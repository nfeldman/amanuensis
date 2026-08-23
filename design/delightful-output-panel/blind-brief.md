# Blind first-reading brief

## Objective

Independently assess and reimagine the human-facing HTML output of Amanuensis
so it becomes unusually delightful, clear, actionable, and orienting without
weakening its epistemic honesty. Use the current generated AxiomDB conspectus
as the concrete reading object.

This is a first reading. Do not inspect prior panel output, research, critiques,
design-session records, or implementation proposals. Do not seek consensus.
Your value is the distinctness and internal coherence of your own discipline.

## Reading object

Open and explore:

- Entry point:
  `/Users/nfeldman/repos/axiomdb/.amanuensis/docs/index.html`
- Complete generated report:
  `/Users/nfeldman/repos/axiomdb/.amanuensis/docs/`

The entry point was generated 2026-08-22 17:49:49 EDT. It represents AxiomDB
at `last_checked_sha=d19ade703e3c`, with 34 named subsystems, 19 mapped
subsystems, 11 confirmed open findings, 20 open field notes, and no unresolved
contradictions in the entry-point summary.

## Product constraints

These are constraints, not a preferred design:

- HTML is the primary human reading surface. Markdown remains a portable,
  inspectable companion and must stay one click away.
- Each generated HTML page is self-contained: no external font, stylesheet,
  JavaScript, image, or diagram-renderer requests.
- Pages must work when opened directly from the filesystem and when served by
  a static server.
- The report is a projection, not the durable authority. It must not imply
  more certainty than the underlying survey state authorizes.
- Stable local pages, cross-page links, and fragment targets are part of the
  publication contract. Machine-readable markers and semantic content must
  remain available for independent read-back.
- Human-facing names should lead; IDs remain visible as precise handles.
- Readers need name, ID, and topic discovery across a report with dozens of
  subsystems.
- Survey depth, evidence quality, severity, staleness, and unresolved states
  need plain-language interpretation, not color alone.
- Mermaid relationship source cannot require a client runtime; relationship
  information needs an accessible HTML/text projection.
- The experience must be responsive, keyboard-usable, and legible without
  animation. Reduced-motion and print use should degrade cleanly.
- The prototype may use inline CSS and inline progressive-enhancement
  JavaScript. Essential orientation and content must survive with JavaScript
  disabled.
- Do not modify production Amanuensis or AxiomDB files. Write only to your
  assigned path under
  `/Users/nfeldman/repos/amanuensis/design/delightful-output-panel/`.

## Representative reader tasks

Use these as probes, not as a forced page structure:

1. A new engineer has five minutes to answer: What is AxiomDB made of, how much
   of it is actually understood, and where should I begin?
2. A maintainer responding to a change wants to find the most consequential
   open issue, understand its impact and evidence, and identify the next useful
   action.
3. A skeptical reviewer wants to know which claims are safe to rely on, which
   areas remain thinly surveyed, and where uncertainty or disagreement lives.
4. A returning reader wants to reorient after a week away: what changed, what
   remains unfinished, and where was I likely headed?
5. A specialist wants to jump to one subsystem by name or ID, understand its
   relationships, and retain a sense of place while following links.

## Required response

Write a concise but concrete first-reading memo to your assigned path. Include:

- your discipline and the reader need it privileges;
- what your unaided first reading made easy and what made you lose orientation;
- a coherent design direction with a distinct governing metaphor or principle;
- the information architecture and first viewport you would build;
- two or three signature interactions or presentational moves;
- how your direction handles all five representative tasks;
- the hardest tradeoff it accepts and what it intentionally refuses;
- content-specific sketches using actual AxiomDB material, not generic cards;
- observations versus creative judgments in separately labeled sections.

Do not read or modify any other panelist's memo.

