# **B-04** — Reader lenses: standing, locus account, claims, edges, vocabulary

**Status**: 🟢 mapped  
**Layer**: api

## Scope

No purpose statement is recorded for this subsystem; the scope below states what it covers.

mcp-server/src/standing.ts, vocabulary.ts, tools/locus.ts, tools/claims.ts, tools/xrefs.ts, tools/vocabulary.ts, contracts/locus-account.schema.json, contracts/locus-history.schema.json, contracts/attention.schema.json, contracts/conspectus-vocabulary.json

## Start here

contracts/conspectus-vocabulary.json for the single enum source, then src/standing.ts for the state predicate, then tools/locus.ts (3607 lines) for describe_locus / get_attention / get_history.

## Structure

What the survey recorded as claims about this subsystem, grouped by what each one states. Every claim is bound to the revision it was asserted at and to the evidence attached to it; a superseded claim is not shown here.

### Key types

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-04/key-type/mcp-server-src-standing-ts-standingstate` | `mcp-server/src/standing.ts:StandingState` | Standing is a seven-value closed enum — unledgered, excluded, scoped-unread, examined, examined-stale, absent, mixed — with a separately declared total order, STANDING_AUTHORITY_ORDER, running weakest first: unledgered, excluded, absent, scoped-unread, then the two readings, dated before current. The ordering exists because `mixed` authorizes only what its weakest owner authorizes and the specification ranks nothing; the gap is filled in code and the comment says so rather than leaving each caller to guess. `deferred` is deliberately given no rank, because the status ladder does not rank it either. | Observation | `7c1c1a9f5689` |

### State containers

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-04/state-container/mcp-server-src-tools-claims-ts-requirefileanchoredevidence` | `mcp-server/src/tools/claims.ts:requireFileAnchoredEvidence` | add_claim carries exactly the two subtractive checks the specification names, and no more. subject_type is validated against the CLAIM_SUBJECT_TYPES enum from the vocabulary source. A claim whose claim_key matches the file-anchored category pattern is refused unless a single evidence row is both a strong kind (code-verified or contract-stated) and cites the file named in subject_id — two rows each satisfying one half do not satisfy it together, and the error names the kinds it found. What the pattern does not reach is the slug portion of the key: it stops at the category and its trailing slash. | Observation | `7c1c1a9f5689` |

### Flow steps

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-04/flow/bounded-response/01` | `mcp-server/src/tools/locus.ts:describeLocus` | describe_locus bounds its response against the whole emitted wire envelope — the text block plus the structuredContent that duplicates it — and the bound is WIRE_BUDGET (8192) plus WIRE_BUDGET_PER_OPTIONAL_SECTION (4096) for each optional section the caller requests. The allowance therefore scales with how much extra the caller asks for, while the fixed cost does not: the scaffolding for a locus with nothing recorded already measures 6860 wire bytes, so a default call on any ledgered locus exhausts 8192 before a single item and serves items: [] in all eight sections, while the same call naming three optional sections is bounded at 20480 and serves the account in full. Truncation is ordered and every omission is declared with an exact count, so the emptiness is always reported rather than hidden. | Observation | `7c1c1a9f5689` |

### Concurrency invariants

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-04/concurrency` | `B-04` | This subsystem has no concurrency of its own to describe, and records that rather than omitting the category. Its three reader tools are pure reads over the shared handle: the trace on every response reports model_calls: 0, no handler here spawns a worker or holds a lock, and the only writers in scope — add_claim, add_xref, record_claim_challenge — are ordinary synchronous handlers under [B-02](b02-server-core-repository-binding-storage-schema-lifecycle.md)'s single-writer model. The one ordering assumption it makes is temporal rather than concurrent: a claim's evidence must exist before the claim, and a closed claim must stop appearing as current on every reader surface. | Inference | `7c1c1a9f5689` |

