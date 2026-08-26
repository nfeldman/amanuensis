#!/usr/bin/env node
// Adversarial probes for the client-adapter installer. Every test runs in a
// fresh temporary workspace and reads back the files the selected client will
// consume.
import { spawnSync } from "node:child_process";
import {
  existsSync,
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
    const installed = runCli(["install", "--dir", workspace], {
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

    const dryRun = runCli(["upgrade", "--dir", workspace, "--dry-run"], {
      env: { ...process.env, CODEX_HOME: userHome },
    });
    assert(dryRun.status === 0, dryRun.stderr);
    assert(dryRun.stdout.includes("[dry-run] Upgrading"), "upgrade plan is not explicit");
    assert(readFileSync(configPath, "utf8") === staleConfig, "upgrade dry run changed config");
    assert(readFileSync(skillPath, "utf8") === "stale managed skill\n", "dry run changed skill");

    const upgraded = runCli(["upgrade", "--dir", workspace], {
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
