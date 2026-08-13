# ADR-0018: Expose typed Chorusmith adapters without transferring Amanuensis authority

- Status: accepted for A17
- Date: 2026-08-12
- Deciders: Chorusmith owns orchestration; Amanuensis owns codebase-domain truth and invariants; the human retains preference and decision authority

## Context

Chorusmith is the natural owner of cross-domain planning, context compilation,
provider routing, attempts, and session artifacts. Amanuensis already owns a
working codebase workflow with evidence, knowledge-depth, authority, exact
fan-in, and read-back invariants enforced in SQLite and MCP handlers. Moving
those rules into a generic orchestrator before parity exists would create a
second, weaker authority path and make rollback depend on reconstructing the
old workflow.

The Chorusmith tree inspected for this decision is commit
`7e794747017c6c3d0df9151d4c6a584a6cdba60e`. Its artifact store expects typed
artifact kind, schema reference/version, producing stage, attempt index, output
slot, and payload fields. Its architecture document still lists consumption of
external MCP tools as future work. A17 therefore defines and verifies the
Amanuensis side of the stable project-type boundary; it does not claim that a
native Chorusmith external-MCP loader has landed, and it does not migrate any
workflow merely to complete the diagram.

## Decision

### Publish six versioned adapters over one transport

The checked-in `ProjectTypeAdapter@1.0.0` declares the `codebase` project type
over the existing `amanuensis-memory` MCP transport. It registers:

| Domain object | Chorusmith artifact kind | Output slot |
|---|---|---|
| CodebaseBrief | `AmanuensisCodebaseBrief@1.0.0` | `codebase-brief` |
| ReviewBrief | `AmanuensisReviewBrief@1.0.0` | `review-brief` |
| ResearchRequest | `AmanuensisResearchRequest@1.0.0` | `research-request` |
| Decision | `AmanuensisDecision@1.0.0` | `decision` |
| Obligation | `AmanuensisObligation@1.0.0` | `obligation` |
| RunManifest | `AmanuensisRunManifest@1.0.0` | `run-manifest` |

`export_chorusmith_adapter_artifact` reads the corresponding durable source and
emits an Amanuensis custody envelope containing a nested projection of
Chorusmith's `PersistArtifactInput` fields. The outer envelope keeps the source
reference, SHA-256 source-payload hash, and authority separate. It deliberately
does not impersonate Chorusmith's `ArtifactRecord`: Chorusmith computes its own
BLAKE3 payload hash, artifact id, blob path, manifest path, and durability state
during persistence. A future native ingress must perform that translation.
Exports are append-only and explicitly projection-only: their authority block
says Amanuensis owns the payload and external write authority is false.

### Let the adapter invoke handlers, never domain tables

An `AmanuensisRunManifest` freezes an exact repository commit, external run
reference, ordered typed steps, arguments and hashes, expected output keys, a
direct-path parity snapshot, recovery policy, and verification-time ceiling.
Each adapter exposes a finite list of existing Amanuensis tool names. Cross-
adapter tool smuggling is rejected during planning. Before every execution,
resume, and parity check, the adapter also asserts that the checked-out tracked
source still equals the frozen commit.

`execute_chorusmith_adapter_step` selects only the next step and invokes the
existing tool definition's handler. The domain mutation and the step's result
receipt share one SQLite transaction. The adapter has no SQL path for creating
claims, evidence, decisions, obligations, briefs, or research results. As a
result, every original evidence, depth, authority, and completion gate runs in
the same place for direct and orchestrated calls. A rejection rolls back the
adapter landing as well as the domain mutation.

This is the load-bearing extraction rule: Chorusmith orchestrates the call;
Amanuensis decides whether the domain operation is legal.

### Treat orchestration loss as a durable replay boundary

Run and step manifests are immutable. The substrate bounds inserted steps by
the frozen expected count; every operation reconciles the complete table to the
manifest and requires landed steps to form an exact ordinal prefix. Landed step
arguments and outputs are immutable, hashed, and reconciled before resume.
`resume_chorusmith_adapter_run` derives a
read-only partial domain projection, records the landed prefix and exact next
step, and appends a recovery receipt. The run's recovery count can increase only
when the matching receipt already exists. No retry or process restart rewrites
source truth.

The recovery contract deliberately permits a partial parity scope: after two
steps, the evidence and claim may exist while the decision and obligation do
not. Exact full-scope fan-in remains a completion requirement, not a resume
precondition.

### Gate extraction on four derived parity axes

The direct path first captures exact claim, decision, obligation, and evidence
IDs and deterministic content, excluding timestamps and session IDs that are
not domain behavior. It also captures the identical human-verification item
surface and the measured time needed to derive the mechanical projection.

