// The scope a fixture owes before it may advance to `mapped` (finding B03-5).
// A test that climbs to `mapped` is not testing examination, so it records every
// file it scoped and left at `candidate` as `examined`. Calling it again changes
// nothing: only rows still at `candidate` are touched.

/**
 * Record each obligation-bearing `candidate` row of `subsystemId` as examined.
 * `call(name, args, ctx)` is the calling test's own way into the handlers.
 */
export function examineScope(call, ctx, subsystemId) {
  const rows = ctx.db
    .prepare(
      `SELECT file_path FROM file_ledger
        WHERE subsystem_id = ? AND COALESCE(classification, 'candidate') = 'candidate'
        ORDER BY file_path`,
    )
    .all(subsystemId);
  for (const { file_path } of rows) {
    call(
      "update_file_classification",
      { subsystem_id: subsystemId, file_path, classification: "examined" },
      ctx,
    );
  }
}
