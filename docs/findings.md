# Open findings

## Open

_10 defect(s) with no recorded repair._

### High findings

#### [Knowledge tools and workflow API](subsystems/b03-knowledge-tools-and-workflow-api.md)

| ID | Status | Symptom | Root cause | Ref SHA |
|---|---|---|---|---|
<!-- amanuensis:finding:c09fdbd11e344a2688d7d671c192b43218ef266cc6c9162aabc8e29232a4a737 -->
| <a id="b03-r1"></a>**B03-R1** | open | A subsystem can report status 'mapped' with zero unledgered paths, zero absent files and zero stale entries while most of its scoped files have never been examined. Nothing in the server measures examination within the ledger, so the store's own census cannot distinguish a subsystem that was read from one that was inventoried. | get_dashboard's census (dashboard.ts:102-121) counts subsystems, mapped subsystems, staleness split by obligation, total scoped_files and scope_gaps by kind, and has no field counting rows at classification 'examined'; scoped_files is a raw total mixing examined, candidate and exempt. enforcePhasePrerequisites (invariants.ts:922-930) gates scoping-to-structural on COUNT(*) >= 1 in file_ledger, so one classified row authorizes advancing a subsystem whose remaining scope is untouched, and no later gate revisits it — the advance to mapped adds requireCompleteReconciliation, which is about unledgered and absent paths, not about unread ones. Staleness cannot surface it either: a candidate row carries a ref_sha and goes stale only when its content changes, which says nothing about whether it was ever read. This is carried finding B03-5 re-found at c073404. | `c0734040` |

### Medium findings

#### [MCP core, persistence, and lifecycle](subsystems/b02-mcp-core-persistence-and-lifecycle.md)

| ID | Status | Symptom | Root cause | Ref SHA |
|---|---|---|---|---|
<!-- amanuensis:finding:3c8deef0011b6a98f5d8e61dd557b4e3432b67094c6ebed8b443007535a1e649 -->
| <a id="b02-r1"></a>**B02-R1** | open | A durable write can block the server indefinitely. Every add_evidence, add_finding, add_claim and set_disposition shells out to `git rev-parse` synchronously with no timeout, so an unresponsive git — a network-mounted worktree, a credential helper waiting on input, a filesystem that has stopped answering — hangs the whole stdio server with no diagnostic, because spawnSync blocks the event loop and the transport is single-threaded. | resolveWorkspaceCommit (helpers.ts:127-148) and resolveWorkspaceCommits (helpers.ts:172-207) pass no `timeout` and no `killSignal` to spawnSync. The two probes that were identified as hang risks — the Codex parent `ps` in codex-host.ts and the `git remote get-url origin` in project.ts — both carry STARTUP_PROBE_TIMEOUT_MS with killSignal SIGKILL, and codex-host.ts's own comment states the reason ("an unresponsive ps would hang activation with nothing to diagnose", naming finding B02-2). The same reasoning applies with more force to resolveWorkspaceCommit, which by its own docstring "is paid on every durable write" rather than once at startup, but the bound was added only to the startup probes. | `c0734040` |

#### [Knowledge tools and workflow API](subsystems/b03-knowledge-tools-and-workflow-api.md)

