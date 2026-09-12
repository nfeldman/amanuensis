#!/usr/bin/env node
// Gate for reader-lenses packet P13 — cited edges and topology from recorded
// rows only (spec.md §9.2; claims C45, C55, C63).
//
// Turns red when:
//   - `add_xref` records an edge with no `context`, an empty `context`, a
//     whitespace-only one, or one carrying no whitespace-delimited token that
//     matches the §9.2 citation grammar (`file:symbol@sha`, 7–40 hex);
//   - it accepts a token whose revision does not resolve in the bound
//     workspace — an unknown sha, or one that resolves only in another repo;
//   - it accepts a token whose path is absolute, traversing, or points into
//     `.amanuensis`, the reserved tool state;
//   - it *rejects* prose that contains a well-formed token, which is the
//     complementary defect `requireWorkspaceCitation` shipped with: the
//     documented "one-line: why this link matters" shape had no `@` and was
//     refused outright;
//   - the prose-prefix trap still parses: `"why: src/a.ts:sym@<sha>"` must be
//     recorded with `src/a.ts:sym@<sha>` as the citation, never with `why`
//     normalized as the path and the real citation never checked;
//   - the stored `context` is not the caller's prose byte-for-byte, or the
//     validated tokens do not come back in `citations[]`;
//   - symbol reachability is checked after all — a token naming a symbol that
//     is not in the file must still be recorded — or the tool's own contract
//     text does not say that reachability is unchecked;
//   - `context` is not required by the published input schema, so a host that
//     validates against the schema would send a call the handler must refuse;
//   - `describe_locus`'s `boundaries` section drops a recorded edge for an
//     owning subsystem, invents one for a subsystem that has none, or presents
//     a cited edge as unbound to a revision;
//   - `architecture.md` renders a dependency topology on a store with zero
//     `xrefs` rows instead of the layer atlas, or renders the atlas without
//     saying that no edges are recorded and that the map is not inferred;
//   - a rendered edge has no `xrefs` row: an edge is inferred from a seam, from
//     a shared name prefix, or from anything but a recorded row;
//   - the dependency view reports a coverage census that does not track the
//     store — the count of subsystems carrying no recorded edge is asserted on
//     two fixtures with different answers, so a constant cannot satisfy both;
//   - `test-smoke.mjs` calls `add_xref` without a `context`, or a second caller
//     appears that this packet did not update;
//   - `phase-2-structural.md` does not instruct Phase 2 to record the crossing
//     data flows and dependencies as `add_xref` rows carrying a citation;
//   - the gate does not run in CI.
//
// False greens it cannot exclude. A recorded edge can still be wrong: the
// contract binds a citation to a resolvable revision and a real workspace path,
// not the truth of the relationship, and no write path can check that. Symbol
// reachability is deliberately unchecked — deciding whether a symbol exists at
// a revision needs a language parser the server does not have — so a citation
// may name a symbol that was never there. The rendering assertions run over
// seeded fixtures through the real renderer, so they establish that the
// projection carries exactly the recorded rows; they say nothing about whether
// Phase 2 recorded the edges that exist in the code. And `phase-2-structural.md`
// is asserted on the instruction it carries, not on whether an agent follows it.
//
// Output protocol: exactly one status line, last, on stdout. Every message is
// scrubbed, so a missing deliverable reports as an assertion failure rather
// than as a crash.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureBuilt } from "./scripts/ensure-built.mjs";

const MCP = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(MCP, "..");
const PY = process.env.AMANUENSIS_PYTHON ?? "python3";

const PHASE_2_REL = ".claude/skills/amanuensis/references/phase-2-structural.md";
// Phase 2's recording obligation, verbatim, with whitespace collapsed: the
// directive this gate exists to keep in the skill, in its positive polarity.
const PHASE_2_OBLIGATION =
  "Call `add_xref` once for every data flow or dependency that crosses a subsystem boundary; one row per crossing.";
const CI_REL = ".github/workflows/test.yml";
const SCHEMA_REL = "mcp-server/src/schema.sql";

// The Markdown header rows the two architecture surfaces are distinguished by.
// A topology has five columns and names a relation between two subsystems; the
// atlas has three and names only where each subsystem sits.
const CITATION_SHAPE = "[^\\s:]+:[^\\s@]+@(?:[0-9a-fA-F]{7,40}|\\$\\{[A-Za-z0-9_.]+\\})";
const TOPOLOGY_HEADER = "| From | Relationship | To | Strength | Context |";
const ATLAS_HEADER = "| Region | Subsystem | Survey depth |";

