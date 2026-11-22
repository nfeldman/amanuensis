// The structure narrative a fixture owes before it may advance to `concerns`
// (design/store-only/PLAN.md §2.5). A test that climbs the ladder is not testing
// the narrative, so it declines the section with a reason and moves on. Calling it
// again changes nothing, so a helper that climbs twice does not stack rows.

import { narrativeTools } from "../dist/tools/narratives.js";

export const FIXTURE_STRUCTURE_DECLINATION =
  "Fixture subsystem: its seeded files say nothing true and specific enough to narrate.";

/**
 * Decline the `structure` narrative of `subsystemId` unless one already stands. The
 * subsystem has to be at `scoping` or later, `ctx` has to hold an active session, and
 * `refSha` has to resolve in the bound workspace, as for any `decline_narrative`.
 */
export function answerStructure(ctx, subsystemId, refSha) {
  const standing = ctx.db
    .prepare(
      `SELECT disposition FROM narratives
        WHERE subject_type = 'subsystem' AND subject_id = ? AND section = 'structure'
        ORDER BY id DESC LIMIT 1`,
    )
    .get(subsystemId);
  if (standing && standing.disposition !== "withdrawn") return;
  const decline = narrativeTools.find((tool) => tool.name === "decline_narrative");
  decline.handler(
    {
      subject_type: "subsystem",
      subject_id: subsystemId,
      section: "structure",
      reason: FIXTURE_STRUCTURE_DECLINATION,
      ref_sha: refSha,
    },
    ctx,
  );
}
