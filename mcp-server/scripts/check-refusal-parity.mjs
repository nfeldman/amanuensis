#!/usr/bin/env node
// Skill/server refusal parity (design/survey-depth/spec.md §6.2, GATE RP1 §8.7).
//
// The survey skill's references are prose that instructs tool calls. When the
// server starts refusing one of those calls, the reference that still teaches
// it is wrong, and nothing notices: prose drifts silently and a reader follows
// it into a refusal nobody warned them about. `references/phase-1-scope.md:58`
// is the recorded instance — it instructs
// `define_term(term, gloss, expansion, subsystem_id, first_seen, ref_sha)`, a
// call this lane makes the server refuse when the anchor does not resolve, and
// §6.1's eight-entry register did not name it.
//
// **What this buys, exactly.** It is string identity over a hand-maintained
// register: it catches a reference edited out of agreement with the server, and
// it cannot tell whether either side is *right*. A refusal nobody registers
// drifts freely. That limit is why the check is cheap — the register is the
// artifact under review, not a model's judgment of similarity — and §8.7 states
// it rather than leaving a reader to infer it.
//
// **The third assertion narrows that limit rather than pretending past it.** A
// register compared only against itself cannot report what nobody wrote down,
// so the candidate set is *generated*: every refusal message the server's own
// source carries is compared against the register, and every one no entry
// covers is reported. The derivation is lexical, and its scope is stated:
//
//   * three openings — `cannot advance`, `<subject> refuses:`,
//     `<subject> requires` — because those are the three sentence forms this
//     server's refusals take; and
//   * for the latter two, `<subject>` must be an interpolation or a tool the
//     server advertises, because a refusal names the operation it refuses.
//     `learning requires an ended agent session` is a validation message about
//     a noun, not an operation refusing, and claiming it would fill the report
//     with entries no skill reference could ever be expected to carry; and
//   * the message must be thrown or returned, not collected into another
//     call's arguments. `blockers.push(`${mode} requires allowed_write_prefixes`)`
//     opens like a refusal and is one note among several a preflight gathers.
//
// A refusal phrased outside those forms is invisible here. That converts the
// failure mode from *silent* to *narrower*, which is the honest claim.
//
// The fourth assertion runs the same comparison from the other side: a skill
// reference that names a tool whose handler throws a registered refusal, and
// carries no registered phrase for it, is instructing a call it does not warn
// about. That is what finds `phase-1-scope.md`.
//
// **The fifth holds the register to its own association.** An entry names the
// tools it concerns in two roles — `refuses`, the tools the server states the
// sentence at, and `instructs`, the tools a reference calling them must warn
// about without throwing it — and each name is checked against the source: the
// tool's handler, whatever that handler calls or names, and the tool's own
// definition. One field used to hold both roles and nothing compared it to a
// call site, so `active-session-required` named `start_session` — the repair,
// whose handler starts a session — while every tool that throws it was absent
// (slice-S3 review, F3/codex). `refuses` must be true of every tool it names;
// it is not required to name every one, and the derived scan above is what
// covers a sentence no entry carries at all.
//
// Usage:
//   node scripts/check-refusal-parity.mjs            # this repository
//   node scripts/check-refusal-parity.mjs --json     # the same, machine-readable
//   node scripts/check-refusal-parity.mjs --root DIR # a tree laid out like it
//
// `--root` exists for GATE RP1, which sabotages a fixture tree one edit at a
// time. A gate that could only run over the committed register could assert
// nothing before that register existed, and would assert only its presence
// afterwards.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const rootAt = argv.indexOf("--root");
const REPO =
  rootAt === -1
    ? resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
    : resolve(argv[rootAt + 1] ?? ".");
const ROOT = join(REPO, "mcp-server");
const REGISTER = join(ROOT, "contracts", "refusal-parity.json");
const SKILL_DIR = join(REPO, ".claude", "skills", "amanuensis");

