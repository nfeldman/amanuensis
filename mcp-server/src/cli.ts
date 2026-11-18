#!/usr/bin/env node
// Amanuensis client installer and lifecycle manager.
//
// MCP standardizes the server protocol, not project configuration discovery.
// The installer therefore keeps one portable workflow skill and emits the
// small adapter required by the selected client.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  chmodSync,
  copyFileSync,
  existsSync,
  constants as fsConstants,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { applyEdits, modify, type ParseError, parse, printParseErrorCode } from "jsonc-parser";
import { parse as parseToml } from "smol-toml";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const packageVersion = (
  JSON.parse(readFileSync(resolve(moduleDir, "..", "package.json"), "utf8")) as {
    version: string;
  }
).version;
const SERVER_NAME = "amanuensis-memory";
const CODEX_BLOCK_START = "# >>> amanuensis init (managed)";
const CODEX_BLOCK_END = "# <<< amanuensis init (managed)";
// The agent-instructions paragraph is opt-in. It is the only thing the
// installer would write into a file the project owns and maintains by hand,
// so it is never written unless it was asked for: an install that was not
// asked prints the offer and writes nothing. The delimiters make the block
// findable on a rerun and removable by hand.
const AGENT_INSTRUCTIONS_START = "<!-- >>> amanuensis (managed) -->";
const AGENT_INSTRUCTIONS_END = "<!-- <<< amanuensis (managed) -->";
const AGENT_INSTRUCTIONS_BLOCK = [
  AGENT_INSTRUCTIONS_START,
  "## Amanuensis",
  "",
  "This project has an Amanuensis conspectus: a recorded, evidence-backed survey of the",
  "codebase. Before you edit an unfamiliar file, call `describe_locus` on it. The answer",
  "opens with standing — what the record authorizes about that path and what it cannot",
  "justify — and then the account: purpose, structure, known defects, boundaries, and",
  "terms. When standing is `unledgered`, `excluded`, or `scoped-unread`, say so and offer",
  "a survey rather than reading the file and improvising. `get_attention` lists what is",
  "unresolved; `get_history` lists what was concluded.",
  AGENT_INSTRUCTIONS_END,
  "",
].join("\n");

const LEGACY_AGENT_FILES = [
  "amanuensis-adversarial.agent.md",
  "amanuensis-auto.agent.md",
  "amanuensis-concerns.agent.md",
  "amanuensis-memory-auditor.agent.md",
  "amanuensis-notes.agent.md",
  "amanuensis-scoper.agent.md",
  "amanuensis-structural.agent.md",
  "amanuensis.agent.md",
] as const;

type Client = "claude" | "codex" | "copilot" | "vscode" | "generic";
type InstallScope = "user" | "project";

// The hosts one `amanuensis install` sets up for every repository at once.
// Each reads a user-level MCP registration and a user-level skills directory.
const USER_HOSTS = ["codex", "claude", "copilot"] as const;
type UserHost = (typeof USER_HOSTS)[number];
const HOST_LABEL: Record<UserHost, string> = {
  codex: "Codex",
  claude: "Claude Code",
  copilot: "GitHub Copilot (CLI and VS Code)",
};
// A user-level registration launched by a host other than Codex. The server
// binds from CLAUDE_PROJECT_DIR or a Git working directory, and otherwise
// waits for the skill's workspace handshake instead of claiming a non-Git
// launcher directory such as the home directory.
const USER_CWD_CONTRACT = "user-cwd-v1";

type InitFlags = {
  dir: string;
  client: Client;
  dryRun: boolean;
  force: boolean;
  mcpOnly: boolean;
  scope: InstallScope;
  agentInstructions: boolean;
};

type PlanAction =
  | { kind: "write-file"; path: string; content: string; mode: "create" | "overwrite" }
  | { kind: "backup"; from: string; to: string }
  | { kind: "archive"; from: string; to: string }
  | { kind: "skip-file"; path: string; reason: string }
  | { kind: "conflict"; path: string; reason: string }
  | { kind: "mkdir"; path: string }
  | { kind: "remove-tree"; path: string }
  | { kind: "remove-file"; path: string }
  // A JSON edit computed from the file as it is when the edit is applied, not
  // when it was planned: another program (Claude Code rewrites ~/.claude.json
  // constantly) may change the file in between, and its change must survive.
  | {
      kind: "edit-json";
      path: string;
      keyPath: string[];
      value: unknown;
      backupTo: string;
      allowUnmanaged: boolean;
    };

type JsonObject = Record<string, unknown>;

type ServerLaunch = { command: string; args: string[] };

type CodexRegistration = {
  path: string;
  present: boolean;
  managed: boolean;
  parseError?: string;
  entry?: JsonObject;
  workspace?: string;
};

type DoctorDiagnosis = {
  code: string;
  path: string;
  message: string;
  remediation: string;
};

function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function assertSafeRootPath(rootPath: string, target: string): void {
  const lexicalRoot = resolve(rootPath);
  const lexicalTarget = resolve(target);
  if (!isWithin(lexicalRoot, lexicalTarget)) {
    throw new Error(`installer path escapes managed root: ${target}`);
  }
  // A root that does not exist yet (a dry run before a host's first install)
  // has nothing beneath it to traverse; the lexical check is the whole check.
  if (!lstatExists(rootPath)) return;
  const root = realpathSync(rootPath);
  const resolvedTarget = join(root, relative(lexicalRoot, lexicalTarget));
  let cursor = root;
  for (const segment of relative(root, resolvedTarget).split(sep).filter(Boolean)) {
    cursor = join(cursor, segment);
    // lstat, not exists: a dangling symbolic link does not "exist", and
    // treating it as absent would let a write follow it out of the root.
    if (!lstatExists(cursor)) break;
    const stat = lstatSync(cursor);
    if (stat.isSymbolicLink()) {
      throw new Error(`installer path traverses a symbolic link: ${cursor}`);
    }
    if (cursor !== resolvedTarget && !stat.isDirectory()) {
      throw new Error(`installer path traverses a non-directory: ${cursor}`);
    }
    if (!isWithin(root, realpathSync(cursor))) {
      throw new Error(`installer path escapes the canonical target project: ${cursor}`);
    }
  }
}

function serverLaunch(): ServerLaunch {
  const pkgRoot = resolve(moduleDir, "..");
  if (existsSync(join(pkgRoot, "src", "cli.ts"))) {
    return { command: process.execPath, args: [join(pkgRoot, "dist", "index.js")] };
  }
  return { command: SERVER_NAME, args: [] };
}

function printUsage(): void {
  process.stdout.write(
    [
      "amanuensis — manage the Amanuensis MCP server and workflow skill.",
      "",
      "Usage:",
      "  amanuensis install [--client codex,claude,copilot] [options]",
      "  amanuensis status [--json]",
      "  amanuensis upgrade [--client <names>] [options]",
      "  amanuensis uninstall [--client <names>] [options]",
      "  amanuensis init --client <claude|codex|vscode|generic> --dir <project> [options]",
      "  amanuensis doctor --client codex [options]",
      "",
      "install sets up every host it finds on this machine (Codex, Claude Code,",
      "GitHub Copilot) once, for every repository; --client limits it to the",
      "named hosts. status reports what is installed and exits non-zero when a",
      "host it finds is not set up. init installs into one project instead.",
      "",
      "Options:",
      "  --client <name>  Host(s): codex, claude, copilot (comma-separated) for",
      "                   install, upgrade, and uninstall; one of claude, codex,",
      "                   vscode, generic for init.",
      "  --dir <path>     Target project for init and doctor (default: current directory).",
      "  --scope <name>   user (default for install) or project.",
      "  --force          Replace conflicting Amanuensis files or a hand-written",
      "                   registration; config rewrites receive timestamped backups.",
      "  --mcp-only       Configure only the MCP launcher. Intended for",
      "                   local development with a live global skill symlink.",
      "  --dry-run        Print the complete plan; write nothing.",
      "  --agent-instructions",
      "                   With init, add a short Amanuensis paragraph to the",
      "                   project's agent instructions: CLAUDE.md for Claude",
      "                   Code, AGENTS.md for the other clients. Nothing is",
      "                   written to either file without this flag.",
      "  --repair         With doctor, prepare a bounded user/project migration.",
      "  --apply-plan ID  Apply only the exact repair plan ID returned by dry-run.",
      "  --json           Emit the status or doctor report as machine-readable JSON.",
      "  --help           Show this message.",
      "",
      "Where install writes (user level):",
      "  codex    $CODEX_HOME/config.toml + $CODEX_HOME/skills/amanuensis/",
      "  claude   ~/.claude.json + ~/.claude/skills/amanuensis/ ($CLAUDE_CONFIG_DIR)",
      "  copilot  $COPILOT_HOME/mcp-config.json + $COPILOT_HOME/skills/amanuensis/",
      "",
      "Project adapters (init):",
      "  claude   .mcp.json + .claude/skills/amanuensis/",
      "  codex    --scope project: .codex/config.toml + .agents/skills/amanuensis/",
      "  vscode   .vscode/mcp.json + .agents/skills/amanuensis/",
      "  generic  portable skill only; prints the stdio registration command",
      "",
      "The selected adapter changes discovery only. Every client launches the",
      "same local stdio server: amanuensis-memory.",
      "",
    ].join("\n"),
  );
}

function parseClient(value: string | undefined): Client {
  if (
    value === "claude" ||
    value === "codex" ||
    value === "copilot" ||
    value === "vscode" ||
    value === "generic"
  ) {
    return value;
  }
  if (value == null) {
    throw new Error(
      "--client is required (claude, codex, copilot, vscode, or generic); MCP does not standardize a universal project config file",
    );
  }
  throw new Error(
    `unsupported --client ${JSON.stringify(value)}; expected claude, codex, copilot, vscode, or generic`,
  );
}

/** Parse `--client a,b` for the user-level commands; every name must be a user host. */
function parseUserHosts(value: string): UserHost[] {
  const names = value
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length === 0) throw new Error("--client names no host");
  const hosts: UserHost[] = [];
  for (const name of names) {
    const client = parseClient(name);
    if (!(USER_HOSTS as readonly string[]).includes(client)) {
      throw new Error(
        `${client} has no user-level installation; use \`amanuensis init --client ${client} --dir <project>\``,
      );
    }
    if (!hosts.includes(client as UserHost)) hosts.push(client as UserHost);
  }
  return hosts;
}

function parseScope(
  value: string | undefined,
  client: Client,
  operation: "init" | "install" | "upgrade" | "uninstall" = "init",
): InstallScope {
  if (value == null) {
    if (client === "codex" || client === "copilot") return "user";
    if (client === "claude" && operation !== "init") return "user";
    return "project";
  }
  if (value !== "user" && value !== "project") {
    throw new Error(`unsupported --scope ${JSON.stringify(value)}; expected user or project`);
  }
  if (value === "user" && !(USER_HOSTS as readonly string[]).includes(client)) {
    throw new Error("--scope user is supported for codex, claude, and copilot");
  }
  if (value === "project" && client === "copilot") {
    throw new Error(
      "copilot is installed at user scope; use --client vscode for a project adapter",
    );
  }
  return value;
}

