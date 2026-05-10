#!/usr/bin/env node
// Amanuensis installer CLI.
//
// Usage:
//   npx amanuensis init                  # install into current dir
//   npx amanuensis init --dir <path>     # install into a specific dir
//   npx amanuensis init --dry-run        # show what would happen
//   npx amanuensis init --force          # overwrite existing amanuensis entries
//   npx amanuensis init --agents-dir <p> # custom agent-file directory
//
// Drops Amanuensis's .agent.md files into `.github/agents/` (the VS Code
// default discovery path as of early 2026) and merges a server entry
// into `.vscode/mcp.json`, preserving any other MCP servers the user
// already had configured.
//
// The CLI resolves the bundled agents directory by searching a small
// list of candidate locations, so it works both from a dev clone
// (`../agents/` relative to this file) and from an installed npm
// package (`../agents/` inside the package root after prepack).
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const moduleDir = dirname(fileURLToPath(import.meta.url));

type InitFlags = {
  dir: string;
  dryRun: boolean;
  force: boolean;
  agentsDir: string;
  mcpConfig: string;
};

function printUsage(): void {
  process.stdout.write(
    [
      "amanuensis — per-project installer for the Amanuensis methodology.",
      "",
      "Usage:",
      "  amanuensis init [options]",
      "",
      "Options:",
      "  --dir <path>          Target workspace dir (default: cwd)",
      "  --agents-dir <path>   Where to drop agent files, relative to workspace",
      "                        (default: .github/agents — VS Code's stable",
      "                        custom-agent discovery path)",
      "  --mcp-config <path>   MCP config file, relative to workspace",
      "                        (default: .vscode/mcp.json)",
      "  --force               Overwrite an existing `amanuensis-memory`",
      "                        server entry and/or clobber existing agent",
      "                        files. A timestamped backup is written first.",
      "  --dry-run             Print what would change; write nothing.",
      "  --help                Show this message.",
      "",
      "Behavior:",
      "  - Agent files are copied into <agents-dir>. Conflicting files are",
      "    preserved unless --force is passed (with backup).",
      "  - .vscode/mcp.json is merged: other MCP servers configured there",
      "    are preserved unchanged; only the `amanuensis-memory` entry is",
      "    managed by this installer. A backup is written before any",
      "    overwrite.",
      "  - The installer does NOT build the MCP server — it assumes",
      "    the `@gruetech/amanuensis` package is installed (e.g. `npm install",
      "    -g @gruetech/amanuensis`), which puts both `amanuensis` and",
      "    `amanuensis-memory` on PATH.",
      "",
    ].join("\n"),
  );
}

function findBundledAgents(): string {
  // Candidate paths, ordered from most-specific to least. The first one
  // that exists wins.
  //
  //   1. <pkgRoot>/agents/   — installed npm package shape (prepack
  //      copies agents into the mcp-server package at publish time)
  //   2. <pkgRoot>/../agents/ — dev clone where mcp-server is a subdir
  //      of the Amanuensis repo root.
  const pkgRoot = resolve(moduleDir, "..");
  const candidates = [join(pkgRoot, "agents"), join(pkgRoot, "..", "agents")];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isDirectory()) {
      // Require at least one .agent.md file so we don't pick an empty
      // dir or a stale copy.
      const files = readdirSync(c).filter((f) => f.endsWith(".agent.md"));
      if (files.length > 0) return c;
    }
  }
  throw new Error(
    `could not locate bundled agent files. Searched:\n  ${candidates.join("\n  ")}\n` +
      "If running from a dev clone, make sure you are inside the repo and " +
      "the agents/ directory exists. If installed via npm, re-install the package.",
  );
}

interface McpConfig {
  servers?: Record<string, unknown>;
  [key: string]: unknown;
}

function buildAmanuensisServerEntry(): Record<string, unknown> {
  // The installed amanuensis-memory binary is on PATH after
  // `npm install -g` or via npx; using the command-name form keeps the
  // mcp.json portable across machines and doesn't hardcode an install
  // path. `${workspaceFolder}` below is a VS Code variable reference
  // that the client substitutes at launch — it must reach mcp.json as
  // literal text, so the lint warning about a template-string
  // placeholder is a false positive here.
  return {
    type: "stdio",
    command: "amanuensis-memory",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: VS Code variable reference
    args: ["--workspace", "${workspaceFolder}"],
  };
}

