import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  optBool,
  optString,
  requireEnum,
  requireInt,
  requireString,
  requireStringArray,
  type ServerContext,
  type ToolDefinition,
  ToolError,
} from "../helpers.js";
import { requireActiveSession } from "../invariants.js";

const DESTINATION_FIELDS = [
  "premise",
  "accepted-option",
  "alternative",
  "constraint",
  "consequence",
  "falsifier",
  "review-hypothesis",
] as const;
const EVIDENCE_KINDS = ["code-claim", "repository-evidence", "decision-premise"] as const;
const ACCESS_STATUSES = [
  "directly-read",
  "snippet",
  "via-agent",
  "unread-hop",
  "inaccessible",
] as const;
const CLASSIFICATIONS = [
  "established",
  "contested",
  "underdetermined",
  "inferred",
  "open-question",
] as const;
const CONFIDENCES = [
  "verified",
  "corroborated",
  "single-source",
  "inferred",
  "unverified",
] as const;
const TARGET_KINDS = ["hypothesis", "option", "decision-premise", "confidence-reason"] as const;
const EFFECT_KINDS = [...TARGET_KINDS, "no-change"] as const;
const INITIAL_STATES = ["rejected", "deferred", "admitted"] as const;
const QUEUE_STATES = [...INITIAL_STATES, "dispatched", "landed", "consumed", "expired"] as const;
const INFORMATION_VALUE_THRESHOLD = 9;

interface ResearchRequestRow {
  request_id: string;
  status: (typeof QUEUE_STATES)[number];
  contract_json: string;
  decision_id: string | null;
  decision_revision_id: string | null;
  destination_field: string | null;
  destination_ref: string | null;
  current_evidence_json: string;
  needed_source_classes_json: string;
  disconfirmers_json: string;
  budget_json: string;
  uncertainty: string;
}

interface DecisionRevisionRow {
  revision_id: string;
  decision_id: string;
  status: string;
  accepted_option_json: string;
  alternatives_json: string;
  constraints_json: string;
  consequences_json: string;
  falsifiers_json: string;
  premises_json: string;
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalize(item)]),
    );
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function hash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireObjects(
  value: unknown,
  field: string,
  minimum = 0,
): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length < minimum) {
    throw new ToolError(`${field} must contain at least ${minimum} object(s)`);
  }
  return value.map((item, index) => requireObject(item, `${field}[${index}]`));
}

function uniqueStrings(value: unknown, field: string, minimum = 0): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string" && item.length > 0)
  ) {
    throw new ToolError(`${field} must contain only non-empty strings`);
  }
  const unique = [...new Set(value as string[])];
  if (unique.length < minimum)
    throw new ToolError(`${field} must contain at least ${minimum} item(s)`);
  return unique;
}

