#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import { discoverCodexParentWorkspace } from "./codex-host.js";
import { openDatabase } from "./db.js";
import { jsonResult, type ServerContext, type ToolDefinition, ToolError } from "./helpers.js";
import { assertProjectBinding, resolveProject } from "./project.js";
import { artifactTools } from "./tools/artifacts.js";
import { chorusmithAdapterTools } from "./tools/chorusmith-adapter.js";
import { claimTools } from "./tools/claims.js";
import { codebaseBriefTools } from "./tools/codebase-brief.js";
import { compareTools } from "./tools/compare.js";

const SERVER_INSTRUCTIONS =
  "Build and maintain an evidence-backed codebase conspectus. Start with get_project_info, then get_dashboard and list_subsystems. Read source code for evidence; write survey state only through Amanuensis tools. Bind claims to repository revisions, keep observations separate from inference and open questions, and do not claim beyond a subsystem's recorded status. Use the Amanuensis skill when installed for the full survey, review, design, and refresh workflows.";
const SERVER_VERSION = "0.2.0-alpha.1";

// MCP defines destructiveHint=false as a guarantee that a tool performs only
// additive updates. Default every mutation to destructive and carve out only
// operations whose handlers have been audited as append-only or immutable-
// successor writes. These hints inform hosts; they are not authorization.
const ADDITIVE_TOOLS = new Set([
  "add_claim",
  "record_open_question",
  "rebaseline_operating_envelope",
]);

function toolAnnotations(name: string) {
  // MCP annotations are hints, not authorization. Keep the read-only set
  // intentionally narrow: every get/list/lookup tool is contractually a
  // query, while tools such as verify_* may also record custody evidence.
  const readOnly =
    name.startsWith("get_") || name.startsWith("list_") || name.startsWith("lookup_");
  return {
    readOnlyHint: readOnly,
    destructiveHint: !readOnly && !ADDITIVE_TOOLS.has(name),
    idempotentHint: readOnly,
    openWorldHint: false,
  };
}

function formatValidationErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) return "arguments do not match the advertised input schema";
  return errors
    .map((error) => `${error.instancePath || "/"} ${error.message ?? error.keyword}`)
    .join("; ");
}

import { compositionTools } from "./tools/composition.js";
import { concernTools } from "./tools/concerns.js";
import { contradictionTools } from "./tools/contradictions.js";
import { crosswalkTools } from "./tools/crosswalk.js";
import { dashboardTools } from "./tools/dashboard.js";
import { decisionTools } from "./tools/decisions.js";
import { designSessionTools } from "./tools/design-session.js";
import { diagnosticityTools } from "./tools/diagnosticity.js";
import { dispatchTools } from "./tools/dispatch.js";
import { dispositionTools } from "./tools/dispositions.js";
import { evaluationTools } from "./tools/evaluation.js";
import { evidenceTools } from "./tools/evidence.js";
import { fieldNoteTools } from "./tools/field-notes.js";
import { fileTools } from "./tools/files.js";
import { findingTools } from "./tools/findings.js";
import { gitTools } from "./tools/git.js";
import { impactTools } from "./tools/impact.js";
import { learningTools } from "./tools/learning.js";
import { lockTools } from "./tools/locks.js";
import { loggingTools } from "./tools/logging.js";
import { materializeTools } from "./tools/materialize.js";
import { openQuestionTools } from "./tools/open-questions.js";
import { projectTools } from "./tools/project.js";
import { refreshTools } from "./tools/refresh.js";
import { researchTools } from "./tools/research.js";
import { resolutionTools } from "./tools/resolution.js";
import { revalidationTools } from "./tools/revalidation.js";
import { reviewTools } from "./tools/review.js";
import { reviewAnalysisTools } from "./tools/review-analysis.js";
import { reviewSessionTools } from "./tools/review-session.js";
import { seamTools } from "./tools/seams.js";
import { staleTools } from "./tools/stale.js";
import { storageHistoryTools } from "./tools/storage-history.js";
import { subsystemTools } from "./tools/subsystems.js";
import { vocabularyTools } from "./tools/vocabulary.js";
import { xrefTools } from "./tools/xrefs.js";

function gitRoot(cwd: string): string | null {
  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return root ? realpathSync(root) : null;
  } catch {
    return null;
  }
}

function assertWorkspaceMatchesLaunch(
  selectedWorkspace: string,
  source: "argument" | "environment",
  allowWorkspacePin: boolean,
  launchWorkspace: string,
): void {
  if (allowWorkspacePin) return;
  const launchRoot = gitRoot(launchWorkspace);
  const selectedRoot = gitRoot(selectedWorkspace);
  if (launchRoot && selectedRoot && launchRoot !== selectedRoot) {
    throw new Error(
      `workspace mismatch before state initialization: ${source} selected ${selectedRoot}, ` +
        `but the server process was launched from ${launchRoot}. ` +
        "Remove the stale hard-coded workspace or use a deliberately project-scoped registration.",
    );
  }
}