/** One finding: what drifted, and which side lost it. */
const findings = [];
function report(id, side, message) {
  findings.push({ id, side, message });
}

function read(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
function show(path) {
  const r = relative(REPO, path);
  return r.startsWith("..") ? path : r;
}

// ---- the register ---------------------------------------------------------

const registerText = read(REGISTER);
let register = null;
if (registerText === null) {
  report("(register)", "register", `${show(REGISTER)} could not be read`);
} else {
  try {
    register = JSON.parse(registerText);
  } catch (error) {
    report("(register)", "register", `${show(REGISTER)} is not parseable JSON: ${error.message}`);
  }
}

const entries = Array.isArray(register?.refusals) ? register.refusals : [];
if (register && entries.length === 0) {
  report(
    "(register)",
    "register",
    `${show(REGISTER)} carries no refusals. An empty register asserts nothing: every refusal the ` +
      "server throws would be unregistered and every reference free to drift.",
  );
}

// ---- the tools the server advertises --------------------------------------

/**
 * Tool names, read as text from `src/tools/*.ts`.
 *
 * Read rather than imported, for `check-evidence-vocabulary.mjs`'s reason:
 * following the import would compare one array with itself. This is the set a
 * refusal's subject is checked against and the set the reference-side scan
 * searches the skill for.
 *
 * **A `name:` alone is not a tool.** These modules also build response sections
 * shaped `{ name, source_rows, items }`, and reading the bare key advertised
 * eleven of them — `hot_spots`, `leads`, `stale` and eight more — so the
 * register could bind a refusal to a field no caller can invoke and the
 * advertisement test stayed green (slice-S3 review, F2/codex). A tool is the
 * object that publishes a `description` and an `inputSchema` after its name,
 * which is the pair `gen-tool-inventory.mjs:44` reads for the same reason and
 * the pair that reconciles against a live `tools/list`. The counts agree: 209.
 */
const TOOL_DEFINITION = /^\s+name:\s*"([a-z][a-z0-9_]*)",\n\s+description:[\s\S]{0,8000}?\n\s+inputSchema:/gm;

/** The `{ … }` starting at `from`, or the first one after it, brace-matched. */
function braced(text, from) {
  const open = text.indexOf("{", from);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return text.slice(open);
}

/** The object literal whose first key is at `at`. */
function enclosingObject(text, at) {
  let i = at - 1;
  while (i >= 0 && /\s/.test(text[i])) i--;
  return braced(text, text[i] === "{" ? i : at);
}

/**
 * name → { file, definition, handler }, one row per advertised tool.
 *
 * `definition` is what the tool says about itself before its handler — the
 * description and the input schema. `handler` is what it does. Assertion 5
 * reads both: a refusal is usually thrown from the handler, and `define_term`'s
 * anchor obligation is stated in the description the references quote.
 */
function toolDefinitions() {
  const byName = new Map();
  const dir = join(ROOT, "src", "tools");
  if (!existsSync(dir)) return byName;
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts")).sort()) {
    const text = read(join(dir, file));
    if (text === null) continue;
    for (const match of text.matchAll(TOOL_DEFINITION)) {
      const object = enclosingObject(text, match.index);
      const at = object.indexOf("handler:");
      byName.set(match[1], {
        file,
        definition: at === -1 ? object : object.slice(0, at),
        handler: at === -1 ? "" : braced(object, at),
      });
    }
  }
  return byName;
}
const TOOL_DEFINITIONS = toolDefinitions();
const TOOLS = new Set(TOOL_DEFINITIONS.keys());

// ---- the server's own refusal messages ------------------------------------

/**
 * Every concatenated string/template literal in `text`, with `${…}` replaced by
 * `{X}` and whitespace collapsed.
 *
 * Runs of literals joined by `+` are one message: this server wraps its
 * sentences at the column limit, so a refusal is nearly always three or four
 * literals in a row. Reading only the first would truncate every message at its
 * first line break and the opening test would still work while the phrase test
 * silently would not.
 */
