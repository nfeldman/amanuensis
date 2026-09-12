#!/usr/bin/env node
// Gate for reader-lenses packet P15 — consumer routing (spec.md §5.4, §5.5,
// §9.3, §9.4, §13, §13.1–§13.3; claims C25, C46, C47, C55, C63, C64).
//
// Turns red when:
//   - the advertised annotations for `describe_locus` are not
//     `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`,
//     `openWorldHint: false`, or `get_attention`/`get_history` are not
//     read-only, or the read-only carve-out has been widened until a write
//     tool such as `add_finding` or `set_disposition` also advertises
//     `readOnlyHint: true`;
//   - the `instructions` the server returns at `initialize` do not name
//     `describe_locus` in their first sentence, name it after
//     `get_project_info`, drop the producer route, drop `get_attention` or
//     `get_history`, drop the standing caution that `unledgered` and
//     `scoped-unread` are said rather than improvised over, or grow past the
//     ceiling below;
//   - the generated tool inventory is out of date, disagrees with the surface
//     the running server advertises, does not carry the three reader-lens
//     tools as a `locus` group, or does not report the baseline count plus
//     three;
//   - `SKILL.md`'s routing table carries no consumer row, or carries one that
//     is not placed directly after the "what have you noticed" row, does not
//     route to `describe_locus` first, does not say standing comes before the
//     account, does not name the three standings that stop the answer, or does
//     not point at `references/notes.md`; or the skill description has not
//     been widened past subsystems to files, symbols, and terms;
//   - the four-way vocabulary check is not green on the tree as committed, or
//     no longer reads `SKILL.md`'s kind ladder independently — proved by
//     mutating the ladder in a scratch copy and requiring a red that names
//     `SKILL.md`;
//   - `references/notes.md` does not fix the answer shape: standing first in
//     one line with state, disagreeing owners, authority ceiling and checked
//     revision; then the account led by the most consequential open item in
//     the recorded precedence; then what is not known, never omitted; or it
//     stops saying that it runs no survey;
//   - the installer does not offer the agent-instructions paragraph, writes it
//     when it was not asked for, leaves an existing agent-instructions file
//     changed when it was not asked for, writes under `--dry-run`, does not
//     write the paragraph when it is asked for, writes it to a file that does
//     not match the client, or appends it a second time on a rerun;
//   - the gate does not run in `.github/workflows/test.yml`;
//   - `design/reader-lenses/routing-measurement.md` does not record §13.2's
//     protocol: 20 enumerated file questions, two named arms, two runs per arm,
//     tool-call counts reported per question, no pooling across arms, and a
//     null result reported as a null result.
//
// False greens it cannot exclude. Reachability is not behaviour: every
// assertion here is static — an annotation, a string the server returns, a row
// in a table, a file the installer did or did not write. None of them shows
// that an agent given these instructions actually reaches `describe_locus` in
// one call, and §13.1 says so: that is a claim about a model, it needs two arms
// and two runs per arm (VP5, VP10), and it is specified in §13.2 as a
// measurement that gates nothing. The assertions below about
// `routing-measurement.md` read its *protocol* only — the question set, the
// arms, the run count, the reporting rule. No assertion here reads its result,
// so a null result stays green, which is what §13.2 requires.
// The inventory arithmetic reads its total from `gen-tool-inventory.mjs`
// rather than from a literal, and identifies the three added tools by name, so
// it cannot exclude a fourth tool added and documented in the same commit —
// only one that is added, or removed, without the generated block following.
//
// Output protocol: exactly one status line, last, on stdout. Every message is
// scrubbed of the launcher's crash signatures, so an absent deliverable reads
// as a failed assertion rather than as a gate that never ran.
import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MCP = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(MCP, "..");

