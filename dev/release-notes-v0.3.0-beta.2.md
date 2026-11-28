A read-only server mode for agents that consult a conspectus without surveying, a read-back fix, and plainer guidance for explanations.

### Changes

- **Read-only consumer mode.** `amanuensis-memory --consumer-read-only` serves an
  existing store with three tools: `get_project_info`, `describe_locus` and
  `search_records`. It opens the store read-only, never creates, initializes or
  migrates one, and refuses a store whose schema is older than the server's; open such
  a store once with the normal server first. The call log is off in this mode. The
  store directory must still be writable: SQLite may create the store's `-wal` and
  `-shm` files to read it, and `search_records` keeps the code index's sidecar beside
  the store.
- **Read-back.** A status written in a record's prose, such as a disposition rationale
  that names both `confirmed-bug` and `ruled-out`, prints as a chip, and the read-back
  used to take every chip in the record as its state, so the publish failed. Chips in
  the record's prose are now left out; the chip in its facts is still checked.
- **Explanation guidance.** The skill now says that a default, a configuration choice
  or something not built yet is a fact about the design, not a shortcoming, and that
  the project's account stays at the level of the parts and how work moves between
  them.

### Validation scope

The repository's [`tests` workflow passed](https://github.com/nfeldman/amanuensis/actions/runs/46102357099) at the release commit, and the
publish workflow verified the packed artifact before it published.
[Publication succeeded](https://github.com/nfeldman/amanuensis/actions/runs/46103332224), and [all four Linux/macOS
Node.js 20/22 smoke jobs passed](https://github.com/nfeldman/amanuensis/actions/runs/46104002708) against the registry version.
Every server and materializer CI step also ran serially in a fresh clone of the release
commit, the materializer under Python 3.11. The read-only consumer mode was run against a
copy of a real populated store, which it served without changing.

Product efficacy remains unestablished.

Install this exact prerelease with:

```bash
npm install -g @gruetech/amanuensis@0.3.0-beta.2
amanuensis install
amanuensis status
```

If you installed an earlier release, run `amanuensis upgrade` instead of `install`,
then restart your agents so existing connections load the new server. Until
`1.0.0`, breaking changes remain possible between releases.
