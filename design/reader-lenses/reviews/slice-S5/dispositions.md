# slice-S5 — dispositions

Run `20260912-070158-fix-slice-S5`. One reviewer (codex), nine findings, all nine
reproduced against the reviewed tree and repaired. Red proof `31225b2`; repair `8f38a5f`;
the sharpened budget assertion `bcf9553`.

Every red was taken on the reviewed tree before any repair: the nine assertions below were
added first and `mcp-server/test-attention-history.mjs` reported eight failures and
`mcp-server/test-consumer-route.mjs` one. No assertion or gate was weakened. Two standing
assertions were realigned to the widened fixture — the resolutions census from six events to
ten, and the undiscriminated label read off a section-scoped call rather than off whichever
of seven sections won the byte budget — and both still assert what they asserted before.

| F1/codex | verified: yes | action: fixed | reproduced: `get_history({locus: "a".repeat(5000)})` served 24050 bytes with `within_budget=false` against an 8192-byte budget, and `get_attention({scope: …})` 24986 against 12288; both rode the 32768-byte ceiling that belongs to `describe_locus`'s expanded budget. Bounded `locus`, `finding_id`, `scope` and `as_of_sha` at 512 bytes in `locus.ts:boundedSubject` and in each advertised schema, and made the round-robin ceiling `2 ×` the tool's own budget (`locus.ts:2073`). Measured: each subject byte costs four on the wire (two echoes, doubled envelope), so the floor moves 3792 → 5784 at the bound, inside 8192. Sabotage re-run after the fix — `MAX_SUBJECT_LENGTH` raised to 5000, rebuilt — turns the gate red ("refuses a subject of the length it advertises … 23752 bytes"), and was undone. red 31225b2, green 8f38a5f, sharpened bcf9553 |
| F2/codex | verified: yes | action: fixed | reproduced: on the seeded store `get_attention({scope: "B-01"})` returned `leads` census 0 while the project call served note 1, whose `location` is `src/ingest.ts` and whose owner in `file_ledger` is B-01; `locationInScope` matched a token only against the subsystem id or the path prefix, and a subsystem scope carries no prefix. Added `scopeOwnedPaths` and a third token test against the paths the scope's subsystems own. The fence still holds: the B-02 scope does not reach note 1. red 31225b2, green 8f38a5f |
| F3/codex | verified: yes | action: fixed | reproduced: `buildHotSpots` gated the column on `SELECT COUNT(*) FROM access_log` and then compared `access_log.entry_id` with a subsystem id. Seeded two `access_log` rows against entry `E-01`, which `entries` assigns to B-01, plus one naming an undefined entry: the column appeared and read 0 for every row — the column of zeros §7.6 exists to omit. Now joined `access_log → entries` on `(id, tier)`, grouped by `entries.subsystem_id`, with the joined result as the column's gate. B-01 reads 2, B-02 reads 0, the orphan row reaches nothing. red 31225b2, green 8f38a5f |
| F4/codex | verified: yes | action: fixed | reproduced: `get_history({finding_id: "B01-4"})` served subsystem questions 3 and 2 as that finding's history, because `buildQuestionHistory` reads `subject.owners`, which a finding subject fills with its subsystem id. `schema.sql:4617-4640` gives `open_questions` a nullable `subsystem_id` and no finding binding of any kind, so a finding subject now serves none and states why; the locus route is unchanged. red 31225b2, green 8f38a5f |
| F5/codex | verified: yes | action: fixed | reproduced: the fixture stores `answer = 'yes'` for question 2 and the serialized item carried `answer: undefined` — the SQL selected the column and the mapper dropped it. The item now carries `answer` (a string only where the resolution is `answered`, `null` otherwise), and `contracts/locus-history.schema.json` requires it under `if resolution == "answered"`. red 31225b2, green 8f38a5f |
| F6/codex | verified: yes | action: fixed | reproduced: `get_history`'s advertised `inputSchema` carried neither `required` nor `oneOf`, so `{}` and `{locus, finding_id}` were both schema-valid while the handler refused both. Encoded as two `oneOf` branches, each requiring one subject and forbidding the other with `not: {}`. Each branch also declares the property it requires: the MCP SDK compiles the schema under Ajv `strictRequired`, which rejects a branch that requires an undeclared property — the first attempt broke the initialize handshake and the P15 gate caught it. red 31225b2, green 8f38a5f |
| F7/codex | verified: yes | action: fixed | reproduced: `references/notes.md:94` opened "What does X mean here?" at `lookup_term` and stopped at the gloss, two sections after the same file fixes the one-locus route at `describe_locus` and the three-part answer shape — and a term is one of §3.1's four locus kinds. Rewritten to start at `describe_locus(locus=X, kind="term")`, answer in the same three parts, and keep `lookup_term` for the raw definition row or the offer to expand. `test-consumer-route.mjs` now reads every worked one-locus sequence, not just the file one. red 31225b2, green 8f38a5f |
| F8/codex | verified: yes | action: fixed | reproduced: `buildHotSpots` selected `seam_id, party_a, party_b` and tested only whether each party holds an `SC-%` disposition. Spec §2.4.6 (spec.md:281) counts a side unassessed on either ground. Seeded seam `SM-01` whose two parties both hold an `SC-1` disposition while `seam_assessability.assessable` is 0 (neither subsystem is `mapped`): the row read `0/2` where the spec requires `2/2`. Now selects `assessable` and counts a side when it is 0 *or* the party holds no `SC-%` disposition. red 31225b2, green 8f38a5f |
| F9/codex | verified: yes | action: fixed | reproduced: seeded contradiction 3, unresolved, between B01-5 and B01-6, both `verified-fixed`. The project call held it; `get_attention({scope: "B-01"})` did not, because `buildUndiscriminated` filtered against `attentionFindings`, which selects `open` and `fixed-pending-verification` alone. Split `findingsInScope(db, scope, states | null)` out of `attentionFindings` and scoped contradictions over every finding the scope reaches at any state — whether two accounts still stand is not a question about either finding's own state. The fence holds: the B-02 scope does not reach it. red 31225b2, green 8f38a5f |

