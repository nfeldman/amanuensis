#!/usr/bin/env node
// The republish chain as one command (design/explanation/spec.md §4.2; claim C14).
//
// `docs/`, the dogfood receipt, the depth receipt and the progress record bind to
// each other and to the store, and until now the chain that keeps them bound was
// run by hand (`git show 19c8442`). Run out of order or stopped halfway, it leaves
// a receipt that describes a store which has since moved. So the order lives here,
// as ten named steps:
//
//    1. preflight        the server is built from this tree, the store opens, and
//                        nothing is uncommitted outside docs/ and the receipt files
//    2. reconcile        start_session, then detect_changes at HEAD; stop on any
//                        unledgered path
//    3. freshness        stop if an owner of a dogfood locus is not `examined`
//    4. publish          materialize_docs(clean_publish=true); stop on a red
//                        read-back or a lint refusal
//    5. promote          dev/promote-docs.mjs with --publish-summary and --receipt
//    6. dogfood-receipt  dev/record-dogfood-receipt.mjs over that promotion
//    7. depth-receipt    dev/record-survey-depth.mjs
//    8. progress-record  rewrite the derived fields of survey-progress.json
//    9. measure          with --measure-label, dev/measure-reader-prose.mjs
//   10. verify           the four receipt-bound gates; non-zero if any is red
//
// What the script will not do, each for a reason a later gate would otherwise pay for:
//
//   - It never assigns an unledgered path. A subsystem and a classification are a
//     survey judgement, so it prints the paths and stops; the session makes the
//     `add_files_to_scope` calls and reruns it.
//   - It never clears staleness. Re-examining a locus means reading the file at HEAD,
//     which only the session can do.
//   - It never calls detect_changes after step 4. A reconciliation after the publish
//     moves `last_checked_sha` past what the dogfood receipt records. The server is
//     stopped when step 4 ends, so no later step holds a way to do it.
//   - It adds no tracked path after step 2, since a new one is a path the depth
//     receipt has not inventoried. Its own working files therefore live in the
//     system's temporary directory, and a promotion that adds a page stops the run.
//   - It does not run any rebuild recorder (§4.1).
//
//   node dev/republish-docs.mjs [--measure-label <label>] [--from <step>]
//   node dev/republish-docs.mjs --plan
//
// Exit status is 0 only when every step ran and all four gates are green. A child's
// output is not echoed; a stop says what stopped it and what the session does next.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const DOGFOOD_RECEIPT = "design/reader-lenses/dogfood-receipt.json";
const DEPTH_RECEIPT = "design/survey-depth/acceptance-receipt.json";
const PROGRESS_RECORD = "design/survey-depth/survey-progress.json";
const UNFILLED_SLOTS = "design/explanation/unfilled-slots.json";
const READER_MEASURE = "design/explanation/reader-measure.json";

// Every tracked file a later step writes. Step 2 inventories the tree, so each has
// to exist and be tracked by then, and these are the only changes preflight allows
// outside docs/.
const RECEIPT_FILES = [DOGFOOD_RECEIPT, DEPTH_RECEIPT, PROGRESS_RECORD, UNFILLED_SLOTS, READER_MEASURE];

const PUBLISH_SUMMARY_NAME = "clean-publish.json";
const PROMOTION_RECEIPT_NAME = "promotion.json";

const READBACK_AXES = ["state", "coverage", "content"];
// `dev/test-reader-lenses-dogfood.mjs` accepts these for a file's standing.
const EXAMINED_STATES = ["examined", "mixed"];

// spec.md §0.3.
const RECEIPT_GATES = [
  { id: "P18", script: "dev/test-reader-lenses-dogfood.mjs" },
  { id: "P10 / D0", script: "dev/test-survey-depth.mjs" },
  { id: "P11 / A1", script: "dev/test-survey-depth-acceptance.mjs" },
  { id: "carried references", script: "dev/test-carried-finding-references.mjs" },
];

/** A step's refusal: the run stops here, and these lines say why. */
export class ChainStop extends Error {
  constructor(...lines) {
    super(lines[0]);
    this.lines = lines;
  }
}

const stop = (...lines) => {
  throw new ChainStop(...lines);
};

