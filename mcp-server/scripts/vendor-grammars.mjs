#!/usr/bin/env node
// Vendor the tree-sitter grammars the code index parses with (PLAN §4.8).
//
// grammars/sources.json pins ten grammar packages by name, exact version and sha512
// integrity. They are never npm dependencies: each package ships native prebuilds with an
// install script, and the ten .wasm files are the only part used. This script runs
// `npm pack <name>@<version>` (no install, no lifecycle scripts) into a temporary
// directory, refuses a tarball whose integrity differs from the pin, and extracts only the
// .wasm, queries/tags.scm and LICENSE into grammars/<language>/ (gitignored), then writes
// grammars/manifest.json with the sha256 and size of each file.
//
// `readVerifiedGrammar` and `readVerifiedGrammarFile` are the load-time check: they return a
// file's bytes only if they match the manifest.
//
// Run by `prepack` and CI. Safe to re-run: when every vendored file already matches the
// manifest and the pins, it fetches nothing.
//   node scripts/vendor-grammars.mjs [--force] [--sources <file>] [--out <dir>]
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(moduleDir, "..");
const defaultOut = join(packageRoot, "grammars");
const defaultSources = join(defaultOut, "sources.json");

export const GRAMMAR_FILES = ["grammar.wasm", "tags.scm", "LICENSE"];
const INTEGRITY = /^sha512-[A-Za-z0-9+/]{86}==$/;
const LANGUAGE = /^[a-z][a-z0-9]*$/;
const PACKAGE = /^tree-sitter-[a-z0-9-]+$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const MEMBER = /^[A-Za-z0-9_.-]+\.wasm$/;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function loadSources(path = defaultSources) {
  if (!existsSync(path)) throw new Error(`sources file not found: ${path}`);
  const sources = JSON.parse(readFileSync(path, "utf8"));
  if (sources.schema !== 1 || !Array.isArray(sources.grammars) || sources.grammars.length === 0) {
    throw new Error(`${path}: expected {"schema": 1, "grammars": [...]}`);
  }
  const seen = new Set();
  for (const row of sources.grammars) {
    if (!LANGUAGE.test(row.language ?? "") || seen.has(row.language)) {
      throw new Error(`${path}: bad or duplicate language ${JSON.stringify(row.language)}`);
    }
    seen.add(row.language);
    if (!PACKAGE.test(row.package ?? "")) throw new Error(`${path}: bad package for ${row.language}`);
    if (!VERSION.test(row.version ?? "")) {
      throw new Error(`${path}: ${row.language} needs an exact version, got ${row.version}`);
    }
    if (!INTEGRITY.test(row.integrity ?? "")) {
      throw new Error(`${path}: ${row.language} needs a sha512 integrity`);
    }
    if (!MEMBER.test(row.wasm ?? "")) throw new Error(`${path}: bad wasm name for ${row.language}`);
    if (row.tarball !== undefined) {
      if (typeof row.tarball !== "string" || !row.tarball.endsWith(".tgz")) {
        throw new Error(`${path}: ${row.language} tarball must be a path to a .tgz`);
      }
      row.tarball = resolve(dirname(path), row.tarball);
    }
  }
  return sources;
}

function readManifest(root) {
  const path = join(root, "manifest.json");
  if (!existsSync(path)) throw new Error(`grammar manifest not found: ${path}`);
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  if (manifest.schema !== 1 || typeof manifest.grammars !== "object" || !manifest.grammars) {
    throw new Error(`grammar manifest is unreadable: ${path}`);
  }
  return manifest;
}

// The bytes of grammars/<language>/<file>, if and only if they match the manifest's size and
// sha256. A language or file the manifest does not list is refused.
export function readVerifiedGrammarFile(root, language, file) {
  const entry = Object.hasOwn(readManifest(root).grammars, language)
    ? readManifest(root).grammars[language]
    : undefined;
  const want = entry && GRAMMAR_FILES.includes(file) ? entry.files?.[file] : undefined;
  if (!want) throw new Error(`grammar ${language}/${file} is not in the manifest`);
  const path = join(root, language, file);
  if (!existsSync(path)) throw new Error(`grammar file is missing: ${language}/${file}`);
  const bytes = readFileSync(path);
  if (bytes.length !== want.size) {
    throw new Error(
      `grammar ${language}/${file} is ${bytes.length} bytes; the manifest records size ${want.size}`,
    );
  }
  const got = sha256(bytes);
  if (got !== want.sha256) {
    throw new Error(
      `grammar ${language}/${file} sha256 ${got} differs from the manifest's ${want.sha256}`,
    );
  }
  return bytes;
}

export function readVerifiedGrammar(root, language) {
  return readVerifiedGrammarFile(root, language, "grammar.wasm");
}

function currentManifest(sources, out) {
  try {
    const manifest = readManifest(out);
    if (Object.keys(manifest.grammars).length !== sources.grammars.length) return false;
    for (const row of sources.grammars) {
      const entry = manifest.grammars[row.language];
      if (
        !entry ||
        entry.package !== row.package ||
        entry.version !== row.version ||
        entry.integrity !== row.integrity
      ) {
        return false;
      }
      for (const file of GRAMMAR_FILES) readVerifiedGrammarFile(out, row.language, file);
    }
    return true;
  } catch {
    return false;
  }
}

