#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

function parseArgs(args) {
  let mode = "--check";
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--check" || argument === "--write") {
      mode = argument;
      continue;
    }
    if (["--root", "--source", "--output", "--catalog"].includes(argument)) {
      const value = args[index + 1];
      if (!value) throw new Error(`${argument} requires a path`);
      options[argument.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new Error(
      `unknown argument ${argument}; use --write or --check with optional --root, --source, and --output`,
    );
  }
  return { mode, ...options };
}

const CLI = parseArgs(process.argv.slice(2));
const ROOT = resolve(CLI.root ?? resolve(SCRIPT_DIR, ".."));
const SOURCE = resolve(ROOT, CLI.source ?? "dev/roadmap.json");
const OUTPUT = resolve(ROOT, CLI.output ?? "ROADMAP.md");
const CATALOG = resolve(ROOT, CLI.catalog ?? "dev/practice-catalog-v2.10.json");
const STAGE_ORDER = new Map([
  ["now", 0],
  ["next", 1],
  ["later", 2],
]);
const VALID_STATUSES = new Set(["ready", "planned", "in-progress", "blocked", "done"]);
const VALID_IMPLEMENTATION_STATUSES = new Set(["active", "local-complete", "integrated"]);
const FULL_SHA = /^[0-9a-f]{40}$/;
const FULL_BRANCH_REF = /^refs\/heads\/[A-Za-z0-9._/-]+$/;
const CATALOG_SNAPSHOT = JSON.parse(readFileSync(CATALOG, "utf8"));
const REQUIRED_PRACTICES = new Set(CATALOG_SNAPSHOT.ids);
const PACKAGE_MANIFEST = JSON.parse(
  readFileSync(resolve(ROOT, "mcp-server/package.json"), "utf8"),
);

function loadRoadmap() {
  return JSON.parse(readFileSync(SOURCE, "utf8"));
}

function assert(condition, message, errors) {
  if (!condition) errors.push(message);
}

function nonEmptyStrings(value, field, errors, minimum = 1) {
  assert(Array.isArray(value), `${field} must be an array`, errors);
  if (!Array.isArray(value)) return;
  assert(value.length >= minimum, `${field} must contain at least ${minimum} item(s)`, errors);
  value.forEach((item, index) => {
    assert(
      typeof item === "string" && item.trim().length > 0,
      `${field}[${index}] must be text`,
      errors,
    );
  });
}

function validateEstablishedRelease(release, prefix, errors) {
  assert(release?.status === "established", `${prefix}.status must be established`, errors);
  assert(
    release?.tag === `v${release?.version}`,
    `${prefix}.tag must equal v<release.version>`,
    errors,
  );
  assert(FULL_SHA.test(release?.tagCommit ?? ""), `${prefix}.tagCommit must be a full SHA`, errors);
  assert(release?.registry === "npmjs", `${prefix}.registry must be npmjs`, errors);
  assert(release?.distTag === "latest", `${prefix}.distTag must be latest`, errors);
  assert(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(release?.publishedAt ?? ""),
    `${prefix}.publishedAt must be an ISO UTC timestamp`,
    errors,
  );
  assert(FULL_SHA.test(release?.shasum ?? ""), `${prefix}.shasum must be a SHA-1`, errors);
  assert(
    /^sha512-[A-Za-z0-9+/]+={0,2}$/.test(release?.integrity ?? ""),
    `${prefix}.integrity must be an npm sha512 integrity value`,
    errors,
  );
  assert(
    release?.publish?.provider === "github-actions" && release?.publish?.workflow === "publish.yml",
    `${prefix}.publish must identify the GitHub Actions publish workflow`,
    errors,
  );
  assert(
    Number.isInteger(release?.publish?.runId) && release.publish.runId > 0,
    `${prefix}.publish.runId must be a positive integer`,
    errors,
  );
  assert(
    release?.publish?.headSha === release?.tagCommit,
    `${prefix}.publish.headSha must equal the tag commit`,
    errors,
  );
  assert(
    release?.publish?.conclusion === "success",
    `${prefix}.publish.conclusion must be success`,
    errors,
  );
  assert(
    release?.publishedSmoke?.provider === "github-actions" &&
      release?.publishedSmoke?.workflow === "published-smoke.yml",
    `${prefix}.publishedSmoke must identify the published-smoke workflow`,
    errors,
  );
  assert(
    Number.isInteger(release?.publishedSmoke?.runId) && release.publishedSmoke.runId > 0,
    `${prefix}.publishedSmoke.runId must be a positive integer`,
    errors,
  );
  assert(
    release?.publishedSmoke?.version === release?.version,
    `${prefix}.publishedSmoke.version must equal the release version`,
    errors,
  );
  assert(
    release?.publishedSmoke?.conclusion === "success",
    `${prefix}.publishedSmoke.conclusion must be success`,
    errors,
  );
}