function codexHome(): string {
  return resolve(process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"));
}

function claudeHome(): string {
  return resolve(process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude"));
}

/** Claude Code keeps user-scoped MCP servers in `.claude.json`, beside `~/.claude`. */
function claudeUserConfigPath(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim();
  return configDir ? join(resolve(configDir), ".claude.json") : join(homedir(), ".claude.json");
}

/** Copilot CLI and VS Code's Copilot both read `$COPILOT_HOME` (default `~/.copilot`). */
function copilotHome(): string {
  return resolve(process.env.COPILOT_HOME?.trim() || join(homedir(), ".copilot"));
}

function userHostHome(host: UserHost): string {
  if (host === "codex") return codexHome();
  if (host === "claude") return claudeHome();
  return copilotHome();
}

function findBundledSkill(): string {
  const pkgRoot = resolve(moduleDir, "..");
  const bundled = join(pkgRoot, "skills", "amanuensis");
  // A source checkout has src/cli.ts and should prefer the canonical skill
  // over a stale generated prepack mirror. An installed package must stay
  // within its own root rather than trusting an arbitrary sibling directory.
  const candidates = existsSync(join(pkgRoot, "src", "cli.ts"))
    ? [join(pkgRoot, "..", ".claude", "skills", "amanuensis"), bundled]
    : [bundled];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "SKILL.md")) && statSync(join(candidate, "SKILL.md")).isFile()) {
      return candidate;
    }
  }
  throw new Error(
    `could not locate the bundled Amanuensis skill. Searched:\n  ${candidates.join("\n  ")}\n` +
      "Reinstall the package, or restore .claude/skills/amanuensis in a development checkout.",
  );
}

function skillDestination(workspace: string, client: Client, scope: InstallScope): string {
  if (scope === "user" && (USER_HOSTS as readonly string[]).includes(client)) {
    return join(userHostHome(client as UserHost), "skills", "amanuensis");
  }
  if (client === "claude") return join(workspace, ".claude", "skills", "amanuensis");
  return join(workspace, ".agents", "skills", "amanuensis");
}

