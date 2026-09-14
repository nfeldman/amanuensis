import {
  ok,
  optString,
  requireEnum,
  requireInt,
  requireString,
  resolveWorkspaceCommit,
  type ServerContext,
  type ToolDefinition,
  ToolError,
} from "../helpers.js";
import { isAncestorOrSame, requireActiveSession } from "../invariants.js";
import { CARRIED_FINDING_OUTCOMES, FINDING_RESOLUTION_STATES, SEVERITIES } from "../vocabulary.js";

/**
 * §5's carry, in five writes and two reads.
 *
 * A reinitialization discards a conspectus, and before this nothing carried a
 * prior finding into the successor: six baseline open findings were neither
 * re-found nor ruled out, and `pecia audit` — which flags only *closed* records
 * whose reference stopped resolving — could not see it happen.
 *
 * The shape is three steps rather than one call, because the two counts §5.2
 * separates are only meaningful across a run: `begin_carry_run` declares what
 * the source holds and what this run commits to writing, `carry_finding` writes
 * one record per call so any reinitialization path can drive it, and
 * `finish_carry_run` refuses while the declaration and the rows disagree. The
 * run row is immutable by its trigger, so the counts are a promise made before
 * the writes and checked after them, not a tally quietly corrected at the end.
 */

const CARRY_SOURCE_KINDS = ["store", "export", "none"] as const;

/** The archived resolution states that mean the archive had already closed it. */
const ARCHIVED_CLOSED = new Set(["accepted", "ruled-out", "verified-fixed"]);

interface CarryRunRow {
  id: number;
  source_kind: string;
  archived_store_id: string | null;
  archived_anchor: string | null;
  expected_count: number;
  imported_count: number;
  session_id: string | null;
}

function readRun(ctx: ServerContext, carryRunId: number): CarryRunRow {
  const row = ctx.db.prepare("SELECT * FROM carry_runs WHERE id = ?").get(carryRunId) as
    | CarryRunRow
    | undefined;
  if (!row) {
    throw new ToolError(
      `carry_run_id ${carryRunId} names no carry run. Open one with begin_carry_run: a carried ` +
        `record without a run cannot say which reinitialization carried it, or how many records ` +
        `that run expected.`,
    );
  }
  return row;
}

function carriedRowsFor(ctx: ServerContext, carryRunId: number): number {
  return (
    ctx.db
      .prepare("SELECT COUNT(*) AS n FROM carried_findings WHERE carry_run_id = ?")
      .get(carryRunId) as { n: number }
  ).n;
}

function readCarried(ctx: ServerContext, carriedId: number) {
  const row = ctx.db
    .prepare("SELECT * FROM carried_findings WHERE carried_id = ?")
    .get(carriedId) as
    | {
        carried_id: number;
        archived_finding_id: string;
        archived_store_id: string;
        severity: string;
        symptom: string;
        root_cause: string;
        archived_resolution: string;
        subsystem_id: string;
        archived_anchor_sha: string;
        archived_ref_sha: string | null;
        primary_files: string | null;
        carried_at: string;
      }
    | undefined;
  if (!row) throw new ToolError(`carried_id ${carriedId} names no carried finding`);
  return row;
}

/** The envelope budget the other list tools observe (§5.2a). */
const WIRE_BUDGET = 8192;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * The bytes a response costs the host: the text block plus the
 * `structuredContent` that repeats it. Measured rather than estimated, because
 * the doubling is what turned a comfortable-looking payload into one over
 * budget in the reader-lens work.
 */
function envelopeBytes(payload: unknown): number {
  return (
    Buffer.byteLength(JSON.stringify(payload, null, 2), "utf8") +
    Buffer.byteLength(JSON.stringify(payload), "utf8")
  );
}

/** The first line of a symptom, which is what a compact page carries. */
function firstLine(text: string): string {
  const line = String(text ?? "").split("\n")[0] ?? "";
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}

