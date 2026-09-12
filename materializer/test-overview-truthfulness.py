#!/usr/bin/env python3
"""Gate for reader-lenses packet P3 — the overview's thesis and the orientation
lint (spec.md §7.2, §11.1; claims C32, C49, C55, C63).

Turns red when:
  - `amanuensis_materializer.lint` does not expose `orientation_violations`, or
    the lint misses a survey-status assertion in its positive corpus, a count
    fraction, or any term the vocabulary source carries;
  - any member of the negative corpus — *memory-mapped page cache*, *a stale
    cache*, *the mapped region*, *re-anchored the B-tree* — is flagged.  The
    false-alarm arm is part of the gate, not a separate concern (VP7);
  - the published thesis is taken from anywhere but the `entry-point.md`
    section headed *What is this codebase?*, or an absent section falls back to
    the first paragraph instead of publishing the named instruction;
  - a thesis carrying status vocabulary reaches the published overview, or the
    publish stays green when it does;
  - the overview does not carry, in source order with nothing between them,
    identity, the thesis, four separately named status dimensions, one linked
    count per `finding_resolution_state` value, and one route into each lens;
  - a status dimension reports a number the fixture's store contradicts, a
    composite score or progress meter appears, or a resolution state with zero
    findings loses its row;
  - the `entries`-derived stale marker stops being emitted exactly once per
    corpus, or any read-back axis goes red on a clean fixture;
  - the gate does not run in CI.

False green it cannot exclude: a clean thesis can still be wrong about the
project.  The lint measures the vocabulary of the sentence, never its truth,
and no gate here reads the codebase the thesis describes.

Output protocol: exactly one status line, last, on stdout.  Every subprocess is
captured and never echoed, and every message is scrubbed, so a missing
deliverable reports as an assertion failure rather than as a crash.
"""

from __future__ import annotations

import hashlib
import importlib
import json
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

# ---------------------------------------------------------------------------
# Output funnel.  Nothing reaches stdout except through emit(), and everything
# is scrubbed of the launcher's crash signatures so a genuine assertion failure
# is never mistaken for a gate that never ran.
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


# ---------------------------------------------------------------------------
# What the specification fixes, written out here rather than imported, so that
# rewriting an implementation constant cannot also rewrite what this gate
# expects (§7.2, §11.1, §6.1).
# ---------------------------------------------------------------------------
PROJECT_NAME = "LedgerFixture"
THESIS_HEADING = "What is this codebase?"
THESIS_SENTENCE = (
    "LedgerFixture appends ledger rows durably and serves them through a "
    "separate read path."
)
DECOY_SENTENCE = (
    "This decoy paragraph is the first non-header paragraph of the reading "
    "path and must never become the thesis."
)
MISSING_THESIS = (
    "No thesis section is recorded; add a 'What is this codebase?' section to "
    "`entry-point.md`."
)
REFUSED_THESIS = (
    "The recorded thesis carries status vocabulary and was not published; "
    "correct `entry-point.md`."
)
OFFENDING_THESIS = (
    "The conspectus is 34/34 mapped and every subsystem is fully surveyed."
)

OVERVIEW_SECTIONS = (
    THESIS_HEADING,
    "Where the record stands",
    "Findings by resolution state",
    "The four lenses",
)
STATUS_DIMENSIONS = (
    "Source alignment",
    "Survey coverage",
    "Open engineering work",
    "Publication integrity",
)
LENSES = ("Codebase", "Unresolved", "History", "Method")

# §6.1 assigns each resolution state to exactly one findings page, and the
# fixture below seeds a different count for each so a mis-wired count cannot
# coincide with the right answer.
EXPECTED_STATES: dict[str, tuple[str, str, int]] = {
    # value: (human label, page, fixture count)
    "open": ("Open", "findings.md", 2),
    "fixed-pending-verification": ("Unverified fix", "findings.md", 1),
    "verified-fixed": ("Verified fixed", "resolved-findings.md", 3),
    "ruled-out": ("Ruled out", "resolved-findings.md", 1),
    "accepted": ("Accepted", "resolved-findings.md", 0),
}

# §11.1 arm 1: survey-status assertions the lint must catch.
POSITIVE_CORPUS = (
    "The conspectus is fully surveyed at the checked revision.",
    "This codebase is fully mapped and needs no further reading.",
    "The survey is current as of the last refresh.",
    "The documentation is up to date with the canonical branch.",
    "B-01 is mapped and its ledger is complete.",
    "This project is 34/34 mapped.",
    "The survey remains fresh at the reviewed head.",
    "The conspectus was out of date before this run.",
)