const SKILL_REL = ".claude/skills/amanuensis/SKILL.md";
const NOTES_REL = ".claude/skills/amanuensis/references/notes.md";
const SOURCE_REL = "mcp-server/contracts/conspectus-vocabulary.json";
const TS_REL = "mcp-server/src/vocabulary.ts";
const PY_REL = "materializer/amanuensis_materializer/vocabulary.py";
const FOURWAY_REL = "mcp-server/scripts/check-evidence-vocabulary.mjs";
const INVENTORY_REL = "mcp-server/DEVELOPMENT.md";
const GEN_INVENTORY_REL = "mcp-server/scripts/gen-tool-inventory.mjs";
const CLI_REL = "mcp-server/dist/cli.js";
const SERVER_REL = "mcp-server/dist/index.js";
const CI_REL = ".github/workflows/test.yml";
const MEASUREMENT_REL = "design/reader-lenses/routing-measurement.md";

// §5's three reader-lens tools, written out rather than read from the source
// so that deleting one from `allTools` cannot also delete what this gate
// expects to find.
const LOCUS_TOOLS = ["describe_locus", "get_attention", "get_history"];
// The count of them is the "plus three" of §5's arithmetic. The baseline it is
// added to is never written down here: it is the inventory's own total, as
// reported by `gen-tool-inventory.mjs`, less these three.
const ADDED_TOOL_COUNT = LOCUS_TOOLS.length;
// Tools whose handlers write. Named here so a widened read-only carve-out is
// caught by something other than the rule that widened it.
const WRITE_TOOLS = ["add_finding", "set_disposition", "add_evidence"];
// Decision 5: the server instructions ride in every session's context, so they
// are held to a stated ceiling rather than left to grow. §5.4's text is ~900
// bytes; this leaves room for wording without leaving room for a second
// method document.
const INSTRUCTIONS_CEILING = 1500;

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
  [/SyntaxError/g, "syntax-error"],
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
async function check(label, fn) {
  let reason = null;
  try {
    reason = await fn();
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

const scratchDirs = [];
function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

function runNode(args, cwd) {
  const r = spawnSync(process.execPath, args, { cwd, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

// ---------------------------------------------------------------------------
// The deliverables are compiled before they are read: a sabotaged `src/` must
// not be certified by a stale `dist/`. ensure-built.mjs is loaded defensively
// so that its absence is an assertion failure rather than a crash.
// ---------------------------------------------------------------------------
let build = { ok: false, detail: "the build helper could not be loaded" };
try {
  const mod = await import("./scripts/ensure-built.mjs");
  build = mod.ensureBuilt();
} catch (e) {
  build = { ok: false, detail: `the build helper could not be loaded — ${e?.message ?? e}` };
}

// ---------------------------------------------------------------------------
// The advertised surface, read over the real stdio protocol rather than by
// importing the module: annotations and instructions are what a host receives,
// not what a constant says.
// ---------------------------------------------------------------------------
async function probeServer() {
  if (!build.ok) return { ok: false, detail: build.detail };
  const entry = join(REPO, SERVER_REL);
  if (!existsSync(entry)) return { ok: false, detail: `${SERVER_REL} was not produced by the build` };
  const root = scratch("p15-probe-");
  const workspace = join(root, "workspace");
  const storage = join(root, "storage");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(storage, { recursive: true });
  const server = spawn(process.execPath, [entry, "--workspace", workspace, "--allow-workspace-pin"], {
    env: { ...process.env, AMANUENSIS_STORAGE_ROOT: storage, AMANUENSIS_AUTOPROGRESS: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  let stderr = "";
  let nextId = 1;
  const pending = new Map();
  server.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  server.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        let message = null;
        try {
          message = JSON.parse(line);
        } catch {
          message = null;
        }
        const waiter = message ? pending.get(message.id) : null;
        if (waiter) {
          pending.delete(message.id);
          if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
          else waiter.resolve(message.result);
        }
      }
      newline = buffer.indexOf("\n");
    }
  });
  const request = (method, params = {}) => {
    const id = nextId++;
    const response = new Promise((resolveFn, rejectFn) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectFn(new Error(`timed out waiting for ${method}; stderr=${stderr}`));
      }, 30_000);
      pending.set(id, {
        resolve(value) {
          clearTimeout(timer);
          resolveFn(value);
        },
        reject(error) {
          clearTimeout(timer);
          rejectFn(error);
        },
      });
    });
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return response;
  };
  try {
    const initialized = await request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "amanuensis-consumer-route-gate", version: "1" },
    });
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    const listed = await request("tools/list");
    return {
      ok: true,
      instructions: typeof initialized?.instructions === "string" ? initialized.instructions : null,
      tools: Array.isArray(listed?.tools) ? listed.tools : [],
    };
  } catch (e) {
    return { ok: false, detail: `the server did not answer the handshake — ${e?.message ?? e}` };
  } finally {
    server.stdin.end();
    server.kill();
  }
}