// ---------------------------------------------------------------------------
// Output funnel. Nothing reaches stdout except through emit(), and everything
// is scrubbed of the launcher's crash signatures so that a genuine assertion
// failure is never mistaken for a gate that never ran.
// ---------------------------------------------------------------------------
const SCRUB = [
  [/MODULE_NOT_FOUND/g, "module-absent"],
  [/ModuleNotFoundError/g, "python-module-absent"],
  [/Cannot find module/g, "cannot load module"],
  [/No such file or directory/g, "path is absent"],
  [/No such file/g, "path is absent"],
  [/can't open file/g, "cannot open path"],
  [/SyntaxError/g, "parse-failure"],
  [/syntax error/gi, "malformed statement"],
  [/ImportError/g, "python-import-error"],
  [/ReferenceError/g, "reference-error"],
  [/TypeError/g, "type-error"],
  [/ENOENT/g, "PATH-ABSENT"],
  [/is not defined/g, "is undeclared"],
  [/is not a function/g, "is not callable"],
  [/command not found/g, "executable is absent"],
];

function scrub(text) {
  let out = String(text ?? "");
  for (const [pattern, replacement] of SCRUB) out = out.replace(pattern, replacement);
  return out;
}

function emit(line) {
  process.stdout.write(`${scrub(line)}\n`);
}

const failures = [];
function check(label, fn) {
  let reason = null;
  try {
    reason = fn();
  } catch (e) {
    reason = `threw while checking — ${e && e.message ? e.message : e}`;
  }
  if (reason) {
    failures.push(`${label}: ${reason}`);
    emit(`  FAIL ${label}: ${reason}`);
  } else {
    emit(`  ok   ${label}`);
  }
}

function readText(absPath) {
  if (!existsSync(absPath)) return null;
  try {
    return readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Deliverables, loaded defensively. `dist/` is a build artifact, so compile
// first and let a compile failure poison the fixture rather than certify bytes
// that are not under review (slice-S2, F1–F3/codex).
// ---------------------------------------------------------------------------
const built = ensureBuilt();

let mods = null;
let loadError = null;
try {
  const [db, project, xrefs, locus, subsystems, seams, projectTools] = await Promise.all([
    import("./dist/db.js"),
    import("./dist/project.js"),
    import("./dist/tools/xrefs.js"),
    import("./dist/tools/locus.js"),
    import("./dist/tools/subsystems.js"),
    import("./dist/tools/seams.js"),
    import("./dist/tools/project.js"),
  ]);
  mods = { db, project, xrefs, locus, subsystems, seams, projectTools };
} catch (e) {
  loadError = e && e.message ? e.message : String(e);
}

function toolNamed(name) {
  const groups = [
    mods?.xrefs?.xrefTools,
    mods?.locus?.locusTools,
    mods?.subsystems?.subsystemTools,
    mods?.seams?.seamTools,
    mods?.projectTools?.projectTools,
  ];
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    const found = group.find((tool) => tool?.name === name);
    if (found) return found;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fixture. One workspace with two commits, one store. Every write runs through
// the real handler, so a check installed anywhere but the write path fails here.
// ---------------------------------------------------------------------------
const roots = [];
function tempRoot(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args[0]} did not succeed`);
  return String(result.stdout ?? "").trim();
}

function initRepo(dir, marker) {
  mkdirSync(join(dir, "src"), { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "test@localhost");
  git(dir, "config", "user.name", "Edge Contract Gate");
  git(dir, "config", "commit.gpgsign", "false");
  // The marker keeps the two repositories' commits distinct: identical content
  // committed by one identity in the same second is the same sha, and a foreign
  // sha that happens to equal the workspace's proves nothing.
  writeFileSync(join(dir, "src", "a.ts"), `export const a = "${marker}";\n`);
  git(dir, "add", "src");
  git(dir, "commit", "-q", "--no-verify", "-m", `base ${marker}`);
  return git(dir, "rev-parse", "HEAD");
}

let fixture = null;
let fixtureError = !built.ok
  ? `src/ was not compiled before this gate read dist/ — ${built.detail}`
  : loadError
    ? `the xref, locus and subsystem tools could not be loaded — ${loadError}`
    : null;

function buildFixture() {
  const root = tempRoot("amanuensis-edge-contract-");
  const workspace = join(root, "workspace");
  const outsider = join(root, "outsider");
  const storageRoot = join(root, "storage-root");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(outsider, { recursive: true });
  mkdirSync(storageRoot, { recursive: true });
  const head = initRepo(workspace, "workspace");
  // A second repository whose HEAD is a perfectly well-formed sha that this
  // workspace cannot resolve: the grammar alone must not be enough.
  const foreign = initRepo(outsider, "outsider");
  if (foreign === head) throw new Error("the two fixture repositories share a HEAD");

  process.env.AMANUENSIS_STORAGE_ROOT = storageRoot;
  const project = mods.project.resolveProject(workspace, {
    selectionSource: "test-edge-contract",
    serverVersion: "test",
  });
  mods.project.ensureProjectStorage(project, (dbPath) => mods.db.openDatabase(dbPath).close());
  const db = mods.db.openDatabase(project.dbPath);
  const ctx = { project, db, sessionId: null };
  ctx.sessionId = call("start_session", { intent: "edge-contract-gate" }, ctx).session_id;
  for (const id of ["B-01", "B-02", "B-03", "B-04"]) {
    call("upsert_subsystem", { id, name: `Subsystem ${id}`, status: "unmapped" }, ctx);
  }
  return { project, db, ctx, head, foreign, workspace };
}

function call(name, args, ctx) {
  const tool = toolNamed(name);
  if (!tool) throw new Error(`${name} is not exported by the built tools`);
  return tool.handler(args, ctx);
}

/** Run a call that is expected to be refused; return the refusal, or null. */
function refusal(name, args, ctx) {
  try {
    call(name, args, ctx);
    return null;
  } catch (e) {
    return e && e.message ? String(e.message) : String(e);
  }
}

try {
  if (!fixtureError) fixture = buildFixture();
} catch (e) {
  fixtureError = `the workspace and store could not be prepared — ${e && e.message ? e.message : e}`;
}

function needFixture() {
  return fixture ? null : fixtureError;
}

let edgeSeq = 0;
/** A distinct subsystem pair per scenario, so no ON CONFLICT hides a refusal. */
function nextPair() {
  edgeSeq += 1;
  return { from_id: "B-01", to_id: "B-02", relationship: `probe-${edgeSeq}` };
}

function xrefRow(pair) {
  return fixture.db
    .prepare("SELECT context FROM xrefs WHERE from_id = ? AND to_id = ? AND relationship = ?")
    .get(pair.from_id, pair.to_id, pair.relationship);
}

// ---------------------------------------------------------------------------
// 1. add_xref refuses an edge it cannot bind to a citation (§9.2)
// ---------------------------------------------------------------------------
emit("add_xref — the citation the contract requires");

function refusesContext(label, context, expect) {
  check(label, () => {
    const blocked = needFixture();
    if (blocked) return blocked;
    const pair = nextPair();
    const args = { ...pair, strength: "observed" };
    if (context !== undefined) args.context = context;
    const message = refusal("add_xref", args, fixture.ctx);
    if (message === null) {
      return `add_xref recorded an edge whose context ${expect}`;
    }
    if (xrefRow(pair)) {
      return `add_xref refused the call but the xrefs row was written anyway — ${message}`;
    }
    return null;
  });
}

refusesContext("an absent context is refused", undefined, "was absent");
refusesContext("an empty context is refused", "", "was empty");
refusesContext("a whitespace-only context is refused", "   \t \n ", "carried only whitespace");
refusesContext(
  "prose with no citation token is refused",
  "one-line: why this link matters",
  "carries no token matching the citation grammar",
);
refusesContext(
  "a token with no revision is refused",
  "B-01 reads the queue src/a.ts:writeQueue",
  "carries a path and symbol but no revision",
);
refusesContext(
  "a token whose revision is not hex is refused",
  "B-01 reads the queue src/a.ts:writeQueue@NOT_A_SHA",
  "carries a revision outside the 7–40 hex grammar",
);
refusesContext(
  "a token whose revision is too short is refused",
  "B-01 reads the queue src/a.ts:writeQueue@abc12",
  "carries a five-character revision",
);

check("a well-formed token whose revision does not resolve is refused", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const pair = nextPair();
  const message = refusal(
    "add_xref",
    { ...pair, context: `B-01 reads the queue src/a.ts:writeQueue@${"0".repeat(40)}` },
    fixture.ctx,
  );
  if (message === null) return "add_xref recorded an edge citing a revision no commit carries";
  if (xrefRow(pair)) return `add_xref refused the call but wrote the row anyway — ${message}`;
  return null;
});

check("a revision that resolves only in another repository is refused", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const pair = nextPair();
  const message = refusal(
    "add_xref",
    { ...pair, context: `B-01 reads the queue src/a.ts:writeQueue@${fixture.foreign}` },
    fixture.ctx,
  );
  if (message === null) {
    return "add_xref accepted a revision that resolves in a different repository, so the citation is not bound to the workspace";
  }
  if (xrefRow(pair)) return `add_xref refused the call but wrote the row anyway — ${message}`;
  return null;
});

for (const [label, path] of [
  ["absolute", "/etc/passwd"],
  ["traversing", "../outside/a.ts"],
  ["reserved tool state", ".amanuensis/memory.db"],
]) {
  check(`a token whose path is ${label} is refused`, () => {
    const blocked = needFixture();
    if (blocked) return blocked;
    const pair = nextPair();
    const message = refusal(
      "add_xref",
      { ...pair, context: `B-01 reads ${path}:sym@${fixture.head}` },
      fixture.ctx,
    );
    if (message === null) return `add_xref accepted a citation naming ${label} path ${path}`;
    if (xrefRow(pair)) return `add_xref refused the call but wrote the row anyway — ${message}`;
    return null;
  });
}

// ---------------------------------------------------------------------------
// 2. add_xref accepts prose that carries one, verbatim (§9.2)
// ---------------------------------------------------------------------------
emit("");
emit("add_xref — the prose it keeps and the citation it returns");

check("prose containing a well-formed token is accepted and stored verbatim", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const pair = nextPair();
  const context = `B-01 hands the queue to B-02 on job start, at src/a.ts:writeQueue@${fixture.head} — the handoff is synchronous.`;
  let result = null;
  try {
    result = call("add_xref", { ...pair, context }, fixture.ctx);
  } catch (e) {
    return `add_xref refused prose that carries a well-formed citation token — ${e && e.message ? e.message : e}`;
  }
  const row = xrefRow(pair);
  if (!row) return "add_xref returned without writing the xrefs row";
  if (row.context !== context) {
    return `the stored context is not the caller's prose; stored ${JSON.stringify(row.context)}`;
  }
  if (!Array.isArray(result?.citations)) {
    return `the response carries no citations[]; keys were ${JSON.stringify(Object.keys(result ?? {}))}`;
  }
  const wanted = `src/a.ts:writeQueue@${fixture.head}`;
  if (result.citations.length !== 1 || result.citations[0] !== wanted) {
    return `citations[] is ${JSON.stringify(result.citations)}, not exactly [${JSON.stringify(wanted)}]`;
  }
  return null;
});

check("a prose prefix ending in a colon is not taken as the path", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const pair = nextPair();
  // The exact string C45/codex reproduced: the old parser took `why` as the
  // path and never looked at the real citation.
  const context = `why: src/a.ts:writeQueue@${fixture.head}`;
  let result = null;
  try {
    result = call("add_xref", { ...pair, context }, fixture.ctx);
  } catch (e) {
    return `add_xref refused a context whose second token is a well-formed citation — ${e && e.message ? e.message : e}`;
  }
  const wanted = `src/a.ts:writeQueue@${fixture.head}`;
  if (!Array.isArray(result?.citations) || !result.citations.includes(wanted)) {
    return `the validated citation is ${JSON.stringify(result?.citations)}, so the prose prefix was parsed instead of the citation`;
  }
  if (result.citations.some((c) => String(c).startsWith("why"))) {
    return `\`why\` was normalized as a source path: ${JSON.stringify(result.citations)}`;
  }
  return null;
});

