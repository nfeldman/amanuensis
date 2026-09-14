# **B-11** — Development harness and gates

**Status**: 🟢 mapped  
**Layer**: harness

## Scope

No purpose statement is recorded for this subsystem; the scope below states what it covers.

dev/*.mjs, mcp-server/scripts/*.mjs, mcp-server/test-*.mjs, materializer/test-*.py, .github/workflows/test.yml — the red-provable gates, the generated-artifact checkers, and the CI job list that runs them.

## Start here

.github/workflows/test.yml, then dev/check-living-conspectus.mjs

## Structure

What the survey recorded as claims about this subsystem, grouped by what each one states. Every claim is bound to the revision it was asserted at and to the evidence attached to it; a superseded claim is not shown here.

### Key types

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-11/key-type/github-workflows-test-yml-pecia-defects` | `.github/workflows/test.yml:pecia-defects` | A gate whose subject may be unavailable is opt-in at the job level rather than skipped inside a passing job: a skipped job reads as not-run, while a passing step that silently did nothing does not. The comment names three zero-denominator greens already found in this repository as the reason the distinction is made in the workflow rather than in the script. | Observation | `258ccd28fc19` |

### State containers

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-11/state-container` | `B-11` | **B-11** keeps no live state. What it keeps are committed receipts and fixtures — the A0 historical baseline, the rebuild receipts, the generated tool inventory — each written once and re-read by a later run. A receipt is durable state with a stated expiry of meaning: it proves what was true when it was written and nothing about now. | Inference | `258ccd28fc19` |

### Flow steps

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-11/flow/prove-a-gate/01` | `dev/test-rebuild-readback.mjs:the two-arm gate header` | Step 1 of a gate in this repository: the file states the conditions that turn it red and the false greens it cannot exclude, and scrubs the launcher's crash signatures out of its own output, so an absent deliverable reads as a failed assertion rather than as a gate that never reached one. | Observation | `258ccd28fc19` |

### Concurrency invariants

| Claim | Subject | Statement | Epistemic kind | Asserted at |
|---|---|---|---|---|
| `B-11/concurrency` | `B-11` | CI jobs run in parallel over separate checkouts, so no gate may depend on another's side effects. Gates that need a store build one in a throwaway workspace; the ones that cannot spawn a real subject assert over a committed receipt instead, which is the same reason the store itself is never a CI denominator. | Inference | `258ccd28fc19` |

## Boundaries

### Seams

| Seam | Shared object | Other party | Assessable |
|---|---|---|---|
| **[SM-09](../seams.md#sm-09)** | the built server at mcp-server/dist/index.js, spawned by gates over the MCP protocol | **[B-01](b01-server-runtime-and-tool-dispatch.md)** | both parties are `mapped` |

### Recorded edges

| From | → | To | Relationship | Strength | Context |
|---|---|---|---|---|---|
| **B-11** | → | **[B-09](b09-projection-read-back-and-publication-custody.md)** | data-flow | observed | the living-conspectus gate reads the committed projection receipts as its denominator, so a publish that recorded nothing gives that gate nothing to check, read at dev/check-living-conspectus.mjs:main@258ccd2 |
| **B-11** | → | **[B-01](b01-server-runtime-and-tool-dispatch.md)** | dependency | structural | the gates drive spawned server processes over the protocol rather than importing handlers, so what they exercise is the built server a host would launch, read at dev/test-rebuild-readback.mjs:client@258ccd2 |

## Known defects here

2 defects here are open or awaiting verification. Each one's full record, with its evidence, is on [Open findings](../findings.md).

- The revision-ancestry axis of dev/test-rebuild-readback.mjs and dev/test-rebuild-coverage.mjs cannot turn red in CI. The mcp-server job that runs both checks out at actions/checkout's default depth of 1; the gates detect the shallow clone, print that ancestry is not evaluable, and return a pass for that assertion. — [B11-1](../findings.md#b11-1) · 🔵 LOW · Open
- Three JavaScript files in the harness carry raw NUL bytes, which makes them binary to the repository's own search tools: `grep -n pairKey dev/test-rebuild-coverage.mjs` prints nothing and exits 1, and `rg -n pairKey` on the same file prints only "binary file matches (found \0 byte around offset 10704)" with no line number and no content. A search therefore reports that a symbol in a load-bearing gate is absent. — [B11-2](../findings.md#b11-2) · 🔵 LOW · Open

## Standing

**Mapped** — Survey complete through structural analysis, concern review, and adversarial challenge. It cannot justify that the reading is current at the repository head.

| Metric | Value |
|---|---|
| Files read | 5 of 7 ledger rows |
| Files in scope, not yet read | 2 of 7 |
| Files excluded from the survey obligation | 0 of 7 |
| Ledger rows the repository has changed under | 0 of 7 |
| Active concerns with a disposition recorded here | 7 of 15 — 1 confirmed-bug, 6 confirmed-acceptable |
| Findings by resolution state | 2 open |
| Seams assessable from both sides | 1 of 1 |

## Survey record

### File ledger

| Path | Classification | Why in scope | Examined at |
|---|---|---|---|
| <a id="le-8320171763"></a>`dev/check-living-conspectus.mjs` | candidate | Checks the immutable A0 historical fixture, which the rebuild must leave untouched. | `258ccd28` |
| <a id="le-936cd3a565"></a>`mcp-server/scripts/gen-tool-inventory.mjs` | candidate | Generates the tool inventory in DEVELOPMENT.md and re-checks it, so a new tool cannot land undocumented. | `258ccd28` |
| <a id="le-201eefec97"></a>`.github/workflows/test.yml` | examined | The gate list: four jobs, and the one opt-in job that refuses to run silently when its subject is unavailable. | `258ccd28` |
| <a id="le-bbe6f82316"></a>`dev/test-rebuild-coverage.mjs` | examined | Concern probe for [ZD-1](../concerns.md#zd-1): a two-arm gate whose revision-ancestry axis declares itself unevaluable in the job CI runs it from. | `0fee11b0` |
| <a id="le-0cf5457aa5"></a>`dev/test-rebuild-readback.mjs` | examined | The nearest neighbour to this packet's own gate: two arms, a procedure executed for real and a committed receipt asserted over. | `258ccd28` |
| <a id="le-560f30d3c5"></a>`mcp-server/scripts/check-evidence-vocabulary.mjs` | examined | Concern probe for [GT-1](../concerns.md#gt-1): the four-party vocabulary check, and the only place the hand-written party is compared with anything. | `0fee11b0` |
| <a id="le-9880e14212"></a>`mcp-server/scripts/gen-vocabulary.mjs` | examined | Concern probe for [GT-1](../concerns.md#gt-1): generates two parties and asserts parity with the third. | `0fee11b0` |

### Concern review

| Concern | Classification | Evidence quality | Linchpin? | Rationale |
|---|---|---|---|---|
| **[BV-1](../concerns.md#bv-1)** | confirmed-acceptable | code-verified |  | No gate takes an agent-supplied path: each resolves its targets from the checked-out tree relative to its own module directory and reads the repository it is running in, so there is no boundary to contain an argument against — the one boundary these files do draw is internal, a NUL separator chosen so two subsystem ids cannot concatenate into one key. |
| **[CC-1](../concerns.md#cc-1)** | confirmed-acceptable | code-verified |  | The gates that judge resolution state select from finding_state_current rather than mapping findings.status themselves, so the harness holds no third copy of the predicate; where a gate re-derives a rule deliberately — recomputing a claim_key slug rather than trusting the record — it is stated as the point of the check, not as a convenience. |
| **[EV-1](../concerns.md#ev-1)** | confirmed-acceptable | code-verified |  | Every receipt this harness asserts over binds itself to a repository revision, and the gates resolve each cited revision and check it reaches HEAD rather than accepting a well-formed hex string — the qualification being where that axis can run, which is [ZD-1](../concerns.md#zd-1) and is recorded there as [B11-1](../findings.md#b11-1). |
| **[GT-1](../concerns.md#gt-1)** | confirmed-acceptable | code-verified |  | Every generated artifact this harness owns is re-derived and compared in CI — the two vocabulary modules, the SQL CHECK literals, the four-party value lists, and the tool inventory block — and each comparison reads its party as text rather than following an import, which is what keeps a check from comparing one array with itself. |
| **[RC-1](../concerns.md#rc-1)** | confirmed-acceptable | code-verified |  | A gate that needs a store builds one in a throwaway workspace and kills the server process it spawned, so no gate leaves a handle or a directory behind for another to inherit; the one gate that destroys a real store is a separate driver requiring an explicit --confirm and is not run by CI at all. |
| **[SC-9](../concerns.md#sc-9)** | confirmed-acceptable | code-verified |  | From the gate side: in CI the build precedes every gate that spawns the server and a failed build fails the job, so no gate there judges a stale dist; outside CI a gate may be handed one, which is why each loads its subject defensively and reports absence as a failed assertion rather than dying on it. |
| **[ZD-1](../concerns.md#zd-1)** | confirmed-bug | code-verified |  | Two instances here, both of an answer taken from an absence the instrument created. [B11-1](../findings.md#b11-1): the rebuild gates' revision-ancestry axis cannot turn red where CI runs them, because the mcp-server job checks out at depth 1 while the sibling roadmap job sets fetch-depth: 0. [B11-2](../findings.md#b11-2): three harness files carry raw NUL bytes, so a grep over them reports a present symbol as absent and an rg reports a byte offset instead of a line — a verification of the gates whose denominator silently excluded them. The job-level opt-in on pecia-defects is the same distinction drawn correctly, which is what makes both of these omissions rather than policy. |

### Survey artifact

#### **B-11** · Development harness and gates

Structural inventory at `258ccd2`.

##### Key types

| Symbol | Role | Source |
|---|---|---|
| the `pecia-defects` job | opt-in at the job level rather than skipped inside a passing job | `.github/workflows/test.yml:pecia-defects@258ccd2` |
| the two-arm gate | a procedure executed for real, plus a committed receipt asserted over | `dev/test-rebuild-readback.mjs:the two-arm gate header@258ccd2` |

##### State containers

No live state. What is kept are committed receipts and fixtures — the A0 historical baseline,
the rebuild receipts, the generated tool inventory — each written once and re-read by a later
run. A receipt is durable state with a stated expiry of meaning: it proves what was true when it
was written. Recorded as an explicit negative claim (`B-11/state-container`).

##### Data flow · proving a gate

1. The gate file states the conditions that turn it red and the false greens it cannot exclude,
   and scrubs crash signatures out of its own output, so an absent deliverable reads as a failed
   assertion rather than as a gate that never reached one
   (`dev/test-rebuild-readback.mjs:the two-arm gate header@258ccd2`).

##### Concurrency model

CI jobs run in parallel over separate checkouts, so no gate may depend on another's side effects.
Gates that need a store build one in a throwaway workspace; those that cannot spawn a real
subject assert over a committed receipt. Recorded as an inference.

##### Seam contracts

- **[SM-09](../seams.md#sm-09) · the built server, with [B-01](b01-server-runtime-and-tool-dispatch.md).** The gates drive `dist/index.js` over the protocol
  rather than importing handlers, so a build that did not run is a gate that tested the previous
  revision.

##### Concern review

Six active concerns, all terminal at `0fee11b`. Two confirmed bugs, both under [ZD-1](../concerns.md#zd-1).

| Concern | Disposition | Reading |
|---|---|---|
| [CC-1](../concerns.md#cc-1) | confirmed-acceptable | Gates that judge resolution state select from the view; where one re-derives a rule it says that is the point of the check. |
| [RC-1](../concerns.md#rc-1) | confirmed-acceptable | A gate needing a store builds one in a throwaway workspace and kills what it spawned. |
| [BV-1](../concerns.md#bv-1) | confirmed-acceptable | No gate takes an agent-supplied path. |
| [EV-1](../concerns.md#ev-1) | confirmed-acceptable | Every receipt binds to a revision, and the gates resolve it — subject to where that axis can run. |
| [GT-1](../concerns.md#gt-1) | confirmed-acceptable | Every generated artifact is re-derived and compared in CI, each party read as text rather than through an import. |
| [ZD-1](../concerns.md#zd-1) | **confirmed-bug** ([B11-1](../findings.md#b11-1), [B11-2](../findings.md#b11-2)) | An axis that cannot turn red where it runs, and three gate files a search reports as absent. |

##### Adversarial review

**Finding [B11-1](../findings.md#b11-1) — upheld.** Claim A: the revision-ancestry axis cannot turn red in CI.
Claim B: another job runs the same gates with history. Evidence for Claim B: neither gate
appears in the roadmap job or in any other; each runs exactly once, in the `mcp-server` job,
at depth 1. Verdict: **upheld**.

**Finding [B11-2](../findings.md#b11-2) — upheld, and measured.** Claim A: three harness files are binary to the
repository's own search tools. Claim B: the content is unreachable, or the behaviour differs.
Evidence for Claim B: `rg --text -n pairKey dev/test-rebuild-coverage.mjs` returns the three
real matches, and Node treats a raw NUL and the escape as the same code point — so the content
is reachable and the run-time behaviour is identical. That is what makes this a legibility
defect rather than a correctness one, and it does not overturn the claim.
Verdict: **upheld**. Its filing under [ZD-1](../concerns.md#zd-1) is a stretch stated in the disposition and logged
as open question 5.

**Claims.** Four targets, all survived — `concurrency` checked against the workflow, which
carries no `upload-artifact` or `download-artifact` step at all.
