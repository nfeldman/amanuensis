#!/usr/bin/env node
// A4 integration: MCP publication gate records read-back mismatch custody.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./dist/db.js";
import { materializeTools } from "./dist/tools/materialize.js";

function assert(value, message) {
  if (!value) throw new Error(message);
}

const root = mkdtempSync(join(tmpdir(), "amanuensis-projection-custody-"));
const workspace = join(root, "workspace");
const storage = join(root, "storage");
mkdirSync(workspace);
mkdirSync(storage);
execFileSync("git", ["init", "-q"], { cwd: workspace });
writeFileSync(join(workspace, "fixture.ts"), "export const fixture = true;\n");
execFileSync("git", ["add", "fixture.ts"], { cwd: workspace });
execFileSync(
  "git",
  [
    "-c",
    "commit.gpgsign=false",
    "-c",
    "user.name=amanuensis-test",
    "-c",
    "user.email=test@localhost",
    "commit",
    "--quiet",
    "--no-verify",
    "-m",
    "fixture",
  ],
  { cwd: workspace },
);
const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspace, encoding: "utf8" }).trim();
const project = {
  workspacePath: workspace,
  projectKey: "test/projection-custody",
  storagePath: storage,
  dbPath: join(storage, "memory.db"),
  storageGitReady: false,
};
const db = openDatabase(project.dbPath);
const ctx = { project, db, sessionId: "projection-session" };
const tools = new Map(materializeTools.map((tool) => [tool.name, tool]));
const call = (name, args = {}) => tools.get(name).handler(args, ctx);

try {
  db.prepare("INSERT INTO sessions (session_id, intent) VALUES (?, 'projection-custody')").run(
    ctx.sessionId,
  );
  db.prepare(
    "INSERT INTO subsystems (id, name, status) VALUES ('B-01', 'Projection', 'concerns')",
  ).run();
  db.prepare(
    `INSERT INTO findings
       (finding_id, subsystem_id, symptom, root_cause, severity, status,
        ref_sha, session_id, pass_type)
     VALUES ('B01-1', 'B-01', 'projection drift', 'missing custody', 'HIGH',
             'confirmed-bug', ?, ?, 'survey')`,
  ).run(sha, ctx.sessionId);
  db.prepare(
    `INSERT INTO finding_resolution_events
       (finding_id, resolution_state, rationale, session_id)
     VALUES ('B01-1', 'open', 'fixture', ?)`,
  ).run(ctx.sessionId);
  db.prepare(
    `INSERT INTO entries
       (id, tier, subsystem_id, source_path, content_hash, ref_sha, confidence,
        stale, stale_since, stale_reason)
     VALUES ('B-01-overview', 1, 'B-01', 'fixture.ts', 'hash', ?, 'verified',
             1, datetime('now'), 'fixture')`,
  ).run(sha);

  const published = call("materialize_docs", { clean_publish: true });
  assert(published.ok && published.published, JSON.stringify(published));
  assert(published.readback.ok, JSON.stringify(published));
  assert(typeof published.projection_run_id === "string", JSON.stringify(published));

  const beforeTruth = db
    .prepare(
      `SELECT
       (SELECT COUNT(*) FROM findings) AS findings,
       (SELECT COUNT(*) FROM finding_resolution_events) AS resolutions,
       (SELECT COUNT(*) FROM entries WHERE stale=1) AS stale`,
    )
    .get();
  const findingsPath = join(storage, "docs", "findings.md");
  const body = readFileSync(findingsPath, "utf8");
  const corrupt = body.replace(/<!-- amanuensis:finding:[a-f0-9]+ -->\n/, "");
  assert(corrupt !== body, "fixture did not contain a finding marker");
  writeFileSync(findingsPath, corrupt);

  const rejected = call("verify_materialized_docs");
  assert(rejected.ok === false && rejected.exit_status === 1, JSON.stringify(rejected));
  assert(rejected.published === false, JSON.stringify(rejected));
  assert(
    rejected.mismatches.some((m) => m.axis === "state" && m.object_type === "finding"),
    JSON.stringify(rejected),
  );
  const afterTruth = db
    .prepare(
      `SELECT
       (SELECT COUNT(*) FROM findings) AS findings,
       (SELECT COUNT(*) FROM finding_resolution_events) AS resolutions,
       (SELECT COUNT(*) FROM entries WHERE stale=1) AS stale`,
    )
    .get();
  assert(
    JSON.stringify(afterTruth) === JSON.stringify(beforeTruth),
    "read-back mutated durable truth",
  );
  const recorded = db
    .prepare(
      `SELECT r.ok, r.state_ok, COUNT(m.id) AS mismatches
       FROM projection_verification_runs r
       LEFT JOIN projection_mismatches m ON m.run_id=r.run_id
      WHERE r.run_id=? GROUP BY r.run_id`,
    )
    .get(rejected.projection_run_id);
  assert(
    recorded.ok === 0 && recorded.state_ok === 0 && recorded.mismatches >= 1,
    JSON.stringify(recorded),
  );

  const repaired = call("materialize_docs", { clean_publish: true });
  assert(repaired.ok && repaired.published && repaired.readback.ok, JSON.stringify(repaired));
  console.log(
    "OK — red projection halts, records mismatch custody, and repairs from durable truth",
  );
} finally {
  db.close();
  rmSync(root, { recursive: true, force: true });
}
