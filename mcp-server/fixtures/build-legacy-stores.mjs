#!/usr/bin/env node
// Build the committed legacy stores under fixtures/legacy-stores/
// (design/store-only/PLAN.md §8 "Gates are hermetic", SO2).
//
// The store-only migration and import must be tested on stores an earlier
// server wrote, without reading a real store. These two are written by the
// server of the lane's start commit (built from `git archive` by
// base-tree-server.mjs), so their schema is that commit's, byte for byte, and
// their rows and files are shaped like the two real stores PLAN.md §5.3
// measured:
//
//   axiomdb-shaped  0 claims, seams, survey bodies at the top level with tables
//                   and code fences, every project artifact kind, and an
//                   entry-point.md whose bytes differ from its registered hash
//                   (it was edited after it was registered).
//   self-shaped     claims, survey bodies under subsystems/, every file
//                   matching its registered hash.
//
// The content is invented and small; only the shape is copied. Each fixture is
// committed as `memory.sql` (a `sqlite3 .dump`, so a reviewer can diff it) and
// `storage/` (the artifact files). A gate loads the dump into a scratch file;
// nothing reads these in place.
//
//   node fixtures/build-legacy-stores.mjs            # rewrite both fixtures
//   node fixtures/build-legacy-stores.mjs --check    # exit 1 if a rebuild differs
//
// Needs git history holding BASE_SHA and the `sqlite3` command-line shell.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildBaseTreeServer } from "./base-tree-server.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "legacy-stores");
// The store-only lane's SO2 start commit: the server deployed when the lane merges.
const BASE_SHA = "adc060c663e0b93ce395d146c9830f721ba6f59a";
const check = process.argv.includes("--check");

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const SHA_A = "c3b1492c0da8168c125930d03a8dc4a40dfcc7fe";
const SHA_B = "d395c4d5a9e1f0b2c3d4e5f60718293a4b5c6d7e";
const SHA_C = "c711feb70e1d2c3b4a5968778695a4b3c2d1e0f9";

// ------------------------------------------------------------ file content

const AXIOM_ONBOARDING = `# Onboarding report

**Codebase**: Quadstore — an embedded RDF store with a query planner and a rule engine
**Date**: 2026-08-20
**Onboarding SHA**: ${SHA_A}

## Repository shape

| Dimension | Observed value | Confidence |
|---|---|---|
| Primary language(s) | Rust (3 crates) | code-verified |
| Build system(s) | Cargo workspace | code-verified |

## Runtime boundary map

| Runtime / Process | Language | Communicates with | Mechanism | Notes |
|---|---|---|---|---|
| Embedded \`quad-core\` | Rust | Host application (in-process) | Direct API | The primary deployment. |
| \`quad-server\` | Rust | Clients | gRPC over HTTP/2 | Optional TLS. |
| \`quad-server\` | Rust | Clients | HTTP (SPARQL protocol) | Plaintext unless terminated upstream. |

## Stateful entities

The store keeps quads in five index permutations and a dictionary of terms.
`;

const AXIOM_ENTRY_REGISTERED = `# Entry point

**Canonical branch**: main
**Onboarding SHA**: ${SHA_A}

## What is this codebase?

Quadstore is an RDF quad store written in Rust. It answers SPARQL queries over named graphs and keeps the inferences its rules derive beside the asserted quads.

## Directory map

| Path | Role |
|---|---|
| \`crates/quad-core/src/storage\` | Index permutations and the term dictionary |
`;

// What is on disk now: edited after it was registered, so its bytes differ.
const AXIOM_ENTRY_ON_DISK = `# Entry point

**Canonical branch**: main
**Onboarding SHA**: ${SHA_A}

## What is this codebase?

Quadstore is an RDF quad store written in Rust. It answers SPARQL queries over named graphs, refusing at planning the algebra it does not support, and keeps the inferences its rules derive beside the asserted quads.

Two ideas explain most of the design: visibility is metadata carried on each index entry, and every write passes one coordinator per graph.

## Directory map

| Path | Role |
|---|---|
| \`crates/quad-core/src/storage\` | Index permutations and the term dictionary |
| \`crates/quad-core/src/write\` | The write coordinator and its fences |
`;

