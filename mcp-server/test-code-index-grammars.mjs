#!/usr/bin/env node
// GATE SI1 — vendored grammars and packaging (design/semantic-index/PLAN.md §4.8, §8 SI1).
//
// Turns red when:
//   - grammars/sources.json does not pin the ten grammars (TypeScript, TSX, JavaScript,
//     Python, Rust, Go, Java, C, C++, C#) row for row: package, exact version, sha512
//     integrity, and the .wasm name inside the tarball;
//   - web-tree-sitter is not pinned to exactly 0.27.2 in package.json and package-lock.json,
//     any other tree-sitter package is a dependency of any kind or appears in the lockfile,
//     or the installed web-tree-sitter has an install script or dependencies;
//   - package.json `files` omits grammars/, queries/ or THIRD_PARTY_NOTICES.md, or `prepack`
//     does not run the vendoring step; .gitignore does not ignore the extracted grammars and
//     manifest while keeping sources.json tracked;
//   - a manifest file is missing, or its bytes differ from the sha256 and size recorded in
//     grammars/manifest.json, or the manifest disagrees with sources.json;
//   - any of the ten grammars does not load under the running Node, parse a sample to the
//     expected root without error, or compile its tags.scm;
//   - a flipped .wasm byte, a changed size, or a flipped tags.scm byte is accepted at load;
//   - a tarball whose integrity differs from sources.json is accepted, or leaves files behind,
//     or the vendoring step refuses the correct integrity;
//   - THIRD_PARTY_NOTICES.md omits a vendored package or a copyright line of its LICENSE;
//   - .github/workflows/test.yml does not run the vendoring step before the gate's step;
//   - `npm pack` omits a grammar, the manifest or the notices, or the tarball is over the ceiling.
//
// Network: this gate's integrity arms run the vendoring script, which fetches one pinned
// package with `npm pack`. Nothing else here reaches the network. Run `node
// scripts/vendor-grammars.mjs` first (the gate command does).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const grammarsDir = join(here, "grammars");

class GateFailure extends Error {}
function fail(message) {
  throw new GateFailure(message);
}
function check(condition, message) {
  if (!condition) fail(message);
}
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function readText(path, what) {
  if (!existsSync(path)) fail(`${what} is missing`);
  return readFileSync(path, "utf8");
}
function readJson(path, what) {
  const text = readText(path, what);
  try {
    return JSON.parse(text);
  } catch {
    return fail(`${what} is not valid JSON`);
  }
}
function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", cwd: here, ...options });
}