function requiredBoundedInt(
  object: Record<string, unknown>,
  field: string,
  minimum: number,
  maximum: number,
): number {
  const value = requireInt(object, field);
  if (value < minimum || value > maximum) {
    throw new ToolError(`${field} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function questionFingerprint(question: string): string {
  const normalizedQuestion = question
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
  return createHash("sha256").update(normalizedQuestion).digest("hex");
}

function revision(ctx: ServerContext, revisionId: string): DecisionRevisionRow | null {
  return (
    (ctx.db.prepare("SELECT * FROM decision_revisions WHERE revision_id=?").get(revisionId) as
      | DecisionRevisionRow
      | undefined) ?? null
  );
}

function destinationExists(
  ctx: ServerContext,
  row: DecisionRevisionRow,
  field: (typeof DESTINATION_FIELDS)[number],
  ref: string,
): boolean {
  if (field === "review-hypothesis") {
    return !!ctx.db.prepare("SELECT 1 FROM review_hypotheses WHERE hypothesis_id=?").get(ref);
  }
  if (field === "accepted-option") {
    const option = JSON.parse(row.accepted_option_json) as Record<string, unknown>;
    return option.option_key === ref;
  }
  const mappings = {
    premise: [row.premises_json, "premise_id"],
    alternative: [row.alternatives_json, "option_key"],
    constraint: [row.constraints_json, "constraint_id"],
    consequence: [row.consequences_json, "consequence_id"],
    falsifier: [row.falsifiers_json, "falsifier_id"],
  } as const;
  const [json, idKey] = mappings[field];
  return (JSON.parse(json) as Array<Record<string, unknown>>).some((item) => item[idKey] === ref);
}

function evidenceProblems(
  ctx: ServerContext,
  evidence: Array<Record<string, unknown>>,
  decisionRevision: DecisionRevisionRow | null,
): string[] {
  const problems: string[] = [];
  const premiseIds = new Set(
    decisionRevision
      ? (JSON.parse(decisionRevision.premises_json) as Array<Record<string, unknown>>).map((item) =>
          String(item.premise_id),
        )
      : [],
  );
  const premises = new Map(
    decisionRevision
      ? (JSON.parse(decisionRevision.premises_json) as Array<Record<string, unknown>>).map(
          (item) => [String(item.premise_id), String(item.statement)],
        )
      : [],
  );
  for (const [index, item] of evidence.entries()) {
    const kind = requireEnum(item, "kind", EVIDENCE_KINDS);
    const ref = requireString(item, "ref");
    const statement = requireString(item, "statement");
    if (kind === "code-claim") {
      const claim = ctx.db
        .prepare("SELECT statement, valid_until_sha FROM claims WHERE claim_id=?")
        .get(ref) as { statement: string; valid_until_sha: string | null } | undefined;
      if (!claim || claim.valid_until_sha !== null)
        problems.push(`current_evidence[${index}] code claim is not current`);
      else if (claim.statement !== statement)
        problems.push(`current_evidence[${index}] statement does not match the code claim`);
    } else if (kind === "repository-evidence") {
      const evidenceId = Number(ref);
      const repositoryEvidence = Number.isInteger(evidenceId)
        ? (ctx.db.prepare("SELECT excerpt, note FROM evidence WHERE id=?").get(evidenceId) as
            | { excerpt: string | null; note: string | null }
            | undefined)
        : undefined;
      if (!repositoryEvidence) {
        problems.push(`current_evidence[${index}] repository evidence does not resolve`);
      } else if (!repositoryEvidence.excerpt && !repositoryEvidence.note) {
        problems.push(`current_evidence[${index}] repository evidence has no textual anchor`);
      } else if (![repositoryEvidence.excerpt, repositoryEvidence.note].includes(statement)) {
        problems.push(`current_evidence[${index}] statement does not match repository evidence`);
      }
    } else if (!premiseIds.has(ref)) {
      problems.push(`current_evidence[${index}] decision premise does not resolve`);
    } else if (premises.get(ref) !== statement) {
      problems.push(`current_evidence[${index}] statement does not match the decision premise`);
    }
  }
  return problems;
}

function request(ctx: ServerContext, requestId: string): ResearchRequestRow {
  const row = ctx.db.prepare("SELECT * FROM research_requests WHERE request_id=?").get(requestId) as
    | ResearchRequestRow
    | undefined;
  if (!row) throw new ToolError(`unknown research request: ${requestId}`);
  return row;
}

function transition(
  ctx: ServerContext,
  row: ResearchRequestRow,
  toState: (typeof QUEUE_STATES)[number],
  reason: string,
  detail: Record<string, unknown> = {},
): void {
  const sessionId = requireActiveSession(ctx, `transition research request to ${toState}`);
  ctx.db
    .prepare(
      `INSERT INTO research_request_events
         (request_id, from_state, to_state, reason, detail_json, actor)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(row.request_id, row.status, toState, reason, stableJson(detail), sessionId);
  if (toState === "consumed" || toState === "expired") {
    ctx.db
      .prepare(
        `UPDATE research_requests
            SET status=?, updated_at=datetime('now'), terminal_at=datetime('now')
          WHERE request_id=?`,
      )
      .run(toState, row.request_id);
  } else {
    ctx.db
      .prepare(
        `UPDATE research_requests SET status=?, updated_at=datetime('now') WHERE request_id=?`,
      )
      .run(toState, row.request_id);
  }
}

function parseDestination(
  args: Record<string, unknown>,
  ctx: ServerContext,
): {
  contract: Record<string, unknown> | null;
  decision: DecisionRevisionRow | null;
  field: (typeof DESTINATION_FIELDS)[number] | null;
  ref: string | null;
  problems: string[];
} {
  if (args.decision_destination == null) {
    return {
      contract: null,
      decision: null,
      field: null,
      ref: null,
      problems: ["no decision destination; curiosity-only research is outside the blocking queue"],
    };
  }
  const destination = requireObject(args.decision_destination, "decision_destination");
  const decisionId = requireString(destination, "decision_id");
  const revisionId = requireString(destination, "revision_id");
  const field = requireEnum(destination, "field", DESTINATION_FIELDS);
  const ref = requireString(destination, "ref");
  const row = revision(ctx, revisionId);
  const problems: string[] = [];
  if (!row || row.decision_id !== decisionId) {
    problems.push("decision destination does not resolve to the named revision");
  } else if (!destinationExists(ctx, row, field, ref)) {
    problems.push("decision destination field/ref does not exist in the named revision");
  }
  return {
    contract: { decision_id: decisionId, revision_id: revisionId, field, ref },
    decision: row?.decision_id === decisionId ? row : null,
    field,
    ref,
    problems,
  };
}

function propose(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const sessionId = requireActiveSession(ctx, "propose_research_request");
  const requestId = requireString(args, "request_id");
  if (ctx.db.prepare("SELECT 1 FROM research_requests WHERE request_id=?").get(requestId)) {
    throw new ToolError(`research request already exists: ${requestId}`);
  }
  const question = requireString(args, "question");
  const uncertainty = requireString(args, "uncertainty");
  const destination = parseDestination(args, ctx);
  const currentEvidence = requireObjects(args.current_evidence, "current_evidence");
  const neededSourceClasses = uniqueStrings(args.needed_source_classes, "needed_source_classes");
  const disconfirmers = uniqueStrings(args.disconfirmers, "disconfirmers");
  const changedPremiseRefs = uniqueStrings(args.changed_premise_refs ?? [], "changed_premise_refs");
  const localSearch = requireObject(args.local_evidence_search, "local_evidence_search");
  const localOutcome = requireEnum(localSearch, "outcome", [
    "exhausted",
    "not-run",
    "found-answer",
  ] as const);
  const localQueries = uniqueStrings(localSearch.queries, "local_evidence_search.queries");
  const localLocations = uniqueStrings(localSearch.locations, "local_evidence_search.locations");
  const unresolvedReason =
    typeof localSearch.unresolved_reason === "string" ? localSearch.unresolved_reason : "";
  const budget = requireObject(args.budget, "budget");
  const maxSources = requiredBoundedInt(budget, "max_sources", 1, 20);
  const maxMinutes = requiredBoundedInt(budget, "max_minutes", 5, 1440);
  const informationValue = requireObject(
    args.expected_information_value,
    "expected_information_value",
  );
  const decisionSensitivity = requiredBoundedInt(informationValue, "decision_sensitivity", 1, 5);
  const uncertaintyReducibility = requiredBoundedInt(
    informationValue,
    "uncertainty_reducibility",
    1,
    5,
  );
  const score = decisionSensitivity * uncertaintyReducibility;
  const fingerprint = questionFingerprint(question);
  const reasons = [...destination.problems];
  reasons.push(...evidenceProblems(ctx, currentEvidence, destination.decision));

  if (destination.decision) {
    const premiseIds = new Set(
      (JSON.parse(destination.decision.premises_json) as Array<Record<string, unknown>>).map(
        (item) => String(item.premise_id),
      ),
    );
    for (const premiseRef of changedPremiseRefs) {
      if (!premiseIds.has(premiseRef))
        reasons.push(`changed premise does not exist: ${premiseRef}`);
    }
  } else if (changedPremiseRefs.length > 0) {
    reasons.push("changed premises require a valid decision revision");
  }

  let duplicateOf: string | null = null;
  if (destination.decision && destination.field && destination.ref) {
    const duplicate = ctx.db
      .prepare(
        `SELECT request_id FROM research_requests
          WHERE question_fingerprint=? AND decision_revision_id=?
            AND destination_field=? AND destination_ref=?
          ORDER BY created_at, request_id LIMIT 1`,
      )
      .get(fingerprint, destination.decision.revision_id, destination.field, destination.ref) as
      | { request_id: string }
      | undefined;
    if (duplicate) {
      duplicateOf = duplicate.request_id;
      if (changedPremiseRefs.length === 0) {
        reasons.push(`duplicate of ${duplicate.request_id}; no changed premise named`);
      }
    }
  }

  const relevanceFailure = destination.problems.length > 0;
  const duplicateFailure = duplicateOf !== null && changedPremiseRefs.length === 0;
  let status: (typeof INITIAL_STATES)[number];
  if (relevanceFailure || duplicateFailure) {
    status = "rejected";
  } else {
    if (currentEvidence.length === 0) reasons.push("no current local evidence is anchored");
    if (
      localOutcome !== "exhausted" ||
      localQueries.length === 0 ||
      localLocations.length === 0 ||
      unresolvedReason.length === 0
    ) {
      reasons.push("local evidence search is not exhausted with a recorded unresolved reason");
    }
    if (neededSourceClasses.length === 0) reasons.push("no needed external source class is named");
    if (disconfirmers.length === 0) reasons.push("no disconfirming observation is named");
    if (score < INFORMATION_VALUE_THRESHOLD) {
      reasons.push(
        `expected information value ${score} is below threshold ${INFORMATION_VALUE_THRESHOLD}`,
      );
    }
    status = reasons.length === 0 ? "admitted" : "deferred";
  }
  if (status === "admitted") reasons.push(`admitted at expected information value ${score}`);
  const blocking = status === "rejected" ? false : optBool(args, "blocking", false);
  const contract = {
    schema_version: "1.0.0",
    request_id: requestId,
    question,
    decision_destination: destination.contract,
    current_evidence: currentEvidence,
    uncertainty,
    needed_source_classes: neededSourceClasses,
    disconfirmers,
    budget: { max_sources: maxSources, max_minutes: maxMinutes },
    local_evidence_search: {
      outcome: localOutcome,
      queries: localQueries,
      locations: localLocations,
      unresolved_reason: unresolvedReason,
    },
    expected_information_value: {
      decision_sensitivity: decisionSensitivity,
      uncertainty_reducibility: uncertaintyReducibility,
      score,
      threshold: INFORMATION_VALUE_THRESHOLD,
    },
    changed_premise_refs: changedPremiseRefs,
    duplicate_of: duplicateOf,
    admission: { state: status, reasons, blocking },
  };

  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT INTO research_requests
           (request_id, schema_version, question, question_fingerprint,
            decision_id, decision_revision_id, destination_field, destination_ref,
            current_evidence_json, uncertainty, needed_source_classes_json,
            disconfirmers_json, budget_json, local_search_json,
            decision_sensitivity, uncertainty_reducibility, expected_value_score,
            changed_premise_refs_json, duplicate_of, admission_reasons_json,
            contract_json, contract_hash, status, blocking, created_by, terminal_at)
         VALUES (?, '1.0.0', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 CASE WHEN ?='rejected' THEN datetime('now') ELSE NULL END)`,
      )
      .run(
        requestId,
        question,
        fingerprint,
        destination.decision?.decision_id ?? null,
        destination.decision?.revision_id ?? null,
        destination.decision ? destination.field : null,
        destination.decision ? destination.ref : null,
        stableJson(currentEvidence),
        uncertainty,
        stableJson(neededSourceClasses),
        stableJson(disconfirmers),
        stableJson({ max_sources: maxSources, max_minutes: maxMinutes }),
        stableJson({
          outcome: localOutcome,
          queries: localQueries,
          locations: localLocations,
          unresolved_reason: unresolvedReason,
        }),
        decisionSensitivity,
        uncertaintyReducibility,
        score,
        stableJson(changedPremiseRefs),
        duplicateOf,
        stableJson(reasons),
        stableJson(contract),
        hash(contract),
        status,
        blocking ? 1 : 0,
        sessionId,
        status,
      );
    ctx.db
      .prepare(
        `INSERT INTO research_request_events
           (request_id, from_state, to_state, reason, detail_json, actor)
         VALUES (?, NULL, ?, ?, ?, ?)`,
      )
      .run(
        requestId,
        status,
        reasons.join("; "),
        stableJson({ contract_hash: hash(contract) }),
        sessionId,
      );
  })();
  return { request_id: requestId, status, blocking, duplicate_of: duplicateOf, contract };
}

function durableWorkspace(path: string): string {
  if (!isAbsolute(path)) throw new ToolError("research workspace_path must be absolute");
  const lexical = resolve(path);
  if (!existsSync(lexical) || !statSync(lexical).isDirectory()) {
    throw new ToolError("research workspace must already exist as a durable directory");
  }
  const real = realpathSync(lexical);
  if (
    real === "/tmp" ||
    real.startsWith("/tmp/") ||
    real === "/private/tmp" ||
    real.startsWith("/private/tmp/") ||
    (/^\/private\/var\/folders\//.test(real) && real.includes("/T/"))
  ) {
    throw new ToolError("research workspace cannot be temporary or application scratch storage");
  }
  const segments = real.split(sep);
  if (segments.length < 2 || segments.at(-2) !== "scholiast" || !segments.at(-1)) {
    throw new ToolError("research workspace must be a scholiast/<slug> directory");
  }
  return real;
}

function dispatch(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const sessionId = requireActiveSession(ctx, "dispatch_research_request");
  const row = request(ctx, requireString(args, "request_id"));
  if (row.status !== "admitted")
    throw new ToolError(`research request is ${row.status}, not admitted`);
  const dispatchId = requireString(args, "dispatch_id");
  const workspacePath = durableWorkspace(requireString(args, "workspace_path"));
  const ruledOut = requireStringArray(args, "ruled_out");
  const contract = JSON.parse(row.contract_json) as Record<string, unknown>;
  const requiredOutputPath = join(workspacePath, "claims.md");
  const handoff = {
    schema_version: "scholiast-handoff/1.0.0",
    request_id: row.request_id,
    question: contract.question,
    why_it_matters: row.uncertainty,
    workspace_path: workspacePath,
    required_output_path: requiredOutputPath,
    established: JSON.parse(row.current_evidence_json),
    ruled_out: ruledOut,
    expected_output: {
      claims: "seven-field claim stubs, not narrative verdicts",
      sources:
        "append-only source rows with classification, access status, excerpt, and limitation",
      synthesis: "established, contested, and underdetermined remain distinct",
    },
    source_quality_guidance: {
      needed_source_classes: JSON.parse(row.needed_source_classes_json),
      preference: "primary and venue sources over SEO-ranked summaries",
      cannot_tell: "record what each source class cannot establish",
    },
    held_evidence: (JSON.parse(row.current_evidence_json) as Array<Record<string, unknown>>).map(
      (item) => ({
        locator: item.ref,
        quoted_or_observed_passage: item.statement,
        access_status: "directly-read",
      }),
    ),
    access_status_rule:
      "Report directly-read, snippet, via-agent, unread-hop, or inaccessible for every source; degrade one confidence level per unread hop.",
    disconfirmers: JSON.parse(row.disconfirmers_json),
    budget: JSON.parse(row.budget_json),
    decision_destination: (contract.decision_destination as Record<string, unknown>) ?? null,
  };
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT INTO research_dispatches
           (dispatch_id, request_id, workspace_path, required_output_path,
            handoff_json, handoff_hash, dispatched_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        dispatchId,
        row.request_id,
        workspacePath,
        requiredOutputPath,
        stableJson(handoff),
        hash(handoff),
        sessionId,
      );
    transition(ctx, row, "dispatched", "bounded Scholiast handoff dispatched", {
      dispatch_id: dispatchId,
      handoff_hash: hash(handoff),
    });
  })();
  return { dispatch_id: dispatchId, handoff_hash: hash(handoff), handoff };
}

function artifactManifest(workspacePath: string, value: unknown): Array<Record<string, unknown>> {
  const paths = uniqueStrings(value, "artifact_paths", 1);
  const manifest: Array<Record<string, unknown>> = [];
  for (const path of paths) {
    if (!isAbsolute(path) || !existsSync(path) || !statSync(path).isFile()) {
      throw new ToolError(`research artifact must be an existing absolute file: ${path}`);
    }
    const real = realpathSync(path);
    const rel = relative(workspacePath, real);
    if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new ToolError(`research artifact is outside the dispatched workspace: ${path}`);
    }
    const bytes = readFileSync(real);
    manifest.push({
      path: real,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
    });
  }
  return manifest;
}

function degradation(status: (typeof ACCESS_STATUSES)[number]): number {
  if (status === "directly-read") return 0;
  if (status === "snippet" || status === "via-agent") return 1;
  if (status === "unread-hop") return 2;
  return 3;
}

function targetMatchesRequest(
  row: ResearchRequestRow,
  targetKind: (typeof TARGET_KINDS)[number],
  targetRef: string,
): boolean {
  const expectedKind =
    row.destination_field === "premise"
      ? "decision-premise"
      : row.destination_field === "accepted-option" || row.destination_field === "alternative"
        ? "option"
        : row.destination_field === "review-hypothesis"
          ? "hypothesis"
          : "confidence-reason";
  return targetKind === expectedKind && targetRef === row.destination_ref;
}

function land(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const sessionId = requireActiveSession(ctx, "land_research_result");
  const row = request(ctx, requireString(args, "request_id"));
  if (row.status !== "dispatched")
    throw new ToolError(`research request is ${row.status}, not dispatched`);
  const dispatchRow = ctx.db
    .prepare("SELECT workspace_path FROM research_dispatches WHERE request_id=?")
    .get(row.request_id) as { workspace_path: string } | undefined;
  if (!dispatchRow) throw new ToolError("research request has no durable dispatch");
  const workspacePath = durableWorkspace(dispatchRow.workspace_path);
  const artifacts = artifactManifest(workspacePath, args.artifact_paths);
  const resultId = requireString(args, "result_id");
  const summary = requireString(args, "summary");
  const sourceInputs = requireObjects(args.sources, "sources", 1);
  const sourceIds = new Set<string>();
  const sources = sourceInputs.map((source, index) => {
    const sourceId = requireString(source, "source_id");
    if (sourceIds.has(sourceId)) throw new ToolError(`duplicate source_id: ${sourceId}`);
    sourceIds.add(sourceId);
    const accessStatus = requireEnum(source, "access_status", ACCESS_STATUSES);
    const heldExcerpt = optString(source, "held_excerpt");
    if (["directly-read", "snippet"].includes(accessStatus) && !heldExcerpt) {
      throw new ToolError(`sources[${index}] read source requires held_excerpt`);
    }
    return {
      source_id: sourceId,
      title: requireString(source, "title"),
      locator: requireString(source, "locator"),
      source_class: requireString(source, "source_class"),
      access_status: accessStatus,
      held_excerpt: heldExcerpt,
      limitation: requireString(source, "limitation"),
    };
  });
  const sourceMap = new Map(sources.map((source) => [source.source_id, source]));
  const claimIds = new Set<string>();
  const claimInputs = requireObjects(args.claims, "claims", 1);
  const claims = claimInputs.map((claim, index) => {
    const externalClaimId = requireString(claim, "external_claim_id");
    if (claimIds.has(externalClaimId))
      throw new ToolError(`duplicate external_claim_id: ${externalClaimId}`);
    claimIds.add(externalClaimId);
    const citedSourceIds = uniqueStrings(claim.source_ids, `claims[${index}].source_ids`, 1);
    const citedSources = citedSourceIds.map((sourceId) => {
      const source = sourceMap.get(sourceId);
      if (!source) throw new ToolError(`claims[${index}] cites unknown source: ${sourceId}`);
      return source;
    });
    const confidence = requireEnum(claim, "confidence", CONFIDENCES);
    const chainDegradation = Math.max(
      ...citedSources.map((source) => degradation(source.access_status)),
    );
    if (confidence === "verified" && (citedSources.length < 2 || chainDegradation !== 0)) {
      throw new ToolError("verified external claims require at least two directly-read sources");
    }
    if (confidence === "corroborated" && (citedSources.length < 2 || chainDegradation > 1)) {
      throw new ToolError("corroborated external claims require two accessible sources");
    }
    const contradictedCodeClaimIds = uniqueStrings(
      claim.contradicts_code_claim_ids ?? [],
      `claims[${index}].contradicts_code_claim_ids`,
    );
    for (const codeClaimId of contradictedCodeClaimIds) {
      const codeClaim = ctx.db
        .prepare(
          `SELECT c.epistemic_kind, c.valid_until_sha,
                  (SELECT COUNT(*) FROM claim_evidence ce WHERE ce.claim_id=c.claim_id) AS evidence_count
             FROM claims c WHERE c.claim_id=?`,
        )
        .get(codeClaimId) as
        | { epistemic_kind: string; valid_until_sha: string | null; evidence_count: number }
        | undefined;
      if (
        !codeClaim ||
        codeClaim.epistemic_kind !== "observation" ||
        codeClaim.valid_until_sha !== null ||
        codeClaim.evidence_count < 1
      ) {
        throw new ToolError(
          `contradicted code claim is not a current evidence-backed observation: ${codeClaimId}`,
        );
      }
    }
    const targetKind = requireEnum(claim, "target_kind", TARGET_KINDS);
    const targetRef = requireString(claim, "target_ref");
    if (!targetMatchesRequest(row, targetKind, targetRef)) {
      throw new ToolError("external claim destination does not match the research request");
    }
    return {
      external_claim_id: externalClaimId,
      statement: requireString(claim, "statement"),
      classification: requireEnum(claim, "classification", CLASSIFICATIONS),
      confidence,
      source_ids: citedSourceIds,
      chain_degradation: chainDegradation,
      target_kind: targetKind,
      target_ref: targetRef,
      contradicts_code_claim_ids: contradictedCodeClaimIds,
    };
  });
  const result = {
    schema_version: "1.0.0",
    result_id: resultId,
    request_id: row.request_id,
    workspace_path: workspacePath,
    artifact_manifest: artifacts,
    summary,
    sources,
    claims,
  };

  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT INTO research_results
           (result_id, request_id, schema_version, result_json, result_hash, landed_by)
         VALUES (?, ?, '1.0.0', ?, ?, ?)`,
      )
      .run(resultId, row.request_id, stableJson(result), hash(result), sessionId);
    const insertSource = ctx.db.prepare(
      `INSERT INTO research_sources
         (result_id, source_id, title, locator, source_class, access_status, held_excerpt, limitation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const source of sources) {
      insertSource.run(
        resultId,
        source.source_id,
        source.title,
        source.locator,
        source.source_class,
        source.access_status,
        source.held_excerpt,
        source.limitation,
      );
    }
    const insertClaim = ctx.db.prepare(
      `INSERT INTO research_external_claims
         (external_claim_id, result_id, statement, classification, confidence,
          source_ids_json, chain_degradation, target_kind, target_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertContradiction = ctx.db.prepare(
      `INSERT INTO research_code_contradictions
         (external_claim_id, code_claim_id) VALUES (?, ?)`,
    );
    for (const claim of claims) {
      insertClaim.run(
        claim.external_claim_id,
        resultId,
        claim.statement,
        claim.classification,
        claim.confidence,
        stableJson(claim.source_ids),
        claim.chain_degradation,
        claim.target_kind,
        claim.target_ref,
      );
      for (const codeClaimId of claim.contradicts_code_claim_ids) {
        insertContradiction.run(claim.external_claim_id, codeClaimId);
      }
    }
    transition(ctx, row, "landed", "external research landed with provenance", {
      result_id: resultId,
      result_hash: hash(result),
      contradiction_count: claims.reduce(
        (count, claim) => count + claim.contradicts_code_claim_ids.length,
        0,
      ),
    });
  })();
  return { result_id: resultId, result_hash: hash(result), result };
}

function consume(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const sessionId = requireActiveSession(ctx, "consume_research_result");
  const row = request(ctx, requireString(args, "request_id"));
  if (row.status !== "landed") throw new ToolError(`research request is ${row.status}, not landed`);
  const result = ctx.db
    .prepare("SELECT result_id FROM research_results WHERE request_id=?")
    .get(row.request_id) as { result_id: string } | undefined;
  if (!result) throw new ToolError("research request has no landed result");
  const consumptionId = requireString(args, "consumption_id");
  const effectKind = requireEnum(args, "effect_kind", EFFECT_KINDS);
  const targetRef = optString(args, "target_ref");
  const effectStatement = optString(args, "effect_statement");
  const noChangeReason = optString(args, "no_change_reason");
  if (effectKind === "no-change") {
    if (targetRef || effectStatement || !noChangeReason) {
      throw new ToolError("no-change consumption requires only no_change_reason");
    }
  } else {
    if (!targetRef || !effectStatement || noChangeReason) {
      throw new ToolError("changed consumption requires target_ref and effect_statement only");
    }
    const externalClaimId = requireString(args, "external_claim_id");
    const externalClaim = ctx.db
      .prepare(
        "SELECT target_kind, target_ref FROM research_external_claims WHERE external_claim_id=? AND result_id=?",
      )
      .get(externalClaimId, result.result_id) as
      | { target_kind: string; target_ref: string }
      | undefined;
    if (!externalClaim)
      throw new ToolError("consumption must cite an external claim from this result");
    if (externalClaim.target_kind !== effectKind || externalClaim.target_ref !== targetRef) {
      throw new ToolError("consumption effect must match the cited external claim destination");
    }
  }
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT INTO research_consumptions
           (consumption_id, request_id, result_id, effect_kind, target_ref,
            effect_statement, no_change_reason, consumed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        consumptionId,
        row.request_id,
        result.result_id,
        effectKind,
        targetRef,
        effectStatement,
        noChangeReason,
        sessionId,
      );
    transition(ctx, row, "consumed", "research result reconciled to its named destination", {
      consumption_id: consumptionId,
      effect_kind: effectKind,
      target_ref: targetRef,
      no_change_reason: noChangeReason,
    });
  })();
  return {
    consumption_id: consumptionId,
    request_id: row.request_id,
    result_id: result.result_id,
    effect_kind: effectKind,
    target_ref: targetRef,
    changed: effectKind !== "no-change",
    no_change_reason: noChangeReason,
  };
}

