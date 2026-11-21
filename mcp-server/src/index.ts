#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import { CallLog, type CallOutcome, digestArguments, throwSite } from "./call-log.js";
import { discoverCodexParentLaunch, STARTUP_PROBE_TIMEOUT_MS } from "./codex-host.js";
import { type DB, openDatabase } from "./db.js";
import { jsonResult, type ServerContext, type ToolDefinition, ToolError } from "./helpers.js";
import {
  assertProjectBinding,
  ensureProjectStorage,
  type ProjectContext,
  resolveProject,
} from "./project.js";
import { storagePathIsTracked } from "./storage-git.js";
import { artifactTools } from "./tools/artifacts.js";
import { carriedTools } from "./tools/carried.js";
import { chorusmithAdapterTools } from "./tools/chorusmith-adapter.js";
import { claimMarkTools } from "./tools/claim-marks.js";
import { claimTools } from "./tools/claims.js";
import { codebaseBriefTools } from "./tools/codebase-brief.js";
import { compareTools } from "./tools/compare.js";
import { locusTools } from "./tools/locus.js";

// §5.4: the consumer route opens, the workspace handshake it depends on comes
// next, and the producer route follows. Hosts inject
// this string once per session, so it names the three reader tools and the two
// standings that stop an answer, and stops there — the method itself is the
// skill's, not this string's. The producer sentence keeps the phrase
// "evidence-backed codebase conspectus" that test-mcp-compatibility.mjs reads
// back from the initialize result.
const CONSUMER_OPENING =
  "To learn what is recorded about a file, symbol, subsystem, or term, call describe_locus first.";
const SERVER_INSTRUCTIONS =
  "The standing describe_locus returns states what the record authorizes and what it cannot justify; do not claim beyond it, and when standing is unledgered or scoped-unread say so rather than reading the file and improvising. get_attention returns what is unresolved; get_history returns what was concluded. To build or maintain an evidence-backed codebase conspectus, start with get_project_info, then get_dashboard and list_subsystems; read source code for evidence and write survey state only through Amanuensis tools. Bind claims to repository revisions, keep observations separate from inference and open questions, and do not claim beyond a subsystem's recorded status. Use the Amanuensis skill when installed for the full survey, review, design, and refresh workflows.";
const WORKSPACE_INSTRUCTIONS =
  "Before using project tools, call get_project_info with workspace set to the absolute project directory from this chat's environment context (not the MCP process cwd). An unbound response is not a cold start. The first workspace handshake binds this server process once; a different workspace is refused before database access.";
// The package's own version, read at startup rather than written here: a
// literal had to be bumped by hand at release and drifted twice, into what a
// host shows and into the binding receipt (findings B05-R1, B02-R7).
const SERVER_VERSION = (
  JSON.parse(
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"),
  ) as { version: string }
).version;

// MCP defines destructiveHint=false as a guarantee that a tool performs only
// additive updates. Default every mutation to destructive and carve out only
// operations whose handlers have been audited as append-only or immutable-
// successor writes. These hints inform hosts; they are not authorization.
const ADDITIVE_TOOLS = new Set([
  "add_claim",
  // The four carried-finding tables are append-only in the substrate, by the
  // trigger pairs `schema.sql` ships rather than by this list (spec.md §5.2):
  // each of these inserts one row and no path in the server can update or
  // delete it. `record_carried_outcome` writes the decision that discharges an
  // obligation and is deliberately NOT here — it is additive in the same sense,
  // but a host reading the hint should see a decision being recorded.
  "begin_carry_run",
  "carry_finding",
  "attach_carried_evidence",
  // `vocabulary_declinations` is append-only in the substrate, by the trigger
  // pair `schema.sql` ships rather than by this list (spec.md §4.3): the tool
  // inserts one row and no path in the server can update or delete it.
  "decline_domain_vocabulary",
  // `explanations` and `explanation_evidence` are append-only in the substrate,
  // by the trigger pairs `schema.sql` ships (spec.md §3.1): each writer inserts
  // rows and no path in the server can update or delete one. A correction is a
  // new row.
  "record_explanation",
  "decline_explanation",
  // `narratives` and `narrative_evidence` are append-only in the same way
  // (PLAN §2.1): each writer inserts rows, and a correction is a new row.
  "record_narrative",
  "decline_narrative",
  // `project_profile`, `runtime_boundaries`, `runtime_boundary_evidence` and
  // `territory_dispositions` are append-only in the same way (PLAN §2.2); a
  // withdrawal is a row too.
  "record_project_profile",
  "record_runtime_boundary",
  "withdraw_runtime_boundary",
  "record_territory_disposition",
  // `claim_marks`, `claim_mark_withdrawals` and `claim_mark_declinations` are
  // append-only in the same way (PLAN §7.2); a withdrawal is a row too.
  "record_claim_mark",
  "withdraw_claim_mark",
  "decline_claim_marks",
  // `imported_artifacts`, `explanations`, `project_profile` and
  // `runtime_boundaries` are append-only (PLAN §5.2): the import inserts rows,
  // skips what is already there, and writes no file.
  "import_artifact_bodies",
  "record_open_question",
  "rebaseline_operating_envelope",
]);

