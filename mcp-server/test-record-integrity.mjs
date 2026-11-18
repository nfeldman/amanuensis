#!/usr/bin/env node
// Three record-integrity defects from the self-conspectus, each asserted
// against a temporary git workspace and a store this script creates.
//
//   F  B03-R2: a repair is recorded at the commit that changed the repaired
//      file. Before, any commit the evidence descended from was accepted as
//      fix_sha, so verified-fixed could name a commit the repair is not at.
//   V  B03-R4: a finding's severity can be re-graded, and each re-grade is an
//      append-only row. Before, nothing wrote findings.severity after insert.
//   K  B04-R7: add_claim refuses a key-type or state-container key whose slug
//      is not its subject's, and a flow key with no step number. Before, the
//      rule ran only in a dev gate, after the record was durable.
//
// Controls that must stay green: the right fix commit is accepted (F2), a
// stable key is accepted (K2, K4), keys outside the three file-anchored
// categories are untouched (K5), and a legacy unstable key can still be
// superseded (K6).
//
//   exit 0  `RECORD INTEGRITY GREEN`
//   exit 1  `RECORD INTEGRITY RED: <first failure>`

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./dist/db.js";
import { claimTools } from "./dist/tools/claims.js";
import { evidenceTools } from "./dist/tools/evidence.js";
import { findingTools } from "./dist/tools/findings.js";
import { locusTools } from "./dist/tools/locus.js";
import { projectTools } from "./dist/tools/project.js";

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

const root = mkdtempSync(join(tmpdir(), "amanuensis-record-integrity-"));
const workspace = join(root, "workspace");
const storage = join(root, "storage");
mkdirSync(workspace);
mkdirSync(storage);
execFileSync("git", ["init", "-q"], { cwd: workspace });
function commit(message, files) {
  for (const [path, text] of Object.entries(files)) writeFileSync(join(workspace, path), text);
  execFileSync("git", ["add", "-A"], { cwd: workspace });
  execFileSync(
    "git",
    [
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.name=record-integrity",
      "-c",
      "user.email=test@localhost",
      "commit",
      "-q",
      "--no-verify",
      "-m",
      message,
    ],
    { cwd: workspace },
  );
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspace, encoding: "utf8" }).trim();
}
const seedSha = commit("seed", {
  "fixture.ts": "export interface Config { broken: true }\n",
  "other.ts": "export const other = 1;\n",
});
const fixSha = commit("fix", { "fixture.ts": "export interface Config { broken: false }\n" });
const laterSha = commit("unrelated", { "other.ts": "export const other = 2;\n" });

const project = {
  workspacePath: workspace,
  projectKey: "test/record-integrity",
  storagePath: storage,
  dbPath: join(storage, "memory.db"),
  storageGitReady: false,
};
const db = openDatabase(project.dbPath);
const ctx = { project, db, sessionId: null };
const tools = new Map(
  [...projectTools, ...findingTools, ...evidenceTools, ...claimTools, ...locusTools].map((tool) => [
    tool.name,
    tool,
  ]),
);
function call(name, args = {}) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool.handler(args, ctx);
}

