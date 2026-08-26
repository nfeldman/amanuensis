#!/usr/bin/env node

import { copyFileSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const apply = process.argv.slice(2).includes("--apply");
for (const argument of process.argv.slice(2)) {
  if (argument !== "--apply") throw new Error(`unknown argument: ${argument}`);
}

const configRoot = process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
const configPath = join(configRoot, "config.toml");
const before = readFileSync(configPath, "utf8");
const removedPaths = [];
const after = before.replace(
  /\n\[projects\."(\/private\/var\/folders\/[^"\n]+\/T\/amanuensis-codex-host-[^"\n]+\/(?:repository-a|repository-b|worktree-a))"\]\ntrust_level = "trusted"\n/g,
  (_block, path) => {
    removedPaths.push(path);
    return "";
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
  removedPaths,
  removedCount: removedPaths.length,
  beforeSha256: await sha256(before),
  afterSha256: await sha256(after),
  removedByteCount: before === after ? 0 : before.length - after.length,
};

if (apply && before !== after) {
  const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const backupPath = `${configPath}.bak.a22-host-trust.${timestamp}`;
  const temporaryPath = join(dirname(configPath), `.config.toml.a22-host-trust.${process.pid}`);
  copyFileSync(configPath, backupPath);
  writeFileSync(temporaryPath, after, {
    encoding: "utf8",
    mode: statSync(configPath).mode & 0o777,
  });
  renameSync(temporaryPath, configPath);
  report.backupPath = backupPath;
  report.readBackSha256 = await sha256(readFileSync(configPath, "utf8"));
  if (report.readBackSha256 !== report.afterSha256) {
    throw new Error("Codex configuration cleanup failed read-back");
  }
}

console.log(JSON.stringify(report, null, 2));
