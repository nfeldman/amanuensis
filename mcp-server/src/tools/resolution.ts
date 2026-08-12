import { spawnSync } from "node:child_process";
import type { ServerContext, ToolDefinition } from "../helpers.js";

interface Violation {
  domain: "finding" | "claim" | "contradiction" | "obligation";
  object_id: string;
  invariant: string;
  detail: string;
}

function isAncestor(ctx: ServerContext, ancestor: string, descendant: string): boolean | null {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
    cwd: ctx.project.workspacePath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  return null;
}

export const resolutionTools: ToolDefinition[] = [
  {
    name: "audit_resolution_invariants",
    description:
      "Audit authoritative resolution invariants across findings, temporal claims, contradictions, and revalidation obligations. Returns explicit violations; it never repairs or rewrites durable truth.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: (_args, ctx) => {
      const violations: Violation[] = [];

      const fixed = ctx.db
        .prepare(
          `SELECT f.finding_id, r.resolution_state, r.fix_sha, r.evidence_id,
                  e.ref_sha AS evidence_sha
             FROM findings f
             LEFT JOIN finding_resolution_current r ON r.finding_id=f.finding_id
             LEFT JOIN evidence e ON e.id=r.evidence_id
            WHERE f.status='fixed'`,
        )
        .all() as Array<{
        finding_id: string;
        resolution_state: string | null;
        fix_sha: string | null;
        evidence_id: number | null;
        evidence_sha: string | null;
      }>;
      for (const row of fixed) {
        if (!row.resolution_state) {
          violations.push({
            domain: "finding",
            object_id: row.finding_id,
            invariant: "fixed-has-resolution-event",
            detail: "coarse fixed label has no append-only resolution event",
          });
          continue;
        }
        if (row.resolution_state === "verified-fixed") {
          if (!row.fix_sha || !row.evidence_id || !row.evidence_sha) {
            violations.push({
              domain: "finding",
              object_id: row.finding_id,
              invariant: "verified-has-proof",
              detail: "verified-fixed lacks a repair SHA or confirming evidence",
            });
          } else if (isAncestor(ctx, row.fix_sha, row.evidence_sha) !== true) {
            violations.push({
              domain: "finding",
              object_id: row.finding_id,
              invariant: "evidence-at-or-after-fix",
              detail: `evidence ${row.evidence_id} at ${row.evidence_sha} is not proven at or after ${row.fix_sha}`,
            });
          }
        }
      }

      const badClaims = ctx.db
        .prepare(
          `SELECT c.claim_id, c.valid_until_sha
             FROM claims c
            WHERE NOT EXISTS (
                    SELECT 1 FROM claim_evidence ce
                     WHERE ce.claim_id=c.claim_id AND ce.role='supports'
                  )
               OR NOT EXISTS (
                    SELECT 1 FROM claim_validity_events ve
                     WHERE ve.claim_id=c.claim_id AND ve.event_type='asserted'
                  )
               OR (c.valid_until_sha IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM claim_validity_events ve
                     WHERE ve.claim_id=c.claim_id
                       AND ve.event_type IN ('invalidated','superseded')
                       AND ve.at_sha=c.valid_until_sha
                  ))`,
        )
        .all() as Array<{ claim_id: string; valid_until_sha: string | null }>;
      for (const row of badClaims) {
        violations.push({
          domain: "claim",
          object_id: row.claim_id,
          invariant: "claim-validity-is-evidenced",
          detail: row.valid_until_sha
            ? "closed claim lacks supporting assertion or matching invalidation/supersession event"
            : "current claim lacks supporting evidence or assertion event",
        });
      }

      const badContradictions = ctx.db
        .prepare(
          `SELECT c.id
             FROM contradictions c
            WHERE c.resolution!='unresolved'
              AND NOT EXISTS (
                SELECT 1 FROM contradiction_resolution_events cre
                 WHERE cre.contradiction_id=c.id
                   AND cre.resolution=c.resolution
                   AND cre.evidence_id IS NOT NULL
                   AND cre.id=(SELECT MAX(cre2.id) FROM contradiction_resolution_events cre2
                                WHERE cre2.contradiction_id=c.id)
              )`,
        )
        .all() as Array<{ id: number }>;
      for (const row of badContradictions) {
        violations.push({
          domain: "contradiction",
          object_id: String(row.id),
          invariant: "resolution-has-current-evidence-event",
          detail: "resolved compatibility row lacks a matching evidence-backed append-only event",
        });
      }

      const badObligations = ctx.db
        .prepare(
          `SELECT obligation_id FROM revalidation_obligations
            WHERE state='closed' AND resolution_evidence_id IS NULL`,
        )
        .all() as Array<{ obligation_id: string }>;
      for (const row of badObligations) {
        violations.push({
          domain: "obligation",
          object_id: row.obligation_id,
          invariant: "closed-has-resolution-evidence",
          detail: "closed obligation has no resolution evidence",
        });
      }

      const counts = {
        findings: fixed.length,
        claims: (ctx.db.prepare("SELECT COUNT(*) AS n FROM claims").get() as { n: number }).n,
        contradictions: (
          ctx.db.prepare("SELECT COUNT(*) AS n FROM contradictions").get() as { n: number }
        ).n,
        obligations: (
          ctx.db.prepare("SELECT COUNT(*) AS n FROM revalidation_obligations").get() as {
            n: number;
          }
        ).n,
      };
      return { ok: violations.length === 0, counts, violations };
    },
  },
];
