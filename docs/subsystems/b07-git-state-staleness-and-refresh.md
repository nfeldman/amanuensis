# **B-07** — Git state, staleness, and refresh

**Status**: 🟢 mapped  
**Layer**: mcp-server

## Scope

No purpose statement is recorded for this subsystem; the scope below states what it covers.

mcp-server/src/tools/{git,stale,refresh,impact}.ts — detect_changes against the recorded baseline, the stale reasons written into the file ledger, unattended refresh runs, and change-impact prediction.

## Start here

mcp-server/src/tools/git.ts, then mcp-server/src/tools/stale.ts

## Structure

What the survey recorded as claims about this subsystem, grouped by what each one states. Every claim is bound to the revision it was asserted at and to the evidence attached to it; a superseded claim is not shown here.

### State containers

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-07/state-container/mcp-server-src-tools-git-ts-gittools` | `mcp-server/src/tools/git.ts:gitTools` | The state this subsystem owns is the staleness columns on file_ledger — stale, stale_since, stale_reason. They are populated only by the reconciliation transaction, live as long as the row, and are invalidated by the same pass that sets them when the file matches its examination commit again. | Observation | `258ccd28fc19` |

### Flow steps

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-07/flow/detect-changes/01` | `mcp-server/src/tools/git.ts:gitTools` | Step 1 of detecting drift: ledger rows are grouped by the revision they were examined at and each group is diffed once against HEAD. A group whose diff throws — an examination commit no longer reachable — goes to `unverifiable`, never to `fresh`, so an unanswerable question is not recorded as a negative answer. | Observation | `258ccd28fc19` |
| `B-07/flow/detect-changes/02` | `mcp-server/src/tools/git.ts:gitTools` | Step 2: one transaction writes git-drift, absent, or unverifiable-ref onto rows not already stale, and clears staleness on rows that match their examination commit again. Staleness is re-derived in both directions by the same rule, so a row is never left flagged as an obligation the evidence no longer supports. | Observation | `258ccd28fc19` |

