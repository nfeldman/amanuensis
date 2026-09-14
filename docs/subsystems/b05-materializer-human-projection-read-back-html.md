# **B-05** — Materializer: human projection, read-back, HTML

**Status**: 🟢 mapped  
**Layer**: projection

## Scope

No purpose statement is recorded for this subsystem; the scope below states what it covers.

materializer/materialize.py and materializer/amanuensis_materializer/ (core.py, db.py, renderers.py, html_projection.py, readback.py, manifest.py, diagrams.py, lint.py, slugs.py, vocabulary.py, xref.py)

## Start here

materializer/amanuensis_materializer/core.py — the publish orchestration and the clean-publish contract; then readback.py for the three verification axes, then renderers.py / html_projection.py for the page set.

## Structure

What the survey recorded as claims about this subsystem, grouped by what each one states. Every claim is bound to the revision it was asserted at and to the evidence attached to it; a superseded claim is not shown here.

### Key types

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-05/key-type/materializer-amanuensis-materializer-readback-py-projectionverifier` | `materializer/amanuensis_materializer/readback.py:ProjectionVerifier` | Read-back is three independent axes, each answering a different question and each able to fail alone: state, that every authoritative object has exactly one durable marker in the output — not zero, and not two pages; coverage, that every planned page and every recorded local cross-link is present and resolves; content, that the finished page bytes match the receipt written after cross-link rewriting. write_contract records a sha256 per page, which is what makes the content axis a byte comparison rather than a second render compared to the first. | Observation | `7c1c1a9f5689` |

### State containers

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-05/state-container/materializer-amanuensis-materializer-db-py-open-ro` | `materializer/amanuensis_materializer/db.py:open_ro` | The materializer holds the store read-only for the life of one render: it opens `file:<path>?mode=ro&amp;immutable=0` so a WAL reader does not block the writer, and it applies no schema. That makes it structurally incapable of repairing what it reads, which is why the required-view probe refuses rather than falling back — the module comment states that an inline copy of a view's predicate would put the same definition in two places, which is the drift the views were introduced to remove. | Observation | `7c1c1a9f5689` |

### Flow steps

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-05/flow/clean-publish/01` | `materializer/amanuensis_materializer/core.py:Materializer` | A publish renders every planned page, rewrites cross-links, writes the projection contract recording a sha256 per page, and only then runs the verifier — so the contract the content axis compares against describes the final bytes rather than an intermediate state, and a link rewrite that corrupted a page is caught rather than hidden by a stale hash. When verify_readback is set and the result is not ok, the publish does not promote. This ordering is what makes the two-step publication meaningful: dev/promote-docs.mjs refuses a source whose bytes have drifted from the contract it carries, which can only detect drift if the contract was written last. | Observation | `7c1c1a9f5689` |

### Concurrency invariants

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-05/concurrency` | `B-05` | The materializer is a short-lived single-threaded process that reads and exits. Its only concurrency relationship is with the writer it shares a store with, and it is resolved by SQLite rather than by coordination: mode=ro with WAL means the reader does not block the writer and sees a consistent snapshot. It takes no lock and does not consult active_write_locks, so a render concurrent with a survey reflects whatever was committed when its queries ran — which is correct for a projection that is explicitly not authority and dated by the revision it records. | Inference | `7c1c1a9f5689` |