# §11.1 arm 2: the false-alarm corpus.  A lint with only the positive arm
# measures nothing about its false-alarm rate (VP7).
NEGATIVE_CORPUS = (
    "The read path serves rows from a memory-mapped page cache.",
    # The discriminating case for §11.1 rule 1: a survey-status *subject* and a
    # copula, with the forbidden term reached only through a hyphen.  Dropping
    # the hyphen exclusion flags this and nothing else in the corpus notices.
    "This codebase is memory-mapped throughout its read path.",
    "A stale cache is invalidated by the next epoch boundary.",
    "The mapped region is unmapped when the segment is retired.",
    "Compaction re-anchored the B-tree root after the split.",
    "LedgerFixture appends rows durably and serves them from a read path.",
    "The freshness digest names each shape whose plan went out of scope.",
)


# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------
ENTRY_POINT_WITH_THESIS = f"""# Where to begin

{DECOY_SENTENCE}

## Reading order

Read `src/reader.ts` first, then `src/writer.ts`.

## {THESIS_HEADING}

{THESIS_SENTENCE}

## File ledger

| Path | Classification | Why in scope | Ref SHA |
|---|---|---|---|
| `src/reader.ts` | examined | Owns the read path. | `deadbeef` |
"""

ENTRY_POINT_NO_THESIS = f"""# Where to begin

{DECOY_SENTENCE}

## Reading order

Read `src/reader.ts` first.
"""

ENTRY_POINT_PROJECT_HEADING = f"""# Where to begin

{DECOY_SENTENCE}

### WHAT IS THIS PROJECT?

{THESIS_SENTENCE}
"""

ENTRY_POINT_OFFENDING = f"""# Where to begin

{DECOY_SENTENCE}

## {THESIS_HEADING}

{OFFENDING_THESIS}
"""

ONBOARDING_REPORT = f"""# Onboarding report

**Codebase**: {PROJECT_NAME} — P3 gate fixture

## Directory clusters

- src/ — B-01
"""


def seed(storage: Path, entry_point: str) -> None:
    """One store whose every overview number is distinct and checkable."""

    db = sqlite3.connect(storage / "memory.db")
    db.executescript(SCHEMA.read_text())
    cur = db.cursor()
    cur.execute(
        "INSERT INTO git_state (repo_id, canonical_branch, onboarding_sha,"
        " last_checked_sha, last_checked_at)"
        " VALUES ('default', 'main', 'aaaaaaaaaaaa1111', 'aaaaaaaaaaaa1111',"
        " '2026-09-10T12:00:00Z')"
    )
    cur.execute("INSERT INTO sessions (session_id, intent) VALUES ('p3', 'fixture')")
    # 2 mapped, 1 scoping — a bare subsystem count cannot satisfy this.
    cur.executemany(
        "INSERT INTO subsystems (id, name, status, layer, scope) VALUES (?, ?, ?, ?, ?)",
        [
            ("B-01", "Read path", "mapped", "backend", "src/reader.ts"),
            ("B-02", "Write path", "mapped", "backend", "src/writer.ts"),
            ("F-01", "Surface", "scoping", "frontend", "web/"),
        ],
    )
    # 4 scoped files: 3 carry a survey obligation (2 examined, 1 candidate),
    # 1 is exempt.  One obligation-bearing row is stale and one exempt row is
    # stale, so a predicate that ignores the exemption reports 2, not 1.
    cur.executemany(
        "INSERT INTO file_ledger (subsystem_id, file_path, classification, ref_sha,"
        " stale, stale_since, stale_reason) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
            ("B-01", "src/reader.ts", "examined", "aaaaaaaaaaaa1111", 0, None, None),
            ("B-02", "src/writer.ts", "examined", "aaaaaaaaaaaa1111", 1, "2026-09-10T12:00:00Z", "git-drift"),
            ("B-02", "src/pending.ts", "candidate", None, 0, None, None),
            ("B-01", "dist/bundle.js", "generated-ignore", None, 1, "2026-09-10T12:00:00Z", "git-drift"),
        ],
    )
    # One unledgered gap and one absent gap: counting every scope_gaps row
    # reports 2 where the unledgered denominator is 1.
    cur.executemany(
        "INSERT INTO scope_gaps (file_path, kind, subsystem_id) VALUES (?, ?, ?)",
        [("src/unledgered.ts", "unledgered", None), ("src/deleted.ts", "absent", "B-01")],
    )
    cur.execute(
        "INSERT INTO evidence (file_path, symbol, ref_sha, kind, note)"
        " VALUES ('src/writer.ts', 'append', 'aaaaaaaaaaaa1111', 'code-verified', 'fix verified')"
    )
    evidence_id = cur.lastrowid
    findings = [
        ("B01-1", "B-01", "HIGH", "confirmed-bug", "open"),
        ("B01-2", "B-01", "MEDIUM", "confirmed-bug", "open"),
        ("B01-3", "B-01", "LOW", "fixed", "fixed-pending-verification"),
        ("B02-1", "B-02", "HIGH", "fixed", "verified-fixed"),
        ("B02-2", "B-02", "MEDIUM", "fixed", "verified-fixed"),
        ("B02-3", "B-02", "LOW", "fixed", "verified-fixed"),
        ("B02-4", "B-02", "LOW", "ruled-out", "ruled-out"),
    ]
    for finding_id, subsystem, severity, status, state in findings:
        cur.execute(
            "INSERT INTO findings (finding_id, subsystem_id, symptom, root_cause,"
            " severity, status, ref_sha, session_id, pass_type)"
            " VALUES (?, ?, ?, ?, ?, ?, 'aaaaaaaaaaaa1111', 'p3', 'survey')",
            (finding_id, subsystem, f"symptom for {finding_id}", f"cause for {finding_id}", severity, status),
        )
        fix_location = "src/writer.ts:append" if state in ("fixed-pending-verification", "verified-fixed") else None
        fix_sha = "aaaaaaaaaaaa1111" if fix_location else None
        if state == "verified-fixed":
            # A verified repair must carry its verification evidence
            # (schema.sql finding_verification_evidence_integrity).
            cur.execute(
                "INSERT INTO finding_evidence (finding_id, evidence_id, role)"
                " VALUES (?, ?, 'fix-verification')",
                (finding_id, evidence_id),
            )
        cur.execute(
            "INSERT INTO finding_resolution_events (finding_id, resolution_state,"
            " fix_location, fix_sha, evidence_id, rationale, session_id)"
            " VALUES (?, ?, ?, ?, ?, 'fixture', 'p3')",
            (
                finding_id,
                state,
                fix_location,
                fix_sha,
                evidence_id if state == "verified-fixed" else None,
            ),
        )
    # One unresolved contradiction beside one resolved one.
    cur.executemany(
        "INSERT INTO contradictions (finding_a, finding_b, conflict_type, resolution)"
        " VALUES (?, ?, ?, ?)",
        [
            ("B01-1", "B01-2", "severity-conflict", "unresolved"),
            ("B02-1", "B02-2", "classification-conflict", "a-supersedes-b"),
        ],
    )
    # One open decision beside one answered one.
    cur.executemany(
        "INSERT INTO open_questions (category, question, resolution) VALUES (?, ?, ?)",
        [
            ("scope-judgment", "Does the ledger own its compaction schedule?", "open"),
            ("domain-knowledge", "Which branch is canonical?", "answered"),
        ],
    )
    # The `entries`-derived stale marker must survive the rewrite (§11.3).
    cur.execute(
        "INSERT INTO entries (id, tier, subsystem_id, source_path, content_hash,"
        " ref_sha, confidence, stale, stale_since, stale_reason)"
        " VALUES ('B-01-overview', 1, 'B-01', 'survey.md', 'hash',"
        " 'aaaaaaaaaaaa1111', 'verified', 1, '2026-09-10T12:00:00Z', 'fixture')"
    )
    # Publication integrity reads the latest row: the newer one is coverage-red.
    cur.executemany(
        "INSERT INTO projection_verification_runs (run_id, output_dir, mode, source_sha,"
        " state_ok, coverage_ok, content_ok, ok, summary_json, verified_at)"
        " VALUES (?, 'docs', 'clean-publish', 'aaaaaaaaaaaa1111', ?, ?, ?, ?, '{}', ?)",
        [
            ("run-older", 1, 1, 1, 1, "2026-09-09T09:00:00Z"),
            ("run-latest", 1, 0, 1, 0, "2026-09-11T18:30:00Z"),
        ],
    )
    db.commit()
    db.close()
    (storage / "entry-point.md").write_text(entry_point)
    (storage / "onboarding-report.md").write_text(ONBOARDING_REPORT)