// A row's optional `tarball` names a local .tgz to verify instead of fetching from the
// registry; the SI1 gate uses it to stay off the network. The pinned rows have none.
function pack(row, scratch) {
  const directory = mkdtempSync(join(scratch, "pack-"));
  const spec = row.tarball ?? `${row.package}@${row.version}`;
  if (row.tarball) {
    if (!existsSync(row.tarball)) throw new Error(`tarball not found: ${row.tarball}`);
    writeFileSync(join(directory, "local.tgz"), readFileSync(row.tarball));
  } else {
    fetchTarball(spec, directory);
  }
  const tarballs = readdirSync(directory).filter((name) => name.endsWith(".tgz"));
  if (tarballs.length !== 1) throw new Error(`npm pack ${spec} produced ${tarballs.length} tarballs`);
  const tarball = join(directory, tarballs[0]);
  const digest = `sha512-${createHash("sha512").update(readFileSync(tarball)).digest("base64")}`;
  if (digest !== row.integrity) {
    throw new Error(
      `integrity mismatch for ${spec}: sources.json pins ${row.integrity}, the tarball is ${digest}`,
    );
  }
  return tarball;
}

function fetchTarball(spec, directory) {
  const result = spawnSync(
    "npm",
    ["pack", spec, "--ignore-scripts", "--silent", "--pack-destination", directory],
    {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env, npm_config_ignore_scripts: "true", npm_config_audit: "false" },
    },
  );
  if (result.status !== 0) {
    throw new Error(`npm pack ${spec} failed: ${(result.stderr || result.stdout).trim().slice(0, 300)}`);
  }
}

// Extract exactly the three members a grammar needs, into a directory that holds nothing else.
function extract(tarball, row, scratch) {
  const target = mkdtempSync(join(scratch, "extract-"));
  const members = [`package/${row.wasm}`, "package/queries/tags.scm", "package/LICENSE"];
  const result = spawnSync("tar", ["-xzf", tarball, "-C", target, ...members], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `${row.package}@${row.version} does not hold ${members.join(", ")}: ${result.stderr.trim().slice(0, 200)}`,
    );
  }
  const files = {
    "grammar.wasm": join(target, "package", row.wasm),
    "tags.scm": join(target, "package", "queries", "tags.scm"),
    LICENSE: join(target, "package", "LICENSE"),
  };
  for (const [name, path] of Object.entries(files)) {
    if (!lstatSync(path).isFile()) throw new Error(`${row.language}/${name} is not a regular file`);
  }
  return files;
}

export function vendorGrammars({ sourcesPath = defaultSources, out = defaultOut, force = false } = {}) {
  const sources = loadSources(sourcesPath);
  if (!force && currentManifest(sources, out)) {
    return { fetched: 0, grammars: sources.grammars.length };
  }
  const scratch = mkdtempSync(join(tmpdir(), "amanuensis-vendor-grammars-"));
  try {
    const stage = join(scratch, "stage");
    mkdirSync(stage);
    const tarballs = new Map();
    const manifest = { schema: 1, grammars: {} };
    for (const row of sources.grammars) {
      const key = `${row.package}@${row.version}`;
      if (!tarballs.has(key)) tarballs.set(key, pack(row, scratch));
      const files = extract(tarballs.get(key), row, scratch);
      mkdirSync(join(stage, row.language));
      const recorded = {};
      for (const name of GRAMMAR_FILES) {
        const bytes = readFileSync(files[name]);
        if (bytes.length === 0) throw new Error(`${row.language}/${name} is empty`);
        writeFileSync(join(stage, row.language, name), bytes);
        recorded[name] = { sha256: sha256(bytes), size: bytes.length };
      }
      if (!readFileSync(join(stage, row.language, "grammar.wasm")).subarray(0, 4).equals(Buffer.from([0, 0x61, 0x73, 0x6d]))) {
        throw new Error(`${row.language}/grammar.wasm is not a WebAssembly module`);
      }
      manifest.grammars[row.language] = {
        package: row.package,
        version: row.version,
        integrity: row.integrity,
        files: recorded,
      };
    }
    // Everything verified: replace the output only now, so a refusal leaves nothing behind.
    mkdirSync(out, { recursive: true });
    rmSync(join(out, "manifest.json"), { force: true });
    const wanted = new Set(sources.grammars.map((row) => row.language));
    for (const entry of readdirSync(out, { withFileTypes: true })) {
      if (
        entry.isDirectory() &&
        !wanted.has(entry.name) &&
        existsSync(join(out, entry.name, "grammar.wasm"))
      ) {
        rmSync(join(out, entry.name), { recursive: true, force: true });
      }
    }
    for (const row of sources.grammars) {
      rmSync(join(out, row.language), { recursive: true, force: true });
      renameOrCopy(join(stage, row.language), join(out, row.language));
    }
    writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    return { fetched: tarballs.size, grammars: sources.grammars.length };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// The scratch directory may sit on another filesystem than the output.
function renameOrCopy(from, to) {
  try {
    renameSync(from, to);
  } catch (error) {
    if (error?.code !== "EXDEV") throw error;
    mkdirSync(to);
    for (const name of readdirSync(from)) writeFileSync(join(to, name), readFileSync(join(from, name)));
  }
}

function parseArguments(argv) {
  const options = { force: false, sourcesPath: defaultSources, out: defaultOut };
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    if (argument === "--force") options.force = true;
    else if (argument === "--sources" && argv[i + 1]) options.sourcesPath = resolve(argv[++i]);
    else if (argument === "--out" && argv[i + 1]) options.out = resolve(argv[++i]);
    else throw new Error(`unknown argument: ${argument}`);
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = vendorGrammars(parseArguments(process.argv.slice(2)));
    console.log(
      result.fetched === 0
        ? `grammars up to date (${result.grammars} languages, nothing fetched)`
        : `vendored ${result.grammars} grammars from ${result.fetched} packages`,
    );
  } catch (error) {
    console.error(`vendor-grammars: ${error.message}`);
    process.exitCode = 1;
  }
}
