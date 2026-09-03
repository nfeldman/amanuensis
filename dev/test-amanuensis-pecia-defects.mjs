#!/usr/bin/env node
// Red gates for the Amanuensis → Pecia defect projection.
//
//   node dev/test-amanuensis-pecia-defects.mjs
//
// Builds a disposable git repository with a synthetic conspectus holding one
// finding in every resolution state, runs the projection against a fresh Pecia
// ledger, and requires each control to turn red on its own. The fixture is
// synthetic on purpose: seeding the states directly keeps the gates deterministic
// instead of coupling them to whatever this repository's live findings happen to
// be today.
//
// What each gate is for:
//   1  the resolver licenses exactly the two terminal dispositions, and refuses
//      `fixed-pending-verification` — the distinction the whole reference exists
//      to carry across
//   2  the resolver never echoes its argument (pecia decision pc-cdb8)
//   3  the projection lands well-formed, and `audit` resolves every reference it
//      attached — no reference is attached where it cannot resolve
//   4  re-running writes nothing (this is a reconciler, not an importer)
//   5  a finding reopened in the conspectus turns `audit` red against its closed
//      defect — the cross-system check, and the reason to prefer a reference
//   6  a reopen produces an E005-safe successor, not an illegal un-close
//   7  a write the checker refuses (E016) escalates that finding and lets the
//      run continue — never --force, never an aborted reconciliation
//   8  a genuinely forked label chain fails closed rather than picking a side

process.removeAllListeners("warning");
process.on("warning", () => {});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = join(root, "mcp-server", "src", "schema.sql");

// One finding per resolution state. `accepted` is present precisely to prove it
// is excluded: confirmed-acceptable is a reviewed decision, not a defect.
const FIXTURE = [
  { id: "T01-1", sev: "HIGH", status: "confirmed-bug", events: ["open"] },
  { id: "T01-2", sev: "MEDIUM", status: "fixed", events: ["open", "fixed-pending-verification"] },
  { id: "T01-3", sev: "LOW", status: "fixed", events: ["open", "fixed-pending-verification", "verified-fixed"] },
  { id: "T01-4", sev: "MEDIUM", status: "ruled-out", events: ["open", "ruled-out"] },
  { id: "T01-5", sev: "LOW", status: "confirmed-acceptable", events: ["accepted"] },
];

function run(cmd, argv, cwd, label) {
  const r = spawnSync(cmd, argv, { cwd, encoding: "utf8" });
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
  return r;
}

function json(r, label) {
  try {
    return JSON.parse(r.stdout);
  } catch {
    throw new Error(`${label}: output was not JSON\n${r.stdout}\n${r.stderr}`);
  }
}

function auditKinds(cwd) {
  const r = run("pecia", ["audit"], cwd, "pecia audit");
  const parsed = json(r, "pecia audit");
  const findings = Array.isArray(parsed) ? parsed : (parsed.findings ?? []);
  return findings;
}

// These gates drive the real pecia CLI, because what they certify is the
// behaviour of the two systems together — a mock would only restate this
// adapter's own assumptions. Absence of the CLI is a loud failure, never a skip:
// a gate that quietly passes when its subject is missing is the zero-denominator
// green this repository has already found three times (B03-2, B04-1, B04-3).
{
  const probe = spawnSync("pecia", ["--help"], { encoding: "utf8" });
  if (probe.error) {
    process.stderr.write(
      "cannot run: the `pecia` CLI is not on PATH.\n" +
        "These gates exercise the real ledger tooling and will not pretend to pass without it.\n" +
        "Install pecia (github.com/nfeldman/pecia — a uv PEP-723 script) and re-run.\n",
    );
    process.exit(2);
  }
}

