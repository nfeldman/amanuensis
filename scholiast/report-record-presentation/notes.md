# Notes, concerns, and open questions

## Calibrated concerns

- **Scope misapplication:** medical-risk fact boxes contain concise comparable
  numbers; they cannot justify putting 800-character software explanations into
  cells. Searched directly and retained only the narrower claim that true tabular
  comparisons can improve comprehension.
- **Motivated source structure:** GOV.UK and PatternFly document their own component
  systems. Their agreement is useful but not independent empirical replication.
- **Temporal conflation:** the 2001 line-length study predates current displays and
  web conventions. It is supporting evidence, not the basis of the recommendation.
- **False consensus:** the QCA study supplies a counterexample to “tables always
  improve comprehension”; task and information structure change the result.
- **Instrument failure:** the first corpus profiler treated marker comments between
  a table header and its rows as an empty table. The corrected run moved the corpus
  from 769 to 784 rows and added the missing 15-finding population.

## O-01 · Finding index/detail mechanism

The current data model has no concise human-authored finding title. The first
symptom sentence is too long to serve reliably as an index label (109 characters
median; 224 at the 90th percentile). A dedicated title/lede field would improve the
aggregate register, but adding one creates an authoring and migration obligation.

For the current increment, preserve the full finding as one article and use its ID,
severity, subsystem, and first observed-behavior sentence for orientation without
pretending the sentence is a title. Compare in-page expansion against dedicated
finding pages before changing the durable schema.

## O-02 · Reader evidence

No representative Amanuensis reader has yet performed timed comprehension and
comparison tasks across the candidate layouts. Structural and corpus evidence can
reject the current schema dump and narrow the candidates; it cannot license a
measured “fastest” claim. The implementation should carry explicit task fixtures and
remain easy to revise after reader testing.
