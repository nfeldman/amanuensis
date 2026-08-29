#!/usr/bin/env node
// B02-2: every subprocess on the startup and project-binding path was
// synchronous and unbounded. execFileSync blocks the Node event loop for the
// call's full duration, so a stalled `ps` or `git` — a slow network filesystem,
// an unresponsive credential helper, a very large repository — hangs the server
// before it reaches a usable state, with no diagnosis. ADR-0021's acceptance
// boundary runs straight through these calls on every start.
//
// The probes here put a deliberately slow executable ahead of the real one on
// PATH and require the call to give up and stay usable. Before the repair each
// one blocked for the full sleep.
import { chmodSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { discoverCodexParentWorkspace } from "./dist/codex-host.js";
import { resolveProject } from "./dist/project.js";

let passed = 0;
let failed = 0;
function t(label, fn) {
  try {
    fn();
    console.log(`  ok   ${label}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL ${label}\n       ${e.message}`);
    failed++;
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// A stub that sleeps far longer than any bound we would accept, so a passing
// result can only mean the call bounded itself.
const SLEEP_SECONDS = 30;
function stubDir(names) {
  const dir = mkdtempSync(join(tmpdir(), "slow-bin-"));
  for (const name of names) {
    const path = join(dir, name);
    // Touch a marker before sleeping, so the test can tell "the bound held"
    // from "the stub was never reached" — a timing assertion that never ran
    // the slow path would pass for the wrong reason.
    writeFileSync(path, `#!/bin/sh\ntouch "${join(dir, "invoked")}"\nsleep ${SLEEP_SECONDS}\n`);
    chmodSync(path, 0o755);
  }
  return dir;
}

function withStubbedPath(names, fn) {
  const dir = stubDir(names);
  const original = process.env.PATH;
  process.env.PATH = `${dir}:${original}`;
  const started = Date.now();
  try {
    const value = fn();
    return { value, elapsed: Date.now() - started, invoked: existsSync(join(dir, "invoked")) };
  } finally {
    process.env.PATH = original;
    rmSync(dir, { recursive: true, force: true });
  }
}

t("a stalled ps does not hang Codex parent-workspace discovery", () => {
  const { elapsed, invoked } = withStubbedPath(["ps"], () =>
    discoverCodexParentWorkspace({ parentPid: process.pid, launchCwd: process.cwd() }),
  );
  assert(invoked, "the stub ps was never invoked; this probe proved nothing");
  assert(
    elapsed < (SLEEP_SECONDS * 1000) / 2,
    `parent-workspace discovery blocked for ${elapsed}ms; the ps probe is unbounded`,
  );
});

// Synchronous on purpose: the harness does not await, so an async body would
// report a pass before any of its assertions ran.
t("a stalled git does not hang project binding", () => {
  const workspace = mkdtempSync(join(tmpdir(), "slow-bind-"));
  mkdirSync(join(workspace, "src"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: workspace });
  try {
    const { elapsed, invoked } = withStubbedPath(["git"], () => {
      try {
        return resolveProject(workspace, {
          selectionSource: "test-startup-bounds",
          serverVersion: "test",
        });
      } catch (error) {
        // Failing is fine; hanging is not. A bounded probe may legitimately
        // surface as an error once its timeout expires.
        return error;
      }
    });
    assert(invoked, "the stub git was never invoked; this probe proved nothing");
    assert(
      elapsed < (SLEEP_SECONDS * 1000) / 2,
      `project binding blocked for ${elapsed}ms; its git probes are unbounded`,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