const surface = await probeServer();

// ---------------------------------------------------------------------------
// §5.4 — the server instructions
// ---------------------------------------------------------------------------
function firstSentence(text) {
  const match = String(text).match(/^[\s\S]*?[.!?](?=\s|$)/);
  return match ? match[0] : String(text);
}

await check("the server returns instructions at initialize", () => {
  if (!surface.ok) return surface.detail;
  if (!surface.instructions) return "the initialize result carries no instructions string";
  return null;
});

await check("the instructions name describe_locus in their first sentence", () => {
  if (!surface.instructions) return "there are no instructions to read";
  const opening = firstSentence(surface.instructions);
  if (!opening.includes("describe_locus"))
    return `SERVER_INSTRUCTIONS opens with the producer route: "${opening.slice(0, 120)}"`;
  return null;
});

await check("the instructions keep the producer route after the consumer route", () => {
  if (!surface.instructions) return "there are no instructions to read";
  const text = surface.instructions;
  const consumer = text.indexOf("describe_locus");
  const producer = text.indexOf("get_project_info");
  if (producer < 0) return "SERVER_INSTRUCTIONS no longer names get_project_info for producers";
  if (consumer > producer) return "SERVER_INSTRUCTIONS names get_project_info before describe_locus";
  for (const name of ["get_attention", "get_history", "get_dashboard", "list_subsystems"])
    if (!text.includes(name)) return `SERVER_INSTRUCTIONS no longer names ${name}`;
  return null;
});

await check("the instructions carry the standing caution and stay within their ceiling", () => {
  if (!surface.instructions) return "there are no instructions to read";
  const text = surface.instructions;
  if (!/standing/i.test(text)) return "SERVER_INSTRUCTIONS never mentions standing";
  for (const state of ["unledgered", "scoped-unread"])
    if (!text.includes(state)) return `SERVER_INSTRUCTIONS does not name the ${state} standing`;
  if (!/improvis/i.test(text))
    return "SERVER_INSTRUCTIONS does not say to say so rather than read the file and improvise";
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > INSTRUCTIONS_CEILING)
    return `SERVER_INSTRUCTIONS is ${bytes} bytes, past the ${INSTRUCTIONS_CEILING}-byte ceiling`;
  return null;
});

// ---------------------------------------------------------------------------
// §5.1 — annotations
// ---------------------------------------------------------------------------
await check("describe_locus advertises the four read-only annotations", () => {
  if (!surface.ok) return surface.detail;
  const tool = surface.tools.find((t) => t.name === "describe_locus");
  if (!tool) return "describe_locus is not advertised at all";
  const a = tool.annotations ?? {};
  const want = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
  const wrong = Object.entries(want)
    .filter(([key, value]) => a[key] !== value)
    .map(([key, value]) => `${key} is ${JSON.stringify(a[key])}, not ${JSON.stringify(value)}`);
  return wrong.length ? wrong.join("; ") : null;
});

await check("get_attention and get_history are advertised read-only too", () => {
  if (!surface.ok) return surface.detail;
  const bad = [];
  for (const name of ["get_attention", "get_history"]) {
    const tool = surface.tools.find((t) => t.name === name);
    if (!tool) {
      bad.push(`${name} is not advertised`);
      continue;
    }
    if (tool.annotations?.readOnlyHint !== true) bad.push(`${name} does not advertise readOnlyHint`);
  }
  return bad.length ? bad.join("; ") : null;
});

