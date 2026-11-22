#!/usr/bin/env node
// Descriptive token report (design/semantic-index/PLAN.md §6).
//
// Reads copies of the call log (`<storage>/call-log/calls.db`, read into memory and opened read-only,
// so nothing is added beside a WAL-mode copy) and, optionally,
// Claude Code transcript files, and prints what each side — before and after — shows. It decides
// nothing: there is no verdict, no threshold and no figure for the change between the sides. The
// two sides differ in task, subject and time, so the comparison is descriptive.
//
// Call log: per Amanuensis tool, calls, response bytes (total, median, 90th percentile) and
// refusals, split by server version (`--after-version`) or by a cutover date (`--cutover`).
// Transcripts: per session (the files of one session id are one session, and a file named twice is
// read once), tool-result bytes by class and the four `usage` counts, deduplicated by message id,
// split by two file lists (`--before-transcripts`, `--after-transcripts`) or by the date a session
// began (`--transcripts` with `--cutover`). Amanuensis's read tools are the index class and "other
// Amanuensis reads"; its write tools count as `other`. Without transcripts the report says that
// host reads (`Read`, `Grep`, shell) are not covered.
//
// Writes nothing but standard output, or the one file named by `--out`.
//
// Usage:
//   node dev/token-report.mjs --call-log <calls.db>... (--after-version <v>... | --cutover <date>)
//       [--before-transcripts <file|dir>...] [--after-transcripts <file|dir>...]
//       [--transcripts <file|dir>... --cutover <date>] [--format text|json] [--out <file>]
// A directory of transcripts is searched for `*.jsonl`. A flag that takes paths or versions may be
// repeated. Take the call-log copy with `sqlite3 calls.db ".backup before-calls.db"` once every
// server on the store has stopped.

import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

/** Published price ratios, relative to one uncached input token. Cache writes use the five-minute rate. */
const PRICE_RATIOS = { input: 1, output: 5, cache_creation: 1.25, cache_read: 0.1 };
/** The same ratios in hundredths, so the weighted sum is integer arithmetic. */
const PRICE_HUNDREDTHS = { input: 100, output: 500, cache_creation: 125, cache_read: 10 };

const INDEX_TOOLS = new Set(["find_symbol", "outline_file", "read_symbol", "search_records"]);
// Amanuensis's read tools, by the rule the server's readOnlyHint follows (mcp-server/src/index.ts,
// toolAnnotations): describe_locus and the four index tools by name, the rest by a get_, list_ or
// lookup_ prefix. Every other Amanuensis tool writes, and its results count as `other`.
const isAmanuensisRead = (tool) =>
  tool === "describe_locus" || INDEX_TOOLS.has(tool) || /^(get|list|lookup)_/.test(tool);
const CLASSES = ["index", "amanuensis_other", "read_whole", "read_sliced", "search", "shell", "other"];
const TOKEN_KEYS = ["input", "output", "cache_creation", "cache_read"];
const USAGE_FIELDS = {
  input: "input_tokens",
  output: "output_tokens",
  cache_creation: "cache_creation_input_tokens",
  cache_read: "cache_read_input_tokens",
};

class UsageError extends Error {}

