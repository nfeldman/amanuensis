#!/usr/bin/env node
// GATE EX7 (design/explanation/spec.md §4.2; claim C14) — the republish chain.
//
//   exit 0  `GATE EX7 GREEN`          — every assertion held
//   exit 1  `GATE EX7 RED: <reason>`  — an assertion fired
//
// `dev/republish-docs.mjs` is loaded by guarded dynamic import and driven through
// `main(argv, deps)`, so its absence prints the RED line and not a stack trace.
// Every subprocess, git call and server call is a stub; the fixture receipts are
// real files in a throwaway root, so the step bodies run and only their
// subprocesses are replaced. No store is opened and nothing outside the throwaway
// root is written. A child's raw output is never echoed.
//
// One case is not a stub: the real `dev/record-survey-depth.mjs` runs in a throwaway
// repository over a store built from `mcp-server/src/schema.sql`, and its receipt
// feeds the real progress step. That seam is what a fixture receipt cannot vouch
// for, since step 8 reads a successor id the recorder has to supply.
//
// What a reviewer should sabotage, and what must go red:
//   remove the unledgered stop, or print no paths         → the first check
//   classify an unledgered path, or call any ledger tool  → the first check
//   move or swap any two steps                            → the order checks
//   hard-code the dogfood loci instead of reading them    → the freshness checks
//   check standing but not classification, or one owner   → the freshness checks
//   treat no owners, or no loci, as nothing to stop on    → the freshness checks
//   read only `ok`, or only `readback.ok`                 → the publish checks
//   promote without either flag                           → the summary checks
//   drop the refusal before the dogfood recorder          → the summary checks
//   add a detect_changes after materialize_docs           → the reconcile checks
//   invoke a rebuild recorder                             → the recorder checks
//   stop verifying at the first red gate, or drop one     → the verify checks
//   exit 0 with a red gate, or echo a child's output      → the verify checks
//   rewrite the progress file through JSON.stringify      → the byte-identity check
//   rewrite a key §4.2 does not name, or miss one it does → the byte-identity check
//   drop `successor_id` from the depth recorder           → the recorder seam check
//   drop the workflow step                                → the last assertion

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..");
const SCRIPT_REL = "dev/republish-docs.mjs";
const SCRIPT = join(REPO, SCRIPT_REL);
const WORKFLOW_REL = ".github/workflows/test.yml";
const UNFILLED_REL = "design/explanation/unfilled-slots.json";
const DOGFOOD_REL = "design/reader-lenses/dogfood-receipt.json";
const DEPTH_REL = "design/survey-depth/acceptance-receipt.json";
const PROGRESS_REL = "design/survey-depth/survey-progress.json";
const MEASURE_REL = "design/explanation/reader-measure.json";

const UNLEDGERED_PHRASE =
  "the republish chain does not stop before publishing when a tracked path is unledgered";

const STEPS = [
  "preflight",
  "reconcile",
  "freshness",
  "publish",
  "promote",
  "dogfood-receipt",
  "depth-receipt",
  "progress-record",
  "measure",
  "verify",
];
const GATES = [
  "dev/test-reader-lenses-dogfood.mjs",
  "dev/test-survey-depth.mjs",
  "dev/test-survey-depth-acceptance.mjs",
  "dev/test-carried-finding-references.mjs",
];
const PROMOTE = "dev/promote-docs.mjs";
const DOGFOOD = "dev/record-dogfood-receipt.mjs";
const DEPTH = "dev/record-survey-depth.mjs";
const MEASURE = "dev/measure-reader-prose.mjs";
const HEAD = "c".repeat(40);
const CHILD_RAW = "RAW-CHILD-OUTPUT-MARKER";

// ---------------------------------------------------------------------------
// The fixture progress file. Its formatting is deliberately not what
// JSON.stringify would write: a `\u` escape, a trailing-zero number, inline
// objects, and braces inside a string. The expected text below is worked out by
// hand, so any rewrite that reformats a key §4.2 does not name is a byte difference.
// ---------------------------------------------------------------------------
const PROGRESS_FIXTURE = `{
  "contract": "amanuensis-survey-depth/survey-progress/v1",
  "what_this_is": "A fixture \\u2014 with an escape a round trip would normalize",
  "batches": [ {"a": 1,   "b": 2.50} ],
  "carried_adjudication": {
    "denominator": "keep \\u00e9",
    "total": 1,
    "pre_recorded_archived_terminal": 8,
    "to_decide": 99,
    "decided": 1,
    "outcomes": { "archived-terminal": 1 },
    "successors": [],
    "repaired": ["OLD at 0000000"],
    "note": "keep \\"quoted\\" } ] braces"
  },
  "end": {
    "at_sha": "old",
    "obligation_bearing": 1,
    "examined": 1,
    "fraction": 1.00,
    "examined_needed_for_b2": 294,
    "why": "keep"
  }
}
`;

const RECEIPT_SHA = "a".repeat(40);
const RECONCILED_SHA = "b".repeat(40);
const REPAIRED_ONE = "1d6516aee47fd7be8cc87e94ee6bca93869916ea";
const REPAIRED_TWO = "5694080aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const carriedRow = (id, outcome, extra = {}) => ({
  carried_id: id,
  archived_store_id: "store-a",
  archived_finding_id: id,
  subsystem_id: "B-01",
  archived_resolution: "open",
  outcome,
  successor_id: null,
  repaired_sha: null,
  evidence_revisions: [],
  ...extra,
});

const RECEIPT_FIXTURE = {
  contract: "amanuensis-survey-depth/acceptance-receipt/v1",
  repository_sha: RECEIPT_SHA,
  store: { checked_sha: RECONCILED_SHA },
  blocking: {
    B1: { witness: { detected_sha: RECONCILED_SHA } },
    B2: { examined: 357, obligation_bearing: 496, fraction: 357 / 496 },
    B5: {
      carried: [
        carriedRow("A-1", "archived-terminal"),
        carriedRow("A-2", "archived-terminal"),
        carriedRow("B-1", "repaired", { repaired_sha: REPAIRED_ONE }),
        carriedRow("B-2", "repaired", { repaired_sha: REPAIRED_TWO }),
        carriedRow("C-1", "successor-finding", { successor_id: "S-1" }),
        // Two records may name one successor. The depth gate compares the count
        // with the list's length, so the list must not be deduplicated.
        carriedRow("C-2", "successor-finding", { successor_id: "S-1" }),
        carriedRow("D-1", "ruled-out"),
      ],
    },
  },
};

