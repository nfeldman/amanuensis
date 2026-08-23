#!/usr/bin/env node
// Amanuensis per-project installer.
//
// MCP standardizes the server protocol, not project configuration discovery.
// The installer therefore keeps one portable workflow skill and emits the
// small adapter required by the selected client.
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { applyEdits, modify, type ParseError, parse, printParseErrorCode } from "jsonc-parser";
import { parse as parseToml } from "smol-toml";

const moduleDir = dirname(fileURLToPath(import.meta.url));
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

type InitFlags = {
  dir: string;
  client: Client;
  dryRun: boolean;
  force: boolean;
  mcpOnly: boolean;
};

type PlanAction =
  | { kind: "write-file"; path: string; content: string; mode: "create" | "overwrite" }
  | { kind: "backup"; from: string; to: string }
  | { kind: "archive"; from: string; to: string }
  | { kind: "skip-file"; path: string; reason: string }
  | { kind: "conflict"; path: string; reason: string }
  | { kind: "mkdir"; path: string };

type JsonObject = Record<string, unknown>;

type ServerLaunch = { command: string; args: string[] };

function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function assertSafeWorkspacePath(workspace: string, target: string): void {
  const root = realpathSync(workspace);
  const resolvedTarget = resolve(target);
  if (!isWithin(root, resolvedTarget)) {
    throw new Error(`installer path escapes target project: ${target}`);
  }
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
      "",
      "Options:",
      "  --client <name>  Target agent runtime. Required because MCP clients use",
      "                   different project configuration files.",
      "  --dir <path>     Target project (default: current directory).",
      "  --force          Replace conflicting Amanuensis-managed files after",
      "                   writing timestamped backups.",
      "  --mcp-only       Configure only the project MCP launcher. Intended for",
      "                   local development with a live global skill symlink.",
      "  --dry-run        Print the complete plan; write nothing.",
      "  --help           Show this message.",
      "",
      "Client adapters:",
      "  claude   .mcp.json + .claude/skills/amanuensis/",
      "  codex    .codex/config.toml + .agents/skills/amanuensis/",
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

function skillDestination(workspace: string, client: Client): string {
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
      args: [...launch.args, "--workspace", "${CLAUDE_PROJECT_DIR:-.}"],
      env: { AMANUENSIS_AUTOPROGRESS: "1" },
    };
  }
  return {
    type: "stdio",
    command: launch.command,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: VS Code workspace variable syntax
    args: [...launch.args, "--workspace", "${workspaceFolder}"],
    env: { AMANUENSIS_AUTOPROGRESS: "1" },
  };
}

function codexBlock(launch: ServerLaunch): string {
  const lines = [
    CODEX_BLOCK_START,
    `[mcp_servers.${SERVER_NAME}]`,
    `command = ${JSON.stringify(launch.command)}`,
  ];
  if (launch.args.length > 0) {
    lines.push(`args = [${launch.args.map((arg) => JSON.stringify(arg)).join(", ")}]`);
  }
  return [...lines, 'cwd = "."', 'env = { AMANUENSIS_AUTOPROGRESS = "1" }', CODEX_BLOCK_END].join(
    "\n",
  );
}

function planSkill(
  actions: PlanAction[],
  workspace: string,
  flags: InitFlags,
  planMkdir: (dir: string) => void,
): void {
  const source = findBundledSkill();
  const destination = skillDestination(workspace, flags.client);
  planMkdir(destination);
  for (const { relPath, src } of walkFiles(source)) {
    const dest = join(destination, relPath);
    assertSafeWorkspacePath(workspace, dest);
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
        reason: "existing skill file differs; rerun with --force to replace it with a backup",
      });
      continue;
    }
    actions.push({ kind: "backup", from: dest, to: backupPath(dest) });
    actions.push({ kind: "write-file", path: dest, content, mode: "overwrite" });
  }
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
  assertSafeWorkspacePath(workspace, configPath);
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
  const configPath = join(workspace, ".codex", "config.toml");
  assertSafeWorkspacePath(workspace, configPath);
  const desiredBlock = codexBlock(serverLaunch());
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

function planLegacyAgents(actions: PlanAction[], workspace: string): void {
  const legacyRoot = join(workspace, ".github", "agents");
  for (const filename of LEGACY_AGENT_FILES) {
    const path = join(legacyRoot, filename);
    assertSafeWorkspacePath(workspace, path);
    if (!existsSync(path) || !statSync(path).isFile()) continue;
    actions.push({ kind: "archive", from: path, to: backupPath(path) });
  }
}