function expire(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const row = request(ctx, requireString(args, "request_id"));
  if (!["admitted", "deferred", "dispatched", "landed"].includes(row.status)) {
    throw new ToolError(`research request is terminal: ${row.status}`);
  }
  const reason = requireString(args, "reason");
  ctx.db.transaction(() => transition(ctx, row, "expired", reason))();
  return { request_id: row.request_id, previous_status: row.status, status: "expired", reason };
}

function get(args: Record<string, unknown>, ctx: ServerContext): Record<string, unknown> {
  const row = request(ctx, requireString(args, "request_id"));
  const result = ctx.db
    .prepare("SELECT * FROM research_results WHERE request_id=?")
    .get(row.request_id) as Record<string, unknown> | undefined;
  return {
    ...row,
    contract: JSON.parse(row.contract_json),
    current_evidence: JSON.parse(row.current_evidence_json),
    needed_source_classes: JSON.parse(row.needed_source_classes_json),
    disconfirmers: JSON.parse(row.disconfirmers_json),
    events: ctx.db
      .prepare("SELECT * FROM research_request_events WHERE request_id=? ORDER BY event_id")
      .all(row.request_id),
    dispatch: (() => {
      const dispatch = ctx.db
        .prepare("SELECT * FROM research_dispatches WHERE request_id=?")
        .get(row.request_id) as (Record<string, unknown> & { handoff_json: string }) | undefined;
      return dispatch ? { ...dispatch, handoff: JSON.parse(dispatch.handoff_json) } : null;
    })(),
    result: result
      ? {
          ...result,
          payload: JSON.parse(String(result.result_json)),
          sources: ctx.db
            .prepare("SELECT * FROM research_sources WHERE result_id=? ORDER BY source_id")
            .all(String(result.result_id)),
          external_claims: ctx.db
            .prepare(
              "SELECT * FROM research_external_claims WHERE result_id=? ORDER BY external_claim_id",
            )
            .all(String(result.result_id)),
          contradictions: ctx.db
            .prepare(
              `SELECT c.* FROM research_code_contradictions c
                JOIN research_external_claims e ON e.external_claim_id=c.external_claim_id
               WHERE e.result_id=? ORDER BY c.contradiction_id`,
            )
            .all(String(result.result_id)),
        }
      : null,
    consumption:
      ctx.db
        .prepare("SELECT * FROM research_consumptions WHERE request_id=?")
        .get(row.request_id) ?? null,
  };
}