// The plan's table (§1, §4.8), row for row. integrity is `npm view <pkg>@<version>
// dist.integrity` as checked 2026-11-22. abi is measured under web-tree-sitter 0.27.2 at SI1:
// five grammars are ABI 14 and five ABI 15 (§1 says all ten are 15; it is wrong for these).
const GOLDEN = [
  {
    language: "typescript",
    abi: 14,
    package: "tree-sitter-typescript",
    version: "0.23.2",
    integrity:
      "sha512-e04JUUKxTT53/x3Uq1zIL45DoYKVfHH4CZqwgZhPg5qYROl5nQjV+85ruFzFGZxu+QeFVbRTPDRnqL9UbU4VeA==",
    wasm: "tree-sitter-typescript.wasm",
    sample: "const x: number = 1;\nfunction f(a: string): void {}\n",
    root: "program",
  },
  {
    language: "tsx",
    abi: 14,
    package: "tree-sitter-typescript",
    version: "0.23.2",
    integrity:
      "sha512-e04JUUKxTT53/x3Uq1zIL45DoYKVfHH4CZqwgZhPg5qYROl5nQjV+85ruFzFGZxu+QeFVbRTPDRnqL9UbU4VeA==",
    wasm: "tree-sitter-tsx.wasm",
    sample: "const a = <div className=\"x\">{1}</div>;\n",
    root: "program",
  },
  {
    language: "javascript",
    abi: 15,
    package: "tree-sitter-javascript",
    version: "0.25.0",
    integrity:
      "sha512-1fCbmzAskZkxcZzN41sFZ2br2iqTYP3tKls1b/HKGNPQUVOpsUxpmGxdN/wMqAk3jYZnYBR1dd/y/0avMeU7dw==",
    wasm: "tree-sitter-javascript.wasm",
    sample: "let x = 1;\nclass A { m() {} }\n",
    root: "program",
  },
  {
    language: "python",
    abi: 15,
    package: "tree-sitter-python",
    version: "0.25.0",
    integrity:
      "sha512-eCmJx6zQa35GxaCtQD+wXHOhYqBxEL+bp71W/s3fcDMu06MrtzkVXR437dRrCrbrDbyLuUDJpAgycs7ncngLXw==",
    wasm: "tree-sitter-python.wasm",
    sample: "def f(a):\n    return a\n",
    root: "module",
  },
  {
    language: "rust",
    abi: 14,
    package: "tree-sitter-rust",
    version: "0.24.0",
    integrity:
      "sha512-NWemUDf629Tfc90Y0Z55zuwPCAHkLxWnMf2RznYu4iBkkrQl2o/CHGB7Cr52TyN5F1DAx8FmUnDtCy9iUkXZEQ==",
    wasm: "tree-sitter-rust.wasm",
    sample: "fn main() {}\nstruct S;\n",
    root: "source_file",
  },
  {
    language: "go",
    abi: 15,
    package: "tree-sitter-go",
    version: "0.25.0",
    integrity:
      "sha512-APBc/Dq3xz/e35Xpkhb1blu5UgW+2E3RyGWawZSCNcbGwa7jhSQPS8KsUupuzBla8PCo8+lz9W/JDJjmfRa2tw==",
    wasm: "tree-sitter-go.wasm",
    sample: "package main\n\nfunc f() {}\n",
    root: "source_file",
  },
  {
    language: "java",
    abi: 14,
    package: "tree-sitter-java",
    version: "0.23.5",
    integrity:
      "sha512-Yju7oQ0Xx7GcUT01mUglPP+bYfvqjNCGdxqigTnew9nLGoII42PNVP3bHrYeMxswiCRM0yubWmN5qk+zsg0zMA==",
    wasm: "tree-sitter-java.wasm",
    sample: "class A { void m(int x) {} }\n",
    root: "program",
  },
  {
    language: "c",
    abi: 15,
    package: "tree-sitter-c",
    version: "0.24.1",
    integrity:
      "sha512-lkYwWN3SRecpvaeqmFKkuPNR3ZbtnvHU+4XAEEkJdrp3JfSp2pBrhXOtvfsENUneye76g889Y0ddF2DM0gEDpA==",
    wasm: "tree-sitter-c.wasm",
    sample: "int f(void) { return 0; }\n",
    root: "translation_unit",
  },
  {
    language: "cpp",
    abi: 14,
    package: "tree-sitter-cpp",
    version: "0.23.4",
    integrity:
      "sha512-qR5qUDyhZ5jJ6V8/umiBxokRbe89bCGmcq/dk94wI4kN86qfdV8k0GHIUEKaqWgcu42wKal5E97LKpLeVW8sKw==",
    wasm: "tree-sitter-cpp.wasm",
    sample: "namespace n { class A { void m() const {} }; }\n",
    root: "translation_unit",
  },
  {
    language: "csharp",
    abi: 15,
    package: "tree-sitter-c-sharp",
    version: "0.24.0",
    integrity:
      "sha512-M7VLq8mZEmPz3HNyocw484Pdai/DdSycrSlFrLqzjmhUPqhph3VellWbtx9mWcyTXgHWpNQzymFDrLt8IIna5w==",
    wasm: "tree-sitter-c_sharp.wasm",
    sample: "namespace N { class A { void M(ref int x) {} } }\n",
    root: "compilation_unit",
  },
];
const FILES = ["grammar.wasm", "tags.scm", "LICENSE"];
const RUNTIME_VERSION = "0.27.2";
const RUNTIME_INTEGRITY =
  "sha512-ZRo86GKI4aOSBAqOrPmCtriExI3xIzu1sNw/V6v3b4QGxrEmO19FGwbMNdyhw3MJLAZIw0xAV0oSpqX361eAyQ==";
