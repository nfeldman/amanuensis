# **B-02** — MCP core, persistence, and lifecycle

**Status**: 🟡 adversarial  
**Layer**: Runtime

## Scope

No purpose statement is recorded for this subsystem; the scope below states what it covers.

mcp-server/src/*.ts and schema.sql — the server root modules, the storage lifecycle, the invariants

## Start here

mcp-server/src/index.ts; src/db.ts; src/schema.sql; src/invariants.ts

## Structure

What the survey recorded as claims about this subsystem, grouped by what each one states. Every claim is bound to the revision it was asserted at and to the evidence attached to it; a superseded claim is not shown here.

### Other claims

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-02/identity/binding-is-re-derived-per-call` | `B-02` | Scope identity is re-derived and re-asserted on every tool call rather than trusted from process start: assertProjectBinding recomputes the project descriptor, compares it against the receipt minted at resolveProject, and requires the bound storage path to remain inside the storage root. Two worktrees of one repository therefore share a projectKey but hold distinct worktree-local stores with distinct workspaceInstanceId values, which is the ordinary case here rather than the exotic one. | Observation | `c0734040022f` |
| `B-02/recoverability/checkpoint-is-a-caller-obligation` | `B-02` | The WAL checkpoint that makes a storage commit recoverable is a caller obligation, not a property of the function that publishes the commit. commitStorage stages and commits without checkpointing; both call sites — end_session and commit_phase_gate — call checkpointDatabaseForStorageCommit immediately before it, and that function treats a busy or partial checkpoint as a hard failure. A third caller added without the checkpoint would reintroduce archived finding B02-1 with nothing in storage-git.ts to stop it. | Inference | `c0734040022f` |
| `B-02/storage-lifecycle/open-is-the-only-migration-path` | `B-02` | openDatabase is the only path by which a store's schema changes: it runs additive column/index migrations, re-execs the whole of schema.sql (546 of 547 CREATE statements carry IF NOT EXISTS), mints the store identity if absent, and then refuses the open when any declared object is missing or present as the wrong kind, or when either required view is absent. No table arrives, and no store is left partially upgraded, outside that sequence. | Observation | `c0734040022f` |
| `B-05/contracts/generate-or-assert-every-duplicated-fact` | `B-05` | The checker set in mcp-server/scripts/ is organized around one rule: a fact published twice is either generated from one source or asserted against it. gen-vocabulary.mjs generates two enum modules and asserts the schema's CHECKs; gen-tool-inventory.mjs generates DEVELOPMENT.md's block and --check refuses a divergence; check-refusal-parity.mjs cannot generate prose so it generates the candidate refusal set and compares that against a register; check-concern-checklist.mjs holds the calibrated checklist to its contract. Where a duplicated fact has neither a generator nor an assertion, it drifts — which is what B05-2 is. | Inference | `c0734040022f` |

## Vocabulary

- **independent storage mode** — The .storage-mode marker that makes a project-local .amanuensis/ its own nested git repository and forbids it from ever falling through to the surveyed repository's git.
- **store generation** — The random 32-hex identity a store mints once, at the open that creates store_identity, and never recomputes — the name a carried record calls the conspectus it came out of.

## Known defects here

2 defects here are open or awaiting verification. Each one's full record, with its evidence, is on [Open findings](../findings.md).

- A durable write can block the server indefinitely. Every add_evidence, add_finding, add_claim and set_disposition shells out to `git rev-parse` synchronously with no timeout, so an unresponsive git — a network-mounted worktree, a credential helper waiting on input, a filesystem that has stopped answering — hangs the whole stdio server with no diagnostic, because spawnSync blocks the event loop and the transport is single-threaded. — [B02-R1](../findings.md#b02-r1) · 🟡 MEDIUM · Open
- A stalled git subprocess during server startup hangs the MCP server indefinitely, with no timeout and no diagnosis, on every start that selects its workspace from an argument or the environment — which is the registration Claude Code writes. — [B02-R2](../findings.md#b02-r2) · 🟡 MEDIUM · Open

## Standing

**Adversarial** — Candidate conclusions are being challenged; treat them as provisional. It cannot justify that the challenge pass has finished.

| Metric | Value |
|---|---|
| Files read | 13 of 13 ledger rows |
| Files in scope, not yet read | 0 of 13 |
| Files excluded from the survey obligation | 0 of 13 |
| Ledger rows the repository has changed under | 0 of 13 |
| Active concerns with a disposition recorded here | 12 of 12 — 8 confirmed-acceptable, 3 ruled-out, 1 out-of-scope |
| Findings by resolution state | 2 open |
| Seams assessable from both sides | no seam names this subsystem |

## Survey record

### File ledger

| Path | Classification | Why in scope | Examined at |
|---|---|---|---|
| <a id="le-b9dab6dc2d"></a>`mcp-server/src/cli.ts` | examined | The installer and doctor: registration planning for Claude, VS Code and Codex, the managed config blocks, and the repair plans. | `c0734040` |
| <a id="le-ca9a153bd6"></a>`mcp-server/src/codebase-brief-contract.ts` | examined | The codebase-brief schema, its canonical JSON hashing, and the compile/validate pair the brief tools call. | `c0734040` |
| <a id="le-fcffcd1e95"></a>`mcp-server/src/codex-host.ts` | examined | Codex parent-workspace discovery, with the 5s probe timeout that finding B02-2 is about. | `c0734040` |
| <a id="le-28d2d6d8a8"></a>`mcp-server/src/db.ts` | examined | Storage lifecycle: openDatabase runs migrations, re-execs schema.sql, mints store identity, then refuses the open when a declared object or required view is absent. | `c0734040` |
| <a id="le-f9885d1938"></a>`mcp-server/src/helpers.ts` | examined | The shared ingress guards: resolveWorkspaceCommit, the batched resolveWorkspaceCommits, path and citation validation, and the response envelope every budget is measured on. | `c0734040` |
| <a id="le-813b71c1ac"></a>`mcp-server/src/index.ts` | examined | Server root: workspace selection, tool assembly, Ajv validation, annotation derivation, and the single dispatcher that enforces each tool's compact flag. | `c0734040` |
| <a id="le-f53441642b"></a>`mcp-server/src/invariants.ts` | examined | Every status-advance refusal: phase prerequisites, attached-evidence, vocabulary discharge, reconciliation standing, archived store identity, and the carried accounting. | `c0734040` |
| <a id="le-97fd8ef43b"></a>`mcp-server/src/project.ts` | examined | Project identity, the binding receipt, the storage root containment check, and the staged atomic publish of a new store. | `c0734040` |
| <a id="le-9cd5d88c97"></a>`mcp-server/src/schema.sql` | examined | The durable substrate: 547 CREATE statements, 546 of them IF NOT EXISTS, and 176 immutability trigger lines that make the append-only tables append-only. | `c0734040` |
| <a id="le-df2c09ece6"></a>`mcp-server/src/session.ts` | examined | The session table's three operations; the smallest module in the subsystem and the one every write's session_id comes from. | `c0734040` |
| <a id="le-9e2f6e715c"></a>`mcp-server/src/standing.ts` | examined | The reader-lens standing model: locus resolution, the standing ladder, the authority ceiling, and the revision and measured blocks describe_locus answers from. | `c0734040` |
| <a id="le-07c11b6cef"></a>`mcp-server/src/storage-git.ts` | examined | The storage repository: repoState's six starting states, ensureStorageRepo, and commitStorage, which stages and commits without checkpointing the WAL itself. | `c0734040` |
| <a id="le-0dc42cdab7"></a>`mcp-server/src/vocabulary.ts` | examined | Generated from contracts/conspectus-vocabulary.json — the single source for every enum, the obligation-bearing split, and the SQL CHECK bindings. | `c0734040` |

### Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[AT-1](../concerns.md#at-1)** | confirmed-acceptable | code-verified |  | This subsystem's own multi-statement mutation is the open sequence, and it is atomic in the sense that matters: a partial apply is a refused open, not a returned handle. requireSchemaObjects closes the database and throws when any of the 547 declared objects is absent or of the wrong kind, and requireViews does the same for the two views the materializer reads. Transactional atomicity of domain writes belongs to the tool handlers ([B-03](b03-knowledge-tools-and-workflow-api.md)) rather than here; add_files_to_scope's batch, for instance, runs inside ctx.db.transaction. |
| **[AT-2](../concerns.md#at-2)** | confirmed-acceptable | code-verified | 🔗 | Archived finding B02-1 is repaired and the repair holds at this revision: both callers of commitStorage checkpoint with wal_checkpoint(TRUNCATE) first, and a busy or partial checkpoint throws rather than publishing a commit already known to be incomplete. Acceptable rather than ruled out because the invariant lives in the two call sites, not in commitStorage: a third caller would reintroduce the defect silently. Linchpin-dependent on the claim that those two are the only callers, which grep over src/ confirms at this revision and nothing enforces. |
| **[CC-1](../concerns.md#cc-1)** | confirmed-acceptable | code-verified | 🔗 | The derived surfaces this subsystem owns are SQL views, which are computed at read time and cannot lag their base rows. The coherence risk is the opposite one: a view that stops being defined. REQUIRED_VIEWS names the two the materializer opens read-only and asserts them on every open, and requireSchemaObjects now covers the other 545 declared objects, so the materializer's probe is a statement about the store's age rather than about a schema that silently stopped defining them. Linchpin-dependent because the list of views a downstream reader needs is maintained here by hand: a third view the materializer comes to depend on would not be asserted until someone adds it. |
| **[CR-1](../concerns.md#cr-1)** | confirmed-acceptable | code-verified | 🔗 | Concurrency here is cross-process, not in-process: handlers are synchronous better-sqlite3 calls with no await inside one. The two shared objects are the SQLite file (WAL, single writer, later writers block) and the storage git index. The git path is scoped deliberately — 'add -A .' and 'commit -- .' limit staging to the storage directory so two surveys sharing an outer cloud-mode repository cannot entangle. Acceptable rather than ruled out: two processes opening the *same* worktree-local store would still contend on the storage git index, and nothing here serializes that. On this machine lanes run against sibling worktrees with distinct stores, so the case is not reachable as configured, which is a property of the configuration rather than of the code. |
| **[EP-1](../concerns.md#ep-1)** | confirmed-acceptable | code-verified |  | The dispatcher's error path is total: a ToolError becomes {ok:false,error} and any other throw is logged to stderr and returned the same way, so no handler failure crashes the transport. Validation runs before the handler, so a malformed call reaches no write. Storage git degrades rather than throwing: ensureStorageRepo returns {ok:false,reason} when git is absent or .git is malformed, and commitStorage treats 'not a git repo' as a no-op. The one deliberate hard failure is checkpointDatabaseForStorageCommit, which must throw rather than publish an incomplete commit. |
| **[IF-1](../concerns.md#if-1)** | out-of-scope | code-verified |  | Incremental-versus-full parity is a property of the materializer's rendering paths ([B-04](b04-diff-aware-materializer.md)), which this subsystem neither implements nor calls. The nearest thing here is schema application, and it has no incremental mode: initializeSchema re-execs the whole file on every open, which is the full path every time. Recorded as out-of-scope rather than ruled out so the concern stays owned by [B-04](b04-diff-aware-materializer.md), where the probe can actually be run. |
| **[RL-1](../concerns.md#rl-1)** | confirmed-acceptable | code-verified | 🔗 | The handles this subsystem owns are the database and its child processes. The refusal paths close the database explicitly before throwing (requireSchemaObjects and requireViews both call db.close() first), and ensureProjectStorage's probe opens a candidate store and closes it. Every child process is spawnSync or execFileSync, so nothing is left running past the call; the two probes that could hang — the Codex parent ps and the git origin read — carry STARTUP_PROBE_TIMEOUT_MS with SIGKILL. Acceptable rather than ruled out: the long-lived db handle held in the ServerContext closure is never closed on process exit, which is harmless for a stdio server the host tears down but is not a released resource. |
| **[SC-1](../concerns.md#sc-1)** | confirmed-acceptable | code-verified | 🔗 | The two seams this side owns are compared by a checker rather than by prose. src/vocabulary.ts carries a generated-file banner and is written by scripts/gen-vocabulary.mjs from contracts/conspectus-vocabulary.json, with --check and --check-sql in CI so a copy or a SQL CHECK that diverges fails the build; helpers.ts re-exports the obligation split from that module rather than restating it, for the stated reason that a second definition is a second place to drift. Acceptable rather than ruled out because the store-facing half is weaker: migrateVocabularyChecks is what carries a widened enum into an existing store, and whether it has run is not asserted on open the way a declared object is. |
| **[SI-1](../concerns.md#si-1)** | ruled-out | code-verified |  | Two checkouts of this repository cannot be conflated and a store cannot be placed outside the storage root. The binding receipt carries projectKey, canonicalRoot, workspaceInstanceId (a hash of the absolute workspace path) and storageRoot; assertProjectBinding re-derives the descriptor on every call and compares all of them, and assertContainedPath refuses a storagePath outside storageRoot. This worktree and the primary checkout share a projectKey and hold distinct worktree-local stores — the ordinary case here — and the lane's own run exercises the separation. |
| **[SI-2](../concerns.md#si-2)** | ruled-out | code-verified |  | Every revision a durable write accepts is resolved against the bound workspace at the moment of the write, stored as the full 40-character object name, and re-resolved by readers rather than trusted. The cache that would have broken this was removed for the stated reason that revalidating it costs what not caching costs; the batched form pays one subprocess for a whole recorded set and reports an unreachable revision as unresolvable rather than trusting it. |
| **[TB-1](../concerns.md#tb-1)** | confirmed-acceptable | code-verified | 🔗 | The blocking calls made before the server can serve anything are bounded: the Codex parent 'ps' and the git origin read both carry STARTUP_PROBE_TIMEOUT_MS (5s) with killSignal SIGKILL, and both degrade to a fallback on expiry rather than failing activation — which is what archived finding B02-2 asked for. Acceptable rather than ruled out because the per-write 'git rev-parse' in resolveWorkspaceCommit carries no timeout at all: it is execFileSync-shaped and blocks the event loop, so a wedged git on a slow filesystem stalls a durable write with nothing to diagnose. That path is not a startup probe, so the constant does not reach it. |
| **[TR-1](../concerns.md#tr-1)** | ruled-out | code-verified |  | The model-facing trust boundary is enforced at ingress rather than at use: absolute paths, Windows drive paths, and any segment equal to '..' are refused, and a first segment of '.amanuensis' is refused by name so tool state cannot be cited as source evidence. Commit labels are passed on stdin via 'git commit -F -' and bounded to one line of 500 characters, so message content cannot become arguments. |

### Survey artifact

#### **B-02** — MCP core, persistence, and lifecycle

Structural account, read at `c073404`. Scope: `mcp-server/src/*.ts` and `src/schema.sql` —
the server root, the storage lifecycle, the invariants.

##### Observed

**One open, five steps.** `openDatabase` (`db.ts:66-79`) runs `runMigrations`, then
`initializeSchema`, then `mintStoreIdentity`, then `requireSchemaObjects`, then
`requireViews`. Migrations are additive column and index changes guarded by
`hasTable`/`hasColumn` probes, so they are no-ops on a fresh store;
`initializeSchema` re-execs the whole of `schema.sql`, which is written with
`CREATE ... IF NOT EXISTS` throughout (546 of 547 statements). `requireSchemaObjects`
then parses the schema's own `CREATE` statements and refuses the open when a declared
object is absent or present as another kind — the guard that turns a silent
`CREATE TABLE IF NOT EXISTS` no-op over a name already held by a view into a refused
open rather than a downstream read failure.

**Identity is minted, not derived.** `store_identity` holds one row with a random
32-hex `store_generation`, written `INSERT OR IGNORE` so the mint happens once and an
existing populated store gains one the first time it is opened under this schema. The
immutability trigger is on UPDATE and DELETE, so re-opening is a no-op rather than a
refusal.

**Recoverability is a caller obligation.** `commitStorage` (`storage-git.ts:228`)
stages `-A .` and commits with `-F -`, scoped to the storage directory so two
concurrent surveys sharing an outer repository cannot entangle. It does not checkpoint.
`checkpointDatabaseForStorageCommit` (`db.ts:492`) runs `wal_checkpoint(TRUNCATE)` and
throws on a busy or partial result. Both callers — `end_session`
(`tools/project.ts:98`) and `commit_phase_gate` (`tools/storage-history.ts:32`) —
call it immediately before the commit.

**Every durable write resolves its revision live.** `resolveWorkspaceCommit`
(`helpers.ts:127`) shells `git rev-parse --verify <sha>^{commit}` in the bound
workspace on every call and stores the resolved 40-character name. Nothing is
memoized, because the only check that distinguishes a live commit from a collected
one is the call the cache would avoid. `resolveWorkspaceCommits` is the batched form
for writers that read a whole recorded set — one `git cat-file --batch-check` rather
than N subprocesses.

**The trust boundary is at ingress.** `requireWorkspaceSourcePath` refuses absolute
paths, `..` traversal, and any path whose first segment is `.amanuensis`, so the
conspectus cannot become evidence about itself.

##### Concurrency model

Single-process, synchronous `better-sqlite3` over a WAL database; there is no async
inside a tool handler. Cross-process concurrency is real and is handled outside this
subsystem (the lock table, and the storage git repository's own index). Sibling
worktrees on this machine run lanes concurrently against *distinct* stores, which the
worktree-local storage policy is what makes safe.

##### Seam contracts from this side

- **memory.db** — written here, read `mode=ro` by the materializer ([B-04](b04-diff-aware-materializer.md)). This side
  owns the schema; `REQUIRED_VIEWS` names the two views the reader depends on and
  asserts them on every open.
- **contracts/conspectus-vocabulary.json** — read by the generator that writes
  `src/vocabulary.ts` and the Python twin. This side consumes the generated module;
  it never re-declares an enum.
- **the storage git repository** — written here by `commitStorage`, read by
  `get_storage_history` and by anything that clones a phase gate.

##### Open

Nothing in `storage-git.ts` obliges a future caller of `commitStorage` to checkpoint
first; the invariant lives in two call sites. Recorded as claim `B02-C2` and disposed
under [AT-2](../concerns.md#at-2).
