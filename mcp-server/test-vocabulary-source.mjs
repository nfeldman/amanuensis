#!/usr/bin/env node
// Gate for reader-lenses packet P1 — a single enum source for every vocabulary
// surface (spec.md §10, claims C1, C3, C7, C48, C55, C63).
//
// Turns red when:
//   - a generated enum file differs from contracts/conspectus-vocabulary.json;
//   - a SQL `CHECK (<col> IN (…))` for a column the source names differs from
//     the source, or SQLite itself rejects a value the source carries;
//   - a tool validator accepts a value the source does not carry — checked
//     twice: statically, by requiring the validators to *be* the generated
//     arrays rather than copies of them, and behaviourally, by driving each
//     bound validator on a live store with a value the source does not carry
//     and requiring the refusal. The static half alone greps for an absent
//     literal and a present import, so widening a call to
//     `requireEnum(args, "kind", [...EVIDENCE_KINDS, "bogus"])` left it green
//     while `add_evidence` accepted `bogus` (F2/claude);
//   - the reader's guide hint tables list a value the server rejects, or omit
//     one it accepts;
//   - an enum value lacks `label`, `meaning`, or `cannot_justify`;
//   - the four-way check (JSON source, vocabulary.ts, vocabulary.py, SKILL.md)
//     cannot report *which* of the four diverged — each party is mutated in a
//     scratch copy of the tree and the check must name it (VP4: a gate that
//     cannot turn red for a given party is not guarding that party).
//
// False green it cannot exclude: agreeing copies can share one wrong
// definition. That is why SKILL.md — the only hand-written party — is read
// independently rather than followed through an import, and why the sabotage
// arms below drive each party separately.
//
// Output protocol: exactly one status line, last, on stdout. Every subprocess
// is captured and never echoed, and every message is scrubbed, so a missing
// deliverable reports as an assertion failure rather than as a crash.
import { spawnSync } from "node:child_process";
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
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureBuilt } from "./scripts/ensure-built.mjs";

const MCP = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(MCP, "..");

const SOURCE_REL = "mcp-server/contracts/conspectus-vocabulary.json";
const TS_REL = "mcp-server/src/vocabulary.ts";
const PY_REL = "materializer/amanuensis_materializer/vocabulary.py";
const SCHEMA_REL = "mcp-server/src/schema.sql";
const SKILL_REL = ".claude/skills/amanuensis/SKILL.md";
const GEN_REL = "mcp-server/scripts/gen-vocabulary.mjs";
const FOURWAY_REL = "mcp-server/scripts/check-evidence-vocabulary.mjs";

// §10.1 names the vocabularies the source must carry. `finding_status` is
// added: findings.status is CHECK-constrained and findings.ts enforces it, so
// the rule §10.1 states ("every CHECK-constrained vocabulary any surface in
// §10.2 reads or enforces") reaches it even though its list did not.
const REQUIRED_ENUMS = [
  "finding_resolution_state",
  "finding_status",
  "standing_state",
  "stale_reason",
  "file_classification",
  "subsystem_status",
  "evidence_kind",
  "evidence_quality",
  "disposition_classification",
  "severity",
  "field_note_category",
  "open_question_category",
  "open_question_resolution",
  "field_note_follow_up",
  "xref_relationship",
  "xref_strength",
  "contradiction_resolution",
  "diagnosticity_outcome",
  "claim_epistemic_kind",
  "claim_subject_type",
  "concern_status",
  "pass_type",
  "lens",
  "omission_reason",
  "attention_label",
];

// Tool validators that must import their arrays from the generated module
// rather than declaring a literal. Each entry: file, the literal declaration
// that must be gone, and the generated export that must be imported.
const VALIDATOR_BINDINGS = [
  { file: "src/tools/evidence.ts", literal: "const KINDS = [", imports: "EVIDENCE_KINDS" },
  {
    file: "src/tools/dispositions.ts",
    literal: "const EVIDENCE_QUALITY = [",
    imports: "EVIDENCE_QUALITIES",
  },
  {
    file: "src/tools/dispositions.ts",
    literal: "const CLASSIFICATIONS = [",
    imports: "DISPOSITION_CLASSIFICATIONS",
  },
  { file: "src/tools/files.ts", literal: "const CLASSIFICATIONS = [", imports: "FILE_CLASSIFICATIONS" },
  { file: "src/tools/findings.ts", literal: "const SEVERITY = [", imports: "SEVERITIES" },
  { file: "src/tools/findings.ts", literal: "const STATUS = [", imports: "FINDING_STATUSES" },
  { file: "src/tools/dispositions.ts", literal: "const PASS_TYPES = [", imports: "PASS_TYPES" },
  { file: "src/tools/findings.ts", literal: "const PASS_TYPES = [", imports: "PASS_TYPES" },
  {
    file: "src/tools/claims.ts",
    literal: "const EPISTEMIC_KINDS = [",
    imports: "CLAIM_EPISTEMIC_KINDS",
  },
  {
    file: "src/tools/xrefs.ts",
    literal: '["observed", "confirmed", "structural"]',
    imports: "XREF_STRENGTHS",
  },
  {
    file: "src/tools/field-notes.ts",
    literal: "const CATEGORIES = [",
    imports: "FIELD_NOTE_CATEGORIES",
  },
];

// The flat hint tables in html_projection.py and the enums that compose them,
// in precedence order. §10.2 requires them to be built from vocabulary.py.
const HINT_SURFACES = {
  STATUS_HINTS: [
    "subsystem_status",
    "disposition_classification",
    "finding_status",
    "finding_resolution_state",
    "diagnosticity_outcome",
  ],
  EVIDENCE_HINTS: ["evidence_kind"],
  SEVERITY_HINTS: ["severity"],
  STATUS_AXIS: [
    "subsystem_status",
    "disposition_classification",
    "finding_status",
    "finding_resolution_state",
    "diagnosticity_outcome",
  ],
  DISPLAY_STATUS: [
    "subsystem_status",
    "disposition_classification",
    "finding_status",
    "finding_resolution_state",
    "diagnosticity_outcome",
    "evidence_kind",
  ],
};

