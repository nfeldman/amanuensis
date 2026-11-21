#!/usr/bin/env node
// GATE SO6 (design/store-only/PLAN.md §2.5, §8 SO6) — the server stops
// depending on hand-written files.
//
// A survey used to reach `concerns` by writing a Markdown narrative under storage
// and registering it by hand; `describe_locus` pointed at that file's path and
// hash; composition scored an `artifact` item against the registry. §2.5 stops
// each: the `concerns` advance reads a structure narrative (or an imported survey
// body), the locus names the narrative record and its revision, `register_artifact`
// and `rehash_artifact` refuse every hand-written kind, and composition gains an
// item kind `record`.
//
// Turns red when (PLAN §8 SO6):
//   - the `concerns` advance is refused with a structure narrative recorded or
//     declined, or with an imported, unwithdrawn survey body; or accepted with
//     neither (a legacy `artifacts` row, a narrative of another section or subject,
//     a withdrawn narrative and a withdrawn or foreign imported body are not one);
//   - a fixture subsystem cannot be driven from `unmapped` to `mapped` through the
//     tools with no file written under storage, or the run leaves any file in
//     storage besides the database and the storage-git files;
//   - `register_artifact` or `rehash_artifact` accepts a hand-written kind, names
//     no record tool in its refusal, or refuses `other`;
//   - `describe_locus`'s narrative pointer names a file path, does not name the
//     structure narratives by record id with their revision, is not
//     `revision_bound` for a recorded narrative, or is served for a declination, a
//     withdrawn narrative or a legacy `artifacts` row;
//   - a composition item of kind `record` scores wrongly for an effective, a
//     superseded or a wrong-commit narrative or explanation, a missing or declined
//     row, a malformed reference or a worker that names another record; or a
//     manifest without a record item stops planning; or a store opened from a
//     legacy fixture still refuses the kind.
// Controls (a handler that refuses everything must be red): the climb reaches
// `mapped`, `other` is registered, listed and rehashed, and the effective
// narrative and explanation score pass.
//
// The gate drives the built handlers over fixtures it creates itself, in a
// temporary directory, and reads no real store.
//
//   exit 0  `GATE SO6 GREEN`          — every assertion held
//   exit 1  `GATE SO6 RED: <reason>`  — the first assertion that failed

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureBuilt } from "./scripts/ensure-built.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// A crash signature in this gate's output means the run never reached its
// assertion. Assertion detail is quoted from live errors, so it is scrubbed.
const CRASH_SIGNATURES = [
  "MODULE_NOT_FOUND",
  "Cannot find module",
  "ENOENT",
  "SyntaxError",
  "ReferenceError",
  "TypeError",
  "is not a function",
  "command not found",
  "ModuleNotFoundError",
  "ImportError",
  "Traceback (most recent call last)",
  "NameError",
  "AttributeError",
  "No such file or directory",
  "is not defined",
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

const failures = [];
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

/** Run `fn`, returning its refusal message, or null when it did not refuse. */
function refusal(fn) {
  try {
    const value = fn();
    if (value && typeof value === "object" && value.ok === false && value.error) {
      return String(value.error);
    }
    return null;
  } catch (error) {
    return String(error?.message ?? error);
  }
}

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** Hand-written kind → the record tools that replace it (PLAN §1.1, §2.5). */
const HAND_WRITTEN = {
  "onboarding-report": ["record_narrative", "record_project_profile", "record_runtime_boundary"],
  "entry-point": ["record_explanation", "record_narrative"],
  "master-plan": ["record_narrative"],
  "findings-index": ["add_finding"],
  "concern-checklist": ["add_concern", "record_territory_disposition"],
  "field-notes": ["add_field_note"],
  "subsystem-survey": ["record_narrative", "decline_narrative"],
  "seam-assessment": ["upsert_seam"],
  "dispatch-prompt": ["log_dispatch"],
};

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return String(result.stdout ?? "").trim();
}
function gitCommit(cwd, message) {
  spawnSync(
    "git",
    [
      "-c", "user.email=so6@localhost",
      "-c", "user.name=no-files-so6",
      "-c", "commit.gpgsign=false",
      "commit", "-q", "--no-verify", "-m", message,
    ],
    { cwd, encoding: "utf8" },
  );
}

/** Every file under `root`, relative, with the storage-git directory and the database files left out. */
function storageFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const rel = relative(root, full);
      if (name === ".git") continue;
      if (statSync(full).isDirectory()) walk(full);
      else if (!/^memory\.db(-wal|-shm|-journal)?$/.test(name)) out.push(rel);
    }
  };
  if (existsSync(root)) walk(root);
  return out.sort();
}

// --------------------------------------------------------------- the gate body