### Seam contracts

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-04/seam/S-05` | `S-05` | From this side, the contract across [S-05](../seams.md#s-05) is that contracts/conspectus-vocabulary.json is the only place an enum value is defined, and that four parties are held to it rather than two: the generated src/vocabulary.ts the server's validators read, the generated materializer vocabulary.py, the hand-maintained SQL CHECK literals in schema.sql, and SKILL.md's hand-written evidence ladder. Every value carries a label, a meaning, and a statement of what it cannot justify, so the vocabulary is an operational-definitions artifact and not merely a list of permitted strings. The generated modules are never edited; the SQL literals are, deliberately, because that file is applied to live databases on every open. | Observation | `7c1c1a9f5689` |

## Boundaries

### Seams

| Seam | Shared object | Other party | Assessable |
|---|---|---|---|
| **[S-02](../seams.md#s-02)** | The tool registry and ServerContext handed to every handler by index.ts | **[B-02](b02-server-core-repository-binding-storage-schema-lifecycle.md)** | both parties are `mapped` |
| **[S-05](../seams.md#s-05)** | mcp-server/contracts/conspectus-vocabulary.json — the single enum source and its two generated modules | **[B-05](b05-materializer-human-projection-read-back-html.md)** | both parties are `mapped` |
| **[S-06](../seams.md#s-06)** | The claims, claim_evidence, evidence and xrefs tables — written by the survey handlers, read by the reader route | **[B-03](b03-knowledge-tools-and-workflow-api.md)** | both parties are `mapped` |

### Recorded edges

| From | → | To | Relationship | Strength | Context |
|---|---|---|---|---|---|
| **B-04** | → | **[B-03](b03-knowledge-tools-and-workflow-api.md)** | data-flow | structural | The reader route serves rows the survey handlers write: a claim binds evidence rows created by add_evidence and describe_locus reads them back as a locus account, so this subsystem's output is only as good as that subsystem's input. Read at mcp-server/src/tools/claims.ts:requireFileAnchoredEvidence@7c1c1a9 which resolves each evidence id and reads its kind and file_path. |
| **B-04** | → | **[B-05](b05-materializer-human-projection-read-back-html.md)** | dependency | structural | One enum source generates two modules in two languages, so the projection labels and orders values with the same table the server validates against; a value added on one side and not regenerated on the other is drift a --check exists to catch. Read at mcp-server/src/vocabulary.ts:SQL_CONSTRAINED_VOCABULARIES@7c1c1a9 which is the generated TypeScript half of that pair. |
| **[B-02](b02-server-core-repository-binding-storage-schema-lifecycle.md)** | → | **B-04** | dependency | structural | The reader-lens tools are registered first in the advertised list, deliberately, because list order is the order a host reads and the consumer route is the one a reader needs first. Read at mcp-server/src/index.ts:allTools@7c1c1a9 which places locusTools ahead of every other group with a comment citing spec section 5.5. |

## Known defects here

4 defects here are open or awaiting verification. Each one's full record, with its evidence, is on [Open findings](../findings.md).

- A default `describe_locus` call on a surveyed file returns standing, a census, and no account at all — `items: []` in every one of the eight sections — while declaring itself over budget. The tool the server instructions name first, and that the skill tells an agent to call before reading a file, answers "29 things are recorded here" and serves none of them. — [B04-R1](../findings.md#b04-r1) · 🟠 HIGH · Open
- The adversarial pass cannot record a negative outcome when the survey is conducted at a single revision. `record_claim_challenge` accepts only `survived`; `overturned` and `superseded` are unreachable. A phase whose whole purpose is to overturn claims can, in the normal case, only ever agree with them — and the `mapped` prerequisite that requires an outcome on every claim is therefore a gate that cannot turn red. — [B04-R2](../findings.md#b04-r2) · 🟠 HIGH · Open
- `add_claim` accepts a `claim_key` whose slug does not identify the subject, and the writer only learns the rule from a gate that runs long after the record is durable — at which point the record cannot be corrected without discarding the whole structural phase. — [B04-R3](../findings.md#b04-r3) · 🟡 MEDIUM · Open
- A hung `git` invocation inside a tool handler blocks that call indefinitely. Because the calls are synchronous and block the Node event loop, the whole server stops answering, not just the one request. — [B04-R4](../findings.md#b04-r4) · 🟡 MEDIUM · Open

## Standing

**Mapped** — Survey complete through structural analysis, concern review, and adversarial challenge. It cannot justify that the reading is current at the repository head.

| Metric | Value |
|---|---|
| Files read | 9 of 10 ledger rows |
| Files in scope, not yet read | 0 of 10 |
| Files excluded from the survey obligation | 1 of 10 |
| Ledger rows the repository has changed under | 0 of 10 |
| Active concerns with a disposition recorded here | 23 of 30 — 7 confirmed-bug, 9 confirmed-acceptable, 2 ruled-out, 5 out-of-scope |
| Findings by resolution state | 4 open |
| Seams assessable from both sides | 3 of 3 |

## Survey record

### File ledger

| Path | Classification | Why in scope | Examined at |
|---|---|---|---|
| <a id="le-e300d3564e"></a>`mcp-server/contracts/attention.schema.json` | examined | The declared shape of a get_attention response, including the omission ledger. | `7c1c1a9f` |
| <a id="le-9119e3384b"></a>`mcp-server/contracts/conspectus-vocabulary.json` | examined | The single enum source. One object per value with a label, a meaning, and what it cannot justify. | `7c1c1a9f` |
| <a id="le-a77508172f"></a>`mcp-server/contracts/locus-account.schema.json` | examined | The declared shape of a describe_locus response. | `7c1c1a9f` |
| <a id="le-a368c8bc89"></a>`mcp-server/contracts/locus-history.schema.json` | examined | The declared shape of a get_history response. | `7c1c1a9f` |
| <a id="le-d7c1cfe708"></a>`mcp-server/src/standing.ts` | examined | The standing state machine: the seven-state enum, the authority ordering, the locus-kind inference ladder, and the per-kind standing builders. | `7c1c1a9f` |
| <a id="le-f3ae99722d"></a>`mcp-server/src/tools/claims.ts` | examined | add_claim and its two subtractive checks, record_claim_challenge, supersession and invalidation. | `7c1c1a9f` |
| <a id="le-cb0cd78df4"></a>`mcp-server/src/tools/locus.ts` | examined | 3607 lines: describe_locus, get_attention and get_history, plus the wire budgets, the truncation ladder and the omission ledger. | `7c1c1a9f` |
| <a id="le-5ff2eb5eb7"></a>`mcp-server/src/tools/vocabulary.ts` | examined | The tools that serve the enum vocabulary to a reader: list_vocabulary, define_term, lookup_term. | `7c1c1a9f` |
| <a id="le-f7badfcd57"></a>`mcp-server/src/tools/xrefs.ts` | examined | add_xref and the token-level citation grammar that replaced whole-string citation parsing. | `7c1c1a9f` |
| <a id="le-8d0c6aad3c"></a>`mcp-server/src/vocabulary.ts` | generated-ignore | Generated from contracts/conspectus-vocabulary.json by scripts/gen-vocabulary.mjs. Read to confirm what it is, not surveyed as a source of behaviour. | `7c1c1a9f` |

### Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[AL-1](../concerns.md#al-1)** | ruled-out | code-verified |  | The module-level state here is the generated vocabulary tables and the budget constants, all read-only lookups. Responses are freshly constructed objects built per call from SQLite rows, so a caller holds no reference into anything the server reads again. Nothing exported from this subsystem is a mutable container a handler could write through. |
| **[AT-1](../concerns.md#at-1)** | confirmed-acceptable | code-verified |  | The multi-table writes here are transactional where a partial write would be visible. supersede_claim's own description names atomicity as its contract — close the predecessor and create the successor at one commit — and add_claim writes claims and claim_evidence together with the evidence resolved and ancestry-checked before anything is inserted, so a rejected claim leaves no orphan link. The tool's documented rejection behaviour is transactional and the refusals observed during this survey left no partial rows. |
| **[AT-2](../concerns.md#at-2)** | out-of-scope | code-verified |  | Nothing here commits to the storage Git repository. The checkpoint-versus-mutation divergence belongs to [B-02](b02-server-core-repository-binding-storage-schema-lifecycle.md), which owns commit_phase_gate and the WAL checkpoint, and is dispositioned there. |
| **[CC-1](../concerns.md#cc-1)** | confirmed-acceptable | code-verified |  | This subsystem owns the repository's most-generated artifact and gives it the most checks. src/vocabulary.ts and the materializer's vocabulary.py are generated from contracts/conspectus-vocabulary.json and never edited; gen-vocabulary.mjs --check asserts the generated files match the source, --check-sql asserts schema.sql's hand-written CHECK literals match it, and check-evidence-vocabulary.mjs holds SKILL.md's hand-written ladder to the same source. Four parties, three checks, one source, and the one hand-maintained party is hand-maintained for a stated reason. |
| **[CC-2](../concerns.md#cc-2)** | confirmed-bug | runtime-observed |  | The derived surface here is the account describe_locus serves, and it disagrees with the store it derives from in the way this concern names: the store holds 29 items for mcp-server/src/index.ts and the default call serves 0. It is not a silent disagreement — every omission is declared with an exact count, which is the contract working — but the reader of a default call is told only that 29 things exist. The cause is arithmetic: the budget is 8192 plus 4096 per OPTIONAL section requested, so the allowance grows only when the caller asks for extra, while the fixed scaffolding (6860 wire bytes with nothing recorded) does not shrink. Naming structure alone does not help because structure is a default section. Measured across four section selections against the live server. |
| **[CR-1](../concerns.md#cr-1)** | out-of-scope | code-verified |  | Nothing in this subsystem acquires, releases or consults a write lock, and the reader tools write nothing. Cross-process contention over the shared store is [B-02](b02-server-core-repository-binding-storage-schema-lifecycle.md)'s disposition. |
| **[CR-2](../concerns.md#cr-2)** | out-of-scope | code-verified |  | Store creation happens entirely in [B-02](b02-server-core-repository-binding-storage-schema-lifecycle.md). Nothing here participates in first use beyond touching ctx.db, which is [B-02](b02-server-core-repository-binding-storage-schema-lifecycle.md)'s getter. |
| **[EP-1](../concerns.md#ep-1)** | out-of-scope | code-verified |  | No handler in this subsystem performs a multi-file write. The reader tools write nothing at all, and the three writers touch only SQLite tables, where the transaction covers what a rollback would. |
| **[EP-2](../concerns.md#ep-2)** | confirmed-bug | code-verified |  | The negative path of the adversarial pass cannot be taken at the survey's own revision, so the phase can only ever record its positive outcome. record_claim_challenge refuses an overturned or superseded outcome without a validity_event_id; only invalidate_claim and supersede_claim write such an event; both call requireStrictDescendant(at_sha, valid_from_sha) and reject at_sha equal to valid_from_sha. A survey records every claim at the revision it is reading, so all three routes are closed and the only expressible outcome is survived. Reproduced three times during this survey while trying to correct a claim of my own. |
| **[ID-1](../concerns.md#id-1)** | confirmed-bug | code-verified |  | This is the concern's exact signature: a caller-supplied key whose stability is load-bearing, and nothing in the writer that makes it stable. claim_key is the field that decides whether a later reading supersedes or duplicates, the unique index on it is what makes supersession work, and the server validates only its category prefix. A key built from a bare symbol name collides across files by construction, and the collision presents as a superseded claim rather than as an error. |
| **[ID-2](../concerns.md#id-2)** | confirmed-acceptable | runtime-observed |  | Every served item carries ref_sha and an explicit revision_bound flag, every section carries as_of, and the standing block carries a revision object stating the checked SHA, the repository head, the origin head and whether they agree — the live response reported agrees: false against a head one commit ahead, which is the flag doing its job. as_of_sha supports an as-of query and each section declares whether it can answer one. Nothing observed serves a locus row without the revision it was read at. |
| **[IF-1](../concerns.md#if-1)** | out-of-scope | code-verified |  | No incremental path exists here to diverge from a full one; every response is computed from the store per call with no cache. The incremental-versus-clean publish belongs to [B-05](b05-materializer-human-projection-read-back-html.md). |
| **[IF-2](../concerns.md#if-2)** | confirmed-acceptable | runtime-observed | 🔗 | This subsystem reads staleness rather than deriving it, and it reads it with a denominator: the live response reported staleness_measured true, ledger_rows 1, and a reconciliation_receipt naming the last checked SHA and time, so a reader can tell "no stale rows" from "staleness was never computed" — which is the distinction whose absence made a whole staleness surface inert in this project's history. On the unledgered path the same fields reported staleness_measured false and ledger_reconciled false rather than a reassuring zero. Marked linchpin-dependent because agreement with a full reconciliation was not tested; only the presence of the denominator was. |
| **[RL-1](../concerns.md#rl-1)** | confirmed-acceptable | code-verified |  | The only resources taken here are synchronous git subprocesses, reaped by spawnSync on every exit path. No handle, temporary directory or long-lived object is acquired. The absence of a timeout on those subprocesses is a liveness defect recorded under [TB-1](../concerns.md#tb-1), not a lifecycle one. |
| **[SC-2](../concerns.md#sc-2)** | confirmed-bug | runtime-observed |  | Assessed from **B-04**'s side, same evidence, and here the seam does carry a violation — not of the serialization contract, which holds, but of what the budget is measured against. This party computes its bound with responseBytes over the whole envelope, and the envelope carries the payload twice because jsonResult emits a text block and a duplicate structuredContent. So the tool's own budget is halved by a decision that lives on the other side of the seam, and neither side states the interaction. Measured: a default describe_locus on a ledgered file reports payload 4535 and response 9612 against a budget of 8192. Filed as B04-R1. |
| **[SC-5](../concerns.md#sc-5)** | confirmed-acceptable | code-verified |  | Assessed from **B-04**'s side. The failure this concern names — checks that compare copies to each other rather than to the source — is anticipated by name in the vocabulary gate's own red conditions, which state that agreeing copies can share one wrong definition and that SKILL.md, the only hand-written party, is therefore read independently against the source. Each of the four parties is compared to the JSON rather than to a sibling: the two generated modules by gen-vocabulary.mjs --check, the SQL literals by --check-sql, the evidence ladder by check-evidence-vocabulary.mjs. The four-way check also has to report which party diverged, which is a design against exactly this ambiguity. |
| **[SC-6](../concerns.md#sc-6)** | confirmed-bug | code-verified |  | Assessed from **B-04**'s side. The reader does serve something the writer's validation did not establish: describe_locus's structure section admits a claim on subject_id, or on a claim_key prefix, or on cited evidence, joined with OR — the dogfood gate's own comment says so and reads the evidence file paths separately for that reason. So a claim can appear on a file's page because its key names the subject's subsystem while its evidence cites elsewhere, and the served item does not carry the citation that would let a reader check. The writer's file-anchored rule constrains only the three file-anchored categories, so a concurrency or seam claim reaches the reader with no file binding at all. That is a real gap between what the writer validates and what the reader presents as an account of a file. |
| **[SE-1](../concerns.md#se-1)** | confirmed-bug | code-verified |  | The stable-key rule is stated on one side of the seam and enforced only on the other. add_claim's pattern reaches the category and its trailing slash and no further, so the server accepts any slug; dev/test-rebuild-coverage.mjs recomputes the key from the whole path:symbol pair and refuses anything else, citing a recorded incident where a symbol-only slug made two Config types collide. Reproduced during this survey: the server accepted [B-02](b02-server-core-repository-binding-storage-schema-lifecycle.md)/state-container/openDatabase and the gate's rule would have refused it. The correction path then fails too, which is filed separately. |
| **[TB-1](../concerns.md#tb-1)** | confirmed-bug | code-verified | 🔗 | Two subprocess call sites in tools/xrefs.ts and two in tools/claims.ts run git rev-parse to resolve a citation's revision, and none carries a timeout; standing.ts has two more. Grepping the whole of mcp-server/src, only project.ts and codex-host.ts mention a timeout at all. These are handler paths rather than startup, so a hang costs one tool call rather than activation, which is why this is dispositioned separately from [B-02](b02-server-core-repository-binding-storage-schema-lifecycle.md)'s. Marked linchpin-dependent because the reading rests on the absence of an option in the call sites rather than on an observed hang. |
| **[TR-1](../concerns.md#tr-1)** | confirmed-acceptable | code-verified |  | Model-authored values that reach a filesystem path or a subprocess argument here are validated first: a citation token's path goes through requireWorkspaceSourcePath, which rejects absolute, traversing and .amanuensis paths, and its revision goes to git rev-parse as a separate argv element rather than into a shell string. The grammar is applied token-by-token rather than over the whole value, which was the previous defect. describe_locus's locus argument is capped at 512 characters and resolved against the ledger rather than the filesystem. |
| **[TR-2](../concerns.md#tr-2)** | confirmed-acceptable | runtime-observed | 🔗 | This is the route by which stored prose reaches an agent's context, so the concern is live here. What limits it is structural rather than sanitising: every served item is a typed field inside a named section with its authorship declared — the live response marked each item authored "model" or "code" — and the standing block states the authority ceiling and what it cannot justify before any content. A reader that honours the contract treats the account as a record, not as instruction. Marked linchpin-dependent because that is a property of the response's shape and of the consumer honouring it, not an enforced boundary; nothing strips or escapes the prose, and nothing here was tested with deliberately adversarial stored content. |
| **[VR-1](../concerns.md#vr-1)** | confirmed-acceptable | contract-stated |  | The version identities this subsystem owns each have a single source and a check. The vocabulary declares contract_version 1.0.0 in the JSON and every generated module carries it; describe_locus emits contract_version 1.0.0 in its response and the schema under contracts/ declares the same. gen-vocabulary.mjs --check, --check-sql and check-evidence-vocabulary.mjs bind the four parties. The repository-wide version drift is real but is stated in [B-02](b02-server-core-repository-binding-storage-schema-lifecycle.md)'s SERVER_VERSION and the documentation, not here. |
| **[ZD-1](../concerns.md#zd-1)** | ruled-out | test-observed |  | Ruled out by running the gate rather than reading it. test-locus-compactness.mjs is green at 7c1c1a9 and prints its own measurements: "wide census 150: served 0, omitted 150" and "six owners: standing 3811 B, wire 12364 B, declared over budget". It exercises both the serve-nothing case and the over-budget case on real responses, and its contract is that an over-budget response must declare itself rather than fit. The denominator is populated and the assertions can fail. The behaviour recorded under [CC-2](../concerns.md#cc-2) is therefore behaviour this gate was written to permit, not behaviour it failed to see. |

### Survey artifact

#### **B-04** · Reader lenses: standing, locus account, claims, edges, vocabulary

**Revision read:** `7c1c1a9` · **Layer:** api · **Priority:** 1

##### Scope

`src/standing.ts`, `src/vocabulary.ts` (generated), `tools/locus.ts`, `tools/claims.ts`,
`tools/xrefs.ts`, `tools/vocabulary.ts`, and four contracts under `mcp-server/contracts/`.
Ten files. This is the subsystem the merged `reader-lenses` branch created.

##### Observed structure

**Standing is a closed seven-state enum with a declared order.** `unledgered`, `excluded`,
`scoped-unread`, `examined`, `examined-stale`, `absent`, `mixed`, plus
`STANDING_AUTHORITY_ORDER` running weakest first. The ordering exists because `mixed`
authorizes only what its weakest owner authorizes and the specification ranks nothing; the
comment says the gap was filled here rather than left to callers. `deferred` is given **no**
rank, because the status ladder does not rank it either — a refusal to invent, of the same
kind as declaring an omission rather than dropping it.

**`add_claim` carries exactly two subtractive checks.** `subject_type` against the
vocabulary's enum, and — for a key whose category is `key-type`, `state-container` or `flow` —
a requirement that *one* evidence row be both a strong kind and cite the file `subject_id`
names. Two rows each satisfying one half do not satisfy it together. Both fired during this
survey, correctly, with errors that named what they found.

**`add_xref` validates citations token-by-token.** The context is split on whitespace and at
least one token must match `path:symbol@sha`; the path is checked as a workspace source path
and the revision must resolve. Symbol reachability is deliberately unchecked and the contract
says so.

**Responses are bounded and the accounting is honest.** `WIRE_BUDGET` is 8192 bytes, measured
by `responseBytes` against the **whole emitted envelope** — the text block plus the
`structuredContent` that duplicates it. Truncation is ordered: `unknown` first, then
round-robin across sections, then the omission ledger's id lists down a 1024/512/256/128/64/0
ladder. Nothing is dropped silently; every omission carries an exact count and a reason of
`policy` or `budget`.

##### Measured behaviour, this store, this revision

Through the live server:

| Call | budget | payload | wire | items served |
|---|---|---|---|---|
| `describe_locus("LICENSE")` — unledgered, default sections | 8192 | 3228 | 6860 | 0 of 0 |
| `describe_locus("mcp-server/src/index.ts")` — default sections | 8192 | 4535 | 9612 | **0 of 29** |
| same, `sections: ["structure"]` | 8192 | 4535 | 9612 | **0 of 29** |
| same, `sections: ["structure","reviews","leads","history_pointer"]` | **20480** | 9748 | 20310 | 7 of 29 |
| `get_attention()` | 12288 | 5732 | 12102 | 12 of 19 |

The budget is `WIRE_BUDGET + WIRE_BUDGET_PER_OPTIONAL_SECTION * optionalRequested`
(`locus.ts:1574`) — 8192 plus 4096 for each **optional** section named. So the allowance
scales with how much *extra* the caller asks for, while the fixed cost does not. The
scaffolding for a locus with nothing recorded is already 6860 wire bytes, 84% of the default
budget; one examined owner plus its omission ledger adds about 2752 against 1332 of headroom.
Naming `structure` alone changes nothing, because `structure` is a default section and adds
no allowance.

The consequence: **the default invocation — the one the server instructions tell an agent to
make first — returns standing and a census and no account at all.** The account is reachable,
but only by asking for sections the caller may not want. The committed dogfood receipt
records `budget_bytes: 20480` for all three of its loci, which is why its assertion-1 arm
passes; a receipt regenerated from default calls would fail it, and the gate's message for
that case is already written: "the budget dropped every claim, so the account reached no
reader".

##### Seam contract offered ([S-05](../seams.md#s-05))

`contracts/conspectus-vocabulary.json` is the only place an enum value is defined, and **four**
parties are held to it: the generated `src/vocabulary.ts`, the generated
`materializer/…/vocabulary.py`, the hand-maintained SQL `CHECK` literals, and `SKILL.md`'s
hand-written evidence ladder. Every value carries a label, a meaning, and what it cannot
justify — operational definitions, not a permitted-strings list.

##### Inference, separated from observation

The concurrency reading is an inference: the reader tools are pure reads and nothing here
spawns a worker or takes a lock, but no concurrent run was performed.

##### Open

Whether `describe_locus`'s emptiness is a budget-tuning question or a contract question is
recorded as a finding, not decided here. The measurement establishes that it is not a
property of *this* store's size: it appears at one owner and one file.
