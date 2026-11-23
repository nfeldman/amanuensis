// The code index's git reader (PLAN §4.1, "Reading git").
//
// Trees come from `git ls-tree -r -z --full-tree <rev>`; only modes 100644 and 100755 are
// parsed, and symlinks (120000) and gitlinks (160000) are listed with a skip reason. Blob
// sizes and presence come from one `git cat-file --batch-check` over every candidate, and
// contents from one long-lived `git cat-file --batch` per request (BlobReader), so a
// whole-tree index starts two processes, not one per file. A missing object (a shallow
// clone, pruned history) is `unavailable`, never `gone`.
//
// Text is decoded as UTF-8 with `fatal: true` and the byte-order mark kept, so string
// offsets and the blob's bytes agree; invalid UTF-8 is `not-utf8`. CRLF is kept.
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { DEFAULT_SUBPROCESS_TIMEOUT_MS, spawnSync } from "../subprocess.js";
import { type CodeLanguage, languageForPath } from "./extract.js";

export type SkipReason = "symlink" | "gitlink" | "unsupported-language" | "unavailable";

export interface TreeEntry {
  path: string;
  mode: string;
  type: string;
  blob_sha: string;
  lang: CodeLanguage | null;
  skip_reason: SkipReason | null;
}

const PARSED_MODES = new Set(["100644", "100755"]);
const MAX_LISTING_BYTES = 1024 * 1024 * 1024;

