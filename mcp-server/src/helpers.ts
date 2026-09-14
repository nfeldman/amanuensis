import { spawnSync } from "node:child_process";

import type { DB } from "./db.js";
import type { ProjectContext } from "./project.js";

// The obligation split and the SQL that expresses it are generated from the
// `obligation_bearing` flag on each file_classification value in
// contracts/conspectus-vocabulary.json. They are re-exported here because that
// is where every caller already looks for them; a second definition would be a
// second place to drift.
export {
  OBLIGATION_BEARING_SQL,
  OBLIGATION_EXEMPT_CLASSIFICATIONS,
} from "./vocabulary.js";

export interface ServerContext {
  project: ProjectContext;
  db: DB;
  sessionId: string | null;
}

type JsonSchema = Record<string, unknown>;

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  handler: (args: Record<string, unknown>, ctx: ServerContext) => unknown;
  /**
   * Serialize this tool's text block without indentation (spec §4.1). The
   * dispatcher in `index.ts` reads the flag, so a tool whose response carries a
   * byte budget has that budget enforced on the bytes the host receives rather
   * than on a promise in a comment. Absent means the indented default, which is
   * what every tool written before the budgets existed still emits.
   */
  compact?: boolean;
}

export interface JsonResultOptions {
  /**
   * §4.1: emit the text block as `JSON.stringify(data)` rather than as
   * `JSON.stringify(data, null, 2)`. `structuredContent` still repeats the same
   * object, because the MCP contract and existing hosts depend on it; the
   * duplicate is counted against the budget, not dropped.
   */
  compact?: boolean;
}

/**
 * Every tool returns structured JSON and the same value serialized as a text
 * block for older clients. `{ ok: false, error }` is also surfaced through
 * MCP's protocol-level `isError` signal so hosts can react without reparsing
 * prose.
 */
export function jsonResult(data: unknown, options: JsonResultOptions = {}) {
  const result: {
    content: Array<{ type: "text"; text: string }>;
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  } = {
    content: [
      {
        type: "text" as const,
        text: options.compact === true ? JSON.stringify(data) : JSON.stringify(data, null, 2),
      },
    ],
  };
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    result.structuredContent = data as Record<string, unknown>;
    if ((data as { ok?: unknown }).ok === false) result.isError = true;
  }
  return result;
}

/**
 * The bytes a host actually receives: the whole emitted envelope, text block
 * and the `structuredContent` that duplicates it. §4.1 binds every response
 * budget to this measurement rather than to the payload, so the measurement
 * lives beside the emitter and both the tools and their gate read the same one.
 */
export function responseBytes(data: unknown, options: JsonResultOptions = {}): number {
  return Buffer.byteLength(JSON.stringify(jsonResult(data, options)), "utf8");
}

export function ok(extra: Record<string, unknown> = {}) {
  return { ok: true as const, ...extra };
}

export function err(message: string, extra: Record<string, unknown> = {}) {
  return { ok: false as const, error: message, ...extra };
}

/**
 * Resolve a revision to the commit it names **in the bound workspace**.
 *
 * `add_claim` has always done this (`claims.ts:129`); `add_evidence`,
 * `add_finding`, and `set_disposition` took the same field through
 * `requireString` and stored whatever arrived. The consequence was not a
 * cosmetic one: `describe_locus` reports `revision_bound: true` for any
 * non-null `ref_sha`, so `deadbeef` — or a sha that resolves only in some
 * other repository — was published as a revision-bound reading (F6/codex).
 * Resolving at ingress is what makes that flag a claim the record supports.
 *
 * The resolved 40-character object name is returned and stored, not the value
 * as typed, so a later reader comparing revisions by ancestry has a commit to
 * compare rather than a prefix to guess at.
 *
 * The resolution is **live at every call**, and nothing is memoized. An earlier
 * revision of this helper cached object-name-shaped input per workspace, on the
 * reasoning that a commit does not stop existing inside one server process.
 * That is false by the route a survey session actually takes: rewinding a
 * branch, an amend, a rebase, or a force-fetch all leave the previously
 * resolved commit unreachable, and the next collection removes it. The cache
 * then answered for git, and the writer stored a durable row at a revision
 * nothing could resolve — `revision_bound: true` over an absent commit, which
 * is the exact defect resolving at ingress exists to prevent (F1/codex,
 * slice-S7).
 *
 * A cache here cannot be made sound cheaply: the only check that distinguishes
 * a commit that still exists from one that has been collected is the same
 * `rev-parse` the cache was introduced to avoid, so revalidating a cached
 * answer costs exactly what not caching costs. The subprocess is therefore
 * paid on every durable write, and `test-perf-ceilings.mjs` reads these
 * writers against the subprocess ceilings rather than the SQLite ones, because
 * that is now what they are.
 */
