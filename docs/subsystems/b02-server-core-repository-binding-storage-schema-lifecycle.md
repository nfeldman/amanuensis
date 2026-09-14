# **B-02** — Server core: repository binding, storage, schema, lifecycle

**Status**: 🟢 mapped  
**Layer**: core

## Scope

No purpose statement is recorded for this subsystem; the scope below states what it covers.

mcp-server/src/index.ts, db.ts, project.ts, session.ts, helpers.ts, invariants.ts, storage-git.ts, schema.sql

## Start here

mcp-server/src/index.ts — the tool registry and dispatch loop; then project.ts for how a workspace becomes a bound store, then db.ts for the lazy open.

## Structure

What the survey recorded as claims about this subsystem, grouped by what each one states. Every claim is bound to the revision it was asserted at and to the evidence attached to it; a superseded claim is not shown here.

### Key types

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-02/key-type/mcp-server-src-project-ts-assertprojectbinding` | `mcp-server/src/project.ts:assertProjectBinding` | The per-process ProjectBindingReceipt (contract amanuensis-repository-binding/v1) is the identity a server process is held to for its whole life, and assertProjectBinding re-checks it on every tool call. It refuses on six independent axes: the four path and key fields must still equal the receipt, the workspace's realpath must still be the canonical root, the repository's identity and key must still describe the same project, storage must still be contained under the recorded storage root, the storage tree must still contain no symlink, and the storage identity must still match. Any drift raises rather than re-binds. | Observation | `7c1c1a9f5689` |

### State containers

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-02/state-container/mcp-server-src-db-ts-opendatabase` | `mcp-server/src/db.ts:openDatabase` | openDatabase is the sole construction point for the server's one SQLite handle. It opens the file, sets journal_mode=WAL and foreign_keys=ON, runs additive and vocabulary migrations, applies the whole of schema.sql, and only then asserts that both required views survived the application — closing the handle before throwing if either did not. The ordering is deliberate and commented: migrations precede schema.sql so additive columns exist before its index statements reference them. | Observation | `7c1c1a9f5689` |

### Flow steps

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-02/flow/lazy-first-use/01` | `mcp-server/src/index.ts:main` | The store is created and opened lazily behind a getter on the ServerContext, not at startup. main() holds `db` as null; the first handler that touches ctx.db triggers ensureProjectStorage — which probes with a candidate handle it opens and immediately closes — and then takes the real handle. Server startup therefore performs no database write, which is the mechanism by which one user-scoped installation can serve a repository it has never entered before without a setup command. | Observation | `7c1c1a9f5689` |
| `B-02/flow/storage-commit/01` | `mcp-server/src/db.ts:checkpointDatabaseForStorageCommit` | Before the storage Git repository stages memory.db, every committed WAL frame is forced into the main database file by a TRUNCATE checkpoint, and a busy or partial result is raised as an error rather than reported. This closes the gap between the two halves of a checkpoint: the storage repository ignores the -wal and -shm sidecars, so without the forced checkpoint a phase commit could contain the prose a survey phase wrote while omitting the database rows it wrote. | Observation | `7c1c1a9f5689` |

### Concurrency invariants

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-02/concurrency` | `B-02` | Within one process the store has a single writer: one handle, taken once, held for the life of the process, with SQLite in WAL mode. Across processes the model is different and weaker — several server processes can be bound to different repositories at once, and linked worktrees of one repository share a storage root, so two processes can hold handles to one store. Cross-process mutual exclusion is advisory rather than structural: it is expressed in the active_write_locks table, which a writer must choose to consult. The startup path is deliberately synchronous — execFileSync blocks the event loop — and the repository's answer to that is a time bound on each probe rather than asynchrony. | Inference | `7c1c1a9f5689` |