function buildPlan(flags: InitFlags): PlanAction[] {
  const actions: PlanAction[] = [];
  const workspace = realpathSync(resolve(flags.dir));
  const plannedMkdirs = new Set<string>();
  const planMkdir = (dir: string) => {
    assertSafeWorkspacePath(workspace, dir);
    if (plannedMkdirs.has(dir)) return;
    plannedMkdirs.add(dir);
    if (!existsSync(dir)) actions.push({ kind: "mkdir", path: dir });
  };

  planLegacyAgents(actions, workspace);
  if (!flags.mcpOnly) planSkill(actions, workspace, flags, planMkdir);
  if (flags.client === "claude" || flags.client === "vscode") {
    planJsonConfig(actions, workspace, flags.client, flags, planMkdir);
  } else if (flags.client === "codex") {
    planCodexConfig(actions, workspace, flags, planMkdir);
  }
  return actions;
}

function applyPlan(actions: PlanAction[], flags: InitFlags, workspace: string): void {
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
      assertSafeWorkspacePath(workspace, action.from);
      assertSafeWorkspacePath(workspace, action.to);
    } else if (action.kind !== "conflict") {
      assertSafeWorkspacePath(workspace, action.path);
    }
    switch (action.kind) {
      case "mkdir":
        if (flags.dryRun) console.log(`[dry-run] mkdir ${rel(action.path)}`);
        else mkdirSync(action.path, { recursive: true });
        break;
      case "backup":
        if (flags.dryRun) console.log(`[dry-run] backup ${rel(action.from)} → ${rel(action.to)}`);
        else copyFileSync(action.from, action.to);
        break;
      case "archive":
        if (flags.dryRun)
          console.log(`[dry-run] archive obsolete agent ${rel(action.from)} → ${rel(action.to)}`);
        else {
          renameSync(action.from, action.to);
          console.log(`  ~ archived obsolete agent ${rel(action.from)} → ${rel(action.to)}`);
        }
        break;
      case "write-file":
        if (flags.dryRun) console.log(`[dry-run] ${action.mode} ${rel(action.path)}`);
        else {
          mkdirSync(dirname(action.path), { recursive: true });
          writeFileSync(action.path, action.content, "utf8");
          console.log(`  ${action.mode === "create" ? "+" : "~"} ${rel(action.path)}`);
        }
        break;
      case "skip-file":
        console.log(`  · ${rel(action.path)}  (${action.reason})`);
        break;
      case "conflict":
        break;
    }
  }
}

function printNextSteps(client: Client, workspace: string): void {
  if (client === "generic") {
    const launch = serverLaunch();
    console.log("");
    console.log("Register this local stdio server in your MCP host:");
    console.log(`  command: ${JSON.stringify(launch.command)}`);
    console.log(`  args: ${JSON.stringify([...launch.args, "--workspace", workspace])}`);
    console.log("  environment: AMANUENSIS_AUTOPROGRESS=1");
    console.log("If the host implements Agent Skills, point it at .agents/skills/amanuensis/");
    console.log("and ask it to run Amanuensis onboarding. Otherwise the typed MCP tools and");
    console.log("concise server instructions are available, but the full method is not automatic.");
    return;
  }
  console.log("");
  console.log("Ready. Start your agent in this project and ask it to run Amanuensis onboarding.");
  if (client === "claude")
    console.log("Claude Code can also invoke the installed /amanuensis skill.");
  if (client === "codex") console.log("Codex can also invoke the installed $amanuensis skill.");
  if (client === "vscode") console.log("The installed Agent Skill is available to VS Code agents.");
}

function cmdInit(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: {
      client: { type: "string" },
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
  const flags: InitFlags = {
    dir: values.dir as string,
    client: parseClient(values.client),
    dryRun: values["dry-run"] as boolean,
    force: values.force as boolean,
    mcpOnly: values["mcp-only"] as boolean,
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
  console.log(
    `${flags.dryRun ? "[dry-run] " : ""}Installing Amanuensis for ${flags.client} into ${workspace}`,
  );
  const actions = buildPlan(flags);
  applyPlan(actions, flags, workspace);
  if (!flags.dryRun) printNextSteps(flags.client, workspace);
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