const PROGRESS_EXPECTED = `{
  "contract": "amanuensis-survey-depth/survey-progress/v1",
  "what_this_is": "A fixture \\u2014 with an escape a round trip would normalize",
  "batches": [ {"a": 1,   "b": 2.50} ],
  "carried_adjudication": {
    "denominator": "keep \\u00e9",
    "total": 7,
    "pre_recorded_archived_terminal": 8,
    "to_decide": 5,
    "decided": 7,
    "outcomes": {
      "archived-terminal": 2,
      "repaired": 2,
      "ruled-out": 1,
      "successor-finding": 2
    },
    "successors": [
      "S-1",
      "S-1"
    ],
    "repaired": [
      "B-1 at 1d6516a",
      "B-2 at 5694080"
    ],
    "note": "keep \\"quoted\\" } ] braces"
  },
  "end": {
    "at_sha": "${RECONCILED_SHA}",
    "obligation_bearing": 496,
    "examined": 357,
    "fraction": 0.7198,
    "examined_needed_for_b2": 294,
    "why": "keep"
  },
  "derived_fields_rewritten_at": "${RECEIPT_SHA}"
}
`;

// ---------------------------------------------------------------------------
// The stubbed world
// ---------------------------------------------------------------------------
const EXAMINED_OWNER = { subsystem_id: "B-01", classification: "examined", standing_state: "examined" };
const EXAMINED_STANDING = { state: "examined", owners: [EXAMINED_OWNER] };
const LOCI = ["fixture/only-here.ts", "fixture/also-here.py"];
const UNFILLED_ROWS = [
  { slot: "thesis", page: "index.md", subject: "project", state: "absent", discharge: "add a section" },
];

function greenPublish() {
  return {
    ok: true,
    mode: "clean-publish",
    published: true,
    output_dir: "/fixture/.amanuensis/docs",
    warnings: [],
    readback: {
      ok: true,
      axes: { state: { ok: true }, coverage: { ok: true }, content: { ok: true } },
      mismatch_count: 0,
      mismatches: [],
    },
    unfilled_slots: UNFILLED_ROWS,
  };
}

const roots = [];

function world(options = {}) {
  const repo = mkdtempSync(join(tmpdir(), "ex7-republish-"));
  roots.push(repo);
  const write = (rel, text) => {
    mkdirSync(dirname(join(repo, rel)), { recursive: true });
    writeFileSync(join(repo, rel), text);
  };
  write(
    DOGFOOD_REL,
    `${JSON.stringify(options.dogfood ?? { loci: LOCI.map((locus) => ({ locus })) })}\n`,
  );
  write(DEPTH_REL, `${JSON.stringify(options.receipt ?? RECEIPT_FIXTURE)}\n`);
  write(PROGRESS_REL, options.progress ?? PROGRESS_FIXTURE);
  write(UNFILLED_REL, `${JSON.stringify({ commit: options.unfilledCommit ?? null, unfilled_slots: [] })}\n`);
  write(MEASURE_REL, `${JSON.stringify({ entries: [] })}\n`);

  const log = [];
  const printed = [];
  const nodeCalls = [];
  const serverCalls = [];
  const stateDir = join(repo, ".republish-state");
  const standing = options.standing ?? {};
  const statuses = options.statuses ?? {};

  const deps = {
    repo,
    stateDir,
    print: (line) => printed.push(String(line)),
    git(args) {
      const verb = args[0];
      if (verb === "rev-parse") return { status: 0, stdout: `${HEAD}\n` };
      if (verb === "status") {
        const scoped = args.includes("docs");
        return { status: 0, stdout: scoped ? (options.docsStatus ?? "") : (options.status ?? "") };
      }
      if (verb === "ls-files") {
        const asked = args.slice(args.indexOf("--") + 1);
        const untracked = new Set(options.untracked ?? []);
        return { status: 0, stdout: asked.filter((path) => !untracked.has(path)).join("\0") };
      }
      throw new Error(`the stub has no answer for git ${args.join(" ")}`);
    },
    buildServer() {
      log.push("build");
      return { status: options.buildStatus ?? 0 };
    },
    storeProblem() {
      log.push("store-opens");
      return options.storeProblem ?? null;
    },
    async spawnServer() {
      log.push("server:spawn");
      return {
        async call(name, args = {}) {
          serverCalls.push({ name, args });
          if (name === "describe_locus") {
            log.push(`server:describe_locus ${args.locus}`);
            return { standing: args.locus in standing ? standing[args.locus] : EXAMINED_STANDING };
          }
          log.push(`server:${name}`);
          if (name === "start_session") return { session_id: "fixture-session" };
          if (name === "detect_changes") {
            if ("detect" in options) return options.detect;
            return {
              reconciled_at_sha: HEAD,
              unledgered_paths: options.unledgered ?? [],
              absent_ledger_paths: options.absent ?? [],
            };
          }
          if (name === "materialize_docs") return options.publish ?? greenPublish();
          return { ok: true };
        },
        async stop() {
          log.push("server:stop");
        },
      };
    },
    runNode(script, args = []) {
      log.push(`node ${script}`);
      nodeCalls.push({ script, args });
      if (script === PROMOTE) {
        const summary = args[args.indexOf("--publish-summary") + 1];
        const receipt = args[args.indexOf("--receipt") + 1];
        if (args.includes("--receipt")) {
          const carried =
            options.promoteDropsSummary || !args.includes("--publish-summary")
              ? null
              : JSON.parse(readFileSync(summary, "utf8"));
          mkdirSync(dirname(receipt), { recursive: true });
          writeFileSync(receipt, JSON.stringify({ ok: true, clean_publish: carried }));
        }
      }
      return {
        status: script in statuses ? statuses[script] : 0,
        stdout: `${CHILD_RAW} of ${script}\n`,
        stderr: `${CHILD_RAW} on stderr of ${script}\n`,
      };
    },
  };
  if (options.steps) deps.steps = options.steps;
  return { repo, deps, log, printed, nodeCalls, serverCalls, stateDir };
}

