// A one-revision git repository for anchored evidence (SI7, PLAN §4.4).
//
// Everything is committed in a directory the caller supplies; nothing here reads a real
// repository.
//
//   src/shapes.ts    a documented function; two functions on one line, so an excerpt can come
//                    from a neighbour on the same line; two classes that each define `render`
//   src/Parser.java  an overloaded method, whose qname differs from each symbol_id
//   lib/dup.py       one function defined twice, in the branches of an `if`
//   src/latin1.ts    a file that is not valid UTF-8, which the index cannot read
//   docs/notes.txt   a file in no supported language
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

function git(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

function write(dir, path, content) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
}

export const SHAPES_SOURCE = `/** Adds two numbers. */
export function add(a: number, b: number): number {
  const sum = a + b;
  return sum;
}

export function one() { return "alpha"; } export function two() { return "beta"; }

export class Label {
  render(): string {
    return "label";
  }
}

export class Button {
  render(): string {
    return "button";
  }
}
`;

export const PARSER_SOURCE = `/** Parses text. */
class Parser {
    /** Parses a whole string. */
    int parse(String s) {
        return 0;
    }

    /** Parses with a base. */
    int parse(String s, int base) {
        return base;
    }
}
`;

export const DUP_SOURCE = `import os

if os.name == "nt":
    def sep():
        return "\\\\"
else:
    def sep():
        return "/"
`;

/** "café" in Latin-1: the 0xE9 byte alone is not valid UTF-8. */
export const LATIN1_BYTES = Buffer.concat([
  Buffer.from('export const caf = "caf', "latin1"),
  Buffer.from([0xe9]),
  Buffer.from('";\n', "latin1"),
]);

/** Build the repository in `dir` and return its commit. */
export function buildEvidenceAnchorsRepo(dir) {
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "gate@localhost"]);
  git(dir, ["config", "user.name", "gate"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  write(dir, "src/shapes.ts", SHAPES_SOURCE);
  write(dir, "src/Parser.java", PARSER_SOURCE);
  write(dir, "lib/dup.py", DUP_SOURCE);
  write(dir, "src/latin1.ts", LATIN1_BYTES);
  write(dir, "docs/notes.txt", "Notes in no language the index parses.\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "evidence anchors fixture"]);
  return { workspace: dir, commit: git(dir, ["rev-parse", "HEAD"]).trim() };
}
