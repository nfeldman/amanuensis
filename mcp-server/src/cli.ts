#!/usr/bin/env node
// Amanuensis client installer and lifecycle manager.
//
// MCP standardizes the server protocol, not project configuration discovery.
// The installer therefore keeps one portable workflow skill and emits the
// small adapter required by the selected client.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
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
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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

type Client = "claude" | "codex" | "vscode" | "generic";
type InstallScope = "user" | "project";

type InitFlags = {
  dir: string;
  client: Client;
  dryRun: boolean;
  force: boolean;
  mcpOnly: boolean;
  scope: InstallScope;
};

type PlanAction =
  | { kind: "write-file"; path: string; content: string; mode: "create" | "overwrite" }
  | { kind: "backup"; from: string; to: string }
  | { kind: "archive"; from: string; to: string }
  | { kind: "skip-file"; path: string; reason: string }
  | { kind: "conflict"; path: string; reason: string }
  | { kind: "mkdir"; path: string }
  | { kind: "remove-tree"; path: string };

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
  const root = realpathSync(rootPath);
  const resolvedTarget = join(root, relative(lexicalRoot, lexicalTarget));
  let cursor = root;
  for (const segment of relative(root, resolvedTarget).split(sep).filter(Boolean)) {
    cursor = join(cursor, segment);
    if (!existsSync(cursor)) break;
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
      "amanuensis — install the Amanuensis MCP server and workflow skill into a project.",
      "",
      "Usage:",
      "  amanuensis init --client <claude|codex|vscode|generic> [options]",
      "  amanuensis doctor --client codex [options]",
      "  amanuensis uninstall --client codex [options]",
      "",
      "Options:",
      "  --client <name>  Target agent runtime. Required because MCP clients use",
      "                   different project configuration files.",
      "  --dir <path>     Target project (default: current directory).",
      "  --scope <name>   Codex installation scope: user (default) or project.",
      "  --force          Replace conflicting Amanuensis-managed files; config",
      "                   migrations receive timestamped backups.",
      "  --mcp-only       Configure only the MCP launcher. Intended for",
      "                   local development with a live global skill symlink.",
      "  --dry-run        Print the complete plan; write nothing.",
      "  --repair         With doctor, prepare a bounded user/project migration.",
      "  --apply-plan ID  Apply only the exact repair plan ID returned by dry-run.",
      "  --json           Emit the doctor report as machine-readable JSON.",
      "  --help           Show this message.",
      "",
      "Client adapters:",
      "  claude   .mcp.json + .claude/skills/amanuensis/",
      "  codex    user: $CODEX_HOME/config.toml + skills/amanuensis/",
      "           project pin: .codex/config.toml + .agents/skills/amanuensis/",
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
  if (value === "claude" || value === "codex" || value === "vscode" || value === "generic") {
    return value;
  }
  if (value == null) {
    throw new Error(
      "--client is required (claude, codex, vscode, or generic); MCP does not standardize a universal project config file",
    );
  }
  throw new Error(
    `unsupported --client ${JSON.stringify(value)}; expected claude, codex, vscode, or generic`,
  );
}

function parseScope(value: string | undefined, client: Client): InstallScope {
  if (value == null) return client === "codex" ? "user" : "project";
  if (value !== "user" && value !== "project") {
    throw new Error(`unsupported --scope ${JSON.stringify(value)}; expected user or project`);
  }
  if (value === "user" && client !== "codex") {
    throw new Error("--scope user is currently supported only for Codex");
  }
  return value;
}

