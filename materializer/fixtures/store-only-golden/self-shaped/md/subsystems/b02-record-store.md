# **B-02** — Record store

*Scope, structure, boundaries, defects, and the survey record for Record store. Use it when you have picked a subsystem.*

Terms on this page: [Survey](../how-to-read.md#term-survey) · [Subsystem](../how-to-read.md#term-subsystem) · [Layer](../how-to-read.md#term-layer) · [Survey depth](../how-to-read.md#term-survey-depth) · [Mapped](../how-to-read.md#term-mapped) · [Scope](../how-to-read.md#term-scope) · [Evidence](../how-to-read.md#term-evidence) · [Claim](../how-to-read.md#term-claim) · [Challenge](../how-to-read.md#term-challenge) · [Concern](../how-to-read.md#term-concern) · [Concern review](../how-to-read.md#term-concern-review) · [Finding](../how-to-read.md#term-finding) · [Lead](../how-to-read.md#term-lead) · [Decision needed](../how-to-read.md#term-decision-needed) · [System boundary](../how-to-read.md#term-system-boundary) · [Recorded edge](../how-to-read.md#term-recorded-edge) · [Standing](../how-to-read.md#term-standing) · [Purpose, account](../how-to-read.md#term-purpose-account)

**Status**: 🟠 structural  
**Layer**: —

## Purpose

**B-02** holds every record the survey writes.

*Written by a survey session at `c3b1492c` from 1 evidence row(s). Whether the files it cites have changed since is not measured here.*

## Scope

No scope statement is recorded for this subsystem. The file ledger in its survey record is the only account of what belongs to it.

## How it works

Opening a store migrates it and applies the schema.

*Written by a survey session at `c3b1492c` from 1 evidence row(s). Whether the files it cites have changed since is not measured here.*

## Structure

What the survey recorded as claims about this subsystem, grouped by what each one states. Every claim is bound to the revision it was asserted at and to the evidence attached to it; a superseded claim is not shown here.

### Key types

- DB is the better-sqlite3 database type.
    - `B-02/key-type/db` · subject `mcp-server/src/db.ts` · Observation · asserted at `d395c4d5a9e1` · evidence: `mcp-server/src/db.ts:67-80`

### Flow steps

- openDatabase is called with a path.
    - `B-02/flow/open-store/00` · subject `mcp-server/src/db.ts` · Observation · asserted at `d395c4d5a9e1` · evidence: `mcp-server/src/db.ts:67-80`
- runMigrations runs before the schema is applied.
    - `B-02/flow/open-store/01` · subject `mcp-server/src/db.ts` · Observation · asserted at `d395c4d5a9e1` · evidence: `mcp-server/src/db.ts:67-80`

## Vocabulary

**Domain vocabulary** — not recorded. Neither a term nor a declination has been recorded for this subsystem, so nobody has answered the question either way.

## Known defects here

No defect here is open or awaiting verification.

## Standing

**Structural** — The structure pass is done: types, state, flows and concurrency are mapped; correctness claims are not yet authorized. It cannot justify any correctness claim.

| Metric | Value |
|---|---|
| Files read | 1 of 1 ledger row |
| Files in scope, not yet read | 0 of 1 |
| Files excluded from the survey obligation | 0 of 1 |
| Ledger rows the repository has changed under | 0 of 1 |
| Active concerns with a disposition recorded here | 0 of 1 |
| Findings by resolution state | none recorded |
| Seams assessable from both sides | no seam names this subsystem |

## Survey record

### File ledger

- **No reason recorded** — examined, 1 file, examined at `c3b1492c`
    - <a id="le-28d2d6d8a8"></a>`mcp-server/src/db.ts`

### Concern review

No concern has been dispositioned in this subsystem.

### Survey artifact

*Written on 2026-09-13 at revision d395c4d5 as the survey's working notes, and kept as written. The account above was recorded on 2026-09-14 at revision c3b1492c; where the two disagree, the later one is the current reading.*

*As written at 2026-09-13, revision `d395c4d5`; kept as written, not tied to evidence.*

#### **B-02** — Record store

Structural account, read at `d395c4d`.

##### Observed

The server applies the schema on every open and migrates additive columns first.
