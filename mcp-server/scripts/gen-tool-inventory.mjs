#!/usr/bin/env node
// Regenerate the tool-inventory block in DEVELOPMENT.md from the
// running server. Spawns the server, performs the MCP init handshake,
// calls tools/list, and writes a grouped markdown table between the
// TOOL-INVENTORY markers.
//
// DEVELOPMENT.md is the developer-facing doc with the live tool
// surface; README.md is the minimal npm-facing readme and does not
// carry this block.
//
// Grouping is inferred from the source file each tool is exported from,
// which we read from src/tools/*.ts by scanning for tool `name:` strings.
// Ordering within a group: insertion order in the source file.
//
// Usage:
//   node scripts/gen-tool-inventory.mjs          # rewrite README in place
//   node scripts/gen-tool-inventory.mjs --check  # exit 1 if README would change
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const mcpRoot = resolve(moduleDir, "..");
const readmePath = join(mcpRoot, "DEVELOPMENT.md");
const toolsDir = join(mcpRoot, "src", "tools");
const START = "<!-- TOOL-INVENTORY-START -->";
const END = "<!-- TOOL-INVENTORY-END -->";

const checkOnly = process.argv.includes("--check");

function scanToolFiles() {
  // Map tool name → source file by scanning each src/tools/*.ts for
  // quoted `name:` strings. This is robust to ordering in index.ts.
  const mapping = new Map(); // name -> filename
  const order = new Map();   // filename -> [names in order]
  for (const fname of readdirSync(toolsDir).sort()) {
    if (!fname.endsWith(".ts")) continue;
    const content = readFileSync(join(toolsDir, fname), "utf8");
    const names = [];
    const re = /^\s+name:\s*"([^"]+)"/gm;
    let m;
    while ((m = re.exec(content)) !== null) {
      mapping.set(m[1], fname);
      names.push(m[1]);
    }
    if (names.length) order.set(fname, names);
  }
  return { mapping, order };
}

async function fetchToolList() {
  const workspace = mkdtempSync(join(tmpdir(), "aman-inv-"));
  return new Promise((resolveFn, rejectFn) => {
    const srv = spawn(
      "node",
      [join(mcpRoot, "dist", "index.js"), "--workspace", workspace],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let out = "";
    let stderr = "";
    srv.stdout.on("data", (d) => { out += d.toString(); });
    srv.stderr.on("data", (d) => { stderr += d.toString(); });
    const killTimer = setTimeout(() => {
      srv.kill("SIGTERM");
      rejectFn(new Error("server did not respond in time\n" + stderr));
    }, 5000);

    const send = (msg) => srv.stdin.write(JSON.stringify(msg) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
      protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "gen", version: "0" }
    }});
    send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });

    // Poll stdout for the response.
    const pollTimer = setInterval(() => {
      for (const line of out.split("\n")) {
        if (!line) continue;
        try {
          const j = JSON.parse(line);
          if (j.id === 2 && j.result?.tools) {
            clearInterval(pollTimer);
            clearTimeout(killTimer);
            srv.kill("SIGTERM");
            resolveFn(j.result.tools);
            return;
          }
        } catch { /* partial line */ }
      }
    }, 50);
  });
}

function renderBlock(tools, { mapping, order }) {
  // Group tools by their source file.
  const groups = new Map(); // groupName -> [{name, description}, ...]
  for (const t of tools) {
    const file = mapping.get(t.name);
    if (!file) {
      // Tool not found in src/tools/*.ts — server might define it inline.
      // Bucket it under "other".
      const bucket = groups.get("other") ?? [];
      bucket.push(t);
      groups.set("other", bucket);
      continue;
    }
    const gname = file.replace(/\.ts$/, "");
    const bucket = groups.get(gname) ?? [];
    bucket.push(t);
    groups.set(gname, bucket);
  }

  // Preserve file-order within each group using `order`.
  for (const [gname, bucket] of groups) {
    const fname = gname + ".ts";
    const expected = order.get(fname);
    if (!expected) continue;
    bucket.sort((a, b) => expected.indexOf(a.name) - expected.indexOf(b.name));
  }

  // Render: one subsection per group, alphabetical group order.
  const sortedGroups = [...groups.keys()].sort();
  const lines = [];
  lines.push("");
  lines.push(`_${tools.length} tools across ${sortedGroups.length} groups. Generated from \`tools/list\` — do not hand-edit._`);
  lines.push("");
  for (const gname of sortedGroups) {
    lines.push(`### \`${gname}\` (${groups.get(gname).length})`);
    lines.push("");
    lines.push("| Tool | Description |");
    lines.push("|---|---|");
    for (const t of groups.get(gname)) {
      const desc = (t.description ?? "").split("\n")[0].trim().replaceAll("|", "\\|");
      lines.push(`| \`${t.name}\` | ${desc} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function replaceBlock(readme, block) {
  const startIdx = readme.indexOf(START);
  const endIdx = readme.indexOf(END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(`markers ${START} / ${END} not found in ${readmePath}`);
  }
  const before = readme.slice(0, startIdx + START.length);
  const after = readme.slice(endIdx);
  return before + "\n" + block + "\n" + after;
}

async function main() {
  const { mapping, order } = scanToolFiles();
  const tools = await fetchToolList();
  const block = renderBlock(tools, { mapping, order });
  const current = readFileSync(readmePath, "utf8");
  const updated = replaceBlock(current, block);
  if (updated === current) {
    console.log(`tool inventory block up to date (${tools.length} tools)`);
    return;
  }
  if (checkOnly) {
    process.stderr.write(
      "tool inventory block is STALE. Run: node scripts/gen-tool-inventory.mjs\n",
    );
    process.exit(1);
  }
  writeFileSync(readmePath, updated);
  console.log(`regenerated tool inventory block (${tools.length} tools)`);
}

main().catch((e) => {
  process.stderr.write(`gen-tool-inventory failed: ${e?.stack || e}\n`);
  process.exit(1);
});
