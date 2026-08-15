-- Conspectus Memory Schema (amanuensis)
--
-- Derived from the LOC toolkit's schema. Amanuensis has diverged and will
-- continue to diverge: extensions below (sessions, subsystems, artifacts,
-- seams, evidence, diagnosticity matrix) are amanuensis-specific and are
-- not expected to track upstream.
-- SQLite, WAL mode, single-writer / multi-reader
--
-- This database is the memory-about-memory: it tracks what exists,
-- how it connects, how fresh it is, and what the agent has been
-- attending to. The markdown files remain the readable artifacts.
-- The database is the index that makes retrieval intelligent.
--
-- Initialize per-project:
--   sqlite3 ~/.amanuensis/workspaces/<owner>/<project>/memory.db < ~/.amanuensis/schema.sql

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

----------------------------------------------------------------------
-- ENTRIES: every piece of knowledge at every tier
----------------------------------------------------------------------
-- Tier 0: recognition — entry point rows, master plan lines
-- Tier 1: recall — semantically compressed subsystem summaries
-- Tier 2: episodic — full survey artifacts
-- Tier 3: source — pointers to code (not stored, just referenced)

CREATE TABLE IF NOT EXISTS entries (
    id            TEXT    NOT NULL,
    tier          INTEGER NOT NULL CHECK (tier BETWEEN 0 AND 2),
    subsystem_id  TEXT,                          -- nullable for cross-cutting entries
    content_hash  TEXT,                          -- blake2b of the markdown section/file
    source_path   TEXT,                          -- relative path to the markdown artifact
    source_lines  TEXT,                          -- line range within file, e.g. '1-45'
    ref_sha       TEXT,                          -- git commit SHA the entry was based on
    ref_branch    TEXT,                          -- branch name at time of survey
    parent_id     TEXT,                          -- tier N entry points to tier N+1 parent
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    confidence    TEXT    CHECK (confidence IN (
                            'verified','corroborated','single-source',
                            'inferred','unverified')),
    stale         INTEGER NOT NULL DEFAULT 0,    -- 0 = fresh, 1 = staleness detected
    stale_since   TEXT,                          -- when staleness was detected
    stale_reason  TEXT,                          -- what changed: 'git-drift', 'manual', etc.
    PRIMARY KEY (id, tier)
    -- Invariant: parent_id references the entry one tier deeper.
    -- Cannot express tier+1 in a FOREIGN KEY; enforce in application code.
);

CREATE INDEX IF NOT EXISTS idx_entries_subsystem ON entries(subsystem_id);
CREATE INDEX IF NOT EXISTS idx_entries_tier      ON entries(tier);
CREATE INDEX IF NOT EXISTS idx_entries_stale     ON entries(stale) WHERE stale = 1;

----------------------------------------------------------------------
-- GIT_STATE: version control tracking
----------------------------------------------------------------------
-- One row per codebase (supports multi-repo if needed).
-- Tracks the canonical branch and the last SHA the agent checked
-- for changes. The agent compares HEAD of the canonical branch
-- against last_checked_sha to detect drift.

CREATE TABLE IF NOT EXISTS git_state (
    repo_id          TEXT    PRIMARY KEY DEFAULT 'default',
    canonical_branch TEXT    NOT NULL,              -- detected during onboarding: main, master, trunk, etc.
    branch_convention TEXT,                          -- e.g. 'trunk-based', 'gitflow', 'github-flow'
    last_checked_sha TEXT,                           -- HEAD of canonical branch at last check
    last_checked_at  TEXT,                           -- when the check was performed
    onboarding_sha   TEXT    NOT NULL,               -- HEAD at time of onboarding
    detected_branches TEXT,                          -- JSON array of branches seen at onboarding
    notes            TEXT
);

----------------------------------------------------------------------
-- XREFS: cross-references between subsystems
----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS xrefs (
    from_id       TEXT    NOT NULL,
    to_id         TEXT    NOT NULL,
    relationship  TEXT    NOT NULL,  -- shared-pattern, data-flow, dependency,
                                     -- mirrors, contention, temporal-coupling
    strength      TEXT    NOT NULL DEFAULT 'observed'
                          CHECK (strength IN ('observed','confirmed','structural')),
    discovered_at TEXT    NOT NULL DEFAULT (datetime('now')),
    context       TEXT,              -- one-line: why this link matters
    PRIMARY KEY (from_id, to_id, relationship)
);

CREATE INDEX IF NOT EXISTS idx_xrefs_to ON xrefs(to_id);

----------------------------------------------------------------------
-- ACCESS_LOG: recency + frequency tracking
----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS access_log (
    id            INTEGER PRIMARY KEY,
    entry_id      TEXT    NOT NULL,
    entry_tier    INTEGER NOT NULL,
    accessed_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    trigger       TEXT,              -- why loaded: 'xref from B3', 'phase-3 read', etc.
    session_id    TEXT               -- groups accesses within one survey pass
);