After exact orchestrated fan-in, `verify_chorusmith_adapter_parity` re-derives:

- **behavior** — claims, validity, complete decision revisions/events, and obligations;
- **evidence** — exact evidence records and claim/evidence roles;
- **recovery** — a required interruption receipt when the manifest asks for the probe; and
- **verification time** — equal verification items and projection time within the frozen overhead ceiling.

Only a four-axis green record permits `ready → verified`. A mismatching baseline
records a red verification and leaves the run ready. The fixture's time metric
is explicitly mechanical projection time, not M7 human verification minutes;
real feature extraction still requires measured human-time parity.

### Keep the feature ledger conservative

The feature-by-feature extraction ledger marks all six workflows
`retained-direct`. Decision, obligation, and run-manifest behavior have a full
direct-versus-adapter replay; the three large furnished-artifact workflows have
contract/envelope coverage but have not moved. Their rollback is therefore not
a compensating migration—it is simply invoking `amanuensis-memory` directly.

## Custody matrix

| Asset | Owner | Other side's bounded authority |
|---|---|---|
| Durable codebase truth | Amanuensis | Chorusmith may project and invoke only |
| Session artifacts | Chorusmith | Amanuensis validates and lands domain results |
| Provider configuration | Chorusmith | Amanuensis enforces the preauthorized envelope |
| User preferences | Human | Both systems transport or retain typed scope; neither originates desire |

The machine-readable matrix is checked in beside the adapter schemas and is
returned by `get_chorusmith_adapter_catalog`.

## Options considered

- **Move the workflow into Chorusmith now:** rejected because native external-MCP
  consumption and per-feature parity are not established.
- **Give Chorusmith a direct database writer:** rejected because it would bypass
  the invariants this integration is supposed to preserve.
- **Copy invariants into the adapter prompt:** rejected because two prose copies
  would drift and generative required fields do not prove truth.
- **Replay completed calls after interruption:** rejected because non-idempotent
  domain writes could duplicate or diverge. The durable landed prefix determines
  the next call.
- **Call contract existence parity:** rejected. Contracts and envelope schemas
  are one ledger state; behavioral replay is another, and extraction remains
  retained-direct until the latter exists per feature.

## Consequences

- Chorusmith-compatible projection and invocation are available without making
  Chorusmith a second source of codebase truth.
- Current direct Amanuensis operation is unchanged and is the rollback path.
- The adapter adds a small amount of temporary contract duplication; pinned
  upstream compatibility and contract tests make that debt visible.
- A future Chorusmith-native MCP client can consume the same manifest and
  artifact contracts. Its landing is an upstream capability change, not a reason
  to weaken or relocate the Amanuensis gate.
- “Adapter verified” does not authorize moving all six workflows. The parity
  ledger stays `retained-direct` until feature-specific behavior, evidence,
  recovery, and real human verification-time measurements are green.

## Practice basis

Practice catalog v2.8: GP8 and GP25 (subtractive allowlists halt), GP11
(provenance and custody), GP21/GP22 (adapter-unit success does not establish
composed migration safety), GP24 (exact step fan-in), GP28 (derived projections
and three-axis read-back generalized here to four parity axes), VP4 (red proofs),
VP11 (planned/landed reconciliation), and VP20 (consumer-side read-back). The
upstream compatibility record is pinned; it is not a claim about uninspected
future Chorusmith commits.

## Verification obligations

- [x] All six adapters have exact @1.0.0 artifact kinds, schema refs, and output slots.
- [x] The custody envelope validates a strict nested Chorusmith input projection without claiming to be a persisted Chorusmith record.
- [x] A run manifest resolves and freezes an exact repository commit before execution.
- [x] Checked-out commit drift halts before any adapter step can execute.
- [x] An extra step or post-landing output rewrite is rejected by the substrate.
- [x] Cross-adapter tool smuggling and out-of-order execution turn red.
- [x] Direct and adapter-mediated paths reconcile claims, decisions, obligations, and evidence IDs.
- [x] Direct and adapter-mediated parity snapshots produce the same deterministic clean-export hash.
- [x] Mid-run process removal resumes from the exact landed prefix after reopening SQLite.
- [x] Recovery does not require nonexistent future-scope objects and does not mutate source truth.
- [x] A model cannot accept a decision through the adapter; the draft and pending step remain intact.
- [x] A behavior mismatch records red and cannot advance the run to verified.
- [x] Versioned Decision, Obligation, and RunManifest exports deny external write authority.
- [x] Every feature remains `retained-direct`; rollback is explicit and immediately available.
