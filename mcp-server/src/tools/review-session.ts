import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  optInt,
  optString,
  requireInt,
  requireString,
  requireStringArray,
  type ServerContext,
  type ToolDefinition,
  ToolError,
} from "../helpers.js";
import { requireActiveSession } from "../invariants.js";
import { resolveStorageOutputPath } from "../project.js";

const SECTIONS = [
  "situation",
  "findings",
  "challenges",
  "regressions",
  "latent-defects",
  "stale-knowledge",
  "open-obligations",
  "unknowns",
  "history",
] as const;

type Section = (typeof SECTIONS)[number];
type EpistemicKind = "observation" | "inference" | "open-question";

interface ReviewItemInput {
  section: Section;
  semanticState: string;
  epistemicKind: EpistemicKind;
  actionable: boolean;
  statement: string;
  sourceType: string;
  sourceId: string;
  evidenceIds?: number[];
}

interface ReviewSessionRow {
  review_session_id: string;
  composition_run_id: string;
  impact_run_id: string;
  reviewed_sha: string;
  status: string;
  item_count: number;
  actionable_count: number;
  summary_json: string;
  summary_hash: string;
}

function normalizedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizedJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizedJson(item)]),
    );
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(normalizedJson(value));
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function git(ctx: ServerContext, args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync("git", args, {
    cwd: ctx.project.workspacePath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function isAncestor(ctx: ServerContext, ancestor: string, descendant: string): boolean {
  if (ancestor === descendant) return true;
  return git(ctx, ["merge-base", "--is-ancestor", ancestor, descendant]).status === 0;
}

function getSession(ctx: ServerContext, reviewSessionId: string): ReviewSessionRow {
  const row = ctx.db
    .prepare("SELECT * FROM review_sessions WHERE review_session_id=?")
    .get(reviewSessionId) as ReviewSessionRow | undefined;
  if (!row) throw new ToolError(`unknown review session: ${reviewSessionId}`);
  return row;
}

function evidenceIds(ctx: ServerContext, findingId: string): number[] {
  return (
    ctx.db
      .prepare("SELECT evidence_id FROM finding_evidence WHERE finding_id=? ORDER BY evidence_id")
      .all(findingId) as Array<{ evidence_id: number }>
  ).map((row) => row.evidence_id);
}

function itemId(item: ReviewItemInput): string {
  return `review-item:${hash(`${item.sourceType}\u0000${item.sourceId}\u0000${item.semanticState}`).slice(0, 24)}`;
}

function recordUri(item: ReviewItemInput): string {
  return `amanuensis://${item.sourceType}/${encodeURIComponent(item.sourceId)}`;
}

function compile(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const preparedBy = requireActiveSession(ctx, "compile_review_session");
  const reviewSessionId = requireString(args, "review_session_id");
  if (
    ctx.db.prepare("SELECT 1 FROM review_sessions WHERE review_session_id=?").get(reviewSessionId)
  ) {
    throw new ToolError(`review session already exists: ${reviewSessionId}`);
  }
  const compositionRunId = requireString(args, "composition_run_id");
  const composition = ctx.db
    .prepare("SELECT * FROM composition_runs WHERE run_id=?")
    .get(compositionRunId) as
    | {
        impact_run_id: string;
        assembled_head_sha: string;
        status: string;
      }
    | undefined;
  if (!composition || !["complete", "blocked"].includes(composition.status)) {
    throw new ToolError("review session requires a reconciled complete or blocked composition run");
  }
  const reconciliation = ctx.db
    .prepare(
      "SELECT * FROM composition_reconciliations WHERE run_id=? ORDER BY reconciliation_id DESC LIMIT 1",
    )
    .get(compositionRunId) as { status: string; result_json: string } | undefined;
  if (!reconciliation) throw new ToolError("composition run has no fan-in reconciliation");
  const impact = ctx.db
    .prepare("SELECT base_sha, head_sha FROM change_impact_runs WHERE run_id=?")
    .get(composition.impact_run_id) as { base_sha: string; head_sha: string } | undefined;
  if (!impact || impact.head_sha !== composition.assembled_head_sha) {
    throw new ToolError("composition and impact state do not reconcile");
  }
  const items: ReviewItemInput[] = [];
  const add = (item: ReviewItemInput): void => {
    items.push({
      ...item,
      evidenceIds: [...new Set(item.evidenceIds ?? [])].sort((a, b) => a - b),
    });
  };

  const compositionResult = JSON.parse(reconciliation.result_json) as {
    fan_in: Record<string, number>;
  };
  add({
    section: "situation",
    semanticState: reconciliation.status === "green" ? "composition-green" : "composition-red",
    epistemicKind: "observation",
    actionable: false,
    statement: `Composition ${compositionRunId} is ${reconciliation.status} at ${impact.head_sha.slice(0, 12)} with ${compositionResult.fan_in.passed}/${compositionResult.fan_in.expected} expected items passing.`,
    sourceType: "composition",
    sourceId: compositionRunId,
  });

  const changedFiles = ctx.db
    .prepare(
      `SELECT ordinal, change_type, path_before, path_after
         FROM change_impact_files WHERE run_id=? ORDER BY ordinal`,
    )
    .all(composition.impact_run_id) as Array<{
    ordinal: number;
    change_type: string;
    path_before: string | null;
    path_after: string | null;
  }>;
  for (const file of changedFiles) {
    add({
      section: "situation",
      semanticState: "changed",
      epistemicKind: "observation",
      actionable: false,
      statement: `${file.change_type}: ${file.path_before ?? "∅"}${file.path_before !== file.path_after ? ` → ${file.path_after ?? "∅"}` : ""}`,
      sourceType: "change-file",
      sourceId: `${composition.impact_run_id}:${file.ordinal}`,
    });
  }

  const findings = ctx.db
    .prepare(
      `SELECT f.*, r.resolution_state
         FROM findings f
         LEFT JOIN finding_resolution_current r ON r.finding_id=f.finding_id
        ORDER BY CASE f.severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1
                 WHEN 'MEDIUM' THEN 2 ELSE 3 END, f.finding_id`,
    )
    .all() as Array<{
    finding_id: string;
    symptom: string;
    root_cause: string;
    severity: string;
    ref_sha: string | null;
    resolution_state: string | null;
  }>;
  for (const finding of findings) {
    const priorVerified = Number(
      (
        ctx.db
          .prepare(
            "SELECT COUNT(*) AS n FROM finding_resolution_events WHERE finding_id=? AND resolution_state='verified-fixed'",
          )
          .get(finding.finding_id) as { n: number }
      ).n,
    );
    let section: Section = "findings";
    let semanticState = "active-finding";
    let actionable = true;
    if (finding.resolution_state === "open" && priorVerified > 0) {
      section = "regressions";
      semanticState = "regression";
    } else if (
      finding.resolution_state === "open" &&
      finding.ref_sha &&
      isAncestor(ctx, finding.ref_sha, impact.base_sha)
    ) {
      section = "latent-defects";
      semanticState = "latent-defect";
    } else if (finding.resolution_state === "ruled-out") {
      section = "history";
      semanticState = "ruled-out-historical";
      actionable = false;
    } else if (finding.resolution_state === "verified-fixed") {
      section = "history";
      semanticState = "verified-fixed-historical";
      actionable = false;
    } else if (finding.resolution_state === "accepted") {
      section = "history";
      semanticState = "acceptable-control";
      actionable = false;
    }
    add({
      section,
      semanticState,
      epistemicKind: "inference",
      actionable,
      statement: `${finding.severity} ${finding.finding_id}: ${finding.symptom}`,
      sourceType: "finding",
      sourceId: finding.finding_id,
      evidenceIds: evidenceIds(ctx, finding.finding_id),
    });
  }

  const reviewRunIds = [
    ...new Set(
      (
        ctx.db
          .prepare(
            `SELECT expected_ref FROM composition_items
              WHERE run_id=? AND item_kind='review-result' ORDER BY ordinal`,
          )
          .all(compositionRunId) as Array<{ expected_ref: string }>
      ).map((row) => row.expected_ref),
    ),
  ];
  for (const runId of reviewRunIds) {
    const aggregation = ctx.db
      .prepare("SELECT result_json FROM review_aggregations WHERE run_id=?")
      .get(runId) as { result_json: string } | undefined;
    if (!aggregation) continue;
    const result = JSON.parse(aggregation.result_json) as {
      hypotheses: Array<{
        hypothesis_id: string;
        finding_key: string;
        final_status: string;
      }>;
    };
    for (const hypothesis of result.hypotheses) {
      const semanticState =
        hypothesis.final_status === "survived"
          ? "challenge-survived"
          : hypothesis.final_status === "defeated"
            ? "challenge-defeated"
            : "challenge-contested";
      const challengeEvidence = (
        ctx.db
          .prepare(
            `SELECT DISTINCT je.evidence_id
               FROM review_judgments j
               JOIN review_judgment_evidence je ON je.judgment_id=j.judgment_id
              WHERE j.hypothesis_id=? ORDER BY je.evidence_id`,
          )
          .all(hypothesis.hypothesis_id) as Array<{ evidence_id: number }>
      ).map((row) => row.evidence_id);
      add({
        section: "challenges",
        semanticState,
        epistemicKind: "inference",
        actionable: semanticState !== "challenge-defeated",
        statement: `${hypothesis.finding_key} ${hypothesis.final_status} independent challenge.`,
        sourceType: "review-hypothesis",
        sourceId: hypothesis.hypothesis_id,
        evidenceIds: challengeEvidence,
      });
    }
  }

  const staleClaims = ctx.db
    .prepare(
      `SELECT claim_id, statement, valid_until_sha FROM claims
        WHERE valid_until_sha IS NOT NULL ORDER BY claim_id`,
    )
    .all() as Array<{ claim_id: string; statement: string; valid_until_sha: string }>;
  for (const claim of staleClaims.filter((row) =>
    isAncestor(ctx, row.valid_until_sha, impact.head_sha),
  )) {
    const claimEvidence = (
      ctx.db
        .prepare("SELECT evidence_id FROM claim_evidence WHERE claim_id=? ORDER BY evidence_id")
        .all(claim.claim_id) as Array<{ evidence_id: number }>
    ).map((row) => row.evidence_id);
    add({
      section: "stale-knowledge",
      semanticState: "stale-claim",
      epistemicKind: "observation",
      actionable: true,
      statement: claim.statement,
      sourceType: "claim",
      sourceId: claim.claim_id,
      evidenceIds: claimEvidence,
    });
  }

  const obligations = ctx.db
    .prepare(
      `SELECT obligation_id, destination_type, destination_id, state, blocking
         FROM revalidation_obligations
        WHERE state NOT IN ('closed','dead-letter') ORDER BY blocking DESC, priority, obligation_id`,
    )
    .all() as Array<{
    obligation_id: string;
    destination_type: string;
    destination_id: string;
    state: string;
    blocking: number;
  }>;
  for (const obligation of obligations) {
    add({
      section: "open-obligations",
      semanticState: "open-obligation",
      epistemicKind: "observation",
      actionable: true,
      statement: `${obligation.state}${obligation.blocking ? " blocking" : ""} obligation for ${obligation.destination_type}:${obligation.destination_id}.`,
      sourceType: "obligation",
      sourceId: obligation.obligation_id,
    });
  }

  const questions = ctx.db
    .prepare("SELECT id, question FROM open_questions WHERE resolution='open' ORDER BY id")
    .all() as Array<{ id: number; question: string }>;
  for (const question of questions) {
    add({
      section: "unknowns",
      semanticState: "unknown",
      epistemicKind: "open-question",
      actionable: false,
      statement: question.question,
      sourceType: "open-question",
      sourceId: String(question.id),
    });
  }
  const suspicions = ctx.db
    .prepare(
      "SELECT id, observation FROM field_notes WHERE category='candidate-concern' AND follow_up='open' ORDER BY id",
    )
    .all() as Array<{ id: number; observation: string }>;
  for (const suspicion of suspicions) {
    add({
      section: "unknowns",
      semanticState: "unverified-suspicion",
      epistemicKind: "open-question",
      actionable: false,
      statement: suspicion.observation,
      sourceType: "field-note",
      sourceId: String(suspicion.id),
    });
  }

  const order = new Map(SECTIONS.map((section, index) => [section, index]));
  items.sort(
    (left, right) =>
      (order.get(left.section) ?? 99) - (order.get(right.section) ?? 99) ||
      itemId(left).localeCompare(itemId(right)),
  );
  const duplicateIds = items.map(itemId);
  if (new Set(duplicateIds).size !== duplicateIds.length) {
    throw new ToolError("review item identity collision");
  }
  const uncitedActionable = items.filter(
    (item) =>
      item.actionable && item.sourceType !== "obligation" && (item.evidenceIds?.length ?? 0) === 0,
  );
  if (uncitedActionable.length > 0) {
    throw new ToolError(
      `actionable review items require cited evidence: ${uncitedActionable.map((item) => `${item.sourceType}:${item.sourceId}`).join(", ")}`,
    );
  }
  const counts = Object.fromEntries(
    SECTIONS.map((section) => [section, items.filter((item) => item.section === section).length]),
  );
  const summary = {
    schema_version: 1,
    review_session_id: reviewSessionId,
    composition_run_id: compositionRunId,
    reviewed_sha: impact.head_sha,
    counts,
    item_count: items.length,
    actionable_count: items.filter((item) => item.actionable).length,
    epistemic_contract: {
      observation: "direct durable state",
      inference: "classification derived by an operational rule",
      "open-question": "not authorized as a finding",
    },
  };
  const summaryJson = stableJson(summary);
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT INTO review_sessions
           (review_session_id, composition_run_id, impact_run_id, reviewed_sha,
            item_count, actionable_count, summary_json, summary_hash, prepared_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        reviewSessionId,
        compositionRunId,
        composition.impact_run_id,
        impact.head_sha,
        items.length,
        summary.actionable_count,
        summaryJson,
        hash(summaryJson),
        preparedBy,
      );
    const itemInsert = ctx.db.prepare(
      `INSERT INTO review_session_items
         (review_session_id, item_id, ordinal, section, semantic_state,
          epistemic_kind, actionable, statement, source_type, source_id,
          record_uri, compact_json, compact_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const evidenceInsert = ctx.db.prepare(
      `INSERT INTO review_session_item_evidence
         (review_session_id, item_id, evidence_id, role) VALUES (?, ?, ?, 'supports')`,
    );
    items.forEach((item, ordinal) => {
      const id = itemId(item);
      const compact = {
        item_id: id,
        section: item.section,
        semantic_state: item.semanticState,
        epistemic_kind: item.epistemicKind,
        actionable: item.actionable,
        statement: item.statement,
        record_uri: recordUri(item),
        expansion: { tool: "expand_review_session_item", item_id: id },
        evidence_count: item.evidenceIds?.length ?? 0,
      };
      const compactJson = stableJson(compact);
      itemInsert.run(
        reviewSessionId,
        id,
        ordinal,
        item.section,
        item.semanticState,
        item.epistemicKind,
        item.actionable ? 1 : 0,
        item.statement,
        item.sourceType,
        item.sourceId,
        recordUri(item),
        compactJson,
        hash(compactJson),
      );
      for (const idValue of item.evidenceIds ?? []) {
        evidenceInsert.run(reviewSessionId, id, idValue);
      }
    });
  })();
  return readSession(ctx, reviewSessionId, null);
}

function readSession(
  ctx: ServerContext,
  reviewSessionId: string,
  section: string | null,
): Record<string, unknown> {
  const session = getSession(ctx, reviewSessionId);
  if (section && !SECTIONS.includes(section as Section))
    throw new ToolError(`unknown review section: ${section}`);
  const items = (
    section
      ? ctx.db
          .prepare(
            "SELECT compact_json FROM review_session_items WHERE review_session_id=? AND section=? ORDER BY ordinal",
          )
          .all(reviewSessionId, section)
      : ctx.db
          .prepare(
            "SELECT compact_json FROM review_session_items WHERE review_session_id=? ORDER BY ordinal",
          )
          .all(reviewSessionId)
  ) as Array<{ compact_json: string }>;
  const completion = ctx.db
    .prepare("SELECT * FROM review_session_completions WHERE review_session_id=?")
    .get(reviewSessionId) as
    | (Record<string, unknown> & { advice_item_ids_json: string; decisions_json: string })
    | undefined;
  return {
    ...session,
    summary: JSON.parse(session.summary_json),
    items: items.map((row) => JSON.parse(row.compact_json)),
    completion: completion
      ? {
          ...completion,
          advice_item_ids: JSON.parse(completion.advice_item_ids_json),
          decisions: JSON.parse(completion.decisions_json),
        }
      : null,
    exports: ctx.db
      .prepare("SELECT * FROM review_exports WHERE review_session_id=?")
      .all(reviewSessionId),
    evaluations: ctx.db
      .prepare(
        "SELECT * FROM review_session_evaluations WHERE review_session_id=? ORDER BY recorded_at",
      )
      .all(reviewSessionId),
  };
}

function sourceRecord(ctx: ServerContext, sourceType: string, sourceId: string): unknown {
  if (sourceType === "finding")
    return ctx.db.prepare("SELECT * FROM findings WHERE finding_id=?").get(sourceId);
  if (sourceType === "claim")
    return ctx.db.prepare("SELECT * FROM claims WHERE claim_id=?").get(sourceId);
  if (sourceType === "obligation")
    return ctx.db
      .prepare("SELECT * FROM revalidation_obligations WHERE obligation_id=?")
      .get(sourceId);
  if (sourceType === "open-question")
    return ctx.db.prepare("SELECT * FROM open_questions WHERE id=?").get(Number(sourceId));
  if (sourceType === "field-note")
    return ctx.db.prepare("SELECT * FROM field_notes WHERE id=?").get(Number(sourceId));
  if (sourceType === "composition") {
    return ctx.db
      .prepare(
        "SELECT * FROM composition_reconciliations WHERE run_id=? ORDER BY reconciliation_id DESC LIMIT 1",
      )
      .get(sourceId);
  }
  if (sourceType === "change-file") {
    const split = sourceId.lastIndexOf(":");
    return ctx.db
      .prepare("SELECT * FROM change_impact_files WHERE run_id=? AND ordinal=?")
      .get(sourceId.slice(0, split), Number(sourceId.slice(split + 1)));
  }
  if (sourceType === "review-hypothesis") {
    return ctx.db.prepare("SELECT * FROM review_hypotheses WHERE hypothesis_id=?").get(sourceId);
  }
  return null;
}

function expand(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const reviewSessionId = requireString(args, "review_session_id");
  const id = requireString(args, "item_id");
  const item = ctx.db
    .prepare("SELECT * FROM review_session_items WHERE review_session_id=? AND item_id=?")
    .get(reviewSessionId, id) as
    | (Record<string, unknown> & {
        source_type: string;
        source_id: string;
        compact_json: string;
      })
    | undefined;
  if (!item) throw new ToolError(`unknown review item: ${id}`);
  const evidence = ctx.db
    .prepare(
      `SELECT e.*, l.role FROM review_session_item_evidence l
        JOIN evidence e ON e.id=l.evidence_id
       WHERE l.review_session_id=? AND l.item_id=? ORDER BY e.id`,
    )
    .all(reviewSessionId, id);
  return {
    compact: JSON.parse(item.compact_json),
    source_record: sourceRecord(ctx, item.source_type, item.source_id),
    evidence,
    back_link: {
      tool: "get_review_session",
      review_session_id: reviewSessionId,
      item_id: id,
    },
  };
}

function parseDecisions(
  value: unknown,
): Array<{ item_id: string; disposition: string; rationale: string }> {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new ToolError("decisions must be an array");
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ToolError(`decisions[${index}] must be an object`);
    }
    const row = entry as Record<string, unknown>;
    const item = requireString(row, "item_id");
    if (seen.has(item)) throw new ToolError(`duplicate decision item_id: ${item}`);
    seen.add(item);
    const disposition = requireString(row, "disposition");
    if (!["accepted", "rejected", "deferred"].includes(disposition)) {
      throw new ToolError(`unknown decision disposition: ${disposition}`);
    }
    return { item_id: item, disposition, rationale: requireString(row, "rationale") };
  });
}

function complete(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const completedBy = requireActiveSession(ctx, "complete_review_session");
  const reviewSessionId = requireString(args, "review_session_id");
  const session = getSession(ctx, reviewSessionId);
  if (session.status !== "prepared") throw new ToolError(`review session is ${session.status}`);
  const adviceIds = [
    ...new Set(requireStringArray(args, "advice_item_ids", { minLength: 1 })),
  ].sort();
  const known = new Set(
    (
      ctx.db
        .prepare("SELECT item_id FROM review_session_items WHERE review_session_id=?")
        .all(reviewSessionId) as Array<{ item_id: string }>
    ).map((row) => row.item_id),
  );
  const unknownAdvice = adviceIds.filter((id) => !known.has(id));
  if (unknownAdvice.length > 0)
    throw new ToolError(`unknown advice items: ${unknownAdvice.join(", ")}`);
  const decisions = parseDecisions(args.decisions);
  const adviceSet = new Set(adviceIds);
  const unfurnished = decisions.filter((decision) => !adviceSet.has(decision.item_id));
  if (unfurnished.length > 0)
    throw new ToolError("decisions may reference only advice actually furnished");
  const accepted = decisions.filter((decision) => decision.disposition === "accepted").length;
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT INTO review_session_completions
           (review_session_id, advice_item_ids_json, advice_count, decisions_json,
            decision_count, accepted_count, completion_note, completed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        reviewSessionId,
        JSON.stringify(adviceIds),
        adviceIds.length,
        stableJson(decisions),
        decisions.length,
        accepted,
        requireString(args, "completion_note"),
        completedBy,
      );
    ctx.db
      .prepare(
        "UPDATE review_sessions SET status='furnished', furnished_at=datetime('now') WHERE review_session_id=?",
      )
      .run(reviewSessionId);
  })();
  return readSession(ctx, reviewSessionId, null);
}

function exportPath(ctx: ServerContext, path: string): string {
  return resolveStorageOutputPath(ctx.project, path, "review export path");
}

function exportPayload(ctx: ServerContext, reviewSessionId: string): Record<string, unknown> {
  const session = readSession(ctx, reviewSessionId, null);
  return {
    schema_version: 1,
    review_session_id: reviewSessionId,
    reviewed_sha: session.reviewed_sha,
    status: session.status,
    summary: session.summary,
    items: session.items,
    completion: session.completion,
  };
}

function renderMarkdown(payload: Record<string, unknown>): string {
  const summary = payload.summary as { actionable_count: number; item_count: number };
  const lines = [
    `# Review ${payload.review_session_id}`,
    "",
    `Reviewed state: \`${payload.reviewed_sha}\``,
    `Items: ${summary.item_count}; actionable: ${summary.actionable_count}`,
    "",
  ];
  const items = payload.items as Array<Record<string, unknown>>;
  for (const section of SECTIONS) {
    const sectionItems = items.filter((item) => item.section === section);
    lines.push(`## ${section}`, "");
    if (sectionItems.length === 0) lines.push("_No recorded items._", "");
    for (const item of sectionItems) {
      lines.push(
        `- **${item.semantic_state}** (${item.epistemic_kind}) ${item.statement} ` +
          `[record](${item.record_uri}) · expand \`${item.item_id}\``,
      );
    }
    if (sectionItems.length > 0) lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function writeExport(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const exportedBy = requireActiveSession(ctx, "export_review_session");
  const reviewSessionId = requireString(args, "review_session_id");
  const session = getSession(ctx, reviewSessionId);
  if (session.status !== "furnished")
    throw new ToolError("review session must be furnished before export");
  if (
    ctx.db.prepare("SELECT 1 FROM review_exports WHERE review_session_id=?").get(reviewSessionId)
  ) {
    throw new ToolError(`review session already exported: ${reviewSessionId}`);
  }
  const exportId = requireString(args, "export_id");
  const jsonPath = `reviews/${reviewSessionId}/review.json`;
  const markdownPath = `reviews/${reviewSessionId}/review.md`;
  const payload = exportPayload(ctx, reviewSessionId);
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  const markdown = renderMarkdown(payload);
  const jsonAbsolute = exportPath(ctx, jsonPath);
  const markdownAbsolute = exportPath(ctx, markdownPath);
  mkdirSync(dirname(jsonAbsolute), { recursive: true });
  writeFileSync(jsonAbsolute, json, "utf8");
  writeFileSync(markdownAbsolute, markdown, "utf8");
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT INTO review_exports
           (export_id, review_session_id, json_path, markdown_path, json_hash,
            markdown_hash, item_count, export_json, exported_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        exportId,
        reviewSessionId,
        jsonPath,
        markdownPath,
        hash(json),
        hash(markdown),
        session.item_count,
        stableJson(payload),
        exportedBy,
      );
    const artifact = ctx.db.prepare(
      `INSERT INTO artifacts (path, kind, content_hash, ref_sha, session_id, bytes, notes)
       VALUES (?, 'other', ?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET content_hash=excluded.content_hash,
         ref_sha=excluded.ref_sha, session_id=excluded.session_id, bytes=excluded.bytes,
         notes=excluded.notes, written_at=datetime('now')`,
    );
    artifact.run(
      jsonPath,
      hash(json),
      session.reviewed_sha,
      exportedBy,
      Buffer.byteLength(json),
      `review export ${exportId}`,
    );
    artifact.run(
      markdownPath,
      hash(markdown),
      session.reviewed_sha,
      exportedBy,
      Buffer.byteLength(markdown),
      `review export ${exportId}`,
    );
  })();
  return {
    export_id: exportId,
    review_session_id: reviewSessionId,
    json_path: jsonPath,
    markdown_path: markdownPath,
    json_hash: hash(json),
    markdown_hash: hash(markdown),
    item_count: session.item_count,
  };
}

function verifyExport(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const verifiedBy = requireActiveSession(ctx, "verify_review_export");
  const exportId = requireString(args, "export_id");
  const row = ctx.db.prepare("SELECT * FROM review_exports WHERE export_id=?").get(exportId) as
    | {
        review_session_id: string;
        json_path: string;
        markdown_path: string;
        json_hash: string;
        markdown_hash: string;
        item_count: number;
      }
    | undefined;
  if (!row) throw new ToolError(`unknown review export: ${exportId}`);
  const expected = exportPayload(ctx, row.review_session_id);
  const expectedItems = expected.items as Array<Record<string, unknown>>;
  const mismatches: Array<{ axis: string; object: string; detail: string }> = [];
  let actual: Record<string, unknown> | null = null;
  let rawJson = "";
  let rawMarkdown = "";
  try {
    rawJson = readFileSync(exportPath(ctx, row.json_path), "utf8");
    actual = JSON.parse(rawJson) as Record<string, unknown>;
  } catch (error) {
    mismatches.push({
      axis: "state",
      object: row.json_path,
      detail: `unreadable JSON: ${String(error)}`,
    });
  }
  try {
    rawMarkdown = readFileSync(exportPath(ctx, row.markdown_path), "utf8");
  } catch (error) {
    mismatches.push({
      axis: "state",
      object: row.markdown_path,
      detail: `unreadable Markdown: ${String(error)}`,
    });
  }
  if (actual) {
    for (const [field, wanted] of [
      ["review_session_id", expected.review_session_id],
      ["reviewed_sha", expected.reviewed_sha],
      ["status", expected.status],
    ] as Array<[string, unknown]>) {
      if (actual[field] !== wanted) {
        mismatches.push({
          axis: "state",
          object: field,
          detail: `expected ${String(wanted)}, got ${String(actual[field])}`,
        });
      }
    }
    const actualItems = Array.isArray(actual.items)
      ? (actual.items as Array<Record<string, unknown>>)
      : [];
    const expectedIds = expectedItems.map((item) => item.item_id).sort();
    const actualIds = actualItems.map((item) => item.item_id).sort();
    if (
      stableJson(expectedIds) !== stableJson(actualIds) ||
      actualItems.length !== row.item_count
    ) {
      mismatches.push({
        axis: "coverage",
        object: "review-items",
        detail: `expected ${expectedIds.length} exact item ids, got ${actualIds.length}`,
      });
    }
    if (stableJson(actualItems) !== stableJson(expectedItems)) {
      mismatches.push({
        axis: "content",
        object: "review-items",
        detail: "semantic item payload differs from source",
      });
    }
    if (stableJson(actual.summary) !== stableJson(expected.summary)) {
      mismatches.push({
        axis: "content",
        object: "summary",
        detail: "derived summary differs from source",
      });
    }
    if (stableJson(actual.completion) !== stableJson(expected.completion)) {
      mismatches.push({
        axis: "content",
        object: "completion",
        detail: "advice/decision custody differs from source",
      });
    }
  }
  if (rawJson && hash(rawJson) !== row.json_hash) {
    mismatches.push({
      axis: "content",
      object: row.json_path,
      detail: "JSON hash differs from publication",
    });
  }
  if (rawMarkdown && hash(rawMarkdown) !== row.markdown_hash) {
    mismatches.push({
      axis: "content",
      object: row.markdown_path,
      detail: "Markdown hash differs from publication",
    });
  }
  const stateOk = !mismatches.some((item) => item.axis === "state");
  const coverageOk = !mismatches.some((item) => item.axis === "coverage");
  const contentOk = !mismatches.some((item) => item.axis === "content");
  const report = {
    schema_version: 1,
    export_id: exportId,
    review_session_id: row.review_session_id,
    axes: {
      state: { ok: stateOk },
      coverage: { ok: coverageOk, expected_items: expectedItems.length },
      content: { ok: contentOk },
    },
    mismatch_count: mismatches.length,
    mismatches,
    ok: stateOk && coverageOk && contentOk,
  };
  const reportJson = stableJson(report);
  ctx.db
    .prepare(
      `INSERT INTO review_export_verifications
         (export_id, state_ok, coverage_ok, content_ok, ok, mismatch_count,
          report_json, report_hash, verified_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      exportId,
      stateOk ? 1 : 0,
      coverageOk ? 1 : 0,
      contentOk ? 1 : 0,
      report.ok ? 1 : 0,
      mismatches.length,
      reportJson,
      hash(reportJson),
      verifiedBy,
    );
  return report;
}

function recordEvaluation(
  args: Record<string, unknown>,
  ctx: ServerContext,
): Record<string, unknown> {
  const recordedBy = requireActiveSession(ctx, "record_review_session_evaluation");
  const reviewSessionId = requireString(args, "review_session_id");
  getSession(ctx, reviewSessionId);
  const verificationMinutes = Number(args.verification_minutes);
  if (!Number.isFinite(verificationMinutes) || verificationMinutes < 0) {
    throw new ToolError("verification_minutes must be a non-negative number");
  }
  const denominator = requireInt(args, "constraint_denominator");
  const missed = requireInt(args, "missed_constraint_count");
  const expansions = requireInt(args, "expansion_count");
  if (denominator <= 0 || missed < 0 || missed > denominator || expansions < 0) {
    throw new ToolError("review evaluation counts are inconsistent");
  }
  const satisfaction = optInt(args, "satisfaction_score");
  if (satisfaction !== null && (satisfaction < 1 || satisfaction > 5)) {
    throw new ToolError("satisfaction_score must be 1..5");
  }
  const evaluationId = requireString(args, "evaluation_id");
  ctx.db
    .prepare(
      `INSERT INTO review_session_evaluations
         (evaluation_id, review_session_id, verification_minutes,
          constraint_denominator, missed_constraint_count, expansion_count,
          satisfaction_score, notes, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      evaluationId,
      reviewSessionId,
      verificationMinutes,
      denominator,
      missed,
      expansions,
      satisfaction,
      optString(args, "notes"),
      recordedBy,
    );
  return {
    evaluation_id: evaluationId,
    review_session_id: reviewSessionId,
    verification_minutes: verificationMinutes,
    constraint_denominator: denominator,
    missed_constraint_count: missed,
    expansion_count: expansions,
    satisfaction_score: satisfaction,
  };
}

export const reviewSessionTools: ToolDefinition[] = [
  {
    name: "compile_review_session",
    description:
      "Compile a compact decision surface from one reconciled composition run. It operationally distinguishes changed situation, active findings, survived/contested/defeated challenges, regressions, latent defects, stale knowledge, open obligations, unknowns, unverified suspicions, and ruled-out or fixed history.",
    inputSchema: {
      type: "object",
      properties: {
        review_session_id: { type: "string" },
        composition_run_id: { type: "string" },
      },
      required: ["review_session_id", "composition_run_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => compile(args, ctx),
  },
  {
    name: "get_review_session",
    description:
      "Read the compact review situation, optionally one named section, plus advice-versus-decision completion custody, exports, and measured verification evaluations. Compact items expose stable record URIs and a one-call expansion pointer.",
    inputSchema: {
      type: "object",
      properties: {
        review_session_id: { type: "string" },
        section: { type: "string", enum: SECTIONS },
      },
      required: ["review_session_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) =>
      readSession(ctx, requireString(args, "review_session_id"), optString(args, "section")),
  },
  {
    name: "expand_review_session_item",
    description:
      "Expand one compact review item directly to its durable source record and structured evidence, with a backlink to the parent review. This is the single progressive-disclosure hop for every actionable claim.",
    inputSchema: {
      type: "object",
      properties: {
        review_session_id: { type: "string" },
        item_id: { type: "string" },
      },
      required: ["review_session_id", "item_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => expand(args, ctx),
  },
  {
    name: "complete_review_session",
    description:
      "Record which advice items were actually furnished and any user decisions separately. A decision can reference only furnished advice; absence of an accepted decision never becomes implicit acceptance.",
    inputSchema: {
      type: "object",
      properties: {
        review_session_id: { type: "string" },
        advice_item_ids: { type: "array", items: { type: "string" }, minItems: 1 },
        decisions: { type: "array", items: { type: "object" } },
        completion_note: { type: "string" },
      },
      required: ["review_session_id", "advice_item_ids", "completion_note"],
      additionalProperties: false,
    },
    handler: (args, ctx) => complete(args, ctx),
  },
  {
    name: "export_review_session",
    description:
      "Generate canonical JSON and Markdown under project storage from a furnished review session, with stable item identifiers, record links, expansion pointers, and an immutable publication hash. The export remains derived, never authoritative.",
    inputSchema: {
      type: "object",
      properties: {
        review_session_id: { type: "string" },
        export_id: { type: "string" },
      },
      required: ["review_session_id", "export_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => writeExport(args, ctx),
  },
  {
    name: "verify_review_export",
    description:
      "Read the canonical export paths back and independently reconcile state, exact item coverage, and semantic content against the source review session. Label swaps, missing unknowns, path errors, and edited completion custody turn RED.",
    inputSchema: {
      type: "object",
      properties: { export_id: { type: "string" } },
      required: ["export_id"],
      additionalProperties: false,
    },
    handler: (args, ctx) => verifyExport(args, ctx),
  },
  {
    name: "record_review_session_evaluation",
    description:
      "Record decision-surface usability as verification minutes, missed constraints over an explicit denominator, and expansion count; satisfaction is optional context and cannot replace the task metrics.",
    inputSchema: {
      type: "object",
      properties: {
        evaluation_id: { type: "string" },
        review_session_id: { type: "string" },
        verification_minutes: { type: "number", minimum: 0 },
        constraint_denominator: { type: "integer", minimum: 1 },
        missed_constraint_count: { type: "integer", minimum: 0 },
        expansion_count: { type: "integer", minimum: 0 },
        satisfaction_score: { type: "integer", minimum: 1, maximum: 5 },
        notes: { type: "string" },
      },
      required: [
        "evaluation_id",
        "review_session_id",
        "verification_minutes",
        "constraint_denominator",
        "missed_constraint_count",
        "expansion_count",
      ],
      additionalProperties: false,
    },
    handler: (args, ctx) => recordEvaluation(args, ctx),
  },
];