CREATE INDEX IF NOT EXISTS idx_access_recency   ON access_log(accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_frequency ON access_log(entry_id, entry_tier);
-- Covering index for hot_subsystems view: walks entry_id groups with
-- accessed_at / tier available in the index itself, avoiding table touches.
CREATE INDEX IF NOT EXISTS idx_access_hot ON access_log(entry_id, entry_tier, accessed_at);

----------------------------------------------------------------------
-- COMPRESSIONS: the chain from dense to full
----------------------------------------------------------------------
-- Every compression records: what was compressed, into what,
-- and what was preserved vs. elided. The chain is reversible
-- as long as the source artifact (or git history) still exists.

CREATE TABLE IF NOT EXISTS compressions (
    id               INTEGER PRIMARY KEY,
    source_id        TEXT    NOT NULL,
    source_tier      INTEGER NOT NULL,
    target_id        TEXT    NOT NULL,
    target_tier      INTEGER NOT NULL,
    compressed_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    ratio            REAL,            -- source_tokens / target_tokens (approx)
    strategy         TEXT,            -- e.g. 'semantic', 'structural-elision', 'initial'
    preserved_fields TEXT,            -- JSON array of seven-field keys kept at full fidelity
    elided_fields    TEXT,            -- JSON array of what was dropped or condensed
    reversible       INTEGER NOT NULL DEFAULT 1,
    CHECK (target_tier < source_tier)
);

----------------------------------------------------------------------
-- CONCERNS: lifecycle tracking for concern categories
----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS concerns (
    code          TEXT    PRIMARY KEY,  -- e.g. 'CACHE-STALENESS', 'CC-1'
    category      TEXT,                 -- e.g. 'concurrency', 'data-integrity'
    origin        TEXT    NOT NULL CHECK (origin IN ('seeded','discovered')),
    discovered_in TEXT,                 -- subsystem where first noticed
    discovered_at TEXT    NOT NULL DEFAULT (datetime('now')),
    promoted_at   TEXT,                 -- when accepted into checklist
    status        TEXT    NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','retired','merged','candidate')),
    merged_into   TEXT,                 -- if merged, target concern code
    notes         TEXT,
    FOREIGN KEY (merged_into) REFERENCES concerns(code)
);

----------------------------------------------------------------------
-- FILE_LEDGER: which files belong to which subsystem
----------------------------------------------------------------------
-- The canonical record of scope. Markdown file ledger tables are
-- rendered from this. Change detection uses this to know which
-- git paths to check for each subsystem.

CREATE TABLE IF NOT EXISTS file_ledger (
    subsystem_id    TEXT    NOT NULL,
    file_path       TEXT    NOT NULL,
    why_in_scope    TEXT,
    classification  TEXT    CHECK (classification IN (
                              'candidate','examined','generated-ignore',
                              'vendor-ignore','irrelevant','deferred-with-reason')),
    ref_sha         TEXT,               -- commit SHA when file was examined
    examined_at     TEXT,               -- when classification moved to 'examined'
    PRIMARY KEY (subsystem_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_file_ledger_path ON file_ledger(file_path);

----------------------------------------------------------------------
-- DISPOSITIONS: concern × subsystem classification
----------------------------------------------------------------------
-- One row per (subsystem, concern) pair. This is the queryable form
-- of the Concern Disposition Table in each subsystem artifact.

CREATE TABLE IF NOT EXISTS dispositions (
    subsystem_id    TEXT    NOT NULL,
    concern_code    TEXT    NOT NULL REFERENCES concerns(code),
    classification  TEXT    CHECK (classification IN (
                              'confirmed-bug','confirmed-acceptable',
                              'ruled-out','out-of-scope',
                              'unresolved-competition')),
    evidence        TEXT,               -- file:symbol@sha reference
    evidence_quality TEXT CHECK (evidence_quality IN (
                              'code-verified','contract-stated',
                              'comment-asserted','name-inferred',
                              'pattern-matched')),
    linchpin_dependent INTEGER NOT NULL DEFAULT 0, -- 1 if finding depends on fragile evidence
    rationale       TEXT,               -- one-sentence justification
    assessed_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    ref_sha         TEXT,               -- commit SHA when assessed
    session_id      TEXT,               -- survey session that produced this row
    pass_type       TEXT    CHECK (pass_type IN (
                              'onboarding','survey','adversarial','refresh')),
    PRIMARY KEY (subsystem_id, concern_code)
);

----------------------------------------------------------------------
-- FINDINGS: confirmed findings across all subsystems
----------------------------------------------------------------------
-- The queryable form of findings-index.md. Severity
-- queries, status tracking, and fix verification run against this.

CREATE TABLE IF NOT EXISTS findings (
    finding_id        TEXT    PRIMARY KEY,  -- e.g. 'B01-1'
    subsystem_id      TEXT    NOT NULL,
    symptom           TEXT    NOT NULL,
    root_cause        TEXT    NOT NULL,
    severity          TEXT    NOT NULL CHECK (severity IN (
                                'CRITICAL','HIGH','MEDIUM','LOW')),
    status            TEXT    NOT NULL CHECK (status IN (
                                'confirmed-bug','confirmed-acceptable',
                                'fixed','ruled-out')),
    fix_location      TEXT,
    primary_files     TEXT,                 -- JSON array of file:symbol@sha
    business_context  TEXT,
    ref_sha           TEXT,
    session_id        TEXT,               -- survey session that confirmed this finding
    pass_type         TEXT    CHECK (pass_type IN (
                                'onboarding','survey','adversarial','refresh')),
    created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_findings_subsystem ON findings(subsystem_id);
CREATE INDEX IF NOT EXISTS idx_findings_severity  ON findings(severity);
CREATE INDEX IF NOT EXISTS idx_findings_status    ON findings(status);
CREATE INDEX IF NOT EXISTS idx_findings_session   ON findings(session_id);

----------------------------------------------------------------------
-- CONTRADICTIONS: conflicting findings detected across survey passes
----------------------------------------------------------------------
-- When two findings reference the same file/symbol and have logically
-- incompatible classifications or severity assessments, a contradiction
-- row is created. Contradictions require explicit resolution: one finding
-- supersedes the other (superseded_by), or they apply to distinct scopes
-- that must be explicitly distinguished (scope_note).

CREATE TABLE IF NOT EXISTS contradictions (
    id              INTEGER PRIMARY KEY,
    finding_a       TEXT    NOT NULL REFERENCES findings(finding_id),
    finding_b       TEXT    NOT NULL REFERENCES findings(finding_id),
    shared_location TEXT,               -- file:symbol@sha in common
    conflict_type   TEXT    NOT NULL,   -- e.g. 'classification-conflict', 'severity-conflict'
    detected_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    resolution      TEXT    CHECK (resolution IN (
                              'a-supersedes-b','b-supersedes-a',
                              'scope-distinction','unresolved')),
    scope_note      TEXT,               -- if scope-distinction: what scopes differ
    resolved_at     TEXT,
    session_id      TEXT                -- session that performed the resolution
);

CREATE INDEX IF NOT EXISTS idx_contradictions_a    ON contradictions(finding_a);
CREATE INDEX IF NOT EXISTS idx_contradictions_b    ON contradictions(finding_b);
CREATE INDEX IF NOT EXISTS idx_contradictions_unresolved ON contradictions(resolution)
    WHERE resolution = 'unresolved';

----------------------------------------------------------------------
-- FIELD_NOTES: peripheral observations
----------------------------------------------------------------------
-- Append-only. The DB form of field-notes.md tables.
-- Queryable across subsystems: "show me all anomalies" or
-- "what tensions have open follow-ups?"

CREATE TABLE IF NOT EXISTS field_notes (
    id              INTEGER PRIMARY KEY,
    category        TEXT    NOT NULL CHECK (category IN (
                              'pattern','anomaly','connection',
                              'tension','candidate-concern')),
    observation     TEXT    NOT NULL,
    location        TEXT,               -- file:symbol@sha or subsystem ID
    ref_sha         TEXT,
    follow_up       TEXT    DEFAULT 'open',  -- 'open', finding ID, 'dismissed'
    session_id      TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_field_notes_category ON field_notes(category);
CREATE INDEX IF NOT EXISTS idx_field_notes_followup ON field_notes(follow_up) WHERE follow_up = 'open';

----------------------------------------------------------------------
-- QUERY_LOG: user question pattern tracking
----------------------------------------------------------------------
-- Every user question is classified by which of the seven fields
-- the answer drew on (fields_hit) and how deep the agent had to go
-- (tier_reached). The field_demand view aggregates these into a
-- priority ranking that drives adaptive compression.

CREATE TABLE IF NOT EXISTS query_log (
    id              INTEGER PRIMARY KEY,
    question        TEXT    NOT NULL,        -- paraphrased user question
    fields_hit      TEXT    NOT NULL,        -- JSON array: ["what","how","see-also"]
    tier_reached    INTEGER NOT NULL,        -- deepest tier loaded to answer (0-3)
    subsystem_id    TEXT,                    -- which subsystem the question targeted
    session_id      TEXT,
    answered_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_query_log_session ON query_log(session_id);
CREATE INDEX IF NOT EXISTS idx_query_log_time    ON query_log(answered_at DESC);

----------------------------------------------------------------------
-- WRITE_LOCKS: sub-agent coordination
----------------------------------------------------------------------
-- When multiple sub-agents may write to the same artifact, the
-- orchestrator acquires a lock before dispatching. The sub-agent
-- verifies the lock before writing. Locks expire after a timeout
-- to prevent deadlock from crashed agents.
--
-- The lock protocol is defensive, not blocking: if a lock is held,
-- the sub-agent writes to a git branch instead and the orchestrator
-- merges after the lock holder is done.

CREATE TABLE IF NOT EXISTS write_locks (
    artifact_path   TEXT    PRIMARY KEY,   -- relative path to the artifact
    holder_id       TEXT    NOT NULL,      -- sub-agent session ID
    acquired_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    expires_at      TEXT,                  -- auto-release after this time
    intent          TEXT                   -- what the holder plans to do
);


----------------------------------------------------------------------
-- VOCABULARY: the codebase's compressed signifiers
----------------------------------------------------------------------
-- Every system compresses complex concepts into short terms.
-- This table captures those terms with two levels of explanation:
--   gloss  — the compressed definition (enough to use the term)
--   expand — the full unpacked explanation (enough to teach the concept)
--
-- The agent uses vocabulary terms in its own artifacts for density,
-- and expands them on demand when the human asks "what do you mean by X?"

CREATE TABLE IF NOT EXISTS vocabulary (
    term            TEXT    PRIMARY KEY,     -- the signifier as used in the codebase
    gloss           TEXT    NOT NULL,        -- 1-sentence compressed definition
    expansion       TEXT,                    -- full explanation: what it means, why it
                                            -- exists, what it implies, edge cases
    subsystem_id    TEXT,                    -- NULL = codebase-wide, else scoped
    first_seen      TEXT,                    -- file:symbol@sha where first encountered
    ref_sha         TEXT,                    -- commit SHA when recorded
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vocabulary_subsystem ON vocabulary(subsystem_id);


----------------------------------------------------------------------
-- ENTRY_VERSIONS: cheap time-travel (append-only snapshots)
----------------------------------------------------------------------
-- Before any UPDATE to entries, a trigger copies the old row here.
-- Not a full CRDT — just a linear audit trail per entry.

CREATE TABLE IF NOT EXISTS entry_versions (
    version_id    INTEGER PRIMARY KEY,
    id            TEXT    NOT NULL,
    tier          INTEGER NOT NULL,
    content_hash  TEXT,
    source_path   TEXT,
    ref_sha       TEXT,                 -- git SHA the old version was based on
    confidence    TEXT,
    valid_from    TEXT    NOT NULL,     -- the old updated_at
    valid_until   TEXT    NOT NULL DEFAULT (datetime('now')),
    superseded_by TEXT                  -- new content_hash, for diffing
);

CREATE INDEX IF NOT EXISTS idx_versions_entry ON entry_versions(id, tier);
CREATE INDEX IF NOT EXISTS idx_versions_time  ON entry_versions(valid_until DESC);

-- Trigger: snapshot before update
CREATE TRIGGER IF NOT EXISTS entries_version_on_update
BEFORE UPDATE ON entries
FOR EACH ROW
WHEN (
    (OLD.content_hash IS NOT NULL AND
        (NEW.content_hash IS NULL OR OLD.content_hash != NEW.content_hash))
    OR COALESCE(OLD.confidence,'') != COALESCE(NEW.confidence,'')
    OR OLD.stale != NEW.stale
    OR COALESCE(OLD.ref_sha,'') != COALESCE(NEW.ref_sha,'')
)
BEGIN
    INSERT INTO entry_versions (id, tier, content_hash, source_path,
                                ref_sha, confidence, valid_from, superseded_by)
    VALUES (OLD.id, OLD.tier, OLD.content_hash, OLD.source_path,
            OLD.ref_sha, OLD.confidence, OLD.updated_at, NEW.content_hash);
END;

----------------------------------------------------------------------
-- VIEWS: the queries the agent actually runs
----------------------------------------------------------------------

-- Hot subsystems: most accessed in last 7 days, weighted by recency
CREATE VIEW IF NOT EXISTS hot_subsystems AS
SELECT
    entry_id,
    COUNT(*)                                           AS access_count,
    MAX(accessed_at)                                   AS last_accessed,
    COUNT(*) * 1.0 / (julianday('now') -
        julianday(MIN(accessed_at)) + 1)               AS heat
FROM access_log
WHERE accessed_at > datetime('now', '-7 days')
  AND entry_tier <= 1
GROUP BY entry_id
ORDER BY heat DESC;

-- Stale entries: where the conspectus may have drifted from source
CREATE VIEW IF NOT EXISTS stale_entries AS
SELECT e.id, e.tier, e.source_path, e.updated_at, e.confidence,
       e.ref_sha, e.stale_since, e.stale_reason
FROM entries e
WHERE e.stale = 1
ORDER BY e.stale_since ASC, e.updated_at ASC;

-- Stale backlog: entries needing refresh, prioritized by access heat
-- High-heat stale entries should be refreshed first.
CREATE VIEW IF NOT EXISTS stale_backlog AS
SELECT
    e.id,
    e.tier,
    e.subsystem_id,
    e.source_path,
    e.ref_sha,
    e.stale_since,
    e.stale_reason,
    COALESCE(h.heat, 0) AS heat,
    COALESCE(h.access_count, 0) AS access_count
FROM entries e
LEFT JOIN hot_subsystems h ON h.entry_id = e.id
WHERE e.stale = 1
ORDER BY COALESCE(h.heat, 0) DESC, e.stale_since ASC;

-- Compression chain for a given entry: walk from tier 0 → tier 2
-- (use recursively in application code; this view shows direct links)
CREATE VIEW IF NOT EXISTS compression_chain AS
SELECT
    c.target_id   AS compressed_id,
    c.target_tier AS compressed_tier,
    c.source_id   AS full_id,
    c.source_tier AS full_tier,
    c.ratio,
    c.strategy,
    c.compressed_at
FROM compressions c
ORDER BY c.target_tier ASC;

-- Cross-reference density: which subsystems are most interconnected
CREATE VIEW IF NOT EXISTS xref_density AS
SELECT
    id,
    (SELECT COUNT(*) FROM xrefs WHERE from_id = id) +
    (SELECT COUNT(*) FROM xrefs WHERE to_id = id)    AS total_xrefs,
    (SELECT COUNT(*) FROM xrefs WHERE from_id = id)  AS outgoing,
    (SELECT COUNT(*) FROM xrefs WHERE to_id = id)    AS incoming
FROM (SELECT DISTINCT from_id AS id FROM xrefs
      UNION
      SELECT DISTINCT to_id FROM xrefs)
ORDER BY total_xrefs DESC;

-- Concern coverage: which subsystems have unexamined concerns.
-- Subsystems are sourced from the `subsystems` table (promoted first-class
-- in the post-v0.1 schema evolution). Earlier versions sourced from
-- `entries WHERE tier=0`, which missed subsystems registered via
-- upsert_subsystem that had no tier-0 entry row yet. Drop-and-recreate
-- so the evolved body lands on pre-existing databases.
DROP VIEW IF EXISTS concern_coverage;
CREATE VIEW concern_coverage AS
SELECT
    c.code          AS concern_code,
    c.category,
    s.id            AS subsystem_id,
    COALESCE(d.classification, '—') AS disposition,
    d.assessed_at
FROM concerns c
CROSS JOIN subsystems s
LEFT JOIN dispositions d
    ON d.concern_code = c.code AND d.subsystem_id = s.id
WHERE c.status = 'active'
ORDER BY s.id, c.code;

-- Subsystem scope paths: files tracked per subsystem, for change detection
CREATE VIEW IF NOT EXISTS subsystem_scope AS
SELECT
    subsystem_id,
    GROUP_CONCAT(file_path, char(10)) AS scope_files,
    COUNT(*) AS file_count,
    SUM(CASE WHEN classification = 'examined' THEN 1 ELSE 0 END) AS examined_count,
    MAX(ref_sha) AS latest_ref_sha
FROM file_ledger
GROUP BY subsystem_id;

-- Finding severity summary
CREATE VIEW IF NOT EXISTS finding_summary AS
SELECT
    subsystem_id,
    COUNT(*) AS total_findings,
    SUM(CASE WHEN severity = 'CRITICAL' THEN 1 ELSE 0 END) AS critical,
    SUM(CASE WHEN severity = 'HIGH' THEN 1 ELSE 0 END) AS high,
    SUM(CASE WHEN severity = 'MEDIUM' THEN 1 ELSE 0 END) AS medium,
    SUM(CASE WHEN severity = 'LOW' THEN 1 ELSE 0 END) AS low,
    SUM(CASE WHEN status = 'confirmed-bug' THEN 1 ELSE 0 END) AS open_bugs,
    SUM(CASE WHEN status = 'fixed' THEN 1 ELSE 0 END) AS fixed
FROM findings
GROUP BY subsystem_id;

----------------------------------------------------------------------
-- SUBAGENT_LOG: index of all subagent dispatch records
----------------------------------------------------------------------
-- The full prompt and output live in _meta/prompts/<file_path>.
-- This table is the queryable index — filter by session, role, or time
-- without reading every file.
--
-- Role values match the Connector mode taxonomy:
--   mapping-agent | memory-auditor | explore | custom

CREATE TABLE IF NOT EXISTS subagent_log (
    id              INTEGER PRIMARY KEY,
    session_id      TEXT    NOT NULL,        -- UUID of the orchestrating session
    seq             INTEGER NOT NULL,        -- dispatch order within session (1-based)
    role            TEXT    NOT NULL,        -- role given to the subagent
    dispatched_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    completed_at    TEXT,                    -- NULL until response received
    file_path       TEXT    NOT NULL,        -- relative path: _meta/prompts/<file>
    subsystem_id    TEXT,                    -- which subsystem this dispatch targeted
    artifacts_written TEXT,                  -- JSON array of artifact paths touched
    status          TEXT    NOT NULL DEFAULT 'dispatched'  -- dispatched | completed | failed
);

CREATE INDEX IF NOT EXISTS idx_subagent_log_session ON subagent_log(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_subagent_log_time    ON subagent_log(dispatched_at DESC);

----------------------------------------------------------------------
-- Active write locks (excluding expired)
CREATE VIEW IF NOT EXISTS active_write_locks AS
SELECT artifact_path, holder_id, acquired_at, expires_at, intent
FROM write_locks
WHERE expires_at IS NULL OR expires_at > datetime('now');

-- Field demand: which seven-field dimensions the user asks about most.
-- Drives adaptive compression — high-demand fields get preserved at
-- higher fidelity during Tier 2 → Tier 1 compression.
-- Default priority (no data): what > how > see-also > where > why > confidence > when
CREATE VIEW IF NOT EXISTS field_demand AS
SELECT
    j.value                                             AS field,
    COUNT(*)                                            AS demand_count,
    COUNT(*) * 1.0 / (SELECT COUNT(*) FROM query_log)  AS demand_ratio,
    MAX(q.answered_at)                                  AS last_demanded,
    AVG(q.tier_reached)                                 AS avg_tier_reached
FROM query_log q, json_each(q.fields_hit) j
GROUP BY j.value
ORDER BY demand_count DESC;

----------------------------------------------------------------------
-- AMANUENSIS DIVERGENCES FROM LOC TOOLKIT SCHEMA
----------------------------------------------------------------------
-- Everything below promotes structure that was markdown-only (seams,
-- artifacts) or free-text (evidence, diagnosticity analysis) in the
-- ancestor schema. The motivation is that the VS Code materializer and
-- the agents need these things as queryable, linkable, hash-comparable
-- rows — not as prose the materializer has to re-parse every run.

----------------------------------------------------------------------
-- SESSIONS: survey session registry
----------------------------------------------------------------------
-- Promoted from a server-owned supplementary table. session_id is used
-- as a free-form tag on findings, dispositions, access_log, query_log,
-- field_notes, contradictions, and subagent_log. Having it first-class
-- lets us attribute every durable artifact back to the intent that
-- produced it.

CREATE TABLE IF NOT EXISTS sessions (
    session_id   TEXT    PRIMARY KEY,
    intent       TEXT    NOT NULL,                -- 'onboarding', 'survey B-01', 'refresh', 'adversarial-sweep'
    started_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    ended_at     TEXT,                            -- NULL while active; set by end_session
    outcome      TEXT                             -- free text note — 'completed', 'deferred', 'superseded', etc.
);

CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_active  ON sessions(ended_at) WHERE ended_at IS NULL;

----------------------------------------------------------------------
-- SUBSYSTEMS: master plan registry
----------------------------------------------------------------------
-- Promoted from a server-owned supplementary table. Existed implicitly
-- via file_ledger.subsystem_id and entries.subsystem_id, but had no row
-- of its own — name, scope, jump-in reading, status lived in
-- master-plan.md prose only. Making it structured lets the materializer
-- render deep-linked subsystem pages and lets the coordinator query
-- status without parsing markdown.
--
-- The `status` enum is the survey state machine: unmapped → scoping →
-- structural → concerns → adversarial → mapped. `deferred` is for
-- subsystems explicitly removed from the active plan.

CREATE TABLE IF NOT EXISTS subsystems (
    id               TEXT    PRIMARY KEY,
    name             TEXT    NOT NULL,
    status           TEXT    NOT NULL DEFAULT 'unmapped'
                           CHECK (status IN ('unmapped','scoping','structural',
                                              'concerns','adversarial','mapped','deferred')),
    layer            TEXT,                         -- e.g. 'backend', 'frontend', 'native', 'cross-cutting'
    scope            TEXT,                         -- free-text: key files, directories, symbols
    jump_in_reading  TEXT,                         -- 2–3 files a future LLM should read first
    notes            TEXT,
    priority         INTEGER CHECK (priority IS NULL OR priority > 0),
                                                    -- survey priority. 1 = survey first; nullable when
                                                    -- the coordinator has no strong opinion. Ranks are
                                                    -- relative, not absolute — two subsystems at the
                                                    -- same priority are a tie. Produced during
                                                    -- onboarding Phase 5 and refined by the memory
                                                    -- auditor as new dependencies are discovered.
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_subsystems_status   ON subsystems(status);
CREATE INDEX IF NOT EXISTS idx_subsystems_layer    ON subsystems(layer);
CREATE INDEX IF NOT EXISTS idx_subsystems_priority ON subsystems(priority) WHERE priority IS NOT NULL;

-- subsystems.priority was added post-v0.1. `CREATE TABLE IF NOT EXISTS`
-- above leaves existing tables untouched, so databases created before
-- the column existed get the additive migration from `runMigrations()`
-- in db.ts.

----------------------------------------------------------------------
-- ARTIFACTS: prose artifact registry
----------------------------------------------------------------------
-- Each row is a markdown artifact in the project storage directory
-- (onboarding-report.md, entry-point.md, [id]-[name].md survey files,
-- field-notes.md, etc.). The materializer uses content_hash to decide
-- whether a prose-sourced page needs to be re-rendered. Agents use
-- this table to find artifacts by type without ls-ing the directory.

CREATE TABLE IF NOT EXISTS artifacts (
    path             TEXT    PRIMARY KEY,          -- relative to storage dir, e.g. 'B-01-scheduler.md'
    kind             TEXT    NOT NULL CHECK (kind IN (
                               'onboarding-report','entry-point','master-plan',
                               'findings-index','concern-checklist','field-notes',
                               'subsystem-survey','seam-assessment','dispatch-prompt',
                               'other')),
    subsystem_id     TEXT,                          -- scoped artifacts point at a subsystem
    content_hash     TEXT,                          -- blake2b / sha256 of the file contents
    ref_sha          TEXT,                          -- workspace SHA at last write
    session_id       TEXT,                          -- session that produced the last write
    written_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    bytes            INTEGER,
    notes            TEXT
);

CREATE INDEX IF NOT EXISTS idx_artifacts_kind      ON artifacts(kind);
CREATE INDEX IF NOT EXISTS idx_artifacts_subsystem ON artifacts(subsystem_id);

----------------------------------------------------------------------
-- SEAMS: inter-subsystem boundaries (Concern Territory 11)
----------------------------------------------------------------------
-- concern-seeding.md T11 designates the seam registry as mandatory
-- Phase 2 output. In the ancestor schema this lived as markdown only.
-- Making it structured lets seam concerns (SC-N) be real dispositions
-- in the coverage matrix and lets the materializer draw seam pages
-- that link both parties together.
--
-- A seam is promotable to an assessable boundary only when both parties
-- are `mapped` — tracked via the computed view `seam_assessability`.

CREATE TABLE IF NOT EXISTS seams (
    id                  TEXT    PRIMARY KEY,       -- e.g. 'SM-01'
    shared_object       TEXT    NOT NULL,          -- 'user_cache', 'jobs_queue', 'orders table'
    shared_object_kind  TEXT    CHECK (shared_object_kind IN (
                              'cache','queue','table','event-bus','rpc','shared-memory',
                              'file','config','other')),
    party_a             TEXT    NOT NULL REFERENCES subsystems(id),
    party_b             TEXT    NOT NULL REFERENCES subsystems(id),
    a_writes            TEXT,                       -- what party A writes through the seam
    a_reads             TEXT,                       -- what party A reads
    b_writes            TEXT,
    b_reads             TEXT,
    ordering_assumption TEXT,                       -- 'total-ordering','causal','none', etc.
    cardinality         TEXT,                       -- 'single-consumer','fan-out','n-to-n'
    staleness_tolerance TEXT,                       -- free text: 'strong-consistent','bounded:5s','eventual','not-specified'
    schema_owner        TEXT,                       -- which subsystem owns the schema (if applicable)
    notes               TEXT,
    created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_seams_a ON seams(party_a);
CREATE INDEX IF NOT EXISTS idx_seams_b ON seams(party_b);

-- Seam assessability: a seam can only host SC-N concern assessments
-- once both parties reach `mapped`. This view surfaces which seams
-- are ready for assessment.
CREATE VIEW IF NOT EXISTS seam_assessability AS
SELECT
    s.id                               AS seam_id,
    s.shared_object,
    s.party_a,
    sa.status                          AS party_a_status,
    s.party_b,
    sb.status                          AS party_b_status,
    CASE WHEN sa.status='mapped' AND sb.status='mapped' THEN 1 ELSE 0 END
                                       AS assessable
FROM seams s
JOIN subsystems sa ON sa.id = s.party_a
JOIN subsystems sb ON sb.id = s.party_b;

----------------------------------------------------------------------
-- EVIDENCE: structured code citations
----------------------------------------------------------------------
-- The ancestor schema kept evidence as free-text file:symbol@sha
-- fields on dispositions and findings. That works but has three
-- downsides:
--   1. The materializer has to parse the string to render source links.
--   2. There is no way to answer "show me everything that cites file X"
--      except by grepping every evidence field.
--   3. Evidence quality ('code-verified', etc.) lived on dispositions
--      only. Findings had no structured way to record quality.
--
-- The evidence table gives every citation a row with hash-able source
-- coordinates. Dispositions and findings reference evidence by id via
-- the join tables `disposition_evidence` and `finding_evidence` — many
-- dispositions/findings can share a single piece of evidence.

CREATE TABLE IF NOT EXISTS evidence (
    id               INTEGER PRIMARY KEY,
    file_path        TEXT    NOT NULL,
    symbol           TEXT,                         -- function/class/type identifier if applicable
    line_range       TEXT,                         -- '42-57' if a specific span
    ref_sha          TEXT    NOT NULL,
    kind             TEXT    NOT NULL CHECK (kind IN (
                              'code-verified','contract-stated','comment-asserted',
                              'name-inferred','pattern-matched','test-observed',
                              'config-asserted','doc-asserted','runtime-observed')),
    excerpt          TEXT,                         -- optional stored snippet (max ~1KB)
    note             TEXT,                         -- why this evidence matters
    session_id       TEXT,
    collected_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_evidence_file     ON evidence(file_path);
CREATE INDEX IF NOT EXISTS idx_evidence_kind     ON evidence(kind);
CREATE INDEX IF NOT EXISTS idx_evidence_ref_sha  ON evidence(ref_sha);

CREATE TABLE IF NOT EXISTS disposition_evidence (
    subsystem_id     TEXT    NOT NULL,
    concern_code     TEXT    NOT NULL,
    evidence_id      INTEGER NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
    role             TEXT,                         -- 'supports','contradicts','linchpin','compensating'
    PRIMARY KEY (subsystem_id, concern_code, evidence_id),
    FOREIGN KEY (subsystem_id, concern_code) REFERENCES dispositions(subsystem_id, concern_code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS finding_evidence (
    finding_id       TEXT    NOT NULL REFERENCES findings(finding_id) ON DELETE CASCADE,
    evidence_id      INTEGER NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
    role             TEXT,                         -- 'symptom','root-cause','fix-anchor','compensating'
    PRIMARY KEY (finding_id, evidence_id)
);

CREATE INDEX IF NOT EXISTS idx_disp_evidence_evidence ON disposition_evidence(evidence_id);
CREATE INDEX IF NOT EXISTS idx_find_evidence_evidence ON finding_evidence(evidence_id);

----------------------------------------------------------------------
-- RESOLUTION PROOFS: append-only authority for "fixed" and resolved
----------------------------------------------------------------------
-- `findings.status` and `contradictions.resolution` remain coarse mutable
-- compatibility projections.  Authority lives here: a repair is pending
-- until evidence at a repository state at or after the fix commit confirms
-- it, and a contradiction resolution retains the evidence that justified it.

CREATE TABLE IF NOT EXISTS finding_resolution_events (
    id                 INTEGER PRIMARY KEY,
    origin_key         TEXT UNIQUE, -- deterministic key for one-time legacy imports
    finding_id         TEXT NOT NULL REFERENCES findings(finding_id) ON DELETE CASCADE,
    resolution_state   TEXT NOT NULL CHECK (resolution_state IN (
                               'open','accepted','ruled-out',
                               'fixed-pending-verification','verified-fixed')),
    fix_location       TEXT,
    fix_sha            TEXT,
    evidence_id        INTEGER REFERENCES evidence(id) ON DELETE RESTRICT,
    rationale          TEXT NOT NULL,
    session_id         TEXT,
    recorded_at        TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (resolution_state NOT IN ('fixed-pending-verification','verified-fixed')
           OR (fix_location IS NOT NULL AND fix_sha IS NOT NULL)),
    CHECK (resolution_state != 'verified-fixed' OR evidence_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_finding_resolution_finding
    ON finding_resolution_events(finding_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_finding_resolution_evidence
    ON finding_resolution_events(evidence_id);

CREATE TRIGGER IF NOT EXISTS finding_verification_evidence_integrity
BEFORE INSERT ON finding_resolution_events
FOR EACH ROW
WHEN NEW.resolution_state = 'verified-fixed'
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM finding_evidence fe
         WHERE fe.finding_id = NEW.finding_id
           AND fe.evidence_id = NEW.evidence_id
           AND fe.role = 'fix-verification'
    ) THEN RAISE(ABORT, 'verified-fixed evidence must be attached as fix-verification') END;
END;

-- Existing `fixed` rows predate proof-of-repair.  Preserve them explicitly as
-- pending instead of fabricating verification or silently treating them as
-- open.  Rows without a fix location receive an honest legacy placeholder;
-- they still cannot become verified without a new tool-mediated event.
INSERT OR IGNORE INTO finding_resolution_events
    (origin_key, finding_id, resolution_state, fix_location, fix_sha,
     rationale, session_id, recorded_at)
SELECT 'legacy-fixed:' || finding_id,
       finding_id,
       'fixed-pending-verification',
       COALESCE(fix_location, 'legacy:location-not-recorded'),
       COALESCE(ref_sha, 'legacy:sha-not-recorded'),
       'Imported legacy fixed label; verification was not recorded.',
       session_id,
       updated_at
  FROM findings
 WHERE status = 'fixed';

CREATE VIEW IF NOT EXISTS finding_resolution_current AS
SELECT e.*
  FROM finding_resolution_events e
 WHERE e.id = (
    SELECT e2.id
      FROM finding_resolution_events e2
     WHERE e2.finding_id = e.finding_id
     ORDER BY e2.id DESC
     LIMIT 1
 );

CREATE TABLE IF NOT EXISTS contradiction_resolution_events (
    id              INTEGER PRIMARY KEY,
    contradiction_id INTEGER NOT NULL REFERENCES contradictions(id) ON DELETE CASCADE,
    resolution      TEXT NOT NULL CHECK (resolution IN (
                           'a-supersedes-b','b-supersedes-a',
                           'scope-distinction','unresolved')),
    scope_note      TEXT,
    evidence_id     INTEGER REFERENCES evidence(id) ON DELETE RESTRICT,
    rationale       TEXT NOT NULL,
    session_id      TEXT,
    recorded_at     TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (resolution = 'unresolved' OR evidence_id IS NOT NULL),
    CHECK (resolution != 'scope-distinction' OR scope_note IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_contradiction_resolution_contradiction
    ON contradiction_resolution_events(contradiction_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_contradiction_resolution_evidence
    ON contradiction_resolution_events(evidence_id);

CREATE TRIGGER IF NOT EXISTS contradiction_resolution_evidence_integrity
BEFORE INSERT ON contradiction_resolution_events
FOR EACH ROW
WHEN NEW.resolution != 'unresolved'
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
          FROM contradictions c
          JOIN finding_evidence fe
            ON fe.finding_id IN (c.finding_a, c.finding_b)
         WHERE c.id = NEW.contradiction_id
           AND fe.evidence_id = NEW.evidence_id
    ) THEN RAISE(ABORT, 'contradiction resolution evidence must be attached to a party') END;
END;

----------------------------------------------------------------------
-- PROJECTION VERIFICATION: derived output may fail; durable truth may not bend
----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS projection_verification_runs (
    run_id          TEXT PRIMARY KEY,
    output_dir      TEXT NOT NULL,
    mode            TEXT NOT NULL CHECK (mode IN ('readback','clean-publish')),
    source_sha      TEXT,
    state_ok        INTEGER NOT NULL CHECK (state_ok IN (0,1)),
    coverage_ok     INTEGER NOT NULL CHECK (coverage_ok IN (0,1)),
    content_ok      INTEGER NOT NULL CHECK (content_ok IN (0,1)),
    ok              INTEGER NOT NULL CHECK (ok IN (0,1)),
    summary_json    TEXT NOT NULL,
    session_id      TEXT,
    verified_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projection_mismatches (
    id              INTEGER PRIMARY KEY,
    run_id          TEXT NOT NULL REFERENCES projection_verification_runs(run_id) ON DELETE CASCADE,
    axis            TEXT NOT NULL CHECK (axis IN ('state','coverage','content')),
    object_type     TEXT NOT NULL,
    object_id       TEXT NOT NULL,
    detail          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projection_mismatch_run
    ON projection_mismatches(run_id, axis);

----------------------------------------------------------------------
-- TEMPORAL CLAIMS: typed authority at repository states
----------------------------------------------------------------------
-- Claims are immutable versions in a named semantic slot (`claim_key`).
-- `valid_until_sha` is an exclusive Git boundary: a claim invalidated at B
-- is not authoritative at B. Commit ancestry, rather than SHA text or wall
-- clock order, is evaluated by the claims tool against the target workspace.
--
-- Exactly one open-ended version may occupy a claim_key. Supersession closes
-- the predecessor and opens the successor at the same commit, while the edge
-- and validity events retain why the transition happened.

CREATE TABLE IF NOT EXISTS claims (
    claim_id          TEXT    PRIMARY KEY,
    claim_key         TEXT    NOT NULL,
    subject_type      TEXT    NOT NULL,
    subject_id        TEXT    NOT NULL,
    statement         TEXT    NOT NULL,
    epistemic_kind    TEXT    NOT NULL CHECK (epistemic_kind IN (
                                'observation','inference','hypothesis',
                                'open-question','direct-intent',
                                'inferred-intent','decision')),
    asserted_at_sha   TEXT    NOT NULL,
    valid_from_sha    TEXT    NOT NULL,
    valid_until_sha   TEXT,
    session_id        TEXT    NOT NULL REFERENCES sessions(session_id),
    created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    CHECK (length(claim_id) > 0),
    CHECK (length(claim_key) > 0),
    CHECK (length(subject_type) > 0),
    CHECK (length(subject_id) > 0),
    CHECK (length(statement) > 0),
    CHECK (valid_until_sha IS NULL OR valid_until_sha != valid_from_sha)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_current_key
    ON claims(claim_key) WHERE valid_until_sha IS NULL;
CREATE INDEX IF NOT EXISTS idx_claims_subject ON claims(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_claims_epistemic_kind ON claims(epistemic_kind);
CREATE INDEX IF NOT EXISTS idx_claims_validity ON claims(valid_from_sha, valid_until_sha);

CREATE TABLE IF NOT EXISTS claim_evidence (
    claim_id          TEXT    NOT NULL REFERENCES claims(claim_id) ON DELETE CASCADE,
    evidence_id       INTEGER NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
    role              TEXT    NOT NULL CHECK (role IN ('supports','contradicts','qualifies')),
    PRIMARY KEY (claim_id, evidence_id)
);

CREATE INDEX IF NOT EXISTS idx_claim_evidence_evidence ON claim_evidence(evidence_id);

CREATE TABLE IF NOT EXISTS claim_validity_events (
    id                INTEGER PRIMARY KEY,
    claim_id          TEXT    NOT NULL REFERENCES claims(claim_id) ON DELETE CASCADE,
    event_type        TEXT    NOT NULL CHECK (event_type IN (
                                'asserted','invalidated','superseded','revalidated')),
    at_sha            TEXT    NOT NULL,
    reason            TEXT    NOT NULL,
    evidence_id       INTEGER NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
    session_id        TEXT    NOT NULL REFERENCES sessions(session_id),
    created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_claim_validity_events_claim
    ON claim_validity_events(claim_id, id);
CREATE INDEX IF NOT EXISTS idx_claim_validity_events_sha ON claim_validity_events(at_sha);

CREATE TABLE IF NOT EXISTS claim_supersessions (
    predecessor_claim_id TEXT PRIMARY KEY REFERENCES claims(claim_id) ON DELETE RESTRICT,
    successor_claim_id   TEXT NOT NULL UNIQUE REFERENCES claims(claim_id) ON DELETE RESTRICT,
    at_sha               TEXT NOT NULL,
    evidence_id          INTEGER NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
    rationale            TEXT NOT NULL,
    session_id           TEXT NOT NULL REFERENCES sessions(session_id),
    created_at           TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (predecessor_claim_id != successor_claim_id)
);

-- Claim versions do not change meaning in place. The only legal mutation is
-- setting the exclusive end of a previously current interval exactly once.
CREATE TRIGGER IF NOT EXISTS claims_versions_are_immutable
BEFORE UPDATE ON claims
FOR EACH ROW
WHEN (
    OLD.claim_key != NEW.claim_key
    OR OLD.subject_type != NEW.subject_type
    OR OLD.subject_id != NEW.subject_id
    OR OLD.statement != NEW.statement
    OR OLD.epistemic_kind != NEW.epistemic_kind
    OR OLD.asserted_at_sha != NEW.asserted_at_sha
    OR OLD.valid_from_sha != NEW.valid_from_sha
    OR OLD.session_id != NEW.session_id
    OR OLD.valid_until_sha IS NOT NULL
    OR NEW.valid_until_sha IS NULL
)
BEGIN
    SELECT RAISE(ABORT, 'claim versions are immutable; only a current validity interval may be closed');
END;

CREATE TRIGGER IF NOT EXISTS claim_supersession_integrity
BEFORE INSERT ON claim_supersessions
FOR EACH ROW
BEGIN
    SELECT CASE WHEN EXISTS (
        WITH RECURSIVE successors(claim_id) AS (
            SELECT NEW.successor_claim_id
            UNION ALL
            SELECT cs.successor_claim_id
              FROM claim_supersessions cs
              JOIN successors s ON cs.predecessor_claim_id = s.claim_id
        )
        SELECT 1 FROM successors WHERE claim_id = NEW.predecessor_claim_id
    ) THEN RAISE(ABORT, 'claim supersession cycle') END;
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
          FROM claims predecessor
          JOIN claims successor ON successor.claim_id = NEW.successor_claim_id
         WHERE predecessor.claim_id = NEW.predecessor_claim_id
           AND predecessor.claim_key = successor.claim_key
           AND predecessor.valid_until_sha = NEW.at_sha
           AND successor.valid_from_sha = NEW.at_sha
    ) THEN RAISE(ABORT, 'supersession must preserve claim_key and share one validity boundary') END;
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM claim_evidence
         WHERE claim_id = NEW.successor_claim_id
           AND evidence_id = NEW.evidence_id
           AND role = 'supports'
    ) THEN RAISE(ABORT, 'supersession evidence must support the successor claim') END;
END;

-- Existing rows remain untouched. This view is an explicitly lossy bridge:
-- it gives legacy knowledge stable typed handles without pretending the old
-- records had claim-level temporal precision they never carried.
CREATE VIEW IF NOT EXISTS legacy_claim_projection AS
SELECT 'legacy:entry:' || id || ':' || tier AS claim_id,
       'entry' AS subject_type,
       id || ':' || tier AS subject_id,
       'Legacy entry ' || id || ' tier ' || tier ||
         COALESCE(' from ' || source_path, '') AS statement,
       CASE WHEN confidence = 'inferred' THEN 'inference' ELSE 'observation' END
         AS epistemic_kind,
       ref_sha AS asserted_at_sha,
       source_path AS provenance,
       'entries' AS legacy_source
  FROM entries
UNION ALL
SELECT 'legacy:evidence:' || id,
       'evidence', CAST(id AS TEXT),
       kind || ' evidence at ' || file_path || COALESCE(':' || symbol, ''),
       'observation', ref_sha, file_path, 'evidence'
  FROM evidence
UNION ALL
SELECT 'legacy:disposition:' || subsystem_id || ':' || concern_code,
       'disposition', subsystem_id || ':' || concern_code,
       classification || COALESCE(': ' || rationale, ''),
       'inference', ref_sha, evidence, 'dispositions'
  FROM dispositions
UNION ALL
SELECT 'legacy:finding:' || finding_id || ':symptom',
       'finding', finding_id,
       symptom, 'observation', ref_sha, primary_files, 'findings'
  FROM findings
UNION ALL
SELECT 'legacy:finding:' || finding_id || ':root-cause',
       'finding', finding_id,
       root_cause, 'inference', ref_sha, primary_files, 'findings'
  FROM findings
UNION ALL
SELECT 'legacy:contradiction:' || id,
       'contradiction', CAST(id AS TEXT),
       conflict_type || ' between ' || finding_a || ' and ' || finding_b,
       'inference', NULL, shared_location, 'contradictions'
  FROM contradictions;

----------------------------------------------------------------------
-- CHANGE IMPACT: predicted diffs, explanation paths, and application
----------------------------------------------------------------------
-- Prediction and application are deliberately separate. A predicted run is
-- written before any fixture/expected-result comparison (GP36), and applying
-- it later closes claim intervals while preserving the original artifact.

CREATE TABLE IF NOT EXISTS change_impact_runs (
    run_id                    TEXT PRIMARY KEY,
    base_sha                  TEXT NOT NULL,
    head_sha                  TEXT NOT NULL,
    relation_discovery_mode   TEXT NOT NULL CHECK (relation_discovery_mode IN (
                                      'explicit-only','request-if-gap')),
    max_depth                 INTEGER NOT NULL CHECK (max_depth BETWEEN 0 AND 16),
    explicit_gap_count        INTEGER NOT NULL CHECK (explicit_gap_count >= 0),
    status                    TEXT NOT NULL DEFAULT 'predicted' CHECK (status IN (
                                      'predicted','applied','abandoned')),
    artifact_json             TEXT NOT NULL CHECK (json_valid(artifact_json)),
    session_id                TEXT NOT NULL REFERENCES sessions(session_id),
    created_at                TEXT NOT NULL DEFAULT (datetime('now')),
    applied_at                TEXT,
    CHECK (base_sha != head_sha)
);

CREATE INDEX IF NOT EXISTS idx_change_impact_runs_range
    ON change_impact_runs(base_sha, head_sha);
CREATE INDEX IF NOT EXISTS idx_change_impact_runs_status
    ON change_impact_runs(status);

CREATE TABLE IF NOT EXISTS change_impact_files (
    run_id          TEXT NOT NULL REFERENCES change_impact_runs(run_id) ON DELETE CASCADE,
    ordinal         INTEGER NOT NULL,
    change_type     TEXT NOT NULL CHECK (change_type IN (
                              'added','deleted','modified','renamed','copied','type-changed',
                              'unmerged','unknown')),
    path_before     TEXT,
    path_after      TEXT,
    similarity      INTEGER CHECK (similarity IS NULL OR similarity BETWEEN 0 AND 100),
    PRIMARY KEY (run_id, ordinal),
    CHECK (path_before IS NOT NULL OR path_after IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS change_impact_objects (
    run_id          TEXT NOT NULL REFERENCES change_impact_runs(run_id) ON DELETE CASCADE,
    object_type     TEXT NOT NULL CHECK (object_type IN (
                              'changed-file','subsystem','seam','finding','obligation',
                              'claim','control','gap')),
    object_id       TEXT NOT NULL,
    impact_kind     TEXT NOT NULL CHECK (impact_kind IN (
                              'direct','transitive','unaffected','gap')),
    invalidates     INTEGER NOT NULL DEFAULT 0 CHECK (invalidates IN (0,1)),
    reason_path     TEXT NOT NULL CHECK (json_valid(reason_path)),
    PRIMARY KEY (run_id, object_type, object_id)
);

CREATE INDEX IF NOT EXISTS idx_change_impact_objects_lookup
    ON change_impact_objects(object_type, object_id, run_id);

CREATE TABLE IF NOT EXISTS change_impact_relations (
    run_id          TEXT NOT NULL REFERENCES change_impact_runs(run_id) ON DELETE CASCADE,
    ordinal         INTEGER NOT NULL,
    relation_class  TEXT NOT NULL CHECK (relation_class IN ('xref','seam')),
    relation_id     TEXT NOT NULL,
    from_id         TEXT NOT NULL,
    to_id           TEXT NOT NULL,
    PRIMARY KEY (run_id, ordinal)
);

CREATE TABLE IF NOT EXISTS change_impact_invalidations (
    run_id          TEXT NOT NULL REFERENCES change_impact_runs(run_id) ON DELETE CASCADE,
    claim_id        TEXT NOT NULL REFERENCES claims(claim_id) ON DELETE RESTRICT,
    state           TEXT NOT NULL DEFAULT 'predicted' CHECK (state IN (
                              'predicted','applied','skipped')),
    reason_path     TEXT NOT NULL CHECK (json_valid(reason_path)),
    evidence_id     INTEGER REFERENCES evidence(id) ON DELETE RESTRICT,
    applied_at      TEXT,
    PRIMARY KEY (run_id, claim_id)
);

CREATE INDEX IF NOT EXISTS idx_change_impact_invalidations_claim
    ON change_impact_invalidations(claim_id, state);

----------------------------------------------------------------------
-- REVALIDATION OBLIGATIONS: custody from invalidation to scored landing
----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS revalidation_obligations (
    obligation_id          TEXT PRIMARY KEY,
    trigger_type           TEXT NOT NULL CHECK (trigger_type IN (
                                  'claim-invalidation','explicit-gap','manual','decision-impact')),
    trigger_id             TEXT NOT NULL,
    destination_type       TEXT NOT NULL CHECK (destination_type IN (
                                  'claim','finding','subsystem','seam','artifact','decision')),
    destination_id         TEXT NOT NULL,
    source_impact_run_id   TEXT REFERENCES change_impact_runs(run_id) ON DELETE RESTRICT,
    owner                   TEXT NOT NULL CHECK (length(owner) > 0),
    state                   TEXT NOT NULL DEFAULT 'ready' CHECK (state IN (
                                  'open','ready','dispatched','landed','scored','closed',
                                  'blocked','dead-letter','deferred')),
    blocking                INTEGER NOT NULL DEFAULT 1 CHECK (blocking IN (0,1)),
    priority                INTEGER NOT NULL DEFAULT 1 CHECK (priority BETWEEN 0 AND 4),
    resolution_evidence_id INTEGER REFERENCES evidence(id) ON DELETE RESTRICT,
    resolution_note         TEXT,
    created_at              TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at               TEXT,
    UNIQUE (trigger_type, trigger_id, destination_type, destination_id),
    CHECK (state != 'closed' OR resolution_evidence_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_revalidation_obligations_state
    ON revalidation_obligations(state, blocking, priority);
CREATE INDEX IF NOT EXISTS idx_revalidation_obligations_impact
    ON revalidation_obligations(source_impact_run_id, state);

CREATE TABLE IF NOT EXISTS revalidation_runs (
    run_id                       TEXT PRIMARY KEY,
    source_impact_run_id         TEXT NOT NULL REFERENCES change_impact_runs(run_id) ON DELETE RESTRICT,
    status                       TEXT NOT NULL DEFAULT 'planned' CHECK (status IN (
                                       'planned','running','reconciling','complete','failed')),
    allowed_sources              TEXT NOT NULL CHECK (json_valid(allowed_sources)),
    provider_allowlist           TEXT NOT NULL CHECK (json_valid(provider_allowlist)),
    allowed_write_prefixes       TEXT NOT NULL CHECK (json_valid(allowed_write_prefixes)),
    authority_mode               TEXT NOT NULL CHECK (authority_mode IN (
                                       'observe-only','conspectus-write','branch-write')),
    max_concurrency              INTEGER NOT NULL CHECK (max_concurrency > 0),
    max_attempts_per_obligation  INTEGER NOT NULL CHECK (max_attempts_per_obligation > 0),
    max_tokens_per_attempt       INTEGER NOT NULL CHECK (max_tokens_per_attempt > 0),
    max_total_tokens             INTEGER NOT NULL CHECK (max_total_tokens > 0),
    max_total_cost_microusd      INTEGER NOT NULL CHECK (max_total_cost_microusd >= 0),
    expected_obligation_count    INTEGER NOT NULL CHECK (expected_obligation_count > 0),
    session_id                   TEXT NOT NULL REFERENCES sessions(session_id),
    created_at                   TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at                 TEXT
);

CREATE INDEX IF NOT EXISTS idx_revalidation_runs_status
    ON revalidation_runs(status, created_at);

CREATE TABLE IF NOT EXISTS revalidation_run_obligations (
    run_id          TEXT NOT NULL REFERENCES revalidation_runs(run_id) ON DELETE CASCADE,
    obligation_id  TEXT NOT NULL REFERENCES revalidation_obligations(obligation_id) ON DELETE RESTRICT,
    ordinal         INTEGER NOT NULL CHECK (ordinal >= 0),
    work_packet     TEXT NOT NULL CHECK (json_valid(work_packet)),
    PRIMARY KEY (run_id, obligation_id),
    UNIQUE (run_id, ordinal)
);

CREATE TABLE IF NOT EXISTS revalidation_attempts (
    attempt_id             TEXT PRIMARY KEY,
    run_id                 TEXT NOT NULL REFERENCES revalidation_runs(run_id) ON DELETE RESTRICT,
    obligation_id          TEXT NOT NULL REFERENCES revalidation_obligations(obligation_id) ON DELETE RESTRICT,
    replicate_id           TEXT NOT NULL,
    attempt_number         INTEGER NOT NULL CHECK (attempt_number > 0),
    worker_id              TEXT NOT NULL,
    provider               TEXT NOT NULL,
    model                  TEXT NOT NULL,
    status                 TEXT NOT NULL DEFAULT 'dispatched' CHECK (status IN (
                                   'dispatched','landed','scored','failed','timed-out')),
    planned_tokens         INTEGER NOT NULL CHECK (planned_tokens > 0),
    planned_cost_microusd  INTEGER NOT NULL CHECK (planned_cost_microusd >= 0),
    actual_tokens          INTEGER CHECK (actual_tokens IS NULL OR actual_tokens >= 0),
    actual_cost_microusd   INTEGER CHECK (actual_cost_microusd IS NULL OR actual_cost_microusd >= 0),
    result_json            TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
    artifacts_written      TEXT CHECK (artifacts_written IS NULL OR json_valid(artifacts_written)),
    consulted_sources      TEXT CHECK (consulted_sources IS NULL OR json_valid(consulted_sources)),
    score_json             TEXT CHECK (score_json IS NULL OR json_valid(score_json)),
    budget_violation       INTEGER NOT NULL DEFAULT 0 CHECK (budget_violation IN (0,1)),
    boundary_violation     INTEGER NOT NULL DEFAULT 0 CHECK (boundary_violation IN (0,1)),
    dispatched_at          TEXT NOT NULL DEFAULT (datetime('now')),
    landed_at              TEXT,
    scored_at              TEXT,
    UNIQUE (run_id, obligation_id, replicate_id, attempt_number),
    FOREIGN KEY (run_id, obligation_id)
        REFERENCES revalidation_run_obligations(run_id, obligation_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_revalidation_attempts_run
    ON revalidation_attempts(run_id, status, obligation_id);

CREATE TABLE IF NOT EXISTS revalidation_attempt_events (
    id              INTEGER PRIMARY KEY,
    attempt_id      TEXT NOT NULL REFERENCES revalidation_attempts(attempt_id) ON DELETE RESTRICT,
    event_type      TEXT NOT NULL CHECK (event_type IN (
                              'dispatched','landed','scored','failed','timed-out')),
    detail_json     TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json)),
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_revalidation_attempt_events_attempt
    ON revalidation_attempt_events(attempt_id, id);

CREATE TABLE IF NOT EXISTS revalidation_protocol_violations (
    id              INTEGER PRIMARY KEY,
    run_id          TEXT NOT NULL REFERENCES revalidation_runs(run_id) ON DELETE RESTRICT,
    obligation_id  TEXT REFERENCES revalidation_obligations(obligation_id) ON DELETE RESTRICT,
    attempt_id      TEXT,
    violation_type TEXT NOT NULL CHECK (violation_type IN (
                              'duplicate-landing','duplicate-score','unknown-attempt',
                              'source-boundary','authority-boundary','budget-overrun')),
    detail_json     TEXT NOT NULL CHECK (json_valid(detail_json)),
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_revalidation_protocol_violations_run
    ON revalidation_protocol_violations(run_id, violation_type);

CREATE TRIGGER IF NOT EXISTS impact_application_creates_obligation
AFTER UPDATE OF state ON change_impact_invalidations
FOR EACH ROW
WHEN NEW.state = 'applied' AND OLD.state != 'applied'
BEGIN
    INSERT OR IGNORE INTO revalidation_obligations
      (obligation_id, trigger_type, trigger_id, destination_type, destination_id,
       source_impact_run_id, owner, state, blocking, priority)
    VALUES
      ('impact:' || NEW.run_id || ':claim:' || NEW.claim_id,
       'claim-invalidation', NEW.run_id || ':claim:' || NEW.claim_id,
       'claim', NEW.claim_id, NEW.run_id,
       'amanuensis:revalidation', 'ready', 1, 1);
END;

-- VP24 historical sweep: the trigger governs future transitions; this insert
-- covers applied invalidations that existed before the trigger was installed.
INSERT OR IGNORE INTO revalidation_obligations
  (obligation_id, trigger_type, trigger_id, destination_type, destination_id,
   source_impact_run_id, owner, state, blocking, priority)
SELECT 'impact:' || i.run_id || ':claim:' || i.claim_id,
       'claim-invalidation', i.run_id || ':claim:' || i.claim_id,
       'claim', i.claim_id, i.run_id,
       'amanuensis:revalidation', 'ready', 1, 1
  FROM change_impact_invalidations i
 WHERE i.state = 'applied';

CREATE TRIGGER IF NOT EXISTS revalidation_attempt_identity_is_immutable
BEFORE UPDATE ON revalidation_attempts
FOR EACH ROW
WHEN OLD.attempt_id != NEW.attempt_id
  OR OLD.run_id != NEW.run_id
  OR OLD.obligation_id != NEW.obligation_id
  OR OLD.replicate_id != NEW.replicate_id
  OR OLD.attempt_number != NEW.attempt_number
  OR OLD.worker_id != NEW.worker_id
  OR OLD.provider != NEW.provider
  OR OLD.model != NEW.model
  OR OLD.planned_tokens != NEW.planned_tokens
  OR OLD.planned_cost_microusd != NEW.planned_cost_microusd
BEGIN
    SELECT RAISE(ABORT, 'revalidation attempt identity and plan are immutable');
END;

CREATE TRIGGER IF NOT EXISTS revalidation_obligation_terminal_is_immutable
BEFORE UPDATE OF state ON revalidation_obligations
FOR EACH ROW
WHEN OLD.state IN ('closed','dead-letter') AND NEW.state != OLD.state
BEGIN
    SELECT RAISE(ABORT, 'terminal revalidation obligation cannot be reopened in place');
END;

CREATE TRIGGER IF NOT EXISTS revalidation_attempt_status_is_monotonic
BEFORE UPDATE OF status ON revalidation_attempts
FOR EACH ROW
WHEN NOT (
    (OLD.status = 'dispatched' AND NEW.status IN ('landed','failed','timed-out'))
    OR (OLD.status = 'landed' AND NEW.status = 'scored')
)
BEGIN
    SELECT RAISE(ABORT, 'invalid revalidation attempt status transition');
END;

CREATE TRIGGER IF NOT EXISTS revalidation_attempt_dispatched_event
AFTER INSERT ON revalidation_attempts
FOR EACH ROW
BEGIN
    INSERT INTO revalidation_attempt_events (attempt_id, event_type, detail_json)
    VALUES (NEW.attempt_id, 'dispatched', json_object(
      'run_id', NEW.run_id, 'obligation_id', NEW.obligation_id,
      'replicate_id', NEW.replicate_id, 'attempt_number', NEW.attempt_number));
END;

CREATE TRIGGER IF NOT EXISTS revalidation_attempt_transition_event
AFTER UPDATE OF status ON revalidation_attempts
FOR EACH ROW
BEGIN
    INSERT INTO revalidation_attempt_events (attempt_id, event_type, detail_json)
    VALUES (NEW.attempt_id, NEW.status, json_object('from', OLD.status, 'to', NEW.status));
END;

CREATE VIEW IF NOT EXISTS revalidation_dashboard AS
SELECT
  (SELECT COUNT(*) FROM revalidation_obligations WHERE state NOT IN ('closed','dead-letter')) AS open,
  (SELECT COUNT(*) FROM revalidation_obligations WHERE state = 'blocked') AS blocked,
  (SELECT COUNT(*) FROM revalidation_obligations WHERE state = 'deferred') AS deferred,
  (SELECT COUNT(*) FROM revalidation_obligations WHERE state = 'dead-letter') AS dead_letter,
  (SELECT COUNT(*) FROM revalidation_obligations o
    WHERE o.destination_type = 'claim'
      AND NOT EXISTS (SELECT 1 FROM claims c WHERE c.claim_id = o.destination_id)) AS orphaned,
  (SELECT COUNT(*) FROM (
     SELECT obligation_id FROM revalidation_attempts
      GROUP BY obligation_id HAVING COUNT(*) > 1
   )) AS retried,
  (SELECT COUNT(*) FROM revalidation_runs WHERE status = 'running') AS active_runs,
  (SELECT COUNT(*) FROM revalidation_protocol_violations) AS protocol_violations;

----------------------------------------------------------------------
-- UNATTENDED REFRESH: resumable composition and authority envelope
----------------------------------------------------------------------
-- A refresh run is a durable coordinator over impact, revalidation, and
-- projection verification.  The manifest is immutable; only custody state and
-- child-run pointers advance.  Deterministic child/attempt identifiers let a
-- resume adopt a side effect that landed immediately before a process crash.

CREATE TABLE IF NOT EXISTS refresh_runs (
    run_id                      TEXT PRIMARY KEY,
    replicate_id                TEXT NOT NULL,
    status                      TEXT NOT NULL CHECK (status IN (
                                    'planned','impact-predicted','impact-applied',
                                    'revalidation-planned','executing','verifying',
                                    'blocked','completed','cancelled','failed')),
    base_sha                    TEXT NOT NULL,
    head_sha                    TEXT NOT NULL,
    allowed_sources             TEXT NOT NULL CHECK (json_valid(allowed_sources)),
    provider_allowlist          TEXT NOT NULL CHECK (json_valid(provider_allowlist)),
    selected_provider           TEXT NOT NULL,
    model                       TEXT NOT NULL,
    runtime                     TEXT NOT NULL,
    determinism_mode            TEXT NOT NULL CHECK (determinism_mode IN (
                                    'provider-default','seeded','local-deterministic')),
    determinism_seed            INTEGER,
    runtime_input_json          TEXT NOT NULL CHECK (json_valid(runtime_input_json)),
    relation_discovery_mode     TEXT NOT NULL CHECK (relation_discovery_mode IN (
                                    'explicit-only','request-if-gap')),
    max_relation_depth          INTEGER NOT NULL CHECK (max_relation_depth BETWEEN 0 AND 16),
    authority_mode              TEXT NOT NULL CHECK (authority_mode IN (
                                    'observe-only','conspectus-write','branch-write')),
    allowed_write_prefixes      TEXT NOT NULL CHECK (json_valid(allowed_write_prefixes)),
    allowed_side_effects        TEXT NOT NULL CHECK (json_valid(allowed_side_effects)),
    decision_policy             TEXT NOT NULL DEFAULT 'human-only'
                                    CHECK (decision_policy = 'human-only'),
    auto_dispatch               INTEGER NOT NULL CHECK (auto_dispatch IN (0,1)),
    max_concurrency             INTEGER NOT NULL CHECK (max_concurrency > 0),
    max_attempts_per_obligation INTEGER NOT NULL CHECK (max_attempts_per_obligation > 0),
    max_tokens_per_attempt      INTEGER NOT NULL CHECK (max_tokens_per_attempt > 0),
    max_total_tokens            INTEGER NOT NULL CHECK (max_total_tokens > 0),
    max_total_cost_microusd     INTEGER NOT NULL CHECK (max_total_cost_microusd >= 0),
    planned_tokens_per_attempt  INTEGER NOT NULL CHECK (planned_tokens_per_attempt > 0),
    planned_cost_microusd       INTEGER NOT NULL CHECK (planned_cost_microusd >= 0),
    output_dir                  TEXT NOT NULL,
    manifest_json               TEXT NOT NULL CHECK (json_valid(manifest_json)),
    manifest_hash               TEXT NOT NULL,
    impact_run_id               TEXT NOT NULL UNIQUE,
    revalidation_run_id         TEXT UNIQUE,
    projection_run_id           TEXT UNIQUE REFERENCES projection_verification_runs(run_id),
    blocking_reasons_json       TEXT NOT NULL DEFAULT '[]'
                                    CHECK (json_valid(blocking_reasons_json)),
    session_id                  TEXT NOT NULL REFERENCES sessions(session_id),
    error                       TEXT,
    created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                  TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at                TEXT,
    cancelled_at                TEXT,
    CHECK (base_sha != head_sha),
    CHECK ((determinism_mode = 'seeded' AND determinism_seed IS NOT NULL)
           OR (determinism_mode != 'seeded' AND determinism_seed IS NULL)),
    CHECK (status != 'completed' OR projection_run_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_refresh_runs_status
    ON refresh_runs(status, created_at DESC);

CREATE TABLE IF NOT EXISTS refresh_stage_events (
    id                INTEGER PRIMARY KEY,
    run_id            TEXT NOT NULL REFERENCES refresh_runs(run_id) ON DELETE CASCADE,
    stage             TEXT NOT NULL CHECK (stage IN (
                              'plan','impact-predict','impact-apply',
                              'revalidation-plan','dispatch','reconcile',
                              'readback','complete','cancel')),
    event_type        TEXT NOT NULL CHECK (event_type IN (
                              'completed','adopted','blocked','failed','cancelled')),
    idempotency_key   TEXT NOT NULL,
    detail_json       TEXT NOT NULL CHECK (json_valid(detail_json)),
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (run_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_refresh_stage_events_run
    ON refresh_stage_events(run_id, id);

CREATE TABLE IF NOT EXISTS refresh_dispatches (
    run_id            TEXT NOT NULL REFERENCES refresh_runs(run_id) ON DELETE CASCADE,
    obligation_id     TEXT NOT NULL REFERENCES revalidation_obligations(obligation_id) ON DELETE RESTRICT,
    attempt_id        TEXT NOT NULL UNIQUE REFERENCES revalidation_attempts(attempt_id) ON DELETE RESTRICT,
    runtime_route     TEXT NOT NULL,
    runtime_input_json TEXT NOT NULL CHECK (json_valid(runtime_input_json)),
    status            TEXT NOT NULL DEFAULT 'dispatched' CHECK (status IN (
                              'dispatched','landed','scored','failed','timed-out')),
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (run_id, attempt_id)
);

CREATE INDEX IF NOT EXISTS idx_refresh_dispatches_obligation
    ON refresh_dispatches(run_id, obligation_id, created_at);

CREATE TRIGGER IF NOT EXISTS refresh_manifest_is_immutable
BEFORE UPDATE ON refresh_runs
FOR EACH ROW
WHEN OLD.replicate_id != NEW.replicate_id
  OR OLD.base_sha != NEW.base_sha
  OR OLD.head_sha != NEW.head_sha
  OR OLD.allowed_sources != NEW.allowed_sources
  OR OLD.provider_allowlist != NEW.provider_allowlist
  OR OLD.selected_provider != NEW.selected_provider
  OR OLD.model != NEW.model
  OR OLD.runtime != NEW.runtime
  OR OLD.determinism_mode != NEW.determinism_mode
  OR COALESCE(OLD.determinism_seed, -1) != COALESCE(NEW.determinism_seed, -1)
  OR OLD.runtime_input_json != NEW.runtime_input_json
  OR OLD.relation_discovery_mode != NEW.relation_discovery_mode
  OR OLD.max_relation_depth != NEW.max_relation_depth
  OR OLD.authority_mode != NEW.authority_mode
  OR OLD.allowed_write_prefixes != NEW.allowed_write_prefixes
  OR OLD.allowed_side_effects != NEW.allowed_side_effects
  OR OLD.decision_policy != NEW.decision_policy
  OR OLD.auto_dispatch != NEW.auto_dispatch
  OR OLD.max_concurrency != NEW.max_concurrency
  OR OLD.max_attempts_per_obligation != NEW.max_attempts_per_obligation
  OR OLD.max_tokens_per_attempt != NEW.max_tokens_per_attempt
  OR OLD.max_total_tokens != NEW.max_total_tokens
  OR OLD.max_total_cost_microusd != NEW.max_total_cost_microusd
  OR OLD.planned_tokens_per_attempt != NEW.planned_tokens_per_attempt
  OR OLD.planned_cost_microusd != NEW.planned_cost_microusd
  OR OLD.output_dir != NEW.output_dir
  OR OLD.manifest_json != NEW.manifest_json
  OR OLD.manifest_hash != NEW.manifest_hash
  OR OLD.impact_run_id != NEW.impact_run_id
  OR OLD.session_id != NEW.session_id
BEGIN
    SELECT RAISE(ABORT, 'refresh execution manifest is immutable');
END;

CREATE TRIGGER IF NOT EXISTS refresh_terminal_state_is_immutable
BEFORE UPDATE OF status ON refresh_runs
FOR EACH ROW
WHEN OLD.status IN ('completed','cancelled','failed') AND NEW.status != OLD.status
BEGIN
    SELECT RAISE(ABORT, 'terminal refresh run cannot be resumed in place');
END;

----------------------------------------------------------------------
-- REVIEW BRIEFS: impact-shaped context with reversible provenance
----------------------------------------------------------------------
-- The compact brief is derived from one durable A2 impact artifact.  The
-- trace owns every inclusion, omission, truncation, and blocking reason;
-- source_json is the expansion path back to typed claims and evidence.

CREATE TABLE IF NOT EXISTS review_briefs (
    brief_id                         TEXT PRIMARY KEY,
    impact_run_id                    TEXT NOT NULL REFERENCES change_impact_runs(run_id) ON DELETE RESTRICT,
    context_profile                  TEXT NOT NULL CHECK (context_profile IN (
                                           'diff-scoped','control-wide','integral-head')),
    task                             TEXT NOT NULL,
    task_constraints                 TEXT NOT NULL CHECK (json_valid(task_constraints)),
    reviewed_sha                     TEXT NOT NULL,
    token_budget                     INTEGER NOT NULL CHECK (token_budget > 0),
    estimated_tokens                 INTEGER NOT NULL CHECK (estimated_tokens >= 0),
    control_score                    REAL NOT NULL CHECK (control_score BETWEEN 0.0 AND 1.0),
    required_section_count           INTEGER NOT NULL CHECK (required_section_count >= 0),
    included_required_section_count  INTEGER NOT NULL CHECK (included_required_section_count >= 0),
    uncovered_file_count             INTEGER NOT NULL CHECK (uncovered_file_count >= 0),
    omitted_section_count            INTEGER NOT NULL CHECK (omitted_section_count >= 0),
    truncated_item_count             INTEGER NOT NULL CHECK (truncated_item_count >= 0),
    status                           TEXT NOT NULL CHECK (status IN (
                                           'publishable','blocked','published')),
    brief_json                       TEXT NOT NULL CHECK (json_valid(brief_json)),
    brief_hash                       TEXT NOT NULL,
    session_id                       TEXT NOT NULL REFERENCES sessions(session_id),
    created_at                       TEXT NOT NULL DEFAULT (datetime('now')),
    published_at                     TEXT,
    CHECK (included_required_section_count <= required_section_count),
    CHECK (status != 'published' OR published_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_review_briefs_impact
    ON review_briefs(impact_run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_briefs_status
    ON review_briefs(status, created_at DESC);

CREATE TABLE IF NOT EXISTS review_brief_trace (
    trace_id          TEXT PRIMARY KEY,
    brief_id          TEXT NOT NULL REFERENCES review_briefs(brief_id) ON DELETE CASCADE,
    ordinal           INTEGER NOT NULL CHECK (ordinal >= 0),
    section           TEXT NOT NULL,
    action            TEXT NOT NULL CHECK (action IN (
                              'included','omitted','truncated','blocked')),
    object_type       TEXT NOT NULL,
    object_id         TEXT NOT NULL,
    reason            TEXT NOT NULL,
    provenance_json   TEXT NOT NULL CHECK (json_valid(provenance_json)),
    source_json       TEXT NOT NULL CHECK (json_valid(source_json)),
    estimated_tokens  INTEGER NOT NULL CHECK (estimated_tokens >= 0),
    obligation_id     TEXT REFERENCES revalidation_obligations(obligation_id) ON DELETE RESTRICT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (brief_id, ordinal),
    UNIQUE (brief_id, section, object_type, object_id)
);

CREATE INDEX IF NOT EXISTS idx_review_brief_trace_brief
    ON review_brief_trace(brief_id, action, section, ordinal);

CREATE TABLE IF NOT EXISTS review_brief_publications (
    publication_id     INTEGER PRIMARY KEY,
    brief_id           TEXT NOT NULL UNIQUE REFERENCES review_briefs(brief_id) ON DELETE RESTRICT,
    brief_hash         TEXT NOT NULL,
    reviewed_sha       TEXT NOT NULL,
    control_score      REAL NOT NULL CHECK (control_score BETWEEN 0.0 AND 1.0),
    included_trace_count INTEGER NOT NULL CHECK (included_trace_count >= 0),
    seam_count         INTEGER NOT NULL CHECK (seam_count >= 0),
    session_id         TEXT NOT NULL REFERENCES sessions(session_id),
    published_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE VIEW IF NOT EXISTS review_brief_summary AS
SELECT b.brief_id, b.impact_run_id, b.context_profile, b.reviewed_sha,
       b.token_budget, b.estimated_tokens, b.control_score, b.status,
       b.uncovered_file_count, b.omitted_section_count, b.truncated_item_count,
       COUNT(t.trace_id) AS trace_count,
       COUNT(t.trace_id) FILTER (WHERE t.action='included') AS included_count,
       COUNT(t.trace_id) FILTER (WHERE t.action IN ('blocked','truncated')) AS red_count
  FROM review_briefs b
  LEFT JOIN review_brief_trace t ON t.brief_id=b.brief_id
 GROUP BY b.brief_id;

CREATE TRIGGER IF NOT EXISTS review_brief_payload_is_immutable
BEFORE UPDATE ON review_briefs
FOR EACH ROW
WHEN OLD.brief_id != NEW.brief_id
  OR OLD.impact_run_id != NEW.impact_run_id
  OR OLD.context_profile != NEW.context_profile
  OR OLD.task != NEW.task
  OR OLD.task_constraints != NEW.task_constraints
  OR OLD.reviewed_sha != NEW.reviewed_sha
  OR OLD.token_budget != NEW.token_budget
  OR OLD.estimated_tokens != NEW.estimated_tokens
  OR OLD.control_score != NEW.control_score
  OR OLD.required_section_count != NEW.required_section_count
  OR OLD.included_required_section_count != NEW.included_required_section_count
  OR OLD.uncovered_file_count != NEW.uncovered_file_count
  OR OLD.omitted_section_count != NEW.omitted_section_count
  OR OLD.truncated_item_count != NEW.truncated_item_count
  OR OLD.brief_json != NEW.brief_json
  OR OLD.brief_hash != NEW.brief_hash
  OR OLD.session_id != NEW.session_id
BEGIN
    SELECT RAISE(ABORT, 'review brief payload is immutable');
END;

CREATE TRIGGER IF NOT EXISTS review_brief_status_is_monotonic
BEFORE UPDATE OF status ON review_briefs
FOR EACH ROW
WHEN NOT (
    OLD.status='publishable' AND NEW.status='published'
    AND EXISTS (
        SELECT 1 FROM review_brief_publications p
         WHERE p.brief_id=OLD.brief_id
           AND p.brief_hash=OLD.brief_hash
           AND p.reviewed_sha=OLD.reviewed_sha
           AND p.control_score=OLD.control_score
    )
)
BEGIN
    SELECT RAISE(ABORT, 'published status requires a reconciled publication receipt');
END;

CREATE TRIGGER IF NOT EXISTS review_brief_published_at_follows_receipt
BEFORE UPDATE OF published_at ON review_briefs
FOR EACH ROW
WHEN NOT (
    OLD.status='publishable' AND NEW.status='published'
    AND OLD.published_at IS NULL AND NEW.published_at IS NOT NULL
)
BEGIN
    SELECT RAISE(ABORT, 'review brief publication timestamp is immutable');
END;

CREATE TRIGGER IF NOT EXISTS review_brief_trace_is_immutable
BEFORE UPDATE ON review_brief_trace
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'review brief trace is immutable');
END;

CREATE TRIGGER IF NOT EXISTS review_brief_trace_cannot_be_deleted
BEFORE DELETE ON review_brief_trace
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'review brief trace cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS review_brief_publication_is_immutable
BEFORE UPDATE ON review_brief_publications
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'review brief publication is immutable');
END;

CREATE TRIGGER IF NOT EXISTS review_brief_publication_cannot_be_deleted
BEFORE DELETE ON review_brief_publications
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'review brief publication cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS review_brief_publication_must_reconcile
BEFORE INSERT ON review_brief_publications
FOR EACH ROW
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM review_briefs b
         WHERE b.brief_id=NEW.brief_id
           AND b.status='publishable'
           AND b.brief_hash=NEW.brief_hash
           AND b.reviewed_sha=NEW.reviewed_sha
           AND b.control_score=1.0
           AND NEW.control_score=b.control_score
           AND b.included_required_section_count=b.required_section_count
    ) THEN RAISE(ABORT, 'review brief publication does not match a publishable brief') END;
    SELECT CASE WHEN NEW.included_trace_count != (
        SELECT COUNT(*) FROM review_brief_trace
         WHERE brief_id=NEW.brief_id AND action='included'
    ) THEN RAISE(ABORT, 'review brief publication trace count does not reconcile') END;
    SELECT CASE WHEN NEW.seam_count != (
        SELECT COUNT(*) FROM change_impact_objects o
        JOIN review_briefs b ON b.impact_run_id=o.run_id
         WHERE b.brief_id=NEW.brief_id AND o.object_type='seam'
    ) THEN RAISE(ABORT, 'review brief publication seam denominator does not reconcile') END;
    SELECT CASE WHEN NEW.seam_count != (
        SELECT COUNT(*) FROM review_brief_trace
         WHERE brief_id=NEW.brief_id AND section='impacted_seams' AND action='included'
           AND json_array_length(json_extract(provenance_json, '$.impact_reason_path')) > 0
    ) THEN RAISE(ABORT, 'review brief publication seam provenance does not reconcile') END;
    SELECT CASE WHEN EXISTS (
        SELECT 1
          FROM review_brief_trace t, json_each(json_extract(t.source_json, '$.evidence')) evidence
         WHERE t.brief_id=NEW.brief_id AND t.action='included'
           AND COALESCE(json_extract(evidence.value, '$.reachable_at_reviewed_sha'), 0) != 1
    ) THEN RAISE(ABORT, 'review brief publication evidence validity does not reconcile') END;
END;

----------------------------------------------------------------------
-- INDEPENDENT REVIEW ANALYSIS: generate, blind-challenge, verify, aggregate
----------------------------------------------------------------------
-- A7 pass inputs are durable outbox packets. Generator packets contain one
-- published A6 brief. Refuter packets contain anonymized claims + evidence;
-- verifier packets add evidence discovered by refuters but never their
-- verdicts, rationales, confidence, provider, or identity.

CREATE TABLE IF NOT EXISTS review_analysis_runs (
    run_id                    TEXT PRIMARY KEY,
    impact_run_id             TEXT NOT NULL REFERENCES change_impact_runs(run_id) ON DELETE RESTRICT,
    reviewed_sha              TEXT NOT NULL,
    replicate_id              TEXT NOT NULL,
    condition                 TEXT NOT NULL CHECK (condition IN (
                                  'same-context','varied-context','heterogeneous-runtime')),
    orchestrator_model_family TEXT NOT NULL,
    provider_allowlist        TEXT NOT NULL CHECK (json_valid(provider_allowlist)),
    allowed_source_prefixes   TEXT NOT NULL CHECK (json_valid(allowed_source_prefixes)),
    max_total_tokens          INTEGER NOT NULL CHECK (max_total_tokens > 0),
    max_total_cost_microusd   INTEGER NOT NULL CHECK (max_total_cost_microusd >= 0),
    expected_generator_count  INTEGER NOT NULL CHECK (expected_generator_count >= 2),
    expected_refuter_count    INTEGER NOT NULL CHECK (expected_refuter_count >= 2),
    expected_verifier_count   INTEGER NOT NULL CHECK (expected_verifier_count >= 2),
    blind_assignment_id       TEXT NOT NULL,
    sealed_truth_hash         TEXT NOT NULL,
    validation_inject_leak    TEXT CHECK (validation_inject_leak IN (
                                  'blind-truth-field','prior-verdict-field')),
    status                    TEXT NOT NULL DEFAULT 'planned' CHECK (status IN (
                                  'planned','generating','hypotheses-frozen','refuting',
                                  'verification-ready','verifying','ready-to-aggregate',
                                  'aggregated','contaminated','failed')),
    manifest_json             TEXT NOT NULL CHECK (json_valid(manifest_json)),
    manifest_hash             TEXT NOT NULL,
    session_id                TEXT NOT NULL REFERENCES sessions(session_id),
    created_at                TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at              TEXT
);

CREATE INDEX IF NOT EXISTS idx_review_analysis_runs_status
    ON review_analysis_runs(status, created_at);

CREATE TABLE IF NOT EXISTS review_analysis_briefs (
    run_id          TEXT NOT NULL REFERENCES review_analysis_runs(run_id) ON DELETE RESTRICT,
    context_profile TEXT NOT NULL CHECK (context_profile IN (
                            'diff-scoped','control-wide','integral-head')),
    brief_id        TEXT NOT NULL REFERENCES review_briefs(brief_id) ON DELETE RESTRICT,
    PRIMARY KEY (run_id, context_profile),
    UNIQUE (run_id, brief_id)
);

CREATE TABLE IF NOT EXISTS review_passes (
    pass_id                  TEXT PRIMARY KEY,
    run_id                   TEXT NOT NULL REFERENCES review_analysis_runs(run_id) ON DELETE RESTRICT,
    ordinal                  INTEGER NOT NULL CHECK (ordinal >= 0),
    role                     TEXT NOT NULL CHECK (role IN ('generator','refuter','verifier')),
    replicate_id             TEXT NOT NULL,
    context_profile          TEXT NOT NULL CHECK (context_profile IN (
                                 'diff-scoped','control-wide','integral-head')),
    analytical_frame         TEXT NOT NULL,
    provider                 TEXT NOT NULL,
    model                    TEXT NOT NULL,
    model_family             TEXT NOT NULL,
    runtime                  TEXT NOT NULL,
    planned_tokens           INTEGER NOT NULL CHECK (planned_tokens > 0),
    planned_cost_microusd    INTEGER NOT NULL CHECK (planned_cost_microusd >= 0),
    status                   TEXT NOT NULL DEFAULT 'planned' CHECK (status IN (
                                 'planned','dispatched','landed','failed')),
    runtime_input_json       TEXT CHECK (runtime_input_json IS NULL OR json_valid(runtime_input_json)),
    runtime_input_hash       TEXT,
    result_json              TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
    result_hash              TEXT,
    actual_tokens            INTEGER CHECK (actual_tokens IS NULL OR actual_tokens >= 0),
    actual_cost_microusd     INTEGER CHECK (actual_cost_microusd IS NULL OR actual_cost_microusd >= 0),
    dispatched_at            TEXT,
    landed_at                TEXT,
    failure                  TEXT,
    UNIQUE (run_id, ordinal),
    UNIQUE (run_id, role, replicate_id)
);

CREATE INDEX IF NOT EXISTS idx_review_passes_run
    ON review_passes(run_id, role, status, ordinal);

CREATE TABLE IF NOT EXISTS review_judgments (
    judgment_id       TEXT PRIMARY KEY,
    pass_id           TEXT NOT NULL REFERENCES review_passes(pass_id) ON DELETE RESTRICT,
    hypothesis_id     TEXT,
    finding_key       TEXT NOT NULL,
    claim             TEXT NOT NULL,
    severity          TEXT CHECK (severity IN ('CRITICAL','HIGH','MEDIUM','LOW')),
    scope             TEXT,
    verdict           TEXT NOT NULL CHECK (verdict IN (
                            'proposed','upheld','overturned','scope-restricted','undetermined')),
    rationale         TEXT NOT NULL,
    payload_json      TEXT NOT NULL CHECK (json_valid(payload_json)),
    payload_hash      TEXT NOT NULL,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (pass_id, hypothesis_id),
    CHECK ((verdict='proposed' AND hypothesis_id IS NULL)
        OR (verdict!='proposed' AND hypothesis_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_review_judgments_pass
    ON review_judgments(pass_id, verdict, finding_key);

CREATE TABLE IF NOT EXISTS review_judgment_evidence (
    judgment_id  TEXT NOT NULL REFERENCES review_judgments(judgment_id) ON DELETE RESTRICT,
    evidence_id  INTEGER NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
    origin       TEXT NOT NULL CHECK (origin IN ('prior-packet','discovered-by-pass')),
    PRIMARY KEY (judgment_id, evidence_id)
);

CREATE TABLE IF NOT EXISTS review_hypotheses (
    hypothesis_id        TEXT PRIMARY KEY,
    run_id               TEXT NOT NULL REFERENCES review_analysis_runs(run_id) ON DELETE RESTRICT,
    ordinal              INTEGER NOT NULL CHECK (ordinal >= 0),
    finding_key          TEXT NOT NULL,
    challenge_packet_json TEXT NOT NULL CHECK (json_valid(challenge_packet_json)),
    challenge_packet_hash TEXT NOT NULL,
    frozen_at            TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (run_id, ordinal),
    UNIQUE (run_id, finding_key)
);

CREATE TABLE IF NOT EXISTS review_hypothesis_candidates (
    hypothesis_id TEXT NOT NULL REFERENCES review_hypotheses(hypothesis_id) ON DELETE RESTRICT,
    judgment_id   TEXT NOT NULL REFERENCES review_judgments(judgment_id) ON DELETE RESTRICT,
    PRIMARY KEY (hypothesis_id, judgment_id)
);

CREATE TABLE IF NOT EXISTS review_aggregations (
    aggregation_id        INTEGER PRIMARY KEY,
    run_id                TEXT NOT NULL UNIQUE REFERENCES review_analysis_runs(run_id) ON DELETE RESTRICT,
    expected_pass_count   INTEGER NOT NULL CHECK (expected_pass_count > 0),
    landed_pass_count     INTEGER NOT NULL CHECK (landed_pass_count >= 0),
    hypothesis_count      INTEGER NOT NULL CHECK (hypothesis_count >= 0),
    survived_count        INTEGER NOT NULL CHECK (survived_count >= 0),
    defeated_count        INTEGER NOT NULL CHECK (defeated_count >= 0),
    contested_count       INTEGER NOT NULL CHECK (contested_count >= 0),
    result_json           TEXT NOT NULL CHECK (json_valid(result_json)),
    result_hash           TEXT NOT NULL,
    session_id            TEXT NOT NULL REFERENCES sessions(session_id),
    aggregated_at         TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (landed_pass_count=expected_pass_count),
    CHECK (hypothesis_count=survived_count+defeated_count+contested_count)
);

CREATE TABLE IF NOT EXISTS review_contamination_events (
    id          INTEGER PRIMARY KEY,
    run_id      TEXT NOT NULL REFERENCES review_analysis_runs(run_id) ON DELETE RESTRICT,
    pass_id     TEXT REFERENCES review_passes(pass_id) ON DELETE RESTRICT,
    leak_type   TEXT NOT NULL CHECK (leak_type IN (
                      'blind-truth-field','prior-verdict-field','content-canary')),
    detail_json TEXT NOT NULL CHECK (json_valid(detail_json)),
    detected_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_review_contamination_run
    ON review_contamination_events(run_id, detected_at);

CREATE TABLE IF NOT EXISTS review_blind_reveals (
    run_id          TEXT PRIMARY KEY REFERENCES review_analysis_runs(run_id) ON DELETE RESTRICT,
    truth_json      TEXT NOT NULL CHECK (json_valid(truth_json)),
    truth_hash      TEXT NOT NULL,
    contaminated    INTEGER NOT NULL CHECK (contaminated IN (0,1)),
    revealed_by     TEXT NOT NULL REFERENCES sessions(session_id),
    revealed_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS review_evaluations (
    evaluation_id       TEXT PRIMARY KEY,
    run_ids_json        TEXT NOT NULL CHECK (json_valid(run_ids_json)),
    included_run_count  INTEGER NOT NULL CHECK (included_run_count >= 0),
    excluded_run_count  INTEGER NOT NULL CHECK (excluded_run_count >= 0),
    status              TEXT NOT NULL CHECK (status IN ('valid','red')),
    report_json         TEXT NOT NULL CHECK (json_valid(report_json)),
    report_hash         TEXT NOT NULL,
    session_id          TEXT NOT NULL REFERENCES sessions(session_id),
    scored_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER IF NOT EXISTS review_analysis_manifest_is_immutable
BEFORE UPDATE ON review_analysis_runs
FOR EACH ROW
WHEN OLD.run_id!=NEW.run_id OR OLD.impact_run_id!=NEW.impact_run_id
  OR OLD.reviewed_sha!=NEW.reviewed_sha OR OLD.replicate_id!=NEW.replicate_id
  OR OLD.condition!=NEW.condition OR OLD.orchestrator_model_family!=NEW.orchestrator_model_family
  OR OLD.provider_allowlist!=NEW.provider_allowlist
  OR OLD.allowed_source_prefixes!=NEW.allowed_source_prefixes
  OR OLD.max_total_tokens!=NEW.max_total_tokens
  OR OLD.max_total_cost_microusd!=NEW.max_total_cost_microusd
  OR OLD.expected_generator_count!=NEW.expected_generator_count
  OR OLD.expected_refuter_count!=NEW.expected_refuter_count
  OR OLD.expected_verifier_count!=NEW.expected_verifier_count
  OR OLD.blind_assignment_id!=NEW.blind_assignment_id
  OR OLD.sealed_truth_hash!=NEW.sealed_truth_hash
  OR COALESCE(OLD.validation_inject_leak,'')!=COALESCE(NEW.validation_inject_leak,'')
  OR OLD.manifest_json!=NEW.manifest_json OR OLD.manifest_hash!=NEW.manifest_hash
  OR OLD.session_id!=NEW.session_id
BEGIN
    SELECT RAISE(ABORT, 'review analysis manifest is immutable');
END;

CREATE TRIGGER IF NOT EXISTS review_analysis_status_is_monotonic
BEFORE UPDATE OF status ON review_analysis_runs
FOR EACH ROW
WHEN NOT (
    (OLD.status='planned' AND NEW.status='generating')
 OR (OLD.status='generating' AND NEW.status='hypotheses-frozen')
 OR (OLD.status='hypotheses-frozen' AND NEW.status='refuting')
 OR (OLD.status='refuting' AND NEW.status='verification-ready')
 OR (OLD.status='verification-ready' AND NEW.status='verifying')
 OR (OLD.status='verifying' AND NEW.status='ready-to-aggregate')
 OR (OLD.status='ready-to-aggregate' AND NEW.status='aggregated')
 OR (OLD.status='aggregated' AND NEW.status='contaminated')
 OR (OLD.status NOT IN ('aggregated','contaminated','failed')
     AND NEW.status IN ('contaminated','failed'))
)
BEGIN
    SELECT RAISE(ABORT, 'invalid review analysis status transition');
END;

CREATE TRIGGER IF NOT EXISTS review_pass_identity_is_immutable
BEFORE UPDATE ON review_passes
FOR EACH ROW
WHEN OLD.pass_id!=NEW.pass_id OR OLD.run_id!=NEW.run_id OR OLD.ordinal!=NEW.ordinal
  OR OLD.role!=NEW.role OR OLD.replicate_id!=NEW.replicate_id
  OR OLD.context_profile!=NEW.context_profile OR OLD.analytical_frame!=NEW.analytical_frame
  OR OLD.provider!=NEW.provider OR OLD.model!=NEW.model OR OLD.model_family!=NEW.model_family
  OR OLD.runtime!=NEW.runtime OR OLD.planned_tokens!=NEW.planned_tokens
  OR OLD.planned_cost_microusd!=NEW.planned_cost_microusd
BEGIN
    SELECT RAISE(ABORT, 'review pass identity and plan are immutable');
END;

CREATE TRIGGER IF NOT EXISTS review_pass_status_is_monotonic
BEFORE UPDATE OF status ON review_passes
FOR EACH ROW
WHEN NOT (
    (OLD.status='planned' AND NEW.status='dispatched')
 OR (OLD.status='dispatched' AND NEW.status IN ('landed','failed'))
)
BEGIN
    SELECT RAISE(ABORT, 'invalid review pass status transition');
END;

CREATE TRIGGER IF NOT EXISTS review_pass_input_is_write_once
BEFORE UPDATE OF runtime_input_json, runtime_input_hash, dispatched_at ON review_passes
FOR EACH ROW
WHEN NOT (
    OLD.status='planned' AND NEW.status='dispatched'
    AND OLD.runtime_input_json IS NULL AND NEW.runtime_input_json IS NOT NULL
    AND OLD.runtime_input_hash IS NULL AND NEW.runtime_input_hash IS NOT NULL
    AND OLD.dispatched_at IS NULL AND NEW.dispatched_at IS NOT NULL
)
BEGIN
    SELECT RAISE(ABORT, 'review pass runtime input is write-once at dispatch');
END;

CREATE TRIGGER IF NOT EXISTS review_pass_runtime_input_is_blind
BEFORE UPDATE OF runtime_input_json ON review_passes
FOR EACH ROW
WHEN EXISTS (
    SELECT 1 FROM json_tree(NEW.runtime_input_json)
     WHERE key IN ('expected_findings','expected_finding_keys','truth','arm_type',
                   'evaluation_condition','leak_canary')
       OR (NEW.role!='generator' AND key IN
           ('verdict','rationale','confidence','prior_verdict','source_pass_id'))
)
BEGIN
    SELECT RAISE(ABORT, 'review pass runtime input violates blinding contract');
END;

CREATE TRIGGER IF NOT EXISTS review_pass_result_is_write_once
BEFORE UPDATE OF result_json, result_hash, actual_tokens, actual_cost_microusd, landed_at, failure
ON review_passes
FOR EACH ROW
WHEN NOT (
    OLD.status='dispatched' AND NEW.status IN ('landed','failed')
    AND OLD.result_json IS NULL AND OLD.result_hash IS NULL
    AND OLD.actual_tokens IS NULL AND OLD.actual_cost_microusd IS NULL
    AND OLD.landed_at IS NULL AND OLD.failure IS NULL
)
BEGIN
    SELECT RAISE(ABORT, 'review pass result is write-once at landing');
END;

CREATE TRIGGER IF NOT EXISTS review_judgment_is_immutable
BEFORE UPDATE ON review_judgments FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'review judgment is immutable'); END;
CREATE TRIGGER IF NOT EXISTS review_analysis_brief_is_immutable
BEFORE UPDATE ON review_analysis_briefs FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'review analysis brief assignment is immutable'); END;
CREATE TRIGGER IF NOT EXISTS review_analysis_brief_cannot_be_deleted
BEFORE DELETE ON review_analysis_briefs FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'review analysis brief assignment cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS review_judgment_cannot_be_deleted
BEFORE DELETE ON review_judgments FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'review judgment cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS review_judgment_requires_dispatched_pass
BEFORE INSERT ON review_judgments FOR EACH ROW
WHEN NOT EXISTS (
    SELECT 1 FROM review_passes p WHERE p.pass_id=NEW.pass_id AND p.status='dispatched'
)
BEGIN SELECT RAISE(ABORT, 'review judgments land only for a dispatched pass'); END;
CREATE TRIGGER IF NOT EXISTS review_judgment_evidence_requires_dispatched_pass
BEFORE INSERT ON review_judgment_evidence FOR EACH ROW
WHEN NOT EXISTS (
    SELECT 1 FROM review_judgments j JOIN review_passes p ON p.pass_id=j.pass_id
     WHERE j.judgment_id=NEW.judgment_id AND p.status='dispatched'
)
BEGIN SELECT RAISE(ABORT, 'review judgment evidence lands only with its dispatched pass'); END;
CREATE TRIGGER IF NOT EXISTS review_judgment_evidence_is_immutable
BEFORE UPDATE ON review_judgment_evidence FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'review judgment evidence is immutable'); END;
CREATE TRIGGER IF NOT EXISTS review_judgment_evidence_cannot_be_deleted
BEFORE DELETE ON review_judgment_evidence FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'review judgment evidence cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS review_hypothesis_is_immutable
BEFORE UPDATE ON review_hypotheses FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'review hypothesis is immutable'); END;
CREATE TRIGGER IF NOT EXISTS review_hypothesis_cannot_be_deleted
BEFORE DELETE ON review_hypotheses FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'review hypothesis cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS review_hypothesis_requires_generating_run
BEFORE INSERT ON review_hypotheses FOR EACH ROW
WHEN NOT EXISTS (
    SELECT 1 FROM review_analysis_runs r WHERE r.run_id=NEW.run_id AND r.status='generating'
)
BEGIN SELECT RAISE(ABORT, 'review hypotheses freeze only after generation'); END;
CREATE TRIGGER IF NOT EXISTS review_hypothesis_candidate_requires_generating_run
BEFORE INSERT ON review_hypothesis_candidates FOR EACH ROW
WHEN NOT EXISTS (
    SELECT 1 FROM review_hypotheses h JOIN review_analysis_runs r ON r.run_id=h.run_id
     WHERE h.hypothesis_id=NEW.hypothesis_id AND r.status='generating'
)
BEGIN SELECT RAISE(ABORT, 'review hypothesis candidates freeze only during generation'); END;
CREATE TRIGGER IF NOT EXISTS review_hypothesis_candidate_is_immutable
BEFORE UPDATE ON review_hypothesis_candidates FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'review hypothesis candidate mapping is immutable'); END;
CREATE TRIGGER IF NOT EXISTS review_hypothesis_candidate_cannot_be_deleted
BEFORE DELETE ON review_hypothesis_candidates FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'review hypothesis candidate mapping cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS review_aggregation_must_reconcile
BEFORE INSERT ON review_aggregations FOR EACH ROW
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM review_analysis_runs r
         WHERE r.run_id=NEW.run_id AND r.status='ready-to-aggregate'
           AND NEW.expected_pass_count=(r.expected_generator_count+r.expected_refuter_count+r.expected_verifier_count)
    ) THEN RAISE(ABORT, 'review aggregation run or expected denominator does not reconcile') END;
    SELECT CASE WHEN NEW.landed_pass_count != (
        SELECT COUNT(*) FROM review_passes p WHERE p.run_id=NEW.run_id AND p.status='landed'
    ) THEN RAISE(ABORT, 'review aggregation landed denominator does not reconcile') END;
    SELECT CASE WHEN NEW.expected_pass_count != (
        SELECT COUNT(*) FROM review_passes p WHERE p.run_id=NEW.run_id
    ) THEN RAISE(ABORT, 'review aggregation pass manifest does not reconcile') END;
    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM review_hypotheses h
         WHERE h.run_id=NEW.run_id AND (
           SELECT COUNT(*) FROM review_judgments j JOIN review_passes p ON p.pass_id=j.pass_id
            WHERE j.hypothesis_id=h.hypothesis_id AND p.role IN ('refuter','verifier')
         ) != (
           SELECT r.expected_refuter_count+r.expected_verifier_count
             FROM review_analysis_runs r WHERE r.run_id=NEW.run_id
         )
    ) THEN RAISE(ABORT, 'review aggregation judgment fan-in does not reconcile') END;
    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM review_contamination_events c WHERE c.run_id=NEW.run_id
    ) THEN RAISE(ABORT, 'contaminated review analysis cannot aggregate') END;
END;
CREATE TRIGGER IF NOT EXISTS review_aggregation_is_immutable
BEFORE UPDATE ON review_aggregations FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'review aggregation is immutable'); END;
CREATE TRIGGER IF NOT EXISTS review_aggregation_cannot_be_deleted
BEFORE DELETE ON review_aggregations FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'review aggregation cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS review_contamination_event_is_immutable
BEFORE UPDATE ON review_contamination_events FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'review contamination event is immutable'); END;
CREATE TRIGGER IF NOT EXISTS review_contamination_event_cannot_be_deleted
BEFORE DELETE ON review_contamination_events FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'review contamination event cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS review_blind_reveal_is_immutable
BEFORE UPDATE ON review_blind_reveals FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'review blind reveal is immutable'); END;
CREATE TRIGGER IF NOT EXISTS review_blind_reveal_cannot_be_deleted
BEFORE DELETE ON review_blind_reveals FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'review blind reveal cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS review_evaluation_is_immutable
BEFORE UPDATE ON review_evaluations FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'review evaluation is immutable'); END;
CREATE TRIGGER IF NOT EXISTS review_evaluation_cannot_be_deleted
BEFORE DELETE ON review_evaluations FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'review evaluation cannot be deleted'); END;

----------------------------------------------------------------------
-- COMPOSITION VERIFICATION: exact fan-in and one integral lane at HEAD
----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS composition_runs (
    run_id                       TEXT PRIMARY KEY,
    impact_run_id                TEXT NOT NULL REFERENCES change_impact_runs(run_id) ON DELETE RESTRICT,
    assembled_head_sha           TEXT NOT NULL,
    assembled_tree_sha           TEXT NOT NULL,
    expected_item_count          INTEGER NOT NULL CHECK (expected_item_count > 0),
    expected_unit_item_count     INTEGER NOT NULL CHECK (expected_unit_item_count > 0),
    expected_integral_item_count INTEGER NOT NULL CHECK (expected_integral_item_count > 0),
    impacted_seam_count          INTEGER NOT NULL CHECK (impacted_seam_count >= 0),
    selected_seam_count          INTEGER NOT NULL CHECK (selected_seam_count >= 0),
    status                       TEXT NOT NULL DEFAULT 'planned' CHECK (status IN (
                                     'planned','collecting','integral-dispatched','verifying',
                                     'complete','blocked')),
    manifest_json                TEXT NOT NULL CHECK (json_valid(manifest_json)),
    manifest_hash                TEXT NOT NULL,
    session_id                   TEXT NOT NULL REFERENCES sessions(session_id),
    created_at                   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                   TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at                 TEXT,
    CHECK (expected_item_count=expected_unit_item_count+expected_integral_item_count),
    CHECK (impacted_seam_count=selected_seam_count OR impacted_seam_count=0)
);

CREATE INDEX IF NOT EXISTS idx_composition_runs_status
    ON composition_runs(status, created_at);

CREATE TABLE IF NOT EXISTS composition_items (
    item_id             TEXT PRIMARY KEY,
    run_id              TEXT NOT NULL REFERENCES composition_runs(run_id) ON DELETE RESTRICT,
    ordinal             INTEGER NOT NULL CHECK (ordinal >= 0),
    item_kind           TEXT NOT NULL CHECK (item_kind IN (
                              'artifact','commit','test','review-result')),
    verification_scope  TEXT NOT NULL CHECK (verification_scope IN ('unit','integral-head')),
    subject             TEXT NOT NULL,
    expected_ref        TEXT NOT NULL,
    target_sha          TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'planned' CHECK (status IN (
                              'planned','dispatched','landed','scored-pass','scored-fail')),
    runtime_input_json  TEXT CHECK (runtime_input_json IS NULL OR json_valid(runtime_input_json)),
    runtime_input_hash  TEXT,
    observation_json    TEXT CHECK (observation_json IS NULL OR json_valid(observation_json)),
    observation_hash    TEXT,
    scoring_json        TEXT CHECK (scoring_json IS NULL OR json_valid(scoring_json)),
    scoring_hash        TEXT,
    dispatched_at       TEXT,
    landed_at           TEXT,
    scored_at           TEXT,
    UNIQUE (run_id, ordinal),
    UNIQUE (run_id, item_kind, verification_scope, subject)
);

CREATE INDEX IF NOT EXISTS idx_composition_items_run
    ON composition_items(run_id, verification_scope, status, ordinal);

CREATE TABLE IF NOT EXISTS composition_seam_concerns (
    run_id        TEXT NOT NULL REFERENCES composition_runs(run_id) ON DELETE RESTRICT,
    seam_id       TEXT NOT NULL REFERENCES seams(id) ON DELETE RESTRICT,
    concern_code  TEXT NOT NULL REFERENCES concerns(code) ON DELETE RESTRICT,
    rationale     TEXT NOT NULL,
    PRIMARY KEY (run_id, seam_id, concern_code)
);

CREATE TABLE IF NOT EXISTS composition_integral_lanes (
    run_id                TEXT PRIMARY KEY REFERENCES composition_runs(run_id) ON DELETE RESTRICT,
    status                TEXT NOT NULL CHECK (status IN (
                              'dispatched','landed','scored-pass','scored-fail')),
    runtime_input_json    TEXT NOT NULL CHECK (json_valid(runtime_input_json)),
    runtime_input_hash    TEXT NOT NULL,
    checkout_head_sha     TEXT,
    checkout_tree_sha     TEXT,
    checkout_mode         TEXT CHECK (checkout_mode IS NULL OR checkout_mode='clean-worktree'),
    dirty_paths_json      TEXT CHECK (dirty_paths_json IS NULL OR json_valid(dirty_paths_json)),
    observation_json      TEXT CHECK (observation_json IS NULL OR json_valid(observation_json)),
    observation_hash      TEXT,
    scoring_json          TEXT CHECK (scoring_json IS NULL OR json_valid(scoring_json)),
    scoring_hash          TEXT,
    dispatched_at         TEXT NOT NULL DEFAULT (datetime('now')),
    landed_at             TEXT,
    scored_at             TEXT
);

CREATE TABLE IF NOT EXISTS composition_deferrals (
    deferral_id    TEXT PRIMARY KEY,
    run_id         TEXT NOT NULL REFERENCES composition_runs(run_id) ON DELETE RESTRICT,
    concern        TEXT NOT NULL,
    obligation_id  TEXT NOT NULL REFERENCES revalidation_obligations(obligation_id) ON DELETE RESTRICT,
    source_item_id TEXT REFERENCES composition_items(item_id) ON DELETE RESTRICT,
    recorded_by    TEXT NOT NULL REFERENCES sessions(session_id),
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_composition_deferrals_run
    ON composition_deferrals(run_id, created_at);

CREATE TABLE IF NOT EXISTS composition_reconciliations (
    reconciliation_id INTEGER PRIMARY KEY,
    run_id             TEXT NOT NULL REFERENCES composition_runs(run_id) ON DELETE RESTRICT,
    expected_count     INTEGER NOT NULL CHECK (expected_count > 0),
    dispatched_count   INTEGER NOT NULL CHECK (dispatched_count >= 0),
    landed_count       INTEGER NOT NULL CHECK (landed_count >= 0),
    scored_count       INTEGER NOT NULL CHECK (scored_count >= 0),
    passed_count       INTEGER NOT NULL CHECK (passed_count >= 0),
    failed_count       INTEGER NOT NULL CHECK (failed_count >= 0),
    deferred_count     INTEGER NOT NULL CHECK (deferred_count >= 0),
    status             TEXT NOT NULL CHECK (status IN ('red','green')),
    result_json        TEXT NOT NULL CHECK (json_valid(result_json)),
    result_hash        TEXT NOT NULL,
    session_id         TEXT NOT NULL REFERENCES sessions(session_id),
    reconciled_at      TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (scored_count=passed_count+failed_count)
);

CREATE INDEX IF NOT EXISTS idx_composition_reconciliations_run
    ON composition_reconciliations(run_id, reconciliation_id);

CREATE TRIGGER IF NOT EXISTS composition_manifest_is_immutable
BEFORE UPDATE ON composition_runs FOR EACH ROW
WHEN OLD.run_id!=NEW.run_id OR OLD.impact_run_id!=NEW.impact_run_id
  OR OLD.assembled_head_sha!=NEW.assembled_head_sha OR OLD.assembled_tree_sha!=NEW.assembled_tree_sha
  OR OLD.expected_item_count!=NEW.expected_item_count
  OR OLD.expected_unit_item_count!=NEW.expected_unit_item_count
  OR OLD.expected_integral_item_count!=NEW.expected_integral_item_count
  OR OLD.impacted_seam_count!=NEW.impacted_seam_count
  OR OLD.selected_seam_count!=NEW.selected_seam_count
  OR OLD.manifest_json!=NEW.manifest_json OR OLD.manifest_hash!=NEW.manifest_hash
  OR OLD.session_id!=NEW.session_id
BEGIN SELECT RAISE(ABORT, 'composition manifest is immutable'); END;
CREATE TRIGGER IF NOT EXISTS composition_run_starts_planned
BEFORE INSERT ON composition_runs FOR EACH ROW
WHEN NEW.status!='planned'
BEGIN SELECT RAISE(ABORT, 'composition run must start planned'); END;
CREATE TRIGGER IF NOT EXISTS composition_run_cannot_be_deleted
BEFORE DELETE ON composition_runs FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'composition run cannot be deleted'); END;

CREATE TRIGGER IF NOT EXISTS composition_status_is_monotonic
BEFORE UPDATE OF status ON composition_runs FOR EACH ROW
WHEN NOT (
    (OLD.status='planned' AND NEW.status='collecting'
     AND EXISTS (SELECT 1 FROM composition_items
                  WHERE run_id=OLD.run_id AND status!='planned'))
 OR (OLD.status IN ('planned','collecting') AND NEW.status='integral-dispatched'
     AND EXISTS (SELECT 1 FROM composition_integral_lanes
                  WHERE run_id=OLD.run_id AND status='dispatched'))
 OR (OLD.status='integral-dispatched' AND NEW.status='verifying'
     AND EXISTS (SELECT 1 FROM composition_integral_lanes
                  WHERE run_id=OLD.run_id AND status='scored-pass'))
 OR (OLD.status IN ('planned','collecting','integral-dispatched','verifying')
     AND NEW.status='blocked')
 OR (OLD.status='verifying' AND NEW.status='complete'
     AND EXISTS (SELECT 1 FROM composition_reconciliations
                  WHERE run_id=OLD.run_id AND status='green'))
)
BEGIN SELECT RAISE(ABORT, 'invalid composition status transition'); END;

CREATE TRIGGER IF NOT EXISTS composition_item_plan_is_immutable
BEFORE UPDATE ON composition_items FOR EACH ROW
WHEN OLD.item_id!=NEW.item_id OR OLD.run_id!=NEW.run_id OR OLD.ordinal!=NEW.ordinal
  OR OLD.item_kind!=NEW.item_kind OR OLD.verification_scope!=NEW.verification_scope
  OR OLD.subject!=NEW.subject OR OLD.expected_ref!=NEW.expected_ref OR OLD.target_sha!=NEW.target_sha
BEGIN SELECT RAISE(ABORT, 'composition item plan is immutable'); END;
CREATE TRIGGER IF NOT EXISTS composition_item_starts_planned
BEFORE INSERT ON composition_items FOR EACH ROW
WHEN NEW.status!='planned' OR NEW.runtime_input_json IS NOT NULL
  OR NEW.observation_json IS NOT NULL OR NEW.scoring_json IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'composition item must start planned and empty'); END;
CREATE TRIGGER IF NOT EXISTS composition_item_cannot_be_deleted
BEFORE DELETE ON composition_items FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'composition item cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS composition_seam_concern_is_immutable
BEFORE UPDATE ON composition_seam_concerns FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'composition seam concern is immutable'); END;
CREATE TRIGGER IF NOT EXISTS composition_seam_concern_cannot_be_deleted
BEFORE DELETE ON composition_seam_concerns FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'composition seam concern cannot be deleted'); END;

CREATE TRIGGER IF NOT EXISTS composition_item_status_is_monotonic
BEFORE UPDATE OF status ON composition_items FOR EACH ROW
WHEN NOT (
    (OLD.status='planned' AND NEW.status='dispatched'
     AND NEW.runtime_input_json IS NOT NULL AND NEW.runtime_input_hash IS NOT NULL
     AND NEW.dispatched_at IS NOT NULL)
 OR (OLD.status='dispatched' AND NEW.status='landed'
     AND NEW.observation_json IS NOT NULL AND NEW.observation_hash IS NOT NULL
     AND NEW.landed_at IS NOT NULL)
 OR (OLD.status='landed' AND NEW.status IN ('scored-pass','scored-fail')
     AND NEW.scoring_json IS NOT NULL AND NEW.scoring_hash IS NOT NULL
     AND NEW.scored_at IS NOT NULL)
)
BEGIN SELECT RAISE(ABORT, 'invalid composition item status transition'); END;

CREATE TRIGGER IF NOT EXISTS composition_item_dispatch_is_write_once
BEFORE UPDATE OF runtime_input_json, runtime_input_hash, dispatched_at ON composition_items
FOR EACH ROW
WHEN NOT (OLD.status='planned' AND NEW.status='dispatched'
  AND OLD.runtime_input_json IS NULL AND NEW.runtime_input_json IS NOT NULL
  AND OLD.runtime_input_hash IS NULL AND NEW.runtime_input_hash IS NOT NULL
  AND OLD.dispatched_at IS NULL AND NEW.dispatched_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'composition item dispatch is write-once'); END;

CREATE TRIGGER IF NOT EXISTS composition_item_landing_is_write_once
BEFORE UPDATE OF observation_json, observation_hash, landed_at ON composition_items
FOR EACH ROW
WHEN NOT (OLD.status='dispatched' AND NEW.status='landed'
  AND OLD.observation_json IS NULL AND NEW.observation_json IS NOT NULL
  AND OLD.observation_hash IS NULL AND NEW.observation_hash IS NOT NULL
  AND OLD.landed_at IS NULL AND NEW.landed_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'composition item landing is write-once'); END;

CREATE TRIGGER IF NOT EXISTS composition_item_scoring_is_write_once
BEFORE UPDATE OF scoring_json, scoring_hash, scored_at ON composition_items
FOR EACH ROW
WHEN NOT (OLD.status='landed' AND NEW.status IN ('scored-pass','scored-fail')
  AND OLD.scoring_json IS NULL AND NEW.scoring_json IS NOT NULL
  AND OLD.scoring_hash IS NULL AND NEW.scoring_hash IS NOT NULL
  AND OLD.scored_at IS NULL AND NEW.scored_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'composition item scoring is write-once'); END;

CREATE TRIGGER IF NOT EXISTS composition_integral_lane_status_is_monotonic
BEFORE UPDATE OF status ON composition_integral_lanes FOR EACH ROW
WHEN NOT ((OLD.status='dispatched' AND NEW.status='landed'
           AND NEW.checkout_head_sha IS NOT NULL AND NEW.checkout_tree_sha IS NOT NULL
           AND NEW.checkout_mode='clean-worktree' AND NEW.dirty_paths_json IS NOT NULL
           AND NEW.observation_json IS NOT NULL AND NEW.observation_hash IS NOT NULL
           AND NEW.landed_at IS NOT NULL)
       OR (OLD.status='landed' AND NEW.status IN ('scored-pass','scored-fail')
           AND NEW.scoring_json IS NOT NULL AND NEW.scoring_hash IS NOT NULL
           AND NEW.scored_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'invalid integral lane status transition'); END;
CREATE TRIGGER IF NOT EXISTS composition_integral_lane_starts_dispatched
BEFORE INSERT ON composition_integral_lanes FOR EACH ROW
WHEN NEW.status!='dispatched' OR NEW.runtime_input_json IS NULL OR NEW.runtime_input_hash IS NULL
BEGIN SELECT RAISE(ABORT, 'composition integral lane must start dispatched'); END;
CREATE TRIGGER IF NOT EXISTS composition_integral_lane_cannot_be_deleted
BEFORE DELETE ON composition_integral_lanes FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'composition integral lane cannot be deleted'); END;

CREATE TRIGGER IF NOT EXISTS composition_integral_lane_landing_is_write_once
BEFORE UPDATE OF checkout_head_sha, checkout_tree_sha, checkout_mode,
                 dirty_paths_json, observation_json, observation_hash, landed_at
ON composition_integral_lanes FOR EACH ROW
WHEN NOT (OLD.status='dispatched' AND NEW.status='landed'
  AND OLD.observation_json IS NULL AND NEW.observation_json IS NOT NULL
  AND OLD.observation_hash IS NULL AND NEW.observation_hash IS NOT NULL
  AND OLD.landed_at IS NULL AND NEW.landed_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'integral lane landing is write-once'); END;

CREATE TRIGGER IF NOT EXISTS composition_integral_lane_scoring_is_write_once
BEFORE UPDATE OF scoring_json, scoring_hash, scored_at ON composition_integral_lanes
FOR EACH ROW
WHEN NOT (OLD.status='landed' AND NEW.status IN ('scored-pass','scored-fail')
  AND OLD.scoring_json IS NULL AND NEW.scoring_json IS NOT NULL
  AND OLD.scoring_hash IS NULL AND NEW.scoring_hash IS NOT NULL
  AND OLD.scored_at IS NULL AND NEW.scored_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'integral lane scoring is write-once'); END;

CREATE TRIGGER IF NOT EXISTS composition_reconciliation_must_reconcile
BEFORE INSERT ON composition_reconciliations FOR EACH ROW
BEGIN
    SELECT CASE WHEN NEW.expected_count != (
        SELECT expected_item_count FROM composition_runs WHERE run_id=NEW.run_id
    ) THEN RAISE(ABORT, 'composition expected denominator does not reconcile') END;
    SELECT CASE WHEN NEW.expected_count != (
        SELECT COUNT(*) FROM composition_items WHERE run_id=NEW.run_id
    ) THEN RAISE(ABORT, 'composition item manifest does not reconcile') END;
    SELECT CASE WHEN NEW.dispatched_count != (
        SELECT COUNT(*) FROM composition_items WHERE run_id=NEW.run_id AND status!='planned'
    ) THEN RAISE(ABORT, 'composition dispatched denominator does not reconcile') END;
    SELECT CASE WHEN NEW.landed_count != (
        SELECT COUNT(*) FROM composition_items WHERE run_id=NEW.run_id
         AND status IN ('landed','scored-pass','scored-fail')
    ) THEN RAISE(ABORT, 'composition landed denominator does not reconcile') END;
    SELECT CASE WHEN NEW.scored_count != (
        SELECT COUNT(*) FROM composition_items WHERE run_id=NEW.run_id
         AND status IN ('scored-pass','scored-fail')
    ) THEN RAISE(ABORT, 'composition scored denominator does not reconcile') END;
    SELECT CASE WHEN NEW.passed_count != (
        SELECT COUNT(*) FROM composition_items WHERE run_id=NEW.run_id AND status='scored-pass'
    ) OR NEW.failed_count != (
        SELECT COUNT(*) FROM composition_items WHERE run_id=NEW.run_id AND status='scored-fail'
    ) OR NEW.deferred_count != (
        SELECT COUNT(*) FROM composition_deferrals WHERE run_id=NEW.run_id
    ) THEN RAISE(ABORT, 'composition outcome denominators do not reconcile') END;
    SELECT CASE WHEN NEW.status='green' AND (
        NEW.passed_count!=NEW.expected_count OR NEW.failed_count!=0 OR NEW.deferred_count!=0
        OR NOT EXISTS (SELECT 1 FROM composition_integral_lanes
                        WHERE run_id=NEW.run_id AND status='scored-pass')
    ) THEN RAISE(ABORT, 'green composition requires exact fan-in and a passing integral lane') END;
END;

CREATE TRIGGER IF NOT EXISTS composition_reconciliation_is_immutable
BEFORE UPDATE ON composition_reconciliations FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'composition reconciliation is immutable'); END;
CREATE TRIGGER IF NOT EXISTS composition_reconciliation_cannot_be_deleted
BEFORE DELETE ON composition_reconciliations FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'composition reconciliation cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS composition_deferral_is_immutable
BEFORE UPDATE ON composition_deferrals FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'composition deferral is immutable'); END;
CREATE TRIGGER IF NOT EXISTS composition_deferral_requires_red_destination
BEFORE INSERT ON composition_deferrals FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM revalidation_obligations
                  WHERE obligation_id=NEW.obligation_id AND blocking=1 AND state!='closed')
BEGIN SELECT RAISE(ABORT, 'composition deferral requires an open blocking destination'); END;
CREATE TRIGGER IF NOT EXISTS composition_deferral_cannot_be_deleted
BEFORE DELETE ON composition_deferrals FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'composition deferral cannot be deleted'); END;

----------------------------------------------------------------------
-- REVIEW SESSION: compact decision surface and verified clean export
----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS review_sessions (
    review_session_id TEXT PRIMARY KEY,
    composition_run_id TEXT NOT NULL REFERENCES composition_runs(run_id) ON DELETE RESTRICT,
    impact_run_id      TEXT NOT NULL REFERENCES change_impact_runs(run_id) ON DELETE RESTRICT,
    reviewed_sha       TEXT NOT NULL,
    status             TEXT NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared','furnished')),
    item_count         INTEGER NOT NULL CHECK (item_count > 0),
    actionable_count   INTEGER NOT NULL CHECK (actionable_count >= 0),
    summary_json       TEXT NOT NULL CHECK (json_valid(summary_json)),
    summary_hash       TEXT NOT NULL,
    prepared_by        TEXT NOT NULL REFERENCES sessions(session_id),
    prepared_at        TEXT NOT NULL DEFAULT (datetime('now')),
    furnished_at       TEXT
);

CREATE TABLE IF NOT EXISTS review_session_items (
    review_session_id TEXT NOT NULL REFERENCES review_sessions(review_session_id) ON DELETE RESTRICT,
    item_id           TEXT NOT NULL,
    ordinal           INTEGER NOT NULL CHECK (ordinal >= 0),
    section           TEXT NOT NULL CHECK (section IN (
                         'situation','findings','challenges','regressions','latent-defects',
                         'stale-knowledge','open-obligations','unknowns','history')),
    semantic_state    TEXT NOT NULL CHECK (semantic_state IN (
                         'changed','active-finding','challenge-survived','challenge-contested',
                         'challenge-defeated','regression','latent-defect','stale-claim',
                         'open-obligation','unknown','unverified-suspicion',
                         'ruled-out-historical','verified-fixed-historical','acceptable-control',
                         'composition-red','composition-green')),
    epistemic_kind    TEXT NOT NULL CHECK (epistemic_kind IN (
                         'observation','inference','open-question')),
    actionable        INTEGER NOT NULL CHECK (actionable IN (0,1)),
    statement         TEXT NOT NULL,
    source_type       TEXT NOT NULL CHECK (source_type IN (
                         'change-file','finding','review-hypothesis','claim','obligation',
                         'open-question','field-note','composition')),
    source_id         TEXT NOT NULL,
    record_uri        TEXT NOT NULL,
    compact_json      TEXT NOT NULL CHECK (json_valid(compact_json)),
    compact_hash      TEXT NOT NULL,
    PRIMARY KEY (review_session_id, item_id),
    UNIQUE (review_session_id, ordinal),
    UNIQUE (review_session_id, source_type, source_id, semantic_state)
);

CREATE INDEX IF NOT EXISTS idx_review_session_items_section
    ON review_session_items(review_session_id, section, ordinal);

CREATE TABLE IF NOT EXISTS review_session_item_evidence (
    review_session_id TEXT NOT NULL,
    item_id           TEXT NOT NULL,
    evidence_id       INTEGER NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
    role              TEXT NOT NULL CHECK (role IN ('supports','contradicts','qualifies','status-moving')),
    PRIMARY KEY (review_session_id, item_id, evidence_id),
    FOREIGN KEY (review_session_id, item_id)
      REFERENCES review_session_items(review_session_id, item_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS review_session_completions (
    review_session_id   TEXT PRIMARY KEY REFERENCES review_sessions(review_session_id) ON DELETE RESTRICT,
    advice_item_ids_json TEXT NOT NULL CHECK (json_valid(advice_item_ids_json)),
    advice_count         INTEGER NOT NULL CHECK (advice_count > 0),
    decisions_json       TEXT NOT NULL CHECK (json_valid(decisions_json)),
    decision_count       INTEGER NOT NULL CHECK (decision_count >= 0),
    accepted_count       INTEGER NOT NULL CHECK (accepted_count >= 0),
    completion_note      TEXT NOT NULL,
    completed_by         TEXT NOT NULL REFERENCES sessions(session_id),
    completed_at         TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (accepted_count <= decision_count)
);

CREATE TABLE IF NOT EXISTS review_exports (
    export_id          TEXT PRIMARY KEY,
    review_session_id  TEXT NOT NULL UNIQUE REFERENCES review_sessions(review_session_id) ON DELETE RESTRICT,
    json_path          TEXT NOT NULL UNIQUE,
    markdown_path      TEXT NOT NULL UNIQUE,
    json_hash          TEXT NOT NULL,
    markdown_hash      TEXT NOT NULL,
    item_count         INTEGER NOT NULL CHECK (item_count > 0),
    export_json        TEXT NOT NULL CHECK (json_valid(export_json)),
    exported_by        TEXT NOT NULL REFERENCES sessions(session_id),
    exported_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS review_export_verifications (
    verification_id INTEGER PRIMARY KEY,
    export_id       TEXT NOT NULL REFERENCES review_exports(export_id) ON DELETE RESTRICT,
    state_ok        INTEGER NOT NULL CHECK (state_ok IN (0,1)),
    coverage_ok     INTEGER NOT NULL CHECK (coverage_ok IN (0,1)),
    content_ok      INTEGER NOT NULL CHECK (content_ok IN (0,1)),
    ok              INTEGER NOT NULL CHECK (ok IN (0,1)),
    mismatch_count  INTEGER NOT NULL CHECK (mismatch_count >= 0),
    report_json     TEXT NOT NULL CHECK (json_valid(report_json)),
    report_hash     TEXT NOT NULL,
    verified_by     TEXT NOT NULL REFERENCES sessions(session_id),
    verified_at     TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (ok=(state_ok AND coverage_ok AND content_ok))
);

CREATE INDEX IF NOT EXISTS idx_review_export_verifications
    ON review_export_verifications(export_id, verification_id);

CREATE TABLE IF NOT EXISTS review_session_evaluations (
    evaluation_id           TEXT PRIMARY KEY,
    review_session_id       TEXT NOT NULL REFERENCES review_sessions(review_session_id) ON DELETE RESTRICT,
    verification_minutes    REAL NOT NULL CHECK (verification_minutes >= 0),
    constraint_denominator  INTEGER NOT NULL CHECK (constraint_denominator > 0),
    missed_constraint_count INTEGER NOT NULL CHECK (missed_constraint_count >= 0),
    expansion_count         INTEGER NOT NULL CHECK (expansion_count >= 0),
    satisfaction_score      INTEGER CHECK (satisfaction_score IS NULL OR satisfaction_score BETWEEN 1 AND 5),
    notes                   TEXT,
    recorded_by             TEXT NOT NULL REFERENCES sessions(session_id),
    recorded_at             TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (missed_constraint_count <= constraint_denominator)
);

CREATE TRIGGER IF NOT EXISTS review_session_payload_is_immutable
BEFORE UPDATE ON review_sessions FOR EACH ROW
WHEN OLD.review_session_id!=NEW.review_session_id
  OR OLD.composition_run_id!=NEW.composition_run_id OR OLD.impact_run_id!=NEW.impact_run_id
  OR OLD.reviewed_sha!=NEW.reviewed_sha OR OLD.item_count!=NEW.item_count
  OR OLD.actionable_count!=NEW.actionable_count OR OLD.summary_json!=NEW.summary_json
  OR OLD.summary_hash!=NEW.summary_hash OR OLD.prepared_by!=NEW.prepared_by
BEGIN SELECT RAISE(ABORT, 'review session payload is immutable'); END;
CREATE TRIGGER IF NOT EXISTS review_session_status_is_monotonic
BEFORE UPDATE OF status ON review_sessions FOR EACH ROW
WHEN NOT (OLD.status='prepared' AND NEW.status='furnished'
  AND EXISTS (SELECT 1 FROM review_session_completions
               WHERE review_session_id=OLD.review_session_id))
BEGIN SELECT RAISE(ABORT, 'review session furnishing requires completion custody'); END;
CREATE TRIGGER IF NOT EXISTS review_session_furnished_at_is_write_once
BEFORE UPDATE OF furnished_at ON review_sessions FOR EACH ROW
WHEN NOT (OLD.status='prepared' AND NEW.status='furnished'
  AND OLD.furnished_at IS NULL AND NEW.furnished_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'review session furnished timestamp is write-once'); END;
CREATE TRIGGER IF NOT EXISTS review_session_cannot_be_deleted
BEFORE DELETE ON review_sessions FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'review session cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS review_session_item_is_immutable
BEFORE UPDATE ON review_session_items FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'review session item is immutable'); END;
CREATE TRIGGER IF NOT EXISTS review_session_item_cannot_be_deleted
BEFORE DELETE ON review_session_items FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'review session item cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS review_session_item_evidence_is_immutable
BEFORE UPDATE ON review_session_item_evidence FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'review session item evidence is immutable'); END;
CREATE TRIGGER IF NOT EXISTS review_session_item_evidence_cannot_be_deleted
BEFORE DELETE ON review_session_item_evidence FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'review session item evidence cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS review_session_completion_must_reconcile
BEFORE INSERT ON review_session_completions FOR EACH ROW
BEGIN
    SELECT CASE WHEN NEW.advice_count!=json_array_length(NEW.advice_item_ids_json)
      THEN RAISE(ABORT, 'review advice count does not reconcile') END;
    SELECT CASE WHEN NEW.decision_count!=json_array_length(NEW.decisions_json)
      THEN RAISE(ABORT, 'review decision count does not reconcile') END;
    SELECT CASE WHEN NEW.accepted_count!=(
      SELECT COUNT(*) FROM json_each(NEW.decisions_json)
       WHERE json_extract(value, '$.disposition')='accepted')
      THEN RAISE(ABORT, 'review accepted-decision count does not reconcile') END;
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM json_each(NEW.advice_item_ids_json) a
       WHERE NOT EXISTS (SELECT 1 FROM review_session_items i
                          WHERE i.review_session_id=NEW.review_session_id AND i.item_id=a.value))
      THEN RAISE(ABORT, 'review advice references an unknown item') END;
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM json_each(NEW.decisions_json) d
       WHERE NOT EXISTS (SELECT 1 FROM review_session_items i
                          WHERE i.review_session_id=NEW.review_session_id
                            AND i.item_id=json_extract(d.value, '$.item_id')))
      THEN RAISE(ABORT, 'review decision references an unknown item') END;
END;
CREATE TRIGGER IF NOT EXISTS review_session_completion_is_immutable
BEFORE UPDATE ON review_session_completions FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'review session completion is immutable'); END;
CREATE TRIGGER IF NOT EXISTS review_session_completion_cannot_be_deleted
BEFORE DELETE ON review_session_completions FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'review session completion cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS review_export_is_immutable
BEFORE UPDATE ON review_exports FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'review export is immutable'); END;
CREATE TRIGGER IF NOT EXISTS review_export_cannot_be_deleted
BEFORE DELETE ON review_exports FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'review export cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS review_export_verification_is_immutable
BEFORE UPDATE ON review_export_verifications FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'review export verification is immutable'); END;
CREATE TRIGGER IF NOT EXISTS review_export_verification_cannot_be_deleted
BEFORE DELETE ON review_export_verifications FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'review export verification cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS review_export_verification_must_reconcile
BEFORE INSERT ON review_export_verifications FOR EACH ROW
WHEN NEW.mismatch_count!=json_array_length(json_extract(NEW.report_json, '$.mismatches'))
  OR NEW.state_ok!=json_extract(NEW.report_json, '$.axes.state.ok')
  OR NEW.coverage_ok!=json_extract(NEW.report_json, '$.axes.coverage.ok')
  OR NEW.content_ok!=json_extract(NEW.report_json, '$.axes.content.ok')
  OR NEW.ok!=json_extract(NEW.report_json, '$.ok')
BEGIN SELECT RAISE(ABORT, 'review export verification report does not reconcile'); END;
CREATE TRIGGER IF NOT EXISTS review_session_evaluation_is_immutable
BEFORE UPDATE ON review_session_evaluations FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'review session evaluation is immutable'); END;
CREATE TRIGGER IF NOT EXISTS review_session_evaluation_cannot_be_deleted
BEFORE DELETE ON review_session_evaluations FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'review session evaluation cannot be deleted'); END;

----------------------------------------------------------------------
-- CODEBASE BRIEF: versioned, task-bounded architecture contract
----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS codebase_brief_sources (
    source_id         TEXT PRIMARY KEY,
    review_session_id TEXT NOT NULL REFERENCES review_sessions(review_session_id) ON DELETE RESTRICT,
    reviewed_sha      TEXT NOT NULL,
    schema_version    TEXT NOT NULL CHECK (schema_version='1.0.0'),
    candidate_count   INTEGER NOT NULL CHECK (candidate_count > 0),
    source_json       TEXT NOT NULL CHECK (json_valid(source_json)),
    source_hash       TEXT NOT NULL,
    prepared_by       TEXT NOT NULL REFERENCES sessions(session_id),
    prepared_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS codebase_brief_candidates (
    source_id        TEXT NOT NULL REFERENCES codebase_brief_sources(source_id) ON DELETE RESTRICT,
    candidate_id     TEXT NOT NULL,
    category         TEXT NOT NULL CHECK (category IN (
                       'facts','direct_intent','inferred_intent','constraints',
                       'contradictions','changes','options','gaps')),
    epistemic_kind   TEXT NOT NULL CHECK (epistemic_kind IN (
                       'observed-behavior','inference','direct-intent',
                       'inferred-intent','recommendation','open-question')),
    required         INTEGER NOT NULL CHECK (required IN (0,1)),
    candidate_hash   TEXT NOT NULL,
    candidate_json   TEXT NOT NULL CHECK (json_valid(candidate_json)),
    PRIMARY KEY (source_id, candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_codebase_brief_candidates_category
    ON codebase_brief_candidates(source_id, category, candidate_id);

CREATE TABLE IF NOT EXISTS codebase_briefs (
    brief_id        TEXT PRIMARY KEY,
    source_id       TEXT NOT NULL REFERENCES codebase_brief_sources(source_id) ON DELETE RESTRICT,
    mode            TEXT NOT NULL CHECK (mode IN ('review','design','generative')),
    schema_version  TEXT NOT NULL CHECK (schema_version='1.0.0'),
    item_limit      INTEGER NOT NULL CHECK (item_limit > 0),
    included_count  INTEGER NOT NULL CHECK (included_count > 0),
    omitted_count   INTEGER NOT NULL CHECK (omitted_count >= 0),
    brief_json      TEXT NOT NULL CHECK (json_valid(brief_json)),
    brief_hash      TEXT NOT NULL,
    compiled_by     TEXT NOT NULL REFERENCES sessions(session_id),
    compiled_at     TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (source_id, mode, brief_id)
);

CREATE TABLE IF NOT EXISTS codebase_brief_validations (
    validation_id INTEGER PRIMARY KEY,
    brief_id      TEXT NOT NULL REFERENCES codebase_briefs(brief_id) ON DELETE RESTRICT,
    input_hash    TEXT NOT NULL,
    schema_ok     INTEGER NOT NULL CHECK (schema_ok IN (0,1)),
    semantic_ok   INTEGER NOT NULL CHECK (semantic_ok IN (0,1)),
    error_count   INTEGER NOT NULL CHECK (error_count >= 0),
    report_json   TEXT NOT NULL CHECK (json_valid(report_json)),
    validated_by  TEXT NOT NULL REFERENCES sessions(session_id),
    validated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER IF NOT EXISTS codebase_brief_source_is_immutable
BEFORE UPDATE ON codebase_brief_sources FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'CodebaseBrief source is immutable'); END;
CREATE TRIGGER IF NOT EXISTS codebase_brief_source_cannot_be_deleted
BEFORE DELETE ON codebase_brief_sources FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'CodebaseBrief source cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS codebase_brief_candidate_is_immutable
BEFORE UPDATE ON codebase_brief_candidates FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'CodebaseBrief candidate is immutable'); END;
CREATE TRIGGER IF NOT EXISTS codebase_brief_candidate_cannot_be_deleted
BEFORE DELETE ON codebase_brief_candidates FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'CodebaseBrief candidate cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS codebase_brief_is_immutable
BEFORE UPDATE ON codebase_briefs FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'CodebaseBrief is immutable'); END;
CREATE TRIGGER IF NOT EXISTS codebase_brief_cannot_be_deleted
BEFORE DELETE ON codebase_briefs FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'CodebaseBrief cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS codebase_brief_validation_is_immutable
BEFORE UPDATE ON codebase_brief_validations FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'CodebaseBrief validation is immutable'); END;
CREATE TRIGGER IF NOT EXISTS codebase_brief_validation_cannot_be_deleted
BEFORE DELETE ON codebase_brief_validations FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'CodebaseBrief validation cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS codebase_brief_source_must_reconcile
BEFORE INSERT ON codebase_brief_sources FOR EACH ROW
WHEN NEW.candidate_count!=json_array_length(json_extract(NEW.source_json, '$.candidates'))
  OR NEW.source_hash!=json_extract(NEW.source_json, '$.source_hash')
  OR NEW.review_session_id!=json_extract(NEW.source_json, '$.review_session_id')
  OR NEW.reviewed_sha!=json_extract(NEW.source_json, '$.reviewed_sha')
BEGIN SELECT RAISE(ABORT, 'CodebaseBrief source does not reconcile'); END;
CREATE TRIGGER IF NOT EXISTS codebase_brief_must_reconcile
BEFORE INSERT ON codebase_briefs FOR EACH ROW
WHEN NEW.included_count!=json_extract(NEW.brief_json, '$.budget.selected_count')
  OR NEW.omitted_count!=json_extract(NEW.brief_json, '$.budget.omitted_count')
  OR NEW.source_id!=json_extract(NEW.brief_json, '$.source.source_id')
  OR NEW.mode!=json_extract(NEW.brief_json, '$.mode')
BEGIN SELECT RAISE(ABORT, 'CodebaseBrief projection does not reconcile'); END;
CREATE TRIGGER IF NOT EXISTS codebase_brief_validation_must_reconcile
BEFORE INSERT ON codebase_brief_validations FOR EACH ROW
WHEN NEW.semantic_ok!=json_extract(NEW.report_json, '$.ok')
  OR NEW.error_count!=json_array_length(json_extract(NEW.report_json, '$.errors'))
BEGIN SELECT RAISE(ABORT, 'CodebaseBrief validation does not reconcile'); END;

----------------------------------------------------------------------
-- DESIGN SESSIONS: independent dialectical lenses and advice-only lean
----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS design_sessions (
    design_session_id        TEXT PRIMARY KEY,
    source_id                TEXT NOT NULL REFERENCES codebase_brief_sources(source_id) ON DELETE RESTRICT,
    source_hash              TEXT NOT NULL,
    status                   TEXT NOT NULL DEFAULT 'planned' CHECK (status IN (
                               'planned','collecting','ready-to-aggregate',
                               'aggregated','underdetermined')),
    desire_count             INTEGER NOT NULL CHECK (desire_count > 0),
    conflict_count           INTEGER NOT NULL CHECK (conflict_count >= 0),
    expected_lens_count      INTEGER NOT NULL DEFAULT 3 CHECK (expected_lens_count=3),
    orchestrator_model_family TEXT NOT NULL,
    plan_json                TEXT NOT NULL CHECK (json_valid(plan_json)),
    plan_hash                TEXT NOT NULL,
    planned_by               TEXT NOT NULL REFERENCES sessions(session_id),
    planned_at               TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at             TEXT
);

CREATE TABLE IF NOT EXISTS design_desires (
    design_session_id TEXT NOT NULL REFERENCES design_sessions(design_session_id) ON DELETE RESTRICT,
    desire_id         TEXT NOT NULL,
    statement         TEXT NOT NULL,
    priority          INTEGER CHECK (priority IS NULL OR priority BETWEEN 1 AND 5),
    exclusive_group   TEXT,
    source_ref        TEXT NOT NULL,
    PRIMARY KEY (design_session_id, desire_id)
);

CREATE TABLE IF NOT EXISTS design_lenses (
    design_session_id TEXT NOT NULL REFERENCES design_sessions(design_session_id) ON DELETE RESTRICT,
    lens              TEXT NOT NULL CHECK (lens IN ('immanent','adversarial','speculative')),
    brief_id          TEXT NOT NULL REFERENCES codebase_briefs(brief_id) ON DELETE RESTRICT,
    provider          TEXT NOT NULL,
    model             TEXT NOT NULL,
    model_family      TEXT NOT NULL,
    context_profile   TEXT NOT NULL CHECK (context_profile IN (
                         'existing-trajectory','constraint-challenge','adjacent-possible')),
    status            TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','dispatched','landed')),
    packet_json       TEXT NOT NULL CHECK (json_valid(packet_json)),
    packet_hash       TEXT NOT NULL,
    observed_packet_hash TEXT,
    output_json       TEXT CHECK (output_json IS NULL OR json_valid(output_json)),
    output_hash       TEXT,
    dispatched_at     TEXT,
    landed_at         TEXT,
    PRIMARY KEY (design_session_id, lens)
);

CREATE TABLE IF NOT EXISTS design_options (
    design_session_id TEXT NOT NULL,
    lens              TEXT NOT NULL,
    option_key        TEXT NOT NULL,
    summary           TEXT NOT NULL,
    preserves_json    TEXT NOT NULL CHECK (json_valid(preserves_json)),
    rejects_json      TEXT NOT NULL CHECK (json_valid(rejects_json)),
    enables_json      TEXT NOT NULL CHECK (json_valid(enables_json)),
    forecloses_json   TEXT NOT NULL CHECK (json_valid(forecloses_json)),
    migration_cost_json TEXT NOT NULL CHECK (json_valid(migration_cost_json)),
    reversibility_json TEXT NOT NULL CHECK (json_valid(reversibility_json)),
    evidence_item_ids_json TEXT NOT NULL CHECK (json_valid(evidence_item_ids_json)),
    evidence_gaps_json TEXT NOT NULL CHECK (json_valid(evidence_gaps_json)),
    falsifiers_json   TEXT NOT NULL CHECK (json_valid(falsifiers_json)),
    research_needs_json TEXT NOT NULL CHECK (json_valid(research_needs_json)),
    constraint_preservation REAL NOT NULL CHECK (constraint_preservation BETWEEN 0 AND 1),
    PRIMARY KEY (design_session_id, lens, option_key),
    FOREIGN KEY (design_session_id, lens)
      REFERENCES design_lenses(design_session_id, lens) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS design_aggregations (
    design_session_id    TEXT PRIMARY KEY REFERENCES design_sessions(design_session_id) ON DELETE RESTRICT,
    status               TEXT NOT NULL CHECK (status IN ('qualified','underdetermined')),
    option_count         INTEGER NOT NULL CHECK (option_count > 0),
    disagreement_count   INTEGER NOT NULL CHECK (disagreement_count >= 0),
    matrix_json          TEXT NOT NULL CHECK (json_valid(matrix_json)),
    lean_json            TEXT CHECK (lean_json IS NULL OR json_valid(lean_json)),
    missing_desires_json TEXT NOT NULL CHECK (json_valid(missing_desires_json)),
    result_json          TEXT NOT NULL CHECK (json_valid(result_json)),
    result_hash          TEXT NOT NULL,
    aggregated_by        TEXT NOT NULL REFERENCES sessions(session_id),
    aggregated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK ((status='qualified' AND lean_json IS NOT NULL)
        OR (status='underdetermined' AND lean_json IS NULL))
);

CREATE TABLE IF NOT EXISTS design_evaluation_packets (
    packet_id          TEXT PRIMARY KEY,
    design_session_id  TEXT NOT NULL REFERENCES design_sessions(design_session_id) ON DELETE RESTRICT,
    condition          TEXT NOT NULL CHECK (condition IN ('clean','marker-only','treated','null')),
    replicate_id       TEXT NOT NULL,
    blind_label        TEXT NOT NULL UNIQUE,
    packet_json        TEXT NOT NULL CHECK (json_valid(packet_json)),
    packet_hash        TEXT NOT NULL,
    canary_terms_json  TEXT NOT NULL CHECK (json_valid(canary_terms_json)),
    content_canary_ok  INTEGER NOT NULL CHECK (content_canary_ok IN (0,1)),
    prepared_by        TEXT NOT NULL REFERENCES sessions(session_id),
    prepared_at        TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (design_session_id, condition, replicate_id)
);

CREATE TRIGGER IF NOT EXISTS design_session_payload_is_immutable
BEFORE UPDATE ON design_sessions FOR EACH ROW
WHEN OLD.design_session_id!=NEW.design_session_id OR OLD.source_id!=NEW.source_id
  OR OLD.source_hash!=NEW.source_hash OR OLD.desire_count!=NEW.desire_count
  OR OLD.conflict_count!=NEW.conflict_count OR OLD.expected_lens_count!=NEW.expected_lens_count
  OR OLD.orchestrator_model_family!=NEW.orchestrator_model_family
  OR OLD.plan_json!=NEW.plan_json OR OLD.plan_hash!=NEW.plan_hash
BEGIN SELECT RAISE(ABORT, 'design session plan is immutable'); END;
CREATE TRIGGER IF NOT EXISTS design_session_status_is_monotonic
BEFORE UPDATE OF status ON design_sessions FOR EACH ROW
WHEN NOT ((OLD.status='planned' AND NEW.status='collecting')
  OR (OLD.status='collecting' AND NEW.status='ready-to-aggregate')
  OR (OLD.status='ready-to-aggregate' AND NEW.status IN ('aggregated','underdetermined')))
BEGIN SELECT RAISE(ABORT, 'invalid design session status transition'); END;
CREATE TRIGGER IF NOT EXISTS design_session_cannot_be_deleted
BEFORE DELETE ON design_sessions FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'design session cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS design_desire_is_immutable
BEFORE UPDATE ON design_desires FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'design desire is immutable'); END;
CREATE TRIGGER IF NOT EXISTS design_desire_cannot_be_deleted
BEFORE DELETE ON design_desires FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'design desire cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS design_lens_payload_is_immutable
BEFORE UPDATE ON design_lenses FOR EACH ROW
WHEN OLD.design_session_id!=NEW.design_session_id OR OLD.lens!=NEW.lens
  OR OLD.brief_id!=NEW.brief_id OR OLD.provider!=NEW.provider OR OLD.model!=NEW.model
  OR OLD.model_family!=NEW.model_family OR OLD.context_profile!=NEW.context_profile
  OR OLD.packet_json!=NEW.packet_json OR OLD.packet_hash!=NEW.packet_hash
BEGIN SELECT RAISE(ABORT, 'design lens plan is immutable'); END;
CREATE TRIGGER IF NOT EXISTS design_lens_dispatch_must_reconcile
BEFORE UPDATE OF status ON design_lenses FOR EACH ROW
WHEN NEW.status='dispatched' AND NOT (OLD.status='planned'
  AND NEW.observed_packet_hash=OLD.packet_hash AND NEW.dispatched_at IS NOT NULL
  AND NEW.output_json IS NULL AND NEW.output_hash IS NULL)
BEGIN SELECT RAISE(ABORT, 'design lens dispatch does not reconcile'); END;
CREATE TRIGGER IF NOT EXISTS design_lens_land_must_reconcile
BEFORE UPDATE OF status ON design_lenses FOR EACH ROW
WHEN NEW.status='landed' AND NOT (OLD.status='dispatched'
  AND NEW.observed_packet_hash=OLD.packet_hash AND NEW.output_json IS NOT NULL
  AND NEW.output_hash IS NOT NULL AND NEW.landed_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'design lens landing does not reconcile'); END;
CREATE TRIGGER IF NOT EXISTS design_lens_cannot_be_deleted
BEFORE DELETE ON design_lenses FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'design lens cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS design_option_is_immutable
BEFORE UPDATE ON design_options FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'design option is immutable'); END;
CREATE TRIGGER IF NOT EXISTS design_option_cannot_be_deleted
BEFORE DELETE ON design_options FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'design option cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS design_aggregation_is_immutable
BEFORE UPDATE ON design_aggregations FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'design aggregation is immutable'); END;
CREATE TRIGGER IF NOT EXISTS design_aggregation_cannot_be_deleted
BEFORE DELETE ON design_aggregations FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'design aggregation cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS design_aggregation_must_reconcile
BEFORE INSERT ON design_aggregations FOR EACH ROW
WHEN NEW.option_count!=json_array_length(json_extract(NEW.matrix_json, '$.options'))
  OR NEW.disagreement_count!=json_array_length(json_extract(NEW.matrix_json, '$.disagreements'))
  OR NEW.status!=json_extract(NEW.result_json, '$.status')
BEGIN SELECT RAISE(ABORT, 'design aggregation does not reconcile'); END;
CREATE TRIGGER IF NOT EXISTS design_evaluation_packet_is_immutable
BEFORE UPDATE ON design_evaluation_packets FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'design evaluation packet is immutable'); END;
CREATE TRIGGER IF NOT EXISTS design_evaluation_packet_cannot_be_deleted
BEFORE DELETE ON design_evaluation_packets FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'design evaluation packet cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS design_evaluation_packet_must_be_blind
BEFORE INSERT ON design_evaluation_packets FOR EACH ROW
WHEN NEW.content_canary_ok!=1
  OR json_type(NEW.packet_json, '$.condition') IS NOT NULL
  OR json_type(NEW.packet_json, '$.design_session_id') IS NOT NULL
  OR json_type(NEW.packet_json, '$.lens') IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'design evaluation packet is not blind'); END;

----------------------------------------------------------------------
-- DECISIONS: human acceptance, immutable revisions, consequence custody
----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS decisions (
    decision_id        TEXT PRIMARY KEY,
    title              TEXT NOT NULL,
    current_revision_id TEXT,
    created_by         TEXT NOT NULL REFERENCES sessions(session_id),
    created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS decision_revisions (
    revision_id        TEXT PRIMARY KEY,
    decision_id        TEXT NOT NULL REFERENCES decisions(decision_id) ON DELETE RESTRICT,
    revision_number    INTEGER NOT NULL CHECK (revision_number > 0),
    predecessor_revision_id TEXT REFERENCES decision_revisions(revision_id) ON DELETE RESTRICT,
    design_session_id  TEXT REFERENCES design_sessions(design_session_id) ON DELETE RESTRICT,
    status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                           'draft','accepted','rejected','superseded','invalidated')),
    desire_sources_json TEXT NOT NULL CHECK (json_valid(desire_sources_json)),
    accepted_option_json TEXT NOT NULL CHECK (json_valid(accepted_option_json)),
    alternatives_json  TEXT NOT NULL CHECK (json_valid(alternatives_json)),
    constraints_json   TEXT NOT NULL CHECK (json_valid(constraints_json)),
    consequences_json  TEXT NOT NULL CHECK (json_valid(consequences_json)),
    falsifiers_json    TEXT NOT NULL CHECK (json_valid(falsifiers_json)),
    premises_json      TEXT NOT NULL CHECK (json_valid(premises_json)),
    code_changes_json  TEXT NOT NULL CHECK (json_valid(code_changes_json)),
    rationale          TEXT NOT NULL,
    authored_by_kind   TEXT NOT NULL CHECK (authored_by_kind IN ('model','human','owning-system')),
    authored_by        TEXT NOT NULL,
    payload_hash       TEXT NOT NULL,
    created_by         TEXT NOT NULL REFERENCES sessions(session_id),
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    terminal_at        TEXT,
    UNIQUE (decision_id, revision_number)
);

CREATE TABLE IF NOT EXISTS decision_events (
    event_id           INTEGER PRIMARY KEY,
    revision_id        TEXT NOT NULL REFERENCES decision_revisions(revision_id) ON DELETE RESTRICT,
    event_type         TEXT NOT NULL CHECK (event_type IN (
                           'drafted','accepted','rejected','superseded','invalidated','impact-detected')),
    actor_kind         TEXT NOT NULL CHECK (actor_kind IN ('model','human','owning-system','amanuensis')),
    actor_id           TEXT NOT NULL,
    authority_scope    TEXT,
    reason             TEXT NOT NULL,
    evidence_id        INTEGER REFERENCES evidence(id) ON DELETE RESTRICT,
    impact_run_id      TEXT REFERENCES change_impact_runs(run_id) ON DELETE RESTRICT,
    detail_json        TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json)),
    created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS decision_projections (
    projection_id      TEXT PRIMARY KEY,
    revision_id        TEXT NOT NULL REFERENCES decision_revisions(revision_id) ON DELETE RESTRICT,
    schema_version     TEXT NOT NULL CHECK (schema_version='1.0.0'),
    projection_json    TEXT NOT NULL CHECK (json_valid(projection_json)),
    projection_hash    TEXT NOT NULL,
    projected_by       TEXT NOT NULL REFERENCES sessions(session_id),
    projected_at       TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (revision_id, projection_id)
);

CREATE TABLE IF NOT EXISTS decision_projection_verifications (
    verification_id   INTEGER PRIMARY KEY,
    projection_id     TEXT NOT NULL REFERENCES decision_projections(projection_id) ON DELETE RESTRICT,
    state_ok           INTEGER NOT NULL CHECK (state_ok IN (0,1)),
    coverage_ok        INTEGER NOT NULL CHECK (coverage_ok IN (0,1)),
    content_ok         INTEGER NOT NULL CHECK (content_ok IN (0,1)),
    ok                 INTEGER NOT NULL CHECK (ok IN (0,1)),
    report_json        TEXT NOT NULL CHECK (json_valid(report_json)),
    verified_by        TEXT NOT NULL REFERENCES sessions(session_id),
    verified_at        TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (ok=(state_ok AND coverage_ok AND content_ok))
);

CREATE TRIGGER IF NOT EXISTS decision_identity_is_immutable
BEFORE UPDATE ON decisions FOR EACH ROW
WHEN OLD.decision_id!=NEW.decision_id OR OLD.title!=NEW.title OR OLD.created_by!=NEW.created_by
BEGIN SELECT RAISE(ABORT, 'decision identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS decision_cannot_be_deleted
BEFORE DELETE ON decisions FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'decision cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS decision_current_revision_must_be_accepted
BEFORE UPDATE OF current_revision_id ON decisions FOR EACH ROW
WHEN NEW.current_revision_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM decision_revisions r
   WHERE r.revision_id=NEW.current_revision_id
     AND r.decision_id=NEW.decision_id AND r.status='accepted')
BEGIN SELECT RAISE(ABORT, 'decision current authority must reference an accepted revision'); END;
CREATE TRIGGER IF NOT EXISTS decision_revision_payload_is_immutable
BEFORE UPDATE ON decision_revisions FOR EACH ROW
WHEN OLD.revision_id!=NEW.revision_id OR OLD.decision_id!=NEW.decision_id
  OR OLD.revision_number!=NEW.revision_number
  OR COALESCE(OLD.predecessor_revision_id,'')!=COALESCE(NEW.predecessor_revision_id,'')
  OR COALESCE(OLD.design_session_id,'')!=COALESCE(NEW.design_session_id,'')
  OR OLD.desire_sources_json!=NEW.desire_sources_json
  OR OLD.accepted_option_json!=NEW.accepted_option_json
  OR OLD.alternatives_json!=NEW.alternatives_json
  OR OLD.constraints_json!=NEW.constraints_json
  OR OLD.consequences_json!=NEW.consequences_json
  OR OLD.falsifiers_json!=NEW.falsifiers_json OR OLD.premises_json!=NEW.premises_json
  OR OLD.code_changes_json!=NEW.code_changes_json OR OLD.rationale!=NEW.rationale
  OR OLD.authored_by_kind!=NEW.authored_by_kind OR OLD.authored_by!=NEW.authored_by
  OR OLD.payload_hash!=NEW.payload_hash OR OLD.created_by!=NEW.created_by
BEGIN SELECT RAISE(ABORT, 'decision revision payload is immutable'); END;
CREATE TRIGGER IF NOT EXISTS decision_revision_status_is_monotonic
BEFORE UPDATE OF status ON decision_revisions FOR EACH ROW
WHEN NOT ((OLD.status='draft' AND NEW.status IN ('accepted','rejected'))
  OR (OLD.status='accepted' AND NEW.status IN ('superseded','invalidated')))
BEGIN SELECT RAISE(ABORT, 'invalid decision revision status transition'); END;
CREATE TRIGGER IF NOT EXISTS decision_revision_acceptance_requires_event
BEFORE UPDATE OF status ON decision_revisions FOR EACH ROW
WHEN NEW.status='accepted' AND (
  NEW.terminal_at IS NULL OR NOT EXISTS (
    SELECT 1 FROM decision_events e
     WHERE e.revision_id=OLD.revision_id AND e.event_type='accepted'
       AND e.actor_kind IN ('human','owning-system')
       AND e.authority_scope IS NOT NULL AND length(e.authority_scope)>0))
BEGIN SELECT RAISE(ABORT, 'decision acceptance transition lacks authorized event'); END;
CREATE TRIGGER IF NOT EXISTS decision_revision_cannot_be_deleted
BEFORE DELETE ON decision_revisions FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'decision revision cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS decision_event_is_immutable
BEFORE UPDATE ON decision_events FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'decision event is immutable'); END;
CREATE TRIGGER IF NOT EXISTS decision_event_cannot_be_deleted
BEFORE DELETE ON decision_events FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'decision event cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS decision_acceptance_requires_authority
BEFORE INSERT ON decision_events FOR EACH ROW
WHEN NEW.event_type='accepted' AND (
  NEW.actor_kind NOT IN ('human','owning-system')
  OR NEW.authority_scope IS NULL OR length(NEW.authority_scope)=0
  OR NEW.authority_scope NOT IN (
    SELECT r.decision_id FROM decision_revisions r WHERE r.revision_id=NEW.revision_id
    UNION ALL
    SELECT r.decision_id || ':' || r.revision_id
      FROM decision_revisions r WHERE r.revision_id=NEW.revision_id))
BEGIN SELECT RAISE(ABORT, 'decision acceptance requires explicit human or owning-system authority'); END;
CREATE TRIGGER IF NOT EXISTS decision_projection_is_immutable
BEFORE UPDATE ON decision_projections FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'decision projection is immutable'); END;
CREATE TRIGGER IF NOT EXISTS decision_projection_cannot_be_deleted
BEFORE DELETE ON decision_projections FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'decision projection cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS decision_projection_verification_is_immutable
BEFORE UPDATE ON decision_projection_verifications FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'decision projection verification is immutable'); END;
CREATE TRIGGER IF NOT EXISTS decision_projection_verification_cannot_be_deleted
BEFORE DELETE ON decision_projection_verifications FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'decision projection verification cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS decision_projection_verification_must_reconcile
BEFORE INSERT ON decision_projection_verifications FOR EACH ROW
WHEN NEW.state_ok!=json_extract(NEW.report_json, '$.axes.state.ok')
  OR NEW.coverage_ok!=json_extract(NEW.report_json, '$.axes.coverage.ok')
  OR NEW.content_ok!=json_extract(NEW.report_json, '$.axes.content.ok')
  OR NEW.ok!=json_extract(NEW.report_json, '$.ok')
BEGIN SELECT RAISE(ABORT, 'decision projection verification does not reconcile'); END;

----------------------------------------------------------------------
-- RESEARCH BROKER: admitted questions and external-claim custody
----------------------------------------------------------------------
-- A research request is a decision-support object, not a curiosity feed.
-- Rejected/deferred requests are retained so duplicate and backlog metrics
-- include the denominator. External testimony is stored in a separate table
-- from repository-backed `claims`; importing research can therefore challenge
-- a code observation but cannot silently replace it.

CREATE TABLE IF NOT EXISTS research_requests (
    request_id             TEXT PRIMARY KEY,
    schema_version         TEXT NOT NULL CHECK (schema_version='1.0.0'),
    question               TEXT NOT NULL,
    question_fingerprint   TEXT NOT NULL,
    decision_id            TEXT REFERENCES decisions(decision_id) ON DELETE RESTRICT,
    decision_revision_id   TEXT REFERENCES decision_revisions(revision_id) ON DELETE RESTRICT,
    destination_field      TEXT CHECK (destination_field IN (
                               'premise','accepted-option','alternative','constraint',
                               'consequence','falsifier','review-hypothesis')),
    destination_ref        TEXT,
    current_evidence_json  TEXT NOT NULL CHECK (json_valid(current_evidence_json)),
    uncertainty            TEXT NOT NULL,
    needed_source_classes_json TEXT NOT NULL CHECK (json_valid(needed_source_classes_json)),
    disconfirmers_json     TEXT NOT NULL CHECK (json_valid(disconfirmers_json)),
    budget_json            TEXT NOT NULL CHECK (json_valid(budget_json)),
    local_search_json      TEXT NOT NULL CHECK (json_valid(local_search_json)),
    decision_sensitivity   INTEGER NOT NULL CHECK (decision_sensitivity BETWEEN 1 AND 5),
    uncertainty_reducibility INTEGER NOT NULL CHECK (uncertainty_reducibility BETWEEN 1 AND 5),
    expected_value_score   INTEGER NOT NULL CHECK (
                               expected_value_score=decision_sensitivity*uncertainty_reducibility),
    changed_premise_refs_json TEXT NOT NULL DEFAULT '[]'
                               CHECK (json_valid(changed_premise_refs_json)),
    duplicate_of           TEXT REFERENCES research_requests(request_id) ON DELETE RESTRICT,
    admission_reasons_json TEXT NOT NULL CHECK (json_valid(admission_reasons_json)),
    contract_json          TEXT NOT NULL CHECK (json_valid(contract_json)),
    contract_hash          TEXT NOT NULL,
    status                 TEXT NOT NULL CHECK (status IN (
                               'rejected','deferred','admitted','dispatched',
                               'landed','consumed','expired')),
    blocking               INTEGER NOT NULL DEFAULT 0 CHECK (blocking IN (0,1)),
    created_by             TEXT NOT NULL REFERENCES sessions(session_id),
    created_at             TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
    terminal_at            TEXT,
    CHECK ((decision_id IS NULL)=(decision_revision_id IS NULL)),
    CHECK ((decision_id IS NULL)=(destination_field IS NULL)),
    CHECK ((decision_id IS NULL)=(destination_ref IS NULL)),
    CHECK (status NOT IN ('admitted','dispatched','landed','consumed') OR decision_id IS NOT NULL),
    CHECK (status!='rejected' OR blocking=0)
);

CREATE INDEX IF NOT EXISTS idx_research_requests_queue
    ON research_requests(status, blocking, created_at);
CREATE INDEX IF NOT EXISTS idx_research_requests_destination
    ON research_requests(decision_revision_id, destination_field, destination_ref);
CREATE INDEX IF NOT EXISTS idx_research_requests_fingerprint
    ON research_requests(question_fingerprint, decision_revision_id, destination_field, destination_ref);

CREATE TABLE IF NOT EXISTS research_request_events (
    event_id        INTEGER PRIMARY KEY,
    request_id      TEXT NOT NULL REFERENCES research_requests(request_id) ON DELETE RESTRICT,
    from_state      TEXT CHECK (from_state IS NULL OR from_state IN (
                        'rejected','deferred','admitted','dispatched','landed','consumed','expired')),
    to_state        TEXT NOT NULL CHECK (to_state IN (
                        'rejected','deferred','admitted','dispatched','landed','consumed','expired')),
    reason          TEXT NOT NULL,
    detail_json     TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json)),
    actor           TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_research_request_events
    ON research_request_events(request_id, event_id);

CREATE TABLE IF NOT EXISTS research_dispatches (
    dispatch_id         TEXT PRIMARY KEY,
    request_id          TEXT NOT NULL UNIQUE REFERENCES research_requests(request_id) ON DELETE RESTRICT,
    workspace_path      TEXT NOT NULL,
    required_output_path TEXT NOT NULL,
    handoff_json        TEXT NOT NULL CHECK (json_valid(handoff_json)),
    handoff_hash        TEXT NOT NULL,
    dispatched_by      TEXT NOT NULL REFERENCES sessions(session_id),
    dispatched_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS research_results (
    result_id        TEXT PRIMARY KEY,
    request_id       TEXT NOT NULL UNIQUE REFERENCES research_requests(request_id) ON DELETE RESTRICT,
    schema_version   TEXT NOT NULL CHECK (schema_version='1.0.0'),
    result_json      TEXT NOT NULL CHECK (json_valid(result_json)),
    result_hash      TEXT NOT NULL,
    landed_by        TEXT NOT NULL REFERENCES sessions(session_id),
    landed_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS research_sources (
    result_id        TEXT NOT NULL REFERENCES research_results(result_id) ON DELETE RESTRICT,
    source_id        TEXT NOT NULL,
    title            TEXT NOT NULL,
    locator          TEXT NOT NULL,
    source_class     TEXT NOT NULL,
    access_status    TEXT NOT NULL CHECK (access_status IN (
                         'directly-read','snippet','via-agent','unread-hop','inaccessible')),
    held_excerpt     TEXT,
    limitation      TEXT NOT NULL,
    PRIMARY KEY (result_id, source_id)
);

CREATE TABLE IF NOT EXISTS research_external_claims (
    external_claim_id TEXT PRIMARY KEY,
    result_id         TEXT NOT NULL REFERENCES research_results(result_id) ON DELETE RESTRICT,
    statement         TEXT NOT NULL,
    classification    TEXT NOT NULL CHECK (classification IN (
                          'established','contested','underdetermined','inferred','open-question')),
    confidence        TEXT NOT NULL CHECK (confidence IN (
                          'verified','corroborated','single-source','inferred','unverified')),
    source_ids_json   TEXT NOT NULL CHECK (json_valid(source_ids_json)),
    chain_degradation INTEGER NOT NULL CHECK (chain_degradation BETWEEN 0 AND 3),
    target_kind       TEXT NOT NULL CHECK (target_kind IN (
                          'hypothesis','option','decision-premise','confidence-reason')),
    target_ref        TEXT NOT NULL,
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_research_external_claims_result
    ON research_external_claims(result_id);

CREATE TABLE IF NOT EXISTS research_code_contradictions (
    contradiction_id INTEGER PRIMARY KEY,
    external_claim_id TEXT NOT NULL REFERENCES research_external_claims(external_claim_id) ON DELETE RESTRICT,
    code_claim_id     TEXT NOT NULL REFERENCES claims(claim_id) ON DELETE RESTRICT,
    status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','scope-distinction')),
    resolution_note   TEXT,
    detected_at       TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at       TEXT,
    UNIQUE (external_claim_id, code_claim_id),
    CHECK (status='open' OR resolution_note IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS research_consumptions (
    consumption_id   TEXT PRIMARY KEY,
    request_id       TEXT NOT NULL UNIQUE REFERENCES research_requests(request_id) ON DELETE RESTRICT,
    result_id        TEXT NOT NULL UNIQUE REFERENCES research_results(result_id) ON DELETE RESTRICT,
    effect_kind      TEXT NOT NULL CHECK (effect_kind IN (
                         'hypothesis','option','decision-premise','confidence-reason','no-change')),
    target_ref       TEXT,
    effect_statement TEXT,
    no_change_reason TEXT,
    consumed_by      TEXT NOT NULL REFERENCES sessions(session_id),
    consumed_at      TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK ((effect_kind='no-change' AND target_ref IS NULL
            AND effect_statement IS NULL AND no_change_reason IS NOT NULL)
        OR (effect_kind!='no-change' AND target_ref IS NOT NULL
            AND effect_statement IS NOT NULL AND no_change_reason IS NULL))
);

CREATE TRIGGER IF NOT EXISTS research_request_payload_is_immutable
BEFORE UPDATE ON research_requests FOR EACH ROW
WHEN OLD.request_id!=NEW.request_id OR OLD.schema_version!=NEW.schema_version
  OR OLD.question!=NEW.question OR OLD.question_fingerprint!=NEW.question_fingerprint
  OR COALESCE(OLD.decision_id,'')!=COALESCE(NEW.decision_id,'')
  OR COALESCE(OLD.decision_revision_id,'')!=COALESCE(NEW.decision_revision_id,'')
  OR COALESCE(OLD.destination_field,'')!=COALESCE(NEW.destination_field,'')
  OR COALESCE(OLD.destination_ref,'')!=COALESCE(NEW.destination_ref,'')
  OR OLD.current_evidence_json!=NEW.current_evidence_json OR OLD.uncertainty!=NEW.uncertainty
  OR OLD.needed_source_classes_json!=NEW.needed_source_classes_json
  OR OLD.disconfirmers_json!=NEW.disconfirmers_json OR OLD.budget_json!=NEW.budget_json
  OR OLD.local_search_json!=NEW.local_search_json
  OR OLD.decision_sensitivity!=NEW.decision_sensitivity
  OR OLD.uncertainty_reducibility!=NEW.uncertainty_reducibility
  OR OLD.expected_value_score!=NEW.expected_value_score
  OR OLD.changed_premise_refs_json!=NEW.changed_premise_refs_json
  OR COALESCE(OLD.duplicate_of,'')!=COALESCE(NEW.duplicate_of,'')
  OR OLD.admission_reasons_json!=NEW.admission_reasons_json
  OR OLD.contract_json!=NEW.contract_json OR OLD.contract_hash!=NEW.contract_hash
  OR OLD.blocking!=NEW.blocking OR OLD.created_by!=NEW.created_by
BEGIN SELECT RAISE(ABORT, 'research request payload is immutable'); END;

CREATE TRIGGER IF NOT EXISTS research_request_initial_state_is_admission_only
BEFORE INSERT ON research_requests FOR EACH ROW
WHEN NEW.status NOT IN ('rejected','deferred','admitted')
BEGIN SELECT RAISE(ABORT, 'research request must enter through admission'); END;
CREATE TRIGGER IF NOT EXISTS research_request_rejection_is_terminal
BEFORE INSERT ON research_requests FOR EACH ROW
WHEN NEW.status='rejected' AND NEW.terminal_at IS NULL
BEGIN SELECT RAISE(ABORT, 'rejected research request requires terminal timestamp'); END;

CREATE TRIGGER IF NOT EXISTS research_request_terminal_timestamp_is_derived
BEFORE UPDATE OF terminal_at ON research_requests FOR EACH ROW
WHEN NOT (OLD.status!=NEW.status AND NEW.status IN ('consumed','expired')
          AND NEW.terminal_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'research request terminal timestamp is derived from terminal transition'); END;

CREATE TRIGGER IF NOT EXISTS research_request_status_transition_is_valid
BEFORE UPDATE OF status ON research_requests FOR EACH ROW
WHEN NOT (
     (OLD.status='admitted' AND NEW.status IN ('dispatched','deferred','expired'))
  OR (OLD.status='deferred' AND NEW.status IN ('admitted','expired'))
  OR (OLD.status='dispatched' AND NEW.status IN ('landed','expired'))
  OR (OLD.status='landed' AND NEW.status IN ('consumed','expired')))
BEGIN SELECT RAISE(ABORT, 'invalid research request status transition'); END;
CREATE TRIGGER IF NOT EXISTS research_request_terminal_status_requires_timestamp
BEFORE UPDATE OF status ON research_requests FOR EACH ROW
WHEN NEW.status IN ('consumed','expired') AND NEW.terminal_at IS NULL
BEGIN SELECT RAISE(ABORT, 'terminal research request requires terminal timestamp'); END;

CREATE TRIGGER IF NOT EXISTS research_request_transition_requires_event
BEFORE UPDATE OF status ON research_requests FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM research_request_events e
   WHERE e.request_id=OLD.request_id AND e.from_state=OLD.status AND e.to_state=NEW.status)
BEGIN SELECT RAISE(ABORT, 'research request transition lacks event'); END;

CREATE TRIGGER IF NOT EXISTS research_request_transition_requires_custody
BEFORE UPDATE OF status ON research_requests FOR EACH ROW
WHEN (NEW.status='dispatched' AND NOT EXISTS (
        SELECT 1 FROM research_dispatches d WHERE d.request_id=OLD.request_id))
  OR (NEW.status='landed' AND NOT EXISTS (
        SELECT 1 FROM research_results r WHERE r.request_id=OLD.request_id))
  OR (NEW.status='consumed' AND NOT EXISTS (
        SELECT 1 FROM research_consumptions c WHERE c.request_id=OLD.request_id))
BEGIN SELECT RAISE(ABORT, 'research request transition lacks durable custody object'); END;

CREATE TRIGGER IF NOT EXISTS research_request_cannot_be_deleted
BEFORE DELETE ON research_requests FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'research request cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS research_request_event_is_immutable
BEFORE UPDATE ON research_request_events FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'research request event is immutable'); END;
CREATE TRIGGER IF NOT EXISTS research_request_event_cannot_be_deleted
BEFORE DELETE ON research_request_events FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'research request event cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS research_dispatch_is_immutable
BEFORE UPDATE ON research_dispatches FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'research dispatch is immutable'); END;
CREATE TRIGGER IF NOT EXISTS research_dispatch_requires_admission
BEFORE INSERT ON research_dispatches FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM research_requests r WHERE r.request_id=NEW.request_id AND r.status='admitted')
BEGIN SELECT RAISE(ABORT, 'research dispatch requires admitted request'); END;
CREATE TRIGGER IF NOT EXISTS research_dispatch_cannot_be_deleted
BEFORE DELETE ON research_dispatches FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'research dispatch cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS research_result_is_immutable
BEFORE UPDATE ON research_results FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'research result is immutable'); END;
CREATE TRIGGER IF NOT EXISTS research_result_requires_dispatch
BEFORE INSERT ON research_results FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM research_requests r WHERE r.request_id=NEW.request_id AND r.status='dispatched')
BEGIN SELECT RAISE(ABORT, 'research result requires dispatched request'); END;
CREATE TRIGGER IF NOT EXISTS research_result_cannot_be_deleted
BEFORE DELETE ON research_results FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'research result cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS research_source_is_immutable
BEFORE UPDATE ON research_sources FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'research source is immutable'); END;
CREATE TRIGGER IF NOT EXISTS research_read_source_requires_excerpt
BEFORE INSERT ON research_sources FOR EACH ROW
WHEN NEW.access_status IN ('directly-read','snippet')
  AND (NEW.held_excerpt IS NULL OR length(NEW.held_excerpt)=0)