function repoPath(ctx, rel) {
  return join(ctx.deps.repo, rel);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function headSha(ctx) {
  const run = ctx.deps.git(["rev-parse", "HEAD"]);
  const sha = String(run.stdout ?? "").trim();
  if (run.status !== 0 || !sha) stop("this checkout has no HEAD to publish at");
  return sha;
}

/** `git status --porcelain -z`, as the paths each entry touches. */
function statusEntries(output) {
  const fields = String(output ?? "").split("\0").filter(Boolean);
  const entries = [];
  for (let index = 0; index < fields.length; index += 1) {
    const code = fields[index].slice(0, 2);
    const paths = [fields[index].slice(3)];
    // A rename or a copy carries its source as the next NUL-separated field.
    if (code.includes("R") || code.includes("C")) {
      index += 1;
      paths.push(fields[index]);
    }
    entries.push({ code, paths });
  }
  return entries;
}

/** The one server the steps before the publish share, spawned on first use. */
async function serverFor(ctx) {
  if (!ctx.server) {
    ctx.server = await ctx.deps.spawnServer();
    await ctx.server.call("start_session", { intent: "republish docs" });
  }
  return ctx.server;
}

async function stopServer(ctx) {
  if (!ctx.server) return;
  const server = ctx.server;
  ctx.server = null;
  await server.stop();
}

function publishProblems(summary) {
  const problems = [];
  if (summary?.ok !== true) problems.push("it did not report ok");
  if (summary?.mode !== "clean-publish") {
    problems.push(`it ran in mode ${JSON.stringify(summary?.mode ?? null)}`);
  }
  if (summary?.published !== true) problems.push("it did not promote its staging directory");
  const readback = summary?.readback;
  if (readback?.ok !== true) problems.push("its read-back is not green");
  for (const axis of READBACK_AXES) {
    if (readback?.axes?.[axis]?.ok !== true) problems.push(`its ${axis} axis is red`);
  }
  if (Number(readback?.mismatch_count ?? 0) !== 0) {
    problems.push(`its read-back records ${readback.mismatch_count} mismatch(es)`);
  }
  return problems;
}

function runRecorder(ctx, step, script, args = []) {
  const run = ctx.deps.runNode(script, args);
  if (run.status !== 0) {
    stop(`${script} exited ${run.status}. Run it directly to read its output, then resume with --from ${step}.`);
  }
  return run;
}

// ---------------------------------------------------------------------------
// The progress record (step 8)
// ---------------------------------------------------------------------------

/** The fields §4.2 step 8 names, from the depth receipt. Refuses what it cannot derive. */
export function derivedProgressFields(receipt) {
  const rows = receipt?.blocking?.B5?.carried;
  if (!Array.isArray(rows)) stop(`${DEPTH_RECEIPT} carries no blocking.B5.carried table.`);
  const coverage = receipt?.blocking?.B2;
  if (!Number.isInteger(coverage?.examined) || !Number.isInteger(coverage?.obligation_bearing)) {
    stop(`${DEPTH_RECEIPT} carries no blocking.B2 examined and obligation-bearing counts.`);
  }
  const atSha = receipt?.blocking?.B1?.witness?.detected_sha;
  if (typeof atSha !== "string" || !atSha) {
    stop(`${DEPTH_RECEIPT} records no reconciliation in blocking.B1.witness.`);
  }
  if (typeof receipt?.repository_sha !== "string" || !receipt.repository_sha) {
    stop(`${DEPTH_RECEIPT} records no repository_sha.`);
  }

  const name = (row) => String(row?.archived_finding_id ?? row?.carried_id);
  const undecided = rows.filter((row) => !row?.outcome).map(name);
  if (undecided.length) {
    stop(
      `${undecided.length} carried record(s) have no outcome, so the outcomes cannot sum to the total: ${undecided.join(", ")}.`,
      "Decide them with record_carried_outcome and rerun the script (spec.md §4.3).",
    );
  }
  const noSuccessor = rows
    .filter((row) => row.outcome === "successor-finding" && !row.successor_id)
    .map(name);
  if (noSuccessor.length) {
    stop(`These successor outcomes name no successor in ${DEPTH_RECEIPT}: ${noSuccessor.join(", ")}.`);
  }
  const noRepair = rows.filter((row) => row.outcome === "repaired" && !row.repaired_sha).map(name);
  if (noRepair.length) {
    stop(`These repaired outcomes name no commit in ${DEPTH_RECEIPT}: ${noRepair.join(", ")}.`);
  }

  // `repaired` and `successor-finding` are always present, zero included: the depth
  // gate compares each with its list's length and reads an absent key as a mismatch.
  const outcomes = { repaired: 0, "successor-finding": 0 };
  for (const row of rows) outcomes[row.outcome] = (outcomes[row.outcome] ?? 0) + 1;
  const { examined, obligation_bearing: obligationBearing } = coverage;
  return {
    end: {
      at_sha: atSha,
      examined,
      obligation_bearing: obligationBearing,
      fraction: obligationBearing ? Number((examined / obligationBearing).toFixed(4)) : null,
    },
    carried_adjudication: {
      total: rows.length,
      decided: rows.length,
      // The records the carry did not settle by itself. Not "still undecided": an
      // undecided record stops the step above, so that would always read nought.
      to_decide: rows.filter((row) => row.outcome !== "archived-terminal").length,
      outcomes: Object.fromEntries(Object.entries(outcomes).sort(([a], [b]) => (a < b ? -1 : 1))),
      successors: rows.filter((row) => row.outcome === "successor-finding").map((row) => row.successor_id),
      repaired: rows
        .filter((row) => row.outcome === "repaired")
        .map((row) => `${name(row)} at ${row.repaired_sha.slice(0, 7)}`),
    },
    derived_fields_rewritten_at: receipt.repository_sha,
  };
}

function skipSpace(text, start) {
  let index = start;
  while (/\s/.test(text[index] ?? "")) index += 1;
  return index;
}

function stringEnd(text, start) {
  let index = start + 1;
  while (text[index] !== '"') index += text[index] === "\\" ? 2 : 1;
  return index + 1;
}

function valueEnd(text, start) {
  const first = text[start];
  if (first === '"') return stringEnd(text, start);
  if (first !== "{" && first !== "[") {
    let index = start;
    while (index < text.length && !/[\s,}\]]/.test(text[index])) index += 1;
    return index;
  }
  let depth = 0;
  let index = start;
  while (index < text.length) {
    const character = text[index];
    if (character === '"') {
      index = stringEnd(text, index);
      continue;
    }
    if (character === "{" || character === "[") depth += 1;
    if (character === "}" || character === "]") depth -= 1;
    index += 1;
    if (depth === 0) return index;
  }
  return index;
}