// --- arguments -----------------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    callLogs: [],
    afterVersions: [],
    cutover: null,
    beforeTranscripts: [],
    afterTranscripts: [],
    transcripts: [],
    format: "text",
    out: null,
  };
  const value = (i, flag) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new UsageError(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const v = value(i, flag);
    if (flag === "--call-log") args.callLogs.push(v);
    else if (flag === "--after-version") args.afterVersions.push(v);
    else if (flag === "--cutover") args.cutover = v;
    else if (flag === "--before-transcripts") args.beforeTranscripts.push(v);
    else if (flag === "--after-transcripts") args.afterTranscripts.push(v);
    else if (flag === "--transcripts") args.transcripts.push(v);
    else if (flag === "--format") args.format = v;
    else if (flag === "--out") args.out = v;
    else throw new UsageError(`unknown argument: ${flag}`);
  }
  if (!["text", "json"].includes(args.format)) throw new UsageError("--format is text or json");
  let cutoverMs = null;
  if (args.cutover !== null) {
    cutoverMs = Date.parse(args.cutover);
    if (Number.isNaN(cutoverMs)) throw new UsageError(`--cutover is not a date: ${args.cutover}`);
  }
  const explicitTranscripts = args.beforeTranscripts.length + args.afterTranscripts.length > 0;
  if (args.callLogs.length === 0 && args.transcripts.length === 0 && !explicitTranscripts) {
    throw new UsageError("give at least one --call-log or some transcripts");
  }
  if (args.callLogs.length > 0 && args.afterVersions.length === 0 && cutoverMs === null) {
    throw new UsageError("a call log needs --after-version <v> or --cutover <date> to say which side is which");
  }
  if (args.transcripts.length > 0 && cutoverMs === null) {
    throw new UsageError("--transcripts needs --cutover <date>; or name the sides with --before-transcripts and --after-transcripts");
  }
  if (args.transcripts.length > 0 && explicitTranscripts) {
    throw new UsageError("use either --transcripts with --cutover, or --before-transcripts and --after-transcripts");
  }
  return { ...args, cutoverMs };
}

// --- statistics ----------------------------------------------------------------------------------

/** The middle value, or the mean of the two middle values; null for no values. */
function median(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : round2((s[mid - 1] + s[mid]) / 2);
}

/** The nearest-rank 90th percentile: the smallest value with at least 90% of values at or below it. */
function p90(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.ceil(0.9 * s.length) - 1];
}

const round2 = (n) => Math.round(n * 100) / 100;
const sum = (values) => values.reduce((a, b) => a + b, 0);

// --- call log ------------------------------------------------------------------------------------

/**
 * Open a call-log copy from its bytes, in memory and read-only. Opening the file itself, even
 * read-only, adds `-shm` and `-wal` beside a WAL-mode copy, which a `.backup` of the live log is; the
 * header's WAL bytes are set back to rollback mode in the in-memory copy only. A copy with a
 * write-ahead log beside it is refused, because its last calls would be in that log.
 */
function openCopy(Database, path) {
  const wal = `${path}-wal`;
  if (existsSync(wal) && statSync(wal).size > 0) {
    throw new Error(`a write-ahead log is beside it (${basename(wal)}); take the copy with sqlite3 calls.db ".backup <copy>"`);
  }
  const bytes = readFileSync(path);
  if (bytes.length >= 20 && bytes[18] === 2 && bytes[19] === 2) {
    bytes[18] = 1;
    bytes[19] = 1;
  }
  return new Database(bytes, { readonly: true });
}

function readCallLogs(paths, args) {
  const Database = require(join(root, "mcp-server", "node_modules", "better-sqlite3"));
  const sides = { before: { rows: [], versions: new Set() }, after: { rows: [], versions: new Set() } };
  const after = new Set(args.afterVersions);
  for (const path of paths) {
    let db;
    try {
      db = openCopy(Database, path);
    } catch (e) {
      throw new Error(`cannot open call log ${path} read-only: ${String(e.message).split("\n")[0]}`);
    }
    try {
      let rows;
      try {
        rows = db
          .prepare(
            `SELECT l.tool, l.outcome, l.response_bytes, l.started_at, c.server_version
               FROM call_log l JOIN call_log_connections c ON c.connection_id = l.connection_id`,
          )
          .all();
      } catch (e) {
        throw new Error(`${path} is not a call log: ${String(e.message).split("\n")[0]}`);
      }
      for (const row of rows) {
        const isAfter =
          args.cutoverMs !== null && args.afterVersions.length === 0
            ? Date.parse(row.started_at) >= args.cutoverMs
            : after.has(row.server_version);
        const side = sides[isAfter ? "after" : "before"];
        side.rows.push(row);
        side.versions.add(row.server_version);
      }
    } finally {
      db.close();
    }
  }
  return sides;
}

