#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEV_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(DEV_DIR, "..");
const RENDERER = resolve(DEV_DIR, "render-roadmap.mjs");
const CANONICAL = JSON.parse(readFileSync(resolve(DEV_DIR, "roadmap.json"), "utf8"));
const SCRATCH = mkdtempSync(resolve(tmpdir(), "amanuensis-roadmap-test-"));

function run(args, expectedStatus, expectedText) {
  const result = spawnSync(process.execPath, [RENDERER, "--root", ROOT, ...args], {
    encoding: "utf8",
  });
  const combined = `${result.stdout}\n${result.stderr}`;
  if (result.status !== expectedStatus) {
    throw new Error(
      `expected exit ${expectedStatus}, got ${result.status}\ncommand: ${args.join(" ")}\n${combined}`,
    );
  }
  if (expectedText && !combined.includes(expectedText)) {
    throw new Error(
      `expected output to include ${JSON.stringify(expectedText)}\ncommand: ${args.join(" ")}\n${combined}`,
    );
  }
}

function writeCase(name, mutate = () => {}) {
  const value = structuredClone(CANONICAL);
  mutate(value);
  const path = resolve(SCRATCH, `${name}.json`);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

function initiative(value, id) {
  return value.stages.flatMap((stage) => stage.initiatives).find((item) => item.id === id);
}

try {
  const valid = writeCase("valid");
  const projection = resolve(SCRATCH, "ROADMAP.md");
  run(["--write", "--source", valid, "--output", projection], 0, "wrote");
  run(["--check", "--source", valid, "--output", projection], 0, "roadmap valid");

  writeFileSync(projection, `${readFileSync(projection, "utf8")}drift\n`);
  run(["--check", "--source", valid, "--output", projection], 1, "is stale");

  const staleSchema = writeCase("stale-schema", (value) => {
    value.schemaVersion = 1;
  });
  run(["--write", "--source", staleSchema, "--output", projection], 1, "schemaVersion must be 2");

  const dangling = writeCase("dangling", (value) => initiative(value, "A1").dependsOn.push("A999"));
  run(["--write", "--source", dangling, "--output", projection], 1, "unknown dependency A999");

  const cycle = writeCase("cycle", (value) => initiative(value, "A0").dependsOn.push("A1"));
  run(["--write", "--source", cycle, "--output", projection], 1, "dependency cycle");

  const noRedGate = writeCase("no-red-gate", (value) => {
    initiative(value, "A0").redGate = "";
  });
  run(["--write", "--source", noRedGate, "--output", projection], 1, ".redGate is required");

  const unfinishedDependency = writeCase("unfinished-dependency", (value) => {
    initiative(value, "A0").status = "ready";
    initiative(value, "A1").status = "ready";
  });
  run(
    ["--write", "--source", unfinishedDependency, "--output", projection],
    1,
    "ready initiative A1 depends on unfinished A0",
  );

  const unfinishedActiveDependency = writeCase("unfinished-active-dependency", (value) => {
    for (const stage of value.stages) {
      for (const item of stage.initiatives) {
        if (item.status === "in-progress") item.status = "planned";
      }
    }
    initiative(value, "A0").status = "ready";
    initiative(value, "A1").status = "in-progress";
  });
  run(
    ["--write", "--source", unfinishedActiveDependency, "--output", projection],
    1,
    "in-progress initiative A1 depends on unfinished A0",
  );

  const competingActiveWork = writeCase("competing-active-work", (value) => {
    initiative(value, "A1").status = "in-progress";
    initiative(value, "A2").status = "in-progress";
  });
  run(
    ["--write", "--source", competingActiveWork, "--output", projection],
    1,
    "at most one initiative may be in-progress",
  );

  const noFrontier = writeCase("no-frontier", (value) => {
    for (const stage of value.stages) {
      for (const item of stage.initiatives) {
        if (item.status === "ready" || item.status === "in-progress") item.status = "planned";
      }
    }
    initiative(value, "A17").status = "planned";
  });
  run(
    ["--write", "--source", noFrontier, "--output", projection],
    1,
    "at least one initiative must be ready or in-progress",
  );

  const missingEvidence = writeCase("missing-evidence", (value) => {
    initiative(value, "A0").baselineEvidence.push("not-a-real-roadmap-evidence-file");
  });
  run(
    ["--write", "--source", missingEvidence, "--output", projection],
    1,
    "evidence path does not exist",
  );

  const missingPractice = writeCase("missing-practice", (value) => {
    value.practiceAudit.applied = value.practiceAudit.applied.map((entry) => ({
      ...entry,
      ids: entry.ids.filter((id) => id !== "GP1"),
    }));
  });
  run(
    ["--write", "--source", missingPractice, "--output", projection],
    1,
    "does not account for required GP1",
  );

  const staleCatalog = writeCase("stale-catalog", (value) => {
    value.practiceAudit.version = "2.8";
  });
  run(
    ["--write", "--source", staleCatalog, "--output", projection],
    1,
    "practiceAudit.version must be 2.10",
  );

  const unsupportedProductProof = writeCase("unsupported-product-proof", (value) => {
    value.delivery.productProof = "established";
  });
  run(
    ["--write", "--source", unsupportedProductProof, "--output", projection],
    1,
    "productProof must remain unestablished until criterion-linked product evidence is implemented",
  );

  const regressedIntegration = writeCase("regressed-integration", (value) => {
    value.delivery.integration.status = "pending";
  });
  run(
    ["--write", "--source", regressedIntegration, "--output", projection],
    1,
    "delivery.integration.status must be established after integrated read-back",
  );

  const regressedImplementation = writeCase("regressed-implementation", (value) => {
    value.delivery.implementation = "branch-local-complete";
  });
  run(
    ["--write", "--source", regressedImplementation, "--output", projection],
    1,
    "delivery.implementation must be active, local-complete, or integrated",
  );

  const unfinishedIntegratedImplementation = writeCase(
    "unfinished-integrated-implementation",
    (value) => {
      value.delivery.implementation = "integrated";
      initiative(value, "A18").status = "ready";
    },
  );
  run(
    ["--write", "--source", unfinishedIntegratedImplementation, "--output", projection],
    1,
    "delivery.implementation cannot be integrated while any initiative is unfinished",
  );

  const unfinishedLocalCompleteImplementation = writeCase(
    "unfinished-local-complete-implementation",
    (value) => {
      value.delivery.implementation = "local-complete";
      initiative(value, "A18").status = "ready";
    },
  );
  run(
    ["--write", "--source", unfinishedLocalCompleteImplementation, "--output", projection],
    1,
    "delivery.implementation cannot be local-complete while any initiative is unfinished",
  );

  const activeWithoutWork = writeCase("active-without-work", (value) => {
    value.delivery.implementation = "active";
    for (const stage of value.stages) {
      for (const item of stage.initiatives) item.status = "done";
    }
  });
  run(
    ["--write", "--source", activeWithoutWork, "--output", projection],
    1,
    "delivery.implementation cannot be active without unfinished initiatives",
  );

  const ambiguousIntegrationRef = writeCase("ambiguous-integration-ref", (value) => {
    value.delivery.integration.ref = "main";
  });
  run(
    ["--write", "--source", ambiguousIntegrationRef, "--output", projection],
    1,
    "delivery.integration.ref must be a full refs/heads branch ref",
  );

  const mismatchedCiHead = writeCase("mismatched-ci-head", (value) => {
    value.delivery.integration.ci.headSha = "1".repeat(40);
  });
  run(
    ["--write", "--source", mismatchedCiHead, "--output", projection],
    1,
    "delivery.integration.ci.headSha must equal the implementation SHA",
  );

  const failedReadback = writeCase("failed-readback", (value) => {
    value.delivery.integration.readback.axes.content = "failed";
    value.delivery.integration.readback.mismatchCount = 1;
  });
  run(
    ["--write", "--source", failedReadback, "--output", projection],
    1,
    "delivery.integration.readback.axes.content must be passed",
  );

  const fabricatedProductProof = writeCase("fabricated-product-proof", (value) => {
    value.delivery.productProof = "established";
    value.stages[0].productEvidenceStatus = "established";
    value.stages[0].exitEvidence = value.stages[0].exitCriteria.map(
      (_, index) => `fabricated evidence ${index}`,
    );
  });
  run(
    ["--write", "--source", fabricatedProductProof, "--output", projection],
    1,
    "productProof must remain unestablished until criterion-linked product evidence is implemented",
  );

  const mismatchedReleaseTag = writeCase("mismatched-release-tag", (value) => {
    value.delivery.release.tag = "v2.0.0";
  });
  run(
    ["--write", "--source", mismatchedReleaseTag, "--output", projection],
    1,
    "delivery.release.tag must equal v<release.version>",
  );

  const regressedReleaseStatus = writeCase("regressed-release-status", (value) => {
    value.delivery.release.status = "unestablished";
  });
  run(
    ["--write", "--source", regressedReleaseStatus, "--output", projection],
    1,
    "delivery.release.status must be candidate or established",
  );

  const failedPublishedSmoke = writeCase("failed-published-smoke", (value) => {
    value.delivery.release.previousEstablished.publishedSmoke.conclusion = "failure";
  });
  run(
    ["--write", "--source", failedPublishedSmoke, "--output", projection],
    1,
    "delivery.release.previousEstablished.publishedSmoke.conclusion must be success",
  );

  const prematurePublicationClaim = writeCase("premature-publication-claim", (value) => {
    value.delivery.release.publicationStatus = "published";
  });
  run(
    ["--write", "--source", prematurePublicationClaim, "--output", projection],
    1,
    "delivery.release candidate must be authorized and not-published",
  );

  const fabricatedCandidateArtifact = writeCase("fabricated-candidate-artifact", (value) => {
    value.delivery.release.shasum = "1".repeat(40);
  });
  run(
    ["--write", "--source", fabricatedCandidateArtifact, "--output", projection],
    1,
    "delivery.release candidate must not claim shasum before publication",
  );

  const unevidencedStageExit = writeCase("unevidenced-stage-exit", (value) => {
    value.stages[0].productEvidenceStatus = "established";
  });
  run(
    ["--write", "--source", unevidencedStageExit, "--output", projection],
    1,
    "must evidence every stage exit before product proof is established",
  );

  const expandedCatalog = resolve(SCRATCH, "expanded-catalog.json");
  const catalog = JSON.parse(readFileSync(resolve(DEV_DIR, "practice-catalog-v2.10.json"), "utf8"));
  catalog.ids.push("VP27");
  writeFileSync(expandedCatalog, `${JSON.stringify(catalog, null, 2)}\n`);
  run(
    ["--write", "--source", valid, "--catalog", expandedCatalog, "--output", projection],
    1,
    "does not account for required VP27",
  );

  const overdueDecision = writeCase("overdue-decision", (value) => {
    value.programDecisions[0].status = "open";
    delete value.programDecisions[0].decisionRecord;
    delete value.programDecisions[0].resolution;
  });
  run(
    ["--write", "--source", overdueDecision, "--output", projection],
    1,
    "is still open after terminal A1",
  );

  const brokenControl = writeCase("broken-control", (value) => {
    value.controlLadder[0].expected = "";
  });
  run(
    ["--write", "--source", brokenControl, "--output", projection],
    1,
    "controlLadder[0].expected is required",
  );

  console.log(
    "roadmap red gates verified: drift, dangling/unfinished dependency, cycle, overdue decision, delivery regression, product/stage proof, stale catalog, missing criterion, evidence, practice coverage, and control integrity",
  );
} finally {
  rmSync(SCRATCH, { recursive: true, force: true });
}