async function main(mods) {
  const { openDatabase, resolveProject, ensureProjectStorage, toolArrays, Database } = mods;
  const allTools = new Map(toolArrays.flat().map((td) => [td.name, td]));
  const call = (name, args, ctx) => {
    const td = allTools.get(name);
    if (!td) throw new Error(`no such tool: ${name}`);
    return td.handler(args, ctx);
  };

  const scratch = mkdtempSync(join(tmpdir(), "amanuensis-so6-"));
  process.env.AMANUENSIS_STORAGE_ROOT = join(scratch, "storage-root");
  const cleanups = [];

  /** A fresh workspace, store and open session. Every assertion that writes gets its own. */
  function world(label) {
    const ws = join(scratch, `ws-${label}`);
    mkdirSync(ws, { recursive: true });
    git(ws, "init", "-q");
    mods.writeCitedSources(ws, ["src/B-01/index.ts", "src/B-02/index.ts", "src/other.ts"]);
    git(ws, "add", "-A");
    gitCommit(ws, "seed");
    const project = resolveProject(ws, { selectionSource: "so6-no-files" });
    ensureProjectStorage(project, (databasePath) => openDatabase(databasePath).close());
    const db = openDatabase(project.dbPath);
    const ctx = { project, db, sessionId: null };
    cleanups.push(() => {
      try {
        ctx.db.close();
      } catch {
        /* the assertion already reported whatever broke */
      }
    });
    ctx.sessionId = call("start_session", { intent: `so6-${label}` }, ctx).session_id;
    // The files the server itself puts in storage when it creates it (identity,
    // initialisation record, storage-git ignore list): what the run adds to them
    // is what it wrote by hand.
    ctx.storageAtStart = storageFiles(project.storagePath);
    return ctx;
  }
  const filesAdded = (ctx) =>
    storageFiles(ctx.project.storagePath).filter((file) => !ctx.storageAtStart.includes(file));
  const headSha = (ctx) => git(ctx.project.workspacePath, "rev-parse", "HEAD");
  const statusOf = (ctx, id) =>
    ctx.db.prepare("SELECT status FROM subsystems WHERE id = ?").get(id)?.status ?? null;

  const evidence = (ctx, file, lines = "1-4") =>
    call(
      "add_evidence",
      { file_path: file, symbol: "Unit", line_range: lines, ref_sha: headSha(ctx), kind: "code-verified" },
      ctx,
    ).id;

  const BODY = "A request enters through the dispatcher, which hands it to one handler and returns that handler's answer.";
  const DECLINED = "The code does not say how this part is built beyond its file names.";

  const recordStructure = (ctx, id, over = {}) =>
    call(
      "record_narrative",
      {
        subject_type: "subsystem",
        subject_id: id,
        section: "structure",
        body: BODY,
        evidence_ids: [evidence(ctx, `src/${id}/index.ts`)],
        ref_sha: headSha(ctx),
        ...over,
      },
      ctx,
    );
  const declineStructure = (ctx, id) =>
    call(
      "decline_narrative",
      {
        subject_type: "subsystem",
        subject_id: id,
        section: "structure",
        reason: DECLINED,
        ref_sha: headSha(ctx),
      },
      ctx,
    );

  /** Climb `id` to `structural`: scoped, one structural claim, the vocabulary discharged. */
  function toStructural(ctx, id) {
    call("upsert_subsystem", { id, name: id, status: "unmapped" }, ctx);
    call("update_subsystem_status", { id, status: "scoping" }, ctx);
    call(
      "add_files_to_scope",
      {
        subsystem_id: id,
        ref_sha: headSha(ctx),
        files: [{ file_path: `src/${id}/index.ts`, why_in_scope: "fixture" }],
      },
      ctx,
    );
    const file = `src/${id}/index.ts`;
    call(
      "add_claim",
      {
        claim_id: `CL-${id}`,
        claim_key: mods.stableClaimKey(id, "key-type", `${file}:Unit`),
        subject_type: "symbol",
        subject_id: `${file}:Unit`,
        statement: `Unit is the type ${id} is built around.`,
        epistemic_kind: "observation",
        ref_sha: headSha(ctx),
        evidence_ids: [evidence(ctx, file)],
      },
      ctx,
    );
    call(
      "decline_domain_vocabulary",
      { subsystem_id: id, reason: "fixture subsystem: its seeded files coin no term of their own", ref_sha: headSha(ctx) },
      ctx,
    );
    call("update_subsystem_status", { id, status: "structural" }, ctx);
  }

  /** From `concerns` to `mapped`, through the same tools a survey uses. */
  function toMapped(ctx, id) {
    call("update_subsystem_status", { id, status: "concerns" }, ctx);
    const file = `src/${id}/index.ts`;
    call("add_concern", { code: `FIXTURE-${id}`, category: "cache", origin: "seeded" }, ctx);
    call(
      "set_disposition",
      {
        subsystem_id: id,
        concern_code: `FIXTURE-${id}`,
        classification: "ruled-out",
        evidence: `${file}:fixture@fixture-ref`,
        evidence_ids: [evidence(ctx, file)],
        evidence_quality: "code-verified",
        linchpin_dependent: false,
        rationale: "fixture disposition",
        ref_sha: headSha(ctx),
        pass_type: "survey",
      },
      ctx,
    );
    call("update_subsystem_status", { id, status: "adversarial" }, ctx);
    const unchallenged = ctx.db
      .prepare(
        `SELECT claim_id FROM claims c
          WHERE c.valid_until_sha IS NULL AND substr(c.claim_key, 1, length(?)) = ?
            AND NOT EXISTS (SELECT 1 FROM claim_challenge_outcomes o WHERE o.claim_id = c.claim_id)`,
      )
      .all(`${id}/`, `${id}/`);
    for (const row of unchallenged) {
      call(
        "record_claim_challenge",
        {
          claim_id: row.claim_id,
          outcome: "survived",
          challenge: "fixture probe: read the declaration and found nothing that would overturn it",
          ref_sha: headSha(ctx),
        },
        ctx,
      );
    }
    mods.examineScope(call, ctx, id);
    const sha = headSha(ctx);
    if (!ctx.db.prepare("SELECT 1 FROM git_state WHERE repo_id='default'").get()) {
      call("set_git_state", { canonical_branch: "main", onboarding_sha: sha }, ctx);
    }
    call("detect_changes", { current_sha: sha }, ctx);
    mods.dischargeExplanations(call, ctx, id, sha);
    call("update_subsystem_status", { id, status: "mapped" }, ctx);
  }

  const advanceToConcerns = (ctx, id) => call("update_subsystem_status", { id, status: "concerns" }, ctx);

  /** A subsystem held at `structural` that has no structure narrative. */
  function structuralWorld(label, id = "B-01") {
    const ctx = world(label);
    toStructural(ctx, id);
    return ctx;
  }

  /** An imported survey body, as SO7's import writes it: the file's bytes, retired by a withdrawal. */
  function importSurvey(ctx, id, over = {}) {
    const body = over.body ?? "# survey\n\nThe dispatcher hands each request to one handler.\n";
    const info = ctx.db
      .prepare(
        `INSERT INTO imported_artifacts (path, kind, subsystem_id, body, body_sha256, registered_hash, hash_matches, session_id)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(
        over.path ?? `${id}-survey.md`,
        over.kind ?? "subsystem-survey",
        over.subsystem ?? id,
        body,
        sha256(body),
        sha256(body),
        ctx.sessionId,
      );
    return { id: Number(info.lastInsertRowid), path: over.path ?? `${id}-survey.md` };
  }
  const withdrawImported = (ctx, path) =>
    ctx.db
      .prepare("INSERT INTO imported_artifact_withdrawals (path, reason, session_id) VALUES (?, 'fixture', ?)")
      .run(path, ctx.sessionId);

  // ------------------------------------------------- C: the climb and the prerequisite

  check("C1 a subsystem reaches mapped through the tools with a recorded structure narrative and no file under storage", () => {
    const ctx = structuralWorld("c1");
    recordStructure(ctx, "B-01");
    toMapped(ctx, "B-01");
    if (statusOf(ctx, "B-01") !== "mapped") return `the subsystem is ${statusOf(ctx, "B-01")}, not mapped`;
    const files = filesAdded(ctx);
    return files.length === 0
      ? null
      : `the run left ${files.length} file(s) in storage besides the database and storage-git files: ${files.join(", ")}`;
  });

  check("C2 a declined structure narrative admits the concerns advance, and the subsystem reaches mapped", () => {
    const ctx = structuralWorld("c2");
    declineStructure(ctx, "B-01");
    toMapped(ctx, "B-01");
    const files = filesAdded(ctx);
    if (files.length > 0) return `the run left file(s) in storage: ${files.join(", ")}`;
    return statusOf(ctx, "B-01") === "mapped" ? null : `the subsystem is ${statusOf(ctx, "B-01")}`;
  });

  check("C3 the concerns advance is refused with no structure narrative, names the record tools, and leaves the status", () => {
    const ctx = structuralWorld("c3");
    const said = refusal(() => advanceToConcerns(ctx, "B-01"));
    if (!said) return "the advance was accepted with no narrative and no import";
    if (!said.includes("record_narrative") || !said.includes("decline_narrative")) {
      return `the refusal names no record tool: ${said.slice(0, 200)}`;
    }
    if (/register_artifact|subsystem-survey/.test(said)) return `the refusal still asks for a file: ${said.slice(0, 200)}`;
    return statusOf(ctx, "B-01") === "structural" ? null : `the status moved to ${statusOf(ctx, "B-01")}`;
  });

  check("C4 a legacy artifacts row, a narrative of another section or subject, and a foreign or other-kind imported body are not a structure narrative", () => {
    const ctx = structuralWorld("c4");
    toStructural(ctx, "B-02");
    // The legacy registry row, written by SQL as an earlier server did.
    ctx.db
      .prepare(
        `INSERT INTO artifacts (path, kind, subsystem_id, content_hash, session_id)
         VALUES ('B-01-survey.md', 'subsystem-survey', 'B-01', ?, ?)`,
      )
      .run(sha256("x"), ctx.sessionId);
    // A structure narrative of the other subsystem, and a project narrative.
    recordStructure(ctx, "B-02");
    call(
      "record_narrative",
      {
        subject_type: "project",
        section: "survey-plan",
        body: "Survey the dispatcher first, then the stores it writes to.",
        ref_sha: headSha(ctx),
      },
      ctx,
    );
    // Imported bodies that are not this subsystem's survey.
    importSurvey(ctx, "B-01", { subsystem: "B-02", path: "B-02-survey.md" });
    importSurvey(ctx, "B-01", { kind: "entry-point", path: "entry-point.md" });
    const said = refusal(() => advanceToConcerns(ctx, "B-01"));
    return said ? null : "the advance was accepted on none of a structure narrative or an imported survey body of this subsystem";
  });

  check("C5 an imported, unwithdrawn survey body admits the advance; once withdrawn it does not", () => {
    const ctx = structuralWorld("c5");
    const imported = importSurvey(ctx, "B-01");
    const accepted = refusal(() => advanceToConcerns(ctx, "B-01"));
    if (accepted) return `an imported survey body was refused: ${accepted.slice(0, 200)}`;
    if (statusOf(ctx, "B-01") !== "concerns") return `the status is ${statusOf(ctx, "B-01")} after the advance`;
    const other = structuralWorld("c5b");
    const second = importSurvey(other, "B-01");
    withdrawImported(other, second.path);
    return refusal(() => advanceToConcerns(other, "B-01"))
      ? null
      : `a withdrawn imported body (${imported.path}) still admits the advance`;
  });

  check("C6 a reset withdraws the narrative, so the re-advance is refused until a new one is recorded", () => {
    const ctx = structuralWorld("c6");
    recordStructure(ctx, "B-01");
    advanceToConcerns(ctx, "B-01");
    call("reset_subsystem", { id: "B-01", to_status: "structural", reason: "fixture reset to read again" }, ctx);
    if (statusOf(ctx, "B-01") !== "structural") return `the reset left ${statusOf(ctx, "B-01")}`;
    if (!refusal(() => advanceToConcerns(ctx, "B-01"))) return "the advance was accepted over a withdrawn narrative";
    recordStructure(ctx, "B-01", { body: `${BODY} It is read again.` });
    return refusal(() => advanceToConcerns(ctx, "B-01")) ? "a new narrative did not admit the advance" : null;
  });

  // ------------------------------------------------- R: register_artifact, rehash_artifact

  check("R1 register_artifact refuses every hand-written kind, naming the record tool, and stores nothing", () => {
    const ctx = world("r1");
    for (const [kind, tools] of Object.entries(HAND_WRITTEN)) {
      const said = refusal(() =>
        call("register_artifact", { path: `${kind}.md`, kind, subsystem_id: kind === "subsystem-survey" ? "B-01" : undefined }, ctx),
      );
      if (!said) return `register_artifact accepted kind ${kind}`;
      if (!said.startsWith("register_artifact refuses")) {
        return `the refusal of ${kind} does not begin "register_artifact refuses": ${said.slice(0, 160)}`;
      }
      if (!tools.some((tool) => said.includes(tool))) {
        return `the refusal of ${kind} names none of ${tools.join(", ")}: ${said.slice(0, 200)}`;
      }
    }
    const rows = ctx.db.prepare("SELECT COUNT(*) AS n FROM artifacts").get().n;
    return rows === 0 ? null : `${rows} artifacts row(s) were stored by refused registrations`;
  });

  check("R2 register_artifact accepts kind other, hashes its file, and list_artifacts returns it", () => {
    const ctx = world("r2");
    const body = "# review export\n\nOne line.\n";
    writeFileSync(join(ctx.project.storagePath, "export.md"), body);
    const receipt = call("register_artifact", { path: "export.md", kind: "other", ref_sha: headSha(ctx) }, ctx);
    if (receipt.content_hash !== sha256(body)) return `the receipt's hash is ${receipt.content_hash}`;
    const upfront = refusal(() => call("register_artifact", { path: "later.md", kind: "other" }, ctx));
    if (upfront) return `an upfront registration of kind other was refused: ${upfront.slice(0, 160)}`;
    const listed = call("list_artifacts", { kind: "other" }, ctx);
    if (!Array.isArray(listed) || listed.length !== 2) return `list_artifacts returned ${JSON.stringify(listed).slice(0, 160)}`;
    const row = listed.find((r) => r.path === "export.md");
    if (!row || row.bytes !== Buffer.byteLength(body)) return "the registered row does not carry the file's size";
    writeFileSync(join(ctx.project.storagePath, "export.md"), `${body}A second line.\n`);
    const again = call("rehash_artifact", { path: "export.md" }, ctx);
    if (!again.ok || again.content_hash !== sha256(`${body}A second line.\n`)) {
      return `rehash_artifact of kind other returned ${JSON.stringify(again).slice(0, 160)}`;
    }
    return null;
  });

  check("R3 rehash_artifact refuses a registered hand-written kind and leaves its hash", () => {
    const ctx = world("r3");
    writeFileSync(join(ctx.project.storagePath, "entry-point.md"), "# entry\n");
    ctx.db
      .prepare(
        `INSERT INTO artifacts (path, kind, content_hash, session_id) VALUES ('entry-point.md', 'entry-point', ?, ?)`,
      )
      .run(sha256("old"), ctx.sessionId);
    const said = refusal(() => call("rehash_artifact", { path: "entry-point.md" }, ctx));
    if (!said) return "rehash_artifact accepted a registered entry-point";
    if (!said.startsWith("rehash_artifact refuses")) return `the refusal does not begin "rehash_artifact refuses": ${said.slice(0, 160)}`;
    if (!said.includes("record_explanation") && !said.includes("record_narrative")) {
      return `the refusal names no record tool: ${said.slice(0, 200)}`;
    }
    const held = ctx.db.prepare("SELECT content_hash FROM artifacts WHERE path = 'entry-point.md'").get();
    return held.content_hash === sha256("old") ? null : "the refused rehash changed the stored hash";
  });

  check("R4 an unknown kind is still refused", () => {
    const ctx = world("r4");
    return refusal(() => call("register_artifact", { path: "x.md", kind: "no-such-kind" }, ctx))
      ? null
      : "register_artifact accepted a kind that is not on the list";
  });

  // ------------------------------------------------- L: describe_locus's narrative pointer

  const SECTIONS = ["purpose", "structure", "defects", "reviews", "boundaries", "terms", "leads", "history_pointer"];
  const pointerOf = (ctx, id) => {
    const payload = call("describe_locus", { locus: id, sections: SECTIONS }, ctx);
    const section = payload?.sections?.structure;
    if (!section) throw new Error("the response carries no structure section");
    if ((section.items ?? []).length !== 0) throw new Error("the fixture subsystem carries a claim; the pointer is only for none");
    return section.narrative;
  };
  /** A subsystem with no claim at `concerns`, so the structure section falls back to the narrative pointer. */
  function claimlessWorld(label) {
    const ctx = world(label);
    ctx.db.prepare("INSERT INTO subsystems (id, name, status) VALUES ('B-01', 'B-01', 'concerns')").run();
    ctx.db
      .prepare(
        `INSERT INTO file_ledger (subsystem_id, file_path, why_in_scope, classification, ref_sha)
         VALUES ('B-01', 'src/B-01/index.ts', 'fixture', 'examined', ?)`,
      )
      .run(headSha(ctx));
    return ctx;
  }
  const FILE_WORDS = /artifact_path|\.md\b|storage|survey\.md/;

  check("L1 a recorded structure narrative is pointed at by record id and revision, bound to it, with no path", () => {
    const ctx = claimlessWorld("l1");
    const first = recordStructure(ctx, "B-01", { topic: "dispatch" });
    const second = recordStructure(ctx, "B-01", { topic: "storage", body: `${BODY} It then writes the row.` });
    const pointer = pointerOf(ctx, "B-01");
    if (!pointer) return "no narrative pointer is served for a subsystem with a recorded structure narrative";
    const text = JSON.stringify(pointer);
    if (FILE_WORDS.test(text)) return `the pointer names a file: ${text.slice(0, 200)}`;
    const ids = [...(pointer.record_ids ?? [])].sort((a, b) => a - b);
    const want = [Number(first.id ?? first.narrative_id), Number(second.id ?? second.narrative_id)].sort((a, b) => a - b);
    if (JSON.stringify(ids) !== JSON.stringify(want)) {
      return `the pointer names records ${JSON.stringify(pointer.record_ids ?? null)}, expected ${JSON.stringify(want)}`;
    }
    if (pointer.revision_bound !== true) return "a recorded narrative is not marked revision_bound: true";
    if (pointer.ref_sha !== headSha(ctx)) return `the pointer's revision is ${pointer.ref_sha}`;
    return typeof pointer.label === "string" && pointer.label.length > 0 ? null : "the pointer carries no label";
  });

  check("L2 a declination, a legacy artifacts row and a withdrawn narrative serve no pointer", () => {
    const declined = claimlessWorld("l2a");
    declineStructure(declined, "B-01");
    if (pointerOf(declined, "B-01")) return "a pointer is served for a declination, which holds no prose";
    const legacy = claimlessWorld("l2b");
    legacy.db
      .prepare(
        `INSERT INTO artifacts (path, kind, subsystem_id, content_hash, session_id)
         VALUES ('B-01-survey.md', 'subsystem-survey', 'B-01', ?, ?)`,
      )
      .run(sha256("x"), legacy.sessionId);
    if (pointerOf(legacy, "B-01")) return "a pointer is served for a legacy artifacts row";
    const reset = claimlessWorld("l2c");
    recordStructure(reset, "B-01");
    if (!pointerOf(reset, "B-01")) return "no pointer is served before the reset";
    call("reset_subsystem", { id: "B-01", to_status: "structural", reason: "fixture reset to read again" }, reset);
    return pointerOf(reset, "B-01") ? "a pointer is served for a withdrawn narrative" : null;
  });

  check("L3 an imported survey body is pointed at by its record id, unbound, with no path, and not when withdrawn", () => {
    const ctx = claimlessWorld("l3");
    const imported = importSurvey(ctx, "B-01", { path: "subsystems/B-01-index.md" });
    const pointer = pointerOf(ctx, "B-01");
    if (!pointer) return "no pointer is served for an imported survey body";
    const text = JSON.stringify(pointer);
    if (FILE_WORDS.test(text) || text.includes("subsystems/")) return `the pointer names a file: ${text.slice(0, 200)}`;
    if (!text.includes(String(imported.id))) return `the pointer does not carry the imported record id ${imported.id}: ${text.slice(0, 200)}`;
    if (pointer.revision_bound !== false) return "an imported body is marked revision_bound";
    withdrawImported(ctx, imported.path);
    return pointerOf(ctx, "B-01") ? "a pointer is served for a withdrawn imported body" : null;
  });

  // §2.5: the pointer names each record "with its revision". Two topics
  // recorded at different commits were served with only the newer one's
  // revision beside both ids (F6/codex, slice-S1).
  check("L5 narratives recorded at different revisions are each served with their own revision", () => {
    const ctx = claimlessWorld("l5");
    const first = recordStructure(ctx, "B-01", { topic: "dispatch" });
    const firstSha = headSha(ctx);
    const ws = ctx.project.workspacePath;
    writeFileSync(join(ws, "later.txt"), "a later commit\n");
    git(ws, "add", "later.txt");
    gitCommit(ws, "later");
    const secondSha = headSha(ctx);
    if (secondSha === firstSha) return "the fixture could not make a second commit";
    const second = recordStructure(ctx, "B-01", { topic: "storage", body: `${BODY} It then writes the row.` });
    const pointer = pointerOf(ctx, "B-01");
    if (!pointer) return "no narrative pointer is served";
    const want = [
      { id: Number(first.id ?? first.narrative_id), ref_sha: firstSha },
      { id: Number(second.id ?? second.narrative_id), ref_sha: secondSha },
    ];
    const served = [...(pointer.records ?? [])]
      .map((r) => ({ id: Number(r.id), ref_sha: r.ref_sha }))
      .sort((a, b) => a.id - b.id);
    if (JSON.stringify(served) !== JSON.stringify(want)) {
      return `the pointer serves ${JSON.stringify(pointer.records ?? null)}, expected ${JSON.stringify(want)}`;
    }
    if (pointer.ref_sha === firstSha || pointer.ref_sha === secondSha) {
      return `the pointer names one revision (${pointer.ref_sha}) for records bound to two`;
    }
    return null;
  });

  check("L4 a subsystem with no narrative serves no pointer", () => {
    const ctx = claimlessWorld("l4");
    return pointerOf(ctx, "B-01") ? "a pointer is served with nothing recorded" : null;
  });

  // ------------------------------------------------- K: composition's record item

  const composition = buildComposition();
  function buildComposition() {
    const root = join(scratch, "composition");
    const workspace = join(root, "workspace");
    const storage = join(root, "storage");
    mkdirSync(join(workspace, "src"), { recursive: true });
    mkdirSync(storage, { recursive: true });
    git(workspace, "init", "-q");
    const write = (version) => {
      writeFileSync(join(workspace, "src/producer.mjs"), `export const version = ${version};\n`);
      writeFileSync(join(workspace, "src/consumer.mjs"), "export const accepted = [1];\n");
    };
    write(1);
    git(workspace, "add", "src");
    gitCommit(workspace, "base");
    const base = git(workspace, "rev-parse", "HEAD");
    write(2);
    git(workspace, "add", "src");
    gitCommit(workspace, "producer v2");
    const head = git(workspace, "rev-parse", "HEAD");
    const project = {
      workspacePath: workspace,
      projectKey: "test/so6-composition",
      storagePath: storage,
      dbPath: join(storage, "memory.db"),
      storageGitReady: false,
    };
    const db = openDatabase(project.dbPath);
    cleanups.push(() => db.close());
    const ctx = { project, db, sessionId: null };
    ctx.sessionId = call("start_session", { intent: "so6-composition" }, ctx).session_id;
    for (const [id, name] of [["P", "producer"], ["C", "consumer"]]) {
      db.prepare("INSERT INTO subsystems (id, name, status) VALUES (?, ?, 'mapped')").run(id, name);
    }
    for (const [subsystem, path] of [["P", "src/producer.mjs"], ["C", "src/consumer.mjs"]]) {
      db.prepare(
        `INSERT INTO file_ledger (subsystem_id, file_path, why_in_scope, classification, ref_sha, examined_at)
         VALUES (?, ?, 'composition fixture', 'examined', ?, datetime('now'))`,
      ).run(subsystem, path, base);
    }
    db.prepare(
      `INSERT INTO seams (id, shared_object, shared_object_kind, party_a, party_b, ordering_assumption, schema_owner)
       VALUES ('S-PC', 'event version', 'event-bus', 'P', 'C', 'producer before consumer', 'P')`,
    ).run();
    db.prepare(
      `INSERT INTO concerns (code, category, origin, status, notes) VALUES ('SC-1', 'seam-contract', 'seeded', 'active', 'Version compatibility')`,
    ).run();
    return { ctx, base, head, workspace };
  }

  function planWith(label, recordItems) {
    const { ctx, base, head } = composition;
    const impactId = `${label}:impact`;
    call("predict_change_impact", { base_sha: base, head_sha: head, run_id: impactId }, ctx);
    const item = (id, kind, scope, subject, ref) => ({
      item_id: `${label}:${id}`,
      item_kind: kind,
      verification_scope: scope,
      subject,
      expected_ref: ref,
      target_sha: head,
    });
    return call(
      "plan_composition_run",
      {
        run_id: label,
        impact_run_id: impactId,
        assembled_head_sha: head,
        expected_items: [
          item("artifact", "artifact", "unit", "producer artifact", "export.md"),
          item("commit", "commit", "unit", "producer commit", head),
          item("unit-test", "test", "unit", "producer unit test", "test/unit.mjs"),
          item("unit-review", "review-result", "unit", "unit review", "review-unit"),
          item("integral-test", "test", "integral-head", "contract", "test/integral.mjs"),
          item("integral-review", "review-result", "integral-head", "integral review", "review-integral"),
          ...recordItems.map(([id, ref, sha]) => ({
            ...item(id, "record", "unit", `record ${id}`, ref),
            target_sha: sha ?? head,
          })),
        ],
        seam_concerns: [{ seam_id: "S-PC", concern_code: "SC-1", rationale: "Producer output stays inside the consumer's set." }],
      },
      ctx,
    );
  }
  const scoreRecord = (label, id, observation) => {
    const { ctx } = composition;
    call("dispatch_composition_item", { run_id: label, item_id: `${label}:${id}` }, ctx);
    call("land_composition_item", { run_id: label, item_id: `${label}:${id}`, observation }, ctx);
    return call("score_composition_item", { run_id: label, item_id: `${label}:${id}` }, ctx);
  };
  const projectNarrative = (section, body, extra = {}) =>
    call(
      "record_narrative",
      { subject_type: "project", section, body, ref_sha: composition.head, ...extra },
      composition.ctx,
    );
  const verdictOf = (label, id, ref) => scoreRecord(label, id, { record_ref: ref });

  check("K1 a plan with no record item still plans, and a plan with one is accepted", () => {
    const withoutRecord = refusal(() => planWith("k1-plain", []));
    if (withoutRecord) return `a manifest without a record item stopped planning: ${withoutRecord.slice(0, 200)}`;
    const narrative = projectNarrative("survey-plan", "Survey the producer first.");
    const withRecord = refusal(() => planWith("k1-record", [["rec", `narrative:${narrative.id}`]]));
    return withRecord ? `a manifest with a record item was refused: ${withRecord.slice(0, 200)}` : null;
  });

  check("K2 an effective narrative recorded at the target commit scores pass", () => {
    const narrative = projectNarrative("repository-shape", "The producer emits one event version.", {
      evidence_ids: [evidence(composition.ctx, "src/producer.mjs", "1-1")],
    });
    const ref = `narrative:${narrative.id}`;
    planWith("k2", [["rec", ref]]);
    const score = verdictOf("k2", "rec", ref);
    return score.verdict === "pass" ? null : `the verdict is ${score.verdict}: ${JSON.stringify(score).slice(0, 240)}`;
  });

  check("K3 a superseded narrative scores fail, and the row that supersedes it scores pass", () => {
    const old = projectNarrative("survey-plan", "Survey the producer first, then the consumer.", { topic: "order" });
    const fresh = projectNarrative("survey-plan", "Survey the consumer first, then the producer.", { topic: "order" });
    planWith("k3", [["old", `narrative:${old.id}`], ["new", `narrative:${fresh.id}`]]);
    const stale = verdictOf("k3", "old", `narrative:${old.id}`);
    if (stale.verdict !== "fail") return `the superseded narrative scored ${stale.verdict}`;
    const current = verdictOf("k3", "new", `narrative:${fresh.id}`);
    return current.verdict === "pass" ? null : `the superseding narrative scored ${current.verdict}`;
  });

  check("K4 a narrative recorded at another commit scores fail", () => {
    const { ctx, base } = composition;
    const early = call(
      "record_narrative",
      { subject_type: "project", section: "survey-plan", topic: "early", body: "Survey the producer.", ref_sha: base },
      ctx,
    );
    planWith("k4", [["rec", `narrative:${early.id}`]]);
    const score = verdictOf("k4", "rec", `narrative:${early.id}`);
    return score.verdict === "fail" ? null : `a narrative recorded at ${base.slice(0, 8)}, scored against ${composition.head.slice(0, 8)}, passed`;
  });

  check("K5 a missing row, a declination, a malformed reference and a worker naming another record score fail", () => {
    const { ctx } = composition;
    const declined = call(
      "decline_narrative",
      { subject_type: "project", section: "survey-plan", topic: "declined", reason: "No plan is written for this survey.", ref_sha: composition.head },
      ctx,
    );
    const real = projectNarrative("survey-plan", "Survey the producer.", { topic: "real" });
    planWith("k5", [
      ["missing", "narrative:999999"],
      ["declined", `narrative:${declined.id}`],
      ["malformed", "producer.md"],
      ["other", `narrative:${real.id}`],
    ]);
    for (const [id, ref, observed] of [
      ["missing", "narrative:999999", "narrative:999999"],
      ["declined", `narrative:${declined.id}`, `narrative:${declined.id}`],
      ["malformed", "producer.md", "producer.md"],
      ["other", `narrative:${real.id}`, "narrative:1"],
    ]) {
      const score = verdictOf("k5", id, observed);
      if (score.verdict !== "fail") return `${id} (${ref}) scored ${score.verdict}`;
    }
    return null;
  });

  check("K6 an effective explanation scores pass, a superseded one fails", () => {
    const { ctx, head } = composition;
    const cited = [evidence(ctx, "src/producer.mjs", "1-1")];
    const record = (body) =>
      call(
        "record_explanation",
        { subject_type: "subsystem", subject_id: "P", slot: "account", body, evidence_ids: cited, ref_sha: head },
        ctx,
      );
    const old = record("The producer emits one event version and nothing else.");
    const fresh = record("The producer emits one event version, which the consumer must accept.");
    planWith("k6", [["old", `explanation:${old.id}`], ["new", `explanation:${fresh.id}`]]);
    const stale = verdictOf("k6", "old", `explanation:${old.id}`);
    if (stale.verdict !== "fail") return `the superseded explanation scored ${stale.verdict}`;
    const current = verdictOf("k6", "new", `explanation:${fresh.id}`);
    return current.verdict === "pass" ? null : `the effective explanation scored ${current.verdict}`;
  });

  check("K7 a store opened from a legacy fixture accepts the record item kind", () => {
    const dump = join(here, "fixtures", "legacy-stores", "axiomdb-shaped", "memory.sql");
    if (!existsSync(dump)) return "fixtures/legacy-stores/axiomdb-shaped/memory.sql is absent";
    const path = join(scratch, "legacy-so6.db");
    const raw = new Database(path);
    try {
      raw.exec(readFileSync(dump, "utf8"));
    } finally {
      raw.close();
    }
    const db = openDatabase(path);
    try {
      const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'composition_items'").get()?.sql ?? "";
      if (!sql.includes("'record'")) return "composition_items still refuses the record kind after the store is opened";
      for (const kind of ["artifact", "commit", "test", "review-result"]) {
        if (!sql.includes(`'${kind}'`)) return `the rebuilt composition_items lost the ${kind} kind`;
      }
      return null;
    } finally {
      db.close();
    }
  });

  for (const cleanup of cleanups) cleanup();
  rmSync(scratch, { recursive: true, force: true });
}