// The prefix rule below derives read-only from the `get_`/`list_`/`lookup_`
// names, which the reader-lens tools do not carry: `describe_locus` answers
// what the record holds about one locus and writes nothing. Naming them here
// is the same explicit carve-out ADDITIVE_TOOLS already is, and it keeps the
// prefix rule as the fallback rather than widening it into a fourth prefix
// that any future write tool could accidentally match.
const READ_ONLY_TOOLS = new Set(["describe_locus"]);

function toolAnnotations(name: string) {
  // MCP annotations are hints, not authorization. Keep the read-only set
  // intentionally narrow: every get/list/lookup tool is contractually a
  // query, while tools such as verify_* may also record custody evidence.
  const readOnly =
    READ_ONLY_TOOLS.has(name) ||
    name.startsWith("get_") ||
    name.startsWith("list_") ||
    name.startsWith("lookup_");
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
import { explanationTools } from "./tools/explanations.js";
import { fieldNoteTools } from "./tools/field-notes.js";
import { fileTools } from "./tools/files.js";
import { findingTools } from "./tools/findings.js";
import { gitTools } from "./tools/git.js";
import { impactTools } from "./tools/impact.js";
import { importTools } from "./tools/import.js";
import { learningTools } from "./tools/learning.js";
import { lockTools } from "./tools/locks.js";
import { loggingTools } from "./tools/logging.js";
import { materializeTools } from "./tools/materialize.js";
import { narrativeTools } from "./tools/narratives.js";
import { openQuestionTools } from "./tools/open-questions.js";
import { projectTools } from "./tools/project.js";
import { projectRecordTools } from "./tools/project-records.js";
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
      timeout: STARTUP_PROBE_TIMEOUT_MS,
      killSignal: "SIGKILL",
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

function parseArgs(argv: string[]): { workspace: string | null; selectionSource: string } {
  // An explicit target always wins. Claude Code provides its project root in
  // the server environment; other local clients normally launch in the target
  // repository. For the latter case, normalize a nested cwd to the Git root.
  const allowWorkspacePin = argv.includes("--allow-workspace-pin");
  const codexParentLaunch =
    process.env.AMANUENSIS_ACTIVATION_CONTRACT === "codex-user-cwd-v1"
      ? discoverCodexParentLaunch()
      : { workspace: null, appServer: false };
  const codexParentWorkspace = codexParentLaunch.workspace;
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
    if (amanuensisWorkspace) {
      return {
        workspace: amanuensisWorkspace,
        selectionSource: "environment:AMANUENSIS_WORKSPACE",
      };
    }
    // Claude Code sets CLAUDE_PROJECT_DIR to the directory a session started
    // in, which may be a subdirectory. The store belongs to the repository,
    // so a directory inside a Git work tree resolves to its root.
    const claudeRoot = gitRoot(claudeWorkspace as string);
    // A user-level registration serves every session, including one started
    // in the home directory; outside a repository it waits for the handshake.
    if (!claudeRoot && process.env.AMANUENSIS_ACTIVATION_CONTRACT === "user-cwd-v1") {
      return { workspace: null, selectionSource: "awaiting-workspace-handshake" };
    }
    return {
      workspace: claudeRoot ?? (claudeWorkspace as string),
      selectionSource: claudeRoot
        ? "environment:CLAUDE_PROJECT_DIR-git-root"
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
  // The desktop app-server serves many chats; even a Git cwd belongs to the
  // launcher, not necessarily this chat. Its connection must select explicitly.
  if (codexParentLaunch.appServer) {
    return { workspace: null, selectionSource: "awaiting-workspace-handshake" };
  }
  const root = gitRoot(process.cwd());
  if (root) return { workspace: root, selectionSource: "process-cwd-git-root" };
  // Codex desktop starts user-scoped MCP processes outside the chat's project,
  // commonly at /. That is a launcher location, never a project selection.
  // Stay reachable for a workspace handshake without resolving or opening state.
  // A user-level registration in another host (user-cwd-v1) is launched from
  // wherever that host starts it — often the home directory — so a non-Git
  // directory is likewise a launcher location, not the project.
  if (
    process.env.AMANUENSIS_ACTIVATION_CONTRACT === "codex-user-cwd-v1" ||
    process.env.AMANUENSIS_ACTIVATION_CONTRACT === "user-cwd-v1" ||
    process.cwd() === parse(process.cwd()).root
  ) {
    return { workspace: null, selectionSource: "awaiting-workspace-handshake" };
  }
  // Other hosts retain support for non-Git workspaces in their launch directory.
  return { workspace: process.cwd(), selectionSource: "process-cwd-non-git" };
}

async function main(): Promise<void> {
  const { workspace, selectionSource } = parseArgs(process.argv.slice(2));
  let project: ProjectContext | null = workspace
    ? resolveProject(workspace, { selectionSource, serverVersion: SERVER_VERSION })
    : null;
  const requireProject = (): ProjectContext => {
    if (!project) {
      throw new ToolError(
        "workspace is unbound; call get_project_info with workspace set to the absolute project directory from the chat environment before using project tools",
        "workspace.unbound",
      );
    }
    return project;
  };
  let db: DB | null = null;
  const ensureDatabase = (): DB => {
    if (db) return db;
    const bound = requireProject();
    ensureProjectStorage(bound, (candidatePath) => {
      const candidate = openDatabase(candidatePath);
      candidate.close();
    });
    db = openDatabase(bound.dbPath);
    return db;
  };

  const ctx: ServerContext = {
    get project() {
      return requireProject();
    },
    get db() {
      return ensureDatabase();
    },
    sessionId: null,
  };

  const allTools: ToolDefinition[] = [
    // §5.5: the reader-lens tools head the advertised list, because the list
    // order is the order a host reads and the consumer route is the one a
    // reader needs first.
    ...locusTools,
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
    ...explanationTools,
    ...narrativeTools,
    ...projectRecordTools,
    ...claimMarkTools,
    ...importTools,
    ...carriedTools,
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
      instructions: `${CONSUMER_OPENING} ${WORKSPACE_INSTRUCTIONS} ${SERVER_INSTRUCTIONS}`,
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

  // Layer A of design/self-observability: every call is recorded by the
  // dispatcher, whatever the model does. `dispatchTool` classifies; the
  // handler below times, records and returns. The call log never changes a
  // response and never fails a call.
  const callLog = new CallLog({
    serverVersion: SERVER_VERSION,
    clientInfo: () => server.getClientVersion(),
    isTrackedInStorage: storagePathIsTracked,
  });
  process.once("exit", () => callLog.close());

  interface Dispatched {
    data: unknown;
    compact: boolean;
    outcome: CallOutcome;
    rule: string | null;
    /** Where a thrown refusal or exception came from; never its message. */
    site: string | null;
  }

  const refusal = (data: unknown): Pick<Dispatched, "outcome" | "rule" | "site"> => {
    // Handlers refuse in two ways: by throwing ToolError, and by returning
    // `{ ok: false, error }`. Both are refusals to the host (`isError`), so
    // both are refusals here.
    if (data !== null && typeof data === "object" && !Array.isArray(data)) {
      const body = data as { ok?: unknown; error?: unknown; rule?: unknown };
      if (body.ok === false) {
        return {
          outcome: "refusal",
          rule: typeof body.rule === "string" ? body.rule : null,
          site: null,
        };
      }
    }
    return { outcome: "ok", rule: null, site: null };
  };

  const dispatchTool = (name: string, rawArgs: unknown): Dispatched => {
    const tool = byName.get(name);
    if (!tool) {
      const message = `unknown tool: ${name}`;
      return {
        data: { ok: false, error: message },
        compact: false,
        outcome: "validation",
        rule: "protocol.unknown-tool",
        site: null,
      };
    }
    const args = (rawArgs ?? {}) as Record<string, unknown>;
    const validate = validators.get(name);
    if (!validate?.(args)) {
      const message = `invalid arguments for ${name}: ${formatValidationErrors(validate?.errors)}`;
      const keyword = validate?.errors?.[0]?.keyword;
      return {
        data: { ok: false, error: message },
        compact: false,
        outcome: "validation",
        rule: keyword ? `schema.${keyword}` : "schema.invalid",
        site: null,
      };
    }
    try {
      if (name === "get_project_info") {
        const requested = args.workspace;
        if (typeof requested === "string") {
          if (!isAbsolute(requested))
            throw new ToolError(
              "workspace must be an absolute directory path",
              "workspace.not-absolute",
            );
          const canonical = gitRoot(requested) ?? realpathSync(requested);
          if (project && project.workspacePath !== canonical) {
            throw new ToolError(
              `workspace mismatch: this server is bound to ${project.workspacePath}, but this chat requested ${canonical}. Start a separate server connection for the other workspace; rebinding is refused.`,
              "workspace.mismatch",
            );
          }
          if (!project) {
            project = resolveProject(canonical, {
              selectionSource: "tool-workspace-handshake",
              serverVersion: SERVER_VERSION,
            });
            process.stderr.write(
              `[amanuensis-memory] binding=${JSON.stringify(project.bindingReceipt)}\n`,
            );
          }
        }
        if (!project) {
          const data = {
            ok: false,
            binding_status: "unbound",
            workspace_path: null,
            storage_path: null,
            binding_receipt: null,
            error: WORKSPACE_INSTRUCTIONS,
          };
          return { data, compact: false, ...refusal(data), rule: "workspace.unbound" };
        }
      }
      assertProjectBinding(requireProject());
      if (name !== "get_project_info") ensureDatabase();
      const data = tool.handler(args, ctx);
      // §4.1: the tool declares whether its text block is serialized compactly,
      // and the dispatcher honors the declaration. A tool that carries a byte
      // budget therefore has it enforced on the emitted response.
      return { data, compact: tool.compact === true, ...refusal(data) };
    } catch (e) {
      if (e instanceof ToolError) {
        return {
          data: { ok: false, error: e.message },
          compact: false,
          outcome: "refusal",
          rule: e.rule ?? null,
          site: throwSite(e),
        };
      }
      const message = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[amanuensis-memory] tool ${name} threw: ${message}\n`);
      return {
        data: { ok: false, error: message },
        compact: false,
        outcome: "exception",
        rule: "exception",
        site: throwSite(e),
      };
    }
  };

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;
    const sessionBefore = ctx.sessionId;
    const startedAt = new Date().toISOString();
    const started = performance.now();
    let dispatched = dispatchTool(name, rawArgs);
    let result: ReturnType<typeof jsonResult>;
    try {
      result = jsonResult(dispatched.data, { compact: dispatched.compact });
    } catch (e) {
      // Serialization ran inside the handler's try before the dispatcher was
      // split, so an unserializable result reached the host as a tool error,
      // not a protocol error. Keep that.
      const message = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[amanuensis-memory] tool ${name} threw: ${message}\n`);
      dispatched = {
        data: { ok: false, error: message },
        compact: false,
        outcome: "exception",
        rule: "exception",
        site: throwSite(e),
      };
      result = jsonResult(dispatched.data);
    }
    const latencyMs = performance.now() - started;
    if (callLog.enabled) {
      try {
        // Attach only once the record itself is open: the call log must never be
        // the thing that creates a store.
        if (db && project) callLog.attach(project.storagePath);
        const digest = digestArguments(rawArgs);
        callLog.record({
          tool: name,
          outcome: dispatched.outcome,
          rule: dispatched.rule,
          site: dispatched.site,
          // start_session sets the session and end_session clears it: the
          // row belongs to whichever was in force on either side of the call.
          sessionId: ctx.sessionId ?? sessionBefore,
          startedAt,
          latencyMs,
          argsBytes: digest.bytes,
          argsSha256: digest.sha256,
          // The envelope the host receives, measured as helpers.responseBytes does.
          responseBytes: Buffer.byteLength(JSON.stringify(result), "utf8"),
        });
      } catch {
        // Recording is best-effort by contract; CallLog reports its own
        // failures. Nothing here may change the response.
      }
    }
    return result;
  });

  process.stderr.write(
    project
      ? `[amanuensis-memory] binding=${JSON.stringify(project.bindingReceipt)}\n`
      : `[amanuensis-memory] workspace unbound; awaiting get_project_info(workspace)\n`,
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  process.stderr.write(`[amanuensis-memory] fatal: ${e?.stack || e}\n`);
  process.exit(1);
});