function summariseCalls(side) {
  const byTool = new Map();
  for (const row of side.rows) {
    if (!byTool.has(row.tool)) byTool.set(row.tool, []);
    byTool.get(row.tool).push(row);
  }
  return {
    server_versions: [...side.versions].sort(),
    tools: [...byTool.keys()].sort().map((tool) => {
      const rows = byTool.get(tool);
      const bytes = rows.map((r) => r.response_bytes);
      return {
        tool,
        calls: rows.length,
        response_bytes_total: sum(bytes),
        response_bytes_median: median(bytes),
        response_bytes_p90: p90(bytes),
        refusals: rows.filter((r) => r.outcome === "refusal").length,
      };
    }),
  };
}

// --- transcripts ---------------------------------------------------------------------------------

/** The transcript files the paths name, each once however often it is named, directly or by a directory. */
function collectTranscriptFiles(paths) {
  const files = [];
  const seen = new Set();
  const add = (path) => {
    const real = realpathSync(path);
    if (seen.has(real)) return;
    seen.add(real);
    files.push(path);
  };
  const visit = (path) => {
    const st = lstatSync(path);
    if (st.isDirectory()) {
      for (const name of readdirSync(path).sort()) visit(join(path, name));
    } else if (st.isFile() && path.endsWith(".jsonl")) {
      add(path);
    }
  };
  for (const p of paths) {
    const st = statSync(p);
    if (st.isFile()) add(p);
    else visit(p);
  }
  return files;
}

function classify(name, input) {
  if (name.startsWith("mcp__")) {
    const [, server = "", ...rest] = name.split("__");
    if (!/amanuensis/i.test(server)) return "other";
    const tool = rest.join("__");
    if (INDEX_TOOLS.has(tool)) return "index";
    return isAmanuensisRead(tool) ? "amanuensis_other" : "other";
  }
  if (name === "Read") {
    const sliced = input && (input.offset != null || input.limit != null || input.pages != null);
    return sliced ? "read_sliced" : "read_whole";
  }
  if (name === "Grep" || name === "Glob") return "search";
  if (name === "Bash" || name === "BashOutput") return "shell";
  return "other";
}

function resultBytes(content) {
  if (typeof content === "string") return Buffer.byteLength(content, "utf8");
  if (Array.isArray(content)) {
    return sum(
      content.map((block) =>
        block && block.type === "text" && typeof block.text === "string"
          ? Buffer.byteLength(block.text, "utf8")
          : Buffer.byteLength(JSON.stringify(block) ?? "", "utf8"),
      ),
    );
  }
  return Buffer.byteLength(JSON.stringify(content ?? "") ?? "", "utf8");
}

const zeroClasses = () => Object.fromEntries(CLASSES.map((c) => [c, 0]));
const zeroTokens = () => Object.fromEntries(TOKEN_KEYS.map((k) => [k, 0]));

/**
 * Read transcript files into sessions, one per session id: the files of a resumed session are one
 * session. A message id is counted once for its usage and a tool-use id once for its result, across
 * every file, because a resumed session repeats earlier lines and a streamed message appears once
 * per content block.
 */