### Seam contracts

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-05/seam/S-04` | `S-04` | From this side, [S-04](../seams.md#s-04) is a one-way dependency this party cannot repair. It opens the store read-only and applies no schema, so the two reader views exist only if the writer created them; a store last opened by an older server arrives without them. The response is to probe once at the start of a render and refuse, naming the cause and the fix — open it once with the current server — rather than inlining the view's predicate, because the same definition in two places is the drift the views were introduced to remove. The same two names are therefore declared independently on both sides of the process boundary, which is duplication accepted deliberately where a shared constant cannot cross. | Observation | `7c1c1a9f5689` |

## Boundaries

### Seams

| Seam | Shared object | Other party | Assessable |
|---|---|---|---|
| **[S-04](../seams.md#s-04)** | .amanuensis/memory.db read read-only by the materializer, a separate Python process | **[B-02](b02-server-core-repository-binding-storage-schema-lifecycle.md)** | both parties are `mapped` |
| **[S-05](../seams.md#s-05)** | mcp-server/contracts/conspectus-vocabulary.json — the single enum source and its two generated modules | **[B-04](b04-reader-lenses-standing-locus-account-claims-edges-vocabulary.md)** | both parties are `mapped` |
| **[S-07](../seams.md#s-07)** | The published projection tree — .amanuensis/docs rendered, then promoted to the tracked docs/ | **[B-08](b08-records-design-research-published-projection-execution-ledger.md)** | both parties are `mapped` |

### Recorded edges

| From | → | To | Relationship | Strength | Context |
|---|---|---|---|---|---|
| **B-05** | → | **[B-08](b08-records-design-research-published-projection-execution-ledger.md)** | data-flow | structural | The rendered tree in project storage becomes the tracked docs tree only through a separate promotion step, and the projection contract written here is what that step re-verifies at the destination path before the bytes are committed. Read at materializer/amanuensis_materializer/readback.py:write_contract@7c1c1a9 which records a sha256 per page. |
| **[B-02](b02-server-core-repository-binding-storage-schema-lifecycle.md)** | → | **B-05** | data-flow | structural | The materializer opens this store from a second process and applies no schema of its own, so the two reader views exist only because this subsystem created them; that is why they are asserted on every open rather than assumed — mcp-server/src/db.ts:REQUIRED_VIEWS@7c1c1a9 names them and requireViews closes the handle and throws when either is absent. |
| **[B-03](b03-knowledge-tools-and-workflow-api.md)** | → | **B-05** | data-flow | structural | materialize_docs is a handler here that spawns the Python materializer as a child process and asserts the output path stays inside project storage, which is why the tool cannot be pointed at the tracked docs tree and promotion is a second explicit step. Read at mcp-server/src/tools/materialize.ts:resolveStorageOutputPath@7c1c1a9 which resolves a relative output_dir against storagePath and asserts containment. |
| **[B-04](b04-reader-lenses-standing-locus-account-claims-edges-vocabulary.md)** | → | **B-05** | dependency | structural | One enum source generates two modules in two languages, so the projection labels and orders values with the same table the server validates against; a value added on one side and not regenerated on the other is drift a --check exists to catch. Read at mcp-server/src/vocabulary.ts:SQL_CONSTRAINED_VOCABULARIES@7c1c1a9 which is the generated TypeScript half of that pair. |
| **[B-07](b07-gates-evidence-custody-and-ci.md)** | → | **B-05** | dependency | structural | The promotion script drives the materializer's own read-back through its CLI in readback-only mode rather than reimplementing the three axes, so the gate and the projection agree by construction rather than by two implementations staying in step. Read at dev/promote-docs.mjs:promote@7c1c1a9 which invokes the same code path verify_materialized_docs executes. |

## Known defects here

No defect here is open or awaiting verification.

## Standing

**Mapped** — Survey complete through structural analysis, concern review, and adversarial challenge. It cannot justify that the reading is current at the repository head.

| Metric | Value |
|---|---|
| Files read | 8 of 12 ledger rows |
| Files in scope, not yet read | 3 of 12 |
| Files excluded from the survey obligation | 1 of 12 |
| Ledger rows the repository has changed under | 0 of 12 |
| Active concerns with a disposition recorded here | 23 of 30 — 16 confirmed-acceptable, 2 ruled-out, 4 out-of-scope, 1 unresolved-competition |
| Findings by resolution state | none recorded |
| Seams assessable from both sides | 3 of 3 |

## Survey record

### File ledger

| Path | Classification | Why in scope | Examined at |
|---|---|---|---|
| <a id="le-04ac7dd693"></a>`materializer/amanuensis_materializer/diagrams.py` | candidate | Deterministic embedded runtime-boundary diagrams. Read for shape only. | `7c1c1a9f` |
| <a id="le-193116b014"></a>`materializer/amanuensis_materializer/html_projection.py` | candidate | 3155 lines of HTML projection. Read for structure only. | `7c1c1a9f` |
| <a id="le-64c8700835"></a>`materializer/amanuensis_materializer/renderers.py` | candidate | 3744 lines of Markdown rendering. Read for page-plan structure only; individual renderers were not read. | `7c1c1a9f` |
| <a id="le-4deacb5753"></a>`materializer/amanuensis_materializer/core.py` | examined | The publish orchestration: the page plan, the route table, the locus index, and the clean-publish contract. | `7c1c1a9f` |
| <a id="le-d5151e4900"></a>`materializer/amanuensis_materializer/db.py` | examined | The read-only open and the required-view probe; the [S-04](../seams.md#s-04) boundary from this side. | `7c1c1a9f` |
| <a id="le-610d7cd955"></a>`materializer/amanuensis_materializer/lint.py` | examined | The orientation-prose lint that keeps survey-status vocabulary out of the overview. | `7c1c1a9f` |
| <a id="le-ebf0697c78"></a>`materializer/amanuensis_materializer/manifest.py` | examined | The manifest that records what was published. | `7c1c1a9f` |
| <a id="le-beff4a666d"></a>`materializer/amanuensis_materializer/readback.py` | examined | The three verification axes — state, coverage, content — and the projection contract they are checked against. | `7c1c1a9f` |
| <a id="le-2a6856e520"></a>`materializer/amanuensis_materializer/slugs.py` | examined | Path and anchor slugs — the collision surface the search-index gate tests. | `7c1c1a9f` |
| <a id="le-b5528c0f23"></a>`materializer/amanuensis_materializer/xref.py` | examined | Cross-link rewriting, which the coverage axis then verifies. | `7c1c1a9f` |
| <a id="le-fecf794c7e"></a>`materializer/materialize.py` | examined | The CLI entry point, including the --readback-only mode that promote-docs.mjs and verify_materialized_docs both drive. | `7c1c1a9f` |
| <a id="le-198ab52db0"></a>`materializer/amanuensis_materializer/vocabulary.py` | generated-ignore | Generated from contracts/conspectus-vocabulary.json. The source is the JSON, surveyed under [B-04](b04-reader-lenses-standing-locus-account-claims-edges-vocabulary.md). | `7c1c1a9f` |

### Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[AL-1](../concerns.md#al-1)** | ruled-out | code-verified |  | The query helpers deliberately return plain dicts rather than sqlite3.Row objects, with the stated reason that they must serialize cleanly for the manifest hash — which also means no caller holds a cursor-backed object. The process is single-threaded and exits after one render, so there is no long-lived shared structure for one part to mutate under another. |
| **[AT-1](../concerns.md#at-1)** | out-of-scope | code-verified |  | The connection is read-only; this subsystem performs no database mutation, so there is no multi-table write to wrap. Its file-write atomicity is dispositioned under [EP-1](../concerns.md#ep-1). |
| **[AT-2](../concerns.md#at-2)** | out-of-scope | code-verified |  | Nothing here commits to the storage Git repository or checkpoints the WAL. That divergence is [B-02](b02-server-core-repository-binding-storage-schema-lifecycle.md)'s. |
| **[CC-1](../concerns.md#cc-1)** | confirmed-acceptable | code-verified |  | The generated artifact here is the projection itself, and it carries its own drift check by construction: the contract records a sha256 per page written after cross-link rewriting, the promotion script refuses a source whose bytes have drifted from it, and the dogfood gate re-hashes every promoted page at the committed path. That is a generated tree with three independent checks on whether it still matches its source, which is stronger than the --check pattern used elsewhere in the repository. |
| **[CC-2](../concerns.md#cc-2)** | confirmed-acceptable | code-verified |  | The derived-versus-source disagreement this concern names is handled at the only point it can be here: the materializer reads the views rather than reimplementing their predicates, and refuses when they are absent instead of falling back to an inline copy. The comment states the reasoning — the same definition in two places is the drift the views were introduced to remove. The residual duplication is the two view names, declared on both sides of a process boundary where a shared constant cannot cross, and both sides assert them rather than assume them. |
| **[CR-1](../concerns.md#cr-1)** | confirmed-acceptable | code-verified | 🔗 | A render concurrent with a survey is the normal case, and it is handled by SQLite rather than by coordination: mode=ro under WAL gives the reader a consistent snapshot without blocking the writer. No lock is taken and active_write_locks is not consulted, which is correct for a projection explicitly dated by the revision it records and explicitly not authority. Marked linchpin-dependent: no concurrent render was performed. |
| **[CR-2](../concerns.md#cr-2)** | out-of-scope | code-verified |  | This process never creates a store; a missing one is an error to report, not a state to initialize. |
| **[EP-1](../concerns.md#ep-1)** | confirmed-acceptable | code-verified | 🔗 | The multi-file write here is the publish, and its failure asymmetry is stated and implemented: clean_publish renders in isolation and a red read-back leaves the previous output untouched, so a failed run publishes nothing. The promotion step outside this subsystem carries the matching guarantee at the destination — it stages beside the target, renames into place, keeps a backup until the promoted tree verifies at its committed path, and restores on a red post-promotion read-back. Marked linchpin-dependent because neither rollback was induced during this pass; both were read. |
| **[EP-2](../concerns.md#ep-2)** | confirmed-acceptable | code-verified |  | The success and failure paths differ only in the exit status and the summary they emit; both release the single read-only connection by exiting, and neither holds a lock or an external claim. A red read-back is a reported outcome with a nonzero exit, not an exception that skips cleanup. |
| **[ID-1](../concerns.md#id-1)** | confirmed-acceptable | code-verified | 🔗 | The identity risk here is anchor and page-slug collision — two distinct loci sharing one anchor — and it is a declared red condition of the search-index gate, which requires three colliding path slugs to produce three distinct anchors. So the concern is recognised and has a test with a populated denominator. Marked linchpin-dependent because the slug function itself was read but the collision case was not executed in this pass. |
| **[ID-2](../concerns.md#id-2)** | confirmed-acceptable | code-verified | 🔗 | The projection carries the revision it was rendered at and states that it is derived rather than authoritative, so a reader is told what the pages are current as of. Marked linchpin-dependent because per-item revision binding inside the rendered pages was not verified — renderers.py is classified candidate — so this rests on the publication-level revision, not on every item carrying its own. |
| **[IF-1](../concerns.md#if-1)** | unresolved-competition | code-verified | 🔗 | Both paths exist — the materializer is diff-aware and clean_publish is a distinct mode — and this pass could not discriminate between two accounts of them. On one reading they cannot diverge, because both render from one page plan and both end at the same write_contract and the same three-axis verifier, so a divergence would have to survive a byte comparison. On the other, the diff-aware path decides what to re-render from the registered artifacts' content hashes, and a page whose inputs changed without its artifact hash changing would be skipped by one path and rendered by the other — which is precisely the class this concern names and which the shared verifier would not catch, because it verifies what was written, not what should have been. Discriminating between them needs two runs over one store state and a tree diff, which this pass did not perform. Recorded as unresolved rather than guessed. |
| **[IF-2](../concerns.md#if-2)** | out-of-scope | code-verified |  | Staleness is derived by the server and read here. This subsystem renders the freshness strip from get_dashboard's numbers and has its own gate asserting the two agree; deriving staleness is [B-03](b03-knowledge-tools-and-workflow-api.md)'s. |
| **[RL-1](../concerns.md#rl-1)** | confirmed-acceptable | code-verified |  | The process is short-lived and read-only: one connection, opened at the start and released when the process exits, which is the strongest possible release guarantee. The temporary tree a clean publish renders into is either promoted or left for the caller, and the promotion script owns its own staging cleanup. |
| **[SC-4](../concerns.md#sc-4)** | confirmed-acceptable | code-verified | 🔗 | Assessed from **B-05**'s side, same evidence. This party names the same two views in its own module and comments precisely on why it duplicates rather than reimplements: an inline copy of a view's predicate would put the same definition in two places, which is the drift the views were introduced to remove, so it duplicates the names and refuses when they are absent instead of duplicating the logic. Duplicating an identifier is recoverable; duplicating a predicate is the failure. Marked linchpin-dependent for the same reason as the other side. |
| **[SC-5](../concerns.md#sc-5)** | confirmed-acceptable | code-verified | 🔗 | Assessed from **B-05**'s side, same evidence. This party consumes the generated Python module and does not restate any value, so it cannot be the source of a divergence — only its victim, and the --check that guards it runs in CI. The one consumer downstream of a generated party rather than of the source is the reader's guide the projection renders, which takes its values from the generated module; that is a chain rather than an unchecked copy, but it means a fault in generation reaches the reader as authoritative labels. Marked linchpin-dependent because the reader's guide rendering was not read — html_projection.py is classified candidate. |
| **[SC-7](../concerns.md#sc-7)** | confirmed-acceptable | code-verified |  | Assessed from **B-05**'s side. This party makes the question answerable by writing the contract after cross-link rewriting, so the recorded hashes describe final bytes rather than an intermediate state. Without that ordering the destination check would compare post-rewrite bytes against pre-rewrite hashes and could not distinguish drift from rewriting. The promotion then re-runs this party's own read-back at the destination through the same CLI code path, so the two are not two implementations of green. |
| **[SE-1](../concerns.md#se-1)** | confirmed-acceptable | code-verified |  | The contract this side depends on across [S-04](../seams.md#s-04) is enforced rather than assumed: the required views are probed, and their absence produces a refusal naming the cause and the fix rather than a degraded render. The contract this side offers across [S-07](../seams.md#s-07) — that the projection contract describes the bytes on disk — is enforced by the promotion script and re-checked by the dogfood gate at the committed path. Both directions have a mechanical check, which is the condition this concern asks for. |
| **[TB-1](../concerns.md#tb-1)** | ruled-out | code-verified | 🔗 | The materializer makes no exogenous call of its own: it reads SQLite and writes files, with one git invocation to derive the repository URL for links. It is also not the process the host is waiting on — the server spawns it — so a stall costs the publish rather than the session. Marked linchpin-dependent because the two large candidate renderers were not read for subprocess calls. |
| **[TR-1](../concerns.md#tr-1)** | confirmed-acceptable | code-verified | 🔗 | Every query goes through helpers that take a parameter sequence and bind it, so store content does not reach SQL as text. The output path is chosen by the caller and containment-asserted on the server side before this process is spawned, and the promotion script independently refuses a destination holding files its own manifest does not claim. Marked linchpin-dependent because path handling inside the two candidate renderers was not audited. |
| **[TR-2](../concerns.md#tr-2)** | confirmed-acceptable | code-verified | 🔗 | This is where stored prose becomes a document a person opens, so the concern is live. Two things limit it: the orientation lint refuses survey-status vocabulary and count fractions in the overview, which is a content-trust check on the store's own prose rather than only a style rule; and the published pages are self-contained static output with no scripting beyond the search index. Marked linchpin-dependent because HTML escaping of stored prose was not verified — html_projection.py is 3155 lines and is classified candidate — so the reading rests on the lint and the output shape, not on an audited escape path. |
| **[VR-1](../concerns.md#vr-1)** | confirmed-acceptable | code-verified |  | The version identities this subsystem carries are the vocabulary contract version, which it inherits from the generated module rather than restating, and the projection contract, which is written per publish and re-verified at the promotion destination. Neither is a second hand-maintained statement of a fact declared elsewhere. The repository-wide version drift is [B-02](b02-server-core-repository-binding-storage-schema-lifecycle.md)'s and [B-08](b08-records-design-research-published-projection-execution-ledger.md)'s. |
| **[ZD-1](../concerns.md#zd-1)** | confirmed-acceptable | code-verified |  | The three axes each have a denominator that cannot be silently empty. State counts markers against the authoritative objects the store holds, so zero objects is visible as zero rather than as a pass. Coverage counts planned pages and recorded cross-links, both derived from the page plan rather than from the output. Content compares a per-page sha256 recorded in the contract, so a missing page fails rather than being skipped. The axes are iterated by name, which means a verifier that dropped one would surface as a missing key. This project's recorded zero-denominator failures in this area — a stale read-back axis with no denominator — were closed by the ledger-derived freshness work and its gate asserts the denominator explicitly. |

### Survey artifact

#### **B-05** · Materializer: human projection, read-back, HTML

**Revision read:** `7c1c1a9` · **Layer:** projection · **Priority:** 2

##### Scope

`materializer/` — twelve files in the ledger, eight `examined`, three `candidate`
(`renderers.py` 3744 lines, `html_projection.py` 3155, `diagrams.py`), and `vocabulary.py`
`generated-ignore`. The two large renderers were read for page-plan structure only; no
structural claim is made about individual renderers.

##### Observed structure

**It reads and exits.** `open_ro` opens `file:<path>?mode=ro&immutable=0`, so a WAL reader
does not block the writer, and it applies no schema. This makes the process structurally
incapable of repairing what it reads — which is the reason for the next thing.

**It refuses rather than falls back.** The two reader views exist only because the MCP server
created them, so a store last opened by an older server arrives without them. `missing_views`
probes once at the start of a render and refuses, naming both the cause and the single fix
("open it once with the current MCP server to create them"). The module comment states why
there is no fallback: an inline copy of a view's predicate would put the same definition in
two places, which is the drift the views were introduced to remove. The two names are
therefore declared independently on both sides of the process boundary — duplication accepted
deliberately where a shared constant cannot cross.

**Read-back is three axes that fail independently:**

| Axis | Asserts |
|---|---|
| state | every authoritative object has **exactly one** durable marker in the output — not zero, not two pages |
| coverage | every planned page and every recorded local cross-link is present and resolves |
| content | finished page bytes match the receipt written **after** cross-link rewriting |

`write_contract` records a sha256 per page, which makes the content axis a byte comparison
rather than a second render compared with the first. The axes are iterated by name, so a
verifier silently checking two of three would surface as a missing key, not as a pass.

**Ordering is load-bearing.** Render → rewrite cross-links → write the contract → verify. The
contract therefore describes the final bytes, which is the only reason
`dev/promote-docs.mjs`'s refusal of a source whose bytes have drifted from its own contract
can detect anything.

##### Concurrency

Single-threaded, short-lived, read-only. The one relationship is with the writer it shares a
store with, resolved by SQLite rather than by coordination: `mode=ro` under WAL gives a
consistent snapshot without blocking. It takes no lock and does not consult
`active_write_locks`, so a render concurrent with a survey reflects what was committed when
its queries ran — correct for a projection that is explicitly not authority and is dated by
the revision it records.

##### Seam contract offered ([S-04](../seams.md#s-04))

A one-way dependency this party cannot repair, discharged by refusing with a named cause
rather than by degrading.

##### Inference, separated from observation

The concurrency reading is an inference from the connection URI and SQLite's WAL semantics; no
concurrent render was performed during this pass. The three `candidate` files carry no claim.

##### Open

Whether the incremental and clean-publish paths produce identical trees from identical store
state was not tested here — it needs two runs and a diff, which this pass did not perform.
Recorded as `IF-1`'s residual.