function messages(text) {
  const out = [];
  let i = 0;
  let pending = null; // { line, parts } — a run still open across `+`
  let line = 1;
  const flush = () => {
    if (pending) out.push({ line: pending.line, text: pending.parts.join("").replace(/\s+/g, " ").trim() });
    pending = null;
  };
  while (i < text.length) {
    const c = text[i];
    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    // A comment is not a message; skipping it also keeps an apostrophe inside
    // prose from being read as the start of a string literal.
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
        if (text[i] === "\n") line++;
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const startLine = line;
      const thrown = pending !== null || throwPosition(text, i);
      const { value, next } = readLiteral(text, i, c);
      if (!thrown) {
        for (let k = i; k < next; k++) if (text[k] === "\n") line++;
        flush();
        i = next;
        continue;
      }
      for (let k = i; k < next; k++) if (text[k] === "\n") line++;
      if (pending) pending.parts.push(value);
      else pending = { line: startLine, parts: [value] };
      // Stay open only across a `+` that joins this literal to the next one.
      let j = next;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === "+") {
        let k = j + 1;
        while (k < text.length && /\s/.test(text[k])) k++;
        if (text[k] === '"' || text[k] === "'" || text[k] === "`") {
          i = next;
          continue;
        }
      }
      flush();
      i = next;
      continue;
    }
    i++;
  }
  flush();
  return out;
}

/**
 * Is the literal starting at `at` thrown or returned, rather than collected?
 *
 * `blockers.push(`${authorityMode} requires allowed_write_prefixes`)` opens
 * like a refusal and is not one: it is one note among several a preflight
 * gathers, and no skill reference could be expected to quote it. A refusal is
 * thrown by `new ToolError(`, returned by the helper that composes it
 * (`requireCompleteReconciliation`), or bound to a constant the thrower uses
 * (`dispositions.ts`'s `EVIDENCE_IDS_REQUIRED`). Being an argument to any
 * *other* call is what this excludes.
 */
const NOT_A_CALL = new Set(["return", "throw", "await", "yield", "typeof", "if", "while"]);
function throwPosition(text, at) {
  const before = text.slice(Math.max(0, at - 200), at).replace(/\s+$/, "");
  if (/new\s+ToolError\($/.test(before)) return true;
  const call = /(?:^|[^\w$.])([A-Za-z_$][\w$.]*)\s*\($/.exec(before);
  // `return (` opens a parenthesized expression, not a call: the reconciliation
  // refusals are composed by a helper and thrown by its caller.
  return call === null || NOT_A_CALL.has(call[1]);
}

function readLiteral(text, start, quote) {
  let i = start + 1;
  let value = "";
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") {
      value += c === "\\" && text[i + 1] === "n" ? " " : text[i + 1];
      i += 2;
      continue;
    }
    if (quote === "`" && c === "$" && text[i + 1] === "{") {
      let depth = 1;
      i += 2;
      while (i < text.length && depth > 0) {
        if (text[i] === "{") depth++;
        else if (text[i] === "}") depth--;
        if (depth > 0) i++;
      }
      value += "{X}";
      i++;
      continue;
    }
    if (c === quote) return { value, next: i + 1 };
    value += c;
    i++;
  }
  return { value, next: i };
}

/**
 * Does `text` carry `phrase`?
 *
 * Both sides are compared with their whitespace collapsed, because both sides
 * wrap. The server splits a refusal across three or four concatenated literals
 * at the column limit; the references wrap the same sentence at theirs. A
 * comparison that demanded a contiguous byte run would be a check on two
 * formatters rather than on what either side says, and would go red on a
 * reflow that changed no word.
 */
function normalize(text) {
  return String(text).replace(/\s+/g, " ");
}
function carries(text, phrase) {
  return normalize(text).includes(normalize(phrase));
}

/**
 * The server side additionally compares against the messages the file
 * *composes*: a sentence wrapped across a concatenation is still one sentence,
 * and the register quotes the sentence rather than whichever fragment the
 * formatter happened to leave whole.
 */