export function resolveWorkspaceCommit(
  ctx: ServerContext,
  requested: string,
  label = "ref_sha",
): string {
  const result = spawnSync("git", ["rev-parse", "--verify", `${requested}^{commit}`], {
    cwd: ctx.project.workspacePath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const sha = String(result.stdout ?? "").trim();
  if (result.status !== 0 || !sha) {
    throw new ToolError(
      `${label} ${requested} does not resolve to a commit in the bound workspace ` +
        `${ctx.project.workspacePath}; record the revision the reading was taken at`,
    );
  }
  return sha;
}

/**
 * Resolve many revisions in **one** subprocess, for the writers that read a
 * whole set of recorded revisions rather than one supplied by the caller.
 *
 * `resolveWorkspaceCommit` above is the single-value form and is deliberately
 * uncached: revalidating a cached answer costs the same `rev-parse` the cache
 * avoided, so the subprocess is paid on every durable write. That is affordable
 * once per call and not affordable N+1 times. `set_disposition` now names a set
 * of evidence rows (§2.2) and a status advance reads every attached revision a
 * subsystem holds (§2.3); at one subprocess per row, an ordinary
 * multi-evidence disposition would approach the 200 ms ceiling
 * `test-perf-ceilings.mjs:187` reads this writer against — a ceiling
 * `:171-184` records as ~31× a measured 6.35-6.50 ms single subprocess, the
 * tightest multiple in that section. `git cat-file --batch-check` answers the
 * whole set in one process and is as live as `rev-parse`: it reads the object
 * store at call time and reports a collected commit as `missing`.
 *
 * Returns one entry per **distinct** requested value: the resolved
 * 40-character object name, or `null` when the workspace cannot reach it.
 * Callers decide whether an unreachable revision refuses or is reported.
 */
export function resolveWorkspaceCommits(
  workspacePath: string,
  requested: readonly string[],
): Map<string, string | null> {
  const resolved = new Map<string, string | null>();
  const askable: string[] = [];
  for (const value of requested) {
    if (resolved.has(value)) continue;
    resolved.set(value, null);
    // `--batch-check` is newline-delimited, so a value carrying whitespace
    // would desync every answer after it from its question. Rows written
    // through `add_evidence` are stored resolved and cannot; a row written
    // around the tool can, and is reported unresolvable rather than trusted.
    if (value.length > 0 && !/\s/.test(value)) askable.push(value);
  }
  if (askable.length === 0) return resolved;

  const result = spawnSync("git", ["cat-file", "--batch-check"], {
    cwd: workspacePath,
    encoding: "utf8",
    input: `${askable.map((value) => `${value}^{commit}`).join("\n")}\n`,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) return resolved;

  // One answer line per question, in order: `<sha> commit <size>` when the
  // object is there, `<question> missing` when it is not.
  const lines = String(result.stdout ?? "")
    .split("\n")
    .filter((line) => line.length > 0);
  for (let i = 0; i < askable.length && i < lines.length; i++) {
    const match = /^([0-9a-f]{40}) commit \d+$/.exec(lines[i] as string);
    if (match) resolved.set(askable[i] as string, match[1] as string);
  }
  return resolved;
}

export function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new ToolError(`missing required string: ${key}`);
  }
  return v;
}

/**
 * Normalize a repository-relative source path and reserve `.amanuensis/` for
 * tool state. This guard belongs at durable source/evidence ingress so a
 * model cannot turn the conspectus into evidence about itself.
 */
export function requireWorkspaceSourcePath(value: unknown, label = "file_path"): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ToolError(`missing required string: ${label}`);
  }
  const slashPath = value.replace(/\\/g, "/").replace(/^\.\/+/, "");
  const segments = slashPath.split("/");
  if (
    slashPath.length === 0 ||
    slashPath.startsWith("/") ||
    /^[A-Za-z]:\//.test(slashPath) ||
    segments.some((segment) => segment === "..")
  ) {
    throw new ToolError(`${label} must be a relative, non-traversing workspace source path`);
  }
  if (segments[0]?.toLowerCase() === ".amanuensis") {
    throw new ToolError(`${label} points into reserved Amanuensis tool state`);
  }
  return slashPath;
}