try {
  ctx.sessionId = call("start_session", { intent: "record-integrity" }).session_id;
  db.prepare(
    "INSERT INTO subsystems (id, name, status) VALUES ('B-01', 'Fixture', 'concerns')",
  ).run();
  // B01-3 is re-graded below and read back through describe_locus, whose
  // default budget serves one finding; it gets a subsystem of its own.
  db.prepare(
    "INSERT INTO subsystems (id, name, status) VALUES ('B-02', 'Regraded', 'concerns')",
  ).run();
  for (const id of ["B01-1", "B01-2", "B01-3"]) {
    call("add_finding", {
      finding_id: id,
      subsystem_id: id === "B01-3" ? "B-02" : "B-01",
      symptom: `defect ${id}`,
      root_cause: "fixture",
      severity: "HIGH",
      status: "confirmed-bug",
      ref_sha: seedSha,
      pass_type: "survey",
    });
  }

  // ── F: the repair commit changed the repaired file ──────────────────────
  check("F1 a fix_sha that did not change the fix_location file is refused", () => {
    const message = refusal(() =>
      call("update_finding_status", {
        finding_id: "B01-1",
        status: "fixed",
        fix_location: "fixture.ts:Config",
        fix_sha: laterSha,
      }),
    );
    if (message === null) return "accepted a commit that did not touch fixture.ts";
    if (!message.includes(fixSha.slice(0, 12))) {
      return `refusal does not name the commit that last changed fixture.ts: ${message}`;
    }
    const row = db.prepare("SELECT status FROM findings WHERE finding_id = 'B01-1'").get();
    return row.status === "confirmed-bug" ? null : `status moved to ${row.status}`;
  });
  check("F2 the commit that changed the file is accepted", () => {
    const result = call("update_finding_status", {
      finding_id: "B01-1",
      status: "fixed",
      fix_location: "fixture.ts:Config",
      fix_sha: fixSha,
    });
    return result.resolution_state === "fixed-pending-verification" ? null : JSON.stringify(result);
  });
  check("F4 a fix_location naming a directory or the root is refused", () => {
    // `rev-list -- .` matches every commit that changed anything, so a
    // directory would let any commit pass.
    const cases = { ".:Config": "the root", "src:Config": "a directory" };
    mkdirSync(join(workspace, "src"), { recursive: true });
    const dirSha = commit("a directory", { "src/inner.ts": "export const inner = 1;\n" });
    for (const [location, what] of Object.entries(cases)) {
      const message = refusal(() =>
        call("update_finding_status", {
          finding_id: "B01-2",
          status: "fixed",
          fix_location: location,
          fix_sha: dirSha,
        }),
      );
      if (message === null) return `accepted ${what} (${location}) as the repaired file`;
    }
    return null;
  });
  check("F3 verify_finding_fix refuses a stored pending repair at the wrong commit", () => {
    // A row written before the check existed: the write path no longer
    // produces one, so it is inserted the way an older server stored it.
    db.prepare(
      "UPDATE findings SET status = 'fixed', fix_location = 'fixture.ts:Config' WHERE finding_id = 'B01-2'",
    ).run();
    db.prepare(
      `INSERT INTO finding_resolution_events
         (finding_id, resolution_state, fix_location, fix_sha, effective_sha, rationale, session_id)
       VALUES ('B01-2', 'fixed-pending-verification', 'fixture.ts:Config', ?, ?, 'legacy', ?)`,
    ).run(laterSha, laterSha, ctx.sessionId);
    const evidence = call("add_evidence", {
      file_path: "fixture.ts",
      symbol: "Config",
      ref_sha: laterSha,
      kind: "test-observed",
      note: "post-repair observation",
    });
    call("attach_evidence_to_finding", {
      finding_id: "B01-2",
      evidence_id: evidence.id,
      role: "fix-verification",
    });
    const message = refusal(() =>
      call("verify_finding_fix", {
        finding_id: "B01-2",
        evidence_id: evidence.id,
        verification_note: "should be refused",
      }),
    );
    return message === null
      ? "promoted a repair recorded at a commit that did not change the file"
      : null;
  });

  // ── V: severity is re-gradable, with history ───────────────────────────
  check("V1 a re-grade changes the severity every projection reads", () => {
    const result = call("update_finding_severity", {
      finding_id: "B01-3",
      severity: "LOW",
      rationale: "the adversarial pass found the path unreachable from any public entry point",
      ref_sha: laterSha,
    });
    if (result.previous_severity !== "HIGH" || result.severity !== "LOW") {
      return JSON.stringify(result);
    }
    const listed = call("get_findings", {}).find((row) => row.finding_id === "B01-3");
    return listed.severity === "LOW" ? null : `get_findings reports ${listed.severity}`;
  });
  check("V2 each re-grade is recorded with what it replaced and why", () => {
    const rows = db
      .prepare(
        "SELECT previous_severity, severity, rationale, session_id FROM finding_severity_events WHERE finding_id = 'B01-3'",
      )
      .all();
    if (rows.length !== 1) return `expected 1 event, found ${rows.length}`;
    const [row] = rows;
    return row.previous_severity === "HIGH" &&
      row.severity === "LOW" &&
      row.rationale.includes("unreachable") &&
      row.session_id === ctx.sessionId
      ? null
      : JSON.stringify(row);
  });
  check("V3 an unchanged severity, a blank rationale and an unknown grade are refused", () => {
    const same = refusal(() =>
      call("update_finding_severity", {
        finding_id: "B01-3",
        severity: "LOW",
        rationale: "again",
        ref_sha: laterSha,
      }),
    );
    const blank = refusal(() =>
      call("update_finding_severity", {
        finding_id: "B01-3",
        severity: "MEDIUM",
        rationale: "  ",
        ref_sha: laterSha,
      }),
    );
    const unknown = refusal(() =>
      call("update_finding_severity", {
        finding_id: "B01-3",
        severity: "SEVERE",
        rationale: "x",
        ref_sha: laterSha,
      }),
    );
    const missing = [same, blank, unknown].findIndex((message) => message === null);
    if (missing >= 0) return `case ${["unchanged", "blank", "unknown"][missing]} was accepted`;
    const count = db
      .prepare("SELECT COUNT(*) AS n FROM finding_severity_events WHERE finding_id = 'B01-3'")
      .get().n;
    return count === 1 ? null : `a refused call wrote a row (${count})`;
  });
  check("V4 a recorded re-grade cannot be rewritten, or deleted while its finding exists", () => {
    const update = refusal(() =>
      db.prepare("UPDATE finding_severity_events SET severity = 'CRITICAL'").run(),
    );
    const remove = refusal(() => db.prepare("DELETE FROM finding_severity_events").run());
    if (update === null) return "UPDATE succeeded";
    if (remove === null) return "DELETE succeeded";
    return null;
  });

  check("V6 describe_locus as of a revision reports the grade that stood there", () => {
    const gradeAt = (asOf) => {
      const payload = call("describe_locus", {
        locus: "B-02",
        sections: ["defects"],
        as_of_sha: asOf,
      });
      return (payload?.sections?.defects?.items ?? []).find((item) => item.finding_id === "B01-3")
        ?.severity;
    };
    const before = gradeAt(fixSha);
    const after = gradeAt(laterSha);
    if (before !== "HIGH") return `as of the commit before the re-grade it reports ${before}`;
    return after === "LOW" ? null : `as of the re-grade's own commit it reports ${after}`;
  });

  check("V5 the history goes with its finding, so a re-minted id inherits none", () => {
    // reset_subsystem deletes a subsystem's findings; the same id can then be
    // filed again for a different defect (B03-R6).
    const message = refusal(() =>
      db.prepare("DELETE FROM findings WHERE finding_id = 'B01-3'").run(),
    );
    if (message !== null) return `deleting the finding was refused: ${message}`;
    const left = db
      .prepare("SELECT COUNT(*) AS n FROM finding_severity_events WHERE finding_id = 'B01-3'")
      .get().n;
    return left === 0 ? null : `${left} re-grade row(s) outlived the finding`;
  });

  // ── K: claim keys are stable when written ──────────────────────────────
  const anchored = call("add_evidence", {
    file_path: "fixture.ts",
    symbol: "Config",
    ref_sha: laterSha,
    kind: "code-verified",
    note: "read the interface",
  });
  const claim = (id, key, subject) =>
    refusal(() =>
      call("add_claim", {
        claim_id: id,
        claim_key: key,
        subject_type: "symbol",
        subject_id: subject,
        statement: `Config is the fixture's key type (${id}).`,
        epistemic_kind: "observation",
        ref_sha: laterSha,
        evidence_ids: [anchored.id],
      }),
    );
  check("K1 a key-type key built from the symbol alone is refused", () => {
    const message = claim("c-k1", "B-01/key-type/config", "fixture.ts:Config");
    if (message === null) return "accepted an unstable key";
    return message.includes("B-01/key-type/fixture-ts-config")
      ? null
      : `refusal does not name the stable key: ${message}`;
  });
  check("K2 the stable key is accepted", () =>
    claim("c-k2", "B-01/key-type/fixture-ts-config", "fixture.ts:Config"),
  );
  check("K3 a flow key with no step number is refused", () =>
    claim("c-k3", "B-01/flow/startup", "fixture.ts:Config") === null
      ? "accepted a flow step with no order"
      : null,
  );
  check("K4 a numbered flow step is accepted", () =>
    claim("c-k4", "B-01/flow/startup/01", "fixture.ts:Config"),
  );
  check("K5 a key outside the file-anchored categories is untouched", () =>
    claim("c-k5", "B-01/concurrency", "fixture.ts:Config"),
  );
  check("K6 a legacy unstable key can still be superseded", () => {
    db.prepare(
      `INSERT INTO claims (claim_id, claim_key, subject_type, subject_id, statement,
                           epistemic_kind, asserted_at_sha, valid_from_sha, session_id)
       VALUES ('c-legacy', 'B-01/state-container/config', 'symbol', 'fixture.ts:Config',
               'legacy reading', 'observation', ?, ?, ?)`,
    ).run(fixSha, fixSha, ctx.sessionId);
    const fresh = call("add_evidence", {
      file_path: "fixture.ts",
      symbol: "Config",
      ref_sha: laterSha,
      kind: "code-verified",
      note: "re-read the interface",
    });
    return refusal(() =>
      call("supersede_claim", {
        predecessor_claim_id: "c-legacy",
        successor_claim_id: "c-legacy-2",
        statement: "Config is a state container.",
        epistemic_kind: "observation",
        at_sha: laterSha,
        rationale: "re-read at the later revision",
        evidence_ids: [fresh.id],
      }),
    );
  });
} catch (error) {
  failures.push(`setup: ${String(error?.stack ?? error)}`);
} finally {
  db.close();
  rmSync(root, { recursive: true, force: true });
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL ${failure}`);
  console.error(`RECORD INTEGRITY RED: ${failures[0]}`);
  process.exit(1);
}
console.log(`RECORD INTEGRITY GREEN (${checked} checks)`);
