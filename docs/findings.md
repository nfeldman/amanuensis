# Open findings

## Open

_10 defect(s) with no recorded repair._

### Medium findings

#### [Server runtime and tool dispatch](subsystems/b01-server-runtime-and-tool-dispatch.md)

| ID | Status | Symptom | Root cause | Ref SHA |
|---|---|---|---|---|
<!-- amanuensis:finding:cc78044544af598925de07123aa694d25430434fcf83dd6fa8c44449698b6824 -->
| <a id="b01-1"></a>**B01-1** | open | A ToolDefinition array exported from a module under mcp-server/src/tools/ but never concatenated into index.ts's registry is served by nothing, advertised by nothing, and reported by no check: the tool-inventory gate stays green and DEVELOPMENT.md simply omits it. | gen-tool-inventory.mjs derives its denominator from the served tools/list. scanToolFiles() reads every src/tools/*.ts and does hold the full exported set, but that map is consulted only to group and order the served tools; its keys are never diffed against the served list, so the one artifact that sees both sides discards the only comparison that could turn red. check-tool-schemas.mjs imports every dist/tools module and therefore also sees an unregistered one, but asserts schema shape only. | `0fee11b0` |

#### [Survey record tools](subsystems/b04-survey-record-tools.md)

| ID | Status | Symptom | Root cause | Ref SHA |
|---|---|---|---|---|
<!-- amanuensis:finding:6374cca73aa49a111c30775938c961063a9892f3d60bd99b65e8eb748c34e5eb -->
| <a id="b04-4"></a>**B04-4** | open | add_evidence writes an evidence row whose ref_sha was never resolved, so a disposition or finding can be published citing file:symbol@&lt;sha&gt; for a sha that names no commit in the bound workspace, and every reader downstream presents it as a revision binding. | The handler validates file_path through requireWorkspaceSourcePath and kind against the generated enum, then takes ref_sha with requireString and stores it. The module imports no git helper. Revision resolution in this server is attached to the citing record rather than to the cited row: add_claim resolves each evidence row's ref_sha and requires ancestry, and add_xref resolves every citation token, so evidence that only ever reaches a disposition or a finding is never resolved by anyone. | `0fee11b0` |

#### [Findings, dispositions, and resolution custody](subsystems/b05-findings-dispositions-and-resolution-custody.md)

| ID | Status | Symptom | Root cause | Ref SHA |
|---|---|---|---|---|
<!-- amanuensis:finding:12cbd57d87e0a1b81b7e15720e21a6900c7c87978c1699bcd48440da44a33ade -->
| <a id="b05-1"></a>**B05-1** | open | A concern verdict and a confirmed bug are both stored with a ref_sha nobody resolved, so a disposition or finding can claim to have been assessed at a revision that exists in no repository, and every surface that prints the binding repeats the claim. | set_disposition and add_finding read ref_sha with requireString and write it. dispositions.ts imports no git helper at all; findings.ts has resolveCommit and applies it only to fix_sha, on the repair path. The disposition's free-text evidence citation is parsed with strict:false, which checks only that it does not point into reserved tool state before returning it verbatim, so the revision inside that string is unchecked too. | `0fee11b0` |

#### [Git state, staleness, and refresh](subsystems/b07-git-state-staleness-and-refresh.md)

| ID | Status | Symptom | Root cause | Ref SHA |
|---|---|---|---|---|
<!-- amanuensis:finding:5b90b53ec0f81ef847766380b42be22e6c08d6dca7946efc2439fe965de77143 -->
| <a id="b07-1"></a>**B07-1** | open | The four stale reasons are declared in the vocabulary source and generated into two modules that nobody imports; both writers spell the values as string literals and the column carries no CHECK, so a value that drifts from the enum is written, stored, and read with nothing naming the divergence. | stale_reason declares "sql": [] in the source — a deliberate choice, since the column predates the enum — and the generated STALE_REASONS constants are consumed by no TypeScript or Python module. detect_changes writes "git-drift", "absent" and "unverifiable-ref" inline, and standing.ts:reachability writes "unverifiable-ref" and "unreachable-ref" inline. The enum therefore has three copies and zero enforcement points, which is the one shape the four-party contract does not cover: a vocabulary with no consumer. | `0fee11b0` |

#### [The Amanuensis skill](subsystems/b10-the-amanuensis-skill.md)

| ID | Status | Symptom | Root cause | Ref SHA |
|---|---|---|---|---|
<!-- amanuensis:finding:43048b19c807541cf9f24e09d93a608a30ec708998a59d870770fa01bbed2618 -->
| <a id="b10-1"></a>**B10-1** | open | SKILL.md can drift from the vocabulary source on twenty-three of the twenty-five enums with no check naming the divergence: the four-party check compares the hand-written party only on evidence kinds and disposition classifications, while the prose also publishes the six-value status ladder and the five field-note categories as lists an agent acts on directly. | check-evidence-vocabulary.mjs compares the two generated parties against every enum the source carries, by iterating sourceLists. The fourth party is handled separately, by two hand-written regexes that look for one literal phrase each — "kind ladder (...)" and "`set_disposition` writes one of `...`". Every other vocabulary SKILL.md publishes is outside both patterns, so adding a status or renaming a field-note category changes the source, both generated modules, and the SQL, and leaves the prose asserting the old list with nothing comparing them. | `0fee11b0` |

