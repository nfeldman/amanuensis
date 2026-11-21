# Files

*One row per ledger file with owners, standing, and open defects. Use it when you want to know whether a particular file was read.*

Terms on this page: [Scope](how-to-read.md#term-scope) · [Finding](how-to-read.md#term-finding) · [Stale](how-to-read.md#term-stale) · [Standing](how-to-read.md#term-standing)

12 distinct paths across 15 ledger rows, read at `cfc2c80635e9`. Every owner of a path is listed, and the examined revision is the one that owner recorded — two subsystems may have read the same file at different revisions.

| File | Owners | Standing | Examined at | Open defects |
|---|---|---|---|---|
| <a id="f-16c34cbfd4"></a>`dist/bundle.js` | [Read path](subsystems/b01-read-path.md#le-5393cae2e6) | Excluded | `aaaaaaaa` | 0 |
| <a id="f-e0505f9301"></a>`src/a-b.ts` | [Read path](subsystems/b01-read-path.md#le-caf4cb2f7f) | Examined | `aaaaaaaa` | 0 |
| <a id="f-e56e1a4fc5"></a>`src/a.b.ts` | [Read path](subsystems/b01-read-path.md#le-ab2d612626) | In scope, not yet read | `aaaaaaaa` | 0 |
| <a id="f-fe6c19f8d4"></a>`src/a/b.ts` | [Read path](subsystems/b01-read-path.md#le-1749fe3edc) | Examined | `aaaaaaaa` | 1 |
| <a id="f-eade95ff41"></a>`src/agreed.ts` | [Read path](subsystems/b01-read-path.md#le-08f67b58e1) · [Write path](subsystems/b02-write-path.md#le-d82107d48d) | Examined | `aaaaaaaa` | 0 |
| <a id="f-3610915ac3"></a>`src/gone.ts` | [Write path](subsystems/b02-write-path.md#le-29e6683589) | No longer in the repository | `aaaaaaaa` | 0 |
| <a id="f-c1da3dc93a"></a>`src/mixed.ts` | [Read path](subsystems/b01-read-path.md#le-30894145f2) · [Write path](subsystems/b02-write-path.md#le-44a764fa4e) | Owners disagree | `aaaaaaaa` | 0 |
| <a id="f-021f3a4f8e"></a>`src/pending.ts` | [Queue](subsystems/b03-queue.md#le-dc904806b4) | In scope, not yet read | `aaaaaaaa` | 0 |
| <a id="f-bfe4967a03"></a>`src/queue.ts` | [Queue](subsystems/b03-queue.md#le-bbc5ab9561) | In scope, not yet read | `aaaaaaaa` | 0 |
| <a id="f-2a6d4bdeaf"></a>`src/shared.ts` | [Read path](subsystems/b01-read-path.md#le-4fc851b2fb) · [Write path](subsystems/b02-write-path.md#le-b4d03c4bbe) | Examined | Read path `aaaaaaaa` · Write path `bbbbbbbb` | 2 |
| <a id="f-d8c4ecbac2"></a>`ui/console.ts` | [Console](subsystems/f01-console.md#le-3dc3ee5456) | Excluded | `aaaaaaaa` | 0 |
| <a id="f-e3c499b66a"></a>`vendor/lib.js` | [Read path](subsystems/b01-read-path.md#le-2583a17df8) | Excluded | `aaaaaaaa` | 0 |

*Rendered from the command line. Its read-back was not recorded in the survey's record, so the Publication integrity figures on the overview describe an earlier publication.*
