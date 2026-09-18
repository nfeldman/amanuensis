# Owner decisions for the survey-depth lane

Recorded 2026-09-14. These bind the specification.

1. **Fix the tool, not the data.** The archived store is the measured baseline, not a
   restore target. The lane's acceptance is a rebuild that dominates it on the named
   depth measures and accounts for its open findings.
2. **Substrate, not prose.** Every depth obligation is enforced by the server or a gate
   with a named red condition; the skill's references are updated to say the same thing,
   and a check keeps them aligned.
3. **Discharge or decline, never a floor.** Vocabulary and similar generative obligations
   are satisfied either by real records with resolvable anchors or by an explicit,
   reasoned declaration that none apply. No numeric minimums.
4. **Findings survive a rebuild.** A reinitialization carries prior findings forward as
   unverified obligations that must be re-found, ruled out with evidence, or marked
   repaired at a commit before the store is fully surveyed.
5. **Models.** Opus at maximum effort for design, revision, implementation, fixes, and
   the second reviewer. Codex `gpt-5.6-sol` at `xhigh` remains the blind heterogeneous
   reviewer for the design round, every slice, and the final review. No Fable sessions.
6. **Custody.** Work lands on branch `survey-depth` in a dedicated worktree from `main`
   at `d2b1630`. The primary checkout, its rebuilt store, and the AxiomDB repository are
   read-only for the lane. Nothing is pushed or merged by the lane.

7. **An impossible or vacuous requirement does not apply.** Where context makes an otherwise
   blanket requirement impossible to satisfy or empty of content, it does not bind. It must be
   recorded where the requirement lives, together with what discharges the obligation instead; it
   is never dropped in silence. Applied 2026-09-17 to the red-commit protocol for a gate whose red
   condition is a property of an untracked live store (spec §8.0 clause 4).
8. **Baseline parity stands, and the acceptance survey resumes.** B2's examined fraction is
   expensive but neither impossible nor vacuous: the baseline reached it by classifying and
   reading, which is the work this lane exists to make unavoidable. P10 therefore runs as many
   implement sessions as it needs against the store P8 initialized, each required to advance a
   recorded progress measure; a session that advances it and runs out of budget returns the packet
   to `ready` rather than blocking the lane.
