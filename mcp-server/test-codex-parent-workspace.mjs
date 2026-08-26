#!/usr/bin/env node

import assert from "node:assert/strict";
import { discoverCodexParentWorkspace, parseCodexParentWorkspace } from "./dist/codex-host.js";

assert.equal(
  parseCodexParentWorkspace(
    "codex exec --json --cd /tmp/repository-b a-prompt-with-more-flags",
    "/tmp/repository-a",
  ),
  "/tmp/repository-b",
);
assert.equal(
  parseCodexParentWorkspace(
    "/opt/homebrew/bin/codex exec -C '../repository b' prompt",
    "/tmp/repository-a",
  ),
  "/tmp/repository b",
);
assert.equal(
  parseCodexParentWorkspace("node dist/index.js --cd /tmp/decoy", "/tmp/repository-a"),
  null,
);
assert.equal(parseCodexParentWorkspace("codex exec prompt", "/tmp/repository-a"), null);
assert.throws(
  () => parseCodexParentWorkspace("codex exec --cd", "/tmp/repository-a"),
  /unreadable --cd workspace/,
);
assert.equal(
  discoverCodexParentWorkspace({
    parentPid: 42,
    launchCwd: "/tmp/repository-a",
    readParentCommand: (pid) => `codex exec --cd /tmp/repository-${pid}`,
  }),
  "/tmp/repository-42",
);
console.log("Codex parent workspace detection: 6 passed, 0 failed");