function cleanRoots() {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------
const failures = [];

// A thrown error's text is not ours to print verbatim: it can carry the crash
// signatures the launcher reads as a gate that never reached its assertion.
function scrub(text) {
  return String(text)
    .replace(/Cannot find module|MODULE_NOT_FOUND|ENOENT|SyntaxError|ReferenceError|TypeError/g, "[error]")
    .replace(/is not a function|command not found|No such file or directory/g, "[error]")
    .replace(/ModuleNotFoundError|ImportError|Traceback \(most recent call last\)/g, "[error]")
    .replace(/NameError|AttributeError/g, "[error]")
    .split("\n")[0]
    .slice(0, 400);
}

async function check(name, assertion) {
  let reason = null;
  try {
    reason = await assertion();
  } catch (error) {
    reason = `the check raised: ${scrub(error?.message ?? error)}`;
  }
  if (reason) {
    failures.push(`${name}: ${reason}`);
    console.log(`  not ok  ${name}`);
  } else {
    console.log(`  ok      ${name}`);
  }
}

// ---------------------------------------------------------------------------
// The module under test, guarded
// ---------------------------------------------------------------------------
let chain = null;
try {
  chain = await import(pathToFileURL(SCRIPT).href);
} catch {
  chain = null;
}
const notLoaded = () => {
  if (!chain) return `${SCRIPT_REL} could not be loaded`;
  if (typeof chain.main !== "function") return `${SCRIPT_REL} exports no main(argv, deps)`;
  return null;
};

const published = (w) => w.log.includes("server:materialize_docs");
const ran = (w, script) => w.nodeCalls.some((call) => call.script === script);
const nodeLog = (w) => w.log.filter((entry) => entry.startsWith("node "));
const said = (w) => w.printed.join("\n");

function greenLog() {
  return [
    "build",
    "store-opens",
    "server:spawn",
    "server:start_session",
    "server:detect_changes",
    ...LOCI.map((locus) => `server:describe_locus ${locus}`),
    "server:materialize_docs",
    "server:stop",
    `node ${PROMOTE}`,
    `node ${DOGFOOD}`,
    `node ${DEPTH}`,
    `node ${MEASURE}`,
    ...GATES.map((gate) => `node ${gate}`),
  ];
}

async function run(options, argv = []) {
  const w = world(options);
  w.exit = await chain.main(argv, w.deps);
  return w;
}

// Stopped non-zero, before the publish, naming every string given.
function stoppedBeforePublish(w, names) {
  if (w.exit === 0) return "the command exits 0";
  if (published(w)) return "materialize_docs ran";
  if (w.nodeCalls.length) return `${w.nodeCalls[0].script} ran after the stop`;
  const missing = names.filter((name) => !said(w).includes(name));
  return missing.length ? `the stop does not name ${missing.join(", ")}` : null;
}

// ---------------------------------------------------------------------------
// The stop that names the plan's red line comes first (spec.md §0.1).
// ---------------------------------------------------------------------------
console.log("the stops before the publish");

await check(UNLEDGERED_PHRASE, async () => {
  const absent = notLoaded();
  if (absent) return absent;
  const paths = ["dev/brand-new.mjs", "design/another/new.md"];
  const w = await run({ unledgered: paths });
  const stopped = stoppedBeforePublish(w, paths);
  if (stopped) return stopped;
  if (w.log.some((entry) => entry.startsWith("server:describe_locus"))) {
    return "the freshness step ran past the stop";
  }
  // A path's subsystem and classification are a survey judgement (§4.2 step 2).
  const after = w.log.slice(w.log.indexOf("server:detect_changes") + 1);
  const guessed = after.filter((entry) => entry !== "server:stop");
  if (guessed.length) return `the script went on to ${guessed.join(", ")}`;
  if (!after.includes("server:stop")) return "the server was left running";
  return null;
});

await check("a detect_changes that reports no path list stops the run and does not read as none", async () => {
  const absent = notLoaded();
  if (absent) return absent;
  for (const detect of [{}, { ok: false, error: "fixture refusal" }, { unledgered_paths: "none" }]) {
    const w = await run({ detect });
    const stopped = stoppedBeforePublish(w, []);
    if (stopped) return `${JSON.stringify(detect)}: ${stopped}`;
  }
  return null;
});

await check("a ledger row the tree no longer carries stops the run and names the path", async () => {
  const absent = notLoaded();
  if (absent) return absent;
  const w = await run({ absent: [{ subsystem_id: "B-07", file_path: "dev/removed.mjs" }] });
  return stoppedBeforePublish(w, ["dev/removed.mjs"]);
});

await check("a dogfood locus with a stale owner stops the run and names the path and owner", async () => {
  const absent = notLoaded();
  if (absent) return absent;
  const stale = { subsystem_id: "B-03", classification: "examined", standing_state: "examined-stale" };
  const w = await run({
    standing: { [LOCI[1]]: { state: "mixed", owners: [EXAMINED_OWNER, stale] } },
  });
  const stopped = stoppedBeforePublish(w, [LOCI[1], "B-03"]);
  if (stopped) return stopped;
  if (said(w).includes(LOCI[0])) return `the stop names ${LOCI[0]}, whose owner is examined`;
  return null;
});

await check("every failing dogfood locus is named in one stop", async () => {
  const absent = notLoaded();
  if (absent) return absent;
  const a = { subsystem_id: "B-03", classification: "examined", standing_state: "candidate" };
  const b = { subsystem_id: "B-05", classification: "examined", standing_state: "examined-stale" };
  const w = await run({
    standing: { [LOCI[0]]: { state: "candidate", owners: [a] }, [LOCI[1]]: { state: "mixed", owners: [b] } },
  });
  return stoppedBeforePublish(w, [LOCI[0], LOCI[1], "B-03", "B-05"]);
});

await check("the dogfood gate's other standing conditions also stop the run", async () => {
  const absent = notLoaded();
  if (absent) return absent;
  const cases = {
    "a ledger classification that is not examined": {
      state: "examined",
      owners: [{ subsystem_id: "B-04", classification: "candidate", standing_state: "examined" }],
    },
    "no owner": { state: "examined", owners: [] },
    "a standing the gate does not accept": {
      state: "unexamined",
      owners: [{ subsystem_id: "B-04", classification: "examined", standing_state: "examined" }],
    },
    "no standing": undefined,
  };
  for (const [label, block] of Object.entries(cases)) {
    const w = await run({ standing: { [LOCI[0]]: block } });
    const stopped = stoppedBeforePublish(w, [LOCI[0]]);
    if (stopped) return `${label}: ${stopped}`;
  }
  return null;
});

await check("the dogfood loci are read from the receipt, and a receipt naming none stops the run", async () => {
  const absent = notLoaded();
  if (absent) return absent;
  const w = await run({});
  const asked = w.serverCalls.filter((call) => call.name === "describe_locus").map((call) => call.args.locus);
  if (JSON.stringify(asked) !== JSON.stringify(LOCI)) {
    return `describe_locus was asked about ${JSON.stringify(asked)}, not the receipt's ${JSON.stringify(LOCI)}`;
  }
  for (const dogfood of [{}, { loci: [] }]) {
    const stoppedWorld = await run({ dogfood });
    const stopped = stoppedBeforePublish(stoppedWorld, []);
    if (stopped) return `a receipt holding ${JSON.stringify(dogfood)}: ${stopped}`;
  }
  return null;
});

await check("preflight stops on a build failure, an unopenable store, and a change outside the allowed set", async () => {
  const absent = notLoaded();
  if (absent) return absent;
  const build = await run({ buildStatus: 1 });
  if (build.exit === 0 || build.log.includes("server:spawn")) return "a failed build did not stop the run";
  const store = await run({ storeProblem: "the fixture store does not open" });
  if (store.exit === 0 || store.log.includes("server:spawn")) return "an unopenable store did not stop the run";
  if (!said(store).includes("the fixture store does not open")) return "the stop does not say why the store failed";
  for (const [status, name] of [
    [" M mcp-server/src/index.ts\0", "mcp-server/src/index.ts"],
    ["?? stray/untracked.md\0", "stray/untracked.md"],
    ["R  docs/renamed.md\0dev/moved-from.mjs\0", "dev/moved-from.mjs"],
    [" M design/explanation/spec.md\0", "design/explanation/spec.md"],
  ]) {
    const w = await run({ status });
    if (w.exit === 0 || w.log.includes("server:spawn")) return `${name} did not stop the run`;
    if (!said(w).includes(name)) return `the stop does not name ${name}`;
  }
  return null;
});

await check("preflight allows changes under docs/ and to the receipt files, and nothing else", async () => {
  const absent = notLoaded();
  if (absent) return absent;
  const status = [
    " M docs/index.md",
    "?? docs/new-page.html",
    ` M ${DOGFOOD_REL}`,
    ` M ${DEPTH_REL}`,
    ` M ${PROGRESS_REL}`,
    ` M ${UNFILLED_REL}`,
    ` M ${MEASURE_REL}`,
    "",
  ].join("\0");
  const w = await run({ status });
  if (w.exit !== 0) return `the run did not complete: ${scrub(said(w))}`;
  const lookalike = await run({ status: " M docs-not/really.md\0" });
  if (lookalike.exit === 0) return "a path that only begins with docs is treated as docs/";
  return null;
});

await check("preflight stops when a file a later step writes is not tracked", async () => {
  const absent = notLoaded();
  if (absent) return absent;
  const w = await run({ untracked: [UNFILLED_REL] });
  if (w.exit === 0 || w.log.includes("server:spawn")) return "the run went on";
  return said(w).includes(UNFILLED_REL) ? null : `the stop does not name ${UNFILLED_REL}`;
});

console.log("the order");

await check("a green run performs the ten steps' work in order", async () => {
  const absent = notLoaded();
  if (absent) return absent;
  const w = await run({}, ["--measure-label", "fixture-label"]);
  if (w.exit !== 0) return `the green run exits ${w.exit}: ${scrub(said(w))}`;
  const expected = greenLog();
  if (JSON.stringify(w.log) !== JSON.stringify(expected)) {
    return `the calls were ${w.log.join(" > ")}`;
  }
  return null;
});

await check("the ten named steps are exported in order and each is injectable", async () => {
  const absent = notLoaded();
  if (absent) return absent;
  if (JSON.stringify(chain.STEP_NAMES) !== JSON.stringify(STEPS)) {
    return `STEP_NAMES is ${JSON.stringify(chain.STEP_NAMES)}`;
  }
  const seen = [];
  const steps = Object.fromEntries(STEPS.map((name) => [name, async () => seen.push(name)]));
  const w = await run({ steps }, ["--measure-label", "fixture-label"]);
  if (w.exit !== 0) return `a run of ten injected steps exits ${w.exit}`;
  if (JSON.stringify(seen) !== JSON.stringify(STEPS)) return `the injected steps ran as ${seen.join(" > ")}`;
  if (w.log.length) return `an injected run still reached ${w.log[0]}`;
  return null;
});

await check("--plan prints the ten steps in order and does nothing else", async () => {
  const absent = notLoaded();
  if (absent) return absent;
  const stubbed = await run({}, ["--plan"]);
  if (stubbed.exit !== 0) return `--plan exits ${stubbed.exit}`;
  if (stubbed.log.length) return `--plan reached ${stubbed.log[0]}`;
  const child = spawnSync(process.execPath, [SCRIPT, "--plan"], { encoding: "utf8", cwd: REPO });
  if (child.status !== 0) return `the script's own --plan exits ${child.status}`;
  const lines = child.stdout.split("\n");
  const positions = STEPS.map((name) => lines.findIndex((line) => new RegExp(`\\b${name}\\b`).test(line)));
  if (positions.some((position) => position < 0)) return `the plan omits a step: ${scrub(child.stdout)}`;
  if (positions.some((position, index) => index > 0 && position <= positions[index - 1])) {
    return "the plan does not print the steps in order";
  }
  return null;
});

await check("--from resumes at the step named and refuses a step that does not exist", async () => {
  const absent = notLoaded();
  if (absent) return absent;
  const seen = [];
  const steps = Object.fromEntries(STEPS.map((name) => [name, async () => seen.push(name)]));
  const injected = await run({ steps }, ["--from", "publish", "--measure-label", "x"]);
  if (injected.exit !== 0) return `--from publish exits ${injected.exit}`;
  if (JSON.stringify(seen) !== JSON.stringify(STEPS.slice(3))) return `--from publish ran ${seen.join(" > ")}`;
  const late = await run({}, ["--from", "verify"]);
  const gates = GATES.map((gate) => `node ${gate}`);
  if (JSON.stringify(late.log) !== JSON.stringify(gates)) return `--from verify reached ${late.log.join(" > ")}`;
  for (const argv of [["--from", "no-such-step"], ["--from"], ["--no-such-flag"], ["--measure-label"]]) {
    const refused = await run({}, argv);
    if (refused.exit === 0) return `${argv.join(" ")} exits 0`;
    if (refused.log.length) return `${argv.join(" ")} reached ${refused.log[0]}`;
    const child = spawnSync(process.execPath, [SCRIPT, ...argv], { encoding: "utf8", cwd: REPO });
    if (child.status === 0) return `the script's own ${argv.join(" ")} exits 0`;
  }
  return null;
});

await check("the measure step runs only with --measure-label, with the label, on docs", async () => {
  const absent = notLoaded();
  if (absent) return absent;
  const without = await run({});
  if (without.exit !== 0) return `a run without a label exits ${without.exit}`;
  if (ran(without, MEASURE)) return "the measure ran without a label";
  const withLabel = await run({}, ["--measure-label", "fixture-label"]);
  const call = withLabel.nodeCalls.find((entry) => entry.script === MEASURE);
  if (JSON.stringify(call?.args) !== JSON.stringify(["docs", "--record", "fixture-label"])) {
    return `the measure was given ${JSON.stringify(call?.args ?? null)}`;
  }
  const failed = await run({ statuses: { [MEASURE]: 1 } }, ["--measure-label", "fixture-label"]);
  if (failed.exit === 0 || ran(failed, GATES[0])) return "a failed measure did not stop the run";
  return null;
});

console.log("the publish");

await check("a red read-back or a lint refusal stops the run before promote", async () => {
  const absent = notLoaded();
  if (absent) return absent;
  const red = (mutate) => {
    const summary = greenPublish();
    mutate(summary);
    return summary;
  };
  const cases = {
    "a red state axis": red((s) => {
      s.ok = false;
      s.readback.ok = false;
      s.readback.axes.state.ok = false;
    }),
    "a coverage axis red under a green ok": red((s) => {
      s.readback.axes.coverage.ok = false;
    }),
    "a content axis red under a green readback.ok": red((s) => {
      s.readback.axes.content.ok = false;
    }),
    "mismatches under green axes": red((s) => {
      s.readback.mismatch_count = 2;
    }),
    "no read-back at all": red((s) => {
      s.readback = null;
    }),
    "a lint refusal": red((s) => {
      s.ok = false;
      s.warnings = ["orientation lint: fixture sentence"];
    }),
    "a run that did not promote its stage": red((s) => {
      s.published = false;
    }),
    "another mode": red((s) => {
      s.mode = "readback";
    }),
    "a refusal before rendering": { ok: false, error: "fixture preflight refusal" },
    "an empty object": {},
  };
  for (const [label, publish] of Object.entries(cases)) {
    const w = await run({ publish });
    if (w.exit === 0) return `${label}: the command exits 0`;
    if (w.nodeCalls.length) return `${label}: ${w.nodeCalls[0].script} ran after the stop`;
  }
  const lint = await run({ publish: cases["a lint refusal"] });
  if (!said(lint).includes("orientation lint: fixture sentence")) return "the stop does not print the refusal";
  return null;
});

await check("the publish asks for a clean publish and writes the response and the census", async () => {
  const absent = notLoaded();
  if (absent) return absent;
  const w = await run({});
  const call = w.serverCalls.find((entry) => entry.name === "materialize_docs");
  if (call?.args?.clean_publish !== true) return `materialize_docs was given ${JSON.stringify(call?.args ?? null)}`;
  const census = JSON.parse(readFileSync(join(w.repo, UNFILLED_REL), "utf8"));
  if (JSON.stringify(Object.keys(census).sort()) !== JSON.stringify(["commit", "unfilled_slots"])) {
    return `${UNFILLED_REL} holds the keys ${Object.keys(census).join(", ")}`;
  }
  if (census.commit !== HEAD) return `${UNFILLED_REL} records commit ${JSON.stringify(census.commit)}`;
  if (JSON.stringify(census.unfilled_slots) !== JSON.stringify(UNFILLED_ROWS)) {
    return `${UNFILLED_REL} records ${JSON.stringify(census.unfilled_slots)}`;
  }
  const promote = w.nodeCalls.find((entry) => entry.script === PROMOTE);
  const summary = JSON.parse(readFileSync(promote.args[promote.args.indexOf("--publish-summary") + 1], "utf8"));
  if (JSON.stringify(summary) !== JSON.stringify(greenPublish())) return "the summary file is not the response";
  return null;
});

await check("a red publish leaves the census where the last green publish left it", async () => {
  const absent = notLoaded();
  if (absent) return absent;
  const w = await run({ unfilledCommit: "e".repeat(40), publish: { ok: false, error: "fixture refusal" } });
  const census = JSON.parse(readFileSync(join(w.repo, UNFILLED_REL), "utf8"));
  return census.commit === "e".repeat(40) ? null : `the census now records ${JSON.stringify(census.commit)}`;
});

await check("a green publish without a census stops the run", async () => {
  const absent = notLoaded();
  if (absent) return absent;
  const publish = greenPublish();
  delete publish.unfilled_slots;
  const w = await run({ publish });
  if (w.exit === 0) return "the command exits 0";
  return ran(w, PROMOTE) ? "promote ran" : null;
});

console.log("the publish summary reaches the dogfood recorder");

await check("promote is given both --publish-summary and --receipt, and the recorder that receipt", async () => {
  const absent = notLoaded();
  if (absent) return absent;
  const w = await run({});
  const promote = w.nodeCalls.find((entry) => entry.script === PROMOTE);
  for (const flag of ["--publish-summary", "--receipt"]) {
    const value = promote?.args?.[promote.args.indexOf(flag) + 1];
    if (!promote?.args?.includes(flag) || !value || value.startsWith("--")) return `promote was not given ${flag}`;
  }
  const dogfood = w.nodeCalls.find((entry) => entry.script === DOGFOOD);
  const given = dogfood?.args?.[dogfood.args.indexOf("--promotion") + 1];
  if (given !== promote.args[promote.args.indexOf("--receipt") + 1]) {
    return `the recorder was given ${JSON.stringify(dogfood?.args ?? null)}`;
  }
  return null;
});

await check("the dogfood recorder is never reached without a publish summary", async () => {
  const absent = notLoaded();
  if (absent) return absent;
  // A promotion that dropped the summary, in one run.
  const dropped = await run({ promoteDropsSummary: true });
  if (dropped.exit === 0) return "a promotion with no summary exits 0";
  if (ran(dropped, DOGFOOD)) return "the recorder ran over a promotion with no summary";
  if (ran(dropped, DEPTH)) return "the chain went on past the refusal";

  // Resumed at promote, with no publish on record.
  const noSummary = await run({ unfilledCommit: HEAD }, ["--from", "promote"]);
  if (noSummary.exit === 0) return "--from promote with no summary exits 0";
  if (ran(noSummary, PROMOTE)) return "promote ran with no summary";
  if (ran(noSummary, DOGFOOD)) return "the recorder ran with no summary";

  // Resumed at the recorder, with no promotion on record.
  const noReceipt = await run({ unfilledCommit: HEAD }, ["--from", "dogfood-receipt"]);
  if (noReceipt.exit === 0) return "--from dogfood-receipt with no receipt exits 0";
  if (ran(noReceipt, DOGFOOD)) return "the recorder ran with no receipt";

  // Resumed at the recorder, over receipts that are present and insufficient.
  for (const [label, promotion] of Object.entries({
    "a null summary": { ok: true, clean_publish: null },
    "another mode": { ok: true, clean_publish: { ...greenPublish(), mode: "readback" } },
    "a red summary": { ok: true, clean_publish: { ...greenPublish(), ok: false } },
    "a red promotion": { ok: false, clean_publish: greenPublish() },
  })) {
    const w = world({ unfilledCommit: HEAD });
    mkdirSync(w.stateDir, { recursive: true });
    const seeded = await seedPromotion(w, promotion);
    if (seeded) return seeded;
    const exit = await chain.main(["--from", "dogfood-receipt"], w.deps);
    if (exit === 0) return `${label}: the command exits 0`;
    if (ran(w, DOGFOOD)) return `${label}: the recorder ran`;
  }
  return null;
});

// The script owns where its receipt lives; a first run shows the path it uses.
async function seedPromotion(w, promotion) {
  const first = await run({});
  const promote = first.nodeCalls.find((entry) => entry.script === PROMOTE);
  const receipt = promote?.args?.[promote.args.indexOf("--receipt") + 1];
  if (!receipt) return "no green run named a receipt path to seed";
  if (!receipt.startsWith(first.stateDir)) return `the receipt path ${receipt} is not under the state directory`;
  const relative = receipt.slice(first.stateDir.length);
  mkdirSync(dirname(join(w.stateDir, relative)), { recursive: true });
  writeFileSync(join(w.stateDir, relative), JSON.stringify(promotion));
  return null;
}

await check("--from promote refuses a publish taken at another commit", async () => {
  const absent = notLoaded();
  if (absent) return absent;
  const first = await run({});
  const promote = first.nodeCalls.find((entry) => entry.script === PROMOTE);
  const summary = promote.args[promote.args.indexOf("--publish-summary") + 1];
  const relative = summary.slice(first.stateDir.length);
  const seed = (w) => {
    mkdirSync(dirname(join(w.stateDir, relative)), { recursive: true });
    writeFileSync(join(w.stateDir, relative), JSON.stringify(greenPublish()));
  };
  const moved = world({ unfilledCommit: "e".repeat(40) });
  seed(moved);
  const exit = await chain.main(["--from", "promote"], moved.deps);
  if (exit === 0) return "the command exits 0";
  if (ran(moved, PROMOTE)) return "promote ran over a publish at another commit";
  const same = world({ unfilledCommit: HEAD });
  seed(same);
  const sameExit = await chain.main(["--from", "promote"], same.deps);
  if (sameExit !== 0) return `a publish at this commit exits ${sameExit}: ${scrub(said(same))}`;
  return ran(same, PROMOTE) ? null : "promote did not run over a publish at this commit";
});

await check("a promotion that adds an untracked page stops the run and names it", async () => {
  const absent = notLoaded();
  if (absent) return absent;
  const w = await run({ docsStatus: " M docs/index.md\0?? docs/brand-new-page.md\0" });
  if (w.exit === 0) return "the command exits 0";
  if (ran(w, DOGFOOD)) return "the recorder ran";
  if (!said(w).includes("docs/brand-new-page.md")) return "the stop does not name the page";
  if (said(w).includes("docs/index.md")) return "the stop names a page that is already tracked";
  return null;
});

await check("each failing recorder stops the run before the next", async () => {
  const absent = notLoaded();
  if (absent) return absent;
  for (const [script, next] of [
    [PROMOTE, DOGFOOD],
    [DOGFOOD, DEPTH],
    [DEPTH, GATES[0]],
  ]) {
    const w = await run({ statuses: { [script]: 1 } });
    if (w.exit === 0) return `${script} failing exits 0`;
    if (ran(w, next)) return `${next} ran after ${script} failed`;
  }
  return null;
});

console.log("the reconcile and the recorders");

await check("no reconcile runs after publish, and no server is spawned after the publish", async () => {
  const absent = notLoaded();
  if (absent) return absent;
  const full = await run({}, ["--measure-label", "x"]);
  const names = full.serverCalls.map((call) => call.name);
  if (names.filter((name) => name === "detect_changes").length !== 1) {
    return `detect_changes ran ${names.filter((name) => name === "detect_changes").length} time(s)`;
  }
  if (names.indexOf("detect_changes") > names.indexOf("materialize_docs")) return "detect_changes followed the publish";
  if (names.at(-1) !== "materialize_docs") return `${names.at(-1)} followed the publish`;
  if (full.log.lastIndexOf("server:spawn") > full.log.indexOf("server:materialize_docs")) {
    return "a server was spawned after the publish";
  }
  const resumed = await run({ unfilledCommit: HEAD }, ["--from", "publish"]);
  if (resumed.serverCalls.some((call) => call.name === "detect_changes")) {
    return "--from publish reconciled";
  }
  if (full.log.indexOf("server:stop") > full.log.indexOf(`node ${PROMOTE}`)) {
    return "the server was still up when promote ran";
  }
  return null;
});

await check("detect_changes is taken at HEAD, after start_session", async () => {
  const absent = notLoaded();
  if (absent) return absent;
  const w = await run({});
  const names = w.serverCalls.map((call) => call.name);
  if (names[0] !== "start_session") return `the first call was ${names[0]}`;
  if (typeof w.serverCalls[0].args?.intent !== "string" || !w.serverCalls[0].args.intent) {
    return "start_session was given no intent";
  }
  const detect = w.serverCalls.find((call) => call.name === "detect_changes");
  return detect?.args?.current_sha === HEAD ? null : `detect_changes was given ${JSON.stringify(detect?.args)}`;
});

await check("the rebuild-* recorders are never invoked", async () => {
  const absent = notLoaded();
  if (absent) return absent;
  const runs = [await run({}, ["--measure-label", "x"]), await run({}, ["--from", "depth-receipt"])];
  for (const w of runs) {
    const rebuild = w.nodeCalls.filter((call) => /rebuild/.test(call.script));
    if (rebuild.length) return `${rebuild[0].script} was invoked`;
    const allowed = new Set([PROMOTE, DOGFOOD, DEPTH, MEASURE, ...GATES]);
    const other = w.nodeCalls.filter((call) => !allowed.has(call.script));
    if (other.length) return `${other[0].script} is not part of the chain`;
  }
  return null;
});

console.log("the verification");

await check("verify runs last, invokes all four gates once each, and passes when all four are green", async () => {
  const absent = notLoaded();
  if (absent) return absent;
  const w = await run({}, ["--measure-label", "x"]);
  if (w.exit !== 0) return `the command exits ${w.exit}`;
  const tail = nodeLog(w).slice(-4);
  if (JSON.stringify(tail) !== JSON.stringify(GATES.map((gate) => `node ${gate}`))) {
    return `the run ended ${tail.join(" > ")}`;
  }
  for (const gate of GATES) {
    if (w.nodeCalls.filter((call) => call.script === gate).length !== 1) return `${gate} did not run exactly once`;
    if (w.printed.filter((line) => line.includes(gate)).length !== 1) return `${gate} does not print one line`;
  }
  return null;
});

await check("any one red gate makes the command exit non-zero, and the other three still run", async () => {
  const absent = notLoaded();
  if (absent) return absent;
  for (const gate of GATES) {
    for (const status of [1, null]) {
      const w = await run({ statuses: { [gate]: status } });
      if (w.exit === 0) return `${gate} at status ${status} exits 0`;
      for (const other of GATES) {
        if (!ran(w, other)) return `${other} did not run when ${gate} was red`;
      }
      const line = w.printed.find((entry) => entry.includes(gate));
      if (!line || !/\bred\b/.test(line)) return `${gate}'s line does not say red: ${JSON.stringify(line ?? null)}`;
      for (const other of GATES.filter((entry) => entry !== gate)) {
        const greenLine = w.printed.find((entry) => entry.includes(other));
        if (!greenLine || !/\bgreen\b/.test(greenLine)) return `${other}'s line does not say green`;
      }
    }
  }
  return null;
});

await check("no child's raw output is echoed", async () => {
  const absent = notLoaded();
  if (absent) return absent;
  const worlds = [
    await run({}, ["--measure-label", "x"]),
    await run({ statuses: { [GATES[1]]: 1 } }),
    await run({ statuses: { [PROMOTE]: 1 } }),
  ];
  return worlds.some((w) => said(w).includes(CHILD_RAW)) ? "a child's stdout or stderr reached the output" : null;
});

console.log("the progress record");

// §4.2's four relations, as dev/test-survey-depth.mjs:1278-1330 checks them.
function relations(progress, receipt) {
  const wrong = [];
  const adjudication = progress?.carried_adjudication ?? {};
  const outcomes = adjudication.outcomes ?? {};
  for (const [key, list] of [
    ["repaired", adjudication.repaired],
    ["successor-finding", adjudication.successors],
  ]) {
    if (!Array.isArray(list)) wrong.push(`${key} has no list`);
    else if (outcomes[key] !== list.length) wrong.push(`${key} is ${outcomes[key]} and ${list.length} are listed`);
  }
  const sum = Object.values(outcomes).reduce((n, v) => n + (Number(v) || 0), 0);
  if (sum !== adjudication.total) wrong.push(`the outcomes sum to ${sum} and the total is ${adjudication.total}`);
  const carried = receipt.blocking.B5.carried.length;
  if (adjudication.total !== carried) wrong.push(`the total is ${adjudication.total} and the receipt has ${carried}`);
  const end = progress?.end ?? {};
  const { examined, obligation_bearing: bearing } = receipt.blocking.B2;
  if (end.examined !== examined) wrong.push(`end.examined is ${end.examined}`);
  if (end.obligation_bearing !== bearing) wrong.push(`end.obligation_bearing is ${end.obligation_bearing}`);
  const fraction = bearing ? Number((examined / bearing).toFixed(4)) : null;
  if (end.fraction !== fraction) wrong.push(`end.fraction is ${end.fraction} and the receipt rounds to ${fraction}`);
  return wrong.length ? wrong.join("; ") : null;
}

const progressAfter = (w) => readFileSync(join(w.repo, PROGRESS_REL), "utf8");
const PROGRESS_ARGV = ["--from", "progress-record"];

await check("the progress step rewrites the derived fields and leaves every other key byte-identical", async () => {
  const absent = notLoaded();
  if (absent) return absent;
  const w = await run({}, PROGRESS_ARGV);
  if (w.exit !== 0) return `the step exits ${w.exit}: ${scrub(said(w))}`;
  const text = progressAfter(w);
  if (text !== PROGRESS_EXPECTED) {
    const before = PROGRESS_EXPECTED.split("\n");
    const after = text.split("\n");
    const line = before.findIndex((entry, index) => entry !== after[index]);
    return `line ${line + 1} is ${JSON.stringify(after[line])} and should be ${JSON.stringify(before[line])}`;
  }
  return relations(JSON.parse(text), RECEIPT_FIXTURE);
});

await check("the progress step's output satisfies the depth gate's four relations on other receipts", async () => {
  const absent = notLoaded();
  if (absent) return absent;
  const noneRepaired = structuredClone(RECEIPT_FIXTURE);
  noneRepaired.blocking.B5.carried = [
    carriedRow("A-1", "archived-terminal"),
    carriedRow("C-1", "successor-finding", { successor_id: "S-7" }),
  ];
  noneRepaired.blocking.B2 = { examined: 1, obligation_bearing: 3 };
  const noneAtAll = structuredClone(RECEIPT_FIXTURE);
  noneAtAll.blocking.B5.carried = [carriedRow("A-1", "archived-terminal")];
  for (const receipt of [noneRepaired, noneAtAll]) {
    const w = await run({ receipt }, PROGRESS_ARGV);
    if (w.exit !== 0) return `the step exits ${w.exit}: ${scrub(said(w))}`;
    const wrong = relations(JSON.parse(progressAfter(w)), receipt);
    if (wrong) return wrong;
  }
  return null;
});

await check("the progress step leaves the committed record's other keys alone, and a second run changes nothing", async () => {
  const absent = notLoaded();
  if (absent) return absent;
  const committed = readFileSync(join(REPO, PROGRESS_REL), "utf8");
  const w = await run({ progress: committed }, PROGRESS_ARGV);
  if (w.exit !== 0) return `the step exits ${w.exit}: ${scrub(said(w))}`;
  const once = progressAfter(w);
  const before = JSON.parse(committed);
  const after = JSON.parse(once);
  const derived = {
    end: new Set(["at_sha", "examined", "obligation_bearing", "fraction"]),
    carried_adjudication: new Set(["total", "decided", "to_decide", "outcomes", "successors", "repaired"]),
  };
  for (const key of Object.keys(before)) {
    if (key in derived) {
      for (const inner of Object.keys(before[key])) {
        if (derived[key].has(inner)) continue;
        if (JSON.stringify(before[key][inner]) !== JSON.stringify(after[key]?.[inner])) return `${key}.${inner} moved`;
      }
    } else if (key !== "derived_fields_rewritten_at" && JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      return `${key} moved`;
    }
  }
  if (after.derived_fields_rewritten_at !== RECEIPT_SHA) {
    return `derived_fields_rewritten_at is ${JSON.stringify(after.derived_fields_rewritten_at)}`;
  }
  const again = await run({ progress: once }, PROGRESS_ARGV);
  return progressAfter(again) === once ? null : "a second run over its own output changed the file";
});

await check("the progress step refuses a record it cannot derive, and leaves the file as it was", async () => {
  const absent = notLoaded();
  if (absent) return absent;
  const mutated = (mutate) => {
    const receipt = structuredClone(RECEIPT_FIXTURE);
    mutate(receipt);
    return receipt;
  };
  const cases = {
    "an undecided carried record": mutated((r) => {
      r.blocking.B5.carried.push(carriedRow("U-1", null));
    }),
    "a successor outcome with no successor id": mutated((r) => {
      r.blocking.B5.carried.push(carriedRow("U-2", "successor-finding"));
    }),
    "a repaired outcome with no commit": mutated((r) => {
      r.blocking.B5.carried.push(carriedRow("U-3", "repaired"));
    }),
    "no carried table": mutated((r) => {
      delete r.blocking.B5;
    }),
    "no coverage": mutated((r) => {
      delete r.blocking.B2;
    }),
    "no reconciliation": mutated((r) => {
      r.blocking.B1.witness = null;
    }),
  };
  for (const [label, receipt] of Object.entries(cases)) {
    const w = await run({ receipt }, PROGRESS_ARGV);
    if (w.exit === 0) return `${label}: the step exits 0`;
    if (progressAfter(w) !== PROGRESS_FIXTURE) return `${label}: the file changed`;
    if (ran(w, GATES[0])) return `${label}: the chain went on to verify`;
  }
  const named = await run({ receipt: cases["an undecided carried record"] }, PROGRESS_ARGV);
  if (!said(named).includes("U-1")) return "the stop does not name the undecided record";
  const successor = await run({ receipt: cases["a successor outcome with no successor id"] }, PROGRESS_ARGV);
  if (!said(successor).includes("U-2")) return "the stop does not name the record with no successor id";
  return null;
});

await check("the real depth recorder supplies what the progress step reads", async () => {
  const absent = notLoaded();
  if (absent) return absent;
  const root = mkdtempSync(join(tmpdir(), "ex7-recorder-"));
  roots.push(root);
  for (const rel of [
    "dev/record-survey-depth.mjs",
    "dev/survey-depth-baseline.json",
    "mcp-server/contracts/conspectus-vocabulary.json",
  ]) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    cpSync(join(REPO, rel), join(root, rel));
  }
  const git = (...args) =>
    spawnSync("git", ["-c", "user.name=ex7", "-c", "user.email=ex7@example.invalid", ...args], {
      cwd: root,
      encoding: "utf8",
    });
  git("init", "-q");
  git("add", "dev/record-survey-depth.mjs");
  git("commit", "-q", "-m", "fixture");
  const head = git("rev-parse", "HEAD").stdout.trim();
  const tracked = git("ls-tree", "-r", "--name-only", "-z", head).stdout.split("\0").filter(Boolean);
  const digest = (parts) => createHash("sha256").update([...parts].sort().join("\0")).digest("hex");

  const { DatabaseSync } = await import("node:sqlite");
  mkdirSync(join(root, ".amanuensis"), { recursive: true });
  const db = new DatabaseSync(join(root, ".amanuensis/memory.db"));
  db.exec(readFileSync(join(REPO, "mcp-server/src/schema.sql"), "utf8"));
  db.exec("PRAGMA foreign_keys=OFF");
  db.prepare(
    "INSERT INTO git_state (canonical_branch, last_checked_sha, onboarding_sha) VALUES ('main', ?, ?)",
  ).run(head, head);
  db.prepare(
    `INSERT INTO scope_reconciliations
       (detected_sha, tree_digest, ledger_digest, tracked_paths, ledger_rows, unledgered, absent, exempt)
     VALUES (?, ?, ?, ?, 0, ?, 0, 0)`,
  ).run(head, digest(tracked), digest([]), tracked.length, tracked.length);
  const carry = db.prepare(
    `INSERT INTO carried_findings
       (carried_id, archived_finding_id, archived_store_id, archived_anchor_sha, subsystem_id,
        severity, symptom, root_cause, carry_run_id, archived_resolution)
     VALUES (?, ?, 'store-a', ?, 'B-01', 'LOW', 's', 'r', 1, 'open')`,
  );
  const outcome = db.prepare(
    `INSERT INTO carried_finding_outcomes
       (carried_id, outcome, successor_id, repaired_sha, rationale, session_id, ref_sha)
     VALUES (?, ?, ?, ?, 'r', 's', ?)`,
  );
  carry.run(1, "F-1", head);
  outcome.run(1, "successor-finding", "F-1-SUCCESSOR", null, head);
  carry.run(2, "F-2", head);
  outcome.run(2, "repaired", null, head, head);
  db.close();

  const receiptPath = join(root, DEPTH_REL);
  mkdirSync(dirname(receiptPath), { recursive: true });
  const recorded = spawnSync(process.execPath, ["dev/record-survey-depth.mjs"], { cwd: root, encoding: "utf8" });
  if (recorded.status !== 0) return `the recorder exits ${recorded.status}: ${scrub(recorded.stderr)}`;
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  const row = (receipt.blocking?.B5?.carried ?? []).find((entry) => entry.archived_finding_id === "F-1");
  if (row?.successor_id !== "F-1-SUCCESSOR") {
    return `the receipt's B5 row carries successor_id ${JSON.stringify(row?.successor_id ?? null)}`;
  }
  const w = await run({ receipt }, PROGRESS_ARGV);
  if (w.exit !== 0) return `the step over the real receipt exits ${w.exit}: ${scrub(said(w))}`;
  const progress = JSON.parse(progressAfter(w));
  const wrong = relations(progress, receipt);
  if (wrong) return wrong;
  if (progress.end.at_sha !== head) return `end.at_sha is ${progress.end.at_sha}, not the reconciled ${head}`;
  if (JSON.stringify(progress.carried_adjudication.successors) !== JSON.stringify(["F-1-SUCCESSOR"])) {
    return `the successors are ${JSON.stringify(progress.carried_adjudication.successors)}`;
  }
  if (JSON.stringify(progress.carried_adjudication.repaired) !== JSON.stringify([`F-2 at ${head.slice(0, 7)}`])) {
    return `the repaired list is ${JSON.stringify(progress.carried_adjudication.repaired)}`;
  }
  return null;
});