// ------------------------------------------------------------------- the driver

let exitCode = 0;
try {
  // Load the subject defensively: an absent build or module must produce this
  // gate's red line, not a stack trace. `dist/` is a build artifact, so the
  // gate compiles it first; a compile failure is this gate's red line.
  const built = ensureBuilt();
  const mods = {};
  let loadError = null;
  try {
    if (!built.ok) throw new Error(built.detail);
    ({ openDatabase: mods.openDatabase } = await import("./dist/db.js"));
    ({ resolveProject: mods.resolveProject, ensureProjectStorage: mods.ensureProjectStorage } =
      await import("./dist/project.js"));
    mods.Database = (await import("better-sqlite3")).default;
    ({ writeCitedSources: mods.writeCitedSources } = await import("./fixtures/cited-source.mjs"));
    ({ stableClaimKey: mods.stableClaimKey } = await import("./fixtures/claim-key.mjs"));
    ({ examineScope: mods.examineScope } = await import("./fixtures/examine-scope.mjs"));
    ({ dischargeExplanations: mods.dischargeExplanations } = await import("./fixtures/explanation-discharge.mjs"));
    const [
      artifacts, claims, composition, concerns, dispositions, evidence, explanations, files, git, impact,
      narratives, project, subsystems, vocabulary,
    ] = await Promise.all([
      import("./dist/tools/artifacts.js"),
      import("./dist/tools/claims.js"),
      import("./dist/tools/composition.js"),
      import("./dist/tools/concerns.js"),
      import("./dist/tools/dispositions.js"),
      import("./dist/tools/evidence.js"),
      import("./dist/tools/explanations.js"),
      import("./dist/tools/files.js"),
      import("./dist/tools/git.js"),
      import("./dist/tools/impact.js"),
      import("./dist/tools/narratives.js"),
      import("./dist/tools/project.js"),
      import("./dist/tools/subsystems.js"),
      import("./dist/tools/vocabulary.js"),
    ]);
    const locus = await import("./dist/tools/locus.js");
    mods.toolArrays = [
      artifacts.artifactTools,
      claims.claimTools,
      composition.compositionTools,
      concerns.concernTools,
      dispositions.dispositionTools,
      evidence.evidenceTools,
      explanations.explanationTools,
      files.fileTools,
      git.gitTools,
      impact.impactTools,
      locus.locusTools,
      narratives.narrativeTools,
      project.projectTools,
      subsystems.subsystemTools,
      vocabulary.vocabularyTools,
    ];
  } catch (error) {
    loadError = `the server build could not be loaded: ${scrub(error?.message ?? error)}`;
  }

  if (loadError) {
    checked++;
    failures.push(`X1 ${loadError}`);
  } else {
    await main(mods);
  }
} catch (error) {
  failures.push(`X9 the gate did not finish: ${scrub(error?.message ?? error)}`);
}

console.log(`  ran  ${checked} assertion(s) against ${join(here, "dist")}`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  console.log(`GATE SO6 RED: ${failures[0]}`);
  exitCode = 1;
} else {
  console.log("GATE SO6 GREEN");
}
process.exit(exitCode);
