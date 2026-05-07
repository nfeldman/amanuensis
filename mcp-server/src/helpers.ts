import type { DB } from "./db.js";
import type { ProjectContext } from "./project.js";

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
 * Every tool returns structured JSON wrapped as a text content block.
 * Errors follow `{ ok: false, error }`.
 */
export function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
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