function walkFiles(dir: string, relPath = ""): Array<{ relPath: string; src: string }> {
  const out: Array<{ relPath: string; src: string }> = [];
  for (const entry of readdirSync(dir)) {
    const src = join(dir, entry);
    const childRel = relPath ? `${relPath}/${entry}` : entry;
    const st = statSync(src);
    if (st.isDirectory()) out.push(...walkFiles(src, childRel));
    else if (st.isFile()) out.push({ relPath: childRel, src });
  }
  return out;
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readJsonWithComments(path: string): { raw: string; value: JsonObject } {
  const raw = readFileSync(path, "utf8");
  const errors: ParseError[] = [];
  const parsed = parse(raw, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as unknown;
  const first = errors[0];
  if (first) {
    throw new Error(`${printParseErrorCode(first.error)} at offset ${first.offset}`);
  }
  if (!isJsonObject(parsed)) throw new Error("top level must be an object");
  return { raw, value: parsed };
}

function backupPath(path: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${path}.bak.${timestamp}`;
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!isJsonObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalJson(value[key])]),
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function serverEntry(client: "claude" | "vscode", launch: ServerLaunch): JsonObject {
  if (client === "claude") {
    return {
      type: "stdio",
      command: launch.command,
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Claude Code environment expansion syntax
      args: [...launch.args, "--allow-workspace-pin", "--workspace", "${CLAUDE_PROJECT_DIR:-.}"],
      env: { AMANUENSIS_AUTOPROGRESS: "1" },
    };
  }
  return {
    type: "stdio",
    command: launch.command,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: VS Code workspace variable syntax
    args: [...launch.args, "--allow-workspace-pin", "--workspace", "${workspaceFolder}"],
    env: { AMANUENSIS_AUTOPROGRESS: "1" },
  };
}

function codexBlock(launch: ServerLaunch, scope: InstallScope, workspace: string): string {
  const args =
    scope === "project"
      ? [...launch.args, "--workspace", workspace, "--allow-workspace-pin"]
      : launch.args;
  const contract = scope === "user" ? "codex-user-cwd-v1" : "codex-project-pin-v1";
  const lines = [
    CODEX_BLOCK_START,
    `[mcp_servers.${SERVER_NAME}]`,
    `command = ${JSON.stringify(launch.command)}`,
  ];
  if (args.length > 0) {
    lines.push(`args = [${args.map((arg) => JSON.stringify(arg)).join(", ")}]`);
  }
  return [
    ...lines,
    'cwd = "."',
    `env = { AMANUENSIS_AUTOPROGRESS = "1", AMANUENSIS_ACTIVATION_CONTRACT = ${JSON.stringify(contract)} }`,
    CODEX_BLOCK_END,
  ].join("\n");
}

// Codex rewrites its own config.toml: it drops comments, turns an inline `env`
// into a sub-table, and moves tables around. The comment markers are therefore
// a hint, not the identity. An entry is the installer's when it carries one of
// the installer's activation contracts or, for an installation older than the
// contract, when one intact marker pair surrounds the file's only entry.
const CODEX_CONTRACTS = new Set(["codex-user-cwd-v1", "codex-project-pin-v1"]);

type CodexMarkers = { present: boolean; paired: boolean };

function codexMarkers(raw: string): CodexMarkers {
  const start = raw.indexOf(CODEX_BLOCK_START);
  const end = raw.indexOf(CODEX_BLOCK_END);
  const startCount = raw.split(CODEX_BLOCK_START).length - 1;
  const endCount = raw.split(CODEX_BLOCK_END).length - 1;
  return {
    present: start >= 0 || end >= 0,
    paired: startCount === 1 && endCount === 1 && start < end,
  };
}

function codexServerEntry(parsed: Record<string, unknown>): JsonObject | undefined {
  const servers = parsed.mcp_servers;
  if (!isJsonObject(servers)) return undefined;
  const entry = servers[SERVER_NAME];
  return isJsonObject(entry) ? entry : undefined;
}

function codexEntryIsManaged(raw: string, entry: JsonObject): boolean {
  const env = entry.env;
  const contract = isJsonObject(env) ? env.AMANUENSIS_ACTIVATION_CONTRACT : undefined;
  if (typeof contract === "string" && CODEX_CONTRACTS.has(contract)) return true;
  return codexMarkers(raw).paired;
}

function desiredCodexEntry(block: string): JsonObject {
  const entry = codexServerEntry(parseToml(block) as Record<string, unknown>);
  if (!entry) throw new Error("internal error: the Codex block has no server entry");
  return entry;
}

/** The text of `[mcp_servers.amanuensis-memory]` and its sub-tables, if written as tables. */
function codexEntrySpan(existing: string): { start: number; end: number } | undefined {
  const lines = existing.match(/.*(?:\r?\n|$)/g)?.filter(Boolean) ?? [];
  const header =
    /^\s*\[\s*mcp_servers\s*\.\s*(?:amanuensis-memory|"amanuensis-memory"|'amanuensis-memory')\s*\]\s*(?:#.*)?(?:\r?\n)?$/;
  const headerOrDescendant =
    /^\s*\[\[?\s*mcp_servers\s*\.\s*(?:amanuensis-memory|"amanuensis-memory"|'amanuensis-memory')(?=\s*(?:\.|\]))/;
  let offset = 0;
  let start = -1;
  for (const line of lines) {
    if (start < 0 && header.test(line)) start = offset;
    else if (start >= 0 && /^\s*\[/.test(line) && !headerOrDescendant.test(line)) {
      return { start, end: offset };
    }
    offset += line.length;
  }
  return start >= 0 ? { start, end: existing.length } : undefined;
}

function stripCodexMarkers(text: string): string {
  return text
    .split(/(?<=\n)/)
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed !== CODEX_BLOCK_START && trimmed !== CODEX_BLOCK_END;
    })
    .join("");
}

function withoutCodexEntry(parsed: Record<string, unknown>): unknown {
  const copy = JSON.parse(JSON.stringify(parsed)) as Record<string, unknown>;
  const servers = copy.mcp_servers;
  if (isJsonObject(servers)) {
    delete servers[SERVER_NAME];
    if (Object.keys(servers).length === 0) delete copy.mcp_servers;
  }
  return copy;
}

/**
 * Replace (or, with `replacement` null, remove) the server's tables and every
 * stray marker line, then prove by parsing that nothing else in the file moved.
 */
function rewriteCodexEntry(
  existing: string,
  parsed: Record<string, unknown>,
  replacement: string | null,
  configPath: string,
): string {
  const span = codexEntrySpan(existing);
  if (!span) {
    throw new Error(
      `${configPath} defines ${SERVER_NAME} in a form the installer cannot rewrite; ` +
        `change it to a [mcp_servers.${SERVER_NAME}] table or remove it, then rerun`,
    );
  }
  const before = stripCodexMarkers(existing.slice(0, span.start));
  const after = stripCodexMarkers(existing.slice(span.end));
  let content: string;
  if (replacement === null) {
    content =
      before.endsWith("\n\n") && after.startsWith("\n") ? before + after.slice(1) : before + after;
  } else {
    const left = before.length === 0 || before.endsWith("\n") ? before : `${before}\n`;
    const right = after.length === 0 || after.startsWith("\n") ? after : `\n${after}`;
    content = `${left}${replacement}\n${right}`;
  }
  let rewritten: Record<string, unknown>;
  try {
    rewritten = parseToml(content) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `${configPath}: rewriting ${SERVER_NAME} would leave invalid TOML (${(error as Error).message}); edit it by hand`,
    );
  }
  const expected = replacement === null ? undefined : desiredCodexEntry(replacement);
  if (
    !sameJson(withoutCodexEntry(rewritten), withoutCodexEntry(parsed)) ||
    !sameJson(codexServerEntry(rewritten) ?? null, expected ?? null)
  ) {
    throw new Error(
      `${configPath}: rewriting ${SERVER_NAME} would change other settings; edit it by hand`,
    );
  }
  return content;
}

function parseCodexConfig(existing: string, configPath: string): Record<string, unknown> {
  try {
    return parseToml(existing) as Record<string, unknown>;
  } catch (error) {
    const markers = codexMarkers(existing);
    if (markers.present && !markers.paired) {
      throw new Error(`${configPath} contains an incomplete Amanuensis-managed block`);
    }
    throw new Error(`${configPath} is not parseable TOML (${(error as Error).message})`);
  }
}

// The doctor's probes are a person waiting at a terminal; a stalled git or
// shell must not hang it (test-startup-bounds.mjs holds every direct call).
const DOCTOR_PROBE_TIMEOUT_MS = 10_000;

function canonicalGitRoot(path: string): string {
  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: path,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: DOCTOR_PROBE_TIMEOUT_MS,
      killSignal: "SIGKILL",
    }).trim();
    if (root) return realpathSync(root);
  } catch {
    // Doctor also supports reporting non-Git project pins.
  }
  return realpathSync(path);
}

function registrationWorkspace(
  entry: JsonObject | undefined,
  fallback: string,
): string | undefined {
  if (!entry) return undefined;
  const args = Array.isArray(entry.args) ? entry.args : [];
  const workspaceIndex = args.indexOf("--workspace");
  const selected = workspaceIndex >= 0 ? args[workspaceIndex + 1] : undefined;
  const cwd = entry.cwd;
  const configured = typeof selected === "string" ? selected : cwd;
  if (typeof configured !== "string" || configured === ".") return fallback;
  if (configured.includes("${")) return undefined;
  const candidate = isAbsolute(configured) ? configured : resolve(fallback, configured);
  return existsSync(candidate) ? canonicalGitRoot(candidate) : resolve(candidate);
}

function hasExplicitWorkspaceArgument(entry: JsonObject | undefined): boolean {
  return Array.isArray(entry?.args) && entry.args.includes("--workspace");
}

function inspectCodexRegistration(
  path: string,
  root: string,
  workspace: string,
): CodexRegistration {
  assertSafeRootPath(root, path);
  if (!existsSync(path)) return { path, present: false, managed: false };
  const raw = readFileSync(path, "utf8");
  const managed = codexMarkers(raw).paired;
  try {
    const parsed = parseToml(raw) as Record<string, unknown>;
    const entry = codexServerEntry(parsed);
    if (!entry) return { path, present: true, managed };
    return {
      path,
      present: true,
      managed: codexEntryIsManaged(raw, entry),
      entry,
      workspace: registrationWorkspace(entry, workspace),
    };
  } catch (error) {
    return { path, present: true, managed, parseError: (error as Error).message };
  }
}

function commandExists(command: unknown): boolean {
  if (typeof command !== "string" || command.length === 0) return false;
  if (isAbsolute(command) || command.includes(sep)) return existsSync(resolve(command));
  try {
    execFileSync("sh", ["-c", 'command -v "$1"', "amanuensis-doctor", command], {
      stdio: "ignore",
      timeout: DOCTOR_PROBE_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    return true;
  } catch {
    return false;
  }
}

function publicRegistration(registration: CodexRegistration): JsonObject {
  const entry = registration.entry;
  const env = isJsonObject(entry?.env) ? entry.env : {};
  return {
    path: registration.path,
    present: registration.present,
    managed: registration.managed,
    parseError: registration.parseError,
    command: entry?.command,
    args: Array.isArray(entry?.args) ? entry.args : [],
    cwd: entry?.cwd,
    workspace: registration.workspace,
    activationContract: env.AMANUENSIS_ACTIVATION_CONTRACT,
  };
}

function doctorReport(workspace: string): JsonObject & { diagnoses: DoctorDiagnosis[] } {
  const repositoryRoot = canonicalGitRoot(workspace);
  const userRoot = codexHome();
  const userConfig = inspectCodexRegistration(
    join(userRoot, "config.toml"),
    userRoot,
    repositoryRoot,
  );
  const projectConfig = inspectCodexRegistration(
    join(repositoryRoot, ".codex", "config.toml"),
    repositoryRoot,
    repositoryRoot,
  );
  const userHasEntry = userConfig.entry !== undefined;
  const projectHasEntry = projectConfig.entry !== undefined;
  const effectiveSource = projectHasEntry ? "project" : userHasEntry ? "user" : "none";
  const effective = projectHasEntry ? projectConfig : userConfig;
  const diagnoses: DoctorDiagnosis[] = [];
  const diagnose = (diagnosis: DoctorDiagnosis) => diagnoses.push(diagnosis);

  for (const registration of [userConfig, projectConfig]) {
    if (registration.parseError) {
      diagnose({
        code: "invalid-codex-config",
        path: registration.path,
        message: `Codex configuration is not parseable TOML: ${registration.parseError}`,
        remediation: "Repair the TOML syntax before running Amanuensis migration.",
      });
    }
  }
  if (!userHasEntry && !projectHasEntry && diagnoses.length === 0) {
    diagnose({
      code: "missing-registration",
      path: join(userRoot, "config.toml"),
      message: "No Amanuensis Codex MCP registration is configured.",
      remediation:
        "Run `amanuensis init --client codex --scope user --dry-run`, then apply the same command without `--dry-run`.",
    });
  }
  if (userHasEntry && !userConfig.managed) {
    diagnose({
      code: "unmanaged-user-registration",
      path: userConfig.path,
      message: "The user-scoped Amanuensis registration is not installer-managed.",
      remediation: "Run doctor with `--repair --dry-run` to obtain a digest-bound migration plan.",
    });
  }
  if (projectHasEntry && !projectConfig.managed) {
    diagnose({
      code: "unmanaged-project-registration",
      path: projectConfig.path,
      message: "The project-scoped Amanuensis registration is not installer-managed.",
      remediation: "Remove or migrate that project entry explicitly; doctor will not rewrite it.",
    });
  }
  if (
    userHasEntry &&
    hasExplicitWorkspaceArgument(userConfig.entry) &&
    userConfig.workspace !== repositoryRoot
  ) {
    diagnose({
      code: "hard-coded-user-workspace",
      path: userConfig.path,
      message: `The user registration selects ${userConfig.workspace ?? "an unresolved workspace"} instead of resolving the task cwd.`,
      remediation: "Migrate the user entry to the cwd-relative `codex-user-cwd-v1` contract.",
    });
  }
  if (userHasEntry && userConfig.entry?.cwd !== ".") {
    diagnose({
      code:
        typeof userConfig.entry?.cwd === "string"
          ? "hard-coded-user-cwd"
          : "missing-user-cwd-contract",
      path: userConfig.path,
      message:
        typeof userConfig.entry?.cwd === "string"
          ? `The user registration fixes the MCP process cwd at ${userConfig.entry.cwd}; it must resolve each task cwd dynamically.`
          : "The user registration has no cwd-relative launch contract.",
      remediation: 'Migrate the user entry to `cwd = "."` with the `codex-user-cwd-v1` contract.',
    });
  }
  if (userHasEntry && projectHasEntry) {
    const sameWorkspace =
      userConfig.workspace !== undefined && userConfig.workspace === projectConfig.workspace;
    diagnose({
      code: sameWorkspace ? "duplicate-registration" : "conflicting-registrations",
      path: projectConfig.path,
      message: sameWorkspace
        ? "Both user and project configuration register Amanuensis; the project entry shadows the user entry."
        : `User and project registrations select different repositories (${userConfig.workspace ?? "unresolved"} vs ${projectConfig.workspace ?? "unresolved"}).`,
      remediation: projectConfig.managed
        ? "Use the digest-bound doctor repair to remove the managed project pin."
        : "Remove the project entry manually after making a backup; doctor will not rewrite unmanaged project configuration.",
    });
  }

  for (const registration of [userConfig, projectConfig]) {
    if (!registration.entry) continue;
    const args = Array.isArray(registration.entry.args) ? registration.entry.args : [];
    const staleArgument = args.find(
      (argument) =>
        typeof argument === "string" &&
        isAbsolute(argument) &&
        argument.endsWith(".js") &&
        !existsSync(argument),
    );
    if (!commandExists(registration.entry.command) || staleArgument) {
      diagnose({
        code: "stale-executable",
        path: registration.path,
        message: staleArgument
          ? `The configured server entry does not exist: ${staleArgument}`
          : `The configured command is unavailable: ${String(registration.entry.command)}`,
        remediation:
          "Re-run user-scoped installation from the intended source checkout or installed package.",
      });
    }
  }

  if (effective.entry && effective.workspace && effective.workspace !== repositoryRoot) {
    diagnose({
      code: "wrong-repository-binding",
      path: effective.path,
      message: `Codex precedence selects ${effective.workspace}, not the task repository ${repositoryRoot}.`,
      remediation: "Do not start the workflow; repair the effective registration first.",
    });
  }

  const userSkill = join(userRoot, "skills", "amanuensis");
  const projectSkill = join(repositoryRoot, ".agents", "skills", "amanuensis");
  // Two links to one checkout are the same skill, not a shadow.
  if (
    existsSync(userSkill) &&
    existsSync(projectSkill) &&
    realpathSync(userSkill) !== realpathSync(projectSkill)
  ) {
    diagnose({
      code: "shadowed-user-skill",
      path: projectSkill,
      message: "A project skill shadows the user-scoped Amanuensis skill.",
      remediation:
        "Doctor repair removes the project copy only when it exactly matches the packaged skill.",
    });
  }

  const status = diagnoses.length === 0 ? "ok" : "error";
  return {
    schemaVersion: 1,
    fixtureContract: "codex-activation/v1",
    status,
    repository: {
      requestedPath: workspace,
      canonicalRoot: repositoryRoot,
      storagePath: join(repositoryRoot, ".amanuensis"),
    },
    configuration: {
      precedence: "trusted-project-over-user",
      effectiveSource,
      user: publicRegistration(userConfig),
      project: publicRegistration(projectConfig),
    },
    process: {
      serverVersion: packageVersion,
      configuredCommand: effective.entry?.command,
      configuredArguments: Array.isArray(effective.entry?.args) ? effective.entry.args : [],
      cwdContract: effective.entry?.cwd,
      bindingState: "not-observable-from-config-process",
      verification: "Start a new Codex task and compare its get_project_info response.",
    },
    restart: {
      state: status === "ok" ? "required" : "blocked-by-diagnosis",
      reason:
        status === "ok"
          ? "A new Codex task must read the repaired user registration before host binding is verified."
          : "Repair configuration faults before restarting Codex.",
    },
    skills: {
      userPath: userSkill,
      userPresent: existsSync(userSkill),
      projectPath: projectSkill,
      projectPresent: existsSync(projectSkill),
    },
    diagnoses,
  };
}

/** The directory every path a plan writes must stay inside. */
function installRoot(flags: InitFlags, workspace: string): string {
  if (flags.scope !== "user") return workspace;
  return userHostHome(flags.client as UserHost);
}

const LINKED_SKILL_REASON = "skill is a symbolic link (a development checkout); left in place";

/**
 * A user-level skill directory that is itself a symbolic link is a
 * contributor's link to a source checkout. The installer neither writes
 * through it nor removes it; it reports the link and leaves it.
 */
function isLinkedSkill(root: string, destination: string): boolean {
  assertSafeRootPath(root, dirname(destination));
  return lstatExists(destination) && lstatSync(destination).isSymbolicLink();
}

function lstatExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function planSkill(
  actions: PlanAction[],
  workspace: string,
  flags: InitFlags,
  planMkdir: (dir: string) => void,
): void {
  const source = findBundledSkill();
  const destination = skillDestination(workspace, flags.client, flags.scope);
  const root = installRoot(flags, workspace);
  if (flags.scope === "user" && isLinkedSkill(root, destination)) {
    actions.push({ kind: "skip-file", path: destination, reason: LINKED_SKILL_REASON });
    return;
  }
  planMkdir(destination);
  for (const { relPath, src } of walkFiles(source)) {
    const dest = join(destination, relPath);
    assertSafeRootPath(root, dest);
    const content = readFileSync(src, "utf8");
    planMkdir(dirname(dest));
    if (!existsSync(dest)) {
      actions.push({ kind: "write-file", path: dest, content, mode: "create" });
      continue;
    }
    if (readFileSync(dest, "utf8") === content) {
      actions.push({ kind: "skip-file", path: dest, reason: "already up-to-date" });
      continue;
    }
    if (!flags.force) {
      actions.push({
        kind: "conflict",
        path: dest,
        reason: "existing skill file differs; rerun with --force to replace it",
      });
      continue;
    }
    actions.push({ kind: "write-file", path: dest, content, mode: "overwrite" });
  }
  // An upgrade (always forced) also removes files an earlier release shipped
  // and this one does not, so the installed skill matches the package exactly.
  if (flags.force && existsSync(destination) && statSync(destination).isDirectory()) {
    const shipped = new Set(walkFiles(source).map((file) => file.relPath));
    for (const { relPath } of walkFiles(destination)) {
      if (shipped.has(relPath)) continue;
      const path = join(destination, relPath);
      assertSafeRootPath(root, path);
      actions.push({ kind: "remove-file", path });
    }
  }
}

function planSkillUninstall(actions: PlanAction[], workspace: string, flags: InitFlags): void {
  const root = installRoot(flags, workspace);
  const destination = skillDestination(workspace, flags.client, flags.scope);
  // A link is never the installer's own work, at any scope: leave it.
  if (isLinkedSkill(root, destination)) {
    actions.push({ kind: "skip-file", path: destination, reason: LINKED_SKILL_REASON });
    return;
  }
  assertSafeRootPath(root, destination);
  if (!existsSync(destination)) {
    actions.push({ kind: "skip-file", path: destination, reason: "skill is not installed" });
    return;
  }
  const source = findBundledSkill();
  const sourceFiles = walkFiles(source).sort((left, right) =>
    left.relPath.localeCompare(right.relPath),
  );
  const destinationFiles = walkFiles(destination).sort((left, right) =>
    left.relPath.localeCompare(right.relPath),
  );
  const exact =
    sourceFiles.length === destinationFiles.length &&
    sourceFiles.every(
      (file, index) =>
        file.relPath === destinationFiles[index]?.relPath &&
        readFileSync(file.src, "utf8") === readFileSync(destinationFiles[index].src, "utf8"),
    );
  if (!exact && !flags.force) {
    actions.push({
      kind: "conflict",
      path: destination,
      reason: "installed skill differs from this package; rerun with --force to remove it",
    });
    return;
  }
  actions.push({ kind: "remove-tree", path: destination });
}

function planJsonConfig(
  actions: PlanAction[],
  workspace: string,
  client: "claude" | "vscode",
  flags: InitFlags,
  planMkdir: (dir: string) => void,
): void {
  const configPath =
    client === "claude" ? join(workspace, ".mcp.json") : join(workspace, ".vscode", "mcp.json");
  const rootKey = client === "claude" ? "mcpServers" : "servers";
  assertSafeRootPath(workspace, configPath);
  const desired = serverEntry(client, serverLaunch());
  planMkdir(dirname(configPath));

  if (!existsSync(configPath)) {
    const fresh = { [rootKey]: { [SERVER_NAME]: desired } };
    actions.push({
      kind: "write-file",
      path: configPath,
      content: `${JSON.stringify(fresh, null, 2)}\n`,
      mode: "create",
    });
    return;
  }

  let raw: string;
  let existing: JsonObject;
  try {
    const parsed = readJsonWithComments(configPath);
    raw = parsed.raw;
    existing = parsed.value;
  } catch (error) {
    throw new Error(
      `${configPath} is not parseable JSON (${(error as Error).message}); fix or move it before rerunning`,
    );
  }
  const rawServers = existing[rootKey] ?? {};
  if (!isJsonObject(rawServers)) {
    throw new Error(`${configPath} has a non-object ${rootKey} field`);
  }
  const prior = rawServers[SERVER_NAME];
  if (sameJson(prior, desired)) {
    actions.push({ kind: "skip-file", path: configPath, reason: "already up-to-date" });
    return;
  }
  if (prior !== undefined && !flags.force) {
    actions.push({
      kind: "conflict",
      path: configPath,
      reason: `${SERVER_NAME} already exists with different settings; rerun with --force to replace it`,
    });
    return;
  }

  actions.push({ kind: "backup", from: configPath, to: backupPath(configPath) });
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const content = applyEdits(
    raw,
    modify(raw, [rootKey, SERVER_NAME], desired, {
      formattingOptions: { insertSpaces: true, tabSize: 2, eol },
    }),
  );
  actions.push({
    kind: "write-file",
    path: configPath,
    content,
    mode: "overwrite",
  });
}

function planCodexConfig(
  actions: PlanAction[],
  workspace: string,
  flags: InitFlags,
  planMkdir: (dir: string) => void,
): void {
  const root = flags.scope === "user" ? codexHome() : workspace;
  const configPath =
    flags.scope === "user" ? join(root, "config.toml") : join(root, ".codex", "config.toml");
  assertSafeRootPath(root, configPath);
  const desiredBlock = codexBlock(serverLaunch(), flags.scope, workspace);
  planMkdir(dirname(configPath));
  if (!existsSync(configPath)) {
    actions.push({
      kind: "write-file",
      path: configPath,
      content: `${desiredBlock}\n`,
      mode: "create",
    });
    return;
  }

  const existing = readFileSync(configPath, "utf8");
  const markers = codexMarkers(existing);
  const parsed = parseCodexConfig(existing, configPath);
  const entry = codexServerEntry(parsed);

  if (entry && codexEntryIsManaged(existing, entry)) {
    // Compared as data, so Codex reformatting the entry is not a difference.
    if (sameJson(entry, desiredCodexEntry(desiredBlock))) {
      actions.push({ kind: "skip-file", path: configPath, reason: "already up-to-date" });
      return;
    }
    if (!flags.force) {
      actions.push({
        kind: "conflict",
        path: configPath,
        reason: "managed Amanuensis server block differs; rerun with --force to replace it",
      });
      return;
    }
    const content = rewriteCodexEntry(existing, parsed, desiredBlock, configPath);
    actions.push({ kind: "backup", from: configPath, to: backupPath(configPath) });
    actions.push({ kind: "write-file", path: configPath, content, mode: "overwrite" });
    return;
  }

  const mcpServers = parsed.mcp_servers;
  if (isJsonObject(mcpServers) && Object.hasOwn(mcpServers, SERVER_NAME)) {
    if (markers.present && !markers.paired) {
      throw new Error(`${configPath} contains an incomplete Amanuensis-managed block`);
    }
    if (flags.force && codexEntrySpan(existing)) {
      const content = rewriteCodexEntry(existing, parsed, desiredBlock, configPath);
      actions.push({ kind: "backup", from: configPath, to: backupPath(configPath) });
      actions.push({ kind: "write-file", path: configPath, content, mode: "overwrite" });
      return;
    }
    actions.push({
      kind: "conflict",
      path: configPath,
      reason: `${SERVER_NAME} already has an unmanaged TOML section; remove or rename it before rerunning`,
    });
    return;
  }

  // No entry: leftover markers from an earlier installation are dropped.
  const base = stripCodexMarkers(existing);
  actions.push({ kind: "backup", from: configPath, to: backupPath(configPath) });
  const separator =
    base.length === 0 || base.endsWith("\n\n") ? "" : base.endsWith("\n") ? "\n" : "\n\n";
  actions.push({
    kind: "write-file",
    path: configPath,
    content: `${base}${separator}${desiredBlock}\n`,
    mode: "overwrite",
  });
}

function planCodexUninstall(actions: PlanAction[], workspace: string, flags: InitFlags): void {
  const root = flags.scope === "user" ? codexHome() : workspace;
  const configPath =
    flags.scope === "user" ? join(root, "config.toml") : join(root, ".codex", "config.toml");
  assertSafeRootPath(root, configPath);
  if (!existsSync(configPath)) {
    actions.push({ kind: "skip-file", path: configPath, reason: "Codex config is absent" });
    return;
  }
  const existing = readFileSync(configPath, "utf8");
  const markers = codexMarkers(existing);
  const parsed = parseCodexConfig(existing, configPath);
  const entry = codexServerEntry(parsed);
  const mcpServers = parsed.mcp_servers;
  if (!entry && !(isJsonObject(mcpServers) && Object.hasOwn(mcpServers, SERVER_NAME))) {
    if (!markers.present) {
      actions.push({ kind: "skip-file", path: configPath, reason: "managed server is absent" });
      return;
    }
    actions.push({ kind: "backup", from: configPath, to: backupPath(configPath) });
    actions.push({
      kind: "write-file",
      path: configPath,
      content: stripCodexMarkers(existing),
      mode: "overwrite",
    });
    return;
  }
  if (!entry || !codexEntryIsManaged(existing, entry)) {
    if (markers.present && !markers.paired) {
      throw new Error(`${configPath} contains an incomplete Amanuensis-managed block`);
    }
    actions.push({
      kind: "conflict",
      path: configPath,
      reason: "Amanuensis server entry is unmanaged; migrate it before uninstalling",
    });
    return;
  }
  const content = rewriteCodexEntry(existing, parsed, null, configPath);
  actions.push({ kind: "backup", from: configPath, to: backupPath(configPath) });
  actions.push({ kind: "write-file", path: configPath, content, mode: "overwrite" });
}

type PlanSegment = { actions: PlanAction[]; root: string };

function planSegment(root: string): PlanSegment & { planMkdir: (dir: string) => void } {
  const actions: PlanAction[] = [];
  const planned = new Set<string>();
  return {
    actions,
    root,
    planMkdir: (dir: string) => {
      assertSafeRootPath(root, dir);
      if (planned.has(dir)) return;
      planned.add(dir);
      if (!existsSync(dir)) actions.push({ kind: "mkdir", path: dir });
    },
  };
}

type JsonUserHost = Exclude<UserHost, "codex">;

function userConfigPath(host: UserHost): string {
  if (host === "codex") return join(codexHome(), "config.toml");
  if (host === "claude") return claudeUserConfigPath();
  return join(copilotHome(), "mcp-config.json");
}

/**
 * The user-level registration for a host other than Codex. Both files key
 * servers under `mcpServers`; Copilot names a stdio server `local` and lists
 * the tools it may call. The contract marker in `env` is how a later install,
 * upgrade, or uninstall recognizes the entry as the installer's own.
 */
function userServerEntry(host: JsonUserHost, launch: ServerLaunch): JsonObject {
  const env = {
    AMANUENSIS_AUTOPROGRESS: "1",
    AMANUENSIS_ACTIVATION_CONTRACT: USER_CWD_CONTRACT,
  };
  if (host === "claude") {
    return { type: "stdio", command: launch.command, args: launch.args, env };
  }
  return { type: "local", command: launch.command, args: launch.args, env, tools: ["*"] };
}

function isManagedUserEntry(entry: unknown): boolean {
  return (
    isJsonObject(entry) &&
    isJsonObject(entry.env) &&
    entry.env.AMANUENSIS_ACTIVATION_CONTRACT === USER_CWD_CONTRACT
  );
}

function readUserServers(path: string): { raw: string; value: JsonObject; servers: JsonObject } {
  let parsed: { raw: string; value: JsonObject };
  try {
    parsed = readJsonWithComments(path);
  } catch (error) {
    throw new Error(
      `${path} is not parseable JSON (${(error as Error).message}); fix or move it before rerunning`,
    );
  }
  const servers = parsed.value.mcpServers ?? {};
  if (!isJsonObject(servers)) throw new Error(`${path} has a non-object mcpServers field`);
  return { ...parsed, servers };
}

function planUserJsonConfig(
  segment: PlanSegment & { planMkdir: (dir: string) => void },
  host: JsonUserHost,
  flags: InitFlags,
): void {
  const { actions } = segment;
  const configPath = userConfigPath(host);
  assertSafeRootPath(segment.root, configPath);
  const desired = userServerEntry(host, serverLaunch());
  segment.planMkdir(dirname(configPath));
  if (!existsSync(configPath)) {
    actions.push({
      kind: "write-file",
      path: configPath,
      content: `${JSON.stringify({ mcpServers: { [SERVER_NAME]: desired } }, null, 2)}\n`,
      mode: "create",
    });
    return;
  }
  const { servers } = readUserServers(configPath);
  const prior = servers[SERVER_NAME];
  if (sameJson(prior, desired)) {
    actions.push({ kind: "skip-file", path: configPath, reason: "already up-to-date" });
    return;
  }
  if (prior !== undefined && !isManagedUserEntry(prior) && !flags.force) {
    actions.push({
      kind: "conflict",
      path: configPath,
      reason: `${SERVER_NAME} is registered by hand with different settings; rerun with --force to replace it`,
    });
    return;
  }
  actions.push({
    kind: "edit-json",
    path: configPath,
    keyPath: ["mcpServers", SERVER_NAME],
    value: desired,
    backupTo: backupPath(configPath),
    allowUnmanaged: flags.force,
  });
}

function planUserJsonUninstall(segment: PlanSegment, host: JsonUserHost, flags: InitFlags): void {
  const { actions } = segment;
  const configPath = userConfigPath(host);
  assertSafeRootPath(segment.root, configPath);
  if (!existsSync(configPath)) {
    actions.push({ kind: "skip-file", path: configPath, reason: "configuration is absent" });
    return;
  }
  const { servers } = readUserServers(configPath);
  const prior = servers[SERVER_NAME];
  if (prior === undefined) {
    actions.push({ kind: "skip-file", path: configPath, reason: "server is not registered" });
    return;
  }
  if (!isManagedUserEntry(prior) && !flags.force) {
    actions.push({
      kind: "conflict",
      path: configPath,
      reason: `${SERVER_NAME} was registered by hand; rerun with --force to remove it`,
    });
    return;
  }
  actions.push({
    kind: "edit-json",
    path: configPath,
    keyPath: ["mcpServers", SERVER_NAME],
    value: undefined,
    backupTo: backupPath(configPath),
    allowUnmanaged: flags.force,
  });
}

function userFlags(host: UserHost, base: InitFlags): InitFlags {
  return { ...base, client: host, scope: "user", agentInstructions: false };
}

/** The complete user-level install (or upgrade, with force) for one host. */
function buildUserPlan(host: UserHost, flags: InitFlags, workspace: string): PlanSegment[] {
  if (host === "codex") return [buildPlan(flags, workspace)];
  const segments: PlanSegment[] = [];
  if (!flags.mcpOnly) {
    const skill = planSegment(userHostHome(host));
    planSkill(skill.actions, workspace, flags, skill.planMkdir);
    segments.push(skill);
  }
  const config = planSegment(dirname(userConfigPath(host)));
  planUserJsonConfig(config, host, flags);
  segments.push(config);
  return segments;
}

function buildUserUninstallPlan(
  host: UserHost,
  flags: InitFlags,
  workspace: string,
): PlanSegment[] {
  if (host === "codex") return [buildUninstallPlan(flags, workspace)];
  const segments: PlanSegment[] = [];
  if (!flags.mcpOnly) {
    const skill = planSegment(userHostHome(host));
    planSkillUninstall(skill.actions, workspace, flags);
    segments.push(skill);
  }
  const config = planSegment(dirname(userConfigPath(host)));
  planUserJsonUninstall(config, host, flags);
  segments.push(config);
  return segments;
}

const HOST_HOME_VARIABLE: Record<UserHost, string> = {
  codex: "CODEX_HOME",
  claude: "CLAUDE_CONFIG_DIR",
  copilot: "COPILOT_HOME",
};

/**
 * A host is present when its home is configured or exists, or its command is
 * on PATH. VS Code's `code` counts for Copilot: VS Code's Copilot reads the
 * same `~/.copilot` registration and skills as the Copilot CLI.
 */
function hostPresent(host: UserHost): boolean {
  if (process.env[HOST_HOME_VARIABLE[host]]?.trim()) return true;
  if (existsSync(userHostHome(host))) return true;
  if (host === "claude" && existsSync(claudeUserConfigPath())) return true;
  // VS Code's own user directories count too: its `code` shell command is
  // optional, and ~/.copilot may not exist until Copilot first runs.
  if (host === "copilot" && VSCODE_USER_DIRS().some((dir) => existsSync(dir))) return true;
  const commands = host === "copilot" ? ["copilot", "code"] : [host];
  return commands.some((command) => commandExists(command));
}

function VSCODE_USER_DIRS(): string[] {
  return [
    join(homedir(), ".vscode"),
    join(homedir(), "Library", "Application Support", "Code"),
    join(homedir(), ".config", "Code"),
  ];
}

type RegistrationState = "installed" | "outdated" | "absent" | "unmanaged" | "unreadable";
type SkillState = "installed" | "outdated" | "absent" | "linked" | "broken";

function userRegistrationState(host: UserHost): RegistrationState {
  const path = userConfigPath(host);
  if (!existsSync(path)) return "absent";
  if (host === "codex") {
    const raw = readFileSync(path, "utf8");
    let parsed: Record<string, unknown>;
    try {
      // The whole file must parse: Codex loads nothing from an invalid file.
      parsed = parseToml(raw) as Record<string, unknown>;
    } catch {
      return "unreadable";
    }
    const entry = codexServerEntry(parsed);
    if (!entry) {
      const servers = parsed.mcp_servers;
      return isJsonObject(servers) && Object.hasOwn(servers, SERVER_NAME) ? "unmanaged" : "absent";
    }
    if (!codexEntryIsManaged(raw, entry)) return "unmanaged";
    const desired = desiredCodexEntry(codexBlock(serverLaunch(), "user", homedir()));
    return sameJson(entry, desired) ? "installed" : "outdated";
  }
  let servers: JsonObject;
  try {
    servers = readUserServers(path).servers;
  } catch {
    return "unreadable";
  }
  const entry = servers[SERVER_NAME];
  if (entry === undefined) return "absent";
  if (sameJson(entry, userServerEntry(host, serverLaunch()))) return "installed";
  return isManagedUserEntry(entry) ? "outdated" : "unmanaged";
}

function userSkillState(host: UserHost): SkillState {
  const destination = join(userHostHome(host), "skills", "amanuensis");
  if (!lstatExists(destination)) return "absent";
  if (lstatSync(destination).isSymbolicLink()) {
    return existsSync(join(destination, "SKILL.md")) ? "linked" : "broken";
  }
  if (!statSync(destination).isDirectory()) return "outdated";
  const source = walkFiles(findBundledSkill()).sort((a, b) => a.relPath.localeCompare(b.relPath));
  const installed = walkFiles(destination).sort((a, b) => a.relPath.localeCompare(b.relPath));
  const exact =
    source.length === installed.length &&
    source.every(
      (file, index) =>
        file.relPath === installed[index]?.relPath &&
        readFileSync(file.src, "utf8") === readFileSync(installed[index].src, "utf8"),
    );
  return exact ? "installed" : "outdated";
}

/** A host whose registration this installer wrote, current or not. */
function hasUserInstallation(host: UserHost): boolean {
  const state = userRegistrationState(host);
  return state === "installed" || state === "outdated";
}

/** A registration or a copied skill: anything uninstall has to remove. */
function hasAnyUserInstallation(host: UserHost): boolean {
  if (hasUserInstallation(host)) return true;
  const skill = userSkillState(host);
  return skill === "installed" || skill === "outdated";
}

/** Whether the launcher a registration names can start on this machine. */
function launcherAvailable(): boolean {
  const launch = serverLaunch();
  if (!commandExists(launch.command)) return false;
  return launch.args.every((arg) => !isAbsolute(arg) || existsSync(arg));
}

function nearestExistingAncestor(path: string): string {
  let cursor = path;
  while (!lstatExists(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return cursor;
}

function writable(path: string): boolean {
  try {
    accessSync(path, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Turn every write a plan would fail on into a conflict before anything is
 * written, so one unwritable host cannot leave another half-installed.
 */
function preflightWritable(segment: PlanSegment): void {
  const conflicts: PlanAction[] = [];
  for (const action of segment.actions) {
    const targets =
      action.kind === "write-file" || action.kind === "edit-json"
        ? [action.path]
        : action.kind === "remove-file" || action.kind === "remove-tree"
          ? [action.path]
          : action.kind === "mkdir"
            ? [action.path]
            : [];
    for (const target of targets) {
      const directory = nearestExistingAncestor(dirname(target));
      if (
        !writable(directory) ||
        (lstatExists(target) && action.kind !== "mkdir" && !writable(target))
      ) {
        conflicts.push({
          kind: "conflict",
          path: target,
          reason: "not writable by this user; fix its permissions and rerun",
        });
      }
    }
  }
  segment.actions.push(...conflicts);
}

/**
 * The file the selected client reads for project-wide agent instructions.
 *
 * Claude Code reads `CLAUDE.md`; Codex and the Agent Skills clients read
 * `AGENTS.md`. Both live in the target repository, so the paragraph is offered
 * only for a project-scoped install — a user-scoped Codex registration is
 * rooted in `$CODEX_HOME` and has no repository to write into.
 */
function agentInstructionsPath(workspace: string, client: Client): string {
  return join(workspace, client === "claude" ? "CLAUDE.md" : "AGENTS.md");
}

function agentInstructionsApplies(flags: InitFlags): boolean {
  return flags.scope === "project";
}

/**
 * Plan the opt-in paragraph. Absent file: create it. Present without the
 * managed block: append, leaving every existing byte in place. Present with
 * the block: skip, so a rerun is a no-op rather than a second copy.
 */
function planAgentInstructions(actions: PlanAction[], workspace: string, flags: InitFlags): void {
  const path = agentInstructionsPath(workspace, flags.client);
  assertSafeRootPath(workspace, path);
  if (!existsSync(path)) {
    actions.push({ kind: "write-file", path, content: AGENT_INSTRUCTIONS_BLOCK, mode: "create" });
    return;
  }
  if (!statSync(path).isFile()) {
    actions.push({
      kind: "conflict",
      path,
      reason: "agent instructions path is not a regular file",
    });
    return;
  }
  const current = readFileSync(path, "utf8");
  if (current.includes(AGENT_INSTRUCTIONS_START)) {
    actions.push({ kind: "skip-file", path, reason: "Amanuensis paragraph already present" });
    return;
  }
  const separator = current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n";
  actions.push({
    kind: "write-file",
    path,
    content: `${current}${separator}${AGENT_INSTRUCTIONS_BLOCK}`,
    mode: "overwrite",
  });
}

/**
 * Print the offer when the paragraph was not asked for. The offer is the whole
 * of the opt-in: nothing is written on this path, and the message says so.
 */
function printAgentInstructionsOffer(workspace: string, flags: InitFlags): void {
  const path = agentInstructionsPath(workspace, flags.client);
  const name = relative(workspace, path) || path;
  const present = existsSync(path) && readFileSync(path, "utf8").includes(AGENT_INSTRUCTIONS_START);
  if (present) return;
  console.log("");
  console.log(`Optional: add a short Amanuensis paragraph to ${name} so agents call`);
  console.log("describe_locus before editing an unfamiliar file, and answer from standing");
  console.log("rather than improvising. Not written; rerun with --agent-instructions to add it.");
}

function planLegacyAgents(actions: PlanAction[], workspace: string): void {
  const legacyRoot = join(workspace, ".github", "agents");
  for (const filename of LEGACY_AGENT_FILES) {
    const path = join(legacyRoot, filename);
    assertSafeRootPath(workspace, path);
    if (!existsSync(path) || !statSync(path).isFile()) continue;
    actions.push({ kind: "archive", from: path, to: backupPath(path) });
  }
}

function buildPlan(flags: InitFlags, workspace: string): { actions: PlanAction[]; root: string } {
  const actions: PlanAction[] = [];
  const root = flags.scope === "user" ? codexHome() : workspace;
  const plannedMkdirs = new Set<string>();
  const planMkdir = (dir: string) => {
    assertSafeRootPath(root, dir);
    if (plannedMkdirs.has(dir)) return;
    plannedMkdirs.add(dir);
    if (!existsSync(dir)) actions.push({ kind: "mkdir", path: dir });
  };

  if (flags.scope === "project") planLegacyAgents(actions, workspace);
  if (flags.agentInstructions && agentInstructionsApplies(flags))
    planAgentInstructions(actions, workspace, flags);
  if (!flags.mcpOnly) planSkill(actions, workspace, flags, planMkdir);
  if (flags.client === "claude" || flags.client === "vscode") {
    planJsonConfig(actions, workspace, flags.client, flags, planMkdir);
  } else if (flags.client === "codex") {
    planCodexConfig(actions, workspace, flags, planMkdir);
  }
  return { actions, root };
}

function buildUninstallPlan(
  flags: InitFlags,
  workspace: string,
): { actions: PlanAction[]; root: string } {
  const actions: PlanAction[] = [];
  const root = flags.scope === "user" ? codexHome() : workspace;
  if (!flags.mcpOnly) planSkillUninstall(actions, workspace, flags);
  planCodexUninstall(actions, workspace, flags);
  return { actions, root };
}

function hashRepairInput(hash: ReturnType<typeof createHash>, path: string): void {
  hash.update(path);
  if (!existsSync(path)) {
    hash.update("\0missing\0");
    return;
  }
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    hash.update("\0symlink\0");
    return;
  }
  if (stat.isFile()) {
    hash.update("\0file\0");
    hash.update(readFileSync(path));
    return;
  }
  hash.update("\0directory\0");
  for (const file of walkFiles(path).sort((left, right) =>
    left.relPath.localeCompare(right.relPath),
  )) {
    hash.update(file.relPath);
    hash.update(readFileSync(file.src));
  }
}

function repairPlanId(workspace: string): string {
  const hash = createHash("sha256");
  hash.update("amanuensis-doctor-repair/v1\0");
  hash.update(codexBlock(serverLaunch(), "user", workspace));
  hashRepairInput(hash, join(codexHome(), "config.toml"));
  hashRepairInput(hash, join(workspace, ".codex", "config.toml"));
  hashRepairInput(hash, join(workspace, ".agents", "skills", "amanuensis"));
  return hash.digest("hex");
}

function doctorRepairPlans(workspace: string): Array<{
  flags: InitFlags;
  actions: PlanAction[];
  root: string;
}> {
  const shared = {
    dir: workspace,
    client: "codex" as const,
    dryRun: false,
    // A repair migrates an existing registration; it never writes into the
    // project's own agent instructions.
    agentInstructions: false,
  };
  const userFlags: InitFlags = {
    ...shared,
    force: true,
    mcpOnly: true,
    scope: "user",
  };
  const projectFlags: InitFlags = {
    ...shared,
    force: false,
    mcpOnly: false,
    scope: "project",
  };
  const user = buildPlan(userFlags, workspace);
  const project = buildUninstallPlan(projectFlags, workspace);
  return [
    { flags: userFlags, ...user },
    { flags: projectFlags, ...project },
  ];
}

function publicRepairAction(action: PlanAction): JsonObject {
  if (action.kind === "backup" || action.kind === "archive") {
    return { kind: action.kind, from: action.from, to: action.to };
  }
  if (action.kind === "write-file") {
    return {
      kind: action.kind,
      path: action.path,
      mode: action.mode,
      contentSha256: createHash("sha256").update(action.content).digest("hex"),
    };
  }
  if (action.kind === "skip-file" || action.kind === "conflict") {
    return { kind: action.kind, path: action.path, reason: action.reason };
  }
  return { kind: action.kind, path: action.path };
}

function applyPlan(
  actions: PlanAction[],
  flags: InitFlags,
  workspace: string,
  quiet = false,
): void {
  const conflicts = actions.filter((action) => action.kind === "conflict");
  if (conflicts.length > 0) {
    const detail = conflicts
      .map((action) => `  ${relative(workspace, action.path) || "."}: ${action.reason}`)
      .join("\n");
    throw new Error(
      `installation has ${conflicts.length} conflict(s); nothing was written:\n${detail}`,
    );
  }

  for (const action of actions) {
    const rel = (path: string) => relative(workspace, path) || ".";
    if (action.kind === "backup" || action.kind === "archive") {
      assertSafeRootPath(workspace, action.from);
      assertSafeRootPath(workspace, action.to);
    } else if (action.kind !== "conflict" && action.kind !== "skip-file") {
      // A skip writes nothing, so it needs no containment check; a linked
      // development skill is reported through one.
      assertSafeRootPath(workspace, action.path);
    }
    switch (action.kind) {
      case "mkdir":
        if (flags.dryRun) {
          if (!quiet) console.log(`[dry-run] mkdir ${rel(action.path)}`);
        } else mkdirSync(action.path, { recursive: true });
        break;
      case "backup":
        if (flags.dryRun) {
          if (!quiet) console.log(`[dry-run] backup ${rel(action.from)} → ${rel(action.to)}`);
        } else copyFileSync(action.from, action.to);
        break;
      case "archive":
        if (flags.dryRun) {
          if (!quiet)
            console.log(`[dry-run] archive obsolete agent ${rel(action.from)} → ${rel(action.to)}`);
        } else {
          renameSync(action.from, action.to);
          if (!quiet)
            console.log(`  ~ archived obsolete agent ${rel(action.from)} → ${rel(action.to)}`);
        }
        break;
      case "write-file":
        if (flags.dryRun) {
          if (!quiet) console.log(`[dry-run] ${action.mode} ${rel(action.path)}`);
        } else {
          mkdirSync(dirname(action.path), { recursive: true });
          const mode = lstatExists(action.path) ? statSync(action.path).mode & 0o777 : 0o644;
          atomicWrite(action.path, action.content, mode);
          if (!quiet) console.log(`  ${action.mode === "create" ? "+" : "~"} ${rel(action.path)}`);
        }
        break;
      case "edit-json": {
        if (flags.dryRun) {
          const exists = lstatExists(action.path);
          if (!quiet && exists)
            console.log(`[dry-run] backup ${rel(action.path)} → ${rel(action.backupTo)}`);
          if (!quiet)
            console.log(`[dry-run] ${exists ? "overwrite" : "create"} ${rel(action.path)}`);
          break;
        }
        const outcome = applyJsonEdit(action);
        if (!quiet && outcome !== "unchanged")
          console.log(`  ${outcome === "create" ? "+" : "~"} ${rel(action.path)}`);
        break;
      }
      case "remove-file":
        if (flags.dryRun) {
          if (!quiet) console.log(`[dry-run] remove obsolete skill file ${rel(action.path)}`);
        } else {
          rmSync(action.path, { force: false });
          if (!quiet) console.log(`  - removed obsolete skill file ${rel(action.path)}`);
        }
        break;
      case "skip-file":
        if (!quiet) console.log(`  · ${rel(action.path)}  (${action.reason})`);
        break;
      case "remove-tree":
        if (flags.dryRun) {
          if (!quiet) console.log(`[dry-run] remove managed skill ${rel(action.path)}`);
        } else {
          rmSync(action.path, { recursive: true, force: false });
          if (!quiet) console.log(`  - removed managed skill ${rel(action.path)}`);
        }
        break;
      case "conflict":
        break;
    }
  }
}

/**
 * Replace a file by writing a sibling and renaming it over the original, so a
 * reader never sees a truncated file and an interruption leaves the old one.
 */
function atomicWrite(path: string, content: string, mode: number): void {
  const temp = join(dirname(path), `.${basename(path)}.amanuensis-${process.pid}.tmp`);
  try {
    writeFileSync(temp, content, { encoding: "utf8", mode, flag: "wx" });
    chmodSync(temp, mode);
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

/**
 * Apply one `mcpServers` edit to the file as it is now. Everything else in
 * the file, including whatever another program wrote after planning, is kept.
 */
function applyJsonEdit(
  action: Extract<PlanAction, { kind: "edit-json" }>,
): "create" | "overwrite" | "unchanged" {
  const name = action.keyPath.at(-1) as string;
  if (!lstatExists(action.path)) {
    if (action.value === undefined) return "unchanged";
    atomicWrite(
      action.path,
      `${JSON.stringify({ mcpServers: { [name]: action.value } }, null, 2)}\n`,
      0o600,
    );
    return "create";
  }
  const { raw, servers } = readUserServers(action.path);
  const prior = servers[name];
  if (prior === undefined && action.value === undefined) return "unchanged";
  if (prior !== undefined && !isManagedUserEntry(prior) && !action.allowUnmanaged) {
    throw new Error(
      `${action.path} gained a hand-written ${name} entry during installation; it was not changed. Rerun to see the conflict.`,
    );
  }
  copyFileSync(action.path, action.backupTo);
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const content = applyEdits(
    raw,
    modify(raw, action.keyPath, action.value, {
      formattingOptions: { insertSpaces: true, tabSize: 2, eol },
    }),
  );
  atomicWrite(action.path, content, statSync(action.path).mode & 0o777);
  return "overwrite";
}

function printNextSteps(
  client: Client,
  workspace: string,
  scope: InstallScope,
  operation: "install" | "upgrade" = "install",
): void {
  if (client === "generic") {
    const launch = serverLaunch();
    console.log("");
    console.log("Register this local stdio server in your MCP host:");
    console.log(`  command: ${JSON.stringify(launch.command)}`);
    console.log(
      `  args: ${JSON.stringify([...launch.args, "--allow-workspace-pin", "--workspace", workspace])}`,
    );
    console.log("  environment: AMANUENSIS_AUTOPROGRESS=1");
    console.log("If the host implements Agent Skills, point it at .agents/skills/amanuensis/");
    console.log("and ask it to run Amanuensis onboarding. Otherwise the typed MCP tools and");
    console.log("concise server instructions are available, but the full method is not automatic.");
    return;
  }
  console.log("");
  if (client === "codex" && scope === "user") {
    console.log("");
    console.log(
      operation === "upgrade"
        ? "Restart Codex once to load the upgraded user-scoped Amanuensis installation."
        : "Restart Codex once to load the user-scoped Amanuensis registration.",
    );
    console.log("New trusted Git repositories then require no Amanuensis setup or restart.");
    return;
  }
  console.log("Ready. Start your agent in this project and ask it to run Amanuensis onboarding.");
  if (client === "claude")
    console.log("Claude Code can also invoke the installed /amanuensis skill.");
  if (client === "codex") console.log("Codex can also invoke the installed $amanuensis skill.");
  if (client === "vscode") console.log("The installed Agent Skill is available to VS Code agents.");
}

function emitDoctorReport(
  report: JsonObject & { diagnoses: DoctorDiagnosis[] },
  json: boolean,
): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  const repository = report.repository as JsonObject;
  const configuration = report.configuration as JsonObject;
  console.log(`Amanuensis doctor: ${report.status}`);
  console.log(`  repository: ${repository.canonicalRoot}`);
  console.log(`  storage: ${repository.storagePath}`);
  console.log(`  effective config: ${configuration.effectiveSource}`);
  for (const diagnosis of report.diagnoses) {
    console.log(`  [${diagnosis.code}] ${diagnosis.message}`);
    console.log(`    path: ${diagnosis.path}`);
    console.log(`    repair: ${diagnosis.remediation}`);
  }
  if (report.repairPlanId) console.log(`  repair plan: ${report.repairPlanId}`);
}

function cmdDoctor(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: {
      client: { type: "string", default: "codex" },
      dir: { type: "string", default: process.cwd() },
      repair: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      "apply-plan": { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
    strict: true,
  });
  if (values.help) {
    printUsage();
    return;
  }
  if (parseClient(values.client) !== "codex") {
    throw new Error("doctor currently supports only Codex");
  }
  if (values["dry-run"] && !values.repair) {
    throw new Error("doctor --dry-run requires --repair");
  }
  if (values["apply-plan"] && !values.repair) {
    throw new Error("doctor --apply-plan requires --repair");
  }
  if (values.repair && !values["dry-run"] && !values["apply-plan"]) {
    throw new Error("doctor --repair requires --dry-run or --apply-plan <ID>");
  }
  if (values["dry-run"] && values["apply-plan"]) {
    throw new Error("doctor accepts either --dry-run or --apply-plan, not both");
  }

  const requestedWorkspace = resolve(values.dir as string);
  if (!existsSync(requestedWorkspace) || !statSync(requestedWorkspace).isDirectory()) {
    throw new Error(`target directory does not exist or is not a directory: ${requestedWorkspace}`);
  }
  const workspace = canonicalGitRoot(requestedWorkspace);
  let report = doctorReport(workspace);

  if (values.repair) {
    const planId = repairPlanId(workspace);
    const plans = doctorRepairPlans(workspace);
    const actions = plans.flatMap((plan) => plan.actions);
    report.repairPlanId = planId;
    report.repairActions = actions.map(publicRepairAction);
    const conflicts = actions.filter((action) => action.kind === "conflict");
    const firstConflict = conflicts[0];
    if (firstConflict) {
      report.diagnoses.push({
        code: "repair-conflict",
        path: firstConflict.path,
        message: conflicts.map((conflict) => conflict.reason).join("; "),
        remediation: "Resolve the named conflict manually, then request a new dry-run plan.",
      });
      report.status = "error";
    } else if (values["apply-plan"] && values["apply-plan"] !== planId) {
      report.diagnoses.push({
        code: "stale-repair-plan",
        path: join(codexHome(), "config.toml"),
        message:
          "The supplied repair plan does not match the current configuration and skill inputs.",
        remediation: "Run doctor --repair --dry-run again and apply the newly returned plan ID.",
      });
      report.status = "error";
    } else if (values["apply-plan"] === planId) {
      for (const plan of plans) applyPlan(plan.actions, plan.flags, plan.root, true);
      const postRepair = doctorReport(workspace);
      postRepair.appliedPlanId = planId;
      postRepair.repairActions = actions.map(publicRepairAction);
      report = postRepair;
    }
  }

  emitDoctorReport(report, values.json as boolean);
  if (report.status !== "ok") process.exitCode = 1;
}

function assertUpgradeableCodexInstallation(workspace: string, flags: InitFlags): void {
  if (flags.client !== "codex" || flags.scope !== "user") {
    throw new Error("upgrade currently supports only the user-scoped Codex installation");
  }
  const configPath = join(codexHome(), "config.toml");
  if (!existsSync(configPath)) {
    throw new Error("no user-scoped Codex installation found; run `amanuensis install` first");
  }
  assertSafeRootPath(codexHome(), configPath);
  const existing = readFileSync(configPath, "utf8");
  let entry: JsonObject | undefined;
  try {
    entry = codexServerEntry(parseToml(existing) as Record<string, unknown>);
  } catch {
    entry = undefined;
  }
  if (!entry || !codexEntryIsManaged(existing, entry)) {
    throw new Error(
      "the user-scoped Codex registration is absent, unmanaged, or incomplete; run doctor before upgrade",
    );
  }
  if (!flags.mcpOnly) {
    const skill = skillDestination(workspace, "codex", "user");
    // A development link is left in place by the plan, exactly as install does.
    if (lstatExists(skill) && lstatSync(skill).isSymbolicLink()) return;
    if (!existsSync(skill) || !statSync(skill).isDirectory()) {
      throw new Error(
        "the user-scoped Amanuensis skill is absent or unsafe; run doctor before upgrade",
      );
    }
  }
}

function cmdInstall(argv: string[], operation: "init" | "install" | "upgrade" = "init"): void {
  const { values } = parseArgs({
    args: argv,
    options: {
      client: { type: "string" },
      scope: { type: "string" },
      dir: { type: "string", default: process.cwd() },
      force: { type: "boolean", default: false },
      "mcp-only": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      "agent-instructions": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
    strict: true,
  });
  if (values.help) {
    printUsage();
    return;
  }
  if (operation !== "init" && isUserLevelRequest(values.client, values.scope)) {
    cmdUserInstall(values, operation);
    return;
  }
  const client = parseClient(values.client ?? (operation === "init" ? undefined : "codex"));
  const flags: InitFlags = {
    dir: values.dir as string,
    client,
    dryRun: values["dry-run"] as boolean,
    force: operation === "upgrade" ? true : (values.force as boolean),
    mcpOnly: values["mcp-only"] as boolean,
    scope: parseScope(values.scope, client, operation),
    agentInstructions: values["agent-instructions"] as boolean,
  };
  if (flags.client === "generic" && flags.mcpOnly) {
    throw new Error(
      "--mcp-only is unavailable for generic clients because there is no project MCP adapter to configure",
    );
  }
  const requestedWorkspace = resolve(flags.dir);
  if (!existsSync(requestedWorkspace) || !statSync(requestedWorkspace).isDirectory()) {
    throw new Error(`target directory does not exist or is not a directory: ${requestedWorkspace}`);
  }
  const workspace = realpathSync(requestedWorkspace);
  if (operation === "upgrade") assertUpgradeableCodexInstallation(workspace, flags);
  if (flags.scope === "user" && !flags.dryRun && !existsSync(codexHome())) {
    mkdirSync(codexHome(), { recursive: true });
  }
  const installationRoot = flags.scope === "user" ? codexHome() : workspace;
  console.log(
    `${flags.dryRun ? "[dry-run] " : ""}${operation === "upgrade" ? "Upgrading" : "Installing"} Amanuensis for ${flags.client} (${flags.scope}) into ${installationRoot}`,
  );
  const plan = buildPlan(flags, workspace);
  applyPlan(plan.actions, flags, plan.root);
  if (!flags.agentInstructions && agentInstructionsApplies(flags))
    printAgentInstructionsOffer(workspace, flags);
  if (!flags.dryRun) {
    printNextSteps(
      flags.client,
      workspace,
      flags.scope,
      operation === "upgrade" ? "upgrade" : "install",
    );
  }
}

function cmdUninstall(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: {
      client: { type: "string" },
      scope: { type: "string" },
      dir: { type: "string", default: process.cwd() },
      force: { type: "boolean", default: false },
      "mcp-only": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
    strict: true,
  });
  if (values.help) {
    printUsage();
    return;
  }
  if (isUserLevelRequest(values.client, values.scope)) {
    cmdUserUninstall(values);
    return;
  }
  const client = parseClient(values.client);
  if (client !== "codex") throw new Error("uninstall at project scope supports only Codex");
  const flags: InitFlags = {
    dir: values.dir as string,
    client,
    dryRun: values["dry-run"] as boolean,
    force: values.force as boolean,
    mcpOnly: values["mcp-only"] as boolean,
    scope: parseScope(values.scope, client),
    agentInstructions: false,
  };
  const requestedWorkspace = resolve(flags.dir);
  if (!existsSync(requestedWorkspace) || !statSync(requestedWorkspace).isDirectory()) {
    throw new Error(`target directory does not exist or is not a directory: ${requestedWorkspace}`);
  }
  const workspace = realpathSync(requestedWorkspace);
  const root = flags.scope === "user" ? codexHome() : workspace;
  if (!existsSync(root)) {
    console.log(`${flags.dryRun ? "[dry-run] " : ""}Amanuensis is not installed at ${root}`);
    return;
  }
  console.log(
    `${flags.dryRun ? "[dry-run] " : ""}Uninstalling Amanuensis for Codex (${flags.scope}) from ${root}`,
  );
  const plan = buildUninstallPlan(flags, workspace);
  applyPlan(plan.actions, flags, plan.root);
  if (!flags.dryRun) {
    console.log("Restart Codex once to stop using the removed registration.");
    console.log("Repository conspectus storage was not changed.");
  }
}

type CliValues = Record<string, string | boolean | undefined>;

/**
 * install, upgrade and uninstall act at user level unless a project scope is
 * asked for or the named client has no user-level installation (vscode,
 * generic), which keeps their per-project behavior.
 */
function isUserLevelRequest(client: unknown, scope: unknown): boolean {
  if (scope === "project") return false;
  if (client == null) return true;
  return String(client)
    .split(",")
    .map((name) => name.trim())
    .every((name) => (USER_HOSTS as readonly string[]).includes(name));
}

function existingDirectory(dir: string): string {
  const requested = resolve(dir);
  if (!existsSync(requested) || !statSync(requested).isDirectory()) {
    throw new Error(`target directory does not exist or is not a directory: ${requested}`);
  }
  return realpathSync(requested);
}

function assertUpgradeableUserInstallation(
  host: UserHost,
  flags: InitFlags,
  workspace: string,
): void {
  if (host === "codex") {
    assertUpgradeableCodexInstallation(workspace, flags);
    return;
  }
  if (!hasUserInstallation(host)) {
    throw new Error(
      `no ${HOST_LABEL[host]} installation found at ${userConfigPath(host)}; run \`amanuensis install --client ${host}\` first`,
    );
  }
}

