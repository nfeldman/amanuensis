// Shared provenance resolution for the S6 rebuild receipts.
//
// Every receipt binds itself to revisions: its own `repository_sha`, the
// store's `last_checked_sha`, and the `ref_sha` of every claim, evidence row
// and edge citation. A gate that only pattern-matches those for forty hex
// digits accepts forty zeroes, which is what slice-S6's independent review
// demonstrated (F1/F2: P16 stayed green with a zeroed `repository_sha`, and
// P17, P19 and P18 stayed green in a depth-one clone).
//
// The three states this module distinguishes, and why the middle one is not a
// pass:
//
//   resolved      — every revision resolves and is an ancestor of HEAD.
//   not evaluable — the checkout cannot answer ancestry (a shallow clone).
//                   The old code emitted a note and returned success, so the
//                   `mcp-server` CI job — which checked out at depth 1 — never
//                   evaluated the check at all: a zero-denominator green of
//                   exactly the kind these gates exist to refuse (VP4). It is
//                   now RED, naming `fetch-depth: 0` as the fix. CI supplies
//                   full history, so the honest outcome there is `resolved`.
//   absent        — the history is complete and the revision still does not
//                   resolve, or is not an ancestor of HEAD. RED.
//
// A history-truncated copy that is not *flagged* shallow (a `git archive` plus
// a fresh `git init`, which is how the review's snapshot behaved) lands in
// `absent`, and that is deliberate: nothing distinguishes a discarded history
// from a fabricated revision, so the gate refuses to certify provenance it
// cannot see rather than guessing which it is looking at.
import { spawnSync } from "node:child_process";

const FULL_HISTORY_HINT =
  "check out with full history (`fetch-depth: 0` in CI, a non-shallow clone locally)";

function run(repo, args) {
  return spawnSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** True when this checkout can answer reachability over the whole history. */
export function historyIsComplete(repo) {
  return run(repo, ["rev-parse", "--is-shallow-repository"]).stdout?.trim() === "false";
}

/**
 * Resolve every revision in `shas` against `repo` and require each to be an
 * ancestor of HEAD. Returns an error string, or null when all of them hold.
 *
 * `label` names what cited them, so the red output says which receipt field
 * failed rather than only which revision.
 */
export function resolveRevisions(repo, shas, label) {
  const wanted = [...new Set([...shas].filter((sha) => typeof sha === "string" && sha))];
  if (!wanted.length) return `${label}: no revision to resolve, so nothing binds it to the code`;
  if (!historyIsComplete(repo)) {
    return (
      `${label}: revision ancestry is not evaluable in a shallow clone, so ` +
      `${wanted.length} revision(s) go unchecked — ${FULL_HISTORY_HINT}`
    );
  }
  const head = run(repo, ["rev-parse", "HEAD"]).stdout?.trim();
  if (!head) return `${label}: this checkout has no HEAD to measure ancestry against`;
  const unresolved = [];
  const unreachable = [];
  for (const sha of wanted) {
    if (run(repo, ["cat-file", "-e", `${sha}^{commit}`]).status !== 0) {
      unresolved.push(sha);
      continue;
    }
    if (run(repo, ["merge-base", "--is-ancestor", sha, head]).status !== 0) unreachable.push(sha);
  }
  if (unresolved.length) {
    return `${label}: revision(s) ${unresolved.join(", ")} do not resolve in this repository`;
  }
  if (unreachable.length) {
    return (
      `${label}: revision(s) ${unreachable.join(", ")} are not ancestors of HEAD, ` +
      "so what they cite is not on this branch"
    );
  }
  return null;
}