### Low findings

#### [Conspectus schema, vocabulary, and invariants](subsystems/b03-conspectus-schema-vocabulary-and-invariants.md)

| ID | Status | Symptom | Root cause | Ref SHA |
|---|---|---|---|---|
<!-- amanuensis:finding:dd9a532ba428c06720c816c26ff40c038b456426167ecaa1b4d1786dcf297631 -->
| <a id="b03-4"></a>**B03-4** | open | schema.sql tells a reader of dispositions.evidence_quality that "databases created before this widening keep the narrower constraint", which stopped being true when the vocabulary CHECK migration landed: the source binds evidence_quality to that very column, so every open compares its live CHECK against the source and rebuilds the table when it is narrower. | The vocabulary contract has four parties and a check that compares them; hand-written prose inside schema.sql is a fifth, unchecked one. gen-vocabulary.mjs --check-sql compares CHECK literals, and check-evidence-vocabulary.mjs compares value lists, so neither reads a comment. When migrateVocabularyChecks was added in db.ts it made the statement obsolete and nothing in the repository could notice. | `0fee11b0` |

#### [Survey record tools](subsystems/b04-survey-record-tools.md)

| ID | Status | Symptom | Root cause | Ref SHA |
|---|---|---|---|---|
<!-- amanuensis:finding:a01d786dde9f27952868a962fb456c1693847bbbb9eda1c373c19839924315c3 -->
| <a id="b04-5"></a>**B04-5** | open | The confirmed_bugs rollup on every row list_subsystems returns is computed from findings.status, not from finding_state_current, so the dashboard's count of open bugs and a subsystem page's list of them are produced by two separate definitions of the same predicate. | finding_state_current was introduced because each reader had been mapping findings.status its own way, and its comment enumerates the readers that were converted: the renderer, the two findings tools, the review session, and the review historical-findings reader. list_subsystems was not among them and still carries a FILTER (WHERE f.status='confirmed-bug') in its LEFT JOIN. | `0fee11b0` |

#### [Materializer rendering pipeline](subsystems/b08-materializer-rendering-pipeline.md)

| ID | Status | Symptom | Root cause | Ref SHA |
|---|---|---|---|---|
<!-- amanuensis:finding:c33234b7d1ed2897c72414dcc68063803adb417d5636b9242b71444e2e56c1fb -->
| <a id="b08-1"></a>**B08-1** | open | The subsystem map prints each subsystem's finding count as "N (M open)" where M is computed from findings.status, while the subsystem page for the same subsystem lists those findings with a resolution_state read from finding_state_current. One publish carries two definitions of open. | render_master_plan's rollup query aggregates SUM(CASE WHEN status='confirmed-bug' …) over the findings table. render_subsystem, in the same module, joins finding_state_current for the same rows. The view's comment enumerates the readers that were converted to it and names "the renderer" among them; the conversion reached render_subsystem and not render_master_plan. | `0fee11b0` |

#### [Development harness and gates](subsystems/b11-development-harness-and-gates.md)

| ID | Status | Symptom | Root cause | Ref SHA |
|---|---|---|---|---|
<!-- amanuensis:finding:8a79e3cc7ca3610be73431028d83d0df6978522509d27a5ad17ed07e30fabe98 -->
| <a id="b11-1"></a>**B11-1** | open | The revision-ancestry axis of dev/test-rebuild-readback.mjs and dev/test-rebuild-coverage.mjs cannot turn red in CI. The mcp-server job that runs both checks out at actions/checkout's default depth of 1; the gates detect the shallow clone, print that ancestry is not evaluable, and return a pass for that assertion. | The gates handle the environment honestly — reporting not-evaluable rather than green is the correct response to a clone that cannot answer ancestry — but the environment is chosen by the workflow, and the workflow can give them a full clone. The roadmap job in the same file sets fetch-depth: 0 for gates that need history; the mcp-server job does not, and it is the job that carries the two gates whose receipts bind claims to revisions. | `0fee11b0` |
<!-- amanuensis:finding:d2f533e960072a849a6cf19732efc159c44c53e42584358fda7c70fcd4db2eac -->
| <a id="b11-2"></a>**B11-2** | open | Three JavaScript files in the harness carry raw NUL bytes, which makes them binary to the repository's own search tools: `grep -n pairKey dev/test-rebuild-coverage.mjs` prints nothing and exits 1, and `rg -n pairKey` on the same file prints only "binary file matches (found \0 byte around offset 10704)" with no line number and no content. A search therefore reports that a symbol in a load-bearing gate is absent. | The files embed the separator and sentinel characters literally rather than as escapes: dev/test-rebuild-coverage.mjs uses a raw 0x00 in pairKey's join and in the batch-label comparison's default, and mcp-server/scripts/gen-vocabulary.mjs and dev/amanuensis-defects-to-pecia.mjs each carry two more. The choice of a NUL separator is right — no subsystem id or path can contain one, so two keys cannot collide by concatenation, which is the same reasoning readback.py's ledger-row token uses — but readback.py writes it as the escape \x00 and stays text. | `0fee11b0` |

