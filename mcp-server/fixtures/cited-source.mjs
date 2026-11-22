// Source files for fixtures to cite.
//
// add_evidence checks a citation against the file at its ref_sha: the path
// must exist, each line_range span must lie inside the file, and an excerpt
// must appear in the cited lines. A fixture that cites `src/B-01/index.ts`
// lines 1-4 therefore has to commit that file with at least four lines first.
// These helpers write such a file. Every line is distinct, so an excerpt quoted
// from it can only match where it really is.
//
// Lines 1-4 are one definition, `Unit`, so a citation of `Unit` at lines 1-4
// names a definition the code index finds there (semantic-index PLAN §4.4,
// §11): with the index on, add_evidence refuses a symbol in a TypeScript file
// that names no definition, or a line_range that leaves the one it names.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const CITED_SOURCE_LINES = 60;

/** The text of a cited source file: `CITED_SOURCE_LINES` distinct lines. */
export function citedSource(label = "unit") {
  const lines = ["export interface Unit {", `  label: "${label}";`, "  line: number;", "}"];
  for (let n = 5; n <= CITED_SOURCE_LINES; n++) lines.push(`export const line${n} = ${n};`);
  return `${lines.join("\n")}\n`;
}

/** Write a cited source file at each workspace-relative path. Does not commit. */
export function writeCitedSources(workspace, paths) {
  for (const path of paths) {
    mkdirSync(dirname(join(workspace, path)), { recursive: true });
    writeFileSync(join(workspace, path), citedSource(path));
  }
}
