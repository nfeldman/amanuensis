# W-01 — Graph write coordinator

## Structural inventory (Phase 2)

### Key types

| Symbol | Role | Source |
|---|---|---|
| `GraphLock` | Shared per-graph lock handle. | `coordinator.rs:31` |
| `WriteFence` | Blocks writers while a rebuild runs. | `coordinator.rs:273-410` |

### Data flow — coordinated write (`execute_inner`)

1. Take the graph lock.
2. Check the fence.
3. Commit through the write core.

```rust
let _guard = locks.graph(graph_id).lock();
fence.wait_inactive();
core.commit(batch)?;
```

## Concern assessment

| Concern | Classification | Evidence |
|---|---|---|
| CC-1 | confirmed-acceptable | `coordinator.rs:1170` |
