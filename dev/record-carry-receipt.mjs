#!/usr/bin/env node
// `design/survey-depth/carry-receipt.json` — the record of what the acceptance
// rebuild's carry step (spec.md §5.8, §7.4 step 5) carried out of the archived
// clean-slate store and into the store that replaced it.
//
// Why the document exists. P10's survey has to decide every carried finding,
// and the fraction it reports is only a fraction if its denominator was written
// somewhere the survey does not also write. `dev/test-rebuild-depth.mjs:19-24`
// states the property: "Every denominator this gate counts against is read from
// a *different* committed document than the one under test … A numerator and
// its denominator that shrink together prove nothing (GP24)." So the 22 ids and
// their archived resolution states are committed here, by this packet, and P11
// records the acceptance receipts without rewriting this file.
//
//   node dev/record-carry-receipt.mjs            write the receipt
//   node dev/record-carry-receipt.mjs --print    print it, write nothing
//   node dev/record-carry-receipt.mjs --check    exit 1 if it would change
//
// **`--check` has three answers, not two**, for the reason
// `dev/record-survey-depth-baseline.mjs` does: the archive is a machine-local
// absolute path outside the repository and the live store is untracked, so on
// CI or another machine there is nothing to compare the committed file against.
// That is exit 2 `cannot run`, never exit 0. A check that silently passed where
// it could not read its sources would certify a file nothing had been compared
// against — the zero-denominator green this repository has recorded three
// times (B03-2, B04-1, B04-3).
//
// The read-back is a *third process*, which §7.4 step 6 asks for: the carry's
// own server exited before this one started, so the count below is read out of
// the database rather than out of the handle that wrote it. It comes through
// `list_carried_findings`, paged, with each response's envelope measured the
// way the tool measures it — the text block plus the `structuredContent` that
// repeats it — so "within the envelope budget" is a number here and not a hope.
//
// `AMANUENSIS_CARRY_ARCHIVE` overrides the archive path, as it does for the
// baseline recorder and for `dev/test-carry-receipt.mjs`. Pointing it at
// another store changes the derived `archived_store_id`, which `GATE CR1`
// rejects.

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RECEIPT_REL = "design/survey-depth/carry-receipt.json";
const RECEIPT_PATH = join(REPO, RECEIPT_REL);
const STORE_PATH = join(REPO, ".amanuensis", "memory.db");
const SERVER = join(REPO, "mcp-server", "dist", "index.js");

const CONTRACT = "amanuensis-survey-depth/carry-receipt/v1";
const PACKET = "P8";
const WIRE_BUDGET = 8192;
const PAGE_LIMIT = 10;