/** The byte spans of an object's members, over text already known to parse. */
function memberSpans(text, objectStart) {
  const members = new Map();
  let index = skipSpace(text, objectStart + 1);
  let lastEnd = objectStart + 1;
  while (text[index] !== "}") {
    const keyEnd = stringEnd(text, index);
    const key = JSON.parse(text.slice(index, keyEnd));
    const start = skipSpace(text, skipSpace(text, keyEnd) + 1);
    const end = valueEnd(text, start);
    members.set(key, { start, end });
    lastEnd = end;
    index = skipSpace(text, end);
    if (text[index] === ",") index = skipSpace(text, index + 1);
  }
  return { members, lastEnd };
}

const renderAt = (value, indent) =>
  JSON.stringify(value, null, 2).replaceAll("\n", `\n${" ".repeat(indent)}`);

/**
 * Rewrite the derived fields in place, by span, so that every other key keeps the
 * bytes it has. A parse and re-render would normalize what the file's history wrote.
 */
export function rewriteProgress(text, receipt) {
  const fields = derivedProgressFields(receipt);
  JSON.parse(text);
  const top = memberSpans(text, skipSpace(text, 0));
  const edits = [];
  const set = (scope, key, value, indent) => {
    const member = scope.members.get(key);
    if (member) {
      edits.push({ start: member.start, end: member.end, text: renderAt(value, indent) });
      return;
    }
    const separator = scope.members.size ? "," : "";
    const rendered = `${separator}\n${" ".repeat(indent)}${JSON.stringify(key)}: ${renderAt(value, indent)}`;
    edits.push({ start: scope.lastEnd, end: scope.lastEnd, text: rendered });
    scope.members.set(key, { start: scope.lastEnd, end: scope.lastEnd });
  };
  for (const section of ["end", "carried_adjudication"]) {
    const member = top.members.get(section);
    if (!member || text[member.start] !== "{") {
      stop(`${PROGRESS_RECORD} has no ${section} object to rewrite.`);
    }
    const scope = memberSpans(text, member.start);
    for (const [key, value] of Object.entries(fields[section])) set(scope, key, value, 4);
  }
  set(top, "derived_fields_rewritten_at", fields.derived_fields_rewritten_at, 2);
  // Applied last to first, so an earlier edit's offsets are still good. A sort is
  // stable, so insertions at one offset are reversed once to keep their order.
  let rewritten = text;
  for (const edit of edits.reverse().sort((a, b) => b.start - a.start)) {
    rewritten = rewritten.slice(0, edit.start) + edit.text + rewritten.slice(edit.end);
  }
  return rewritten;
}