function throwOnConflicts(plans: Array<{ host: UserHost; segments: PlanSegment[] }>): void {
  const conflicts = plans.flatMap(({ host, segments }) =>
    segments.flatMap((segment) =>
      segment.actions
        .filter((action) => action.kind === "conflict")
        .map((action) => `  ${host}: ${action.path}: ${(action as { reason: string }).reason}`),
    ),
  );
  if (conflicts.length > 0) {
    throw new Error(
      `installation has ${conflicts.length} conflict(s); nothing was written:\n${conflicts.join("\n")}`,
    );
  }
}

function cmdUserInstall(values: CliValues, operation: "install" | "upgrade"): void {
  if (values["agent-instructions"]) {
    throw new Error(
      "--agent-instructions writes into a project; use `amanuensis init --client <name> --dir <project> --agent-instructions`",
    );
  }
  const workspace = existingDirectory(values.dir as string);
  const named = typeof values.client === "string" ? parseUserHosts(values.client) : null;
  const hosts =
    named ??
    (operation === "install"
      ? USER_HOSTS.filter(hostPresent)
      : USER_HOSTS.filter(hasUserInstallation));
  if (hosts.length === 0) {
    throw new Error(
      operation === "install"
        ? "found no Codex, Claude Code, or GitHub Copilot on this machine; install one, or name it with --client codex, claude, or copilot"
        : "no Amanuensis installation found; run `amanuensis install` first",
    );
  }
  const dryRun = values["dry-run"] as boolean;
  const base: InitFlags = {
    dir: workspace,
    client: hosts[0] as UserHost,
    dryRun,
    force: operation === "upgrade" ? true : (values.force as boolean),
    mcpOnly: values["mcp-only"] as boolean,
    scope: "user",
    agentInstructions: false,
  };
  if (!dryRun) {
    for (const host of hosts) mkdirSync(userHostHome(host), { recursive: true });
  }
  const plans = hosts.map((host) => {
    const flags = userFlags(host, base);
    if (operation === "upgrade") assertUpgradeableUserInstallation(host, flags, workspace);
    const segments = buildUserPlan(host, flags, workspace);
    for (const segment of segments) preflightWritable(segment);
    return { host, flags, segments };
  });
  throwOnConflicts(plans);
  for (const { host, flags, segments } of plans) {
    console.log(
      `${dryRun ? "[dry-run] " : ""}${operation === "upgrade" ? "Upgrading" : "Installing"} Amanuensis for ${host} (user) into ${userHostHome(host)}`,
    );
    for (const segment of segments) applyPlan(segment.actions, flags, segment.root);
  }
  if (dryRun) return;
  for (const warning of prerequisiteWarnings()) console.log(`\nNote: ${warning}`);
  console.log("");
  // Only a host whose files changed has anything new to load.
  const changing = new Set(["write-file", "edit-json", "remove-file", "remove-tree", "archive"]);
  const changed = plans
    .filter(({ segments }) =>
      segments.some((segment) => segment.actions.some((action) => changing.has(action.kind))),
    )
    .map(({ host }) => host);
  if (changed.length === 0) console.log("Everything was already up to date; nothing to restart.");
  for (const host of changed) {
    console.log(
      operation === "upgrade"
        ? `Restart ${HOST_LABEL[host]} once to load the upgraded Amanuensis installation.`
        : `Restart ${HOST_LABEL[host]} once to load the Amanuensis registration.`,
    );
  }
  console.log("New trusted Git repositories then require no Amanuensis setup or restart.");
  console.log('Open a Git repository in your agent and ask it to "run Amanuensis onboarding".');
  console.log("Check the installation at any time with: amanuensis status");
}

