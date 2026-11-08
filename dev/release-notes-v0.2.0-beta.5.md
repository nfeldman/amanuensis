Give the conspectus's explanations a durable home, and lead the published pages with them.

### Changes

A subsystem, and the project as a whole, now carries a recorded **purpose** and
**account**: what it is for and how its parts fit together. Three new MCP tools,
`record_explanation`, `decline_explanation` and `get_explanations`, write and read
them. Each explanation is append-only, labelled as model-authored, bound to the
revision it was written at and to its evidence, and refused when it rests only on
name-inferred or pattern-matched evidence. Explanations are never synthesized at
read time. A page whose cited files have since changed says that its explanation is
ageing instead of hiding it.

A subsystem advancing to `mapped` must now have its purpose and account recorded or
declined with a reason. The gate is forward-only: subsystems already `mapped` stay
`mapped`, and an existing store gains the new tables when it is opened.

The skill asks for the purpose and a draft account at the end of Phase 2, challenges
the account in Phase 4 and revises it in Phase 5.

The published pages now read as explanation first:

- subsystem pages open with Purpose and How it works, ahead of the claims and ledger;
- a finding's business context ("Why it matters") and a subsystem's notes are rendered;
- claims read as a register, statement first and grouped by segment;
- ledger rows that share one reason are grouped, keeping every anchor;
- the master plan, hover definitions and the architecture page carry recorded purposes;
- `materialize_docs` reports the slots a survey has left unfilled.

The published self-conspectus has been republished with purposes and accounts for
B-01 to B-05, B-07 and the project.

### Validation scope

The repository's `tests` workflow passed at the release commit's parent. It now covers the product
and its packaging only. Development receipt gates under `dev/` are outside it, and
several are known red after that narrowing. The publish workflow verifies the packed
artifact before it publishes.

Whether the recorded explanations are true and useful is not checked by any gate;
they had one blind review each and the owner's reading. Product efficacy remains
unestablished.

Install this exact prerelease with:

```bash
npm install -g @gruetech/amanuensis@0.2.0-beta.5
```

Restart your MCP client after upgrading so existing connections load the new server
and materializer. Until `1.0.0`, breaking changes remain possible between releases.
