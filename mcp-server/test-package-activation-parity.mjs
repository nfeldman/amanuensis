#!/usr/bin/env node
// A24 clean-package differential oracle. It runs the same user-scoped Codex
// lifecycle from the source checkout and from an npm-packed, clean-installed
// artifact. Absolute installation paths and launcher spelling are allowed to
// differ; identity, storage, skill, diagnosis, and lifecycle outcomes are not.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { parse as parseToml } from "smol-toml";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(moduleDir, "..");
const fixture = JSON.parse(
  readFileSync(join(moduleDir, "fixtures/activation/package-parity.json"), "utf8"),
);
const schema = JSON.parse(
  readFileSync(join(moduleDir, "contracts/activation-parity.schema.json"), "utf8"),
);
const caseIndex = process.argv.indexOf("--case");
const candidateCase = caseIndex >= 0 ? process.argv[caseIndex + 1] : "green";
const jsonOutput = process.argv.includes("--json");
assert(
  candidateCase === "green" || Object.hasOwn(fixture.redCases, candidateCase),
  `unknown A24 parity case: ${candidateCase}`,
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed (${result.status})\n${result.stdout}\n${result.stderr}`,
  );
  return result;
}

function initRepository(path) {
  mkdirSync(path, { recursive: true });
  const initialized = spawnSync("git", ["init", "--quiet", "--initial-branch=main"], {
    cwd: path,
    encoding: "utf8",
  });
  assert.equal(initialized.status, 0, initialized.stderr);
  writeFileSync(join(path, "README.md"), `# ${path.split("/").at(-1)}\n`);
}

function fileTreeDigest(root) {
  const rows = [];
  const visit = (dir, prefix = "") => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(path);
      assert(!stat.isSymbolicLink(), `skill contains a symbolic link: ${path}`);
      if (stat.isDirectory()) visit(path, rel);
      else if (stat.isFile()) {
        rows.push(`${rel}\0${createHash("sha256").update(readFileSync(path)).digest("hex")}`);
      }
    }
  };
  visit(root);
  return createHash("sha256").update(rows.join("\n")).digest("hex");
}

function request(server, state, method, params = {}) {
  const id = state.nextId++;
  const response = new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      state.pending.delete(id);
      reject(new Error(`timed out waiting for ${method}; stderr=${state.stderr}`));
    }, 15_000);
    state.pending.set(id, {
      resolve(value) {
        clearTimeout(timer);
        resolvePromise(value);
      },
      reject(error) {
        clearTimeout(timer);
        reject(error);
      },
    });
  });
  server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return response;
}