function cmdUserUninstall(values: CliValues): void {
  const workspace = existingDirectory(values.dir as string);
  const named = typeof values.client === "string" ? parseUserHosts(values.client) : null;
  const hosts = named ?? USER_HOSTS.filter(hasAnyUserInstallation);
  const dryRun = values["dry-run"] as boolean;
  if (hosts.length === 0) {
    console.log(`${dryRun ? "[dry-run] " : ""}Amanuensis is not installed for any host`);
    return;
  }
  const base: InitFlags = {
    dir: workspace,
    client: hosts[0] as UserHost,
    dryRun,
    force: values.force as boolean,
    mcpOnly: values["mcp-only"] as boolean,
    scope: "user",
    agentInstructions: false,
  };
  const plans = hosts
    .filter((host) => host !== "codex" || existsSync(codexHome()))
    .map((host) => {
      const flags = userFlags(host, base);
      const segments = buildUserUninstallPlan(host, flags, workspace);
      for (const segment of segments) preflightWritable(segment);
      return { host, flags, segments };
    });
  if (plans.length === 0) {
    console.log(`${dryRun ? "[dry-run] " : ""}Amanuensis is not installed at ${codexHome()}`);
    return;
  }
  throwOnConflicts(plans);
  for (const { host, flags, segments } of plans) {
    console.log(
      `${dryRun ? "[dry-run] " : ""}Uninstalling Amanuensis for ${host === "codex" ? "Codex" : HOST_LABEL[host]} (user) from ${userHostHome(host)}`,
    );
    for (const segment of segments) applyPlan(segment.actions, flags, segment.root);
  }
  if (dryRun) return;
  for (const { host } of plans) {
    console.log(`Restart ${HOST_LABEL[host]} once to stop using the removed registration.`);
  }
  console.log("Repository conspectus storage was not changed.");
}