check("every well-formed token in the prose is validated and returned", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const pair = nextPair();
  const first = `src/a.ts:writeQueue@${fixture.head}`;
  const second = `src/a.ts:readQueue@${fixture.head.slice(0, 7)}`;
  let result = null;
  try {
    result = call("add_xref", { ...pair, context: `${first} feeds ${second} downstream` }, fixture.ctx);
  } catch (e) {
    return `add_xref refused prose carrying two well-formed tokens — ${e && e.message ? e.message : e}`;
  }
  const got = Array.isArray(result?.citations) ? result.citations : [];
  if (got.length !== 2 || got[0] !== first || got[1] !== second) {
    return `citations[] is ${JSON.stringify(got)}, not both tokens in prose order`;
  }
  return null;
});

check("one unresolvable token poisons a context that also carries a good one", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const pair = nextPair();
  const context = `src/a.ts:writeQueue@${fixture.head} and src/a.ts:readQueue@${"9".repeat(40)}`;
  const message = refusal("add_xref", { ...pair, context }, fixture.ctx);
  if (message === null) {
    return "add_xref recorded an edge whose second citation names a revision no commit carries, so one good token launders the rest";
  }
  if (xrefRow(pair)) return `add_xref refused the call but wrote the row anyway — ${message}`;
  return null;
});

