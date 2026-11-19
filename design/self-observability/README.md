# What Amanuensis can measure about itself, and what it would need

Written 2026-11-18. **[O]** marks an observation with a reference. **[J]** marks a judgment.

**Naming.** This is a local call log, not telemetry: nothing leaves the machine. Remote
collection would be a decision for a possible productized version and is out of scope here.
"Metrics" stays reserved for the roadmap's computed measures (M1–M17), which these rows feed.

**Status.** Layer A is implemented on branch `call-log`: `mcp-server/src/call-log.ts`, the
dispatcher in `mcp-server/src/index.ts`, and GATE CL1 in `mcp-server/test-call-log.mjs`.
These differ from the plan below:

- The sidecar is `<storage>/call-log/calls.db`. Three guards keep it out of the store's
  history:
  - its directory's own `.gitignore` of `*`, rewritten if it says anything else;
  - a `:(exclude)call-log` pathspec on every storage commit;
  - a refusal to record when that history already tracks it.

  The tracked top-level `.gitignore` of existing stores is not edited. Storage migration
  compares stores without the sidecar.
- Rule ids cover the shared argument helpers (`arg.*`), `session.required`,
  `knowledge-depth.*`, `ref.unknown-id`, `storage-commit.*`, `workspace.*`, schema
  validation (`schema.<ajv keyword>`) and `protocol.unknown-tool`. The other ToolError sites
  (about 700) are recorded with a null rule. A thrown refusal also records its `site`: the build
  file and line that threw it, which groups unlabelled refusals without storing their messages.
  Messages are not stored at all, because they echo arguments. Labelling the remaining sites is
  incremental work.
- Rows are written after the response, in a deferred flush that also opens the sidecar. A
  locked sidecar is never waited for: queued rows (up to 256) wait for the next flush.
- The first Codex review (2026-11-18) found seven defects in the first commit. All seven are
  fixed, and GATE CL1 turns red when any one of them is reintroduced. Two fixes have no gate:
  the migration manifest's exclusion of the sidecar, and tolerance of SQLite files that vanish
  during the storage-tree symlink walk.
- The model is not recorded. MCP does not carry it, so it belongs to layer B. The client name
  and version from `initialize` are recorded once per connection.
- Items served and omitted by budgeted reads are not recorded yet.
- `log_access` and `log_query` are not retired yet.
- The `exception` class has no gate, because nothing can make a tool throw on demand without
  a test hook.

The remaining layers are still proposals.

## 1. Answer

Amanuensis is good at checking that its record is internally consistent: gates, invariants,
receipts, resolution history and projection read-back. It can measure almost nothing about how
it is used or whether it helps.

- The roadmap defines the right metrics (M1–M17, `ROADMAP.md:1480`), but only fixtures feed
  them.
- The tables meant to record use are empty in every real store.
- Every quality measurement taken so far was a separate manual study run outside the store:
  the efficacy pilot, the explanation blind reads and the evidence-range check. None of them
  can be repeated without rebuilding it by hand.

The only usage record that exists today is the hosts' session transcripts. Nothing reads them.

## 2. What exists today

| Signal | Mechanism | State in real stores |
|---|---|---|
| `access_log`, `query_log` | the model calls `log_access` / `log_query` voluntarily | **[O]** AxiomDB: 1 access row and 0 queries across 86 sessions. Self-store: 0 and 0. Neither tool appears once in 14,580 transcript calls. |
| `subagent_log` (`log_dispatch`) | voluntary | 0 rows in both stores |
| `evaluation_*`, `learning_*`, `operating_envelope_*` | orchestrated programs | 0 rows in both stores |
| `sessions` | `start_session` / `end_session` | **[O]** Outcome is free text (for example, "interrupted: weekly usage limit at 21:50…"). 21 of 35 self-store sessions never ended. |
| Tool refusals | `ToolError` returned to the caller | **[O]** Not recorded. Only unexpected exceptions reach stderr (`mcp-server/src/index.ts:410-417`). |
| Model and host on each write | — | **[O]** Recorded only on the orchestrated-run tables (review passes, refresh and revalidation dispatches, design lenses), which are unused. Evidence, findings, claims, explanations and dispositions carry only a `session_id`, and a session records no model, host or skill version. |
| Finding outcomes | `finding_resolution_events` | Usable. **[O]** AxiomDB: 29 fixed, 3 ruled out, 1 open. |
| Schema version | migrations | **[O]** Three stores (scholiast, pecia-public, axiom) lack tables that current code expects. Skew is invisible until a query fails. |