function pythonVersion(): { command: string; version: string | null } {
  const command = process.env.AMANUENSIS_PYTHON?.trim() || "python3";
  try {
    const version = execFileSync(
      command,
      ["-c", "import sys; print('%d.%d' % sys.version_info[:2])"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: DOCTOR_PROBE_TIMEOUT_MS,
        killSignal: "SIGKILL",
      },
    ).trim();
    return { command, version: version || null };
  } catch {
    return { command, version: null };
  }
}

function atLeast(version: string | null, major: number, minor: number): boolean {
  if (!version) return false;
  const [left = 0, right = 0] = version.split(".").map((part) => Number.parseInt(part, 10));
  return left > major || (left === major && right >= minor);
}

/** Python runs only the publication step, so its absence is a note, not a failure. */
function prerequisiteWarnings(): string[] {
  const python = pythonVersion();
  if (atLeast(python.version, 3, 11)) return [];
  return [
    python.version
      ? `${python.command} is Python ${python.version}; publishing the human-readable map needs Python 3.11 or newer (set AMANUENSIS_PYTHON to choose another interpreter).`
      : `${python.command} was not found; publishing the human-readable map needs Python 3.11 or newer (set AMANUENSIS_PYTHON to choose another interpreter). Everything else works without it.`,
  ];
}