// ---------------------------------------------------------------------------
// The steps
// ---------------------------------------------------------------------------
const STEP_FUNCTIONS = {
  async preflight(ctx) {
    const build = await ctx.deps.buildServer();
    if (build.status !== 0) {
      stop(`npm run build in mcp-server exited ${build.status}, so the server is not built from this tree.`);
    }
    const storeProblem = await ctx.deps.storeProblem();
    if (storeProblem) stop(`The store does not open: ${storeProblem}`);

    const status = ctx.deps.git(["status", "--porcelain", "-z", "--untracked-files=all"]);
    if (status.status !== 0) stop("git status failed, so the worktree's state is unknown.");
    const allowed = (path) => path.startsWith("docs/") || RECEIPT_FILES.includes(path);
    const outside = statusEntries(status.stdout)
      .flatMap((entry) => entry.paths)
      .filter((path) => !allowed(path));
    if (outside.length) {
      stop(
        "These changes are uncommitted and are outside docs/ and the receipt files:",
        ...outside.map((path) => `  ${path}`),
        "Commit them first: a receipt binds to HEAD, and these would not be in it.",
      );
    }

    const tracked = ctx.deps.git(["ls-files", "-z", "--", ...RECEIPT_FILES]);
    const present = new Set(String(tracked.stdout ?? "").split("\0").filter(Boolean));
    const untracked = RECEIPT_FILES.filter((path) => !present.has(path));
    if (untracked.length) {
      stop(
        "A later step writes these files and they are not tracked, so the reconciliation would not inventory them:",
        ...untracked.map((path) => `  ${path}`),
      );
    }
  },

  async reconcile(ctx) {
    const server = await serverFor(ctx);
    const result = await server.call("detect_changes", { current_sha: headSha(ctx) });
    if (result?.ok === false) stop(`detect_changes refused: ${result.error ?? "no reason given"}`);
    const unledgered = result?.unledgered_paths;
    const absent = result?.absent_ledger_paths;
    if (!Array.isArray(unledgered) || !Array.isArray(absent)) {
      stop("detect_changes returned no path lists, which is not the same as no paths.");
    }
    if (unledgered.length) {
      stop(
        `${unledgered.length} tracked path(s) are unledgered:`,
        ...unledgered.map((path) => `  ${path}`),
        "Assign each to a subsystem and a classification with add_files_to_scope, then rerun this script.",
      );
    }
    if (absent.length) {
      // materialize_docs refuses this too. Stopping here names the paths.
      stop(
        `${absent.length} ledger row(s) name a path the tree no longer carries:`,
        ...absent.map((row) => `  ${row.file_path} (${row.subsystem_id})`),
        "Resolve each in the ledger, then rerun this script.",
      );
    }
  },

  async freshness(ctx) {
    let loci = null;
    try {
      loci = readJson(repoPath(ctx, DOGFOOD_RECEIPT)).loci;
    } catch {
      stop(`${DOGFOOD_RECEIPT} could not be read, so the dogfood loci are unknown.`);
    }
    const paths = Array.isArray(loci) ? loci.map((entry) => entry?.locus).filter(Boolean) : [];
    if (!paths.length) stop(`${DOGFOOD_RECEIPT} names no locus, so there is nothing to check freshness against.`);

    const server = await serverFor(ctx);
    const short = [];
    for (const path of paths) {
      const response = await server.call("describe_locus", { locus: path, kind: "file" });
      const standing = response?.standing;
      const owners = Array.isArray(standing?.owners) ? standing.owners : [];
      if (!standing) {
        short.push(`  ${path}: describe_locus returned no standing`);
        continue;
      }
      if (!owners.length) short.push(`  ${path}: no ledger owner`);
      else if (!EXAMINED_STATES.includes(standing.state)) {
        short.push(`  ${path}: stands as ${standing.state}`);
      }
      for (const owner of owners) {
        if (owner?.standing_state !== "examined" || owner?.classification !== "examined") {
          short.push(
            `  ${path}: owner ${owner?.subsystem_id} stands as ${owner?.standing_state} and is classified ${owner?.classification}`,
          );
        }
      }
    }
    if (short.length) {
      stop(
        "The dogfood gate requires every owner of these loci to stand as examined:",
        ...short,
        "Read each file at HEAD, record the examination at HEAD through the ledger tool, and rerun this script.",
        "Staleness is never cleared on a file that has not been read.",
      );
    }
  },

  async publish(ctx) {
    const server = await serverFor(ctx);
    const summary = await server.call("materialize_docs", { clean_publish: true });
    await stopServer(ctx);

    mkdirSync(ctx.deps.stateDir, { recursive: true });
    writeFileSync(ctx.summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    const problems = publishProblems(summary);
    if (problems.length) {
      const said = [summary?.error, ...(Array.isArray(summary?.warnings) ? summary.warnings : [])]
        .filter(Boolean)
        .map((line) => `  ${String(line).split("\n")[0]}`);
      stop(`The publish is not green: ${problems.join("; ")}.`, ...said, `The response is at ${ctx.summaryPath}.`);
    }
    if (!Array.isArray(summary.unfilled_slots)) {
      stop("The publish returned no unfilled_slots, so the census cannot be recorded.");
    }
    writeFileSync(
      repoPath(ctx, UNFILLED_SLOTS),
      `${JSON.stringify({ commit: headSha(ctx), unfilled_slots: summary.unfilled_slots }, null, 2)}\n`,
    );
  },

  async promote(ctx) {
    // A resumed run may be reading what an earlier run left behind.
    if (!existsSync(ctx.summaryPath)) {
      stop("No publish summary is on record, so a promotion could not carry one. Resume with --from publish.");
    }
    const problems = publishProblems(readJson(ctx.summaryPath));
    if (problems.length) {
      stop(`The publish on record is not green: ${problems.join("; ")}. Resume with --from publish.`);
    }
    const head = headSha(ctx);
    const census = readJson(repoPath(ctx, UNFILLED_SLOTS));
    if (census?.commit !== head) {
      stop(`The publish on record was taken at ${census?.commit} and HEAD is ${head}. Rerun from reconcile.`);
    }

    runRecorder(ctx, "promote", "dev/promote-docs.mjs", [
      "--publish-summary",
      ctx.summaryPath,
      "--receipt",
      ctx.promotionPath,
    ]);

    const status = ctx.deps.git(["status", "--porcelain", "-z", "--untracked-files=all", "--", "docs"]);
    const added = statusEntries(status.stdout)
      .filter((entry) => entry.code === "??")
      .flatMap((entry) => entry.paths);
    if (added.length) {
      stop(
        "The promotion added pages the reconciliation did not inventory:",
        ...added.map((path) => `  ${path}`),
        "Ledger and commit them, then rerun this script from the start.",
      );
    }
  },

  async "dogfood-receipt"(ctx) {
    let promotion = null;
    try {
      promotion = readJson(ctx.promotionPath);
    } catch {
      stop("No promotion receipt is on record. Resume with --from promote.");
    }
    if (promotion?.ok !== true) stop("The promotion receipt is not green. Resume with --from promote.");
    // The dogfood gate reads the publish mode from this block. A receipt written
    // without it records a null mode, and that gate turns red over a real publish.
    const problems = publishProblems(promotion.clean_publish);
    if (problems.length) {
      stop(
        `The promotion receipt carries no green publish summary: ${problems.join("; ")}.`,
        "The dogfood receipt is not recorded over it. Resume with --from promote.",
      );
    }
    runRecorder(ctx, "dogfood-receipt", "dev/record-dogfood-receipt.mjs", ["--promotion", ctx.promotionPath]);
  },

  async "depth-receipt"(ctx) {
    runRecorder(ctx, "depth-receipt", "dev/record-survey-depth.mjs");
  },

  async "progress-record"(ctx) {
    const receipt = readJson(repoPath(ctx, DEPTH_RECEIPT));
    const path = repoPath(ctx, PROGRESS_RECORD);
    writeFileSync(path, rewriteProgress(readFileSync(path, "utf8"), receipt));
  },

  async measure(ctx) {
    if (ctx.measureLabel === null) return "skipped: no --measure-label";
    runRecorder(ctx, "measure", "dev/measure-reader-prose.mjs", ["docs", "--record", ctx.measureLabel]);
    return null;
  },

  async verify(ctx) {
    const red = [];
    for (const gate of RECEIPT_GATES) {
      const run = ctx.deps.runNode(gate.script);
      const green = run.status === 0;
      if (!green) red.push(gate.id);
      ctx.deps.print(`  ${green ? "green" : `red (exit ${run.status})`}  ${gate.id}: node ${gate.script}`);
    }
    if (red.length) stop(`${red.length} of ${RECEIPT_GATES.length} receipt gates are red: ${red.join(", ")}.`);
  },
};

export const STEP_NAMES = Object.keys(STEP_FUNCTIONS);

const STEP_SUMMARIES = {
  preflight: "the server is built from this tree, the store opens, nothing is uncommitted outside docs/ and the receipt files",
  reconcile: "start_session, then detect_changes at HEAD; stop on an unledgered path",
  freshness: "stop if an owner of a dogfood locus is not examined",
  publish: "materialize_docs(clean_publish=true); stop on a red read-back or a lint refusal",
  promote: "dev/promote-docs.mjs with --publish-summary and --receipt",
  "dogfood-receipt": "dev/record-dogfood-receipt.mjs --promotion <receipt>",
  "depth-receipt": "dev/record-survey-depth.mjs",
  "progress-record": "rewrite the derived fields of survey-progress.json from the depth receipt",
  measure: "with --measure-label, dev/measure-reader-prose.mjs docs --record <label>",
  verify: "the four receipt-bound gates; non-zero if any is red",
};

// ---------------------------------------------------------------------------
// The real subprocesses. The gate replaces every one of these.
// ---------------------------------------------------------------------------
function serverClient(repo) {
  const entry = join(repo, "mcp-server", "dist", "index.js");
  const child = spawn(process.execPath, [entry, "--workspace", repo, "--allow-workspace-pin"], {
    cwd: repo,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  let stderr = "";
  let nextId = 1;
  const pending = new Map();
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  child.on("exit", () => {
    for (const [id, waiter] of pending) {
      pending.delete(id);
      waiter.reject(new Error(`the server exited; stderr=${stderr.slice(-400)}`));
    }
  });
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        const message = JSON.parse(line);
        const waiter = pending.get(message.id);
        if (waiter) {
          pending.delete(message.id);
          if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
          else waiter.resolve(message.result);
        }
      }
      newline = buffer.indexOf("\n");
    }
  });
  // A clean publish renders every page, so this is far longer than the recorder's.
  const TIMEOUT_MS = 600_000;
  const request = (method, params = {}) => {
    const id = nextId++;
    const response = new Promise((res, rej) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rej(new Error(`timed out waiting for ${method}; stderr=${stderr.slice(-400)}`));
      }, TIMEOUT_MS);
      pending.set(id, {
        resolve(value) {
          clearTimeout(timer);
          res(value);
        },
        reject(error) {
          clearTimeout(timer);
          rej(error);
        },
      });
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return response;
  };
  return {
    async handshake() {
      await request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "republish-docs", version: "1" },
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    },
    async call(name, args = {}) {
      const result = await request("tools/call", { name, arguments: args });
      if (result.isError === true) {
        throw new Error(`${name} returned an error: ${result.content?.[0]?.text ?? "(no text)"}`);
      }
      return JSON.parse(result.content?.[0]?.text ?? "null");
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      await new Promise((res) => child.once("exit", res));
    },
  };
}

