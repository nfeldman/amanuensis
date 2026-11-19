Correct a claim without waiting for a new commit, and stop failing a publish over links to resolved findings.

### Changes

- **Correcting a claim at the revision it was recorded at.** A survey reads one
  revision, so a claim the adversarial pass found wrong could not be overturned or
  corrected until the repository gained a commit: `invalidate_claim` and
  `supersede_claim` required a later commit. Both now accept the claim's own
  `valid_from_sha`, which records that the claim never held. A claim that held and
  later became false still closes at the commit that made it false. An older store
  is migrated when it is opened; every claim, index and trigger is kept.
- **Links to moved findings.** When a finding was verified fixed, its entry moved
  from the open findings page to the resolved findings page, but pages whose own
  content had not changed kept their old link. The publish's read-back then marked
  it failed for a dangling link. Those pages are now relinked whenever a target
  moves. Nothing in an existing store needs repair; publish again.
- **`mapped` requires examined scope.** A subsystem could reach `mapped` with every
  scoped file inventoried but never read. The advance is now refused while any
  scoped file is still a candidate, naming the first five; record each as examined
  or deferred with a reason. `get_dashboard` reports examined and unexamined files.
  A survey that relied on the old behavior will see this refusal.
- **Resuming and resetting subsystems.** Resuming a subsystem from `deferred` now
  checks every status above the depth it held when it was parked, and
  `reset_subsystem` refuses a target above the subsystem's current depth. A status
  and its recorded depth are written together, so an interruption cannot leave a
  parked subsystem with no depth to resume from.
- **Review brief and stale markers.** The review brief now carries stale files from
  the file ledger. The index page's stale-entry markers, which no code path could
  produce, are removed; the stale-files page is the census.
- **`describe_locus` budget.** The default rises from 8192 to 15360 bytes. At the
  old figure a default call on a surveyed file returned no item at all.
- **Skill references.** Four tool calls in the skill's references named the wrong
  tool or an argument the tool does not take. They are corrected, and CI now checks
  every call the references write out against the server's tools.

### Validation scope

The repository's [`tests` workflow passed](https://github.com/nfeldman/amanuensis/actions/runs/44638953638) at the release commit, and the
publish workflow verified the packed artifact before it published.
[Publication succeeded](https://github.com/nfeldman/amanuensis/actions/runs/44640560519), and [all four Linux/macOS
Node.js 20/22 smoke jobs passed](https://github.com/nfeldman/amanuensis/actions/runs/44641198593) against the registry version.

Every server test and every materializer test passed serially at the release commit.
The claim and link fixes each have a test that reproduces the failure a beta tester
reported and fails without the fix. Product efficacy remains unestablished.

Install this exact prerelease with:

```bash
npm install -g @gruetech/amanuensis@0.2.0-beta.7
amanuensis install
amanuensis status
```

If you installed an earlier release, run `amanuensis upgrade` instead of `install`,
then restart your agents so existing connections load the new server. Until
`1.0.0`, breaking changes remain possible between releases.
