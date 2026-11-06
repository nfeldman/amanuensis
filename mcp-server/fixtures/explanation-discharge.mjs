// The explanation a fixture owes before it may advance to `mapped`
// (design/explanation/spec.md §3.4). A test that climbs to `mapped` is not testing
// the explanation, so it declines both slots with a reason and moves on. Calling
// it again changes nothing, so a helper that climbs twice does not stack rows.

export const FIXTURE_DECLINATION =
  "Fixture subsystem: its seeded files say nothing true and specific enough to explain.";

/**
 * Decline each slot of `subsystemId` that holds no standing row. The subsystem has
 * to be at `structural` or later, `ctx` has to hold an active session, and `refSha`
 * has to resolve in the bound workspace, as for any `decline_explanation`.
 * `call(name, args, ctx)` is the calling test's own way into the handlers.
 */
export function dischargeExplanations(call, ctx, subsystemId, refSha) {
  for (const slot of ["purpose", "account"]) {
    const newest = ctx.db
      .prepare(
        `SELECT disposition FROM explanations
          WHERE subject_type = 'subsystem' AND subject_id = ? AND slot = ?
          ORDER BY id DESC LIMIT 1`,
      )
      .get(subsystemId, slot);
    if (newest && newest.disposition !== "withdrawn") continue;
    call(
      "decline_explanation",
      {
        subject_type: "subsystem",
        subject_id: subsystemId,
        slot,
        reason: FIXTURE_DECLINATION,
        ref_sha: refSha,
      },
      ctx,
    );
  }
}