### Concurrency invariants

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-07/concurrency` | `B-07` | Reconciliation is one SQLite transaction over the whole ledger, so a reader never sees half a pass. The git subprocesses run before it, synchronously, against the bound workspace's working tree; a repository mutated between the diff and the transaction would be recorded at the revision the diff saw, not the one on disk. | Inference | `258ccd28fc19` |

## Boundaries

### Recorded edges

| From | → | To | Relationship | Strength | Context |
|---|---|---|---|---|---|
| **B-07** | → | **[B-06](b06-locus-standing-and-the-reader-lenses.md)** | data-flow | structural | the stale flag and reason this pass writes are what turn an examined standing into examined-stale for every later answer, read at mcp-server/src/tools/git.ts:gitTools@258ccd2 |

## Known defects here

1 defect here is open or awaiting verification. Each one's full record, with its evidence, is on [Open findings](../findings.md).

- The four stale reasons are declared in the vocabulary source and generated into two modules that nobody imports; both writers spell the values as string literals and the column carries no CHECK, so a value that drifts from the enum is written, stored, and read with nothing naming the divergence. — [B07-1](../findings.md#b07-1) · 🟡 MEDIUM · Open

## Standing

**Mapped** — Survey complete through structural analysis, concern review, and adversarial challenge. It cannot justify that the reading is current at the repository head.

| Metric | Value |
|---|---|
| Files read | 1 of 4 ledger rows |
| Files in scope, not yet read | 3 of 4 |
| Files excluded from the survey obligation | 0 of 4 |
| Ledger rows the repository has changed under | 0 of 4 |
| Active concerns with a disposition recorded here | 6 of 15 — 1 confirmed-bug, 5 confirmed-acceptable |
| Findings by resolution state | 1 open |
| Seams assessable from both sides | no seam names this subsystem |

## Survey record

### File ledger

| Path | Classification | Why in scope | Examined at |
|---|---|---|---|
| <a id="le-8fcdf74211"></a>`mcp-server/src/tools/impact.ts` | candidate | predict_change_impact and apply_change_impact, which close claims a change has overtaken. | `258ccd28` |
| <a id="le-a85130a50f"></a>`mcp-server/src/tools/refresh.ts` | candidate | Unattended refresh runs: planning, execution, and the final read-back over the backlog. | `258ccd28` |
| <a id="le-5391499409"></a>`mcp-server/src/tools/stale.ts` | candidate | The stale backlog readers and clear_staleness, which is how an obligation is discharged. | `258ccd28` |
| <a id="le-69e8473f57"></a>`mcp-server/src/tools/git.ts` | examined | detect_changes: groups ledger rows by the revision they were examined at, diffs each against HEAD, and writes the stale reason each outcome earns. | `258ccd28` |

### Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[BV-1](../concerns.md#bv-1)** | confirmed-acceptable | code-verified |  | Every git invocation runs with cwd set to the bound workspace and is given paths that came out of the ledger or out of git ls-files rather than out of an argument, and execFileSync passes them as an argument vector, so no agent-supplied string reaches a shell or names a file outside the tree. |
| **[CC-1](../concerns.md#cc-1)** | confirmed-acceptable | code-verified |  | This subsystem writes the columns file_standing derives from and reads neither derived view, so it holds no second copy of a predicate; the rule it does duplicate — what makes a row stale — is applied in both directions by one pass, which is why a restored file is cleared by the same rule that flagged it. |
| **[EV-1](../concerns.md#ev-1)** | confirmed-acceptable | code-verified |  | Every revision this subsystem acts on is resolved by being used: a ledger row's examination commit is passed to git diff against the current head, and a failure to compare is recorded as unverifiable rather than assumed away, which is resolution at write time in the only form a drift pass can take. |
| **[GT-1](../concerns.md#gt-1)** | confirmed-bug | code-verified |  | STALE_REASONS is declared in the source, generated into both the TypeScript and the Python module, bound to no SQL column, and imported by neither of its two writers: detect_changes and the standing reachability probe spell all four values as string literals, so nothing in the repository compares what is written against the enum that declares it. |
| **[RC-1](../concerns.md#rc-1)** | confirmed-acceptable | code-verified |  | Every git subprocess here is synchronous and reaped before the reconciliation transaction opens, so no handle is held across the write and a reader never observes half a pass; a repository mutated between the diff and the transaction is recorded at the revision the diff saw, which the subsystem states rather than conceals. |
| **[ZD-1](../concerns.md#zd-1)** | confirmed-acceptable | code-verified |  | The two ways this pass could report a clean tree it never examined are both closed: a group whose diff throws goes to unverifiable rather than to fresh, and absence is decided against git ls-files rather than against the diff window, so a path that never appears in the range is not thereby fresh. |

### Survey artifact

#### **B-07** · Git state, staleness, and refresh

Structural inventory at `258ccd2`.

##### Key types

Not a type-shaped subsystem: `gitTools` is a list of handlers over the ledger, and the thing
worth naming is the reconciliation pass rather than a declaration. Recorded as flow and
state-container claims instead of a key-type claim.

##### State containers

| Name | Location | Stores | Lifetime | Populated by | Invalidated by |
|---|---|---|---|---|---|
| `file_ledger.stale`, `stale_since`, `stale_reason` | the store | the drift obligation on each scoped path | as long as the row | the reconciliation transaction | the same pass, when the file matches its examination commit again |

##### Data flow · detecting drift

1. Ledger rows are grouped by the revision they were examined at and each group is diffed once
   against HEAD. A group whose diff throws goes to `unverifiable`, never to `fresh`
   (`mcp-server/src/tools/git.ts:gitTools@258ccd2`).
2. One transaction writes `git-drift`, `absent`, or `unverifiable-ref` onto rows not already
   stale, and clears staleness on rows that match again — the same rule in both directions
   (`mcp-server/src/tools/git.ts:gitTools@258ccd2`).

##### Concurrency model

Reconciliation is one transaction, so a reader never sees half a pass. The git subprocesses run
before it; a repository mutated between the diff and the transaction is recorded at the revision
the diff saw. Recorded as an inference.

##### Seam contracts

- This subsystem writes what [B-06](b06-locus-standing-and-the-reader-lenses.md) reads: the flag and reason are what turn an `examined`
  standing into `examined-stale` for every later answer. Recorded as an edge rather than a seam,
  because the shared object is a column on a table [B-03](b03-conspectus-schema-vocabulary-and-invariants.md) owns.

##### Concern review

Six active concerns, all terminal at `0fee11b`. One confirmed bug.

| Concern | Disposition | Reading |
|---|---|---|
| [CC-1](../concerns.md#cc-1) | confirmed-acceptable | Writes the columns `file_standing` derives from and reads neither view. |
| [RC-1](../concerns.md#rc-1) | confirmed-acceptable | Every git subprocess is reaped before the reconciliation transaction opens. |
| [BV-1](../concerns.md#bv-1) | confirmed-acceptable | Paths come out of the ledger or `git ls-files`, never out of an argument, and `execFileSync` passes an argument vector. |
| [EV-1](../concerns.md#ev-1) | confirmed-acceptable | Each revision is resolved by being used, and a failure to compare is recorded as `unverifiable` rather than assumed away. |
| [GT-1](../concerns.md#gt-1) | **confirmed-bug** ([B07-1](../findings.md#b07-1)) | `STALE_REASONS` is declared, generated twice, imported by nobody, and bound to no CHECK. |
| [ZD-1](../concerns.md#zd-1) | confirmed-acceptable | A group whose diff throws goes to `unverifiable`, and absence is decided against the tree rather than the diff window. |

##### Adversarial review

**Finding [B07-1](../findings.md#b07-1) — upheld.** Claim A: a stale reason that drifts from the enum is written and
read with nothing naming the divergence. Claim B: a CHECK, a union type, or `--check-sql`
catches it. Evidence for Claim B: the column is plain `TEXT`; the value reaches SQLite through
a bound parameter typed `unknown`; and `--check-sql` compares CHECK literals, of which this
enum has none. Verdict: **upheld**.

**Claims.** Four targets, all survived — `flow/detect-changes/02` with one asymmetry named:
`markFresh` excludes rows whose reason is `absent`, which is deliberate and outside the
claim's scope.
