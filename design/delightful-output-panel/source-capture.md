# Representative AxiomDB source capture

The prototype freezes the coherent report state observed at **2026-08-22 18:15:05 EDT**. The live survey continued to advance during panel work, so the prototype is a representative publication specimen, not a dashboard connected to the current `.amanuensis` directory.

## Captured state

- Canonical branch: `main`
- Last checked code SHA: `d19ade703e3c`
- Survey reach: `25 / 34` mapped; 9 unmapped
- Confirmed open findings: 14 — 1 critical, 1 high, 5 medium, 7 low
- Open field notes: 20
- Unresolved contradictory finding pairs: 0
- Lead critical case: `V02-1` — the HTTP query/update surface performs no authorization and defaults an unauthenticated request to the system-tenant context; the standalone bootstrap starts that surface and defaults to all interfaces.
- High case: `R04-1` — no production path materializes ABox OWL EL inferences; open question #10 changes the remedy and severity rationale, not the observed wiring gap.
- Active survey trail: `resume complete survey in priority order — seam SM-07 assessment, then Q-01 onward`.

## Source hashes

| Artifact | SHA-256 |
|---|---|
| `index.html` | `9508502afbda86473bc701ac7c6685a44e28d2505223ff9d93a63155b69953cf` |
| `index.md` | `e17da85b3ec217a3835e893c8ae7e5d3b40d3e504a84b21bc0257184f8ba48e1` |
| `findings.md` | `06f55e5f33b2bf6fa896bbc575e72e0c0a0953beb129690401928c8cee63a2c2` |
| `master-plan.md` | `48643f6e1fc35dbc5e78ce389dabf3b400b2b9a242c60fda25a9d6e10f240ba2` |
| `architecture.md` | `2b1af088b52f7e0cec6b92ab29a5337ebdff8642a50c2c5dc5660f0cdd5b618a` |
| `entry-point.md` | `29dc6576409ed60401487885b95f2d928f4f3d969cb7aae786f95e3cdc232fa3` |
| `open-questions.md` | `5fb4b22aea60bcbdcf50da0e653b4def139773791678725aa1426e6b7cd8ed08` |

## Provenance caveat

Earlier in the same session, stable report paths changed through `19`, `21`, `22`, and `23` mapped subsystems. One captured write disagreed across the overview, master plan, and findings register before the 18:15 state restored summary/register agreement. The prototype therefore demonstrates a distinct **publication integrity** field and an explicit **comparison baseline unknown** state. It does not diagnose the earlier disagreement or claim every Amanuensis projection is non-atomic.

## Production custody

All source artifacts remain under `/Users/nfeldman/repos/axiomdb/.amanuensis/docs/`. They were read but not copied or modified. This file is the panel's custody record for the representative content used in the prototype.
