# Files

*One row per ledger file with owners, standing, and open defects. Use it when you want to know whether a particular file was read.*

Terms on this page: [Scope](how-to-read.md#term-scope) · [Finding](how-to-read.md#term-finding) · [Stale](how-to-read.md#term-stale) · [Standing](how-to-read.md#term-standing)

3 distinct paths across 3 ledger rows, read at `d395c4d5a9e1`. Every owner of a path is listed, and the examined revision is the one that owner recorded — two subsystems may have read the same file at different revisions.

| File | Owners | Standing | Examined at | Open defects |
|---|---|---|---|---|
| <a id="f-710bc9cb91"></a>`crates/quad-core/src/index/perm.rs` | [Storage substrate](subsystems/s01-storage-substrate.md#le-b709f4c9f2) | Examined | `c3b1492c` | 0 |
| <a id="f-c962b6417d"></a>`crates/quad-core/src/query/parse.rs` | [Query front end](subsystems/q01-query-front-end.md#le-9dbd55d5f0) | Examined | `c3b1492c` | 0 |
| <a id="f-12ada624a7"></a>`crates/quad-core/src/write/coordinator.rs` | [Graph write coordinator](subsystems/w01-graph-write-coordinator.md#le-c0468ac389) | Examined | `c3b1492c` | 0 |

*Rendered from the command line. Its read-back was not recorded in the survey's record, so the Publication integrity figures on the overview describe an earlier publication.*
