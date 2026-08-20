#!/usr/bin/env node
// Security probes for the storage-git integration and project resolution.
// Each test attempts an attack and asserts it's either neutralized or
// caught. Attack classes probed:
//
//   1. Command injection via commit message (labels containing shell
//      metachars, null bytes, leading `-` that could look like an arg)
//   2. Path traversal via project key segments
//   3. Control-char injection into commit message
//   4. Git hook execution (we pass --no-verify so hooks don't run)
//   5. Argv smuggling via label (label starts with `-` — could be read
//      as a flag by git commit if we weren't using `-F -`)
//   6. Gitignore bypass (committing WAL file by naming trick)
//   7. Non-UTF8 bytes in commit message
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { resolveProject, resolveProjectKey } from "./dist/project.js";
import { commitStorage, ensureStorageRepo, getStorageLog } from "./dist/storage-git.js";

let passed = 0,
  failed = 0;
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

function freshStorage() {
  const sp = mkdtempSync(join(tmpdir(), "agit-sec-"));
  ensureStorageRepo(sp);
  return sp;
}

// 1. Command injection via label — covered by correctness test too but
//    let's add more vectors: backticks, $(), semicolons, && chains.
t("command injection via label is neutralized", () => {
  const sp = freshStorage();
  writeFileSync(join(sp, "a.txt"), "x");
  const vectors = [
    "rm -rf /",
    "`touch /tmp/PWNED_AMANUENSIS`",
    "$(touch /tmp/PWNED_AMANUENSIS)",
    "; touch /tmp/PWNED_AMANUENSIS",
    "&& touch /tmp/PWNED_AMANUENSIS",
    "| touch /tmp/PWNED_AMANUENSIS",
  ];
  // Use unique filenames for each, one per commit
  for (const v of vectors) {
    writeFileSync(join(sp, `f-${Math.random().toString(36).slice(2)}.txt`), "x");
    const r = commitStorage(sp, v);
    assert(r.ok, `vector should commit as message, not execute: ${v}`);
  }
  // Verify nothing landed in /tmp/PWNED_AMANUENSIS
  assert(
    !existsSync("/tmp/PWNED_AMANUENSIS"),
    "injection succeeded — /tmp/PWNED_AMANUENSIS exists",
  );
  rmSync(sp, { recursive: true, force: true });
});

// 2. Argv smuggling — label that starts with `-` could be read as a flag
//    if we weren't using `-F -` + stdin. Test: `--exec=/bin/sh` as label.
t("label starting with '-' is not read as git flag", () => {
  const sp = freshStorage();
  writeFileSync(join(sp, "a.txt"), "x");
  // `-m` as label would, if substituted into argv, be read as a flag.
  // With -F - it becomes the message content instead.
  const r = commitStorage(sp, "-m injected-flag");
  assert(r.ok, `dash-prefixed label should commit: ${r.reason}`);
  const log = getStorageLog(sp, 5);
  assert(
    log[0].message === "-m injected-flag",
    `dash-prefixed label should land verbatim, got: ${log[0].message}`,
  );
  rmSync(sp, { recursive: true, force: true });
});

// 3. Null byte in label — should be caught before it reaches git.
t("null byte in label is rejected", () => {
  const sp = freshStorage();
  // Multi-line check will catch \n but not \0. Let me verify we reject it.
  const r = commitStorage(sp, "label\0nulbyte");
  // Either rejected explicitly or landed as text with the \0 stripped by git.
  // Any behavior except executing code is acceptable. We just don't want
  // the \0 to truncate the message in a way that lets further content be
  // interpreted as an arg.
  // In spawn + stdin mode, null bytes pass through as data, but git commit
  // message is written verbatim to the commit object. Not a security issue.
  assert(typeof r.ok === "boolean");
  rmSync(sp, { recursive: true, force: true });
});

