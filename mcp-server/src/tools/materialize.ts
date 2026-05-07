import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { optBool, optString, type ToolDefinition } from "../helpers.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));

// The materializer ships as a standalone Python script in the repo root's
// ../materializer/ directory. We search a few relative locations so this
// works in both dev (node src/...) and packaged (node dist/...) layouts.
function findMaterializer(): string | null {
  const envOverride = process.env.AMANUENSIS_MATERIALIZER;
  if (envOverride && existsSync(envOverride)) return envOverride;
  const candidates = [
    join(moduleDir, "..", "..", "..", "materializer", "materialize.py"),
    join(moduleDir, "..", "..", "materializer", "materialize.py"),
    join(moduleDir, "..", "materializer", "materialize.py"),
  ].map((p) => resolve(p));
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

export const materializeTools: ToolDefinition[] = [
  {
    name: "materialize_docs",
    description:
      "Render the conspectus from memory.db + prose artifacts into navigable documentation under <storage>/docs/. Diff-aware: re-renders only pages whose source data or prose has changed since the last run. output_dir overrides the default (project storage /docs). force_full=true re-renders everything.",
    inputSchema: {
      type: "object",
      properties: {
        output_dir: { type: "string" },
        force_full: { type: "boolean" },
      },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const outputDir = optString(args, "output_dir") ?? join(ctx.project.storagePath, "docs");
      const forceFull = optBool(args, "force_full", false);
      const script = findMaterializer();
      if (!script) {
        return {
          ok: false,
          error:
            "materializer not found; set AMANUENSIS_MATERIALIZER or install the materializer script next to mcp-server/",
        };
      }
      const py = process.env.AMANUENSIS_PYTHON ?? "python3";
      const cliArgs = [script, "--storage", ctx.project.storagePath, "--output", outputDir];
      if (forceFull) cliArgs.push("--force-full");
      const res = spawnSync(py, cliArgs, { encoding: "utf8" });
      if (res.error) {
        return { ok: false, error: `materializer failed to start: ${res.error.message}` };
      }
      if (res.status !== 0) {
        return {
          ok: false,
          error: `materializer exited ${res.status}: ${res.stderr?.trim() || res.stdout?.trim() || "no output"}`,
        };
      }
      // The materializer prints a JSON summary to stdout on success.
      const last = (res.stdout || "").trim().split("\n").filter(Boolean).pop();
      let summary: unknown = { ok: true };
      if (last) {
        try {
          summary = JSON.parse(last);
        } catch {
          summary = { ok: true, raw: res.stdout };
        }
      }
      return summary;
    },
  },
];
