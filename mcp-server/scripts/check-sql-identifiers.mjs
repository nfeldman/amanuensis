#!/usr/bin/env node
// Verify every SQL identifier referenced in src/tools/*.ts and src/*.ts
// resolves to a real table, view, or column in src/schema.sql. Catches
// typos that TypeScript cannot see (SQL strings are just strings).
//
// Approach:
//   1. Parse schema.sql once to extract the set of table / view / column
//      names the schema defines.
//   2. Walk all TypeScript source files, extract every SQL string
//      literal (template or plain), and tokenize it into candidate
//      identifiers.
//   3. Report any referenced table/column that isn't in the schema.
//
// This is a heuristic — it can produce false positives on aliases or
// CTEs. Known false-positive patterns are suppressed.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const mcpRoot = join(moduleDir, "..");
const schemaPath = join(mcpRoot, "src", "schema.sql");
const srcDir = join(mcpRoot, "src");

// ---- schema extraction ----
// Strip `--` single-line comments before parsing — SQL comments can
// contain semicolons that confuse the body-capture regex.
const schemaText = readFileSync(schemaPath, "utf8")
  .split("\n")
  .map((l) => {
    // Remove anything from `--` to end of line, but preserve `--` that
    // appears inside string literals. Schema uses no such literals.
    const idx = l.indexOf("--");
    return idx >= 0 ? l.slice(0, idx) : l;
  })
  .join("\n");

const tables = new Set();
const views = new Set();
const columnsByTable = new Map(); // name -> Set<column>

function recordColumns(tableName, body) {
  const set = new Set();
  // Naive column extraction: each line's leading identifier up to the
  // first whitespace/comma/paren. We skip constraint lines (PRIMARY KEY,
  // FOREIGN KEY, CHECK, UNIQUE, CONSTRAINT).
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("--")) continue;
    if (/^(primary|foreign|check|unique|constraint)\b/i.test(line)) continue;
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
    if (m) set.add(m[1]);
  }
  columnsByTable.set(tableName, set);
}

// Tables: CREATE TABLE IF NOT EXISTS <name> (...body...);
const tableRe =
  /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^;]*?)\)\s*;/gis;
let m;
while ((m = tableRe.exec(schemaText)) !== null) {
  const name = m[1];
  const body = m[2];
  tables.add(name);
  recordColumns(name, body);
}

// Views: CREATE VIEW ... AS ...;
const viewRe = /CREATE\s+VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)/gi;
while ((m = viewRe.exec(schemaText)) !== null) {
  views.add(m[1]);
}

// Pragma-backed virtual rows and SQLite internal tables are legal too.
const sqliteBuiltins = new Set([
  "pragma_page_count",
  "pragma_page_size",
  "pragma_table_info",
  "sqlite_master",
  "sqlite_sequence",
  "sqlite_temp_master",
]);

// Views have columns too, but they're derived — we won't validate view
// column names, only their presence as a relation.
const relations = new Set([...tables, ...views, ...sqliteBuiltins]);

// ---- TS walk ----
function* walkTs(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walkTs(full);
    } else if (entry.endsWith(".ts")) {
      yield full;
    }
  }
}

// Pull template and plain string literals that look like SQL. Heuristic
// is case-sensitive on purpose — idiomatic SQL uses UPPERCASE keywords
// and English prose (tool descriptions) does not. Matching case-
// sensitively eliminates false positives on sentences like "update the
// git baseline" that share keyword tokens with SQL.
const sqlKinds = /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/;
const sqlMarker = /\b(FROM|INTO|TABLE|VIEW|WHERE|VALUES|ON|SET|CONFLICT)\b/;
function looksLikeSql(s) {
  return sqlKinds.test(s) && sqlMarker.test(s);
}

// Extract FROM/JOIN/INTO/UPDATE tokens — these are relation references.
// For robustness we only validate the relation side; column validation
// would need a real SQL parser.
//
// Known keyword followers of UPDATE that must not be validated as
// relations: SET (as in `ON CONFLICT ... DO UPDATE SET ...`).
// Same trick with other keyword pairs.
const SQL_KEYWORDS = new Set(
  [
    "SET",
    "WHERE",
    "FROM",
    "JOIN",
    "ON",
    "AS",
    "INTO",
    "VALUES",
    // `CREATE TABLE IF NOT EXISTS <name>` — "IF" gets captured by the
    // relation regex; exclude it.
    "IF",
  ].map((k) => k.toLowerCase()),
);
function tokenizeSql(sql) {
  const rels = new Set();
  const re = /\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const ident = m[1];
    if (SQL_KEYWORDS.has(ident.toLowerCase())) continue;
    rels.add(ident);
  }
  return { rels };
}

const errors = [];
let sqlStringsChecked = 0;
for (const file of walkTs(srcDir)) {
  const text = readFileSync(file, "utf8");
  // Template literals (backtick) + double-quoted strings.
  const strRe = /(`[^`]*`|"[^"]*")/gs;
  let sm;
  while ((sm = strRe.exec(text)) !== null) {
    const raw = sm[1].slice(1, -1);
    if (!looksLikeSql(raw)) continue;
    sqlStringsChecked++;
    const { rels } = tokenizeSql(raw);
    for (const r of rels) {
      if (!relations.has(r)) {
        errors.push({ file, identifier: r, context: raw.slice(0, 80).replace(/\s+/g, " ") });
      }
    }
  }
}

console.log(`schema.sql: ${tables.size} tables, ${views.size} views`);
console.log(`source: ${sqlStringsChecked} SQL strings checked`);
if (errors.length === 0) {
  console.log("OK — every FROM/JOIN/UPDATE/INTO target resolves.");
  process.exit(0);
}
console.error(`\nFAIL — ${errors.length} unresolved SQL identifier(s):`);
for (const e of errors) {
  console.error(`  ${e.file}`);
  console.error(`    relation not in schema: ${e.identifier}`);
  console.error(`    context: ${e.context}…`);
}
process.exit(1);