function saysIt(text, phrase) {
  if (carries(text, phrase)) return true;
  return messages(text).some((message) => carries(message.text, phrase));
}

const SUBJECT = "(?:\\{X\\}|[A-Za-z_][A-Za-z0-9_]*)";
const OPENINGS = [
  { name: "cannot advance", re: /^cannot advance\b/ },
  { name: "refuses:", re: new RegExp(`^(${SUBJECT}) refuses:`) },
  { name: "requires", re: new RegExp(`^(${SUBJECT}) requires\\b`) },
];

/** Is this message one of the three refusal forms, with a subject that names an operation? */
function refusalOpening(message) {
  for (const opening of OPENINGS) {
    const match = opening.re.exec(message);
    if (!match) continue;
    const subject = match[1];
    if (subject === undefined) return opening.name; // `cannot advance` names no subject
    if (subject === "{X}" || TOOLS.has(subject)) return opening.name;
  }
  return null;
}

function serverSources() {
  const files = [];
  const invariants = join(ROOT, "src", "invariants.ts");
  if (existsSync(invariants)) files.push(invariants);
  const dir = join(ROOT, "src", "tools");
  if (existsSync(dir)) {
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts")).sort()) {
      files.push(join(dir, file));
    }
  }
  return files;
}

// ---- what the server says at a tool ---------------------------------------

/** The statement beginning at `from`, up to the `;` that ends it. */
function statement(text, from) {
  let i = from;
  const end = Math.min(text.length, from + 20000);
  while (i < end) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      i = readLiteral(text, i, c).next;
      continue;
    }
    if (c === ";") return text.slice(from, i);
    i++;
  }
  return text.slice(from, end);
}

/**
 * name → the bodies the server binds to it: functions, and the constants a
 * refusal is composed into.
 *
 * `dispositions.ts` throws `new ToolError(EVIDENCE_IDS_REQUIRED)`, so a scan
 * that read only the handler's own literals would find no sentence there and
 * conclude `set_disposition` does not refuse. Tool tables are skipped: an array
 * of definitions carries every refusal in the file, and following a reference
 * to it would make each tool appear to state all of them.
 */