function readSessions(files) {
  const seenMessages = new Set();
  const seenResults = new Set();
  const sessions = [];
  const groups = new Map();
  for (const file of files) {
    let unreadable = 0;
    const entries = [];
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (line.trim() === "") continue;
      try {
        const entry = JSON.parse(line);
        if (entry && typeof entry === "object") entries.push(entry);
        else unreadable += 1;
      } catch {
        unreadable += 1;
      }
    }
    const id = entries.find((e) => typeof e.sessionId === "string")?.sessionId ?? basename(file, ".jsonl");
    if (!groups.has(id)) groups.set(id, { entries: [], unreadable: 0 });
    const group = groups.get(id);
    group.entries.push(...entries);
    group.unreadable += unreadable;
  }
  for (const [id, { entries, unreadable }] of groups) {
    const uses = new Map();
    for (const entry of entries) {
      const content = entry.message?.content;
      if (entry.type !== "assistant" || !Array.isArray(content)) continue;
      for (const block of content) {
        if (block?.type === "tool_use" && block.id) uses.set(block.id, { name: String(block.name ?? ""), input: block.input });
      }
    }
    const session = {
      session: id,
      unreadable,
      started_at: null,
      calls: zeroClasses(),
      bytes: zeroClasses(),
      tokens: zeroTokens(),
    };
    for (const entry of entries) {
      if (typeof entry.timestamp === "string" && (session.started_at === null || entry.timestamp < session.started_at)) {
        session.started_at = entry.timestamp;
      }
      const message = entry.message;
      if (entry.type === "assistant" && message?.usage && typeof message.id === "string" && !seenMessages.has(message.id)) {
        seenMessages.add(message.id);
        for (const key of TOKEN_KEYS) session.tokens[key] += Number(message.usage[USAGE_FIELDS[key]]) || 0;
      }
      if (entry.type === "user" && Array.isArray(message?.content)) {
        for (const block of message.content) {
          if (block?.type !== "tool_result") continue;
          const key = block.tool_use_id ?? null;
          if (key !== null) {
            if (seenResults.has(key)) continue;
            seenResults.add(key);
          }
          const use = uses.get(key);
          const klass = use ? classify(use.name, use.input) : "other";
          session.calls[klass] += 1;
          session.bytes[klass] += resultBytes(block.content);
        }
      }
    }
    if (entries.length > 0) sessions.push(session);
  }
  for (const s of sessions) s.tokens.weighted = weighted(s.tokens);
  return sessions;
}

function weighted(tokens) {
  return sum(TOKEN_KEYS.map((k) => tokens[k] * PRICE_HUNDREDTHS[k])) / 100;
}

function summariseSessions(sessions) {
  const bytesOf = (c) => sessions.map((s) => s.bytes[c]);
  const tokensOf = (k) => sessions.map((s) => s.tokens[k]);
  const tokenKeys = [...TOKEN_KEYS, "weighted"];
  return {
    sessions: sessions.length,
    unreadable_lines: sum(sessions.map((s) => s.unreadable)),
    totals: {
      calls: Object.fromEntries(CLASSES.map((c) => [c, sum(sessions.map((s) => s.calls[c]))])),
      bytes: Object.fromEntries(CLASSES.map((c) => [c, sum(bytesOf(c))])),
      tokens: Object.fromEntries(tokenKeys.map((k) => [k, sum(tokensOf(k))])),
    },
    medians: {
      bytes: Object.fromEntries(CLASSES.map((c) => [c, median(bytesOf(c))])),
      tokens: Object.fromEntries(tokenKeys.map((k) => [k, median(tokensOf(k))])),
    },
    per_session: sessions.map((s) => ({
      session: s.session,
      started_at: s.started_at,
      calls: s.calls,
      bytes: s.bytes,
      tokens: s.tokens,
    })),
  };
}

function splitSessions(args) {
  if (args.transcripts.length > 0) {
    const sessions = readSessions(collectTranscriptFiles(args.transcripts));
    const dated = sessions.filter((s) => s.started_at !== null);
    const before = dated.filter((s) => Date.parse(s.started_at) < args.cutoverMs);
    const after = dated.filter((s) => Date.parse(s.started_at) >= args.cutoverMs);
    return {
      before: summariseSessions(before),
      after: summariseSessions(after),
      undated: sessions.length - dated.length,
    };
  }
  const side = (paths) => {
    return summariseSessions(readSessions(collectTranscriptFiles(paths)));
  };
  return { before: side(args.beforeTranscripts), after: side(args.afterTranscripts), undated: 0 };
}

// --- report --------------------------------------------------------------------------------------