const RUNTIME_DEPENDENCIES = [
  "@modelcontextprotocol/sdk",
  "ajv",
  "better-sqlite3",
  "jsonc-parser",
  "smol-toml",
  "web-tree-sitter",
];

// Ceilings just above the sizes measured at SI1 (the package before grammars was 1.96 MB
// packed and 11.27 MB unpacked; the ten grammars add 16.8 MB unpacked and 1.32 MB gzipped).
const PACKED_CEILING_BYTES = 3_600_000;
const UNPACKED_CEILING_BYTES = 31_000_000;

function checkSources() {
  const sources = readJson(join(grammarsDir, "sources.json"), "grammars/sources.json");
  check(
    sources && Array.isArray(sources.grammars),
    "grammars/sources.json has no `grammars` array",
  );
  check(
    sources.grammars.length === GOLDEN.length,
    `grammars/sources.json lists ${sources.grammars.length} grammars, expected ${GOLDEN.length}`,
  );
  for (const [i, want] of GOLDEN.entries()) {
    const got = sources.grammars[i];
    for (const key of ["language", "package", "version", "integrity", "wasm"]) {
      check(
        got && got[key] === want[key],
        `sources.json row ${i} (${want.language}): ${key} is ${JSON.stringify(got?.[key])}, expected ${JSON.stringify(want[key])}`,
      );
    }
  }
  return sources;
}

function checkPackageJson() {
  const pkg = readJson(join(here, "package.json"), "package.json");
  check(
    pkg.dependencies?.["web-tree-sitter"] === RUNTIME_VERSION,
    `package.json dependencies.web-tree-sitter is ${JSON.stringify(pkg.dependencies?.["web-tree-sitter"])}, expected the exact pin ${RUNTIME_VERSION}`,
  );
  check(
    JSON.stringify(Object.keys(pkg.dependencies).sort()) === JSON.stringify(RUNTIME_DEPENDENCIES),
    `package.json dependencies are ${Object.keys(pkg.dependencies).sort().join(",")}; web-tree-sitter must be the only addition`,
  );
  for (const section of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
    "bundledDependencies",
  ]) {
    const names = Array.isArray(pkg[section]) ? pkg[section] : Object.keys(pkg[section] ?? {});
    for (const name of names) {
      check(
        !/tree-sitter/.test(name) || name === "web-tree-sitter",
        `${name} is in package.json ${section}; grammars are vendored, never npm dependencies`,
      );
    }
  }
  for (const entry of ["grammars/", "queries/", "THIRD_PARTY_NOTICES.md"]) {
    check(pkg.files?.includes(entry), `package.json files does not list ${entry}`);
  }
  check(
    /node scripts\/vendor-grammars\.mjs/.test(pkg.scripts?.prepack ?? ""),
    `package.json prepack does not run scripts/vendor-grammars.mjs: ${pkg.scripts?.prepack}`,
  );
  check(
    /prepack-bundle-assets/.test(pkg.scripts.prepack) && /npm run build/.test(pkg.scripts.prepack),
    "package.json prepack no longer runs the bundle step and the build",
  );
  check(
    pkg.scripts.install === undefined &&
      pkg.scripts.postinstall === undefined &&
      pkg.scripts.preinstall === undefined,
    "package.json has an install script of its own",
  );
}

