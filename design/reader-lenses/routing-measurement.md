# Routing measurement: does the consumer route reach `describe_locus` in one call?

**Status: specified, not yet run.** The protocol below is fixed by spec §13.2 and landed with
packet P15. It runs over the rebuilt self-conspectus, which slice S6 produces (P16–P18), so it
cannot be run before that store exists. Nothing in the implementation waits on it: it **gates
nothing**, it is not in CI, it blocks no packet, and `mcp-server/test-consumer-route.mjs` asserts
this document's protocol only — never its result.

## The claim under measurement

C64. Spec §5.4 rewrote `SERVER_INSTRUCTIONS` so that the first sentence routes a reader to
`describe_locus`. The reviewed draft wanted a gate asserting that "a harness given only the server
instructions needs more than one call to answer a file question". §13.1 refused that: it is a claim
about a model's behaviour, one run of it is not a measurement (VP5), and it needs an arm to compare
against (VP10). This file is where it is measured instead.

## What is counted

For one session answering one question:

| Quantity | Definition |
|---|---|
| `calls_to_standing` | Amanuensis tool calls issued before the answer first states the locus's standing — its state, or that no record exists. A session that never states standing records `calls_to_standing: null` and `stated_standing: false`. |
| `used_describe_locus` | Whether `describe_locus` was among them, and at which position (1 = first call). |
| `read_source` | Whether the session read the file's source before stating standing. Reading source is not an error; improvising a reading the record does not carry is what §5.4 asks agents to stop doing, and this column is what makes that visible. |
| `stated_standing` | Whether the answer states what the record authorizes, rather than only what the file appears to do. |

**Least count: one tool call.** No effect smaller than one call is reportable, and no arithmetic
below turns a difference of one call into a fractional claim.

## The two arms

Two arms, identical in every respect but the instruction string. The same rebuilt self-conspectus
store at one recorded commit, the same advertised tool surface, the same model at the same effort, no
Amanuensis skill installed in either arm — the skill's routing row (§9.3) answers the very question
the instructions are being measured for, so its presence would confound both arms equally and
measure nothing.

| Arm | Instructions |
|---|---|
| **A — with the `describe_locus` route** | `SERVER_INSTRUCTIONS` as landed by P15: the consumer route first, the producer route after it. |
| **B — without the `describe_locus` route** | The pre-P15 producer-only text, recovered from `git show <baseline sha>:mcp-server/src/index.ts`. The three reader tools stay registered and stay advertised; only the sentence that routes to them is absent. |

Arm B is the baseline, and it is verified rather than assumed (VP10): before the questions are run,
one probe confirms that arm B's server advertises `describe_locus` with the same schema and
annotations as arm A's. An arm B that could not reach the tool at all would measure tool absence,
not routing.

## Runs

**2 runs per arm** per question — 20 × 2 × 2 = 80 sessions. Runs are independent: no session sees
another's transcript, and there is no deliberation round. Test-retest is read before any comparison
between arms (VP5): if the two runs of one condition differ by more than the difference between the
arms, the apparatus cannot resolve the effect and that is the finding.

## The 20 file questions

Phrased as a reader would ask them, one locus each. The mix is deliberate: some loci the rebuilt
conspectus will have examined, some it will have scoped and not read, and some it will not carry at
all. The third kind is where the claim actually bites — an unrecorded file is where a session is
most likely to read the source and improvise rather than say there is no record.

| # | Question | Locus | Standing sought |
|---|---|---|---|
| Q1 | What do we know about `mcp-server/src/index.ts`? | file | examined |
| Q2 | Before I change `mcp-server/src/db.ts`, what is recorded about it? | file | examined |
| Q3 | Is there a finding on `mcp-server/src/project.ts`? | file | examined |
| Q4 | What do we know about `mcp-server/src/tools/locus.ts`? | file | examined |
| Q5 | What is recorded about `mcp-server/src/standing.ts`? | file | examined |
| Q6 | Before I change `mcp-server/src/helpers.ts`, what should I know? | file | examined |
| Q7 | Is there a finding on `mcp-server/src/tools/findings.ts`? | file | examined |
| Q8 | What do we know about `materializer/amanuensis_materializer/renderers.py`? | file | examined |
| Q9 | What is recorded about `materializer/amanuensis_materializer/html_projection.py`? | file | examined |
| Q10 | Before I change `materializer/amanuensis_materializer/diagrams.py`, what is known? | file | examined |
| Q11 | What do we know about `mcp-server/src/cli.ts`? | file | examined |
| Q12 | Is there a finding on `mcp-server/src/codex-host.ts`? | file | examined |
| Q13 | What is recorded about `mcp-server/src/tools/review-session.ts`? | file | examined or scoped-unread |
| Q14 | What do we know about `mcp-server/src/tools/chorusmith-adapter.ts`? | file | examined or scoped-unread |
| Q15 | Before I change `dev/promote-docs.mjs`, what is known about it? | file | scoped-unread or unledgered |
| Q16 | Is there a finding on `dev/render-roadmap.mjs`? | file | scoped-unread or unledgered |
| Q17 | What do we know about `mcp-server/scripts/gen-vocabulary.mjs`? | file | scoped-unread or unledgered |
| Q18 | What is recorded about `mcp-server/test-locus-compactness.mjs`? | file | excluded or unledgered |
| Q19 | Before I change `.github/workflows/test.yml`, what is known? | file | excluded or unledgered |
| Q20 | Is there a finding on `mcp-server/src/tools/does-not-exist.ts`? | file | unledgered, path absent |

The "standing sought" column is the reason the locus is on the list, not a prediction to be scored.
The standing each locus actually holds is read from the store at the run's commit and recorded
beside the result; a locus whose standing differs from the column is reported with its real
standing, not dropped.

## Recording

One row per question per arm per run. Nothing is averaged into this table.

| Question | Arm | Run | `calls_to_standing` | `used_describe_locus` (position) | `read_source` | `stated_standing` | Recorded standing |
|---|---|---|---|---|---|---|---|
| Q1 | A | 1 | — | — | — | — | — |
| Q1 | A | 2 | — | — | — | — | — |
| Q1 | B | 1 | — | — | — | — | — |
| Q1 | B | 2 | — | — | — | — | — |
| … | … | … | — | — | — | — | — |

Run metadata recorded once, in this file, when the measurement is run: the model and effort, the
repository commit, the conspectus store's `last_checked_sha`, the date, and the harness invocation.

## How it is read

- **Per question and per arm.** The unit is the question; 20 questions are 20 results, not one.
- **Never pooled across arms** (VP6). No mean, median, or count is reported over arms A and B
  together. Pooled dispersion here would be a property of the question set, not of the route.
- **Both runs are shown.** Two runs of one condition that disagree are reported as disagreeing;
  the disagreement is the reliability reading, and it is stated before any between-arm comparison.
- **A null result is reported as a null result** — in this file, in the same detail, with the
  question-level table intact. If the arms are indistinguishable at a least count of one tool call,
  §5.4's wording stands as landed and this document says the route was not shown to change what the
  model did. No packet is reopened and no gate changes either way.

## What it cannot settle

One model, so it is that model's behaviour and not a property of hosts in general. Twenty questions
chosen for their standing mix, not sampled, so it is not a rate over the repository. The harness
sees the instructions and the tool list; a host that also injects the skill, a project `CLAUDE.md`
paragraph (§P15's installer opt-in), or a system prompt of its own is a different condition that
this design does not measure. And a session that reaches `describe_locus` in one call has been
routed, which is not the same as having answered well: nothing here scores the answer's content.
