#!/usr/bin/env node
// GATE RP1 (spec.md §8.7) — packet P7 of the survey-depth lane.
//
// **A refusal nobody registers drifts freely.** That is the false green this
// gate cannot exclude and the reason the register exists at all: the parity
// check compares a hand-maintained list against two sides, so a fifth refusal
// added later with no register entry drifts with nothing watching. It also
// cannot tell whether the shared sentence is *correct* — only that both sides
// say it. This is string identity over a register, and naming it as such is the
// honest description of what §6.2 buys (spec.md §8.7).
//
// §6.2 narrows that false green rather than pretending past it. The check's
// third assertion has a **generated** left-hand side: it scans the server's own
// refusal messages and reports every one no register entry covers. A register
// compared only against itself cannot report what nobody wrote down, and
// `phase-1-scope.md:58` — a `define_term` call the server will start refusing,
// absent from the eight-entry register of §6.1 — is the proof it was already
// happening. The derivation is lexical and incomplete: a refusal phrased
// outside the three openings, or one whose sentence does not name the operation
// it refuses, is invisible to it. Silent becomes narrower, which is the honest
// claim.
//
// Two names appear below. `GATE RP1` is what spec.md §8.7 calls this gate;
// `GATE P7` is the packet id the launcher greps for. The status line carries
// both so neither reader has to translate.
//
//   exit 0  `GATE P7 GREEN`          — every assertion held
//   exit 1  `GATE P7 RED: <reason>`  — an assertion fired
//
// This gate has no third state. Its subject is the repository's own text, and
// its sabotage arms run against a **fixture tree it builds itself** — a
// throwaway register, a throwaway server file, throwaway references — so the
// arms assert the checker's *behaviour* rather than the presence of the
// repository's register, and they read the same before and after the packet
// lands (spec.md §8.0). A checker that is absent, or that exits non-zero
// without naming the entry and the side that lost the phrase, has not rejected
// the sabotage; A1 says so in those words.
//
// Must-stay-green controls (VP4(f) — a kill proves a gate can fire, never that
// it fires selectively):
//   G1  the unsabotaged fixture passes — every sabotage below is one edit away
//       from a tree the checker accepts, so a checker that always failed would
//       be caught here rather than read as rigour
//   G2  the register at HEAD passes (spec.md §8.7's named control)
//   G3  a reference that names a registered tool *and* carries the phrase is
//       not reported — the reference-side derivation has a green case
//   G4  a message whose subject is not a tool the server advertises
//       (`learning requires an ended agent session`) is not reported — the
//       derivation's scope is deliberate and stated, not an accident
//   G5  the sentences these eleven passages already carried are still there:
//       nothing describing a surviving behaviour was removed or softened
//   G6  the fixture's three tools are counted and its response section is not,
//       so the tool set the derivation and the register are checked against is
//       the surface the server actually advertises
//
// False greens it cannot exclude:
//   - A refusal nobody registers and whose sentence the derivation cannot see.
//     Three openings and a tool-name subject are a lexical net, not a proof.
//   - Whether either side is *right*. Both sides saying the same wrong thing
//     passes, and must: the register is the artifact under review, not a
//     model's judgment of similarity.
//   - Whether a reference's surrounding prose still *means* what the quoted
//     phrase means. A sentence can be quoted faithfully into a paragraph that
//     contradicts it.
//
// What a reviewer should sabotage, and what must go red:
//   delete a registered phrase from a reference                   → A1
//   delete a registered phrase from the server file               → A2
//   point an entry at a reference file that does not exist        → A3
//   empty the register                                            → A4
//   leave an entry with no references                             → A5
//   add a server refusal with no register entry                   → A6
//   add a reference naming a registered tool, with no phrase      → A7
//   delete the register                                           → A8
//   corrupt the register's JSON                                   → A9
//   declare a tool the server does not advertise                  → A10
//   make the reference phrase something the server never says     → A11
//   add a server refusal inside a tool handler, with no entry     → A12
//   register a response field that is not an advertised tool      → A13
//   file a tool as refusing when its handler never states it       → A14
//   file a thrower as merely instructing the refusal               → A15
//   leave the superseded `tools` field on an entry                 → A16
//   drop the derived scan (report nothing generated)              → A6, A7
//   drop `src/tools/*.ts` from the derived scan                   → A12
//   read tool names from a bare `name:` rather than a definition  → A13, C5
//   drop check-refusal-parity.mjs from CI                         → C4
//   unregister any of the four new refusals                       → C2
//   drop the anchor obligation from any of the three callers       → E1
//   soften a passage the references already carried               → G5

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const CHECKER = join(here, "scripts", "check-refusal-parity.mjs");
const REGISTER = join(here, "contracts", "refusal-parity.json");
const SKILLS = join(repo, ".claude", "skills", "amanuensis");