function checkLockfile() {
  const lock = readJson(join(here, "package-lock.json"), "package-lock.json");
  const packages = lock.packages ?? {};
  for (const key of Object.keys(packages)) {
    check(
      !/tree-sitter/.test(key) || key === "node_modules/web-tree-sitter",
      `package-lock.json contains ${key}; a grammar package is never an npm dependency`,
    );
  }
  const runtime = packages["node_modules/web-tree-sitter"];
  check(runtime, "package-lock.json has no entry for web-tree-sitter");
  check(
    runtime.version === RUNTIME_VERSION,
    `package-lock.json pins web-tree-sitter ${runtime.version}, expected ${RUNTIME_VERSION}`,
  );
  check(
    runtime.integrity === RUNTIME_INTEGRITY,
    "package-lock.json web-tree-sitter integrity differs from the registry's",
  );
  check(!runtime.hasInstallScript, "package-lock.json marks web-tree-sitter as having an install script");
  check(
    !runtime.dependencies && !runtime.optionalDependencies && !runtime.peerDependencies,
    "package-lock.json shows dependencies for web-tree-sitter",
  );
  check(
    packages[""]?.dependencies?.["web-tree-sitter"] === RUNTIME_VERSION,
    "package-lock.json root does not record the web-tree-sitter pin",
  );
  const installed = readJson(
    join(here, "node_modules", "web-tree-sitter", "package.json"),
    "node_modules/web-tree-sitter/package.json (run npm ci)",
  );
  check(installed.version === RUNTIME_VERSION, `installed web-tree-sitter is ${installed.version}`);
  for (const hook of ["preinstall", "install", "postinstall"]) {
    check(!installed.scripts?.[hook], `installed web-tree-sitter has a ${hook} script`);
  }
  check(
    Object.keys(installed.dependencies ?? {}).length === 0 &&
      Object.keys(installed.optionalDependencies ?? {}).length === 0,
    "installed web-tree-sitter has dependencies",
  );
  check(!existsSync(join(here, "binding.gyp")), "mcp-server has a native build file");
}

function checkGitignore() {
  const ignored = (path) =>
    run("git", ["check-ignore", "-q", path], { cwd: here }).status === 0;
  check(
    ignored("grammars/typescript/grammar.wasm") && ignored("grammars/go/tags.scm"),
    "extracted grammar files are not gitignored",
  );
  check(ignored("grammars/manifest.json"), "grammars/manifest.json is not gitignored");
  check(!ignored("grammars/sources.json"), "grammars/sources.json is gitignored; it must be tracked");
  const tracked = run("git", ["ls-files", "--", "grammars"], { cwd: here }).stdout.trim();
  check(tracked === "grammars/sources.json", `tracked files under grammars/: ${tracked || "(none)"}`);
}

async function loadVendorModule() {
  const path = join(here, "scripts", "vendor-grammars.mjs");
  if (!existsSync(path)) fail("scripts/vendor-grammars.mjs is missing");
  let mod;
  try {
    mod = await import(pathToFileURL(path).href);
  } catch (error) {
    return fail(`scripts/vendor-grammars.mjs does not import (${error?.name})`);
  }
  check(
    typeof mod.readVerifiedGrammar === "function" && typeof mod.readVerifiedGrammarFile === "function",
    "scripts/vendor-grammars.mjs does not export readVerifiedGrammar and readVerifiedGrammarFile",
  );
  return mod;
}

function checkManifest(sources) {
  const manifest = readJson(join(grammarsDir, "manifest.json"), "grammars/manifest.json");
  check(manifest.schema === 1, "grammars/manifest.json schema is not 1");
  const languages = Object.keys(manifest.grammars ?? {}).sort();
  const wanted = GOLDEN.map((row) => row.language).sort();
  check(
    JSON.stringify(languages) === JSON.stringify(wanted),
    `manifest lists ${languages.join(",")}; expected ${wanted.join(",")}`,
  );
  for (const row of sources.grammars) {
    const entry = manifest.grammars[row.language];
    for (const key of ["package", "version", "integrity"]) {
      check(entry[key] === row[key], `manifest ${row.language}.${key} disagrees with sources.json`);
    }
    check(
      JSON.stringify(Object.keys(entry.files).sort()) === JSON.stringify([...FILES].sort()),
      `manifest ${row.language} files are ${Object.keys(entry.files ?? {}).join(",")}`,
    );
    for (const file of FILES) {
      const path = join(grammarsDir, row.language, file);
      check(existsSync(path), `grammars/${row.language}/${file} is missing`);
      const bytes = readFileSync(path);
      const want = entry.files[file];
      check(
        bytes.length > 0 && want.size === bytes.length,
        `grammars/${row.language}/${file} is ${bytes.length} bytes; manifest says ${want.size}`,
      );
      check(
        /^[0-9a-f]{64}$/.test(want.sha256) && sha256(bytes) === want.sha256,
        `grammars/${row.language}/${file} sha256 differs from the manifest`,
      );
    }
    const wasm = readFileSync(join(grammarsDir, row.language, "grammar.wasm"));
    check(
      wasm.subarray(0, 4).equals(Buffer.from([0x00, 0x61, 0x73, 0x6d])),
      `grammars/${row.language}/grammar.wasm is not a WebAssembly module`,
    );
    const license = readFileSync(join(grammarsDir, row.language, "LICENSE"), "utf8");
    check(
      /Permission is hereby granted/.test(license),
      `grammars/${row.language}/LICENSE is not the MIT text`,
    );
    const tags = readFileSync(join(grammarsDir, row.language, "tags.scm"), "utf8");
    check(/@definition|@name|@reference/.test(tags), `grammars/${row.language}/tags.scm has no captures`);
  }
  return manifest;
}

