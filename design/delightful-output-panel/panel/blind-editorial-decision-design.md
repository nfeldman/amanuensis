# Blind first-reading memo — editorial decision design

## Discipline and privileged reader need

My discipline is **editorial decision design**: arranging a large body of qualified evidence so a reader can decide what to trust, what to do next, and why, without erasing uncertainty. I privilege the reader arriving with a live question and little time—especially the maintainer or returning engineer who needs a defensible next move, not merely access to every record.

## Observations from the unaided first reading

### What was easy

- The report establishes provenance early: branch, checked SHA, generation time, and the warning that this is a derived surface. The persistent subsystem rail makes name/ID lookup straightforward, and human names lead while identifiers remain visible.
- The vocabulary of status and evidence is unusually disciplined. “Mapped,” “code-verified,” “confirmed defect,” and severity each have explicit meanings. The how-to-read page is excellent reference material.
- Once found, the substantive records are strong. `R04-1` explains a concrete user-visible failure, the three missing wiring junctions, its evidence, counterarguments, scope, and the assumption that controls its grade. This is decision-grade reporting, not a bug-list headline.
- Cross-page links and stable handles support specialist traversal. The R-04 page gives file ledger, concern dispositions, finding, primary files, survey notes, and adversarial review in one inspectable record.

### Where I lost orientation

- The overview answers “what sections exist?” before “what should I know or do?” Its first useful decision signal—the current-state table—is followed by a directory of ten destinations. The lone high finding and the most important coverage gaps are not in the opening argument.
- The first viewport spends scarce space repeating branch/onboarding metadata and essentially the same reading hint twice. “Latest session” is at the bottom and says what an agent is doing, but not what changed for the human reader or what decision now awaits them.
- Findings are formatted as wide tables even though each symptom and root cause is an essay. The table makes comparison look possible but forces serial reading inside narrow cells. Severity is scannable; consequence, confidence, assumption, and next action are not.
- The concern heatmap exposes rigor but not meaning. Thirty-six abbreviated columns and symbol cells make it difficult to answer the skeptical reviewer’s real questions: which areas are thin, which claims depend on outside evidence, and which uncertainty could overturn an important conclusion?
- Page transitions shed the reader’s purpose. The global rail preserves the report’s taxonomy, but a click from a finding to R-04 does not say “you came here to verify R04-1; here is the evidence trail and where you are within it.”
- “No contradictions recorded” can read more strongly than warranted beside 13 unmapped subsystems and 20 open field notes. Absence of recorded conflict is not evidence that unsurveyed areas agree.
- The handoff brief described 19 of 34 mapped and 11 confirmed findings; the opened overview reports 21 of 34 and 13. The page correctly identifies its own SHA and time, but offers no change digest. A reader can know *which snapshot* they see without knowing *what moved* since the last snapshot they saw.

## Creative judgment: build a **decision docket with receipts**

The governing metaphor is a docket placed before a careful decision-maker. The front page does not summarize every document; it states the matters requiring attention, the survey’s jurisdiction, and the recommended reading order. Each matter then carries its receipts: evidence, assumptions, counterarguments, and precise source handles.

The editorial rule would be: **lead with consequence and next decision; bind every conclusion to its warrant; defer exhaustive record structure until the reader asks for it.** This is not an executive dashboard. It is a short, argued brief with progressively disclosed case files.

### Information architecture

1. **Briefing** — current thesis, survey reach, consequential matters, uncertainty, and change since the previous publication.
2. **Action docket** — findings and open human decisions, grouped by the action they imply: fix, verify, clarify intent, or survey next.
3. **System map** — named domains and relationships, with surveyed depth and open matters overlaid in plain language.
4. **Case files** — subsystem pages organized as: why this matters; present claim; confidence boundary; findings; evidence trail; relationships; full survey record.
5. **Methods and registers** — how to read, concerns, diagnosticity, contradictions, field notes, glossary, provenance, and Markdown. These remain first-class and searchable, but they support the argument rather than interrupt it.