export function requireWorkspaceCitation(
  value: unknown,
  label = "citation",
  options: { strict?: boolean } = {},
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ToolError(`missing required string: ${label}`);
  }
  const separator = value.indexOf(":");
  const revision = value.lastIndexOf("@");
  if (separator <= 0 || revision <= separator + 1 || revision === value.length - 1) {
    if (options.strict === false) {
      const normalized = value.replace(/\\/g, "/");
      // Match a root-path token after any non-path delimiter (`=`, prose
      // punctuation, quotes, whitespace), while allowing a legitimate nested
      // `some-dir/.amanuensis` source path.
      const mentionsReservedState = /(^|[^A-Za-z0-9._/-])(?:\.\/)*\.amanuensis(?:\/|$)/i.test(
        normalized,
      );
      if (mentionsReservedState) {
        throw new ToolError(`${label} points into reserved Amanuensis tool state`);
      }
      return value;
    }
    throw new ToolError(`${label} must use file:symbol@sha form`);
  }
  const sourcePath = requireWorkspaceSourcePath(value.slice(0, separator), label);
  return `${sourcePath}${value.slice(separator)}`;
}

/**
 * §9.2's citation grammar, as one whitespace-delimited token: a workspace path,
 * a first-colon separator, a symbol, and a 7–40 character hex revision.
 *
 * `requireWorkspaceCitation` cannot validate a citation embedded in prose. It
 * takes `indexOf(":")` and `lastIndexOf("@")` over the *whole* value, so
 * `"why: src/a.ts:sym@abc1234"` is accepted with `why` normalized as the path
 * and the real citation never checked, while `"one-line: why this link
 * matters"` — the shape `xrefs.context` is documented as (`schema.sql:86`) —
 * is refused outright for carrying no `@`. Both directions are wrong, so a
 * context is scanned token by token instead.
 *
 * The pattern source is exported so the published input schema can carry the
 * same grammar the handler enforces rather than a second copy of it.
 */
export const CITATION_TOKEN_SOURCE = "[^\\s:]+(?:/[^\\s:]+)*:[^\\s@]+@[0-9a-fA-F]{7,40}";

const CITATION_TOKEN = new RegExp(`^${CITATION_TOKEN_SOURCE}$`);

/** Does the whole value match §9.2's one-token citation grammar? */
export function isCitationToken(value: unknown): boolean {
  return typeof value === "string" && CITATION_TOKEN.test(value);
}

/**
 * The tokens of `value` that match the grammar, deduplicated, in prose order.
 *
 * Lexical only: no path normalization, no git. Read surfaces use this to
 * surface the citation a stored row already carries; the write path uses
 * `extractWorkspaceCitations`, which validates each one.
 */