| ID | Status | Symptom | Root cause | Ref SHA |
|---|---|---|---|---|
<!-- amanuensis:finding:461dffdc3f2ff752233c630fd5858308eb995831cf9ed4bf5e365d84e469004b -->
| <a id="b03-r2"></a>**B03-R2** | open | A finding can be promoted to verified-fixed while its recorded fix_sha names a commit at which the repair does not exist, so the resolution record misattributes the repair to the wrong commit and nothing in the custody chain detects it. | verify_finding_fix (findings.ts:1792-1798) resolves current.fix_sha and the evidence ref_sha for existence and then calls requireAncestor, which accepts when git merge-base --is-ancestor exits 0. That proves the evidence was collected at or after the claimed fix; it does not test that the repair is present at fix_sha, and neither commit's tree is ever inspected. fix_sha itself is supplied by the caller at update_finding_status time and validated only by resolveWorkspaceCommit for existence, so any ancestor of the evidence commit is accepted and the further back it is the more likely it is to pass. Carried finding B03-6 re-found unchanged at c073404. | `c0734040` |
<!-- amanuensis:finding:5ee14cbe502cb01da7b6ecf6122c97f097c76bc798459b45f9a5f1a6ce8bea79 -->
| <a id="b03-r3"></a>**B03-R3** | open | When a file's content moves but every claim written against it still holds, the conspectus has no action that records the move. A citation whose line range has shifted keeps pointing at lines that now hold something else, and a range that lands on unrelated prose in the same document reads as correct — it makes the conspectus look wrong where it is right. | An absence in the tool surface, unchanged at c073404. add_evidence is the only writer of the evidence table; the two UPDATE statements in evidence.ts target the join tables' role column and never line_range, so an evidence row's coordinates are insert-only. clear_staleness (stale.ts:1107-1120) makes its freshness assertion per file by rewriting file_ledger alone and touches no citation anchored to that file. The refresh route therefore has only the two actions it lists — clear the staleness row, or re-decide the claim — and a file cleared after a faithful re-read keeps citations at lines that have moved. Carried finding B03-7 re-found at c073404. | `c0734040` |
<!-- amanuensis:finding:3b733fd44e2f4f88cfd786f805c13dfb233f8652c44dc538a2281277d5f41a9e -->
| <a id="b03-r4"></a>**B03-R4** | open | A finding's severity cannot be amended after it is filed, so an adversarial pass that re-grades one can record the re-grade in a resolution note, a disposition and the survey artifact while the findings.severity column keeps the original grade — leaving the published index and the store's own column disagreeing about the same finding. | add_finding performs a plain INSERT and returns 'use update_finding_status to change it' on a primary-key conflict; update_finding_status (findings.ts:1696-1700) writes status and fix_location only, and at c073404 that statement remains the only UPDATE against the findings table anywhere in the server. No tool writes severity after insert, so the pass whose explicit job is to overturn or restrict a concern-pass conclusion cannot record a re-grade in the field every downstream projection sorts and filters on. Carried finding B03-8 re-found unchanged at c073404. | `c0734040` |
<!-- amanuensis:finding:a48c345f296a51504fb324bd25aa92be00e643a062456b29a4a55f022736477b -->
| <a id="b03-r5"></a>**B03-R5** | open | An evidence row's locating coordinates are stored unchecked, so a disposition can be evidence-backed by a citation no reader can open. Measured in this store: 13 of the 35 evidence rows that carry a line_range name a range past the end of the file they cite, at the revision they cite it at — mcp-server/src/tools/findings.ts:verify_finding_fix at 1792-1798 of a 486-line file, mcp-server/src/tools/dashboard.ts:get_dashboard at 102-121 and again at 141-148 of an 85-line file, mcp-server/src/tools/stale.ts:clear_staleness at 1107-1120 of a 135-line file, mcp-server/src/tools/carried.ts:record_carried_outcome at 3512-3639 of a 735-line file, and nine more across mcp-server, materializer and the skill references. Every one of those rows is attached to a disposition and reads as evidence-backed. | add_evidence (mcp-server/src/tools/evidence.ts:44-66) validates two of the four fields its own description calls the anchor. requireWorkspaceSourcePath (helpers.ts:213-235) checks path syntax only — relative, non-traversing, not reserved tool state — and resolveWorkspaceCommit resolves the revision and stores it resolved. symbol and line_range are read by optString (evidence.ts:53-54) and go straight into the INSERT at :59-64. The repository already holds the check for the adjacent half of the same question: workspaceTreeHasPath (helpers.ts:359-370) runs git cat-file -e on revision:path, and its docstring states the principle — "Parsing is not resolution, and an anchor pointing at a path the named revision never carried is an anchor no later reader can open." add_evidence does not call it, and no code anywhere compares a stored line_range against the length of the file it names. | `23884334` |

#### [Diff-aware materializer](subsystems/b04-diff-aware-materializer.md)