### First viewport

I would open with one compact editorial sentence and three routes:

> **AxiomDB is 21 of 34 subsystems mapped. One high-severity gap means shipped writes may not produce promised OWL EL inferences; 13 subsystems remain unmapped, concentrated in service, verification, and tooling surfaces.** Checked at `d19ade7`.

Immediately below:

- **Act now:** “Verify intent, then wire or disclose ABox materialization” — `R04-1`, High, code-verified. Qualification in the same block: severity assumes the standalone server is a shipping target and the missing wiring is unintentional; open question #10 can change the remedy.
- **Trust boundary:** “21 mapped; 13 unmapped; 0 stale records; 0 *recorded* contradictions; 9 human questions and 20 open field notes.” Each phrase links to the relevant register and expands to plain-language meaning.
- **Choose a route:** “New to AxiomDB,” “Responding to a change,” or “Audit the survey.” Each is a curated reading path, not merely a page link.

A small “Since your last snapshot” line follows: “+2 mapped, +2 confirmed findings” when a prior snapshot is known; otherwise “This is your baseline.” This makes the current report’s rapid movement legible rather than surprising.

### Signature moves

1. **Claim → warrant → action.** Every finding becomes a vertical brief, not a table row: user consequence; recommended next action; confidence/status; the assumption that could change it; then collapsible symptom, root cause, rebuttal, and source receipts. For `R04-1`, the headline is the missing ABox inference, the action is “answer intent question #10, then wire the coordinator or correct the capability claim,” and the three unreachable junctions are the evidence beneath it.

2. **A persistent decision trail.** Following `R04-1` into “B/F incremental deletion · R-04” keeps a slim context bar: `Briefing → R04-1 → R-04 evidence`, plus “back to the decision.” The subsystem page locally marks where the reader is—finding, concern disposition, file ledger, or relationship—rather than relying only on the global subsystem rail.

3. **Uncertainty written as bounded sentences.** Replace bare zeros and dense symbols with formulations such as: “No contradictions have been recorded among surveyed claims; 13 subsystems have not reached a claim-authorizing depth.” On the system map, “gRPC service surface · V-01 — not yet behaviorally surveyed” is text, not merely a gray dot. The full heatmap remains available as a register.

### How this handles the five reader tasks

1. **New engineer, five minutes:** the opening thesis answers composition and survey reach; “New to AxiomDB” gives a short path through the system map, the write/reason/query spine, and the one risk that changes how to interpret advertised behavior.
2. **Maintainer responding to change:** the action docket leads with `R04-1`, makes impact and code-verified evidence scannable, exposes the unresolved intent assumption, and ends with a concrete fork: implementation fix versus documentation/capability correction.
3. **Skeptical reviewer:** the trust boundary distinguishes mapped from unmapped, recorded absence from proven absence, and fact from severity assumption. “Audit the survey” opens evidence-quality rules, contradictions, linchpin dependencies, open questions, and the raw Markdown.
4. **Returning reader:** the change digest reports what moved, while a locally stored “last read snapshot” and recent case trail offer re-entry. With JavaScript off, the generated chronological change section remains; local history is only enhancement.
5. **Specialist:** global name/ID/topic search remains, but results show status and open matters. Subsystem case files lead with relationships and a local decision trail, preserving place while following seams or evidence.

### Hardest tradeoff and intentional refusal

The direction accepts that the front page will be interpretive. Selecting a lead matter and recommending a route is editorial judgment, and it can age badly. I would make that judgment inspectable: label why an item leads (severity, reach, evidence, blocking decision), expose the sorting rule, and keep the exhaustive registers one click away.

I intentionally refuse a “single health score,” percent-complete confidence number, or reassuring green project status. `21 / 34 mapped`, one High finding, zero recorded contradictions, and nine unanswered human questions measure different things and must not be collapsed. Delight here should come from the feeling that the report remembers the reader’s question and never hides the receipt—not from making uncertainty disappear.