await check("the read-only carve-out did not widen to cover write tools", () => {
  if (!surface.ok) return surface.detail;
  const bad = [];
  for (const name of WRITE_TOOLS) {
    const tool = surface.tools.find((t) => t.name === name);
    if (!tool) {
      bad.push(`${name} is not advertised, so the carve-out cannot be tested against it`);
      continue;
    }
    if (tool.annotations?.readOnlyHint === true) bad.push(`${name} advertises readOnlyHint: true`);
  }
  return bad.length ? bad.join("; ") : null;
});

// ---------------------------------------------------------------------------
// §5.5 — the generated inventory
// ---------------------------------------------------------------------------
function parseInventory(text) {
  const start = text.indexOf("<!-- TOOL-INVENTORY-START -->");
  const end = text.indexOf("<!-- TOOL-INVENTORY-END -->");
  if (start < 0 || end < 0 || end < start) return null;
  const block = text.slice(start, end);
  const total = block.match(/_(\d+) tools across (\d+) groups\./);
  const groups = new Map();
  for (const section of block.split(/^### /m).slice(1)) {
    const heading = section.match(/^`([^`]+)` \((\d+)\)/);
    if (!heading) continue;
    const names = [...section.matchAll(/^\| `([a-z0-9_]+)` \|/gm)].map((m) => m[1]);
    groups.set(heading[1], { declared: Number(heading[2]), names });
  }
  return {
    total: total ? Number(total[1]) : null,
    groupCount: total ? Number(total[2]) : null,
    groups,
  };
}

const inventoryText = readText(join(REPO, INVENTORY_REL));
const inventory = inventoryText === null ? null : parseInventory(inventoryText);

// The reported total is read from the generator, never from a literal in this
// file: `--check` prints "tool inventory block up to date (N tools)".
let generatorTotal = null;
let generatorDetail = null;
if (!existsSync(join(REPO, GEN_INVENTORY_REL))) {
  generatorDetail = `${GEN_INVENTORY_REL} is absent`;
} else if (!build.ok) {
  generatorDetail = build.detail;
} else {
  const r = runNode([join(REPO, GEN_INVENTORY_REL), "--check"], MCP);
  const reported = r.out.match(/\((\d+) tools\)/);
  if (r.status !== 0)
    generatorDetail = `the generated inventory is out of date: ${r.out.trim().split("\n").slice(-1)[0]}`;
  else if (!reported) generatorDetail = "the generator did not report a tool count";
  else generatorTotal = Number(reported[1]);
}

await check("the generated inventory is current and reports its own total", () => {
  if (generatorDetail) return generatorDetail;
  if (generatorTotal === null) return "no tool count was obtained from the generator";
  return null;
});

await check("the inventory carries the three reader-lens tools as one locus group", () => {
  if (inventory === null) return `${INVENTORY_REL} carries no generated inventory block`;
  const group = inventory.groups.get("locus");
  if (!group) return "the generated inventory has no locus group";
  const missing = LOCUS_TOOLS.filter((name) => !group.names.includes(name));
  if (missing.length) return `the locus group omits ${missing.join(", ")}`;
  const extra = group.names.filter((name) => !LOCUS_TOOLS.includes(name));
  if (extra.length) return `the locus group carries ${extra.join(", ")} as well`;
  if (group.declared !== group.names.length)
    return `the locus heading declares ${group.declared} tools and lists ${group.names.length}`;
  return null;
});

await check("the inventory total is the baseline plus three", () => {
  if (inventory === null) return `${INVENTORY_REL} carries no generated inventory block`;
  if (generatorTotal === null) return generatorDetail ?? "no tool count was obtained";
  const listed = [...inventory.groups.values()].flatMap((g) => g.names);
  if (listed.length !== generatorTotal)
    return `the generator reports ${generatorTotal} tools and the block lists ${listed.length}`;
  const baseline = listed.filter((name) => !LOCUS_TOOLS.includes(name)).length;
  if (generatorTotal !== baseline + ADDED_TOOL_COUNT)
    return `the inventory reports ${generatorTotal} tools; the baseline of ${baseline} plus ${ADDED_TOOL_COUNT} is ${baseline + ADDED_TOOL_COUNT}`;
  return null;
});

await check("the inventory and the advertised surface are the same set of tools", () => {
  if (!surface.ok) return surface.detail;
  if (inventory === null) return `${INVENTORY_REL} carries no generated inventory block`;
  const advertised = new Set(surface.tools.map((t) => t.name));
  const listed = new Set([...inventory.groups.values()].flatMap((g) => g.names));
  const undocumented = [...advertised].filter((name) => !listed.has(name));
  const unadvertised = [...listed].filter((name) => !advertised.has(name));
  if (undocumented.length) return `advertised but not in the inventory: ${undocumented.join(", ")}`;
  if (unadvertised.length) return `in the inventory but not advertised: ${unadvertised.join(", ")}`;
  return null;
});

// ---------------------------------------------------------------------------
// §9.3 — the skill routing row
// ---------------------------------------------------------------------------
const skillText = readText(join(REPO, SKILL_REL));

function routingRows(text) {
  const header = text.indexOf("| User says");
  if (header < 0) return null;
  const rest = text.slice(header).split("\n");
  const rows = [];
  for (const line of rest.slice(2)) {
    if (!line.startsWith("|")) break;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    rows.push(cells);
  }
  return rows;
}

await check("SKILL.md carries the consumer routing row, directly after the notes row", () => {
  if (skillText === null) return `${SKILL_REL} is absent`;
  const rows = routingRows(skillText);
  if (!rows || rows.length === 0) return "the routing table could not be read";
  const notesIndex = rows.findIndex((cells) => /what have you noticed/i.test(cells[0] ?? ""));
  if (notesIndex < 0) return "the 'what have you noticed' row is gone";
  const consumerIndex = rows.findIndex((cells) => /what do we know about/i.test(cells[0] ?? ""));
  if (consumerIndex < 0) return "no routing row carries the consumer trigger phrases";
  if (consumerIndex !== notesIndex + 1)
    return `the consumer row is at position ${consumerIndex}, not directly after the notes row at ${notesIndex}`;
  const says = rows[consumerIndex][0] ?? "";
  const missing = ["before I change", "is there a finding on this file", "what is"].filter(
    (phrase) => !says.includes(phrase),
  );
  if (missing.length) return `the consumer row omits the trigger phrase(s): ${missing.join("; ")}`;
  return null;
});

await check("the consumer row routes to describe_locus first, standing before account", () => {
  if (skillText === null) return `${SKILL_REL} is absent`;
  const rows = routingRows(skillText) ?? [];
  const row = rows.find((cells) => /what do we know about/i.test(cells[0] ?? ""));
  if (!row) return "no routing row carries the consumer trigger phrases";
  const action = row[1] ?? "";
  if (!action.includes("describe_locus")) return "the consumer row does not name describe_locus";
  const standing = action.search(/standing/i);
  const account = action.search(/account/i);
  if (standing < 0 || account < 0) return "the consumer row does not order standing before the account";
  if (standing > account) return "the consumer row puts the account before standing";
  const missing = ["unledgered", "excluded", "scoped-unread"].filter(
    (state) => !action.includes(state),
  );
  if (missing.length) return `the consumer row does not stop on ${missing.join(", ")}`;
  if (!/survey/i.test(action)) return "the consumer row does not offer a survey when standing stops it";
  if (!action.includes("notes.md")) return "the consumer row does not point at references/notes.md";
  return null;
});

await check("the skill description reaches past subsystems to files, symbols, and terms", () => {
  if (skillText === null) return `${SKILL_REL} is absent`;
  const front = skillText.match(/^---\n([\s\S]*?)\n---/);
  if (!front) return "SKILL.md carries no front matter";
  const description = front[1];
  if (!/what do we know about/i.test(description))
    return "the description no longer carries the 'what do we know about' trigger";
  const missing = ["file", "symbol", "term"].filter((word) => !new RegExp(word, "i").test(description));
  if (missing.length) return `the description does not widen to ${missing.join(", ")}`;
  return null;
});

// ---------------------------------------------------------------------------
// §10.2 — the rewritten vocabulary check still reads SKILL.md independently
// ---------------------------------------------------------------------------
await check("the four-way vocabulary check is green on the tree as committed", () => {
  if (!existsSync(join(REPO, FOURWAY_REL))) return `${FOURWAY_REL} is absent`;
  const r = runNode([join(REPO, FOURWAY_REL)], REPO);
  return r.status === 0 ? null : `it reports a divergence: ${r.out.trim().split("\n").slice(-1)[0]}`;
});

await check("mutating SKILL.md's kind ladder still turns the vocabulary check red", () => {
  if (!existsSync(join(REPO, FOURWAY_REL))) return `${FOURWAY_REL} is absent`;
  const dir = scratch("p15-vocab-");
  for (const rel of [SOURCE_REL, TS_REL, PY_REL, SKILL_REL, FOURWAY_REL]) {
    const from = join(REPO, rel);
    if (!existsSync(from)) return `${rel} is absent`;
    const to = join(dir, rel);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to);
  }
  const path = join(dir, SKILL_REL);
  const text = readText(path);
  if (text === null) return "the scratch copy of the skill could not be read";
  const mutated = text.replace(/`pattern-matched`\)/, "`pattern-matchd`)");
  if (mutated === text) return "the kind ladder could not be located in SKILL.md";
  writeFileSync(path, mutated);
  const r = runNode([join(dir, FOURWAY_REL)], dir);
  if (r.status === 0) return "the vocabulary check stayed green with the ladder mutated";
  if (!r.out.includes("SKILL.md")) return "it turned red without naming SKILL.md";
  return null;
});

// ---------------------------------------------------------------------------
// §9.4 — the answer shape in references/notes.md
// ---------------------------------------------------------------------------
const notesText = readText(join(REPO, NOTES_REL));
// notes.md is hard-wrapped at sixty columns, so every phrase below is matched
// against a whitespace-collapsed reading of it. Collapsing changes which line a
// phrase sits on and nothing else: the words, and the order they appear in, are
// still what is asserted.
const notesFlat = notesText === null ? null : notesText.replace(/\s+/g, " ");

await check("notes.md fixes the standing-first answer shape", () => {
  if (notesFlat === null) return `${NOTES_REL} is absent`;
  if (!notesFlat.includes("describe_locus")) return "notes.md never names describe_locus";
  const standing = notesFlat.search(/standing[^.]{0,40}one line/i);
  if (standing < 0) return "notes.md does not put standing first, in one line";
  const head = notesFlat.slice(standing, standing + 600);
  const missing = [
    [/authority ceiling/i, "the authority ceiling"],
    [/owners?/i, "the owners when they disagree"],
    [/checked/i, "the checked revision"],
  ]
    .filter(([pattern]) => !pattern.test(head))
    .map(([, what]) => what);
  if (missing.length) return `the standing line does not carry ${missing.join(", ")}`;
  return null;
});

await check("notes.md leads the account with the most consequential open item", () => {
  if (notesFlat === null) return `${NOTES_REL} is absent`;
  const precedence =
    /open finding[^.]*severity[^.]*awaiting[ -]verification[^.]*undiscriminated[^.]*decision[^.]*lead/is;
  if (!precedence.test(notesFlat))
    return "notes.md does not record the open-finding → awaiting-verification → undiscriminated → decision → lead precedence";
  return null;
});

await check("notes.md keeps what is not known, never omitted, and runs no survey", () => {
  if (notesFlat === null) return `${NOTES_REL} is absent`;
  const notKnown = notesFlat.search(/not known/i);
  if (notKnown < 0) return "notes.md does not carry a 'what is not known' step";
  if (!/never omitted/i.test(notesFlat.slice(notKnown, notKnown + 500)))
    return "notes.md does not say the unknown list is never omitted";
  if (!/`?unknown`?/i.test(notesFlat.slice(notKnown, notKnown + 500)))
    return "notes.md does not name the unknown list as the source";
  const standing = notesFlat.search(/standing[^.]{0,40}one line/i);
  const account = notesFlat.search(/the account/i);
  if (standing < 0 || account < 0 || !(standing < account && account < notKnown))
    return "notes.md does not order standing, then the account, then what is not known";
  if (!notesFlat.includes("You do not run survey passes here"))
    return "notes.md dropped the limit that it runs no survey passes";
  return null;
});

// ---------------------------------------------------------------------------
// The installer's opt-in agent-instructions paragraph
// ---------------------------------------------------------------------------
function runCli(args) {
  const cli = join(REPO, CLI_REL);
  if (!existsSync(cli)) return { status: null, out: `${CLI_REL} was not produced by the build` };
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const AGENT_FILES = { claude: "CLAUDE.md", codex: "AGENTS.md" };

function installArgs(client, workspace, extra = []) {
  const scope = client === "codex" ? ["--scope", "project"] : [];
  return ["init", "--client", client, "--dir", workspace, ...scope, ...extra];
}

await check("the installer offers the paragraph and writes nothing when it is declined", () => {
  if (!build.ok) return build.detail;
  const bad = [];
  for (const [client, filename] of Object.entries(AGENT_FILES)) {
    const workspace = scratch(`p15-install-${client}-`);
    const target = join(workspace, filename);
    const r = runCli(installArgs(client, workspace));
    if (r.status !== 0) {
      bad.push(`${client}: the installer exited ${r.status}: ${r.out.trim().slice(0, 160)}`);
      continue;
    }
    if (existsSync(target)) bad.push(`${client}: ${filename} was written without being asked for`);
    if (!r.out.includes("--agent-instructions"))
      bad.push(`${client}: the installer never offers --agent-instructions`);
    if (!r.out.includes(filename)) bad.push(`${client}: the offer does not name ${filename}`);
    if (!r.out.includes("describe_locus"))
      bad.push(`${client}: the offer does not say what the paragraph would ask for`);
    if (!/not written/i.test(r.out)) bad.push(`${client}: the offer does not say nothing was written`);
  }
  return bad.length ? bad.join("; ") : null;
});

await check("a declined install leaves an existing agent-instructions file byte-identical", () => {
  if (!build.ok) return build.detail;
  const workspace = scratch("p15-install-existing-");
  const target = join(workspace, "CLAUDE.md");
  const before = "# Project rules\n\nRun the tests before pushing.\n";
  writeFileSync(target, before);
  const r = runCli(installArgs("claude", workspace));
  if (r.status !== 0) return `the installer exited ${r.status}: ${r.out.trim().slice(0, 160)}`;
  const after = readText(target);
  if (after !== before) return "CLAUDE.md was modified by an install that did not ask for it";
  return null;
});

await check("the opt-in writes the paragraph to the file the client reads", () => {
  if (!build.ok) return build.detail;
  const bad = [];
  for (const [client, filename] of Object.entries(AGENT_FILES)) {
    const workspace = scratch(`p15-optin-${client}-`);
    const r = runCli(installArgs(client, workspace, ["--agent-instructions"]));
    if (r.status !== 0) {
      bad.push(`${client}: the installer exited ${r.status}: ${r.out.trim().slice(0, 160)}`);
      continue;
    }
    const text = readText(join(workspace, filename));
    if (text === null) {
      bad.push(`${client}: ${filename} was not written although the paragraph was asked for`);
      continue;
    }
    if (!text.includes("describe_locus"))
      bad.push(`${client}: the paragraph does not route to describe_locus`);
    if (!/before (you )?edit/i.test(text))
      bad.push(`${client}: the paragraph does not say when to call it`);
    const other = client === "claude" ? "AGENTS.md" : "CLAUDE.md";
    if (existsSync(join(workspace, other)))
      bad.push(`${client}: the paragraph was also written to ${other}`);
  }
  return bad.length ? bad.join("; ") : null;
});

await check("the opt-in appends to an existing file once, and only once", () => {
  if (!build.ok) return build.detail;
  const workspace = scratch("p15-optin-append-");
  const target = join(workspace, "CLAUDE.md");
  const before = "# Project rules\n\nRun the tests before pushing.\n";
  writeFileSync(target, before);
  const first = runCli(installArgs("claude", workspace, ["--agent-instructions"]));
  if (first.status !== 0) return `the first install exited ${first.status}`;
  const afterFirst = readText(target) ?? "";
  if (!afterFirst.startsWith(before)) return "the existing instructions were not preserved";
  if (!afterFirst.includes("describe_locus")) return "the paragraph was not appended";
  const second = runCli(installArgs("claude", workspace, ["--agent-instructions"]));
  if (second.status !== 0) return `the second install exited ${second.status}`;
  const afterSecond = readText(target) ?? "";
  const occurrences = afterSecond.split("describe_locus").length - 1;
  const firstOccurrences = afterFirst.split("describe_locus").length - 1;
  if (afterSecond !== afterFirst)
    return `a rerun changed the file again (describe_locus appears ${occurrences} times, was ${firstOccurrences})`;
  return null;
});

await check("--dry-run writes no agent instructions even when the paragraph is asked for", () => {
  if (!build.ok) return build.detail;
  const workspace = scratch("p15-optin-dry-");
  const r = runCli(installArgs("claude", workspace, ["--agent-instructions", "--dry-run"]));
  if (r.status !== 0) return `the installer exited ${r.status}: ${r.out.trim().slice(0, 160)}`;
  if (existsSync(join(workspace, "CLAUDE.md"))) return "CLAUDE.md was written under --dry-run";
  if (!r.out.includes("CLAUDE.md")) return "the dry run does not report the planned write";
  return null;
});

// ---------------------------------------------------------------------------
// §13.3 — the gate runs in CI
// ---------------------------------------------------------------------------
await check("the gate runs in CI", () => {
  const ci = readText(join(REPO, CI_REL));
  if (ci === null) return `${CI_REL} is absent`;
  return ci.includes("node test-consumer-route.mjs") ? null : "the gate is not run in CI";
});

// ---------------------------------------------------------------------------
// §13.2 — the routing measurement's protocol, never its result
// ---------------------------------------------------------------------------
await check("routing-measurement.md records the protocol §13.2 fixes", () => {
  const text = readText(join(REPO, MEASUREMENT_REL));
  if (text === null) return `${MEASUREMENT_REL} is absent`;
  const questions = [...text.matchAll(/^\|\s*Q(\d{1,2})\s*\|/gm)].map((m) => Number(m[1]));
  const unique = new Set(questions);
  if (unique.size !== 20)
    return `it enumerates ${unique.size} file questions, not the 20 the protocol fixes`;
  const bad = [];
  if (!/two arms|arm A[\s\S]{0,400}arm B/i.test(text)) bad.push("it does not name two arms");
  if (!/without the `?describe_locus`? route|no consumer route|unaided/i.test(text))
    bad.push("it does not describe the arm without the describe_locus route");
  if (!/2 runs per arm|two runs per arm/i.test(text)) bad.push("it does not fix two runs per arm");
  if (!/per question/i.test(text)) bad.push("it does not report tool-call counts per question");
  if (!/never pooled|not pooled|no pooling/i.test(text)) bad.push("it does not forbid pooling across arms");
  if (!/gates nothing|blocks no packet|is not a gate/i.test(text))
    bad.push("it does not say the measurement gates nothing");
  if (!/null result/i.test(text)) bad.push("it does not say a null result is reported as a null result");
  return bad.length ? bad.join("; ") : null;
});

// ---------------------------------------------------------------------------
for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });

if (failures.length) {
  emit(
    `GATE P15 RED: the consumer route is not wired — SERVER_INSTRUCTIONS, readOnlyHint, inventory, skill routing, notes, and the installer opt-in carry ${failures.length} failed assertion(s); first: ${failures[0]}`,
  );
  process.exit(1);
}
emit("GATE P15 GREEN");