| ID | Status | Symptom | Root cause | Ref SHA |
|---|---|---|---|---|
<!-- amanuensis:finding:7ad2818d7b459bad363659966e3bd62c234c9957fdd39876a27b8dcac38dec5a -->
| <a id="b04-r1"></a>**B04-R1** | open | The projection read-back's per-row stale-marker expectation set is empty for every real conspectus, so a projection that drops every stale marker still passes that part of the state axis; and the index page's stale reading is drawn from the same dead source. | readback.py:687 loads its expected stale markers with SELECT id, tier FROM entries WHERE stale=1, and renderers.py:696 reads the same table for the index page. No server code path inserts into entries — staleness lives on file_ledger (B03-2) — so the per-row loop never executes in production, and the red arm covering it in test-readback.py passes only because seed() hand-inserts a row, which remains the only INSERT INTO entries in the repository. This is carried finding B04-3 re-found at c073404 and narrowed: _ledger_stale_census now runs beside the dead reader and does draw from the ledger, so the axis as a whole is no longer unreachable. What remains unreachable is the marker-level expectation the census does not replace. | `c0734040` |
<!-- amanuensis:finding:9adfe21e3c920af7565e71f5f74528c6e2121b1ee4f0ac4ac7fa7c29c45627a1 -->
| <a id="b04-r2"></a>**B04-R2** | open | A clean publish can go red on the read-back's coverage axis with dangling anchors whose only distinguishing property is the length of the record prose beside them: shortening five long rationales returned all seven missing anchors and the next publish was green on all three axes. | Not located. What is established is the failing check and the anchors' shape: the coverage axis fails when a recorded local link's fragment does not resolve to an anchor on the target page, and every record anchor is emitted as raw HTML inside a single-line Markdown table row into which record prose is interpolated with only the pipe escaped. Two candidate mechanisms were tested against the archive's HEAD and did not reproduce — an HTMLParser without close(), and a table row broken by a newline inside a long cell. Reproducing it needs the downstream store's rows, which are not in this repository and are not in this one either. Carried finding B04-5, carried forward as an open finding of this store rather than closed: the length dependence is a real observation and its mechanism is still unknown. | `c0734040` |

#### [Packaging, installer, validation, and product docs](subsystems/b05-packaging-installer-validation-and-product-docs.md)

| ID | Status | Symptom | Root cause | Ref SHA |
|---|---|---|---|---|
<!-- amanuensis:finding:a247e548df4419686248d7e0efb8e9ccb19a31d3669107703838094830dd217e -->
| <a id="b05-r1"></a>**B05-R1** | open | The server identifies itself to every MCP host as 0.2.0-beta.1 while the package it ships from is 0.2.0-beta.2, and stamps that wrong version into the immutable binding receipt the setup documentation tells users to read back when verifying an installation. | SERVER_VERSION (index.ts:28) is a hardcoded literal that was not advanced when the package version was. It is the only source for both the version advertised during initialize and the serverVersion field frozen into the ProjectBindingReceipt, and nothing derives it from or checks it against mcp-server/package.json. The gates that could have caught it each cover the adjacent fact: render-roadmap.mjs relates the package manifest to the roadmap's release record, and published-smoke.yml installs the real tarball and asserts binding_receipt.canonicalRoot and storage_path without asserting the reported version. Carried finding B05-2 re-found at c073404, where the divergence is now directly observable rather than inferred. | `c0734040` |

### Low findings

#### [Embedded research surveys and platform trials](subsystems/b07-embedded-research-surveys-and-platform-trials.md)

| ID | Status | Symptom | Root cause | Ref SHA |
|---|---|---|---|---|
<!-- amanuensis:finding:3bf707b0e63ecca6a151b7f7e0a4685da2fc6067f5a25dfaee717e25e13850a2 -->
| <a id="b07-r1"></a>**B07-R1** | open | A research refresh or snapshot verification hangs indefinitely when GitHub, npm, the shadcn CLI, or a child detector stalls. | Unchanged at c073404. capture-component-landscape.mjs:39 awaits fetch with no AbortSignal and no timeout; :60 spawns a child with none; trials/shadcn-copy/scripts/capture-registry.mjs:7 spawns the shadcn CLI with none; verify-trial-snapshot.py:13 runs trial-inspection.py through subprocess.check_output with none. A grep for timeout, AbortSignal and signal: across the three files returns nothing. Carried finding B07-1 re-found. | `c0734040` |

## Carried obligations

_14 inherited obligations carried forward from an earlier store and still undecided. An inherited defect is an obligation to re-find it, rule it out with evidence, or mark it repaired at a commit — not a defect this survey confirmed, and not counted among the findings open above._

### B02-R1 · 🟠 HIGH · Undecided

<!-- amanuensis:carried:3c449cac1c75686a0a6dcb15d85833a286fd357ad391431c845514c0e09fd1bc --><a id="cf-3c449cac1c"></a>

- **Carried from** `store-legacy-7e0595ffa9f84f2b` at `7c1c1a9f5689`, recorded there as `open`
- **Subsystem there** [B-02](subsystems/b02-mcp-core-persistence-and-lifecycle.md)
- **Outcome** `undecided` — nobody here has re-found it, ruled it out, or recorded a repair