## 3. What the transcripts show

`mine-transcripts.py` (in this directory) read all 873 Claude Code transcripts that call the
server. It took about a minute. The 250 Codex sessions were not read.

**[O]** 14,580 calls between 2026-08 and 2026-11, with 1.2% returning `ok:false`.

**The workload is bookkeeping, not reading.**

| Tool group | Calls |
|---|---|
| `clear_staleness` | 2,618 |
| `add_evidence` | 2,430 |
| `add_files_to_scope` | 1,618 |
| `describe_locus` | 34 |
| `get_attention` | 3 |
| `get_history`, `get_codebase_brief`, `get_claims`, `compile_review_brief` | 0 each |

The read path the product exists for is barely used.

**Most of the tool surface has never run outside tests.** About 137 of 213 tools were never
called in any transcript. That includes all of the evaluation, learning, design-session,
research, composition, review-session and Chorusmith machinery.

**Most refusals are friction, not catches.** These are the most common causes:

| Count | Refusal |
|---|---|
| 26 | `commit_phase_gate`: commit label too long |
| 16+ | a write before `start_session` |
| 9 | `upsert_seam`: enum mismatch on `shared_object_kind` |
| 16 | `set_disposition`: knowledge-depth contract (a real gate) |
| 6 | `materialize_docs`: unreconciled store (a real gate) |

**[J]** Today nothing can tell "a gate stopped a bad write" apart from "the agent fumbled the
schema". That distinction decides whether enforcement is worth its cost.

**Latency:** `materialize_docs` has a p95 of 141 s and a 7.5% refusal rate. Everything else is
under 2 s at p95.

## 4. What is needed

Each layer builds on the one before it. Layer A is the cheapest and unblocks the rest.

### A. An automatic call log in the dispatcher (no model cooperation)

Add a `tool_calls` row for every call to `CallToolRequestSchema`, with these fields:

- timestamp
- session id
- tool
- server version and schema version
- host (Codex or Claude) and the client-declared model, when the host passes one
- argument sizes, plus a digest of the arguments rather than their text
- outcome class: `ok`, `validation`, `refusal`, or `exception`
- **refusal rule id**
- latency in milliseconds
- response bytes
- for budgeted reads: items served and items omitted, by reason

The refusal rule id is the key change. Give every `ToolError` a stable id, such as
`knowledge-depth.set_disposition` or `label-length.commit_phase_gate`. The prose message can
stay as it is.

Storage:

- Keep the log in a sidecar database next to `memory.db`. Do not track it in the store's Git
  history: high-volume writes would bloat that history, and the log must not change record
  digests (the efficacy trial pins those).
- Store no question text by default.

Retire `log_access` and `log_query`, and derive access heat from `tool_calls`. Voluntary
logging has a measured adoption rate of zero.

**Gate:** one call of each outcome class, including a refusal, produces exactly one row with the
right rule id. Opening a store does not change its digest.

### B. Structured provenance and lifecycle

- Record `host`, `model`, `effort`, `skill_version` and `server_version` on every session.
  Each write already carries a `session_id`, so every write inherits them. This is the minimum
  needed to answer "did the new skill or prompt make findings better?"
- Make the session outcome an enum: `completed`, `interrupted:<cause>`, `abandoned` or
  `superseded`. Keep a free-text note beside it. A session that stays open past a timeout is
  closed as `abandoned` the next time the store opens.
- `clear_staleness` records a basis (proposal S6 in `design/explanation-quality`). It is the
  most-called tool and the least auditable.

### C. Truth signals: the only metrics about quality

Layers A and B measure activity. Quality needs an outcome that comes from outside the writing
model. Four of these signals are almost free:

