# Onboarding report

*The repository boundary and initial decomposition that established this conspectus. Use it when you want the first pass's decisions about scope and split.*

Terms on this page: [Conspectus](how-to-read.md#term-conspectus) · [Subsystem](how-to-read.md#term-subsystem)

*As written at 2026-08-21, revision `c3b1492c`; kept as written, not tied to evidence.*

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
