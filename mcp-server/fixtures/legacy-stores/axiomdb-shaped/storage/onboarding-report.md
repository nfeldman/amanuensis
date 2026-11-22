# Onboarding report

**Codebase**: Quadstore — an embedded RDF store with a query planner and a rule engine
**Date**: 2026-08-20
**Onboarding SHA**: c3b1492c0da8168c125930d03a8dc4a40dfcc7fe

## Repository shape

| Dimension | Observed value | Confidence |
|---|---|---|
| Primary language(s) | Rust (3 crates) | code-verified |
| Build system(s) | Cargo workspace | code-verified |

## Runtime boundary map

| Runtime / Process | Language | Communicates with | Mechanism | Notes |
|---|---|---|---|---|
| Embedded `quad-core` | Rust | Host application (in-process) | Direct API | The primary deployment. |
| `quad-server` | Rust | Clients | gRPC over HTTP/2 | Optional TLS. |
| `quad-server` | Rust | Clients | HTTP (SPARQL protocol) | Plaintext unless terminated upstream. |

## Stateful entities

The store keeps quads in five index permutations and a dictionary of terms.
