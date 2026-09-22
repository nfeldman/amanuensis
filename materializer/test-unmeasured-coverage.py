#!/usr/bin/env python3
"""GATE PM1 — the projection renders `not measured` (packet P6).

`design/survey-depth/spec.md` §3.4, §4.5, §5.6; claims C14, C18, C34, C39.

Red when the overview's `Paths in scope with no ledger row` prints a number for
an unreconciled store; the coverage denominator is drawn from the ledger rather
than from the standing reconciliation; `Not yet surveyed` §1 prints a
denominator for an unreconciled store; the `not measured` sentence omits the
revision or the reason; a declined subsystem renders as though it were never
asked; the Carried obligations section is missing from either lens or either
format; `Carried defects undecided` is absent or summed into `Findings open`;
or the read-back's coverage axis counts a `not measured` row as satisfied.

**Two controls, because one fixture cannot carry both halves (§8.6).**

(a) A reconciled store with **zero** unledgered paths renders exactly the
    numbers it renders today, asserted byte-for-byte against the blocks
    recorded in `EXPECTED_*` below. Those constants were captured from the
    renderer as it stood before this packet, so the control fails the moment
    the change reaches a store shape it must not touch.

(b) A reconciled store with unledgered **greater than zero** renders against
    the *new* denominator. **The intended change, recorded here as §8.6
    requires:** fixture B's ledger carries three obligation-bearing rows and
    its tree carries five obligation-bearing tracked paths, so
    `Files read, of those carrying an obligation` moves from **`2 of 3`**
    (today: `obligation_files`, `SUM(CASE WHEN … ) FROM file_ledger`,
    `renderers.py:415`, read at `:630`) to **`2 of 5`** (D2 over the standing
    reconciliation, `tracked_paths - exempt`). The two differ by exactly the
    unledgered count, which is why a byte-identical control is satisfiable only
    on the zero-unledgered fixture (a) — the one store shape this change does
    not affect.

**False green it cannot exclude.** It asserts the rendering of a store it is
handed. A reconciliation record that is itself wrong renders faithfully and
wrongly; `GATE SR1` owns that. It also cannot see a workspace this machine
cannot enumerate: where `git ls-tree` cannot answer at the published revision,
the projection stands on the row's own `ledger_digest` and on the recorded
revision, and the tree arm of §3.3's condition 4 is unevaluated — the
`different tree` case below is the arm that proves the check fires where git
*can* answer.

Output protocol: exactly one status line, last, on stdout, and it is addressed
to two readers at once. §8.0 clauses 1 and 2 bind the launcher to the *packet*
id — it greps `^GATE P6 RED: ` and `^GATE P6 GREEN` and knows nothing of this
specification's own gate names — while §8.6 and `plan.json`'s `gate.red_expect`
name this gate PM1. So the packet marker leads and PM1's verdict is the reason
it carries: `GATE P6 RED: GATE PM1 RED: …`, `GATE P6 GREEN — GATE PM1 GREEN`.
Every message, including everything captured from a spawned process, is
scrubbed of the launcher's crash signatures, so an absent deliverable reads as
a failed assertion rather than as a gate that never ran.
"""

from __future__ import annotations

import hashlib
import importlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
SCHEMA = REPO / "mcp-server" / "src" / "schema.sql"
CI_FILE = REPO / ".github" / "workflows" / "test.yml"
CI_COMMAND = "test-unmeasured-coverage.py"

# ---------------------------------------------------------------------------
# Output funnel. Nothing reaches stdout except through emit(), and everything is
# scrubbed of the launcher's crash signatures so a genuine assertion failure is
# never mistaken for a gate that never ran.
# ---------------------------------------------------------------------------
_SCRUB: tuple[tuple[str, str], ...] = (
    ("MODULE_NOT_FOUND", "module-absent"),
    ("ModuleNotFoundError", "python-module-absent"),
    ("Cannot find module", "cannot load module"),
    ("No such file or directory", "path is absent"),
    ("No such file", "path is absent"),
    ("can't open file", "cannot open path"),
    ("SyntaxError", "syntax-error"),
    ("ImportError", "python-import-error"),
    ("ReferenceError", "reference-error"),
    ("TypeError", "type-error"),
    ("AttributeError", "attribute-error"),
    ("ENOENT", "PATH-ABSENT"),
    ("is not defined", "is undeclared"),
    ("is not a function", "is not callable"),
    ("command not found", "executable is absent"),
)


def scrub(text: object) -> str:
    out = "" if text is None else str(text)
    for needle, replacement in _SCRUB:
        out = out.replace(needle, replacement)
    return out


def emit(line: str = "") -> None:
    sys.stdout.write(f"{scrub(line)}\n")


FAILURES: list[str] = []
UNEVALUATED: list[str] = []


def check(label: str, fn: Callable[[], str | None]) -> None:
    try:
        reason = fn()
    except Exception as exc:  # the gate must survive any absent deliverable
        reason = f"raised while checking — {exc!r}"
    if reason:
        FAILURES.append(f"{label}: {reason}")
        emit(f"  FAIL {label}: {reason}")
    else:
        emit(f"  ok   {label}")


def note(line: str) -> None:
    """Recorded, never counted as a pass: an arm whose subject this machine lacks."""
    UNEVALUATED.append(line)
    emit(f"  note {line}")


def finish() -> int:
    emit("")
    for line in UNEVALUATED:
        emit(f"unevaluated here: {line}")
    if FAILURES:
        emit(
            "GATE P6 RED: GATE PM1 RED: an unreconciled store rendered a coverage number,"
            " a reconciled one was counted over its own ledger, a declination or a carried"
            f" obligation went unrendered, or a read-back axis missed it — {len(FAILURES)}"
            f" assertion(s) failed; first: {FAILURES[0]}"
        )
        return 1
    emit("GATE P6 GREEN — GATE PM1 GREEN")
    return 0


# ---------------------------------------------------------------------------
# What the specification fixes, written out here rather than imported, so that
# rewriting an implementation constant cannot also rewrite what this gate
# expects (§3.3, §3.4, §4.5, §5.6).
# ---------------------------------------------------------------------------
NUL = "\x00"
PROJECT_NAME = "LedgerFixture"
SESSION = "p6"
BRANCH = "main"

# The tree every fixture is reconciled against. Seven paths, two of them
# carrying an exempting classification wherever they are ledgered, so D2 is
# never the same number as |tracked| and a denominator that forgot the
# exemption is visible.
TRACKED: tuple[tuple[str, str], ...] = (
    ("dist/bundle.js", "window.__fixture = 1;\n"),
    ("docs/guide.md", "# Guide\n\nRead the reader first.\n"),
    ("src/pending.ts", "export const pending = () => 0;\n"),
    ("src/reader.ts", "export const read = () => 0;\n"),
    ("src/writer.ts", "export const append = () => 0;\n"),
    ("tools/build.sh", "#!/bin/sh\necho build\n"),
    ("vendor/lib.js", "module.exports = {};\n"),
)
TRACKED_PATHS: tuple[str, ...] = tuple(path for path, _body in TRACKED)

EXEMPT_CLASSIFICATIONS = ("generated-ignore", "vendor-ignore", "irrelevant")