function buildReport(args) {
  const haveTranscripts = args.transcripts.length + args.beforeTranscripts.length + args.afterTranscripts.length > 0;
  const haveCallLog = args.callLogs.length > 0;
  const calls = haveCallLog ? readCallLogs(args.callLogs, args) : null;
  const sessions = haveTranscripts ? splitSessions(args) : null;
  const notes = [];
  if (sessions?.undated) notes.push(`${sessions.undated} transcript session(s) have no timestamp and are left out of both sides.`);
  return {
    report: "token-report",
    price_ratios: PRICE_RATIOS,
    coverage: { call_log: haveCallLog, transcripts: haveTranscripts, host_reads_covered: haveTranscripts },
    split: {
      call_log: haveCallLog ? (args.afterVersions.length > 0 ? { after_versions: args.afterVersions } : { cutover: args.cutover }) : null,
      transcripts: haveTranscripts ? (args.transcripts.length > 0 ? { cutover: args.cutover } : { lists: true }) : null,
    },
    sides: {
      before: { call_log: calls && summariseCalls(calls.before), transcripts: sessions?.before ?? null },
      after: { call_log: calls && summariseCalls(calls.after), transcripts: sessions?.after ?? null },
    },
    notes,
  };
}

const fmt = (n) => (n === null || n === undefined ? "-" : String(n));

function table(header, rows) {
  const all = [header, ...rows].map((r) => r.map(fmt));
  const widths = header.map((_, i) => Math.max(...all.map((r) => r[i].length)));
  return all.map((r) => r.map((cell, i) => cell.padEnd(widths[i])).join("  ").trimEnd());
}

function renderText(report) {
  const out = [];
  out.push("Token report. Descriptive only; it decides nothing.", "");
  out.push("The two sides differ in task, subject and time, so the comparison is descriptive.");
  const r = report.price_ratios;
  out.push(
    `Price ratios, relative to one input token (cache writes at the five-minute rate): input ${r.input}, output ${r.output}, cache_creation ${r.cache_creation}, cache_read ${r.cache_read}.`,
  );
  out.push("The weighted sum applies those ratios to the four usage counts.");
  if (!report.coverage.transcripts) {
    out.push(
      "Host reads (Read, Grep, shell) are not covered: no transcripts were given, so this report cannot show whether file reading went up or down.",
    );
  }
  if (!report.coverage.call_log) {
    out.push("No call log was given, so Amanuensis's own calls are not covered.");
  }
  for (const note of report.notes) out.push(note);
  for (const side of ["before", "after"]) {
    const data = report.sides[side];
    if (data.call_log) {
      const versions = data.call_log.server_versions;
      out.push("", `## ${side}: call log (server versions: ${versions.length ? versions.join(", ") : "none"})`);
      out.push(
        ...table(
          ["tool", "calls", "response_bytes_total", "response_bytes_median", "response_bytes_p90", "refusals"],
          data.call_log.tools.map((t) => [
            t.tool,
            t.calls,
            t.response_bytes_total,
            t.response_bytes_median,
            t.response_bytes_p90,
            t.refusals,
          ]),
        ),
      );
    }
    const t = data.transcripts;
    if (t) {
      out.push("", `## ${side}: transcripts (${t.sessions} sessions)`);
      out.push(
        ...table(
          ["class", "calls", "total_bytes", "median_bytes_per_session"],
          CLASSES.map((c) => [c, t.totals.calls[c], t.totals.bytes[c], t.medians.bytes[c]]),
        ),
      );
      out.push(
        ...table(
          ["tokens", "total", "median_per_session"],
          [...TOKEN_KEYS, "weighted"].map((k) => [k === "weighted" ? "weighted" : k, t.totals.tokens[k], t.medians.tokens[k]]),
        ),
      );
      if (t.unreadable_lines > 0) out.push("", `${t.unreadable_lines} unreadable transcript line(s) skipped.`);
    }
  }
  return `${out.join("\n")}\n`;
}

// --- main ----------------------------------------------------------------------------------------

try {
  const args = parseArgs(process.argv.slice(2));
  const report = buildReport(args);
  const text = args.format === "json" ? `${JSON.stringify(report, null, 2)}\n` : renderText(report);
  if (args.out) writeFileSync(args.out, text);
  else process.stdout.write(text);
} catch (e) {
  process.stderr.write(`token-report: ${e.message}\n`);
  process.exit(e instanceof UsageError ? 2 : 1);
}
