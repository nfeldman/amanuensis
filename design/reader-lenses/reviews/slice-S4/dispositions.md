# slice-S4 — fix session dispositions

Run `20260912-052926-fix-slice-S4`. One reviewer (codex), so the `/name` suffix is
omitted. Every finding was reproduced before it was repaired; every repair was
proved by re-applying the reviewer's own sabotage to the sharpened gate and
undoing it.

| F1 | verified: yes | action: fixed | reproduced: swapped From/To in diagrams.py's row f-string, gate exit 0 (GREEN) — both row checks matched on `row.includes(id)`, which is order-blind; rows are now parsed into cells and each recorded field asserted in its own column (topologyCells/endpointId/edgeRowMismatch, test-edge-contract.mjs:757-806), and the multi-edge fixture shares B-02 between its two rows in opposite roles so a row cannot be matched by naming both ids; sabotage re-applied to the sharpened gate → RED "the From column reads \"B-02\", not \"B-01\"", then undone; 9455ad3 |
| F2 | verified: yes | action: fixed | reproduced: `run: echo skipped # node test-edge-contract.mjs`, gate exit 0 with "ok this gate runs in CI" — the check was `ci.includes("node test-edge-contract.mjs")` over the whole file, which a comment satisfies; the workflow is now read as steps (workflowSteps/shellLines) and the gate must be a line a shell executes, from mcp-server, in a step with no `if:` and no continue-on-error, plus a second assertion pinning the push trigger; three sabotages re-applied → RED on the comment, on `working-directory: materializer`, and on `if: false`, all undone; 9455ad3 |
| F3 | verified: yes | action: fixed | reproduced: rewrote the step as "Never record an `add_xref` row…", gate exit 0 — the scan `/\bmust\b|\brecord\b|\bone row\b/i` reads "record" as an obligation in either polarity; the obligation sentence is now pinned verbatim as PHASE_2_OBLIGATION and an imperative prohibition naming the tool is rejected beside it; both sabotages re-applied → RED on the inversion and on an inversion added alongside the intact sentence, both undone; 9455ad3 |
| F4 | verified: yes | action: fixed | reproduced: removed deliverable diagrams.py — exit 1, `GATE P13 RED:` marker present, red_expect `add_xref\|context` matched, red_rejects not matched, and the launcher's gate_crashed also false, because SCRUB rewrote ModuleNotFoundError to "python-module-absent" before either guard could see it (both guards defeated, not one); SCRUB is deleted, a preflight loads dist/ and the materializer before any assertion runs, and any crash signature in the transcript demotes the run to a third verdict INCONCLUSIVE that prints no RED marker; red_expect is now "add_xref recorded an edge whose context" (assertion-specific; the old pattern is contained in the gate's own RED summary line, so it matched whatever the gate did) and red_rejects gains the Python import vocabulary — both checked against the recorded red output at 03a78b5, which still matches red_expect and still does not match red_rejects; both sabotages re-run → INCONCLUSIVE, rejected by the launcher twice over; negative control: a genuine write-path sabotage still reports RED and matches red_expect; c867dc2 |
| F5 | verified: yes | action: fixed | reproduced: seeded P6's fixture xref context with a valid citation — P6 RED "a seam or xref carries a ref_sha it has no column for"; §3.2 binds an item only where its source row carries a revision and `xrefs` has no `ref_sha` column, so locus.ts:907 promoting the first prose citation token was drift, and P6 stayed green only because its fixture edge carried a context §9.2's write path can no longer produce; the item is now served unbound with `citations[]` exposed, P6's fixture carries the citation permanently, and P13's own assertion is realigned to the same rule; red dcd2194 (both gates red), green d6e92ef |

## Notes

- Chosen resolution for F5 is the reviewer's first option — keep xrefs unbound
  while exposing `citations[]` — not a new revision column. §3.2 is explicit
  that the binding follows the *source row*, an edge whose prose cites several
  revisions has no single one to promote, and `citations[]` already carries the
  count a reader needs.
- Regression: all 15 commands of P13 and P6 pass. Every gate of every `done`
  packet passes except P2's `test-finding-partition.mjs`, which is red on the
  same two `resolved-findings.md` link assertions P12's notes already recorded
  as pre-existing at `6628a01`. It imports no locus module and names no file
  this session touched; it is not repaired here and remains open against P2.
- `plan.json`'s P13 notes carried a sentence describing the ref_sha derivation
  F5 overturned; it is corrected in place rather than left to read as current.
- The SCRUB idiom F4 turns on is not unique to this gate: twelve other gate
  files carry a copy. Only P13's is repaired here. Recorded for the final
  review as a systemic finding, since each copy defeats the same two launcher
  guards for its own packet.
- Pre-existing and untouched: `npx biome check test-edge-contract.mjs` reports
  12 findings, the same 12 it reports at `33ff5a5`; the packet's regression
  command is `biome check src/`, which does not cover test files.
