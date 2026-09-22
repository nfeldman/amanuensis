# Pecia dogfood: roadmap execution custody

Pecia tracks execution of the living-conspectus roadmap while
`dev/roadmap.json` remains authoritative for initiative definitions, gates,
dependencies, and status. The committed `.pecia/work.jsonl` is Pecia's
materialized projection; `.pecia/snapshot.json` binds its SHA-256 and detector
version to the claimed local-v2 `.pecia/snapshot.head` timeline identity.

## Operating contract

- Each roadmap stage has one Pecia milestone labeled `roadmap:stage-<id>`.
- Each initiative resolves to one *current* Pecia task labeled
  `roadmap:<initiative-id>`. Because Pecia treats closure as final, reopening an
  initiative appends a successor task carrying `discovered_from` rather than
  un-closing the original, so a label may legitimately cover a chain of records.
  The validator resolves the label to that chain's tail — the head no other head
  was discovered from. Two records that independently claim one initiative are
  two tails and still fail; a forked or broken chain fails closed.
- A roadmap dependency `B dependsOn A` is represented by Pecia's directed
  `A blocks B` edge. When an initiative is reopened, its predecessors' `blocks`
  edges are repointed at the successor so the graph describes current work; the
  superseded record keeps its own disposition and evidence unchanged.
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

4. A foreign reference outlives the record that cites it only if the system
   that owns it carries its referent forward. The 2026-09-14 clean-slate
   rebuild of the conspectus destroyed the findings eight closed defects cite,
   and `pecia audit` reported all eight at once — correctly, and with no way to
   answer them from this side. The carry audit below is the answer; the
   obligation it records belongs to Amanuensis, not to Pecia.

These limitations are visible rather than waived. Amanuensis's existing CI,
red gates, and explicit per-milestone commits remain the enforcement substrate.

## Carry audit: the closed references the 2026-09-14 rebuild destroyed

A Pecia defect closes against evidence, and for a defect imported from the
conspectus that evidence is the reference `amanuensis:<finding-id>`, resolved
by `dev/pecia-resolve-finding.mjs`. The 2026-09-14 clean-slate rebuild deleted
the conspectus those ids named. Eight closed records lost the licence for their
closure in one step, and `pecia audit` reported every one of them as
`unresolvable-evidence` — the signal working, not a fault.

The survey-depth acceptance rebuild carries all 22 archived findings forward as
`carried_findings` records (`design/survey-depth/spec.md` §5.8), and the
resolver follows a reference into the carried record and answers with the
outcome recorded against it (§5.7). Each row below names the carried record
that now answers for one closure. Re-running `pecia audit` over the rebuilt
store reports none of the eight: all eight references resolve, each through its
carried record, at exit 0.

All eight were already `verified-fixed` in the archived store, so each carries
the outcome `archived-terminal`: the rebuild inherited a decision rather than
making one, and the closure keeps the licence it was granted. An id that had
been carried undecided would resolve at exit 1 and appear here with no outcome,
which is the state this table exists to make impossible to miss.

| Pecia record | Reference | Subsystem | Archived resolution | Carried record | Outcome |
| --- | --- | --- | --- | --- | --- |
| `pc-1a91` | `amanuensis:B08-1` | B-08 | verified-fixed | `carried_id 22` | `archived-terminal` |
| `pc-207e` | `amanuensis:B03-3` | B-03 | verified-fixed | `carried_id 8` | `archived-terminal` |
| `pc-707e` | `amanuensis:B04-1` | B-04 | verified-fixed | `carried_id 14` | `archived-terminal` |
| `pc-80b8` | `amanuensis:B03-2` | B-03 | verified-fixed | `carried_id 7` | `archived-terminal` |
| `pc-833d` | `amanuensis:B02-1` | B-02 | verified-fixed | `carried_id 2` | `archived-terminal` |
| `pc-adce` | `amanuensis:B03-4` | B-03 | verified-fixed | `carried_id 9` | `archived-terminal` |
| `pc-ae87` | `amanuensis:B03-1` | B-03 | verified-fixed | `carried_id 6` | `archived-terminal` |
| `pc-d688` | `amanuensis:B05-1` | B-05 | verified-fixed | `carried_id 19` | `archived-terminal` |

Regenerate with `node dev/amanuensis-defects-to-pecia.mjs --carry-audit
--markdown`, which reads the store rather than this file. `GATE PA1` —
`dev/test-pecia-carry-audit.mjs`, `design/survey-depth/spec.md` §8.9b — is red
when any of the eight is unaccounted here, when a row names a carried record
the carry did not write, when it names an outcome the carried record
contradicts, or when the closed records the audit reports are no longer these
eight.

### What this accounting does not cover

`pecia audit` enumerates only *closed* records whose reference stopped
resolving. An **open** record pointing at a destroyed finding is reported by
nothing: the audit does not examine it, so it is outside the eight above and
outside the gate that checks them. That gap is candidate finding **B03-R2**,
which the acceptance rebuild carries forward rather than closes — carried
record 11, outcome `successor-finding` into B03-R2 — and it is recorded here
because an accounting that reported the eight without it would read as
coverage of a question it never asked.

## Closed records outside the carry's scope

The table above accounts for references the acceptance rebuild could have destroyed: references to
findings the archive held, each answered by the carried record that inherited it. A closed record
citing a finding filed **after** the rebuild forked, in another checkout's store, was never the
carry's to account for, because no carried record could exist for it. Each such record is named here
with where its reference resolves, so a new record cannot pass the audit simply by being new
(`GATE PA1`, spec §8.9b's closing paragraph; `decisions.md` §7).

- `pc-5465` → `amanuensis:B02-R5`, "a conspectus cannot be read from any working copy other than
  the one it was created in." Filed on `main` on 2026-09-19 after `survey-depth` forked, and repaired
  there at `8cb6a7a` ("Bind a store to its repository's identity, not to the directory it was made
  in"). It resolves in the primary checkout's store, not in the store this branch rebuilt.
