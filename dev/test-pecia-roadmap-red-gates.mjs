#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEV = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(DEV, "..");
const CHECKER = resolve(DEV, "test-pecia-roadmap.mjs");
const roadmapText = readFileSync(resolve(DEV, "roadmap.json"), "utf8");
const ledgerText = readFileSync(resolve(ROOT, ".pecia/work.jsonl"), "utf8");
const snapshotHead = readFileSync(resolve(ROOT, ".pecia/snapshot.head"), "utf8");
const snapshotManifest = readFileSync(resolve(ROOT, ".pecia/snapshot.json"), "utf8");
const scratch = mkdtempSync(resolve(tmpdir(), "amanuensis-pecia-roadmap-test-"));

function writeCase(name, mutate = () => {}) {
  const fixture = resolve(scratch, name);
  mkdirSync(resolve(fixture, "dev"), { recursive: true });
  mkdirSync(resolve(fixture, ".pecia"), { recursive: true });
  const state = {
    roadmap: JSON.parse(roadmapText),
    records: ledgerText
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
    head: snapshotHead,
    snapshot: JSON.parse(snapshotManifest),
  };
  mutate(state);
  const projection = `${state.records.map((record) => JSON.stringify(record)).join("\n")}\n`;
  if (!state.keepSnapshotDigest) {
    state.snapshot.workProjectionSha256 = createHash("sha256").update(projection).digest("hex");
  }
  writeFileSync(resolve(fixture, "dev/roadmap.json"), `${JSON.stringify(state.roadmap)}\n`);
  writeFileSync(resolve(fixture, ".pecia/work.jsonl"), projection);
  writeFileSync(resolve(fixture, ".pecia/snapshot.head"), state.head);
  writeFileSync(resolve(fixture, ".pecia/snapshot.json"), `${JSON.stringify(state.snapshot)}\n`);
  return fixture;
}

function run(fixture, expectedStatus, expectedText) {
  const result = spawnSync(process.execPath, [CHECKER, "--root", fixture], { encoding: "utf8" });
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.status !== expectedStatus || !output.includes(expectedText)) {
    throw new Error(
      `expected exit ${expectedStatus} with ${JSON.stringify(expectedText)}, got ${result.status}\n${output}`,
    );
  }
}

function headForLabel(state, label) {
  return state.records
    .filter((record) => record.labels?.includes(label))
    .sort((left, right) => right.rev - left.rev)[0];
}

try {
  run(writeCase("valid"), 0, "pecia-roadmap correspondence valid");

  run(
    writeCase("missing", (state) => {
      state.records = state.records.filter((record) => !record.labels?.includes("roadmap:A1"));
    }),
    1,
    "roadmap:A1 must identify exactly one Pecia head",
  );

  run(
    writeCase("stage-status", (state) => {
      headForLabel(state, "roadmap:stage-now").status = "done";
    }),
    1,
    "now stage status drifted from product-evidence status",
  );

  run(
    writeCase("stage-evidence", (state) => {
      headForLabel(state, "roadmap:stage-now").evidence = "unknown";
    }),
    1,
    "now stage lacks evidence",
  );

  run(
    writeCase("dependency", (state) => {
      const a0 = headForLabel(state, "roadmap:A0");
      const a1 = headForLabel(state, "roadmap:A1");
      a0.edges.blocks = a0.edges.blocks.filter((id) => id !== a1.id);
    }),
    1,
    "A1 dependency edges drifted from the roadmap",
  );

  run(
    writeCase("status", (state) => {
      headForLabel(state, "roadmap:A1").status = "open";
    }),
    1,
    "A1 status drifted from the roadmap",
  );

  run(
    writeCase("head", (state) => {
      state.head = `${"0".repeat(64)}\n`;
    }),
    1,
    "Pecia snapshot manifest and head disagree",
  );

  run(
    writeCase("projection-digest", (state) => {
      state.snapshot.workProjectionSha256 = "0".repeat(64);
      state.keepSnapshotDigest = true;
    }),
    1,
    "Pecia work projection digest drifted",
  );

  console.log(
    "pecia-roadmap red gates verified: missing, dependency, initiative/stage status, stage evidence, timeline identity, and projection digest drift",
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