# Fixture (a): every tracked path is ledgered. `unledgered` is 0, so the new
# denominator and the old one agree and the rendering must not move a byte.
LEDGER_FULL: tuple[tuple[str, str, str], ...] = (
    ("B-01", "src/reader.ts", "examined"),
    ("B-02", "src/writer.ts", "examined"),
    ("B-02", "src/pending.ts", "candidate"),
    ("B-01", "dist/bundle.js", "generated-ignore"),
    ("B-01", "vendor/lib.js", "vendor-ignore"),
    ("B-01", "docs/guide.md", "examined"),
    ("B-02", "tools/build.sh", "candidate"),
)
# Fixture (b) and the unreconciled fixtures: `docs/guide.md` and
# `tools/build.sh` are tracked and unledgered.
LEDGER_PARTIAL: tuple[tuple[str, str, str], ...] = (
    ("B-01", "src/reader.ts", "examined"),
    ("B-02", "src/writer.ts", "examined"),
    ("B-02", "src/pending.ts", "candidate"),
    ("B-01", "dist/bundle.js", "generated-ignore"),
    ("B-01", "vendor/lib.js", "vendor-ignore"),
)
UNLEDGERED_PATHS: tuple[str, ...] = ("docs/guide.md", "tools/build.sh")

# The arithmetic both controls turn on, computed here from the fixtures above
# rather than read back from the page under test.
FULL_OBLIGATION_ROWS = sum(1 for _s, _p, c in LEDGER_FULL if c not in EXEMPT_CLASSIFICATIONS)
FULL_EXAMINED = len({p for _s, p, c in LEDGER_FULL if c == "examined"})
PARTIAL_OBLIGATION_ROWS = sum(
    1 for _s, _p, c in LEDGER_PARTIAL if c not in EXEMPT_CLASSIFICATIONS
)
PARTIAL_EXAMINED = len({p for _s, p, c in LEDGER_PARTIAL if c == "examined"})
PARTIAL_EXEMPT = len({p for _s, p, c in LEDGER_PARTIAL if c in EXEMPT_CLASSIFICATIONS})
# D2 = |tracked| - |tracked ∩ exempt| (§1.2). Five, against the three
# obligation-bearing ledger rows today's denominator counts.
PARTIAL_D2 = len(TRACKED_PATHS) - PARTIAL_EXEMPT
PARTIAL_OLD_DENOMINATOR = PARTIAL_OBLIGATION_ROWS

SUBSYSTEMS: tuple[tuple[str, str, str, str], ...] = (
    ("B-01", "Read path", "mapped", "backend"),
    ("B-02", "Write path", "mapped", "backend"),
    ("B-03", "Queue", "scoping", "backend"),
)

# §4.5's three states, one subsystem each.
VOCAB_TERM = "ledger row"
VOCAB_GLOSS = "One append to the ledger, with the owner that appended it."
DECLINED_SUPERSEDED = "B-01"   # anchored term *and* an earlier declination
DECLINED_CURRENT = "B-02"      # a declination and no term
VOCAB_NOT_RECORDED = "B-03"    # neither
REASON_SUPERSEDED = (
    "An earlier structural pass found no name the read path coins for itself."
)
REASON_CURRENT = (
    "The write path names nothing of its own; every term it uses is the ledger's."
)

# §5.6's carried obligations. One undecided, two decided, so both lenses have a
# denominator and neither section can be satisfied by the other's records.
CARRIED_STORE = "store-7c1c1a9f00000000"
CARRIED: tuple[tuple[str, str, str, str, str | None], ...] = (
    # archived id, subsystem, severity, symptom, outcome-or-None
    ("B03-5", "B-01", "HIGH", "A subsystem reports mapped with an unchecked tree.", None),
    (
        "B03-6",
        "B-02",
        "MEDIUM",
        "The write path publishes a coverage fraction of itself.",
        "successor-finding",
    ),
    ("B04-5", "B-03", "LOW", "The queue's retry budget is undocumented.", "ruled-out"),
)
CARRIED_UNDECIDED = tuple(c for c in CARRIED if c[4] is None)
CARRIED_DECIDED = tuple(c for c in CARRIED if c[4] is not None)
CARRIED_SUCCESSOR = "B02-1"

CARRIED_HEADING = "Carried obligations"
CARRIED_OVERVIEW_ROW = "Carried defects undecided"
UNDECIDED_WORD = "undecided"
NOT_MEASURED = "not measured"
NOT_RECORDED = "not recorded"
SUPERSEDED_HEADING = "Superseded: this subsystem previously declared no domain vocabulary"
DECLINED_INDEX_HEADING = "Subsystems that declared no domain vocabulary"

OVERVIEW_PAGE = "index.md"
GAPS_PAGE = "not-yet-surveyed.md"
FINDINGS_PAGE = "findings.md"
RESOLVED_PAGE = "resolved-findings.md"
GLOSSARY_PAGE = "vocabulary.md"
COVERAGE_ROWS = (
    "Files read, of those carrying an obligation",
    "Paths in scope with no ledger row",
)
GAPS_SECTION_1 = "Paths with no ledger row"

# ---------------------------------------------------------------------------
# Control (a), recorded. These three blocks are the bytes the renderer produced
# for fixture (a) *before* this packet, captured from it and committed with the
# gate's red proof. A reconciled store with zero unledgered paths must still
# render exactly them: the new denominator and the old one differ by the
# unledgered count, and at zero they are the same number. The commit the
# fixture workspace is built at is deterministic — fixed author, fixed
# committer, fixed dates, fixed tree — so `c4ee87e3b6ac` is the same revision
# on every machine and these bytes are reproducible rather than local.
# ---------------------------------------------------------------------------
EXPECTED_SURVEY_COVERAGE = """| Metric | Value |
|---|---|
| Subsystems by survey depth | 1 scoping, 2 mapped |
| Files read, of those carrying an obligation | 3 of 5 |
| Paths in scope with no ledger row | 0 |"""

EXPECTED_SOURCE_ALIGNMENT = """| Metric | Value |
|---|---|
| Checked at | `c4ee87e3b6ac` on `main`, 2026-09-14 00:00 UTC |
| Repository head | `c4ee87e3b6ac` \u2014 the same revision the survey checked |
| Upstream head | not known here |
| Files carrying a survey obligation marked stale | 0 of 5 |
| Scoped files exempt from that obligation, marked stale | 0 of 2 |"""

EXPECTED_GAPS_SECTION = (
    "**0 of 7** tracked paths are named by no `file_ledger` row in any subsystem."
    " They participate in no subsystem's scope, so nothing here has been read,"
    " excluded, or deferred."
)


# ---------------------------------------------------------------------------
# Fixtures. One git workspace, committed with fixed identity and fixed dates so
# its commit id is the same on every machine, and therefore so are the bytes
# control (a) is asserted against.
# ---------------------------------------------------------------------------
GIT_ENV = {
    "GIT_AUTHOR_NAME": "PM1 gate",
    "GIT_AUTHOR_EMAIL": "gate@example.invalid",
    "GIT_AUTHOR_DATE": "2026-09-14T00:00:00+0000",
    "GIT_COMMITTER_NAME": "PM1 gate",
    "GIT_COMMITTER_EMAIL": "gate@example.invalid",
    "GIT_COMMITTER_DATE": "2026-09-14T00:00:00+0000",
}


