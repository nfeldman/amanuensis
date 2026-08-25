#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const cli = join(moduleDir, "dist/cli.js");
const server = join(moduleDir, "dist/index.js");
const sourceSkill = join(moduleDir, "..", ".claude", "skills", "amanuensis");
const packageVersion = JSON.parse(readFileSync(join(moduleDir, "package.json"), "utf8")).version;
const fixture = JSON.parse(
  readFileSync(join(moduleDir, "fixtures/activation/conflicting-user-project.json"), "utf8"),
);

function run(args, cwd, codexHome) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    env: { ...process.env, CODEX_HOME: codexHome },
    encoding: "utf8",
  });
}

function initRepository(path) {
  mkdirSync(path, { recursive: true });
  const result = spawnSync("git", ["init", "--quiet", "--initial-branch=main"], {
    cwd: path,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
}

function backupsFor(path) {
  const prefix = `${path.split("/").at(-1)}.bak.`;
  return readdirSync(dirname(path)).filter((name) => name.startsWith(prefix));
}

const root = mkdtempSync(join(tmpdir(), "amanuensis-a20-red-"));
const repositoryA = join(root, "repository-a");
const repositoryB = join(root, "repository-b");
const codexHome = join(root, "codex-home");
initRepository(repositoryA);
initRepository(repositoryB);
mkdirSync(codexHome);

try {
  const projectInstall = run(
    ["init", "--client", "codex", "--scope", "project", "--dir", repositoryB],
    repositoryB,
    codexHome,
  );
  assert.equal(projectInstall.status, 0, projectInstall.stderr);
  cpSync(sourceSkill, join(codexHome, "skills", "amanuensis"), { recursive: true });

  const userConfig = join(codexHome, "config.toml");
  const userBefore =
    "# unrelated prefix\n[features]\nkeep = true\n\n" +
    "[mcp_servers.amanuensis-memory]\n" +
    `command = ${JSON.stringify(process.execPath)}\n` +
    `args = [${JSON.stringify(server)}, "--workspace", ${JSON.stringify(repositoryA)}]\n` +
    'cwd = "."\n\n' +
    '[mcp_servers.other]\ncommand = "keep-server"\n';
  writeFileSync(userConfig, userBefore);
  const projectConfig = join(repositoryB, ".codex", "config.toml");
  const projectBefore = readFileSync(projectConfig, "utf8");

  const diagnosed = run(
    ["doctor", "--client", "codex", "--dir", repositoryB, "--json"],
    repositoryB,
    codexHome,
  );
  assert.notEqual(diagnosed.status, 0, "conflicting registrations received a green diagnosis");
  const report = JSON.parse(diagnosed.stdout);
  const canonicalRepositoryB = realpathSync(repositoryB);
  assert.equal(report.fixtureContract, "codex-activation/v1");
  assert.equal(report.repository.canonicalRoot, canonicalRepositoryB);
  assert.equal(report.repository.storagePath, join(canonicalRepositoryB, ".amanuensis"));
  assert.equal(report.configuration.effectiveSource, fixture.expectedEffectiveSource);
  assert.equal(report.process.serverVersion, packageVersion);
  assert.equal(report.process.configuredCommand, process.execPath);
  assert(report.diagnoses.every((diagnosis) => diagnosis.path && diagnosis.remediation));
  const diagnosisCodes = report.diagnoses.map((diagnosis) => diagnosis.code).sort();
  assert.deepEqual(diagnosisCodes, [...fixture.expectedDiagnoses].sort());
  assert.equal(readFileSync(userConfig, "utf8"), userBefore, "doctor changed user config");
  assert.equal(readFileSync(projectConfig, "utf8"), projectBefore, "doctor changed project config");

  const dryRun = run(
    ["doctor", "--client", "codex", "--dir", repositoryB, "--repair", "--dry-run", "--json"],
    repositoryB,
    codexHome,
  );
  assert.notEqual(dryRun.status, 0, "repair dry-run hid the active diagnosis");
  const dryReport = JSON.parse(dryRun.stdout);
  assert.match(dryReport.repairPlanId, /^[a-f0-9]{64}$/);
  assert(dryReport.repairActions.length >= 3, "repair plan omitted required actions");
  assert.equal(readFileSync(userConfig, "utf8"), userBefore, "repair dry-run changed user config");
  assert.equal(
    readFileSync(projectConfig, "utf8"),
    projectBefore,
    "repair dry-run changed project config",
  );
  assert.equal(backupsFor(userConfig).length, 0, "repair dry-run created a user backup");
  assert.equal(backupsFor(projectConfig).length, 0, "repair dry-run created a project backup");

  const wrongPlan = run(
    [
      "doctor",
      "--client",
      "codex",
      "--dir",
      repositoryB,
      "--repair",
      "--apply-plan",
      "0".repeat(64),
      "--json",
    ],
    repositoryB,
    codexHome,
  );
  assert.notEqual(wrongPlan.status, 0, "a stale repair plan was applied");
  assert.equal(readFileSync(userConfig, "utf8"), userBefore, "stale plan changed user config");

  const applied = run(
    [
      "doctor",
      "--client",
      "codex",
      "--dir",
      repositoryB,
      "--repair",
      "--apply-plan",
      dryReport.repairPlanId,
      "--json",
    ],
    repositoryB,
    codexHome,
  );
  assert.equal(applied.status, 0, applied.stderr || applied.stdout);
  const appliedReport = JSON.parse(applied.stdout);
  assert.equal(appliedReport.status, "ok");
  assert.equal(appliedReport.restart.state, "required");
  assert.equal(appliedReport.configuration.user.activationContract, "codex-user-cwd-v1");
  assert.equal(backupsFor(userConfig).length, 1, "user migration backup missing");
  assert.equal(readFileSync(join(codexHome, backupsFor(userConfig)[0]), "utf8"), userBefore);
  assert.equal(backupsFor(projectConfig).length, 1, "project migration backup missing");
  assert.equal(
    readFileSync(join(dirname(projectConfig), backupsFor(projectConfig)[0]), "utf8"),
    projectBefore,
  );
  const userAfter = readFileSync(userConfig, "utf8");
  assert(userAfter.startsWith("# unrelated prefix\n[features]\nkeep = true\n\n"));
  assert(userAfter.includes('[mcp_servers.other]\ncommand = "keep-server"'));
  assert(!userAfter.includes(repositoryA), "hard-coded user workspace survived repair");
  assert(!existsSync(join(repositoryB, ".agents", "skills", "amanuensis")));

  const staleHome = join(root, "stale-home");
  mkdirSync(staleHome);
  writeFileSync(
    join(staleHome, "config.toml"),
    "# >>> amanuensis init (managed)\n" +
      "[mcp_servers.amanuensis-memory]\n" +
      'command = "/definitely/missing/amanuensis-memory"\n' +
      'cwd = "."\n' +
      'env = { AMANUENSIS_ACTIVATION_CONTRACT = "codex-user-cwd-v1" }\n' +
      "# <<< amanuensis init (managed)\n",
  );
  const stale = run(
    ["doctor", "--client", "codex", "--dir", repositoryA, "--json"],
    repositoryA,
    staleHome,
  );
  assert.notEqual(stale.status, 0, "stale executable received a green diagnosis");
  assert(
    JSON.parse(stale.stdout).diagnoses.some((diagnosis) => diagnosis.code === "stale-executable"),
    "stale executable was not identified",
  );

  console.log(
    "A20 red gate verified: conflicting user/project registration halted, planned, repaired, and read back",
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
