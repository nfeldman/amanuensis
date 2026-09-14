## Claims

| Claim | Verdict | Evidence | Proposed change |
|---|---|---|---|
| C1 | overturned | `decisions.md:10-12` makes History conditional on surviving review. The asserted historical reading is not reconstructible from mutable, unversioned dispositions, seams, vocabulary, and subsystem rows, while `spec.md:247-250` also omits current claims opened before `as_of_sha`. | Apply the binding fallback: remove History as a lens and place resolved records last in Attention. |
| C2 | overturned | `spec.md:484-496` places only selected finding and event records in History; terminal dispositions, revalidation obligations, and claim-validity records are not partitioned, while disposition records remain on Method pages. | Define an exhaustive record-family census and exactly-one Unresolved or resolved-Attention membership predicate. |
| C3 | upheld | | |
| C4 | upheld | | |
| C5 | upheld | | |
| C6 | overturned | `spec.md:146-147` retains `examined` when Git is unavailable, although `dev/adr/0001-living-conspectus-terms.md:30-36` makes current reachability part of what examined standing authorizes. `claims.ts:65-83` also throws rather than returning unchecked reachability. | Report a non-authorizing unchecked state when ancestry cannot be evaluated, or conservatively downgrade to `examined-stale`. |
| C7 | upheld | | |
| C8 | qualified | `schema.sql:177` permits arbitrarily many owner rows per path; the AxiomDB store already has a path with ten owners. An untruncated array therefore has no enforceable compatibility with the hard response ceilings in C18. | Keep owners complete, but specify a deterministic overflow response or bounded external reference when the hard ceiling cannot be met. |
| C9 | overturned | `schema.sql:619-642` includes `deferred`, while `invariants.ts:23-33` explicitly treats deferred as orthogonal to the ranked survey ladder. Therefore a weakest-owner ladder value is undefined for a deferred owner. | Define deferred’s authority explicitly or exclude it from the rank calculation while reporting it separately. |
| C10 | upheld | | |
| C11 | qualified | `scope_gaps` records only unledgered or absent paths (`schema.sql:186-193`). A ledgered locus with no gap row is indistinguishable from one that has undergone a complete reconciliation, so `ledger_reconciled` cannot generally be derived. | Add a durable reconciliation receipt or narrow the field to the exact condition that existing rows prove. |
| C12 | overturned | A read-only AxiomDB join found 1,094 missing subsystem-by-active-concern dispositions, but every active concern code has a disposition somewhere. Nine seams lack an SC disposition on one side, but none lacks SC on both sides. The global predicates in `spec.md:178-190` therefore hide real unknowns. | Enumerate missing owner-by-concern pairs and missing side-specific seam assessments. |
| C13 | overturned | `describe_locus` has no subsystem-context parameter, and an unmatched vocabulary term has no subsystem association. The same-subsystem-first nearest-term tier in `spec.md` therefore cannot be evaluated deterministically. | Add subsystem context or remove that tier and specify a globally deterministic distance and tie-break order. |
| C14 | upheld | | |
| C15 | upheld | | |
| C16 | overturned | The candidate predicate in `spec.md:247-250` includes `valid_from_sha = as_of_sha` or closed intervals, omitting still-current claims opened at an ancestor. Most other account sources are mutable and have no validity intervals at all. | Remove whole-account historical snapshots, or add append-only/versioned sources and use ancestry checks for both interval boundaries. |
| C17 | qualified | Purpose, claim, finding, and narrative fields can contain text authored by a model during the survey; `spec.md:258-264` only establishes that no model call occurs while serving the request. | State “no text generated during this tool call” and identify durable model-authored source fields as such. |
| C18 | overturned | `helpers.ts:43-55` emits pretty JSON in `content` and repeats the object in `structuredContent`. The proposed gates measure only compact payload bytes, so actual MCP responses can exceed the limits by roughly twice the measured size. | Gate the fully serialized MCP response and remove or budget the duplicate representation. |
| C19 | qualified | `decisions.md:10-12` requires resolved records to move into Attention if History is overturned. The default and opt-in section split otherwise survives. | Replace the History-lens pointer with a pointer to Attention’s resolved-record group or an event-detail tool. |
| C20 | overturned | `spec.md:294-304` defines `not-recorded` as absence of a source row, yet every omitted item must have a distinct id in the census and `selected + omitted = census`. ADR-0011 instead names policy, irrelevant, and budget omissions. | Keep absent-data metadata outside the omission ledger and use omission reasons only for known census members. |
| C21 | upheld | | |
| C22 | upheld | | |
| C23 | overturned | `dev/adr/0010-derived-review-surface-and-semantic-readback.md:32-43` already defines `contested` as a challenge state. `spec.md:374-379` disclaims that meaning and reintroduces `contested` for a different union, contradicting `decisions.md:24-25`. | Reuse the ADR-0010 labels and meanings exactly; represent additional source distinctions with fields rather than overloaded labels. |
| C24 | overturned | `field_notes` has creation time and free-text `follow_up` but no resolution event or resolved time (`schema.sql:291-305`); `sessions` has no locus relation (`schema.sql:598-607`). Resolved leads and sessions touching a locus therefore cannot be reconstructed newest-first. | Add append-only lead-resolution events and a session-to-locus relation, or remove those promised history categories. |
| C25 | upheld | | |
| C26 | upheld | | |
| C27 | overturned | Inline legacy fallbacks remain in `renderers.py:443-455`, `tools/findings.ts:399-445`, `review-session.ts:190-225`, and `review.ts:394-418`. P2 does not list the latter three readers as deliverables. | Migrate every reader to `finding_state_current` and add a gate rejecting remaining inline fallback expressions. |
| C28 | overturned | `spec.md:500-502` defines Method through a fixed page list rather than a SQL membership predicate. | Either add a real SQL-backed Method membership source or weaken the claim to deterministic, mechanically checked membership. |
| C29 | upheld | | |
| C30 | upheld | | |
| C31 | qualified | The table referenced by the claim retains a History navigation group, but the binding fallback in `decisions.md:10-12` applies once that lens is overturned. | Preserve useful pages but regroup resolved material under Attention and update `NAV_GROUPS`. |
| C32 | qualified | “First viewport” varies with viewport size, zoom, font metrics, and translated or enlarged text; source order can be guaranteed, but literal viewport inclusion cannot. | Define semantic source order and test representative responsive breakpoints without making an absolute viewport guarantee. |
| C33 | overturned | `subsystems.scope` is described as key files (`schema.sql:630`), and AxiomDB values are path and boundary lists such as `crates/axiomdb-cli/…`, not purpose sentences. | Add a durable purpose field or render the existing value as Scope rather than Purpose. |
| C34 | qualified | `slugs.py:20-23` collapses punctuation and can map distinct paths to the same anchor. Multi-owner paths can also carry different examined revisions, making a singular revision ambiguous. | Use a collision-resistant path-derived anchor and render examined revisions per owner. |
| C35 | overturned | The same read-only store query as C12 found 1,094 missing owner-by-concern pairs and nine partially assessed seams, while the proposed global predicates report zero in both categories. | Count and render missing concern dispositions per subsystem and seam assessments per side, with matching denominators. |
| C36 | upheld | | |
| C37 | overturned | `schema.sql:811-813` requires evidence only for `verified-fixed`. `findings.ts:54-57,149-155` permits accepted resolutions with rationale but no attached evidence, so every resolved record cannot truthfully render “with its proof.” | Require evidence or an explicitly authorized dismissal record for every terminal resolution, and gate the rendered proof link. |
| C38 | upheld | | |
| C39 | qualified | Existing JavaScript also implements theme and mobile-navigation behavior (`html_projection.py:690-708` in the generated shell), so “may do nothing else” is false when applied to the projection as a whole. | Limit the restriction to new reader-lens behavior and preserve the existing shell functions explicitly. |
| C40 | upheld | | |
| C41 | upheld | | |
| C42 | overturned | `spec.md:730-736` requires code-grade evidence only for key type, state, and flow claims; concurrency and seam claims need merely an evidence row. `add_claim` checks nonempty ids, not evidence kind or subject correspondence (`claims.ts:225-269`). | Require and validate code-grade evidence for every listed structural category, including subject and revision correspondence. |
| C43 | overturned | `phase-4-adversarial.md:29-37` challenges confirmed findings and linchpin dispositions but does not review structural claims. P12 does not modify that phase. | Add current structural claims to the adversarial phase and record their challenge outcome before advancing. |
| C44 | upheld | | |
| C45 | qualified | `helpers.ts:97-127` performs only syntactic citation parsing. Direct calls accepted `See src/a.ts:f@NOT_A_SHA because` and `src/a.ts:f@NOT_A_SHA trailing prose`; neither proves a resolvable revision or symbol. | Parse the embedded citation strictly and validate its path, revision, and symbol reachability. |
| C46 | upheld | | |
| C47 | upheld | | |
| C48 | overturned | SQL CHECK enums remain independent literals throughout `schema.sql`, while P1 generates only TypeScript and Python vocabulary files and touches only three tool validators. `check-evidence-vocabulary.mjs:17-63` currently compares only a small subset. | Include schema constraints and every enforcing validator in generation or exhaustive parity checks, with deliberate divergence tests for each surface. |
| C49 | qualified | The proposed word-boundary lint rejects legitimate prose such as “memory-mapped” and can reject a thesis that accurately discusses a stale cache. | Match survey-status assertions contextually or provide a narrowly reviewed allowlist. |
| C50 | upheld | | |
| C51 | upheld | | |
| C52 | qualified | The skill authorizes snapshot and deletion, but the MCP server holds an open SQLite connection and exposes no whole-store reinitialization operation. Deleting the file without a process boundary risks continuing against the old handle. | Specify and test snapshot, server shutdown, deletion, initialization, restart, and read-back as distinct steps. |
| C53 | overturned | `materialize.ts:224-260` resolves publication through project storage; `project.ts:1003-1012` confines relative output beneath `.amanuensis`. Thus `materialize_docs` writes `.amanuensis/docs`, while the tracked target is root `docs/`; P16 has no promotion step. | Add an explicit verified export to root `docs/` and re-read that canonical path before committing. |
| C54 | upheld | | |
| C55 | overturned | Every named gate file is absent in the baseline. Running `cd mcp-server && node test-locus-compactness.mjs` fails with `MODULE_NOT_FOUND`, not the intended compactness assertion. `plan.json` also records no semantic red witness or false-green arm. | Require each test to be installed and observed failing on its intended assertion before implementation, with a sabotage or red-case receipt. |

