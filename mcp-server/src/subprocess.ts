import * as childProcess from "node:child_process";

/**
 * `spawnSync` and `execFileSync` with a time limit.
 *
 * The server runs every subprocess synchronously, so one that never returns
 * blocks the event loop: not only the tool call that started it but every call
 * after it. The startup probes already carry `STARTUP_PROBE_TIMEOUT_MS`; the
 * tool-time calls carried nothing (older defects B04-R4, B02-R1). Each module
 * that starts a subprocess during a tool call imports these instead of
 * `node:child_process`, and a call that sets its own `timeout` keeps it.
 *
 * The limit is generous because it guards against a hang, not a slow repository:
 * `git ls-tree -r` over a large tree or `cat-file` of a large blob can take
 * seconds. `AMANUENSIS_SUBPROCESS_TIMEOUT_MS` overrides it, read at each call.
 * A process that overruns is killed and the caller sees an ordinary failure;
 * a line on stderr says which command it was, since a caller's own message
 * ("unknown commit") would not.
 */
export const DEFAULT_SUBPROCESS_TIMEOUT_MS = 120_000;

function timeoutMs(): number {
  const configured = Number(process.env.AMANUENSIS_SUBPROCESS_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_SUBPROCESS_TIMEOUT_MS;
}

function bounded<T extends { timeout?: number; killSignal?: NodeJS.Signals | number }>(
  options: T | undefined,
): T {
  const given = (options ?? {}) as T;
  if (given.timeout !== undefined) return given;
  return { ...given, timeout: timeoutMs(), killSignal: given.killSignal ?? "SIGKILL" };
}

function reportTimeout(command: string, args: readonly string[] | undefined, error: unknown) {
  if ((error as NodeJS.ErrnoException | undefined)?.code !== "ETIMEDOUT") return;
  console.error(
    `amanuensis: ${[command, ...(args ?? [])].join(" ").slice(0, 200)} did not finish within ` +
      `${timeoutMs()} ms and was killed (AMANUENSIS_SUBPROCESS_TIMEOUT_MS)`,
  );
}

export const spawnSync = ((
  command: string,
  args?: readonly string[],
  options?: childProcess.SpawnSyncOptions,
) => {
  const result = childProcess.spawnSync(command, args ?? [], bounded(options));
  reportTimeout(command, args, result.error);
  return result;
}) as typeof childProcess.spawnSync;

export const execFileSync = ((
  command: string,
  args?: readonly string[],
  options?: childProcess.ExecFileSyncOptions,
) => {
  try {
    return childProcess.execFileSync(command, args ?? [], bounded(options));
  } catch (error) {
    reportTimeout(command, args, error);
    throw error;
  }
}) as typeof childProcess.execFileSync;
