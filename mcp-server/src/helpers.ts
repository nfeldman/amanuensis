import type { DB } from "./db.js";
import type { ProjectContext } from "./project.js";

/**
 * Classifications that exempt a scoped file from survey obligation: generated
 * output, vendored third-party code, and files ruled irrelevant. Staleness over
 * these is real drift but carries no work, so counting it in an obligation
 * metric dilutes the signal — most sharply for a checked-in projection, which
 * changes on every publish and would otherwise make republishing the report
 * read as the conspectus going stale.
 */
export const OBLIGATION_EXEMPT_CLASSIFICATIONS = [
  "generated-ignore",
  "vendor-ignore",
  "irrelevant",
] as const;

/** SQL predicate selecting ledger rows that do carry a survey obligation. */
export const OBLIGATION_BEARING_SQL =
  "COALESCE(classification, 'candidate') NOT IN ('generated-ignore', 'vendor-ignore', 'irrelevant')";

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
}

/**
 * Every tool returns structured JSON and the same value serialized as a text
 * block for older clients. `{ ok: false, error }` is also surfaced through
 * MCP's protocol-level `isError` signal so hosts can react without reparsing
 * prose.
 */
export function jsonResult(data: unknown) {
  const result: {
    content: Array<{ type: "text"; text: string }>;
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  } = {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    result.structuredContent = data as Record<string, unknown>;
    if ((data as { ok?: unknown }).ok === false) result.isError = true;
  }
  return result;
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
