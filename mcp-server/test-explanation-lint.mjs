#!/usr/bin/env node
// The orientation lint at write time (BACKLOG, explanation quality item 2).
//
// A recorded explanation or declination reason is printed only when the
// materializer's orientation lint clears it. The lint ran only at render, so an
// author learned a body would be withheld when publishing failed. The writers
// now run the same Python function before they record. The narrowed fraction
// rule itself is asserted in materializer/test-overview-truthfulness.py.
//
//   L1  "exit codes 0/1/3" is accepted (it withheld a real account before)
//   L2  "12/35 subsystems are mapped" is refused at write time
//   L3  survey-status language is refused
//   L4  a declination reason is linted too
//   L5  refused writes leave no row
//   L6  with no Python the write goes through; render still withholds the text
//
//   exit 0  `EXPLANATION LINT GREEN`
//   exit 1  `EXPLANATION LINT RED: <first failure>`

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const failures = [];
let checked = 0;
function check(label, fn) {
  checked++;
  try {
    const detail = fn();
    if (detail) failures.push(`${label}: ${detail}`);
  } catch (error) {
    failures.push(`${label}: threw ${String(error?.message ?? error)}`);
  }
}
function refusal(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return String(error?.message ?? error);
  }
}
function git(cwd, ...args) {
  const result = spawnSync(
    "git",
    [
      "-c",
      "user.email=lint@localhost",
      "-c",
      "user.name=explanation-lint",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
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
    ["./dist/tools/subsystems.js", "subsystemTools"],
    ["./dist/tools/files.js", "fileTools"],
    ["./dist/tools/explanations.js", "explanationTools"],
  ].map(async ([path, name]) => (await import(path))[name]),
);
const tools = new Map(toolArrays.flat().map((td) => [td.name, td]));
const call = (name, args, ctx) => tools.get(name).handler(args, ctx);

const ws = mkdtempSync(join(tmpdir(), "amanuensis-explanation-lint-"));
git(ws, "init", "-q");
writeFileSync(join(ws, "cli.ts"), "export const exitCodes = [0, 1, 3];\n");
git(ws, "add", "-A");
git(ws, "commit", "-q", "--no-verify", "-m", "seed");
const head = git(ws, "rev-parse", "HEAD");
const project = resolveProject(ws, { selectionSource: "explanation-lint" });
ensureProjectStorage(project, (databasePath) => openDatabase(databasePath).close());
const db = openDatabase(project.dbPath);
const ctx = { project, db, sessionId: null };
ctx.sessionId = call("start_session", { intent: "explanation-lint" }, ctx).session_id;
call("upsert_subsystem", { id: "B-01", name: "CLI" }, ctx);
call(
  "add_files_to_scope",
  {
    subsystem_id: "B-01",
    ref_sha: head,
    files: [{ file_path: "cli.ts", why_in_scope: "fixture" }],
  },
  ctx,
);
// Seeded by SQL: reaching `structural` through the tools takes a survey's worth
// of prerequisites, and the lint does not depend on how the status was reached.
db.prepare("UPDATE subsystems SET status = 'structural' WHERE id = 'B-01'").run();
const evidence = call(
  "add_evidence",
  { file_path: "cli.ts", ref_sha: head, kind: "code-verified", line_range: "1" },
  ctx,
).id;

const record = (slot, body) =>
  call(
    "record_explanation",
    {
      subject_type: "subsystem",
      subject_id: "B-01",
      slot,
      body,
      evidence_ids: [evidence],
      ref_sha: head,
    },
    ctx,
  );
const decline = (reason) =>
  call(
    "decline_explanation",
    { subject_type: "subsystem", subject_id: "B-01", slot: "purpose", reason, ref_sha: head },
    ctx,
  );
const rows = () => db.prepare("SELECT COUNT(*) AS n FROM explanations").get().n;

check("L1 a slash chain of exit codes is accepted", () => {
  const said = refusal(() =>
    record("account", "The command exits with codes 0/1/3 for clean, failed and refused runs."),
  );
  return said && `refused: ${said}`;
});
check("L2 a survey count fraction is refused at write time", () => {
  const said = refusal(() => record("purpose", "12/35 subsystems are mapped."));
  return said?.includes("count fraction") && said.includes('"12/35"')
    ? null
    : `got ${JSON.stringify(said)}`;
});
check("L3 survey-status language is refused", () => {
  const said = refusal(() => record("purpose", "The conspectus is fully surveyed."));
  return said?.includes("record_explanation refuses") ? null : `got ${JSON.stringify(said)}`;
});
check("L4 a declination reason is linted", () => {
  const said = refusal(() => decline("Only 3/9 callers were read."));
  return said?.includes("decline_explanation refuses") && said.includes("count fraction")
    ? null
    : `got ${JSON.stringify(said)}`;
});
check("L5 refused writes left no row", () => {
  const n = rows();
  return n === 1 ? null : `expected the 1 accepted row, found ${n}`;
});
check("L6 with no Python the write goes through", () => {
  const saved = process.env.AMANUENSIS_PYTHON;
  process.env.AMANUENSIS_PYTHON = join(ws, "no-such-python");
  try {
    const said = refusal(() => record("purpose", "12/35 subsystems are mapped."));
    return said && `refused although the lint could not run: ${said}`;
  } finally {
    if (saved === undefined) delete process.env.AMANUENSIS_PYTHON;
    else process.env.AMANUENSIS_PYTHON = saved;
  }
});

db.close();
rmSync(project.storagePath, { recursive: true, force: true });
rmSync(ws, { recursive: true, force: true });

console.log(`  ran  ${checked} assertion(s)`);
if (failures.length) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(
    `EXPLANATION LINT RED: ${failures.length} of ${checked} failed; first: ${failures[0]}`,
  );
  process.exit(1);
}
console.log("EXPLANATION LINT GREEN");