function serverSymbols() {
  const bodies = new Map();
  const add = (name, text) => bodies.set(name, [...(bodies.get(name) ?? []), text]);
  for (const path of serverSources()) {
    const text = read(path);
    if (text === null) continue;
    // Module scope only. A `const rows = …` inside some other handler would
    // bind a name common enough that every body mentions it, and following it
    // would let any tool "state" any refusal in the file.
    for (const match of text.matchAll(
      /(?:^|\n)(?:export )?(?:async )?function ([A-Za-z_$][\w$]*)\s*[(<]/g,
    )) {
      add(match[1], braced(text, match.index + match[0].length));
    }
    for (const match of text.matchAll(
      /(?:^|\n)(?:export )?const ([A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=/g,
    )) {
      const bound = statement(text, match.index + match[0].length);
      if (bound.includes("inputSchema:")) continue;
      add(match[1], bound);
    }
  }
  return bodies;
}
const SYMBOLS = serverSymbols();

/**
 * Does `text`, or anything it names, say `phrase`?
 *
 * The refusals a tool throws are mostly thrown somewhere else: a handler calls
 * `enforcePhasePrerequisites`, which calls `requireAttachedEvidence`, which
 * throws. Following the names a body mentions — bound functions and constants,
 * not every identifier — is what turns "this tool refuses with this sentence"
 * into something a check can hold the register to.
 */
function reaches(text, phrase, seen, depth) {
  if (!text || depth > 6) return false;
  if (saysIt(text, phrase)) return true;
  for (const match of text.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
    const name = match[1];
    if (seen.has(name)) continue;
    const bound = SYMBOLS.get(name);
    if (!bound) continue;
    seen.add(name);
    for (const body of bound) if (reaches(body, phrase, seen, depth + 1)) return true;
  }
  return false;
}

/**
 * Does the server state `phrase` at `tool` — throw it from the handler, or
 * document it in the tool's own definition?
 *
 * Both count, and the difference is not one a skill reference can act on:
 * `define_term`'s anchor obligation is in its description, and the three
 * passages that instruct the call quote it from there.
 */
function statesRefusal(tool, phrase) {
  const definition = TOOL_DEFINITIONS.get(tool);
  if (definition === undefined) return false;
  if (carries(definition.definition, phrase)) return true;
  return reaches(definition.handler, phrase, new Set(), 0);
}

// ---- assertions 1 and 2: the register against both sides -------------------

const registeredPhrases = new Map(); // tool → Set(phrase)
/** Every tool the entry names, in either role: the reference-side search set. */
function named(entry) {
  return [
    ...(Array.isArray(entry?.refuses) ? entry.refuses : []),
    ...(Array.isArray(entry?.instructs) ? entry.instructs : []),
  ];
}
function rememberPhrase(entry, phrase) {
  for (const tool of named(entry)) {
    if (!registeredPhrases.has(tool)) registeredPhrases.set(tool, new Set());
    registeredPhrases.get(tool).add(phrase);
  }
}

const covering = []; // { id, phrase } — the phrases the derived scan clears against

for (const entry of entries) {
  const id = String(entry?.id ?? "(unnamed)");
  const serverFile = entry?.server?.file;
  const phrase = entry?.server?.phrase;
  if (!entry?.id) report(id, "register", "an entry carries no id");
  if (typeof serverFile !== "string" || typeof phrase !== "string" || phrase.length === 0) {
    report(id, "register", "the entry declares no server file and phrase");
    continue;
  }
  covering.push({ id, phrase });
  rememberPhrase(entry, phrase);

  const serverPath = resolve(ROOT, serverFile);
  const serverText = read(serverPath);
  if (serverText === null) {
    report(id, "server", `${serverFile} is not in the tree`);
  } else if (!saysIt(serverText, phrase)) {
    report(id, "server", `${serverFile} no longer says "${phrase}"`);
  }

  const references = Array.isArray(entry?.references) ? entry.references : [];
  if (references.length === 0) {
    report(
      id,
      "register",
      "the entry names no reference. A refusal registered against nothing is a refusal the " +
        "skill never states, which is the drift this check exists to report.",
    );
    continue;
  }
  for (const reference of references) {
    const file = reference?.file;
    if (typeof file !== "string") {
      report(id, "register", "a reference carries no file");
      continue;
    }
    const own = typeof reference.phrase === "string" ? reference.phrase : null;
    const wanted = own ?? phrase;
    if (own !== null && !carries(phrase, own)) {
      report(
        id,
        "register",
        `the reference phrase "${own}" is not part of the server's sentence "${phrase}". A ` +
          "reference may quote less than the server says; it may not quote something else.",
      );
      continue;
    }
    rememberPhrase(entry, wanted);
    const referenceText = read(resolve(ROOT, file));
    if (referenceText === null) {
      report(id, "reference", `${file} is not in the tree`);
    } else if (!carries(referenceText, wanted)) {
      report(id, "reference", `${file} no longer says "${wanted}"`);
    }
  }

  // ---- assertion 5: the association the register asserts --------------------
  //
  // `refuses` is what the server states at that tool; `instructs` is what a
  // reference naming it has to warn about without throwing it. Before this,
  // one field held both and nothing compared either to a call site, so
  // `active-session-required` could name `start_session` — the repair, whose
  // handler starts a session — and every tool that throws it could be absent
  // (slice-S3 review, F3/codex). The list is required to be *true*, not
  // exhaustive: a tool that throws a registered sentence and is named by no
  // entry is not reported here. The derived scan covers the sentence nobody
  // registered, which is the drift that loses a reader.
  if (entry?.tools !== undefined) {
    report(
      id,
      "register",
      'the entry carries "tools", which "refuses" and "instructs" replace. Left in place it ' +
        "reads like an association and asserts nothing.",
    );
  }
  const refuses = Array.isArray(entry?.refuses) ? entry.refuses : [];
  const instructs = Array.isArray(entry?.instructs) ? entry.instructs : [];
  for (const tool of named(entry)) {
    if (!TOOLS.has(tool)) {
      report(id, "register", `refuses/instructs names "${tool}", which this server does not advertise`);
    }
  }
  for (const tool of refuses) {
    if (instructs.includes(tool)) {
      report(id, "register", `"${tool}" is filed as both refusing and instructing the refusal`);
    }
    if (!TOOLS.has(tool)) continue;
    if (!statesRefusal(tool, phrase)) {
      report(
        id,
        "register",
        `refuses names "${tool}", and neither its handler nor its definition states "${phrase}". ` +
          "A tool that does not refuse belongs in instructs.",
      );
    }
  }
  for (const tool of instructs) {
    if (!TOOLS.has(tool)) continue;
    if (statesRefusal(tool, phrase)) {
      report(
        id,
        "register",
        `instructs names "${tool}", which states the refusal itself. A tool that refuses belongs ` +
          "in refuses, where the association is checked against its call sites.",
      );
    }
  }
}

// ---- assertion 3: refusals with no register entry -------------------------

const derivedUnregistered = [];
for (const path of serverSources()) {
  const text = read(path);
  if (text === null) continue;
  for (const message of messages(text)) {
    const opening = refusalOpening(message.text);
    if (!opening) continue;
    if (covering.some(({ phrase }) => carries(message.text, phrase))) continue;
    derivedUnregistered.push({
      file: show(path),
      line: message.line,
      opening,
      message: message.text.length > 160 ? `${message.text.slice(0, 160)}…` : message.text,
    });
  }
}
for (const row of derivedUnregistered) {
  report(
    "(derived)",
    "server",
    `${row.file}:${row.line} refuses with no register entry — "${row.message}"`,
  );
}

// ---- assertion 4: callers the register never warned ------------------------

function skillFiles() {
  const files = [];
  const skill = join(SKILL_DIR, "SKILL.md");
  if (existsSync(skill)) files.push(skill);
  const dir = join(SKILL_DIR, "references");
  if (existsSync(dir)) {
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".md")).sort()) {
      files.push(join(dir, file));
    }
  }
  return files;
}