const AXIOM_SURVEY_W01 = `# W-01 — Graph write coordinator

## Structural inventory (Phase 2)

### Key types

| Symbol | Role | Source |
|---|---|---|
| \`GraphLock\` | Shared per-graph lock handle. | \`coordinator.rs:31\` |
| \`WriteFence\` | Blocks writers while a rebuild runs. | \`coordinator.rs:273-410\` |

### Data flow — coordinated write (\`execute_inner\`)

1. Take the graph lock.
2. Check the fence.
3. Commit through the write core.

\`\`\`rust
let _guard = locks.graph(graph_id).lock();
fence.wait_inactive();
core.commit(batch)?;
\`\`\`

## Concern assessment

| Concern | Classification | Evidence |
|---|---|---|
| CC-1 | confirmed-acceptable | \`coordinator.rs:1170\` |
`;

const AXIOM_SURVEY_S01 = `# S-01 — Storage substrate

## Structural inventory (Phase 2)

| Symbol | Role | Source |
|---|---|---|
| \`Permutation\` | One of the five key orders. | \`index/perm.rs:12\` |

\`\`\`text
spog posg ogsp gspo gpos
\`\`\`
`;

const AXIOM_SURVEY_Q01 = `# Q-01 — Query front end

## Structural inventory (Phase 2)

The parser hands an algebra tree to the planner, which refuses \`SERVICE\`.
`;

const SELF_ONBOARDING = `# Onboarding report

**Codebase**: Scribe — a survey server and the pages it publishes
**Date**: 2026-09-12
**Onboarding SHA**: ${SHA_B}

## Runtime boundary map

| Runtime / Process | Language | Communicates with | Mechanism | Notes |
|---|---|---|---|---|
| MCP server | TypeScript | Agent host | stdio JSON-RPC | One process per session. |
| MCP server | TypeScript | Materializer | Subprocess | Spawned per publish. |
`;

const SELF_ENTRY = `# Entry point

## What is this codebase?

Scribe records what a survey of a codebase read, in a database, and publishes pages from it.
`;

const SELF_SURVEY_B01 = `# B-01 — Survey method

Structural account, read at \`${SHA_B.slice(0, 7)}\`.

## Observed

**Two halves of one contract.** The skill routes; the references carry the work.

| File | Role |
|---|---|
| \`SKILL.md\` | Routing |
`;

const SELF_SURVEY_B02 = `# B-02 — Record store

Structural account, read at \`${SHA_B.slice(0, 7)}\`.

## Observed

The server applies the schema on every open and migrates additive columns first.
`;

const simple = (title, body) => `# ${title}\n\n${body}\n`;

// ------------------------------------------------------------ the stores

