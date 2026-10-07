#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  discoverCodexParentLaunch,
  discoverCodexParentWorkspace,
  isCodexAppServer,
  parseCodexParentWorkspace,
} from "./dist/codex-host.js";

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
assert(
  isCodexAppServer(
    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex -c features.code_mode_host=true app-server --analytics-default-enabled",
  ),
);
assert(isCodexAppServer("codex -c 'setting=app-server decoy' --profile work app-server"));
assert(isCodexAppServer('"/Applications/Codex App/codex" -c feature=true app-server'));
assert(!isCodexAppServer("node script.js app-server"));
assert(!isCodexAppServer("codex exec 'fix app-server --cd /tmp/decoy'"));
assert.deepEqual(
  discoverCodexParentLaunch({
    launchCwd: "/tmp/incidental-repository",
    readParentCommand: () => "codex --cd /tmp/incidental-repository app-server",
  }),
  { workspace: null, appServer: true },
);
console.log("Codex parent workspace detection: 12 passed, 0 failed");
