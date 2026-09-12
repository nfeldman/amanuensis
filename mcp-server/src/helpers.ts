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
