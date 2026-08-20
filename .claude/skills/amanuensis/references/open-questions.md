# Open-question protocol

Autopilot is the default. Anything you can't decide cleanly — without
guessing on something the human should rule on — becomes an
`open_question` row. You record it, attach `what_assumed` so the
working state is consistent, and continue.

The queue is the asynchronous replacement for per-phase pauses. The
human works through it after natural checkpoints (end of onboarding
Phase 7, end of each subsystem's Phase 5, end of a batch).

## When to record an open question vs. when to stop

**Record (default)** — judgment calls where a reasonable assumption
keeps the survey moving forward and doesn't taint downstream work
that can't be corrected:

- "Is `X` a sanitizer or a passthrough? Comment says one, code
  reads like the other."
- "Should the generated `pb.go` files be in scope, or only the
  proto schemas?"
- "Which of two equally-plausible seams gets `SC-1`?"
- "Tenancy semantics aren't documented — what scope discriminant
  goes in this concern's `business_context`?"

**Stop (rare)** — the few cases where guessing would corrupt the
conspectus or risk destructive action. See SKILL.md "Conditions that stop
execution" for the full list.

When in doubt, record and continue. The human can always re-direct
at the next checkpoint; you cannot un-stop a stopped run.

## Categories

Pick the closest match. The category drives how the materializer
groups questions in the docs.

- **`domain-knowledge`** — the code does X; you cannot tell whether
  X is the intended business rule or a bug. (e.g. "this dedupes by
  user_id; is multi-account-per-email a supported case?")
- **`scope-judgment`** — should file F be in scope? You picked an
  answer; log it. (e.g. "this generated stub is the public API for
  another service; I'm including it as `examined`.")
- **`priority-ranking`** — multiple equally-plausible orderings;
  the choice would benefit from human input. (e.g. "B-02 and B-05
  are tied at priority 2; I'm surveying B-02 first because it has
  more confirmed-bug history.")
- **`contradiction`** — two equally-credible sources disagree and
  the survey cannot resolve. (e.g. "README says auth is
  session-based; code in `auth/middleware.ts` uses JWT.")
- **`ambiguous-evidence`** — evidence permits multiple
  interpretations. (e.g. "this lock could be reentrant or not
  depending on the platform `pthread_mutex_t` is configured with;
  I assumed non-reentrant.")
- **`tooling-limit`** — an operation you could not perform in this
  environment (e.g. "I could not run the test suite to confirm the
  expected sanitization output; assumed the existing snapshot is
  current.")
- **`other`** — escape hatch; use sparingly.

## Always populate `what_assumed`

The point of `what_assumed` is that downstream work stays consistent
with a specific interpretation. Without it, the queue is just a list
of doubts; with it, the queue is a list of reviewable decisions.

Bad:
```
record_open_question(
  category="domain-knowledge",
  question="Is multi-tenancy in scope?",
)
```

Good:
```
record_open_question(
  category="domain-knowledge",
  question="Is multi-tenancy in scope?",
  what_assumed="Yes. The `tenant_id` column appears in 12 tables and the
                JWT carries one — treating tenant-scope as the default
                discriminant for cache and identity concerns.",
)
```

## What does NOT belong in the queue

- **Field notes.** Patterns, anomalies, tensions, candidate
  concerns — those go to `add_field_note`. The queue is for
  decisions that needed human input you didn't have, not for
  general observations.
- **Confirmed bugs.** Bugs go to `add_finding`. An open question
  about whether something is a bug becomes a finding only once you
  decide.
- **Contradictions between two findings.** That's
  `add_contradiction`, a structured row, not an open question. Use
  `contradiction` here only for source-disagreement at survey
  time (README vs code, doc vs runtime, two engineers' comments).

## Reviewing the queue

The materializer renders open questions per phase boundary in the
relevant subsystem-survey artifact, plus a global queue on the
findings index. After a checkpoint, the human can:

- Answer the question — `resolve_open_question(id, resolution=...)`.
  The resolution flows back into the affected disposition or
  artifact at the next survey or refresh pass.
- Convert it to a finding — if the answer reveals the assumption
  was wrong and the right answer is "yes, this is a bug."
- Convert it to a field note — if the answer doesn't change the
  classification but adds context.
- Mark it as `wont-resolve` — if it's genuinely out of scope.

You, the coordinator, do not resolve questions on the human's
behalf unless the human says so (e.g. "answer all my open
priority-ranking questions with 'no opinion, keep the
coordinator's pick'").

## Headless / cloud preflight

When the skill runs unattended (GitHub Actions, Claude Code in
`--dangerously-skip-permissions` mode), there is no human at the
other end of any checkpoint. The skill should:

1. Verify `get_autoprogress_mode()` returns `autoprogress=true`
   (the shipped `.mcp.json` sets this; see `setup.md`).
2. Run as if option **A — autopilot until done** was selected.
3. Emit checkpoint summaries to stdout for the CI log; do not
   wait for input.
4. At the end of the run, emit a final report:
   ```
   Survey complete: <target>
     session:        <id>
     dispositions:   N
     findings:       N (C critical, H high)
     open questions: N (breakdown by category)
     final commit:   <short-sha>
   ```
5. Exit non-zero if open-question count exceeds a configured
   ceiling (the cloud caller decides the ceiling — usually a
   sentinel like `domain-knowledge >= 1` blocks merge).

The open-question breakdown is the key signal: small and mostly
`priority-ranking` means the survey is in good shape; high or heavy
on `domain-knowledge` / `contradiction` means a human pass is needed
before the conspectus updates can be trusted.

## If `autoprogress` is off

If `get_autoprogress_mode()` returns `autoprogress=false`, the
server was launched without `AMANUENSIS_AUTOPROGRESS=1`. In that
mode `record_open_question` is unavailable — the methodology falls
back to **strict interactive**, with pauses at every phase boundary
and Tier-1/2/3 human questions blocking onboarding Phase 6.

This is no longer the default. If the user wanted strict interactive
they would have set it deliberately; if they didn't, point them at
`setup.md` and offer to relaunch.