function parseArgs(argv: string[]): { workspace: string; selectionSource: string } {
  // An explicit target always wins. Claude Code provides its project root in
  // the server environment; other local clients normally launch in the target
  // repository. For the latter case, normalize a nested cwd to the Git root.
  const allowWorkspacePin = argv.includes("--allow-workspace-pin");
  const codexParentWorkspace =
    process.env.AMANUENSIS_ACTIVATION_CONTRACT === "codex-user-cwd-v1"
      ? discoverCodexParentWorkspace()
      : null;
  const launchWorkspace = codexParentWorkspace ?? process.cwd();
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i + 1];
    if (argv[i] === "--workspace" && value) {
      assertWorkspaceMatchesLaunch(value, "argument", allowWorkspacePin, launchWorkspace);
      return { workspace: value, selectionSource: "argument" };
    }
  }
  const amanuensisWorkspace = process.env.AMANUENSIS_WORKSPACE?.trim();
  const claudeWorkspace = process.env.CLAUDE_PROJECT_DIR?.trim();
  const fromEnvironment = amanuensisWorkspace || claudeWorkspace;
  if (fromEnvironment) {
    assertWorkspaceMatchesLaunch(
      fromEnvironment,
      "environment",
      allowWorkspacePin || process.env.AMANUENSIS_ALLOW_WORKSPACE_PIN === "1",
      launchWorkspace,
    );
    return {
      workspace: fromEnvironment,
      selectionSource: amanuensisWorkspace
        ? "environment:AMANUENSIS_WORKSPACE"
        : "environment:CLAUDE_PROJECT_DIR",
    };
  }
  if (codexParentWorkspace) {
    const parentRoot = gitRoot(codexParentWorkspace);
    return {
      workspace: parentRoot ?? codexParentWorkspace,
      selectionSource: parentRoot ? "parent-codex-cli-cd-git-root" : "parent-codex-cli-cd",
    };
  }
  const root = gitRoot(process.cwd());
  if (root) return { workspace: root, selectionSource: "process-cwd-git-root" };
  // Non-Git workspaces are supported; their current directory is the root.
  return { workspace: process.cwd(), selectionSource: "process-cwd-non-git" };
}

async function main(): Promise<void> {
  const { workspace, selectionSource } = parseArgs(process.argv.slice(2));
  const project = resolveProject(workspace, { selectionSource, serverVersion: SERVER_VERSION });
  const db = openDatabase(project.dbPath);

  const ctx: ServerContext = {
    project,
    db,
    sessionId: null,
  };

  const allTools: ToolDefinition[] = [
    ...projectTools,
    ...gitTools,
    ...impactTools,
    ...revalidationTools,
    ...refreshTools,
    ...reviewTools,
    ...reviewAnalysisTools,
    ...reviewSessionTools,
    ...codebaseBriefTools,
    ...designSessionTools,
    ...decisionTools,
    ...researchTools,
    ...crosswalkTools,
    ...learningTools,
    ...evaluationTools,
    ...chorusmithAdapterTools,
    ...compositionTools,
    ...resolutionTools,
    ...subsystemTools,
    ...concernTools,
    ...fileTools,
    ...dispositionTools,
    ...findingTools,
    ...fieldNoteTools,
    ...vocabularyTools,
    ...xrefTools,
    ...contradictionTools,
    ...loggingTools,
    ...lockTools,
    ...staleTools,
    ...dispatchTools,
    ...dashboardTools,
    ...materializeTools,
    ...seamTools,
    ...artifactTools,
    ...claimTools,
    ...evidenceTools,
    ...diagnosticityTools,
    ...openQuestionTools,
    ...storageHistoryTools,
    ...compareTools,
  ];
  const byName = new Map(allTools.map((t) => [t.name, t]));
  const ajv = new Ajv({ allErrors: true, strict: true, strictSchema: true, useDefaults: false });
  const validators = new Map<string, ValidateFunction>(
    allTools.map((tool) => [tool.name, ajv.compile(tool.inputSchema)]),
  );

  const server = new Server(
    {
      name: "amanuensis-memory",
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: allTools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown>,
        annotations: toolAnnotations(t.name),
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;
    const tool = byName.get(name);
    if (!tool) {
      return jsonResult({ ok: false, error: `unknown tool: ${name}` });
    }
    const args = (rawArgs ?? {}) as Record<string, unknown>;
    const validate = validators.get(name);
    if (!validate?.(args)) {
      return jsonResult({
        ok: false,
        error: `invalid arguments for ${name}: ${formatValidationErrors(validate?.errors)}`,
      });
    }
    try {
      assertProjectBinding(project);
      const data = tool.handler(args, ctx);
      return jsonResult(data);
    } catch (e) {
      if (e instanceof ToolError) {
        return jsonResult({ ok: false, error: e.message });
      }
      const message = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[amanuensis-memory] tool ${name} threw: ${message}\n`);
      return jsonResult({ ok: false, error: message });
    }
  });

  process.stderr.write(`[amanuensis-memory] binding=${JSON.stringify(project.bindingReceipt)}\n`);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  process.stderr.write(`[amanuensis-memory] fatal: ${e?.stack || e}\n`);
  process.exit(1);
});
