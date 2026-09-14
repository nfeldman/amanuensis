#!/usr/bin/env node
// Write `design/reader-lenses/dogfood-receipt.json` from the live
// self-conspectus store and the promotion that has just run (reader-lenses P18,
// spec.md §12.2, §12.4).
//
// `git ls-files .amanuensis` returns 0. The store is untracked, so the three
// assertions §12.4 makes are about calls that happened in one worktree at one
// revision and can be asserted over nowhere else. This makes those calls once,
// writes down exactly what came back, and `dev/test-reader-lenses-dogfood.mjs`
// re-derives every property from the record rather than trusting a summary.
//
// The responses are taken over the wire from a spawned server process, not from
// imported handlers: §12.4's subject is what a consumer receives — the payload
// the host parses out of the tool result — and a handler called in-process is a
// different object from the one the budget is measured on. `describe_locus` is
// called with `sections` named, because §4.1's budget is measured on the
// doubled envelope and a default call on a file this well recorded serves zero
// items; the sections asked for are recorded beside each response so a reader
// can see what the budget was raised to.
//
// Everything else is derived and not accepted: `finding_state_current` is read
// from the view, the evidence citations behind each served structural claim are
// read from `claim_evidence` joined to `evidence` — `buildStructure` admits a
// claim on its subject id OR its key prefix OR its cited evidence, so "whose
// evidence cites that file" is a property of the store, not of the served item —
// and the publication block is the promotion receipt `dev/promote-docs.mjs`
// wrote at the moment it verified the promoted tree.
//
//   node dev/record-dogfood-receipt.mjs --promotion <promotion.json>

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STORAGE = join(REPO, ".amanuensis");
const DB_PATH = join(STORAGE, "memory.db");
const SERVER = join(REPO, "mcp-server", "dist", "index.js");
const OUT_REL = "design/reader-lenses/dogfood-receipt.json";

const CONTRACT = "amanuensis-reader-lenses/dogfood-receipt/v1";

// §12.4 assertion 1's three files, one per language surface the repository has.
const DOGFOOD_LOCI = [
  "mcp-server/src/index.ts",
  "mcp-server/src/tools/findings.ts",
  "materializer/amanuensis_materializer/core.py",
];

// The three optional sections. Asking for them raises the wire budget from 8192
// to 20480 (`WIRE_BUDGET + 4096 × optional-sections-requested`), which is what
// leaves room for the account itself; `structure` is a default section and does
// not raise it.
const LOCUS_SECTIONS = ["structure", "reviews", "leads", "history_pointer"];

function parseArgs(argv) {
  const options = { promotion: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--promotion") {
      options.promotion = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`unknown argument ${flag}`);
    }
  }
  if (!options.promotion) throw new Error("--promotion <promotion-receipt.json> is required");
  return options;
}

function abs(pathish) {
  return isAbsolute(pathish) ? resolve(pathish) : resolve(REPO, pathish);
}

function client() {
  const child = spawn(process.execPath, [SERVER, "--workspace", REPO, "--allow-workspace-pin"], {
    cwd: REPO,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  let stderr = "";
  let nextId = 1;
  const pending = new Map();
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  child.on("exit", () => {
    for (const [id, waiter] of pending) {
      pending.delete(id);
      waiter.reject(new Error(`the server exited; stderr=${stderr.slice(-400)}`));
    }
  });
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        const message = JSON.parse(line);
        const waiter = pending.get(message.id);
        if (waiter) {
          pending.delete(message.id);
          if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
          else waiter.resolve(message.result);
        }
      }
      newline = buffer.indexOf("\n");
    }
  });
  const request = (method, params = {}) => {
    const id = nextId++;
    const response = new Promise((res, rej) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rej(new Error(`timed out waiting for ${method}; stderr=${stderr.slice(-400)}`));
      }, 60_000);
      pending.set(id, {
        resolve(value) {
          clearTimeout(timer);
          res(value);
        },
        reject(error) {
          clearTimeout(timer);
          rej(error);
        },
      });
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return response;
  };
  return {
    async handshake() {
      await request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "p18-dogfood-receipt", version: "1" },
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    },
    async call(name, args = {}) {
      const result = await request("tools/call", { name, arguments: args });
      if (result.isError === true) {
        throw new Error(`${name} returned an error: ${result.content?.[0]?.text ?? "(no text)"}`);
      }
      const text = result.content?.[0]?.text ?? "null";
      return {
        payload: JSON.parse(text),
        wire_bytes: Buffer.byteLength(JSON.stringify(result), "utf8"),
      };
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      await new Promise((res) => child.once("exit", res));
    },
  };
}

