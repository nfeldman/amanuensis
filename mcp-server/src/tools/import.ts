import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { ok, optBool, optString, type ServerContext, type ToolDefinition } from "../helpers.js";
import { requireActiveSession } from "../invariants.js";
import { resolveArtifactPath } from "./artifacts.js";
import { findMaterializer } from "./materialize.js";

/**
 * The kinds an earlier version had the survey write by hand (PLAN store-only
 * §1.1). `other` is the server's own exports and is not imported.
 */
const HAND_WRITTEN = [
  "onboarding-report",
  "entry-point",
  "master-plan",
  "findings-index",
  "concern-checklist",
  "field-notes",
  "subsystem-survey",
  "seam-assessment",
  "dispatch-prompt",
] as const;

interface RegisteredRow {
  path: string;
  kind: string;
  subsystem_id: string | null;
  content_hash: string | null;
  ref_sha: string | null;
  written_at: string | null;
}

interface Body {
  row: RegisteredRow;
  body: string;
  sha: string;
  bytes: number;
  hashMatches: 0 | 1;
}

interface RuntimeRow {
  from_runtime: string;
  from_language: string | null;
  to_runtime: string;
  mechanism: string;
  notes: string | null;
}

/** What `legacy_extract` printed: the thesis, the project name and the runtime rows the files carry. */
interface Extraction {
  thesis: { state: string; text: string | null; violations: string[] };
  project_name: string | null;
  runtime_boundaries: RuntimeRow[];
  runtime_boundaries_skipped: string[];
}

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/**
 * One registered file's bytes, or why they cannot be imported. The path is
 * contained in storage by the check `register_artifact` uses; the bytes must
 * be UTF-8 that decodes back to themselves, or the stored text would not be
 * the file. A file that is not there is a reason, not an error (PLAN §5.2).
 */
function readBody(storagePath: string, row: RegisteredRow): Body | { reason: string } {
  let abs: string;
  try {
    abs = resolveArtifactPath(storagePath, row.path);
  } catch {
    return { reason: "the path leads outside the storage directory, so it is not read" };
  }
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(abs);
  } catch {
    return { reason: "no file is at this path under storage" };
  }
  if (!stat.isFile()) return { reason: "the path is not a regular file" };
  let bytes: Buffer;
  try {
    bytes = readFileSync(abs);
  } catch (error) {
    return { reason: `the file could not be read: ${(error as Error).message}` };
  }
  let body: string;
  try {
    body = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return { reason: "the file is not UTF-8 text" };
  }
  if (!Buffer.from(body, "utf8").equals(bytes)) return { reason: "the file is not UTF-8 text" };
  const sha = sha256(bytes);
  return { row, body, sha, bytes: bytes.length, hashMatches: row.content_hash === sha ? 1 : 0 };
}

/**
 * Run the materializer's `legacy_extract` over the storage directory, as
 * `orientation-lint.ts` runs the lint: the thesis, the name and the runtime
 * table are read by the functions that print them, so there is one copy of
 * each rule. Returns the reading, or why it could not be taken.
 */
function extract(storagePath: string): Extraction | { reason: string } {
  const script = findMaterializer();
  if (!script) return { reason: "the materializer was not found beside the server" };
  const python = process.env.AMANUENSIS_PYTHON ?? "python3";
  const result = spawnSync(
    python,
    [
      "-I",
      "-c",
      [
        "import sys",
        "sys.path.insert(0, sys.argv[1])",
        "from amanuensis_materializer.legacy_extract import main",
        "raise SystemExit(main(sys.argv[2:]))",
      ].join("\n"),
      dirname(script),
      storagePath,
    ],
    // SIGKILL: the extraction holds no state, and an interpreter that ignored
    // SIGTERM would keep the server blocked past the bound.
    { encoding: "utf8", timeout: 60_000, killSignal: "SIGKILL" },
  );
  if (result.error || result.status !== 0) {
    const why = result.error?.message ?? (result.stderr.trim() || `exit ${result.status}`);
    return { reason: `the materializer's extraction did not run: ${why.split("\n").pop()}` };
  }
  try {
    return JSON.parse(result.stdout) as Extraction;
  } catch {
    return { reason: "the materializer's extraction did not print JSON" };
  }
}

