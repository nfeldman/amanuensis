import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { findMaterializer } from "./tools/materialize.js";

/**
 * The materializer's orientation lint, run on text before it is recorded.
 *
 * A recorded explanation or declination reason is printed only when this lint
 * clears it, and until now it ran only at render: an author learned that a body
 * would be withheld when publishing failed, sessions later. Running the same
 * Python function here, not a TypeScript copy, keeps one set of rules.
 *
 * Returns the violations (empty when the text is clear), or `null` when the lint
 * could not run: no materializer beside the server, or no Python. A null lets
 * the write through, because the render-time lint still withholds the text; the
 * write path only moves the warning earlier.
 */
export function orientationViolations(text: string): string[] | null {
  const script = findMaterializer();
  if (!script) {
    console.error("orientation lint not run at write time: materializer not found");
    return null;
  }
  const python = process.env.AMANUENSIS_PYTHON ?? "python3";
  const result = spawnSync(
    python,
    [
      "-I",
      "-c",
      [
        "import json, sys",
        "sys.path.insert(0, sys.argv[1])",
        "from amanuensis_materializer.lint import orientation_violations",
        "print(json.dumps(orientation_violations(sys.stdin.read())))",
      ].join("\n"),
      dirname(script),
    ],
    // SIGKILL: the lint holds no state, and an interpreter that ignored SIGTERM
    // would keep the server blocked past the bound.
    { input: text, encoding: "utf8", timeout: 30_000, killSignal: "SIGKILL" },
  );
  if (result.error || result.status !== 0) {
    const why = result.error?.message ?? (result.stderr.trim() || `exit ${result.status}`);
    console.error(`orientation lint not run at write time: ${why}`);
    return null;
  }
  try {
    const parsed = JSON.parse(result.stdout) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    /* reported below */
  }
  console.error("orientation lint not run at write time: its output was not a JSON list");
  return null;
}
