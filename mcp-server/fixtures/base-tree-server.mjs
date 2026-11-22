// Build the MCP server of an earlier commit into a temporary directory.
//
// Used by GATE SO2 (design/store-only/PLAN.md §5.1, §8 SO2) to check that the
// server of the lane's start commit still opens and reads a store the new
// server migrated, and by build-legacy-stores.mjs to write stores on that
// commit's schema. The tree comes from `git archive`, so nothing in the
// worktree is touched; node_modules is the worktree's, linked rather than
// installed, so no network is needed.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MCP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(MCP_ROOT, "..");

/**
 * Returns `{ ok: true, root, cleanup }` where `root/dist/db.js` is the base
 * tree's server, or `{ ok: false, reason }` with a one-line reason.
 */
export function buildBaseTreeServer(sha) {
  const known = spawnSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: REPO_ROOT });
  if (known.status !== 0) {
    return {
      ok: false,
      reason: `commit ${sha.slice(0, 12)} is not in this clone (a shallow checkout needs fetch-depth: 0)`,
    };
  }
  const dir = mkdtempSync(join(tmpdir(), "amanuensis-base-tree-"));
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  const archive = spawnSync(
    "git",
    ["archive", "--format=tar", sha, "mcp-server/src", "mcp-server/tsconfig.json", "mcp-server/package.json"],
    { cwd: REPO_ROOT, maxBuffer: 256 * 1024 * 1024 },
  );
  if (archive.status !== 0) {
    cleanup();
    return { ok: false, reason: `git archive ${sha.slice(0, 12)} failed: ${String(archive.stderr).trim()}` };
  }
  const untar = spawnSync("tar", ["-x", "-C", dir], { input: archive.stdout });
  if (untar.status !== 0) {
    cleanup();
    return { ok: false, reason: `unpacking the base tree failed: ${String(untar.stderr).trim()}` };
  }
  const root = join(dir, "mcp-server");
  symlinkSync(join(MCP_ROOT, "node_modules"), join(root, "node_modules"), "dir");
  const tsc = join(MCP_ROOT, "node_modules", "typescript", "bin", "tsc");
  const build = spawnSync(process.execPath, [tsc, "-p", join(root, "tsconfig.json")], {
    cwd: root,
    encoding: "utf8",
  });
  if (build.status !== 0 || !existsSync(join(root, "dist", "db.js"))) {
    cleanup();
    return {
      ok: false,
      reason: `building the base tree's server failed: ${`${build.stdout}${build.stderr}`.trim().split("\n").slice(0, 3).join(" | ")}`,
    };
  }
  return { ok: true, root, cleanup };
}