def git(workspace: Path, *args: str) -> subprocess.CompletedProcess[str]:
    env = {**os.environ, **GIT_ENV}
    return subprocess.run(
        ["git", "-C", str(workspace), *args],
        capture_output=True,
        text=True,
        check=False,
        env=env,
    )


def make_workspace(root: Path) -> tuple[Path, str | None]:
    """The tree every reconciliation in this gate is taken over."""

    workspace = root / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    for rel, body in TRACKED:
        target = workspace / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(body)
    try:
        if git(workspace, "-c", "init.defaultBranch=main", "init", "--quiet").returncode != 0:
            return workspace, None
        if git(workspace, "add", "-A").returncode != 0:
            return workspace, None
        if git(workspace, "commit", "--quiet", "-m", "fixture").returncode != 0:
            return workspace, None
        head = git(workspace, "rev-parse", "HEAD")
    except OSError:
        return workspace, None
    if head.returncode != 0:
        return workspace, None
    return workspace, (head.stdout.strip() or None)


def digest(parts: list[str]) -> str:
    """A set, as one hash: sorted, NUL-joined, SHA-256 (spec §3.2)."""

    return hashlib.sha256(NUL.join(sorted(parts)).encode()).hexdigest()


def tree_digest(paths: tuple[str, ...]) -> str:
    return digest(list(paths))


def ledger_digest(ledger: tuple[tuple[str, str, str], ...]) -> str:
    return digest([f"{path}{NUL}{classification}" for _s, path, classification in ledger])


ENTRY_POINT = f"""# Where to begin

Read `src/reader.ts` first, then `src/writer.ts`.

## What is this codebase?

{PROJECT_NAME} appends ledger rows durably and serves them through a separate
read path.
"""

ONBOARDING_REPORT = f"""# Onboarding report

**Codebase**: {PROJECT_NAME} — PM1 gate fixture

## Directory clusters

- src/ — B-01
"""


def seed(
    storage: Path,
    workspace: Path,
    head: str,
    *,
    ledger: tuple[tuple[str, str, str], ...],
    unledgered: tuple[str, ...],
    reconciled: bool = True,
    reconciled_sha: str | None = None,
    reconciled_tree: tuple[str, ...] | None = None,
    reconciled_ledger: tuple[tuple[str, str, str], ...] | None = None,
    vocabulary: bool = False,
    vocabulary_anchor: str | None = None,
    workspace_path: Path | str | None = None,
    carried: bool = False,
) -> None:
    """One store, in whichever of §3.3's standings the caller asks for."""

    db = sqlite3.connect(storage / "memory.db")
    db.executescript(SCHEMA.read_text())
    cur = db.cursor()
    cur.execute(
        "INSERT INTO git_state (repo_id, canonical_branch, onboarding_sha,"
        " last_checked_sha, last_checked_at) VALUES ('default', ?, ?, ?,"
        " '2026-09-14T00:00:00Z')",
        (BRANCH, head, head),
    )
    cur.execute(
        "INSERT INTO sessions (session_id, intent) VALUES (?, 'fixture')", (SESSION,)
    )
    cur.executemany(
        "INSERT INTO subsystems (id, name, status, layer, scope)"
        " VALUES (?, ?, ?, ?, 'src/')",
        list(SUBSYSTEMS),
    )
    cur.executemany(
        "INSERT INTO file_ledger (subsystem_id, file_path, why_in_scope, classification,"
        " ref_sha, stale) VALUES (?, ?, 'fixture', ?, ?, 0)",
        [(s, p, c, head) for s, p, c in ledger],
    )
    cur.executemany(
        "INSERT INTO scope_gaps (file_path, kind, subsystem_id, detected_sha)"
        " VALUES (?, 'unledgered', NULL, ?)",
        [(path, head) for path in unledgered],
    )
    if reconciled:
        paths = reconciled_tree if reconciled_tree is not None else TRACKED_PATHS
        witness = reconciled_ledger if reconciled_ledger is not None else ledger
        ledgered = {p for _s, p, _c in ledger}
        exempt = len({p for _s, p, c in ledger if c in EXEMPT_CLASSIFICATIONS})
        cur.execute(
            "INSERT INTO scope_reconciliations (detected_sha, tree_digest, ledger_digest,"
            " tracked_paths, ledger_rows, unledgered, absent, exempt, session_id,"
            " detected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-09-14T00:00:00Z')",
            (
                reconciled_sha if reconciled_sha is not None else head,
                tree_digest(paths),
                ledger_digest(witness),
                len(TRACKED_PATHS),
                len(ledgered),
                len(unledgered),
                0,
                exempt,
                SESSION,
            ),
        )
    findings = (
        ("B01-1", "B-01", "HIGH", "The overview publishes a fraction of itself."),
        ("B01-2", "B-01", "MEDIUM", "The gap page counts over the ledger it measures."),
        (CARRIED_SUCCESSOR, "B-02", "HIGH", "The write path drops its reconciliation."),
    )
    for finding_id, subsystem, severity, symptom in findings:
        cur.execute(
            "INSERT INTO findings (finding_id, subsystem_id, symptom, root_cause,"
            " severity, status, ref_sha, session_id, pass_type)"
            " VALUES (?, ?, ?, 'fixture cause', ?, 'confirmed-bug', ?, ?, 'survey')",
            (finding_id, subsystem, symptom, severity, head, SESSION),
        )
        cur.execute(
            "INSERT INTO finding_resolution_events (finding_id, resolution_state,"
            " rationale, session_id) VALUES (?, 'open', 'fixture', ?)",
            (finding_id, SESSION),
        )
    if vocabulary:
        cur.execute(
            "INSERT INTO vocabulary (term, gloss, subsystem_id, first_seen)"
            " VALUES (?, ?, ?, ?)",
            (
                VOCAB_TERM,
                VOCAB_GLOSS,
                DECLINED_SUPERSEDED,
                vocabulary_anchor
                if vocabulary_anchor is not None
                else f"src/reader.ts:read@{head}",
            ),
        )
        cur.executemany(
            "INSERT INTO vocabulary_declinations (subsystem_id, reason, session_id, ref_sha,"
            " declared_at) VALUES (?, ?, ?, ?, '2026-09-14T00:00:00Z')",
            [
                (DECLINED_SUPERSEDED, REASON_SUPERSEDED, SESSION, head),
                (DECLINED_CURRENT, REASON_CURRENT, SESSION, head),
            ],
        )
    if carried:
        cur.execute(
            "INSERT INTO carry_runs (source_kind, source_path, archived_store_id,"
            " archived_anchor, reason, expected_count, imported_count, session_id)"
            " VALUES ('store', '/archive/memory.db', ?, ?, 'fixture carry', ?, ?, ?)",
            (CARRIED_STORE, head, len(CARRIED), len(CARRIED), SESSION),
        )
        run_id = cur.lastrowid
        for archived_id, subsystem, severity, symptom, outcome in CARRIED:
            cur.execute(
                "INSERT INTO carried_findings (archived_finding_id, archived_store_id,"
                " archived_anchor_sha, subsystem_id, severity, symptom, root_cause,"
                " carry_run_id, archived_resolution, archived_ref_sha, primary_files,"
                " carried_by_session) VALUES (?, ?, ?, ?, ?, ?, 'archived cause', ?,"
                " 'open', ?, '[]', ?)",
                (
                    archived_id,
                    CARRIED_STORE,
                    head,
                    subsystem,
                    severity,
                    symptom,
                    run_id,
                    head,
                    SESSION,
                ),
            )
            carried_id = cur.lastrowid
            if outcome is None:
                continue
            cur.execute(
                "INSERT INTO carried_finding_outcomes (carried_id, outcome, successor_id,"
                " rationale, session_id, ref_sha) VALUES (?, ?, ?, 'fixture decision', ?, ?)",
                (
                    carried_id,
                    outcome,
                    CARRIED_SUCCESSOR if outcome == "successor-finding" else None,
                    SESSION,
                    head,
                ),
            )
    db.commit()
    db.close()
    bound = workspace if workspace_path is None else workspace_path
    (storage / "workspace_path").write_text(f"{bound}\n")
    (storage / "entry-point.md").write_text(ENTRY_POINT)
    (storage / "onboarding-report.md").write_text(ONBOARDING_REPORT)


