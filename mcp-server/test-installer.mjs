#!/usr/bin/env node
// Adversarial probes for the client-adapter installer. Every test runs in a
// fresh temporary workspace and reads back the files the selected client will
// consume.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "jsonc-parser";
import { parse as parseToml } from "smol-toml";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const CLI = join(moduleDir, "dist", "cli.js");
const SOURCE_SERVER = join(moduleDir, "dist", "index.js");
// biome-ignore lint/suspicious/noTemplateCurlyInString: Claude Code expansion syntax
const CLAUDE_PROJECT_VAR = "${CLAUDE_PROJECT_DIR:-.}";
// biome-ignore lint/suspicious/noTemplateCurlyInString: VS Code expansion syntax
const VSCODE_WORKSPACE_VAR = "${workspaceFolder}";

let passed = 0;
let failed = 0;

function test(label, fn) {
  try {
    fn();
    console.log(`  ok   ${label}`);
    passed++;
  } catch (error) {
    console.log(`  FAIL ${label}\n       ${error.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runCli(args, options = {}) {
  const effectiveArgs =
    args[0] === "init" &&
    args[args.indexOf("--client") + 1] === "codex" &&
    !args.includes("--scope")
      ? [...args, "--scope", "project"]
      : args;
  return spawnSync(process.execPath, [CLI, ...effectiveArgs], { encoding: "utf8", ...options });
}

function fresh() {
  return mkdtempSync(join(tmpdir(), "amanuensis-installer-"));
}

function readJson(path) {
  return parse(readFileSync(path, "utf8"));
}

function backupsFor(path) {
  const dir = dirname(path);
  if (!existsSync(dir)) return [];
  const base = path.slice(dir.length + 1);
  return readdirSync(dir).filter((entry) => entry.startsWith(`${base}.bak.`));
}

function skillRoot(workspace, client) {
  return join(
    workspace,
    client === "claude" ? ".claude/skills/amanuensis" : ".agents/skills/amanuensis",
  );
}

function assertSkill(workspace, client) {
  const root = skillRoot(workspace, client);
  const skillPath = join(root, "SKILL.md");
  assert(existsSync(skillPath), `${client} SKILL.md missing`);
  const skillText = readFileSync(skillPath, "utf8").replace(/\s+/g, " ");
  assert(
    skillText.includes("Never scan, classify, or cite `.amanuensis/` as target-project source"),
    `${client} skill does not exclude project-local tool state from evidence`,
  );
  assert(existsSync(join(root, "references/setup.md")), `${client} setup reference missing`);
  assert(
    existsSync(join(root, "references/phase-4-adversarial.md")),
    `${client} adversarial reference missing`,
  );
}

test("requires an explicit client and writes nothing on omission", () => {
  const workspace = fresh();
  try {
    const result = runCli(["init", "--dir", workspace]);
    assert(result.status !== 0, "missing --client should fail");
    assert(result.stderr.includes("--client is required"), result.stderr);
    assert(readdirSync(workspace).length === 0, "installer wrote before rejecting ambiguity");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("Claude adapter installs the skill and Claude project MCP config", () => {
  const workspace = fresh();
  try {
    const result = runCli(["init", "--client", "claude", "--dir", workspace]);
    assert(result.status === 0, result.stderr);
    assertSkill(workspace, "claude");
    const config = readJson(join(workspace, ".mcp.json"));
    const entry = config.mcpServers?.["amanuensis-memory"];
    assert(entry?.command === process.execPath, "Claude source launcher is not durable");
    assert(entry.args?.[0] === SOURCE_SERVER, "Claude source server entry missing");
    assert(entry.args?.includes("--allow-workspace-pin"), "Claude workspace pin is not explicit");
    assert(entry.args?.at(-1) === CLAUDE_PROJECT_VAR, "Claude project root is not portable");
    assert(!existsSync(join(workspace, ".vscode")), "Claude adapter created VS Code state");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("Codex project scope is an explicit repository pin", () => {
  const workspace = fresh();
  try {
    const result = runCli(["init", "--client", "codex", "--dir", workspace]);
    assert(result.status === 0, result.stderr);
    assertSkill(workspace, "codex");
    const config = readFileSync(join(workspace, ".codex/config.toml"), "utf8");
    assert(config.includes("# >>> amanuensis init (managed)"), "managed block missing");
    assert(config.includes("[mcp_servers.amanuensis-memory]"), "Codex server table missing");
    assert(
      config.includes(`command = ${JSON.stringify(process.execPath)}`),
      "Codex command missing",
    );
    assert(config.includes(JSON.stringify(SOURCE_SERVER)), "Codex source server entry missing");
    assert(config.includes('cwd = "."'), "Codex working root is not explicit");
    assert(config.includes(workspace), "Codex project pin omitted its explicit workspace");
    assert(config.includes("--allow-workspace-pin"), "Codex project pin lacks its opt-in marker");
    assert(
      config.includes('AMANUENSIS_ACTIVATION_CONTRACT = "codex-project-pin-v1"'),
      "Codex project activation contract missing",
    );
    const parsed = parseToml(config);
    assert(parsed.mcp_servers?.["amanuensis-memory"]?.cwd === ".", "Codex config is invalid");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("Codex user scope installs once without repository-local state", () => {
  const workspace = fresh();
  const userHome = fresh();
  try {
    const result = runCli(["init", "--client", "codex", "--scope", "user", "--dir", workspace], {
      env: { ...process.env, CODEX_HOME: userHome },
    });
    assert(result.status === 0, result.stderr);
    assert(existsSync(join(userHome, "skills/amanuensis/SKILL.md")), "global skill missing");
    const path = join(userHome, "config.toml");
    const config = readFileSync(path, "utf8");
    const entry = parseToml(config).mcp_servers?.["amanuensis-memory"];
    assert(entry?.cwd === ".", "user-scoped Codex cwd is not relative");
    assert(!entry?.args?.includes("--workspace"), "user registration contains --workspace");
    assert(!config.includes(workspace), "user registration contains the target repository");
    assert(
      entry?.env?.AMANUENSIS_ACTIVATION_CONTRACT === "codex-user-cwd-v1",
      "user activation contract missing",
    );
    assert(readdirSync(workspace).length === 0, "user install changed the repository");
    assert(result.stdout.includes("Restart Codex once"), "one installation restart not reported");
    assert(
      result.stdout.includes("no Amanuensis setup or restart"),
      "zero per-repository restart contract not reported",
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(userHome, { recursive: true, force: true });
  }
});

test("Codex install and upgrade are dry-run-first lifecycle commands that preserve storage", () => {
  const workspace = fresh();
  const userHome = fresh();
  try {
    const configPath = join(userHome, "config.toml");
    const unrelated = "# preserve byte-for-byte\n[features]\nkeep = true\n";
    writeFileSync(configPath, unrelated);
    const installed = runCli(["install", "--client", "codex", "--dir", workspace], {
      env: { ...process.env, CODEX_HOME: userHome },
    });
    assert(installed.status === 0, installed.stderr);
    assert(installed.stdout.includes("Restart Codex once"), "install restart is unclear");
    assert(readdirSync(workspace).length === 0, "install created repository-local state");

    const store = join(workspace, ".amanuensis");
    mkdirSync(store);
    writeFileSync(join(store, "preserve.txt"), "conspectus\n");
    const skillPath = join(userHome, "skills/amanuensis/SKILL.md");
    writeFileSync(skillPath, "stale managed skill\n");
    const desiredCommand = `command = ${JSON.stringify(process.execPath)}`;
    const staleConfig = readFileSync(configPath, "utf8").replace(
      desiredCommand,
      'command = "/stale/amanuensis-memory"',
    );
    assert(staleConfig !== readFileSync(configPath, "utf8"), "fixture did not stale config");
    writeFileSync(configPath, staleConfig);
    const backupsBefore = backupsFor(configPath).length;

    const dryRun = runCli(["upgrade", "--client", "codex", "--dir", workspace, "--dry-run"], {
      env: { ...process.env, CODEX_HOME: userHome },
    });
    assert(dryRun.status === 0, dryRun.stderr);
    assert(dryRun.stdout.includes("[dry-run] Upgrading"), "upgrade plan is not explicit");
    assert(readFileSync(configPath, "utf8") === staleConfig, "upgrade dry run changed config");
    assert(readFileSync(skillPath, "utf8") === "stale managed skill\n", "dry run changed skill");

    const upgraded = runCli(["upgrade", "--client", "codex", "--dir", workspace], {
      env: { ...process.env, CODEX_HOME: userHome },
    });
    assert(upgraded.status === 0, upgraded.stderr);
    const upgradedConfig = readFileSync(configPath, "utf8");
    assert(upgradedConfig.startsWith(unrelated), "upgrade changed unrelated Codex config bytes");
    assert(upgradedConfig.includes(desiredCommand), "upgrade did not restore current launcher");
    assert(backupsFor(configPath).length === backupsBefore + 1, "upgrade backup missing");
    assert(readFileSync(skillPath, "utf8").includes("name: amanuensis"), "skill not upgraded");
    assert(backupsFor(skillPath).length === 0, "old skill was unexpectedly archived");
    assert(
      readFileSync(join(store, "preserve.txt"), "utf8") === "conspectus\n",
      "upgrade changed conspectus storage",
    );
    assert(upgraded.stdout.includes("Restart Codex once"), "upgrade restart is unclear");
    assert(
      upgraded.stdout.includes("no Amanuensis setup or restart"),
      "upgrade reintroduced per-repository ceremony",
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(userHome, { recursive: true, force: true });
  }
});

test("Codex user migration and uninstall preserve unrelated TOML with backups", () => {
  const workspace = fresh();
  const userHome = fresh();
  try {
    const path = join(userHome, "config.toml");
    const before =
      "# unrelated prefix comment\n[features]\nkeep = true\n\n" +
      '[mcp_servers.amanuensis-memory]\ncommand = "node"\n' +
      `args = ["server.js", "--workspace", ${JSON.stringify(workspace)}]\n\n` +
      '[mcp_servers.amanuensis-memory.env]\nAMANUENSIS_AUTOPROGRESS = "1"\n\n' +
      '[mcp_servers.other]\ncommand = "keep-server"\n';
    writeFileSync(path, before);
    const migrated = runCli(
      ["init", "--client", "codex", "--scope", "user", "--dir", workspace, "--mcp-only", "--force"],
      { env: { ...process.env, CODEX_HOME: userHome } },
    );
    assert(migrated.status === 0, migrated.stderr);
    const afterMigration = readFileSync(path, "utf8");
    assert(afterMigration.includes("# unrelated prefix comment"), "prefix comment changed");
    assert(afterMigration.includes("[features]\nkeep = true"), "unrelated feature changed");
    assert(
      afterMigration.includes('[mcp_servers.other]\ncommand = "keep-server"'),
      "other server changed",
    );
    assert(!afterMigration.includes(workspace), "hard-coded workspace survived migration");
    assert(afterMigration.includes("# >>> amanuensis init (managed)"), "managed block missing");
    const migratedEntry = parseToml(afterMigration).mcp_servers?.["amanuensis-memory"];
    assert(
      migratedEntry?.env?.AMANUENSIS_ACTIVATION_CONTRACT === "codex-user-cwd-v1",
      "nested legacy table was not replaced by the managed activation contract",
    );
    const migrationBackups = backupsFor(path);
    assert(migrationBackups.length === 1, "migration backup missing");
    assert(
      readFileSync(join(userHome, migrationBackups[0]), "utf8") === before,
      "migration backup does not match the original",
    );

    const uninstalled = runCli(
      ["uninstall", "--client", "codex", "--scope", "user", "--dir", workspace, "--mcp-only"],
      { env: { ...process.env, CODEX_HOME: userHome } },
    );
    assert(uninstalled.status === 0, uninstalled.stderr);
    const afterUninstall = readFileSync(path, "utf8");
    assert(
      !afterUninstall.includes("amanuensis init (managed)"),
      "managed block survived uninstall",
    );
    assert(
      afterUninstall.includes("# unrelated prefix comment"),
      "uninstall changed prefix comment",
    );
    assert(afterUninstall.includes("[features]\nkeep = true"), "uninstall changed feature config");
    assert(
      afterUninstall.includes('[mcp_servers.other]\ncommand = "keep-server"'),
      "uninstall changed other server",
    );
    assert(backupsFor(path).length === 2, "uninstall backup missing");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(userHome, { recursive: true, force: true });
  }
});

test("Codex user uninstall removes only the managed skill and preserves conspectus state", () => {
  const workspace = fresh();
  const userHome = fresh();
  try {
    const install = runCli(["init", "--client", "codex", "--scope", "user", "--dir", workspace], {
      env: { ...process.env, CODEX_HOME: userHome },
    });
    assert(install.status === 0, install.stderr);
    const store = join(workspace, ".amanuensis");
    mkdirSync(store);
    writeFileSync(join(store, "preserve.txt"), "conspectus\n");
    const skill = join(userHome, "skills/amanuensis");
    const configBefore = readFileSync(join(userHome, "config.toml"), "utf8");

    const dryRun = runCli(
      ["uninstall", "--client", "codex", "--scope", "user", "--dir", workspace, "--dry-run"],
      { env: { ...process.env, CODEX_HOME: userHome } },
    );
    assert(dryRun.status === 0, dryRun.stderr);
    assert(existsSync(skill), "dry-run removed the skill");
    assert(
      readFileSync(join(userHome, "config.toml"), "utf8") === configBefore,
      "dry-run changed config",
    );

    const uninstall = runCli(
      ["uninstall", "--client", "codex", "--scope", "user", "--dir", workspace],
      { env: { ...process.env, CODEX_HOME: userHome } },
    );
    assert(uninstall.status === 0, uninstall.stderr);
    assert(!existsSync(skill), "managed skill remains discoverable");
    assert(backupsFor(skill).length === 0, "managed skill was unexpectedly archived");
    assert(
      readFileSync(join(store, "preserve.txt"), "utf8") === "conspectus\n",
      "conspectus changed",
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(userHome, { recursive: true, force: true });
  }
});

test("VS Code adapter installs a portable skill, not the custom-agent bundle", () => {
  const workspace = fresh();
  try {
    const result = runCli(["init", "--client", "vscode", "--dir", workspace]);
    assert(result.status === 0, result.stderr);
    assertSkill(workspace, "vscode");
    const config = readJson(join(workspace, ".vscode/mcp.json"));
    const entry = config.servers?.["amanuensis-memory"];
    assert(entry?.command === process.execPath, "VS Code source launcher is not durable");
    assert(entry?.args?.[0] === SOURCE_SERVER, "VS Code source server entry missing");
    assert(entry?.args?.includes("--allow-workspace-pin"), "VS Code workspace pin is not explicit");
    assert(entry?.args?.at(-1) === VSCODE_WORKSPACE_VAR, "VS Code workspace binding missing");
    assert(!existsSync(join(workspace, ".github/agents")), "legacy custom agents were installed");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("generic adapter installs only the skill and prints an explicit stdio command", () => {
  const workspace = fresh();
  try {
    const result = runCli(["init", "--client", "generic", "--dir", workspace]);
    assert(result.status === 0, result.stderr);
    assertSkill(workspace, "generic");
    assert(
      result.stdout.includes(JSON.stringify(process.execPath)),
      "registration command missing",
    );
    assert(result.stdout.includes(SOURCE_SERVER), "source server argument missing");
    assert(result.stdout.includes(workspace), "registration command is not bound to target");
    assert(result.stdout.includes("AMANUENSIS_AUTOPROGRESS=1"), "required environment missing");
    assert(
      result.stdout.includes("full method is not automatic"),
      "generic-host workflow limitation is not disclosed",
    );
    assert(!existsSync(join(workspace, ".mcp.json")), "invented a generic config file");
    assert(!existsSync(join(workspace, ".codex")), "generic adapter created Codex config");
    assert(!existsSync(join(workspace, ".vscode")), "generic adapter created VS Code config");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("--mcp-only configures a source launcher without creating a shadow skill copy", () => {
  for (const client of ["claude", "codex", "vscode"]) {
    const workspace = fresh();
    try {
      const result = runCli(["init", "--client", client, "--dir", workspace, "--mcp-only"]);
      assert(result.status === 0, `${client}: ${result.stderr}`);
      assert(!existsSync(skillRoot(workspace, client)), `${client}: project skill shadow created`);
      if (client === "codex") {
        const config = readFileSync(join(workspace, ".codex/config.toml"), "utf8");
        assert(config.includes(SOURCE_SERVER), "Codex source server entry missing");
      } else {
        const path = join(workspace, client === "claude" ? ".mcp.json" : ".vscode/mcp.json");
        const root = client === "claude" ? "mcpServers" : "servers";
        assert(readJson(path)[root]?.["amanuensis-memory"], `${client}: MCP entry missing`);
      }
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
});

test("generic --mcp-only fails instead of pretending to configure an unknown host", () => {
  const workspace = fresh();
  try {
    const result = runCli(["init", "--client", "generic", "--dir", workspace, "--mcp-only"]);
    assert(result.status !== 0, "generic --mcp-only should fail");
    assert(result.stderr.includes("unavailable for generic clients"), result.stderr);
    assert(readdirSync(workspace).length === 0, "generic --mcp-only wrote files");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("JSON adapters preserve unrelated servers and write a backup", () => {
  for (const client of ["claude", "vscode"]) {
    const workspace = fresh();
    try {
      const path = join(workspace, client === "claude" ? ".mcp.json" : ".vscode/mcp.json");
      const rootKey = client === "claude" ? "mcpServers" : "servers";
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(
        path,
        JSON.stringify({ [rootKey]: { other: { command: "other-server", args: ["--keep"] } } }),
      );
      const result = runCli(["init", "--client", client, "--dir", workspace]);
      assert(result.status === 0, `${client}: ${result.stderr}`);
      const config = readJson(path);
      assert(config[rootKey].other.args[0] === "--keep", `${client}: unrelated server changed`);
      assert(config[rootKey]["amanuensis-memory"], `${client}: Amanuensis server missing`);
      assert(backupsFor(path).length === 1, `${client}: backup missing`);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
});

test("JSON entry equality ignores object key order", () => {
  const workspace = fresh();
  try {
    const path = join(workspace, ".mcp.json");
    writeFileSync(
      path,
      JSON.stringify({
        mcpServers: {
          "amanuensis-memory": {
            env: { AMANUENSIS_AUTOPROGRESS: "1" },
            args: [SOURCE_SERVER, "--allow-workspace-pin", "--workspace", CLAUDE_PROJECT_VAR],
            command: process.execPath,
            type: "stdio",
          },
        },
      }),
    );
    const before = readFileSync(path, "utf8");
    const result = runCli(["init", "--client", "claude", "--dir", workspace]);
    assert(result.status === 0, result.stderr);
    assert(readFileSync(path, "utf8") === before, "equivalent entry was rewritten");
    assert(backupsFor(path).length === 0, "equivalent entry created a backup");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("Codex adapter preserves unrelated TOML verbatim", () => {
  const workspace = fresh();
  try {
    const path = join(workspace, ".codex/config.toml");
    mkdirSync(dirname(path), { recursive: true });
    const original = '[model]\nname = "keep-me"\n';
    writeFileSync(path, original);
    const result = runCli(["init", "--client", "codex", "--dir", workspace]);
    assert(result.status === 0, result.stderr);
    const config = readFileSync(path, "utf8");
    assert(config.startsWith(original), "existing TOML was reformatted or changed");
    assert(config.includes("[mcp_servers.amanuensis-memory]"), "managed block missing");
    assert(backupsFor(path).length === 1, "Codex config backup missing");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("all adapters are idempotent on a second run", () => {
  for (const client of ["claude", "codex", "vscode", "generic"]) {
    const workspace = fresh();
    try {
      const first = runCli(["init", "--client", client, "--dir", workspace]);
      assert(first.status === 0, `${client} first run: ${first.stderr}`);
      const skill = join(skillRoot(workspace, client), "SKILL.md");
      const skillMtime = statSync(skill).mtimeMs;
      const second = runCli(["init", "--client", client, "--dir", workspace]);
      assert(second.status === 0, `${client} second run: ${second.stderr}`);
      assert(statSync(skill).mtimeMs === skillMtime, `${client} rewrote an up-to-date skill`);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
});

test("a config conflict halts before writing any skill files", () => {
  const workspace = fresh();
  try {
    writeFileSync(
      join(workspace, ".mcp.json"),
      JSON.stringify({ mcpServers: { "amanuensis-memory": { command: "user-command" } } }),
    );
    const result = runCli(["init", "--client", "claude", "--dir", workspace]);
    assert(result.status !== 0, "conflicting config should fail");
    assert(result.stderr.includes("nothing was written"), result.stderr);
    assert(!existsSync(skillRoot(workspace, "claude")), "skill was partially installed");
    assert(backupsFor(join(workspace, ".mcp.json")).length === 0, "backup written before halt");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("--force backs up and replaces a conflicting JSON server entry", () => {
  const workspace = fresh();
  try {
    const path = join(workspace, ".vscode/mcp.json");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        servers: {
          "amanuensis-memory": { command: "old" },
          other: { command: "keep" },
        },
      }),
    );
    const result = runCli(["init", "--client", "vscode", "--dir", workspace, "--force"]);
    assert(result.status === 0, result.stderr);
    const config = readJson(path);
    assert(config.servers["amanuensis-memory"].command === process.execPath, "entry not replaced");
    assert(config.servers.other.command === "keep", "unrelated entry lost");
    assert(backupsFor(path).length === 1, "backup missing");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("--force replaces a conflicting skill file without archiving the old skill", () => {
  const workspace = fresh();
  try {
    const target = join(skillRoot(workspace, "generic"), "SKILL.md");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, "user content\n");
    const result = runCli(["init", "--client", "generic", "--dir", workspace, "--force"]);
    assert(result.status === 0, result.stderr);
    assert(readFileSync(target, "utf8").includes("name: amanuensis"), "skill not replaced");
    assert(backupsFor(target).length === 0, "old skill was unexpectedly archived");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("dry run reports every layer and writes nothing", () => {
  const workspace = fresh();
  try {
    const result = runCli(["init", "--client", "codex", "--dir", workspace, "--dry-run"]);
    assert(result.status === 0, result.stderr);
    assert(result.stdout.includes("[dry-run]"), "dry-run marker missing");
    assert(result.stdout.includes("SKILL.md"), "skill plan missing");
    assert(result.stdout.includes(".codex/config.toml"), "config plan missing");
    assert(readdirSync(workspace).length === 0, "dry run wrote files");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("invalid JSON fails before any partial installation", () => {
  const workspace = fresh();
  try {
    const path = join(workspace, ".mcp.json");
    const invalid = "{ definitely not JSON }";
    writeFileSync(path, invalid);
    const result = runCli(["init", "--client", "claude", "--dir", workspace]);
    assert(result.status !== 0, "invalid JSON should fail");
    assert(result.stderr.includes("not parseable JSON"), result.stderr);
    assert(readFileSync(path, "utf8") === invalid, "invalid config was changed");
    assert(!existsSync(skillRoot(workspace, "claude")), "skill was partially installed");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("incomplete Codex managed block fails out-of-band", () => {
  const workspace = fresh();
  try {
    const path = join(workspace, ".codex/config.toml");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "# >>> amanuensis init (managed)\n[mcp_servers.amanuensis-memory]\n");
    const result = runCli(["init", "--client", "codex", "--dir", workspace]);
    assert(result.status !== 0, "incomplete marker should fail");
    assert(result.stderr.includes("incomplete Amanuensis-managed block"), result.stderr);
    assert(!existsSync(skillRoot(workspace, "codex")), "skill was partially installed");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("alternate Codex TOML spellings cannot create a duplicate server", () => {
  const variants = [
    "[mcp_servers.'amanuensis-memory']\ncommand = 'old'\n",
    '[mcp_servers."amanuensis-memory"]\ncommand = "old"\n',
    'mcp_servers.amanuensis-memory = { command = "old" }\n',
    'mcp_servers = { "amanuensis-memory" = { command = "old" } }\n',
  ];
  for (const existing of variants) {
    const workspace = fresh();
    try {
      const path = join(workspace, ".codex/config.toml");
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, existing);
      const result = runCli(["init", "--client", "codex", "--dir", workspace]);
      assert(result.status !== 0, `accepted duplicate candidate: ${existing}`);
      assert(result.stderr.includes("unmanaged TOML section"), result.stderr);
      assert(readFileSync(path, "utf8") === existing, "existing TOML changed on conflict");
      assert(!existsSync(skillRoot(workspace, "codex")), "skill was partially installed");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
});

test("invalid Codex TOML fails before any partial installation", () => {
  const workspace = fresh();
  try {
    const path = join(workspace, ".codex/config.toml");
    mkdirSync(dirname(path), { recursive: true });
    const invalid = "[broken\nvalue = ???\n";
    writeFileSync(path, invalid);
    const result = runCli(["init", "--client", "codex", "--dir", workspace]);
    assert(result.status !== 0, "invalid TOML should fail");
    assert(result.stderr.includes("not parseable TOML"), result.stderr);
    assert(readFileSync(path, "utf8") === invalid, "invalid config was changed");
    assert(!existsSync(skillRoot(workspace, "codex")), "skill was partially installed");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("duplicate Codex managed blocks fail before writes", () => {
  const workspace = fresh();
  try {
    const path = join(workspace, ".codex/config.toml");
    mkdirSync(dirname(path), { recursive: true });
    const block =
      "# >>> amanuensis init (managed)\n[mcp_servers.amanuensis-memory]\n" +
      'command = "amanuensis-memory"\n# <<< amanuensis init (managed)\n';
    writeFileSync(path, `${block}\n${block}`);
    const result = runCli(["init", "--client", "codex", "--dir", workspace]);
    assert(result.status !== 0, "duplicate managed blocks should fail");
    assert(result.stderr.includes("incomplete Amanuensis-managed block"), result.stderr);
    assert(!existsSync(skillRoot(workspace, "codex")), "skill was partially installed");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("JSON-with-comments remains accepted for the VS Code adapter", () => {
  const workspace = fresh();
  try {
    const path = join(workspace, ".vscode/mcp.json");
    mkdirSync(dirname(path), { recursive: true });
    const original = `{
  // VS Code accepts comments.
  "servers": {
    "other": {
      "command": "keep",
      "args": ["https://host/a//b", "literal /* text */"],
    },
  },
}\n`;
    writeFileSync(path, original);
    const result = runCli(["init", "--client", "vscode", "--dir", workspace]);
    assert(result.status === 0, result.stderr);
    const raw = readFileSync(path, "utf8");
    assert(raw.includes("// VS Code accepts comments."), "unrelated comment was lost");
    assert(raw.includes("https://host/a//b"), "comment-like string was corrupted");
    assert(raw.includes("literal /* text */"), "block-comment-like string was corrupted");
    const config = readJson(path);
    assert(config.servers.other.command === "keep", "other entry lost");
    assert(config.servers["amanuensis-memory"], "Amanuensis entry missing");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("known legacy custom agents are archived out of discovery", () => {
  const workspace = fresh();
  try {
    const legacy = join(workspace, ".github/agents/amanuensis.agent.md");
    mkdirSync(dirname(legacy), { recursive: true });
    writeFileSync(legacy, "user-modified legacy workflow\n");
    const result = runCli(["init", "--client", "generic", "--dir", workspace]);
    assert(result.status === 0, result.stderr);
    assert(!existsSync(legacy), "obsolete custom agent remains discoverable");
    const backups = backupsFor(legacy);
    assert(backups.length === 1, "legacy agent was not recoverably archived");
    assert(
      readFileSync(join(dirname(legacy), backups[0]), "utf8") === "user-modified legacy workflow\n",
      "legacy agent contents were not preserved",
    );
    assert(result.stdout.includes("archived obsolete agent"), "migration was silent");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("a symlinked skill destination cannot redirect writes outside the project", () => {
  const workspace = fresh();
  const outside = fresh();
  try {
    symlinkSync(outside, join(workspace, ".agents"), "dir");
    const result = runCli(["init", "--client", "generic", "--dir", workspace]);
    assert(result.status !== 0, "symlinked skill root should fail");
    assert(result.stderr.includes("symbolic link"), result.stderr);
    assert(readdirSync(outside).length === 0, "installer wrote through the skill symlink");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("a symlinked client config cannot be read, backed up, or overwritten", () => {
  const workspace = fresh();
  const outside = fresh();
  const externalConfig = join(outside, "mcp.json");
  const original = '{"mcpServers":{"outside":{"command":"preserve"}}}\n';
  try {
    writeFileSync(externalConfig, original);
    symlinkSync(externalConfig, join(workspace, ".mcp.json"));
    const result = runCli(["init", "--client", "claude", "--dir", workspace, "--force"]);
    assert(result.status !== 0, "symlinked config should fail");
    assert(result.stderr.includes("symbolic link"), result.stderr);
    assert(readFileSync(externalConfig, "utf8") === original, "external config was changed");
    assert(readdirSync(outside).length === 1, "external config was backed up outside the project");
    assert(!existsSync(join(workspace, ".claude")), "skill was partially installed");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("nonexistent target fails with no side effects", () => {
  const workspace = join(tmpdir(), `does-not-exist-${Math.random().toString(36).slice(2)}`);
  const result = runCli(["init", "--client", "generic", "--dir", workspace]);
  assert(result.status !== 0, "nonexistent target should fail");
  assert(result.stderr.includes("does not exist or is not a directory"), result.stderr);
  assert(!existsSync(workspace), "nonexistent target was created");
});

// ---- User-level installation for every host (amanuensis install) ----
//
// Every probe below runs with HOME, PATH, and each host's home variable
// pointed at scratch directories, so no run can read or write the real
// ~/.claude.json, ~/.codex, or ~/.copilot of the machine running the suite.

function isolatedHost({ hosts = [], commands = [] } = {}) {
  const home = fresh();
  const bin = join(home, "bin");
  mkdirSync(bin);
  symlinkSync(process.execPath, join(bin, "node"));
  for (const command of commands) {
    writeFileSync(join(bin, command), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  }
  for (const host of hosts) mkdirSync(join(home, host), { recursive: true });
  const env = { ...process.env, HOME: home, PATH: `${bin}:/usr/bin:/bin` };
  for (const key of ["CODEX_HOME", "CLAUDE_CONFIG_DIR", "COPILOT_HOME", "AMANUENSIS_PYTHON"]) {
    delete env[key];
  }
  return { home, env };
}

const USER_CONTRACT = "user-cwd-v1";

test("install sets up Claude Code and Copilot for every repository and leaves the project alone", () => {
  const workspace = fresh();
  const { home, env } = isolatedHost();
  try {
    const claudeJson = join(home, ".claude.json");
    const original = '{\n  "numStartups": 7,\n  "mcpServers": {\n    "other": { "command": "keep" }\n  }\n}\n';
    writeFileSync(claudeJson, original);
    const result = runCli(["install", "--client", "claude,copilot", "--dir", workspace], { env });
    assert(result.status === 0, result.stderr);
    assert(readdirSync(workspace).length === 0, "a user-level install wrote into the project");

    const claude = readJson(claudeJson);
    assert(claude.numStartups === 7, "unrelated Claude state was not preserved");
    assert(claude.mcpServers?.other?.command === "keep", "unrelated Claude server was lost");
    const claudeEntry = claude.mcpServers?.["amanuensis-memory"];
    assert(claudeEntry?.type === "stdio", "Claude entry is not stdio");
    assert(claudeEntry.command === process.execPath, "Claude launcher is not durable");
    assert(!claudeEntry.args?.includes("--workspace"), "Claude user entry pins a repository");
    assert(claudeEntry.env?.AMANUENSIS_ACTIVATION_CONTRACT === USER_CONTRACT, "contract missing");
    assert(backupsFor(claudeJson).length === 1, "Claude config was rewritten without a backup");
    assert(existsSync(join(home, ".claude/skills/amanuensis/SKILL.md")), "Claude skill missing");

    const copilot = readJson(join(home, ".copilot/mcp-config.json"));
    const copilotEntry = copilot.mcpServers?.["amanuensis-memory"];
    assert(copilotEntry?.type === "local", "Copilot entry is not a local server");
    assert(copilotEntry.tools?.[0] === "*", "Copilot entry exposes no tools");
    assert(copilotEntry.env?.AMANUENSIS_ACTIVATION_CONTRACT === USER_CONTRACT, "contract missing");
    assert(existsSync(join(home, ".copilot/skills/amanuensis/SKILL.md")), "Copilot skill missing");
    assert(!existsSync(join(home, ".codex")), "an unnamed host was installed");
    assert(result.stdout.includes("Restart Claude Code once"), "Claude restart not reported");
    assert(result.stdout.includes("amanuensis status"), "the verification command is not named");

    const again = runCli(["install", "--client", "claude,copilot", "--dir", workspace], { env });
    assert(again.status === 0, again.stderr);
    assert(backupsFor(claudeJson).length === 1, "an unchanged rerun rewrote the Claude config");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("install with no --client installs exactly the hosts present on the machine", () => {
  const workspace = fresh();
  const { home, env } = isolatedHost({ hosts: [".copilot"], commands: ["claude"] });
  try {
    const result = runCli(["install", "--dir", workspace], { env });
    assert(result.status === 0, result.stderr);
    assert(existsSync(join(home, ".copilot/mcp-config.json")), "Copilot home was not detected");
    assert(existsSync(join(home, ".claude.json")), "claude on PATH was not detected");
    assert(!existsSync(join(home, ".codex")), "an absent host was installed");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("install with no host on the machine fails, names the hosts, and writes nothing", () => {
  const workspace = fresh();
  const { home, env } = isolatedHost();
  try {
    const result = runCli(["install", "--dir", workspace], { env });
    assert(result.status !== 0, "install succeeded with no host present");
    assert(result.stderr.includes("--client codex, claude, or copilot"), result.stderr);
    assert(
      readdirSync(home).every((entry) => entry === "bin"),
      "install wrote with no host present",
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("a hand-written registration is a conflict that writes nothing until --force", () => {
  const workspace = fresh();
  const { home, env } = isolatedHost();
  try {
    const copilotConfig = join(home, ".copilot/mcp-config.json");
    mkdirSync(dirname(copilotConfig), { recursive: true });
    const original = '{"mcpServers":{"amanuensis-memory":{"type":"local","command":"mine"}}}\n';
    writeFileSync(copilotConfig, original);
    const refused = runCli(["install", "--client", "claude,copilot", "--dir", workspace], { env });
    assert(refused.status !== 0, "a hand-written registration was overwritten");
    assert(refused.stderr.includes("registered by hand"), refused.stderr);
    assert(readFileSync(copilotConfig, "utf8") === original, "conflicting config was changed");
    assert(!existsSync(join(home, ".claude.json")), "another host was written before the refusal");
    assert(!existsSync(join(home, ".copilot/skills")), "skill was partially installed");

    const forced = runCli(
      ["install", "--client", "copilot", "--dir", workspace, "--force"],
      { env },
    );
    assert(forced.status === 0, forced.stderr);
    const entry = readJson(copilotConfig).mcpServers["amanuensis-memory"];
    assert(entry.env?.AMANUENSIS_ACTIVATION_CONTRACT === USER_CONTRACT, "--force did not replace");
    assert(backupsFor(copilotConfig).length === 1, "--force replaced without a backup");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("status reports each host, exits non-zero until every present host is set up", () => {
  const workspace = fresh();
  const { home, env } = isolatedHost({ hosts: [".copilot", ".claude"] });
  try {
    const before = runCli(["status", "--json"], { env, cwd: workspace });
    assert(before.status !== 0, "status passed before installation");
    const beforeReport = JSON.parse(before.stdout);
    assert(beforeReport.status === "incomplete", "status was not incomplete");
    assert(beforeReport.next.includes("amanuensis install"), "status does not name the fix");

    const partial = runCli(["install", "--client", "copilot", "--dir", workspace], { env });
    assert(partial.status === 0, partial.stderr);
    const half = runCli(["status", "--json"], { env, cwd: workspace });
    assert(half.status !== 0, "status passed with a present host still unset");

    const installed = runCli(["install", "--dir", workspace], { env });
    assert(installed.status === 0, installed.stderr);
    const after = runCli(["status", "--json"], { env, cwd: workspace });
    assert(after.status === 0, after.stdout);
    const report = JSON.parse(after.stdout);
    const byHost = Object.fromEntries(report.hosts.map((host) => [host.host, host]));
    assert(byHost.claude.installed && byHost.copilot.installed, "installed hosts not reported");
    assert(!byHost.codex.detected && !byHost.codex.installed, "an absent host was reported");
    const text = runCli(["status"], { env, cwd: workspace });
    assert(text.stdout.includes("Claude Code: installed"), text.stdout);

    const skill = join(home, ".claude/skills/amanuensis/SKILL.md");
    writeFileSync(skill, "stale\n");
    const stale = runCli(["status", "--json"], { env, cwd: workspace });
    assert(stale.status !== 0, "status passed with a stale skill");
    assert(JSON.parse(stale.stdout).next.includes("amanuensis upgrade"), "upgrade not named");
    const upgraded = runCli(["upgrade", "--dir", workspace], { env });
    assert(upgraded.status === 0, upgraded.stderr);
    assert(readFileSync(skill, "utf8").includes("name: amanuensis"), "upgrade missed the skill");
    assert(runCli(["status"], { env, cwd: workspace }).status === 0, "status after upgrade");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("uninstall removes only its own entries and skills, and refuses a hand-written one", () => {
  const workspace = fresh();
  const { home, env } = isolatedHost();
  try {
    const claudeJson = join(home, ".claude.json");
    writeFileSync(claudeJson, '{"mcpServers":{"other":{"command":"keep"}}}\n');
    assert(
      runCli(["install", "--client", "claude,copilot", "--dir", workspace], { env }).status === 0,
      "fixture install failed",
    );
    const dryRun = runCli(["uninstall", "--dir", workspace, "--dry-run"], { env });
    assert(dryRun.status === 0, dryRun.stderr);
    assert(readJson(claudeJson).mcpServers["amanuensis-memory"], "dry run removed the entry");

    const removed = runCli(["uninstall", "--dir", workspace], { env });
    assert(removed.status === 0, removed.stderr);
    const claude = readJson(claudeJson);
    assert(claude.mcpServers.other?.command === "keep", "uninstall removed another server");
    assert(!claude.mcpServers["amanuensis-memory"], "uninstall left the Claude entry");
    assert(!existsSync(join(home, ".claude/skills/amanuensis")), "Claude skill left behind");
    assert(!existsSync(join(home, ".copilot/skills/amanuensis")), "Copilot skill left behind");

    writeFileSync(claudeJson, '{"mcpServers":{"amanuensis-memory":{"command":"mine"}}}\n');
    const refused = runCli(["uninstall", "--client", "claude", "--dir", workspace], { env });
    assert(refused.status !== 0, "uninstall removed a hand-written registration");
    assert(readJson(claudeJson).mcpServers["amanuensis-memory"].command === "mine", "changed");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("CLAUDE_CONFIG_DIR and COPILOT_HOME relocate where install writes", () => {
  const workspace = fresh();
  const { home, env } = isolatedHost();
  const claudeDir = join(home, "elsewhere-claude");
  const copilotDir = join(home, "elsewhere-copilot");
  try {
    const result = runCli(["install", "--client", "claude,copilot", "--dir", workspace], {
      env: { ...env, CLAUDE_CONFIG_DIR: claudeDir, COPILOT_HOME: copilotDir },
    });
    assert(result.status === 0, result.stderr);
    assert(existsSync(join(claudeDir, ".claude.json")), "CLAUDE_CONFIG_DIR config ignored");
    assert(existsSync(join(claudeDir, "skills/amanuensis/SKILL.md")), "CLAUDE_CONFIG_DIR skill");
    assert(existsSync(join(copilotDir, "mcp-config.json")), "COPILOT_HOME ignored");
    assert(!existsSync(join(home, ".claude.json")), "default Claude config written anyway");
    assert(!existsSync(join(home, ".copilot")), "default Copilot home written anyway");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("a skill linked to a development checkout is reported and left in place", () => {
  const workspace = fresh();
  const { home, env } = isolatedHost();
  const checkout = fresh();
  try {
    writeFileSync(join(checkout, "SKILL.md"), "development copy\n");
    mkdirSync(join(home, ".claude/skills"), { recursive: true });
    symlinkSync(checkout, join(home, ".claude/skills/amanuensis"), "dir");
    const result = runCli(["install", "--client", "claude", "--dir", workspace], { env });
    assert(result.status === 0, result.stderr);
    assert(result.stdout.includes("symbolic link"), "the linked skill was not reported");
    assert(
      readFileSync(join(checkout, "SKILL.md"), "utf8") === "development copy\n",
      "install wrote through the development link",
    );
    const status = JSON.parse(runCli(["status", "--json"], { env, cwd: workspace }).stdout);
    assert(status.hosts.find((host) => host.host === "claude").skill === "linked", "not linked");
    const removed = runCli(["uninstall", "--client", "claude", "--dir", workspace], { env });
    assert(removed.status === 0, removed.stderr);
    assert(existsSync(join(checkout, "SKILL.md")), "uninstall removed the development checkout");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    rmSync(checkout, { recursive: true, force: true });
  }
});

test("a dangling symbolic link at a config path is refused, not followed", () => {
  const workspace = fresh();
  const { home, env } = isolatedHost();
  const outside = fresh();
  const target = join(outside, "created-through-link.json");
  try {
    symlinkSync(target, join(home, ".claude.json"));
    const result = runCli(["install", "--client", "claude", "--dir", workspace], { env });
    assert(result.status !== 0, "install followed a dangling config link");
    assert(result.stderr.includes("symbolic link"), result.stderr);
    assert(!existsSync(target), "install created a file outside the managed location");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("a configuration rewrite keeps the file's permissions and leaves no temporary file", () => {
  const workspace = fresh();
  const { home, env } = isolatedHost();
  try {
    const claudeJson = join(home, ".claude.json");
    writeFileSync(claudeJson, "{}\n", { mode: 0o600 });
    const result = runCli(["install", "--client", "claude", "--dir", workspace], { env });
    assert(result.status === 0, result.stderr);
    assert((statSync(claudeJson).mode & 0o777) === 0o600, "rewrite widened permissions");
    assert(
      readdirSync(home).every((entry) => !entry.includes(".amanuensis-")),
      "a temporary file was left beside the config",
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("an unwritable file for one host stops the install before any host is written", () => {
  const workspace = fresh();
  const { home, env } = isolatedHost();
  const copilotConfig = join(home, ".copilot/mcp-config.json");
  try {
    mkdirSync(dirname(copilotConfig), { recursive: true });
    writeFileSync(copilotConfig, "{}\n", { mode: 0o444 });
    const result = runCli(["install", "--client", "claude,copilot", "--dir", workspace], { env });
    assert(result.status !== 0, "install proceeded past an unwritable config");
    assert(result.stderr.includes("not writable"), result.stderr);
    assert(!existsSync(join(home, ".claude.json")), "Claude was written before the refusal");
    assert(!existsSync(join(home, ".claude/skills")), "a skill was written before the refusal");
    assert(!existsSync(join(home, ".copilot/skills")), "Copilot skill was partially written");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("upgrade removes skill files a newer release no longer ships", () => {
  const workspace = fresh();
  const { home, env } = isolatedHost();
  try {
    assert(
      runCli(["install", "--client", "copilot", "--dir", workspace], { env }).status === 0,
      "fixture install failed",
    );
    const obsolete = join(home, ".copilot/skills/amanuensis/references/retired.md");
    writeFileSync(obsolete, "shipped by an earlier release\n");
    const stale = JSON.parse(runCli(["status", "--json"], { env, cwd: workspace }).stdout);
    assert(stale.hosts.find((host) => host.host === "copilot").skill === "outdated", "not stale");
    const upgraded = runCli(["upgrade", "--dir", workspace], { env });
    assert(upgraded.status === 0, upgraded.stderr);
    assert(!existsSync(obsolete), "upgrade left an obsolete skill file");
    const status = runCli(["status", "--json"], { env, cwd: workspace });
    assert(status.status === 0, status.stdout);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("Codex install and upgrade both leave a linked development skill in place", () => {
  const workspace = fresh();
  const { home, env } = isolatedHost();
  const checkout = fresh();
  try {
    writeFileSync(join(checkout, "SKILL.md"), "development copy\n");
    mkdirSync(join(home, ".codex/skills"), { recursive: true });
    symlinkSync(checkout, join(home, ".codex/skills/amanuensis"), "dir");
    const installed = runCli(["install", "--client", "codex", "--dir", workspace], { env });
    assert(installed.status === 0, installed.stderr);
    const upgraded = runCli(["upgrade", "--client", "codex", "--dir", workspace], { env });
    assert(upgraded.status === 0, upgraded.stderr);
    assert(
      readFileSync(join(checkout, "SKILL.md"), "utf8") === "development copy\n",
      "the development checkout was written",
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    rmSync(checkout, { recursive: true, force: true });
  }
});

test("VS Code's user directory counts as Copilot being present", () => {
  const workspace = fresh();
  const { home, env } = isolatedHost({ hosts: [".vscode"] });
  try {
    const result = runCli(["install", "--dir", workspace], { env });
    assert(result.status === 0, result.stderr);
    assert(existsSync(join(home, ".copilot/mcp-config.json")), "VS Code was not detected");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("status refuses a broken skill link and a Codex file that does not parse", () => {
  const workspace = fresh();
  const { home, env } = isolatedHost();
  try {
    assert(
      runCli(["install", "--client", "codex,claude", "--dir", workspace], { env }).status === 0,
      "fixture install failed",
    );
    const config = join(home, ".codex/config.toml");
    writeFileSync(config, `${readFileSync(config, "utf8")}\n[broken\n`);
    rmSync(join(home, ".claude/skills/amanuensis"), { recursive: true });
    symlinkSync(join(home, "missing-checkout"), join(home, ".claude/skills/amanuensis"), "dir");
    const status = runCli(["status", "--json"], { env, cwd: workspace });
    assert(status.status !== 0, "status passed with broken installations");
    const byHost = Object.fromEntries(
      JSON.parse(status.stdout).hosts.map((host) => [host.host, host]),
    );
    assert(byHost.codex.registration === "unreadable", `codex: ${byHost.codex.registration}`);
    assert(byHost.claude.skill === "broken", `claude skill: ${byHost.claude.skill}`);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("uninstall with no --client also removes a skill left without its registration", () => {
  const workspace = fresh();
  const { home, env } = isolatedHost();
  try {
    assert(
      runCli(["install", "--client", "copilot", "--dir", workspace], { env }).status === 0,
      "fixture install failed",
    );
    writeFileSync(join(home, ".copilot/mcp-config.json"), '{"mcpServers":{}}\n');
    const removed = runCli(["uninstall", "--dir", workspace], { env });
    assert(removed.status === 0, removed.stderr);
    assert(!existsSync(join(home, ".copilot/skills/amanuensis")), "orphan skill left behind");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

// Codex rewrites config.toml when it starts: the start marker disappears, the
// inline env becomes a sub-table, and later servers land before the end
// marker. This is the shape of a real config observed after that rewrite.
function codexRewrite(config, { command } = {}) {
  const entry = parseToml(config).mcp_servers["amanuensis-memory"];
  const toml = (value) => JSON.stringify(value);
  const lines = [
    'model = "keep-model"',
    "",
    "[mcp_servers.other]",
    'command = "keep-server"',
    "",
    "[mcp_servers.amanuensis-memory]",
    `command = ${toml(command ?? entry.command)}`,
    `args = [${entry.args.map(toml).join(", ")}]`,
    `cwd = ${toml(entry.cwd)}`,
    "",
    "[mcp_servers.amanuensis-memory.env]",
    ...Object.entries(entry.env).map(([key, value]) => `${key} = ${toml(value)}`),
    "",
    "[mcp_servers.later]",
    'command = "keep-later"',
    "# <<< amanuensis init (managed)",
    "",
    '[projects."/somewhere"]',
    'trust_level = "trusted"',
    "",
  ];
  return lines.join("\n");
}

test("a Codex-rewritten config is still recognised, upgraded and uninstalled", () => {
  const workspace = fresh();
  const { home, env } = isolatedHost({ hosts: [".codex"] });
  try {
    const config = join(home, ".codex/config.toml");
    const cli = (args) => runCli([...args, "--client", "codex", "--mcp-only", "--dir", workspace], { env });
    const status = () => {
      const result = runCli(["status", "--json"], { env });
      return JSON.parse(result.stdout).hosts.find((host) => host.host === "codex").registration;
    };
    let result = cli(["install"]);
    assert(result.status === 0, result.stderr);

    writeFileSync(config, codexRewrite(readFileSync(config, "utf8")));
    const rewritten = readFileSync(config, "utf8");
    assert(status() === "installed", `rewritten current entry reported ${status()}`);
    result = cli(["install"]);
    assert(result.status === 0, result.stderr);
    assert(readFileSync(config, "utf8") === rewritten, "a current rewritten entry was rewritten");
    assert(result.stdout.includes("nothing to restart"), `restart advised for no change: ${result.stdout}`);

    writeFileSync(config, codexRewrite(rewritten, { command: "/old/node" }));
    assert(status() === "outdated", `older rewritten entry reported ${status()}`);
    result = cli(["upgrade"]);
    assert(result.status === 0, result.stderr);
    const upgraded = readFileSync(config, "utf8");
    const parsed = parseToml(upgraded);
    assert(parsed.mcp_servers["amanuensis-memory"].command === process.execPath, "not upgraded");
    assert(parsed.mcp_servers.other?.command === "keep-server", "earlier server lost");
    assert(parsed.mcp_servers.later?.command === "keep-later", "later server lost");
    assert(parsed.model === "keep-model" && parsed.projects["/somewhere"], "settings lost");
    assert(upgraded.split("amanuensis init (managed)").length === 3, "markers not restored once");
    assert(status() === "installed", `upgraded entry reported ${status()}`);

    writeFileSync(config, codexRewrite(upgraded));
    result = cli(["uninstall"]);
    assert(result.status === 0, result.stderr);
    const removed = readFileSync(config, "utf8");
    const after = parseToml(removed);
    assert(!after.mcp_servers["amanuensis-memory"], "entry survived uninstall");
    assert(after.mcp_servers.other && after.mcp_servers.later, "uninstall removed another server");
    assert(after.model === "keep-model" && after.projects["/somewhere"], "uninstall lost settings");
    assert(!removed.includes("amanuensis init (managed)"), "a stray marker survived uninstall");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("a rewritten Codex entry without the installer's contract stays unmanaged", () => {
  const workspace = fresh();
  const { home, env } = isolatedHost({ hosts: [".codex"] });
  try {
    const config = join(home, ".codex/config.toml");
    const original =
      '[mcp_servers.amanuensis-memory]\ncommand = "hand"\n\n[mcp_servers.amanuensis-memory.env]\nX = "1"\n';
    writeFileSync(config, original);
    const result = runCli(["install", "--client", "codex", "--mcp-only", "--dir", workspace], { env });
    assert(result.status !== 0, "a hand-written entry was taken over");
    assert(result.stderr.includes("unmanaged TOML section"), result.stderr);
    assert(readFileSync(config, "utf8") === original, "a hand-written entry was changed");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor repair leaves a linked project skill and does not call one checkout a shadow", () => {
  const { home, env } = isolatedHost({ hosts: [".codex"] });
  const repository = join(home, "repo");
  const checkout = join(home, "checkout-skill");
  try {
    mkdirSync(repository);
    spawnSync("git", ["init", "-q"], { cwd: repository });
    mkdirSync(checkout);
    writeFileSync(join(checkout, "SKILL.md"), "linked\n");
    const installed = runCli(["install", "--client", "codex", "--mcp-only", "--dir", repository], { env });
    assert(installed.status === 0, installed.stderr);
    mkdirSync(join(home, ".codex/skills"), { recursive: true });
    symlinkSync(checkout, join(home, ".codex/skills/amanuensis"), "dir");
    mkdirSync(join(repository, ".agents/skills"), { recursive: true });
    symlinkSync(checkout, join(repository, ".agents/skills/amanuensis"), "dir");
    mkdirSync(join(repository, ".codex"));
    writeFileSync(
      join(repository, ".codex/config.toml"),
      '[mcp_servers.amanuensis-memory]\ncommand = "node"\ncwd = "."\n' +
        'env = { AMANUENSIS_ACTIVATION_CONTRACT = "codex-project-pin-v1" }\n',
    );
    const doctor = (extra) =>
      runCli(["doctor", "--client", "codex", "--dir", repository, "--json", ...extra], { env });
    const before = JSON.parse(doctor([]).stdout);
    const codes = before.diagnoses.map((diagnosis) => diagnosis.code);
    assert(codes.includes("duplicate-registration"), `duplicate not diagnosed: ${codes}`);
    assert(!codes.includes("shadowed-user-skill"), "one checkout linked twice reported as a shadow");
    const plan = doctor(["--repair", "--dry-run"]);
    assert(plan.status === 0 || plan.stdout.includes("repairPlanId"), plan.stderr);
    const planId = JSON.parse(plan.stdout).repairPlanId;
    assert(planId, `no repair plan: ${plan.stderr}`);
    const applied = doctor(["--repair", "--apply-plan", planId]);
    assert(JSON.parse(applied.stdout).status === "ok", applied.stdout);
    assert(
      lstatSync(join(repository, ".agents/skills/amanuensis")).isSymbolicLink(),
      "repair removed a linked project skill",
    );
    assert(readFileSync(join(checkout, "SKILL.md"), "utf8") === "linked\n", "repair followed the link");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