function codexHome(): string {
  return resolve(process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"));
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
  if (client === "codex" && scope === "user") return join(codexHome(), "skills", "amanuensis");
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

function canonicalGitRoot(path: string): string {
  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: path,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
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
  if (typeof selected !== "string") return fallback;
  if (selected.includes("${")) return undefined;
  const candidate = isAbsolute(selected) ? selected : resolve(fallback, selected);
  return existsSync(candidate) ? canonicalGitRoot(candidate) : resolve(candidate);
}

function inspectCodexRegistration(
  path: string,
  root: string,
  workspace: string,
): CodexRegistration {
  assertSafeRootPath(root, path);
  if (!existsSync(path)) return { path, present: false, managed: false };
  const raw = readFileSync(path, "utf8");
  const managed = raw.includes(CODEX_BLOCK_START) && raw.includes(CODEX_BLOCK_END);
  try {
    const parsed = parseToml(raw) as Record<string, unknown>;
    const servers = parsed.mcp_servers;
    const entry = isJsonObject(servers) ? servers[SERVER_NAME] : undefined;
    if (!isJsonObject(entry)) return { path, present: true, managed };
    return {
      path,
      present: true,
      managed,
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
  if (userHasEntry && userConfig.workspace !== repositoryRoot) {
    diagnose({
      code: "hard-coded-user-workspace",
      path: userConfig.path,
      message: `The user registration selects ${userConfig.workspace ?? "an unresolved workspace"} instead of resolving the task cwd.`,
      remediation: "Migrate the user entry to the cwd-relative `codex-user-cwd-v1` contract.",
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
  if (existsSync(userSkill) && existsSync(projectSkill)) {
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

function planSkill(
  actions: PlanAction[],
  workspace: string,
  flags: InitFlags,
  planMkdir: (dir: string) => void,
): void {
  const source = findBundledSkill();
  const destination = skillDestination(workspace, flags.client, flags.scope);
  planMkdir(destination);
  for (const { relPath, src } of walkFiles(source)) {
    const dest = join(destination, relPath);
    assertSafeRootPath(flags.scope === "user" ? codexHome() : workspace, dest);
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
}

function planSkillUninstall(actions: PlanAction[], workspace: string, flags: InitFlags): void {
  const root = flags.scope === "user" ? codexHome() : workspace;
  const destination = skillDestination(workspace, flags.client, flags.scope);
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
  const start = existing.indexOf(CODEX_BLOCK_START);
  const end = existing.indexOf(CODEX_BLOCK_END);
  const hasManagedMarker = start >= 0 || end >= 0;
  if (hasManagedMarker) {
    const startCount = existing.split(CODEX_BLOCK_START).length - 1;
    const endCount = existing.split(CODEX_BLOCK_END).length - 1;
    if (start < 0 || end < start || startCount !== 1 || endCount !== 1) {
      throw new Error(`${configPath} contains an incomplete Amanuensis-managed block`);
    }
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseToml(existing) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`${configPath} is not parseable TOML (${(error as Error).message})`);
  }

  if (hasManagedMarker) {
    const blockEnd = end + CODEX_BLOCK_END.length;
    const priorBlock = existing.slice(start, blockEnd);
    if (priorBlock === desiredBlock) {
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
    actions.push({ kind: "backup", from: configPath, to: backupPath(configPath) });
    actions.push({
      kind: "write-file",
      path: configPath,
      content: existing.slice(0, start) + desiredBlock + existing.slice(blockEnd),
      mode: "overwrite",
    });
    return;
  }

  const mcpServers = parsed.mcp_servers;
  if (isJsonObject(mcpServers) && Object.hasOwn(mcpServers, SERVER_NAME)) {
    if (flags.force) {
      const lines = existing.match(/.*(?:\r?\n|$)/g)?.filter(Boolean) ?? [];
      const header =
        /^\s*\[\s*mcp_servers\s*\.\s*(?:amanuensis-memory|"amanuensis-memory"|'amanuensis-memory')\s*\]\s*(?:#.*)?(?:\r?\n)?$/;
      const headerOrDescendant =
        /^\s*\[\[?\s*mcp_servers\s*\.\s*(?:amanuensis-memory|"amanuensis-memory"|'amanuensis-memory')(?=\s*(?:\.|\]))/;
      let offset = 0;
      let sectionStart = -1;
      let sectionEnd = -1;
      for (const line of lines) {
        if (sectionStart < 0 && header.test(line)) sectionStart = offset;
        else if (sectionStart >= 0 && /^\s*\[/.test(line) && !headerOrDescendant.test(line)) {
          sectionEnd = offset;
          break;
        }
        offset += line.length;
      }
      if (sectionStart >= 0) {
        if (sectionEnd < 0) sectionEnd = existing.length;
        const before = existing.slice(0, sectionStart);
        const after = existing.slice(sectionEnd);
        const left = before.length === 0 || before.endsWith("\n") ? before : `${before}\n`;
        const right = after.length === 0 || after.startsWith("\n") ? after : `\n${after}`;
        actions.push({ kind: "backup", from: configPath, to: backupPath(configPath) });
        actions.push({
          kind: "write-file",
          path: configPath,
          content: `${left}${desiredBlock}\n${right}`,
          mode: "overwrite",
        });
        return;
      }
    }
    actions.push({
      kind: "conflict",
      path: configPath,
      reason: `${SERVER_NAME} already has an unmanaged TOML section; remove or rename it before rerunning`,
    });
    return;
  }

  actions.push({ kind: "backup", from: configPath, to: backupPath(configPath) });
  const separator =
    existing.length === 0 || existing.endsWith("\n\n")
      ? ""
      : existing.endsWith("\n")
        ? "\n"
        : "\n\n";
  actions.push({
    kind: "write-file",
    path: configPath,
    content: `${existing}${separator}${desiredBlock}\n`,
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
  const start = existing.indexOf(CODEX_BLOCK_START);
  const end = existing.indexOf(CODEX_BLOCK_END);
  const startCount = existing.split(CODEX_BLOCK_START).length - 1;
  const endCount = existing.split(CODEX_BLOCK_END).length - 1;
  if (start < 0 && end < 0) {
    let parsed: Record<string, unknown>;
    try {
      parsed = parseToml(existing) as Record<string, unknown>;
    } catch (error) {
      throw new Error(`${configPath} is not parseable TOML (${(error as Error).message})`);
    }
    const mcpServers = parsed.mcp_servers;
    if (isJsonObject(mcpServers) && Object.hasOwn(mcpServers, SERVER_NAME)) {
      actions.push({
        kind: "conflict",
        path: configPath,
        reason: "Amanuensis server entry is unmanaged; migrate it before uninstalling",
      });
    } else {
      actions.push({ kind: "skip-file", path: configPath, reason: "managed server is absent" });
    }
    return;
  }
  if (start < 0 || end < start || startCount !== 1 || endCount !== 1) {
    throw new Error(`${configPath} contains an incomplete Amanuensis-managed block`);
  }
  const blockEnd = end + CODEX_BLOCK_END.length;
  actions.push({ kind: "backup", from: configPath, to: backupPath(configPath) });
  actions.push({
    kind: "write-file",
    path: configPath,
    content: existing.slice(0, start) + existing.slice(blockEnd),
    mode: "overwrite",
  });
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
    } else if (action.kind !== "conflict") {
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
          writeFileSync(action.path, action.content, "utf8");
          if (!quiet) console.log(`  ${action.mode === "create" ? "+" : "~"} ${rel(action.path)}`);
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

function printNextSteps(client: Client, workspace: string, scope: InstallScope): void {
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
    console.log("Restart Codex once to load the user-scoped Amanuensis registration.");
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

function cmdInit(argv: string[]): void {
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
  const client = parseClient(values.client);
  const flags: InitFlags = {
    dir: values.dir as string,
    client,
    dryRun: values["dry-run"] as boolean,
    force: values.force as boolean,
    mcpOnly: values["mcp-only"] as boolean,
    scope: parseScope(values.scope, client),
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
  if (flags.scope === "user" && !flags.dryRun && !existsSync(codexHome())) {
    mkdirSync(codexHome(), { recursive: true });
  }
  const installationRoot = flags.scope === "user" ? codexHome() : workspace;
  console.log(
    `${flags.dryRun ? "[dry-run] " : ""}Installing Amanuensis for ${flags.client} (${flags.scope}) into ${installationRoot}`,
  );
  const plan = buildPlan(flags, workspace);
  applyPlan(plan.actions, flags, plan.root);
  if (!flags.dryRun) printNextSteps(flags.client, workspace, flags.scope);
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
  const client = parseClient(values.client);
  if (client !== "codex") throw new Error("uninstall currently supports only Codex");
  const flags: InitFlags = {
    dir: values.dir as string,
    client,
    dryRun: values["dry-run"] as boolean,
    force: values.force as boolean,
    mcpOnly: values["mcp-only"] as boolean,
    scope: parseScope(values.scope, client),
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

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    printUsage();
    return;
  }
  const subcommand = argv[0];
  try {
    if (subcommand === "init") cmdInit(argv.slice(1));
    else if (subcommand === "doctor") cmdDoctor(argv.slice(1));
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