check("a citation the writer wrapped in punctuation is not a token", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  // §9.2 splits the context on whitespace and anchors the grammar, so
  // `(src/a.ts:sym@sha).` is not a citation token. The boundary is pinned here
  // deliberately: a writer must leave the token unpunctuated, and the tool's
  // description and `phase-2-structural.md` show it that way.
  const pair = nextPair();
  const message = refusal(
    "add_xref",
    { ...pair, context: `see (src/a.ts:writeQueue@${fixture.head}) for the handoff` },
    fixture.ctx,
  );
  if (message === null) {
    return "add_xref accepted a parenthesized citation, so the grammar is no longer the anchored token §9.2 specifies";
  }
  if (xrefRow(pair)) return `add_xref refused the call but wrote the row anyway — ${message}`;
  return null;
});

check("symbol reachability is not checked", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const pair = nextPair();
  const context = `B-01 reaches B-02 through src/a.ts:noSuchSymbolAnywhere@${fixture.head}`;
  try {
    call("add_xref", { ...pair, context }, fixture.ctx);
  } catch (e) {
    return `add_xref refused a citation naming a symbol the file does not carry, so reachability is being checked — ${e && e.message ? e.message : e}`;
  }
  return xrefRow(pair) ? null : "add_xref returned without writing the row";
});

check("the tool's own contract says reachability is unchecked", () => {
  if (loadError) return `the xref tools could not be loaded — ${loadError}`;
  const tool = toolNamed("add_xref");
  if (!tool) return "add_xref is not exported by the built tools";
  const description = String(tool.description ?? "");
  if (!/symbol/i.test(description)) {
    return "the published description never mentions the symbol part of a citation";
  }
  if (!/\bnot\b[^.]{0,60}\b(?:checked|validated|verified|resolved)\b|\bno\b[^.]{0,40}\bparser\b/i.test(description)) {
    return `the published description does not state that reachability is unchecked — ${description.slice(0, 200)}`;
  }
  return null;
});

// One table read twice: by the published schema's `pattern` and, above, by the
// handler. A grammar widened in one place and not the other lets a validating
// host send a call the server then refuses, or refuse one it would accept.
const GRAMMAR_CASES = [
  ["one-line: why this link matters", false, "prose with no token"],
  ["B-01 reads src/a.ts:writeQueue", false, "a token with no revision"],
  ["B-01 reads src/a.ts:writeQueue@abc12", false, "a five-character revision"],
  ["B-01 reads src/a.ts:writeQueue@NOT_A_SHA", false, "a non-hex revision"],
  ["see (src/a.ts:writeQueue@abc1234) here", false, "a token wrapped in punctuation"],
  ["B-01 reads src/a.ts:writeQueue@abc1234", true, "a token inside prose"],
  ["src/a.ts:writeQueue@abc1234", true, "a token that is the whole context"],
  [`src/a.ts:writeQueue@${"a".repeat(40)} first`, true, "a token at the start"],
];

check("the published schema carries the grammar the handler enforces", () => {
  if (loadError) return `the xref tools could not be loaded — ${loadError}`;
  const tool = toolNamed("add_xref");
  if (!tool) return "add_xref is not exported by the built tools";
  const source = tool.inputSchema?.properties?.context?.pattern;
  if (typeof source !== "string" || source.length === 0) {
    return "the published context schema carries no pattern, so a validating host cannot see the grammar";
  }
  let pattern = null;
  try {
    pattern = new RegExp(source);
  } catch (e) {
    return `the published pattern is not a usable regular expression — ${e && e.message ? e.message : e}`;
  }
  const wrong = GRAMMAR_CASES.filter(([context, accepted]) => pattern.test(context) !== accepted).map(
    ([, accepted, label]) => `${label} is ${accepted ? "refused" : "accepted"}`,
  );
  return wrong.length ? `the published pattern disagrees with the grammar: ${wrong.join("; ")}` : null;
});

check("the handler agrees with the published grammar case for case", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  const wrong = [];
  for (const [template, accepted, label] of GRAMMAR_CASES) {
    // The fixture's own HEAD, so an accepted case has a revision that resolves.
    const context = template.replace(/@[0-9a-fA-F]{7,40}/g, `@${fixture.head}`);
    const pair = nextPair();
    const message = refusal("add_xref", { ...pair, context }, fixture.ctx);
    if (accepted && message !== null) wrong.push(`${label} was refused — ${message}`);
    if (!accepted && message === null) wrong.push(`${label} was accepted`);
  }
  return wrong.length ? wrong.join("; ") : null;
});

check("context is required by the published input schema", () => {
  if (loadError) return `the xref tools could not be loaded — ${loadError}`;
  const tool = toolNamed("add_xref");
  if (!tool) return "add_xref is not exported by the built tools";
  const schema = tool.inputSchema ?? {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  if (!required.includes("context")) {
    return `inputSchema.required is ${JSON.stringify(required)}, so a schema-validating host may omit context`;
  }
  const property = schema.properties?.context ?? {};
  if (property.type !== "string" || !(property.minLength >= 1)) {
    return `inputSchema.properties.context is ${JSON.stringify(property)}, which admits an empty string`;
  }
  return null;
});

// ---------------------------------------------------------------------------
// 3. describe_locus carries the recorded edges, and only those (§3.1 row 5)
// ---------------------------------------------------------------------------
emit("");
emit("describe_locus — boundaries from recorded rows");

let boundaryEdge = null;
check("a recorded edge reaches the owning subsystem's boundaries section", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  boundaryEdge = { from_id: "B-03", to_id: "B-04", relationship: "data-flow" };
  const context = `B-03 writes the ledger B-04 reads, at src/a.ts:flush@${fixture.head}`;
  try {
    call("add_xref", { ...boundaryEdge, strength: "confirmed", context }, fixture.ctx);
  } catch (e) {
    return `the boundary fixture edge could not be recorded — ${e && e.message ? e.message : e}`;
  }
  let account = null;
  try {
    account = call("describe_locus", { locus: "B-03", kind: "subsystem" }, fixture.ctx);
  } catch (e) {
    return `describe_locus refused the owning subsystem — ${e && e.message ? e.message : e}`;
  }
  const section = account?.sections?.boundaries;
  if (!section) return "the response carries no boundaries section";
  const items = Array.isArray(section.items) ? section.items : [];
  const edge = items.find((item) => item?.kind === "xref");
  if (!edge) {
    return `boundaries carries no recorded edge; kinds were ${JSON.stringify(items.map((i) => i?.kind))}`;
  }
  if (edge.from_id !== "B-03" || edge.to_id !== "B-04" || edge.relationship !== "data-flow") {
    return `the edge is ${JSON.stringify([edge.from_id, edge.to_id, edge.relationship])}, not the recorded row`;
  }
  if (edge.context !== context) return `the edge's context is not the recorded prose: ${JSON.stringify(edge.context)}`;
  return null;
});

