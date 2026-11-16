#!/usr/bin/env node
// Three write-path defects from BACKLOG.md, each asserted against a temporary
// git workspace and a store this script creates.
//
//   C  add_evidence checks its coordinates at the revision it names: the path
//      exists, every line_range span lies inside the file, and an excerpt
//      appears in the cited lines (whitespace ignored, "..." an elision).
//   U  upsert_subsystem with no status keeps the row's current status, so an
//      update to scope alone is not refused as a downgrade.
//   P  detect_changes and predict_change_impact see a changed file whose name
//      is not ASCII. Without -z, git quotes such a name and it matched no
//      ledger row.
//
// Controls that must stay green: a correct citation is accepted (C1-C4), an
// explicit downgrade is still refused (U2), an ASCII change is still seen (P3).
//
//   exit 0  `WRITE-PATH FIXES GREEN`
//   exit 1  `WRITE-PATH FIXES RED: <first failure>`

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
/** The refusal message, or null when the call succeeded. */
function refusal(fn) {
  try {
    const value = fn();
    if (value && typeof value === "object" && value.ok === false) return String(value.error);
    return null;
  } catch (error) {
    return String(error?.message ?? error);
  }
}

function git(cwd, ...args) {
  const result = spawnSync(
    "git",
    [
      "-c", "user.email=fixes@localhost",
      "-c", "user.name=write-path-fixes",
      "-c", "commit.gpgsign=false",
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
    ["./dist/tools/git.js", "gitTools"],
    ["./dist/tools/impact.js", "impactTools"],
  ].map(async ([path, name]) => (await import(path))[name]),
);
const tools = new Map(toolArrays.flat().map((td) => [td.name, td]));
const call = (name, args, ctx) => tools.get(name).handler(args, ctx);

const scratch = mkdtempSync(join(tmpdir(), "amanuensis-write-path-"));
const cleanups = [];

function world(label) {
  const ws = join(scratch, label);
  mkdirSync(ws, { recursive: true });
  git(ws, "init", "-q");
  // Pin git's default so the assertion does not depend on the machine's config:
  // with quotePath on, a non-ASCII name is printed quoted unless -z is passed.
  git(ws, "config", "core.quotePath", "true");
  writeFileSync(
    join(ws, "unit.ts"),
    [
      "export function add(a: number, b: number): number {",
      "  const sum = a + b;",
      "  return sum;",
      "}",
      "",
      "export const answer = add(40, 2);",
      "",
    ].join("\n"),
  );
  writeFileSync(join(ws, "café.ts"), "export const brew = 1;\n");
  writeFileSync(join(ws, "plain.ts"), "export const plain = 1;\n");
  writeFileSync(join(ws, "old-näme.ts"), "export const moved = 1;\nexport const kept = 2;\n");
  git(ws, "add", "-A");
  git(ws, "commit", "-q", "--no-verify", "-m", "seed");
  const project = resolveProject(ws, { selectionSource: "write-path-fixes" });
  ensureProjectStorage(project, (databasePath) => openDatabase(databasePath).close());
  const db = openDatabase(project.dbPath);
  const ctx = { project, db, sessionId: null };
  cleanups.push(() => {
    db.close();
    rmSync(project.storagePath, { recursive: true, force: true });
  });
  ctx.sessionId = call("start_session", { intent: `write-path-${label}` }, ctx).session_id;
  return { ctx, ws, head: git(ws, "rev-parse", "HEAD") };
}

// ---------------------------------------------------------------- C: evidence

{
  const { ctx, head } = world("evidence");
  const add = (extra) =>
    call("add_evidence", { file_path: "unit.ts", ref_sha: head, kind: "code-verified", ...extra }, ctx);
  const stored = (id) =>
    ctx.db.prepare("SELECT line_range, excerpt FROM evidence WHERE id = ?").get(id);

  check("C1 a range inside the file and a verbatim excerpt are accepted", () => {
    const said = refusal(() => add({ line_range: "1-3", excerpt: "const sum = a + b;" }));
    return said && `refused: ${said}`;
  });
  check("C2 a reflowed excerpt with an elision across a list of spans is accepted", () => {
    const said = refusal(() =>
      add({
        line_range: "1-2, 6",
        excerpt: "export function add(a: number, b: number): number { ... export const answer = add(40, 2);",
      }),
    );
    return said && `refused: ${said}`;
  });
  check("C3 the stored range is normalized", () => {
    const { id } = add({ line_range: " 2 - 3 , 6 " });
    const row = stored(id);
    return row.line_range === "2-3,6" ? null : `stored ${JSON.stringify(row.line_range)}`;
  });
  check("C4 a row with neither range nor excerpt still only needs the path", () => {
    const said = refusal(() => add({}));
    return said && `refused: ${said}`;
  });
  check("C5 a range past the end of the file is refused", () => {
    const said = refusal(() => add({ line_range: "5-40" }));
    return said?.includes("runs past the end") ? null : `got ${JSON.stringify(said)}`;
  });
  check("C6 one bad span in a list is refused", () => {
    const said = refusal(() => add({ line_range: "1-3,90" }));
    return said?.includes("runs past the end") ? null : `got ${JSON.stringify(said)}`;
  });
  check("C7 an excerpt that is not in the cited lines is refused", () => {
    // In the file, but at line 6, not in 1-3: the off-by-some coordinate the
    // AxiomDB audit found.
    const said = refusal(() => add({ line_range: "1-3", excerpt: "export const answer" }));
    return said?.includes("excerpt does not appear") ? null : `got ${JSON.stringify(said)}`;
  });
  check("C8 an HTML-escaped excerpt is refused", () => {
    const said = refusal(() => add({ line_range: "1", excerpt: "add(a: number, b: number): number &lt;" }));
    return said?.includes("excerpt does not appear") ? null : `got ${JSON.stringify(said)}`;
  });
  check("C9 a range that is not a range is refused", () => {
    const said = refusal(() => add({ line_range: "n/a" }));
    return said?.includes("is not a line range") ? null : `got ${JSON.stringify(said)}`;
  });
  check("C10 a reversed span and line 0 are refused", () => {
    const reversed = refusal(() => add({ line_range: "3-1" }));
    const zero = refusal(() => add({ line_range: "0-2" }));
    if (!reversed?.includes("cannot precede")) return `reversed: ${JSON.stringify(reversed)}`;
    if (!zero?.includes("lines start at 1")) return `zero: ${JSON.stringify(zero)}`;
    return null;
  });
  check("C11 a path the revision does not contain is refused", () => {
    const said = refusal(() =>
      call("add_evidence", { file_path: "ghost.ts", ref_sha: head, kind: "code-verified" }, ctx),
    );
    return said?.includes("does not exist") ? null : `got ${JSON.stringify(said)}`;
  });
  check("C12 an excerpt of only an elision is refused", () => {
    const said = refusal(() => add({ line_range: "1", excerpt: " ... " }));
    return said?.includes("quotes nothing") ? null : `got ${JSON.stringify(said)}`;
  });
  check("C13 refused calls wrote no row", () => {
    const { n } = ctx.db.prepare("SELECT COUNT(*) AS n FROM evidence").get();
    return n === 4 ? null : `expected the 4 accepted rows, found ${n}`;
  });
}

// --------------------------------------------------------- U: upsert_subsystem

{
  const { ctx } = world("upsert");
  call("upsert_subsystem", { id: "S1", name: "One", scope: "first" }, ctx);
  // Seeded by SQL: reaching `structural` through the tools takes a survey's
  // worth of prerequisites, and the defect is in the update path alone.
  ctx.db.prepare("UPDATE subsystems SET status = 'structural' WHERE id = 'S1'").run();

  check("U1 an update without status keeps the current status", () => {
    const said = refusal(() => call("upsert_subsystem", { id: "S1", name: "One", scope: "second" }, ctx));
    if (said) return `refused: ${said}`;
    const row = ctx.db.prepare("SELECT status, scope FROM subsystems WHERE id = 'S1'").get();
    if (row.status !== "structural") return `status became ${row.status}`;
    if (row.scope !== "second") return `scope is ${row.scope}`;
    return null;
  });
  check("U2 an explicit downgrade is still refused", () => {
    const said = refusal(() =>
      call("upsert_subsystem", { id: "S1", name: "One", status: "unmapped" }, ctx),
    );
    return said ? null : "the downgrade was accepted";
  });
  check("U3 a new subsystem without status starts unmapped", () => {
    call("upsert_subsystem", { id: "S2", name: "Two" }, ctx);
    const row = ctx.db.prepare("SELECT status FROM subsystems WHERE id = 'S2'").get();
    return row.status === "unmapped" ? null : `status is ${row.status}`;
  });
}

// ------------------------------------------------------------ P: path quoting

{
  const { ctx, ws, head: base } = world("paths");
  call("set_git_state", { canonical_branch: "main", onboarding_sha: base }, ctx);
  call("upsert_subsystem", { id: "S1", name: "One" }, ctx);
  call(
    "add_files_to_scope",
    {
      subsystem_id: "S1",
      ref_sha: base,
      files: ["unit.ts", "café.ts", "plain.ts", "old-näme.ts"].map((file_path) => ({
        file_path,
        why_in_scope: "fixture",
      })),
    },
    ctx,
  );
  writeFileSync(join(ws, "café.ts"), "export const brew = 2;\n");
  writeFileSync(join(ws, "plain.ts"), "export const plain = 2;\n");
  git(ws, "mv", "old-näme.ts", "new-nämé.ts");
  git(ws, "commit", "-q", "--no-verify", "-am", "change");
  const head = git(ws, "rev-parse", "HEAD");

  const changes = call("detect_changes", { current_sha: head }, ctx);
  const named = new Set(changes.stale_subsystems.flatMap((s) => s.changed_files));
  check("P1 detect_changes names a changed non-ASCII file", () =>
    named.has("café.ts") ? null : `changed files: ${JSON.stringify([...named])}`,
  );
  check("P2 detect_changes marks the non-ASCII rows stale", () => {
    // café.ts drifted and old-näme.ts is gone; plain.ts drifted too.
    const rows = ctx.db
      .prepare("SELECT file_path FROM file_ledger WHERE stale = 1 ORDER BY file_path")
      .all()
      .map((r) => r.file_path);
    const missing = ["café.ts", "old-näme.ts", "plain.ts"].filter((p) => !rows.includes(p));
    return missing.length ? `not stale: ${missing.join(", ")} (stale: ${rows.join(", ")})` : null;
  });
  check("P3 detect_changes still names a changed ASCII file", () =>
    named.has("plain.ts") ? null : `changed files: ${JSON.stringify([...named])}`,
  );

  const impact = call("predict_change_impact", { base_sha: base, head_sha: head }, ctx);
  check("P4 predict_change_impact reads a non-ASCII modification unquoted", () => {
    const hit = impact.changed_files.find((c) => c.path_after === "café.ts");
    return hit?.change_type === "modified" ? null : `changes: ${JSON.stringify(impact.changed_files)}`;
  });
  check("P5 predict_change_impact pairs a non-ASCII rename", () => {
    const hit = impact.changed_files.find((c) => c.change_type === "renamed");
    return hit?.path_before === "old-näme.ts" && hit?.path_after === "new-nämé.ts"
      ? null
      : `changes: ${JSON.stringify(impact.changed_files)}`;
  });
  check("P6 no impact record carries a git-quoted path", () => {
    // A quoted name matches no ledger row, so it surfaces as an unmapped gap
    // rather than as the subsystem that owns the file.
    const quoted = JSON.stringify(impact).match(/\\\\[0-7]{3}/);
    return quoted ? `found ${quoted[0]} in the impact artifact` : null;
  });
}

for (const cleanup of cleanups) {
  try {
    cleanup();
  } catch {
    /* reported by the assertion that broke it */
  }
}
rmSync(scratch, { recursive: true, force: true });

console.log(`  ran  ${checked} assertion(s)`);
if (failures.length) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(`WRITE-PATH FIXES RED: ${failures.length} of ${checked} failed; first: ${failures[0]}`);
  process.exit(1);
}
console.log("WRITE-PATH FIXES GREEN");