/** A read that waits longer than the subprocess bound kills `cat-file`, as subprocess.ts does. */
function readTimeoutMs(): number {
  const configured = Number(process.env.AMANUENSIS_SUBPROCESS_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_SUBPROCESS_TIMEOUT_MS;
}

const GIT_ENV = { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };

/** A batch reader lives at most this many read timeouts (30 × 120 s by default). */
const READER_LIFETIME_READS = 30;

function runGit(workspace: string, args: string[], input?: string) {
  return spawnSync("git", args, {
    cwd: workspace,
    input,
    env: { ...process.env, ...GIT_ENV },
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: MAX_LISTING_BYTES,
  });
}

/** The full commit sha `rev` names in `workspace`, or null when it names no commit here. */
export function resolveCommit(workspace: string, rev: string): string | null {
  if (rev.startsWith("-")) return null;
  const r = runGit(workspace, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`]);
  if (r.status !== 0) return null;
  const sha = r.stdout.toString("utf8").trim();
  return /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha) ? sha : null;
}

function entry(mode: string, type: string, sha: string, path: string): TreeEntry {
  let skip: SkipReason | null = null;
  const lang = languageForPath(path);
  if (mode === "120000") skip = "symlink";
  else if (mode === "160000") skip = "gitlink";
  else if (!PARSED_MODES.has(mode) || type !== "blob" || lang === null)
    skip = "unsupported-language";
  return { path, mode, type, blob_sha: sha, lang: skip ? null : lang, skip_reason: skip };
}

function parseListing(out: Buffer): TreeEntry[] {
  const entries: TreeEntry[] = [];
  for (const record of out.toString("utf8").split("\0")) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    const [mode, type, sha] = record.slice(0, tab).split(" ");
    if (tab < 0 || !mode || !type || !sha) continue;
    entries.push(entry(mode, type, sha, record.slice(tab + 1)));
  }
  return entries;
}

/** Every entry of the tree at `commit`, or null when git cannot list it. */
export function listTree(workspace: string, commit: string): TreeEntry[] | null {
  const r = runGit(workspace, ["ls-tree", "-r", "-z", "--full-tree", commit]);
  if (r.status !== 0) return null;
  return parseListing(r.stdout);
}

/**
 * The entry at `path` in `commit`'s tree: null when git cannot list the tree, undefined
 * when the path is not a file there.
 */
export function entryAt(
  workspace: string,
  commit: string,
  path: string,
): TreeEntry | null | undefined {
  const r = runGit(workspace, ["ls-tree", "-z", "--full-tree", commit, "--", path]);
  if (r.status !== 0) return null;
  return parseListing(r.stdout).find((e) => e.path === path && e.type !== "tree");
}

/** Each object's size, or null when the object is missing; one `cat-file --batch-check`. */
export function blobSizes(workspace: string, shas: string[]): Map<string, number | null> | null {
  const sizes = new Map<string, number | null>();
  const unique = [...new Set(shas)];
  if (unique.length === 0) return sizes;
  const r = runGit(workspace, ["cat-file", "--batch-check"], `${unique.join("\n")}\n`);
  if (r.status !== 0) return null;
  const lines = r.stdout.toString("utf8").split("\n");
  for (const line of lines) {
    const [sha, type, size] = line.split(" ");
    if (!sha) continue;
    sizes.set(sha, type === "blob" && size !== undefined ? Number(size) : null);
  }
  return sizes;
}

export type Decoded = { status: "ok"; text: string } | { status: "not-utf8" };

/** UTF-8 with `fatal: true`; the byte-order mark is kept so offsets match the bytes. */
export function decodeBlob(bytes: Uint8Array): Decoded {
  try {
    return {
      status: "ok",
      text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
    };
  } catch {
    return { status: "not-utf8" };
  }
}

/**
 * One `git cat-file --batch` for the life of a request. Reads are served in order; a
 * missing object reads as null. Call close() when the request is done.
 */
export class BlobReader {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private waiting: (() => void) | null = null;
  private ended = false;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly workspace: string) {}

  /** The blob's bytes, or null when the object is missing or git failed. */
  read(sha: string): Promise<Buffer | null> {
    const next = this.chain.then(() => this.readOne(sha));
    this.chain = next.catch(() => undefined);
    return next;
  }

  close(): void {
    if (!this.child) return;
    this.child.stdin.end();
    this.child.kill("SIGTERM");
    this.child = null;
  }

  private start(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;
    // Each read carries its own stall timer (readOne). The lifetime timeout is a
    // backstop for a reader its caller never closes, whose git would otherwise
    // live as long as the server; a reader killed by it starts a fresh process
    // on its next read.
    const child = spawn("git", ["cat-file", "--batch"], {
      cwd: this.workspace,
      env: { ...process.env, ...GIT_ENV },
      stdio: ["pipe", "pipe", "pipe"],
      timeout: readTimeoutMs() * READER_LIFETIME_READS,
      killSignal: "SIGKILL",
    });
    // Events from a process this reader has already closed are ignored.
    child.stdout.on("data", (chunk: Buffer) => {
      if (this.child !== child) return;
      this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
      this.wake();
    });
    const end = () => {
      if (this.child !== child) return;
      this.ended = true;
      // A process that ended on its own (lifetime kill, git exit) is not reused.
      this.child = null;
      this.wake();
    };
    child.stdout.on("end", end);
    child.on("error", end);
    child.stdin.on("error", end);
    child.stderr.resume();
    this.child = child;
    this.ended = false;
    this.buffer = Buffer.alloc(0);
    return child;
  }

  private wake(): void {
    const w = this.waiting;
    this.waiting = null;
    w?.();
  }

  private async until(ready: () => boolean): Promise<boolean> {
    while (!ready()) {
      if (this.ended) return false;
      await new Promise<void>((resolve) => {
        this.waiting = resolve;
      });
    }
    return true;
  }

  private async readOne(sha: string): Promise<Buffer | null> {
    if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha)) return null;
    const child = this.start();
    const timer = setTimeout(() => {
      this.ended = true;
      this.close();
      this.wake();
    }, readTimeoutMs());
    try {
      return await this.receive(child, sha);
    } finally {
      clearTimeout(timer);
    }
  }

  private async receive(
    child: ChildProcessWithoutNullStreams,
    sha: string,
  ): Promise<Buffer | null> {
    child.stdin.write(`${sha}\n`);
    if (!(await this.until(() => this.buffer.indexOf(0x0a) >= 0))) {
      this.close();
      return null;
    }
    const nl = this.buffer.indexOf(0x0a);
    const header = this.buffer.subarray(0, nl).toString("utf8");
    this.buffer = this.buffer.subarray(nl + 1);
    const [, type, sizeText] = header.split(" ");
    if (type === "missing" || sizeText === undefined) return null;
    const size = Number(sizeText);
    if (!(await this.until(() => this.buffer.length >= size + 1))) {
      this.close();
      return null;
    }
    const body = Buffer.from(this.buffer.subarray(0, size));
    this.buffer = this.buffer.subarray(size + 1);
    return type === "blob" ? body : null;
  }
}