const FIXTURES = {
  "axiomdb-shaped": {
    files: {
      "onboarding-report.md": [AXIOM_ONBOARDING, "onboarding-report", null, SHA_A, "2026-08-21 02:27:21"],
      "entry-point.md": [AXIOM_ENTRY_ON_DISK, "entry-point", null, SHA_C, "2026-11-04 05:33:58", AXIOM_ENTRY_REGISTERED],
      "master-plan.md": [simple("Master plan", "| ID | Name |\n|---|---|\n| W-01 | Graph write coordinator |"), "master-plan", null, SHA_B, "2026-10-21 03:06:39"],
      "findings-index.md": [simple("Findings index", "No open finding."), "findings-index", null, SHA_B, "2026-09-30 01:44:28"],
      "concern-checklist.md": [simple("Concern checklist", "| Code | Territory |\n|---|---|\n| CC-1 | T03 |"), "concern-checklist", null, SHA_A, "2026-08-21 02:27:26"],
      "field-notes.md": [simple("Field notes", "1. The fence and the lock are separate mechanisms."), "field-notes", null, SHA_A, "2026-08-21 02:27:30"],
      "W-01-graph-write-coordinator.md": [AXIOM_SURVEY_W01, "subsystem-survey", "W-01", SHA_A, "2026-09-26 01:48:44"],
      "S-01-storage-substrate.md": [AXIOM_SURVEY_S01, "subsystem-survey", "S-01", SHA_A, "2026-08-21 03:30:48"],
      "Q-01-query-front-end.md": [AXIOM_SURVEY_Q01, "subsystem-survey", "Q-01", SHA_A, "2026-08-21 03:34:22"],
    },
    seed(db) {
      db.prepare("INSERT INTO git_state (canonical_branch, onboarding_sha, last_checked_sha) VALUES ('main', ?, ?)").run(SHA_A, SHA_B);
      session(db, "onboard-1", "onboarding", "2026-08-20 10:00:00");
      session(db, "survey-1", "survey W-01", "2026-08-21 03:00:00");
      subsystem(db, "S-01", "Storage substrate", "mapped");
      subsystem(db, "W-01", "Graph write coordinator", "mapped");
      subsystem(db, "Q-01", "Query front end", "structural");
      ledger(db, "S-01", "crates/quad-core/src/index/perm.rs");
      ledger(db, "W-01", "crates/quad-core/src/write/coordinator.rs");
      ledger(db, "Q-01", "crates/quad-core/src/query/parse.rs");
      const e1 = evidence(db, "crates/quad-core/src/write/coordinator.rs", "1170-1380", "survey-1");
      const e2 = evidence(db, "crates/quad-core/src/index/perm.rs", "12-40", "survey-1");
      explanation(db, "project", "project", "account", "The store keeps quads in five orders and one write path per graph.", "survey-1", "2026-09-01 00:00:00", [e1, e2]);
      explanation(db, "subsystem", "W-01", "purpose", "W-01 serializes writes to one graph and holds them back while a rebuild runs.", "survey-1", "2026-09-01 00:00:01", [e1]);
      explanation(db, "subsystem", "W-01", "account", "A write takes the graph lock, waits on the fence, and commits through the write core.", "survey-1", "2026-09-01 00:00:02", [e1]);
      explanation(db, "subsystem", "S-01", "purpose", "S-01 stores each quad under five key orders.", "survey-1", "2026-09-01 00:00:03", [e2]);
      db.prepare(
        "INSERT INTO seams (id, shared_object, shared_object_kind, party_a, party_b, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '2026-08-22 00:00:00', '2026-08-22 00:00:00')",
      ).run("SM-01", "index permutations", "table", "W-01", "S-01");
      db.prepare(
        "INSERT INTO seams (id, shared_object, shared_object_kind, party_a, party_b, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '2026-08-22 00:00:00', '2026-08-22 00:00:00')",
      ).run("SM-02", "snapshot generation", "shared-memory", "W-01", "Q-01");
      concern(db, "CC-1", "concurrency");
      concern(db, "CC-2", "data-integrity");
      db.prepare(
        "INSERT INTO dispositions (subsystem_id, concern_code, classification, evidence_quality, rationale, assessed_at, ref_sha, session_id, pass_type) VALUES ('W-01', 'CC-1', 'confirmed-acceptable', 'code-verified', 'The lock is held across the commit.', '2026-08-23 00:00:00', ?, 'survey-1', 'survey')",
      ).run(SHA_A);
      note(db, "pattern", "The fence and the lock are separate mechanisms.", "W-01", "survey-1");
      note(db, "connection", "W-01 and S-01 share the permutation layout.", "S-01", "survey-1");
    },
  },
  "self-shaped": {
    files: {
      "onboarding-report.md": [SELF_ONBOARDING, "onboarding-report", null, SHA_B, "2026-09-12 10:00:00"],
      "entry-point.md": [SELF_ENTRY, "entry-point", null, SHA_B, "2026-09-12 10:00:01"],
      "master-plan.md": [simple("Master plan", "| ID | Name |\n|---|---|\n| B-01 | Survey method |"), "master-plan", null, SHA_B, "2026-09-12 10:00:02"],
      "findings-index.md": [simple("Findings index", "No open finding."), "findings-index", null, SHA_B, "2026-09-12 10:00:03"],
      "concern-checklist.md": [simple("Concern checklist", "| Code | Territory |\n|---|---|\n| CC-1 | T01 |"), "concern-checklist", null, SHA_B, "2026-09-12 10:00:04"],
      "field-notes.md": [simple("Field notes", "1. The schema is applied on every open."), "field-notes", null, SHA_B, "2026-09-12 10:00:05"],
      "subsystems/B-01-structural.md": [SELF_SURVEY_B01, "subsystem-survey", "B-01", SHA_B, "2026-09-13 10:00:00"],
      "subsystems/B-02-structural.md": [SELF_SURVEY_B02, "subsystem-survey", "B-02", SHA_B, "2026-09-13 10:00:01"],
    },
    seed(db) {
      db.prepare("INSERT INTO git_state (canonical_branch, onboarding_sha, last_checked_sha) VALUES ('main', ?, ?)").run(SHA_B, SHA_B);
      session(db, "onboard-1", "onboarding", "2026-09-12 09:00:00");
      session(db, "survey-1", "survey B-01", "2026-09-13 09:00:00");
      subsystem(db, "B-01", "Survey method", "structural");
      subsystem(db, "B-02", "Record store", "structural");
      subsystem(db, "B-03", "Page materializer", "scoping");
      ledger(db, "B-01", ".claude/skills/amanuensis/SKILL.md");
      ledger(db, "B-02", "mcp-server/src/db.ts");
      const e1 = evidence(db, "mcp-server/src/db.ts", "67-80", "survey-1");
      const e2 = evidence(db, ".claude/skills/amanuensis/SKILL.md", "1-40", "survey-1");
      explanation(db, "project", "project", "account", "The server records a survey; the materializer publishes it.", "survey-1", "2026-09-14 00:00:00", [e1]);
      explanation(db, "project", "project", "account", "The server records a survey in one database; the materializer publishes pages from it.", "survey-1", "2026-09-15 00:00:00", [e1, e2]);
      explanation(db, "subsystem", "B-02", "purpose", "B-02 holds every record the survey writes.", "survey-1", "2026-09-14 00:00:01", [e1]);
      explanation(db, "subsystem", "B-02", "account", "Opening a store migrates it and applies the schema.", "survey-1", "2026-09-14 00:00:02", [e1]);
      explanation(db, "subsystem", "B-01", "purpose", "B-01 tells the agent what to read and what to record.", "survey-1", "2026-09-14 00:00:03", [e2]);
      claim(db, "B-02/flow/open-store/00", "openDatabase is called with a path.", e1);
      claim(db, "B-02/flow/open-store/01", "runMigrations runs before the schema is applied.", e1);
      claim(db, "B-02/key-type/db", "DB is the better-sqlite3 database type.", e1);
      concern(db, "CC-1", "data-integrity");
      note(db, "pattern", "The schema is applied on every open.", "B-02", "survey-1");
    },
  },
};