A git invocation on the server's startup path can block forever. If `git rev-parse --show-toplevel` hangs — a slow network filesystem, an unresponsive credential helper, a very large repository, a stale lock — the server never reaches a usable state and gives no diagnosis, because execFileSync blocks the Node event loop for the whole call.

**Root cause, as archived.** index.ts:108 `gitRoot` calls `execFileSync("git", ["rev-parse","--show-toplevel"], { cwd, encoding, stdio })` with no `timeout` and no `killSignal`. It is reached four times before the store is bound: twice from `assertWorkspaceMatchesLaunch` (index.ts:128, :129), once for a Codex parent workspace (:174), and once at :180 as the default workspace selection — taken whenever there is no `--workspace` argument and no `AMANUENSIS_WORKSPACE` or `CLAUDE_PROJECT_DIR`, which is the documented Codex and Claude activation shape. The repair that bounded this class covered project.ts, where all six subprocess sites carry `STARTUP_PROBE_TIMEOUT_MS` and `killSignal: "SIGKILL"`, and codex-host.ts, which defines the constant. index.ts imports neither and was left unbounded. This is the repository's recorded recurrence of a repair scoped to the symbols a finding named rather than to the defect class.

### B02-R4 · 🟠 HIGH · Undecided

<!-- amanuensis:carried:321dcecd3c9f1b234cf311b469d37ae03a461dc4326567f37cf2802df76f43d7 --><a id="cf-321dcecd3c"></a>

- **Carried from** `store-legacy-7e0595ffa9f84f2b` at `7c1c1a9f5689`, recorded there as `open`
- **Subsystem there** [B-02](subsystems/b02-mcp-core-persistence-and-lifecycle.md)
- **Outcome** `undecided` — nobody here has re-found it, ruled it out, or recorded a repair

Under Codex Desktop, the user-scoped registration launches the server with a process cwd of /. With no --workspace argument, no environment pin, and no --cd on the parent command, workspace resolution falls through to process-cwd-non-git and binds the filesystem root as project local:/ with storage path /.amanuensis. The skill's workspace-mismatch rule then stops the session, so every Codex Desktop session is unusable with the registration the installer writes by default, and a first write would attempt to create a store at the filesystem root. Observed 2026-09-13 23:36 in a Desktop session started in /Users/nfeldman/research and reproduced by direct launch; the pre-merge server binds identically.

**Root cause, as archived.** parseArgs treats any directory that is not inside a Git repository, including /, as a legitimate non-Git workspace and never fails closed. The Codex activation contract adds a parent-process --cd recovery that only Codex CLI provides; Codex Desktop launches the server from an app-server process at / without --cd, so the recovery returns null. The server never requests MCP roots from the client, although the Codex binary implements the roots protocol, so the one channel through which Desktop could name the task repository is unused. The A22 real-host harness and the A25 evidence cover the CLI surface only; ADR-0021 recorded the Desktop case as an unverified counterpoint.

### B03-R1 · 🟠 HIGH · Undecided

<!-- amanuensis:carried:cca0ea82fda01c87d682f1cba26bb831a50ce092958284c86066e00a5087d2dd --><a id="cf-cca0ea82fd"></a>

- **Carried from** `store-legacy-7e0595ffa9f84f2b` at `7c1c1a9f5689`, recorded there as `open`
- **Subsystem there** [B-03](subsystems/b03-knowledge-tools-and-workflow-api.md)
- **Outcome** `undecided` — nobody here has re-found it, ruled it out, or recorded a repair

A finding id can be re-minted by a rebuilt store and silently satisfy an external reference that was made against a different finding. Discarding a store makes every `amanuensis:&lt;finding_id&gt;` reference fail, which is loud and correct; re-minting one of those ids makes a closed defect resolve again, with nothing anywhere reporting that the referent changed.

**Root cause, as archived.** `finding_id` is caller-supplied (findings.ts:103, `requireString`), its only uniqueness constraint is the primary key within one store, and it carries no store generation, no binding id and no creation revision that a reader could compare. `dev/pecia-resolve-finding.mjs` answers a reference by opening whatever database is at `.amanuensis/memory.db` at the moment it runs and asking for the finding's current resolution state; it has no way to ask "is this the store that id was minted in". The Pecia ledger currently holds 22 records carrying such references, eight of them on closed defects. This rebuild avoided the collision by choosing a distinct id namespace (`&lt;SID&gt;-R&lt;n&gt;`), which is a convention a person followed, not a property the system has — the same rebuild run with the conventional ids would have re-created `B02-1` and `B03-1` with different meanings.