### Seam contracts

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-02/seam/S-01` | `S-01` | From this side, the contract offered across [S-01](../seams.md#s-01) is: one DB object, already migrated, with schema.sql applied and both required views proven present, foreign keys on, and WAL journalling. A handler may assume every table and view it names exists, because an open that could not establish that threw instead of returning. What this side does not offer is a transaction boundary — withTransaction is exported for a handler to use, not applied around dispatch — so atomicity across a handler's several writes is the handler's obligation, not this seam's. | Observation | `7c1c1a9f5689` |

### Other claims

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-03/flow/status-ladder/01` | `mcp-server/src/invariants.ts:enforcePhasePrerequisites` | Four of the five status transitions carry a mechanical prerequisite, each naming the deliverable of the phase being left: `structural` requires a non-empty file ledger and at least one current claim under the subsystem's prefix; `concerns` requires a registered subsystem-survey artifact; `adversarial` requires at least one disposition; `mapped` requires a recorded challenge outcome on every current claim. enforceForwardPrerequisites walks every rung between the current status and the target, so a skipped phase names itself rather than being silently jumped, and it treats an insert opening at a later status as an advance from unmapped because upsert_subsystem is a status writer too. | Observation | `7c1c1a9f5689` |
| `B-03/seam/S-10` | `S-10` | From this side, what [S-10](../seams.md#s-10)'s foreign reference resolves against is a finding id and its current resolution state, and this subsystem guarantees only the second of those. The resolution chain is append-only and its terminal states are meaningful: the resolver exits 0 only for verified-fixed or ruled-out, and fixed-pending-verification deliberately does not resolve, so Pecia inherits the distinction between claiming a repair and proving one rather than re-deciding it. What this side does not guarantee is that a finding id means the same thing over time. finding_id is caller-supplied, carries no store generation, and a rebuilt store may mint it again for an unrelated finding; the resolver reads whatever store is at .amanuensis/memory.db now and cannot tell one generation from another. | Observation | `7c1c1a9f5689` |

## Boundaries

### Seams

| Seam | Shared object | Other party | Assessable |
|---|---|---|---|
| **[S-01](../seams.md#s-01)** | .amanuensis/memory.db — the SQLite store, its schema, and the single open handle | **[B-03](b03-knowledge-tools-and-workflow-api.md)** | both parties are `mapped` |
| **[S-02](../seams.md#s-02)** | The tool registry and ServerContext handed to every handler by index.ts | **[B-04](b04-reader-lenses-standing-locus-account-claims-edges-vocabulary.md)** | both parties are `mapped` |
| **[S-03](../seams.md#s-03)** | Host MCP configuration and the cwd the server is launched in (Codex config.toml, Claude .mcp.json, VS Code mcp.json) | **[B-06](b06-packaging-installer-and-host-activation.md)** | both parties are `mapped` |
| **[S-04](../seams.md#s-04)** | .amanuensis/memory.db read read-only by the materializer, a separate Python process | **[B-05](b05-materializer-human-projection-read-back-html.md)** | both parties are `mapped` |
| **[S-09](../seams.md#s-09)** | Committed receipts under dev/ and design/, and the untracked live store they describe | **[B-07](b07-gates-evidence-custody-and-ci.md)** | both parties are `mapped` |

### Recorded edges

| From | → | To | Relationship | Strength | Context |
|---|---|---|---|---|---|
| **B-02** | → | **[B-05](b05-materializer-human-projection-read-back-html.md)** | data-flow | structural | The materializer opens this store from a second process and applies no schema of its own, so the two reader views exist only because this subsystem created them; that is why they are asserted on every open rather than assumed — mcp-server/src/db.ts:REQUIRED_VIEWS@7c1c1a9 names them and requireViews closes the handle and throws when either is absent. |
| **B-02** | → | **[B-03](b03-knowledge-tools-and-workflow-api.md)** | dependency | structural | index.ts imports roughly forty handler modules from tools/ and hands each the same DB getter, so every knowledge tool writes through the one handle this subsystem owns — read at mcp-server/src/index.ts:main@7c1c1a9 where allTools is assembled and ctx.db is defined as a lazy getter. |
| **B-02** | → | **[B-04](b04-reader-lenses-standing-locus-account-claims-edges-vocabulary.md)** | dependency | structural | The reader-lens tools are registered first in the advertised list, deliberately, because list order is the order a host reads and the consumer route is the one a reader needs first. Read at mcp-server/src/index.ts:allTools@7c1c1a9 which places locusTools ahead of every other group with a comment citing spec section 5.5. |
| **B-02** | → | **[B-06](b06-packaging-installer-and-host-activation.md)** | dependency | structural | Workspace selection depends on the activation subsystem: when the Codex activation contract is set, the launch workspace comes from discoverCodexParentWorkspace rather than from process.cwd, and the startup probe bound the binding code applies is defined there too — mcp-server/src/index.ts:parseArgs@7c1c1a9 imports it from codex-host.js. |
| **[B-07](b07-gates-evidence-custody-and-ci.md)** | → | **B-02** | dependency | observed | The gate that proves the activation path is time-bounded imports this subsystem's modules directly and runs them against a deliberately slow git on PATH, which makes the gate's coverage exactly the set of modules it imports. Read at mcp-server/test-startup-bounds.mjs:imports@7c1c1a9 which loads dist/codex-host.js and dist/project.js and nothing else. |

## Known defects here

3 defects here are open or awaiting verification. Each one's full record, with its evidence, is on [Open findings](../findings.md).

- A git invocation on the server's startup path can block forever. If `git rev-parse --show-toplevel` hangs — a slow network filesystem, an unresponsive credential helper, a very large repository, a stale lock — the server never reaches a usable state and gives no diagnosis, because execFileSync blocks the Node event loop for the whole call. — [B02-R1](../findings.md#b02-r1) · 🟠 HIGH · Open
- The gate that certifies "activation-path probes are time-bounded" passes while an unbounded probe sits on the activation path. Its green is true of what it measured and is read as true of the path. — [B02-R2](../findings.md#b02-r2) · 🟡 MEDIUM · Open
- The server tells every host it is 0.2.0-beta.1 while the package it is built from is 0.2.0-beta.2. A user cannot determine which version they are running, and a bug report naming the version names the wrong one. — [B02-R3](../findings.md#b02-r3) · 🟡 MEDIUM · Open

## Standing

**Mapped** — Survey complete through structural analysis, concern review, and adversarial challenge. It cannot justify that the reading is current at the repository head.

| Metric | Value |
|---|---|
| Files read | 8 of 8 ledger rows |
| Files in scope, not yet read | 0 of 8 |
| Files excluded from the survey obligation | 0 of 8 |
| Ledger rows the repository has changed under | 0 of 8 |
| Active concerns with a disposition recorded here | 25 of 30 — 3 confirmed-bug, 18 confirmed-acceptable, 1 ruled-out, 3 out-of-scope |
| Findings by resolution state | 3 open |
| Seams assessable from both sides | 5 of 5 |

## Survey record

### File ledger

| Path | Classification | Why in scope | Examined at |
|---|---|---|---|
| <a id="le-28d2d6d8a8"></a>`mcp-server/src/db.ts` | examined | Owns the SQLite handle, the schema application, the additive and vocabulary migrations, the required-view assertion, and the WAL checkpoint that precedes a storage commit. | `7c1c1a9f` |
| <a id="le-f9885d1938"></a>`mcp-server/src/helpers.ts` | examined | The shared vocabulary every handler uses: ToolError, jsonResult, ServerContext, revision resolution, and workspace path/citation validation. | `7c1c1a9f` |
| <a id="le-813b71c1ac"></a>`mcp-server/src/index.ts` | examined | The entry point: argument and workspace selection, the tool registry, Ajv validation, and the CallTool dispatch loop. Every other module is reached from here. | `7c1c1a9f` |
| <a id="le-f53441642b"></a>`mcp-server/src/invariants.ts` | examined | The knowledge-depth gates and phase prerequisites that decide which status advances are legal. | `7c1c1a9f` |
| <a id="le-97fd8ef43b"></a>`mcp-server/src/project.ts` | examined | Turns a workspace into a bound project: identity, storage path, containment assertions, the immutable binding receipt, and the time-bounded startup probes. | `7c1c1a9f` |
| <a id="le-9cd5d88c97"></a>`mcp-server/src/schema.sql` | examined | 4746 lines applied on every open. Defines every table, every CHECK-constrained vocabulary, and the derived views the reader surfaces and the materializer depend on. | `7c1c1a9f` |
| <a id="le-df2c09ece6"></a>`mcp-server/src/session.ts` | examined | Session lifecycle: the id every disposition, finding, note and log row is tagged with. | `7c1c1a9f` |
| <a id="le-07c11b6cef"></a>`mcp-server/src/storage-git.ts` | examined | The storage directory's own Git repository — the only recoverable record of a store that the surveyed repository does not track. | `7c1c1a9f` |

### Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[AL-1](../concerns.md#al-1)** | ruled-out | code-verified |  | The long-lived mutable structures here are allTools, the byName Map and the compiled-validator Map, all built once inside main and never exported. The one place a tool definition leaves the process is the ListTools handler, which maps over allTools building a fresh object per tool rather than returning the definitions themselves, so a consumer holds no reference into the registry. Handler arguments arrive as a freshly parsed request object. There is no path by which one call mutates state another call reads. |
| **[AT-1](../concerns.md#at-1)** | confirmed-acceptable | code-verified |  | This subsystem's own multi-statement mutations are transactional where it matters: rebuildTable wraps the whole table rebuild in db.transaction and runs foreign_key_check before the commit, so a rebuild that would leave a violation aborts with the store unchanged, and reset_subsystem's cascade is likewise one transaction. What this subsystem does not do is impose a transaction on handler dispatch — withTransaction is exported for handlers to use, not applied around every call — so per-handler atomicity is [B-03](b03-knowledge-tools-and-workflow-api.md)'s disposition and is recorded there. |
| **[AT-2](../concerns.md#at-2)** | confirmed-acceptable | code-verified |  | The divergence this concern names is closed in the direction that loses data. A wal_checkpoint(TRUNCATE) runs before staging, so committed rows are in memory.db when Git reads it, and a busy or partial checkpoint throws rather than publishing a commit already known to be incomplete. The other direction — a mutation with no commit — is not closed here and cannot be: commit_phase_gate is a call an agent makes, so a session that never checkpoints leaves work only in the untracked store. That is a methodology obligation ([B-01](b01-survey-methodology-and-agent-contracts.md)) rather than a defect in this subsystem, and the skill states it as a hard constraint. |
| **[CC-1](../concerns.md#cc-1)** | out-of-scope | code-verified |  | Nothing in this subsystem is generated. schema.sql is the one file that looks like it should be and deliberately is not: CONTRIBUTING.md records that it is applied to live databases on every open, so rewriting it mechanically would be a migration risk rather than a formatting one, and its CHECK literals are hand-maintained with gen-vocabulary.mjs --check-sql asserting agreement. The generated-artifact concern belongs to [B-04](b04-reader-lenses-standing-locus-account-claims-edges-vocabulary.md) (the vocabulary source and its two generated modules) and [B-06](b06-packaging-installer-and-host-activation.md) (the tool inventory), and is dispositioned there. |
| **[CC-2](../concerns.md#cc-2)** | confirmed-acceptable | code-verified |  | This subsystem's obligation for the derived views is that they exist and are recreated from one definition on every open, and both hold: schema.sql is applied whole on every open and requireViews closes the handle and throws when file_standing or finding_state_current is absent, so a schema that stopped defining one fails the open rather than surfacing later as a refused publish. Whether a view's SELECT agrees with its writers is a separate question that belongs to the subsystems that own those tables ([B-03](b03-knowledge-tools-and-workflow-api.md), [B-04](b04-reader-lenses-standing-locus-account-claims-edges-vocabulary.md)) and is dispositioned there. |
| **[CR-1](../concerns.md#cr-1)** | confirmed-acceptable | code-verified | 🔗 | Two processes bound to one store is a supported configuration, not an accident: linked worktrees share a storage root and one installation serves every repository. What this subsystem provides is WAL, which makes concurrent readers safe against a writer and serializes writers at the SQLite level, plus a per-process binding that cannot silently move. What it does not provide is application-level mutual exclusion — that lives in active_write_locks and is advisory. Acceptable at this level because SQLite's own locking prevents corruption; the residual risk is a lost update between two handlers that each read-modify-write, which is [B-03](b03-knowledge-tools-and-workflow-api.md)'s disposition. Marked linchpin-dependent: the reading rests on the WAL pragma and the binding contract rather than on any observed concurrent run. |
| **[CR-2](../concerns.md#cr-2)** | confirmed-acceptable | code-verified |  | Lazy first use is treated as a contract surface, not an edge case. Twelve initialization boundaries are named as an exported const, each with an afterMutation hook a test can interrupt at. Creation stages into a temporary directory published atomically; an initializer-owner marker retires the claim; incompleteStoreCanRollBack refuses to remove an incomplete store that still holds a database, preserving it for diagnosis rather than deleting evidence. A concurrent second first-use meets the owner marker rather than a half-built directory. |
| **[EP-1](../concerns.md#ep-1)** | confirmed-acceptable | code-verified |  | The multi-file write this subsystem owns is storage creation, and it has a rollback that is reachable and deliberately conservative. Staging goes to a temporary directory published atomically; abandoned stages are cleaned; an incomplete store is removed only when incompleteStoreCanRollBack agrees, and an incomplete store that still holds a database is preserved for diagnosis with an explicit message rather than deleted. Choosing to leave a partial directory rather than destroy a database is the correct asymmetry for a system whose store has no backup remote. |
| **[EP-2](../concerns.md#ep-2)** | confirmed-acceptable | code-verified |  | The dispatcher acquires nothing per call that an error path could fail to release: it asserts the binding, ensures the database, calls the handler, and on any throw returns a structured error rather than propagating. A ToolError becomes a clean refusal; anything else is additionally written to stderr so an unexpected throw is not silently converted into a normal-looking result. Sessions and write locks are handler-level resources, so their release on the error path is [B-03](b03-knowledge-tools-and-workflow-api.md)'s disposition, not this subsystem's. |
| **[ID-1](../concerns.md#id-1)** | confirmed-acceptable | code-verified |  | The identity keys this subsystem mints do carry what distinguishes them. The project key is derived from the repository's remote identity rather than a directory name, the binding receipt carries a workspaceInstanceId and a bindingId digest alongside the canonical root, and the storage marker binds the store to that identity so a directory moved under a different repository fails the identity assertion rather than being adopted. Store generation is the one axis nothing here carries, and its consequence is external — a Pecia foreign reference cannot tell a store from the store that replaced it — so it is recorded against [B-03](b03-knowledge-tools-and-workflow-api.md), which owns the finding ids the reference names. |
| **[ID-2](../concerns.md#id-2)** | confirmed-acceptable | code-verified |  | Every durable write resolves its ref_sha against the bound workspace with git rev-parse --verify &lt;sha&gt;^{commit} and stores the resolved 40-character object name rather than the string as typed, so a later reader comparing by ancestry has a commit rather than a prefix. The resolution is live on every call and explicitly not memoized: the header records that a previous cache was removed rather than repaired, because an amend, rebase or force-fetch can collect a commit inside one process and the only check distinguishing a live commit from a collected one is the same rev-parse the cache existed to avoid. |
| **[IF-1](../concerns.md#if-1)** | out-of-scope | code-verified |  | There is no incremental path in this subsystem to diverge from a full one. The store is opened one way, the schema is applied whole on every open with no partial-application mode, and the migrations are idempotent probes rather than an alternative route. The incremental-versus-clean publish this concern names belongs to [B-05](b05-materializer-human-projection-read-back-html.md). |
| **[IF-2](../concerns.md#if-2)** | out-of-scope | code-verified |  | This subsystem defines the columns staleness is derived from — file_ledger.stale, stale_since, stale_reason, added by migration 3 — but computes no staleness and runs no drift detection. Whether the detector and a full reconciliation agree is a property of the tools that write and read those columns, which is [B-03](b03-knowledge-tools-and-workflow-api.md). |
| **[RL-1](../concerns.md#rl-1)** | confirmed-acceptable | code-verified |  | The handle is intentionally process-lifetime — that is the property the rebuild procedure exists to work around, not a leak. The two places a handle is taken and not kept both release it: requireViews closes before throwing, and index.ts's storage probe opens a candidate and immediately closes it. Subprocesses are synchronous and reaped by execFileSync/spawnSync. The unbounded call recorded under [TB-1](../concerns.md#tb-1) is a liveness defect, not a lifecycle one: the child is still reaped when it eventually exits. |
| **[SC-1](../concerns.md#sc-1)** | confirmed-acceptable | code-verified |  | Assessed from **B-02**'s side. This party exports withTransaction and does not apply it around dispatch, and its survey artifact states that omission explicitly rather than leaving it to be assumed. The gap the seam could have had — each side believing the other wraps the writes — does not exist, because neither side believes it: the handler modules that need atomicity call db.transaction themselves, which is visible in reset_subsystem and in the claim writers. The residual is that a new handler inherits no default, which is a hazard for future code rather than a present violation. |
| **[SC-2](../concerns.md#sc-2)** | confirmed-acceptable | code-verified |  | Assessed from **B-02**'s side. The dispatcher honours the declaration rather than deciding for itself: it serializes compactly when and only when the tool sets compact, with a comment naming the specification clause, so a tool carrying a byte budget has it enforced on the emitted response. The seam's risk was that the budget be computed against one serialization and emitted as another; the two agree because one side declares and the other obeys. |
| **[SC-3](../concerns.md#sc-3)** | confirmed-acceptable | code-verified |  | Assessed from **B-02**'s side. This party does not assume the installer wrote no workspace; it checks. assertWorkspaceMatchesLaunch resolves both the selected and the launch workspace to Git roots and refuses when they differ, with an error naming the stale hard-coded workspace as the likely cause and the deliberately project-scoped registration as the legitimate exception. The escape hatch is explicit rather than implicit — --allow-workspace-pin — so the two sides enforce the same property from opposite ends rather than one trusting the other. |
| **[SC-4](../concerns.md#sc-4)** | confirmed-acceptable | code-verified | 🔗 | Assessed from **B-02**'s side. The two names are declared here and again in the materializer with no shared source, which is a genuine duplication — but it cannot drift silently in the direction that matters. This side asserts the views exist on every open and fails the open if they do not, so a name this side stopped creating would break this side first. The direction that could drift undetected is the reader adding a third required view this side does not create, and the reader's own probe would then refuse the render with a named cause. Both drifts are loud. Marked linchpin-dependent: no drift was induced, and a shared constant across a process boundary is not available, so the duplication is accepted rather than removed. |
| **[SC-9](../concerns.md#sc-9)** | confirmed-acceptable | test-observed | 🔗 | Assessed from **B-02**'s side, same evidence. This party's obligation is to make the store readable and self-describing enough for the other side to compare against a receipt, and it does: last_checked_sha, the binding receipt and the derived views are all readable read-only by a gate holding no handle of its own, which is how the live arm ran against this store while the server was up. What this side cannot do is notice that it has changed — the store has no version counter a receipt could bind to beyond the revision it records. Marked linchpin-dependent: the comparison worked here because the revision differed; two different stores at one revision would not be distinguished. |
| **[SE-1](../concerns.md#se-1)** | confirmed-acceptable | code-verified |  | The contracts this side of [S-01](../seams.md#s-01) and [S-04](../seams.md#s-04) states are enforced here rather than asserted. The views the other party depends on are named in code and proven present on every open; the binding this side promises is re-asserted before every call; the revision a writer records is resolved rather than trusted. The one obligation this side states and does not enforce is atomicity across a handler's writes, and the survey artifact says so explicitly rather than leaving the reader to assume the seam covers it. |
| **[TB-1](../concerns.md#tb-1)** | confirmed-bug | code-verified |  | index.ts:108 gitRoot calls execFileSync("git", ["rev-parse","--show-toplevel"]) with no timeout and no killSignal; execFileSync blocks the Node event loop for the whole call. It is reached four times on the startup path — twice from assertWorkspaceMatchesLaunch (:128, :129), once for a Codex parent workspace (:174), and once at :180 as the default workspace selection taken whenever there is no --workspace argument and no AMANUENSIS_WORKSPACE or CLAUDE_PROJECT_DIR, which is the documented Codex and Claude activation shape. All six subprocess sites in project.ts carry STARTUP_PROBE_TIMEOUT_MS and SIGKILL, so the bound exists and this module was not given it. |
| **[TR-1](../concerns.md#tr-1)** | confirmed-acceptable | code-verified |  | Containment is checked structurally rather than by string prefix. assertContainedPath resolves the root canonically, rejects a target equal to or outside it, then walks every path segment refusing a symbolic link, a non-directory intermediate, and any segment whose realpath leaves the canonical root. assertProjectBinding re-runs containment and a whole-tree symlink assertion before every tool call, so a path that became an escape after startup is caught at use rather than at bind. The residual surface is the model-authored argument reaching a handler, which is [B-03](b03-knowledge-tools-and-workflow-api.md)'s and [B-04](b04-reader-lenses-standing-locus-account-claims-edges-vocabulary.md)'s disposition, not this one's. |
| **[TR-2](../concerns.md#tr-2)** | confirmed-acceptable | code-verified | 🔗 | This subsystem moves stored content but does not interpret or render it: the dispatcher serializes whatever a handler returns into a JSON text block, with no template and no markup. The two places untrusted content could acquire authority are the reader route's prose ([B-04](b04-reader-lenses-standing-locus-account-claims-edges-vocabulary.md)) and the generated HTML ([B-05](b05-materializer-human-projection-read-back-html.md)), and both are dispositioned there. Marked linchpin-dependent because the reading rests on the dispatcher's shape alone; nothing here was tested with hostile stored content. |
| **[VR-1](../concerns.md#vr-1)** | confirmed-bug | code-verified |  | SERVER_VERSION at index.ts:27 is a hand-written literal reading "0.2.0-beta.1" while mcp-server/package.json at the same revision declares "0.2.0-beta.2". Nothing binds them, and the literal is not cosmetic: it goes into the MCP handshake the host sees, into resolveProject, and into every per-process binding receipt. This session's own live receipt reports serverVersion 0.2.0-beta.1 from a checkout that packages as beta.2. README.md:78 and mcp-server/README.md:18 and :118 also say beta.1, and HISTORY.md has no beta.2 entry, so five statements of one fact disagree with no single source and no check. |
| **[ZD-1](../concerns.md#zd-1)** | confirmed-bug | test-observed |  | test-startup-bounds.mjs is the gate for "activation-path probes are time-bounded". Its denominator is the set of modules it imports, and it imports exactly two: dist/codex-host.js and dist/project.js. It never loads dist/index.js and never exercises parseArgs, so the unbounded execFileSync at index.ts:108 — on the same startup path, executed before resolveProject — is outside anything the gate can fail on. This is not a zero denominator but a denominator that excludes the live defect, which is the same failure in a milder form: the gate's green is true of what it measured and is read as true of the path. |

### Survey artifact

#### **B-02** · Server core: repository binding, storage, schema, lifecycle

**Revision read:** `7c1c1a9` · **Layer:** core · **Priority:** 1

##### Scope

`mcp-server/src/` — `index.ts`, `db.ts`, `project.ts`, `helpers.ts`, `invariants.ts`,
`storage-git.ts`, `session.ts`, `schema.sql`. Eight files, all examined.

##### Observed structure

**One handle, taken once.** `db.ts:openDatabase` is the only construction point for the
SQLite connection. It opens the file, sets `journal_mode = WAL` and `foreign_keys = ON`, runs
migrations, applies the whole 4,746-line `schema.sql`, and then asserts that both required
views survived — closing the handle before throwing if either did not. The ordering is
commented as deliberate: migrations precede `schema.sql` so that additive columns exist
before its index statements reference them.

**The store is created lazily.** `index.ts:main` holds `db` as `null` and exposes it through a
getter on the `ServerContext`. The first handler that touches `ctx.db` triggers
`ensureProjectStorage` — which probes with a candidate handle it opens and immediately closes
— and only then takes the real handle. Startup performs no database write. That is the
mechanism behind the activation property the beta claims: one user-scoped installation can
serve a repository it has never entered, with no setup command and no restart.

**Initialization is a named sequence, not a side effect.** `project.ts` exports twelve
`PROJECT_INITIALIZATION_BOUNDARIES`, each with an `afterMutation` hook a test can interrupt
at. Creation stages into a temporary directory and publishes it atomically; an
initializer-owner marker retires the claim; `incompleteStoreCanRollBack` refuses to remove an
incomplete store that still holds a database, preserving it for diagnosis instead.

**Binding is immutable and re-checked.** `resolveProject` writes a
`ProjectBindingReceipt` (`amanuensis-repository-binding/v1`) at startup, and
`assertProjectBinding` re-checks it before every tool call on six independent axes: the four
path and key fields, the workspace's realpath, the repository's identity and key, storage
containment, the absence of any symlink in the storage tree, and storage identity. Drift
raises; it never re-binds. `assertContainedPath` walks each path segment, refusing a symlink,
a non-directory, and anything whose realpath leaves the canonical root.

**Revisions resolve live.** `helpers.ts:requireResolvedSha` runs `git rev-parse --verify
<sha>^{commit}` in the bound workspace on every durable write and stores the resolved
40-character name, not the string as typed. The comment records that a previous version
memoized this and that the cache was removed rather than fixed: an amend, a rebase, or a
force-fetch can collect a commit inside one process, and the only check that distinguishes a
live commit from a collected one is the `rev-parse` the cache existed to avoid.

**Two halves of a checkpoint.** The storage repository ignores the `-wal` and `-shm`
sidecars, so `db.ts:checkpointDatabaseForStorageCommit` forces a `wal_checkpoint(TRUNCATE)`
before staging and treats a busy or partial result as a hard error. Without it a phase commit
could contain the prose a phase wrote while omitting its rows.

**Enum widening reaches existing stores.** `migrateVocabularyChecks` rebuilds a table by
SQLite's documented procedure — inside one transaction, `legacy_alter_table = ON` so dependent
views survive the rename, foreign keys off for the swap, `foreign_key_check` before commit —
and refuses to *narrow*: a live value the source no longer declares leaves the table alone.
Which columns to rebuild is read from the contract's own SQL bindings, so there is no second
list to drift.

##### Concurrency model

Within a process: a single writer, one handle, WAL. Across processes: weaker, and
deliberately so. Several servers can be bound to different repositories at once, and linked
worktrees of one repository share a storage root, so two processes can hold handles to one
store. Cross-process exclusion is **advisory** — expressed in `active_write_locks`, which a
writer must choose to consult — not structural. The startup path is synchronous by choice;
the answer to `execFileSync` blocking the event loop is a per-call time bound, not asynchrony.

##### Seam contract offered ([S-01](../seams.md#s-01))

One `DB` object, already migrated, schema applied, both required views proven present,
foreign keys on, WAL. A handler may assume every table and view it names exists, because an
open that could not establish that threw instead of returning. What this side does **not**
offer is a transaction boundary: `withTransaction` is exported for a handler to use, not
applied around dispatch. Atomicity across a handler's several writes is the handler's
obligation.

##### Inference, separated from observation

The cross-process concurrency reading above is an **inference**, not a reading: it is derived
from the binding model and the presence of an advisory lock table, not from an observed race.
Nothing here was executed under contention.

##### Open

Whether the advisory lock table is actually consulted by the writers that need it is [B-03](b03-knowledge-tools-and-workflow-api.md)'s
question, not this subsystem's — recorded as seam [S-01](../seams.md#s-01)'s obligation.
