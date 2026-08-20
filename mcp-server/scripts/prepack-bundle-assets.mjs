#!/usr/bin/env node
// Mirror the canonical skill and materializer
// into the mcp-server package so they ship inside the published npm tarball.
// The derivative mirrors are generated only for packaging; their sources of
// truth remain in the repository root.
//
// Run automatically by `npm pack` / `npm publish` via the `prepack`
// script. Safe to run ad-hoc: `node scripts/prepack-bundle-assets.mjs`.
//
// The derivative mirrors under mcp-server/ are .gitignored — the
// sources of truth are at the repo root.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const mcpRoot = resolve(moduleDir, "..");
const repoRoot = resolve(mcpRoot, "..");

// v0.1 generated a VS Code custom-agent mirror here. It is no longer part of
// the portable package; clear any stale local copy before calculating the
// publish artifact.
const obsoleteAgents = join(mcpRoot, "agents");
if (existsSync(obsoleteAgents)) rmSync(obsoleteAgents, { recursive: true, force: true });

// Each target: source (absolute, under repoRoot), dest (absolute,
// under mcpRoot), and an optional `skip` predicate that receives a
// path relative to the source root and returns true to exclude.
const targets = [
  {
    name: "skill",
    source: join(repoRoot, ".claude", "skills", "amanuensis"),
    dest: join(mcpRoot, "skills", "amanuensis"),
  },
  {
    name: "materializer",
    source: join(repoRoot, "materializer"),
    dest: join(mcpRoot, "materializer"),
    // Skip dev-only artifacts. The published package ships the code
    // the MCP server subprocesses into (materialize.py + the
    // amanuensis_materializer/ package) plus minimal docs; it should
    // NOT ship test fixtures, ruff caches, or test scripts.
    skip: (relPath) =>
      relPath === ".ruff_cache" ||
      relPath.startsWith(".ruff_cache/") ||
      relPath === "__pycache__" ||
      relPath.includes("/__pycache__") ||
      relPath === "test-materializer.py" ||
      relPath === "test-readback.py" ||
      relPath === ".gitignore",
  },
];

function copyTree(from, to, relPath, skip) {
  for (const entry of readdirSync(from)) {
    const childRel = relPath ? `${relPath}/${entry}` : entry;
    if (skip?.(childRel)) continue;
    const src = join(from, entry);
    const dest = join(to, entry);
    const st = statSync(src);
    if (st.isDirectory()) {
      mkdirSync(dest, { recursive: true });
      copyTree(src, dest, childRel, skip);
    } else if (st.isFile()) {
      copyFileSync(src, dest);
    }
  }
}

for (const target of targets) {
  if (!existsSync(target.source) || !statSync(target.source).isDirectory()) {
    process.stderr.write(
      `prepack-bundle-assets: source missing: ${target.source}\n` +
        `  (${target.name} cannot be bundled)\n`,
    );
    process.exit(1);
  }
  if (existsSync(target.dest)) {
    rmSync(target.dest, { recursive: true, force: true });
  }
  mkdirSync(target.dest, { recursive: true });
  copyTree(target.source, target.dest, "", target.skip);
  console.log(`bundled ${target.name}: ${target.source} → ${target.dest}`);
}