const unphrasedReferences = [];
for (const path of skillFiles()) {
  const text = read(path);
  if (text === null) continue;
  for (const [tool, phrases] of registeredPhrases) {
    if (!new RegExp(`\\b${tool}\\b`).test(text)) continue;
    if ([...phrases].some((phrase) => carries(text, phrase))) continue;
    unphrasedReferences.push({ file: show(path), tool });
  }
}
for (const row of unphrasedReferences) {
  report(
    "(derived)",
    "reference",
    `${row.file} instructs ${row.tool}, whose handler throws a registered refusal, and states ` +
      "none of that refusal's words",
  );
}

// ---- the answer -----------------------------------------------------------

const ok = findings.length === 0;
if (asJson) {
  process.stdout.write(
    `${JSON.stringify(
      {
        ok,
        entries: entries.length,
        tools: TOOLS.size,
        findings,
        derived_unregistered: derivedUnregistered,
        unphrased_references: unphrasedReferences,
      },
      null,
      2,
    )}\n`,
  );
  process.exit(ok ? 0 : 1);
}

if (!ok) {
  for (const finding of findings) console.error(`  ${finding.id} [${finding.side}] ${finding.message}`);
  console.error(`\nrefusal parity drift: ${findings.length} finding(s)`);
  process.exit(1);
}
console.log(
  `OK — ${entries.length} registered refusal(s) agree with the server files and every named ` +
    `reference; no refusal among ${TOOLS.size} advertised tools is unregistered, and no skill ` +
    "reference instructs a refusing tool in silence.",
);
