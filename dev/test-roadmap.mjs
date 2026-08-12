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
    initiative(value, "A0").status = "ready";
  });
  run(
    ["--write", "--source", unfinishedActiveDependency, "--output", projection],
    1,
    "in-progress initiative A1 depends on unfinished A0",
  );

  const competingActiveWork = writeCase("competing-active-work", (value) => {
    initiative(value, "A2").status = "in-progress";
  });
  run(
    ["--write", "--source", competingActiveWork, "--output", projection],
    1,
    "at most one initiative may be in-progress",
  );

  const noFrontier = writeCase("no-frontier", (value) => {
    initiative(value, "A1").status = "planned";
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

  const brokenControl = writeCase("broken-control", (value) => {
    value.controlLadder[0].expected = "";
  });
  run(
    ["--write", "--source", brokenControl, "--output", projection],
    1,
    "controlLadder[0].expected is required",
  );

  console.log(
    "roadmap red gates verified: drift, dangling/unfinished dependency, cycle, missing criterion, evidence, practice coverage, and control integrity",
  );
} finally {
  rmSync(SCRATCH, { recursive: true, force: true });
}
