#!/usr/bin/env node
// A stalled subprocess must not hang a tool call (older defects B04-R4 and the
// B02 cluster). Every git the server runs is synchronous, so one that never
// returns blocks the event loop and with it every later call. The startup
// probes were bounded earlier (STARTUP_PROBE_TIMEOUT_MS); the tool-time calls
// were not.
//
// The fixture puts a `git` on PATH that sleeps far longer than the bound, sets
// AMANUENSIS_SUBPROCESS_TIMEOUT_MS low, and times three tools whose git runs
// through different call sites: add_evidence (helpers.ts), detect_changes
// (tools/git.ts) and predict_change_impact (tools/impact.ts). Each must answer,
// refused or not, well before the stalled git would have exited.
//
//   exit 0  `SUBPROCESS TIMEOUTS GREEN`
//   exit 1  `SUBPROCESS TIMEOUTS RED: <first failure>`

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const STALL_SECONDS = 30;
const BOUND_MS = 1_500;
const PATIENCE_MS = 10_000;

const failures = [];
let checked = 0;
function timed(label, fn) {
  checked++;
  const started = Date.now();
  try {
    fn();
  } catch {
    /* a refusal is an answer; only the time is asserted */
  }
  const took = Date.now() - started;
  if (took > PATIENCE_MS) failures.push(`${label}: took ${took} ms against a ${BOUND_MS} ms bound`);
  else console.log(`  ok   ${label} (${took} ms)`);
}
function git(cwd, ...args) {
  const result = spawnSync(
    "git",
    ["-c", "user.email=t@localhost", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return String(result.stdout).trim();
}

const { openDatabase } = await import("./dist/db.js");
const { resolveProject, ensureProjectStorage } = await import("./dist/project.js");
const toolArrays = await Promise.all(
  [
    ["./dist/tools/project.js", "projectTools"],
    ["./dist/tools/evidence.js", "evidenceTools"],
    ["./dist/tools/git.js", "gitTools"],
    ["./dist/tools/impact.js", "impactTools"],
  ].map(async ([path, name]) => (await import(path))[name]),
);
const tools = new Map(toolArrays.flat().map((td) => [td.name, td]));
const call = (name, args, ctx) => tools.get(name).handler(args, ctx);

const scratch = mkdtempSync(join(tmpdir(), "amanuensis-subprocess-"));
const ws = join(scratch, "ws");
mkdirSync(ws);
git(ws, "init", "-q");
writeFileSync(join(ws, "a.ts"), "export const a = 1;\n");
git(ws, "add", "-A");
git(ws, "commit", "-q", "--no-verify", "-m", "seed");
const head = git(ws, "rev-parse", "HEAD");
const project = resolveProject(ws, { selectionSource: "subprocess-timeouts" });
ensureProjectStorage(project, (databasePath) => openDatabase(databasePath).close());
const db = openDatabase(project.dbPath);
const ctx = { project, db, sessionId: null };
ctx.sessionId = call("start_session", { intent: "subprocess-timeouts" }, ctx).session_id;
call("set_git_state", { canonical_branch: "main", onboarding_sha: head }, ctx);

// From here on every `git` the server starts is one that stalls.
const bin = join(scratch, "bin");
mkdirSync(bin);
writeFileSync(join(bin, "git"), `#!/bin/sh\nexec sleep ${STALL_SECONDS}\n`);
chmodSync(join(bin, "git"), 0o755);
const savedPath = process.env.PATH;
process.env.PATH = `${bin}:${savedPath}`;
process.env.AMANUENSIS_SUBPROCESS_TIMEOUT_MS = String(BOUND_MS);
try {
  timed("T1 add_evidence answers with a stalled git", () =>
    call("add_evidence", { file_path: "a.ts", ref_sha: head, kind: "code-verified" }, ctx),
  );
  timed("T2 detect_changes answers with a stalled git", () =>
    call("detect_changes", { current_sha: head }, ctx),
  );
  timed("T3 predict_change_impact answers with a stalled git", () =>
    call("predict_change_impact", { base_sha: head, head_sha: head }, ctx),
  );
} finally {
  process.env.PATH = savedPath;
  delete process.env.AMANUENSIS_SUBPROCESS_TIMEOUT_MS;
}

// A module added later that imports the raw functions would be unbounded again.
// These files may, because each call in them sets its own timeout (startup
// probes, the CLI, the lint bridge) or they are the wrapper.
const DIRECT = new Set([
  "src/subprocess.ts",
  "src/index.ts",
  "src/project.ts",
  "src/codex-host.ts",
  "src/cli.ts",
  "src/orientation-lint.ts",
]);
checked++;
{
  const direct = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (path.endsWith(".ts")) {
        const text = readFileSync(path, "utf8");
        const imports = text.match(/import\s*\{([^}]*)\}\s*from\s*"node:child_process"/g) ?? [];
        if (imports.some((line) => /\b(spawnSync|execFileSync|execSync)\b/.test(line))) {
          direct.push(path);
        }
      }
    }
  };
  walk("src");
  const unbounded = direct.filter((path) => !DIRECT.has(path));
  if (unbounded.length) {
    failures.push(
      `T4 ${unbounded.join(", ")} import a subprocess function from node:child_process; import it from src/subprocess.ts`,
    );
  } else console.log("  ok   T4 tool-time modules start subprocesses through the bounded wrapper");
}

db.close();
rmSync(project.storagePath, { recursive: true, force: true });
rmSync(scratch, { recursive: true, force: true });

console.log(`  ran  ${checked} assertion(s)`);
if (failures.length) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(
    `SUBPROCESS TIMEOUTS RED: ${failures.length} of ${checked} failed; first: ${failures[0]}`,
  );
  process.exit(1);
}
console.log("SUBPROCESS TIMEOUTS GREEN");
