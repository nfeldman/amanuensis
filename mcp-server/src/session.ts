import type { ServerContext } from "./helpers.js";

export function startSession(ctx: ServerContext, id: string, intent: string): void {
  ctx.db.prepare("INSERT INTO sessions (session_id, intent) VALUES (?, ?)").run(id, intent);
  ctx.sessionId = id;
}

export function getSession(
  ctx: ServerContext,
  sessionId: string | null,
): { session_id: string; intent: string; started_at: string } | null {
  if (sessionId) {
    const row = ctx.db
      .prepare("SELECT session_id, intent, started_at FROM sessions WHERE session_id = ?")
      .get(sessionId) as { session_id: string; intent: string; started_at: string } | undefined;
    return row ?? null;
  }
  const row = ctx.db
    .prepare("SELECT session_id, intent, started_at FROM sessions ORDER BY started_at DESC LIMIT 1")
    .get() as { session_id: string; intent: string; started_at: string } | undefined;
  return row ?? null;
}

export function defineSession(ctx: ServerContext, id: string): void {
  ctx.sessionId = id;
}