BEGIN SELECT RAISE(ABORT, 'read research source requires held excerpt'); END;
CREATE TRIGGER IF NOT EXISTS research_source_cannot_be_deleted
BEFORE DELETE ON research_sources FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'research source cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS research_external_claim_is_immutable
BEFORE UPDATE ON research_external_claims FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'research external claim is immutable'); END;
CREATE TRIGGER IF NOT EXISTS research_external_claim_sources_must_resolve
BEFORE INSERT ON research_external_claims FOR EACH ROW
WHEN json_array_length(NEW.source_ids_json)=0 OR EXISTS (
  SELECT 1 FROM json_each(NEW.source_ids_json) j
   WHERE NOT EXISTS (
     SELECT 1 FROM research_sources s
      WHERE s.result_id=NEW.result_id AND s.source_id=j.value))
BEGIN SELECT RAISE(ABORT, 'research external claim sources must resolve within result'); END;
CREATE TRIGGER IF NOT EXISTS research_external_claim_destination_must_match_request
BEFORE INSERT ON research_external_claims FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM research_results x
  JOIN research_requests q ON q.request_id=x.request_id
  WHERE x.result_id=NEW.result_id AND q.destination_ref=NEW.target_ref
    AND ((q.destination_field='premise' AND NEW.target_kind='decision-premise')
      OR (q.destination_field IN ('accepted-option','alternative') AND NEW.target_kind='option')
      OR (q.destination_field='review-hypothesis' AND NEW.target_kind='hypothesis')
      OR (q.destination_field IN ('constraint','consequence','falsifier')
          AND NEW.target_kind='confidence-reason')))
