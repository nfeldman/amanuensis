# Resolution history

*The append-only account of how records reached their state. Use it when you want to know how a record reached its state.*

Terms on this page: [Session](how-to-read.md#term-session)

_Every state a finding or a contradiction was recorded in, and every re-grade of a finding's severity, newest first, with the account given at the time. Nothing here is rewritten when a record moves on: a repair that was later defeated keeps the event that recorded it, which is how a regression is visible at all. Each row links to where that record is written in full today._

| Recorded | Record | State | Session | Account |
|---|---|---|---|---|
| 2026-11-21 04:56 UTC | [B02-2](resolved-findings.md#b02-2) | `accepted` | `p8` | fixture |
| 2026-11-21 04:56 UTC | [B02-1](findings.md#b02-1) | `fixed-pending-verification` | `p8` | Repair at `src/writer.ts`, `bbbbbbbbbbbb`. fixture |
| 2026-11-21 04:56 UTC | [B01-1](findings.md#b01-1) | `open` | `p8` | fixture |

