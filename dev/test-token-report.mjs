#!/usr/bin/env node
// GATE SI10 (design/semantic-index/PLAN.md §6, §8 SI10).
//
// Turns red when:
//   - `dev/token-report.mjs` is missing, or exits non-zero on the fixture call logs and transcripts;
//   - per-tool calls, response-byte totals, medians, 90th percentiles or refusals, before and after
//     (split by server version, and again by cutover date), differ from the hand counts of the
//     fixture call log (two server versions, one of them appearing in the "after" file);
//   - the per-session tool-result bytes by class (the four index tools, other Amanuensis reads,
//     whole-file `Read`, sliced `Read`, search, shell, other), the `usage` counts, the weighted sum,
//     or the per-side session count, totals and medians differ from the hand counts of the fixture
//     transcripts;
//   - a repeated assistant message id is counted more than once, also when it repeats in another file
//     of a resumed session; one session's files make more than one session, or a path named twice
//     (or a directory and a file in it) is read twice; a whole-file `Read` is counted as a sliced
//     one (or the reverse); multi-byte text, in a string or in an array of text blocks, is measured
//     in characters; an Amanuensis write tool is counted among other Amanuensis reads;
//   - the output does not say that host reads are not covered when no transcripts are given, or says
//     it when they are;
//   - the call log is not opened read-only: its bytes, mtime or directory listing change, a missing
//     path is created, the script does not open it with `readonly: true` (outside a comment), or a
//     WAL-mode `.backup` copy cannot be read from a read-only directory or gains `-shm` or `-wal`
//     beside it in a writable one;
//   - anything but standard output (or `--out`) is written;
//   - the output contains a verdict, a threshold or a change figure between the sides;
//   - the output omits the price ratios or the reminder that the two sides differ in task, subject and time.
// Reads the committed fixtures in dev/fixtures/token-report/ and builds its call-log copies in a
// temporary directory; it touches no real store and does not use the network.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "dev", "token-report.mjs");
const fixtures = join(root, "dev", "fixtures", "token-report");

