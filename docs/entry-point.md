# Entry point — Amanuensis

Read this first. It is written so that an agent with no other context can answer four
questions: what the system does, what to map first, what to read for a bug report, and what
mode a feature request puts you in.

## What is this codebase?

Amanuensis produces a **conspectus** of a codebase: an evidence-backed, revision-bound record
of what a system is, what is wrong with it, and what nobody has established yet — one that
survives across sessions and across agents.

It is three things that must agree:

1. **An MCP server** (`mcp-server/`, TypeScript on Node 24) that owns a SQLite store at
   `<repo>/.amanuensis/memory.db` and exposes roughly two hundred tools. It is the authority.
   It enforces the data model: every claim cites `file:symbol@sha`, a subsystem's status caps
   what its agents may assert, dispositions and findings cannot be written without an
   evidence anchor, resolution history is append-only.
2. **A skill** (`.claude/skills/amanuensis/`) — the phased methodology a coordinating agent
   executes: onboarding, then per subsystem scope → structural → concerns → adversarial →
   packaging, then refresh.
3. **A materializer** (`materializer/`, Python) that renders the store into HTML and Markdown
   a person reads, and then reads its own output back on three axes before calling it
   published.

The load-bearing idea is epistemic rather than technical: *authorized claims scale with
recorded depth.* A subsystem at `scoping` may state its file scope and nothing more. This is
enforced in the server, not requested in prose, because the project's own history says that
prose guards get violated and structural ones do not.

What it is **not**: it never modifies the code it surveys. It reads source for evidence and
writes only through its own tools.

## What do I map first?

`master-plan.md` has the ranked plan. The short answer, in order:

1. **[B-02](subsystems/b02-server-core-repository-binding-storage-schema-lifecycle.md), server core** (`mcp-server/src/index.ts`, then `project.ts`, then `db.ts`) — the
   registry, the repository binding, the lazy store. Everything depends on it.
2. **[B-04](subsystems/b04-reader-lenses-standing-locus-account-claims-edges-vocabulary.md), reader lenses** (`contracts/conspectus-vocabulary.json`, then `src/standing.ts`,
   then `tools/locus.ts`) — the newest code, the consumer route, and the only place a wrong
   answer is served as authoritative standing.
3. **[B-03](subsystems/b03-knowledge-tools-and-workflow-api.md), knowledge tools** and **[B-05](subsystems/b05-materializer-human-projection-read-back-html.md), materializer** — the writers, and the reader that
   turns their output into something a person sees.

## Given a bug report, what do I read first?

**Call `describe_locus` on the file or symbol named in the report, before opening the file.**
It answers with a *standing* — what the record authorizes and what it cannot justify — and
then the account. If standing comes back `unledgered`, `excluded`, or `scoped-unread`, say so;
do not read the file and improvise a claim the record does not support. Then `get_attention`
for what is unresolved, and `get_history` for what was already concluded.

If the report is about Amanuensis itself, the routing by symptom is:

| Symptom | Read |
|---|---|
| A tool refused, or returned the wrong shape | `mcp-server/src/tools/<area>.ts`, then `invariants.ts` and `helpers.ts` |
| Wrong standing, wrong account, a response that is too big | `src/standing.ts`, `tools/locus.ts`, `contracts/locus-account.schema.json` |
| The store did not open, or bound the wrong repository | `src/project.ts`, `src/db.ts`, `src/codex-host.ts` |
| A published page is wrong, missing, or read back red | `materializer/amanuensis_materializer/{core,readback,renderers}.py` |
| Install, upgrade, or `doctor` misbehaved | `mcp-server/src/cli.ts` |
| A gate is green that should not be | the gate under `dev/` or `mcp-server/test-*.mjs`, and look for the denominator |
| A count or a status on the published overview looks wrong | the derived views in `src/schema.sql`, then the materializer's reader |

## Given a feature request, what mode applies?

- **Adding or changing a tool** → the contract goes in the server. Add the handler under
  `mcp-server/src/tools/`, register it in `index.ts`, extend the adversarial suites, and
  regenerate `DEVELOPMENT.md`'s inventory. If it introduces an enum value, it goes in
  `contracts/conspectus-vocabulary.json` first and is generated outward from there — the SQL
  `CHECK` literals are the one party edited by hand.
- **Changing what a reader sees** → information architecture and interface are separate
  contracts. Decide records, hierarchy, and routes first; only then how they are expressed.
  Read `references/reporting-style.md` before writing any human-facing label.
- **Changing the methodology** → prose in `.claude/skills/amanuensis/` is the weakest place to
  put a rule. If it must hold, add the refusal to the server and let the prose describe it.
- **Anything with a claim attached** → it needs a gate, that gate needs a condition that turns
  it red, and the red must be provable. A gate that cannot fail is the failure this repository
  has recorded most often.

## What this conspectus does not cover

This is a clean-slate rebuild at `7c1c1a9`; the previous record was discarded, not migrated.
Findings from the earlier survey are archived outside the repository and are referenced by an
external ledger that this store cannot resolve. Nothing here is inherited: if a fact is not
recorded below, this survey did not establish it.
