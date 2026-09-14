# Leads

_Observations from every survey pass that are not yet findings: patterns, anomalies, connections, tensions, and candidate concerns recorded when a reader noticed something the phase structure did not ask for. Closed leads are on [Resolved leads and questions](resolved-leads.md)._

## Tension

_2 open leads._

- <a id="lead-6"></a>add_claim enforces the two subtractive checks the specification names — subject_type against the enum, and a file-anchored key needing one evidence row that is both a strong kind and cites subject_id's file — and both fired correctly during this survey. But the claim_key's slug is enforced only by dev/test-rebuild-coverage.mjs, which recomputes the stable key from the whole path:symbol pair and demands exact equality. The server accepted [B-02](subsystems/b02-server-core-repository-binding-storage-schema-lifecycle.md)/state-container/openDatabase; the gate would have refused it. The writer learns the rule from a gate that runs after the record is durable, and the only supported correction is reset_subsystem, because invalidate_claim needs a strictly later commit and supersede_claim preserves the key that is wrong. @ `mcp-server/src/tools/claims.ts` · _recorded 2026-09-14 03:50 UTC_
- <a id="lead-4"></a>CONTRIBUTING.md states the policy directly — "If your change touches one, the contract belongs in the server, not in agent prose" — yet the methodology's fullest statement is prose in .claude/skills/amanuensis/, which is neither compiled nor tested. Both can be right: the server should hold what must hold, and the prose should describe the rest. The open question is which side of that line each obligation actually falls on, and whether anything mechanically checks the answer. Seam [S-08](seams.md#s-08) names the boundary. @ `.claude/skills/amanuensis/SKILL.md, CONTRIBUTING.md` · _recorded 2026-09-14 03:35 UTC_

## Anomaly

_2 open leads._

- <a id="lead-5"></a>add_xref's citation grammar is anchored with a lookaround requiring whitespace or end-of-string immediately after the revision, so a citation written at the end of a sentence — "...read at path.ts:sym@7c1c1a9." — is rejected, as is one followed by a comma. Hit twice while recording [B-04](subsystems/b04-reader-lenses-standing-locus-account-claims-edges-vocabulary.md)'s edges at 7c1c1a9. The specification's stated intent for the token-level grammar was to stop rejecting prose that contains a well-formed citation, which it largely achieves; this residue means the writer must still position the citation away from punctuation. Not a correctness defect — no wrong edge is admitted — but it is a rule the schema enforces and no message explains, and the failure arrives as a raw pattern dump from Ajv rather than as a sentence. @ `mcp-server/src/tools/xrefs.ts` · _recorded 2026-09-14 03:50 UTC_
- <a id="lead-1"></a>The repository states its version in five places and they disagree at 7c1c1a9. mcp-server/package.json is "0.2.0-beta.2"; SERVER_VERSION in mcp-server/src/index.ts:27 is "0.2.0-beta.1"; README.md:78 says "The current source is versioned as 0.2.0-beta.1"; mcp-server/README.md:18 says "This source tree packages as 0.2.0-beta.1" and line 118 pins an install to @gruetech/amanuensis@0.2.0-beta.1; HISTORY.md's most recent entry is 0.2.0-beta.1 and there is no 0.2.0-beta.2 entry at all. The live server confirms it: the binding receipt this session received reports serverVersion 0.2.0-beta.1 from a checkout whose package is beta.2. Candidate [VR-1](concerns.md#vr-1), and directly material to the release-readiness question. @ `mcp-server/package.json, mcp-server/src/index.ts:27, README.md:78, mcp-server/README.md:18, HISTORY.md` · _recorded 2026-09-14 03:34 UTC_

## Connection

_1 open lead._

- <a id="lead-2"></a>The Pecia ledger holds 22 defect records carrying `amanuensis:&lt;finding_id&gt;` foreign references into this conspectus. dev/pecia-resolve-finding.mjs resolves them by opening whatever store is at .amanuensis/memory.db right now and asking for the finding's current resolution state. Nothing in the reference names a store generation. So discarding and rebuilding the store makes every reference fail — which is loud and correct — but re-minting a finding id that an old reference names would make it silently succeed against a different finding, which is not. Candidate [ID-1](concerns.md#id-1). @ `.pecia/work.jsonl, dev/pecia-resolve-finding.mjs, .pecia/config.yaml` · _recorded 2026-09-14 03:34 UTC_

## Pattern

_1 open lead._

- <a id="lead-3"></a>The recent gates share a deliberate shape: two arms (a committed receipt plus the live subject wherever one exists), an enumerated list of conditions that turn the gate red, and an explicit statement of the false green the gate cannot exclude. Each also scrubs launcher crash signatures from its output so that an absent deliverable reads as a failed assertion rather than as a gate that never ran. This is the direct response to the zero-denominator failures the project recorded three times, and it makes the older gates conspicuous by contrast — the ones to test against [ZD-1](concerns.md#zd-1) are the ones that do not follow it. @ `dev/test-rebuild-coverage.mjs, dev/test-reader-lenses-dogfood.mjs, dev/test-rebuild-readback.mjs` · _recorded 2026-09-14 03:35 UTC_

