#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const safeKeys = Object.keys(process.env)
  .filter((key) => /(?:CODEX|PWD|CWD|WORKSPACE|PROJECT|ROOT)/i.test(key))
  .sort();
const safeEnvironment = Object.fromEntries(
  safeKeys.map((key) => {
    if (/(?:TOKEN|KEY|SECRET|AUTH|PASSWORD)/i.test(key)) return [key, "<redacted>"];
    const value = process.env[key] ?? "";
    return [key, value.startsWith("/") || !value ? value : "<non-path>"];
  }),
);
let parentCommand = "";
try {
  parentCommand = execFileSync("ps", ["-ww", "-p", String(process.ppid), "-o", "command="], {
    encoding: "utf8",
  }).trim();
} catch {
  // A missing process inspector is itself a useful negative result.
}
const parentCdMatch = parentCommand.match(
  /(?:^|\s)(?:-C|--cd)(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/,
);
const parentExecutable = parentCommand.split(/\s+/)[0] ?? "";

const server = new Server(
  { name: "amanuensis-codex-context-probe", version: "1" },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: [
    {
      name: "inspect_codex_context",
      description: "Return non-secret cwd and workspace-related host context for activation tests.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
    },
  ],
}));
server.setRequestHandler(CallToolRequestSchema, () => {
  const result = {
    processCwd: process.cwd(),
    safeEnvironment,
    parentPid: process.ppid,
    parentExecutable: basename(parentExecutable),
    parentCdArgument: parentCdMatch?.[1] ?? parentCdMatch?.[2] ?? parentCdMatch?.[3] ?? null,
  };
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
  };
});
await server.connect(new StdioServerTransport());