BEGIN SELECT RAISE(ABORT, 'research external claim destination must match request'); END;
CREATE TRIGGER IF NOT EXISTS research_external_claim_cannot_be_deleted
BEFORE DELETE ON research_external_claims FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'research external claim cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS research_code_contradiction_requires_current_observation
BEFORE INSERT ON research_code_contradictions FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM claims c
   WHERE c.claim_id=NEW.code_claim_id AND c.epistemic_kind='observation'
     AND c.valid_until_sha IS NULL
     AND EXISTS (SELECT 1 FROM claim_evidence ce WHERE ce.claim_id=c.claim_id))
BEGIN SELECT RAISE(ABORT, 'research contradiction target must be a current evidence-backed observation'); END;
CREATE TRIGGER IF NOT EXISTS research_code_contradiction_is_immutable
BEFORE UPDATE ON research_code_contradictions FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'research code contradiction is immutable pending evidence-backed resolution'); END;
CREATE TRIGGER IF NOT EXISTS research_code_contradiction_cannot_be_deleted
BEFORE DELETE ON research_code_contradictions FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'research code contradiction cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS research_consumption_is_immutable
BEFORE UPDATE ON research_consumptions FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'research consumption is immutable'); END;
CREATE TRIGGER IF NOT EXISTS research_consumption_requires_landed_result
BEFORE INSERT ON research_consumptions FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM research_requests q JOIN research_results r ON r.request_id=q.request_id
   WHERE q.request_id=NEW.request_id AND q.status='landed' AND r.result_id=NEW.result_id)
