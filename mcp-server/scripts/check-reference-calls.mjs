#!/usr/bin/env node
// Skill/server call parity (finding B01-R1).
//
// The survey skill's references teach tool calls in prose, as code spans such
// as `detect_changes(current_sha=<HEAD>)`. When a tool is renamed or an
// argument dropped, the reference that still teaches the old call is wrong and
// nothing notices. check-refusal-parity.mjs covers the registered refusals; this
// covers every call a reference writes out.
//
// What it checks, exactly. Every code span in SKILL.md and references/*.md
// shaped `name(…)`, where `name` is snake_case with at least one underscore, is
// read as a tool call:
//   * `name` must be a tool the server defines;
//   * every argument the span names — `key=value`, `key: value` inside an
//     object literal, or a bare `key` / `key?` — must be a property of that
//     tool's inputSchema. `...` and positional placeholders in angle brackets
//     are skipped.
//
// What it cannot see. A call written outside a code span, a call whose name has
// no underscore, an argument value of the wrong type or enum, and prose that
// describes a tool's behaviour wrongly. It is string identity over the schema,
// not a judgment of whether the reference is right.
//
// Usage: node scripts/check-reference-calls.mjs   (needs a built dist/)

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MCP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = resolve(MCP, "..", ".claude", "skills", "amanuensis");

async function loadTools() {
  const dir = join(MCP, "dist", "tools");
  const tools = new Map();
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".js")).sort()) {
    const mod = await import(pathToFileURL(join(dir, file)).href);
    for (const value of Object.values(mod)) {
      if (!Array.isArray(value)) continue;
      for (const td of value) {
        if (td && typeof td.name === "string" && td.inputSchema && typeof td.handler === "function") {
          tools.set(td.name, td);
        }
      }
    }
  }
  return tools;
}

/** Split on commas that are not nested in brackets or quotes. */
function topLevelArgs(text) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let current = "";
  for (const ch of text) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if ("([{<".includes(ch)) depth += 1;
    else if (")]}>".includes(ch)) depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** The argument names one call span writes. */
function argumentNames(inner) {
  const names = [];
  const trimmed = inner.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    for (const part of topLevelArgs(trimmed.slice(1, -1))) {
      const match = /^([a-z_][a-z0-9_]*)\??\s*:/i.exec(part);
      if (match) names.push(match[1]);
    }
    return names;
  }
  for (const part of topLevelArgs(trimmed)) {
    if (part === "" || part === "..." || part.startsWith("<")) continue;
    const named = /^([a-z_][a-z0-9_]*)\s*=/i.exec(part);
    if (named) {
      names.push(named[1]);
      continue;
    }
    const bare = /^([a-z_][a-z0-9_]*)\??$/i.exec(part);
    if (bare) names.push(bare[1]);
  }
  return names;
}

function referenceFiles() {
  const files = [join(SKILL, "SKILL.md")];
  const refs = join(SKILL, "references");
  for (const name of readdirSync(refs).sort()) if (name.endsWith(".md")) files.push(join(refs, name));
  return files;
}

const CALL = /(?<![A-Za-z0-9_])([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\(([^`]*)\)/g;

export async function checkReferenceCalls() {
  const tools = await loadTools();
  const problems = [];
  let calls = 0;
  for (const file of referenceFiles()) {
    const text = readFileSync(file, "utf8");
    // Code spans, single-backtick and fenced, with their line numbers.
    const spans = [];
    const fence = /```[^\n]*\n([\s\S]*?)```/g;
    let masked = text;
    for (const match of text.matchAll(fence)) {
      spans.push({ body: match[1], index: match.index });
      masked = masked.slice(0, match.index) + " ".repeat(match[0].length) + masked.slice(match.index + match[0].length);
    }
    for (const match of masked.matchAll(/`([^`\n]+)`/g)) spans.push({ body: match[1], index: match.index });
    // A span split across lines by wrapping: `name(a,\n b)`.
    for (const match of masked.matchAll(/`([^`]*\n[^`]*)`/g)) spans.push({ body: match[1], index: match.index });
    for (const span of spans) {
      for (const call of span.body.matchAll(CALL)) {
        const [, name, inner] = call;
        calls += 1;
        const line = text.slice(0, span.index).split("\n").length;
        const where = `${relative(resolve(MCP, ".."), file)}:${line}`;
        const td = tools.get(name);
        if (!td) {
          problems.push(`${where}: \`${name}(…)\` is not a tool the server defines`);
          continue;
        }
        const properties = Object.keys(td.inputSchema.properties ?? {});
        for (const arg of argumentNames(inner)) {
          if (!properties.includes(arg)) {
            problems.push(
              `${where}: \`${name}\` takes no argument \`${arg}\` (it takes ${properties.join(", ") || "none"})`,
            );
          }
        }
      }
    }
  }
  return { calls, problems, tools: tools.size };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { calls, problems, tools } = await checkReferenceCalls();
  if (problems.length) {
    for (const problem of problems) console.error(`RED ${problem}`);
    console.error(`${problems.length} reference call(s) disagree with the ${tools} tools the server defines.`);
    process.exit(1);
  }
  console.log(`OK — ${calls} tool call(s) written in the skill references name real tools and arguments.`);
}