function launch(command, args, cwd, env) {
  const state = { buffer: "", stderr: "", nextId: 1, pending: new Map() };
  const server = spawn(command, args, {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  server.stderr.on("data", (chunk) => {
    state.stderr += chunk.toString("utf8");
  });
  server.stdout.on("data", (chunk) => {
    state.buffer += chunk.toString("utf8");
    let newline = state.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = state.buffer.slice(0, newline).trim();
      state.buffer = state.buffer.slice(newline + 1);
      if (line) {
        const message = JSON.parse(line);
        const pending = state.pending.get(message.id);
        if (pending) {
          state.pending.delete(message.id);
          if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
          else pending.resolve(message.result);
        }
      }
      newline = state.buffer.indexOf("\n");
    }
  });
  return { server, state };
}

async function stop(server) {
  if (server.exitCode !== null) return;
  await new Promise((resolvePromise) => {
    const timer = setTimeout(() => {
      server.kill("SIGKILL");
      resolvePromise();
    }, 3_000);
    server.once("exit", () => {
      clearTimeout(timer);
      resolvePromise();
    });
    server.kill("SIGTERM");
  });
}

async function probeRepository(entry, repository, label, environment) {
  const configuredCwd = entry.cwd ?? ".";
  const launchCwd = isAbsolute(configuredCwd) ? configuredCwd : resolve(repository, configuredCwd);
  const processEnv = { ...environment, ...(entry.env ?? {}) };
  const { server, state } = launch(entry.command, entry.args ?? [], launchCwd, processEnv);
  try {
    await request(server, state, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: `amanuensis-a24-${label}`, version: "1" },
    });
    server.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`,
    );
    await request(server, state, "tools/list");
    const before = await request(server, state, "tools/call", {
      name: "get_project_info",
      arguments: {},
    });
    const canonical = realpathSync(repository);
    const beforeReceipt = before.structuredContent?.binding_receipt;
    assert.equal(
      beforeReceipt?.canonicalRoot,
      canonical,
      `${label}: canonicalRoot parity mismatch`,
    );
    assert.equal(
      before.structuredContent?.db_exists,
      false,
      `${label}: DB exists before first use`,
    );
    assert(!existsSync(join(repository, ".amanuensis")), `${label}: startup changed repository`);
    await request(server, state, "tools/call", { name: "get_session", arguments: {} });
    const after = await request(server, state, "tools/call", {
      name: "get_project_info",
      arguments: {},
    });
    const receipt = after.structuredContent?.binding_receipt;
    assert.equal(receipt?.canonicalRoot, canonical, `${label}: canonicalRoot parity mismatch`);
    assert.equal(
      receipt?.storagePath,
      join(canonical, ".amanuensis"),
      `${label}: storagePath parity mismatch`,
    );
    return {
      label,
      canonicalRoot: `<${label}>`,
      projectIdentity: `local:<${label}>`,
      storagePath: `<${label}>/.amanuensis`,
      selectionSource: receipt.selectionSource,
      storagePolicy: receipt.storagePolicy,
      dbBeforeFirstUse: before.structuredContent.db_exists,
      dbAfterFirstUse: after.structuredContent.db_exists,
      storeCount: readdirSync(repository).filter((name) => name.startsWith(".amanuensis")).length,
    };
  } finally {
    await stop(server);
  }
}

function runCli(spec, args, cwd, codexHome) {
  return spawnSync(spec.command, [...spec.arguments, ...args], {
    cwd,
    env: { ...spec.environment, CODEX_HOME: codexHome },
    encoding: "utf8",
  });
}

function doctorCodes(spec, repository, codexHome) {
  const result = runCli(
    spec,
    ["doctor", "--client", "codex", "--dir", repository, "--json"],
    repository,
    codexHome,
  );
  const report = JSON.parse(result.stdout);
  return { exitCode: result.status, codes: report.diagnoses.map(({ code }) => code).sort() };
}

function configBackups(codexHome) {
  return readdirSync(codexHome)
    .filter((name) => name.startsWith("config.toml.bak."))
    .sort();
}

function replaceManagedLine(config, key, value) {
  const pattern = new RegExp(`^${key} = .*?$`, "m");
  assert(pattern.test(config), `managed config has no ${key} line`);
  return config.replace(pattern, `${key} = ${JSON.stringify(value)}`);
}

function repositoryCustody(repository) {
  const storage = join(repository, ".amanuensis");
  const path = join(storage, "a24-custody.txt");
  writeFileSync(path, "preserve-a24\n");
  return { storage, path };
}

async function runScenario(mode, root, spec, packageVersion) {
  const codexHome = join(root, "codex-home");
  const repositories = fixture.repositoryLabels.map((label) => join(root, label));
  mkdirSync(codexHome, { recursive: true });
  repositories.forEach(initRepository);
  const unrelated = "# a24 unrelated bytes\n[features]\nkeep = true\n";
  const configPath = join(codexHome, "config.toml");
  writeFileSync(configPath, unrelated);

  const installed = runCli(spec, ["install", "--dir", repositories[0]], repositories[0], codexHome);
  assert.equal(installed.status, 0, installed.stderr);
  assert(installed.stdout.includes("Restart Codex once"), `${mode}: install restart missing`);
  assert(
    installed.stdout.includes("no Amanuensis setup or restart"),
    `${mode}: repo promise missing`,
  );
  for (const repository of repositories) {
    assert(!existsSync(join(repository, ".amanuensis")), `${mode}: install created project state`);
    assert(!existsSync(join(repository, ".codex")), `${mode}: install created project config`);
  }

  const config = readFileSync(configPath, "utf8");
  const entry = parseToml(config).mcp_servers?.["amanuensis-memory"];
  assert(entry, `${mode}: managed Codex entry missing`);
  const observedRepositories = [];
  for (let index = 0; index < repositories.length; index++) {
    observedRepositories.push(
      await probeRepository(
        entry,
        repositories[index],
        fixture.repositoryLabels[index],
        spec.environment,
      ),
    );
  }

  const cleanDoctor = repositories.map((repository) => doctorCodes(spec, repository, codexHome));
  assert(cleanDoctor.every(({ exitCode, codes }) => exitCode === 0 && codes.length === 0));

  const staleConfig = replaceManagedLine(config, "command", "/missing/a24-amanuensis-memory");
  writeFileSync(configPath, staleConfig);
  const staleExecutable = doctorCodes(spec, repositories[0], codexHome);
  writeFileSync(configPath, config);

  const hardCodedConfig = replaceManagedLine(config, "cwd", repositories[0]);
  writeFileSync(configPath, hardCodedConfig);
  const hardCodedUserCwd = doctorCodes(spec, repositories[1], codexHome);
  const repairDryRun = runCli(
    spec,
    ["doctor", "--client", "codex", "--dir", repositories[1], "--repair", "--dry-run", "--json"],
    repositories[1],
    codexHome,
  );
  assert.notEqual(repairDryRun.status, 0, `${mode}: repair dry run hid the cwd fault`);
  const repairPlanId = JSON.parse(repairDryRun.stdout).repairPlanId;
  assert.match(repairPlanId, /^[a-f0-9]{64}$/, `${mode}: repair plan identity missing`);
  const repairApplied = runCli(
    spec,
    [
      "doctor",
      "--client",
      "codex",
      "--dir",
      repositories[1],
      "--repair",
      "--apply-plan",
      repairPlanId,
      "--json",
    ],
    repositories[1],
    codexHome,
  );
  assert.equal(repairApplied.status, 0, repairApplied.stderr || repairApplied.stdout);
  assert.equal(readFileSync(configPath, "utf8"), config, `${mode}: cwd repair changed other bytes`);

  if (candidateCase === "green") {
    assert.deepEqual(staleExecutable.codes, ["stale-executable"], `${mode}: stale classification`);
    assert.deepEqual(
      hardCodedUserCwd.codes,
      ["hard-coded-user-cwd", "wrong-repository-binding"],
      `${mode}: hard-coded cwd classification`,
    );
  }

  const custody = repositories.map(repositoryCustody);
  const upgradeDryRun = runCli(
    spec,
    ["upgrade", "--dir", repositories[0], "--dry-run"],
    repositories[0],
    codexHome,
  );
  assert.equal(upgradeDryRun.status, 0, upgradeDryRun.stderr);
  const upgraded = runCli(spec, ["upgrade", "--dir", repositories[0]], repositories[0], codexHome);
  assert.equal(upgraded.status, 0, upgraded.stderr);
  assert(custody.every(({ path }) => readFileSync(path, "utf8") === "preserve-a24\n"));

  const uninstallDryRun = runCli(
    spec,
    ["uninstall", "--client", "codex", "--scope", "user", "--dir", repositories[0], "--dry-run"],
    repositories[0],
    codexHome,
  );
  assert.equal(uninstallDryRun.status, 0, uninstallDryRun.stderr);
  const uninstalled = runCli(
    spec,
    ["uninstall", "--client", "codex", "--scope", "user", "--dir", repositories[0]],
    repositories[0],
    codexHome,
  );
  assert.equal(uninstalled.status, 0, uninstalled.stderr);
  assert(custody.every(({ path }) => readFileSync(path, "utf8") === "preserve-a24\n"));
  const afterUninstall = readFileSync(configPath, "utf8");
  const skillRoot = join(codexHome, "skills", "amanuensis");
  assert(!existsSync(skillRoot), `${mode}: uninstall retained managed skill`);

  return {
    mode,
    packageVersion,
    launcher: {
      command: entry.command,
      arguments: entry.args ?? [],
      installRoot: spec.installRoot,
    },
    config: {
      managedBlockCount: config.split("# >>> amanuensis init (managed)").length - 1,
      cwdContract: entry.cwd,
      hardCodedRepositoryPathCount: repositories.filter((path) => config.includes(path)).length,
      unrelatedPrefixPreserved: afterUninstall.startsWith(unrelated),
      installationRestartCount: 1,
      perRepositoryRestartCount: 0,
    },
    skillDigest: spec.installedSkillDigest,
    repositories: observedRepositories,
    doctor: {
      cleanRepositoryCount: cleanDoctor.length,
      seededFailureCodes: {
        "stale-executable": staleExecutable.codes,
        "hard-coded-user-cwd": hardCodedUserCwd.codes,
      },
      repairDryRunExitCode: repairDryRun.status,
      repairExitCode: repairApplied.status,
      repairBackupCount: configBackups(codexHome).length,
    },
    lifecycle: {
      upgradeDryRunExitCode: upgradeDryRun.status,
      upgradeExitCode: upgraded.status,
      uninstallDryRunExitCode: uninstallDryRun.status,
      uninstallExitCode: uninstalled.status,
      preservedStoreCount: custody.filter(({ path }) => existsSync(path)).length,
      lostConspectusCount: custody.filter(({ path }) => !existsSync(path)).length,
      unrelatedConfigMutationCount: afterUninstall.startsWith(unrelated) ? 0 : 1,
      skillArchiveCount: readdirSync(join(codexHome, "skills")).filter((name) =>
        name.startsWith("amanuensis.bak."),
      ).length,
    },
  };
}

function comparable(scenario) {
  return Object.fromEntries(fixture.parityPaths.map((path) => [path, scenario[path]]));
}

const scratch = mkdtempSync(join(tmpdir(), "amanuensis-a24-parity-"));
try {
  const packageVersion = JSON.parse(readFileSync(join(moduleDir, "package.json"), "utf8")).version;
  const sourceSkill = join(sourceRoot, ".claude", "skills", "amanuensis");
  const sourceSpec = {
    command: process.execPath,
    arguments: [join(moduleDir, "dist", "cli.js")],
    environment: { ...process.env },
    installRoot: "<source-checkout>",
    installedSkillDigest: fileTreeDigest(sourceSkill),
  };

  const npmCache = join(scratch, "npm-cache");
  run("npm", ["pack", "--silent", "--pack-destination", scratch], {
    cwd: moduleDir,
    env: { ...process.env, npm_config_cache: npmCache },
  });
  const tarballs = readdirSync(scratch).filter((name) => name.endsWith(".tgz"));
  assert.equal(tarballs.length, 1, `expected one tarball, found ${tarballs.length}`);
  const packageInstall = join(scratch, "package-install");
  run(
    "npm",
    ["install", "--prefix", packageInstall, "--no-audit", "--no-fund", join(scratch, tarballs[0])],
    { env: { ...process.env, npm_config_cache: npmCache } },
  );
  const packageRoot = join(packageInstall, "node_modules", "@gruetech", "amanuensis");
  const binRoot = join(packageInstall, "node_modules", ".bin");
  const packageCli = join(binRoot, "amanuensis");
  const packageServer = join(binRoot, "amanuensis-memory");
  const packedSkill = join(packageRoot, "skills", "amanuensis");
  assert(
    existsSync(packageCli) && existsSync(packageServer),
    "packed structural unit floor failed",
  );
  assert(existsSync(join(packedSkill, "SKILL.md")), "packed skill unit floor failed");

  if (candidateCase === "packed-cwd") {
    const compiledCli = join(packageRoot, "dist", "cli.js");
    const original = readFileSync(compiledCli, "utf8");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the red arm injects a literal compiled template
    const sabotaged = original.replace(`'cwd = "."'`, "`cwd = ${JSON.stringify(workspace)}`");
    assert.notEqual(sabotaged, original, "packed cwd sabotage did not arm");
    writeFileSync(compiledCli, sabotaged);
  } else if (candidateCase === "packed-skill-version") {
    const skillPath = join(packedSkill, "SKILL.md");
    writeFileSync(skillPath, `${readFileSync(skillPath, "utf8")}\nA24-PACKED-SKILL-SABOTAGE\n`);
  }

  const packedPath = `${binRoot}:${process.env.PATH ?? ""}`;
  const packedSpec = {
    command: packageCli,
    arguments: [],
    environment: { ...process.env, PATH: packedPath },
    installRoot: "<clean-package-prefix>",
    installedSkillDigest: fileTreeDigest(packedSkill),
  };

  const source = await runScenario(
    "source",
    join(scratch, "source-scenario"),
    sourceSpec,
    packageVersion,
  );
  const packed = await runScenario(
    "packed",
    join(scratch, "packed-scenario"),
    packedSpec,
    packageVersion,
  );
  for (const path of fixture.parityPaths) {
    assert.deepEqual(packed[path], source[path], `source/packed parity mismatch: ${path}`);
  }
  const receipt = {
    schemaVersion: 1,
    fixtureId: fixture.fixtureId,
    result: "passed",
    parityPaths: fixture.parityPaths,
    source,
    packed,
  };
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  assert(validate(receipt), JSON.stringify(validate.errors));
  assert.deepEqual(comparable(source), comparable(packed));
  if (jsonOutput) console.log(JSON.stringify(receipt, null, 2));
  else {
    console.log(
      `A24 package activation parity passed: 2/2 repositories, ${fixture.parityPaths.length}/${fixture.parityPaths.length} parity fields, 2/2 failure classes`,
    );
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