### B04-R1 · 🟠 HIGH · Undecided

<!-- amanuensis:carried:80471f083479cdd56b518eca87ff8d9537d2893e2fe3affc807bda8408d07cc0 --><a id="cf-80471f0834"></a>

- **Carried from** `store-legacy-7e0595ffa9f84f2b` at `7c1c1a9f5689`, recorded there as `open`
- **Subsystem there** [B-04](subsystems/b04-diff-aware-materializer.md)
- **Outcome** `undecided` — nobody here has re-found it, ruled it out, or recorded a repair

A default `describe_locus` call on a surveyed file returns standing, a census, and no account at all — `items: []` in every one of the eight sections — while declaring itself over budget. The tool the server instructions name first, and that the skill tells an agent to call before reading a file, answers "29 things are recorded here" and serves none of them.

**Root cause, as archived.** The response budget is `WIRE_BUDGET + WIRE_BUDGET_PER_OPTIONAL_SECTION * optionalRequested` (locus.ts:1574) — 8192 bytes plus 4096 for each **optional** section the caller names — and it is measured by `responseBytes` against the whole emitted envelope, which carries the payload twice because `jsonResult` emits both a text block and a duplicate `structuredContent`. So the allowance grows only when a caller asks for *extra* sections, while the fixed cost does not shrink: measured on this store, the scaffolding for a locus with nothing recorded is already 6860 wire bytes (84% of 8192), and one examined owner plus its omission ledger adds about 2752 against 1332 of headroom. Naming `sections: ["structure"]` does not help, because `structure` is a default section and adds no allowance. The same call naming three optional sections is bounded at 20480, comes in at 20310, and serves the account in full — which is how the committed dogfood receipt passes §12.4 assertion 1: it records `budget_bytes: 20480` for all three of its loci.

### B04-R2 · 🟠 HIGH · Undecided

<!-- amanuensis:carried:5e31d76b4dd7ae6ac6ae3f3b28e65e263e1cd8860cef0902ef774969ae4aada6 --><a id="cf-5e31d76b4d"></a>

- **Carried from** `store-legacy-7e0595ffa9f84f2b` at `7c1c1a9f5689`, recorded there as `open`
- **Subsystem there** [B-04](subsystems/b04-diff-aware-materializer.md)
- **Outcome** `undecided` — nobody here has re-found it, ruled it out, or recorded a repair

The adversarial pass cannot record a negative outcome when the survey is conducted at a single revision. `record_claim_challenge` accepts only `survived`; `overturned` and `superseded` are unreachable. A phase whose whole purpose is to overturn claims can, in the normal case, only ever agree with them — and the `mapped` prerequisite that requires an outcome on every claim is therefore a gate that cannot turn red.

**Root cause, as archived.** Three checks compose into a closed loop. (1) `record_claim_challenge` refuses an `overturned` or `superseded` outcome without a `validity_event_id`, with the message "an overturning that closed no interval overturned nothing". (2) Such a row is written only by `invalidate_claim` (event_type `invalidated`) or `supersede_claim` (`superseded`), and the handler checks the event type matches the outcome. (3) Both of those call `requireStrictDescendant(at_sha, valid_from_sha)`, which throws when `boundary === validFrom`. A survey records each claim with `ref_sha` equal to the revision it is reading, so `valid_from_sha` is HEAD and no `at_sha` the survey can supply is a strict descendant of it. Reproduced three times during this survey while trying to correct a claim I had recorded myself; the only route that worked was `reset_subsystem`, which discards the entire phase. spec.md §12.1 mandates rebuilding at one revision, so this is the mandated case, not an unusual one.

### B01-R1 · 🟡 MEDIUM · Undecided

<!-- amanuensis:carried:3a43c29adab4e075722455c0525312a847dabc2288270903dfeb14056d3a4220 --><a id="cf-3a43c29ada"></a>

- **Carried from** `store-legacy-7e0595ffa9f84f2b` at `7c1c1a9f5689`, recorded there as `open`
- **Subsystem there** [B-01](subsystems/b01-survey-methodology-and-agent-contracts.md)
- **Outcome** `undecided` — nobody here has re-found it, ruled it out, or recorded a repair