function validateRoadmap(roadmap) {
  const errors = [];
  assert(roadmap.schemaVersion === 2, "schemaVersion must be 2", errors);
  for (const field of ["roadmapVersion", "updated", "title", "northStar", "scopeDecision"]) {
    assert(
      typeof roadmap[field] === "string" && roadmap[field].trim(),
      `${field} is required`,
      errors,
    );
  }
  assert(
    VALID_IMPLEMENTATION_STATUSES.has(roadmap.delivery?.implementation),
    "delivery.implementation must be active, local-complete, or integrated",
    errors,
  );
  assert(
    roadmap.delivery?.productProof === "unestablished",
    "delivery.productProof must remain unestablished until criterion-linked product evidence is implemented",
    errors,
  );
  const integration = roadmap.delivery?.integration;
  assert(
    integration?.status === "established",
    "delivery.integration.status must be established after integrated read-back",
    errors,
  );
  assert(integration?.remote === "origin", "delivery.integration.remote must be origin", errors);
  assert(
    integration?.repository === "nfeldman/amanuensis",
    "delivery.integration.repository must be nfeldman/amanuensis",
    errors,
  );
  assert(
    FULL_BRANCH_REF.test(integration?.ref ?? ""),
    "delivery.integration.ref must be a full refs/heads branch ref",
    errors,
  );
  assert(
    FULL_SHA.test(integration?.implementationSha ?? ""),
    "delivery.integration.implementationSha must be a full commit SHA",
    errors,
  );
  assert(
    /^\d{4}-\d{2}-\d{2}$/.test(integration?.verifiedAt ?? ""),
    "delivery.integration.verifiedAt must be YYYY-MM-DD",
    errors,
  );
  assert(
    integration?.ci?.provider === "github-actions" && integration?.ci?.workflow === "tests",
    "delivery.integration.ci must identify the GitHub Actions tests workflow",
    errors,
  );
  assert(
    Number.isInteger(integration?.ci?.runId) && integration.ci.runId > 0,
    "delivery.integration.ci.runId must be a positive integer",
    errors,
  );
  assert(
    integration?.ci?.headSha === integration?.implementationSha,
    "delivery.integration.ci.headSha must equal the implementation SHA",
    errors,
  );
  assert(
    integration?.ci?.conclusion === "success",
    "delivery.integration.ci.conclusion must be success",
    errors,
  );
  assert(
    typeof integration?.readback?.runId === "string" && integration.readback.runId.trim(),
    "delivery.integration.readback.runId is required",
    errors,
  );
  assert(
    integration?.readback?.sourceSha === integration?.implementationSha,
    "delivery.integration.readback.sourceSha must equal the implementation SHA",
    errors,
  );
  assert(
    FULL_SHA.test(integration?.readback?.storageCommit ?? ""),
    "delivery.integration.readback.storageCommit must be a full commit SHA",
    errors,
  );
  for (const axis of ["state", "coverage", "content"]) {
    assert(
      integration?.readback?.axes?.[axis] === "passed",
      `delivery.integration.readback.axes.${axis} must be passed`,
      errors,
    );
  }
  assert(
    integration?.readback?.mismatchCount === 0,
    "delivery.integration.readback.mismatchCount must be zero",
    errors,
  );
  const release = roadmap.delivery?.release;
  assert(
    release?.status === "candidate" || release?.status === "established",
    "delivery.release.status must be candidate or established",
    errors,
  );
  assert(
    release?.package === PACKAGE_MANIFEST.name && release?.version === PACKAGE_MANIFEST.version,
    "delivery.release package and version must match mcp-server/package.json",
    errors,
  );
  assert(release?.tag === `v${release?.version}`, "delivery.release.tag must equal v<release.version>", errors);
  assert(release?.registry === "npmjs", "delivery.release.registry must be npmjs", errors);
  assert(release?.distTag === "latest", "delivery.release.distTag must be latest", errors);
  if (release?.status === "established") {
    validateEstablishedRelease(release, "delivery.release", errors);
  } else if (release?.status === "candidate") {
    assert(
      release?.publicationAuthorized === true && release?.publicationStatus === "not-published",
      "delivery.release candidate must be authorized and not-published",
      errors,
    );
    assert(
      release?.releaseReadyReceipt === "dev/activation-evidence/a26-release-readiness.json",
      "delivery.release candidate must identify the A26 release-readiness receipt",
      errors,
    );
    for (const field of ["tagCommit", "publishedAt", "shasum", "integrity", "publish", "publishedSmoke"]) {
      assert(
        release?.[field] === undefined,
        `delivery.release candidate must not claim ${field} before publication`,
        errors,
      );
    }
    validateEstablishedRelease(
      release?.previousEstablished,
      "delivery.release.previousEstablished",
      errors,
    );
    assert(
      release?.previousEstablished?.version !== release?.version,
      "delivery.release.previousEstablished must identify an earlier version",
      errors,
    );
    try {
      const readiness = JSON.parse(readFileSync(resolve(ROOT, release.releaseReadyReceipt), "utf8"));
      assert(
        readiness?.result === "passed" &&
          readiness?.candidate?.packageVersion === release.version &&
          readiness?.decision?.releaseReady === true &&
          readiness?.decision?.publicationStatus === "not-published",
        "delivery.release candidate receipt must prove this version ready but not published",
        errors,
      );
    } catch {
      errors.push("delivery.release candidate receipt is missing or invalid");
    }
  }
  assert(/^\d{4}-\d{2}-\d{2}$/.test(roadmap.updated ?? ""), "updated must be YYYY-MM-DD", errors);

  for (const field of [
    "baselineObservations",
    "inferences",
    "programDecisions",
    "tensions",
    "definitions",
    "durableObjects",
    "ownership",
    "principles",
    "stages",
    "firstSlices",
    "metrics",
    "controlLadder",
    "risks",
    "killCriteria",
    "references",
  ]) {
    assert(
      Array.isArray(roadmap[field]) && roadmap[field].length > 0,
      `${field} must be non-empty`,
      errors,
    );
  }

  const evidencePaths = new Set();
  for (const [index, observation] of (roadmap.baselineObservations ?? []).entries()) {
    assert(
      observation.kind === "observation",
      `baselineObservations[${index}].kind must be observation`,
      errors,
    );
    assert(
      typeof observation.claim === "string" && observation.claim.trim(),
      `baselineObservations[${index}].claim is required`,
      errors,
    );
    nonEmptyStrings(observation.evidence, `baselineObservations[${index}].evidence`, errors);
    for (const path of observation.evidence ?? []) evidencePaths.add(path);
  }
  for (const [index, inference] of (roadmap.inferences ?? []).entries()) {
    assert(inference.kind === "inference", `inferences[${index}].kind must be inference`, errors);
    for (const field of ["claim", "basis", "counterpoint"]) {
      assert(
        typeof inference[field] === "string" && inference[field].trim(),
        `inferences[${index}].${field} is required`,
        errors,
      );
    }
  }
  for (const [index, question] of (roadmap.programDecisions ?? []).entries()) {
    for (const field of ["question", "owner", "resolveBefore", "resolveBeforeInitiative"]) {
      assert(
        typeof question[field] === "string" && question[field].trim(),
        `programDecisions[${index}].${field} is required`,
        errors,
      );
    }
    assert(
      question.status === "open" || question.status === "resolved",
      `programDecisions[${index}].status must be open or resolved`,
      errors,
    );
    if (question.status === "resolved") {
      for (const field of ["decisionRecord", "resolution"]) {
        assert(
          typeof question[field] === "string" && question[field].trim(),
          `programDecisions[${index}].${field} is required when resolved`,
          errors,
        );
      }
      if (question.decisionRecord) evidencePaths.add(question.decisionRecord);
    }
  }

  for (const [index, tension] of (roadmap.tensions ?? []).entries()) {
    for (const field of ["name", "left", "right", "resolution"]) {
      assert(
        typeof tension[field] === "string" && tension[field].trim(),
        `tensions[${index}].${field} is required`,
        errors,
      );
    }
  }
  for (const [index, definition] of (roadmap.definitions ?? []).entries()) {
    for (const field of ["term", "definition"]) {
      assert(
        typeof definition[field] === "string" && definition[field].trim(),
        `definitions[${index}].${field} is required`,
        errors,
      );
    }
    nonEmptyStrings(
      definition.negativeCriteria,
      `definitions[${index}].negativeCriteria`,
      errors,
      2,
    );
  }
  for (const [index, object] of (roadmap.durableObjects ?? []).entries()) {
    for (const field of ["name", "contract"]) {
      assert(
        typeof object[field] === "string" && object[field].trim(),
        `durableObjects[${index}].${field} is required`,
        errors,
      );
    }
    nonEmptyStrings(object.fields, `durableObjects[${index}].fields`, errors, 3);
  }
  for (const [index, owner] of (roadmap.ownership ?? []).entries()) {
    for (const field of ["actor", "owns", "doesNotOwn"]) {
      assert(
        typeof owner[field] === "string" && owner[field].trim(),
        `ownership[${index}].${field} is required`,
        errors,
      );
    }
  }
  for (const field of ["unattended", "humanGates", "hardStops"]) {
    nonEmptyStrings(roadmap.authority?.[field], `authority.${field}`, errors, 2);
  }

  const principleIds = new Set();
  for (const [index, principle] of (roadmap.principles ?? []).entries()) {
    assert(
      /^P\d+$/.test(principle.id ?? ""),
      `principles[${index}].id must match P<number>`,
      errors,
    );
    assert(!principleIds.has(principle.id), `duplicate principle id ${principle.id}`, errors);
    principleIds.add(principle.id);
    for (const field of ["title", "rule"]) {
      assert(
        typeof principle[field] === "string" && principle[field].trim(),
        `principles[${index}].${field} is required`,
        errors,
      );
    }
    nonEmptyStrings(principle.practices, `principles[${index}].practices`, errors);
    for (const practice of principle.practices ?? []) {
      assert(
        /^(GP|VP)\d+$/.test(practice),
        `principles[${index}] contains invalid practice ${practice}`,
        errors,
      );
    }
  }

  const metricIds = new Set();
  for (const [index, metric] of (roadmap.metrics ?? []).entries()) {
    assert(/^M\d+$/.test(metric.id ?? ""), `metrics[${index}].id must match M<number>`, errors);
    assert(!metricIds.has(metric.id), `duplicate metric id ${metric.id}`, errors);
    metricIds.add(metric.id);
    for (const field of ["name", "definition", "target", "exclusions"]) {
      assert(
        typeof metric[field] === "string" && metric[field].trim(),
        `metrics[${index}].${field} is required`,
        errors,
      );
    }
  }

  const stageIds = new Set();
  const initiatives = new Map();
  for (const [stageIndex, stage] of (roadmap.stages ?? []).entries()) {
    assert(
      STAGE_ORDER.has(stage.id),
      `stages[${stageIndex}].id must be now, next, or later`,
      errors,
    );
    assert(!stageIds.has(stage.id), `duplicate stage id ${stage.id}`, errors);
    stageIds.add(stage.id);
    for (const field of ["label", "horizon", "objective"]) {
      assert(
        typeof stage[field] === "string" && stage[field].trim(),
        `stages[${stageIndex}].${field} is required`,
        errors,
      );
    }
    nonEmptyStrings(stage.exitCriteria, `stages[${stageIndex}].exitCriteria`, errors, 2);
    assert(
      stage.productEvidenceStatus === "unestablished" ||
        stage.productEvidenceStatus === "established",
      `stages[${stageIndex}].productEvidenceStatus is invalid`,
      errors,
    );
    assert(
      Array.isArray(stage.exitEvidence),
      `stages[${stageIndex}].exitEvidence must be an array`,
      errors,
    );
    if (stage.productEvidenceStatus === "established") {
      nonEmptyStrings(
        stage.exitEvidence,
        `stages[${stageIndex}].exitEvidence`,
        errors,
        stage.exitCriteria?.length ?? 1,
      );
      assert(
        stage.exitEvidence?.length === stage.exitCriteria?.length,
        `stages[${stageIndex}] must evidence every stage exit before product proof is established`,
        errors,
      );
    }
    assert(
      Array.isArray(stage.initiatives) && stage.initiatives.length > 0,
      `stages[${stageIndex}].initiatives must be non-empty`,
      errors,
    );
    for (const [itemIndex, item] of (stage.initiatives ?? []).entries()) {
      const prefix = `stages[${stageIndex}].initiatives[${itemIndex}]`;
      assert(/^A\d+$/.test(item.id ?? ""), `${prefix}.id must match A<number>`, errors);
      assert(!initiatives.has(item.id), `duplicate initiative id ${item.id}`, errors);
      initiatives.set(item.id, { item, stage: stage.id });
      assert(VALID_STATUSES.has(item.status), `${prefix}.status is invalid`, errors);
      for (const field of ["title", "owner", "outcome", "rationale", "redGate"]) {
        assert(
          typeof item[field] === "string" && item[field].trim(),
          `${prefix}.${field} is required`,
          errors,
        );
      }
      nonEmptyStrings(item.deliverables, `${prefix}.deliverables`, errors);
      nonEmptyStrings(item.acceptance, `${prefix}.acceptance`, errors, 2);
      nonEmptyStrings(item.risks, `${prefix}.risks`, errors);
      nonEmptyStrings(item.practices, `${prefix}.practices`, errors);
      nonEmptyStrings(item.metrics, `${prefix}.metrics`, errors);
      nonEmptyStrings(item.baselineEvidence, `${prefix}.baselineEvidence`, errors);
      for (const path of item.baselineEvidence ?? []) evidencePaths.add(path);
      assert(Array.isArray(item.dependsOn), `${prefix}.dependsOn must be an array`, errors);
      for (const practice of item.practices ?? []) {
        assert(
          /^(GP|VP)\d+$/.test(practice),
          `${prefix}.practices contains invalid id ${practice}`,
          errors,
        );
      }
    }
  }
  assert(stageIds.size === 3, "stages must contain exactly now, next, and later", errors);
  const nowStage = roadmap.stages?.find((stage) => stage.id === "now");
  assert(
    roadmap.delivery?.productProof !== "established" ||
      nowStage?.productEvidenceStatus === "established",
    "delivery.productProof cannot be established before the Now stage exits are evidenced",
    errors,
  );

  for (const [index, decision] of (roadmap.programDecisions ?? []).entries()) {
    const deadline = initiatives.get(decision.resolveBeforeInitiative)?.item;
    assert(
      deadline,
      `programDecisions[${index}] has unknown deadline initiative ${decision.resolveBeforeInitiative}`,
      errors,
    );
    assert(
      !(deadline?.status === "done" && decision.status !== "resolved"),
      `programDecisions[${index}] is still open after terminal ${decision.resolveBeforeInitiative}`,
      errors,
    );
  }

  for (const [id, { item, stage }] of initiatives) {
    for (const dependency of item.dependsOn ?? []) {
      assert(initiatives.has(dependency), `${id} has unknown dependency ${dependency}`, errors);
      assert(dependency !== id, `${id} cannot depend on itself`, errors);
      const dependencyStage = initiatives.get(dependency)?.stage;
      if (dependencyStage) {
        assert(
          STAGE_ORDER.get(dependencyStage) <= STAGE_ORDER.get(stage),
          `${id} depends on later-stage initiative ${dependency}`,
          errors,
        );
      }
    }
    for (const metric of item.metrics ?? []) {
      assert(metricIds.has(metric), `${id} refers to unknown metric ${metric}`, errors);
    }
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(id, chain = []) {
    if (visiting.has(id)) {
      errors.push(`initiative dependency cycle: ${[...chain, id].join(" -> ")}`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of initiatives.get(id)?.item.dependsOn ?? [])
      visit(dependency, [...chain, id]);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of initiatives.keys()) visit(id);

  const readyItems = [...initiatives.values()].filter(({ item }) => item.status === "ready");
  const activeItems = [...initiatives.values()].filter(({ item }) => item.status === "in-progress");
  const unfinishedItems = [...initiatives.values()].filter(({ item }) => item.status !== "done");
  assert(activeItems.length <= 1, "at most one initiative may be in-progress", errors);
  assert(
    roadmap.delivery?.implementation !== "integrated" || unfinishedItems.length === 0,
    "delivery.implementation cannot be integrated while any initiative is unfinished",
    errors,
  );
  assert(
    roadmap.delivery?.implementation !== "local-complete" || unfinishedItems.length === 0,
    "delivery.implementation cannot be local-complete while any initiative is unfinished",
    errors,
  );
  assert(
    roadmap.delivery?.implementation !== "active" || unfinishedItems.length > 0,
    "delivery.implementation cannot be active without unfinished initiatives",
    errors,
  );
  assert(
    unfinishedItems.length === 0 || readyItems.length > 0 || activeItems.length > 0,
    "at least one initiative must be ready or in-progress",
    errors,
  );
  for (const { item } of [...readyItems, ...activeItems]) {
    for (const dependency of item.dependsOn) {
      assert(
        initiatives.get(dependency)?.item.status === "done",
        `${item.status} initiative ${item.id} depends on unfinished ${dependency}`,
        errors,
      );
    }
  }

  const sequences = new Set();
  for (const [index, slice] of (roadmap.firstSlices ?? []).entries()) {
    assert(
      Number.isInteger(slice.sequence) && slice.sequence > 0,
      `firstSlices[${index}].sequence must be a positive integer`,
      errors,
    );
    assert(
      !sequences.has(slice.sequence),
      `duplicate first slice sequence ${slice.sequence}`,
      errors,
    );
    sequences.add(slice.sequence);
    for (const field of ["title", "intent", "rollback"]) {
      assert(
        typeof slice[field] === "string" && slice[field].trim(),
        `firstSlices[${index}].${field} is required`,
        errors,
      );
    }
    nonEmptyStrings(slice.initiatives, `firstSlices[${index}].initiatives`, errors);
    nonEmptyStrings(slice.existingFiles, `firstSlices[${index}].existingFiles`, errors);
    nonEmptyStrings(slice.proposedFiles, `firstSlices[${index}].proposedFiles`, errors);
    nonEmptyStrings(slice.proves, `firstSlices[${index}].proves`, errors);
    nonEmptyStrings(slice.requiredChecks, `firstSlices[${index}].requiredChecks`, errors);
    for (const id of slice.initiatives ?? [])
      assert(
        initiatives.has(id),
        `first slice ${slice.sequence} refers to unknown initiative ${id}`,
        errors,
      );
    for (const path of slice.existingFiles ?? []) evidencePaths.add(path);
  }
  if (sequences.size) {
    const ordered = [...sequences].sort((a, b) => a - b);
    ordered.forEach((value, index) => {
      assert(value === index + 1, "first slice sequences must be contiguous from 1", errors);
    });
  }

  const controlLevels = new Set();
  for (const [index, control] of (roadmap.controlLadder ?? []).entries()) {
    assert(
      Number.isInteger(control.level) && control.level >= 0,
      `controlLadder[${index}].level must be a non-negative integer`,
      errors,
    );
    assert(!controlLevels.has(control.level), `duplicate control level ${control.level}`, errors);
    controlLevels.add(control.level);
    for (const field of ["fixture", "expected"]) {
      assert(
        typeof control[field] === "string" && control[field].trim(),
        `controlLadder[${index}].${field} is required`,
        errors,
      );
    }
    nonEmptyStrings(control.validates, `controlLadder[${index}].validates`, errors);
    for (const metric of control.validates ?? []) {
      assert(
        metricIds.has(metric),
        `control level ${control.level} refers to unknown metric ${metric}`,
        errors,
      );
    }
  }
  if (controlLevels.size) {
    const ordered = [...controlLevels].sort((a, b) => a - b);
    ordered.forEach((value, index) => {
      assert(value === index, "control levels must be contiguous from 0", errors);
    });
  }

  for (const [index, risk] of (roadmap.risks ?? []).entries()) {
    for (const field of ["risk", "signal", "mitigation", "owner"]) {
      assert(
        typeof risk[field] === "string" && risk[field].trim(),
        `risks[${index}].${field} is required`,
        errors,
      );
    }
  }
  for (const [index, criterion] of (roadmap.killCriteria ?? []).entries()) {
    for (const field of ["trigger", "action"]) {
      assert(
        typeof criterion[field] === "string" && criterion[field].trim(),
        `killCriteria[${index}].${field} is required`,
        errors,
      );
    }
  }
  for (const [index, reference] of (roadmap.references ?? []).entries()) {
    for (const field of ["name", "relevance"]) {
      assert(
        typeof reference[field] === "string" && reference[field].trim(),
        `references[${index}].${field} is required`,
        errors,
      );
    }
    if (reference.path) evidencePaths.add(reference.path);
  }

  for (const path of evidencePaths) {
    assert(!path.startsWith("/"), `repository evidence path must be relative: ${path}`, errors);
    try {
      assert(
        readFileSync(resolve(ROOT, path)).length >= 0,
        `evidence path does not exist: ${path}`,
        errors,
      );
    } catch {
      errors.push(`evidence path does not exist: ${path}`);
    }
  }

  assert(
    roadmap.practiceAudit?.version === CATALOG_SNAPSHOT.catalogVersion,
    `practiceAudit.version must be ${CATALOG_SNAPSHOT.catalogVersion}`,
    errors,
  );
  const appliedPractices = new Set();
  for (const [index, entry] of (roadmap.practiceAudit?.applied ?? []).entries()) {
    nonEmptyStrings(entry.ids, `practiceAudit.applied[${index}].ids`, errors);
    assert(
      typeof entry.use === "string" && entry.use.trim(),
      `practiceAudit.applied[${index}].use is required`,
      errors,
    );
    assert(
      typeof entry.verification === "string" && entry.verification.trim(),
      `practiceAudit.applied[${index}].verification is required`,
      errors,
    );
    for (const id of entry.ids ?? []) appliedPractices.add(id);
  }
  for (const required of REQUIRED_PRACTICES) {
    assert(
      appliedPractices.has(required),
      `practice audit does not account for required ${required}`,
      errors,
    );
  }
  for (const applied of appliedPractices) {
    assert(
      REQUIRED_PRACTICES.has(applied),
      `practice audit names unknown catalog practice ${applied}`,
      errors,
    );
  }
  nonEmptyStrings(roadmap.practiceAudit?.limitations, "practiceAudit.limitations", errors);

  if (errors.length) throw new Error(`roadmap validation failed:\n- ${errors.join("\n- ")}`);
}

function bullets(items) {
  return items.map((item) => `- ${item}`).join("\n");
}

function render(roadmap) {
  const initiatives = roadmap.stages.flatMap((stage) => stage.initiatives);
  const statusCounts = [...VALID_STATUSES].map((status) => [
    status,
    initiatives.filter((item) => item.status === status).length,
  ]);
  const nextInitiative = roadmap.stages
    .flatMap((stage) => stage.initiatives)
    .find((initiative) => initiative.status !== "done");
  const lines = [];
  lines.push(`# ${roadmap.title}`);
  lines.push("");
  lines.push(
    `> Generated from \`dev/roadmap.json\` by \`dev/render-roadmap.mjs\`. Do not edit this file directly. Roadmap v${roadmap.roadmapVersion}, updated ${roadmap.updated}.`,
  );
  lines.push("");
  lines.push("## Decision");
  lines.push("");
  lines.push(roadmap.scopeDecision);
  lines.push("");
  lines.push(`**North star:** ${roadmap.northStar}`);
  lines.push("");
  lines.push("### Initiative implementation status at a glance");
  lines.push("");
  lines.push("| Ready | Planned | In progress | Blocked | Implemented |");
  lines.push("|---:|---:|---:|---:|---:|");
  lines.push(
    `| ${statusCounts.find(([s]) => s === "ready")[1]} | ${statusCounts.find(([s]) => s === "planned")[1]} | ${statusCounts.find(([s]) => s === "in-progress")[1]} | ${statusCounts.find(([s]) => s === "blocked")[1]} | ${statusCounts.find(([s]) => s === "done")[1]} |`,
  );
  lines.push("");
  lines.push(
    "The horizons are dependency bands, not calendar promises. An initiative advances only when its acceptance checks pass and its red gate has first been demonstrated to fail.",
  );
  lines.push("");
  lines.push("| Horizon | Target product evidence | Evidence status | Initiatives |");
  lines.push("|---|---|---|---|");
  for (const stage of roadmap.stages) {
    lines.push(
      `| ${stage.id[0].toUpperCase()}${stage.id.slice(1)} | ${stage.objective} | ${stage.productEvidenceStatus} | ${stage.initiatives.map((item) => item.id).join(", ")} |`,
    );
  }
  lines.push("");
  const integration = roadmap.delivery.integration;
  const ciUrl = `https://github.com/${integration.repository}/actions/runs/${integration.ci.runId}`;
  if (roadmap.delivery.implementation === "active") {
    const unfinishedCount = initiatives.filter((initiative) => initiative.status !== "done").length;
    lines.push(
      `**Implementation baseline:** The previously integrated program at \`${integration.implementationSha}\` is contained by \`${integration.remote}:${integration.ref}\` (verified ${integration.verifiedAt}).`,
    );
    lines.push("");
    lines.push(
      `**Active expansion:** ${unfinishedCount} of ${initiatives.length} initiatives remain unfinished; completed baseline initiatives retain their historical evidence.`,
    );
  } else if (roadmap.delivery.implementation === "local-complete") {
    lines.push(
      `**Implementation:** All ${initiatives.length} roadmap initiatives have local criterion-linked evidence. The last remotely integrated baseline remains \`${integration.implementationSha}\` at \`${integration.remote}:${integration.ref}\` (verified ${integration.verifiedAt}); the current local expansion is not claimed at that remote or CI run.`,
    );
  } else {
    lines.push(
      `**Implementation:** All ${initiatives.length} roadmap initiatives at implementation tip \`${integration.implementationSha}\` are contained by \`${integration.remote}:${integration.ref}\` (verified ${integration.verifiedAt}).`,
    );
  }
  lines.push("");
  lines.push(`**Product proof:** ${roadmap.delivery.productProof}.`);
  lines.push("");
  lines.push(`**Integration:** ${integration.status}.`);
  lines.push("");
  lines.push(
    `**CI evidence:** [${integration.ci.workflow} run ${integration.ci.runId}](${ciUrl}) concluded ${integration.ci.conclusion} at exact head \`${integration.ci.headSha}\`.`,
  );
  lines.push("");
  lines.push(
    `**Conspectus read-back:** \`${integration.readback.runId}\` passed state, coverage, and content with ${integration.readback.mismatchCount} mismatches at source \`${integration.readback.sourceSha}\`; durable storage commit \`${integration.readback.storageCommit}\`.`,
  );
  lines.push("");
  const release = roadmap.delivery.release;
  const tagUrl = `https://github.com/${integration.repository}/tree/${release.tag}`;
  const packageUrl = `https://www.npmjs.com/package/${release.package}/v/${release.version}`;
  if (release.status === "candidate") {
    const previous = release.previousEstablished;
    const previousTagUrl = `https://github.com/${integration.repository}/tree/${previous.tag}`;
    const previousPackageUrl = `https://www.npmjs.com/package/${previous.package}/v/${previous.version}`;
    lines.push(
      `**Release:** ${release.status}; \`${release.tag}\` / \`${release.package}@${release.version}\` is authorized but ${release.publicationStatus}.`,
    );
    lines.push("");
    lines.push(
      `**Pre-publication evidence:** [A26 release-readiness receipt](${release.releaseReadyReceipt}) proves this candidate ready without claiming a tag, registry artifact, or published-package smoke result.`,
    );
    lines.push("");
    lines.push(
      `**Previous established release:** [${previous.tag}](${previousTagUrl}) published [${previous.package}@${previous.version}](${previousPackageUrl}) as \`${previous.distTag}\` on ${previous.registry}.`,
    );
  } else {
    const publishUrl = `https://github.com/${integration.repository}/actions/runs/${release.publish.runId}`;
    const publishedSmokeUrl = `https://github.com/${integration.repository}/actions/runs/${release.publishedSmoke.runId}`;
    lines.push(
      `**Release:** ${release.status}; [${release.tag}](${tagUrl}) published [${release.package}@${release.version}](${packageUrl}) as \`${release.distTag}\` on ${release.registry}.`,
    );
    lines.push("");
    lines.push(
      `**Publication evidence:** [${release.publish.workflow} run ${release.publish.runId}](${publishUrl}) concluded ${release.publish.conclusion} at tag commit \`${release.tagCommit}\`; registry shasum \`${release.shasum}\`.`,
    );
    lines.push("");
    lines.push(
      `**Published-package smoke:** [${release.publishedSmoke.workflow} run ${release.publishedSmoke.runId}](${publishedSmokeUrl}) concluded ${release.publishedSmoke.conclusion} for \`${release.publishedSmoke.version}\`.`,
    );
  }
  if (nextInitiative) {
    lines.push("");
    lines.push(
      `**Next implementation initiative:** ${nextInitiative.id} — ${nextInitiative.title}.`,
    );
  }

  lines.push("");
  lines.push("## Epistemic baseline");
  lines.push("");
  lines.push("### Observed");
  lines.push("");
  for (const item of roadmap.baselineObservations) {
    lines.push(
      `- ${item.claim} Evidence: ${item.evidence.map((path) => `\`${path}\``).join(", ")}.`,
    );
  }
  lines.push("");
  lines.push("### Inferred, not yet established");
  lines.push("");
  for (const item of roadmap.inferences) {
    lines.push(
      `- **Inference:** ${item.claim} **Basis:** ${item.basis} **Counterpoint:** ${item.counterpoint}`,
    );
  }
  lines.push("");
  lines.push("### Program decisions");
  lines.push("");
  lines.push("| Question | Owner | Deadline | Status | Decision record | Resolution |");
  lines.push("|---|---|---|---|---|---|");
  for (const item of roadmap.programDecisions)
    lines.push(
      `| ${item.question} | ${item.owner} | ${item.resolveBefore} | ${item.status} | ${item.decisionRecord ? `\`${item.decisionRecord}\`` : "—"} | ${item.resolution ?? "—"} |`,
    );

  lines.push("");
  lines.push("## Product boundaries");
  lines.push("");
  lines.push("### Tensions we intend to preserve");
  lines.push("");
  lines.push("| Tension | First pole | Second pole | Resolution |");
  lines.push("|---|---|---|---|");
  for (const tension of roadmap.tensions)
    lines.push(`| ${tension.name} | ${tension.left} | ${tension.right} | ${tension.resolution} |`);
  lines.push("");
  lines.push("### Operational definitions");
  lines.push("");
  for (const definition of roadmap.definitions) {
    lines.push(`#### ${definition.term}`);
    lines.push("");
    lines.push(definition.definition);
    lines.push("");
    lines.push("Does not mean:");
    lines.push("");
    lines.push(bullets(definition.negativeCriteria));
    lines.push("");
  }
  lines.push("### Minimum durable objects");
  lines.push("");
  lines.push("| Object | Required fields | Contract |");
  lines.push("|---|---|---|");
  for (const object of roadmap.durableObjects)
    lines.push(`| ${object.name} | ${object.fields.join(", ")} | ${object.contract} |`);
  lines.push("");
  lines.push("### Ownership");
  lines.push("");
  lines.push("| Actor | Owns | Does not own |");
  lines.push("|---|---|---|");
  for (const item of roadmap.ownership)
    lines.push(`| ${item.actor} | ${item.owns} | ${item.doesNotOwn} |`);
  lines.push("");
  lines.push("### Automation and authority");
  lines.push("");
  lines.push("Amanuensis may run unattended to:");
  lines.push("");
  lines.push(bullets(roadmap.authority.unattended));
  lines.push("");
  lines.push("It must stop or produce a proposal when:");
  lines.push("");
  lines.push(bullets(roadmap.authority.humanGates));
  lines.push("");
  lines.push("Hard stops enforced by the system:");
  lines.push("");
  lines.push(bullets(roadmap.authority.hardStops));

  lines.push("");
  lines.push("## Operating principles");
  lines.push("");
  for (const principle of roadmap.principles)
    lines.push(
      `- **${principle.id} — ${principle.title}:** ${principle.rule} _Catalog: ${principle.practices.join(", ")}._`,
    );

  lines.push("");
  lines.push("## Roadmap");
  for (const stage of roadmap.stages) {
    lines.push("");
    lines.push(`### ${stage.label}`);
    lines.push("");
    lines.push(`**Horizon:** ${stage.horizon}`);
    lines.push("");
    lines.push(`**Objective:** ${stage.objective}`);
    lines.push("");
    lines.push(`**Product-evidence status:** ${stage.productEvidenceStatus}`);
    lines.push("");
    lines.push("**Stage exits:**");
    lines.push("");
    lines.push(bullets(stage.exitCriteria));
    for (const item of stage.initiatives) {
      lines.push("");
      lines.push(`#### ${item.id} — ${item.title}`);
      lines.push("");
      lines.push(`**Implementation status:** ${item.status}<br>`);
      lines.push(`**Owner:** ${item.owner}<br>`);
      lines.push(
        `**Depends on:** ${item.dependsOn.length ? item.dependsOn.join(", ") : "none"}<br>`,
      );
      lines.push(`**Metrics:** ${item.metrics.join(", ")}`);
      lines.push("");
      lines.push(`**Outcome:** ${item.outcome}`);
      lines.push("");
      lines.push(`**Why:** ${item.rationale}`);
      lines.push("");
      lines.push("Deliverables:");
      lines.push("");
      lines.push(bullets(item.deliverables));
      lines.push("");
      lines.push("Acceptance:");
      lines.push("");
      lines.push(bullets(item.acceptance));
      lines.push("");
      lines.push(`**Red gate:** ${item.redGate}`);
      lines.push("");
      lines.push("Risks:");
      lines.push("");
      lines.push(bullets(item.risks));
      lines.push("");
      lines.push(`**Practice basis:** ${item.practices.join(", ")}<br>`);
      lines.push(
        `**Baseline evidence:** ${item.baselineEvidence.map((path) => `\`${path}\``).join(", ")}`,
      );
    }
  }

  lines.push("");
  lines.push("## First implementation slices");
  lines.push("");
  lines.push(
    "Each slice is intended to be a reviewable change that leaves main releasable. The proposed filenames are targets, not pre-decided architecture; the slice may rename them if the predicted diff and ADR explain why.",
  );
  for (const slice of [...roadmap.firstSlices].sort((a, b) => a.sequence - b.sequence)) {
    lines.push("");
    lines.push(`### ${slice.sequence}. ${slice.title}`);
    lines.push("");
    lines.push(`**Initiatives:** ${slice.initiatives.join(", ")}`);
    lines.push("");
    lines.push(slice.intent);
    lines.push("");
    lines.push(
      `**Existing files:** ${slice.existingFiles.map((path) => `\`${path}\``).join(", ")}<br>`,
    );
    lines.push(
      `**Proposed files:** ${slice.proposedFiles.map((path) => `\`${path}\``).join(", ")}`,
    );
    lines.push("");
    lines.push("Proves:");
    lines.push("");
    lines.push(bullets(slice.proves));
    lines.push("");
    lines.push("Required checks:");
    lines.push("");
    lines.push(bullets(slice.requiredChecks));
    lines.push("");
    lines.push(`**Rollback:** ${slice.rollback}`);
  }

  lines.push("");
  lines.push("## Measurement contract");
  lines.push("");
  lines.push(
    "Metrics are reported per repository, commit range, mode, model/runtime configuration, and replicate. They are never pooled across those boundaries.",
  );
  lines.push("");
  lines.push("| ID | Metric | Definition | Gate | Exclusions |");
  lines.push("|---|---|---|---|---|");
  for (const metric of roadmap.metrics)
    lines.push(
      `| ${metric.id} | ${metric.name} | ${metric.definition} | ${metric.target} | ${metric.exclusions} |`,
    );

  lines.push("");
  lines.push("## Control ladder");
  lines.push("");
  lines.push("| Level | Fixture | Expected behavior | Validates |");
  lines.push("|---:|---|---|---|");
  for (const control of roadmap.controlLadder)
    lines.push(
      `| ${control.level} | ${control.fixture} | ${control.expected} | ${control.validates.join(", ")} |`,
    );

  lines.push("");
  lines.push("## Program risks");
  lines.push("");
  lines.push("| Risk | Early signal | Mitigation | Owner |");
  lines.push("|---|---|---|---|");
  for (const risk of roadmap.risks)
    lines.push(`| ${risk.risk} | ${risk.signal} | ${risk.mitigation} | ${risk.owner} |`);
  lines.push("");
  lines.push("### Kill or rescope criteria");
  lines.push("");
  for (const criterion of roadmap.killCriteria)
    lines.push(`- **${criterion.trigger}:** ${criterion.action}`);

  lines.push("");
  lines.push(`## Practice-catalog audit (v${roadmap.practiceAudit.version})`);
  lines.push("");
  lines.push("| Practices | Applied as | Verification in this roadmap |");
  lines.push("|---|---|---|");
  for (const item of roadmap.practiceAudit.applied)
    lines.push(`| ${item.ids.join(", ")} | ${item.use} | ${item.verification} |`);
  lines.push("");
  lines.push("Limitations:");
  lines.push("");
  lines.push(bullets(roadmap.practiceAudit.limitations));

  lines.push("");
  lines.push("## References and custody");
  lines.push("");
  for (const reference of roadmap.references)
    lines.push(
      `- **${reference.name}:** ${reference.relevance}${reference.path ? ` (\`${reference.path}\`)` : ""}`,
    );
  lines.push("");
  lines.push(
    "Roadmap changes are made in `dev/roadmap.json`, rendered with `node dev/render-roadmap.mjs --write`, and verified with `node dev/render-roadmap.mjs --check`. A change is incomplete until the generated projection, structural validation, and repository tests all pass.",
  );
  return `${lines.join("\n")}\n`;
}

const roadmap = loadRoadmap();
validateRoadmap(roadmap);
const rendered = render(roadmap);
const mode = CLI.mode;

if (mode === "--write") {
  writeFileSync(OUTPUT, rendered);
  const delivered = readFileSync(OUTPUT, "utf8");
  if (delivered !== rendered) {
    throw new Error(`${relative(ROOT, OUTPUT)} write completed but read-back did not match`);
  }
  console.log(`wrote ${relative(ROOT, OUTPUT)}`);
} else if (mode === "--check") {
  let current = "";
  try {
    current = readFileSync(OUTPUT, "utf8");
  } catch {
    throw new Error(
      `${relative(ROOT, OUTPUT)} is missing; run node dev/render-roadmap.mjs --write`,
    );
  }
  if (current !== rendered) {
    throw new Error(`${relative(ROOT, OUTPUT)} is stale; run node dev/render-roadmap.mjs --write`);
  }
  const initiativeCount = roadmap.stages.reduce(
    (count, stage) => count + stage.initiatives.length,
    0,
  );
  console.log(
    `roadmap valid; ${initiativeCount} initiatives, ${roadmap.metrics.length} metrics, generated projection current`,
  );
} else {
  throw new Error(`unknown mode ${mode}; use --write or --check`);
}
