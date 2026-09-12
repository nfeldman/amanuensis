#!/usr/bin/env node
// Promote a green Amanuensis publish to the tracked `docs/` (reader-lenses P18,
// spec.md §12.2; claims C53, C62).
//
// Why this script exists at all. `materialize_docs` cannot write the tracked
// tree: `output_dir` defaults to `"docs"` and is resolved by
// `resolveStorageOutputPath` (mcp-server/src/tools/materialize.ts:241-245),
// which resolves relative paths against `project.storagePath` and asserts
// containment (mcp-server/src/project.ts:1003-1012). So the tool publishes
// `.amanuensis/docs`, and pointing it at the repository root raises
// "materializer read-back output escapes its configured root". That containment
// is the guard working as designed, not a bug to remove — which leaves
// publication as two steps, and makes the second one explicit.
//
// The read-back at the destination is run through the materializer CLI in
// `--readback-only` mode, which is the same code path `verify_materialized_docs`
// executes (materialize.ts's handler passes exactly `--readback-only`). The MCP
// tool itself cannot be pointed here for the containment reason above, so the
// operation is invoked directly rather than through the tool that wraps it.
//
// What it refuses, and in this order, so that a refusal never depends on a
// store or an interpreter being present:
//
//   1. a source that is not a directory;
//   2. a source carrying no `.projection-contract.json`, or one that does not
//      parse, or one naming no page;
//   3. a source whose bytes have drifted from the contract it carries, or that
//      holds a file the contract does not claim — the publish's own receipt no
//      longer describes what is on disk;
//   4. a source carrying no `.manifest.json`;
//   5. a source whose read-back is not green on all three axes — state,
//      coverage and content;
//   6. a destination holding files its own manifest does not claim, which are
//      somebody else's and are not this script's to replace.
//
// Nothing is written before all six pass. The promotion itself stages a copy
// beside the destination and renames it into place, keeping the previous
// contents in a backup until the promoted tree has been verified *at the
// destination path*; a red post-promotion read-back restores the backup and
// exits non-zero. The bytes that get committed are the bytes that were verified
// at the path they were committed to — verifying one directory and committing
// another is GP21, a unit-scoped pass asserted as a system-scoped one.
//
//   node dev/promote-docs.mjs
//   node dev/promote-docs.mjs --source .amanuensis/docs --destination docs \
//        --publish-summary <clean-publish.json> --receipt <promotion.json>
//
// The last line of stdout is a JSON summary. Exit status is 0 only when the
// promoted tree is in place and verified.

import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CONTRACT_NAME = ".projection-contract.json";
const MANIFEST_NAME = ".manifest.json";
const MATERIALIZER = join(REPO, "materializer", "materialize.py");
const READBACK_AXES = ["state", "coverage", "content"];

function parseArgs(argv) {
  const options = {
    source: ".amanuensis/docs",
    destination: "docs",
    storage: ".amanuensis",
    publishSummary: null,
    receipt: null,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined) throw new Error(`${flag} needs a value`);
      index += 1;
      return next;
    };
    switch (flag) {
      case "--source":
        options.source = value();
        break;
      case "--destination":
      case "--dest":
        options.destination = value();
        break;
      case "--storage":
        options.storage = value();
        break;
      case "--publish-summary":
        options.publishSummary = value();
        break;
      case "--receipt":
        options.receipt = value();
        break;
      case "--json":
        options.json = true;
        break;
      default:
        throw new Error(`unknown argument ${flag}`);
    }
  }
  return options;
}