The phase references have drifted from the tools they describe, with nothing checking them. `phase-4-adversarial.md` instructs the coordinator to do one thing the server refuses and one thing the server has since replaced.

**Root cause, as archived.** Two concrete drifts, both in the reference that specifies the adversarial pass. First, it lists `overturned` as an available outcome for a claim found "wrong at the current revision" — exactly the case `invalidate_claim` rejects, because closing a claim requires a strict descendant of its `valid_from_sha` and a survey records claims at the revision it reads (B04-R2). Second, it instructs recording a `survived` outcome as a field note, on the reasoning that "no claim row changes, so the outcome has to be recorded explicitly or it is indistinguishable from a claim nobody looked at" — true before `record_claim_challenge` and the `claim_challenge_outcomes` table existed, and the exact problem they were added to solve. The repository checks generated prose against its source in three places and even holds `SKILL.md`'s hand-written evidence ladder to the vocabulary contract; nothing holds the phase references to the tool surface they describe.

### B02-R2 · 🟡 MEDIUM · Undecided

<!-- amanuensis:carried:7cd83dca97a5c7cb54e0899229b602a973ea81b1505f2be8dd46fe0efa6818c7 --><a id="cf-7cd83dca97"></a>

- **Carried from** `store-legacy-7e0595ffa9f84f2b` at `7c1c1a9f5689`, recorded there as `open`
- **Subsystem there** [B-02](subsystems/b02-mcp-core-persistence-and-lifecycle.md)
- **Outcome** `undecided` — nobody here has re-found it, ruled it out, or recorded a repair

The gate that certifies "activation-path probes are time-bounded" passes while an unbounded probe sits on the activation path. Its green is true of what it measured and is read as true of the path.

**Root cause, as archived.** test-startup-bounds.mjs imports exactly two modules — `dist/codex-host.js` for discoverCodexParentWorkspace and `dist/project.js` for resolveProject — and drives them against a deliberately slow `git` placed ahead of the real one on PATH. Its denominator is therefore the set of subprocess calls reachable from those two entry points. `dist/index.js` is never loaded and `parseArgs` is never called, so index.ts:108's unbounded execFileSync (finding B02-R1) is outside anything the gate can fail on. Grepping the gate for `index.ts`, `index.js`, `gitRoot` and `parseArgs` returns nothing. This is the project's recorded zero-denominator class in its milder form: not an empty denominator, but one drawn so that it excludes the live defect.

### B02-R3 · 🟡 MEDIUM · Undecided

<!-- amanuensis:carried:3a4a754c27d6ef131917d004a17139c15500537bbd20a9f6e015e17c611ed123 --><a id="cf-3a4a754c27"></a>

- **Carried from** `store-legacy-7e0595ffa9f84f2b` at `7c1c1a9f5689`, recorded there as `open`
- **Subsystem there** [B-02](subsystems/b02-mcp-core-persistence-and-lifecycle.md)
- **Outcome** `undecided` — nobody here has re-found it, ruled it out, or recorded a repair

The server tells every host it is 0.2.0-beta.1 while the package it is built from is 0.2.0-beta.2. A user cannot determine which version they are running, and a bug report naming the version names the wrong one.

**Root cause, as archived.** `SERVER_VERSION` at mcp-server/src/index.ts:27 is a hand-written string literal, not read from package.json, and nothing checks the two against each other. At 7c1c1a9 the literal is "0.2.0-beta.1" and mcp-server/package.json declares "0.2.0-beta.2". The literal is not decorative: it is the version in the MCP handshake the host receives, it is passed to resolveProject, and it is stamped into every per-process repository binding receipt. This session's own live binding receipt reports serverVersion "0.2.0-beta.1" from this checkout. The same fact is stated in five places and three more of them agree with the literal rather than the package — README.md:78, mcp-server/README.md:18, and mcp-server/README.md:118, which pins an install to `@gruetech/amanuensis@0.2.0-beta.1` — while HISTORY.md has no 0.2.0-beta.2 entry at all. There is no single source and no drift check for any of them, unlike the vocabulary, the tool inventory and the roadmap, which all have one.

### B03-R2 · 🟡 MEDIUM · Undecided

<!-- amanuensis:carried:dc9a1e280398f4776be15f99c72f1fe6138c68d8a7417c97ed2e16bc7fcaf469 --><a id="cf-dc9a1e2803"></a>

