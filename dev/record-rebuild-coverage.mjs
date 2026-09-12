#!/usr/bin/env node
// Write `design/reader-lenses/rebuild-coverage-receipt.json` from the live
// self-conspectus store (reader-lenses P17, spec.md §12.1 step 6).
//
// The store is untracked, so the coverage the rebuild achieved cannot be
// asserted over in CI or in the launcher's verification worktree. This reads it
// once, read-only, and writes down what it found; `dev/test-rebuild-coverage.mjs`
// then re-derives every property from the receipt rather than trusting a
// summary, and re-checks the live store too wherever one is present.
//
// It derives, and does not accept, everything it can: batches come from the
// storage repository's own checkpoint commits, claims and their evidence from
// the tables, and the citation tokens from each edge's stored context. Nothing
// here is typed in twice.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STORAGE = join(REPO, ".amanuensis");
const DB_PATH = join(STORAGE, "memory.db");
const OUT_REL = "design/reader-lenses/rebuild-coverage-receipt.json";

const CONTRACT = "amanuensis-reader-lenses/rebuild-coverage-receipt/v1";
const CITATION_TOKEN = /^[^\s:]+(?:\/[^\s:]+)*:[^\s@]+@[0-9a-fA-F]{7,40}$/;
// The storage checkpoint labels this rebuild writes. Batch membership is read
// off the commit that made it recoverable, so a batch cannot be recorded here
// without one.
const BATCH_LABEL = /^Rebuild batch (\d+) · (.*)$/;
const SUBSYSTEM_ID = /\bB-\d{2}\b/g;

const FIXTURES = [
  "dev/conspectus/self-baseline.json",
  "dev/conspectus/baseline-report.json",
  "dev/conspectus/baseline-report-detector-1.0.0.json",
  "dev/conspectus/detector-registry.json",
];