/** The revision an extracted record is bound to: its file's registered revision, else onboarding's. */
function revisionOf(ctx: ServerContext, path: string): string | null {
  const registered = ctx.db.prepare("SELECT ref_sha FROM artifacts WHERE path = ?").get(path) as
    | { ref_sha: string | null }
    | undefined;
  if (registered?.ref_sha) return registered.ref_sha;
  const onboarding = ctx.db.prepare("SELECT onboarding_sha FROM git_state LIMIT 1").get() as
    | { onboarding_sha: string | null }
    | undefined;
  return onboarding?.onboarding_sha ?? null;
}

const count = (ctx: ServerContext, sql: string, ...params: unknown[]) =>
  (ctx.db.prepare(sql).get(...params) as { n: number }).n;

export const importTools: ToolDefinition[] = [
  {
    name: "import_artifact_bodies",
    description:
      "Copy every file an earlier version had the survey write by hand (onboarding report, entry point, master plan, findings index, concern checklist, field notes, subsystem surveys, seam assessments, dispatch prompts) into the store, as written: for each registered row of those kinds not yet imported, the file's bytes under storage, their sha256, the registered hash and whether the two still match. A missing file, a path outside storage or bytes that are not UTF-8 are reported and imported as nothing; the rest are imported. Then, with the materializer's own functions, it copies the thesis of entry-point.md in as the project's purpose (disposition 'imported', no evidence), the codebase line of the onboarding report as the project's name, and its runtime boundary table as runtime boundaries (origin 'imported'), each only where nothing is recorded yet. Nothing else is parsed: no claim, concern or narrative is created. No file is written, moved or deleted. Running it again imports nothing new. dry_run reports what would be imported and writes nothing. Requires an active session.",
    inputSchema: {
      type: "object",
      properties: { dry_run: { type: "boolean" } },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const sessionId = requireActiveSession(ctx, "import_artifact_bodies");
      const dryRun = optBool(args, "dry_run");
      const kinds = HAND_WRITTEN.map(() => "?").join(", ");
      const pending = ctx.db
        .prepare(
          `SELECT path, kind, subsystem_id, content_hash, ref_sha, written_at FROM artifacts
            WHERE kind IN (${kinds}) AND path NOT IN (SELECT path FROM imported_artifacts)
            ORDER BY path`,
        )
        .all(...HAND_WRITTEN) as RegisteredRow[];
      const alreadyImported = count(
        ctx,
        `SELECT COUNT(*) AS n FROM artifacts WHERE kind IN (${kinds}) AND path IN (SELECT path FROM imported_artifacts)`,
        ...HAND_WRITTEN,
      );

      const bodies: Body[] = [];
      const notImported: Array<{ path: string; kind: string; reason: string }> = [];
      for (const row of pending) {
        const read = readBody(ctx.project.storagePath, row);
        if ("reason" in read)
          notImported.push({ path: row.path, kind: row.kind, reason: read.reason });
        else bodies.push(read);
      }

      // The extraction reads only from files that are, or are about to be,
      // imported, so every extracted record has its source in the store.
      const importedKinds = new Set(
        (
          ctx.db.prepare("SELECT DISTINCT kind FROM imported_artifacts").all() as Array<{
            kind: string;
          }>
        ).map((r) => r.kind),
      );
      for (const body of bodies) importedKinds.add(body.row.kind);
      const sourceOf = (kind: string) =>
        bodies.find((b) => b.row.kind === kind)?.row.path ??
        (
          ctx.db
            .prepare("SELECT path FROM imported_artifacts WHERE kind = ? ORDER BY id LIMIT 1")
            .get(kind) as { path: string } | undefined
        )?.path ??
        null;
      const entryPoint = importedKinds.has("entry-point") ? sourceOf("entry-point") : null;
      const onboarding = importedKinds.has("onboarding-report")
        ? sourceOf("onboarding-report")
        : null;

      const extraction: { ran: boolean; reason?: string } = { ran: false };
      let reading: Extraction | null = null;
      if (entryPoint || onboarding) {
        const result = extract(ctx.project.storagePath);
        if ("reason" in result) {
          extraction.reason = `${result.reason}. Run the import again once it can.`;
        } else {
          extraction.ran = true;
          reading = result;
        }
      } else {
        extraction.reason = "no entry point or onboarding report is imported";
      }

      // The thesis: the project's purpose, unless one is recorded (D2).
      let thesis: Record<string, unknown> = { outcome: "not-read" };
      let thesisRow: { body: string; ref_sha: string } | null = null;
      if (reading && entryPoint) {
        const existing = count(
          ctx,
          "SELECT COUNT(*) AS n FROM explanations WHERE subject_type = 'project' AND slot = 'purpose'",
        );
        const refSha = revisionOf(ctx, entryPoint);
        if (existing > 0) {
          thesis = { outcome: "kept", detail: "a project purpose is already in the store" };
        } else if (reading.thesis.state !== "filled" || !reading.thesis.text) {
          thesis = { outcome: reading.thesis.state, violations: reading.thesis.violations };
        } else if (!refSha) {
          thesis = {
            outcome: "no-revision",
            detail: "neither the entry point nor onboarding records a revision",
          };
        } else {
          thesisRow = { body: reading.thesis.text, ref_sha: refSha };
          thesis = { outcome: "imported", ref_sha: refSha };
        }
      }

      // The project's name: the codebase line, unless a name is recorded.
      let name: Record<string, unknown> = { outcome: "not-read" };
      let nameRow: { name: string; ref_sha: string } | null = null;
      const boundaryRows: RuntimeRow[] = [];
      const boundaryKept: string[] = [];
      let boundaryRef: string | null = null;
      if (reading && onboarding) {
        boundaryRef = revisionOf(ctx, onboarding);
        if (count(ctx, "SELECT COUNT(*) AS n FROM project_profile") > 0) {
          name = { outcome: "kept", detail: "a project name is already in the store" };
        } else if (!reading.project_name) name = { outcome: "absent" };
        else if (!boundaryRef) name = { outcome: "no-revision" };
        else {
          nameRow = { name: reading.project_name, ref_sha: boundaryRef };
          name = { outcome: "imported", name: reading.project_name, ref_sha: boundaryRef };
        }
        // Each crossing of the table, unless its edge is on the map already.
        if (boundaryRef) {
          const seen = new Set<string>();
          for (const row of reading.runtime_boundaries) {
            const key = [row.from_runtime, row.to_runtime, row.mechanism].join("\u0000");
            const recorded = count(
              ctx,
              "SELECT COUNT(*) AS n FROM runtime_boundaries WHERE from_runtime = ? AND to_runtime = ? AND mechanism = ?",
              row.from_runtime,
              row.to_runtime,
              row.mechanism,
            );
            if (recorded > 0 || seen.has(key)) {
              boundaryKept.push(`${row.from_runtime} → ${row.to_runtime} (${row.mechanism})`);
              continue;
            }
            seen.add(key);
            boundaryRows.push(row);
          }
        }
      }

      if (!dryRun) {
        ctx.db.transaction(() => {
          const insertBody = ctx.db.prepare(
            `INSERT INTO imported_artifacts
               (path, kind, subsystem_id, body, body_sha256, registered_hash, hash_matches,
                registered_ref_sha, written_at, session_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          );
          for (const b of bodies) {
            insertBody.run(
              b.row.path,
              b.row.kind,
              b.row.subsystem_id,
              b.body,
              b.sha,
              b.row.content_hash,
              b.hashMatches,
              b.row.ref_sha,
              b.row.written_at,
              sessionId,
            );
          }
          if (thesisRow) {
            ctx.db
              .prepare(
                `INSERT INTO explanations (subject_type, subject_id, slot, disposition, body, ref_sha, session_id)
                 VALUES ('project', 'project', 'purpose', 'imported', ?, ?, ?)`,
              )
              .run(thesisRow.body, thesisRow.ref_sha, sessionId);
          }
          if (nameRow) {
            ctx.db
              .prepare("INSERT INTO project_profile (name, ref_sha, session_id) VALUES (?, ?, ?)")
              .run(nameRow.name, nameRow.ref_sha, sessionId);
          }
          const insertEdge = ctx.db.prepare(
            `INSERT INTO runtime_boundaries
               (from_runtime, from_language, to_runtime, mechanism, notes, origin, withdrawn, ref_sha, session_id)
             VALUES (?, ?, ?, ?, ?, 'imported', 0, ?, ?)`,
          );
          for (const row of boundaryRows) {
            insertEdge.run(
              row.from_runtime,
              row.from_language,
              row.to_runtime,
              row.mechanism,
              row.notes,
              boundaryRef,
              sessionId,
            );
          }
        })();
      }

      return ok({
        dry_run: dryRun,
        imported: bodies.map((b) => ({
          path: b.row.path,
          kind: b.row.kind,
          subsystem_id: b.row.subsystem_id,
          bytes: b.bytes,
          body_sha256: b.sha,
          hash_matches: b.hashMatches,
        })),
        already_imported: alreadyImported,
        not_imported: notImported,
        extraction,
        thesis,
        project_name: name,
        runtime_boundaries: {
          imported: boundaryRows.length,
          kept: boundaryKept,
          skipped: reading?.runtime_boundaries_skipped ?? [],
        },
      });
    },
  },
  {
    name: "get_imported_artifacts",
    description:
      "Read the files import_artifact_bodies copied into the store: for each, its path, kind, subsystem, size, sha256, the hash it was registered with, whether the two match (hash_matches 1 or 0; 0 means the file was edited after it was registered), the registered revision and date, when it was imported, and the withdrawal a subsystem reset appended, if any. Filter by kind, subsystem_id or path. The bodies are left out unless include_body is true. Every body was written by a model in an earlier version and is not tied to evidence. It needs no session and writes nothing.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string" },
        subsystem_id: { type: "string" },
        path: { type: "string" },
        include_body: { type: "boolean" },
      },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const clauses: string[] = [];
      const params: string[] = [];
      for (const key of ["kind", "subsystem_id", "path"] as const) {
        const value = optString(args, key);
        if (value === null) continue;
        clauses.push(`a.${key} = ?`);
        params.push(value);
      }
      const includeBody = optBool(args, "include_body");
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const rows = ctx.db
        .prepare(
          `SELECT a.id, a.path, a.kind, a.subsystem_id, a.body, a.body_sha256, a.registered_hash,
                  a.hash_matches, a.registered_ref_sha, a.written_at, a.imported_at, a.session_id,
                  (SELECT w.reason FROM imported_artifact_withdrawals w WHERE w.path = a.path ORDER BY w.id DESC LIMIT 1) AS withdrawn_reason,
                  (SELECT w.at FROM imported_artifact_withdrawals w WHERE w.path = a.path ORDER BY w.id DESC LIMIT 1) AS withdrawn_at
             FROM imported_artifacts a ${where} ORDER BY a.path`,
        )
        .all(...params) as Array<Record<string, unknown> & { body: string }>;
      return ok({
        artifacts: rows.map(({ body, withdrawn_reason, withdrawn_at, ...row }) => ({
          ...row,
          bytes: Buffer.byteLength(body, "utf8"),
          withdrawn: withdrawn_reason ? { reason: withdrawn_reason, at: withdrawn_at } : null,
          ...(includeBody ? { body } : {}),
        })),
        authored: "model",
        model_calls: 0,
      });
    },
  },
];
