# Resolution history

_Every state a finding or a contradiction was recorded in, newest first, with the account given at the time. Nothing here is rewritten when a record moves on: a repair that was later defeated keeps the event that recorded it, which is how a regression is visible at all. Each row links to where that record is written in full today._

| Recorded | Record | State | Session | Account |
|---|---|---|---|---|
| 2026-10-07 22:44 UTC | [B02-R2](resolved-findings.md#b02-r2) | `verified-fixed` | `muyozldb-ytkmpjjk` | Repair at `mcp-server/src/index.ts:gitRoot`, `dd674ef84876`. At a521e28, index.ts:gitRoot passes timeout=STARTUP_PROBE_TIMEOUT_MS (5000ms) and killSignal=SIGKILL and catches failures as null. dd674ef introduces these options at the exact call named by B02-R2. Code-based verification of that missing-bound defect; no claim of a fault-injected filesystem observation, and B02-R1 remains open. |
| 2026-10-07 22:43 UTC | [B02-R2](resolved-findings.md#b02-r2) | `fixed-pending-verification` | `muyozldb-ytkmpjjk` | Repair at `mcp-server/src/index.ts:gitRoot`, `dd674ef84876`. gitRoot now uses the shared STARTUP_PROBE_TIMEOUT_MS with SIGKILL. Re-examined at a521e28; the separate durable-write timeout finding B02-R1 remains open. |
| 2026-09-18 02:14 UTC | [B03-R5](findings.md#b03-r5) | `open` | `mu6bmjry-fuziol9u` | Finding recorded as confirmed-bug |
| 2026-09-15 04:56 UTC | [B07-R1](findings.md#b07-r1) | `open` | `mu274z8h-ylgc5fy0` | Finding recorded as confirmed-bug |
| 2026-09-15 04:54 UTC | [B05-R1](findings.md#b05-r1) | `open` | `mu274z8h-ylgc5fy0` | Finding recorded as confirmed-bug |
| 2026-09-15 04:51 UTC | [B04-R2](findings.md#b04-r2) | `open` | `mu26wn9s-v8ghdxol` | Finding recorded as confirmed-bug |
| 2026-09-15 04:51 UTC | [B04-R1](findings.md#b04-r1) | `open` | `mu26wn9s-v8ghdxol` | Finding recorded as confirmed-bug |
| 2026-09-15 04:39 UTC | [B03-R4](findings.md#b03-r4) | `open` | `mu26cxw3-7kc3845v` | Finding recorded as confirmed-bug |
| 2026-09-15 04:39 UTC | [B03-R3](findings.md#b03-r3) | `open` | `mu26cxw3-7kc3845v` | Finding recorded as confirmed-bug |
| 2026-09-15 04:39 UTC | [B03-R2](findings.md#b03-r2) | `open` | `mu26cxw3-7kc3845v` | Finding recorded as confirmed-bug |
| 2026-09-15 04:39 UTC | [B03-R1](findings.md#b03-r1) | `open` | `mu26cxw3-7kc3845v` | Finding recorded as confirmed-bug |
| 2026-09-15 04:30 UTC | [B02-R2](resolved-findings.md#b02-r2) | `open` | `mu2622ld-ioef6w30` | Finding recorded as confirmed-bug |
| 2026-09-15 04:29 UTC | [B02-R1](findings.md#b02-r1) | `open` | `mu2622ld-ioef6w30` | Finding recorded as confirmed-bug |