function abs(pathish) {
  return isAbsolute(pathish) ? resolve(pathish) : resolve(REPO, pathish);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Every regular file beneath `root`, as paths relative to it, sorted. */
function walk(root, prefix = "") {
  const out = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(join(root, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out.sort();
}

function readJsonFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

class Refusal extends Error {}

function refuse(reason) {
  throw new Refusal(reason);
}

/**
 * Hash every page the contract names, at the directory given. Returns the page
 * count; refuses on the first page that is missing, drifted, or unclaimed.
 */
function matchContract(directory, label) {
  const contractPath = join(directory, CONTRACT_NAME);
  if (!existsSync(contractPath)) {
    refuse(`${label} carries no ${CONTRACT_NAME}: there is no publication contract to verify it against`);
  }
  let contract = null;
  try {
    contract = readJsonFile(contractPath);
  } catch (error) {
    refuse(`${label}'s ${CONTRACT_NAME} does not parse — ${error.message}`);
  }
  const pages = Array.isArray(contract?.pages) ? contract.pages : [];
  if (!pages.length) {
    refuse(`${label}'s ${CONTRACT_NAME} names no page, so it verifies nothing`);
  }
  const claimed = new Set([CONTRACT_NAME, MANIFEST_NAME]);
  for (const page of pages) {
    const rel = String(page?.path ?? "");
    if (!rel || rel.startsWith("/") || rel.includes("..")) {
      refuse(`${label}'s contract names an unusable page path ${JSON.stringify(page?.path ?? null)}`);
    }
    if (claimed.has(rel)) refuse(`${label}'s contract names ${rel} twice`);
    claimed.add(rel);
    const pagePath = join(directory, rel);
    if (!existsSync(pagePath) || !statSync(pagePath).isFile()) {
      refuse(`${label}'s contract names ${rel}, which is not there`);
    }
    const actual = sha256(readFileSync(pagePath));
    if (actual !== page?.content_hash) {
      refuse(
        `${label}/${rel} hashes to ${actual} and its contract records ${JSON.stringify(page?.content_hash ?? null)}: the bytes have drifted from the receipt that describes them`,
      );
    }
  }
  const unclaimed = walk(directory).filter((rel) => !claimed.has(rel));
  if (unclaimed.length) {
    refuse(
      `${label} holds ${unclaimed.length} file(s) its contract does not claim: ${unclaimed.slice(0, 5).join(", ")}`,
    );
  }
  return { contract, pageCount: pages.length };
}

/**
 * The read-back `verify_materialized_docs` runs, invoked directly because the
 * tool's output path is confined to project storage and the destination is not.
 */
function readback(storage, directory, label) {
  if (!existsSync(MATERIALIZER)) {
    refuse(`the materializer is not at ${MATERIALIZER}, so ${label} cannot be read back`);
  }
  const python = process.env.AMANUENSIS_PYTHON ?? "python3";
  const run = spawnSync(
    python,
    [MATERIALIZER, "--storage", storage, "--output", directory, "--readback-only"],
    { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (run.error) refuse(`the read-back of ${label} could not be started — ${run.error.message}`);
  const last = String(run.stdout ?? "").trim().split("\n").filter(Boolean).pop();
  let summary = null;
  try {
    summary = last ? JSON.parse(last) : null;
  } catch {
    summary = null;
  }
  if (!summary) {
    refuse(
      `the read-back of ${label} produced no JSON summary (exit ${run.status}): ${String(run.stderr ?? "").trim().slice(-400) || "no stderr"}`,
    );
  }
  const axes = summary.axes ?? summary.readback?.axes ?? {};
  const red = READBACK_AXES.filter((axis) => axes?.[axis]?.ok !== true);
  if (summary.ok !== true || red.length) {
    refuse(
      `the read-back of ${label} is red on ${red.length ? red.join(", ") : "no named"} axis (${summary.mismatch_count ?? summary.readback?.mismatch_count ?? "?"} mismatch(es)); nothing is promoted`,
    );
  }
  return summary;
}

/** `unmanaged_output_files`' rule, applied to the destination this replaces. */
function unmanagedAt(directory) {
  if (!existsSync(directory)) return [];
  const present = walk(directory);
  if (!present.length) return [];
  const manifestPath = join(directory, MANIFEST_NAME);
  if (!existsSync(manifestPath)) return present;
  let manifest = null;
  try {
    manifest = readJsonFile(manifestPath);
  } catch {
    return [MANIFEST_NAME];
  }
  const owned = new Set([
    CONTRACT_NAME,
    MANIFEST_NAME,
    ...(Array.isArray(manifest?.pages) ? manifest.pages : [])
      .map((page) => String(page?.path ?? ""))
      .filter(Boolean),
    ...(Array.isArray(manifest?.projection_files) ? manifest.projection_files : [])
      .map((item) => String(item?.path ?? ""))
      .filter(Boolean),
  ]);
  return present.filter((rel) => !owned.has(rel));
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const source = abs(options.source);
  const destination = abs(options.destination);
  const storage = abs(options.storage);

  if (source === destination) refuse("the source and the destination are the same directory");
  if (!existsSync(source) || !statSync(source).isDirectory()) {
    refuse(`the source ${options.source} is not a directory: there is no publish to promote`);
  }

  // Read before anything is written, so an unreadable summary refuses rather
  // than leaving a promoted tree behind a non-zero exit.
  let publishSummary = null;
  if (options.publishSummary) {
    try {
      publishSummary = readJsonFile(abs(options.publishSummary));
    } catch (error) {
      refuse(`the clean-publish summary at ${options.publishSummary} could not be read — ${error.message}`);
    }
  }

  // 2–3. The publish's own receipt, and the bytes it describes.
  const { contract: sourceContract, pageCount } = matchContract(source, options.source);
  // 4. The manifest travels with the contract; the read-back's coverage axis
  //    reads the projection, and the diff-aware render reads the manifest.
  if (!existsSync(join(source, MANIFEST_NAME))) {
    refuse(`the source ${options.source} carries no ${MANIFEST_NAME}`);
  }
  const sourceArtifacts = {
    projection_contract_sha256: sha256(readFileSync(join(source, CONTRACT_NAME))),
    manifest_sha256: sha256(readFileSync(join(source, MANIFEST_NAME))),
    page_count: pageCount,
    contract_version: sourceContract?.version ?? null,
  };

  // 5. The three axes, at the source, before anything is written.
  const sourceReadback = readback(storage, source, options.source);

  // 6. Whatever is at the destination is replaced as one unit, so a file
  //    nobody's manifest claims is somebody else's and stops the promotion.
  const unmanaged = unmanagedAt(destination);
  if (unmanaged.length) {
    refuse(
      `the destination ${options.destination} holds ${unmanaged.length} file(s) no manifest claims: ${unmanaged.slice(0, 5).join(", ")}`,
    );
  }

  // Stage beside the destination, then swap. A crash between the two renames
  // leaves the backup in place beside the destination rather than a half-copy
  // inside it.
  const parent = dirname(destination);
  mkdirSync(parent, { recursive: true });
  const stage = join(parent, `.${options.destination.split("/").pop()}.amanuensis-promote-${randomUUID().slice(0, 8)}`);
  const backup = existsSync(destination)
    ? join(parent, `.${options.destination.split("/").pop()}.amanuensis-previous-${randomUUID().slice(0, 8)}`)
    : null;
  cpSync(source, stage, { recursive: true });
  if (backup) renameSync(destination, backup);
  let promoted = false;
  let promotionReadback = null;
  try {
    renameSync(stage, destination);
    promoted = true;
    // The promoted tree, verified at the path it will be committed to.
    matchContract(destination, options.destination);
    promotionReadback = readback(storage, destination, options.destination);
  } catch (error) {
    if (promoted) rmSync(destination, { recursive: true, force: true });
    else rmSync(stage, { recursive: true, force: true });
    if (backup) renameSync(backup, destination);
    throw error;
  }
  if (backup) rmSync(backup, { recursive: true, force: true });

  const summary = {
    ok: true,
    contract: "amanuensis-reader-lenses/promotion/v1",
    promoted_at: new Date().toISOString(),
    source: options.source,
    destination: options.destination,
    storage: options.storage,
    source_artifacts: sourceArtifacts,
    files_promoted: walk(destination).length,
    source_readback: {
      ok: sourceReadback.ok === true,
      axes: sourceReadback.axes ?? sourceReadback.readback?.axes ?? null,
      mismatch_count: sourceReadback.mismatch_count ?? sourceReadback.readback?.mismatch_count ?? 0,
      output_dir: sourceReadback.output_dir ?? source,
      mode: sourceReadback.mode ?? "readback",
    },
    readback: {
      ok: promotionReadback.ok === true,
      axes: promotionReadback.axes ?? promotionReadback.readback?.axes ?? null,
      mismatch_count:
        promotionReadback.mismatch_count ?? promotionReadback.readback?.mismatch_count ?? 0,
      output_dir: promotionReadback.output_dir ?? destination,
      mode: promotionReadback.mode ?? "readback",
    },
    clean_publish: publishSummary,
  };
  if (options.receipt) {
    const receiptPath = abs(options.receipt);
    mkdirSync(dirname(receiptPath), { recursive: true });
    writeFileSync(receiptPath, `${JSON.stringify(summary, null, 2)}\n`);
  }
  process.stdout.write(
    `promoted ${summary.files_promoted} file(s) from ${options.source} to ${options.destination}; read-back green on state, coverage and content at ${options.destination}\n`,
  );
  if (options.json || options.receipt) process.stdout.write(`${JSON.stringify(summary)}\n`);
  return 0;
}

try {
  process.exit(main());
} catch (error) {
  if (error instanceof Refusal) {
    process.stderr.write(`promote-docs refused: ${error.message}\n`);
    process.stdout.write(`${JSON.stringify({ ok: false, refused: error.message })}\n`);
    process.exit(2);
  }
  process.stderr.write(`promote-docs failed: ${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
}