export function citationTokensIn(value: unknown): string[] {
  if (typeof value !== "string" || value.length === 0) return [];
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const token of value.split(/\s+/)) {
    if (!CITATION_TOKEN.test(token) || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

/** The revision a citation token names: everything after its last `@`. */
export function citationRevision(token: string): string {
  return token.slice(token.lastIndexOf("@") + 1);
}

/**
 * Split a stored citation into the three parts ingress accepted.
 *
 * `requireWorkspaceCitation` takes the **first** colon as the symbol delimiter
 * and the **last** `@` as the revision delimiter, so a vendored path such as
 * `src/pkg@v1/file.ts:loadVendored@abcdef0` is a valid citation. Every read
 * surface has to undo exactly that split: a reader that took the first `@`
 * instead reduced that path to `src/pkg`, serving the finding at a path nobody
 * cited and losing it at the path that was. One parser, used everywhere, is
 * the only thing that keeps the two ends from drifting again.
 *
 * Lexical only, and total: a value carrying no revision keeps the whole value
 * as its citation, and one carrying no colon has a null symbol.
 */
export function parseCitation(token: string): {
  path: string;
  symbol: string | null;
  revision: string | null;
} {
  const at = token.lastIndexOf("@");
  const citation = at > 0 ? token.slice(0, at) : token;
  const revision = at > 0 ? token.slice(at + 1) : null;
  const colon = citation.indexOf(":");
  return {
    path: colon === -1 ? citation : citation.slice(0, colon),
    symbol: colon === -1 ? null : citation.slice(colon + 1),
    revision,
  };
}

/**
 * Does `path` exist in the tree at `revision`?
 *
 * §4.2's third step, and the one `requireWorkspaceCitation` cannot take: that
 * helper reads `indexOf(":")` and `lastIndexOf("@")` and validates path
 * *syntax*, so `src/nothing-here.ts:ghost@0000000` parses. Parsing is not
 * resolution, and an anchor pointing at a path the named revision never carried
 * is an anchor no later reader can open.
 *
 * `git cat-file -e <revision>:<path>` is the whole question: it exits 0 when
 * the object exists in that revision's tree and non-zero otherwise, and it is
 * live at every call for the reason {@link resolveWorkspaceCommit} gives.
 */
export function workspaceTreeHasPath(
  workspacePath: string,
  revision: string,
  path: string,
): boolean {
  const result = spawnSync("git", ["cat-file", "-e", `${revision}:${path}`], {
    cwd: workspacePath,
    encoding: "utf8",
    stdio: ["ignore", "ignore", "ignore"],
  });
  return result.status === 0;
}

/**
 * Which of these stored `file:symbol@sha` anchors still resolve, in **one**
 * subprocess.
 *
 * An anchor resolves when all three of §4.2's conditions hold: the token parses
 * as a citation, its revision is reachable in the bound workspace, and its path
 * exists in that revision's tree. Asking `<revision>:<path>` answers all three
 * at once — an unreachable revision and an absent path are both reported
 * `missing` — which is what a predicate over a whole subsystem's terms needs.
 * The per-anchor form above stays separate because `define_term` refuses with a
 * different sentence for each failure, and a caller told only "does not
 * resolve" cannot tell a rebased revision from a typo'd path.
 *
 * One subprocess for the set, not one per row, for the reason
 * {@link resolveWorkspaceCommits} gives: a status advance's cost must not be a
 * function of how many terms the subsystem recorded.
 *
 * Returns one entry per **distinct** requested value. A token that does not
 * parse is `false` without asking git.
 */
export function resolveWorkspaceAnchors(
  workspacePath: string,
  anchors: readonly string[],
): Map<string, boolean> {
  const resolved = new Map<string, boolean>();
  const askable: string[] = [];
  const questions: string[] = [];
  for (const anchor of anchors) {
    if (resolved.has(anchor)) continue;
    resolved.set(anchor, false);
    if (typeof anchor !== "string" || !CITATION_TOKEN.test(anchor)) continue;
    const { path, revision } = parseCitation(anchor);
    if (!path || !revision) continue;
    askable.push(anchor);
    questions.push(`${revision}:${path}`);
  }
  if (askable.length === 0) return resolved;

  const result = spawnSync("git", ["cat-file", "--batch-check"], {
    cwd: workspacePath,
    encoding: "utf8",
    input: `${questions.join("\n")}\n`,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) return resolved;

  // One answer line per question, in order: `<sha> <type> <size>` when the
  // object is there, `<question> missing` when it is not. Any type counts:
  // `cat-file -e` succeeds for a tree as well as a blob, and this is the same
  // question asked in bulk, not a narrower one.
  const lines = String(result.stdout ?? "")
    .split("\n")
    .filter((line) => line.length > 0);
  for (let i = 0; i < askable.length && i < lines.length; i++) {
    if (/^[0-9a-f]{40} \w+ \d+$/.test(lines[i] as string)) {
      resolved.set(askable[i] as string, true);
    }
  }
  return resolved;
}

/**
 * Validate every citation token in a prose value and return them normalized.
 *
 * Each token's path goes through `requireWorkspaceSourcePath` and its revision
 * through the caller's `resolveRevision`, which asks git whether the commit
 * exists **in the bound workspace** — a well-formed sha that resolves only in
 * some other repository is not a citation of this one. One unresolvable token
 * refuses the whole value: a single good citation must not launder the rest.
 *
 * **Symbol reachability is not checked.** Deciding whether a symbol exists at a
 * revision needs a language parser the server does not have, and
 * `evidence.symbol` is a free-text field that carries parenthetical qualifiers.
 * The surrounding prose is the caller's to store verbatim.
 */
export function extractWorkspaceCitations(
  value: unknown,
  label: string,
  options: { resolveRevision: (revision: string) => boolean },
): string[] {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ToolError(`missing required string: ${label}`);
  }
  const tokens = citationTokensIn(value);
  if (tokens.length === 0) {
    throw new ToolError(
      `${label} must carry at least one whitespace-delimited citation token of the form ` +
        `file:symbol@sha, with a 7-40 character hex revision; the surrounding prose is kept verbatim`,
    );
  }
  const citations: string[] = [];
  for (const token of tokens) {
    const separator = token.indexOf(":");
    const sourcePath = requireWorkspaceSourcePath(token.slice(0, separator), `${label} citation`);
    if (!options.resolveRevision(citationRevision(token))) {
      throw new ToolError(
        `${label} cites ${token}, whose revision does not resolve in the bound workspace`,
      );
    }
    const normalized = `${sourcePath}${token.slice(separator)}`;
    if (!citations.includes(normalized)) citations.push(normalized);
  }
  return citations;
}

export function optString(args: Record<string, unknown>, key: string): string | null {
  const v = args[key];
  if (v == null) return null;
  if (typeof v !== "string") throw new ToolError(`expected string for ${key}`);
  return v;
}

export function requireEnum<T extends string>(
  args: Record<string, unknown>,
  key: string,
  values: readonly T[],
): T {
  const v = requireString(args, key);
  if (!values.includes(v as T)) {
    throw new ToolError(`${key} must be one of: ${values.join(", ")}`);
  }
  return v as T;
}

export function optEnum<T extends string>(
  args: Record<string, unknown>,
  key: string,
  values: readonly T[],
): T | null {
  const v = optString(args, key);
  if (v === null) return null;
  if (!values.includes(v as T)) {
    throw new ToolError(`${key} must be one of: ${values.join(", ")}`);
  }
  return v as T;
}

export function requireInt(args: Record<string, unknown>, key: string): number {
  const v = args[key];
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new ToolError(`missing required integer: ${key}`);
  }
  return v;
}

export function optInt(
  args: Record<string, unknown>,
  key: string,
  fallback: number | null = null,
): number | null {
  const v = args[key];
  if (v == null) return fallback;
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new ToolError(`expected integer for ${key}`);
  }
  return v;
}