async function checkLoads(vendor) {
  let runtime;
  try {
    runtime = await import("web-tree-sitter");
  } catch {
    fail("web-tree-sitter does not import (run npm ci)");
  }
  const { Parser, Language, Query } = runtime;
  await Parser.init();
  for (const row of GOLDEN) {
    const bytes = vendor.readVerifiedGrammar(grammarsDir, row.language);
    const language = await Language.load(new Uint8Array(bytes));
    check(
      language.abiVersion === row.abi,
      `${row.language} loads at ABI ${language.abiVersion}, expected ${row.abi}`,
    );
    const parser = new Parser();
    parser.setLanguage(language);
    const tree = parser.parse(row.sample);
    check(tree.rootNode.type === row.root, `${row.language} sample parsed to ${tree.rootNode.type}`);
    check(!tree.rootNode.hasError, `${row.language} sample parsed with an error`);
    check(
      tree.rootNode.endIndex === Buffer.byteLength(row.sample) || tree.rootNode.text.length > 0,
      `${row.language} root node covers nothing`,
    );
    const tagsText = vendor.readVerifiedGrammarFile(grammarsDir, row.language, "tags.scm").toString("utf8");
    const query = new Query(language, tagsText);
    check(query.captureNames.length > 0, `${row.language} tags.scm compiles to no captures`);
    tree.delete();
    parser.delete();
  }
}

