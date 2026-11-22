// A three-revision git repository for the refresh hint (SI8, PLAN §4.5).
//
// Everything is committed in a directory the caller supplies; nothing here reads a real
// repository. The base revision is where evidence is cited; the target revision is what a
// stale backlog is read against; the reordered revision only swaps two definitions no
// evidence cites.
//
//   src/kept.ts      keeper is kept; reader is kept while LIMIT, the constant it reads,
//                    changes value on its own line; alpha and beta swap in the reordered
//                    revision
//   src/moves.ts     mover, with its leading comment, moves below its neighbour
//   src/edits.ts     editor's body changes; documented changes only in its leading comment
//   src/gone.ts      doomed is deleted beside a survivor; the file still parses cleanly
//   lib/dups.py      twin, defined once, is defined twice in the branches of an `if`
//   src/broken.ts    fragile's syntax breaks beside sturdy, which stays intact
//   src/latin1.ts    a valid file becomes one that is not valid UTF-8
//   src/proto.cpp    twice is declared and defined under one symbol_id, as two kinds; only the
//                    definition's body changes
//   src/removed.ts   the whole file is deleted
//   src/quiet.ts     unchanged, so never stale
//   docs/notes.txt   a file in no supported language, edited
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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

function commit(dir, message) {
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", message]);
  return git(dir, ["rev-parse", "HEAD"]).trim();
}

const keptSource = (limit, first, second) => `export const LIMIT = ${limit};

export function keeper(): number {
  return 4;
}

${first}

${second}

export function reader(): number {
  return LIMIT * 2;
}
`;

const ALPHA = `export function alpha(): string {
  return "a";
}`;

const BETA = `export function beta(): string {
  return "b";
}`;

const MOVER = `/** Moves below its neighbour. */
export function mover(): number {
  return 1;
}`;

const SETTLED = `export function settled(): number {
  return 2;
}`;

const editsSource = (value, rule) => `export function editor(): number {
  return ${value};
}

/** Explains the ${rule} rule. */
export function documented(): number {
  return 6;
}
`;

const DOOMED = `export function doomed(): number {
  return 3;
}

`;

const SURVIVOR = `export function survivor(): number {
  return 5;
}
`;

const brokenSource = (body) => `export function sturdy(): number {
  return 7;
}

export function fragile(): number {
  ${body}
}
`;

const protoSource = (body) => `int twice(int x);

int twice(int x) {
  ${body}
}
`;

/** "café" in Latin-1: the 0xE9 byte alone is not valid UTF-8. */
const LATIN1_BYTES = Buffer.concat([
  Buffer.from('export function legible(): string {\n  return "caf', "latin1"),
  Buffer.from([0xe9]),
  Buffer.from('";\n}\n', "latin1"),
]);

export const FILES = [
  "docs/notes.txt",
  "lib/dups.py",
  "src/broken.ts",
  "src/edits.ts",
  "src/gone.ts",
  "src/kept.ts",
  "src/latin1.ts",
  "src/moves.ts",
  "src/proto.cpp",
  "src/quiet.ts",
  "src/removed.ts",
];

/** Build the base and target revisions in `dir`; `reorder()` adds the third. */
export function buildRefreshRepo(dir) {
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "gate@localhost"]);
  git(dir, ["config", "user.name", "gate"]);
  git(dir, ["config", "commit.gpgsign", "false"]);

  write(dir, "src/kept.ts", keptSource(10, ALPHA, BETA));
  write(dir, "src/moves.ts", `${MOVER}\n\n${SETTLED}\n`);
  write(dir, "src/edits.ts", editsSource(2, "old"));
  write(dir, "src/gone.ts", DOOMED + SURVIVOR);
  write(dir, "lib/dups.py", "def twin():\n    return 1\n");
  write(dir, "src/broken.ts", brokenSource("return 8;"));
  write(dir, "src/latin1.ts", 'export function legible(): string {\n  return "cafe";\n}\n');
  write(dir, "src/proto.cpp", protoSource("return x * 2;"));
  write(dir, "src/removed.ts", "export function orphan(): number {\n  return 0;\n}\n");
  write(dir, "src/quiet.ts", "export function hush(): number {\n  return 0;\n}\n");
  write(dir, "docs/notes.txt", "First notes.\n");
  const base = commit(dir, "base");

  write(dir, "src/kept.ts", keptSource(20, ALPHA, BETA));
  write(dir, "src/moves.ts", `${SETTLED}\n\n${MOVER}\n`);
  write(dir, "src/edits.ts", editsSource(3, "new"));
  write(dir, "src/gone.ts", SURVIVOR);
  write(
    dir,
    "lib/dups.py",
    'import os\n\nif os.name == "nt":\n    def twin():\n        return 1\nelse:\n    def twin():\n        return 2\n',
  );
  write(dir, "src/broken.ts", brokenSource("return (1 + ;"));
  write(dir, "src/latin1.ts", LATIN1_BYTES);
  write(dir, "src/proto.cpp", protoSource("return x + x;"));
  rmSync(join(dir, "src/removed.ts"));
  write(dir, "docs/notes.txt", "Second notes.\n");
  const target = commit(dir, "target");

  const reorder = () => {
    write(dir, "src/kept.ts", keptSource(20, BETA, ALPHA));
    return commit(dir, "reorder alpha and beta");
  };
  return { workspace: dir, base, target, reorder };
}