function session(db, id, intent, at) {
  db.prepare("INSERT INTO sessions (session_id, intent, started_at, ended_at, outcome) VALUES (?, ?, ?, ?, 'completed')").run(id, intent, at, at);
}
function subsystem(db, id, name, status) {
  db.prepare("INSERT INTO subsystems (id, name, status, created_at, updated_at) VALUES (?, ?, ?, '2026-08-20 11:00:00', '2026-08-20 11:00:00')").run(id, name, status);
}
function ledger(db, subsystemId, path) {
  db.prepare("INSERT INTO file_ledger (subsystem_id, file_path, classification, ref_sha, examined_at) VALUES (?, ?, 'examined', ?, '2026-08-21 00:00:00')").run(subsystemId, path, SHA_A);
}
function evidence(db, path, lines, sessionId) {
  return Number(
    db
      .prepare("INSERT INTO evidence (file_path, line_range, ref_sha, kind, session_id, collected_at) VALUES (?, ?, ?, 'code-verified', ?, '2026-08-21 00:00:00')")
      .run(path, lines, SHA_A, sessionId).lastInsertRowid,
  );
}
function explanation(db, type, id, slot, body, sessionId, at, evidenceIds) {
  const row = Number(
    db
      .prepare("INSERT INTO explanations (subject_type, subject_id, slot, disposition, body, ref_sha, session_id, recorded_at) VALUES (?, ?, ?, 'recorded', ?, ?, ?, ?)")
      .run(type, id, slot, body, SHA_A, sessionId, at).lastInsertRowid,
  );
  for (const evidenceId of evidenceIds) {
    db.prepare("INSERT INTO explanation_evidence (explanation_id, evidence_id) VALUES (?, ?)").run(row, evidenceId);
  }
}
function claim(db, key, statement, evidenceId) {
  db.prepare(
    "INSERT INTO claims (claim_id, claim_key, subject_type, subject_id, statement, epistemic_kind, asserted_at_sha, valid_from_sha, session_id, created_at) VALUES (?, ?, 'file', 'mcp-server/src/db.ts', ?, 'observation', ?, ?, 'survey-1', '2026-09-13 12:00:00')",
  ).run(key, key, statement, SHA_B, SHA_B);
  db.prepare("INSERT INTO claim_evidence (claim_id, evidence_id, role) VALUES (?, ?, 'supports')").run(key, evidenceId);
}
function concern(db, code, category) {
  db.prepare("INSERT INTO concerns (code, category, origin, discovered_at) VALUES (?, ?, 'seeded', '2026-08-20 12:00:00')").run(code, category);
}
function note(db, category, observation, location, sessionId) {
  db.prepare("INSERT INTO field_notes (category, observation, location, ref_sha, session_id, created_at) VALUES (?, ?, ?, ?, ?, '2026-08-21 00:00:00')").run(category, observation, location, SHA_A, sessionId);
}