BEGIN SELECT RAISE(ABORT, 'research consumption requires matching landed result'); END;
CREATE TRIGGER IF NOT EXISTS research_consumption_cannot_be_deleted
BEFORE DELETE ON research_consumptions FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'research consumption cannot be deleted'); END;

----------------------------------------------------------------------
-- TYPED CROSSWALKS: identity-before-enrichment and method qualification
----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS crosswalk_entities (
    entity_id          TEXT PRIMARY KEY,
    entity_kind        TEXT NOT NULL CHECK (entity_kind IN (
                           'code-claim','external-claim','concern','decision-revision','method')),
    source_kind        TEXT NOT NULL CHECK (source_kind IN (
                           'code-claim','external-claim','concern','decision-revision',
                           'repository-evidence','direct-user')),
    source_ref         TEXT NOT NULL,
    label              TEXT NOT NULL,
    normalized_label   TEXT NOT NULL,
    definition         TEXT NOT NULL,
    negative_criteria_json TEXT NOT NULL CHECK (json_valid(negative_criteria_json)),
    provenance_json    TEXT NOT NULL CHECK (json_valid(provenance_json)),
    identity_state     TEXT NOT NULL CHECK (identity_state IN ('pending','distinct','same-as')),
    canonical_entity_id TEXT REFERENCES crosswalk_entities(entity_id) ON DELETE RESTRICT,
    created_by         TEXT NOT NULL REFERENCES sessions(session_id),
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (entity_kind, source_kind, source_ref),
    CHECK ((identity_state='pending' AND canonical_entity_id IS NULL)
        OR (identity_state IN ('distinct','same-as') AND canonical_entity_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_crosswalk_entities_label
    ON crosswalk_entities(normalized_label, entity_kind);
CREATE INDEX IF NOT EXISTS idx_crosswalk_entities_canonical
    ON crosswalk_entities(canonical_entity_id, identity_state);

CREATE TABLE IF NOT EXISTS crosswalk_identity_resolutions (
    resolution_id       INTEGER PRIMARY KEY,
    entity_id           TEXT NOT NULL UNIQUE REFERENCES crosswalk_entities(entity_id) ON DELETE RESTRICT,
    candidate_entity_id TEXT REFERENCES crosswalk_entities(entity_id) ON DELETE RESTRICT,
    resolution          TEXT NOT NULL CHECK (resolution IN ('unique','same-as','distinct')),
    evidence_json       TEXT NOT NULL CHECK (json_valid(evidence_json)),
    rationale           TEXT NOT NULL,
    resolved_by         TEXT NOT NULL REFERENCES sessions(session_id),
    resolved_at         TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK ((resolution='unique' AND candidate_entity_id IS NULL)
        OR (resolution IN ('same-as','distinct') AND candidate_entity_id IS NOT NULL)),
    CHECK (candidate_entity_id IS NULL OR candidate_entity_id!=entity_id)
);

CREATE TABLE IF NOT EXISTS crosswalk_properties (
    property_id         TEXT PRIMARY KEY,
    entity_id           TEXT NOT NULL REFERENCES crosswalk_entities(entity_id) ON DELETE RESTRICT,
    property_key        TEXT NOT NULL,
    value_json          TEXT NOT NULL CHECK (json_valid(value_json)),
    source_entity_id    TEXT NOT NULL REFERENCES crosswalk_entities(entity_id) ON DELETE RESTRICT,
    provenance_json     TEXT NOT NULL CHECK (json_valid(provenance_json)),
    created_by          TEXT NOT NULL REFERENCES sessions(session_id),
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (entity_id, property_key, source_entity_id)
);

CREATE TABLE IF NOT EXISTS crosswalk_relations (
    relation_id         TEXT PRIMARY KEY,
    predecessor_relation_id TEXT REFERENCES crosswalk_relations(relation_id) ON DELETE RESTRICT,
    source_entity_id    TEXT NOT NULL REFERENCES crosswalk_entities(entity_id) ON DELETE RESTRICT,
    target_entity_id    TEXT NOT NULL REFERENCES crosswalk_entities(entity_id) ON DELETE RESTRICT,
    relation_type       TEXT NOT NULL CHECK (relation_type IN (
                           'same-as','supports','contradicts','refines','analogous-to',
                           'applies-to','derived-from','supersedes')),
    statement           TEXT NOT NULL,
    positive_criteria_json TEXT NOT NULL CHECK (json_valid(positive_criteria_json)),
    negative_criteria_json TEXT NOT NULL CHECK (json_valid(negative_criteria_json)),
    provenance_json     TEXT NOT NULL CHECK (json_valid(provenance_json)),
    valid_from          TEXT NOT NULL,
    valid_until         TEXT,
    status              TEXT NOT NULL DEFAULT 'current' CHECK (status IN ('current','superseded')),
    created_by          TEXT NOT NULL REFERENCES sessions(session_id),
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    superseded_at       TEXT,
    CHECK (source_entity_id!=target_entity_id),
    CHECK ((status='current' AND valid_until IS NULL AND superseded_at IS NULL)
        OR (status='superseded' AND valid_until IS NOT NULL AND superseded_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_crosswalk_relations_endpoints
    ON crosswalk_relations(source_entity_id, target_entity_id, relation_type, status);

CREATE TABLE IF NOT EXISTS crosswalk_counterevidence (
    counterevidence_id  TEXT PRIMARY KEY,
    relation_id         TEXT NOT NULL REFERENCES crosswalk_relations(relation_id) ON DELETE RESTRICT,
    statement           TEXT NOT NULL,
    provenance_json     TEXT NOT NULL CHECK (json_valid(provenance_json)),
    resolution          TEXT NOT NULL DEFAULT 'open' CHECK (resolution IN (
                           'open','scope-distinction','relation-superseded')),
    resolution_note     TEXT,
    created_by          TEXT NOT NULL REFERENCES sessions(session_id),
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at         TEXT,
    CHECK (resolution='open' OR resolution_note IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_crosswalk_counterevidence_open
    ON crosswalk_counterevidence(relation_id, resolution) WHERE resolution='open';

CREATE TABLE IF NOT EXISTS method_qualification_plans (
    qualification_id   TEXT PRIMARY KEY,
    method_entity_id   TEXT NOT NULL REFERENCES crosswalk_entities(entity_id) ON DELETE RESTRICT,
    collatio_contract_json TEXT NOT NULL CHECK (json_valid(collatio_contract_json)),
    prediction_json    TEXT NOT NULL CHECK (json_valid(prediction_json)),
    controls_json      TEXT NOT NULL CHECK (json_valid(controls_json)),
    red_gates_json     TEXT NOT NULL CHECK (json_valid(red_gates_json)),
    custody_json       TEXT NOT NULL CHECK (json_valid(custody_json)),
    target_policy_key  TEXT NOT NULL,
    plan_hash          TEXT NOT NULL,
    status             TEXT NOT NULL DEFAULT 'planned' CHECK (status IN (
                           'planned','landed','passed','failed')),
    planned_by         TEXT NOT NULL REFERENCES sessions(session_id),
    planned_at         TEXT NOT NULL DEFAULT (datetime('now')),
    terminal_at        TEXT,
    UNIQUE (method_entity_id, qualification_id)
);

CREATE TABLE IF NOT EXISTS method_qualification_results (
    result_id          TEXT PRIMARY KEY,
    qualification_id  TEXT NOT NULL UNIQUE REFERENCES method_qualification_plans(qualification_id) ON DELETE RESTRICT,
    artifact_path      TEXT NOT NULL,
    artifact_hash      TEXT NOT NULL,
    result_json        TEXT NOT NULL CHECK (json_valid(result_json)),
    result_hash        TEXT NOT NULL,
    landed_by          TEXT NOT NULL REFERENCES sessions(session_id),
    landed_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS method_qualification_scores (
    score_id           TEXT PRIMARY KEY,
    qualification_id  TEXT NOT NULL UNIQUE REFERENCES method_qualification_plans(qualification_id) ON DELETE RESTRICT,
    result_id          TEXT NOT NULL UNIQUE REFERENCES method_qualification_results(result_id) ON DELETE RESTRICT,
    prediction_ok      INTEGER NOT NULL CHECK (prediction_ok IN (0,1)),
    controls_ok        INTEGER NOT NULL CHECK (controls_ok IN (0,1)),
    red_gates_ok       INTEGER NOT NULL CHECK (red_gates_ok IN (0,1)),
    custody_ok         INTEGER NOT NULL CHECK (custody_ok IN (0,1)),
    readback_ok        INTEGER NOT NULL CHECK (readback_ok IN (0,1)),
    passed             INTEGER NOT NULL CHECK (passed IN (0,1)),
    report_json        TEXT NOT NULL CHECK (json_valid(report_json)),
    scored_by          TEXT NOT NULL REFERENCES sessions(session_id),
    scored_at          TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (passed=(prediction_ok AND controls_ok AND red_gates_ok AND custody_ok AND readback_ok))
);

CREATE TABLE IF NOT EXISTS unattended_method_policy (
    policy_key         TEXT PRIMARY KEY,
    method_entity_id   TEXT NOT NULL REFERENCES crosswalk_entities(entity_id) ON DELETE RESTRICT,
    qualification_id  TEXT NOT NULL UNIQUE REFERENCES method_qualification_plans(qualification_id) ON DELETE RESTRICT,
    configuration_json TEXT NOT NULL CHECK (json_valid(configuration_json)),
    activated_by       TEXT NOT NULL REFERENCES sessions(session_id),
    activated_at       TEXT NOT NULL DEFAULT (datetime('now')),
    superseded_by      TEXT REFERENCES unattended_method_policy(policy_key) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS crosswalk_projections (
    projection_id      TEXT PRIMARY KEY,
    schema_version     TEXT NOT NULL CHECK (schema_version='1.0.0'),
    projection_json    TEXT NOT NULL CHECK (json_valid(projection_json)),
    projection_hash    TEXT NOT NULL,
    projected_by       TEXT NOT NULL REFERENCES sessions(session_id),
    projected_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS crosswalk_projection_verifications (
    verification_id   INTEGER PRIMARY KEY,
    projection_id     TEXT NOT NULL REFERENCES crosswalk_projections(projection_id) ON DELETE RESTRICT,
    state_ok           INTEGER NOT NULL CHECK (state_ok IN (0,1)),
    coverage_ok        INTEGER NOT NULL CHECK (coverage_ok IN (0,1)),
    content_ok         INTEGER NOT NULL CHECK (content_ok IN (0,1)),
    ok                 INTEGER NOT NULL CHECK (ok IN (0,1)),
    report_json        TEXT NOT NULL CHECK (json_valid(report_json)),
    verified_by        TEXT NOT NULL REFERENCES sessions(session_id),
    verified_at        TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (ok=(state_ok AND coverage_ok AND content_ok))
);

CREATE TRIGGER IF NOT EXISTS crosswalk_entity_insert_starts_pending
BEFORE INSERT ON crosswalk_entities FOR EACH ROW
WHEN NEW.identity_state!='pending' OR NEW.canonical_entity_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'crosswalk identity must begin pending'); END;
CREATE TRIGGER IF NOT EXISTS crosswalk_entity_payload_is_immutable
BEFORE UPDATE ON crosswalk_entities FOR EACH ROW
WHEN OLD.entity_id!=NEW.entity_id OR OLD.entity_kind!=NEW.entity_kind
  OR OLD.source_kind!=NEW.source_kind OR OLD.source_ref!=NEW.source_ref
  OR OLD.label!=NEW.label OR OLD.normalized_label!=NEW.normalized_label
  OR OLD.definition!=NEW.definition OR OLD.negative_criteria_json!=NEW.negative_criteria_json
  OR OLD.provenance_json!=NEW.provenance_json OR OLD.created_by!=NEW.created_by
BEGIN SELECT RAISE(ABORT, 'crosswalk entity payload is immutable'); END;
CREATE TRIGGER IF NOT EXISTS crosswalk_entity_identity_transition_is_valid
BEFORE UPDATE OF identity_state, canonical_entity_id ON crosswalk_entities FOR EACH ROW
WHEN OLD.identity_state!='pending' OR NEW.identity_state NOT IN ('distinct','same-as')
  OR NEW.canonical_entity_id IS NULL
BEGIN SELECT RAISE(ABORT, 'invalid crosswalk identity transition'); END;
CREATE TRIGGER IF NOT EXISTS crosswalk_entity_identity_requires_resolution
BEFORE UPDATE OF identity_state, canonical_entity_id ON crosswalk_entities FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM crosswalk_identity_resolutions r WHERE r.entity_id=OLD.entity_id
    AND ((r.resolution IN ('unique','distinct') AND NEW.identity_state='distinct'
          AND NEW.canonical_entity_id=OLD.entity_id)
      OR (r.resolution='same-as' AND NEW.identity_state='same-as'
          AND NEW.canonical_entity_id=(SELECT canonical_entity_id FROM crosswalk_entities
                                       WHERE entity_id=r.candidate_entity_id))))
BEGIN SELECT RAISE(ABORT, 'crosswalk identity transition lacks matching resolution'); END;
CREATE TRIGGER IF NOT EXISTS crosswalk_entity_cannot_be_deleted
BEFORE DELETE ON crosswalk_entities FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'crosswalk entity cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS crosswalk_identity_resolution_is_immutable
BEFORE UPDATE ON crosswalk_identity_resolutions FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'crosswalk identity resolution is immutable'); END;
CREATE TRIGGER IF NOT EXISTS crosswalk_identity_resolution_cannot_be_deleted
BEFORE DELETE ON crosswalk_identity_resolutions FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'crosswalk identity resolution cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS crosswalk_property_requires_resolved_identity
BEFORE INSERT ON crosswalk_properties FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM crosswalk_entities e WHERE e.entity_id=NEW.entity_id
                  AND e.identity_state!='pending')
  OR NOT EXISTS (SELECT 1 FROM crosswalk_entities e WHERE e.entity_id=NEW.source_entity_id
                  AND e.identity_state!='pending')
  OR (NEW.entity_id!=NEW.source_entity_id AND NOT EXISTS (
       SELECT 1 FROM crosswalk_entities a JOIN crosswalk_entities b
        ON a.canonical_entity_id=b.canonical_entity_id
       WHERE a.entity_id=NEW.entity_id AND b.entity_id=NEW.source_entity_id))
BEGIN SELECT RAISE(ABORT, 'crosswalk enrichment requires resolved identity'); END;
CREATE TRIGGER IF NOT EXISTS crosswalk_property_is_immutable
BEFORE UPDATE ON crosswalk_properties FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'crosswalk property is immutable'); END;
CREATE TRIGGER IF NOT EXISTS crosswalk_property_cannot_be_deleted
BEFORE DELETE ON crosswalk_properties FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'crosswalk property cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS crosswalk_relation_requires_resolved_endpoints
BEFORE INSERT ON crosswalk_relations FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM crosswalk_entities e WHERE e.entity_id=NEW.source_entity_id
                  AND e.identity_state!='pending')
  OR NOT EXISTS (SELECT 1 FROM crosswalk_entities e WHERE e.entity_id=NEW.target_entity_id
                  AND e.identity_state!='pending')
BEGIN SELECT RAISE(ABORT, 'crosswalk relation requires resolved endpoint identities'); END;
CREATE TRIGGER IF NOT EXISTS crosswalk_same_as_requires_canonical_identity
BEFORE INSERT ON crosswalk_relations FOR EACH ROW
WHEN NEW.relation_type='same-as' AND NOT EXISTS (
  SELECT 1 FROM crosswalk_entities a JOIN crosswalk_entities b
    ON a.canonical_entity_id=b.canonical_entity_id
   WHERE a.entity_id=NEW.source_entity_id AND b.entity_id=NEW.target_entity_id)
BEGIN SELECT RAISE(ABORT, 'same-as relation requires resolved canonical identity'); END;
CREATE TRIGGER IF NOT EXISTS crosswalk_relation_payload_is_immutable
BEFORE UPDATE ON crosswalk_relations FOR EACH ROW
WHEN OLD.relation_id!=NEW.relation_id
  OR COALESCE(OLD.predecessor_relation_id,'')!=COALESCE(NEW.predecessor_relation_id,'')
  OR OLD.source_entity_id!=NEW.source_entity_id OR OLD.target_entity_id!=NEW.target_entity_id
  OR OLD.relation_type!=NEW.relation_type OR OLD.statement!=NEW.statement
  OR OLD.positive_criteria_json!=NEW.positive_criteria_json
  OR OLD.negative_criteria_json!=NEW.negative_criteria_json
  OR OLD.provenance_json!=NEW.provenance_json OR OLD.valid_from!=NEW.valid_from
  OR OLD.created_by!=NEW.created_by
BEGIN SELECT RAISE(ABORT, 'crosswalk relation payload is immutable'); END;
CREATE TRIGGER IF NOT EXISTS crosswalk_relation_status_is_monotonic
BEFORE UPDATE OF status ON crosswalk_relations FOR EACH ROW
WHEN NOT (OLD.status='current' AND NEW.status='superseded'
          AND NEW.valid_until IS NOT NULL AND NEW.superseded_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'invalid crosswalk relation status transition'); END;
CREATE TRIGGER IF NOT EXISTS crosswalk_relation_cannot_be_deleted
BEFORE DELETE ON crosswalk_relations FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'crosswalk relation cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS crosswalk_counterevidence_is_immutable
BEFORE UPDATE ON crosswalk_counterevidence FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'crosswalk counterevidence is immutable'); END;
CREATE TRIGGER IF NOT EXISTS crosswalk_counterevidence_cannot_be_deleted
BEFORE DELETE ON crosswalk_counterevidence FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'crosswalk counterevidence cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS method_qualification_requires_method_identity
BEFORE INSERT ON method_qualification_plans FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM crosswalk_entities e WHERE e.entity_id=NEW.method_entity_id
                  AND e.entity_kind='method' AND e.identity_state!='pending')
BEGIN SELECT RAISE(ABORT, 'method qualification requires resolved method identity'); END;
CREATE TRIGGER IF NOT EXISTS method_qualification_plan_payload_is_immutable
BEFORE UPDATE ON method_qualification_plans FOR EACH ROW
WHEN OLD.qualification_id!=NEW.qualification_id OR OLD.method_entity_id!=NEW.method_entity_id
  OR OLD.collatio_contract_json!=NEW.collatio_contract_json
  OR OLD.prediction_json!=NEW.prediction_json OR OLD.controls_json!=NEW.controls_json
  OR OLD.red_gates_json!=NEW.red_gates_json OR OLD.custody_json!=NEW.custody_json
  OR OLD.target_policy_key!=NEW.target_policy_key OR OLD.plan_hash!=NEW.plan_hash
  OR OLD.planned_by!=NEW.planned_by
BEGIN SELECT RAISE(ABORT, 'method qualification plan payload is immutable'); END;
CREATE TRIGGER IF NOT EXISTS method_qualification_status_is_monotonic
BEFORE UPDATE OF status ON method_qualification_plans FOR EACH ROW
WHEN NOT ((OLD.status='planned' AND NEW.status='landed')
       OR (OLD.status='landed' AND NEW.status IN ('passed','failed')))
BEGIN SELECT RAISE(ABORT, 'invalid method qualification status transition'); END;
CREATE TRIGGER IF NOT EXISTS method_qualification_result_requires_plan
BEFORE INSERT ON method_qualification_results FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM method_qualification_plans p
                  WHERE p.qualification_id=NEW.qualification_id AND p.status='planned')
BEGIN SELECT RAISE(ABORT, 'method qualification result requires planned qualification'); END;
CREATE TRIGGER IF NOT EXISTS method_qualification_result_is_immutable
BEFORE UPDATE ON method_qualification_results FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'method qualification result is immutable'); END;
CREATE TRIGGER IF NOT EXISTS method_qualification_result_cannot_be_deleted
BEFORE DELETE ON method_qualification_results FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'method qualification result cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS method_qualification_score_requires_landed
BEFORE INSERT ON method_qualification_scores FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM method_qualification_plans p
                  WHERE p.qualification_id=NEW.qualification_id AND p.status='landed')
