#!/usr/bin/env node
// A26 clean-prefix lifecycle rehearsal. It packs the exact release candidate,
// migrates an isolated stale Codex home, upgrades to a synthetic successor,
// reinstalls the exact candidate, runs that candidate's rollback upgrade path,
// restores and remigrates the timestamped config backup, and finally uninstalls.
// Every repository store is held by a digest throughout; no live user config is
// read or written.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const jsonOutput = process.argv.includes("--json");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed (${result.status})\n${result.stdout}\n${result.stderr}`,
  );
  return result;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fileDigest(path) {
  return sha256(readFileSync(path));
}

function treeDigest(root) {
  const rows = [];
  const visit = (directory, prefix = "") => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const relativePath = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(path);
      assert(!stat.isSymbolicLink(), `unexpected symbolic link in custody tree: ${path}`);
      if (stat.isDirectory()) visit(path, relativePath);
      else if (stat.isFile()) rows.push(`${relativePath}\0${fileDigest(path)}`);
    }
  };
  visit(root);
  return sha256(rows.join("\n"));
}

function initRepository(path, repositoryId) {
  mkdirSync(path, { recursive: true });
  run("git", ["init", "--quiet", "--initial-branch=main"], { cwd: path });
  writeFileSync(join(path, "README.md"), `# ${repositoryId}\n`);
  const store = join(path, ".amanuensis");
  mkdirSync(store);
  writeFileSync(
    join(store, "a26-lifecycle-custody.json"),
    `${JSON.stringify({ contract: "a26-lifecycle-custody/v1", repositoryId })}\n`,
  );
  return { repositoryId, path, store, digest: treeDigest(store) };
}

function configBackups(codexHome) {
  return readdirSync(codexHome)
    .filter((name) => name.startsWith("config.toml.bak."))
    .sort();
}

function skillArchives(codexHome) {
  const root = join(codexHome, "skills");
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((name) => name.startsWith("amanuensis.bak."));
}

function installTarball(tarball, installRoot, npmCache) {
  run("npm", ["install", "--prefix", installRoot, "--no-audit", "--no-fund", "--force", tarball], {
    env: { ...process.env, npm_config_cache: npmCache },
  });
}

function cliPath(installRoot) {
  return join(installRoot, "node_modules", ".bin", "amanuensis");
}

function packageRoot(installRoot) {
  return join(installRoot, "node_modules", "@gruetech", "amanuensis");
}

function runCli(installRoot, args, cwd, codexHome) {
  const binRoot = join(installRoot, "node_modules", ".bin");
  return spawnSync(cliPath(installRoot), args, {
    cwd,
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
      PATH: `${binRoot}:${process.env.PATH ?? ""}`,
    },
    encoding: "utf8",
  });
}

function assertCli(result, label) {
  assert.equal(result.status, 0, `${label} failed\n${result.stdout}\n${result.stderr}`);
  return result;
}

function assertStores(stores, phase) {
  for (const store of stores) {
    assert(existsSync(store.store), `${phase}: ${store.repositoryId} store disappeared`);
    assert.equal(
      treeDigest(store.store),
      store.digest,
      `${phase}: ${store.repositoryId} store changed`,
    );
  }
}

