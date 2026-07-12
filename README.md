# Amanuensis

Amanuensis reads a codebase and writes down what it finds in a form you can trust: a
*conspectus*. Every claim in it points to a specific line of code, carries a confidence
level with the reason behind it, and anything the tool could not verify is labeled as
such, sitting in plain view next to what it confirmed.

Why frame it that way instead of calling it an "AI code reviewer"? Because finding
problems was never the hard part. Any capable model will list twenty suspicious things in
a minute. The hard part, and the only part that actually saves you time, is knowing which
of the twenty are real without checking each one yourself. Speed of generation is cheap
now. Trustworthy output is not, and closing that gap is the whole reason this exists.

So Amanuensis does not try to review faster. It tries to produce a review you can act on
without redoing it.

## Does it hold up?

Two answers, because there are two claims.

On real code: pointed at Grafana, it found real bugs and backed each one with evidence you
can check yourself ([grafana-conspectus](https://github.com/nfeldman/grafana-conspectus)).
That is an existence proof rather than a benchmark, but it is a real one.

On the method: the design rests on a few ideas about how to make a language model
dependable. I reached them by trial and error while building the thing, not by reading a
paper. I have since checked them three ways: a review of the recent research on LLM and
multi-agent reliability, a set of controlled experiments, and an audit of this codebase
scored in parallel by two different models. All three line up with the design. The audit
rated the core of it as strong, and found something more useful than a grade: the parts
doing the real work are the rules the server enforces on its own, not the instructions
written into a prompt.

The ideas below are the valuable part. The code is one way to implement them.

## The idea, in plain terms

A language model is a fluent narrator. Ask it about code and it gives you confident,
readable prose whether or not the prose is correct. That is the trap. A wrong answer looks
exactly like a right one, so the model's confidence tells you nothing on its own. The
design treats that confidence as unreliable and makes the model earn each claim instead.
Four rules do most of that work:

1. **Read before you judge.** No conclusion from a name or a file path, only from what the
   code actually does. `UserCache` is not a cache until you have watched it cache something.
2. **Prove it or drop it.** Every finding cites its evidence. A claim the tool cannot
   support is marked unverified rather than asserted, and stays that way until someone
   verifies it.
3. **Attack your own findings.** After the first pass gathers problems, a separate pass
   tries to knock each one down, hunting for the retry loop, the lock, or the invariant
   that means it was never a bug. What survives is what you keep. What does not is written
   down as ruled out, with the reason, so nobody rediscovers it next month.
4. **Remember.** The record persists across sessions. Confirmed, suspected, and ruled out
   all carry forward, so the tool builds on last week's work instead of starting over and
   re-inventing it.

None of these is clever by itself. What makes them stick is where they live: in the server
that stores the conspectus, not in a prompt that asks the model to behave. A claim that
outruns its evidence, or a finding overturned with no new proof, is rejected when it is
written. That is what lets the discipline hold when the tool runs unattended, which is the
setting where prompt-only rules fall apart.

## How a survey runs

A survey moves through phases, and each phase sets a ceiling on what may be claimed. The
tool cannot report a bug in a subsystem it has only skimmed.

| Phase | What happens | What may be claimed afterward |
|---|---|---|
| **Scope** | Lists the files and boundaries in play. No code read yet, so later phases cannot cherry-pick a convenient sample. | Only that a file belongs to a subsystem. |
| **Structural** | Maps types, state, data flow, and the concurrency model. | Structure. No correctness claims. |
| **Concerns** | Works a checklist fitted to this codebase's languages and runtime, not a generic lint pass. Each concern ends in a disposition backed by evidence. | Findings, with citations. |
| **Adversarial** | A separate agent tries to disprove each finding and each shaky disposition. | The findings that survived the attack. |
| **Mapped** | Boundaries between subsystems filled in. | Complete. |

The pieces underneath:

- **Contracts enforced in the server.** The depth ceiling above and the "no overturn
  without new evidence" rule are checked when data is written. Breaking either returns an
  error, whether or not a person is watching.
- **Evidence with a paper trail.** Every citation is a stored record: file, symbol,
  commit, and how the observation was made. Asking what rests on a given piece of evidence
  is a lookup, not a search.
- **Concerns fitted to the codebase.** The checklist is derived for the specific system.
  Territories that do not apply are recorded with the reason they were skipped.
- **Competing explanations, handled honestly.** When two concerns could explain the same
  symptom, the tool scores them against shared evidence and drops the one the evidence
  contradicts most, instead of quietly picking a favorite.
- **Composition tracked on purpose.** Bugs that exist only in how two subsystems meet get
  their own place, and a boundary is assessed only once both sides are mapped.
- **Output that stays current.** A small Python step renders the whole record into a
  cross-linked doc site and re-renders only the pages whose sources changed.
- **Unattended runs, same bar.** A headless mode runs an entire survey on its own, trading
  the human's pause for a queue of open questions. The evidence bar does not move, because
  it lives in the server rather than in the pause.

## Architecture

```
┌────────────────────────────────────────┐
│  Custom agents (.agent.md)              │
│  coordinator ─┬─ scoper                 │
│               ├─ structural             │
│               ├─ concerns               │
│               ├─ adversarial            │
│               ├─ notes                  │
│               └─ memory-auditor         │
└───────────────┬────────────────────────┘
                │ MCP (stdio)
                ▼
┌────────────────────────────────────────┐
│  amanuensis-memory MCP server           │
│  (TypeScript · better-sqlite3)          │
│  Owns memory.db (WAL) and a git-backed  │
│  storage dir. The contracts live here.  │
└───────────────┬─────────────┬──────────┘
                │             │ subprocess
                ▼             ▼
        ┌──────────────┐  ┌──────────────────────┐
        │ memory.db +  │  │ Python materializer  │
        │ prose        │  │ renders → docs/       │
        │ artifacts    │  │                       │
        └──────────────┘  └──────────────────────┘
```

## Quick start

**Prerequisites:** Node.js ≥ 20, Python 3.11+ (standard library only), and a VS Code
MCP-compatible agent runtime.

```bash
npm install -g @gruetech/amanuensis
cd your-project
amanuensis init          # writes the agent files and wires the MCP server into .vscode/mcp.json
```

Invoke the **amanuensis** agent and say **"run onboarding."** The coordinator walks the
onboarding phases, fits the concern checklist to your codebase, and produces a seeded
`memory.db`, the prose artifacts, and a rendered `docs/` site. From there:

- **Survey a subsystem** with "survey B-01." It runs scope, structural, concerns, and
  adversarial in order, pausing at each boundary for your review.
- **Browse** with "what have you noticed?"
- **Audit** with "audit the conspectus," which sweeps for unresolved contradictions, stale
  entries, and findings that need another look.

The project storage directory is a git repo, and every session commits, so history and
rollback come for free.

## Development

This repository is the source. Contributors should read [CONTRIBUTING.md](CONTRIBUTING.md).
The MCP server's developer reference, including the auto-generated tool inventory, is at
[mcp-server/DEVELOPMENT.md](mcp-server/DEVELOPMENT.md).

## License

MIT. See [`LICENSE`](LICENSE).
