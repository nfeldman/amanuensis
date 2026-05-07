#!/usr/bin/env node
// Adversarial correctness probes for the `amanuensis init` installer.
//
// Each probe sets up a target workspace in a specific state, runs the
// installer, and asserts on the resulting filesystem and mcp.json
// contents. Covers:
//
//   - Fresh workspace: all agent files land, mcp.json is created.
//   - Preservation: an existing mcp.json with other MCP servers keeps
//     those servers' entries untouched.
//   - Idempotence: a second run over an already-installed workspace is
//     a no-op (no files written, no backups created).
//   - --force: conflicting agent files and a prior amanuensis-memory
//     entry are backed up and overwritten; other servers' entries still
//     survive.
//   - --dry-run: nothing is written.
//   - JSON-with-comments tolerance: an mcp.json with // comments
//     parses successfully (comments are lost on rewrite, as documented).
//   - Invalid JSON: errors out with a diagnostic instead of corrupting.
//   - --agents-dir override: agents land in the custom path.
//   - Nonexistent target dir: clear error, no partial writes.
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const CLI = join(moduleDir, "dist", "cli.js");

let passed = 0;
let failed = 0;
function t(label, fn) {
  try {
    fn();
    console.log(`  ok   ${label}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL ${label}\n       ${e.message}`);
    failed++;
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function runCli(args, opts = {}) {
  return spawnSync("node", [CLI, ...args], { encoding: "utf8", ...opts });
}
function fresh() {
  return mkdtempSync(join(tmpdir(), "aman-inst-"));
}
function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
function agentCount(ws, subpath = ".github/agents") {
  const d = join(ws, subpath);
  if (!existsSync(d)) return 0;
  return readdirSync(d).filter((f) => f.endsWith(".agent.md")).length;
}
function backupsFor(path) {
  // Find files matching `<basename>.bak.*` siblings of `path`.
  const dir = dirname(path);
  if (!existsSync(dir)) return [];
  const base = path.slice(dir.length + 1);
  return readdirSync(dir).filter((f) => f.startsWith(`${base}.bak.`));
}

// ---- 1. Fresh workspace ----
t("fresh workspace: all agents + references + mcp.json written", () => {
  const ws = fresh();
  try {
    const r = runCli(["init", "--dir", ws]);
    assert(r.status === 0, `exit ${r.status}; stderr: ${r.stderr}`);
    assert(agentCount(ws) >= 7, `expected ≥7 agent files, got ${agentCount(ws)}`);
    // Reference docs must land with the agents so agents can read them
    // at their documented relative paths.
    assert(
      existsSync(join(ws, ".github/agents/references/concern-territories.md")),
      "concern-territories.md missing — agents can't find their territory catalog",
    );
    assert(
      existsSync(join(ws, ".github/agents/references/artifact-templates.md")),
      "artifact-templates.md missing",
    );
    const mcp = readJson(join(ws, ".vscode/mcp.json"));
    assert(mcp.servers["amanuensis-memory"], "amanuensis-memory entry missing");
    assert(mcp.servers["amanuensis-memory"].command === "amanuensis-memory");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---- 2. Preservation of other MCP servers ----
t("preserves other MCP server entries on merge", () => {
  const ws = fresh();
  try {
    mkdirSync(join(ws, ".vscode"), { recursive: true });
    writeFileSync(
      join(ws, ".vscode/mcp.json"),
      JSON.stringify(
        {
          servers: {
            "some-other-server": {
              type: "stdio",
              command: "other-bin",
              args: ["--flag"],
            },
          },
        },
        null,
        2,
      ),
    );
    const r = runCli(["init", "--dir", ws]);
    assert(r.status === 0, r.stderr);
    const mcp = readJson(join(ws, ".vscode/mcp.json"));
    assert(mcp.servers["amanuensis-memory"], "our entry missing");
    assert(mcp.servers["some-other-server"], "other entry lost!");
    assert(mcp.servers["some-other-server"].command === "other-bin", "other entry mutated");
    // A backup was defensively created because we rewrote the file.
    assert(backupsFor(join(ws, ".vscode/mcp.json")).length === 1, "backup missing");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---- 3. Idempotence ----
t("second run over installed workspace is a no-op", () => {
  const ws = fresh();
  try {
    runCli(["init", "--dir", ws]);
    // Clear any backups created by the first run so we measure only
    // the second run's writes.
    const mcpPath = join(ws, ".vscode/mcp.json");
    for (const b of backupsFor(mcpPath)) rmSync(join(dirname(mcpPath), b));
    const mtimesBefore = readdirSync(join(ws, ".github/agents"))
      .map((f) => statSync(join(ws, ".github/agents", f)).mtimeMs);
    const mcpBefore = readFileSync(mcpPath, "utf8");
    const r = runCli(["init", "--dir", ws]);
    assert(r.status === 0);
    // mcp.json must not have been rewritten (prior amanuensis-memory
    // entry present → skip without --force).
    const mcpAfter = readFileSync(mcpPath, "utf8");
    assert(mcpBefore === mcpAfter, "mcp.json was rewritten on no-op run");
    // Agent files must not have been touched (same mtimes).
    const mtimesAfter = readdirSync(join(ws, ".github/agents"))
      .map((f) => statSync(join(ws, ".github/agents", f)).mtimeMs);
    assert(
      JSON.stringify(mtimesBefore) === JSON.stringify(mtimesAfter),
      "agent file mtimes changed on no-op run",
    );
    assert(backupsFor(mcpPath).length === 0, "spurious backup created");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---- 4. --force overwrites but preserves others ----
t("--force backs up + overwrites our entry; preserves other servers", () => {
  const ws = fresh();
  try {
    mkdirSync(join(ws, ".vscode"), { recursive: true });
    writeFileSync(
      join(ws, ".vscode/mcp.json"),
      JSON.stringify(
        {
          servers: {
            "amanuensis-memory": { type: "stdio", command: "OLD-BINARY", args: [] },
            "another-server": { type: "stdio", command: "other-bin", args: [] },
          },
        },
        null,
        2,
      ),
    );
    const r = runCli(["init", "--dir", ws, "--force"]);
    assert(r.status === 0, r.stderr);
    const mcp = readJson(join(ws, ".vscode/mcp.json"));
    assert(
      mcp.servers["amanuensis-memory"].command === "amanuensis-memory",
      "our entry was not updated",
    );
    assert(mcp.servers["another-server"], "other entry lost under --force");
    assert(backupsFor(join(ws, ".vscode/mcp.json")).length === 1, "backup missing");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---- 5. --dry-run ----
t("--dry-run writes nothing", () => {
  const ws = fresh();
  try {
    const r = runCli(["init", "--dir", ws, "--dry-run"]);
    assert(r.status === 0, r.stderr);
    assert(!existsSync(join(ws, ".github")), "dry-run created .github");
    assert(!existsSync(join(ws, ".vscode")), "dry-run created .vscode");
    assert(r.stdout.includes("[dry-run]"), "dry-run output marker missing");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---- 6. JSON with comments ----
t("tolerates JSON-with-comments in existing mcp.json", () => {
  const ws = fresh();
  try {
    mkdirSync(join(ws, ".vscode"), { recursive: true });
    writeFileSync(
      join(ws, ".vscode/mcp.json"),
      `{
  // This file has comments, which VS Code allows.
  "servers": {
    "other": {
      "type": "stdio",  // trailing comment too
      "command": "bin",
      "args": [] /* block comment */
    },
  }  // trailing comma above
}
`,
    );
    const r = runCli(["init", "--dir", ws]);
    assert(r.status === 0, `exit ${r.status}; stderr: ${r.stderr}`);
    const mcp = readJson(join(ws, ".vscode/mcp.json"));
    assert(mcp.servers.other, "other server lost");
    assert(mcp.servers["amanuensis-memory"], "our entry missing");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---- 7. Invalid JSON ----
t("invalid existing mcp.json: errors with diagnostic, no corruption", () => {
  const ws = fresh();
  try {
    mkdirSync(join(ws, ".vscode"), { recursive: true });
    const badContent = "{ this is not json at all }";
    writeFileSync(join(ws, ".vscode/mcp.json"), badContent);
    const r = runCli(["init", "--dir", ws]);
    assert(r.status !== 0, "should exit nonzero on parse failure");
    assert(
      /not parseable JSON/.test(r.stderr) ||
        /not parseable JSON/.test(r.stdout),
      `expected parse-error diagnostic, got stderr=${r.stderr}`,
    );
    // The broken file is still present and untouched.
    assert(readFileSync(join(ws, ".vscode/mcp.json"), "utf8") === badContent, "file was modified");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---- 8. --agents-dir override ----
t("--agents-dir lands agents in the custom path", () => {
  const ws = fresh();
  try {
    const r = runCli(["init", "--dir", ws, "--agents-dir", ".claude/agents"]);
    assert(r.status === 0, r.stderr);
    assert(agentCount(ws, ".claude/agents") >= 7, "agents not in custom dir");
    assert(agentCount(ws, ".github/agents") === 0, "agents also in default dir");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---- 9. Nonexistent target ----
t("nonexistent --dir errors out cleanly", () => {
  const bogus = join(tmpdir(), `does-not-exist-${Math.random().toString(36).slice(2)}`);
  const r = runCli(["init", "--dir", bogus]);
  assert(r.status !== 0, "should exit nonzero");
  assert(/does not exist/.test(r.stderr), `expected diagnostic, got: ${r.stderr}`);
});

// ---- 10. Conflicting agent file without --force is preserved ----
t("conflicting agent file without --force is preserved, user notified", () => {
  const ws = fresh();
  try {
    // Pre-populate with a user-authored agent file under the same name.
    mkdirSync(join(ws, ".github/agents"), { recursive: true });
    const target = join(ws, ".github/agents/amanuensis.agent.md");
    writeFileSync(target, "---\nname: amanuensis\n---\nUSER-AUTHORED CONTENT\n");
    const r = runCli(["init", "--dir", ws]);
    assert(r.status === 0, r.stderr);
    const content = readFileSync(target, "utf8");
    assert(content.includes("USER-AUTHORED CONTENT"), "user content clobbered without --force");
    assert(
      /conflict.*--force/.test(r.stdout),
      `expected conflict notice in output, got: ${r.stdout}`,
    );
    assert(backupsFor(target).length === 0, "spurious backup of user file");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---- 11. Conflicting agent file with --force is backed up + replaced ----
t("conflicting agent file with --force is backed up + replaced", () => {
  const ws = fresh();
  try {
    mkdirSync(join(ws, ".github/agents"), { recursive: true });
    const target = join(ws, ".github/agents/amanuensis.agent.md");
    writeFileSync(target, "USER CONTENT\n");
    const r = runCli(["init", "--dir", ws, "--force"]);
    assert(r.status === 0, r.stderr);
    const content = readFileSync(target, "utf8");
    assert(!content.includes("USER CONTENT"), "not replaced");
    assert(content.includes("name: amanuensis"), "wrong content written");
    const backups = backupsFor(target);
    assert(backups.length === 1, `expected 1 backup, got ${backups.length}`);
    assert(
      readFileSync(join(dirname(target), backups[0]), "utf8").includes("USER CONTENT"),
      "backup missing user content",
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---- 12. Bundled agents path discovery (dev vs installed) ----
t("installer finds bundled agents via candidate paths", () => {
  // We can't easily simulate an installed-package layout here without
  // publishing; verify only that the current layout (dev clone) is
  // discoverable. If this fails, it means the candidate-path logic has
  // regressed and installed users would fail to find agents.
  const ws = fresh();
  try {
    const r = runCli(["init", "--dir", ws, "--dry-run"]);
    assert(r.status === 0, r.stderr);
    // The plan output should reference all expected agent files.
    for (const name of [
      "amanuensis.agent.md",
      "amanuensis-scoper.agent.md",
      "amanuensis-structural.agent.md",
      "amanuensis-concerns.agent.md",
      "amanuensis-adversarial.agent.md",
      "amanuensis-notes.agent.md",
      "amanuensis-memory-auditor.agent.md",
    ]) {
      assert(r.stdout.includes(name), `dry-run plan missing ${name}`);
    }
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
