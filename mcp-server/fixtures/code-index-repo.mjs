// A two-revision git repository for the code-index read tools (SI5).
//
// Both revisions are committed in a directory the caller supplies; nothing here reads a real
// repository. The second revision edits the body of `add`, adds `subtract`, and leaves every
// other file as it was, so a reader asking for the first revision gets the older body and no
// `subtract`.
//
//   src/shapes.ts    documented functions and classes; `render` is defined by two classes
//   src/big.ts       a definition whose citeable span is exactly 500 lines, with a nested
//                    definition inside the first 400 lines and another after them
//   src/unicode.ts   non-ASCII text, so byte offsets differ from UTF-16 offsets
//   lib/dup.py       one function defined twice, in the branches of an `if`
//   lib/twice.js     one documented function declared twice, so an occurrence has a
//                    citeable span that starts above its declaration
//   src/Parser.java  an overloaded method, whose qname differs from each symbol_id
//   docs/notes.txt   a file in no supported language
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const BIG_SPAN_LINES = 500;

// Git runs with no global or system configuration, so a user's hooks, templates or default
// branch never reach the fixture.
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

function git(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

function write(dir, path, content) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
}

/** `add`'s body differs between the revisions; every other line of the file is the same. */
export function shapesSource(revision) {
  const body = revision === 1 ? "a + b" : "b + a";
  const tail =
    revision === 1
      ? ""
      : `
/** Subtracts the second number from the first. */
export function subtract(a: number, b: number): number {
  return a - b;
}
`;
  return `import { readFileSync } from "node:fs";
import type { Stats } from "node:fs";

/** Adds two numbers. */
export function add(a: number, b: number): number {
  return ${body};
}

/**
 * A label widget.
 */
export class Label {
  name = "label";

  /** Renders the label. */
  render(): string {
    return this.name;
  }
}

export class Button {
  render(): string {
    return "button";
  }
}

export const limit = 10;
${tail}`;
}

/** `bigFunction` runs from its comment on line 1 to its closing brace on line 500. */
export function bigSource() {
  const lines = ["/** A function far longer than a reader should be handed whole. */"];
  lines.push("export function bigFunction(seed: number): number {");
  lines.push("  let total = seed;");
  lines.push("  function inner(x: number): number {");
  lines.push("    return x + 1;");
  lines.push("  }");
  while (lines.length < 449) lines.push(`  total += ${lines.length};`);
  lines.push("  function late(x: number): number {");
  lines.push("    return x * 2;");
  lines.push("  }");
  while (lines.length < 498) lines.push(`  total += ${lines.length};`);
  lines.push("  return total;");
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

export const UNICODE_SOURCE = `// Ünïcödé fixture: offsets are UTF-8 bytes, not UTF-16 code units.
export const 名前 = "東京";

/** Grüße — returns a greeting with an emoji 😀. */
export function grüße(wer: string): string {
  return \`Hallo, \${wer} 👋\`;
}

export const after = "ß";
`;

export const DUP_SOURCE = `"""Two definitions of one function."""
import os
import sys as system

if os.name == "nt":
    def sep():
        return "\\\\"
else:
    def sep():
        return "/"
`;

export const TWICE_SOURCE = `/** Doubles by multiplying. */
function twice(x) {
  return x * 2;
}

/** Doubles by adding. */
function twice(x) {
  return x + x;
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

/** Build the repository in `dir` and return its two commits. */
export function buildCodeIndexRepo(dir) {
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "gate@localhost"]);
  git(dir, ["config", "user.name", "gate"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  write(dir, "src/shapes.ts", shapesSource(1));
  write(dir, "src/big.ts", bigSource());
  write(dir, "src/unicode.ts", UNICODE_SOURCE);
  write(dir, "lib/dup.py", DUP_SOURCE);
  write(dir, "lib/twice.js", TWICE_SOURCE);
  write(dir, "src/Parser.java", PARSER_SOURCE);
  write(dir, "docs/notes.txt", "Notes in no language the index parses.\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "--no-verify", "-m", "first revision"]);
  const first = git(dir, ["rev-parse", "HEAD"]).trim();
  write(dir, "src/shapes.ts", shapesSource(2));
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "--no-verify", "-m", "second revision"]);
  const second = git(dir, ["rev-parse", "HEAD"]).trim();
  return { workspace: dir, first, second };
}
