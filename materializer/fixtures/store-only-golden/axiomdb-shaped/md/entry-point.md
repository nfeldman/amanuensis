# Entry point

*A dated reading path recorded by an earlier session; it is survey history, not a current index. Use it when you want the reading path an earlier session wrote.*

Terms on this page: [Session](how-to-read.md#term-session)

*As written at 2026-11-04, revision `c711feb7`; kept as written, not tied to evidence. It was edited after it was registered.*

**Canonical branch**: main
**Onboarding SHA**: c3b1492c0da8168c125930d03a8dc4a40dfcc7fe

## What is this codebase?

Quadstore is an RDF quad store written in Rust. It answers SPARQL queries over named graphs, refusing at planning the algebra it does not support, and keeps the inferences its rules derive beside the asserted quads.

Two ideas explain most of the design: visibility is metadata carried on each index entry, and every write passes one coordinator per graph.

## Directory map

| Path | Role |
|---|---|
| `crates/quad-core/src/storage` | Index permutations and the term dictionary |
| `crates/quad-core/src/write` | The write coordinator and its fences |