## Plan defects

| Id | Severity | Location | Evidence | Proposed change |
|---|---|---|---|---|
| D1 | high | P5, P8, P9 | The global unknown/not-yet predicates yield zero concern codes and zero seams on the current store despite 1,094 missing subsystem-concern pairs and nine one-sided seam gaps. | Test partial coverage fixtures and use owner-pair and seam-side predicates. |
| D2 | high | P14 | The proposed `as_of_sha` SQL omits open claims created at ancestors, and P14 adds no version history for mutable account sources. | Narrow history to append-only event tables or add validity histories before promising historical accounts. |
| D3 | high | P7, P14 | Compactness gates measure payloads, while `jsonResult` duplicates them as pretty text and structured content. Optional sections and both additional tools lack full wire-size coverage. | Measure serialized MCP responses for every default and expanded mode and eliminate duplicate payload cost. |
| D4 | high | P1 | Deliverables omit `schema.sql` and most enforcing tool files, so the claimed single enum source can remain divergent while its gate passes. | Generate or compare SQL constraints and every server/materializer validator. |
| D5 | high | P10 | Acceptance checks static ARIA attributes, external hosts, and a no-script anchor, but not Arrow keys, Enter, Escape, focus restoration, state updates, announcements, or native filter operation. | Add browser-driven keyboard and accessibility tests plus a complete no-JavaScript traversal. |
| D6 | high | P12 | The gate requires only one prefix-matching claim; it does not enforce the five promised categories, code-grade evidence, or later adversarial review. | Add evidence-kind and subject checks, category coverage receipts, and a Phase 4 claim-review deliverable. |
| D7 | medium | P13 | P12 and P13 both edit `phase-2-structural.md`, but P13 depends only on P6 and P8. | Add P12 as a dependency and gate the combined document contract. |
| D8 | high | P15 | `mcp-server/src/installer.ts` does not exist; installer behavior lives in `src/cli.ts`. Installer opt-in is also absent from the reviewed normative claims, and a one-call model-routing harness is underspecified. | Remove the extra installer scope or add a binding claim and target `cli.ts`; separate static instruction checks from a reproducible behavioral evaluation. |
| D9 | high | P16 | One 150-minute packet combines destructive reinitialization, restart, a full survey of eight subsystems and 513 tracked files, publication, read-back, and commit. | Split snapshot/restart, onboarding, bounded survey batches, publication, and dogfood verification into checkpointed packets. |
| D10 | high | P16 | The materializer writes beneath `.amanuensis`, but acceptance requires root `docs/` to byte-match a receipt; no export or canonical-path read-back is delivered. | Add a safe promotion step and verify root `docs/` bytes after promotion. |
| D11 | high | all packets | All sixteen gate paths are absent, so their commands are red only because the test modules do not exist. The JSON does not encode the intended red condition or false-green exclusion. | Make semantic preimplementation red evidence and a red-case arm mandatory packet artifacts. |
| D12 | medium | P5, P6 | Gates omit Git-unavailable behavior, deferred-owner authority, historical intervals, origin disagreement, `ledger_reconciled`, and zero-denominator measured fields. | Add fixtures and assertions for every standing and read-back axis. |
| D13 | high | P14 | P14 promises resolved leads and sessions touching a locus but supplies no schema deliverable for lead-resolution events or session-locus relations. | Add the required append-only schema and migration, or remove those response categories. |
| D14 | medium | P8, P10 | “Stable anchor” tests do not include colliding path slugs or multi-owner revision differences. | Seed slug collisions, require collision-resistant anchors, and verify every owner-specific destination. |
| D15 | medium | P6 | The generated inventory currently reports 196 tools across 41 groups, while `spec.md:326-327` states a 195-tool baseline. Adding three tools therefore produces 199, not 198. | Derive expected counts from the generated inventory and correct the specification baseline. |
| D16 | high | P2, P9 | P2 tests finding partition only, although C2 covers every resolution, obligation, and terminal disposition family. | Add an exhaustive cross-family census and exactly-one lens-membership gate. |
| D17 | high | P7 | Its required `not-recorded` omission reason has no source-row id that can participate in the required census equality. | Separate missing-data declarations from omissions and use only reasons applicable to known items. |
| D18 | high | P2 | Deliverables omit several finding readers that retain legacy inline fallback logic. | Include `tools/findings.ts`, review-session, and review readers, with a static regression check for duplicate fallback expressions. |
| D19 | medium | P9 | Page tests require proof presentation but do not make proof structurally mandatory for accepted or ruled-out terminal records. | Seed proofless terminal resolutions and require the gate to reject or explicitly label authorized dismissal evidence. |

## Notes

The AxiomDB store was opened read-only; no backfill was assumed.
`gen-tool-inventory.mjs --check` passed and reported 196 tools across 41 groups.
The landing review used practice catalog 2.13, stamp `3ffe3ba1f9e1`.
No repository files were modified.