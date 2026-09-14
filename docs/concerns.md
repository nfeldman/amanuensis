# Concerns

## Coverage overview

| Subsystem | **BV-1** | **CC-1** | **EV-1** | **GT-1** | **RC-1** | **SC-1** | **SC-2** | **SC-3** | **SC-4** | **SC-5** | **SC-6** | **SC-7** | **SC-8** | **SC-9** | **ZD-1** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **[B-01](subsystems/b01-server-runtime-and-tool-dispatch.md)** Server runtime and tool dispatch | 🟡 | 🟢 | ⚪ | 🟡 | 🟡 | 🟡 | — | 🔴 | — | — | — | — | — | 🟡 | 🔴 |
| **[B-02](subsystems/b02-repository-binding-and-storage-custody.md)** Repository binding and storage custody | 🟡 | 🟢 | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 | — | — | — | 🟡 | — | — | — | 🟡 |
| **[B-03](subsystems/b03-conspectus-schema-vocabulary-and-invariants.md)** Conspectus schema, vocabulary, and invariants | 🟡 | 🟡 | 🟡 | 🔴 | ⚪ | — | 🟡 | — | 🟡 | — | — | — | 🔴 | — | 🟡 |
| **[B-04](subsystems/b04-survey-record-tools.md)** Survey record tools | 🟡 | 🔴 | 🔴 | 🟡 | ⚪ | — | — | 🔴 | — | — | — | — | — | — | 🟡 |
| **[B-05](subsystems/b05-findings-dispositions-and-resolution-custody.md)** Findings, dispositions, and resolution custody | 🟡 | 🟡 | 🔴 | 🟡 | ⚪ | — | — | — | — | 🟡 | — | — | — | — | 🟡 |
| **[B-06](subsystems/b06-locus-standing-and-the-reader-lenses.md)** Locus standing and the reader lenses | 🟡 | 🟡 | 🟡 | 🟡 | ⚪ | — | — | — | 🟡 | 🟡 | — | — | — | — | 🟡 |
| **[B-07](subsystems/b07-git-state-staleness-and-refresh.md)** Git state, staleness, and refresh | 🟡 | 🟡 | 🟡 | 🔴 | 🟡 | — | — | — | — | — | — | — | — | — | 🟡 |
| **[B-08](subsystems/b08-materializer-rendering-pipeline.md)** Materializer rendering pipeline | 🟡 | 🔴 | ⚪ | 🟡 | 🟡 | — | — | — | — | — | 🟡 | 🟡 | — | — | 🟡 |
| **[B-09](subsystems/b09-projection-read-back-and-publication-custody.md)** Projection read-back and publication custody | 🟡 | 🟡 | ⚪ | 🟡 | 🟡 | — | — | — | — | — | — | 🟡 | — | — | 🟡 |
| **[B-10](subsystems/b10-the-amanuensis-skill.md)** The Amanuensis skill | 🟡 | ⚪ | 🟡 | 🔴 | 🟡 | — | — | — | — | — | — | — | 🔴 | — | 🟡 |
| **[B-11](subsystems/b11-development-harness-and-gates.md)** Development harness and gates | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 | — | — | — | — | — | — | — | — | 🟡 | 🔴 |
| **[B-12](subsystems/b12-vendored-research-corpus.md)** Vendored research corpus | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |

**Legend**: 🟢 ruled-out · 🟡 confirmed-acceptable · 🔴 confirmed-bug · ⚠️ unresolved-competition · ⚪ out-of-scope · 🔗 linchpin-dependent · — not assessed

## Active concerns