// ------------------------------------------------------------ the build

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out.sort();
}

function build(openDatabase, scratch, name, spec) {
  const target = join(scratch, name);
  const storage = join(target, "storage");
  mkdirSync(storage, { recursive: true });
  const dbPath = join(scratch, `${name}.db`);
  const db = openDatabase(dbPath);
  try {
    db.transaction(() => {
      spec.seed(db);
      for (const [path, [text, kind, subsystemId, refSha, writtenAt, registered]] of Object.entries(spec.files)) {
        const file = join(storage, path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, text);
        const asRegistered = registered ?? text;
        db.prepare(
          "INSERT INTO artifacts (path, kind, subsystem_id, content_hash, ref_sha, session_id, written_at, bytes) VALUES (?, ?, ?, ?, ?, 'survey-1', ?, ?)",
        ).run(path, kind, subsystemId, sha256(asRegistered), refSha, writtenAt, Buffer.byteLength(asRegistered));
      }
    })();
  } finally {
    db.close();
  }
  const dump = spawnSync("sqlite3", [dbPath, ".dump"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (dump.status !== 0) throw new Error(`sqlite3 .dump failed: ${dump.stderr}`);
  // The minted identity is random; a fixed one keeps a rebuild byte-identical.
  const text = dump.stdout.replace(
    /^INSERT INTO store_identity VALUES\(1,'[0-9a-f]{32}','[^']*'\);$/m,
    `INSERT INTO store_identity VALUES(1,'${sha256(name).slice(0, 32)}','2026-11-20 00:00:00');`,
  );
  writeFileSync(join(target, "memory.sql"), text);
  return target;
}

const base = buildBaseTreeServer(BASE_SHA);
if (!base.ok) {
  console.error(`cannot build the base tree's server: ${base.reason}`);
  process.exit(1);
}
const scratch = mkdtempSync(join(tmpdir(), "amanuensis-legacy-stores-"));
let differs = 0;
try {
  const { openDatabase } = await import(pathToFileURL(join(base.root, "dist", "db.js")).href);
  for (const [name, spec] of Object.entries(FIXTURES)) {
    const built = build(openDatabase, scratch, name, spec);
    const committed = join(OUT, name);
    if (check) {
      const a = listFiles(built).map((f) => relative(built, f));
      const b = listFiles(committed).map((f) => relative(committed, f));
      const same =
        JSON.stringify(a) === JSON.stringify(b) &&
        a.every((f) => readFileSync(join(built, f)).equals(readFileSync(join(committed, f))));
      if (!same) {
        differs++;
        console.error(`${name}: the committed fixture differs from a rebuild`);
      }
      continue;
    }
    rmSync(committed, { recursive: true, force: true });
    for (const file of listFiles(built)) {
      const dest = join(committed, relative(built, file));
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(file));
    }
    console.log(`wrote fixtures/legacy-stores/${name} (${listFiles(committed).length} files)`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
  base.cleanup();
}
if (check) {
  if (differs) process.exit(1);
  console.log("OK — both legacy fixtures match a rebuild.");
}
