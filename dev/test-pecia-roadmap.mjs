#!/usr/bin/env node

import assert from "node:assert/strict";
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

const heads = new Map();
for (const record of revisions) {
  const current = heads.get(record.id);
  if (!current || record.rev > current.rev) heads.set(record.id, record);
}

function recordsWithLabel(label) {
  return [...heads.values()].filter((record) => record.labels?.includes(label));
}

function exactlyOne(label) {
  const matches = recordsWithLabel(label);
  assert.equal(matches.length, 1, `${label} must identify exactly one Pecia head`);
  return matches[0];
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

console.log(
  `pecia-roadmap correspondence valid; ${initiatives.length} initiatives, ` +
    `${roadmap.stages.length} stages, ${revisions.length} revisions`,
);