function readJsonWithComments(path: string): McpConfig {
  // .vscode/mcp.json in practice often has JSON-with-comments (VS Code
  // tolerates them). Strip // line comments and /* ... */ block comments
  // before parsing. Trailing commas inside objects/arrays are also
  // tolerated in VS Code JSON; strip those too.
  const raw = readFileSync(path, "utf8");
  const stripped = raw
    // Block comments — non-greedy, multiline.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // Line comments.
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    // Trailing commas before } or ].
    .replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(stripped) as McpConfig;
}

function backupPath(p: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `${p}.bak.${ts}`;
}

type PlanAction =
  | { kind: "write-file"; path: string; content: string; mode: "create" | "overwrite" }
  | { kind: "backup"; from: string; to: string }
  | { kind: "skip-file"; path: string; reason: string }
  | { kind: "mkdir"; path: string };

function plan(flags: InitFlags): PlanAction[] {
  const actions: PlanAction[] = [];
  const workspace = resolve(flags.dir);
  const agentsDir = resolve(workspace, flags.agentsDir);
  const mcpConfig = resolve(workspace, flags.mcpConfig);

  // Agent files + the references/ subtree + README.md. Agents reference
  // `agents/references/concern-territories.md` and similar by relative
  // path; installing them under the same directory root preserves that
  // relationship.
  const source = findBundledAgents();
  // Track mkdir targets we've already planned so the dry-run output
  // doesn't print "mkdir .github/agents" before every file under it.
  const plannedMkdirs = new Set<string>();
  const planMkdir = (dir: string) => {
    if (plannedMkdirs.has(dir)) return;
    plannedMkdirs.add(dir);
    if (!existsSync(dir)) {
      actions.push({ kind: "mkdir", path: dir });
    }
  };
  planMkdir(agentsDir);
  const walk = (dir: string, relPath: string): Array<{ relPath: string; src: string }> => {
    const out: Array<{ relPath: string; src: string }> = [];
    for (const entry of readdirSync(dir)) {
      const src = join(dir, entry);
      const st = statSync(src);
      const childRel = relPath ? `${relPath}/${entry}` : entry;
      if (st.isDirectory()) {
        out.push(...walk(src, childRel));
      } else if (st.isFile()) {
        out.push({ relPath: childRel, src });
      }
    }
    return out;
  };
  for (const { relPath, src } of walk(source, "")) {
    const dest = join(agentsDir, relPath);
    const content = readFileSync(src, "utf8");
    planMkdir(dirname(dest));
    if (!existsSync(dest)) {
      actions.push({ kind: "write-file", path: dest, content, mode: "create" });
      continue;
    }
    // Existing file. Overwrite only with --force, and back up first.
    const existing = readFileSync(dest, "utf8");
    if (existing === content) {
      actions.push({ kind: "skip-file", path: dest, reason: "already up-to-date" });
      continue;
    }
    if (!flags.force) {
      actions.push({
        kind: "skip-file",
        path: dest,
        reason: "conflict; rerun with --force to overwrite (backup will be created)",
      });
      continue;
    }
    actions.push({ kind: "backup", from: dest, to: backupPath(dest) });
    actions.push({ kind: "write-file", path: dest, content, mode: "overwrite" });
  }

  // mcp.json merge.
  const entry = buildAmanuensisServerEntry();
  planMkdir(dirname(mcpConfig));
  if (!existsSync(mcpConfig)) {
    // Fresh — write a minimal config.
    const fresh = {
      $schema: "https://raw.githubusercontent.com/modelcontextprotocol/servers/main/schema.json",
      servers: { "amanuensis-memory": entry },
    };
    actions.push({
      kind: "write-file",
      path: mcpConfig,
      content: `${JSON.stringify(fresh, null, 2)}\n`,
      mode: "create",
    });
  } else {
    // Merge. We parse tolerantly (// comments, trailing commas) but
    // re-emit strict JSON — the user loses comments on the touched
    // file. Document this in the dry-run output so it isn't a surprise.
    let existing: McpConfig;
    try {
      existing = readJsonWithComments(mcpConfig);
    } catch (e) {
      throw new Error(
        `${mcpConfig} is not parseable JSON (${(e as Error).message}). ` +
          "Fix the file or move it aside before rerunning `amanuensis init`.",
      );
    }
    const servers = (existing.servers ?? {}) as Record<string, unknown>;
    const priorEntry = servers["amanuensis-memory"];
    if (priorEntry && !flags.force) {
      // Leave the whole file untouched; user's on their own.
      actions.push({
        kind: "skip-file",
        path: mcpConfig,
        reason: "amanuensis-memory server entry already present; rerun with --force to replace",
      });
    } else {
      if (priorEntry) {
        actions.push({ kind: "backup", from: mcpConfig, to: backupPath(mcpConfig) });
      } else {
        // New entry being merged into an existing file. Back up defensively —
        // we strip comments and reformat, so the user's original is
        // worth preserving even though logically nothing was overwritten.
        actions.push({ kind: "backup", from: mcpConfig, to: backupPath(mcpConfig) });
      }
      const merged: McpConfig = {
        ...existing,
        servers: { ...servers, "amanuensis-memory": entry },
      };
      actions.push({
        kind: "write-file",
        path: mcpConfig,
        content: `${JSON.stringify(merged, null, 2)}\n`,
        mode: priorEntry ? "overwrite" : "create",
      });
    }
  }

  return actions;
}