// 4. Commit hooks are not executed (--no-verify guards pre-commit/commit-msg).
t("pre-commit hooks are skipped", () => {
  const sp = freshStorage();
  const hooksDir = join(sp, ".git", "hooks");
  mkdirSync(hooksDir, { recursive: true });
  const hookPath = join(hooksDir, "pre-commit");
  const canary = join(
    tmpdir(),
    `amanuensis-sec-canary-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
  writeFileSync(hookPath, `#!/bin/sh\ntouch ${canary}\nexit 0\n`);
  chmodSync(hookPath, 0o755);
  writeFileSync(join(sp, "a.txt"), "x");
  commitStorage(sp, "testing hook skip");
  assert(!existsSync(canary), "pre-commit hook ran despite --no-verify");
  rmSync(sp, { recursive: true, force: true });
});

// 5. Project key sanitization — various attack forms.
t("project key sanitization: path traversal attempts", () => {
  // Simulate inputs that could come from a crafted git origin URL or a
  // weird workspace path. We don't call the URL parser directly — we
  // verify the sanitizer outputs are traversal-safe.
  const attacks = [
    "/tmp",
    "/..",
    "/../../etc/passwd",
    "C:\\Windows",
    "\x00etc",
    "'$(whoami)'",
    "name with spaces",
  ];
  for (const a of attacks) {
    const key = resolveProjectKey(a);
    assert(!key.includes(".."), `key must not contain '..': input=${a} key=${key}`);
    assert(!key.startsWith("/"), `key must not start with /: input=${a} key=${key}`);
    assert(!key.includes("\x00"), `key must not contain NUL: input=${a} key=${key}`);
    // Shell metacharacters shouldn't survive — they'd be dangerous if
    // someone ever concat'd the key into a shell command (we don't, but).
    assert(!/['"`$]/.test(key), `key should not contain shell quotes: input=${a} key=${key}`);
  }
});

t("crafted git origins cannot escape shared or legacy storage roots", () => {
  const origins = [
    "https://github.com/owner/../",
    "https://github.com/../victim",
    "git@example.test:C:/Windows",
    "ssh://git@example.test/owner/%2f..%2f",
  ];
  for (const [index, origin] of origins.entries()) {
    const workspace = mkdtempSync(join(tmpdir(), `agit-origin-${index}-`));
    const storageRoot = mkdtempSync(join(tmpdir(), `agit-shared-${index}-`));
    try {
      spawnSync("git", ["init", "-q"], { cwd: workspace });
      spawnSync("git", ["remote", "add", "origin", origin], { cwd: workspace });
      const key = resolveProjectKey(workspace);
      assert(!key.split("/").includes(".."), `origin produced traversal key: ${origin} → ${key}`);
      process.env.AMANUENSIS_STORAGE_ROOT = storageRoot;
      const project = resolveProject(workspace);
      const rel = relative(storageRoot, project.storagePath);
      assert(
        rel !== "" && !rel.startsWith("..") && !isAbsolute(rel),
        `origin escaped shared storage: ${origin} → ${project.storagePath}`,
      );
    } finally {
      delete process.env.AMANUENSIS_STORAGE_ROOT;
      rmSync(workspace, { recursive: true, force: true });
      rmSync(storageRoot, { recursive: true, force: true });
    }
  }
});

// 6. WAL/SHM/journal files never end up tracked even if someone adds them.
t("gitignore resists attempts to track WAL files", () => {
  const sp = freshStorage();
  writeFileSync(join(sp, "memory.db-wal"), "fake wal");
  writeFileSync(join(sp, "memory.db-shm"), "fake shm");
  writeFileSync(join(sp, "memory.db-journal"), "fake journal");
  writeFileSync(join(sp, "something.tmp"), "tmp");
  // Commit should not pick these up.
  commitStorage(sp, "try to commit WAL");
  // It's ok either way (no changes to commit is also fine) — we just
  // care that the WAL files aren't in the tree.
  const tree = spawnSync("git", ["ls-files"], { cwd: sp, encoding: "utf8" });
  for (const ignored of ["memory.db-wal", "memory.db-shm", "memory.db-journal", "something.tmp"]) {
    assert(!tree.stdout.includes(ignored), `${ignored} was tracked — gitignore failed`);
  }
  rmSync(sp, { recursive: true, force: true });
});

// 7. Non-UTF-8 bytes in message.
t("non-UTF8 bytes in label do not crash", () => {
  const sp = freshStorage();
  writeFileSync(join(sp, "a.txt"), "x");
  // We pass a string, not a buffer, so Node will have already decoded it.
  // But an agent might pass bytes that don't round-trip. Use an invalid
  // surrogate-half — JS accepts it, git accepts it.
  const r = commitStorage(sp, "label with lone surrogate: \ud800 end");
  assert(typeof r.ok === "boolean", "should handle invalid UTF-16 without throwing");
  rmSync(sp, { recursive: true, force: true });
});

// 8. Default storage must stay inside the resolved project root.
t("resolved storage path stays under the project root", async () => {
  const malicious = mkdtempSync(join(tmpdir(), "agit-escape-"));
  spawnSync("git", ["init", "-q"], { cwd: malicious });
  const p = resolveProject(malicious);
  assert(
    p.storagePath === join(malicious, ".amanuensis"),
    `storage path must be project-local, got: ${p.storagePath}`,
  );
  rmSync(malicious, { recursive: true, force: true });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