def git(workspace: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            "git",
            "-C",
            str(workspace),
            "-c",
            "user.email=gate@example.invalid",
            "-c",
            "user.name=P3 gate",
            *args,
        ],
        capture_output=True,
        text=True,
        check=False,
    )


def make_workspace(root: Path) -> tuple[Path, str | None]:
    """A workspace with one commit, so the overview has a head to compare.

    Returns the resolved head when git could produce one.  When git is absent
    the overview must say the repository head is not known, and the assertions
    below take that arm instead — both are real readings of the same rule.
    """

    workspace = root / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / "src").mkdir(exist_ok=True)
    (workspace / "src" / "reader.ts").write_text("export const read = () => 0;\n")
    try:
        if git(workspace, "init", "--quiet").returncode != 0:
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
    return workspace, head.stdout.strip() or None


def seeded(root: Path, name: str, entry_point: str) -> tuple[Path, str | None]:
    """A seeded storage directory, or the reason it could not be built.

    A fixture that cannot be seeded is reported through the same funnel as any
    other failed assertion; it never becomes a traceback.
    """

    storage = root / name
    storage.mkdir(parents=True, exist_ok=True)
    try:
        seed(storage, entry_point)
    except Exception as exc:
        return storage, f"the {name} fixture could not be seeded — {scrub(exc)}"
    return storage, None


def publish(storage: Path, *args: str) -> dict[str, Any]:
    """Run the materializer, capturing everything.  Never echoes its output."""

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


def level2(text: str) -> list[str]:
    return [line[3:].strip() for line in text.splitlines() if line.startswith("## ")]


