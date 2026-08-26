import { execFileSync } from "node:child_process";
import { basename, resolve } from "node:path";

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
      }).trim());
  try {
    return parseCodexParentWorkspace(readParentCommand(parentPid), launchCwd);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code) return null;
    throw error;
  }
}