// A crash signature in this gate's output means the run never reached its
// assertion, so the launcher rejects it as a red proof (spec.md §8.0 clause 1).
// Assertion detail is quoted from live subprocess output, so it is scrubbed
// rather than trusted. The elided form breaks the token in the middle:
// `<TypeErr…or elided>` no longer contains the signature a wrapper would leave.
const CRASH_SIGNATURES = [
  "MODULE_NOT_FOUND",
  "Cannot find module",
  "ModuleNotFoundError",
  "SyntaxError",
  "No such file or directory",
  "command not found",
  "ImportError",
  "ENOENT",
  "ReferenceError",
  "is not defined",
  "TypeError",
  "is not a function",
];
function elide(signature) {
  const cut = Math.ceil(signature.length / 2);
  return `${signature.slice(0, cut)}…${signature.slice(cut)}`;
}
function scrub(text) {
  let out = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  for (const signature of CRASH_SIGNATURES) out = out.split(signature).join(elide(signature));
  return out;
}
function head(text, n = 240) {
  const one = scrub(text);
  return one.length > n ? `${one.slice(0, n)}…` : one;
}

/**
 * Prose wraps, and so does the server's own source. Every containment test in
 * this gate compares with whitespace collapsed for the reason
 * `check-refusal-parity.mjs` does: a test that demanded a contiguous byte run
 * would go red on a reflow that changed no word, and green on nothing extra.
 */
function carries(text, phrase) {
  return String(text).replace(/\s+/g, " ").includes(String(phrase).replace(/\s+/g, " "));
}

const failures = [];
const notes = [];
let checked = 0;
function check(label, fn) {
  checked++;
  try {
    const detail = fn();
    if (detail) failures.push(`${label}: ${scrub(detail)}`);
  } catch (error) {
    failures.push(`${label}: threw — ${scrub(error?.message ?? error)}`);
  }
}

// --------------------------------------------------------------- running the check

/**
 * Run `check-refusal-parity.mjs` over a tree and report what it did.
 *
 * An absent or unstartable checker is **not** a crash here: it is the state in
 * which nothing rejects a sabotaged tree, which is precisely what the arms
 * below assert about. `rejected` therefore means *exited non-zero*, and every
 * arm additionally requires the output to name what it rejected — an exit code
 * alone cannot tell a refusal from a checker that fell over.
 */
function runCheck(root, extra = []) {
  // Named before it is spawned: an absent checker produces a module-loader
  // stack whose text is itself a crash signature, and quoting that would make
  // the red proof unreadable by the launcher (spec.md §8.0 clause 1). The state
  // it reports is the same one the arms assert about — nothing is watching.
  if (!existsSync(CHECKER)) {
    return { ran: false, status: null, out: "scripts/check-refusal-parity.mjs is not in the tree" };
  }
  const args = [CHECKER, ...(root ? ["--root", root] : []), ...extra];
  let result;
  try {
    result = spawnSync(process.execPath, args, { encoding: "utf8", cwd: here });
  } catch (error) {
    return { ran: false, status: null, out: String(error?.message ?? error) };
  }
  if (result.error) return { ran: false, status: null, out: String(result.error.message ?? "") };
  const out = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return { ran: true, status: result.status, out, rejected: result.status !== 0 };
}

/** The checker's own machine-readable answer, or null when it produced none. */
function runCheckJson(root) {
  const run = runCheck(root, ["--json"]);
  const at = run.out.indexOf("{");
  if (at === -1) return { run, json: null };
  try {
    return { run, json: JSON.parse(run.out.slice(at, run.out.lastIndexOf("}") + 1)) };
  } catch {
    return { run, json: null };
  }
}

// ------------------------------------------------------------------ the fixture tree

const temps = [];
function newTemp() {
  const dir = mkdtempSync(join(tmpdir(), "rp1-"));
  temps.push(dir);
  return dir;
}

const PROBE_LADDER_PHRASE = "were answered from nothing";
const PROBE_REFERENCE_PHRASE = "answered from nothing";
const PROBE_PUBLISH_PHRASE = "cannot both carry probe vocabulary and declare it has none";