BEGIN SELECT RAISE(ABORT, 'method qualification score requires landed result'); END;
CREATE TRIGGER IF NOT EXISTS method_qualification_score_is_immutable
BEFORE UPDATE ON method_qualification_scores FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'method qualification score is immutable'); END;
CREATE TRIGGER IF NOT EXISTS method_qualification_score_cannot_be_deleted
BEFORE DELETE ON method_qualification_scores FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'method qualification score cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS unattended_method_policy_requires_passed_qualification
BEFORE INSERT ON unattended_method_policy FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM method_qualification_plans p JOIN method_qualification_scores s
    ON s.qualification_id=p.qualification_id
   WHERE p.qualification_id=NEW.qualification_id AND p.method_entity_id=NEW.method_entity_id
     AND p.target_policy_key=NEW.policy_key AND p.status='passed' AND s.passed=1
     AND s.readback_ok=1)
BEGIN SELECT RAISE(ABORT, 'unattended method policy requires passed qualification and read-back'); END;
CREATE TRIGGER IF NOT EXISTS unattended_method_policy_is_immutable
BEFORE UPDATE ON unattended_method_policy FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'unattended method policy is immutable'); END;
CREATE TRIGGER IF NOT EXISTS unattended_method_policy_cannot_be_deleted
BEFORE DELETE ON unattended_method_policy FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'unattended method policy cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS crosswalk_projection_is_immutable
BEFORE UPDATE ON crosswalk_projections FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'crosswalk projection is immutable'); END;
CREATE TRIGGER IF NOT EXISTS crosswalk_projection_cannot_be_deleted
BEFORE DELETE ON crosswalk_projections FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'crosswalk projection cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS crosswalk_projection_verification_is_immutable
BEFORE UPDATE ON crosswalk_projection_verifications FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'crosswalk projection verification is immutable'); END;
CREATE TRIGGER IF NOT EXISTS crosswalk_projection_verification_cannot_be_deleted
BEFORE DELETE ON crosswalk_projection_verifications FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'crosswalk projection verification cannot be deleted'); END;