1. **Finding precision.** The ruled-out share, compared with the share that ends verified-fixed,
   for each pass type, model and skill version. Resolution events already exist; layer B adds
   the attribution.
2. **Claim error compared with claim decay.** When a claim is invalidated, record whether it was
   wrong when written or the code changed afterwards. Only the first is a survey defect. Today
   both look alike.
3. **Explanation reviews as records.** This is S5 in `design/explanation-quality`. Each blind read
   lands as a row with its false-sentence count and kilobytes read. The 0.72 and 0.98 per-KB
   figures then become a time series instead of one study.
4. **Evidence rot.** Validate evidence at write time (S3). A periodic job re-checks a random
   sample of old rows against their revisions. This turns the "13 of 35 out of range" finding
   into a monitored rate.

Two more signals measure whether the record actually helps:

5. **Consult rate.** In sessions where the server was available, the share that read the record
   before answering. The 2026-09-20 efficacy pilot found an arm that never consulted it
   (`design/efficacy-trial/README.md` §11). This comes from layer A plus the session.
6. **Bypass rate.** After `describe_locus` serves a file, how often the agent opens that file
   anyway. This needs the host transcript or a hook. **[J]** It is the cheapest proxy for "the
   record was not enough", and it is also the most ambiguous: reading to verify is good
   behavior.

The last signal is the most valuable one for "where insight matters":

7. **Escapes.** A later commit fixes or reverts code on a locus the ledger records as examined,
   and that locus had no finding. Each escape is a candidate missed finding and goes to a review
   queue. The labeled set grows by itself, and it is the denominator that M5 and M6 lack outside
   fixtures.

### D. An automatic analyzer

A scheduled job in the existing lane harness reads layers A–C and writes a ranked report. It
runs one detector per question you would otherwise ask by hand:

| Detector | Fires when | Suggested action |
|---|---|---|
| Friction | a tool's refusal rate for schema, enum or length rule ids is over 3%, or one call is retried immediately | Fix the description or schema |
| Dead surface | a tool has not been called in 60 days outside tests | Delete it, or wire it into the skill |
| Silent gate | a rule id has never fired | Seed a positive-control fixture (VP8). Without one, a working gate and a broken gate look the same. |
| Quality drift | finding precision, false sentences per KB or evidence rot moves beyond its step size after a skill or server version change | Bisect by version |
| Demand gap | a locus is read often (`describe_locus` returns `unledgered` or `scoped-unread`) or churns often in Git, but is thinly covered | Queue a targeted survey there first |
| Escape | signal 7 above | Review it; on confirmation, add it as a labeled miss |
| Abandonment | `interrupted` or `abandoned` sessions rise, grouped by cause | Investigate the cause |
| Schema skew | a store's schema version is behind the server's | Migrate before the store fails |

The demand-gap detector answers "improve insight where it matters": it ranks unsurveyed or
ageing territory by what people actually ask about and change, instead of by directory order.

## 5. Order and cost

1. **A, with rule ids.** A small change confined to the dispatcher, one table and one id per
   `ToolError` site. Until it lands, everything else depends on transcripts.
2. **B.** Schema columns plus a skill change to pass host and model.
3. **Backfill.** Run `mine-transcripts.py`, extended to Codex sessions, once as the baseline.
   Labels for later runs then have something to compare against.
4. **C1, C2, C4, then C3, C5, C6.**
5. **D.** Start with friction, dead surface and silent gate: they need only layer A. Add drift,
   demand and escapes as their inputs arrive. Escapes come last, because they need a review
   queue to be useful.

## 6. What this cannot establish

- None of this replaces the efficacy trial. A usage log shows whether the record is read
  and whether its own outputs hold up. It cannot show that an agent does better with the record
  than without it. Only an ablation shows that.
- Escapes are candidates, not ground truth. A fix on an examined locus may concern behavior the
  survey was never asked about.
- The transcript numbers in section 3 come from regex matching over host logs: refusal
  detection reads the first 600 bytes of each result. Codex is excluded. Treat them as
  **Grounded**, not **Measured**.