function applyPlan(actions: PlanAction[], flags: InitFlags, workspace: string): void {
  for (const a of actions) {
    const rel = (p: string) => relative(workspace, p) || ".";
    switch (a.kind) {
      case "mkdir":
        if (flags.dryRun) console.log(`[dry-run] mkdir ${rel(a.path)}`);
        else mkdirSync(a.path, { recursive: true });
        break;
      case "backup":
        if (flags.dryRun) console.log(`[dry-run] backup ${rel(a.from)} → ${rel(a.to)}`);
        else copyFileSync(a.from, a.to);
        break;
      case "write-file":
        if (flags.dryRun) {
          console.log(`[dry-run] ${a.mode} ${rel(a.path)}`);
        } else {
          mkdirSync(dirname(a.path), { recursive: true });
          writeFileSync(a.path, a.content, "utf8");
          console.log(`  ${a.mode === "create" ? "+" : "~"} ${rel(a.path)}`);
        }
        break;
      case "skip-file":
        console.log(`  · ${rel(a.path)}  (${a.reason})`);
        break;
    }
  }
}

function cmdInit(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: {
      dir: { type: "string", default: process.cwd() },
      "agents-dir": { type: "string", default: ".github/agents" },
      "mcp-config": { type: "string", default: ".vscode/mcp.json" },
      force: { type: "boolean", default: false },
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
    dryRun: values["dry-run"] as boolean,
    force: values.force as boolean,
    agentsDir: values["agents-dir"] as string,
    mcpConfig: values["mcp-config"] as string,
  };
  const workspace = resolve(flags.dir);
  if (!existsSync(workspace)) {
    throw new Error(`target directory does not exist: ${workspace}`);
  }
  console.log(`${flags.dryRun ? "[dry-run] " : ""}Installing Amanuensis into ${workspace}`);
  const actions = plan(flags);
  applyPlan(actions, flags, workspace);
  if (!flags.dryRun) {
    console.log("");
    console.log("Done. Next steps:");
    console.log("  1. Make sure the `amanuensis-memory` binary is on PATH:");
    console.log("       npm install -g @gruetech/amanuensis");
    console.log("     (skip if you already installed the package globally.)");
    console.log("  2. Open this workspace in VS Code.");
    console.log('  3. Invoke the `amanuensis` agent and say "run onboarding".');
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    printUsage();
    return;
  }
  const sub = argv[0];
  const rest = argv.slice(1);
  try {
    switch (sub) {
      case "init":
        cmdInit(rest);
        break;
      default:
        process.stderr.write(`unknown subcommand: ${sub}\n\n`);
        printUsage();
        process.exit(2);
    }
  } catch (e) {
    process.stderr.write(`amanuensis: ${(e as Error).message}\n`);
    process.exit(1);
  }
}

main();