const failures = [];
const fail = (message) => failures.push(message);
const finish = () => {
  if (failures.length > 0) {
    console.log(`GATE SI10 RED: ${failures[0]}${failures.length > 1 ? ` (+${failures.length - 1} more)` : ""}`);
    for (const f of failures.slice(1)) console.error(`  also: ${f}`);
    process.exit(1);
  }
  console.log("GATE SI10 GREEN");
};
const check = (label, actual, expected) => {
  if (!isDeepStrictEqual(actual, expected)) {
    fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

if (!existsSync(script)) {
  fail("dev/token-report.mjs is not there yet");
  finish();
}

// --- fixture call-log copies, built from the committed hand-countable rows -----------------------
const work = mkdtempSync(join(tmpdir(), "token-report-gate-"));
const logs = join(work, "logs");
mkdirSync(logs);
let Database;
try {
  Database = createRequire(join(root, "mcp-server", "package.json"))("better-sqlite3");
} catch (e) {
  fail(`better-sqlite3 cannot be loaded from mcp-server: ${String(e.message).split("\n")[0]}`);
  finish();
}
const spec = JSON.parse(readFileSync(join(fixtures, "call-log.json"), "utf8"));
/** A call log holding one file's hand-countable rows, left in WAL mode as the server writes it, or not. */
function buildCallLog(path, content, { wal }) {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE call_log_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE call_log_connections (connection_id TEXT PRIMARY KEY, started_at TEXT NOT NULL,
      server_version TEXT NOT NULL, client_name TEXT, client_version TEXT, pid INTEGER NOT NULL);
    CREATE TABLE call_log (id INTEGER PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES call_log_connections(connection_id),
      seq INTEGER NOT NULL, started_at TEXT NOT NULL, session_id TEXT, tool TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK (outcome IN ('ok','validation','refusal','exception')), rule TEXT, site TEXT,
      latency_ms REAL NOT NULL, args_bytes INTEGER NOT NULL, args_sha256 TEXT NOT NULL, response_bytes INTEGER NOT NULL);
  `);
  db.prepare("INSERT INTO call_log_meta VALUES ('schema_version','1')").run();
  const addConnection = db.prepare("INSERT INTO call_log_connections VALUES (?,?,?,NULL,NULL,1)");
  for (const c of content.connections) addConnection.run(c.id, c.started_at, c.server_version);
  const addRow = db.prepare("INSERT INTO call_log VALUES (NULL,?,?,?,NULL,?,?,?,NULL,1.5,10,'0',?)");
  content.rows.forEach((r, i) => addRow.run(r.connection, i + 1, r.started_at, r.tool, r.outcome, r.rule, r.response_bytes));
  if (!wal) {
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.pragma("journal_mode = DELETE");
  }
  return db;
}
for (const [name, content] of Object.entries(spec.files)) buildCallLog(join(logs, name), content, { wal: false }).close();
const beforeDb = join(logs, "before-calls.db");
const afterDb = join(logs, "after-calls.db");

// A copy as §6 takes it, `.backup` of a live WAL call log: the copy keeps WAL mode in its header.
// It sits in a directory nobody may write, so any open that would add `-shm` or `-wal` beside it,
// read-only or read-write, fails instead of passing unseen.
const walDir = join(work, "wal-copy");
mkdirSync(walDir);
const walDb = join(walDir, "before-calls.db");
{
  const live = buildCallLog(join(work, "live-calls.db"), spec.files["before-calls.db"], { wal: true });
  await live.backup(walDb);
  live.close();
  const header = readFileSync(walDb);
  if (header[18] !== 2 || header[19] !== 2) fail("the WAL-mode call-log copy was not made in WAL mode");
  chmodSync(walDb, 0o444);
  chmodSync(walDir, 0o555);
}
const walListing = () => readdirSync(walDir).sort().join(",");

const run = (args, options = {}) =>
  spawnSync(process.execPath, [script, ...args], { encoding: "utf8", cwd: options.cwd ?? work, timeout: 60000 });
const runJson = (label, args) => {
  const r = run([...args, "--format", "json"]);
  if (r.status !== 0) {
    fail(`${label}: exited ${r.status}: ${(r.stderr || r.stdout).split("\n")[0]}`);
    return null;
  }
  try {
    return JSON.parse(r.stdout);
  } catch (e) {
    fail(`${label}: output is not JSON: ${String(e.message).split("\n")[0]}`);
    return null;
  }
};

// --- hand counts --------------------------------------------------------------------------------
const tool = (name, calls, total, median, p90, refusals) => ({
  tool: name,
  calls,
  response_bytes_total: total,
  response_bytes_median: median,
  response_bytes_p90: p90,
  refusals,
});
const BEFORE_CALLS_BY_VERSION = [tool("describe_locus", 4, 6500, 1500, 3000, 1), tool("get_project_info", 2, 440, 220, 400, 0)];
const AFTER_CALLS_BY_VERSION = [
  tool("describe_locus", 2, 3400, 1700, 2200, 0),
  tool("find_symbol", 5, 2500, 500, 900, 1),
  tool("get_project_info", 1, 80, 80, 80, 0),
  tool("read_symbol", 3, 12000, 4000, 6000, 0),
  tool("search_records", 10, 5500, 550, 900, 0),
];
const BEFORE_CALLS_BY_DATE = [tool("describe_locus", 4, 6500, 1500, 3000, 1), tool("get_project_info", 1, 400, 400, 400, 0)];
const AFTER_CALLS_BY_DATE = [
  tool("describe_locus", 2, 3400, 1700, 2200, 0),
  tool("find_symbol", 5, 2500, 500, 900, 1),
  tool("get_project_info", 2, 120, 60, 80, 0),
  tool("read_symbol", 3, 12000, 4000, 6000, 0),
  tool("search_records", 10, 5500, 550, 900, 0),
];

const classes = ["index", "amanuensis_other", "read_whole", "read_sliced", "search", "shell", "other"];
const klass = (values) => Object.fromEntries(classes.map((c, i) => [c, values[i]]));
const tokens = (i, o, cc, cr, w) => ({ input: i, output: o, cache_creation: cc, cache_read: cr, weighted: w });
//                                      index amanuensis_other read_whole read_sliced search shell other
const BEFORE_TRANSCRIPTS = {
  sessions: 2,
  unreadable_lines: 1,
  totals: {
    calls: klass([0, 1, 2, 1, 2, 1, 2]),
    bytes: klass([0, 2500, 6000, 800, 900, 1500, 120]),
    tokens: tokens(35, 350, 1500, 12000, 4860),
  },
  medians: {
    bytes: klass([0, 1250, 3000, 400, 450, 750, 60]),
    tokens: tokens(17.5, 175, 750, 6000, 2430),
  },
};
const AFTER_TRANSCRIPTS = {
  sessions: 2,
  unreadable_lines: 0,
  totals: {
    calls: klass([5, 1, 2, 1, 1, 1, 0]),
    bytes: klass([4500, 150, 4000, 400, 500, 200, 0]),
    tokens: tokens(27, 340, 2100, 23000, 6652),
  },
  medians: {
    bytes: klass([2250, 75, 2000, 200, 250, 100, 0]),
    tokens: tokens(13.5, 170, 1050, 11500, 3326),
  },
};
const SESSION_B1 = {
  session: "sess-b1",
  bytes: klass([0, 2500, 4000, 800, 600, 1500, 120]),
  tokens: tokens(30, 300, 1000, 11000, 3880),
};
const SESSION_A1 = {
  session: "sess-a1",
  bytes: klass([4200, 150, 3000, 400, 0, 200, 0]),
  tokens: tokens(23, 300, 2100, 20000, 6148),
};

const splitTranscripts = (flag, names) => names.flatMap((n) => [flag, join(fixtures, n)]);

const pickTranscripts = (t) =>
  t && {
    sessions: t.sessions,
    unreadable_lines: t.unreadable_lines,
    totals: t.totals && { calls: t.totals.calls, bytes: t.totals.bytes, tokens: t.totals.tokens },
    medians: t.medians && { bytes: t.medians.bytes, tokens: t.medians.tokens },
  };
const pickSession = (t, id) => {
  const s = (t?.per_session ?? []).find((x) => x.session === id);
  return s && { session: s.session, bytes: s.bytes, tokens: s.tokens };
};

// --- 1. split by server version, two explicit transcript lists ------------------------------------
const byVersionArgs = [
  "--call-log", beforeDb,
  "--call-log", afterDb,
  "--after-version", "0.3.0-beta.2",
  ...splitTranscripts("--before-transcripts", ["before-1.jsonl", "before-2.jsonl"]),
  ...splitTranscripts("--after-transcripts", ["after-1.jsonl", "after-2.jsonl"]),
];
const stat = (p) => {
  const s = statSync(p);
  return `${s.size}:${s.mtimeMs}:${createHash("sha256").update(readFileSync(p)).digest("hex")}`;
};
const listing = () => readdirSync(logs).sort().join(",");
const dbsBefore = [stat(beforeDb), stat(afterDb), listing()];

const full = runJson("version split", byVersionArgs);
if (full) {
  check("coverage", full.coverage, { call_log: true, transcripts: true, host_reads_covered: true });
  check("before per-tool (version split)", full.sides?.before?.call_log?.tools, BEFORE_CALLS_BY_VERSION);
  check("after per-tool (version split)", full.sides?.after?.call_log?.tools, AFTER_CALLS_BY_VERSION);
  check("before transcripts", pickTranscripts(full.sides?.before?.transcripts), BEFORE_TRANSCRIPTS);
  check("after transcripts", pickTranscripts(full.sides?.after?.transcripts), AFTER_TRANSCRIPTS);
  check("session sess-b1", pickSession(full.sides?.before?.transcripts, "sess-b1"), SESSION_B1);
  check("session sess-a1", pickSession(full.sides?.after?.transcripts, "sess-a1"), SESSION_A1);
  check("price ratios", full.price_ratios, { input: 1, output: 5, cache_creation: 1.25, cache_read: 0.1 });
  const serialised = JSON.stringify(full);
  if (/verdict|threshold/i.test(serialised)) fail("the JSON output contains a verdict or threshold field");
}

// --- 2. split by cutover date, transcripts from one directory -----------------------------------
const mixed = join(work, "mixed-transcripts");
mkdirSync(mixed);
for (const n of ["before-1.jsonl", "before-2.jsonl", "after-1.jsonl", "after-2.jsonl"]) cpSync(join(fixtures, n), join(mixed, n));
mkdirSync(join(mixed, "nested"));
cpSync(join(fixtures, "call-log.json"), join(mixed, "nested", "not-a-transcript.json"));
const byDate = runJson("cutover split", [
  "--call-log", beforeDb,
  "--call-log", afterDb,
  "--transcripts", mixed,
  "--cutover", "2026-11-15",
]);
if (byDate) {
  check("before per-tool (cutover)", byDate.sides?.before?.call_log?.tools, BEFORE_CALLS_BY_DATE);
  check("after per-tool (cutover)", byDate.sides?.after?.call_log?.tools, AFTER_CALLS_BY_DATE);
  check("before transcripts (cutover)", pickTranscripts(byDate.sides?.before?.transcripts), BEFORE_TRANSCRIPTS);
  check("after transcripts (cutover)", pickTranscripts(byDate.sides?.after?.transcripts), AFTER_TRANSCRIPTS);
}

// --- 3. text output: the tables, the coverage statement, the reminders ----------------------------
const textRun = run(byVersionArgs);
const text = textRun.stdout;
if (textRun.status !== 0) fail(`text run exited ${textRun.status}: ${textRun.stderr.split("\n")[0]}`);
const section = (heading) => {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.startsWith(heading));
  if (at < 0) return null;
  const rows = [];
  for (const l of lines.slice(at + 1)) {
    if (l.trim() === "" || l.startsWith("##")) break;
    rows.push(l.trim().split(/\s+/));
  }
  return rows.slice(1); // the first row names the columns
};
const callRows = (tools) => tools.map((t) => [t.tool, ...[t.calls, t.response_bytes_total, t.response_bytes_median, t.response_bytes_p90, t.refusals].map(String)]);
check("text: before call-log table", section("## before: call log"), callRows(BEFORE_CALLS_BY_VERSION));
check("text: after call-log table", section("## after: call log"), callRows(AFTER_CALLS_BY_VERSION));
const classRows = (t) =>
  classes.map((c) => [c, String(t.totals.calls[c]), String(t.totals.bytes[c]), String(t.medians.bytes[c])]);
const tokenRows = (t) =>
  ["input", "output", "cache_creation", "cache_read", "weighted"].map((k) => [k, String(t.totals.tokens[k]), String(t.medians.tokens[k])]);
const transcriptRows = (t) => [...classRows(t), ["tokens", "total", "median_per_session"], ...tokenRows(t)];
check("text: before transcripts table", section("## before: transcripts"), transcriptRows(BEFORE_TRANSCRIPTS));
check("text: after transcripts table", section("## after: transcripts"), transcriptRows(AFTER_TRANSCRIPTS));
if (!/\(2 sessions\)/.test(text)) fail("text: the session count is not stated");
if (/host reads[^\n]*not covered/i.test(text)) fail("text: says host reads are not covered although transcripts were given");
if (!/two sides differ in task, subject and time/i.test(text)) fail("text: omits the reminder that the two sides differ in task, subject and time");
if (!/input 1\b[^\n]*output 5\b[^\n]*cache_creation 1\.25\b[^\n]*cache_read 0\.1\b/.test(text)) fail("text: omits the price ratios");
const FORBIDDEN = /\b(verdicts?|thresholds?|improv\w*|regress\w*|better|worse|saved|savings?|reduc\w*|increas\w*|decreas\w*|passed|failed|wins?|delta|change)\b|%|[Δ→]/i;
const forbiddenHit = text.match(FORBIDDEN);
if (forbiddenHit) fail(`text: contains "${forbiddenHit[0]}", which reads as a verdict, a threshold or a change figure`);

// --- 4. without transcripts, and without a call log ------------------------------------------------
const noTranscripts = run(["--call-log", beforeDb, "--call-log", afterDb, "--after-version", "0.3.0-beta.2"]);
if (noTranscripts.status !== 0) fail(`call-log-only run exited ${noTranscripts.status}`);
if (!/host reads[^\n]*not covered/i.test(noTranscripts.stdout)) fail("call-log-only: does not say that host reads are not covered");
if (!/file reading[^\n]*(up|down)/i.test(noTranscripts.stdout) && !/cannot show/i.test(noTranscripts.stdout)) {
  fail("call-log-only: does not say why the report cannot show whether file reading changed");
}
const noTranscriptsJson = runJson("call-log only", ["--call-log", beforeDb, "--call-log", afterDb, "--after-version", "0.3.0-beta.2"]);
if (noTranscriptsJson) {
  check("call-log-only coverage", noTranscriptsJson.coverage, { call_log: true, transcripts: false, host_reads_covered: false });
  check("call-log-only transcripts", [noTranscriptsJson.sides?.before?.transcripts ?? null, noTranscriptsJson.sides?.after?.transcripts ?? null], [null, null]);
  check("call-log-only per-tool", noTranscriptsJson.sides?.after?.call_log?.tools, AFTER_CALLS_BY_VERSION);
}
const onlyTranscripts = runJson("transcripts only", [...splitTranscripts("--before-transcripts", ["before-1.jsonl"]), ...splitTranscripts("--after-transcripts", ["after-2.jsonl"])]);
if (onlyTranscripts) {
  check("transcripts-only coverage", onlyTranscripts.coverage, { call_log: false, transcripts: true, host_reads_covered: true });
  check("transcripts-only before sessions", onlyTranscripts.sides?.before?.transcripts?.sessions, 1);
  check("transcripts-only after bytes", onlyTranscripts.sides?.after?.transcripts?.totals?.bytes, klass([300, 0, 1000, 0, 500, 0, 0]));
}
const onlyTranscriptsText = run([...splitTranscripts("--before-transcripts", ["before-1.jsonl"]), ...splitTranscripts("--after-transcripts", ["after-2.jsonl"])]);
if (!/call log[^\n]*not covered/i.test(onlyTranscriptsText.stdout)) fail("transcripts-only: does not say that Amanuensis calls are not covered");

// --- 4b. a resumed session in two files, a repeated path, a write tool, multi-byte text blocks ------
// resumed-2.jsonl replays msg_r_1 and its result from resumed-1.jsonl, as a resumed session does.
// add_evidence writes, so it is `other`; get_findings reads, so it is `amanuensis_other`. Result
// bytes are UTF-8: "évidence ✓" is 13 bytes, "日本語" + "ok" 11.
const RESUMED = {
  sessions: 1,
  unreadable_lines: 0,
  totals: {
    calls: klass([0, 1, 1, 0, 0, 0, 1]),
    bytes: klass([0, 11, 3, 0, 0, 0, 13]),
    tokens: tokens(16, 100, 0, 600, 576),
  },
  medians: {
    bytes: klass([0, 11, 3, 0, 0, 0, 13]),
    tokens: tokens(16, 100, 0, 600, 576),
  },
};
const resumedDir = join(fixtures, "resumed");
const resumedArgs = (...paths) => paths.flatMap((p) => ["--before-transcripts", p]);
for (const [label, paths] of [
  ["resumed session across two files", [join(resumedDir, "resumed-1.jsonl"), join(resumedDir, "resumed-2.jsonl")]],
  ["resumed session, a file named twice", [join(resumedDir, "resumed-1.jsonl"), join(resumedDir, "resumed-2.jsonl"), join(resumedDir, "resumed-1.jsonl")]],
  ["resumed session, a directory and a file in it", [resumedDir, join(resumedDir, "resumed-2.jsonl")]],
]) {
  const r = runJson(label, resumedArgs(...paths));
  if (r) check(label, pickTranscripts(r.sides?.before?.transcripts), RESUMED);
}
// resumed-3.jsonl is a resume that got a new session id, sess-r2, and replays msg_r_1 and its result:
// both still count once, in the session that first had them.
const newId = runJson("resumed under a new session id", resumedArgs(resumedDir, join(fixtures, "resumed-new-id", "resumed-3.jsonl")));
if (newId) {
  const t = newId.sides?.before?.transcripts;
  check("resumed under a new session id: sessions", t?.sessions, 2);
  check("resumed under a new session id: tokens", t?.totals?.tokens, tokens(18, 110, 0, 650, 633));
  check("resumed under a new session id: bytes", t?.totals?.bytes, klass([0, 11, 3, 0, 2, 0, 13]));
  check("resumed under a new session id: sess-r2", pickSession(t, "sess-r2"), {
    session: "sess-r2",
    bytes: klass([0, 0, 0, 0, 2, 0, 0]),
    tokens: tokens(2, 10, 0, 50, 57),
  });
}
const twice = runJson("one transcript named twice", [
  ...splitTranscripts("--before-transcripts", ["before-2.jsonl", "before-2.jsonl"]),
  ...splitTranscripts("--after-transcripts", ["after-2.jsonl"]),
]);
if (twice) {
  check("one transcript named twice: sessions", twice.sides?.before?.transcripts?.sessions, 1);
  check("one transcript named twice: weighted median", twice.sides?.before?.transcripts?.medians?.tokens?.weighted, 980);
}
// before-2.jsonl has an unreadable line, which no id deduplicates: named twice, it is still one.
const once = runJson("before-2 once", splitTranscripts("--before-transcripts", ["before-2.jsonl"]));
if (once && twice) {
  check("before-2 once: unreadable lines", once.sides?.before?.transcripts?.unreadable_lines, 1);
  check("before-2 named twice reads as once", pickTranscripts(twice.sides?.before?.transcripts), pickTranscripts(once.sides?.before?.transcripts));
}

// --- 5. read-only, and nothing written but the output ----------------------------------------------
// before-calls.db alone: every row is on the before side.
const WAL_COPY_CALLS = [tool("describe_locus", 4, 6500, 1500, 3000, 1), tool("get_project_info", 1, 400, 400, 400, 0)];
const walRun = runJson("WAL-mode copy in a read-only directory", ["--call-log", walDb, "--after-version", "0.3.0-beta.2"]);
if (walRun) check("WAL-mode copy: per-tool", walRun.sides?.before?.call_log?.tools, WAL_COPY_CALLS);
check("WAL-mode copy: nothing appears beside it", walListing(), "before-calls.db");
chmodSync(walDir, 0o755);
const walBeside = runJson("WAL-mode copy in a writable directory", ["--call-log", walDb, "--after-version", "0.3.0-beta.2"]);
if (walBeside) check("WAL-mode copy (writable directory): per-tool", walBeside.sides?.before?.call_log?.tools, WAL_COPY_CALLS);
check("WAL-mode copy: no -shm or -wal left beside it", walListing(), "before-calls.db");
check("call-log copies unchanged by every run", [stat(beforeDb), stat(afterDb), listing()], dbsBefore);
const missing = join(logs, "absent-calls.db");
const missingRun = run(["--call-log", missing, "--after-version", "0.3.0-beta.2"]);
if (missingRun.status === 0) fail("a missing call-log path was accepted");
if (existsSync(missing)) fail("a missing call-log path was created: the call log is not opened read-only");
const notSqlite = join(work, "not-a-database.db");
writeFileSync(notSqlite, "this is not a database\n");
if (run(["--call-log", notSqlite, "--after-version", "x"]).status === 0) fail("a file that is not a call log was accepted");
check("call-log copies unchanged after the refused paths", [stat(beforeDb), stat(afterDb), listing()], dbsBefore);
// The open itself, outside comments; a missing path is refused above, and a WAL copy in a read-only
// directory shows the open adds nothing beside the copy.
const source = readFileSync(script, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
if (!/readonly:\s*true/.test(source)) fail("dev/token-report.mjs does not open the call log with `readonly: true`");

const cleanDir = mkdtempSync(join(tmpdir(), "token-report-cwd-"));
const outFile = join(cleanDir, "report.txt");
const outRun = run([...byVersionArgs, "--out", outFile], { cwd: cleanDir });
if (outRun.status !== 0) fail(`--out run exited ${outRun.status}`);
if (outRun.stdout.trim() !== "") fail("--out run also wrote to standard output");
if (!existsSync(outFile) || readFileSync(outFile, "utf8") !== text) fail("--out file differs from the standard-output report");
check("--out wrote only the named file", readdirSync(cleanDir).sort().join(","), "report.txt");
run(byVersionArgs, { cwd: cleanDir });
check("a run without --out writes nothing in its working directory", readdirSync(cleanDir).sort().join(","), "report.txt");

// --- 6. bad usage ----------------------------------------------------------------------------------
const noSplit = run(["--call-log", beforeDb]);
if (noSplit.status === 0) fail("a call log with neither --after-version nor --cutover was accepted");
const noCutover = run(["--transcripts", mixed]);
if (noCutover.status === 0) fail("--transcripts without --cutover was accepted");
const unknownFlag = run(["--frobnicate"]);
if (unknownFlag.status === 0) fail("an unknown flag was accepted");
const nothing = run([]);
if (nothing.status === 0) fail("a run with no inputs was accepted");

chmodSync(walDir, 0o755);
rmSync(work, { recursive: true, force: true });
rmSync(cleanDir, { recursive: true, force: true });
finish();