const DEFAULT_ARCHIVE = join(
  process.env.HOME ?? "",
  ".claude/automations/amanuensis-clean-slate/archive/store-7c1c1a9/memory.db",
);
const ARCHIVE_PATH = resolve(process.env.AMANUENSIS_CARRY_ARCHIVE || DEFAULT_ARCHIVE);
// Folded back to `~` in the committed document: the absolute form names
// whoever ran it.
const ARCHIVE_DISPLAY = process.env.HOME
  ? ARCHIVE_PATH.replace(
      new RegExp(`^${process.env.HOME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
      "~",
    )
  : ARCHIVE_PATH;

const checkOnly = process.argv.includes("--check");
const printOnly = process.argv.includes("--print");

function cannotRun(reason) {
  process.stderr.write(`cannot run: ${reason}\n`);
  process.exit(2);
}

// node:sqlite is experimental and warns on import; this tool's stderr carries
// its reasons and a runtime warning in the middle of them is noise.
process.removeAllListeners("warning");
process.on("warning", () => {});

let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  cannotRun(`this runtime (${process.version}) carries no node:sqlite, so no store can be read`);
}

// ---------------------------------------------------------------------------
// The archive: the denominator, read immutably
// ---------------------------------------------------------------------------
if (!existsSync(ARCHIVE_PATH)) {
  cannotRun(`the archived store is not readable at ${ARCHIVE_PATH}`);
}
/** A SQLite URI: '?' and '#' end the path, so they are what must be escaped. */
const archiveUri = `file:${encodeURI(ARCHIVE_PATH).replace(/\?/g, "%3f").replace(/#/g, "%23")}?immutable=1`;
let archiveDb;
try {
  archiveDb = new DatabaseSync(archiveUri, { readOnly: true });
} catch (error) {
  cannotRun(
    `the archived store at ${ARCHIVE_PATH} could not be opened immutably (${error?.code ?? error?.message ?? error})`,
  );
}

const gitState = archiveDb
  .prepare(
    "SELECT repo_id, canonical_branch, onboarding_sha, last_checked_sha FROM git_state ORDER BY repo_id LIMIT 1",
  )
  .get();
if (!gitState) cannotRun("the archived store carries no git_state row, so it names no identity");

// §5.3's legacy identity, restated here rather than imported from the built
// server so this tool runs on a bare checkout. Where the build is present the
// two are compared below and a disagreement is a refusal.
let mintedGeneration = null;
try {
  mintedGeneration =
    archiveDb.prepare("SELECT store_generation FROM store_identity WHERE id = 1").get()
      ?.store_generation ?? null;
} catch {
  mintedGeneration = null; // frozen before store_identity existed: the legacy case
}
const identityTuple = [
  gitState.repo_id ?? "",
  gitState.canonical_branch ?? "",
  gitState.onboarding_sha ?? "",
  gitState.last_checked_sha ?? "",
].join("|");
const archivedStoreId = mintedGeneration
  ? `store-${String(mintedGeneration).slice(0, 16)}`
  : `store-legacy-${createHash("sha256").update(identityTuple).digest("hex").slice(0, 16)}`;

try {
  const { archivedStoreId: fromServer } = await import(
    join(REPO, "mcp-server", "dist", "invariants.js")
  );
  const theirs = fromServer(ARCHIVE_PATH, { immutable: true });
  if (theirs !== archivedStoreId) {
    cannotRun(
      `this tool derives ${archivedStoreId} for the archive and the built server derives ` +
        `${theirs}; a receipt written under one identity and carried under another names two ` +
        `stores, which is what §5.3 exists to prevent`,
    );
  }
} catch (error) {
  // A bare checkout with nothing built still records the receipt; it just does
  // so without the second opinion. Only a *disagreement* refuses.
  if (String(error?.message ?? "").includes("derives")) throw error;
}

// `resolution_state` derived exactly as `finding_state_current` derives it
// (`mcp-server/src/schema.sql:1208-1218`): this archive was frozen before that
// view existed, and it is immutable, so it cannot be given one.
const archivedFindings = archiveDb
  .prepare(
    `SELECT f.finding_id, f.subsystem_id, f.severity,
            COALESCE(r.resolution_state,
                     CASE f.status WHEN 'fixed'                THEN 'fixed-pending-verification'
                                   WHEN 'ruled-out'            THEN 'ruled-out'
                                   WHEN 'confirmed-acceptable' THEN 'accepted'
                                   ELSE 'open' END)            AS resolution_state
       FROM findings f
       LEFT JOIN finding_resolution_current r ON r.finding_id = f.finding_id
      ORDER BY f.finding_id`,
  )
  .all();
archiveDb.close();
if (archivedFindings.length === 0) {
  cannotRun(`the archived store at ${ARCHIVE_PATH} holds no findings, so there is no denominator`);
}

// ---------------------------------------------------------------------------
// The read-back: a third process, through the tool §5.2a specifies
// ---------------------------------------------------------------------------
if (!existsSync(STORE_PATH)) {
  cannotRun(
    `no live store at ${STORE_PATH}; the carry receipt records what a carry wrote, and no carry ` +
      `has been run in this workspace`,
  );
}
if (!existsSync(SERVER)) {
  cannotRun(`the built server is absent at ${SERVER}; run npm run build in mcp-server first`);
}

function client() {
  const child = spawn(process.execPath, [SERVER, "--workspace", REPO, "--allow-workspace-pin"], {
    cwd: REPO,
    env: { ...process.env, AMANUENSIS_AUTOPROGRESS: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  let stderr = "";
  let nextId = 1;
  const pending = new Map();
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        const message = JSON.parse(line);
        const waiter = pending.get(message.id);
        if (waiter) {
          pending.delete(message.id);
          if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
          else waiter.resolve(message.result);
        }
      }
      newline = buffer.indexOf("\n");
    }
  });
  const request = (method, params = {}) => {
    const id = nextId++;
    const response = new Promise((res, rej) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rej(new Error(`timed out waiting for ${method}; stderr=${stderr.slice(-400)}`));
      }, 60_000);
      pending.set(id, {
        resolve(value) {
          clearTimeout(timer);
          res(value);
        },
        reject(error) {
          clearTimeout(timer);
          rej(error);
        },
      });
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return response;
  };
  return {
    pid: child.pid,
    async handshake() {
      await request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "carry-receipt-recorder", version: "1" },
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    },
    async call(name, args = {}) {
      const result = await request("tools/call", { name, arguments: args });
      let payload = null;
      try {
        payload = JSON.parse(result.content?.[0]?.text ?? "null");
      } catch {
        payload = null;
      }
      if (result.isError === true) {
        throw new Error(`${name} refused: ${payload?.error ?? "no reason given"}`);
      }
      return payload;
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      await new Promise((res) => child.once("exit", res));
    },
  };
}

/**
 * The bytes a response costs the host, measured the way `list_carried_findings`
 * measures them (`src/tools/carried.ts:103-108`): the text block plus the
 * `structuredContent` that repeats it. Measuring it any other way would record
 * a number the tool's own budget does not mean.
 */
function envelopeBytes(payload) {
  return (
    Buffer.byteLength(JSON.stringify(payload, null, 2), "utf8") +
    Buffer.byteLength(JSON.stringify(payload), "utf8")
  );
}

const reader = client();
await reader.handshake();
const projectInfo = await reader.call("get_project_info");
const dashboard = await reader.call("get_dashboard");
const pages = [];
const listed = [];
let cursor = null;
for (let guard = 0; guard < 200; guard++) {
  const page = await reader.call("list_carried_findings", {
    limit: PAGE_LIMIT,
    ...(cursor ? { cursor } : {}),
  });
  const bytes = envelopeBytes(page);
  pages.push({ returned: page.count, envelope_bytes: bytes, next_cursor: page.next_cursor ?? null });
  for (const row of page.carried ?? []) listed.push(row);
  cursor = page.next_cursor ?? null;
  if (!cursor) break;
}
await reader.stop();

const overBudget = pages.filter((page) => page.envelope_bytes > WIRE_BUDGET);

// ---------------------------------------------------------------------------
// The run the carry opened, read back out of the store
// ---------------------------------------------------------------------------
let liveDb;
try {
  liveDb = new DatabaseSync(STORE_PATH, { readOnly: true });
} catch (error) {
  cannotRun(`the live store could not be opened read-only (${error?.message ?? error})`);
}
const runs = liveDb
  .prepare(
    `SELECT id, source_kind, source_path, archived_store_id, archived_anchor, reason,
            expected_count, imported_count, ran_at
       FROM carry_runs WHERE archived_store_id = ? ORDER BY id DESC`,
  )
  .all(archivedStoreId);
liveDb.close();
if (runs.length === 0) {
  cannotRun(
    `no carry_runs row in the live store names ${archivedStoreId}; nothing here carried this archive`,
  );
}
if (runs.length > 1) {
  cannotRun(
    `${runs.length} carry_runs rows name ${archivedStoreId}; the receipt records one carry, and ` +
      `choosing between two would let one run's counts answer for another's rows`,
  );
}
const run = runs[0];

// ---------------------------------------------------------------------------
// The receipt
// ---------------------------------------------------------------------------
// §5.4: a finding the archive had already closed is pre-recorded
// `archived-terminal` by the carry and by nothing else. That is a carry-time
// fact and it is immutable, so it belongs in this document. Every *other*
// outcome is P10's to record, and recording a null for it here would make this
// file go stale the moment the survey decided one — which is exactly what a
// denominator must not do.
const ARCHIVED_CLOSED = new Set(["accepted", "ruled-out", "verified-fixed"]);
const carriedByArchivedId = new Map(listed.map((row) => [row.archived_finding_id, row]));
const disagreed = [];
const records = archivedFindings.map((finding) => {
  const row = carriedByArchivedId.get(finding.finding_id);
  const closed = ARCHIVED_CLOSED.has(finding.resolution_state);
  if (row && closed && row.outcome !== "archived-terminal") {
    disagreed.push(`${finding.finding_id} is ${finding.resolution_state} in the archive and the carried row reads ${row.outcome}`);
  }
  return {
    archived_finding_id: finding.finding_id,
    archived_resolution: finding.resolution_state,
    archived_subsystem_id: finding.subsystem_id,
    archived_severity: finding.severity,
    carried_id: row?.carried_id ?? null,
    ...(closed ? { pre_recorded_outcome: "archived-terminal" } : {}),
  };
});

const receipt = {
  contract: CONTRACT,
  packet: PACKET,
  recorded_by: "dev/record-carry-receipt.mjs",
  note:
    "The stable core of this document — contract, archive, carry_run, count, records — is what " +
    "`--check` compares and what GATE CR1 reads. `read_back` measures the run that wrote the " +
    "file and moves as later packets record outcomes, so it is deliberately outside both.",
  archive: {
    path: ARCHIVE_DISPLAY,
    opened: "file:<path>?immutable=1",
    archived_store_id: archivedStoreId,
    archived_store_id_form: mintedGeneration ? "minted" : "legacy (§5.3)",
    archived_anchor: gitState.last_checked_sha ?? gitState.onboarding_sha ?? "",
    finding_count: archivedFindings.length,
    note:
      "Read from the archived store, not from old-findings-7c1c1a9.json: the export carries no " +
      "store identity, and §5.3's identity is the only field that separates one archive from " +
      "another.",
  },
  carry_run: {
    carry_run_id: run.id,
    source_kind: run.source_kind,
    source_path: run.source_path,
    archived_store_id: run.archived_store_id,
    archived_anchor: run.archived_anchor,
    reason: run.reason,
    expected_count: run.expected_count,
    imported_count: run.imported_count,
    ran_at: run.ran_at,
  },
  count: records.length,
  read_back: {
    tool: "list_carried_findings",
    process: "a third process: the carry's server exited before this one opened the store",
    project_key: projectInfo.project_key,
    db_exists: projectInfo.db_exists === true,
    subsystems_at_read_back: dashboard.subsystem_count ?? null,
    page_limit: PAGE_LIMIT,
    pages,
    listed: listed.length,
    wire_budget_bytes: WIRE_BUDGET,
    largest_envelope_bytes: pages.reduce((max, page) => Math.max(max, page.envelope_bytes), 0),
    within_budget: overBudget.length === 0,
  },
  records,
};

// ---------------------------------------------------------------------------
const rendered = `${JSON.stringify(receipt, null, 2)}\n`;

if (overBudget.length > 0) {
  process.stderr.write(
    `refusing to record: ${overBudget.length} page(s) of list_carried_findings exceeded the ` +
      `${WIRE_BUDGET}-byte envelope budget (largest ${receipt.read_back.largest_envelope_bytes}). ` +
      `The read-back §7.4 step 6 asks for is one a reader can actually make.\n`,
  );
  process.exit(1);
}
if (disagreed.length > 0) {
  process.stderr.write(
    `refusing to record: ${disagreed.join("; ")}. §5.4 reserves 'archived-terminal' to the carry ` +
      `and to findings the archive had already closed; a receipt that recorded a different ` +
      `outcome there would be describing a store nobody wrote.\n`,
  );
  process.exit(1);
}
const missing = records.filter((record) => record.carried_id === null);
if (missing.length > 0) {
  process.stderr.write(
    `refusing to record: the read-back returned no carried record for ` +
      `${missing.map((record) => record.archived_finding_id).join(", ")}. A receipt that recorded ` +
      `null there would be a denominator with holes in it.\n`,
  );
  process.exit(1);
}

if (printOnly) {
  process.stdout.write(rendered);
  process.exit(0);
}

/** The fields a later packet must not be able to move (see the note above). */
function stableCore(document) {
  return {
    contract: document.contract,
    archive: document.archive,
    carry_run: document.carry_run,
    count: document.count,
    records: document.records,
  };
}

if (checkOnly) {
  if (!existsSync(RECEIPT_PATH)) {
    process.stderr.write(`${RECEIPT_REL} is not in the tree; run this tool without --check\n`);
    process.exit(1);
  }
  let committed;
  try {
    committed = JSON.parse(readFileSync(RECEIPT_PATH, "utf8"));
  } catch (error) {
    process.stderr.write(`${RECEIPT_REL} is not parseable JSON (${error?.message ?? error})\n`);
    process.exit(1);
  }
  const a = `${JSON.stringify(stableCore(committed), null, 2)}\n`.split("\n");
  const b = `${JSON.stringify(stableCore(receipt), null, 2)}\n`.split("\n");
  const differences = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      differences.push(
        `  line ${i + 1}: committed ${JSON.stringify(a[i] ?? null)} / measured ${JSON.stringify(b[i] ?? null)}`,
      );
    }
  }
  if (differences.length === 0) {
    process.stdout.write(
      `${RECEIPT_REL}: ${records.length} record(s) from ${archivedStoreId} — still what the ` +
        `archive and the carry run say\n`,
    );
    process.exit(0);
  }
  process.stderr.write(`${RECEIPT_REL} would change:\n${differences.slice(0, 40).join("\n")}\n`);
  process.exit(1);
}

writeFileSync(RECEIPT_PATH, rendered);
process.stdout.write(
  `${RECEIPT_REL}: ${records.length} carried record(s) from ${archivedStoreId}, ` +
    `carry run ${run.id} (${run.expected_count} expected, ${run.imported_count} imported), ` +
    `read back in ${pages.length} page(s), largest envelope ${receipt.read_back.largest_envelope_bytes} of ${WIRE_BUDGET} bytes\n`,
);