const options = parseArgs(process.argv.slice(2));

if (!existsSync(DB_PATH)) {
  process.stderr.write(`no store at ${DB_PATH}: the dogfood run has no conspectus to read\n`);
  process.exit(1);
}
if (!existsSync(SERVER)) {
  process.stderr.write(`no built server at ${SERVER}: run 'npm run build' in mcp-server/ first\n`);
  process.exit(1);
}

const promotion = JSON.parse(readFileSync(abs(options.promotion), "utf8"));
if (promotion.ok !== true) {
  process.stderr.write("the promotion receipt is not green; there is nothing to record\n");
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
const all = (sql, ...params) => db.prepare(sql).all(...params);

const gitState = all("SELECT last_checked_sha, canonical_branch, onboarding_sha FROM git_state")[0];
const findingState = all(
  "SELECT finding_id, resolution_state FROM finding_state_current ORDER BY finding_id",
);
const citationsFor = db.prepare(
  `SELECT DISTINCT e.file_path
     FROM claim_evidence ce JOIN evidence e ON e.id = ce.evidence_id
    WHERE ce.claim_id = ? AND e.file_path IS NOT NULL
    ORDER BY e.file_path`,
);

const server = client();
await server.handshake();

const loci = [];
for (const locus of DOGFOOD_LOCI) {
  const { payload, wire_bytes } = await server.call("describe_locus", {
    locus,
    kind: "file",
    sections: LOCUS_SECTIONS,
  });
  const citations = {};
  for (const item of payload?.sections?.structure?.items ?? []) {
    const claimId = String(item?.claim_id ?? "");
    if (!claimId) continue;
    citations[claimId] = citationsFor.all(claimId).map((row) => row.file_path);
  }
  loci.push({
    locus,
    kind: "file",
    sections_requested: LOCUS_SECTIONS,
    wire_bytes,
    response: payload,
    evidence_citations: citations,
  });
}

const attention = await server.call("get_attention", {});
await server.stop();
db.close();

function headSha() {
  const run = spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" });
  return run.status === 0 ? run.stdout.trim() : null;
}

const publishSummary = promotion.clean_publish ?? null;
const receipt = {
  contract: CONTRACT,
  packet: "P18",
  recorded_at: new Date().toISOString(),
  repository_sha: headSha(),
  workspace_path: REPO,
  storage_path: STORAGE,
  produced_by: "dev/record-dogfood-receipt.mjs",
  store: {
    last_checked_sha: gitState?.last_checked_sha ?? null,
    canonical_branch: gitState?.canonical_branch ?? null,
    onboarding_sha: gitState?.onboarding_sha ?? null,
  },
  loci,
  attention: {
    arguments: {},
    wire_bytes: attention.wire_bytes,
    response: attention.payload,
  },
  finding_state_current: findingState,
  publication: {
    clean_publish: {
      mode: publishSummary?.mode ?? null,
      ok: publishSummary?.ok === true,
      published: publishSummary?.published === true,
      output_dir: publishSummary?.output_dir ?? null,
      axes: publishSummary?.readback?.axes ?? publishSummary?.axes ?? null,
      mismatch_count:
        publishSummary?.readback?.mismatch_count ?? publishSummary?.mismatch_count ?? null,
      projection_run_id: publishSummary?.projection_run_id ?? null,
      pages_rendered: publishSummary?.pages_rendered ?? null,
      html_pages_rendered: publishSummary?.html_pages_rendered ?? null,
      summary: publishSummary,
    },
    source_artifacts: promotion.source_artifacts,
    promotion: {
      promoted_at: promotion.promoted_at,
      source: promotion.source,
      destination: promotion.destination,
      storage: promotion.storage,
      files_promoted: promotion.files_promoted,
      source_readback: promotion.source_readback,
      readback: promotion.readback,
    },
  },
};

writeFileSync(join(REPO, OUT_REL), `${JSON.stringify(receipt, null, 2)}\n`);
process.stdout.write(
  `wrote ${OUT_REL}: ${loci.length} describe_locus response(s), ${findingState.length} finding_state_current row(s), ${promotion.files_promoted} promoted file(s)\n`,
);