check("a cited edge exposes its citations and is still served unbound", () => {
  // §3.2 binds an item to a revision only where its *source row* carries one,
  // and `xrefs` has no `ref_sha` column. The revision a writer cited lives in
  // prose the same table stores verbatim; promoting the first prose token to
  // `ref_sha` presents an edge as revision-bound on the strength of a sentence,
  // and P6's gate asserts the opposite on the same section. The citation is
  // served — in `citations[]`, where a reader can see how many revisions the
  // edge was actually read at — and the binding flag stays false (F5/codex).
  const blocked = needFixture();
  if (blocked) return blocked;
  if (!boundaryEdge) return "the boundary fixture edge was never recorded";
  const account = call("describe_locus", { locus: "B-04", kind: "subsystem" }, fixture.ctx);
  const items = account?.sections?.boundaries?.items ?? [];
  const edge = items.find((item) => item?.kind === "xref");
  if (!edge) return "the target subsystem's boundaries section carries no recorded edge";
  const wanted = `src/a.ts:flush@${fixture.head}`;
  if (!Array.isArray(edge.citations) || !edge.citations.includes(wanted)) {
    return `the edge carries citations ${JSON.stringify(edge.citations)}, not the token recorded in its context`;
  }
  if (edge.ref_sha !== null || edge.revision_bound !== false) {
    return `the edge reports ref_sha ${JSON.stringify(edge.ref_sha)} / revision_bound ${JSON.stringify(edge.revision_bound)}, but xrefs has no revision column for either to be read from`;
  }
  return null;
});

check("a subsystem with no recorded edge is given none", () => {
  const blocked = needFixture();
  if (blocked) return blocked;
  call("upsert_subsystem", { id: "B-09", name: "Subsystem B-09", status: "unmapped" }, fixture.ctx);
  const account = call("describe_locus", { locus: "B-09", kind: "subsystem" }, fixture.ctx);
  const section = account?.sections?.boundaries;
  const items = Array.isArray(section?.items) ? section.items : [];
  const invented = items.filter((item) => item?.kind === "xref");
  if (invented.length > 0) {
    return `boundaries invented ${invented.length} edge(s) for a subsystem with no xrefs row`;
  }
  if (section?.recorded !== false) {
    return `an empty boundaries section reports recorded ${JSON.stringify(section?.recorded)}, so the honest empty is not declared`;
  }
  return null;
});

// ---------------------------------------------------------------------------
// 4. The projection renders recorded rows and nothing else (§9.2)
// ---------------------------------------------------------------------------
emit("");
emit("architecture.md — topology from recorded rows only");

const SCHEMA_ABS = join(REPO, SCHEMA_REL);

const RENDER_SCRIPT = `
import json, sqlite3, sys
from pathlib import Path
from amanuensis_materializer.renderers import render_architecture

spec = json.loads(sys.stdin.read())
db = Path(spec["db"])
conn = sqlite3.connect(db)
conn.executescript(Path(spec["schema"]).read_text())
for sid, name, layer in spec["subsystems"]:
    conn.execute(
        "INSERT INTO subsystems (id, name, status, layer, scope) VALUES (?, ?, 'mapped', ?, '')",
        (sid, name, layer),
    )
for a, b, rel, strength, context in spec["xrefs"]:
    conn.execute(
        "INSERT INTO xrefs (from_id, to_id, relationship, strength, context) VALUES (?, ?, ?, ?, ?)",
        (a, b, rel, strength, context),
    )
for sid, obj, a, b in spec["seams"]:
    conn.execute(
        "INSERT INTO seams (id, shared_object, shared_object_kind, party_a, party_b,"
        " a_writes, b_reads, ordering_assumption, cardinality, staleness_tolerance)"
        " VALUES (?, ?, 'queue', ?, ?, 'writes', 'reads', 'fifo', 'single-consumer', 'strong-consistent')",
        (sid, obj, a, b),
    )
conn.commit()
conn.row_factory = sqlite3.Row
text, sources = render_architecture(conn, Path(spec["storage"]))
print(json.dumps({"markdown": text, "sources": sorted(sources)}))
`;

function renderArchitecture(spec) {
  const root = tempRoot("amanuensis-edge-render-");
  const payload = JSON.stringify({
    ...spec,
    db: join(root, "memory.db"),
    schema: SCHEMA_ABS,
    storage: root,
  });
  const result = spawnSync(PY, ["-c", RENDER_SCRIPT], {
    cwd: REPO,
    encoding: "utf8",
    input: payload,
    env: { ...process.env, PYTHONPATH: join(REPO, "materializer"), PYTHONDONTWRITEBYTECODE: "1" },
  });
  const stdout = String(result.stdout ?? "").trim();
  const last = stdout.split("\n").filter(Boolean).pop();
  let parsed = null;
  try {
    parsed = last ? JSON.parse(last) : null;
  } catch {
    parsed = null;
  }
  if (!parsed) {
    const detail = `${stdout}\n${String(result.stderr ?? "")}`.trim().split("\n").slice(-4).join(" / ");
    return { error: `the architecture page could not be rendered — ${detail.slice(0, 300)}` };
  }
  return { markdown: String(parsed.markdown ?? "") };
}

const FOUR_SUBSYSTEMS = [
  ["B-01", "Job Scheduler", "backend"],
  ["B-02", "Auth Service", "backend"],
  ["B-03", "Ledger", "backend"],
  ["B-04", "Web UI", "frontend"],
];

/** The dependency table's data rows, or null when no such table was rendered. */
function topologyRows(markdown) {
  const lines = markdown.split("\n");
  const index = lines.indexOf(TOPOLOGY_HEADER);
  if (index === -1) return null;
  const out = [];
  for (let i = index + 2; i < lines.length && lines[i].startsWith("|"); i += 1) out.push(lines[i]);
  return out;
}

