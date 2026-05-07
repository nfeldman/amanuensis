# Agents

VS Code custom agents that drive the Amanuensis methodology. Each `.agent.md`
file is a standalone agent with YAML frontmatter (name, description, tools,
handoffs) and a markdown instruction body.

The coordinator (`amanuensis.agent.md`) is the only user-invocable agent for
survey work. The phase agents are invoked via handoffs; the notes and
memory-auditor agents are conversational and can be invoked directly.

## Agent roster

| Agent | Phase | Role |
|---|---|---|
| `amanuensis` | — (coordinator) | Session management, phase gating, Phase 5 packaging, materialization |
| `amanuensis-scoper` | Phase 1 | File ledger, vocabulary seeding, seam stubs |
| `amanuensis-structural` | Phase 2 | Type graph, state containers, flows, concurrency, seam contracts |
| `amanuensis-concerns` | Phase 3 | Concern dispositions with evidence + quality tags |
| `amanuensis-adversarial` | Phase 4 | Attempt to overturn findings; contradiction detection |
| `amanuensis-notes` | — (conversational) | Browse field notes, answer questions, explain findings |
| `amanuensis-memory-auditor` | — (hygiene) | Sweep for unresolved contradictions, stale entries, linchpin-dependent findings |

## Phase flow (per-subsystem survey)

```
                   (unmapped)
                       |
       ┌──── amanuensis ────────┐
       ▼                        │
  scoper ── scoping ────────────┤
       │                        │
       ▼                        │
  structural ── structural ─────┤
       │                        │
       ▼                        │
  concerns ── concerns ─────────┤
       │                        │
       ▼                        │
  adversarial ── adversarial ───┘
       │
       ▼ (coordinator runs Phase 5 packaging)
   mapped
```

At every arrow the coordinator **pauses for human acknowledgment**
before advancing. The human is the calibrator — they answer domain
questions, confirm priority, and approve the work before the next
phase begins.

## Reference documents

The agents read from Amanuensis's own reference docs, bundled with
this repository:

- `references/concern-territories.md` — 11 territories + diagnosticity
  matrix protocol. Used during onboarding Phase 4.
- `references/artifact-templates.md` — prose artifact formats the
  coordinator and phase agents write to.

## Installing into VS Code

Copy the `.agent.md` files into `.github/agents/` in the target
workspace (or wherever VS Code picks them up on your setup), and wire
the MCP server via `.vscode/mcp.json`:

```json
{
  "servers": {
    "amanuensis-memory": {
      "type": "stdio",
      "command": "node",
      "args": [
        "${workspaceFolder}/mcp-server/dist/index.js",
        "--workspace",
        "${workspaceFolder}"
      ]
    }
  }
}
```

Amanuensis ships a ready-to-use `.vscode/mcp.json` at the repo root.

## Hard constraints (shared by every agent)

- **Never modify source code.** Read it. Write only to the project
  storage directory (`~/.amanuensis/workspaces/<owner>/<project>/`)
  and the MCP-managed DB.
- **Never classify anything you haven't read.** Name, location, and
  file metadata are signals, not evidence.
- **Separate observed facts from inferences from open questions.**
- **Use the highest-capability navigation tool available.** Semantic
  language-intelligence tools first, VS Code search second, shell grep
  last.
- **Cite everything.** Every claim in an artifact carries a
  `file:symbol@sha` reference or a disposition/finding/field-note ID.
