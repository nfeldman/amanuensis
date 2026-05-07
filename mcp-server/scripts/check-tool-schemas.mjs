#!/usr/bin/env node
// Validate every MCP tool's `inputSchema` against draft-07 JSON Schema.
// The server hands these schemas to MCP clients as-is, so a malformed
// schema would silently confuse any client that validates its calls.
//
// We use two checks:
//   (a) Ajv compiles the schema (catches structural issues Ajv models)
//   (b) We explicitly check that every top-level keyword is one JSON
//       Schema recognizes. Ajv's `strictSchema` setting is meant to
//       reject unknown keywords but is inconsistent across object
//       boundaries; this extra pass is a simpler hard guarantee.
import Ajv from "ajv";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const mcpRoot = join(moduleDir, "..");
const toolsDir = join(mcpRoot, "dist", "tools");

const ajv = new Ajv({
  allErrors: true,
  strict: true,
  strictSchema: true,
  strictTypes: true,
  strictTuples: true,
  useDefaults: false,
});

// Keywords we allow anywhere in the tool inputSchema subtree. This
// covers the subset of JSON Schema draft-07 the MCP tool shape actually
// uses — we do not pretend to accept arbitrary schemas.
const ALLOWED_KEYWORDS = new Set([
  "$schema",
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "description",
  "default",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "pattern",
  "format",
  "oneOf",
  "anyOf",
  "allOf",
  "not",
  "nullable",
  "$ref",
  "definitions",
]);

function walkSchema(schema, path, errors) {
  if (schema === null || typeof schema !== "object") return;
  if (Array.isArray(schema)) {
    schema.forEach((s, i) => walkSchema(s, `${path}[${i}]`, errors));
    return;
  }
  for (const key of Object.keys(schema)) {
    if (!ALLOWED_KEYWORDS.has(key)) {
      errors.push({ path: `${path}.${key}`, kind: "unknown-keyword", key });
    }
  }
  if (schema.properties && typeof schema.properties === "object") {
    for (const [name, sub] of Object.entries(schema.properties)) {
      walkSchema(sub, `${path}.properties.${name}`, errors);
    }
  }
  if (schema.items) walkSchema(schema.items, `${path}.items`, errors);
  for (const k of ["oneOf", "anyOf", "allOf"]) {
    if (Array.isArray(schema[k])) {
      schema[k].forEach((s, i) => walkSchema(s, `${path}.${k}[${i}]`, errors));
    }
  }
  if (schema.not) walkSchema(schema.not, `${path}.not`, errors);
}

let compiled = 0;
const errors = [];
for (const fname of readdirSync(toolsDir)) {
  if (!fname.endsWith(".js")) continue;
  const mod = await import(join(toolsDir, fname));
  for (const key of Object.keys(mod)) {
    const val = mod[key];
    if (!Array.isArray(val)) continue;
    for (const tool of val) {
      if (!tool?.name || !tool?.inputSchema) continue;
      try {
        ajv.compile(tool.inputSchema);
      } catch (e) {
        errors.push({ tool: tool.name, kind: "ajv-compile", message: e.message });
        continue;
      }
      const keywordErrors = [];
      walkSchema(tool.inputSchema, "root", keywordErrors);
      for (const ke of keywordErrors) {
        errors.push({ tool: tool.name, kind: "unknown-keyword", path: ke.path, key: ke.key });
      }
      compiled++;
    }
  }
}

console.log(`Compiled ${compiled} tool schemas.`);
if (errors.length === 0) {
  console.log("OK — every tool inputSchema is valid JSON Schema.");
  process.exit(0);
}
console.error(`\nFAIL — ${errors.length} schema issue(s):`);
for (const e of errors) {
  console.error(`  ${e.tool}`);
  if (e.kind === "ajv-compile") {
    console.error(`    ${e.message}`);
  } else {
    console.error(`    unknown keyword '${e.key}' at ${e.path}`);
  }
}
process.exit(1);