----------------------------------------------------------------------
-- LEARNING LEDGER: typed distillation, qualification, and reversible policy
----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS learning_outcome_extractions (
    extraction_id       TEXT PRIMARY KEY,
    source_kind         TEXT NOT NULL CHECK (source_kind IN (
                            'agent-session','review-session','design-session')),
    source_ref          TEXT NOT NULL,
    source_terminal_state TEXT NOT NULL,
    planned_count       INTEGER NOT NULL CHECK (planned_count > 0),
    produced_count      INTEGER NOT NULL CHECK (produced_count >= 0),
    accepted_count      INTEGER NOT NULL CHECK (accepted_count >= 0),
    invalidated_count   INTEGER NOT NULL CHECK (invalidated_count >= 0),
    outcome_json        TEXT NOT NULL CHECK (json_valid(outcome_json)),
    outcome_hash        TEXT NOT NULL,
    extracted_by        TEXT NOT NULL REFERENCES sessions(session_id),
    extracted_at        TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (produced_count <= planned_count),
    CHECK (accepted_count <= produced_count),
    CHECK (invalidated_count <= accepted_count),
    UNIQUE (source_kind, source_ref, outcome_hash)
);

CREATE TABLE IF NOT EXISTS learning_lessons (
    lesson_id           TEXT PRIMARY KEY,
    predecessor_lesson_id TEXT REFERENCES learning_lessons(lesson_id) ON DELETE RESTRICT,
    rollback_of_lesson_id TEXT REFERENCES learning_lessons(lesson_id) ON DELETE RESTRICT,
    extraction_id       TEXT NOT NULL REFERENCES learning_outcome_extractions(extraction_id) ON DELETE RESTRICT,
    channel             TEXT NOT NULL CHECK (channel IN (
                            'corpus','retrieval','method','research','user-preference')),
    epistemic_kind      TEXT NOT NULL CHECK (epistemic_kind IN (
                            'observation','inference','external-claim','direct-intent')),
    proposition         TEXT NOT NULL,
    scope_json          TEXT NOT NULL CHECK (json_valid(scope_json)),
    target_policy_key   TEXT NOT NULL,
    configuration_json  TEXT NOT NULL CHECK (json_valid(configuration_json)),
    evidence_artifact_ids_json TEXT NOT NULL CHECK (json_valid(evidence_artifact_ids_json)),
    human_source_json   TEXT CHECK (human_source_json IS NULL OR json_valid(human_source_json)),
    rollback_plan_json  TEXT NOT NULL CHECK (json_valid(rollback_plan_json)),
    payload_hash        TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN (
                            'candidate','qualified','active','superseded')),
    proposed_by         TEXT NOT NULL REFERENCES sessions(session_id),
    proposed_at         TEXT NOT NULL DEFAULT (datetime('now')),
    qualified_at        TEXT,
    activated_at        TEXT,
    superseded_at       TEXT,
    CHECK (predecessor_lesson_id IS NULL OR predecessor_lesson_id!=lesson_id),
    CHECK (rollback_of_lesson_id IS NULL OR rollback_of_lesson_id!=lesson_id),
    CHECK ((channel='corpus' AND epistemic_kind='observation' AND human_source_json IS NULL)
        OR (channel IN ('retrieval','method') AND epistemic_kind='inference' AND human_source_json IS NULL)
        OR (channel='research' AND epistemic_kind='external-claim' AND human_source_json IS NULL)
        OR (channel='user-preference' AND epistemic_kind='direct-intent' AND human_source_json IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_learning_lessons_policy
    ON learning_lessons(target_policy_key, status, channel);

CREATE TABLE IF NOT EXISTS learning_evaluations (
    evaluation_id       TEXT PRIMARY KEY,
    lesson_id           TEXT NOT NULL UNIQUE REFERENCES learning_lessons(lesson_id) ON DELETE RESTRICT,
    evaluation_kind     TEXT NOT NULL CHECK (evaluation_kind IN (
                            'provenance-audit','treatment-versus-clean','ablation','human-confirmation')),
    metric              TEXT NOT NULL,
    baseline_value_milli INTEGER NOT NULL,
    observed_value_milli INTEGER NOT NULL,
    expected_direction  TEXT NOT NULL CHECK (expected_direction IN ('increase','decrease')),
    minimum_effect_milli INTEGER NOT NULL CHECK (minimum_effect_milli > 0),
    effect_milli        INTEGER NOT NULL,
    passed              INTEGER NOT NULL CHECK (passed IN (0,1)),
    evidence_artifact_ids_json TEXT NOT NULL CHECK (json_valid(evidence_artifact_ids_json)),
    method_qualification_id TEXT REFERENCES method_qualification_plans(qualification_id) ON DELETE RESTRICT,
    confirmed_by_kind   TEXT CHECK (confirmed_by_kind IS NULL OR confirmed_by_kind IN ('human','owning-system')),
    confirmed_by        TEXT,
    limitations_json    TEXT NOT NULL CHECK (json_valid(limitations_json)),
    report_json         TEXT NOT NULL CHECK (json_valid(report_json)),
    evaluated_by        TEXT NOT NULL REFERENCES sessions(session_id),
    evaluated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK ((expected_direction='increase' AND effect_milli=observed_value_milli-baseline_value_milli)
        OR (expected_direction='decrease' AND effect_milli=baseline_value_milli-observed_value_milli)),
    CHECK (passed=(effect_milli>=minimum_effect_milli)),
    CHECK ((confirmed_by_kind IS NULL)=(confirmed_by IS NULL))
);

CREATE TABLE IF NOT EXISTS learning_events (
    event_id            INTEGER PRIMARY KEY,
    lesson_id           TEXT NOT NULL REFERENCES learning_lessons(lesson_id) ON DELETE RESTRICT,
    event_type          TEXT NOT NULL CHECK (event_type IN (
                            'proposed','qualified','staged','activated','superseded')),
    actor_kind          TEXT NOT NULL CHECK (actor_kind IN ('human','owning-system','amanuensis')),
    actor_id            TEXT NOT NULL,
    detail_json         TEXT NOT NULL CHECK (json_valid(detail_json)),
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS learning_policy_versions (
    policy_version_id   TEXT PRIMARY KEY,
    policy_key          TEXT NOT NULL,
    revision_number     INTEGER NOT NULL CHECK (revision_number > 0),
    lesson_id           TEXT NOT NULL UNIQUE REFERENCES learning_lessons(lesson_id) ON DELETE RESTRICT,
    predecessor_policy_version_id TEXT REFERENCES learning_policy_versions(policy_version_id) ON DELETE RESTRICT,
    channel             TEXT NOT NULL CHECK (channel IN (
                            'corpus','retrieval','method','research','user-preference')),
    configuration_json  TEXT NOT NULL CHECK (json_valid(configuration_json)),
    configuration_hash  TEXT NOT NULL,
    affected_future_runs_json TEXT NOT NULL CHECK (json_valid(affected_future_runs_json)),
    status              TEXT NOT NULL DEFAULT 'staged' CHECK (status IN ('staged','active','superseded')),
    superseded_by       TEXT REFERENCES learning_policy_versions(policy_version_id) ON DELETE RESTRICT,
    staged_by           TEXT NOT NULL REFERENCES sessions(session_id),
    staged_at           TEXT NOT NULL DEFAULT (datetime('now')),
    activated_at        TEXT,
    superseded_at       TEXT,
    UNIQUE (policy_key, revision_number),
    CHECK ((status='staged' AND activated_at IS NULL AND superseded_at IS NULL AND superseded_by IS NULL)
        OR (status='active' AND activated_at IS NOT NULL AND superseded_at IS NULL AND superseded_by IS NULL)
        OR (status='superseded' AND activated_at IS NOT NULL AND superseded_at IS NOT NULL AND superseded_by IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_learning_policy_one_active
    ON learning_policy_versions(policy_key) WHERE status='active';

CREATE TABLE IF NOT EXISTS learning_policy_readbacks (
    readback_id         INTEGER PRIMARY KEY,
    policy_version_id   TEXT NOT NULL REFERENCES learning_policy_versions(policy_version_id) ON DELETE RESTRICT,
    phase               TEXT NOT NULL CHECK (phase IN ('preactivation','postactivation','audit')),
    state_ok            INTEGER NOT NULL CHECK (state_ok IN (0,1)),
    coverage_ok         INTEGER NOT NULL CHECK (coverage_ok IN (0,1)),
    content_ok          INTEGER NOT NULL CHECK (content_ok IN (0,1)),
    ok                  INTEGER NOT NULL CHECK (ok IN (0,1)),
    report_json         TEXT NOT NULL CHECK (json_valid(report_json)),
    audited_by          TEXT NOT NULL REFERENCES sessions(session_id),
    audited_at          TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (ok=(state_ok AND coverage_ok AND content_ok))
);

CREATE TRIGGER IF NOT EXISTS learning_outcome_must_reconcile
BEFORE INSERT ON learning_outcome_extractions FOR EACH ROW
WHEN NEW.planned_count!=json_extract(NEW.outcome_json, '$.counts.planned')
  OR NEW.produced_count!=json_extract(NEW.outcome_json, '$.counts.produced')
  OR NEW.accepted_count!=json_extract(NEW.outcome_json, '$.counts.accepted')
  OR NEW.invalidated_count!=json_extract(NEW.outcome_json, '$.counts.later_invalidated')
  OR NEW.source_kind!=json_extract(NEW.outcome_json, '$.source.kind')
  OR NEW.source_ref!=json_extract(NEW.outcome_json, '$.source.ref')
BEGIN SELECT RAISE(ABORT, 'learning outcome extraction does not reconcile'); END;
CREATE TRIGGER IF NOT EXISTS learning_outcome_is_immutable
BEFORE UPDATE ON learning_outcome_extractions FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'learning outcome extraction is immutable'); END;
CREATE TRIGGER IF NOT EXISTS learning_outcome_cannot_be_deleted
BEFORE DELETE ON learning_outcome_extractions FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'learning outcome extraction cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS learning_lesson_starts_candidate
BEFORE INSERT ON learning_lessons FOR EACH ROW
WHEN NEW.status!='candidate' OR NEW.qualified_at IS NOT NULL OR NEW.activated_at IS NOT NULL
  OR NEW.superseded_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'learning lesson must begin as candidate'); END;
CREATE TRIGGER IF NOT EXISTS learning_lesson_payload_is_immutable
BEFORE UPDATE ON learning_lessons FOR EACH ROW
WHEN OLD.lesson_id!=NEW.lesson_id
  OR COALESCE(OLD.predecessor_lesson_id,'')!=COALESCE(NEW.predecessor_lesson_id,'')
  OR COALESCE(OLD.rollback_of_lesson_id,'')!=COALESCE(NEW.rollback_of_lesson_id,'')
  OR OLD.extraction_id!=NEW.extraction_id OR OLD.channel!=NEW.channel
  OR OLD.epistemic_kind!=NEW.epistemic_kind OR OLD.proposition!=NEW.proposition
  OR OLD.scope_json!=NEW.scope_json OR OLD.target_policy_key!=NEW.target_policy_key
  OR OLD.configuration_json!=NEW.configuration_json
  OR OLD.evidence_artifact_ids_json!=NEW.evidence_artifact_ids_json
  OR COALESCE(OLD.human_source_json,'')!=COALESCE(NEW.human_source_json,'')
  OR OLD.rollback_plan_json!=NEW.rollback_plan_json OR OLD.payload_hash!=NEW.payload_hash
  OR OLD.proposed_by!=NEW.proposed_by
BEGIN SELECT RAISE(ABORT, 'learning lesson payload is immutable'); END;
CREATE TRIGGER IF NOT EXISTS learning_lesson_status_is_monotonic
BEFORE UPDATE OF status ON learning_lessons FOR EACH ROW
WHEN NOT ((OLD.status='candidate' AND NEW.status='qualified'
            AND NEW.qualified_at IS NOT NULL
            AND EXISTS (SELECT 1 FROM learning_events e WHERE e.lesson_id=OLD.lesson_id
                         AND e.event_type='qualified'))
       OR (OLD.status='qualified' AND NEW.status='active'
            AND NEW.activated_at IS NOT NULL
            AND EXISTS (SELECT 1 FROM learning_events e WHERE e.lesson_id=OLD.lesson_id
                         AND e.event_type='activated'))
       OR (OLD.status='active' AND NEW.status='superseded'
            AND NEW.superseded_at IS NOT NULL
            AND EXISTS (SELECT 1 FROM learning_events e WHERE e.lesson_id=OLD.lesson_id
                         AND e.event_type='superseded')))
BEGIN SELECT RAISE(ABORT, 'invalid learning lesson status transition'); END;
CREATE TRIGGER IF NOT EXISTS learning_lesson_cannot_be_deleted
BEFORE DELETE ON learning_lessons FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'learning lesson cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS learning_evaluation_requires_candidate
BEFORE INSERT ON learning_evaluations FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM learning_lessons l WHERE l.lesson_id=NEW.lesson_id
                  AND l.status='candidate')
BEGIN SELECT RAISE(ABORT, 'learning evaluation requires candidate lesson'); END;
CREATE TRIGGER IF NOT EXISTS learning_method_evaluation_is_qualified
BEFORE INSERT ON learning_evaluations FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM learning_lessons l WHERE l.lesson_id=NEW.lesson_id AND l.channel='method')
 AND (NEW.evaluation_kind NOT IN ('treatment-versus-clean','ablation')
      OR NEW.method_qualification_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM method_qualification_plans p
                       JOIN method_qualification_scores s ON s.qualification_id=p.qualification_id
                      WHERE p.qualification_id=NEW.method_qualification_id
                        AND p.status='passed' AND s.passed=1 AND s.readback_ok=1))
BEGIN SELECT RAISE(ABORT, 'method learning requires treatment/ablation and passed method qualification'); END;
CREATE TRIGGER IF NOT EXISTS learning_preference_evaluation_is_human
BEFORE INSERT ON learning_evaluations FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM learning_lessons l WHERE l.lesson_id=NEW.lesson_id
              AND l.channel='user-preference')
 AND (NEW.evaluation_kind!='human-confirmation' OR NEW.confirmed_by_kind!='human'
      OR NEW.confirmed_by IS NULL)
BEGIN SELECT RAISE(ABORT, 'preference learning requires scored human confirmation'); END;
CREATE TRIGGER IF NOT EXISTS learning_evaluation_is_immutable
BEFORE UPDATE ON learning_evaluations FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'learning evaluation is immutable'); END;
CREATE TRIGGER IF NOT EXISTS learning_evaluation_cannot_be_deleted
BEFORE DELETE ON learning_evaluations FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'learning evaluation cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS learning_event_is_immutable
BEFORE UPDATE ON learning_events FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'learning event is immutable'); END;
CREATE TRIGGER IF NOT EXISTS learning_event_cannot_be_deleted
BEFORE DELETE ON learning_events FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'learning event cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS learning_policy_starts_staged
BEFORE INSERT ON learning_policy_versions FOR EACH ROW
WHEN NEW.status!='staged' OR NEW.activated_at IS NOT NULL OR NEW.superseded_at IS NOT NULL
  OR NEW.superseded_by IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'learning policy must begin staged'); END;
CREATE TRIGGER IF NOT EXISTS learning_policy_requires_qualified_lesson
BEFORE INSERT ON learning_policy_versions FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM learning_lessons l JOIN learning_evaluations e
                   ON e.lesson_id=l.lesson_id
                  WHERE l.lesson_id=NEW.lesson_id AND l.status='qualified' AND e.passed=1
                    AND l.target_policy_key=NEW.policy_key AND l.channel=NEW.channel
                    AND l.configuration_json=NEW.configuration_json)
BEGIN SELECT RAISE(ABORT, 'learning policy requires qualified lesson and matching configuration'); END;
CREATE TRIGGER IF NOT EXISTS learning_policy_payload_is_immutable
BEFORE UPDATE ON learning_policy_versions FOR EACH ROW
WHEN OLD.policy_version_id!=NEW.policy_version_id OR OLD.policy_key!=NEW.policy_key
  OR OLD.revision_number!=NEW.revision_number OR OLD.lesson_id!=NEW.lesson_id
  OR COALESCE(OLD.predecessor_policy_version_id,'')!=COALESCE(NEW.predecessor_policy_version_id,'')
  OR OLD.channel!=NEW.channel OR OLD.configuration_json!=NEW.configuration_json
  OR OLD.configuration_hash!=NEW.configuration_hash
  OR OLD.affected_future_runs_json!=NEW.affected_future_runs_json OR OLD.staged_by!=NEW.staged_by
BEGIN SELECT RAISE(ABORT, 'learning policy payload is immutable'); END;
CREATE TRIGGER IF NOT EXISTS learning_policy_status_is_monotonic
BEFORE UPDATE OF status ON learning_policy_versions FOR EACH ROW
WHEN NOT ((OLD.status='staged' AND NEW.status='active' AND NEW.activated_at IS NOT NULL
            AND EXISTS (SELECT 1 FROM learning_policy_readbacks r
                         WHERE r.policy_version_id=OLD.policy_version_id
                           AND r.phase='preactivation' AND r.ok=1))
       OR (OLD.status='active' AND NEW.status='superseded' AND NEW.superseded_at IS NOT NULL
            AND NEW.superseded_by IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'invalid learning policy status transition'); END;
CREATE TRIGGER IF NOT EXISTS learning_policy_cannot_be_deleted
BEFORE DELETE ON learning_policy_versions FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'learning policy cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS learning_readback_must_reconcile
BEFORE INSERT ON learning_policy_readbacks FOR EACH ROW
WHEN NEW.state_ok!=json_extract(NEW.report_json, '$.axes.state.ok')
  OR NEW.coverage_ok!=json_extract(NEW.report_json, '$.axes.coverage.ok')
  OR NEW.content_ok!=json_extract(NEW.report_json, '$.axes.content.ok')
  OR NEW.ok!=json_extract(NEW.report_json, '$.ok')
BEGIN SELECT RAISE(ABORT, 'learning policy read-back does not reconcile'); END;
CREATE TRIGGER IF NOT EXISTS learning_readback_is_immutable
BEFORE UPDATE ON learning_policy_readbacks FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'learning policy read-back is immutable'); END;
CREATE TRIGGER IF NOT EXISTS learning_readback_cannot_be_deleted
BEFORE DELETE ON learning_policy_readbacks FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'learning policy read-back cannot be deleted'); END;

----------------------------------------------------------------------
-- OPERATING ENVELOPE: stratified, preregistered multi-repository evaluation
----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS evaluation_programs (
    program_id          TEXT PRIMARY KEY,
    schema_version      TEXT NOT NULL CHECK (schema_version='1.0.0'),
    manifest_json       TEXT NOT NULL CHECK (json_valid(manifest_json)),
    manifest_hash       TEXT NOT NULL,
    expected_case_count INTEGER NOT NULL CHECK (expected_case_count > 0),
    status              TEXT NOT NULL DEFAULT 'planned' CHECK (status IN (
                            'planned','collecting','ready','published')),
    planned_by          TEXT NOT NULL REFERENCES sessions(session_id),
    planned_at          TEXT NOT NULL DEFAULT (datetime('now')),
    published_at        TEXT
);