def level3(text: str) -> list[str]:
    return [line[4:].strip() for line in text.splitlines() if line.startswith("### ")]


def section(text: str, heading: str, level: int = 2) -> str:
    """The body of one Markdown section, up to the next heading of its level."""

    lines = text.splitlines()
    marker = "#" * level + " "
    start = None
    for index, line in enumerate(lines):
        if line.startswith(marker) and line[len(marker):].strip() == heading:
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
    return "\n".join(body)


def stale_entry_marker(entry_id: str, tier: int) -> str:
    token = hashlib.sha256(f"{entry_id}:{tier}".encode()).hexdigest()
    return f"<!-- amanuensis:stale-entry:{token} -->"


def corpus(docs: Path, suffix: str) -> str:
    return "\n".join(
        read(path) or "" for path in sorted(docs.rglob(f"*{suffix}")) if path.is_file()
    )


# ---------------------------------------------------------------------------
def main() -> int:
    emit("GATE P3 — overview thesis by heading and the orientation lint")
    emit("")

    # -- the lint module -----------------------------------------------------
    lint: Any = None
    lint_error: str | None = None
    sys.path.insert(0, str(ROOT))
    try:
        lint = importlib.import_module("amanuensis_materializer.lint")
    except Exception as exc:
        lint_error = f"{exc!r}"

    violations: Callable[[str], Any] | None = None
    if lint is not None:
        violations = getattr(lint, "orientation_violations", None)

    def flagged(text: str) -> list[str] | None:
        """The lint's verdict, or None when the lint cannot be consulted."""
        if violations is None:
            return None
        result = violations(text)
        if not isinstance(result, list):
            return None
        return [str(item) for item in result]

    def lint_available() -> str | None:
        if violations is None:
            return (
                "the orientation lint module amanuensis_materializer/lint.py does not"
                f" expose orientation_violations (import reported {scrub(lint_error)})"
            )
        probe = flagged("A stale cache is invalidated by the next epoch boundary.")
        if probe is None:
            return "orientation_violations did not return a list of violations"
        return None

    check("orientation lint exposes orientation_violations", lint_available)

    def positive_arm() -> str | None:
        if violations is None:
            return "the orientation lint is not available, so its positive corpus cannot run"
        missed = [text for text in POSITIVE_CORPUS if not (flagged(text) or [])]
        if missed:
            return f"{len(missed)} survey-status assertion(s) passed the lint; first: {missed[0]!r}"
        return None

    check("orientation lint catches every survey-status assertion", positive_arm)

    def negative_arm() -> str | None:
        if violations is None:
            return "the orientation lint is not available, so its negative corpus cannot run"
        wrong = [(text, flagged(text) or []) for text in NEGATIVE_CORPUS if flagged(text)]
        if wrong:
            text, reported = wrong[0]
            return (
                f"{len(wrong)} member(s) of the negative corpus were flagged; first:"
                f" {text!r} reported as {reported[0]!r}"
            )
        return None

    check("orientation lint clears the negative corpus (VP7)", negative_arm)

    def fraction_arm() -> str | None:
        if violations is None:
            return "the orientation lint is not available, so the fraction arm cannot run"
        for text in ("Coverage stands at 34/34 today.", "It reached 12 / 14 subsystems."):
            if not (flagged(text) or []):
                return f"a count fraction passed the lint: {text!r}"
        if flagged("The read path holds a single reference to each segment."):
            return "a sentence with no fraction and no status term was flagged"
        return None

    check("orientation lint rejects count fractions", fraction_arm)

    def source_terms_arm() -> str | None:
        if violations is None:
            return "the orientation lint is not available, so the term source cannot be checked"
        try:
            vocabulary = importlib.import_module("amanuensis_materializer.vocabulary")
            terms = tuple(vocabulary.ORIENTATION_FORBIDDEN_TERMS)
        except Exception as exc:
            return f"the vocabulary source does not carry ORIENTATION_FORBIDDEN_TERMS — {scrub(exc)}"
        if not terms:
            return "the vocabulary source carries no orientation terms, so the lint has no denominator"
        missed = [
            term
            for term in terms
            if not (flagged(f"The conspectus is {term} at the checked revision.") or [])
        ]
        if missed:
            return (
                f"{len(missed)} of {len(terms)} term(s) from the vocabulary source are not"
                f" caught in a survey-status assertion; first: {missed[0]!r}"
            )
        return None

    check("orientation lint covers every term the enum source carries", source_terms_arm)

    def masking_arm() -> str | None:
        if violations is None:
            return "the orientation lint is not available, so its masking rules cannot run"
        if flagged("The state `fully surveyed` is one recorded ladder value."):
            return "a term inside a code span was flagged"
        fenced = "Example prose:\n\n```\nThe conspectus is fully surveyed.\n```\n"
        if flagged(fenced):
            return "a term inside a fenced block was flagged"
        return None

    check("orientation lint ignores code spans and fenced blocks", masking_arm)

    # -- the published overview ---------------------------------------------
    root = Path(tempfile.mkdtemp(prefix="amanuensis-p3-gate-"))
    try:
        workspace, head = make_workspace(root)

        main_storage, seed_error = seeded(root, "main", ENTRY_POINT_WITH_THESIS)
        if seed_error is None:
            (main_storage / "workspace_path").write_text(f"{workspace}\n")
        clean = publish(main_storage, "--clean-publish") if seed_error is None else {}
        docs = main_storage / "docs"
        index = read(docs / "index.md") or ""

        def publishes_green() -> str | None:
            if seed_error:
                return seed_error
            if not clean:
                return "the clean publish produced no summary"
            if clean.get("_returncode") != 0 or not clean.get("ok") or not clean.get("published"):
                warnings = [scrub(w) for w in clean.get("warnings") or []]
                return (
                    "a clean fixture with a recorded thesis did not publish —"
                    f" ok={clean.get('ok')} published={clean.get('published')}"
                    f" warnings={warnings[:2]}"
                )
            readback = clean.get("readback") or {}
            axes = readback.get("axes") or {}
            red = [name for name, axis in axes.items() if not (axis or {}).get("ok")]
            if red:
                return f"read-back axes red on a clean fixture: {sorted(red)}"
            return None

        check("a recorded thesis publishes green", publishes_green)

        def thesis_by_heading() -> str | None:
            if not index:
                return "the published overview index.md is not readable"
            if THESIS_SENTENCE not in index:
                return (
                    "the overview does not carry the body of the"
                    f" '{THESIS_HEADING}' section as its thesis"
                )
            if DECOY_SENTENCE in index:
                return (
                    "the overview still carries the first non-header paragraph of"
                    " entry-point.md, so the thesis is not taken by heading"
                )
            if "Quick orientation" in index:
                return "the overview still carries the 'Quick orientation' slot"
            return None

        check("the thesis is the named section's body and nothing else", thesis_by_heading)

        def thesis_slot_position() -> str | None:
            if not index:
                return "the published overview index.md is not readable"
            body = section(index, THESIS_HEADING)
            if THESIS_SENTENCE not in body:
                return f"the thesis does not render under the overview's '{THESIS_HEADING}' heading"
            return None

        check("the thesis renders in its own named section", thesis_slot_position)

        def identity_first() -> str | None:
            if not index:
                return "the published overview index.md is not readable"
            lines = [line for line in index.splitlines() if line.strip()]
            if not lines or not lines[0].startswith("# "):
                return "the overview does not open with a level-one identity heading"
            title = lines[0][2:].strip()
            if title != PROJECT_NAME:
                return (
                    "the overview's primary identity is"
                    f" {title!r}, not the project name {PROJECT_NAME!r}"
                )
            head_block = index.split(f"## {THESIS_HEADING}", 1)[0]
            if "Amanuensis" not in head_block:
                return "the identity block does not name Amanuensis as the producing method"
            if re.search(r"^#\s+(Conspectus|Amanuensis)\s*$", index, re.M):
                return "the overview titles itself with the method rather than the project"
            return None

        check("identity is the project name, Amanuensis the method", identity_first)

        def source_order() -> str | None:
            if not index:
                return "the published overview index.md is not readable"
            found = level2(index)
            if found[: len(OVERVIEW_SECTIONS)] != list(OVERVIEW_SECTIONS):
                return (
                    "the overview's first sections are"
                    f" {found[: len(OVERVIEW_SECTIONS) + 1]}, not {list(OVERVIEW_SECTIONS)}"
                    " in that order with nothing between them"
                )
            return None

        check("the five items stand first in source order", source_order)

        def four_dimensions() -> str | None:
            if not index:
                return "the published overview index.md is not readable"
            stands = section(index, "Where the record stands")
            found = level3(stands)
            if found != list(STATUS_DIMENSIONS):
                return (
                    f"the status dimensions are {found}, not the four separately named"
                    f" dimensions {list(STATUS_DIMENSIONS)}"
                )
            return None

        check("four separately named status dimensions", four_dimensions)

        def source_alignment_values() -> str | None:
            body = section(section(index, "Where the record stands"), "Source alignment", level=3)
            if not body.strip():
                return "the Source alignment dimension is empty"
            if "aaaaaaaaaaaa" not in body:
                return "Source alignment does not report the recorded last-checked revision"
            if head:
                if head[:8] not in body:
                    return (
                        "Source alignment does not report the workspace repository head"
                        f" ({head[:8]}) it can resolve"
                    )
            elif not re.search(r"not (known|recorded|available)", body, re.I):
                return "Source alignment neither resolves nor disclaims the repository head"
            if not re.search(r"\bOrigin head\b", body):
                return "Source alignment omits the origin head"
            if not re.search(r"\b1\s+of\s+3\b", body):
                return (
                    "Source alignment does not report 1 of 3 obligation-bearing ledger"
                    " rows stale; the exempt stale row must not be counted"
                )
            return None

        check("Source alignment reports the revisions and the stale denominator", source_alignment_values)

        def survey_coverage_values() -> str | None:
            body = section(section(index, "Where the record stands"), "Survey coverage", level=3)
            if not body.strip():
                return "the Survey coverage dimension is empty"
            if "2 mapped" not in body or "1 scoping" not in body:
                return "Survey coverage does not report subsystems by ladder status (2 mapped, 1 scoping)"
            if not re.search(r"\b2\s+of\s+3\b", body):
                return "Survey coverage does not report 2 of 3 obligation-bearing ledger rows examined"
            if not re.search(r"\b1\b", body) or "unledgered" not in body.lower() and "no ledger row" not in body.lower():
                return "Survey coverage does not report the 1 unledgered path from scope_gaps"
            return None

        check("Survey coverage reports the ladder, the ledger, and the gaps", survey_coverage_values)

        def open_work_values() -> str | None:
            body = section(section(index, "Where the record stands"), "Open engineering work", level=3)
            if not body.strip():
                return "the Open engineering work dimension is empty"
            wanted = {
                "open findings": r"(?i)\bfindings? open\b[^|]*\|\s*\**2\b|\bopen\b[^|]*\|\s*\**2\b",
                "repairs awaiting verification": r"\|\s*\**1\b",
                "unresolved contradictions": r"(?i)contradiction",
                "open decisions": r"(?i)decision",
            }
            for label, pattern in wanted.items():
                if not re.search(pattern, body):
                    return f"Open engineering work does not report {label}"
            numbers = re.findall(r"\|\s*\**(\d+)\**\s*(?:\||$)", body)
            if sorted(numbers) != ["1", "1", "1", "2"]:
                return (
                    "Open engineering work's counts are"
                    f" {numbers}, not one 2 (open findings) and three 1s"
                )
            return None

        check("Open engineering work reports four separate counts", open_work_values)

        def publication_integrity_values() -> str | None:
            body = section(section(index, "Where the record stands"), "Publication integrity", level=3)
            if not body.strip():
                return "the Publication integrity dimension is empty"
            lowered = body.lower()
            for axis in ("state", "coverage", "content"):
                if axis not in lowered:
                    return f"Publication integrity omits the {axis} axis"
            if "2026-09-11" not in body:
                return "Publication integrity does not report when the latest run verified"
            if "2026-09-09" in body:
                return "Publication integrity reports an older run than the latest one"
            green = len(re.findall(r"(?i)\bgreen\b", body))
            red = len(re.findall(r"(?i)\bred\b", body))
            if green != 2 or red != 1:
                return (
                    "Publication integrity reports"
                    f" {green} green and {red} red axes; the latest run is state green,"
                    " coverage red, content green"
                )
            return None

        check("Publication integrity reports the latest run's three axes", publication_integrity_values)

        def no_composite_score() -> str | None:
            if not index:
                return "the published overview index.md is not readable"
            for pattern, what in (
                (r"(?i)\b(health|overall|composite|readiness)\s+(score|index|grade|rating)\b", "a composite score"),
                (r"(?i)\bscore\b", "a score"),
                (r"<progress|<meter", "a progress meter"),
                (r"[█▓▒░]", "a progress bar"),
            ):
                if re.search(pattern, index):
                    return f"the overview carries {what}"
            return None

        check("no composite score, index, or progress meter", no_composite_score)

        def state_counts() -> str | None:
            if not index:
                return "the published overview index.md is not readable"
            body = section(index, "Findings by resolution state")
            if not body.strip():
                return "the overview carries no per-state findings counts"
            try:
                vocabulary = importlib.import_module("amanuensis_materializer.vocabulary")
                enum_values = tuple(vocabulary.values_of("finding_resolution_state"))
            except Exception as exc:
                return f"the finding_resolution_state enum source is not readable — {scrub(exc)}"
            if set(enum_values) != set(EXPECTED_STATES):
                return (
                    "this gate and the enum source disagree on the resolution states:"
                    f" source {sorted(enum_values)} vs gate {sorted(EXPECTED_STATES)}"
                )
            rows = [line for line in body.splitlines() if line.strip().startswith("|")]
            for state, (label, page, count) in EXPECTED_STATES.items():
                matching = [
                    line
                    for line in rows
                    if re.search(rf"\[{re.escape(label)}\]\({re.escape(page)}\)", line)
                ]
                if not matching:
                    return (
                        f"the {state!r} count is not a link labelled {label!r} into {page}"
                    )
                if len(matching) > 1:
                    return f"the {state!r} count renders {len(matching)} times"
                numbers = re.findall(r"\|\s*\**(\d+)\**\s*\|", matching[0])
                if not numbers or int(numbers[-1]) != count:
                    return (
                        f"the {state!r} count is {numbers[-1] if numbers else 'absent'},"
                        f" not the {count} the store holds"
                    )
            linked = [line for line in rows if re.search(r"\]\((findings|resolved-findings)\.md\)", line)]
            if len(linked) != len(EXPECTED_STATES):
                return (
                    f"the overview carries {len(linked)} linked state counts, not one per"
                    f" {len(EXPECTED_STATES)} enum values"
                )
            return None

        check("one linked count per finding_resolution_state value", state_counts)

        def lens_routes() -> str | None:
            if not index:
                return "the published overview index.md is not readable"
            body = section(index, "The four lenses")
            if not body.strip():
                return "the overview carries no routes into the lenses"
            for lens in LENSES:
                hits = re.findall(rf"(?m)^\s*[-*]\s+\*\*{lens}\*\*", body)
                if len(hits) != 1:
                    return f"the {lens!r} lens has {len(hits)} routes, not exactly one"
            targets = re.findall(r"\]\(([^)]+)\)", body)
            if len(targets) < len(LENSES):
                return f"the lens routes carry {len(targets)} links, fewer than one per lens"
            for target in targets:
                page = target.split("#", 1)[0]
                if page and not (docs / page).is_file():
                    return f"a lens route points at {page}, which the projection does not publish"
            return None

        check("one route into each of the four lenses", lens_routes)

        def stale_markers() -> str | None:
            marker = stale_entry_marker("B-01-overview", 1)
            for suffix, label in ((".md", "Markdown"), (".html", "HTML")):
                count = corpus(docs, suffix).count(marker)
                if count != 1:
                    return (
                        f"the entries-derived stale marker appears {count} times in the"
                        f" {label} corpus, not exactly once"
                    )
            return None

        check("the entries-derived stale marker survives, exactly once per corpus", stale_markers)

        # -- an absent thesis section --------------------------------------
        missing_storage, missing_error = seeded(root, "missing", ENTRY_POINT_NO_THESIS)
        missing = publish(missing_storage, "--clean-publish") if missing_error is None else {}
        missing_index = read(missing_storage / "docs" / "index.md") or ""

        def absent_section_instructs() -> str | None:
            if missing_error:
                return missing_error
            if not missing.get("ok") or not missing.get("published"):
                return (
                    "an entry-point.md with no thesis section did not publish —"
                    f" ok={missing.get('ok')} published={missing.get('published')}"
                )
            if MISSING_THESIS not in missing_index:
                return (
                    "the overview does not publish the named instruction"
                    f" {MISSING_THESIS!r} when no thesis section is recorded"
                )
            if DECOY_SENTENCE in missing_index:
                return "the overview fell back to the first paragraph of entry-point.md"
            return None

        check("an absent thesis section publishes a named instruction", absent_section_instructs)

        # -- a differently worded heading ----------------------------------
        variant_storage, variant_error = seeded(root, "variant", ENTRY_POINT_PROJECT_HEADING)
        if variant_error is None:
            publish(variant_storage, "--clean-publish")
        variant_index = read(variant_storage / "docs" / "index.md") or ""

        def heading_variants() -> str | None:
            if variant_error:
                return variant_error
            if THESIS_SENTENCE not in variant_index:
                return (
                    "a '### WHAT IS THIS PROJECT?' section is not recognised as the"
                    " thesis, so the heading match is neither case- nor level-insensitive"
                )
            if MISSING_THESIS in variant_index:
                return "a recorded thesis section was reported as absent"
            return None

        check("the heading match is case- and level-insensitive", heading_variants)

        # -- status vocabulary in the thesis -------------------------------
        refused_storage, refused_error = seeded(root, "refused", ENTRY_POINT_OFFENDING)
        refused = publish(refused_storage, "--clean-publish") if refused_error is None else {}

        def refuses_to_publish() -> str | None:
            if refused_error:
                return refused_error
            if refused.get("ok"):
                return (
                    "a thesis carrying '34/34 mapped' left summary.ok true, so the"
                    " orientation lint does not gate the publish"
                )
            if refused.get("published"):
                return "a thesis carrying status vocabulary was published anyway"
            if refused.get("_returncode") == 0:
                return "the refused publish exited 0"
            warnings = " ".join(str(w) for w in refused.get("warnings") or [])
            if "entry-point.md" not in warnings:
                return (
                    "no warning names the file to correct;"
                    f" warnings were {[scrub(w)[:80] for w in refused.get('warnings') or []][:2]}"
                )
            if (refused_storage / "docs").exists():
                return "the refused run left a published docs directory behind"
            return None

        check("status vocabulary in the thesis turns the publish red", refuses_to_publish)

        inplace_storage, inplace_error = seeded(root, "inplace", ENTRY_POINT_OFFENDING)
        inplace = publish(inplace_storage) if inplace_error is None else {}
        inplace_index = read(inplace_storage / "docs" / "index.md") or ""

        def refused_slot_text() -> str | None:
            if inplace_error:
                return inplace_error
            if inplace.get("ok"):
                return "an in-place render with a status-carrying thesis stayed green"
            if not inplace_index:
                return "the in-place render produced no overview to inspect"
            if REFUSED_THESIS not in inplace_index:
                return (
                    "the thesis slot does not carry the named refusal"
                    f" {REFUSED_THESIS!r}"
                )
            if "34/34" in inplace_index or "fully surveyed" in inplace_index:
                return "the offending thesis reached the rendered overview"
            return None

        check("a refused thesis renders the named refusal instead", refused_slot_text)
    finally:
        shutil.rmtree(root, ignore_errors=True)

    # -- a canonical branch that does not track origin -----------------------
    # "Origin head" is the overview's only external reference point, and a
    # hard-coded refs/remotes/origin/<branch> resolves nothing in the repos that
    # most need it: a fork whose upstream is `upstream`, a clone made with
    # --origin, a branch tracking a differently-named branch.  The dimension
    # then reads "not known here" about a revision git can name exactly, which
    # is a false negative in the one row a reader consults to decide whether the
    # survey is behind.
    upstream_root = Path(tempfile.mkdtemp(prefix="p3-upstream-"))
    try:

        def upstream_fixture() -> tuple[dict[str, Any], str | None]:
            """A workspace whose `main` tracks `upstream/trunk`, and its head."""

            origin = upstream_root / "origin"
            origin.mkdir(parents=True, exist_ok=True)
            (origin / "src").mkdir(exist_ok=True)
            (origin / "src" / "reader.ts").write_text("export const read = () => 0;\n")
            if git(origin, "init", "--quiet", "--initial-branch=trunk").returncode != 0:
                return {}, "git could not initialise the upstream fixture"
            if git(origin, "add", "-A").returncode != 0:
                return {}, "git could not stage the upstream fixture"
            if git(origin, "commit", "--quiet", "-m", "upstream").returncode != 0:
                return {}, "git could not commit the upstream fixture"
            resolved = git(origin, "rev-parse", "HEAD")
            if resolved.returncode != 0:
                return {}, "git could not resolve the upstream head"
            upstream_head = resolved.stdout.strip()
            workspace = upstream_root / "workspace"
            cloned = subprocess.run(
                ["git", "clone", "--quiet", "--origin", "upstream", str(origin), str(workspace)],
                capture_output=True,
                text=True,
                check=False,
            )
            if cloned.returncode != 0:
                return {}, "git could not clone the upstream fixture"
            if git(workspace, "branch", "-m", "trunk", "main").returncode != 0:
                return {}, "git could not rename the tracking branch"
            if git(workspace, "branch", "--set-upstream-to=upstream/trunk", "main").returncode != 0:
                return {}, "git could not set the upstream of the renamed branch"
            storage = workspace / ".amanuensis"
            storage.mkdir(parents=True, exist_ok=True)
            try:
                seed(storage, ENTRY_POINT_WITH_THESIS)
            except Exception as exc:
                return {}, f"the upstream fixture could not be seeded — {scrub(exc)}"
            summary = publish(storage)
            return (
                {"storage": storage, "head": upstream_head, "summary": summary},
                None,
            )

        fixture, fixture_error = upstream_fixture()

        def upstream_alignment() -> str | None:
            if fixture_error:
                return fixture_error
            index = read(fixture["storage"] / "docs" / "index.md")
            if index is None:
                return "the upstream fixture published no index.md"
            body = section(section(index, "Where the record stands"), "Source alignment", level=3)
            if not body.strip():
                return "the Source alignment dimension is empty"
            head = fixture["head"]
            # The workspace head of a fresh clone is the upstream head, so a
            # bare substring search over the whole dimension passes on the
            # "Repository head" row alone.  The row under test is the upstream
            # one, and it is read on its own.
            rows = [
                line
                for line in body.splitlines()
                if re.match(r"\s*\|", line) and re.search(r"upstream|origin", line, re.I)
            ]
            if not rows:
                return "Source alignment carries no upstream row at all"
            row = rows[0]
            if re.search(r"not known here", row, re.I):
                return (
                    "Source alignment says the upstream head is not known here for a branch"
                    f" tracking upstream/trunk, which git resolves to {head[:8]}: {row.strip()}"
                )
            if head[:8] not in row:
                return (
                    "the upstream row reports no revision for a branch tracking upstream/trunk;"
                    f" git resolves it to {head[:8]}: {row.strip()}"
                )
            return None

        check("Source alignment resolves an upstream that is not named origin", upstream_alignment)
    finally:
        shutil.rmtree(upstream_root, ignore_errors=True)

    # -- CI -----------------------------------------------------------------
    def runs_in_ci() -> str | None:
        text = read(CI_FILE)
        if text is None:
            return "the CI workflow .github/workflows/test.yml is not readable"
        if "test-overview-truthfulness.py" not in text:
            return "the workflow does not run test-overview-truthfulness.py"
        return None

    check("the gate runs in CI", runs_in_ci)

    emit("")
    if FAILURES:
        emit(
            "GATE P3 RED: the overview's thesis and the orientation lint do not hold"
            f" — {len(FAILURES)} assertion(s) failed; first: {FAILURES[0]}"
        )
        return 1
    emit("GATE P3 GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
