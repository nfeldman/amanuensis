// The stable claim_key a fixture must write for a key type or state container.
//
// add_claim refuses `<sid>/<category>/<anything>` unless `<anything>` is the
// subject's `<symbol-slug>`: the whole `<path>:<symbol>` pair, lowercased, with
// non-alphanumeric runs collapsed to `-` (phase-2-structural.md, B04-R7).

/** phase-2-structural.md's `<symbol-slug>`. */
export function symbolSlug(subjectId) {
  return String(subjectId)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** `<sid>/<category>/<symbol-slug>` for a key-type or state-container claim. */
export function stableClaimKey(sid, category, subjectId) {
  return `${sid}/${category}/${symbolSlug(subjectId)}`;
}