def publish(storage: Path, *args: str) -> dict[str, Any]:
    """Run the materializer, capturing everything. Never echoes its output."""

    proc = subprocess.run(
        [sys.executable, str(ROOT / "materialize.py"), "--storage", str(storage), *args],
        capture_output=True,
        text=True,
        check=False,
    )
    lines = [line for line in proc.stdout.splitlines() if line.strip()]
    summary: dict[str, Any] = {}
    if lines:
        try:
            summary = json.loads(lines[-1])
        except json.JSONDecodeError:
            summary = {}
    summary["_returncode"] = proc.returncode
    if not lines:
        summary["_diagnostic"] = scrub(proc.stderr)[-400:]
    return summary


def read(path: Path) -> str | None:
    try:
        return path.read_text()
    except OSError:
        return None


def section(text: str, heading: str, level: int = 2) -> str:
    """The body of one Markdown section, up to the next heading of its level."""

    lines = text.splitlines()
    marker = "#" * level + " "
    start = None
    for index, line in enumerate(lines):
        if line.startswith(marker) and line[len(marker) :].strip() == heading:
            start = index + 1
            break
    if start is None:
        return ""
    body: list[str] = []
    for line in lines[start:]:
        stripped = line.lstrip("#")
        depth = len(line) - len(stripped)
        if line.startswith("#") and 0 < depth <= level:
            break
        body.append(line)
    return "\n".join(body).strip("\n")


def metric_row(text: str, label: str) -> str | None:
    """The value cell of one `| label | value |` row, or None when absent."""

    for line in text.splitlines():
        if not line.startswith("|"):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) >= 2 and cells[0].strip("*` ") == label:
            return cells[1]
    return None


def coverage_block(docs: Path) -> str:
    overview = read(docs / OVERVIEW_PAGE) or ""
    return section(section(overview, "Where the record stands"), "Survey coverage", level=3)


def work_block(docs: Path) -> str:
    overview = read(docs / OVERVIEW_PAGE) or ""
    return section(
        section(overview, "Where the record stands"), "Open engineering work", level=3
    )


def gaps_block(docs: Path) -> str:
    return section(read(docs / GAPS_PAGE) or "", GAPS_SECTION_1)


def corpus(docs: Path, suffix: str) -> str:
    return "\n".join(
        read(path) or "" for path in sorted(docs.rglob(f"*{suffix}")) if path.is_file()
    )


def names_revision(text: str, sha: str) -> bool:
    """Whether a sentence names the revision it is about, however abbreviated."""

    return any(sha[:n] in text for n in (7, 8, 12, 40) if len(sha) >= n)


def axes(summary: dict[str, Any]) -> dict[str, bool]:
    readback = summary.get("readback") or summary
    recorded = readback.get("axes") or {}
    return {
        axis: bool((recorded.get(axis) or {}).get("ok"))
        for axis in ("state", "coverage", "content")
    }


def mismatches(summary: dict[str, Any]) -> list[dict[str, str]]:
    readback = summary.get("readback") or summary
    return list(readback.get("mismatches") or [])


# The reasons §3.3 distinguishes, as the projection must print them. A sentence
# that says only "not measured" tells a reader nothing to repair, which is why
# §8.6 makes an omitted reason a red condition in its own right.
REASON_PHRASES = (
    "no reconciliation has been recorded",
    "the file ledger has changed",
    "was taken over a different tree",
)


def unmeasured_failure(cell: str | None, label: str, sha: str) -> str | None:
    """Whether one overview cell is a refusal to measure, said in full."""

    if cell is None:
        return f"the overview carries no {label!r} row at all"
    if NOT_MEASURED not in cell:
        return (
            f"{label!r} reads {cell!r} for an unreconciled store — an unreconciled"
            " store rendered a coverage number"
        )
    if not names_revision(cell, sha):
        return f"the {NOT_MEASURED!r} sentence for {label!r} names no revision: {cell!r}"
    if not any(phrase in cell for phrase in REASON_PHRASES):
        return f"the {NOT_MEASURED!r} sentence for {label!r} names no reason: {cell!r}"
    return None


