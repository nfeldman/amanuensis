# ADR-0020: Reconcile live claims with practice catalog v2.10

- Status: accepted for the branch-local implementation record
- Date: 2026-08-15
- Catalog: v2.10 at `c394b723c28ccad6c84c2df6a5100754320b2d97`
- Deciders: Amanuensis owns implementation and evidence custody; integration,
  release, and product-efficacy claims remain evidence-owned

## Context

The roadmap claimed practice-catalog v2.8 coverage while its validator's manual
inventory stopped at VP20. VP21 already existed in v2.7 and VP22–VP25 were
added in v2.8, so the green coverage gate was incomplete. Catalog v2.9 renamed
handles without changing IDs or content. Catalog v2.10 adds VP26: longitudinal
measurement must version the detector separately from the data schema, treat a
detector mismatch as out-of-band rather than object regression, and give an
explicit rebaseline path an exemption from the comparison guard.

Several projections also collapsed different states into “complete”: roadmap
initiative implementation, Pecia stage projection, current conspectus authority,
integration, release, and product proof. That made historical fixture success
look like current or shipped evidence.

## Decision

### Preserve historical provenance; update only live authority

ADRs 0001–0019 and the A0 fixture/report retain the catalog versions under which
they were authored. The A0 self-conspectus is a historical baseline at
`b8b566f`, not a current survey. Its original report remains attributed to the
exact unversioned checker first committed with it; it is not retroactively
claimed by the current detector. The current detector is registered separately
and writes a successor report identity. A version/digest mismatch is an
out-of-band measurement change. A changed fixture requires a new fixture and
report identity.

The live roadmap uses a versioned full catalog-ID snapshot sourced from v2.10.
Its validator requires every catalog GP/VP row, rejects unknown IDs, and turns
red when the snapshot grows without corresponding accounting. The four expired
“open decisions” are now resolved to their accepted ADRs and the validator
rejects an open decision after its deadline initiative is terminal.

### Separate implementation from delivery and product proof

All 19 roadmap initiatives have branch-local implementation evidence. This does
not establish remote integration, CI at the integrated commit, release, a
current conspectus, or the stage-exit product comparison. Those claims require a
named remote ref, full CI at the exact integrated commit, and terminal read-back.

A16 is narrowed to a detector-versioned evaluation apparatus validated on a
synthetic fixture. It authorizes no real product-efficacy or population operating
envelope claim. A18 still qualifies exactly two natural-history cases at their
recorded detector hashes; it does not establish efficacy, representativeness,
causality, or preservation of behavior outside each positive hidden oracle.

Repository-wide VP21 diagnostic coverage remains unmeasured: the canonical
blocking-gate population and gate-to-red-proof registry have not been typed.
Eight A0 control classes and initiative-specific red gates cannot be generalized
to 100% repository-gate coverage.

### Make measurement corrections append-only

The A16 operating-envelope manifest and report carry `detector_version` and an
exact detector digest separately from `schema_version`. Verification returns an
out-of-band detector mismatch before semantic comparison. An explicit
rebaseline creates an immutable successor report plus measurement event; it
cannot mutate the source.

The A18 corpus schema and receipts likewise carry `detectorVersion`. Normal
receipt writes are create-only. Rebaseline requires a new manifest and mandatory
new receipt, preserves the source, re-runs target-fail/fix-pass qualification,
and labels the result a measurement correction rather than repository drift.

Pecia stage state is derived from child heads and requires non-unknown evidence.
The committed projection is bound by SHA-256 and detector version in a manifest
that explicitly disclaims authority over the machine-local timeline.

## Claim adjudication

| Prior claim | Current disposition |
|---|---|
| Practice-catalog coverage at v2.8 | Withdrawn; the gate omitted VP21–VP25. Replaced by full v2.10 snapshot accounting. |
| All roadmap initiatives complete | Narrowed to branch-local implementation evidence. Integration/release remain pending. |
| A0 checker proves a current living conspectus | Withdrawn. It proves only the immutable historical A0 fixture at `b8b566f`. |
| A16 establishes a product operating envelope | Withdrawn. Synthetic apparatus qualification only; efficacy/population scope unmeasured. |
| A18 qualifies two natural cases | Survives only at exact recorded runner, contract, task, oracle, tree, and detector identities. |
| Catalog v2.9 changes earlier results | Rejected. IDs/content were unchanged; frozen prose is not bulk-renamed. |
| Detector change indicates repository regression | Rejected. It is out-of-band until an explicit immutable-successor rebaseline. |

## Verification obligations

- [x] Catalog snapshot expansion without audit accounting turns the roadmap gate red.
- [x] An overdue unresolved program decision turns the roadmap gate red.
- [x] Pecia open stage, unknown stage evidence, projection drift, and timeline-identity drift turn red.
- [x] A0 detector version/digest mismatch is reported out-of-band.
- [x] A16 detector drift returns no regression verdict and an explicit successor rebaseline verifies.
- [x] A18 detector mismatch is out-of-band; ordinary receipt overwrite and in-place rebaseline are refused.
- [ ] Remote integration and CI/read-back at the integrated commit are delivery evidence, not manufactured locally.
- [ ] Repository-wide VP21 diagnostic coverage awaits a typed gate/proof population.
- [ ] Product efficacy and real operating-envelope claims await preregistered, blinded, adequately resolving evaluation.