export function defaultDeps(repo = REPO) {
  const git = (args) => spawnSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  // Outside the tree, so no later step adds a path to it, and one per worktree, so
  // that --from resumes this checkout's run. If the system clears it, promote stops
  // and says to resume from the publish.
  const worktreeKey = createHash("sha256").update(repo).digest("hex").slice(0, 16);
  return {
    repo,
    stateDir: join(tmpdir(), `amanuensis-republish-${worktreeKey}`),
    print: (line) => process.stdout.write(`${line}\n`),
    git,
    buildServer: () =>
      spawnSync("npm", ["run", "build"], {
        cwd: join(repo, "mcp-server"),
        stdio: "ignore",
      }),
    async storeProblem() {
      const path = join(repo, ".amanuensis", "memory.db");
      if (!existsSync(path)) return `no store at ${path}`;
      try {
        const { DatabaseSync } = await import("node:sqlite");
        const db = new DatabaseSync(path, { readOnly: true });
        db.prepare("SELECT last_checked_sha FROM git_state").all();
        db.close();
        return null;
      } catch (error) {
        return String(error?.message ?? error);
      }
    },
    async spawnServer() {
      const server = serverClient(repo);
      await server.handshake();
      return server;
    },
    runNode: (script, args = []) =>
      spawnSync(process.execPath, [join(repo, script), ...args], {
        cwd: repo,
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
      }),
  };
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const options = { plan: false, from: null, measureLabel: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) throw new ChainStop(`${flag} needs a value.`);
      index += 1;
      return next;
    };
    if (flag === "--plan") options.plan = true;
    else if (flag === "--from") options.from = value();
    else if (flag === "--measure-label") options.measureLabel = value();
    else throw new ChainStop(`Unknown argument ${flag}.`);
  }
  if (options.from !== null && !STEP_NAMES.includes(options.from)) {
    throw new ChainStop(`--from names no step: ${options.from}. The steps are ${STEP_NAMES.join(", ")}.`);
  }
  return options;
}

