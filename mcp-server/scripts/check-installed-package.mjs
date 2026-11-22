#!/usr/bin/env node
// Installed-artifact check for the code index (PLAN §4.8, §8 SI11).
//
// Packs the package (or takes a tarball or registry spec from AMANUENSIS_TEST_PACKAGE), installs
// it into an empty directory, starts the installed `amanuensis-memory` over stdio against a
// repository holding fixtures/installed-artifact (one file per language, each defining
// `installedProbe`), and calls outline_file and read_symbol on every file. It fails when a
// grammar, its manifest or a definition query is missing from the tarball, because then a
// language does not parse and the probe is not found.
//
//   node scripts/check-installed-package.mjs
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const moduleDir = fileURLToPath(new URL("..", import.meta.url));
const FIXTURE_DIR = join(moduleDir, "fixtures/installed-artifact");
const PROBE = "installedProbe";

// The fixture file of each language the package must parse.
const FIXTURES = [
  { language: "typescript", file: "probe.ts" },
  { language: "tsx", file: "probe.tsx" },
  { language: "javascript", file: "probe.js" },
  { language: "python", file: "probe.py" },
  { language: "rust", file: "probe.rs" },
  { language: "go", file: "probe.go" },
  { language: "java", file: "Probe.java" },
  { language: "c", file: "probe.c" },
  { language: "cpp", file: "probe.cpp" },
  { language: "csharp", file: "Probe.cs" },
];

class CheckFailure extends Error {}
function check(condition, message) {
  if (!condition) throw new CheckFailure(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  check(
    result.status === 0,
    `${command} ${args.join(" ")} failed (${result.status})\n${result.stdout}\n${result.stderr}`,
  );
  return result;
}

/** Every symbol of an outline, nested definitions included. */
function flatten(symbols) {
  return (symbols ?? []).flatMap((s) => [s, ...flatten(s.children)]);
}

const scratch = mkdtempSync(join(tmpdir(), "amanuensis-installed-check-"));

async function main() {
  const npmCache = join(scratch, "npm-cache");
  const npmEnv = { ...process.env, npm_config_cache: npmCache };
  let packageSpec = process.env.AMANUENSIS_TEST_PACKAGE;
  if (!packageSpec) {
    run("npm", ["pack", "--silent", "--pack-destination", scratch], {
      cwd: moduleDir,
      env: npmEnv,
    });
    const tarballs = readdirSync(scratch).filter((name) => name.endsWith(".tgz"));
    check(tarballs.length === 1, `expected one npm tarball, found ${tarballs.length}`);
    packageSpec = join(scratch, tarballs[0]);
  }

  // An empty directory: nothing of the source tree is on the module path.
  const installRoot = mkdtempSync(join(scratch, "install-"));
  check(readdirSync(installRoot).length === 0, "the install directory is not empty");
  run("npm", ["install", "--prefix", installRoot, "--no-audit", "--no-fund", packageSpec], {
    cwd: scratch,
    env: npmEnv,
  });
  const packageRoot = join(installRoot, "node_modules", "@gruetech", "amanuensis");
  const server = join(installRoot, "node_modules", ".bin", "amanuensis-memory");
  check(existsSync(server), "the installed amanuensis-memory shim is missing");

  // What the tarball must carry, named before the server is asked to parse anything.
  const manifestPath = join(packageRoot, "grammars", "manifest.json");
  check(existsSync(manifestPath), "grammars/manifest.json is missing from the tarball");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")).grammars;
  for (const { language } of FIXTURES) {
    check(manifest[language], `the manifest has no ${language} grammar`);
    for (const file of ["grammar.wasm", "tags.scm", "LICENSE"]) {
      check(
        existsSync(join(packageRoot, "grammars", language, file)),
        `grammars/${language}/${file} is missing from the tarball`,
      );
    }
  }
  check(
    readdirSync(join(packageRoot, "queries")).some((name) => name.endsWith(".scm")),
    "queries/ carries no definition query",
  );
  check(
    existsSync(join(packageRoot, "THIRD_PARTY_NOTICES.md")),
    "THIRD_PARTY_NOTICES.md is missing from the tarball",
  );

  // The fixture repository: committed copies of the per-language files.
  const workspace = join(scratch, "workspace");
  const storage = join(scratch, "storage");
  mkdirSync(workspace);
  cpSync(FIXTURE_DIR, workspace, { recursive: true });
  run("git", ["init", "--quiet", "--initial-branch=main"], { cwd: workspace });
  run("git", ["add", "."], { cwd: workspace });
  run(
    "git",
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "--no-verify",
      "-m",
      "fixture",
    ],
    { cwd: workspace },
  );

  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith("AMANUENSIS_") && key !== "CLAUDE_PROJECT_DIR",
    ),
  );
  env.AMANUENSIS_STORAGE_ROOT = storage;
  env.AMANUENSIS_CALL_LOG = "off";
  const client = new Client({ name: "installed-artifact-check", version: "1" });
  async function call(name, args) {
    const result = await client.callTool({ name, arguments: args });
    return result.structuredContent ?? JSON.parse(result.content[0].text);
  }
  try {
    await client.connect(new StdioClientTransport({ command: server, cwd: "/", env }));
    const info = await call("get_project_info", { workspace });
    check(info.ok !== false, `get_project_info failed: ${JSON.stringify(info)}`);
    const tools = (await client.listTools()).tools.map((t) => t.name);
    for (const name of ["outline_file", "read_symbol"]) {
      check(tools.includes(name), `the installed server does not advertise ${name}`);
    }
    for (const fixture of FIXTURES) {
      const where = `${fixture.language} (${fixture.file})`;
      const outline = await call("outline_file", { path: fixture.file });
      check(outline.ok === true, `outline_file ${where} was refused: ${JSON.stringify(outline)}`);
      check(
        outline.lang === fixture.language,
        `outline_file ${where} parsed as ${outline.lang}, not ${fixture.language}`,
      );
      check(
        outline.status === "ok",
        `outline_file ${where} has status ${outline.status}; a grammar or query did not load`,
      );
      check(
        flatten(outline.symbols).some((s) => String(s.symbol_id).includes(PROBE)),
        `outline_file ${where} lists no definition of ${PROBE}: ${JSON.stringify(outline.symbols)}`,
      );
      const read = await call("read_symbol", { path: fixture.file, symbol: PROBE });
      check(read.ok === true, `read_symbol ${where} was refused: ${JSON.stringify(read)}`);
      check(
        typeof read.source === "string" && read.source.includes(PROBE),
        `read_symbol ${where} returned no source for ${PROBE}`,
      );
      check(
        read.evidence_args?.file_path === fixture.file && read.evidence_args?.symbol,
        `read_symbol ${where} returned no evidence_args`,
      );
    }
  } finally {
    await client.close();
  }
  console.log(
    `installed package parses ${FIXTURES.length} languages on Node ${process.versions.node} (${process.platform})`,
  );
}

main().then(
  () => {
    rmSync(scratch, { recursive: true, force: true });
  },
  (error) => {
    console.error(error instanceof CheckFailure ? error.message : error);
    console.error(`kept ${scratch} for inspection`);
    process.exit(1);
  },
);
