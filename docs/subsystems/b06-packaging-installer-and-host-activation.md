# **B-06** — Packaging, installer, and host activation

**Status**: 🟢 mapped  
**Layer**: distribution

## Scope

No purpose statement is recorded for this subsystem; the scope below states what it covers.

mcp-server/src/cli.ts, mcp-server/src/codex-host.ts, mcp-server/scripts/ (prepack-bundle-assets.mjs, ensure-built.mjs, gen-tool-inventory.mjs, gen-vocabulary.mjs, check-*.mjs, historical-evaluation.mjs), mcp-server/package.json, mcp-server/contracts/activation-parity.schema.json, mcp-server/fixtures/activation/

## Start here

mcp-server/src/cli.ts — install, doctor, repair, upgrade, rollback, uninstall for each client adapter; then codex-host.ts for parent-workspace discovery.

## Structure

What the survey recorded as claims about this subsystem, grouped by what each one states. Every claim is bound to the revision it was asserted at and to the evidence attached to it; a superseded claim is not shown here.

### Key types

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-06/key-type/mcp-server-src-codex-host-ts-startup-probe-timeout-ms` | `mcp-server/src/codex-host.ts:STARTUP_PROBE_TIMEOUT_MS` | The activation-path time bound is a single exported constant of 5000 milliseconds, defined in this subsystem and applied here and at all six subprocess sites in project.ts, each with killSignal SIGKILL. It is the repository's answer to a synchronous startup path: the calls stay blocking and are bounded rather than being made asynchronous. The constant is exported and one import away from index.ts, which does not use it — so the bound's coverage is a matter of which modules chose to import it rather than of where the boundary is. | Observation | `7c1c1a9f5689` |

### Flow steps

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-06/flow/digest-bound-repair/01` | `mcp-server/src/cli.ts:doctorReport` | Repairing host configuration is diagnosis-first and dry-run-first, and the two halves are bound together by a digest. `doctor` reports diagnoses each carrying a remediation; `--repair --dry-run` emits a plan bound to a digest of the configuration it inspected; `--apply-plan &lt;id&gt;` applies only that exact plan, so configuration that changed between diagnosis and repair is refused rather than rewritten under a stale reading. Every mutating action pushes a timestamped backup action ahead of itself, and configuration Amanuensis does not manage is reported with a remediation rather than rewritten. | Observation | `7c1c1a9f5689` |