function write(root, relative, text) {
  const path = join(root, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
}

/**
 * A complete, passing parity tree in five files.
 *
 * It is deliberately not a copy of the repository's: a fixture that copied the
 * real register would make every arm below depend on a file this packet
 * delivers, and the red commit could then only report that file's absence
 * (spec.md §8.0). Everything the checker reads has a fixture analogue, so each
 * sabotage is one edit away from a tree the checker accepts — which is what G1
 * proves before any of them run.
 */
function buildFixture(register) {
  const root = newTemp();
  write(
    root,
    "mcp-server/src/invariants.ts",
    [
      "import { ToolError } from './errors.js';",
      "export function probeAdvance(id: string, target: string, n: number): void {",
      "  throw new ToolError(",
      "    `cannot advance ${id} to '${target}': ${n} disposition(s) ` +",
      `      \`${PROBE_LADDER_PHRASE} — record the reading first.\`,`,
      "  );",
      "}",
      "",
    ].join("\n"),
  );
  write(
    root,
    "mcp-server/src/tools/probe.ts",
    [
      "import { ToolError } from '../errors.js';",
      "import { probeAdvance } from '../invariants.js';",
      "export const probeTools = [",
      "  {",
      '    name: "probe_advance",',
      '    description: "Advance one probe subsystem.",',
      "    inputSchema: { type: \"object\", properties: {} },",
      "    handler: (args) => {",
      "      probeAdvance(args.id, 'mapped', 2);",
      "      return { ok: true };",
      "    },",
      "  },",
      "  {",
      '    name: "probe_publish",',
      '    description: "Publish the probe projection.",',
      "    inputSchema: { type: \"object\", properties: {} },",
      "    handler: () => {",
      "      throw new ToolError(",
      `        \`probe_publish refuses: the store ${PROBE_PUBLISH_PHRASE}.\`,`,
      "      );",
      "    },",
      "  },",
      "  {",
      '    name: "probe_quiet",',
      '    description: "Read the probe census.",',
      "    inputSchema: { type: \"object\", properties: {} },",
      // A13's subject: a response section publishes a `name:` exactly as a tool
      // definition does, and only the `description:`/`inputSchema:` pair that
      // follows a real tool tells them apart. `gen-tool-inventory.mjs:44` reads
      // the pair for this reason; a scan that reads the bare `name:` advertises
      // eleven fields this server never exposed.
      "    handler: () => ({ sections: [{ name: \"probe_sections\", rows: 0 }] }),",
      "  },",
      "];",
      "// G4: neither of these is a refusal the register could be asked to carry.",
      "// The first names no operation the server advertises; the second is one",
      "// note among several a preflight collects. The scope is stated, not",
      "// accidental, so both are controls rather than happy accidents.",
      "export function probeLearning(blockers: string[], mode: string): void {",
      '  blockers.push(`${mode} requires a probe write prefix`);',
      '  throw new ToolError("learning requires an ended agent session with an outcome");',
      "}",
      "",
    ].join("\n"),
  );
  write(
    root,
    ".claude/skills/amanuensis/SKILL.md",
    [
      "# Probe skill",
      "",
      `Calling \`probe_publish\` on a mixed store refuses: the store ${PROBE_PUBLISH_PHRASE}.`,
      "",
    ].join("\n"),
  );
  write(
    root,
    ".claude/skills/amanuensis/references/probe-phase.md",
    [
      "# Probe phase",
      "",
      "Call `probe_advance` when the pass is done. It refuses a subsystem whose",
      `dispositions were ${PROBE_REFERENCE_PHRASE}.`,
      "",
    ].join("\n"),
  );
  write(
    root,
    "mcp-server/contracts/refusal-parity.json",
    `${JSON.stringify(register ?? defaultRegister(), null, 2)}\n`,
  );
  return root;
}

function defaultRegister() {
  return {
    contract: "refusal-parity/1",
    refusals: [
      {
        id: "probe-ladder",
        // `refuses` is what the server states at that tool; `instructs` is what
        // a reference naming it has to warn about without throwing it. The
        // census tool is the repair here: it reads what the advance refused.
        refuses: ["probe_advance"],
        instructs: ["probe_quiet"],
        server: { file: "src/invariants.ts", phrase: PROBE_LADDER_PHRASE },
        references: [
          {
            file: "../.claude/skills/amanuensis/references/probe-phase.md",
            phrase: PROBE_REFERENCE_PHRASE,
          },
        ],
      },
      {
        id: "probe-publication",
        refuses: ["probe_publish"],
        instructs: [],
        server: { file: "src/tools/probe.ts", phrase: PROBE_PUBLISH_PHRASE },
        references: [{ file: "../.claude/skills/amanuensis/SKILL.md" }],
      },
    ],
  };
}

/** Deep-copy the default register so an arm can bend one field of it. */
function bentRegister(bend) {
  const register = JSON.parse(JSON.stringify(defaultRegister()));
  bend(register);
  return register;
}

function fixtureFile(root, relative) {
  return readFileSync(join(root, relative), "utf8");
}

/**
 * The shape every sabotage arm asserts: the checker rejected the tree **and**
 * named what it rejected. Returns a failure sentence, or null.
 *
 * `must` is the list of tokens the rejection has to name — the entry id and the
 * side that lost the phrase (§6.2). A checker that exits non-zero saying
 * nothing has reported a fault without locating it, and a reader cannot repair
 * what the check will not name.
 */
function rejects(what, run, must) {
  if (!run.ran || run.status === null) {
    return (
      `the parity check passed with a registered phrase missing: nothing rejected ${what} — ` +
      `${head(run.out)}`
    );
  }
  if (!run.rejected) {
    return `the parity check passed with a registered phrase missing: ${what} exited 0 — ${head(run.out)}`;
  }
  const silent = must.filter((token) => !run.out.includes(token));
  if (silent.length > 0) {
    return (
      `the parity check passed with a registered phrase missing: ${what} exited ${run.status} ` +
      `without naming ${silent.join(" or ")} — ${head(run.out)}`
    );
  }
  return null;
}

// ---------------------------------------------------------------------- the arms

// G1 first: every sabotage below is the fixture minus one thing, so a checker
// that rejected everything would make them all pass for the wrong reason.
check("G1 the unsabotaged fixture is accepted", () => {
  const run = runCheck(buildFixture(null));
  if (!run.ran) return `the parity check could not be run — ${head(run.out)}`;
  return run.status === 0
    ? null
    : `a complete, agreeing register was rejected (exit ${run.status}) — ${head(run.out)}`;
});

check("A1 a reference that lost a registered phrase is rejected", () => {
  const root = buildFixture(null);
  const relative = ".claude/skills/amanuensis/references/probe-phase.md";
  write(root, relative, fixtureFile(root, relative).split(PROBE_REFERENCE_PHRASE).join("silent"));
  return rejects("the reference-side deletion", runCheck(root), ["probe-ladder", "probe-phase.md"]);
});

check("A2 a server file that lost a registered phrase is rejected", () => {
  const root = buildFixture(null);
  const relative = "mcp-server/src/invariants.ts";
  write(root, relative, fixtureFile(root, relative).split(PROBE_LADDER_PHRASE).join("were silent"));
  return rejects("the server-side deletion", runCheck(root), ["probe-ladder", "invariants.ts"]);
});

check("A3 a reference file the register names and the tree does not carry is rejected", () => {
  const root = buildFixture(
    bentRegister((register) => {
      register.refusals[0].references[0].file =
        "../.claude/skills/amanuensis/references/probe-absent.md";
    }),
  );
  return rejects("the missing reference", runCheck(root), ["probe-ladder", "probe-absent.md"]);
});

check("A4 an empty register is rejected", () => {
  const root = buildFixture(
    bentRegister((register) => {
      register.refusals = [];
    }),
  );
  return rejects("the empty register", runCheck(root), ["refusal-parity.json"]);
});

check("A5 an entry with no references is rejected", () => {
  const root = buildFixture(
    bentRegister((register) => {
      register.refusals[0].references = [];
    }),
  );
  return rejects("the unreferenced entry", runCheck(root), ["probe-ladder"]);
});

check("A6 a server refusal no entry covers is reported", () => {
  const root = buildFixture(null);
  const relative = "mcp-server/src/invariants.ts";
  write(
    root,
    relative,
    `${fixtureFile(root, relative)}
export function probeUnregistered(id: string): void {
  throw new ToolError(
    \`cannot advance \${id} to 'mapped': the probe ledger was never reconciled.\`,
  );
}
`,
  );
  return rejects("the unregistered refusal", runCheck(root), [
    "the probe ledger was never reconciled",
  ]);
});

check("A7 a reference naming a registered tool with no registered phrase is reported", () => {
  const root = buildFixture(null);
  write(
    root,
    ".claude/skills/amanuensis/references/probe-orphan.md",
    "# Probe orphan\n\nCall `probe_advance` and move on.\n",
  );
  return rejects("the unphrased caller", runCheck(root), ["probe-orphan.md", "probe_advance"]);
});

check("A8 an absent register is rejected", () => {
  const root = buildFixture(null);
  rmSync(join(root, "mcp-server/contracts/refusal-parity.json"));
  return rejects("the absent register", runCheck(root), ["refusal-parity.json"]);
});

check("A9 a register that is not JSON is rejected", () => {
  const root = buildFixture(null);
  write(root, "mcp-server/contracts/refusal-parity.json", "{ this is not json ");
  return rejects("the unparseable register", runCheck(root), ["refusal-parity.json"]);
});

check("A10 an entry naming a tool the server does not advertise is rejected", () => {
  const root = buildFixture(
    bentRegister((register) => {
      register.refusals[0].refuses = ["probe_advnace"];
    }),
  );
  return rejects("the misspelled tool", runCheck(root), ["probe-ladder", "probe_advnace"]);
});

check("A11 a reference phrase the server's sentence does not contain is rejected", () => {
  const root = buildFixture(
    bentRegister((register) => {
      register.refusals[0].references[0].phrase = "answered from vibes";
    }),
  );
  const relative = ".claude/skills/amanuensis/references/probe-phase.md";
  write(root, relative, `${fixtureFile(root, relative)}\nanswered from vibes\n`);
  return rejects("the invented reference phrase", runCheck(root), ["probe-ladder"]);
});

check("A12 a server refusal inside a tool handler with no entry is reported", () => {
  // A6 injects its unregistered refusal into `src/invariants.ts`. Every arm the
  // packet shipped did, so the derived scan could be narrowed to that one file
  // — `serverSources()` minus `src/tools/*.ts` — and 22 assertions still passed
  // (slice-S3 review, F1/codex). Most of this server's refusals are thrown in
  // the handler that refuses, which is exactly the half that went unwatched.
  const root = buildFixture(null);
  const relative = "mcp-server/src/tools/probe.ts";
  write(
    root,
    relative,
    `${fixtureFile(root, relative)}
export function probeReconcile(id: string): void {
  throw new ToolError(
    \`cannot advance \${id} to 'mapped': the probe census was never taken.\`,
  );
}
`,
  );
  return rejects("the unregistered refusal in a tool file", runCheck(root), [
    "the probe census was never taken",
    "probe.ts",
  ]);
});

check("A13 an entry naming a response field rather than an advertised tool is rejected", () => {
  // `probe_sections` is a `name:` in a response object, not a tool: it carries
  // no `description:`/`inputSchema:` pair and `tools/list` never names it. A
  // scan that reads the bare `name:` advertised it anyway, so the register
  // could bind a refusal to a field no caller can invoke and A10 stayed green
  // (slice-S3 review, F2/codex — 220 names scanned against 209 advertised).
  const root = buildFixture(
    bentRegister((register) => {
      register.refusals[1].refuses = ["probe_sections"];
    }),
  );
  return rejects("the registered response field", runCheck(root), [
    "probe-publication",
    "probe_sections",
  ]);
});

check("A14 a tool listed as refusing, whose handler never states it, is rejected", () => {
  // The recorded instance: `active-session-required` named `start_session`,
  // whose handler starts a session and calls nothing that refuses for want of
  // one, while every tool that does throw it was absent — and no assertion
  // compared the list against a call site (slice-S3 review, F3/codex).
  const root = buildFixture(
    bentRegister((register) => {
      register.refusals[0].refuses = ["probe_advance", "probe_quiet"];
      register.refusals[0].instructs = [];
    }),
  );
  return rejects("the tool that does not throw it", runCheck(root), ["probe-ladder", "probe_quiet"]);
});

check("A15 a tool that does throw the refusal, listed as merely instructing it, is rejected", () => {
  const root = buildFixture(
    bentRegister((register) => {
      register.refusals[1].refuses = [];
      register.refusals[1].instructs = ["probe_publish"];
    }),
  );
  return rejects("the thrower filed as a caller", runCheck(root), [
    "probe-publication",
    "probe_publish",
  ]);
});

check("A16 an entry still carrying the old `tools` field is rejected", () => {
  // The field `refuses` and `instructs` replace. Left in place it would read
  // like an association and assert nothing, which is the state F3 reported.
  const root = buildFixture(
    bentRegister((register) => {
      register.refusals[0].tools = ["probe_advance", "probe_quiet"];
    }),
  );
  return rejects("the superseded field", runCheck(root), ["probe-ladder", "tools"]);
});

check("G6 the fixture's response field is not counted as a tool", () => {
  const { run, json } = runCheckJson(buildFixture(null));
  if (!run.ran) return `the parity check could not be run — ${head(run.out)}`;
  if (!json) return `the parity check produced no machine-readable answer — ${head(run.out)}`;
  return json.tools === 3
    ? null
    : `the fixture advertises three tools and the check counted ${json.tools}`;
});

check("G3 a reference that names a registered tool and carries the phrase is accepted", () => {
  const root = buildFixture(null);
  write(
    root,
    ".claude/skills/amanuensis/references/probe-second.md",
    `# Probe second\n\n\`probe_advance\` refuses dispositions ${PROBE_REFERENCE_PHRASE}.\n`,
  );
  const run = runCheck(root);
  return run.ran && run.status === 0
    ? null
    : `a reference that names the tool and quotes the refusal was reported (exit ${run.status}) — ${head(run.out)}`;
});

check("G4 a message the derivation does not claim is left alone", () => {
  const { run, json } = runCheckJson(buildFixture(null));
  if (!run.ran) return `the parity check could not be run — ${head(run.out)}`;
  if (!json) return `the parity check produced no machine-readable answer — ${head(run.out)}`;
  const derived = JSON.stringify(json.derived_unregistered ?? []);
  const overreach = [
    ["names no advertised tool as its subject", "learning requires"],
    ["is collected into another call, not thrown", "probe write prefix"],
  ].filter(([, sentinel]) => derived.includes(sentinel));
  return overreach.length
    ? `the derivation claimed a message that ${overreach.map(([why]) => why).join(" and ")}: ${head(derived)}`
    : null;
});

// ------------------------------------------------- the repository, not the fixture

check("G2 the register at HEAD passes", () => {
  const run = runCheck(null);
  if (!run.ran) return `the parity check could not be run over this repository — ${head(run.out)}`;
  return run.status === 0
    ? null
    : `the committed register does not agree with the server or the references (exit ${run.status}) — ${head(run.out)}`;
});

/** The register as committed, or null with the reason recorded as a failure. */
function committedRegister() {
  if (!existsSync(REGISTER)) return null;
  try {
    return JSON.parse(readFileSync(REGISTER, "utf8"));
  } catch {
    return null;
  }
}

check("C1 the committed register is a non-empty list of referenced entries", () => {
  const register = committedRegister();
  if (!register) return "contracts/refusal-parity.json is absent or is not parseable JSON";
  if (!Array.isArray(register.refusals) || register.refusals.length === 0)
    return "contracts/refusal-parity.json carries no refusals";
  const bad = register.refusals
    .filter(
      (entry) =>
        !entry?.id ||
        !entry?.server?.file ||
        !entry?.server?.phrase ||
        !Array.isArray(entry.references) ||
        entry.references.length === 0,
    )
    .map((entry) => entry?.id ?? "(unnamed)");
  return bad.length ? `entries with no id, no server phrase or no reference: ${bad.join(", ")}` : null;
});

// The four refusals this lane adds and two it inherits, identified by the
// server's own words rather than by a register id: an id is the register's to
// choose, and a gate that asserted ids would go red on a rename and stay green
// on a rewrite. Each sentence below is quoted from the file named beside it.
const REGISTERED_SENTENCES = [
  ["new §2.3 unattached dispositions", "were answered from nothing"],
  ["new §3.3 unreconciled store", "has not been reconciled against the repository at"],
  ["new §4.4 undischarged vocabulary", "neither defined a domain term"],
  ["new §5.5 undecided carried findings", "carried finding(s) have no terminal outcome"],
  ["existing: unchallenged claims", "current claim(s) carry no challenge outcome"],
  ["existing: overturning a finding", "Overturning requires evidence, not vibes"],
];

check("C2 the register carries the four new refusals and the two existing ones", () => {
  const register = committedRegister();
  if (!register?.refusals) return "contracts/refusal-parity.json is absent, unparseable or empty";
  const phrases = register.refusals.map((entry) => String(entry?.server?.phrase ?? ""));
  const missing = REGISTERED_SENTENCES.filter(
    ([, sentence]) => !phrases.some((phrase) => phrase.includes(sentence) || sentence.includes(phrase)),
  ).map(([what]) => what);
  return missing.length ? `no register entry covers ${missing.join("; ")}` : null;
});

/**
 * The server's source with its concatenation glue removed.
 *
 * A refusal is wrapped at the column limit into three or four adjacent
 * literals, so the sentence the register quotes exists in the *message* and
 * nowhere in the file contiguously. C3 reads the server file independently of
 * `check-refusal-parity.mjs` — that is its whole value — so it has to undo the
 * wrapping itself rather than trust the checker's assembly.
 */
function unwrapped(text) {
  return text.replace(/["`]\s*\+\s*["`]/g, "");
}

check("C3 every registered phrase is in the file the register names", () => {
  const register = committedRegister();
  if (!register?.refusals) return "contracts/refusal-parity.json is absent, unparseable or empty";
  const lost = [];
  for (const entry of register.refusals) {
    const file = resolve(here, String(entry?.server?.file ?? ""));
    const text = existsSync(file) ? readFileSync(file, "utf8") : null;
    if (text === null) lost.push(`${entry?.id}: ${entry?.server?.file} is not in the tree`);
    else if (!carries(unwrapped(text), String(entry?.server?.phrase)))
      lost.push(`${entry?.id}: ${entry?.server?.file} no longer says it`);
  }
  return lost.length ? lost.join("; ") : null;
});

check("C4 check-refusal-parity.mjs runs in CI beside check-evidence-vocabulary.mjs", () => {
  const workflow = join(repo, ".github", "workflows", "test.yml");
  if (!existsSync(workflow)) return ".github/workflows/test.yml is not in the tree";
  const text = readFileSync(workflow, "utf8");
  if (!text.includes("scripts/check-refusal-parity.mjs"))
    return "no CI step runs scripts/check-refusal-parity.mjs";
  if (!text.includes("scripts/check-evidence-vocabulary.mjs"))
    return "the vocabulary check this one runs beside is gone from CI";
  const job = text.slice(text.indexOf("mcp-server:"));
  return job.includes("scripts/check-refusal-parity.mjs")
    ? null
    : "the parity check runs in CI, but not in the mcp-server job the vocabulary check runs in";
});

check("C5 the tool set the check reads is the one the server advertises", () => {
  // An independent count, from the block `gen-tool-inventory.mjs` renders out of
  // a live `tools/list`. The checker reads source text — it must, for
  // `check-evidence-vocabulary.mjs`'s reason — and a text scan can read too much
  // as easily as too little. This is the arm that fails if it goes back to a
  // bare `name:`.
  const development = join(here, "DEVELOPMENT.md");
  if (!existsSync(development)) return "DEVELOPMENT.md is not in the tree";
  const text = readFileSync(development, "utf8");
  const start = text.indexOf("<!-- TOOL-INVENTORY-START -->");
  const end = text.indexOf("<!-- TOOL-INVENTORY-END -->");
  if (start === -1 || end === -1) return "DEVELOPMENT.md carries no generated tool inventory";
  const advertised = new Set(
    [...text.slice(start, end).matchAll(/^\| `([a-z][a-z0-9_]*)` \|/gm)].map((m) => m[1]),
  );
  if (advertised.size === 0) return "the generated tool inventory lists no tools";
  const { run, json } = runCheckJson(null);
  if (!run.ran) return `the parity check could not be run over this repository — ${head(run.out)}`;
  if (!json) return `the parity check produced no machine-readable answer — ${head(run.out)}`;
  return json.tools === advertised.size
    ? null
    : `the check reads ${json.tools} tool name(s) from src/tools/*.ts; tools/list advertises ${advertised.size}`;
});

check("F1 no server refusal and no caller is left unregistered at HEAD", () => {
  const { run, json } = runCheckJson(null);
  if (!run.ran) return `the parity check could not be run over this repository — ${head(run.out)}`;
  if (!json) return `the parity check produced no machine-readable answer — ${head(run.out)}`;
  const derived = json.derived_unregistered ?? null;
  const unphrased = json.unphrased_references ?? null;
  if (!Array.isArray(derived) || !Array.isArray(unphrased))
    return "the parity check reported no derived candidate set at all";
  const parts = [];
  if (derived.length) parts.push(`${derived.length} unregistered refusal(s): ${head(JSON.stringify(derived), 200)}`);
  if (unphrased.length)
    parts.push(`${unphrased.length} caller(s) with no registered phrase: ${head(JSON.stringify(unphrased), 200)}`);
  return parts.length ? parts.join("; ") : null;
});

// E1 is what the derived check found: three passages that instruct a
// `define_term` call the server now refuses, none of which was in §6.1's
// eight-entry register (spec.md §6.1, acceptance bullet 8).
const ANCHOR_CALLERS = [
  "references/phase-1-scope.md",
  "references/phase-2-structural.md",
  "references/phase-3-concerns.md",
];

check("E1 every define_term caller carries the anchor obligation", () => {
  const register = committedRegister();
  // The *anchor* obligation, not the ladder refusal that also names the tool:
  // the one define_term's own handler throws, which is the one a passage
  // instructing the call has to warn about. Selected by where it lives rather
  // than by id, so a rename of the entry does not silently empty this check.
  const owned = (register?.refusals ?? []).filter(
    (row) =>
      [...(row?.refuses ?? []), ...(row?.instructs ?? [])].includes("define_term") &&
      String(row?.server?.file ?? "").startsWith("src/tools/"),
  );
  if (owned.length === 0) return "no register entry covers a refusal define_term itself throws";
  const phrases = owned
    .flatMap((row) => [
      String(row.server?.phrase ?? ""),
      ...(row.references ?? []).map((reference) => String(reference?.phrase ?? "")),
    ])
    .filter((phrase) => phrase.length > 0);
  const silent = ANCHOR_CALLERS.filter((relative) => {
    const path = join(SKILLS, relative);
    if (!existsSync(path)) return true;
    const text = readFileSync(path, "utf8");
    return !text.includes("define_term") || !phrases.some((phrase) => carries(text, phrase));
  });
  return silent.length
    ? `${silent.join(", ")} name define_term and carry no registered anchor phrase`
    : null;
});

// G5: the sentences the touched references already carried. §6.1 permits one
// replacement — "Continue adding terms via `define_term`." — and nothing else;
// every sentence below describes a behaviour that still exists, so removing or
// softening one is a regression this packet must not make.
const SURVIVING_SENTENCES = [
  ["references/phase-1-scope.md", "Every file gets a `why_in_scope` rationale. No blanks."],
  ["references/phase-2-structural.md", "The type graph is higher"],
  ["references/phase-3-concerns.md", "`linchpin_dependent`"],
  ["references/phase-3-concerns.md", "attach_evidence_to_disposition"],
  ["references/phase-4-adversarial.md", "Overturning requires evidence, not vibes"],
  ["references/phase-4-adversarial.md", "**Be fair to Phase 3.**"],
  ["references/refresh.md", "Never clear a row you have not read. Never clear in bulk."],
  ["references/refresh.md", "they cannot be verified in place"],
  ["references/onboarding.md", "**Rank every subsystem by survey priority**"],
  ["references/artifact-templates.md", "## Structural inventory (Phase 2)"],
  ["../../../.claude/skills/amanuensis/SKILL.md", "Authorized claims still scale with status"],
];

check("G5 no passage lost a sentence that describes a surviving behaviour", () => {
  const lost = [];
  for (const [relative, sentence] of SURVIVING_SENTENCES) {
    const path = relative.startsWith("../") ? join(SKILLS, relative) : join(SKILLS, relative);
    if (!existsSync(path)) {
      lost.push(`${relative} is not in the tree`);
      continue;
    }
    if (!carries(readFileSync(path, "utf8"), sentence)) lost.push(`${relative}: "${sentence}"`);
  }
  return lost.length ? `removed or softened: ${lost.join("; ")}` : null;
});

// ------------------------------------------------------------------ the status line

for (const dir of temps) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* a temp directory that outlives the run changes no verdict */
  }
}

notes.push(
  existsSync(CHECKER)
    ? "the parity check is in the tree and every arm below ran against it"
    : "the parity check is not in the tree, so nothing rejects a sabotaged register",
);

for (const note of notes) console.log(`  note ${note}`);
console.log(`  ran  ${checked} assertion(s) against ${CHECKER}`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(
    "GATE P7 RED: GATE RP1 RED: the parity check passed with a registered phrase missing, or the " +
      "register lost its hold on the server, on a reference, on the derived candidate set or on " +
      `CI — ${failures.length} of ${checked} assertion(s) failed; first: ${failures[0]}`,
  );
  process.exit(1);
}
console.log("GATE P7 GREEN");
process.exit(0);