/** Run the chain. Returns the exit status; every subprocess comes through `deps`. */
export async function main(argv, deps) {
  const print = deps?.print ?? ((line) => process.stdout.write(`${line}\n`));
  let options = null;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (!(error instanceof ChainStop)) throw error;
    print(`republish refused: ${error.message}`);
    return 2;
  }
  if (options.plan) {
    STEP_NAMES.forEach((name, index) => {
      print(`${String(index + 1).padStart(2)}. ${name}: ${STEP_SUMMARIES[name]}`);
    });
    return 0;
  }

  const resolved = deps ?? defaultDeps();
  const ctx = {
    deps: resolved,
    measureLabel: options.measureLabel,
    server: null,
    summaryPath: join(resolved.stateDir, PUBLISH_SUMMARY_NAME),
    promotionPath: join(resolved.stateDir, PROMOTION_RECEIPT_NAME),
  };
  const steps = { ...STEP_FUNCTIONS, ...(resolved.steps ?? {}) };
  const first = options.from === null ? 0 : STEP_NAMES.indexOf(options.from);

  let current = null;
  try {
    for (const name of STEP_NAMES.slice(first)) {
      current = name;
      print(`${name}`);
      const note = await steps[name](ctx);
      if (typeof note === "string") print(`  ${note}`);
    }
  } catch (error) {
    if (error instanceof ChainStop) {
      print(`republish stopped at ${current}:`);
      for (const line of error.lines) print(line);
    } else {
      print(`republish failed at ${current}: ${error?.message ?? error}`);
    }
    return 1;
  } finally {
    await stopServer(ctx);
  }
  print("republish complete: all four receipt gates are green. Commit docs/ and the receipts in one commit.");
  return 0;
}

const invoked = process.argv[1] ? realpathSync(process.argv[1]) : null;
if (invoked && fileURLToPath(import.meta.url) === invoked) {
  process.exitCode = await main(process.argv.slice(2), undefined);
}