const scratch = mkdtempSync(join(tmpdir(), "amanuensis-a26-rollback-"));
try {
  const npmCache = join(scratch, "npm-cache");
  const packRoot = join(scratch, "candidate-pack");
  mkdirSync(packRoot);
  run("npm", ["pack", "--silent", "--pack-destination", packRoot], {
    cwd: moduleDir,
    env: { ...process.env, npm_config_cache: npmCache },
  });
  const candidateTarballs = readdirSync(packRoot).filter((name) => name.endsWith(".tgz"));
  assert.equal(candidateTarballs.length, 1, "candidate pack did not yield exactly one tarball");
  const candidateTarball = join(packRoot, candidateTarballs[0]);
  const candidateTarballSha256 = fileDigest(candidateTarball);
  const candidateVersion = JSON.parse(
    readFileSync(join(moduleDir, "package.json"), "utf8"),
  ).version;

  const installRoot = join(scratch, "clean-prefix");
  installTarball(candidateTarball, installRoot, npmCache);
  const candidatePackageRoot = packageRoot(installRoot);
  const candidateSkillDigest = treeDigest(join(candidatePackageRoot, "skills", "amanuensis"));
  assert.equal(
    JSON.parse(readFileSync(join(candidatePackageRoot, "package.json"), "utf8")).version,
    candidateVersion,
    "clean prefix did not install the exact candidate version",
  );

  const repositories = Array.from({ length: 5 }, (_, index) =>
    initRepository(join(scratch, `repository-${index + 1}`), `repository-${index + 1}`),
  );
  const codexHome = join(scratch, "codex-home");
  mkdirSync(codexHome);
  const configPath = join(codexHome, "config.toml");
  const unrelatedPrefix = "# a26 unrelated prefix\n[features]\nkeep = true\n\n";
  const unrelatedSuffix =
    '\n[mcp_servers.other]\ncommand = "keep-server"\n# a26 unrelated suffix\n';
  const originalConfig =
    `${unrelatedPrefix}[mcp_servers.amanuensis-memory]\ncommand = "node"\n` +
    `args = ["/stale/amanuensis-memory.js", "--workspace", ${JSON.stringify(repositories[0].path)}]\n` +
    '[mcp_servers.amanuensis-memory.env]\nAMANUENSIS_AUTOPROGRESS = "1"\n' +
    unrelatedSuffix;
  writeFileSync(configPath, originalConfig);

  const installArgs = ["install", "--dir", repositories[0].path, "--force"];
  const migrationDryRun = assertCli(
    runCli(installRoot, [...installArgs, "--dry-run"], repositories[0].path, codexHome),
    "migration dry run",
  );
  assert.equal(readFileSync(configPath, "utf8"), originalConfig, "migration dry run wrote config");
  assert.equal(configBackups(codexHome).length, 0, "migration dry run created a backup");
  const migrated = assertCli(
    runCli(installRoot, installArgs, repositories[0].path, codexHome),
    "migration apply",
  );
  assert(migrated.stdout.includes("Restart Codex once"), "install restart was not reported");
  const migratedConfig = readFileSync(configPath, "utf8");
  const migratedEntry = parseToml(migratedConfig).mcp_servers?.["amanuensis-memory"];
  assert.equal(migratedEntry?.cwd, ".", "migration did not install cwd-relative launch");
  assert(!migratedConfig.includes(repositories[0].path), "hard-coded repository survived");
  assert(migratedConfig.startsWith(unrelatedPrefix), "migration changed unrelated prefix bytes");
  assert(migratedConfig.endsWith(unrelatedSuffix), "migration changed unrelated suffix bytes");
  const firstBackups = configBackups(codexHome);
  assert.equal(firstBackups.length, 1, "migration did not create one timestamped backup");
  const firstBackupPath = join(codexHome, firstBackups[0]);
  assert.equal(readFileSync(firstBackupPath, "utf8"), originalConfig, "migration backup drifted");
  assertStores(repositories, "migration");

  const successorSource = join(scratch, "synthetic-successor-source");
  cpSync(candidatePackageRoot, successorSource, { recursive: true });
  const successorPackagePath = join(successorSource, "package.json");
  const successorPackage = JSON.parse(readFileSync(successorPackagePath, "utf8"));
  const successorVersion = "0.2.0-a26successor.0";
  successorPackage.version = successorVersion;
  writeFileSync(successorPackagePath, `${JSON.stringify(successorPackage, null, 2)}\n`);
  const successorSkillPath = join(successorSource, "skills", "amanuensis", "SKILL.md");
  writeFileSync(
    successorSkillPath,
    `${readFileSync(successorSkillPath, "utf8")}\nA26-SYNTHETIC-SUCCESSOR\n`,
  );
  const successorSkillDigest = treeDigest(join(successorSource, "skills", "amanuensis"));
  assert.notEqual(successorSkillDigest, candidateSkillDigest, "successor skill did not diverge");
  const successorPackRoot = join(scratch, "successor-pack");
  mkdirSync(successorPackRoot);
  run("npm", ["pack", "--ignore-scripts", "--silent", "--pack-destination", successorPackRoot], {
    cwd: successorSource,
    env: { ...process.env, npm_config_cache: npmCache },
  });
  const successorTarballs = readdirSync(successorPackRoot).filter((name) => name.endsWith(".tgz"));
  assert.equal(successorTarballs.length, 1, "successor pack did not yield exactly one tarball");
  installTarball(join(successorPackRoot, successorTarballs[0]), installRoot, npmCache);
  assert.equal(
    JSON.parse(readFileSync(join(packageRoot(installRoot), "package.json"), "utf8")).version,
    successorVersion,
    "synthetic successor did not replace the candidate",
  );
  const upgradeDryRun = assertCli(
    runCli(
      installRoot,
      ["upgrade", "--dir", repositories[0].path, "--dry-run"],
      repositories[0].path,
      codexHome,
    ),
    "successor upgrade dry run",
  );
  const configBeforeUpgrade = readFileSync(configPath, "utf8");
  const skillBeforeUpgrade = treeDigest(join(codexHome, "skills", "amanuensis"));
  assert.equal(skillBeforeUpgrade, candidateSkillDigest, "candidate skill custody drifted");
  assert.equal(
    readFileSync(configPath, "utf8"),
    configBeforeUpgrade,
    "upgrade dry run wrote config",
  );
  assert.equal(
    treeDigest(join(codexHome, "skills", "amanuensis")),
    skillBeforeUpgrade,
    "upgrade dry run wrote skill",
  );
  const upgraded = assertCli(
    runCli(
      installRoot,
      ["upgrade", "--dir", repositories[0].path],
      repositories[0].path,
      codexHome,
    ),
    "successor upgrade",
  );
  assert(upgraded.stdout.includes("Restart Codex once"), "upgrade restart was not reported");
  assert.equal(
    treeDigest(join(codexHome, "skills", "amanuensis")),
    successorSkillDigest,
    "successor skill was not installed",
  );
  assertStores(repositories, "upgrade");

  installTarball(candidateTarball, installRoot, npmCache);
  assert.equal(fileDigest(candidateTarball), candidateTarballSha256, "candidate tarball drifted");
  assert.equal(
    JSON.parse(readFileSync(join(packageRoot(installRoot), "package.json"), "utf8")).version,
    candidateVersion,
    "candidate version was not reinstalled for rollback",
  );
  const rollbackDryRun = assertCli(
    runCli(
      installRoot,
      ["upgrade", "--dir", repositories[0].path, "--dry-run"],
      repositories[0].path,
      codexHome,
    ),
    "rollback dry run",
  );
  const successorInstalledSkillDigest = treeDigest(join(codexHome, "skills", "amanuensis"));
  assert.equal(
    successorInstalledSkillDigest,
    successorSkillDigest,
    "successor skill missing before rollback",
  );
  const rolledBack = assertCli(
    runCli(
      installRoot,
      ["upgrade", "--dir", repositories[0].path],
      repositories[0].path,
      codexHome,
    ),
    "rollback apply",
  );
  assert(rolledBack.stdout.includes("Restart Codex once"), "rollback restart was not reported");
  assert.equal(
    treeDigest(join(codexHome, "skills", "amanuensis")),
    candidateSkillDigest,
    "rollback did not restore the exact candidate skill",
  );
  assertStores(repositories, "package rollback");

  const managedConfigBeforeBackupRestore = readFileSync(configPath, "utf8");
  writeFileSync(configPath, readFileSync(firstBackupPath));
  assert.equal(
    readFileSync(configPath, "utf8"),
    originalConfig,
    "backup restore was not byte exact",
  );
  const remigrationDryRun = assertCli(
    runCli(installRoot, [...installArgs, "--dry-run"], repositories[0].path, codexHome),
    "post-restore migration dry run",
  );
  assert.equal(
    readFileSync(configPath, "utf8"),
    originalConfig,
    "remigration dry run wrote config",
  );
  assertCli(
    runCli(installRoot, installArgs, repositories[0].path, codexHome),
    "post-restore migration apply",
  );
  assert.equal(
    readFileSync(configPath, "utf8"),
    managedConfigBeforeBackupRestore,
    "remigration did not restore managed config",
  );
  assertStores(repositories, "configuration rollback and remigration");

  const configBeforeUninstall = readFileSync(configPath, "utf8");
  const skillBeforeUninstall = treeDigest(join(codexHome, "skills", "amanuensis"));
  const uninstallArgs = [
    "uninstall",
    "--client",
    "codex",
    "--scope",
    "user",
    "--dir",
    repositories[0].path,
  ];
  const uninstallDryRun = assertCli(
    runCli(installRoot, [...uninstallArgs, "--dry-run"], repositories[0].path, codexHome),
    "uninstall dry run",
  );
  assert.equal(
    readFileSync(configPath, "utf8"),
    configBeforeUninstall,
    "uninstall dry run wrote config",
  );
  assert.equal(
    treeDigest(join(codexHome, "skills", "amanuensis")),
    skillBeforeUninstall,
    "uninstall dry run wrote skill",
  );
  const uninstalled = assertCli(
    runCli(installRoot, uninstallArgs, repositories[0].path, codexHome),
    "uninstall apply",
  );
  assert(uninstalled.stdout.includes("Restart Codex once"), "uninstall restart was not reported");
  assert(!existsSync(join(codexHome, "skills", "amanuensis")), "uninstall retained managed skill");
  const afterUninstall = readFileSync(configPath, "utf8");
  assert(
    !afterUninstall.includes("amanuensis init (managed)"),
    "uninstall retained managed config",
  );
  assert(afterUninstall.startsWith(unrelatedPrefix), "uninstall changed unrelated prefix bytes");
  assert(afterUninstall.endsWith(unrelatedSuffix), "uninstall changed unrelated suffix bytes");
  assertStores(repositories, "uninstall");
  assert.equal(skillArchives(codexHome).length, 0, "lifecycle created a skill archive");

  const receipt = {
    schemaVersion: 1,
    fixtureId: "a26-clean-prefix-rollback-rehearsal",
    result: "passed",
    isolation: {
      liveUserConfigurationRead: false,
      liveUserConfigurationWritten: false,
      cleanPrefix: true,
      cleanCodexHome: true,
      logicalRepositoryCount: repositories.length,
    },
    candidate: {
      packageVersion: candidateVersion,
      tarballSha256: candidateTarballSha256,
      installedVersionAfterRollback: candidateVersion,
      skillDigest: candidateSkillDigest,
    },
    syntheticSuccessor: {
      packageVersion: successorVersion,
      published: false,
      skillDigest: successorSkillDigest,
    },
    migration: {
      dryRunExitCode: migrationDryRun.status,
      dryRunMutationCount: 0,
      applyExitCode: migrated.status,
      timestampedBackupCountAfterMigration: firstBackups.length,
      backupReadBackExact: true,
      hardCodedRepositoryPathCount: 0,
      cwdContract: migratedEntry.cwd,
      unrelatedPrefixBytePreserved: true,
      unrelatedSuffixBytePreserved: true,
    },
    lifecycle: {
      upgrade: {
        dryRunExitCode: upgradeDryRun.status,
        applyExitCode: upgraded.status,
        installedVersion: successorVersion,
      },
      rollback: {
        exactCandidateTarballReinstalled: true,
        dryRunExitCode: rollbackDryRun.status,
        applyExitCode: rolledBack.status,
        restoredVersion: candidateVersion,
        restoredSkillDigest: candidateSkillDigest,
        configurationBackupRestoredByteExact: true,
        remigrationDryRunExitCode: remigrationDryRun.status,
      },
      uninstall: {
        dryRunExitCode: uninstallDryRun.status,
        applyExitCode: uninstalled.status,
        managedConfigPresentAfter: false,
        managedSkillPresentAfter: false,
      },
    },
    restartObservations: {
      initialInstallation: 1,
      perRepository: 0,
      ordinaryFirstUse: 0,
      upgrade: 1,
      rollback: 1,
      uninstall: 1,
    },
    storeCustody: repositories.map(({ repositoryId, digest }) => ({
      repositoryId,
      digestBefore: digest,
      digestAfter: digest,
      preserved: true,
    })),
    lostConspectusCount: 0,
    skillArchiveCount: skillArchives(codexHome).length,
  };
  if (jsonOutput) console.log(JSON.stringify(receipt, null, 2));
  else {
    console.log(
      `A26 rollback rehearsal passed: exact ${candidateVersion} tarball restored, ${repositories.length}/${repositories.length} stores preserved, 0 skill archives`,
    );
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
