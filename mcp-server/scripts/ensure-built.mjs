// Compile `src/` into `dist/` before a gate reads it.
//
// The locus gates import their deliverables from `dist/`, which is a build
// artifact rather than the source under review. A sabotaged `src/` therefore
// leaves the previously compiled `dist/` in place and the gate certifies the
// old bytes: slice-S2's review demonstrated this three times (F1–F3/codex) —
// inverting the ancestor branch of `standing.ts:413` left P5's gate green until
// `npm run build` ran by hand. A gate that cannot see the edit it is meant to
// catch is a zero-denominator green (catalog VP4).
//
// Compiling here rather than prepending `npm run build` to the recorded gate
// command puts the guard in the substrate: the gate is protected however it is
// invoked, including the bare `node test-locus-*.mjs` a reviewer will actually
// type. This is a subtractive guard — it removes a stale input rather than
// asking a writer to supply a field — which is the shape the substrate-not-
// prompt result was measured on.
//
// Returns `{ ok, detail }`. It never throws and never exits: an absent compiler
// or a source that does not compile must reach the gate as an assertion
// failure, in keeping with how these gates already load their deliverables.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MCP = dirname(dirname(fileURLToPath(import.meta.url)));

let memo = null;

/**
 * Build `dist/` from `src/` with the repository's own pinned compiler.
 *
 * Memoized: a gate that calls this from more than one place compiles once.
 */
export function ensureBuilt() {
  if (memo) return memo;

  const tsc = join(MCP, "node_modules", "typescript", "bin", "tsc");
  if (!existsSync(tsc)) {
    memo = {
      ok: false,
      detail: `the pinned compiler is not installed at node_modules/typescript/bin/tsc — run npm install; ${
        existsSync(join(MCP, "dist"))
          ? "dist/ exists but cannot be trusted to match src/"
          : "dist/ is absent"
      }`,
    };
    return memo;
  }

  const result = spawnSync(process.execPath, [tsc, "-p", join(MCP, "tsconfig.json")], {
    cwd: MCP,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    memo = { ok: false, detail: `the compiler could not be run — ${result.error.message}` };
    return memo;
  }
  if (result.status !== 0) {
    const diagnostics = `${String(result.stdout ?? "")}${String(result.stderr ?? "")}`
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .slice(0, 5)
      .join(" / ");
    memo = {
      ok: false,
      detail: `src/ does not compile, so dist/ is stale and this gate would certify bytes that are not under review — ${diagnostics}`,
    };
    return memo;
  }

  memo = { ok: true, detail: null };
  return memo;
}
