# Owner decisions on the reader-lenses proposal

Recorded 2026-09-11 from the owner's answers to the six open questions in `README.md`
section 7. These bind the specification. The design session chooses within them; it
does not reopen them.

1. **Labels.** Use whatever conveys accurate meaning to both human and AI consumers with
   the least room for imported, unwanted meaning. Within that constraint the design
   chooses the words. Record the choice and the rejected alternatives in the rationale.
2. **History as a lens.** Acceptable, provided it survives the review passes. If a
   reviewer overturns it with evidence, fold resolved records into the attention lens as
   its last group under the same partition rule.
3. **Per-file pages.** No. One files index with anchors into subsystem pages. A better
   visual design, or simple JavaScript enhancement of the projections to make them more
   navigable, is welcome. Keep it tasteful. Accessibility is required: keyboard
   operation, accessible names and states, a complete no-JavaScript reading path.
4. **Backfill.** Can wait. The Amanuensis self-conspectus is to be discarded and rebuilt
   with the new survey so its documentation is claims-backed; that rebuild is in scope
   for this cycle. AxiomDB backfill is a separate consideration that may be skipped; it
   is out of scope here.
5. **Hook-based injection.** No. The tools are called often; do not spam the context.
   Compactness of every new tool response is a design constraint with a mechanical
   gate, not a preference.
6. **Attention vocabulary.** Reuse ADR-0010's operational labels for `get_attention`.
   Do not re-base the review session on it in this cycle.

Operating assumptions the owner did not state and the lane records explicitly:

- Design, revision, implementation, and fix sessions run on Opus at maximum effort.
- Design review uses two independent reviewers: Codex `gpt-5.6-sol` at `xhigh` and
  Claude `claude-fable-5-1` at `xhigh`. Slice reviews use the Codex reviewer alone; the
  final whole-branch review uses both.
- Work lands on branch `reader-lenses` in a dedicated worktree. Nothing is pushed or
  merged by the lane; merging is the owner's decision.