function list(args: Record<string, unknown>, ctx: ServerContext): Array<Record<string, unknown>> {
  const status = args.status == null ? null : requireEnum(args, "status", QUEUE_STATES);
  const decisionId = optString(args, "decision_id");
  const clauses: string[] = [];
  const values: string[] = [];
  if (status) {
    clauses.push("status=?");
    values.push(status);
  }
  if (decisionId) {
    clauses.push("decision_id=?");
    values.push(decisionId);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return ctx.db
    .prepare(
      `SELECT request_id, question, decision_id, decision_revision_id,
              destination_field, destination_ref, expected_value_score,
              duplicate_of, status, blocking, created_at, updated_at
         FROM research_requests ${where}
        ORDER BY blocking DESC, created_at, request_id`,
    )
    .all(...values) as Array<Record<string, unknown>>;
}

const destinationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["decision_id", "revision_id", "field", "ref"],
  properties: {
    decision_id: { type: "string", minLength: 1 },
    revision_id: { type: "string", minLength: 1 },
    field: { type: "string", enum: [...DESTINATION_FIELDS] },
    ref: { type: "string", minLength: 1 },
  },
};

const stringArraySchema = { type: "array", items: { type: "string", minLength: 1 } };

export const researchTools: ToolDefinition[] = [
  {
    name: "propose_research_request",
    description:
      "Record and mechanically admit, defer, or reject a bounded external-research question. Admission requires a real decision field, anchored current evidence, an exhausted local search, named source classes and disconfirmers, expected information value of at least 9, and duplicate reconciliation. Rejections and deferrals remain durable and nonblocking by default.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "request_id",
        "question",
        "uncertainty",
        "current_evidence",
        "needed_source_classes",
        "disconfirmers",
        "budget",
        "local_evidence_search",
        "expected_information_value",
      ],
      properties: {
        request_id: { type: "string", minLength: 1 },
        question: { type: "string", minLength: 1 },
        uncertainty: { type: "string", minLength: 1 },
        decision_destination: destinationSchema,
        current_evidence: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["kind", "ref", "statement"],
            properties: {
              kind: { type: "string", enum: [...EVIDENCE_KINDS] },
              ref: { type: "string", minLength: 1 },
              statement: { type: "string", minLength: 1 },
            },
          },
        },
        needed_source_classes: stringArraySchema,
        disconfirmers: stringArraySchema,
        budget: {
          type: "object",
          additionalProperties: false,
          required: ["max_sources", "max_minutes"],
          properties: {
            max_sources: { type: "integer", minimum: 1, maximum: 20 },
            max_minutes: { type: "integer", minimum: 5, maximum: 1440 },
          },
        },
        local_evidence_search: {
          type: "object",
          additionalProperties: false,
          required: ["outcome", "queries", "locations", "unresolved_reason"],
          properties: {
            outcome: { type: "string", enum: ["exhausted", "not-run", "found-answer"] },
            queries: stringArraySchema,
            locations: stringArraySchema,
            unresolved_reason: { type: "string" },
          },
        },
        expected_information_value: {
          type: "object",
          additionalProperties: false,
          required: ["decision_sensitivity", "uncertainty_reducibility"],
          properties: {
            decision_sensitivity: { type: "integer", minimum: 1, maximum: 5 },
            uncertainty_reducibility: { type: "integer", minimum: 1, maximum: 5 },
          },
        },
        changed_premise_refs: stringArraySchema,
        blocking: { type: "boolean", default: false },
      },
    },
    handler: propose,
  },
  {
    name: "dispatch_research_request",
    description:
      "Dispatch only an admitted request as a complete Scholiast handoff. The workspace must already be a real, non-temporary scholiast/<slug> directory; the packet preserves the destination, local evidence, ruled-out ground, source ladder, disconfirmers, budget, output shape, and access-status rule.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["request_id", "dispatch_id", "workspace_path", "ruled_out"],
      properties: {
        request_id: { type: "string", minLength: 1 },
        dispatch_id: { type: "string", minLength: 1 },
        workspace_path: { type: "string", minLength: 1 },
        ruled_out: stringArraySchema,
      },
    },
    handler: dispatch,
  },
  {
    name: "land_research_result",
    description:
      "Land a Scholiast result only with readable durable artifacts, append-only source provenance, per-source access status and limitations, calibrated external claims, and explicit contradictions to current repository observations. External claims are structurally separate from code claims.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["request_id", "result_id", "artifact_paths", "summary", "sources", "claims"],
      properties: {
        request_id: { type: "string", minLength: 1 },
        result_id: { type: "string", minLength: 1 },
        artifact_paths: stringArraySchema,
        summary: { type: "string", minLength: 1 },
        sources: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "source_id",
              "title",
              "locator",
              "source_class",
              "access_status",
              "limitation",
            ],
            properties: {
              source_id: { type: "string", minLength: 1 },
              title: { type: "string", minLength: 1 },
              locator: { type: "string", minLength: 1 },
              source_class: { type: "string", minLength: 1 },
              access_status: { type: "string", enum: [...ACCESS_STATUSES] },
              held_excerpt: { type: "string", minLength: 1 },
              limitation: { type: "string", minLength: 1 },
            },
          },
        },
        claims: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "external_claim_id",
              "statement",
              "classification",
              "confidence",
              "source_ids",
              "target_kind",
              "target_ref",
            ],
            properties: {
              external_claim_id: { type: "string", minLength: 1 },
              statement: { type: "string", minLength: 1 },
              classification: { type: "string", enum: [...CLASSIFICATIONS] },
              confidence: { type: "string", enum: [...CONFIDENCES] },
              source_ids: stringArraySchema,
              target_kind: { type: "string", enum: [...TARGET_KINDS] },
              target_ref: { type: "string", minLength: 1 },
              contradicts_code_claim_ids: stringArraySchema,
            },
          },
        },
      },
    },
    handler: land,
  },
  {
    name: "consume_research_result",
    description:
      "Reconcile one landed result to a named hypothesis, option, premise, or confidence reason, or record why it changed nothing. A changed effect must cite an external claim and exactly match its destination; this does not rewrite immutable decision or repository observations.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["request_id", "consumption_id", "effect_kind"],
      properties: {
        request_id: { type: "string", minLength: 1 },
        consumption_id: { type: "string", minLength: 1 },
        effect_kind: { type: "string", enum: [...EFFECT_KINDS] },
        external_claim_id: { type: "string", minLength: 1 },
        target_ref: { type: "string", minLength: 1 },
        effect_statement: { type: "string", minLength: 1 },
        no_change_reason: { type: "string", minLength: 1 },
      },
    },
    handler: consume,
  },
  {
    name: "expire_research_request",
    description:
      "Expire an admitted, deferred, dispatched, or landed request with a durable reason. Expiry is terminal and retained in queue metrics; rejected and consumed requests cannot be erased or relabeled.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["request_id", "reason"],
      properties: {
        request_id: { type: "string", minLength: 1 },
        reason: { type: "string", minLength: 1 },
      },
    },
    handler: expire,
  },
  {
    name: "get_research_request",
    description:
      "Read one research request with its immutable contract, queue events, Scholiast handoff, landed source/claim provenance, preserved code contradictions, and consumption record.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["request_id"],
      properties: { request_id: { type: "string", minLength: 1 } },
    },
    handler: get,
  },
  {
    name: "list_research_requests",
    description:
      "List the durable research queue, including rejected, deferred, admitted, dispatched, landed, consumed, and expired rows. Optional filters preserve visibility into backlog and research decision-yield denominators.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: { type: "string", enum: [...QUEUE_STATES] },
        decision_id: { type: "string", minLength: 1 },
      },
    },
    handler: list,
  },
];