CREATE TABLE IF NOT EXISTS evaluation_cases (
    case_id             TEXT PRIMARY KEY,
    program_id          TEXT NOT NULL REFERENCES evaluation_programs(program_id) ON DELETE RESTRICT,
    stratum_id          TEXT NOT NULL,
    repository_id       TEXT NOT NULL,
    repository_type     TEXT NOT NULL,
    languages_json      TEXT NOT NULL CHECK (json_valid(languages_json)),
    scale_bucket        TEXT NOT NULL,
    repository_shape    TEXT NOT NULL,
    change_class        TEXT NOT NULL,
    mode                TEXT NOT NULL,
    context_condition   TEXT NOT NULL,
    model_family        TEXT NOT NULL,
    runtime_id          TEXT NOT NULL,
    condition_id        TEXT NOT NULL,
    condition_role      TEXT NOT NULL CHECK (condition_role IN (
                            'baseline','null','stronger-control','treatment','ablation',
                            'test-retest','sensitivity-add','sensitivity-remove')),
    replicate_id        TEXT NOT NULL UNIQUE,
    expected_input_hash TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','landed')),
    landed_at           TEXT,
    UNIQUE (program_id,stratum_id,condition_id,replicate_id)
);

CREATE INDEX IF NOT EXISTS idx_evaluation_cases_program
    ON evaluation_cases(program_id,stratum_id,condition_role,status);

CREATE TABLE IF NOT EXISTS evaluation_results (
    result_id           TEXT PRIMARY KEY,
    case_id             TEXT NOT NULL UNIQUE REFERENCES evaluation_cases(case_id) ON DELETE RESTRICT,
    primary_metric_id   TEXT NOT NULL,
    metrics_json        TEXT NOT NULL CHECK (json_valid(metrics_json)),
    primary_value_milli INTEGER NOT NULL,
    delivery_json       TEXT NOT NULL CHECK (json_valid(delivery_json)),
    instrument_status   TEXT NOT NULL CHECK (instrument_status IN (
                            'valid','delivery-failed','determinism-failed','undetermined-no-headroom')),
    rubric_counts_json  TEXT NOT NULL CHECK (json_valid(rubric_counts_json)),
    unused_category_checks_json TEXT NOT NULL CHECK (json_valid(unused_category_checks_json)),
    excluded_observations_json TEXT NOT NULL CHECK (json_valid(excluded_observations_json)),
    agreement_json      TEXT CHECK (agreement_json IS NULL OR json_valid(agreement_json)),
    limitations_json    TEXT NOT NULL CHECK (json_valid(limitations_json)),
    result_hash         TEXT NOT NULL,
    landed_by           TEXT NOT NULL REFERENCES sessions(session_id),
    landed_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS evaluation_alternative_reviews (
    review_id           TEXT PRIMARY KEY,
    case_id             TEXT NOT NULL UNIQUE REFERENCES evaluation_cases(case_id) ON DELETE RESTRICT,
    alternatives_json   TEXT NOT NULL CHECK (json_valid(alternatives_json)),
    evidence_json       TEXT NOT NULL CHECK (json_valid(evidence_json)),
    outcome             TEXT NOT NULL CHECK (outcome IN ('survived','explained-away','underdetermined')),
    limitation          TEXT NOT NULL,
    reviewed_by         TEXT NOT NULL REFERENCES sessions(session_id),
    reviewed_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS operating_envelope_reports (
    report_id           TEXT PRIMARY KEY,
    program_id          TEXT NOT NULL UNIQUE REFERENCES evaluation_programs(program_id) ON DELETE RESTRICT,
    schema_version      TEXT NOT NULL CHECK (schema_version='1.0.0'),
    report_json         TEXT NOT NULL CHECK (json_valid(report_json)),
    report_hash         TEXT NOT NULL,
    stratum_count       INTEGER NOT NULL CHECK (stratum_count > 1),
    supported_count     INTEGER NOT NULL CHECK (supported_count >= 0),
    undetermined_count  INTEGER NOT NULL CHECK (undetermined_count >= 0),
    unsupported_count   INTEGER NOT NULL CHECK (unsupported_count >= 0),
    published_by        TEXT NOT NULL REFERENCES sessions(session_id),
    published_at        TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (supported_count+undetermined_count+unsupported_count=stratum_count)
);

CREATE TABLE IF NOT EXISTS operating_envelope_verifications (
    verification_id    INTEGER PRIMARY KEY,
    report_id           TEXT NOT NULL REFERENCES operating_envelope_reports(report_id) ON DELETE RESTRICT,
    state_ok            INTEGER NOT NULL CHECK (state_ok IN (0,1)),
    coverage_ok         INTEGER NOT NULL CHECK (coverage_ok IN (0,1)),
    content_ok          INTEGER NOT NULL CHECK (content_ok IN (0,1)),
    ok                  INTEGER NOT NULL CHECK (ok IN (0,1)),
    report_json         TEXT NOT NULL CHECK (json_valid(report_json)),
    verified_by         TEXT NOT NULL REFERENCES sessions(session_id),
    verified_at         TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (ok=(state_ok AND coverage_ok AND content_ok))
);

CREATE TABLE IF NOT EXISTS operating_envelope_rebaselines (
    successor_report_id TEXT PRIMARY KEY,
    source_report_id    TEXT NOT NULL,
    program_id          TEXT NOT NULL REFERENCES evaluation_programs(program_id) ON DELETE RESTRICT,
    schema_version      TEXT NOT NULL CHECK (schema_version='1.0.0'),
    detector_version    TEXT NOT NULL,
    detector_digest     TEXT NOT NULL,
    report_json         TEXT NOT NULL CHECK (json_valid(report_json)),
    report_hash         TEXT NOT NULL,
    reason              TEXT NOT NULL,
    rebased_by          TEXT NOT NULL REFERENCES sessions(session_id),
    rebased_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS operating_envelope_measurement_events (
    event_id            INTEGER PRIMARY KEY,
    report_id           TEXT NOT NULL,
    event_kind          TEXT NOT NULL CHECK (event_kind IN (
                            'detector-mismatch','rebaseline','successor-verification')),
    detail_json         TEXT NOT NULL CHECK (json_valid(detail_json)),
    recorded_by         TEXT NOT NULL REFERENCES sessions(session_id),
    recorded_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER IF NOT EXISTS evaluation_program_starts_planned
BEFORE INSERT ON evaluation_programs FOR EACH ROW
WHEN NEW.status!='planned' OR NEW.published_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'evaluation program must begin planned'); END;
CREATE TRIGGER IF NOT EXISTS evaluation_program_payload_is_immutable
BEFORE UPDATE ON evaluation_programs FOR EACH ROW
WHEN OLD.program_id!=NEW.program_id OR OLD.schema_version!=NEW.schema_version
  OR OLD.manifest_json!=NEW.manifest_json OR OLD.manifest_hash!=NEW.manifest_hash
  OR OLD.expected_case_count!=NEW.expected_case_count OR OLD.planned_by!=NEW.planned_by
BEGIN SELECT RAISE(ABORT, 'evaluation program manifest is immutable'); END;
CREATE TRIGGER IF NOT EXISTS evaluation_program_status_is_monotonic
BEFORE UPDATE OF status ON evaluation_programs FOR EACH ROW
WHEN NOT ((OLD.status='planned' AND NEW.status='collecting')
       OR (OLD.status='collecting' AND NEW.status='ready')
       OR (OLD.status='ready' AND NEW.status='published' AND NEW.published_at IS NOT NULL
            AND EXISTS (SELECT 1 FROM operating_envelope_reports r WHERE r.program_id=OLD.program_id)))
BEGIN SELECT RAISE(ABORT, 'invalid evaluation program status transition'); END;
CREATE TRIGGER IF NOT EXISTS evaluation_program_cannot_be_deleted
BEFORE DELETE ON evaluation_programs FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'evaluation program cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS evaluation_case_is_immutable
BEFORE UPDATE ON evaluation_cases FOR EACH ROW
WHEN OLD.case_id!=NEW.case_id OR OLD.program_id!=NEW.program_id OR OLD.stratum_id!=NEW.stratum_id
  OR OLD.repository_id!=NEW.repository_id OR OLD.repository_type!=NEW.repository_type
  OR OLD.languages_json!=NEW.languages_json OR OLD.scale_bucket!=NEW.scale_bucket
  OR OLD.repository_shape!=NEW.repository_shape OR OLD.change_class!=NEW.change_class
  OR OLD.mode!=NEW.mode OR OLD.context_condition!=NEW.context_condition
  OR OLD.model_family!=NEW.model_family OR OLD.runtime_id!=NEW.runtime_id
  OR OLD.condition_id!=NEW.condition_id OR OLD.condition_role!=NEW.condition_role
  OR OLD.replicate_id!=NEW.replicate_id OR OLD.expected_input_hash!=NEW.expected_input_hash
BEGIN SELECT RAISE(ABORT, 'evaluation case payload is immutable'); END;
CREATE TRIGGER IF NOT EXISTS evaluation_case_land_requires_result
BEFORE UPDATE OF status ON evaluation_cases FOR EACH ROW
WHEN NOT (OLD.status='planned' AND NEW.status='landed' AND NEW.landed_at IS NOT NULL
  AND EXISTS (SELECT 1 FROM evaluation_results r WHERE r.case_id=OLD.case_id))
BEGIN SELECT RAISE(ABORT, 'evaluation case landing requires result custody'); END;
CREATE TRIGGER IF NOT EXISTS evaluation_case_cannot_be_deleted
BEFORE DELETE ON evaluation_cases FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'evaluation case cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS evaluation_result_requires_planned_case
BEFORE INSERT ON evaluation_results FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM evaluation_cases c WHERE c.case_id=NEW.case_id AND c.status='planned')
BEGIN SELECT RAISE(ABORT, 'evaluation result requires planned case'); END;
CREATE TRIGGER IF NOT EXISTS evaluation_result_is_immutable
BEFORE UPDATE ON evaluation_results FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'evaluation result is immutable'); END;
CREATE TRIGGER IF NOT EXISTS evaluation_result_cannot_be_deleted
BEFORE DELETE ON evaluation_results FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'evaluation result cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS evaluation_alternative_review_requires_landed_treatment
BEFORE INSERT ON evaluation_alternative_reviews FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM evaluation_cases c JOIN evaluation_results r ON r.case_id=c.case_id
                  WHERE c.case_id=NEW.case_id AND c.condition_role='treatment'
                    AND c.status='landed' AND r.instrument_status='valid')
BEGIN SELECT RAISE(ABORT, 'alternative review requires a valid landed treatment case'); END;
CREATE TRIGGER IF NOT EXISTS evaluation_alternative_review_is_immutable
BEFORE UPDATE ON evaluation_alternative_reviews FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'evaluation alternative review is immutable'); END;
CREATE TRIGGER IF NOT EXISTS evaluation_alternative_review_cannot_be_deleted
BEFORE DELETE ON evaluation_alternative_reviews FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'evaluation alternative review cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS operating_envelope_report_requires_exact_fan_in
BEFORE INSERT ON operating_envelope_reports FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM evaluation_programs p WHERE p.program_id=NEW.program_id AND p.status='ready')
  OR (SELECT COUNT(*) FROM evaluation_cases c WHERE c.program_id=NEW.program_id)
     !=(SELECT COUNT(*) FROM evaluation_cases c WHERE c.program_id=NEW.program_id AND c.status='landed')
BEGIN SELECT RAISE(ABORT, 'operating envelope report requires ready program and exact fan-in'); END;
CREATE TRIGGER IF NOT EXISTS operating_envelope_report_is_immutable
BEFORE UPDATE ON operating_envelope_reports FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'operating envelope report is immutable'); END;
CREATE TRIGGER IF NOT EXISTS operating_envelope_report_cannot_be_deleted
BEFORE DELETE ON operating_envelope_reports FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'operating envelope report cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS operating_envelope_report_id_cannot_shadow_rebaseline
BEFORE INSERT ON operating_envelope_reports FOR EACH ROW
WHEN EXISTS (
    SELECT 1 FROM operating_envelope_rebaselines WHERE successor_report_id=NEW.report_id
)
BEGIN SELECT RAISE(ABORT, 'operating envelope report identity already exists'); END;
CREATE TRIGGER IF NOT EXISTS operating_envelope_verification_must_reconcile
BEFORE INSERT ON operating_envelope_verifications FOR EACH ROW
WHEN NEW.state_ok!=json_extract(NEW.report_json, '$.axes.state.ok')
  OR NEW.coverage_ok!=json_extract(NEW.report_json, '$.axes.coverage.ok')
  OR NEW.content_ok!=json_extract(NEW.report_json, '$.axes.content.ok')
  OR NEW.ok!=json_extract(NEW.report_json, '$.ok')
BEGIN SELECT RAISE(ABORT, 'operating envelope verification does not reconcile'); END;
CREATE TRIGGER IF NOT EXISTS operating_envelope_verification_is_immutable
BEFORE UPDATE ON operating_envelope_verifications FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'operating envelope verification is immutable'); END;
CREATE TRIGGER IF NOT EXISTS operating_envelope_verification_cannot_be_deleted
BEFORE DELETE ON operating_envelope_verifications FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'operating envelope verification cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS operating_envelope_rebaseline_is_immutable
BEFORE UPDATE ON operating_envelope_rebaselines FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'operating envelope rebaseline cannot be updated'); END;
CREATE TRIGGER IF NOT EXISTS operating_envelope_rebaseline_cannot_be_deleted
BEFORE DELETE ON operating_envelope_rebaselines FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'operating envelope rebaseline cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS operating_envelope_rebaseline_id_cannot_shadow_report
BEFORE INSERT ON operating_envelope_rebaselines FOR EACH ROW
WHEN EXISTS (
    SELECT 1 FROM operating_envelope_reports WHERE report_id=NEW.successor_report_id
)
BEGIN SELECT RAISE(ABORT, 'operating envelope report identity already exists'); END;
CREATE TRIGGER IF NOT EXISTS operating_envelope_measurement_event_is_immutable
BEFORE UPDATE ON operating_envelope_measurement_events FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'operating envelope measurement event cannot be updated'); END;
CREATE TRIGGER IF NOT EXISTS operating_envelope_measurement_event_cannot_be_deleted
BEFORE DELETE ON operating_envelope_measurement_events FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'operating envelope measurement event cannot be deleted'); END;

----------------------------------------------------------------------
-- CHORUSMITH ADAPTER: versioned projection, exact execution, and parity custody
----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS chorusmith_adapter_runs (
    run_id                   TEXT PRIMARY KEY,
    external_run_ref         TEXT NOT NULL UNIQUE,
    schema_version           TEXT NOT NULL CHECK (schema_version='1.0.0'),
    manifest_json            TEXT NOT NULL CHECK (json_valid(manifest_json)),
    manifest_hash            TEXT NOT NULL,
    expected_step_count      INTEGER NOT NULL CHECK (expected_step_count > 0),
    expected_snapshot_hash   TEXT NOT NULL,
    status                   TEXT NOT NULL DEFAULT 'planned' CHECK (status IN (
                                 'planned','running','ready','verified')),
    recovery_count           INTEGER NOT NULL DEFAULT 0 CHECK (recovery_count >= 0),
    planned_by               TEXT NOT NULL REFERENCES sessions(session_id),
    planned_at               TEXT NOT NULL DEFAULT (datetime('now')),
    verified_at              TEXT
);

CREATE TABLE IF NOT EXISTS chorusmith_adapter_steps (
    step_id                  TEXT PRIMARY KEY,
    run_id                   TEXT NOT NULL REFERENCES chorusmith_adapter_runs(run_id) ON DELETE RESTRICT,
    ordinal                  INTEGER NOT NULL CHECK (ordinal > 0),
    adapter_kind             TEXT NOT NULL CHECK (adapter_kind IN (
                                 'CodebaseBrief','ReviewBrief','ResearchRequest',
                                 'Decision','Obligation','RunManifest')),
    tool_name                TEXT NOT NULL,
    args_json                TEXT NOT NULL CHECK (json_valid(args_json)),
    args_hash                TEXT NOT NULL,
    expected_output_keys_json TEXT NOT NULL CHECK (json_valid(expected_output_keys_json)),
    status                   TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','landed')),
    output_json              TEXT CHECK (output_json IS NULL OR json_valid(output_json)),
    output_hash              TEXT,
    landed_at                TEXT,
    UNIQUE (run_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_chorusmith_adapter_steps_run
    ON chorusmith_adapter_steps(run_id,status,ordinal);

CREATE TABLE IF NOT EXISTS chorusmith_adapter_recoveries (
    recovery_id              INTEGER PRIMARY KEY,
    run_id                   TEXT NOT NULL REFERENCES chorusmith_adapter_runs(run_id) ON DELETE RESTRICT,
    landed_step_count        INTEGER NOT NULL CHECK (landed_step_count >= 0),
    next_step_id             TEXT,
    domain_projection_hash   TEXT NOT NULL,
    receipt_json             TEXT NOT NULL CHECK (json_valid(receipt_json)),
    resumed_by               TEXT NOT NULL REFERENCES sessions(session_id),
    resumed_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chorusmith_adapter_exports (
    export_id                TEXT PRIMARY KEY,
    run_id                   TEXT REFERENCES chorusmith_adapter_runs(run_id) ON DELETE RESTRICT,
    adapter_kind             TEXT NOT NULL CHECK (adapter_kind IN (
                                 'CodebaseBrief','ReviewBrief','ResearchRequest',
                                 'Decision','Obligation','RunManifest')),
    source_id                TEXT NOT NULL,
    envelope_json            TEXT NOT NULL CHECK (json_valid(envelope_json)),
    envelope_hash            TEXT NOT NULL,
    exported_by              TEXT NOT NULL REFERENCES sessions(session_id),
    exported_at              TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (adapter_kind, source_id, envelope_hash)
);

CREATE TABLE IF NOT EXISTS chorusmith_parity_verifications (
    verification_id         INTEGER PRIMARY KEY,
    run_id                   TEXT NOT NULL REFERENCES chorusmith_adapter_runs(run_id) ON DELETE RESTRICT,
    behavior_ok              INTEGER NOT NULL CHECK (behavior_ok IN (0,1)),
    evidence_ok              INTEGER NOT NULL CHECK (evidence_ok IN (0,1)),
    recovery_ok              INTEGER NOT NULL CHECK (recovery_ok IN (0,1)),
    verification_time_ok     INTEGER NOT NULL CHECK (verification_time_ok IN (0,1)),
    ok                       INTEGER NOT NULL CHECK (ok IN (0,1)),
    report_json              TEXT NOT NULL CHECK (json_valid(report_json)),
    verified_by              TEXT NOT NULL REFERENCES sessions(session_id),
    verified_at              TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (ok=(behavior_ok AND evidence_ok AND recovery_ok AND verification_time_ok))
);

CREATE TRIGGER IF NOT EXISTS chorusmith_adapter_run_starts_planned
BEFORE INSERT ON chorusmith_adapter_runs FOR EACH ROW
WHEN NEW.status!='planned' OR NEW.recovery_count!=0 OR NEW.verified_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'chorusmith adapter run must begin planned'); END;
CREATE TRIGGER IF NOT EXISTS chorusmith_adapter_run_payload_is_immutable
BEFORE UPDATE ON chorusmith_adapter_runs FOR EACH ROW
WHEN OLD.run_id!=NEW.run_id OR OLD.external_run_ref!=NEW.external_run_ref
  OR OLD.schema_version!=NEW.schema_version OR OLD.manifest_json!=NEW.manifest_json
  OR OLD.manifest_hash!=NEW.manifest_hash OR OLD.expected_step_count!=NEW.expected_step_count
  OR OLD.expected_snapshot_hash!=NEW.expected_snapshot_hash OR OLD.planned_by!=NEW.planned_by
BEGIN SELECT RAISE(ABORT, 'chorusmith adapter run manifest is immutable'); END;
CREATE TRIGGER IF NOT EXISTS chorusmith_adapter_run_status_is_monotonic
BEFORE UPDATE OF status ON chorusmith_adapter_runs FOR EACH ROW
WHEN NOT ((OLD.status='planned' AND NEW.status='running')
       OR (OLD.status='running' AND NEW.status='ready')
       OR (OLD.status='ready' AND NEW.status='verified' AND NEW.verified_at IS NOT NULL
            AND EXISTS (SELECT 1 FROM chorusmith_parity_verifications v
                         WHERE v.run_id=OLD.run_id AND v.ok=1)))
BEGIN SELECT RAISE(ABORT, 'invalid chorusmith adapter run status transition'); END;
CREATE TRIGGER IF NOT EXISTS chorusmith_adapter_recovery_count_requires_receipt
BEFORE UPDATE OF recovery_count ON chorusmith_adapter_runs FOR EACH ROW
WHEN NEW.recovery_count!=OLD.recovery_count+1
  OR NEW.recovery_count!=(SELECT COUNT(*) FROM chorusmith_adapter_recoveries r
                           WHERE r.run_id=OLD.run_id)
BEGIN SELECT RAISE(ABORT, 'chorusmith recovery count requires one reconciled receipt'); END;
CREATE TRIGGER IF NOT EXISTS chorusmith_adapter_run_cannot_be_deleted
BEFORE DELETE ON chorusmith_adapter_runs FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'chorusmith adapter run cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS chorusmith_adapter_step_payload_is_immutable
BEFORE UPDATE ON chorusmith_adapter_steps FOR EACH ROW
WHEN OLD.step_id!=NEW.step_id OR OLD.run_id!=NEW.run_id OR OLD.ordinal!=NEW.ordinal
  OR OLD.adapter_kind!=NEW.adapter_kind OR OLD.tool_name!=NEW.tool_name
  OR OLD.args_json!=NEW.args_json OR OLD.args_hash!=NEW.args_hash
  OR OLD.expected_output_keys_json!=NEW.expected_output_keys_json
BEGIN SELECT RAISE(ABORT, 'chorusmith adapter step payload is immutable'); END;
CREATE TRIGGER IF NOT EXISTS chorusmith_adapter_step_starts_planned
BEFORE INSERT ON chorusmith_adapter_steps FOR EACH ROW
WHEN NEW.status!='planned' OR NEW.output_json IS NOT NULL OR NEW.output_hash IS NOT NULL
  OR NEW.landed_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'chorusmith adapter step must begin planned'); END;
CREATE TRIGGER IF NOT EXISTS chorusmith_adapter_step_count_is_bounded
AFTER INSERT ON chorusmith_adapter_steps FOR EACH ROW
WHEN (SELECT COUNT(*) FROM chorusmith_adapter_steps s WHERE s.run_id=NEW.run_id)>
     (SELECT expected_step_count FROM chorusmith_adapter_runs r WHERE r.run_id=NEW.run_id)
BEGIN SELECT RAISE(ABORT, 'chorusmith adapter step count exceeds frozen manifest'); END;
CREATE TRIGGER IF NOT EXISTS chorusmith_adapter_step_landing_requires_output
BEFORE UPDATE OF status ON chorusmith_adapter_steps FOR EACH ROW
WHEN NOT (OLD.status='planned' AND NEW.status='landed' AND NEW.output_json IS NOT NULL
  AND NEW.output_hash IS NOT NULL AND NEW.landed_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'chorusmith adapter step landing requires output custody'); END;
CREATE TRIGGER IF NOT EXISTS chorusmith_adapter_step_output_is_immutable
BEFORE UPDATE OF output_json,output_hash,landed_at ON chorusmith_adapter_steps FOR EACH ROW
WHEN NOT (OLD.status='planned' AND NEW.status='landed'
  AND OLD.output_json IS NULL AND OLD.output_hash IS NULL AND OLD.landed_at IS NULL
  AND NEW.output_json IS NOT NULL AND NEW.output_hash IS NOT NULL AND NEW.landed_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'chorusmith adapter step output is immutable after landing'); END;
CREATE TRIGGER IF NOT EXISTS chorusmith_adapter_step_cannot_be_deleted
BEFORE DELETE ON chorusmith_adapter_steps FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'chorusmith adapter step cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS chorusmith_adapter_recovery_must_reconcile
BEFORE INSERT ON chorusmith_adapter_recoveries FOR EACH ROW
WHEN NEW.landed_step_count!=json_extract(NEW.receipt_json, '$.landed_step_count')
  OR COALESCE(NEW.next_step_id,'')!=COALESCE(json_extract(NEW.receipt_json, '$.next_step_id'),'')
  OR NEW.domain_projection_hash!=json_extract(NEW.receipt_json, '$.domain_projection_hash')
BEGIN SELECT RAISE(ABORT, 'chorusmith recovery receipt does not reconcile'); END;
CREATE TRIGGER IF NOT EXISTS chorusmith_adapter_recovery_is_immutable
BEFORE UPDATE ON chorusmith_adapter_recoveries FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'chorusmith adapter recovery is immutable'); END;
CREATE TRIGGER IF NOT EXISTS chorusmith_adapter_recovery_cannot_be_deleted
BEFORE DELETE ON chorusmith_adapter_recoveries FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'chorusmith adapter recovery cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS chorusmith_adapter_export_is_immutable
BEFORE UPDATE ON chorusmith_adapter_exports FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'chorusmith adapter export is immutable'); END;
CREATE TRIGGER IF NOT EXISTS chorusmith_adapter_export_cannot_be_deleted
BEFORE DELETE ON chorusmith_adapter_exports FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'chorusmith adapter export cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS chorusmith_parity_verification_must_reconcile
BEFORE INSERT ON chorusmith_parity_verifications FOR EACH ROW
WHEN NEW.behavior_ok!=json_extract(NEW.report_json, '$.axes.behavior.ok')
  OR NEW.evidence_ok!=json_extract(NEW.report_json, '$.axes.evidence.ok')
  OR NEW.recovery_ok!=json_extract(NEW.report_json, '$.axes.recovery.ok')
  OR NEW.verification_time_ok!=json_extract(NEW.report_json, '$.axes.verification_time.ok')
  OR NEW.ok!=json_extract(NEW.report_json, '$.ok')
BEGIN SELECT RAISE(ABORT, 'chorusmith parity verification does not reconcile'); END;
CREATE TRIGGER IF NOT EXISTS chorusmith_parity_verification_is_immutable
BEFORE UPDATE ON chorusmith_parity_verifications FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'chorusmith parity verification is immutable'); END;
CREATE TRIGGER IF NOT EXISTS chorusmith_parity_verification_cannot_be_deleted
BEFORE DELETE ON chorusmith_parity_verifications FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'chorusmith parity verification cannot be deleted'); END;

----------------------------------------------------------------------
-- DIAGNOSTICITY MATRIX: Analysis of Competing Hypotheses
----------------------------------------------------------------------
-- Heuer's ACH applied to concern competition. When two or more concerns
-- could independently explain the same symptom, the diagnosticity
-- matrix evaluates each piece of evidence against each concern and
-- asks: does this evidence discriminate between them? Evidence that
-- agrees with all competing concerns has zero diagnostic value and
-- should be down-weighted. The ranking is by inconsistency (reject the
-- concern with the most contradictions), not by support.
--
-- Structure:
--   diagnosticity_sessions  — one per symptom-cluster analysis
--   diagnosticity_concerns  — which concerns compete within that session
--   diagnosticity_evidence  — which evidence rows are relevant
--   diagnosticity_cells     — concern × evidence verdict cells
--
-- The materializer renders each session as a matrix: columns =
-- concerns, rows = evidence, cells = verdict.

CREATE TABLE IF NOT EXISTS diagnosticity_sessions (
    id                INTEGER PRIMARY KEY,
    subsystem_id      TEXT    REFERENCES subsystems(id),
    symptom           TEXT    NOT NULL,           -- what triggered competition
    shared_location   TEXT,                        -- file:symbol@sha
    leading_concern   TEXT,                        -- after analysis; may be NULL while open
    linchpin_note     TEXT,                        -- if leading is fragile, what breaks it
    outcome           TEXT    CHECK (outcome IN (
                              'open','resolved','unresolved-competition')) DEFAULT 'open',
    session_id        TEXT,
    created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    resolved_at       TEXT
);

CREATE TABLE IF NOT EXISTS diagnosticity_concerns (
    matrix_id         INTEGER NOT NULL REFERENCES diagnosticity_sessions(id) ON DELETE CASCADE,
    concern_code      TEXT    NOT NULL REFERENCES concerns(code),
    rank              INTEGER,                     -- final ranking; NULL while unresolved
    eliminated        INTEGER NOT NULL DEFAULT 0,  -- 1 if ruled out by inconsistency
    PRIMARY KEY (matrix_id, concern_code)
);

CREATE TABLE IF NOT EXISTS diagnosticity_evidence (
    matrix_id         INTEGER NOT NULL REFERENCES diagnosticity_sessions(id) ON DELETE CASCADE,
    evidence_id       INTEGER NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
    row_order         INTEGER,                     -- display order in the matrix
    PRIMARY KEY (matrix_id, evidence_id)
);

CREATE TABLE IF NOT EXISTS diagnosticity_cells (
    matrix_id         INTEGER NOT NULL,
    concern_code      TEXT    NOT NULL,
    evidence_id       INTEGER NOT NULL,
    verdict           TEXT    NOT NULL CHECK (verdict IN (
                              'consistent','contradicts','irrelevant','ambiguous')),
    note              TEXT,
    PRIMARY KEY (matrix_id, concern_code, evidence_id),
    FOREIGN KEY (matrix_id, concern_code) REFERENCES diagnosticity_concerns(matrix_id, concern_code) ON DELETE CASCADE,
    FOREIGN KEY (matrix_id, evidence_id)  REFERENCES diagnosticity_evidence(matrix_id, evidence_id) ON DELETE CASCADE
);

-- Diagnostic value per evidence row: how well does this evidence
-- discriminate between the competing concerns in its matrix?
-- Contradicts count − consistent count + absolute of each is a rough
-- proxy for discriminatory power; the materializer surfaces it.
CREATE VIEW IF NOT EXISTS diagnosticity_evidence_value AS
SELECT
    c.matrix_id,
    c.evidence_id,
    SUM(CASE WHEN c.verdict='contradicts' THEN 1 ELSE 0 END) AS n_contradicts,
    SUM(CASE WHEN c.verdict='consistent'  THEN 1 ELSE 0 END) AS n_consistent,
    SUM(CASE WHEN c.verdict='irrelevant'  THEN 1 ELSE 0 END) AS n_irrelevant,
    SUM(CASE WHEN c.verdict='ambiguous'   THEN 1 ELSE 0 END) AS n_ambiguous,
    COUNT(*)                                                 AS n_total
FROM diagnosticity_cells c
GROUP BY c.matrix_id, c.evidence_id;


----------------------------------------------------------------------
-- OPEN_QUESTIONS: items the (cloud, autoprogress) agent could not
-- decide without human input
----------------------------------------------------------------------
-- In autoprogress mode the coordinator does not pause for human review
-- at phase gates; instead it records any blocking question here and
-- proceeds with its best-available interpretation. A human reviewer
-- works through this table post-hoc to close out questions and, where
-- needed, trigger a reset_subsystem + re-survey.
CREATE TABLE IF NOT EXISTS open_questions (
    id              INTEGER PRIMARY KEY,
    category        TEXT    NOT NULL CHECK (category IN (
                              'domain-knowledge',   -- asked the human about business rules
                              'scope-judgment',     -- need a human to confirm the scope fence
                              'priority-ranking',   -- agent guessed; reviewer can override
                              'contradiction',     -- two credible sources disagree
                              'tooling-limit',     -- an operation the agent could not perform
                              'ambiguous-evidence',-- evidence permits multiple interpretations
                              'other')),
    subsystem_id    TEXT,                           -- nullable for global questions
    phase           TEXT,                           -- the phase when the question arose
    question        TEXT    NOT NULL,               -- the question as asked
    what_blocked    TEXT,                           -- what the agent could not do because of it
    what_assumed    TEXT,                           -- the assumption the agent proceeded with
    session_id      TEXT,
    ref_sha         TEXT,
    resolution      TEXT    CHECK (resolution IN (
                              'open','answered','dismissed','superseded')) DEFAULT 'open',
    answer          TEXT,                           -- how the human resolved it (if answered)
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    resolved_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_open_questions_resolution ON open_questions(resolution)
    WHERE resolution = 'open';
CREATE INDEX IF NOT EXISTS idx_open_questions_subsystem  ON open_questions(subsystem_id);
CREATE INDEX IF NOT EXISTS idx_open_questions_phase      ON open_questions(phase);