## Regressions run

All 14 distinct regression commands of P14 and P15 pass, plus the locus-family gates
`test-locus-standing.mjs`, `test-locus-compactness.mjs`, `test-vocabulary-source.mjs` and
`test-structural-claims.mjs`. `npx biome check src/` needed a format pass over the new code
and passes.

One failure outside this slice, not introduced here: `mcp-server/test-finding-partition.mjs`
(GATE P2, slice S1) fails two assertions about subsystem pages linking to
`resolved-findings.md`. It reads `dist/tools/findings.js` and the HTML projection; this
slice's diff touches `src/tools/locus.ts`, `contracts/locus-history.schema.json` and
`references/notes.md` only. The last commit to touch that gate is `f5ff94e red(fix-F3)`,
from an earlier fix session, with no green after it.

## Behaviour the repairs changed, for the packet record

- **P14.** The round-robin engine's residue is now bounded at twice the tool's own budget
  rather than at `describe_locus`'s 32768-byte ceiling; past it the call is refused with the
  remedy named. The residue declaration (`within_budget: false`) is kept, because
  `get_attention` echoes its full subsystem list untruncatably and a large store can reach
  it honestly — what it may not do is drift to three times the number the trace advertises.
  The factor of two is headroom over one measurement, not a number the record has earned:
  the floor measures 3792 bytes for `get_history` against 8192 and 4724 for `get_attention`
  against 12288 on this packet's gate fixture, and no larger store was available to this
  session to measure (`~/.amanuensis/workspaces` holds no conspectus for this project). If a
  real store ever reaches the ceiling, the factor should be re-measured, not raised.
- **P14.** `get_history(finding_id=…)` serves an empty `questions` section. This is a
  narrowing: the store binds a question to a subsystem and to nothing else.
- **P6/P14.** Every locus-tool subject is bounded at 512 bytes, enforced in code and
  advertised as `maxLength`. The longest path this repository tracks is 111 bytes.

## Sibling call sites checked while repairing F3 and F8

A repair scoped to the symbol a finding names leaves the same defect alive next door, so
both families were swept across the tree.

- **F8 — clean.** `src/standing.ts:666` and `:965` are the other two readers of
  `seam_assessability`. Both already select `assessable` and both already treat a side as
  unassessed when the seam is not assessable *or* the party holds no `SC-%` disposition
  (`standing.ts:687`). `hot_spots` was the single outlier; nothing else needed changing.
- **F3 — one sibling found, deliberately not repaired here.**
  `src/tools/stale.ts:37` joins `LEFT JOIN hot_subsystems h ON h.entry_id = fl.subsystem_id`,
  comparing an entry id against a subsystem id exactly as `buildHotSpots` did.
  `hot_subsystems` groups `access_log` by `entry_id`, so the join matches nothing, `heat` and
  `access_count` are always 0, and `get_stale_backlog`'s documented `ORDER BY heat DESC`
  silently degenerates to `subsystem_id, file_path`. The correct join runs through
  `entries.subsystem_id`, as `buildHotSpots` now does. Related: `get_hot_subsystems`
  (`src/tools/dashboard.ts:5`) is described as returning "the most-accessed subsystems" and
  returns entry ids.

  Left alone because `stale.ts` is no packet's deliverable in this branch, the change alters
  a shipped tool's result ordering, and no gate in slice-S5 covers it. It is an owner call
  and a packet of its own, not a fix session's to slip in unreviewed. `action: recorded`,
  outside the nine findings.
