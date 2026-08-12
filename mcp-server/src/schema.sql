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