function git(args, cwd = REPO) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${result.stderr?.trim() ?? ""}`);
  }
  return String(result.stdout ?? "").trim();
}

function sha256(absPath) {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

if (!existsSync(DB_PATH)) {
  process.stderr.write(`no store at ${DB_PATH}: the rebuild has not run in this worktree\n`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
const all = (sql, ...params) => db.prepare(sql).all(...params);
const one = (sql, ...params) => db.prepare(sql).get(...params) ?? null;

const head = git(["rev-parse", "HEAD"]);
const gitState = one("SELECT * FROM git_state WHERE repo_id = 'default'");
const onboardingSession = one(
  "SELECT session_id, intent, started_at FROM sessions WHERE intent LIKE 'onboarding%' ORDER BY started_at LIMIT 1",
);

const subsystemRows = all(
  "SELECT id, name, status, layer, priority, notes FROM subsystems ORDER BY priority, id",
);
const artifactRows = all("SELECT path, kind, subsystem_id, content_hash, bytes, ref_sha FROM artifacts");
const claimRows = all(
  `SELECT claim_id, claim_key, subject_type, subject_id, statement, epistemic_kind,
          asserted_at_sha, valid_from_sha
     FROM claims WHERE valid_until_sha IS NULL ORDER BY claim_key`,
);
const claimEvidenceRows = all(
  `SELECT ce.claim_id AS claim_id, e.id AS id, e.kind AS kind, e.file_path AS file_path,
          e.symbol AS symbol, e.line_range AS line_range, e.ref_sha AS ref_sha
     FROM claim_evidence ce JOIN evidence e ON e.id = ce.evidence_id
    ORDER BY ce.claim_id, e.id`,
);
const xrefRows = all("SELECT from_id, to_id, relationship, strength, context FROM xrefs ORDER BY from_id, to_id");
const seamRows = all("SELECT id, shared_object, party_a, party_b FROM seams ORDER BY id");
const ledgerRows = all("SELECT subsystem_id, file_path, classification FROM file_ledger");

// --- the storage repository's checkpoints ------------------------------------
const storageHistory = git(["log", "--format=%H%x1f%aI%x1f%s"], STORAGE)
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [sha, date, message] = line.split("\x1f");
    return { sha, date, message };
  });

const batches = [];
for (const entry of [...storageHistory].reverse()) {
  const match = BATCH_LABEL.exec(entry.message);
  if (!match) continue;
  const n = Number(match[1]);
  const named = [...new Set(String(match[2]).match(SUBSYSTEM_ID) ?? [])];
  const batch = {
    n,
    label: entry.message,
    storage_commit: entry.sha,
    committed_at: entry.date,
    subsystems: named,
  };
  // §12.1 makes onboarding the first unit of step 6: it surveys no subsystem and
  // still owes a checkpoint, so it declares itself rather than being inferred
  // from an empty list.
  if (named.length === 0) batch.kind = "onboarding";
  batches.push(batch);
}
batches.sort((a, b) => a.n - b.n);

// --- per-subsystem coverage ---------------------------------------------------
const evidenceByClaim = new Map();
for (const row of claimEvidenceRows) {
  if (!evidenceByClaim.has(row.claim_id)) evidenceByClaim.set(row.claim_id, []);
  evidenceByClaim.get(row.claim_id).push({
    id: row.id,
    kind: row.kind,
    file_path: row.file_path,
    symbol: row.symbol,
    line_range: row.line_range,
    ref_sha: row.ref_sha,
  });
}

const ledgerBySubsystem = new Map();
for (const row of ledgerRows) {
  if (!ledgerBySubsystem.has(row.subsystem_id)) ledgerBySubsystem.set(row.subsystem_id, {});
  const counts = ledgerBySubsystem.get(row.subsystem_id);
  const key = row.classification ?? "unclassified";
  counts[key] = (counts[key] ?? 0) + 1;
}

const touchedByEdges = new Set();
for (const edge of xrefRows) {
  touchedByEdges.add(edge.from_id);
  touchedByEdges.add(edge.to_id);
}

const subsystems = subsystemRows.map((row) => {
  const claims = claimRows
    .filter((claim) => String(claim.claim_key).startsWith(`${row.id}/`))
    .map((claim) => ({
      claim_id: claim.claim_id,
      claim_key: claim.claim_key,
      subject_type: claim.subject_type,
      subject_id: claim.subject_id,
      epistemic_kind: claim.epistemic_kind,
      statement: claim.statement,
      ref_sha: claim.asserted_at_sha,
      evidence: evidenceByClaim.get(claim.claim_id) ?? [],
    }));
  const artifact = artifactRows.find(
    (entry) => entry.subsystem_id === row.id && entry.kind === "subsystem-survey",
  );
  const entry = {
    id: row.id,
    name: row.name,
    status: row.status,
    layer: row.layer,
    priority: row.priority,
    files: ledgerBySubsystem.get(row.id) ?? {},
    claims,
    seams: seamRows
      .filter((seam) => seam.party_a === row.id || seam.party_b === row.id)
      .map((seam) => seam.id),
    artifact: artifact ? { path: artifact.path, content_hash: artifact.content_hash, bytes: artifact.bytes } : null,
  };
  if (row.status === "deferred" || row.status === "unmapped" || row.status === "scoping") {
    entry.deferred_reason = row.notes ?? "";
  }
  if (!touchedByEdges.has(row.id) && row.status !== "deferred") {
    entry.no_crossing_reason = "";
  }
  return entry;
});

// --- edges, with their citation tokens re-extracted ---------------------------
const xrefs = xrefRows.map((edge) => ({
  from_id: edge.from_id,
  to_id: edge.to_id,
  relationship: edge.relationship,
  strength: edge.strength,
  context: edge.context,
  citations: String(edge.context ?? "")
    .split(/\s+/)
    .filter((token) => CITATION_TOKEN.test(token))
    .map((token) => {
      const separator = token.indexOf(":");
      const at = token.lastIndexOf("@");
      return {
        path: token.slice(0, separator),
        symbol: token.slice(separator + 1, at),
        sha: token.slice(at + 1),
      };
    }),
}));

const dashboardCounts = {
  subsystem_count: subsystemRows.length,
  structural_or_beyond: subsystemRows.filter((row) =>
    ["structural", "concerns", "adversarial", "mapped"].includes(row.status),
  ).length,
  deferred: subsystemRows.filter((row) => row.status === "deferred").length,
  scoped_files: ledgerRows.length,
  claims: claimRows.length,
  claim_evidence: claimEvidenceRows.length,
  xrefs: xrefRows.length,
  seams: seamRows.length,
};

const receipt = {
  contract: CONTRACT,
  packet: "P17",
  recorded_at: new Date().toISOString(),
  repository_sha: head,
  workspace_path: REPO,
  storage_path: STORAGE,
  project_key: JSON.parse(readFileSync(join(STORAGE, "initialization.json"), "utf8")).projectKey,
  produced_by: "dev/record-rebuild-coverage.mjs",
  onboarding: {
    session_id: onboardingSession?.session_id ?? null,
    intent: onboardingSession?.intent ?? null,
    onboarding_sha: gitState?.onboarding_sha ?? null,
    canonical_branch: gitState?.canonical_branch ?? null,
    detected_branches: gitState?.detected_branches ? JSON.parse(gitState.detected_branches) : [],
    boundary: {
      scan_root: REPO,
      excluded_paths: [".amanuensis"],
      tracked_files: git(["ls-files"]).split("\n").filter(Boolean).length,
      storage_tracked_files: git(["ls-files", ".amanuensis"]).split("\n").filter(Boolean).length,
    },
    artifacts: artifactRows
      .filter((entry) => entry.kind !== "subsystem-survey")
      .map((entry) => ({
        path: entry.path,
        kind: entry.kind,
        content_hash: entry.content_hash,
        bytes: entry.bytes,
        ref_sha: entry.ref_sha,
      })),
    decomposition: subsystemRows.map((row) => ({
      id: row.id,
      name: row.name,
      layer: row.layer,
      priority: row.priority,
    })),
  },
  batches,
  subsystems,
  xrefs,
  seams: seamRows,
  storage_history: storageHistory,
  census: dashboardCounts,
  fixtures_unchanged: {
    checked: "sha256 of each A0 historical fixture after the rebuild (§12.3)",
    digests: Object.fromEntries(FIXTURES.map((path) => [path, sha256(join(REPO, path))])),
  },
};

db.close();

const outPath = join(REPO, OUT_REL);
writeFileSync(outPath, `${JSON.stringify(receipt, null, 2)}\n`);
process.stdout.write(
  `wrote ${OUT_REL}: ${dashboardCounts.subsystem_count} subsystems ` +
    `(${dashboardCounts.structural_or_beyond} structural, ${dashboardCounts.deferred} deferred), ` +
    `${dashboardCounts.claims} claims over ${dashboardCounts.claim_evidence} evidence rows, ` +
    `${dashboardCounts.xrefs} edges, ${dashboardCounts.seams} seams, ${batches.length} batches\n`,
);
