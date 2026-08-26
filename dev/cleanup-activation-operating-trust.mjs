#!/usr/bin/env node
// Remove only Codex trust entries for one A25 temporary harness root. The
// command is a dry run unless --apply is supplied; apply always takes a
// timestamped backup and verifies byte-for-byte read-back.
import {
  copyFileSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

let apply = false;
let scratchRoot;
for (let index = 0; index < process.argv.slice(2).length; index += 1) {
  const argument = process.argv.slice(2)[index];
  if (argument === "--apply") apply = true;
  else if (argument === "--scratch-root") scratchRoot = process.argv.slice(2)[++index];
  else throw new Error(`unknown argument: ${argument}`);
}
if (!scratchRoot)
  throw new Error("usage: cleanup-activation-operating-trust.mjs --scratch-root PATH [--apply]");

const canonicalScratch = realpathSync(resolve(scratchRoot));
const canonicalTemporaryRoot = realpathSync(tmpdir());
if (
  dirname(canonicalScratch) !== canonicalTemporaryRoot ||
  !/^amanuensis-a25-operating-[A-Za-z0-9_-]+$/.test(basename(canonicalScratch))
) {
  throw new Error(`refusing non-A25 scratch root: ${canonicalScratch}`);
}
const configRoot = process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
const configPath = join(configRoot, "config.toml");
const before = readFileSync(configPath, "utf8");
const removedPaths = [];
const after = before.replace(
  /\n\[projects\."([^"\n]+)"\]\ntrust_level = "trusted"\n/g,
  (block, path) => {
    if (path === canonicalScratch || path.startsWith(`${canonicalScratch}/`)) {
      removedPaths.push(path);
      return "";
    }
    return block;
  },
);
const sha256 = async (value) => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
const report = {
  mode: apply ? "apply" : "dry-run",
  configPath,
  scratchRoot: canonicalScratch,
  removedPaths,
  removedCount: removedPaths.length,
  beforeSha256: await sha256(before),
  afterSha256: await sha256(after),
  removedByteCount: before.length - after.length,
};

if (apply && before !== after) {
  const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const backupPath = `${configPath}.bak.a25-host-trust.${timestamp}`;
  const temporaryPath = join(dirname(configPath), `.config.toml.a25-host-trust.${process.pid}`);
  copyFileSync(configPath, backupPath);
  writeFileSync(temporaryPath, after, {
    encoding: "utf8",
    mode: statSync(configPath).mode & 0o777,
  });
  renameSync(temporaryPath, configPath);
  report.backupPath = backupPath;
  report.backupSha256 = await sha256(readFileSync(backupPath, "utf8"));
  report.readBackSha256 = await sha256(readFileSync(configPath, "utf8"));
  if (report.backupSha256 !== report.beforeSha256 || report.readBackSha256 !== report.afterSha256) {
    throw new Error("Codex configuration cleanup failed backup or read-back verification");
  }
}

console.log(JSON.stringify(report, null, 2));