### Concurrency invariants

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-06/concurrency` | `B-06` | The installer is a short-lived single-threaded CLI with no concurrency of its own, and it records that rather than omitting the category. Its exposure is interleaving with a human or another tool editing the same host configuration file, and that is addressed not by locking but by the digest: a plan is bound to the bytes it was computed from and refuses to apply against different bytes. The one shared resource it creates is the user-scoped MCP registration that every subsequent server process reads, which is the [S-03](../seams.md#s-03) seam. | Inference | `7c1c1a9f5689` |

### Seam contracts

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-06/seam/S-03` | `S-03` | From this side, what [S-03](../seams.md#s-03) writes is a launch command and a scope, and deliberately not a workspace. A user-scoped Codex registration launches the server with no hard-coded repository path, so binding is decided by the cwd the host happens to be in, which is what lets one installation serve every repository. The installer therefore treats an explicit workspace argument in an existing registration as a diagnosis — inspectCodexRegistration and hasExplicitWorkspaceArgument exist to find one — rather than as configuration to preserve. What this side cannot guarantee is that the host launches in the directory the user means; that is the server's cwd resolution, and the trust state Codex keeps is a host-side effect outside the managed surface. | Observation | `7c1c1a9f5689` |

## Boundaries

### Seams

| Seam | Shared object | Other party | Assessable |
|---|---|---|---|
| **[S-03](../seams.md#s-03)** | Host MCP configuration and the cwd the server is launched in (Codex config.toml, Claude .mcp.json, VS Code mcp.json) | **[B-02](b02-server-core-repository-binding-storage-schema-lifecycle.md)** | both parties are `mapped` |

### Recorded edges

| From | → | To | Relationship | Strength | Context |
|---|---|---|---|---|---|
| **B-06** | → | **[B-01](b01-survey-methodology-and-agent-contracts.md)** | data-flow | structural | The installer copies the skill into each host's skill directory, so the methodology a host executes is a packaged copy of this repository's prose and can be a different version from the checkout that produced it. Read at mcp-server/src/cli.ts:findBundledSkill@7c1c1a9 which resolves the bundled skill source the install and upgrade paths walk. |
| **[B-02](b02-server-core-repository-binding-storage-schema-lifecycle.md)** | → | **B-06** | dependency | structural | Workspace selection depends on the activation subsystem: when the Codex activation contract is set, the launch workspace comes from discoverCodexParentWorkspace rather than from process.cwd, and the startup probe bound the binding code applies is defined there too — mcp-server/src/index.ts:parseArgs@7c1c1a9 imports it from codex-host.js. |

## Known defects here

No defect here is open or awaiting verification.

## Standing

**Mapped** — Survey complete through structural analysis, concern review, and adversarial challenge. It cannot justify that the reading is current at the repository head.

| Metric | Value |
|---|---|
| Files read | 11 of 12 ledger rows |
| Files in scope, not yet read | 1 of 12 |
| Files excluded from the survey obligation | 0 of 12 |
| Ledger rows the repository has changed under | 0 of 12 |
| Active concerns with a disposition recorded here | 21 of 30 — 1 confirmed-bug, 12 confirmed-acceptable, 1 ruled-out, 7 out-of-scope |
| Findings by resolution state | none recorded |
| Seams assessable from both sides | 1 of 1 |

## Survey record

### File ledger

| Path | Classification | Why in scope | Examined at |
|---|---|---|---|
| <a id="le-a461982e45"></a>`mcp-server/scripts/historical-evaluation.mjs` | candidate | The historical-evaluation instrument. Read for shape only. | `7c1c1a9f` |
| <a id="le-abf65fa2bb"></a>`mcp-server/contracts/activation-parity.schema.json` | examined | The declared shape of a source-versus-packed parity result. | `7c1c1a9f` |
| <a id="le-2baed44e78"></a>`mcp-server/package.json` | examined | Declares the package version — one of the five places the version is stated, and the one that disagrees with the other four. | `7c1c1a9f` |
| <a id="le-cc326c9bae"></a>`mcp-server/scripts/check-evidence-vocabulary.mjs` | examined | Holds SKILL.md's hand-written evidence ladder to the vocabulary source. | `7c1c1a9f` |
| <a id="le-2f3c48c5f7"></a>`mcp-server/scripts/check-sql-identifiers.mjs` | examined | Asserts every SQL identifier the handlers use resolves against schema.sql. | `7c1c1a9f` |
| <a id="le-16fc8071b7"></a>`mcp-server/scripts/check-tool-schemas.mjs` | examined | Asserts every tool inputSchema is valid JSON Schema. | `7c1c1a9f` |
| <a id="le-52507995f6"></a>`mcp-server/scripts/ensure-built.mjs` | examined | The build guard the packaged entry points depend on. | `7c1c1a9f` |
| <a id="le-791d96e38a"></a>`mcp-server/scripts/gen-tool-inventory.mjs` | examined | Generates DEVELOPMENT.md's tool inventory from the running server and fails CI on drift. | `7c1c1a9f` |
| <a id="le-8adf21ac82"></a>`mcp-server/scripts/gen-vocabulary.mjs` | examined | Generates both vocabulary modules and asserts the SQL CHECK literals agree. | `7c1c1a9f` |
| <a id="le-96d8069a30"></a>`mcp-server/scripts/prepack-bundle-assets.mjs` | examined | Regenerates the gitignored skill and materializer mirrors at npm pack time — the packed-versus-source parity surface. | `7c1c1a9f` |
| <a id="le-7962bc612b"></a>`mcp-server/src/cli.ts` | examined | 1494 lines: install, init, doctor, repair, upgrade, rollback and uninstall for the Claude, Codex and VS Code adapters, with the dry-run and backup machinery. | `7c1c1a9f` |
| <a id="le-e3284e0308"></a>`mcp-server/src/codex-host.ts` | examined | Codex parent-workspace discovery and the STARTUP_PROBE_TIMEOUT_MS constant the binding code imports. | `7c1c1a9f` |

### Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[AL-1](../concerns.md#al-1)** | ruled-out | code-verified |  | A one-shot CLI process with no long-lived shared state. Parsed configuration is read into fresh objects per command and compared through canonicalJson and sameJson rather than by mutating and re-reading, and the plan is built as a list of actions rather than by editing a shared document in place. |
| **[AT-1](../concerns.md#at-1)** | out-of-scope | code-verified |  | No database mutation happens here. The file-write atomicity question is [EP-1](../concerns.md#ep-1)'s and is dispositioned there. |
| **[AT-2](../concerns.md#at-2)** | out-of-scope | code-verified |  | Nothing here commits to the storage repository or checkpoints a WAL. |
| **[CC-1](../concerns.md#cc-1)** | confirmed-acceptable | code-verified |  | Every generated artifact this subsystem produces has a paired --check that fails CI: the tool inventory is regenerated from the running server's tools/list response, both vocabulary modules from the JSON source, the SQL CHECK literals asserted against the same source, SKILL.md's evidence ladder held to it independently, and the packed skill and materializer mirrors regenerated at pack time from the repo-root sources and gitignored so they cannot be edited in place. The exception is the version, dispositioned under [VR-1](../concerns.md#vr-1). |
| **[CC-2](../concerns.md#cc-2)** | out-of-scope | code-verified |  | No SQL view or dashboard counter is defined or derived here; the installer never opens the store. |
| **[CR-1](../concerns.md#cr-1)** | confirmed-acceptable | code-verified | 🔗 | The race that matters is a human or another tool editing the same host configuration between diagnosis and repair, and the digest closes it: a plan bound to the bytes it was computed from refuses to apply against different bytes. That is optimistic concurrency with detection rather than a lock, which is the right shape for a file the CLI does not own. Marked linchpin-dependent — no interleaved run was performed. |
| **[CR-2](../concerns.md#cr-2)** | out-of-scope | code-verified |  | The installer never creates a store; lazy first use is entirely [B-02](b02-server-core-repository-binding-storage-schema-lifecycle.md)'s, and keeping the installer out of it is the property that makes activation setup-free. |
| **[EP-1](../concerns.md#ep-1)** | confirmed-acceptable | code-verified | 🔗 | Every mutating action is preceded by a timestamped backup action in the same plan, plans are computed whole before anything is written, and unmanaged configuration is reported rather than rewritten. Marked linchpin-dependent because no partial apply was induced during this pass; the interruption evidence lives in [B-07](b07-gates-evidence-custody-and-ci.md)'s committed lifecycle receipts. |
| **[EP-2](../concerns.md#ep-2)** | confirmed-acceptable | code-verified | 🔗 | The plan-then-apply shape means the error path is mostly "no plan, nothing written": diagnosis and planning are pure, and a refusal happens before any mutation. Where mutation has begun, the backup action precedes it, so the recovery material exists on the failure path by construction rather than by a catch block remembering to make it. Marked linchpin-dependent because no partial apply was induced. |
| **[ID-1](../concerns.md#id-1)** | confirmed-acceptable | code-verified | 🔗 | The identity this subsystem manages is the registration's scope, and it keeps the distinction the concern is about: a user-scoped entry deliberately carries no repository, a project-scoped one does, and canonicalGitRoot resolves a path to a canonical root rather than comparing strings. The failure mode this concern names — one identity standing in for several contexts — is what a user-scoped registration is designed to do safely, with the per-process binding receipt supplying the missing context at launch. Marked linchpin-dependent: this reading rests on the two subsystems agreeing, and only the installer's side was read here. |
| **[ID-2](../concerns.md#id-2)** | out-of-scope | code-verified |  | Nothing here records a revision-bound observation. The installer writes configuration and reads files; the revisions this concern is about are the conspectus's. |
| **[IF-1](../concerns.md#if-1)** | confirmed-acceptable | code-verified | 🔗 | The divergence this subsystem can have is not incremental-versus-full but source-checkout-versus-packed-package, and it is treated as a first-class contract: the skill and materializer mirrors are regenerated at pack time from the repo-root sources and gitignored so they cannot be edited in place, and there is a declared parity contract plus a dedicated lifecycle parity gate. Marked linchpin-dependent because that gate needs registry access and was not run in this pass. |
| **[IF-2](../concerns.md#if-2)** | out-of-scope | code-verified |  | No staleness is derived or read here; the installer never opens the store. |
| **[RL-1](../concerns.md#rl-1)** | confirmed-acceptable | code-verified | 🔗 | A short-lived CLI: no database handle, no long-lived process, subprocesses synchronous and reaped. The resources with an asymmetric lifetime are the timestamped backups it leaves behind, which are deliberate durable artifacts rather than leaks. Marked linchpin-dependent because uninstall's cleanup was read rather than exercised. |
| **[SC-3](../concerns.md#sc-3)** | confirmed-acceptable | code-verified | 🔗 | Assessed from **B-06**'s side, same evidence. This party detects the mirror condition: inspectCodexRegistration and hasExplicitWorkspaceArgument exist to find a registration carrying a workspace and report it as a diagnosis with a digest-bound repair. So a stale pin is caught by the installer at diagnosis time and by the server at launch time, independently. Marked linchpin-dependent because the end-to-end agreement was read across two modules rather than exercised; [B-07](b07-gates-evidence-custody-and-ci.md)'s activation-contract gate is what exercises it and was not run in this pass. |
| **[SE-1](../concerns.md#se-1)** | confirmed-acceptable | code-verified | 🔗 | The [S-03](../seams.md#s-03) contract is stated on this side and checked on this side: the registration must carry no explicit workspace, and inspectCodexRegistration plus hasExplicitWorkspaceArgument exist to detect one and report it as a diagnosis. The server enforces the matching half by refusing a workspace argument that disagrees with the launch directory. Both ends therefore have a mechanical check on the same property, which is what this concern asks for. Marked linchpin-dependent because agreement was read across two modules rather than exercised end to end here; [B-07](b07-gates-evidence-custody-and-ci.md)'s activation-contract gate is what exercises it. |
| **[TB-1](../concerns.md#tb-1)** | confirmed-acceptable | code-verified |  | The bound is defined and applied here, and codex-host.ts's own probe carries it with a SIGKILL. cli.ts's three subprocess calls have no timeout, but the CLI is a foreground command a user ran and can interrupt, not a server a host is waiting on, so an unbounded call there costs a hung terminal rather than a product that never becomes ready. The defect this concern names is live at index.ts and is filed as B02-R1; on this subsystem's own surface the bound exists and is applied where it matters. |
| **[TR-1](../concerns.md#tr-1)** | confirmed-acceptable | code-verified | 🔗 | The CLI writes into directories a user owns, so path containment matters more here than anywhere else, and assertSafeRootPath plus isWithin guard the destinations. The values it handles come from a human on a command line rather than from a model, which is a weaker threat model than the server's. Marked linchpin-dependent because the uninstall and rollback paths, which delete rather than write, were read rather than exercised, and their custody is asserted by [B-07](b07-gates-evidence-custody-and-ci.md)'s test-installer and test-release-rollback gates. |
| **[TR-2](../concerns.md#tr-2)** | confirmed-acceptable | code-verified | 🔗 | The untrusted content here is other people's host configuration, and the CLI reads it to diagnose rather than to obey: publicRegistration exists to project a registration into a reportable shape, and unmanaged entries are described in a report rather than acted on. Marked linchpin-dependent because the report's own escaping and truncation were not examined. |
| **[VR-1](../concerns.md#vr-1)** | confirmed-bug | code-verified |  | This subsystem generates five artifacts and checks every one of them for drift — the tool inventory, both vocabulary modules, the SQL CHECK literals and SKILL.md's evidence ladder all have a --check that fails CI. The version is the one identity it declares and does not check, and it is the one that has drifted: package.json says 0.2.0-beta.2 while SERVER_VERSION, README.md, mcp-server/README.md and HISTORY.md all say beta.1. The pattern for fixing it already exists in this subsystem five times over. Recorded here as well as against [B-02](b02-server-core-repository-binding-storage-schema-lifecycle.md) because the drift needs a check on this side; the finding is filed once, as B02-R3, where the literal lives. |
| **[ZD-1](../concerns.md#zd-1)** | out-of-scope | code-verified |  | The --check scripts here derive their denominator from a live source each run — the running server's tools/list, the vocabulary JSON, schema.sql — so an empty comparison would mean the source was empty, which is itself visible. Whether the repository's gates as a body can turn red is [B-07](b07-gates-evidence-custody-and-ci.md)'s question and is dispositioned there over the whole gate suite rather than over these five scripts. |

### Survey artifact

#### **B-06** · Packaging, installer, and host activation

**Revision read:** `7c1c1a9` · **Layer:** distribution · **Priority:** 3

##### Scope

`src/cli.ts` (1494 lines), `src/codex-host.ts`, seven scripts under `mcp-server/scripts/`,
`package.json`, and the activation-parity contract. Twelve files, eleven `examined`;
`scripts/historical-evaluation.mjs` is `candidate`, read for shape only.

##### Observed structure

**Repair is diagnosis-first, dry-run-first, and digest-bound.** `doctor` reports diagnoses
each carrying a remediation. `--repair --dry-run` emits a plan bound to a digest of the
configuration it inspected. `--apply-plan <id>` applies only that exact plan, so configuration
that changed between diagnosis and repair is refused rather than rewritten under a stale
reading. Every mutating action pushes a timestamped backup ahead of itself, and configuration
Amanuensis does not manage is reported with a remediation instead of being rewritten.

**The activation bound is one exported constant.** `STARTUP_PROBE_TIMEOUT_MS = 5_000`, applied
here and at all six subprocess sites in `project.ts`, each with `killSignal: "SIGKILL"`. The
repository's answer to a synchronous startup path is to bound the blocking calls rather than
make them asynchronous. The constant is exported and one import away from `index.ts`, which
does not use it — so the bound's coverage is decided by which modules chose to import it, not
by where the activation boundary is. That is finding B02-R1 seen from the other side.

**Generation has checks; version identity does not.** `gen-tool-inventory.mjs`,
`gen-vocabulary.mjs` (with `--check` and `--check-sql`), `check-evidence-vocabulary.mjs`,
`check-sql-identifiers.mjs` and `check-tool-schemas.mjs` all fail CI on drift.
`package.json`'s version has no such check, and it is the one that disagrees — see B02-R3.

##### Concurrency

A short-lived single-threaded CLI. Its exposure is interleaving with a human or another tool
editing the same host configuration, addressed by the digest rather than by locking: a plan
refuses to apply against bytes it was not computed from. The one shared resource it creates is
the user-scoped registration every later server process reads — seam [S-03](../seams.md#s-03).

##### Seam contract offered ([S-03](../seams.md#s-03))

The installer writes a **launch command and a scope, and deliberately not a workspace.** A
user-scoped Codex registration carries no hard-coded repository path, which is what lets one
installation serve every repository; an explicit workspace argument in an existing
registration is therefore treated as a *diagnosis* rather than as configuration to preserve
(`inspectCodexRegistration`, `hasExplicitWorkspaceArgument`). What this side cannot guarantee
is that the host launches in the directory the user means — that is the server's cwd
resolution — and Codex's own trust state is a host-side effect outside the managed surface.

##### Inference, separated from observation

The concurrency reading is an inference from the CLI's shape; no interleaved run was
performed. No install, repair, upgrade or uninstall was executed during this pass — every
reading here is from source, and the lifecycle evidence is [B-07](b07-gates-evidence-custody-and-ci.md)'s committed receipts.

##### Open

Whether the packed package and the source checkout behave identically was not re-established
here; `test-package-activation-parity.mjs` needs registry access and is [B-07](b07-gates-evidence-custody-and-ci.md)'s to run.
