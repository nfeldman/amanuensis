# Pecia dogfood: roadmap execution custody

Pecia tracks execution of the living-conspectus roadmap while
`dev/roadmap.json` remains authoritative for initiative definitions, gates,
dependencies, and status. The committed `.pecia/work.jsonl` is Pecia's
materialized projection; `.pecia/snapshot.json` binds its SHA-256 and detector
version to the claimed local-v2 `.pecia/snapshot.head` timeline identity.

## Operating contract

- Each roadmap stage has one Pecia milestone labeled `roadmap:stage-<id>`.
- Each initiative has one Pecia task labeled `roadmap:<initiative-id>`.
- A roadmap dependency `B dependsOn A` is represented by Pecia's directed
  `A blocks B` edge.
- `node dev/test-pecia-roadmap.mjs` rejects missing, duplicate, extra, or
  status/dependency-divergent custody records.
- Completion still requires the roadmap's tests and red gate. Pecia's clean
  structural check means well-formed, never true.
- A stage is terminal only when every child task is terminal and the stage has
  non-unknown evidence. The validator derives that correspondence rather than
  trusting the stage label.
- A green initiative is closed in Pecia with executable evidence and committed
  with its roadmap status transition. The next dependency-ready item is then
  claimed before implementation continues.

The adoption used Pecia at commit `afcb8d3e81391499f4cc1a79f6724b2dc90f29c8`
with owner identity `openai:codex-gpt-5`.

## Dogfood findings

1. `pecia init` implements the v2 single-timeline model by removing the old
   `merge=union` attribute, but its help text and `pecia doctor` still require
   that attribute (`D006`). Re-running the suggested fix cannot clear the
   warning because `init` removes it again.
2. An adopting repository receives no portable hard-gate installation. With no
   hook shipped by Amanuensis, `pecia doctor` reports no hook error; Pecia's own
   current hook assumes repository-local `pecia_cli.py` and `claims.yaml`.
   Until distribution and the v2 staged-state contract are resolved, Pecia is
   an execution-custody scheduler here, not Amanuensis's commit gate.
3. The authoritative v2 timeline lives in Git's common directory and is not a
   normal branch artifact. This branch commits a projection, its digest, and the
   claimed timeline head; another clone must reconstruct or sync the timeline
   before writing. The manifest is explicitly `projection-only`, and the
   correspondence test deliberately does not claim machine-local timeline
   authority.

These limitations are visible rather than waived. Amanuensis's existing CI,
red gates, and explicit per-milestone commits remain the enforcement substrate.
