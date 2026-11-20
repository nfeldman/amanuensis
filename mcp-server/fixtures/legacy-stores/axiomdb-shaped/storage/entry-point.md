# Entry point

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
