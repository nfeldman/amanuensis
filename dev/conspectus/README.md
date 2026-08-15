# Conspectus fixtures and current authority

`self-baseline.json` and `baseline-report.json` are immutable A0 historical
artifacts at repository revision `b8b566f`. The report was first committed under
an unversioned checker whose exact digest is retained in the detector registry;
it is not retroactively relabeled as output from today's detector.

`baseline-report-detector-1.0.0.json` is the explicit successor measurement of
the same historical fixture. Its green checker result establishes internal
completeness at that revision only. It does not establish that the checked-out
repository, the live SQLite conspectus, or an integrated release is current.

`detector-registry.json` separates the original measurement provenance from the
current verification detector and binds each to exact checker bytes. A version
or digest mismatch is an out-of-band measurement-definition change under
practice-catalog v2.10 VP26. Rebaselining requires a new report identity (and a
new fixture identity when the fixture itself changes); historical artifacts are
never overwritten or retargeted.

Current authority lives in the project SQLite record and is revision-bounded.
Use `conspectus_status`, `detect_changes`, targeted revalidation, materialization,
and projection read-back at the named repository revision before calling that
record current.