- **Carried from** `store-legacy-7e0595ffa9f84f2b` at `7c1c1a9f5689`, recorded there as `open`
- **Subsystem there** [B-03](subsystems/b03-knowledge-tools-and-workflow-api.md)
- **Outcome** `undecided` — nobody here has re-found it, ruled it out, or recorded a repair

A clean-slate rebuild has no supported path for carrying an unresolved finding forward. Discarding a conspectus discards its open defects with it, and nothing tells the systems that referenced them that the referents were destroyed rather than resolved.

**Root cause, as archived.** The destructive operation is supported and well built — the skill authorizes "reinit survey", `dev/rebuild-self-conspectus-store.mjs` performs it with a snapshot, a process boundary and a read-back — but it is a *discard*, and nothing in the product exports, migrates, or re-mints the findings that were open when it ran. There is no export tool for open findings, no import path into a fresh store, and no way to record in the new store that a finding is inherited from a discarded one. Observed concretely in this run: 13 `open` findings and one `fixed-pending-verification` were preserved only because this session wrote a JSON export to a directory outside the repository, by hand, before running the procedure. Nothing in the tooling asked for that or would have noticed its absence. The seam this leaves broken is S-10: 22 Pecia records still name ids the store no longer holds, and the honest disposition for each has to be reconstructed from an out-of-tree file.

### B04-R3 · 🟡 MEDIUM · Undecided

<!-- amanuensis:carried:62b74dbff8ed924a41591bc28ddabaf585588e0c45ef7678181c71bf1249180f --><a id="cf-62b74dbff8"></a>

- **Carried from** `store-legacy-7e0595ffa9f84f2b` at `7c1c1a9f5689`, recorded there as `open`
- **Subsystem there** [B-04](subsystems/b04-diff-aware-materializer.md)
- **Outcome** `undecided` — nobody here has re-found it, ruled it out, or recorded a repair

`add_claim` accepts a `claim_key` whose slug does not identify the subject, and the writer only learns the rule from a gate that runs long after the record is durable — at which point the record cannot be corrected without discarding the whole structural phase.

**Root cause, as archived.** The stable-key rule lives on the wrong side of the seam. `FILE_ANCHORED_CLAIM_KEY` (claims.ts:52) matches only the category and its trailing slash, so the server validates that a key *is* a key-type, state-container or flow claim and never what it names. `dev/test-rebuild-coverage.mjs:keyShapeFailure` recomputes the stable key as the slug of the whole `path:symbol` pair and requires exact equality, with a comment recording that a slug built from the symbol alone once made two `Config` types collide and silently shortened a subsystem's inventory. Both were exercised here: the server accepted `B-02/state-container/openDatabase`, which the gate's rule refuses. Because `claim_key` carries a unique index and is what makes a later reading supersede rather than duplicate, an unstable key is not cosmetic — it is a silent collision across files. The correction path compounds it: `invalidate_claim` and `supersede_claim` both need a strictly later commit (B04-R2), and `supersede_claim` preserves the `claim_key` that is the wrong field anyway, so `reset_subsystem` — which discards every claim, disposition, edge and ledger row for the subsystem — is the only route.

### B04-R4 · 🟡 MEDIUM · Undecided

<!-- amanuensis:carried:1ade363d100b69f12e7c31a7710b31a728a89c0b6849376dbab9fde106fdaa23 --><a id="cf-1ade363d10"></a>

- **Carried from** `store-legacy-7e0595ffa9f84f2b` at `7c1c1a9f5689`, recorded there as `open`
- **Subsystem there** [B-04](subsystems/b04-diff-aware-materializer.md)
- **Outcome** `undecided` — nobody here has re-found it, ruled it out, or recorded a repair

A hung `git` invocation inside a tool handler blocks that call indefinitely. Because the calls are synchronous and block the Node event loop, the whole server stops answering, not just the one request.

**Root cause, as archived.** Revision resolution runs `git rev-parse` from the handler path with no `timeout` and no `killSignal`. In this subsystem that is two call sites in `tools/xrefs.ts`, three in `tools/claims.ts` and two in `standing.ts`. Across the whole of `mcp-server/src` there are about sixty subprocess call sites and only two modules mention a timeout at all — `project.ts` (six sites) and `codex-host.ts`, which are the startup-path modules the earlier repair covered. The exposure is broader than the startup case because `requireResolvedSha` deliberately resolves live on every durable write with no memoization, so every claim, evidence row, disposition and finding pays a subprocess.

