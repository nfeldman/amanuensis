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
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", ...options });
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
    assert(entry.args?.at(-1) === CLAUDE_PROJECT_VAR, "Claude project root is not portable");
    assert(!existsSync(join(workspace, ".vscode")), "Claude adapter created VS Code state");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("Codex adapter installs the shared skill and project config", () => {
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
    assert(!config.includes(workspace), "Codex config hard-coded the local checkout path");
    const parsed = parseToml(config);
    assert(parsed.mcp_servers?.["amanuensis-memory"]?.cwd === ".", "Codex config is invalid");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
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
            args: [SOURCE_SERVER, "--workspace", CLAUDE_PROJECT_VAR],
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

test("--force backs up and replaces a conflicting skill file", () => {
  const workspace = fresh();
  try {
    const target = join(skillRoot(workspace, "generic"), "SKILL.md");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, "user content\n");
    const result = runCli(["init", "--client", "generic", "--dir", workspace, "--force"]);
    assert(result.status === 0, result.stderr);
    assert(readFileSync(target, "utf8").includes("name: amanuensis"), "skill not replaced");
    const backups = backupsFor(target);
    assert(backups.length === 1, "skill backup missing");
    assert(
      readFileSync(join(dirname(target), backups[0]), "utf8") === "user content\n",
      "skill backup does not preserve prior content",
    );
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
