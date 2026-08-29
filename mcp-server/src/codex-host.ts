import { execFileSync } from "node:child_process";
import { basename, resolve } from "node:path";

/**
 * Wall-clock bound for the probes the server runs before it can serve anything.
 * These are local `ps` and `git` calls that normally return in milliseconds; the
 * bound exists for the cases where they cannot — an unresponsive network mount,
 * a credential helper waiting on input, a pathologically large repository. Each
 * probe is recoverable, so expiry degrades to the fallback rather than failing
 * activation outright.
 */
export const STARTUP_PROBE_TIMEOUT_MS = 5_000;

function firstArgument(command: string): string {
  const match = command.match(/^(?:"([^"]+)"|'([^']+)'|(\S+))/);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
}

export function parseCodexParentWorkspace(command: string, launchCwd: string): string | null {
  const executable = basename(firstArgument(command));
  if (executable !== "codex" && executable !== "codex.exe") return null;
  const cdFlag = command.match(/(?:^|\s)(?:-C|--cd)(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/);
  if (!cdFlag) {
    if (/(?:^|\s)(?:-C|--cd)(?:=|\s|$)/.test(command)) {
      throw new Error("Codex parent command contains an unreadable --cd workspace");
    }
    return null;
  }
  const workspace = cdFlag[1] ?? cdFlag[2] ?? cdFlag[3];
  if (!workspace) throw new Error("Codex parent command contains an empty --cd workspace");
  return resolve(launchCwd, workspace);
}

export function discoverCodexParentWorkspace(
  options: {
    parentPid?: number;
    launchCwd?: string;
    readParentCommand?: (parentPid: number) => string;
  } = {},
): string | null {
  const parentPid = options.parentPid ?? process.ppid;
  const launchCwd = options.launchCwd ?? process.cwd();
  const readParentCommand =
    options.readParentCommand ??
    ((pid: number) =>
      execFileSync("ps", ["-ww", "-p", String(pid), "-o", "command="], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        // This runs on every server start and execFileSync blocks the event
        // loop for its whole duration, so an unresponsive ps would hang
        // activation with nothing to diagnose. Discovery is an optimisation —
        // losing it costs a fallback, not correctness (finding B02-2).
        timeout: STARTUP_PROBE_TIMEOUT_MS,
        killSignal: "SIGKILL",
      }).trim());
  try {
    return parseCodexParentWorkspace(readParentCommand(parentPid), launchCwd);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code) return null;
    throw error;
  }
}