/**
 * Whether the server's native SQLite module loads. npm builds it with an
 * install script; an npm that declines to run the script leaves the package
 * installed but unable to open any store.
 */
function databaseModule(): { ok: boolean; error?: string } {
  try {
    const Database = createRequire(import.meta.url)("better-sqlite3") as new (
      path: string,
    ) => { prepare: (sql: string) => { get: () => unknown }; close: () => void };
    const db = new Database(":memory:");
    db.prepare("select 1").get();
    db.close();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message.split("\n")[0] };
  }
}

function cmdStatus(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: {
      json: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
    strict: true,
  });
  if (values.help) {
    printUsage();
    return;
  }
  const launcherReady = launcherAvailable();
  const database = databaseModule();
  const hosts = USER_HOSTS.map((host) => {
    const registration = userRegistrationState(host);
    const skill = userSkillState(host);
    const installed =
      registration === "installed" &&
      (skill === "installed" || skill === "linked") &&
      launcherReady;
    return {
      host,
      label: HOST_LABEL[host],
      detected: hostPresent(host),
      installed,
      registration,
      registrationPath: userConfigPath(host),
      skill,
      skillPath: join(userHostHome(host), "skills", "amanuensis"),
    };
  });
  const anyInstalled = hosts.some((host) => host.installed);
  const ok = anyInstalled && database.ok && hosts.every((host) => host.installed || !host.detected);
  const python = pythonVersion();
  const report = {
    status: ok ? "ok" : "incomplete",
    version: packageVersion,
    node: process.versions.node,
    launcher: { ...serverLaunch(), available: launcherReady },
    database,
    python: {
      command: python.command,
      version: python.version,
      ok: atLeast(python.version, 3, 11),
    },
    hosts,
    next: ok
      ? 'Restart any host installed since it was opened, then ask it to "run Amanuensis onboarding" in a Git repository.'
      : !database.ok
        ? `The database module (better-sqlite3) does not load: ${database.error}. Reinstall with \`npm install -g @gruetech/amanuensis\`, allowing its install script to run.`
        : !launcherReady
          ? `The server launcher ${serverLaunch().command} cannot be found; reinstall the package with \`npm install -g @gruetech/amanuensis\`.`
          : hosts.some((host) => host.registration === "outdated" || host.skill === "outdated")
            ? "Run `amanuensis upgrade`."
            : "Run `amanuensis install`.",
  };
  if (values.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    console.log(`Amanuensis ${packageVersion}: ${report.status}`);
    for (const host of hosts) {
      const state = host.installed
        ? "installed"
        : host.detected
          ? `not installed (registration ${host.registration}, skill ${host.skill})`
          : "not found on this machine";
      console.log(`  ${host.label}: ${state}`);
    }
    console.log(
      `  Database module: ${database.ok ? "loads" : `does not load (${database.error})`}`,
    );
    if (!launcherReady) console.log(`  Server launcher: ${serverLaunch().command} not found`);
    console.log(
      `  Python: ${python.version ? `${python.version} (${python.command})` : `not found (${python.command})`}${report.python.ok ? "" : " — needed only to publish the human-readable map"}`,
    );
    console.log(`Next: ${report.next}`);
  }
  if (!ok) process.exitCode = 1;
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    printUsage();
    return;
  }
  const subcommand = argv[0];
  try {
    if (subcommand === "init") cmdInstall(argv.slice(1), "init");
    else if (subcommand === "install") cmdInstall(argv.slice(1), "install");
    else if (subcommand === "upgrade") cmdInstall(argv.slice(1), "upgrade");
    else if (subcommand === "doctor") cmdDoctor(argv.slice(1));
    else if (subcommand === "status") cmdStatus(argv.slice(1));
    else if (subcommand === "uninstall") cmdUninstall(argv.slice(1));
    else {
      process.stderr.write(`unknown subcommand: ${subcommand}\n\n`);
      printUsage();
      process.exit(2);
    }
  } catch (error) {
    process.stderr.write(`amanuensis: ${(error as Error).message}\n`);
    process.exit(1);
  }
}

main();