// The topology is a table, and an edge is a *directed* relation: which column a
// value lands in is the claim. Asserting that both endpoints appear somewhere in
// the row passes a renderer that swaps From and To, publishing every dependency
// backwards (slice-S4 F1/codex). So rows are read as cells, and each recorded
// field is asserted in its own column.
//
// `_safe_label` rewrites `|` to `/` before a value reaches a cell, so splitting
// on the delimiter cannot be confused by the content.
const TOPOLOGY_COLUMNS = TOPOLOGY_HEADER.split("|").slice(1, -1).map((c) => c.trim());

function topologyCells(markdown) {
  const rows = topologyRows(markdown);
  if (rows === null) return null;
  return rows.map((row) => {
    const parts = row.split("|");
    return parts.slice(1, parts.length - 1).map((cell) => cell.trim());
  });
}

// A From or To cell is `**[<id>](<route>)** <name>`; the id is the claim, the
// link and the name are presentation.
function endpointId(cell) {
  const match = /^\*\*\[([^\]]+)\]\([^)]*\)\*\*/.exec(String(cell ?? ""));
  return match ? match[1] : null;
}

// Assert one rendered row against the row that was recorded, column by column.
// Returns a reason or null.
function edgeRowMismatch(cells, recorded) {
  const [from, to, relationship, strength, context] = recorded;
  if (cells.length !== TOPOLOGY_COLUMNS.length) {
    return `the row has ${cells.length} cells, not the ${TOPOLOGY_COLUMNS.length} the header declares`;
  }
  const wanted = [
    ["From", endpointId(cells[0]), from],
    ["Relationship", cells[1], relationship],
    ["To", endpointId(cells[2]), to],
    ["Strength", cells[3], strength],
  ];
  for (const [column, got, want] of wanted) {
    if (got !== want) {
      return `the ${column} column reads ${JSON.stringify(got)}, not ${JSON.stringify(want)}`;
    }
  }
  if (!cells[4].includes(context)) {
    return `the Context column reads ${JSON.stringify(cells[4])}, which does not carry the recorded context`;
  }
  return null;
}

check("a store with zero xrefs renders the atlas, not a topology", () => {
  const { markdown, error } = renderArchitecture({
    subsystems: FOUR_SUBSYSTEMS,
    xrefs: [],
    seams: [["SM-01", "jobs_queue", "B-01", "B-02"]],
  });
  if (error) return error;
  if (topologyRows(markdown) !== null) {
    return "a dependency topology was rendered on a store with no xrefs rows";
  }
  if (markdown.includes("## Subsystem dependency graph")) {
    return "the section is still headed as a dependency graph with no edges recorded";
  }
  if (!markdown.includes("## Subsystem atlas")) return "no subsystem atlas section was rendered";
  if (!markdown.includes(ATLAS_HEADER)) return "the atlas carries no linked subsystem inventory";
  return null;
});

check("the atlas says no edges are recorded and that it is not inferred", () => {
  const { markdown, error } = renderArchitecture({
    subsystems: FOUR_SUBSYSTEMS,
    xrefs: [],
    seams: [["SM-01", "jobs_queue", "B-01", "B-02"]],
  });
  if (error) return error;
  const missing = [];
  if (!/no dependency edges are recorded/i.test(markdown)) missing.push("that no edges are recorded");
  if (!/not an inferred dependency graph/i.test(markdown)) missing.push("that the map is not inferred");
  if (missing.length) return `the atlas does not say ${missing.join(" or ")}`;
  for (const [sid] of FOUR_SUBSYSTEMS) {
    if (!markdown.includes(`[${sid}](`)) return `the atlas does not link ${sid}`;
  }
  return null;
});

check("a seam is never rendered as a dependency edge", () => {
  const { markdown, error } = renderArchitecture({
    subsystems: FOUR_SUBSYSTEMS,
    xrefs: [["B-01", "B-02", "data-flow", "confirmed", `src/a.ts:flush@${"a".repeat(40)}`]],
    seams: [["SM-07", "ledger_table", "B-03", "B-04"]],
  });
  if (error) return error;
  const cells = topologyCells(markdown);
  if (cells === null) return "no dependency topology was rendered for a store that carries an edge";
  if (cells.length !== 1) return `${cells.length} edge rows were rendered for one recorded xrefs row`;
  const wrong = edgeRowMismatch(cells[0], ["B-01", "B-02", "data-flow", "confirmed", `src/a.ts:flush@${"a".repeat(40)}`]);
  if (wrong) return `the rendered edge does not match the recorded row — ${wrong}`;
  if (cells.some((row) => row.some((cell) => cell.includes("B-03") || cell.includes("B-04")))) {
    return "the seam between B-03 and B-04 was rendered as a dependency edge";
  }
  return null;
});

check("every rendered edge row is a recorded xrefs row", () => {
  const recorded = [
    ["B-01", "B-02", "data-flow", "confirmed", `src/a.ts:flush@${"a".repeat(40)}`],
    ["B-02", "B-03", "dependency", "observed", `src/b.ts:read@${"b".repeat(40)}`],
  ];
  const { markdown, error } = renderArchitecture({
    subsystems: FOUR_SUBSYSTEMS,
    xrefs: recorded,
    seams: [["SM-07", "ledger_table", "B-03", "B-04"]],
  });
  if (error) return error;
  const cells = topologyCells(markdown);
  if (cells === null) return "no dependency topology was rendered for a store that carries edges";
  if (cells.length !== recorded.length) {
    return `${cells.length} edge rows were rendered for ${recorded.length} recorded xrefs rows`;
  }
  // The two recorded edges share the endpoint B-02, in opposite roles: a row
  // matched by "names both ids" would accept either edge for either row, so the
  // From column decides which recorded row a rendered row is, and every other
  // column is then asserted against it.
  for (const row of recorded) {
    const [from, to, rel] = row;
    const rendered = cells.find((cand) => endpointId(cand[0]) === from && endpointId(cand[2]) === to);
    if (!rendered) {
      const shown = cells.map((c) => `${endpointId(c[0])} -> ${endpointId(c[2])}`).join(", ");
      return `the recorded edge ${from} -${rel}-> ${to} is not rendered; the table carries ${shown}`;
    }
    const wrong = edgeRowMismatch(rendered, row);
    if (wrong) return `the rendered row for ${from} -${rel}-> ${to} is wrong — ${wrong}`;
  }
  return null;
});