export const carriedTools: ToolDefinition[] = [
  {
    name: "begin_carry_run",
    description:
      "Open the record of one carry: which archive is being carried from, why, how many findings it declares (expected_count), and how many this run commits to writing (imported_count). Every reinitialization writes one, including a reasoned empty one with source_kind 'none' and both counts zero — without it 'nothing was carried' and 'nobody ran a carry' are the same reading. The row is append-only; carry_finding refuses past imported_count and finish_carry_run refuses while the counts and the rows disagree.",
    inputSchema: {
      type: "object",
      properties: {
        source_kind: { type: "string", enum: [...CARRY_SOURCE_KINDS] },
        source_path: { type: "string" },
        archived_store_id: { type: "string" },
        archived_anchor: { type: "string" },
        reason: { type: "string" },
        expected_count: { type: "integer", minimum: 0 },
        imported_count: { type: "integer", minimum: 0 },
      },
      required: ["source_kind", "reason", "expected_count", "imported_count"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const sessionId = requireActiveSession(ctx, "begin_carry_run");
      const sourceKind = requireEnum(args, "source_kind", CARRY_SOURCE_KINDS);
      const reason = requireString(args, "reason");
      const expectedCount = requireInt(args, "expected_count");
      const importedCount = requireInt(args, "imported_count");
      const sourcePath = optString(args, "source_path");
      const archivedStoreId = optString(args, "archived_store_id");
      const archivedAnchor = optString(args, "archived_anchor");

      if (sourceKind === "none") {
        if (sourcePath !== null || archivedStoreId !== null) {
          throw new ToolError(
            "an empty carry names no source: pass source_kind 'none' with a reason and nothing else",
          );
        }
        if (expectedCount !== 0 || importedCount !== 0) {
          throw new ToolError(
            `an empty carry records expected_count 0 and imported_count 0, not ${expectedCount} and ${importedCount}`,
          );
        }
      } else {
        if (sourcePath === null) {
          throw new ToolError(`source_path is required for source_kind '${sourceKind}'`);
        }
        if (archivedStoreId === null) {
          // The one thing §5.3 exists to record. Without it a carried record
          // cannot name the store it came from, and a rebuilt store can
          // silently re-satisfy a closed reference (finding B03-R1).
          throw new ToolError(
            `archived_store_id is required for source_kind '${sourceKind}'. A carried record must ` +
              `name the store it came from; an export that does not carry the field cannot be a ` +
              `carry source, and a store supplies it from its own minted identity.`,
          );
        }
      }
      if (importedCount > expectedCount) {
        throw new ToolError(
          `imported_count ${importedCount} exceeds expected_count ${expectedCount}: a carry cannot ` +
            `write more records than the source declares`,
        );
      }

      const result = ctx.db
        .prepare(
          `INSERT INTO carry_runs (source_kind, source_path, archived_store_id, archived_anchor,
                                   reason, expected_count, imported_count, session_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          sourceKind,
          sourcePath,
          archivedStoreId,
          archivedAnchor,
          reason,
          expectedCount,
          importedCount,
          sessionId,
        );
      return ok({
        carry_run_id: Number(result.lastInsertRowid),
        source_kind: sourceKind,
        expected_count: expectedCount,
        imported_count: importedCount,
      });
    },
  },
  {
    name: "carry_finding",
    description:
      "Carry one finding out of an archived conspectus into this store, as an obligation to decide rather than a finding this store confirmed. Every archived finding is carried whatever its archived resolution state; one the archive had already closed is recorded with the outcome 'archived-terminal' by this call, which is the only writer of that outcome. A carried record is unique by (archived_store_id, archived_finding_id) and is never updated or deleted.",
    inputSchema: {
      type: "object",
      properties: {
        carry_run_id: { type: "integer" },
        archived_finding_id: { type: "string" },
        subsystem_id: { type: "string" },
        severity: { type: "string", enum: [...SEVERITIES] },
        symptom: { type: "string" },
        root_cause: { type: "string" },
        archived_resolution: { type: "string", enum: [...FINDING_RESOLUTION_STATES] },
        archived_ref_sha: { type: "string" },
        primary_files: { type: "array", items: { type: "string" } },
      },
      required: [
        "carry_run_id",
        "archived_finding_id",
        "subsystem_id",
        "severity",
        "symptom",
        "root_cause",
        "archived_resolution",
      ],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const sessionId = requireActiveSession(ctx, "carry_finding");
      const carryRunId = requireInt(args, "carry_run_id");
      const run = readRun(ctx, carryRunId);
      if (run.source_kind === "none") {
        throw new ToolError(
          `carry run ${carryRunId} is an explicit empty carry; open a run naming the source before carrying a record`,
        );
      }
      const written = carriedRowsFor(ctx, carryRunId);
      if (written >= run.imported_count) {
        throw new ToolError(
          `carry run ${carryRunId} declared imported_count ${run.imported_count} and has already ` +
            `written ${written} record(s). A count nothing enforces records nothing; open a new run ` +
            `if more is to be carried.`,
        );
      }

      const archivedFindingId = requireString(args, "archived_finding_id");
      const subsystemId = requireString(args, "subsystem_id");
      const severity = requireEnum(args, "severity", SEVERITIES);
      const symptom = requireString(args, "symptom");
      const rootCause = requireString(args, "root_cause");
      const archivedResolution = requireEnum(
        args,
        "archived_resolution",
        FINDING_RESOLUTION_STATES,
      );
      const archivedRefSha = optString(args, "archived_ref_sha");
      const primaryFiles = Array.isArray(args.primary_files)
        ? JSON.stringify(args.primary_files)
        : null;
      const archivedStoreId = run.archived_store_id;
      if (!archivedStoreId) {
        throw new ToolError(`carry run ${carryRunId} names no archived_store_id`);
      }

      const existing = ctx.db
        .prepare(
          "SELECT carried_id FROM carried_findings WHERE archived_store_id = ? AND archived_finding_id = ?",
        )
        .get(archivedStoreId, archivedFindingId) as { carried_id: number } | undefined;
      if (existing) {
        throw new ToolError(
          `${archivedFindingId} has already been carried from ${archivedStoreId} (carried_id ` +
            `${existing.carried_id}). A second row would make the obligation count wrong and let ` +
            `one archive's decision be recorded twice.`,
        );
      }

      const write = ctx.db.transaction(() => {
        const result = ctx.db
          .prepare(
            `INSERT INTO carried_findings (archived_finding_id, archived_store_id, archived_anchor_sha,
                                           subsystem_id, severity, symptom, root_cause, carry_run_id,
                                           archived_resolution, archived_ref_sha, primary_files,
                                           carried_by_session)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            archivedFindingId,
            archivedStoreId,
            run.archived_anchor ?? "",
            subsystemId,
            severity,
            symptom,
            rootCause,
            carryRunId,
            archivedResolution,
            archivedRefSha,
            primaryFiles,
            sessionId,
          );
        const carriedId = Number(result.lastInsertRowid);
        // A finding the archive had already closed asserts nothing about this
        // store — nobody here checked a commit or read a repaired path — so it
        // is pre-recorded `archived-terminal` and never `repaired`, whose rule
        // requires a resolving commit and an attached post-repair reading
        // (spec.md §5.4). This call is that outcome's only writer.
        if (ARCHIVED_CLOSED.has(archivedResolution)) {
          ctx.db
            .prepare(
              `INSERT INTO carried_finding_outcomes (carried_id, outcome, rationale, session_id, ref_sha)
               VALUES (?, 'archived-terminal', ?, ?, ?)`,
            )
            .run(
              carriedId,
              `the archive ${archivedStoreId} recorded ${archivedFindingId} as ${archivedResolution} ` +
                `before this store existed; the carry records that state rather than re-deciding it`,
              sessionId,
              run.archived_anchor ?? "",
            );
        }
        return carriedId;
      });
      const carriedId = write();
      return ok({
        carried_id: carriedId,
        archived_store_id: archivedStoreId,
        archived_finding_id: archivedFindingId,
        pre_recorded: ARCHIVED_CLOSED.has(archivedResolution) ? "archived-terminal" : null,
        obligation_id: `carried:${archivedStoreId}:${archivedFindingId}`,
      });
    },
  },
  {
    name: "finish_carry_run",
    description:
      "Close one carry, refusing while the run's declared counts and the records it wrote disagree. A partial carry is meant to be a visible disagreement rather than a silent one, so this reports expected_count, imported_count and the rows written, and refuses unless all three agree.",
    inputSchema: {
      type: "object",
      properties: { carry_run_id: { type: "integer" } },
      required: ["carry_run_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const carryRunId = requireInt(args, "carry_run_id");
      const run = readRun(ctx, carryRunId);
      const written = carriedRowsFor(ctx, carryRunId);
      if (run.expected_count !== run.imported_count) {
        throw new ToolError(
          `carry run ${carryRunId} declared expected_count ${run.expected_count} and imported_count ` +
            `${run.imported_count}. The source holds ${run.expected_count} finding(s) and this run ` +
            `carried ${run.imported_count}; a carry does not finish while they differ, because the ` +
            `findings it left behind are exactly the ones nothing will ask about again.`,
        );
      }
      if (written !== run.imported_count) {
        throw new ToolError(
          `carry run ${carryRunId} declared imported_count ${run.imported_count} and wrote ${written} ` +
            `record(s). imported_count is what the run wrote; a finish that does not compare it to ` +
            `the rows is a count nobody checked.`,
        );
      }
      return ok({
        carry_run_id: carryRunId,
        source_kind: run.source_kind,
        archived_store_id: run.archived_store_id,
        expected_count: run.expected_count,
        imported_count: run.imported_count,
        carried_rows: written,
      });
    },
  },
  {
    name: "attach_carried_evidence",
    description:
      "Attach an evidence row to a carried finding, the way attach_evidence_to_finding attaches one to a finding. This is the surface the 'ruled-out' and 'repaired' authority rules read: ruling a carried finding out requires evidence collected in the current session, and marking it repaired requires an attached reading taken at a revision that is a descendant of, or equal to, the repair. The attachment is append-only.",
    inputSchema: {
      type: "object",
      properties: {
        carried_id: { type: "integer" },
        evidence_id: { type: "integer" },
        role: { type: "string" },
      },
      required: ["carried_id", "evidence_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      requireActiveSession(ctx, "attach_carried_evidence");
      const carriedId = requireInt(args, "carried_id");
      readCarried(ctx, carriedId);
      const evidenceId = requireInt(args, "evidence_id");
      const role = optString(args, "role") ?? "supports";
      const evidence = ctx.db.prepare("SELECT id FROM evidence WHERE id = ?").get(evidenceId) as
        | { id: number }
        | undefined;
      if (!evidence) throw new ToolError(`evidence_id ${evidenceId} names no evidence row`);
      const existing = ctx.db
        .prepare(
          "SELECT role FROM carried_finding_evidence WHERE carried_id = ? AND evidence_id = ?",
        )
        .get(carriedId, evidenceId) as { role: string } | undefined;
      if (existing) {
        // The attachment is append-only, so re-attaching in a different role
        // would be an edit the trigger refuses. Report the standing row rather
        // than failing on a call that asks for what is already true.
        return ok({
          carried_id: carriedId,
          evidence_id: evidenceId,
          role: existing.role,
          action: "unchanged",
        });
      }
      ctx.db
        .prepare(
          "INSERT INTO carried_finding_evidence (carried_id, evidence_id, role) VALUES (?, ?, ?)",
        )
        .run(carriedId, evidenceId, role);
      return ok({ carried_id: carriedId, evidence_id: evidenceId, role, action: "attached" });
    },
  },
  {
    name: "record_carried_outcome",
    description:
      "Record what became of one carried finding. Three outcomes, each asserting something about THIS store: 'successor-finding' requires successor_id to name a findings row filed in this session; 'ruled-out' requires at least one evidence row collected in the current session and attached through attach_carried_evidence; 'repaired' requires repaired_sha to resolve in the bound workspace AND an attached evidence row whose revision is a descendant of, or equal to, it. The fourth outcome, 'archived-terminal', is written by carry_finding alone and is refused here. One outcome per carried record, and outcomes are never deleted — a mistaken one is corrected by a new carried record from the same archive.",
    inputSchema: {
      type: "object",
      properties: {
        carried_id: { type: "integer" },
        outcome: { type: "string", enum: [...CARRIED_FINDING_OUTCOMES] },
        successor_id: { type: "string" },
        repaired_sha: { type: "string" },
        rationale: { type: "string" },
        ref_sha: { type: "string" },
      },
      required: ["carried_id", "outcome", "rationale"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const sessionId = requireActiveSession(ctx, "record_carried_outcome");
      const carriedId = requireInt(args, "carried_id");
      const carried = readCarried(ctx, carriedId);
      const outcome = requireEnum(args, "outcome", CARRIED_FINDING_OUTCOMES);
      const rationale = requireString(args, "rationale");
      const suppliedRefSha = optString(args, "ref_sha");

      if (outcome === "archived-terminal") {
        throw new ToolError(
          `record_carried_outcome cannot write 'archived-terminal' for ${carried.archived_finding_id}. ` +
            `That outcome carries the state the archive had already reached and is written by the ` +
            `carry alone: it asserts nothing about this store, because nobody here checked a commit ` +
            `or read a repaired path. The three outcomes this tool writes each assert something ` +
            `about this store, with a rule saying who may assert it and on what evidence.`,
        );
      }

      const standing = ctx.db
        .prepare("SELECT outcome FROM carried_finding_outcomes WHERE carried_id = ?")
        .get(carriedId) as { outcome: string } | undefined;
      if (standing) {
        throw new ToolError(
          `${carried.archived_finding_id} already reached '${standing.outcome}'. A carried finding ` +
            `reaches exactly one outcome; correct a mistaken one by carrying the finding again from ` +
            `the same archive, which is visible, rather than by overwriting the decision.`,
        );
      }

      const refSha = resolveWorkspaceCommit(
        ctx,
        suppliedRefSha ?? "HEAD",
        suppliedRefSha === null ? "the current revision" : "ref_sha",
      );
      let successorId: string | null = null;
      let repairedSha: string | null = null;

      if (outcome === "successor-finding") {
        successorId = requireString(args, "successor_id");
        const successor = ctx.db
          .prepare("SELECT finding_id, session_id FROM findings WHERE finding_id = ?")
          .get(successorId) as { finding_id: string; session_id: string | null } | undefined;
        if (!successor) {
          throw new ToolError(
            `successor_id ${successorId} names no finding in this store. The successor is the ` +
              `re-find: file it with add_finding first, then record the carried finding as ` +
              `discharged into it.`,
          );
        }
        if (successor.session_id !== sessionId) {
          throw new ToolError(
            `successor_id ${successorId} was filed by session ${successor.session_id ?? "nobody"}, ` +
              `not by this one. The successor is this pass's re-find of the archived defect; ` +
              `pointing at a finding an earlier pass filed records an association, not a re-find.`,
          );
        }
      }

      if (outcome === "ruled-out") {
        const { n } = ctx.db
          .prepare(
            `SELECT COUNT(*) AS n
               FROM carried_finding_evidence cfe
               JOIN evidence e ON e.id = cfe.evidence_id
              WHERE cfe.carried_id = ? AND e.session_id = ?`,
          )
          .get(carriedId, sessionId) as { n: number };
        if (n === 0) {
          throw new ToolError(
            `cannot rule out carried finding ${carried.archived_finding_id}: no evidence collected ` +
              `in this session is attached to it. Overturning requires evidence, not vibes — record ` +
              `the disproving reading with add_evidence, attach it with attach_carried_evidence, ` +
              `then re-try. Evidence carried over from the pass that confirmed the finding is not a ` +
              `reading this pass took.`,
          );
        }
      }

      if (outcome === "repaired") {
        repairedSha = resolveWorkspaceCommit(
          ctx,
          requireString(args, "repaired_sha"),
          "repaired_sha",
        );
        const attached = ctx.db
          .prepare(
            `SELECT e.id, e.ref_sha
               FROM carried_finding_evidence cfe
               JOIN evidence e ON e.id = cfe.evidence_id
              WHERE cfe.carried_id = ?`,
          )
          .all(carriedId) as Array<{ id: number; ref_sha: string }>;
        const workspacePath = ctx.project.workspacePath;
        const postRepair = attached.filter((row) =>
          isAncestorOrSame(workspacePath, repairedSha as string, row.ref_sha),
        );
        if (postRepair.length === 0) {
          throw new ToolError(
            `cannot mark carried finding ${carried.archived_finding_id} repaired at ` +
              `${repairedSha.slice(0, 7)}: none of its ${attached.length} attached reading(s) was ` +
              `taken at a revision that is a descendant of, or equal to, that commit. "At or after" ` +
              `has no meaning on a Git DAG until it is said which relation is meant; this one is ` +
              `ancestry, so a reading taken on a sibling branch that never contained the repair does ` +
              `not discharge it. A claimed repair with no post-repair reading is ` +
              `fixed-pending-verification, never a discharge.`,
          );
        }
      }

      const result = ctx.db
        .prepare(
          `INSERT INTO carried_finding_outcomes (carried_id, outcome, successor_id, repaired_sha,
                                                 rationale, session_id, ref_sha)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(carriedId, outcome, successorId, repairedSha, rationale, sessionId, refSha);
      return ok({
        id: Number(result.lastInsertRowid),
        carried_id: carriedId,
        outcome,
        obligation_id: `carried:${carried.archived_store_id}:${carried.archived_finding_id}`,
      });
    },
  },
  {
    name: "list_carried_findings",
    description:
      "A compact page of the findings this store carried out of a prior conspectus, with each record's terminal outcome or the word 'undecided'. Default limit 25, hard maximum 100, truncated to the response budget the other list tools observe, with next_cursor when it truncates. symptom and root_cause in full come from get_carried_finding, one record per call.",
    inputSchema: {
      type: "object",
      properties: {
        outcome: { type: "string" },
        subsystem_id: { type: "string" },
        archived_store_id: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
        cursor: { type: "string" },
      },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const wantedOutcome = optString(args, "outcome");
      const subsystemId = optString(args, "subsystem_id");
      const archivedStoreId = optString(args, "archived_store_id");
      const limit = Math.min(
        typeof args.limit === "number" ? args.limit : DEFAULT_LIMIT,
        MAX_LIMIT,
      );
      const cursor = optString(args, "cursor");
      const after = cursor === null ? 0 : Number.parseInt(cursor, 10);
      if (Number.isNaN(after) || after < 0) {
        throw new ToolError(`cursor ${cursor} is not one this tool issued`);
      }

      const where: string[] = ["cf.carried_id > ?"];
      const params: unknown[] = [after];
      if (subsystemId !== null) {
        where.push("cf.subsystem_id = ?");
        params.push(subsystemId);
      }
      if (archivedStoreId !== null) {
        where.push("cf.archived_store_id = ?");
        params.push(archivedStoreId);
      }
      if (wantedOutcome !== null) {
        if (wantedOutcome === "undecided") where.push("o.id IS NULL");
        else {
          where.push("o.outcome = ?");
          params.push(wantedOutcome);
        }
      }
      const rows = ctx.db
        .prepare(
          `SELECT cf.carried_id, cf.archived_finding_id, cf.archived_store_id, cf.subsystem_id,
                  cf.severity, cf.symptom, o.outcome
             FROM carried_findings cf
             LEFT JOIN carried_finding_outcomes o ON o.carried_id = cf.carried_id
            WHERE ${where.join(" AND ")}
            ORDER BY cf.carried_id
            LIMIT ?`,
        )
        .all(...params, limit + 1) as Array<{
        carried_id: number;
        archived_finding_id: string;
        archived_store_id: string;
        subsystem_id: string;
        severity: string;
        symptom: string;
        outcome: string | null;
      }>;
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit).map((row) => ({
        carried_id: row.carried_id,
        archived_finding_id: row.archived_finding_id,
        archived_store_id: row.archived_store_id,
        subsystem_id: row.subsystem_id,
        severity: row.severity,
        outcome: row.outcome ?? "undecided",
        symptom: firstLine(row.symptom),
      }));

      // Drop records until the envelope fits, and say so. A reader that must
      // page is a reader that can page; a list tool that returns 22 full
      // findings in one envelope is a tool nothing can call twice.
      let truncated = hasMore;
      const build = () => ({
        carried: page,
        count: page.length,
        ...(truncated && page.length > 0
          ? { next_cursor: String(page[page.length - 1]?.carried_id ?? "") }
          : {}),
      });
      while (page.length > 1 && envelopeBytes(build()) > WIRE_BUDGET) {
        page.pop();
        truncated = true;
      }
      return build();
    },
  },
  {
    name: "get_carried_finding",
    description:
      "One carried record in full — symptom, root cause, the archive it came from, the revision it was recorded at, and its terminal outcome if it has one. The compact page comes from list_carried_findings; this is the per-record read.",
    inputSchema: {
      type: "object",
      properties: { carried_id: { type: "integer" } },
      required: ["carried_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const carriedId = requireInt(args, "carried_id");
      const carried = readCarried(ctx, carriedId);
      const outcome =
        ctx.db
          .prepare(
            `SELECT outcome, successor_id, repaired_sha, rationale, session_id, ref_sha, recorded_at
             FROM carried_finding_outcomes WHERE carried_id = ?`,
          )
          .get(carriedId) ?? null;
      const evidence = ctx.db
        .prepare(
          `SELECT cfe.evidence_id, cfe.role, e.file_path, e.ref_sha
             FROM carried_finding_evidence cfe
             JOIN evidence e ON e.id = cfe.evidence_id
            WHERE cfe.carried_id = ?
            ORDER BY cfe.evidence_id`,
        )
        .all(carriedId);
      return {
        ...carried,
        obligation_id: `carried:${carried.archived_store_id}:${carried.archived_finding_id}`,
        outcome,
        evidence,
      };
    },
  },
];