| Code | Category | Origin | Discovered in | Notes |
|---|---|---|---|---|
| <a id="bv-1"></a>**BV-1** | boundary-validation | seeded | — | Tool arguments carry workspace-relative paths, revisions, and output directories supplied by an agent. Is every one of them containment-asserted against the bound workspace or storage root before it reaches the filesystem? |
| <a id="cc-1"></a>**CC-1** | cache-coherence | seeded | — | Derived state is served from SQL views over append-only event tables (finding_state_current, file_standing). Does any reader compute the same predicate inline instead of reading the view, so that a schema change moves one and not the other? |
| <a id="ev-1"></a>**EV-1** | evidence-integrity | seeded | — | Claims and evidence are bound to git revisions. Is every recorded revision resolved in the bound workspace at write time, and is ancestry checked where the record's meaning depends on it? |
| <a id="gt-1"></a>**GT-1** | generated-artifact-drift | seeded | — | One vocabulary source feeds generated TypeScript and Python enum modules, SQL CHECK literals, tool validators, and hand-written SKILL.md prose. Can any of those four parties drift without a check naming which one diverged? |
| <a id="rc-1"></a>**RC-1** | resource-lifecycle | seeded | — | The server holds one SQLite handle for the life of the process and the storage directory is a git repository it also writes. Can a handle outlive the file it was opened on, or a commit run against a directory another process is mutating? |
| <a id="sc-1"></a>**SC-1** | seam-contract | discovered | [B-01](subsystems/b01-server-runtime-and-tool-dispatch.md) | [SM-01](seams.md#sm-01), ServerContext between [B-01](subsystems/b01-server-runtime-and-tool-dispatch.md) and [B-02](subsystems/b02-repository-binding-and-storage-custody.md). Do both sides agree on the handle's lifetime, and does either believe it may be replaced while the other holds it? |
| <a id="sc-2"></a>**SC-2** | seam-contract | discovered | [B-02](subsystems/b02-repository-binding-and-storage-custody.md) | [SM-02](seams.md#sm-02), memory.db and the views between [B-02](subsystems/b02-repository-binding-and-storage-custody.md) and [B-03](subsystems/b03-conspectus-schema-vocabulary-and-invariants.md). Does the schema owner's definition reach every store the custodian opens, including one created before the definition changed? |
| <a id="sc-3"></a>**SC-3** | seam-contract | discovered | [B-01](subsystems/b01-server-runtime-and-tool-dispatch.md) | [SM-03](seams.md#sm-03), the ToolDefinition registry between [B-01](subsystems/b01-server-runtime-and-tool-dispatch.md) and [B-04](subsystems/b04-survey-record-tools.md). Does every array a module exports reach the served list, and can either side tell when one does not? |
| <a id="sc-4"></a>**SC-4** | seam-contract | discovered | [B-06](subsystems/b06-locus-standing-and-the-reader-lenses.md) | [SM-04](seams.md#sm-04), the two derived views between [B-06](subsystems/b06-locus-standing-and-the-reader-lenses.md) and [B-03](subsystems/b03-conspectus-schema-vocabulary-and-invariants.md). Does the reader ever reimplement the predicate the definer holds? |
| <a id="sc-5"></a>**SC-5** | seam-contract | discovered | [B-05](subsystems/b05-findings-dispositions-and-resolution-custody.md) | [SM-05](seams.md#sm-05), the event spine and its view between [B-05](subsystems/b05-findings-dispositions-and-resolution-custody.md) and [B-06](subsystems/b06-locus-standing-and-the-reader-lenses.md). Do the appender and the partitioner agree on which record is authority, and can a finding land in both lens partitions or in neither? |
| <a id="sc-6"></a>**SC-6** | seam-contract | discovered | [B-08](subsystems/b08-materializer-rendering-pipeline.md) | [SM-06](seams.md#sm-06), memory.db read read-only by the projection while the server holds it read-write, between [B-08](subsystems/b08-materializer-rendering-pipeline.md) and [B-02](subsystems/b02-repository-binding-and-storage-custody.md). Can the reader see a file the writer has not finished committing, and can the reader repair what it finds? |
| <a id="sc-7"></a>**SC-7** | seam-contract | discovered | [B-09](subsystems/b09-projection-read-back-and-publication-custody.md) | [SM-07](seams.md#sm-07), .projection-contract.json between [B-08](subsystems/b08-materializer-rendering-pipeline.md) and [B-09](subsystems/b09-projection-read-back-and-publication-custody.md). Does the side that decides the denominator and the side that writes the verdict agree on which pages are in it? |
| <a id="sc-8"></a>**SC-8** | seam-contract | discovered | [B-10](subsystems/b10-the-amanuensis-skill.md) | [SM-08](seams.md#sm-08), the conspectus vocabulary between [B-10](subsystems/b10-the-amanuensis-skill.md) and [B-03](subsystems/b03-conspectus-schema-vocabulary-and-invariants.md). Is the hand-written party held to the same source as the generated ones, for every vocabulary it publishes? |
| <a id="sc-9"></a>**SC-9** | seam-contract | discovered | [B-11](subsystems/b11-development-harness-and-gates.md) | [SM-09](seams.md#sm-09), the built server at mcp-server/dist/index.js between [B-11](subsystems/b11-development-harness-and-gates.md) and [B-01](subsystems/b01-server-runtime-and-tool-dispatch.md). Can a gate run against a dist that does not correspond to the source it is judging? |
| <a id="zd-1"></a>**ZD-1** | zero-denominator-verification | seeded | — | Several gates assert over records that may not exist. Can a gate pass because its subject is absent rather than because the property holds? Three such greens have already been found in this repository (B03-2, B04-1, B04-3). |