check("the dependency view counts the subsystems no recorded edge reaches", () => {
  // Two arms with different answers: a constant cannot satisfy both, and a
  // count derived from the wrong universe (edges, seams, or rows) misses one.
  const arms = [
    {
      xrefs: [["B-01", "B-02", "data-flow", "confirmed", `src/a.ts:flush@${"a".repeat(40)}`]],
      uncovered: 2,
    },
    {
      xrefs: [
        ["B-01", "B-02", "data-flow", "confirmed", `src/a.ts:flush@${"a".repeat(40)}`],
        ["B-02", "B-03", "dependency", "observed", `src/b.ts:read@${"b".repeat(40)}`],
      ],
      uncovered: 1,
    },
  ];
  for (const arm of arms) {
    const { markdown, error } = renderArchitecture({
      subsystems: FOUR_SUBSYSTEMS,
      xrefs: arm.xrefs,
      seams: [["SM-07", "ledger_table", "B-03", "B-04"]],
    });
    if (error) return error;
    const stated = /(\d+)\s+of\s+(\d+)\s+recorded subsystems? (?:carry|carries) no recorded edge/i.exec(markdown);
    if (!stated) {
      return `the dependency view states no coverage census; ${arm.uncovered} of ${FOUR_SUBSYSTEMS.length} subsystems carry no recorded edge`;
    }
    if (Number(stated[1]) !== arm.uncovered || Number(stated[2]) !== FOUR_SUBSYSTEMS.length) {
      return `the census reads "${stated[0]}" where ${arm.uncovered} of ${FOUR_SUBSYSTEMS.length} carry no recorded edge`;
    }
  }
  return null;
});

check("a fully covered store states no shortfall", () => {
  const { markdown, error } = renderArchitecture({
    subsystems: FOUR_SUBSYSTEMS,
    xrefs: [
      ["B-01", "B-02", "data-flow", "confirmed", `src/a.ts:flush@${"a".repeat(40)}`],
      ["B-03", "B-04", "dependency", "observed", `src/b.ts:read@${"b".repeat(40)}`],
    ],
    seams: [],
  });
  if (error) return error;
  const stated = /(\d+)\s+of\s+(\d+)\s+recorded subsystems? (?:carry|carries) no recorded edge/i.exec(markdown);
  if (stated && Number(stated[1]) !== 0) {
    return `every subsystem carries an edge but the census reads "${stated[0]}"`;
  }
  return null;
});

// ---------------------------------------------------------------------------
// 5. The callers, the instruction, and CI
// ---------------------------------------------------------------------------
emit("");
emit("callers, Phase 2's instruction, and CI");

function sourceFiles() {
  const out = [];
  const skip = new Set(["node_modules", "dist", ".git", "__pycache__", ".ruff_cache", "coverage"]);
  const walk = (dir) => {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(mjs|js|ts|py)$/.test(entry.name)) out.push(full);
    }
  };
  walk(join(REPO, "mcp-server"));
  walk(join(REPO, "materializer"));
  walk(join(REPO, "dev"));
  return out;
}

check("test-smoke.mjs's add_xref call passes a context", () => {
  const text = readText(join(MCP, "test-smoke.mjs"));
  if (text === null) return "test-smoke.mjs is absent";
  const at = text.indexOf('"add_xref"');
  if (at === -1) return "test-smoke.mjs no longer calls add_xref";
  // The call may span lines, so read to the start of the next top-level call.
  const rest = text.slice(at);
  const end = rest.indexOf("\nrun(");
  const call = end === -1 ? rest.slice(0, 600) : rest.slice(0, end);
  if (!/context\s*:/.test(call)) return `the call passes no context — ${call.trim().slice(0, 200)}`;
  if (!new RegExp(`${CITATION_SHAPE}`).test(call)) {
    return `the context carries no citation token — ${call.trim().slice(0, 200)}`;
  }
  return null;
});

check("test-smoke.mjs is the only add_xref caller this packet had to update", () => {
  const allowed = new Set([
    join(MCP, "test-smoke.mjs"),
    join(MCP, "test-edge-contract.mjs"),
    join(MCP, "src", "tools", "xrefs.ts"),
  ]);
  const callers = sourceFiles().filter((file) => {
    if (allowed.has(file)) return false;
    const text = readText(file);
    return text !== null && /add_xref/.test(text);
  });
  return callers.length === 0
    ? null
    : `add_xref is also named by ${callers.map((f) => f.slice(REPO.length + 1)).join(", ")}, which this packet did not update`;
});