### B05-R1 · 🟡 MEDIUM · Undecided

<!-- amanuensis:carried:ab13df9ae2fcf96bc7b96df5012dae98ec9952e0635fdef0edb5f15a7c201ae0 --><a id="cf-ab13df9ae2"></a>

- **Carried from** `store-legacy-7e0595ffa9f84f2b` at `7c1c1a9f5689`, recorded there as `open`
- **Subsystem there** [B-05](subsystems/b05-packaging-installer-validation-and-product-docs.md)
- **Outcome** `undecided` — nobody here has re-found it, ruled it out, or recorded a repair

A clean publish, its promotion to docs/, and the published site can all be green while the overview's thesis slot shows the placeholder "No thesis section is recorded; add a 'What is this codebase?' section to entry-point.md." The clean-slate rebuild of 2026-09-13 produced exactly this on the public site: the survey was complete and the thesis existed, but under the heading "What does this system do?", which the renderer does not recognize.

**Root cause, as archived.** The heading contract exists in two places that never meet: the skill's artifact template prescribes "What is this codebase?" as prose, and read_thesis extracts by that exact heading, but register_artifact and rehash_artifact validate nothing about an entry-point artifact's sections, and the publish read-back axes compare projection against store without asserting the thesis slot is filled. A variant heading therefore passes every gate and reaches readers as a placeholder.

### B07-R2 · 🟡 MEDIUM · Undecided

<!-- amanuensis:carried:58591592ff53994893634d82b2d36d3ec7d496781ce7872cf08a2c190305f72e --><a id="cf-58591592ff"></a>

- **Carried from** `store-legacy-7e0595ffa9f84f2b` at `7c1c1a9f5689`, recorded there as `open`
- **Subsystem there** [B-07](subsystems/b07-embedded-research-surveys-and-platform-trials.md)
- **Outcome** `undecided` — nobody here has re-found it, ruled it out, or recorded a repair

`dev/test-rebuild-depth.mjs` cannot be satisfied by a genuine clean-slate rebuild. It requires the rebuilt conspectus to carry the *previous* survey's concern codes, and to mint finding ids in exactly the shape that lets a stale external reference silently re-resolve.

**Root cause, as archived.** Two literals bind a future rebuild to the identities of the store it replaces. `CHECKLIST_CONCERNS = ["BV-1","CC-1","EV-1","GT-1","RC-1","ZD-1"]` (line 104) is the discarded survey's calibrated checklist, and the gate turns red when those codes are not active — so onboarding Phase 4, whose job is to derive concerns for *this* codebase, is refused for doing it. And the finding assertion `new RegExp("^" + id.replace("-","") + "-\\d+$")` (line 598) mandates `B02-1` and rejects any namespace that would stop a rebuilt store re-minting an id the Pecia ledger already references (B03-R1). That second constraint caught this session directly: minting `B07-1` to satisfy the gate collided with an archived finding of the same id that Pecia record pc-861e still names, and the claim had to be withdrawn by a third `reset_subsystem`. A milder third instance: `record-rebuild-depth.mjs` reads checkpoints labelled `Depth batch N` while `record-rebuild-coverage.mjs` reads `Rebuild batch N`, so one integrated rebuild — which is what the skill runs — records batches for one gate and none for the other.

### B07-R1 · 🔵 LOW · Undecided

<!-- amanuensis:carried:5eab80a4fdabc7a96287f6c270bd9e1656232e1011fbd0a8cb154242b01763ae --><a id="cf-5eab80a4fd"></a>

- **Carried from** `store-legacy-7e0595ffa9f84f2b` at `7c1c1a9f5689`, recorded there as `open`
- **Subsystem there** [B-07](subsystems/b07-embedded-research-surveys-and-platform-trials.md)
- **Outcome** `undecided` — nobody here has re-found it, ruled it out, or recorded a repair

`dev/test-activation-evidence.mjs` exists in the tree and never runs in CI, with nothing recording whether that is deliberate.

**Root cause, as archived.** Enumerating all 106 gate files against `.github/workflows/test.yml` shows exactly four unreferenced. Three are performance suites whose exclusion from a correctness list is legible. The fourth is a correctness gate by name with no stated reason for being absent. The repository's own convention — several recent gates assert their own presence in the workflow as a red condition — exists precisely so this cannot happen silently, and this file predates that convention.