const work = mkdtempSync(join(tmpdir(), "aman-pecia-gate-"));
let passed = 0;
try {
  // ---- fixture ----------------------------------------------------------
  mkdirSync(join(work, "dev"), { recursive: true });
  mkdirSync(join(work, ".amanuensis"), { recursive: true });
  run("git", ["init", "-q", "."], work, "git init");
  run("git", ["config", "user.email", "gate@test"], work, "git config");
  run("git", ["config", "user.name", "gate"], work, "git config");
  for (const f of ["pecia-resolve-finding.mjs", "amanuensis-defects-to-pecia.mjs"]) {
    copyFileSync(join(root, "dev", f), join(work, "dev", f));
  }

  const db = new DatabaseSync(join(work, ".amanuensis", "memory.db"));
  db.exec(readFileSync(schemaPath, "utf8"));
  db.exec("INSERT INTO sessions (session_id, intent) VALUES ('gate', 'red gates')");
  db.exec(
    "INSERT INTO subsystems (id, name, status, layer) VALUES ('T-01', 'Fixture subsystem', 'mapped', 'test')",
  );
  for (const f of FIXTURE) {
    db.prepare(
      `INSERT INTO findings (finding_id, subsystem_id, symptom, root_cause, severity,
         status, ref_sha, session_id, pass_type)
       VALUES (?, 'T-01', ?, 'fixture root cause', ?, ?, 'fixturesha', 'gate', 'survey')`,
    ).run(f.id, `fixture symptom for ${f.id}`, f.sev, f.status);
    for (const state of f.events) {
      // The conspectus schema will not accept a fabricated repair history, and
      // the fixture honours that rather than working around it: a repair event
      // must name where and at which commit it landed, and a verified-fixed
      // event must cite evidence attached to the finding with role
      // fix-verification (trigger finding_verification_evidence_integrity).
      const repair = state === "fixed-pending-verification" || state === "verified-fixed";
      let evidenceId = null;
      if (state === "verified-fixed") {
        db.prepare(
          `INSERT INTO evidence (file_path, symbol, ref_sha, kind, note, session_id)
           VALUES ('src/fixture.ts', 'fixture', 'fixturefixsha', 'code-verified', 'fixture', 'gate')`,
        ).run();
        evidenceId = db.prepare("SELECT last_insert_rowid() AS id").get().id;
        db.prepare(
          `INSERT INTO finding_evidence (finding_id, evidence_id, role)
           VALUES (?, ?, 'fix-verification')`,
        ).run(f.id, evidenceId);
      }
      db.prepare(
        `INSERT INTO finding_resolution_events
           (finding_id, resolution_state, fix_location, fix_sha, evidence_id, rationale, session_id)
         VALUES (?, ?, ?, ?, ?, 'fixture', 'gate')`,
      ).run(f.id, state, repair ? "src/fixture.ts" : null, repair ? "fixturefixsha" : null, evidenceId);
    }
  }
  db.close();

  run("pecia", ["init"], work, "pecia init");
  writeFileSync(
    join(work, ".pecia", "config.yaml"),
    "stale_days: 7\nrot_days: 14\nresolvers: [amanuensis=dev/pecia-resolve-finding.mjs]\n",
  );

  const resolver = join(work, "dev", "pecia-resolve-finding.mjs");
  const adapter = join(work, "dev", "amanuensis-defects-to-pecia.mjs");

  // ---- 1. the resolver licenses exactly the terminal dispositions ---------
  for (const [id, want, why] of [
    ["T01-3", 0, "verified-fixed must license a closure"],
    ["T01-4", 0, "ruled-out must license a closure"],
    ["T01-1", 1, "an open finding must not license a closure"],
    ["T01-2", 1, "a repair awaiting verification must not license a closure"],
    ["T01-5", 1, "confirmed-acceptable must not license a closure"],
    ["T09-9", 1, "an absent finding must not license a closure"],
  ]) {
    const r = run(process.execPath, [resolver, id], work, "resolver");
    assert.equal(r.status, want, `${why} (${id} exited ${r.status})`);
  }
  passed++;

  // ---- 2. the resolver never echoes ledger content -----------------------
  const echo = run(process.execPath, [resolver, "T09-9"], work, "resolver");
  assert(
    !`${echo.stdout}${echo.stderr}`.includes("T09-9"),
    "the resolver echoed its argument back — ledger text must not reach a caller's context (pc-cdb8)",
  );
  passed++;

  // ---- 3. the projection lands clean and every reference resolves ---------
  const applied = run(process.execPath, [adapter, "--apply"], work, "adapter --apply");
  assert.equal(applied.status, 0, `--apply failed\n${applied.stdout}\n${applied.stderr}`);
  const check = json(run("pecia", ["check"], work, "pecia check"), "pecia check");
  assert.equal(check.ok, true, `pecia check is red after the projection: ${JSON.stringify(check)}`);
  const unresolved = auditKinds(work).filter((f) => f.kind === "unresolvable-reference");
  assert.equal(
    unresolved.length,
    0,
    `a reference was attached where it cannot resolve: ${JSON.stringify(unresolved)}`,
  );
  // The accepted finding must not have become a defect.
  const ledger = readFileSync(join(work, ".pecia", "work.jsonl"), "utf8");
  assert(!ledger.includes("amanuensis:T01-5"), "confirmed-acceptable was projected as a defect");
  passed++;

  // ---- 4. reconciler, not importer ---------------------------------------
  const again = run(process.execPath, [adapter, "--apply"], work, "adapter --apply");
  assert.equal(again.status, 0, "second apply failed");
  assert(
    again.stdout.includes("applied 0 change"),
    `re-running wrote changes; this is a reconciler, not an importer\n${again.stdout}`,
  );
  passed++;

  // ---- 5. a reopened finding turns the cross-system check red ------------
  const reopen = new DatabaseSync(join(work, ".amanuensis", "memory.db"));
  reopen.exec(
    `INSERT INTO finding_resolution_events (finding_id, resolution_state, rationale, session_id)
     VALUES ('T01-3', 'open', 'red arm: reopened after its defect closed', 'gate')`,
  );
  reopen.close();
  const red = auditKinds(work).filter((f) => f.kind === "unresolvable-reference");
  assert.equal(
    red.length,
    1,
    `reopening a verified finding did not turn audit red against its closed defect (got ${red.length})`,
  );
  passed++;

  // ---- 6. the reopen is an E005-safe successor ---------------------------
  const reapplied = run(process.execPath, [adapter, "--apply"], work, "adapter --apply");
  assert.equal(reapplied.status, 0, "reopen apply failed");
  const heads = new Map();
  for (const line of readFileSync(join(work, ".pecia", "work.jsonl"), "utf8").split("\n")) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line);
    if (!heads.has(rec.id) || rec.rev > heads.get(rec.id).rev) heads.set(rec.id, rec);
  }
  const chain = [...heads.values()].filter((r) => (r.labels ?? []).includes("amanuensis:T01-3"));
  assert.equal(chain.length, 2, `expected a two-record chain after reopen, got ${chain.length}`);
  assert.equal(
    chain.filter((r) => r.status === "done").length,
    1,
    "the closed record must stay closed — terminal states are final (E005)",
  );
  const successor = chain.find((r) => r.edges?.discovered_from);
  assert(successor, "the reopen did not record discovered_from back to the closed record");
  assert.equal(successor.status, "open", "the successor should be open");
  assert.equal(
    json(run("pecia", ["check"], work, "pecia check"), "pecia check").ok,
    true,
    "pecia check is red after the reopen",
  );
  passed++;

  // ---- 7. a refused write escalates instead of aborting the run ----------
  // Since v1.4 the write gate IS the checker, so E016 (v2.4) refuses the closure
  // of a defect an open record blocks — even once Amanuensis has verified the
  // repair, because the ledger knows a dependency the conspectus does not. The
  // run must report that one finding and keep reconciling the rest, and must
  // never reach for --force.
  const blocked = new DatabaseSync(join(work, ".amanuensis", "memory.db"));
  blocked.exec(
    `INSERT INTO evidence (file_path, symbol, ref_sha, kind, note, session_id)
     VALUES ('src/fixture.ts', 'fixture', 'fixturefixsha', 'code-verified', 'fixture', 'gate')`,
  );
  const evId = blocked.prepare("SELECT last_insert_rowid() AS id").get().id;
  blocked.exec(
    `INSERT INTO finding_evidence (finding_id, evidence_id, role)
     VALUES ('T01-1', ${evId}, 'fix-verification')`,
  );
  blocked.exec(
    `INSERT INTO finding_resolution_events
       (finding_id, resolution_state, fix_location, fix_sha, evidence_id, rationale, session_id)
     VALUES ('T01-1','verified-fixed','src/fixture.ts','fixturefixsha',${evId},'fixture','gate')`,
  );
  blocked.close();
  // Find T01-1's defect and put an open blocker in front of it.
  const beforeHeads = new Map();
  for (const line of readFileSync(join(work, ".pecia", "work.jsonl"), "utf8").split("\n")) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line);
    if (!beforeHeads.has(rec.id) || rec.rev > beforeHeads.get(rec.id).rev) beforeHeads.set(rec.id, rec);
  }
  const t011 = [...beforeHeads.values()].find((r) => (r.labels ?? []).includes("amanuensis:T01-1"));
  assert(t011, "T01-1 has no defect record to block");
  const blocker = json(
    run("pecia", ["add", "--type", "task", "--title", "open blocker", "--blocks", t011.id, "--json"], work, "pecia add"),
    "pecia add",
  );
  const escalating = run(process.execPath, [adapter, "--apply", "--json"], work, "adapter --apply");
  const report = JSON.parse(escalating.stdout);
  assert.equal(escalating.status, 1, "a refused write should make the run report failure");
  assert.equal(report.escalated.length, 1, `expected one escalation, got ${JSON.stringify(report.escalated)}`);
  assert(
    report.escalated[0].refusals.some((r) => r.startsWith("E016")),
    `the escalation did not carry the checker's E016 refusal: ${JSON.stringify(report.escalated[0])}`,
  );
  assert.equal(report.escalated[0].finding, "T01-1", "the wrong finding was escalated");
  // The run continued: the ledger is still well-formed and the blocked defect
  // stayed open rather than being forced closed.
  assert.equal(
    json(run("pecia", ["check"], work, "pecia check"), "pecia check").ok,
    true,
    "a refused write left the ledger malformed — the adapter must not have forced it",
  );
  const afterLedger = readFileSync(join(work, ".pecia", "work.jsonl"), "utf8");
  assert(!afterLedger.includes('"forced": true'), "the adapter used --force to bypass the write gate");
  // Clear the blocker so the remaining gate starts from a clean ledger.
  run("pecia", ["close", blocker.id, "--disposition", "fixture blocker retired"], work, "pecia close");
  passed++;

  // ---- 8. a forked label chain fails closed ------------------------------
  appendFileSync(
    join(work, ".pecia", "work.jsonl"),
    `${JSON.stringify({
      body: "rival", created: "2026-01-01", disposition: null,
      edges: { blocks: [], caused_by: null, discovered_from: null, duplicate_of: null,
               parent: null, retires: [], supersedes: null, validates: null },
      evidence: null, id: "pc-rival", labels: ["amanuensis:T01-3"], owner: "gate",
      priority: 2, rev: 1, status: "open", title: "rival claim", type: "defect",
      updated: "2026-01-01",
    })}\n`,
  );
  const forked = run(process.execPath, [adapter], work, "adapter");
  assert.equal(forked.status, 2, "a forked label chain did not halt the adapter");
  assert(
    forked.stderr.includes("one tail"),
    `the fork failure did not name the unresolved chain\n${forked.stderr}`,
  );
  passed++;

  console.log(
    `Amanuensis→Pecia defect gates: ${passed}/8 passed — resolver licences only terminal ` +
      `dispositions, no unresolvable reference is attached, re-runs are inert, a reopened ` +
      `finding reddens audit, reopen stays E005-safe, a refused write escalates, and a `+
      `forked chain halts`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
