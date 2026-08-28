#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootArgument = process.argv.indexOf("--root");
const ROOT = rootArgument === -1 ? scriptRoot : resolve(process.argv[rootArgument + 1]);
const roadmap = JSON.parse(readFileSync(resolve(ROOT, "dev/roadmap.json"), "utf8"));
const revisions = readFileSync(resolve(ROOT, ".pecia/work.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const workProjectionBytes = readFileSync(resolve(ROOT, ".pecia/work.jsonl"));
const snapshot = JSON.parse(readFileSync(resolve(ROOT, ".pecia/snapshot.json"), "utf8"));

const heads = new Map();
for (const record of revisions) {
  const current = heads.get(record.id);
  if (!current || record.rev > current.rev) heads.set(record.id, record);
}

function recordsWithLabel(label) {
  return [...heads.values()].filter((record) => record.labels?.includes(label));
}

// Pecia treats closure as final: reopening work creates a successor record
// carrying edges.discovered_from rather than un-closing the original, so one
// roadmap initiative legitimately accumulates a chain of heads under the same
// label. Resolve the label to that chain's tail — the head no other head was
// discovered from — instead of demanding a single record forever.
//
// This keeps the error class the previous exactly-one rule existed to catch:
// two records that independently claim the same initiative are two tails, and
// still fail. Only genuine supersession is admitted. A forked or broken chain
// fails closed.
function exactlyOne(label) {
  const matches = recordsWithLabel(label);
  assert.notEqual(matches.length, 0, `${label} must identify at least one Pecia head`);
  const supersededIds = new Set(
    matches.map((record) => record.edges?.discovered_from).filter(Boolean),
  );
  const tails = matches.filter((record) => !supersededIds.has(record.id));
  assert.equal(
    tails.length,
    1,
    `${label} must resolve to exactly one current record; found ${tails.length} ` +
      `chain tails among ${matches.length} heads (${matches.map((r) => r.id).join(", ")})`,
  );
  // Every non-tail must actually be part of this label's chain, so an unrelated
  // record cannot hide behind a discovered_from pointing outside the set.
  const known = new Set(matches.map((record) => record.id));
  for (const record of matches) {
    const parent = record.edges?.discovered_from;
    if (record.id === tails[0].id) continue;
    assert.ok(
      parent === null || parent === undefined || known.has(parent),
      `${label} chain is broken: ${record.id} was discovered from ${parent}, which does not carry ${label}`,
    );
  }
  return tails[0];
}

const initiatives = roadmap.stages.flatMap((stage) =>
  stage.initiatives.map((initiative) => ({ initiative, stage })),
);
const roadmapIds = new Set(initiatives.map(({ initiative }) => initiative.id));

const extraRoadmapRecords = [...heads.values()].filter((record) =>
  record.labels?.some(
    (label) => /^roadmap:A\d+$/.test(label) && !roadmapIds.has(label.slice("roadmap:".length)),
  ),
);
assert.deepEqual(extraRoadmapRecords, [], "Pecia carries an initiative absent from the roadmap");

const recordsByRoadmapId = new Map();
for (const { initiative, stage } of initiatives) {
  const record = exactlyOne(`roadmap:${initiative.id}`);
  const stageRecord = exactlyOne(`roadmap:stage-${stage.id}`);
  recordsByRoadmapId.set(initiative.id, record);

  assert.equal(record.title, `${initiative.id} — ${initiative.title}`);
  assert.equal(record.edges?.parent, stageRecord.id, `${initiative.id} has the wrong stage parent`);

  const expectedStatus = {
    done: "done",
    "in-progress": "in-progress",
    ready: "open",
    planned: "open",
    blocked: "open",
  }[initiative.status];
  assert.equal(record.status, expectedStatus, `${initiative.id} status drifted from the roadmap`);
}

for (const stage of roadmap.stages) {
  const stageRecord = exactlyOne(`roadmap:stage-${stage.id}`);
  const childRecords = stage.initiatives.map((initiative) => recordsByRoadmapId.get(initiative.id));
  const expectedStatus = stage.productEvidenceStatus === "established" ? "done" : "open";
  if (expectedStatus === "done") {
    assert.ok(
      childRecords.every((record) => record.status === "done"),
      `${stage.id} cannot establish product evidence before child implementation is terminal`,
    );
    assert.equal(
      stage.exitEvidence.length,
      stage.exitCriteria.length,
      `${stage.id} product evidence does not cover every stage exit`,
    );
  }
  assert.equal(
    stageRecord.status,
    expectedStatus,
    `${stage.id} stage status drifted from product-evidence status`,
  );
  assert.notEqual(stageRecord.evidence, "unknown", `${stage.id} stage lacks evidence`);
}

for (const { initiative } of initiatives) {
  const target = recordsByRoadmapId.get(initiative.id);
  const actualDependencies = [...recordsByRoadmapId.entries()]
    .filter(([, candidate]) => candidate.edges?.blocks?.includes(target.id))
    .map(([id]) => id)
    .sort();
  assert.deepEqual(
    actualDependencies,
    [...initiative.dependsOn].sort(),
    `${initiative.id} dependency edges drifted from the roadmap`,
  );
}

const snapshotHead = readFileSync(resolve(ROOT, ".pecia/snapshot.head"), "utf8").trim();
assert.match(snapshotHead, /^[a-f0-9]{64}$/, "Pecia snapshot must name its timeline head");
assert.equal(snapshot.schemaVersion, 1, "Pecia snapshot manifest schema drifted");
assert.equal(snapshot.projectionDetectorVersion, "1.0.0", "Pecia detector version drifted");
assert.equal(
  snapshot.authority,
  "projection-only",
  "Pecia projection must not claim timeline authority",
);
assert.equal(snapshot.timelineHead, snapshotHead, "Pecia snapshot manifest and head disagree");
assert.equal(
  snapshot.workProjectionSha256,
  createHash("sha256").update(workProjectionBytes).digest("hex"),
  "Pecia work projection digest drifted",
);

console.log(
  `pecia-roadmap correspondence valid; ${initiatives.length} initiatives, ` +
    `${roadmap.stages.length} stages, ${revisions.length} revisions`,
);
