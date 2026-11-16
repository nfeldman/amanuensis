#!/usr/bin/env node
// Three write-path defects from BACKLOG.md, each asserted against a temporary
// git workspace and a store this script creates.
//
//   C  add_evidence checks its coordinates at the revision it names: the path
//      exists, every line_range span lies inside the file, and an excerpt
//      appears in the cited lines (whitespace ignored, "..." an elision).
//   U  upsert_subsystem with no status keeps the row's current status, so an
//      update to scope alone is not refused as a downgrade.
//   S  clear_staleness records its basis (an evidence row citing the file, or
//      a one-line reason) in staleness_clears, at a resolved commit.
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
      "-c",
      "user.email=fixes@localhost",
      "-c",
      "user.name=write-path-fixes",
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
    ["./dist/tools/git.js", "gitTools"],
    ["./dist/tools/impact.js", "impactTools"],
    ["./dist/tools/stale.js", "staleTools"],
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
      "export const less = 1 < 2;",
      "export const rest = (...args: number[]) => args;",
      "",
    ].join("\n"),
  );
  writeFileSync(join(ws, "empty.ts"), "");
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
  const { ctx, ws, head } = world("evidence");
  const add = (extra) =>
    call(
      "add_evidence",
      { file_path: "unit.ts", ref_sha: head, kind: "code-verified", ...extra },
      ctx,
    );
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
        excerpt:
          "export function add(a: number, b: number): number { ... export const answer = add(40, 2);",
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
  check("C8 an HTML-escaped excerpt is refused where the source has the character", () => {
    // Line 8 really holds `1 < 2`, so this fails only if `&lt;` is not decoded.
    const escaped = refusal(() => add({ line_range: "8", excerpt: "1 &lt; 2" }));
    if (!escaped?.includes("excerpt does not appear")) return `escaped: ${JSON.stringify(escaped)}`;
    const plain = refusal(() => add({ line_range: "8", excerpt: "1 < 2" }));
    return plain && `the unescaped control was refused: ${plain}`;
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
  check("C12 a blank excerpt, or a bare elision the lines lack, is refused", () => {
    const blank = refusal(() => add({ line_range: "1", excerpt: "  \n " }));
    if (!blank?.includes("quotes nothing")) return `blank: ${JSON.stringify(blank)}`;
    const bare = refusal(() => add({ line_range: "1", excerpt: " ... " }));
    return bare?.includes("excerpt does not appear") ? null : `bare: ${JSON.stringify(bare)}`;
  });
  check("C14 elided fragments out of source order are refused", () => {
    const said = refusal(() =>
      add({ line_range: "1-3", excerpt: "return sum; ... const sum = a + b;" }),
    );
    return said?.includes("excerpt does not appear") ? null : `got ${JSON.stringify(said)}`;
  });
  check("C15 a match across the gap between two spans is refused", () => {
    // Lines 2 and 6 joined would read `...a + b;export const answer...`; lines
    // 3-5 sit between them, so no source text says that.
    const said = refusal(() => add({ line_range: "2,6", excerpt: "a + b; export const answer" }));
    return said?.includes("excerpt does not appear") ? null : `got ${JSON.stringify(said)}`;
  });
  check("C16 an excerpt quoting a literal ... is accepted", () => {
    const stub = refusal(() => add({ line_range: "9", excerpt: "..." }));
    if (stub) return `bare spread refused: ${stub}`;
    const spread = refusal(() => add({ line_range: "9", excerpt: "(...args: number[]) => args" }));
    return spread && `spread refused: ${spread}`;
  });
  check("C17 a range into an empty file is refused", () => {
    const said = refusal(() =>
      call(
        "add_evidence",
        { file_path: "empty.ts", ref_sha: head, kind: "code-verified", line_range: "1" },
        ctx,
      ),
    );
    return said?.includes("which has 0 line(s)") ? null : `got ${JSON.stringify(said)}`;
  });
  check("C19 a submodule whose commit is not in the object store can be cited by path", () => {
    // A gitlink names a commit in another repository; the superproject rarely
    // holds it. The tree entry exists all the same.
    git(ws, "update-index", "--add", "--cacheinfo", `160000,${"1".repeat(40)},vendor/lib`);
    git(ws, "commit", "-q", "--no-verify", "-m", "gitlink");
    const withLink = git(ws, "rev-parse", "HEAD");
    const said = refusal(() =>
      call(
        "add_evidence",
        { file_path: "vendor/lib", ref_sha: withLink, kind: "code-verified" },
        ctx,
      ),
    );
    return said && `refused: ${said}`;
  });
  check("C18 refused calls wrote no row", () => {
    const { n } = ctx.db.prepare("SELECT COUNT(*) AS n FROM evidence").get();
    return n === 8 ? null : `expected the 8 accepted rows, found ${n}`;
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
    const said = refusal(() =>
      call("upsert_subsystem", { id: "S1", name: "One", scope: "second" }, ctx),
    );
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
    // café.ts and plain.ts drifted; old-näme.ts is gone. Only café.ts depends on
    // the -z fix: a vanished path is found by listTrackedPaths, which already
    // read git with -z.
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
    return hit?.change_type === "modified"
      ? null
      : `changes: ${JSON.stringify(impact.changed_files)}`;
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

// ------------------------------------------------- S: clear_staleness basis

{
  const { ctx, ws, head: base } = world("clears");
  call("set_git_state", { canonical_branch: "main", onboarding_sha: base }, ctx);
  call("upsert_subsystem", { id: "S1", name: "One" }, ctx);
  call(
    "add_files_to_scope",
    {
      subsystem_id: "S1",
      ref_sha: base,
      files: ["unit.ts", "plain.ts"].map((file_path) => ({ file_path, why_in_scope: "fixture" })),
    },
    ctx,
  );
  writeFileSync(join(ws, "plain.ts"), "export const plain = 3;\n");
  git(ws, "commit", "-q", "--no-verify", "-am", "drift");
  const head = git(ws, "rev-parse", "HEAD");
  call("detect_changes", { current_sha: head }, ctx);
  const ledger = () =>
    ctx.db
      .prepare(
        "SELECT stale, ref_sha FROM file_ledger WHERE subsystem_id = 'S1' AND file_path = 'plain.ts'",
      )
      .get();
  const clears = () => ctx.db.prepare("SELECT * FROM staleness_clears ORDER BY id").all();
  const clear = (extra) =>
    call(
      "clear_staleness",
      { subsystem_id: "S1", file_path: "plain.ts", ref_sha: "HEAD", ...extra },
      ctx,
    );

  check("S1 a clear with no basis is refused and leaves the row stale", () => {
    if (ledger().stale !== 1) return "precondition: plain.ts is not stale";
    const said = refusal(() => clear({}));
    if (!said?.includes("a clear records its basis")) return `got ${JSON.stringify(said)}`;
    return ledger().stale === 1 ? null : "the refused clear cleared the row";
  });
  check("S2 evidence citing another file is not a basis", () => {
    const other = call(
      "add_evidence",
      { file_path: "unit.ts", ref_sha: head, kind: "code-verified" },
      ctx,
    ).id;
    const said = refusal(() => clear({ evidence_id: other }));
    return said?.includes("cites unit.ts") ? null : `got ${JSON.stringify(said)}`;
  });
  check("S3 a reason is one line", () => {
    const said = refusal(() => clear({ reason: "first line\nsecond line" }));
    return said?.includes("one line") ? null : `got ${JSON.stringify(said)}`;
  });
  check("S4 a reasoned clear is recorded with what it discharged, at a resolved commit", () => {
    const said = refusal(() =>
      clear({ reason: "re-read; the constant changed and nothing depends on it" }),
    );
    if (said) return `refused: ${said}`;
    const row = ledger();
    if (row.stale !== 0 || row.ref_sha !== head) return `ledger is ${JSON.stringify(row)}`;
    const [first] = clears();
    if (!first) return "no staleness_clears row";
    if (first.ref_sha !== head) return `the clear stored ref_sha ${first.ref_sha}`;
    if (first.prior_stale_reason !== "git-drift" || first.prior_ref_sha !== base) {
      return `the clear recorded prior ${first.prior_stale_reason} at ${first.prior_ref_sha}`;
    }
    return null;
  });
  check("S5 an evidence row citing the file is a basis", () => {
    const own = call(
      "add_evidence",
      { file_path: "plain.ts", ref_sha: head, kind: "code-verified" },
      ctx,
    ).id;
    const said = refusal(() => clear({ evidence_id: own }));
    if (said) return `refused: ${said}`;
    const rows = clears();
    return rows.length === 2 && rows[1].evidence_id === own && rows[1].prior_stale_reason === null
      ? null
      : `clears are ${JSON.stringify(rows)}`;
  });
  check("S6 a recorded clear cannot be edited or deleted", () => {
    const edited = refusal(() => ctx.db.prepare("UPDATE staleness_clears SET reason = 'x'").run());
    const deleted = refusal(() => ctx.db.prepare("DELETE FROM staleness_clears").run());
    return edited?.includes("immutable") && deleted?.includes("cannot be deleted")
      ? null
      : `update: ${edited}; delete: ${deleted}`;
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
  console.log(
    `WRITE-PATH FIXES RED: ${failures.length} of ${checked} failed; first: ${failures[0]}`,
  );
  process.exit(1);
}
console.log("WRITE-PATH FIXES GREEN");
