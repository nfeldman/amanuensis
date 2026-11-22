# Subsystem map

*Every region, grouped by layer, with the scope recorded for it. Use it when you are looking for the part of the code that does something.*

Terms on this page: [Subsystem](how-to-read.md#term-subsystem) · [Layer](how-to-read.md#term-layer) · [Survey depth](how-to-read.md#term-survey-depth) · [Mapped](how-to-read.md#term-mapped) · [Scope](how-to-read.md#term-scope) · [Finding](how-to-read.md#term-finding)

| Region | Subsystem | Survey depth |
|---|---|---|
| backend | **[B-01](subsystems/b01-read-path.md)** Read path | Mapped |
| backend | **[B-02](subsystems/b02-write-path.md)** Write path | Mapped |
| backend | **[B-03](subsystems/b03-queue.md)** Queue | Scoped |
| frontend | **[F-01](subsystems/f01-console.md)** Console | Deferred |
| frontend | **[F-02](subsystems/f02-widgets.md)** Widgets | Deferred |

## backend

| Priority | ID | Name | Status | Purpose | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|---|
| — | **[B-01](subsystems/b01-read-path.md)** | Read path | 🟢 mapped | Not recorded | src/reader.ts and the two files it re-exports | Open src/reader.ts first; it names every other file in this region. | 1 (1 open) |
| — | **[B-02](subsystems/b02-write-path.md)** | Write path | 🟢 mapped | Not recorded | src/writer.ts, src/shared.ts | — | 2 (0 open) |
| — | **[B-03](subsystems/b03-queue.md)** | Queue | 🔵 scoping | Not recorded | — | — | 0 (0 open) |

## frontend

| Priority | ID | Name | Status | Purpose | Scope | Jump-in | Findings |
|---|---|---|---|---|---|---|---|
| — | **[F-01](subsystems/f01-console.md)** | Console | ⚫ deferred | Not recorded | ui/console.ts | — | 0 (0 open) |
| — | **[F-02](subsystems/f02-widgets.md)** | Widgets | ⚫ deferred | Not recorded | — | — | 0 (0 open) |