// ---------------------------------------------------------------------------
// Output funnel. Nothing reaches stdout/stderr except through emit(), and
// everything is scrubbed of the launcher's crash signatures so that a genuine
// assertion failure is never mistaken for a gate that never ran.
// ---------------------------------------------------------------------------
const SCRUB = [
  [/MODULE_NOT_FOUND/g, "module-absent"],
  [/ModuleNotFoundError/g, "python-module-absent"],
  [/Cannot find module/g, "cannot load module"],
  [/No such file or directory/g, "path is absent"],
  [/can't open file/g, "cannot open path"],
  [/SyntaxError/g, "syntax-error"],
  [/ImportError/g, "python-import-error"],
  [/ReferenceError/g, "reference-error"],
  [/ENOENT/g, "PATH-ABSENT"],
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

// Runs a node script with output captured. Nothing it prints is echoed.
function runNode(args, cwd) {
  const r = spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { status: r.status === null ? 1 : r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function runPython(code, cwd) {
  const r = spawnSync("python3", ["-c", code], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { status: r.status === null ? 1 : r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

const scratchDirs = [];
function scratchTree() {
  const dir = mkdtempSync(join(tmpdir(), "p1-vocab-"));
  scratchDirs.push(dir);
  for (const rel of [SOURCE_REL, TS_REL, PY_REL, SCHEMA_REL, SKILL_REL, GEN_REL, FOURWAY_REL]) {
    const from = join(REPO, rel);
    if (!existsSync(from)) continue;
    const to = join(dir, rel);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to);
  }
  return dir;
}

function cleanup() {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// The source, read once. Every later assertion reads its own party
// independently; nothing follows an import to compare an array with itself.
// ---------------------------------------------------------------------------
let source = null;
let sourceError = null;
{
  const raw = readText(join(REPO, SOURCE_REL));
  if (raw === null) sourceError = `${SOURCE_REL} is absent`;
  else {
    try {
      source = JSON.parse(raw);
    } catch {
      sourceError = `${SOURCE_REL} is not parseable JSON`;
    }
  }
}

function enumValues(name) {
  const decl = source?.enums?.[name];
  if (!decl || !Array.isArray(decl.values)) return null;
  return decl.values.map((v) => v.value);
}

// Parses `export const NAME = [ "a", "b" ] as const;` out of the generated
// TypeScript as text. The generator owns this shape; reading it as text is what
// makes the comparison independent of the module system.
function parseGeneratedTs(text) {
  const out = new Map();
  const re = /export const ([A-Z0-9_]+) = \[([^\]]*)\] as const;/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.set(
      m[1],
      m[2]
        .split(",")
        .map((s) => s.trim().replace(/^"|"$/g, ""))
        .filter(Boolean),
    );
  }
  return out;
}

// Parses `NAME: tuple[str, ...] = ( "a", "b", )` out of the generated Python.
function parseGeneratedPy(text) {
  const out = new Map();
  const re = /^([A-Z0-9_]+): tuple\[str, \.\.\.\] = \(([^)]*)\)/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.set(
      m[1],
      m[2]
        .split(",")
        .map((s) => s.trim().replace(/^"|"$/g, ""))
        .filter(Boolean),
    );
  }
  return out;
}

function tsConstName(enumName) {
  return source?.enums?.[enumName]?.const_name ?? null;
}

function sameList(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------
check("the enum source is present and parseable", () => sourceError);

check("the source declares a contract version and an enum map", () => {
  if (!source) return "the source could not be read";
  if (typeof source.contract_version !== "string" || !source.contract_version)
    return "contract_version is missing";
  if (!source.enums || typeof source.enums !== "object") return "enums is missing";
  if (!Array.isArray(source.orientation_forbidden_terms))
    return "orientation_forbidden_terms is missing";
  return null;
});

check("the source carries every vocabulary §10.1 names", () => {
  if (!source?.enums) return "the source could not be read";
  const missing = REQUIRED_ENUMS.filter((name) => !source.enums[name]);
  return missing.length ? `not carried: ${missing.join(", ")}` : null;
});

check("every enum value carries value, label, meaning, and cannot_justify", () => {
  if (!source?.enums) return "the source could not be read";
  const bad = [];
  for (const [name, decl] of Object.entries(source.enums)) {
    if (typeof decl.axis !== "string" || !decl.axis) bad.push(`${name}: no axis`);
    if (typeof decl.const_name !== "string" || !decl.const_name)
      bad.push(`${name}: no const_name`);
    if (!Array.isArray(decl.values) || decl.values.length === 0) {
      bad.push(`${name}: no values`);
      continue;
    }
    const seen = new Set();
    for (const v of decl.values) {
      for (const field of ["value", "label", "meaning", "cannot_justify"]) {
        if (typeof v?.[field] !== "string" || v[field].trim() === "")
          bad.push(`${name}.${v?.value ?? "?"}: ${field} is missing or empty`);
      }
      if (seen.has(v?.value)) bad.push(`${name}: ${v.value} is declared twice`);
      seen.add(v?.value);
    }
  }
  return bad.length ? bad.slice(0, 6).join("; ") + (bad.length > 6 ? ` (+${bad.length - 6})` : "") : null;
});

check("file_classification carries the obligation-bearing flag on every value", () => {
  const decl = source?.enums?.file_classification;
  if (!decl) return "file_classification is not carried";
  const bad = decl.values.filter((v) => typeof v.obligation_bearing !== "boolean");
  if (bad.length) return `no obligation_bearing on: ${bad.map((v) => v.value).join(", ")}`;
  const bearing = decl.values.filter((v) => v.obligation_bearing).map((v) => v.value);
  const exempt = decl.values.filter((v) => !v.obligation_bearing).map((v) => v.value);
  if (!bearing.length || !exempt.length)
    return "the flag partitions nothing — one side of the obligation split is empty";
  return null;
});

check("the generated TypeScript matches the source, enum for enum", () => {
  if (!source?.enums) return "the source could not be read";
  const text = readText(join(REPO, TS_REL));
  if (text === null) return `${TS_REL} is absent`;
  const parsed = parseGeneratedTs(text);
  if (parsed.size === 0) return `${TS_REL} declares no enum arrays in the generated shape`;
  const bad = [];
  for (const name of Object.keys(source.enums)) {
    const constName = tsConstName(name);
    const got = parsed.get(constName);
    if (!got) {
      bad.push(`${constName} is absent`);
      continue;
    }
    const want = enumValues(name);
    if (!sameList(want, got)) bad.push(`${constName} differs from ${name}`);
  }
  return bad.length ? bad.join("; ") : null;
});

check("the generated Python matches the source, enum for enum", () => {
  if (!source?.enums) return "the source could not be read";
  const text = readText(join(REPO, PY_REL));
  if (text === null) return `${PY_REL} is absent`;
  const parsed = parseGeneratedPy(text);
  if (parsed.size === 0) return `${PY_REL} declares no enum tuples in the generated shape`;
  const bad = [];
  for (const name of Object.keys(source.enums)) {
    const constName = tsConstName(name);
    const got = parsed.get(constName);
    if (!got) {
      bad.push(`${constName} is absent`);
      continue;
    }
    const want = enumValues(name);
    if (!sameList(want, got)) bad.push(`${constName} differs from ${name}`);
  }
  return bad.length ? bad.join("; ") : null;
});

check("gen-vocabulary.mjs --check is green on the tree as committed", () => {
  if (!existsSync(join(REPO, GEN_REL))) return `${GEN_REL} is absent`;
  const r = runNode([join(REPO, GEN_REL), "--check"], REPO);
  return r.status === 0 ? null : "--check reports the generated files differ from the source";
});

check("gen-vocabulary.mjs --check-sql is green on schema.sql as committed", () => {
  if (!existsSync(join(REPO, GEN_REL))) return `${GEN_REL} is absent`;
  const r = runNode([join(REPO, GEN_REL), "--check-sql"], REPO);
  return r.status === 0
    ? null
    : "--check-sql reports a CHECK (<col> IN (…)) literal that differs from the source";
});

check("--check turns red when a value is added to the source and not regenerated", () => {
  if (!existsSync(join(REPO, GEN_REL))) return `${GEN_REL} is absent`;
  const dir = scratchTree();
  const path = join(dir, SOURCE_REL);
  const raw = readText(path);
  if (raw === null) return `${SOURCE_REL} is absent`;
  const doc = JSON.parse(raw);
  const decl = doc.enums.severity;
  if (!decl) return "severity is not carried";
  decl.values.push({
    value: "TRIVIAL",
    label: "Trivial",
    meaning: "Sabotage value injected by the gate.",
    cannot_justify: "anything at all.",
  });
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  const r = runNode([join(dir, GEN_REL), "--check"], dir);
  return r.status === 0 ? "--check stayed green with an unregenerated source value" : null;
});

check("--check turns red when a generated file is edited by hand", () => {
  if (!existsSync(join(REPO, GEN_REL))) return `${GEN_REL} is absent`;
  const bad = [];
  for (const rel of [TS_REL, PY_REL]) {
    const dir = scratchTree();
    const path = join(dir, rel);
    const text = readText(path);
    if (text === null) {
      bad.push(`${rel} is absent`);
      continue;
    }
    writeFileSync(path, text.replace(/"pattern-matched"/, '"pattern-matchd"'));
    const r = runNode([join(dir, GEN_REL), "--check"], dir);
    if (r.status === 0) bad.push(`--check stayed green after a hand edit to ${rel}`);
  }
  return bad.length ? bad.join("; ") : null;
});

check("--check-sql turns red when a CHECK literal loses a value", () => {
  if (!existsSync(join(REPO, GEN_REL))) return `${GEN_REL} is absent`;
  const dir = scratchTree();
  const path = join(dir, SCHEMA_REL);
  const text = readText(path);
  if (text === null) return `${SCHEMA_REL} is absent`;
  const mutated = text.replace(
    /'unmapped','scoping','structural',/,
    "'unmapped','scoping',",
  );
  if (mutated === text) return "the subsystems.status CHECK literal could not be located";
  writeFileSync(path, mutated);
  const r = runNode([join(dir, GEN_REL), "--check-sql"], dir);
  return r.status === 0 ? "--check-sql stayed green with a value missing from a CHECK" : null;
});

check("the four-way check is green on the tree as committed", () => {
  if (!existsSync(join(REPO, FOURWAY_REL))) return `${FOURWAY_REL} is absent`;
  const r = runNode([join(REPO, FOURWAY_REL)], REPO);
  return r.status === 0 ? null : "the four-way check reports a divergence on a clean tree";
});

// Each party is mutated alone. The check must turn red *and* name the party it
// found diverging — a check that reports "something differs" cannot tell a
// reader which copy to trust.
check("the four-way check turns red and names the party, for each of the four", () => {
  if (!existsSync(join(REPO, FOURWAY_REL))) return `${FOURWAY_REL} is absent`;
  const arms = [
    {
      party: SOURCE_REL,
      names: "conspectus-vocabulary.json",
      mutate: (text) => text.replace(/"pattern-matched"/, '"pattern-matchd"'),
    },
    {
      party: TS_REL,
      names: "vocabulary.ts",
      mutate: (text) => text.replace(/"pattern-matched"/, '"pattern-matchd"'),
    },
    {
      party: PY_REL,
      names: "vocabulary.py",
      mutate: (text) => text.replace(/"pattern-matched"/, '"pattern-matchd"'),
    },
    {
      party: SKILL_REL,
      names: "SKILL.md",
      mutate: (text) => text.replace(/`pattern-matched`\)/, "`pattern-matchd`)"),
    },
  ];
  const bad = [];
  for (const arm of arms) {
    const dir = scratchTree();
    const path = join(dir, arm.party);
    const text = readText(path);
    if (text === null) {
      bad.push(`${arm.party} is absent`);
      continue;
    }
    const mutated = arm.mutate(text);
    if (mutated === text) {
      bad.push(`the sabotage target could not be located in ${arm.party}`);
      continue;
    }
    writeFileSync(path, mutated);
    const r = runNode([join(dir, FOURWAY_REL)], dir);
    if (r.status === 0) bad.push(`stayed green with ${arm.party} mutated`);
    else if (!r.out.includes(arm.names))
      bad.push(`turned red for ${arm.party} without naming ${arm.names}`);
  }
  return bad.length ? bad.join("; ") : null;
});

check("evidence_quality and evidence_kind carry exactly the same values", () => {
  const kinds = enumValues("evidence_kind");
  const quality = enumValues("evidence_quality");
  if (!kinds || !quality) return "one of the two vocabularies is not carried";
  if (!sameList(kinds, quality))
    return "a disposition cannot record every evidence kind add_evidence accepts";
  return null;
});

check("tool validators are the generated arrays, not copies of them", () => {
  const bad = [];
  for (const binding of VALIDATOR_BINDINGS) {
    const text = readText(join(MCP, binding.file));
    if (text === null) {
      bad.push(`${binding.file} is absent`);
      continue;
    }
    if (text.includes(binding.literal))
      bad.push(`${binding.file} still declares ${binding.literal.trim()}`);
    if (!new RegExp(`\\b${binding.imports}\\b`).test(text))
      bad.push(`${binding.file} does not use ${binding.imports}`);
    if (!/from "\.\.\/vocabulary\.js"/.test(text))
      bad.push(`${binding.file} does not import from the generated module`);
  }
  return bad.length ? bad.slice(0, 5).join("; ") : null;
});

// ---------------------------------------------------------------------------
// The behavioural half of the same question (F2/claude). The static check
// above reads text; this one drives the validator. A widened `requireEnum`
// call keeps the literal absent and the import present, so only a live refusal
// can tell the two apart.
// ---------------------------------------------------------------------------
const OUT_OF_SOURCE = "not-a-vocabulary-value";

const built = ensureBuilt();

let liveTools = null;
let liveError = built.ok ? null : `src/ was not compiled before this gate read dist/ — ${built.detail}`;
if (!liveError) {
  try {
    const loaded = await Promise.all([
      import("./dist/db.js"),
      import("./dist/project.js"),
      import("./dist/tools/evidence.js"),
      import("./dist/tools/findings.js"),
      import("./dist/tools/dispositions.js"),
      import("./dist/tools/files.js"),
      import("./dist/tools/field-notes.js"),
      import("./dist/tools/claims.js"),
      import("./dist/tools/git.js"),
      import("./dist/tools/locus.js"),
    ]);
    liveTools = {
      db: loaded[0],
      project: loaded[1],
      sets: [
        loaded[2].evidenceTools,
        loaded[3].findingTools,
        loaded[4].dispositionTools,
        loaded[5].fileTools,
        loaded[6].fieldNoteTools,
        loaded[7].claimTools,
        loaded[8].gitTools,
        loaded[9].locusTools,
      ],
    };
  } catch (e) {
    liveError = `the tool modules could not be loaded — ${e && e.message ? e.message : e}`;
  }
}

let validatorFixture = null;
if (!liveError) {
  try {
    const dir = mkdtempSync(join(tmpdir(), "p1-validators-"));
    scratchDirs.push(dir);
    const workspace = join(dir, "workspace");
    const storageRoot = join(dir, "storage-root");
    mkdirSync(join(workspace, "src"), { recursive: true });
    mkdirSync(storageRoot, { recursive: true });
    const git = (...args) => {
      const r = spawnSync("git", args, { cwd: workspace, encoding: "utf8" });
      if (r.status !== 0) throw new Error(`git ${args[0]} did not succeed`);
      return String(r.stdout ?? "").trim();
    };
    git("init", "-q", "-b", "main");
    git("config", "user.email", "test@localhost");
    git("config", "user.name", "P1 Validator Arm");
    git("config", "commit.gpgsign", "false");
    writeFileSync(join(workspace, "src", "ledger.ts"), "export const row = 1;\n");
    writeFileSync(join(workspace, "src", "drift.ts"), "export const drift = 1;\n");
    writeFileSync(join(workspace, "src", "gone.ts"), "export const gone = 1;\n");
    writeFileSync(join(workspace, "src", "bad-ref.ts"), "export const bad = 1;\n");
    git("add", "-A");
    git("commit", "-q", "--no-verify", "-m", "base");
    const head = git("rev-parse", "HEAD");
    process.env.AMANUENSIS_STORAGE_ROOT = storageRoot;
    const project = liveTools.project.resolveProject(workspace, {
      selectionSource: "test-vocabulary-source",
      serverVersion: "test",
    });
    liveTools.project.ensureProjectStorage(project, (dbPath) =>
      liveTools.db.openDatabase(dbPath).close(),
    );
    const db = liveTools.db.openDatabase(project.dbPath);
    db.prepare("INSERT INTO sessions (session_id, intent) VALUES ('p1', 'p1-gate')").run();
    db.prepare("INSERT INTO concerns (code, origin) VALUES ('SC-1', 'seeded')").run();
    db.prepare(
      "INSERT INTO subsystems (id, name, status, layer) VALUES ('B-01', 'Ledger', 'adversarial', 'core')",
    ).run();
    const ledger = db.prepare(
      `INSERT INTO file_ledger (subsystem_id, file_path, why_in_scope, classification, ref_sha, stale)
       VALUES ('B-01', ?, 'validator arm', 'examined', ?, 0)`,
    );
    ledger.run("src/ledger.ts", head);
    // One row per reconciliation outcome, so the stale_reason arm below has a
    // positive case for each of the three literals detect_changes writes.
    ledger.run("src/drift.ts", head);
    ledger.run("src/gone.ts", head);
    ledger.run("src/bad-ref.ts", "deadbeef");
    writeFileSync(join(workspace, "src", "drift.ts"), "export const drift = 2;\n");
    rmSync(join(workspace, "src", "gone.ts"));
    git("add", "-A");
    git("commit", "-q", "--no-verify", "-m", "drift");
    const later = git("rev-parse", "HEAD");
    db.prepare(
      `INSERT INTO git_state (repo_id, canonical_branch, onboarding_sha, last_checked_sha)
       VALUES ('default', 'main', ?, ?)`,
    ).run(head, head);
    validatorFixture = { db, head, later, ctx: { project, db, sessionId: "p1" } };
  } catch (e) {
    liveError = `the validator fixture could not be built — ${e && e.message ? e.message : e}`;
  }
}

/**
 * Drive one validator and read back the set it says it accepts.
 *
 * `requireEnum` refuses with `<key> must be one of: <values>`, so the running
 * validator publishes its own accepted list in the refusal. Probing with a
 * single out-of-source value is not enough on its own: the sabotage that
 * opened this finding widened the list by exactly one value
 * (`[...EVIDENCE_KINDS, "bogus"]`), which still refuses any *other* probe.
 * Reading the list out of the refusal is what makes the arm exact, and it is
 * still the running code speaking rather than its source text.
 */
function driveValidator(name, args) {
  for (const set of liveTools?.sets ?? []) {
    if (!Array.isArray(set)) continue;
    const definition = set.find((entry) => entry?.name === name);
    if (!definition) continue;
    const readAccepted = (message) => {
      const match = /must be one of:\s*(.+)$/m.exec(String(message ?? ""));
      return match ? match[1].split(",").map((entry) => entry.trim()).filter(Boolean) : null;
    };
    try {
      const value = definition.handler(args, validatorFixture.ctx);
      if (value && typeof value === "object" && value.ok === false)
        return { refused: true, accepted: readAccepted(value.error), value };
      return { refused: false, accepted: null, value };
    } catch (e) {
      return { refused: true, accepted: readAccepted(e && e.message ? e.message : e), value: null };
    }
  }
  return { refused: false, missing: true, accepted: null };
}

check("every bound validator refuses a value the source does not carry", () => {
  if (liveError) return liveError;
  const head = validatorFixture.head;
  const finding = (id, extra) => ({
    finding_id: id,
    subsystem_id: "B-01",
    symptom: "the row writer drops the last entry",
    root_cause: "the loop bound is exclusive",
    severity: "MEDIUM",
    status: "confirmed-bug",
    ref_sha: head,
    pass_type: "survey",
    ...extra,
  });
  const disposition = (extra) => ({
    subsystem_id: "B-01",
    concern_code: "SC-1",
    classification: "ruled-out",
    evidence: `src/ledger.ts:row@${head}`,
    evidence_quality: "code-verified",
    rationale: "the writer is bounded by the ledger row count",
    ref_sha: head,
    pass_type: "survey",
    ...extra,
  });
  const probes = [
    ["evidence_kind", "add_evidence.kind", "add_evidence", {
      file_path: "src/ledger.ts",
      ref_sha: head,
      kind: OUT_OF_SOURCE,
    }],
    ["severity", "add_finding.severity", "add_finding", finding("V-1", { severity: OUT_OF_SOURCE })],
    ["finding_status", "add_finding.status", "add_finding", finding("V-2", { status: OUT_OF_SOURCE })],
    ["pass_type", "add_finding.pass_type", "add_finding", finding("V-3", { pass_type: OUT_OF_SOURCE })],
    ["disposition_classification", "set_disposition.classification", "set_disposition",
      disposition({ classification: OUT_OF_SOURCE })],
    ["evidence_quality", "set_disposition.evidence_quality", "set_disposition",
      disposition({ evidence_quality: OUT_OF_SOURCE })],
    ["file_classification", "update_file_classification.classification", "update_file_classification", {
      subsystem_id: "B-01",
      file_path: "src/ledger.ts",
      classification: OUT_OF_SOURCE,
    }],
    ["field_note_category", "add_field_note.category", "add_field_note", {
      subsystem_id: "B-01",
      category: OUT_OF_SOURCE,
      observation: "a note whose category the source does not carry",
      location: "src/ledger.ts",
    }],
    ["claim_subject_type", "add_claim.subject_type", "add_claim", {
      claim_id: "B-01-c1",
      claim_key: "B-01/concurrency/writer",
      subject_type: OUT_OF_SOURCE,
      subject_id: "src/ledger.ts:append",
      statement: "the writer holds the ledger lock for the whole append",
      epistemic_kind: "observation",
      ref_sha: head,
      evidence_ids: [1],
    }],
    ["claim_epistemic_kind", "add_claim.epistemic_kind", "add_claim", {
      claim_id: "B-01-c2",
      claim_key: "B-01/concurrency/writer",
      subject_type: "symbol",
      subject_id: "src/ledger.ts:append",
      statement: "the writer holds the ledger lock for the whole append",
      epistemic_kind: OUT_OF_SOURCE,
      ref_sha: head,
      evidence_ids: [1],
    }],
  ];
  const bad = [];
  for (const [enumName, label, name, args] of probes) {
    const values = enumValues(enumName);
    if (!values) {
      bad.push(`the source carries no ${enumName}`);
      continue;
    }
    if (values.includes(OUT_OF_SOURCE)) {
      bad.push(`${enumName} carries the probe value, so this arm measures nothing`);
      continue;
    }
    const outcome = driveValidator(name, args);
    if (outcome.missing) {
      bad.push(`${name} is not registered`);
      continue;
    }
    if (!outcome.refused) {
      bad.push(`${label} accepts ${OUT_OF_SOURCE}`);
      continue;
    }
    if (outcome.accepted === null) {
      bad.push(`${label} refused without naming the values it accepts`);
      continue;
    }
    const extra = outcome.accepted.filter((value) => !values.includes(value));
    const absent = values.filter((value) => !outcome.accepted.includes(value));
    if (extra.length) bad.push(`${label} accepts ${extra.join(", ")}, which the source does not carry`);
    if (absent.length) bad.push(`${label} refuses ${absent.join(", ")}, which the source carries`);
  }
  return bad.length ? bad.slice(0, 5).join("; ") : null;
});

check("the stale_reason writers write only values the source carries", () => {
  if (liveError) return liveError;
  const reasons = enumValues("stale_reason");
  if (!reasons) return "the source carries no stale_reason enum";
  // detect_changes is the first writer: three outcomes, three literals, and
  // nothing in the tree read the generated enum until F4/codex (`git-driftt`
  // reached the ledger and this gate stayed green).
  const detect = driveValidator("detect_changes", { current_sha: validatorFixture.later });
  if (detect.missing) return "detect_changes is not registered";
  if (detect.refused) return "detect_changes refused the fixture revision";
  const written = validatorFixture.db
    .prepare("SELECT file_path, stale_reason FROM file_ledger WHERE stale_reason IS NOT NULL")
    .all();
  if (written.length === 0)
    return "detect_changes marked nothing stale on a fixture holding a drifted, an absent, and an unverifiable row";
  const bad = written
    .filter((row) => !reasons.includes(String(row.stale_reason)))
    .map((row) => `detect_changes wrote ${JSON.stringify(row.stale_reason)} for ${row.file_path}`);
  if (bad.length) return bad.join("; ");
  // standing.ts is the second writer, reached through describe_locus's owner
  // rows rather than through the ledger.
  const account = driveValidator("describe_locus", { locus: "src/bad-ref.ts" });
  if (account.missing) return "describe_locus is not registered";
  const owners = account.value?.standing?.owners ?? [];
  if (owners.length === 0) return "describe_locus reports no owner for a ledgered path";
  const offending = owners
    .filter((owner) => owner.stale_reason !== null && !reasons.includes(String(owner.stale_reason)))
    .map((owner) => `standing wrote ${JSON.stringify(owner.stale_reason)} for ${owner.subsystem_id}`);
  return offending.length ? offending.join("; ") : null;
});

check("a schema-published enum is exactly the source's list", () => {
  if (liveError) return liveError;
  const bad = [];
  for (const [enumName, name, property] of [["xref_strength", "add_xref", "strength"]]) {
    const values = enumValues(enumName);
    if (!values) {
      bad.push(`the source carries no ${enumName}`);
      continue;
    }
    const text = readText(join(MCP, "src", "tools", `${name === "add_xref" ? "xrefs" : name}.ts`));
    if (text === null) {
      bad.push(`the module publishing ${name} is absent`);
      continue;
    }
    if (!new RegExp(`${property}:\\s*\\{[^}]*enum:\\s*\\[\\.\\.\\.`).test(text))
      bad.push(`${name}.${property} does not publish the generated array as its schema enum`);
  }
  return bad.length ? bad.join("; ") : null;
});

check("SQLite accepts every value the source carries for the columns it names", () => {
  const schema = readText(join(REPO, SCHEMA_REL));
  if (schema === null) return `${SCHEMA_REL} is absent`;
  const kinds = enumValues("evidence_kind");
  const quality = enumValues("evidence_quality");
  if (!kinds || !quality) return "one of the two vocabularies is not carried";
  let Database;
  try {
    Database = createRequire(import.meta.url)("better-sqlite3");
  } catch {
    return "the sqlite driver could not be loaded, so the CHECK constraints were not exercised";
  }
  const dir = mkdtempSync(join(tmpdir(), "p1-sqlite-"));
  scratchDirs.push(dir);
  const db = new Database(join(dir, "check.db"));
  try {
    db.exec(schema);
    db.prepare("INSERT INTO concerns (code, origin) VALUES ('GATE-1', 'seeded')").run();
    const rejected = [];
    for (const kind of kinds) {
      try {
        db.prepare(
          "INSERT INTO evidence (file_path, ref_sha, kind) VALUES ('a.ts', 'deadbeef', ?)",
        ).run(kind);
      } catch {
        rejected.push(`evidence.kind rejects ${kind}`);
      }
    }
    for (const value of quality) {
      try {
        db.prepare(
          `INSERT INTO dispositions (subsystem_id, concern_code, classification, evidence_quality)
             VALUES (?, 'GATE-1', 'ruled-out', ?)`,
        ).run(`S-${value}`, value);
      } catch {
        rejected.push(`dispositions.evidence_quality rejects ${value}`);
      }
    }
    return rejected.length ? rejected.join("; ") : null;
  } finally {
    db.close();
  }
});

check("the reader's guide hint tables are exactly the source's values", () => {
  if (!source?.enums) return "the source could not be read";
  const py = runPython(
    "import json\n" +
      "from amanuensis_materializer import html_projection as h\n" +
      "print(json.dumps({k: sorted(getattr(h, k)) for k in " +
      `${JSON.stringify(Object.keys(HINT_SURFACES))}` +
      "}))",
    join(REPO, "materializer"),
  );
  if (py.status !== 0) return "the projection module could not be loaded to read its hint tables";
  let tables;
  try {
    tables = JSON.parse(py.out);
  } catch {
    return "the projection module did not report its hint tables";
  }
  const bad = [];
  for (const [surface, enums] of Object.entries(HINT_SURFACES)) {
    const want = new Set();
    for (const name of enums) for (const v of enumValues(name) ?? []) want.add(v);
    const got = new Set(tables[surface] ?? []);
    const rejects = [...got].filter((v) => !want.has(v));
    const omits = [...want].filter((v) => !got.has(v));
    if (rejects.length) bad.push(`${surface} lists values the server rejects: ${rejects.join(", ")}`);
    if (omits.length) bad.push(`${surface} omits values the server accepts: ${omits.join(", ")}`);
  }
  const projection = readText(join(REPO, "materializer/amanuensis_materializer/html_projection.py"));
  if (projection === null) bad.push("html_projection.py is absent");
  else if (/^STATUS_HINTS = \{$/m.test(projection))
    bad.push("html_projection.py still declares its hint tables as literals");
  return bad.length ? bad.join("; ") : null;
});

check("the obligation-bearing predicate is generated, with no hand-maintained copy", () => {
  const decl = source?.enums?.file_classification;
  if (!decl) return "file_classification is not carried";
  const exempt = decl.values.filter((v) => !v.obligation_bearing).map((v) => v.value);
  const expected = `COALESCE(classification, 'candidate') NOT IN (${exempt
    .map((v) => `'${v}'`)
    .join(", ")})`;
  const bad = [];

  const ts = readText(join(REPO, TS_REL));
  if (ts === null) bad.push(`${TS_REL} is absent`);
  else if (!ts.includes(expected)) bad.push("the generated TypeScript predicate differs");

  const helpers = readText(join(MCP, "src/helpers.ts"));
  if (helpers === null) bad.push("src/helpers.ts is absent");
  else {
    if (/OBLIGATION_BEARING_SQL\s*=\s*\n?\s*"COALESCE/.test(helpers))
      bad.push("src/helpers.ts still declares the predicate as a literal");
    if (!/from "\.\/vocabulary\.js"/.test(helpers))
      bad.push("src/helpers.ts does not source the predicate from the generated module");
  }

  const diagrams = readText(join(REPO, "materializer/amanuensis_materializer/diagrams.py"));
  if (diagrams === null) bad.push("diagrams.py is absent");
  else {
    if (/_OBLIGATION_BEARING = \(\s*\n\s*"COALESCE/.test(diagrams))
      bad.push("diagrams.py still declares the predicate as a literal");
    if (!/from \.vocabulary import/.test(diagrams))
      bad.push("diagrams.py does not source the predicate from the generated module");
  }

  const py = runPython(
    "from amanuensis_materializer.vocabulary import OBLIGATION_BEARING_SQL\n" +
      "print(OBLIGATION_BEARING_SQL)",
    join(REPO, "materializer"),
  );
  if (py.status !== 0) bad.push("the generated Python predicate could not be read");
  else if (py.out.trim() !== expected) bad.push("the generated Python predicate differs");

  return bad.length ? bad.join("; ") : null;
});

// ---------------------------------------------------------------------------
// A single enum source is only single-sourced if databases created before a
// widening are brought forward to it.  `CREATE TABLE IF NOT EXISTS` does not
// rewrite an existing table and SQLite cannot alter a CHECK in place, so a
// store opened by this server must be migrated or it enforces a vocabulary the
// contract no longer describes.  The fixture is the canonical schema with one
// value removed from every mapped CHECK — surface-identical to a real legacy
// store, differing only in the constraint under test.
// ---------------------------------------------------------------------------
const CHECK_RE = (column) =>
  new RegExp(`(${column}\\s+TEXT[^,]*?CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\()([^)]*)(\\))`, "s");

function mappedColumns() {
  const out = [];
  for (const [name, decl] of Object.entries(source?.enums ?? {})) {
    for (const m of decl.sql ?? []) {
      out.push({ enum: name, table: m.table, column: m.column, values: enumValues(name) ?? [] });
    }
  }
  return out;
}

function checkValues(createSql, column) {
  const m = CHECK_RE(column).exec(createSql ?? "");
  if (!m) return null;
  return [...m[2].matchAll(/'([^']*)'/g)].map((v) => v[1]);
}

let upgrade = null;
let upgradeError = null;
{
  const schemaText = readText(join(REPO, SCHEMA_REL));
  const mapped = mappedColumns();
  if (schemaText === null) upgradeError = `${SCHEMA_REL} is absent`;
  else if (!mapped.length) upgradeError = "the source maps no CHECK-constrained column";
  else {
    // Narrow every mapped CHECK by one value, the way a pre-widening store is
    // narrow.  `dropped` is what an upgraded store must come to accept again.
    let legacySchema = schemaText;
    const dropped = [];
    for (const entry of mapped) {
      const re = CHECK_RE(entry.column);
      const found = re.exec(legacySchema);
      if (!found) continue;
      const values = [...found[2].matchAll(/'([^']*)'/g)].map((v) => v[1]);
      if (values.length < 2) continue;
      const keep = values.slice(0, -1);
      dropped.push({ ...entry, dropped: values[values.length - 1], keep });
      legacySchema = legacySchema.replace(
        re,
        (_all, head, _body, tail) => `${head}${keep.map((v) => `'${v}'`).join(",")}${tail}`,
      );
    }
    const dir = mkdtempSync(join(tmpdir(), "p1-legacy-"));
    scratchDirs.push(dir);
    const dbPath = join(dir, "memory.db");
    const seedPath = join(dir, "seed.mjs");
    const runPath = join(dir, "run.mjs");
    writeFileSync(join(dir, "legacy-schema.sql"), legacySchema);
    // Two processes: one creates the legacy store with a direct driver, the
    // other opens it the way the server does.  The upgrade under test is
    // whatever `openDatabase` performs, never anything this gate applies.
    writeFileSync(
      seedPath,
      `import { createRequire } from "node:module";
const Database = createRequire(${JSON.stringify(join(MCP, "package.json"))})("better-sqlite3");
import { readFileSync } from "node:fs";
const db = new Database(${JSON.stringify(dbPath)});
db.exec(readFileSync(${JSON.stringify(join(dir, "legacy-schema.sql"))}, "utf8"));
db.prepare("INSERT INTO subsystems (id, name, status) VALUES ('B-01','Legacy','mapped')").run();
db.prepare("INSERT INTO concerns (code, origin, status) VALUES ('C1','seeded','active')").run();
db.prepare("INSERT INTO dispositions (subsystem_id, concern_code, classification, evidence, evidence_quality, rationale, pass_type) VALUES ('B-01','C1','confirmed-bug','f.ts:v@abc','code-verified','legacy row','survey')").run();
db.close();
console.log("seeded");`,
    );
    writeFileSync(
      runPath,
      `import { openDatabase } from ${JSON.stringify(join(MCP, "dist/db.js"))};
const db = openDatabase(${JSON.stringify(dbPath)});
const schema = Object.fromEntries(
  db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table'").all().map((r) => [r.name, r.sql]),
);
const accepted = {};
try {
  db.prepare("INSERT INTO dispositions (subsystem_id, concern_code, classification, evidence, evidence_quality, rationale, pass_type) VALUES ('B-02','C1','confirmed-bug','f.ts:v@abc',?, 'probe','survey')");
} catch {}
for (const q of ${JSON.stringify(enumValues("evidence_quality") ?? [])}) {
  try {
    db.prepare("INSERT INTO dispositions (subsystem_id, concern_code, classification, evidence, evidence_quality, rationale, pass_type) VALUES (?, 'C1','confirmed-bug','f.ts:v@abc',?,'probe','survey')").run("B-q-" + q, q);
    accepted[q] = true;
  } catch (e) { accepted[q] = String(e.message); }
}
const out = {
  schema,
  accepted,
  preserved: db.prepare("SELECT COUNT(*) AS n FROM dispositions WHERE subsystem_id='B-01' AND rationale='legacy row'").get().n,
  indexes: db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL").all().map((r) => r.name),
  triggers: db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all().map((r) => r.name),
  fkViolations: db.pragma("foreign_key_check").length,
};
db.close();
console.log(JSON.stringify(out));`,
    );
    const seeded = runNode([seedPath], dir);
    if (seeded.status !== 0) upgradeError = `the legacy fixture could not be built — ${scrub(seeded.out).slice(-240)}`;
    else {
      const ran = runNode([runPath], dir);
      if (ran.status !== 0) upgradeError = `opening the legacy store failed — ${scrub(ran.out).slice(-240)}`;
      else {
        const line = ran.out.trim().split("\n").pop();
        try {
          upgrade = { ...JSON.parse(line), dropped };
        } catch {
          upgradeError = `the upgrade probe printed no result — ${scrub(ran.out).slice(-240)}`;
        }
      }
    }
  }
}

check("a store created before a widening is brought forward to the enum source", () => {
  if (upgradeError) return upgradeError;
  const behind = [];
  for (const entry of upgrade.dropped) {
    const live = checkValues(upgrade.schema[entry.table], entry.column);
    if (live === null) {
      behind.push(`${entry.table}.${entry.column} carries no CHECK after the upgrade`);
      continue;
    }
    const missing = entry.values.filter((v) => !live.includes(v));
    if (missing.length) behind.push(`${entry.table}.${entry.column} still rejects ${missing.join(", ")}`);
  }
  return behind.length ? behind.join("; ") : null;
});

check("the upgrade preserves the rows, indexes, triggers, and keys it rebuilds", () => {
  if (upgradeError) return upgradeError;
  const bad = [];
  if (upgrade.preserved !== 1) bad.push(`the legacy disposition row did not survive (${upgrade.preserved} rows)`);
  if (upgrade.fkViolations !== 0) bad.push(`${upgrade.fkViolations} foreign-key violation(s) after the rebuild`);
  const schemaText = readText(join(REPO, SCHEMA_REL)) ?? "";
  for (const kind of [
    ["index", /CREATE INDEX IF NOT EXISTS (\w+)/g, upgrade.indexes],
    ["trigger", /CREATE TRIGGER IF NOT EXISTS (\w+)/g, upgrade.triggers],
  ]) {
    const [label, re, live] = kind;
    const declared = [...schemaText.matchAll(re)].map((m) => m[1]);
    const missing = declared.filter((n) => !live.includes(n));
    if (missing.length) bad.push(`${missing.length} ${label}(s) absent after the rebuild: ${missing.slice(0, 3).join(", ")}`);
  }
  return bad.length ? bad.join("; ") : null;
});

check("every vocabulary value the source declares is writable on an upgraded store", () => {
  if (upgradeError) return upgradeError;
  const rejected = Object.entries(upgrade.accepted)
    .filter(([, v]) => v !== true)
    .map(([q]) => q);
  return rejected.length
    ? `an upgraded store rejects ${rejected.join(", ")} for dispositions.evidence_quality`
    : null;
});

check("the packet's gate and the generator checks run in CI", () => {
  const ci = readText(join(REPO, ".github/workflows/test.yml"));
  if (ci === null) return ".github/workflows/test.yml is absent";
  const missing = [];
  if (!ci.includes("node test-vocabulary-source.mjs")) missing.push("the gate");
  if (!ci.includes("scripts/gen-vocabulary.mjs --check")) missing.push("--check");
  if (!ci.includes("scripts/gen-vocabulary.mjs --check-sql")) missing.push("--check-sql");
  if (!ci.includes("scripts/check-evidence-vocabulary.mjs")) missing.push("the four-way check");
  return missing.length ? `not run in CI: ${missing.join(", ")}` : null;
});

cleanup();

if (failures.length) {
  emit("");
  emit(
    `GATE P1 RED: vocabulary source divergence — ${failures.length} assertion(s) failed; first: ${failures[0]}`,
  );
  process.exit(1);
}
emit("");
emit("GATE P1 GREEN");