export function optBool(args: Record<string, unknown>, key: string, fallback = false): boolean {
  const v = args[key];
  if (v == null) return fallback;
  if (typeof v !== "boolean") throw new ToolError(`expected boolean for ${key}`);
  return v;
}

export function optStringArray(args: Record<string, unknown>, key: string): string[] | null {
  const v = args[key];
  if (v == null) return null;
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
    throw new ToolError(`expected string[] for ${key}`);
  }
  return v as string[];
}

export function requireStringArray(
  args: Record<string, unknown>,
  key: string,
  opts: { minLength?: number } = {},
): string[] {
  const v = args[key];
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
    throw new ToolError(`expected string[] for ${key}`);
  }
  if (opts.minLength != null && v.length < opts.minLength) {
    throw new ToolError(`${key} must contain at least ${opts.minLength} entries`);
  }
  return v as string[];
}

export function optIntArray(args: Record<string, unknown>, key: string): number[] | null {
  const v = args[key];
  if (v == null) return null;
  if (!Array.isArray(v) || !v.every((x) => typeof x === "number" && Number.isInteger(x))) {
    throw new ToolError(`expected integer[] for ${key}`);
  }
  return v as number[];
}

export class ToolError extends Error {}

/**
 * Validate that every given ID exists in `table.column`. Throws a
 * ToolError listing every missing ID at once (rather than failing on
 * the first), so an agent gets the full diff in one round-trip.
 *
 * `table` and `column` are interpolated into the SQL — pass only
 * literal identifiers, never values derived from agent input.
 */
export function requireExistingIds<T extends string | number>(
  db: DB,
  table: string,
  column: string,
  ids: readonly T[],
  label: string,
): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT ${column} AS id FROM ${table} WHERE ${column} IN (${placeholders})`)
    .all(...ids) as Array<{ id: T }>;
  const have = new Set(rows.map((r) => r.id));
  const missing = ids.filter((id) => !have.has(id));
  if (missing.length) {
    throw new ToolError(`unknown ${label}: ${missing.join(", ")}`);
  }
}

export function nowIso(): string {
  // SQLite CURRENT_TIMESTAMP-compatible format.
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

export function newSessionId(): string {
  // Not RFC 4122 — just a random identifier good enough for a single-user agent.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