function checkRefusedAtLoad(vendor) {
  const root = mkdtempSync(join(tmpdir(), "amanuensis-grammar-load-"));
  try {
    mkdirSync(join(root, "go"));
    copyFileSync(join(grammarsDir, "manifest.json"), join(root, "manifest.json"));
    for (const file of FILES) copyFileSync(join(grammarsDir, "go", file), join(root, "go", file));
    const original = readFileSync(join(grammarsDir, "go", "grammar.wasm"));
    // Control: the unmodified copy is accepted and returns the exact bytes.
    check(
      vendor.readVerifiedGrammar(root, "go").equals(original),
      "an unmodified copy of grammars/go is not returned byte for byte",
    );
    const refuses = (mutate, file, pattern, what) => {
      const bytes = Buffer.from(file === "grammar.wasm" ? original : readFileSync(join(grammarsDir, "go", file)));
      writeFileSync(join(root, "go", file), mutate(bytes));
      let message = null;
      try {
        if (file === "grammar.wasm") vendor.readVerifiedGrammar(root, "go");
        else vendor.readVerifiedGrammarFile(root, "go", file);
      } catch (error) {
        message = String(error?.message ?? error);
      }
      writeFileSync(join(root, "go", file), file === "grammar.wasm" ? original : readFileSync(join(grammarsDir, "go", file)));
      check(message !== null, `${what} was accepted at load`);
      check(pattern.test(message), `${what} was refused without naming the hash or size: ${message.slice(0, 120)}`);
    };
    refuses(
      (b) => {
        b[Math.floor(b.length / 2)] ^= 0x01;
        return b;
      },
      "grammar.wasm",
      /sha256/,
      "a flipped .wasm byte",
    );
    refuses(
      (b) => {
        b[0] ^= 0x01;
        return b;
      },
      "grammar.wasm",
      /sha256/,
      "a flipped first .wasm byte",
    );
    refuses((b) => Buffer.concat([b, Buffer.from([0])]), "grammar.wasm", /size/, "an appended .wasm byte");
    refuses((b) => b.subarray(0, b.length - 1), "grammar.wasm", /size/, "a truncated .wasm");
    refuses(
      (b) => {
        b[10] ^= 0x01;
        return b;
      },
      "tags.scm",
      /sha256/,
      "a flipped tags.scm byte",
    );
    // A language the manifest does not list is refused, not loaded from disk.
    mkdirSync(join(root, "rogue"));
    copyFileSync(join(grammarsDir, "go", "grammar.wasm"), join(root, "rogue", "grammar.wasm"));
    let rogue = null;
    try {
      vendor.readVerifiedGrammar(root, "rogue");
    } catch (error) {
      rogue = String(error?.message ?? error);
    }
    check(rogue !== null, "a grammar the manifest does not list was loaded");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function checkIntegrityRefusal(sources, manifest) {
  const row = sources.grammars.find((entry) => entry.language === "go");
  const scratch = mkdtempSync(join(tmpdir(), "amanuensis-grammar-integrity-"));
  const script = join(here, "scripts", "vendor-grammars.mjs");
  try {
    const flipped = row.integrity.replace(
      /^sha512-(.)/,
      (_m, c) => `sha512-${c === "A" ? "B" : "A"}`,
    );
    check(flipped !== row.integrity, "gate could not alter the integrity");
    const pin = (integrity) =>
      JSON.stringify({ schema: 1, grammars: [{ ...row, integrity }] }, null, 2);

    const badSources = join(scratch, "bad-sources.json");
    const badOut = join(scratch, "bad-out");
    writeFileSync(badSources, pin(flipped));
    const bad = run(process.execPath, [script, "--sources", badSources, "--out", badOut], {
      cwd: scratch,
      timeout: 180_000,
    });
    check(bad.status !== 0, "a tarball whose integrity differs from sources.json was accepted");
    check(
      /integrity/i.test(`${bad.stdout}${bad.stderr}`),
      "the integrity refusal does not say integrity",
    );
    const leftovers = existsSync(badOut) ? readdirSync(badOut) : [];
    check(
      leftovers.length === 0,
      `a refused tarball left ${leftovers.join(",")} under the output directory`,
    );

    const goodSources = join(scratch, "good-sources.json");
    const goodOut = join(scratch, "good-out");
    writeFileSync(goodSources, pin(row.integrity));
    const good = run(process.execPath, [script, "--sources", goodSources, "--out", goodOut], {
      cwd: scratch,
      timeout: 180_000,
    });
    check(
      good.status === 0,
      `the vendoring step refused the correct integrity: ${(good.stderr || good.stdout).slice(0, 200)}`,
    );
    const fetched = readFileSync(join(goodOut, "go", "grammar.wasm"));
    check(
      sha256(fetched) === manifest.grammars.go.files["grammar.wasm"].sha256,
      "a fresh vendoring of go differs from the vendored grammar",
    );
    const freshManifest = readJson(join(goodOut, "manifest.json"), "the fresh manifest");
    check(
      freshManifest.grammars.go.files["tags.scm"].sha256 === manifest.grammars.go.files["tags.scm"].sha256,
      "a fresh vendoring of go has a different tags.scm",
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function checkNotices(sources) {
  const notices = readText(join(here, "THIRD_PARTY_NOTICES.md"), "THIRD_PARTY_NOTICES.md");
  for (const row of sources.grammars) {
    check(
      notices.includes(`${row.package}@${row.version}`),
      `THIRD_PARTY_NOTICES.md omits ${row.package}@${row.version}`,
    );
    const license = readFileSync(join(grammarsDir, row.language, "LICENSE"), "utf8");
    const copyright = license.split("\n").find((line) => /copyright/i.test(line))?.trim();
    check(copyright, `grammars/${row.language}/LICENSE has no copyright line`);
    check(notices.includes(copyright), `THIRD_PARTY_NOTICES.md omits "${copyright}"`);
  }
  check(
    notices.includes(`web-tree-sitter@${RUNTIME_VERSION}`),
    "THIRD_PARTY_NOTICES.md omits web-tree-sitter",
  );
  const runtimeLicense = readText(
    join(here, "node_modules", "web-tree-sitter", "LICENSE"),
    "the web-tree-sitter LICENSE",
  );
  const runtimeCopyright = runtimeLicense.split("\n").find((line) => /copyright/i.test(line))?.trim();
  check(runtimeCopyright && notices.includes(runtimeCopyright), "THIRD_PARTY_NOTICES.md omits the web-tree-sitter copyright line");
}

function checkWorkflow() {
  const text = readText(join(repoRoot, ".github", "workflows", "test.yml"), ".github/workflows/test.yml");
  const lines = text.split("\n");
  const vendorAt = lines.findIndex((line) => /run:\s*node scripts\/vendor-grammars\.mjs\s*$/.test(line));
  check(vendorAt >= 0, "test.yml has no step that runs `node scripts/vendor-grammars.mjs`");
  const gateAt = lines.findIndex((line) => /run:\s*node test-code-index-grammars\.mjs\s*$/.test(line));
  check(gateAt >= 0, "test.yml does not run test-code-index-grammars.mjs");
  const installAt = lines.findIndex((line) => /run:\s*npm ci\s*$/.test(line));
  check(installAt >= 0 && installAt < vendorAt, "test.yml vendors grammars before `npm ci`");
  check(vendorAt < gateAt, "test.yml runs the grammar gate before the vendoring step");
  const stepStart = (index) => {
    for (let i = index; i >= 0; i--) if (/^\s*- name:/.test(lines[i])) return i;
    return -1;
  };
  check(
    /working-directory:\s*mcp-server/.test(lines.slice(stepStart(vendorAt), vendorAt + 1).join("\n")),
    "the vendoring step does not run in mcp-server",
  );
  check(
    /GATE SI1/.test(lines[stepStart(gateAt)]),
    "the grammar gate's step is not named with GATE SI1",
  );
}

function checkPackedSize() {
  const result = run("npm", ["pack", "--dry-run", "--json"], { timeout: 300_000 });
  check(result.status === 0, "npm pack --dry-run failed");
  const at = result.stdout.lastIndexOf("\n[\n");
  check(at >= 0 || result.stdout.startsWith("[\n"), "npm pack --dry-run printed no JSON");
  let report;
  try {
    report = JSON.parse(result.stdout.slice(at + 1))[0];
  } catch {
    return fail("npm pack --dry-run printed unreadable JSON");
  }
  const packed = new Set(report.files.map((file) => file.path));
  for (const row of GOLDEN) {
    for (const file of FILES) {
      check(packed.has(`grammars/${row.language}/${file}`), `the package omits grammars/${row.language}/${file}`);
    }
  }
  for (const path of ["grammars/manifest.json", "grammars/sources.json", "THIRD_PARTY_NOTICES.md"]) {
    check(packed.has(path), `the package omits ${path}`);
  }
  check(
    report.size < PACKED_CEILING_BYTES,
    `the packed tarball is ${report.size} bytes, over the ${PACKED_CEILING_BYTES} ceiling`,
  );
  check(
    report.unpackedSize < UNPACKED_CEILING_BYTES,
    `the unpacked package is ${report.unpackedSize} bytes, over the ${UNPACKED_CEILING_BYTES} ceiling`,
  );
  // The ceiling must not be slack enough to hide a grammar added by mistake.
  check(
    report.unpackedSize > 20_000_000,
    `the unpacked package is ${report.unpackedSize} bytes, below the 20 MB the ten grammars require`,
  );
}

async function main() {
  const sources = checkSources();
  checkPackageJson();
  checkLockfile();
  checkGitignore();
  const manifest = checkManifest(sources);
  const vendor = await loadVendorModule();
  await checkLoads(vendor);
  checkRefusedAtLoad(vendor);
  checkNotices(sources);
  checkWorkflow();
  checkIntegrityRefusal(sources, manifest);
  checkPackedSize();
}

try {
  await main();
  console.log("GATE SI1 GREEN");
} catch (error) {
  if (error instanceof GateFailure) {
    console.log(`GATE SI1 RED: ${error.message}`);
  } else {
    if (process.env.GATE_DEBUG) console.error(error);
    console.log(`GATE SI1 RED: unexpected failure (${error?.name ?? "unknown"})`);
  }
  process.exitCode = 1;
}