check("phase-2-structural.md tells Phase 2 to record crossing edges with a citation", () => {
  const text = readText(join(REPO, PHASE_2_REL));
  if (text === null) return `${PHASE_2_REL} is absent`;
  if (!/add_xref/.test(text)) return "the document never names add_xref";
  // Read the step that names add_xref, not the rest of the document: the file
  // already says "cite everything" about claims, and a citation obligation
  // borrowed from a later section is not one this step carries.
  const at = text.indexOf("add_xref");
  const before = text.lastIndexOf("\n### ", at);
  const after = text.indexOf("\n### ", at);
  const section = text.slice(before === -1 ? 0 : before + 1, after === -1 ? text.length : after);
  const sentences = section
    // The slice starts at the step's heading, which carries no terminator and
    // would otherwise be absorbed into the first sentence.
    .replace(/^#{1,6}[^\n]*\n/, "")
    .replace(/\s+/g, " ")
    .split(/(?<=\.)\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => /add_xref/.test(sentence));
  // A keyword scan for "must", "record", or "one row" reads an obligation out
  // of its own inversion: "Never record an `add_xref` row …" contains "record"
  // and passed (slice-S4 F3/codex). Polarity is the whole content of the
  // directive, so the obligation is pinned as an exact sentence. Rewording it
  // is a change to what Phase 2 is told to do, and updating this constant is
  // how that change gets stated deliberately rather than drifting.
  if (!sentences.includes(PHASE_2_OBLIGATION)) {
    const shown = sentences.length ? sentences.map((x) => JSON.stringify(x)).join(" / ") : "none";
    return `the step does not carry Phase 2's recording obligation verbatim — its add_xref sentences are ${shown}`;
  }
  // Defence in depth: an inversion added *beside* the pinned sentence rather
  // than replacing it. An imperative prohibition naming the tool contradicts
  // the obligation, so it must not stand unremarked; a genuine new restriction
  // on the phase is a directive change and belongs in this constant too.
  const prohibition = sentences.find((sentence) => /^(never|do not|don't|no longer)\b/i.test(sentence));
  if (prohibition) {
    return `the step also tells Phase 2 ${JSON.stringify(prohibition)}, which contradicts the recording obligation`;
  }
  if (!/cross(?:es|ing|-)?\s*(?:a\s+)?(?:subsystem\s+)?boundar/i.test(section)) {
    return "the instruction does not say which relationships are recorded — the ones that cross a subsystem boundary";
  }
  if (!/context/.test(section) || !/file:symbol@sha|citation/i.test(section)) {
    return "the instruction does not require the context to carry a citation";
  }
  if (!/\bdata-flow\b/.test(section) || !/\bdependency\b/.test(section)) {
    return "the instruction does not name data-flow and dependency as the relationship values for these rows";
  }
  return null;
});

// The gate command and the directory it must be invoked from. `includes()` on
// the whole file is satisfied by the command sitting in a comment — the step
// `run: echo skipped # node test-edge-contract.mjs` left the check green while
// CI ran nothing (slice-S4 F2/codex). So the workflow is read as steps, and the
// gate must be a line the shell actually executes, in the right directory, in a
// step nothing conditions away.
const GATE_COMMAND = "node test-edge-contract.mjs";
const GATE_WORKDIR = "mcp-server";

// Minimal reader for the one shape a workflow step takes: a `- key: value` list
// item followed by sibling `key: value` lines, with `|`/`>` block scalars read
// to the end of their indented block. Enough to answer "what does this step
// run, from where, and under what condition"; not a general YAML parser.
function workflowSteps(text) {
  const lines = text.split("\n");
  const steps = [];
  let current = null;
  let block = null; // { key, indent }
  const indentOf = (line) => line.length - line.trimStart().length;
  for (const line of lines) {
    if (block) {
      if (line.trim() === "" || indentOf(line) >= block.indent) {
        current[block.key] += `${line.trim()}\n`;
        continue;
      }
      block = null;
    }
    const item = /^(\s*)-\s+([\w-]+):[ \t]*(.*)$/.exec(line);
    if (item) {
      current = { __indent: item[1].length + 2 };
      steps.push(current);
      current[item[2]] = item[3];
      if (/^[|>]/.test(item[3].trim())) {
        current[item[2]] = "";
        block = { key: item[2], indent: current.__indent + 2 };
      }
      continue;
    }
    if (!current) continue;
    const key = /^(\s*)([\w-]+):[ \t]*(.*)$/.exec(line);
    if (!key) continue;
    if (key[1].length !== current.__indent) {
      // A dedent ends the step; a deeper key belongs to a nested mapping
      // (`with:`, `env:`) and is not a step key.
      if (key[1].length < current.__indent) current = null;
      continue;
    }
    current[key[2]] = key[3];
    if (/^[|>]/.test(key[3].trim())) {
      current[key[2]] = "";
      block = { key: key[2], indent: current.__indent + 2 };
    }
  }
  return steps;
}

// Drop shell comments so a commented-out command is not read as an invocation.
function shellLines(run) {
  return String(run ?? "")
    .split("\n")
    .map((line) => line.split("#")[0].trim())
    .filter(Boolean);
}

check("this gate runs in CI", () => {
  const ci = readText(join(REPO, CI_REL));
  if (ci === null) return `${CI_REL} is absent`;
  const steps = workflowSteps(ci);
  if (steps.length === 0) return `no steps could be read from ${CI_REL}`;
  const invoking = steps.filter((step) => shellLines(step.run).includes(GATE_COMMAND));
  if (invoking.length === 0) {
    const mentioned = ci.includes(GATE_COMMAND);
    return mentioned
      ? `${CI_REL} names \`${GATE_COMMAND}\` but no step executes it — it is commented out or otherwise inert`
      : `no step in ${CI_REL} runs \`${GATE_COMMAND}\``;
  }
  const reasons = [];
  for (const step of invoking) {
    if (step["working-directory"] !== GATE_WORKDIR) {
      reasons.push(
        `the step runs from ${JSON.stringify(step["working-directory"] ?? "the repository root")}, not ${GATE_WORKDIR}`,
      );
      continue;
    }
    if (step.if !== undefined) {
      reasons.push(`the step is conditioned on \`if: ${step.if}\`, so CI may skip it`);
      continue;
    }
    if (step.continue_on_error !== undefined || step["continue-on-error"] !== undefined) {
      reasons.push("the step declares continue-on-error, so a red gate would not fail the job");
      continue;
    }
    return null;
  }
  return `${CI_REL} runs the gate, but not unconditionally: ${reasons.join("; ")}`;
});

check("the CI workflow runs on push, so the gate is not manual-only", () => {
  const ci = readText(join(REPO, CI_REL));
  if (ci === null) return `${CI_REL} is absent`;
  const on = /\non:\n((?:[ \t]+.*\n|\n)*)/.exec(ci);
  if (!on) return `${CI_REL} declares no \`on:\` triggers`;
  return /^\s+push:/m.test(on[1]) ? null : `${CI_REL} does not trigger on push — ${on[1].trim().slice(0, 120)}`;
});

// ---------------------------------------------------------------------------
if (fixture?.db) {
  try {
    fixture.db.close();
  } catch {
    /* the fixture is being torn down; a close failure changes no verdict */
  }
}
for (const dir of roots) rmSync(dir, { recursive: true, force: true });

if (failures.length) {
  emit("");
  emit(
    `GATE P13 RED: add_xref's cited-edge contract on context, and topology rendered from recorded rows only, do not hold — ${failures.length} assertion(s) failed; first: ${failures[0]}`,
  );
  process.exit(1);
}
emit("");
emit("GATE P13 GREEN");
