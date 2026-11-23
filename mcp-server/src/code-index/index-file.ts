// Index one file at a revision into the code-index sidecar, in a process of its own.
//
//   node dist/code-index/index-file.js <storage-path> <workspace> <commit> <path>
//
// `add_evidence` resolves a symbol synchronously (semantic-index PLAN §4.4), because callers
// run it inside their own transactions, but parsing loads the grammars asynchronously. When
// the blob it needs is not in the sidecar yet, it runs this script and waits; the sidecar is
// built for several processes (§4.1), so the caller then reads the rows this one published.
// Exit 0 when the file's blob is indexed, 1 when it is not, 2 on a usage error.
import { openCodeIndex } from "./store.js";

const [storagePath, workspace, commit, path] = process.argv.slice(2);
if (!storagePath || !workspace || !commit || !path) {
  process.stderr.write("usage: index-file.js <storage-path> <workspace> <commit> <path>\n");
  process.exit(2);
}
const index = openCodeIndex(storagePath);
if (!index) process.exit(1);
try {
  const result = await index.indexFile(workspace, commit, path);
  process.exitCode = result.state === "ok" ? 0 : 1;
} finally {
  index.close();
}