console.log("what the packet commits");

await check(`${UNFILLED_REL} exists, is tracked, and holds a commit and a census`, () => {
  const path = join(REPO, UNFILLED_REL);
  if (!existsSync(path)) return "the file is absent";
  const tracked = spawnSync("git", ["ls-files", "--error-unmatch", UNFILLED_REL], { cwd: REPO, encoding: "utf8" });
  if (tracked.status !== 0) return "the file is not tracked";
  const census = JSON.parse(readFileSync(path, "utf8"));
  if (JSON.stringify(Object.keys(census).sort()) !== JSON.stringify(["commit", "unfilled_slots"])) {
    return `the file holds the keys ${Object.keys(census).join(", ")}`;
  }
  // This packet commits a null; a later republish commits the revision it published.
  if (census.commit !== null && !/^[0-9a-f]{40}$/.test(String(census.commit))) {
    return `the commit is ${JSON.stringify(census.commit)}`;
  }
  return Array.isArray(census.unfilled_slots) ? null : "unfilled_slots is not a list";
});

await check("the gate is listed in the workflow beside its neighbours", () => {
  let text = "";
  try {
    text = readFileSync(join(REPO, WORKFLOW_REL), "utf8");
  } catch {
    return `${WORKFLOW_REL} is not readable`;
  }
  const start = text.indexOf("\n  roadmap:");
  const end = text.indexOf("\n  pecia-defects:", start);
  const job = start >= 0 && end > start ? text.slice(start, end) : "";
  if (!job.includes("run: node dev/test-reader-measure.mjs")) return "the neighbouring gate is not in the roadmap job";
  return job.includes("run: node dev/test-republish-chain.mjs") ? null : "the roadmap job does not run this gate";
});

cleanRoots();

if (failures.length) {
  console.log(`GATE EX7 RED: ${failures[0]}`);
  process.exit(1);
}
console.log("GATE EX7 GREEN");