def main() -> int:
    emit("GATE PM1 — the projection renders 'not measured' (P6)")
    emit("")

    root = Path(tempfile.mkdtemp(prefix="pm1-"))
    try:
        workspace, head = make_workspace(root)
        if head is None:
            emit("")
            emit(
                "GATE P6 RED: GATE PM1 RED: an unreconciled store rendered a coverage"
                " number could not be tested — git could not build the fixture"
                " workspace this gate reconciles against"
            )
            return 1

        def build(name: str, **kwargs: Any) -> tuple[Path, dict[str, Any], str | None]:
            storage = root / name
            storage.mkdir(parents=True, exist_ok=True)
            try:
                seed(storage, workspace, head, **kwargs)
            except Exception as exc:
                return storage, {}, f"the {name} fixture could not be seeded — {scrub(exc)}"
            return storage, publish(storage, "--clean-publish"), None

        # -- the unreconciled store: the headline red --------------------------
        emit("An unreconciled store has no denominator (§3.4)")
        unrec_storage, unrec, unrec_error = build(
            "unreconciled",
            ledger=LEDGER_PARTIAL,
            unledgered=UNLEDGERED_PATHS,
            reconciled=False,
        )
        unrec_docs = unrec_storage / "docs"

        def unreconciled_unledgered() -> str | None:
            if unrec_error:
                return unrec_error
            return unmeasured_failure(
                metric_row(coverage_block(unrec_docs), COVERAGE_ROWS[1]),
                COVERAGE_ROWS[1],
                head,
            )

        check(
            "an unreconciled store does not print a count of paths with no ledger row",
            unreconciled_unledgered,
        )

        def unreconciled_files_read() -> str | None:
            if unrec_error:
                return unrec_error
            return unmeasured_failure(
                metric_row(coverage_block(unrec_docs), COVERAGE_ROWS[0]),
                COVERAGE_ROWS[0],
                head,
            )

        check(
            "an unreconciled store does not print a coverage fraction for files read",
            unreconciled_files_read,
        )

        def unreconciled_gap_section() -> str | None:
            if unrec_error:
                return unrec_error
            body = gaps_block(unrec_docs)
            if not body:
                return f"{GAPS_PAGE} carries no {GAPS_SECTION_1!r} section"
            if re.search(r"\*\*\d+ of \d+\*\*", body):
                return (
                    "'Not yet surveyed' section 1 prints a denominator for an"
                    f" unreconciled store: {body.splitlines()[0]!r}"
                )
            if "not measured here" not in body:
                return (
                    "section 1 neither counts nor routes into the gap-denominator"
                    f" sentence: {body[:200]!r}"
                )
            if not names_revision(body, head):
                return f"section 1's refusal to measure names no revision: {body[:240]!r}"
            return None

        check(
            "'Not yet surveyed' section 1 routes an unreconciled store into the"
            " gap-denominator sentence with the revision named",
            unreconciled_gap_section,
        )

        def unreconciled_publishes_green() -> str | None:
            if unrec_error:
                return unrec_error
            result = axes(unrec)
            red = [axis for axis, ok in result.items() if not ok]
            if red:
                return (
                    "the read-back reports a 'not measured' row as a fault rather than"
                    f" as present and honest — {red} red: {mismatches(unrec)[:2]}"
                )
            return None

        check(
            "the read-back counts a 'not measured' row as present and honest",
            unreconciled_publishes_green,
        )

        # -- control (a): reconciled, zero unledgered, byte-for-byte ----------
        emit("")
        emit("Control (a): a reconciled store with zero unledgered paths (§8.6)")
        full_storage, full, full_error = build(
            "reconciled-full", ledger=LEDGER_FULL, unledgered=()
        )
        full_docs = full_storage / "docs"

        def byte_identical(name: str, actual: Callable[[], str], expected: str) -> str | None:
            if full_error:
                return full_error
            body = actual()
            if body == expected:
                return None
            return (
                f"{name} is not what it renders today. Recorded:\n{expected}\nRendered:\n{body}"
            )

        check(
            "the overview's Survey coverage block is byte-for-byte what it renders today",
            lambda: byte_identical(
                "Survey coverage", lambda: coverage_block(full_docs), EXPECTED_SURVEY_COVERAGE
            ),
        )
        check(
            "the overview's Source alignment block is byte-for-byte what it renders today",
            lambda: byte_identical(
                "Source alignment",
                lambda: section(
                    section(read(full_docs / OVERVIEW_PAGE) or "", "Where the record stands"),
                    "Source alignment",
                    level=3,
                ),
                EXPECTED_SOURCE_ALIGNMENT,
            ),
        )
        check(
            "'Not yet surveyed' section 1 is byte-for-byte what it renders today",
            lambda: byte_identical(
                GAPS_SECTION_1, lambda: gaps_block(full_docs), EXPECTED_GAPS_SECTION
            ),
        )

        def full_publishes_green() -> str | None:
            if full_error:
                return full_error
            red = [axis for axis, ok in axes(full).items() if not ok]
            if red:
                return f"the control publish is read-back red on {red}: {mismatches(full)[:2]}"
            return None

        check("the zero-unledgered control publishes read-back green", full_publishes_green)

        # -- control (b): reconciled, unledgered > 0 --------------------------
        emit("")
        emit(
            "Control (b): a reconciled store with unledgered > 0 — the denominator moves"
            f" from {PARTIAL_OLD_DENOMINATOR} ledger rows to {PARTIAL_D2} tracked paths"
        )
        part_storage, part, part_error = build(
            "reconciled-partial", ledger=LEDGER_PARTIAL, unledgered=UNLEDGERED_PATHS
        )
        part_docs = part_storage / "docs"

        def partial_unledgered() -> str | None:
            if part_error:
                return part_error
            cell = metric_row(coverage_block(part_docs), COVERAGE_ROWS[1])
            if cell != str(len(UNLEDGERED_PATHS)):
                return (
                    f"{COVERAGE_ROWS[1]!r} reads {cell!r}, not the standing"
                    f" reconciliation's unledgered count {len(UNLEDGERED_PATHS)}"
                )
            return None

        check(
            "a reconciled store prints the standing reconciliation's unledgered count",
            partial_unledgered,
        )

        def partial_files_read() -> str | None:
            if part_error:
                return part_error
            cell = metric_row(coverage_block(part_docs), COVERAGE_ROWS[0])
            expected = f"{PARTIAL_EXAMINED} of {PARTIAL_D2}"
            stale = f"{PARTIAL_EXAMINED} of {PARTIAL_OLD_DENOMINATOR}"
            if cell == stale:
                return (
                    f"{COVERAGE_ROWS[0]!r} reads {cell!r}: the denominator is still the"
                    " obligation-bearing ledger rows, not the obligation-bearing tracked"
                    " paths at the reconciled revision"
                )
            if cell != expected:
                return f"{COVERAGE_ROWS[0]!r} reads {cell!r}, not {expected!r}"
            return None

        check(
            "files read is counted over the standing reconciliation's tracked paths,"
            " not over the ledger it measures",
            partial_files_read,
        )

        def partial_gap_section() -> str | None:
            if part_error:
                return part_error
            body = gaps_block(part_docs)
            expected = f"**{len(UNLEDGERED_PATHS)} of {len(TRACKED_PATHS)}**"
            if expected not in body:
                return (
                    f"section 1 does not count {expected} tracked paths;"
                    f" it reads {body.splitlines()[0]!r}"
                )
            return None

        check(
            "'Not yet surveyed' section 1 counts over the reconciliation's tracked paths",
            partial_gap_section,
        )

        # -- §3.3's conditions 2, 4 and 5 ------------------------------------
        emit("")
        emit("A reconciliation that does not stand is not a reading (§3.3)")
        cases = (
            (
                "another-revision",
                {"reconciled_sha": "0" * 40},
                "no reconciliation has been recorded",
                "a reconciliation recorded at another revision",
            ),
            (
                "moved-ledger",
                {"reconciled_ledger": LEDGER_PARTIAL + (("B-03", "src/queue.ts", "candidate"),)},
                "the file ledger has changed",
                "a reconciliation whose ledger has changed under it",
            ),
            (
                "another-tree",
                {"reconciled_tree": TRACKED_PATHS + ("src/extra.ts",)},
                "was taken over a different tree",
                "a reconciliation taken over a different tree",
            ),
        )
        for name, extra, phrase, label in cases:
            storage, summary, error = build(
                name, ledger=LEDGER_PARTIAL, unledgered=UNLEDGERED_PATHS, **extra
            )
            docs = storage / "docs"

            def does_not_stand(
                docs: Path = docs, error: str | None = error, phrase: str = phrase
            ) -> str | None:
                if error:
                    return error
                cell = metric_row(coverage_block(docs), COVERAGE_ROWS[1])
                failure = unmeasured_failure(cell, COVERAGE_ROWS[1], head)
                if failure:
                    return failure
                if phrase not in str(cell):
                    return (
                        f"the refusal does not name why the reading does not stand"
                        f" ({phrase!r}): {cell!r}"
                    )
                return None

            check(f"{label} does not stand", does_not_stand)

        # -- the function §3.4 names -----------------------------------------
        emit("")
        emit("_tracked_paths reads the record, and has a third answer (§3.4)")

        def tracked_paths_is_none() -> str | None:
            if unrec_error:
                return unrec_error
            sys.path.insert(0, str(ROOT))
            try:
                renderers = importlib.import_module("amanuensis_materializer.renderers")
                db = importlib.import_module("amanuensis_materializer.db")
            except Exception as exc:
                return f"the renderer module could not be loaded — {scrub(exc)}"
            fn = getattr(renderers, "_tracked_paths", None)
            if fn is None:
                return "renderers.py exposes no _tracked_paths"
            conn = db.open_ro(unrec_storage / "memory.db")
            try:
                try:
                    answer = fn(conn, unrec_storage)
                except Exception as exc:
                    return f"_tracked_paths(conn, storage) raised — {scrub(exc)}"
            finally:
                conn.close()
            if answer is not None:
                return (
                    f"_tracked_paths returned {answer!r} for an unreconciled store;"
                    " a reading of nothing and no reading are different facts"
                )
            return None

        check(
            "_tracked_paths returns None, not 0, for an unreconciled store",
            tracked_paths_is_none,
        )

        emit("")
        emit("a declination nobody can open is history, and satisfies nothing (§4.4, C18)")

        def unreachable_declination_is_not_recorded() -> str | None:
            # §4.4: "Older rows, and rows anchored to a revision the repository
            # no longer has, render as history (§4.5) and satisfy nothing." The
            # reachability of a *term*'s anchor is checked; a declination's was
            # not, so a subsystem whose only declination names a revision the
            # repository has never had rendered `declined` — the second of the
            # three states — on the strength of a row the prerequisite refuses
            # (F6/codex).
            sys.path.insert(0, str(ROOT))
            try:
                renderers = importlib.import_module("amanuensis_materializer.renderers")
            except Exception as exc:
                return f"the renderer module could not be loaded — {scrub(exc)}"
            fn = getattr(renderers, "_vocabulary_state", None)
            if fn is None:
                return "renderers.py exposes no _vocabulary_state"
            unreachable = [{"ref_sha": "0" * 40, "reason": "none applies", "session_id": "s1"}]
            try:
                answer = fn([], unreachable, workspace)
            except Exception as exc:
                return f"_vocabulary_state raised — {scrub(exc)}"
            if answer != "not-recorded":
                return (
                    f"a subsystem whose only declination names {'0' * 7}… — a revision this"
                    f" repository does not have — rendered {answer!r}. The status-advance"
                    " prerequisite reads the effective declination, the newest row whose"
                    " ref_sha resolves, so this row discharges nothing and the page reports"
                    " a judgment the server would refuse"
                )
            reachable = [{"ref_sha": head, "reason": "none applies", "session_id": "s1"}]
            try:
                still = fn([], reachable, workspace)
            except Exception as exc:
                return f"_vocabulary_state raised on a reachable declination — {scrub(exc)}"
            if still != "declined":
                return (
                    f"a declination anchored at a revision that does resolve rendered {still!r};"
                    " the three states must stay distinct in both directions"
                )
            return None

        check(
            "an unreachable declination renders 'not recorded', a reachable one 'declined'",
            unreachable_declination_is_not_recorded,
        )
        # -- §4.5: declined, superseded, and not recorded ---------------------
        emit("")
        emit("Three vocabulary states, never two (§4.5)")
        vocab_storage, vocab, vocab_error = build(
            "declinations", ledger=LEDGER_FULL, unledgered=(), vocabulary=True
        )
        vocab_docs = vocab_storage / "docs"

        def subsystem_page(sid: str) -> str:
            # Subsystem pages are slugged `b01-read-path.md`: the id without its
            # hyphen, then the name. Matching on the bare id finds nothing.
            needle = sid.lower().replace("-", "")
            for path in sorted(vocab_docs.glob("subsystems/*.md")):
                if path.name.lower().startswith(needle):
                    return read(path) or ""
            return ""

        def declined_renders() -> str | None:
            if vocab_error:
                return vocab_error
            body = section(subsystem_page(DECLINED_CURRENT), "Vocabulary")
            if not body:
                return f"{DECLINED_CURRENT}'s page carries no Vocabulary section at all"
            missing = [
                part
                for part, label in (
                    (REASON_CURRENT, "the recorded reason"),
                    (SESSION, "the session"),
                    (head[:7], "the revision"),
                )
                if part not in body
            ]
            if missing:
                return (
                    "a declined subsystem renders without"
                    f" {missing}: {body[:240]!r}"
                )
            return None

        check("a declined subsystem renders its reason, session and revision", declined_renders)

        def declined_is_not_not_recorded() -> str | None:
            if vocab_error:
                return vocab_error
            declined = section(subsystem_page(DECLINED_CURRENT), "Vocabulary")
            silent = section(subsystem_page(VOCAB_NOT_RECORDED), "Vocabulary")
            if not silent:
                return (
                    f"{VOCAB_NOT_RECORDED} has neither a term nor a declination and its"
                    " page says nothing at all, so the third state is unrepresentable"
                )
            if NOT_RECORDED not in silent:
                return (
                    f"a subsystem nobody asked does not render {NOT_RECORDED!r}:"
                    f" {silent[:200]!r}"
                )
            if declined == silent:
                return "'declined' and 'not recorded' render identically"
            if NOT_RECORDED in declined:
                return (
                    "a declined subsystem is rendered as 'not recorded', collapsing the"
                    f" two states: {declined[:200]!r}"
                )
            return None

        check("'declined' and 'not recorded' are distinct renderings", declined_is_not_not_recorded)

        def superseded_below_current() -> str | None:
            if vocab_error:
                return vocab_error
            page = subsystem_page(DECLINED_SUPERSEDED)
            body = section(page, "Vocabulary")
            if not body:
                return f"{DECLINED_SUPERSEDED}'s page carries no Vocabulary section"
            if VOCAB_TERM not in body:
                return (
                    "a subsystem holding an anchored term does not render it as its"
                    f" current vocabulary: {body[:200]!r}"
                )
            if SUPERSEDED_HEADING not in body:
                return (
                    "the earlier declination is not rendered beneath the terms as"
                    f" superseded history: {body[:240]!r}"
                )
            if body.index(VOCAB_TERM) > body.index(SUPERSEDED_HEADING):
                return "the superseded declination renders above the current terms"
            if REASON_SUPERSEDED not in body:
                return "the superseded declination renders without its reason"
            return None

        check(
            "terms render as current and an earlier declination beneath them as history",
            superseded_below_current,
        )

        def glossary_lists_declined() -> str | None:
            if vocab_error:
                return vocab_error
            body = read(vocab_docs / GLOSSARY_PAGE) or ""
            if not body:
                return f"{GLOSSARY_PAGE} is absent from the projection"
            if DECLINED_INDEX_HEADING not in body:
                return (
                    "the glossary does not list the subsystems that declared no domain"
                    f" vocabulary: {body[:200]!r}"
                )
            expected = f"{DECLINED_INDEX_HEADING} (1 of {len(SUBSYSTEMS)})"
            if expected not in body:
                return (
                    f"the declined index carries no denominator {expected!r};"
                    " a count with no denominator is not a reading"
                )
            if REASON_CURRENT not in body:
                return "the declined index does not carry each subsystem's reason"
            return None

        check(
            "the glossary lists the subsystems that declared no domain vocabulary,"
            " with a denominator",
            glossary_lists_declined,
        )

        # -- §3.3 conditions 1 and 4: the bound workspace cannot answer -------
        emit("")
        emit("A reconciliation no tree can re-derive does not stand (§3.3 conditions 1, 4)")
        gone_storage = root / "unreachable-workspace"
        gone_storage.mkdir(parents=True, exist_ok=True)
        gone: dict[str, Any] = {}
        gone_error: str | None = None
        try:
            seed(
                gone_storage,
                workspace,
                head,
                ledger=LEDGER_PARTIAL,
                unledgered=UNLEDGERED_PATHS,
                workspace_path=root / "no-such-tree",
            )
            gone = publish(gone_storage, "--clean-publish")
        except Exception as exc:  # noqa: BLE001 - the failure is the answer
            gone_error = f"the unreachable-workspace fixture could not be seeded — {scrub(exc)}"
        gone_docs = gone_storage / "docs"

        def unreachable_workspace(label: str = COVERAGE_ROWS[0]) -> str | None:
            if gone_error:
                return gone_error
            cell = metric_row(coverage_block(gone_docs), label)
            if cell is None:
                return f"the overview carries no {label!r} row at all"
            if NOT_MEASURED not in cell:
                return (
                    f"{label!r} reads {cell!r} for a store whose bound workspace"
                    " cannot enumerate the tree at the published revision, so §3.3"
                    " conditions 1 and 4 were never evaluated and the fraction"
                    " stands on the record's own word"
                )
            if not names_revision(cell, head):
                return f"the refusal names no revision: {cell!r}"
            return None

        check(
            "a store whose bound workspace cannot answer prints no coverage fraction",
            unreachable_workspace,
        )
        check(
            "a store whose bound workspace cannot answer prints no unledgered count",
            lambda: unreachable_workspace(COVERAGE_ROWS[1]),
        )

        def unreachable_reads_back_green() -> str | None:
            if gone_error:
                return gone_error
            red = [axis for axis, ok in axes(gone).items() if not ok]
            if red:
                return (
                    "the read-back reports the refusal as a fault rather than as"
                    f" present and honest — {red} red: {mismatches(gone)[:2]}"
                )
            return None

        check("the refusal to measure still reads back green", unreachable_reads_back_green)

        # -- the read-back compares the reading, not a substring of it --------
        emit("")
        emit("The read-back recomputes the published coverage rows (§3.4)")

        def tampered(label: str, replacement: str) -> str | None:
            """Rewrite one published cell and re-run the read-back over it."""

            if part_error:
                return part_error
            page = part_docs / OVERVIEW_PAGE
            original = read(page) or ""
            cell = metric_row(coverage_block(part_docs), label)
            if cell is None:
                return f"the overview carries no {label!r} row at all"
            row_line = f"| {label} | {cell} |"
            if row_line not in original:
                return f"the {label!r} row is not written as {row_line!r}"
            page.write_text(original.replace(row_line, f"| {label} | {replacement} |"))
            try:
                summary = publish(part_storage, "--readback-only")
                if axes(summary)["coverage"]:
                    return (
                        f"{label!r} was rewritten from {cell!r} to {replacement!r} and"
                        " the coverage axis stayed green: the row is checked for a"
                        " substring of the record, not against it"
                    )
            finally:
                page.write_text(original)
            return None

        check(
            "a files-read numerator the record contradicts turns the coverage axis red",
            lambda: tampered(COVERAGE_ROWS[0], f"999 of {PARTIAL_D2}"),
        )
        check(
            "an unledgered count the record contradicts turns the coverage axis red",
            lambda: tampered(COVERAGE_ROWS[1], f"1{len(UNLEDGERED_PATHS)}"),
        )

        def untampered_still_green() -> str | None:
            if part_error:
                return part_error
            summary = publish(part_storage, "--readback-only")
            red = [axis for axis, ok in axes(summary).items() if not ok]
            if red:
                return (
                    "the restored projection does not read back green, so the two"
                    f" checks above prove nothing — {red} red: {mismatches(summary)[:2]}"
                )
            return None

        check("the projection reads back green once restored", untampered_still_green)

        # -- §4.5: an anchor is a citation that opens -------------------------
        emit("")
        emit("A term is current only where its anchor opens (§4.4, §4.5)")
        UNOPENABLE = (
            ("not-a-citation", "a token that is not a citation at all"),
            (f"src/reader.ts:read@{'0' * 40}", "a citation whose revision does not resolve"),
            (f"src/never-written.ts:read@{head}", "a citation naming a path absent from that tree"),
        )
        for bad_anchor, label in UNOPENABLE:
            bad_storage = root / f"anchor-{abs(hash(bad_anchor)) % 10**8}"
            bad_storage.mkdir(parents=True, exist_ok=True)
            bad_error: str | None = None
            try:
                seed(
                    bad_storage,
                    workspace,
                    head,
                    ledger=LEDGER_FULL,
                    unledgered=(),
                    vocabulary=True,
                    vocabulary_anchor=bad_anchor,
                )
                publish(bad_storage, "--clean-publish")
            except Exception as exc:  # noqa: BLE001 - the failure is the answer
                bad_error = f"the {label} fixture could not be seeded — {scrub(exc)}"

            def anchor_does_not_discharge(
                docs: Path = bad_storage / "docs",
                error: str | None = bad_error,
                label: str = label,
            ) -> str | None:
                if error:
                    return error
                needle = DECLINED_SUPERSEDED.lower().replace("-", "")
                page = ""
                for path in sorted(docs.glob("subsystems/*.md")):
                    if path.name.lower().startswith(needle):
                        page = read(path) or ""
                        break
                body = section(page, "Vocabulary")
                if not body:
                    return f"{DECLINED_SUPERSEDED}'s page carries no Vocabulary section"
                if SUPERSEDED_HEADING in body:
                    return (
                        f"{label} renders the subsystem's declination as superseded"
                        " history, so an anchor nobody can open discharged the"
                        f" obligation (§4.4): {body[:200]!r}"
                    )
                if REASON_SUPERSEDED not in body:
                    return (
                        f"{label} leaves the subsystem with neither a current"
                        f" declination nor its reason: {body[:200]!r}"
                    )
                return None

            check(f"{label} does not make a term current", anchor_does_not_discharge)

        # -- §5.6: carried obligations, on both lenses and in both formats ----
        emit("")
        emit("Carried obligations are rendered, counted separately, and read back (§5.6)")
        carried_storage, carried, carried_error = build(
            "carried", ledger=LEDGER_FULL, unledgered=(), carried=True
        )
        carried_docs = carried_storage / "docs"

        def marker(archived_id: str) -> str:
            token = hashlib.sha256(
                f"{CARRIED_STORE}{NUL}{archived_id}".encode()
            ).hexdigest()
            return f"<!-- amanuensis:carried:{token} -->"

        def section_on(page: str) -> str:
            return section(read(carried_docs / page) or "", CARRIED_HEADING)

        def carried_on_unresolved() -> str | None:
            if carried_error:
                return carried_error
            body = section_on(FINDINGS_PAGE)
            if not body:
                return f"{FINDINGS_PAGE} carries no {CARRIED_HEADING!r} section"
            for archived_id, _sub, severity, symptom, _outcome in CARRIED_UNDECIDED:
                for part, label in (
                    (archived_id, "its archived id"),
                    (CARRIED_STORE, "the store it came from"),
                    (severity, "its severity"),
                    (symptom, "its symptom"),
                    (UNDECIDED_WORD, f"the word {UNDECIDED_WORD!r}"),
                ):
                    if part not in body:
                        return f"the record carried as {archived_id} renders without {label}"
            for archived_id, _sub, _sev, _sym, _outcome in CARRIED_DECIDED:
                if archived_id in body:
                    return (
                        f"{archived_id} has a terminal outcome and still renders as an"
                        " unresolved obligation"
                    )
            return None

        check(
            "the Unresolved lens carries every undecided carried record, in full",
            carried_on_unresolved,
        )

        def carried_on_history() -> str | None:
            if carried_error:
                return carried_error
            body = section_on(RESOLVED_PAGE)
            if not body:
                return f"{RESOLVED_PAGE} carries no {CARRIED_HEADING!r} section"
            for archived_id, _sub, severity, symptom, outcome in CARRIED_DECIDED:
                for part, label in (
                    (archived_id, "its archived id"),
                    (CARRIED_STORE, "the store it came from"),
                    (severity, "its severity"),
                    (symptom, "its symptom"),
                    (str(outcome), "its outcome"),
                ):
                    if part not in body:
                        return f"the record carried as {archived_id} renders without {label}"
            return None

        check(
            "the History pages carry every decided carried record with its outcome",
            carried_on_history,
        )

        def carried_in_both_formats() -> str | None:
            if carried_error:
                return carried_error
            for suffix, label in ((".md", "markdown"), (".html", "html")):
                text = corpus(carried_docs, suffix)
                for archived_id, *_rest in CARRIED:
                    count = text.count(marker(archived_id))
                    if count != 1:
                        return (
                            f"the {label} corpus carries {count} durable marker(s) for the"
                            f" record carried as {archived_id}, not exactly one"
                        )
            return None

        check(
            "every carried record carries exactly one durable marker in each format",
            carried_in_both_formats,
        )

        def undecided_is_its_own_row() -> str | None:
            if carried_error:
                return carried_error
            body = work_block(carried_docs)
            if not body:
                return "the overview carries no 'Open engineering work' block"
            cell = metric_row(body, CARRIED_OVERVIEW_ROW)
            if cell is None:
                return (
                    f"the overview carries no {CARRIED_OVERVIEW_ROW!r} row, so an"
                    " inherited defect nobody has looked at is unreportable"
                )
            if cell != str(len(CARRIED_UNDECIDED)):
                return f"{CARRIED_OVERVIEW_ROW!r} reads {cell!r}, not {len(CARRIED_UNDECIDED)}"
            open_cell = metric_row(body, "Findings open")
            if open_cell != "3":
                return (
                    f"'Findings open' reads {open_cell!r}, not 3: a carried obligation"
                    " has been summed into the defects this store confirmed"
                )
            return None

        check(
            "carried defects undecided is its own row and is never summed into findings open",
            undecided_is_its_own_row,
        )

        # -- the three read-back faults §8.6 requires -------------------------
        def republish() -> str | None:
            again = publish(carried_storage, "--clean-publish")
            if not again.get("ok"):
                return f"the carried fixture would not republish cleanly: {again}"
            return None

        def fault(
            page: str, mutate: Callable[[str], str], axis: str, object_type: str
        ) -> str | None:
            if carried_error:
                return carried_error
            reset = republish()
            if reset:
                return reset
            target = carried_docs / page
            body = read(target)
            if body is None:
                return f"{page} is absent from the projection"
            mutated = mutate(body)
            if mutated == body:
                return f"the fault could not be seeded into {page}: nothing matched"
            target.write_text(mutated)
            summary = publish(carried_storage, "--readback-only")
            result = axes(summary)
            if result[axis]:
                return f"the {axis} axis stayed green with a seeded fault in {page}"
            named = [
                m
                for m in mismatches(summary)
                if m.get("axis") == axis and object_type in str(m.get("object_type"))
            ]
            if not named:
                return (
                    f"the {axis} axis is red but no mismatch names {object_type!r}, so a"
                    f" reader is not told which record is at fault: {mismatches(summary)[:2]}"
                )
            return None

        check(
            "removing a carried record's marker turns the state axis red",
            lambda: fault(
                FINDINGS_PAGE,
                lambda body: body.replace(marker(CARRIED_UNDECIDED[0][0]), "", 1),
                "state",
                "carried",
            ),
        )
        check(
            "breaking a carried record's cross-link turns the coverage axis red",
            lambda: fault(
                RESOLVED_PAGE,
                lambda body: body.replace(
                    f"]({FINDINGS_PAGE}#{CARRIED_SUCCESSOR.lower()})",
                    "](carried-missing.md#gone)",
                    1,
                ),
                "coverage",
                "cross-link",
            ),
        )
        check(
            "altering a carried record's published bytes turns the content axis red",
            lambda: fault(
                FINDINGS_PAGE,
                lambda body: body.replace(
                    CARRIED_UNDECIDED[0][3], "A symptom nobody carried.", 1
                ),
                "content",
                "page",
            ),
        )
        republish()

        # -- the coverage axis owns the honesty of a 'not measured' row -------
        def coverage_axis_catches_a_forged_number() -> str | None:
            if unrec_error:
                return unrec_error
            again = publish(unrec_storage, "--clean-publish")
            if not again.get("ok"):
                return f"the unreconciled fixture would not republish cleanly: {again}"
            target = unrec_docs / OVERVIEW_PAGE
            body = read(target) or ""
            row_line = next(
                (
                    line
                    for line in body.splitlines()
                    if line.startswith("|") and COVERAGE_ROWS[1] in line
                ),
                None,
            )
            if row_line is None:
                return f"the overview carries no {COVERAGE_ROWS[1]!r} row to forge"
            forged = f"| {COVERAGE_ROWS[1]} | 0 |"
            target.write_text(body.replace(row_line, forged, 1))
            summary = publish(unrec_storage, "--readback-only")
            if axes(summary)["coverage"]:
                return (
                    "an unreconciled store published a coverage number and the coverage"
                    " axis counted it as satisfied"
                )
            return None

        check(
            "the coverage axis turns red when a 'not measured' row is replaced by a number",
            coverage_axis_catches_a_forged_number,
        )

        # -- CI ---------------------------------------------------------------
        emit("")

        def runs_in_ci() -> str | None:
            text = read(CI_FILE)
            if text is None:
                return "the CI workflow .github/workflows/test.yml is not readable"
            if CI_COMMAND not in text:
                return f"the workflow does not run {CI_COMMAND}"
            return None

        check("the gate runs in CI", runs_in_ci)
    finally:
        shutil.rmtree(root, ignore_errors=True)

    return finish()


if __name__ == "__main__":
    sys.exit(main())
