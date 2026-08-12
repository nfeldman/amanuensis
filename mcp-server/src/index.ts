#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { openDatabase } from "./db.js";
import { jsonResult, type ServerContext, type ToolDefinition, ToolError } from "./helpers.js";
import { resolveProject } from "./project.js";
import { artifactTools } from "./tools/artifacts.js";
import { claimTools } from "./tools/claims.js";
import { compareTools } from "./tools/compare.js";
import { concernTools } from "./tools/concerns.js";
import { contradictionTools } from "./tools/contradictions.js";
import { dashboardTools } from "./tools/dashboard.js";
import { diagnosticityTools } from "./tools/diagnosticity.js";
import { dispatchTools } from "./tools/dispatch.js";
import { dispositionTools } from "./tools/dispositions.js";
import { evidenceTools } from "./tools/evidence.js";
import { fieldNoteTools } from "./tools/field-notes.js";
import { fileTools } from "./tools/files.js";
import { findingTools } from "./tools/findings.js";
import { gitTools } from "./tools/git.js";
import { impactTools } from "./tools/impact.js";
import { lockTools } from "./tools/locks.js";
import { loggingTools } from "./tools/logging.js";
import { materializeTools } from "./tools/materialize.js";
import { openQuestionTools } from "./tools/open-questions.js";
import { projectTools } from "./tools/project.js";
import { refreshTools } from "./tools/refresh.js";
import { resolutionTools } from "./tools/resolution.js";
import { revalidationTools } from "./tools/revalidation.js";
import { seamTools } from "./tools/seams.js";
import { staleTools } from "./tools/stale.js";
import { storageHistoryTools } from "./tools/storage-history.js";
import { subsystemTools } from "./tools/subsystems.js";
import { vocabularyTools } from "./tools/vocabulary.js";
import { xrefTools } from "./tools/xrefs.js";

function parseArgs(argv: string[]): { workspace: string } {
  // Minimal flag parser — accepts `--workspace <path>` or falls back to cwd.
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i + 1];
    if (argv[i] === "--workspace" && value) {
      return { workspace: value };
    }
  }
  return { workspace: process.cwd() };
}

async function main(): Promise<void> {
  const { workspace } = parseArgs(process.argv.slice(2));
  const project = resolveProject(workspace);
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

  const server = new Server(
    {
      name: "amanuensis-memory",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: allTools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown>,
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
    try {
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

  process.stderr.write(
    `[amanuensis-memory] project=${project.projectKey} storage=${project.storagePath}\n`,
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  process.stderr.write(`[amanuensis-memory] fatal: ${e?.stack || e}\n`);
  process.exit(1);
});
