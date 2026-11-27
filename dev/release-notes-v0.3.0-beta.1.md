The store holds everything a survey learns, the published site is HTML only, and agents get a code index.

### Breaking changes

- **Pages are HTML only.** The materializer no longer writes a `.md` form of any page.
  Anything that read the Markdown pages should read the HTML pages or ask the server.
- **The agent no longer writes prose files.** The project profile, runtime boundaries,
  territory dispositions and every narrative are records in the store, written through
  tools. A store made by an earlier release keeps working: `import_artifact_bodies`
  copies its prose files into the store once, with their provenance.

### Changes

- **Everything in the store.** New tools record what used to live in hand-written files:
  `record_project_profile`, `record_runtime_boundary`, `record_territory_disposition`,
  `record_narrative` and `decline_narrative`, and `record_claim_mark`, which ties a claim
  to a place in the code. Boundaries, narratives and claim marks cite evidence at a
  revision, like a claim.
- **Pages from the store.** Every page is built from store rows (prose imported from
  an older store is still read as Markdown), and the read-back checks
  each rendered record and diagram against the store before a publish counts.
- **Diagrams.** The survey workflow and status ladder, coverage bars, finding badges,
  the seam between two subsystems and the flow through one are drawn as inline SVG at
  publish time.
- **For a first-time reader.** A guide lists every page and what it is for, defines
  Amanuensis's own terms, says what the ID letters mean and how a survey proceeds. The
  overview says what the codebase is and what its parts are; the survey's figures moved
  to an About this survey page.
- **A survey set.** A survey accounts for the tracked files except those the
  repository's ignore files match, those the owner excluded and those onboarding sorted
  as meta, such as plans and research. `set_scope_rule`, `record_scope_sorting` and
  `get_scope` manage the rules. A store that already has ledger rows or a
  reconciliation opens in legacy mode, where only the ignore files change what it must
  account for.
- **A code index.** `outline_file`, `read_symbol`, `find_symbol` and `search_records`
  let an agent find a definition, read it and cite it without slicing files by hand.
  Ten languages are parsed with tree-sitter grammars compiled to WebAssembly, with no
  native build; results are cached beside the store, never in it. The grammars make
  the package about 26 MB installed.
- **Evidence anchored to definitions.** When `add_evidence` names a symbol in a
  supported language and the index is available, the server resolves it at the cited
  revision and keeps the cited range inside that definition. For a stale file, the
  refresh backlog says whether the cited definition is the same, moved, changed or gone,
  or why it cannot tell.
- **Shorter explanations, rewritten on request.** The skill asks for accounts and
  narratives of about 2048 bytes that keep only what a reader would otherwise get wrong,
  and leaves findings to their own pages. Recorded explanations and narratives can be
  rewritten on the reader's word, or replaced with text the reader writes.

### Validation scope

The repository's [`tests` workflow passed](https://github.com/nfeldman/amanuensis/actions/runs/45934581900) at the release commit, and the
publish workflow verified the packed artifact before it published.
[Publication succeeded](https://github.com/nfeldman/amanuensis/actions/runs/45936186484), and [all four Linux/macOS
Node.js 20/22 smoke jobs passed](https://github.com/nfeldman/amanuensis/actions/runs/45936972556) against the registry version.

Every server test and every materializer test passed serially at the release commit,
the materializer's under both Python 3.11 and 3.12. This repository's own survey was
republished with this release's prose guidance and read back green on state, coverage
and content.

Product efficacy remains unestablished.

Install this exact prerelease with:

```bash
npm install -g @gruetech/amanuensis@0.3.0-beta.1
amanuensis install
amanuensis status
```

If you installed an earlier release, run `amanuensis upgrade` instead of `install`,
then restart your agents so existing connections load the new server. Until
`1.0.0`, breaking changes remain possible between releases.
