#!/usr/bin/env python3
"""Gate for explanation packet EX11 — the subsystem page leads with Purpose and
How it works (spec.md §3.6, §2.3 third row, §3.2; claims C29, C30, C31, C32,
C41, C44, C46).

Builds one temporary git repository and several stores over it. Subsystems:

  B-01  recorded purpose and account, claims and an artifact
  B-02  recorded account only, an artifact and no claim
  B-03  purpose and account declined
  B-04  nothing recorded
  B-05  `deferred` (not explanation-eligible) with recorded rows
  B-06  a recorded purpose whose newest row is a withdrawal
  B-07  a recorded purpose whose revision the repository does not have

Turns red when:

  - a recorded purpose does not lead the subsystem page, or the section order
    is not Purpose, Scope, Start here, How it works, Structure;
  - a Purpose heading renders without an effective record (nothing, an
    ineligible subsystem, a withdrawn row, an unreachable revision), or such a
    page stops opening with Scope and the no-purpose sentence;
  - Scope prints the disclaimer beside a recorded or declined purpose;
  - a declined purpose or account does not print the §3.6 sentence;
  - the provenance line is missing, or the ageing sentence is wrong for a seeded
    change: none changed, one of two changed with its path, not measured;
  - an orientation-lint violation in a recorded body or a declination reason is
    printed, or the refusal sentence is absent, or the clean publish stays
    green, publishes, or touches the previously published output;
  - the effective-row selection function disagrees with any case of
    `mcp-server/contracts/explanation-effective-cases.json`;
  - the page does not list the explanation rows among its sources, or the
    read-back passes with a recorded body removed from the page that owes it;
  - a changed label for `explanation_discharge` does not change the page;
  - a recorded account leaves its survey narrative inside Structure, or
    renders it twice;
  - the lint's negative corpus lacks subsystem-id sentences, the retention
    allowlist still holds `explanations.body`, or the gate is not in CI.

False green it cannot exclude: prose that passes the lint and misleads. This
gate asserts where an explanation is, what is said about its age, and that the
two readers agree, not that it is true.

Also turns red when the HTML page drops Purpose, How it works or a declination,
the read-back misses an explanation removed from the HTML page, or the ageing
sentence misreads a change to a path git quotes, trims or reads as magic.

Also turns red when the ageing sentence names more than five paths or counts
evidence rows as files, when the provenance line counts files as evidence rows,
when a violation only the subsystem page prints leaves the publish green, when
the read-back does not owe the refusal sentence on a lint-refused row, or when a
moved head leaves a page's ageing line and source hash where they were (final
review: F3, F8, F9, F11 and F12/claude).

Also turns red when an explanation that names a status in a code span cannot
pass the clean publish, when a wrong status word in that place passes the
read-back, or when a workspace path git cannot answer in reads other than
unchecked with its newest row printed (final review: F1/codex, F2/codex,
F19/claude).

Output protocol: exactly one status line, last, on stdout. Every subprocess is
captured and never echoed, and every message is scrubbed, so a missing
deliverable reports as an assertion failure and not as a crash.
"""

from __future__ import annotations

import ast
import hashlib
import html
import json
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
SCHEMA = REPO / "mcp-server" / "src" / "schema.sql"
CASES = REPO / "mcp-server" / "contracts" / "explanation-effective-cases.json"
CI_FILE = REPO / ".github" / "workflows" / "test.yml"

PACKET = "EX11"
RED_EXPECT = "a recorded purpose does not lead the subsystem page"

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
    ("NameError", "name-error"),
    ("Traceback (most recent call last)", "stack trace"),
    ("ENOENT", "PATH-ABSENT"),
    ("is not a function", "is not callable"),
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
# What the specification fixes, written out here rather than imported.
# ---------------------------------------------------------------------------
NO_PURPOSE_WITH_SCOPE = (
    "No purpose statement is recorded for this subsystem; the scope below states what it covers."
)
NO_PURPOSE_STEM = "No purpose statement is recorded for this subsystem"
SECTION_ORDER = ("Purpose", "Scope", "Start here", "How it works", "Structure")
REFUSAL = (
    "The recorded {slot} carries survey-status vocabulary and was not published;"
    " record a corrected version."
)
NARRATIVE_LABEL = "Narrative from the survey artifact; not individually bound to a revision"
NOT_MEASURED = "Whether the files it cites have changed since is not measured here."

READER = "src/reader.py"
REGISTRY = "src/registry.py"
WRITER = "src/writer.py"
OTHER = "src/other.py"
# Paths git quotes, trims or reads as pathspec magic unless it is asked not to.
AWKWARD = (" lead.py", ":magic.py", "src/café.py")
# One more than the ageing sentence names.
SIX_FILES = tuple(f"src/six{n}.py" for n in range(6))

PURPOSE_B01 = "PURPOSE-B-01 the read path hands each caller a committed snapshot of the rows."
ACCOUNT_B01 = (
    "ACCOUNT-B-01 a read begins at the snapshot registry and then walks the page index.\n\n"
    "- start reading at src/reader.py\n"
    "- the registry never blocks a writer"
)
ACCOUNT_B02 = "ACCOUNT-B-02 a write is queued, ordered, and then applied by one thread."
REASON_PURPOSE_B03 = "REASON-PURPOSE-B-03 the queue has no purpose beyond its caller."
REASON_ACCOUNT_B03 = "REASON-ACCOUNT-B-03 the queue is too small to need an account."
PURPOSE_B05 = "PURPOSE-B-05 the console prints status."
ACCOUNT_B05 = "ACCOUNT-B-05 the console reads a socket."
PURPOSE_B06 = "PURPOSE-B-06 the index orders keys."
PURPOSE_B07 = "PURPOSE-B-07 the gate admits writers."

# An account holding what the writers now refuse, behind each kind of line break.
NESTED_HEADINGS = ("Sneaked heading", "Carriage heading", "Separator heading")
NESTED_ACCOUNT = (
    "Intro line.\n\n## Sneaked heading\n\nBody under it.\r# Carriage heading\rTail."
    "\u2028## Separator heading\u2028End."
)

# True sentences the projection renders in other words: a status chip, a renamed phrase.
PURPOSE_CHIP = "The status `mapped` follows an explicit review."
ACCOUNT_CHIP = (
    "A row at `structural` is read before the `concerns` pass, and the jump-in reading comes first.\n\n"
    "- `deferred` parks it\n\n"
    "```\nthe literal `mapped` in a fence\n```"
)
REASON_CHIP = "The queue reaches `adversarial` with no purpose beyond its caller."

# Each carries survey-status vocabulary the orientation lint refuses.
VIOLATING_PURPOSE = "B-01 is mapped and its ledger is complete."
VIOLATING_ACCOUNT = "The survey is up to date with the canonical branch."
VIOLATING_REASON_PURPOSE = "B-03 is fully mapped, so nothing is left to say."
VIOLATING_REASON_ACCOUNT = "The conspectus is fully surveyed for B-03."

SENTINEL_NARRATIVE = "SENTINEL-NARRATIVE-{sid}: the scheduler drains one queue per tick"
HASH = "0123456789abcdef0123456789abcdef"


def sentinel(sid: str) -> str:
    return SENTINEL_NARRATIVE.format(sid=sid)


# ---------------------------------------------------------------------------
# The repository the explanations cite
# ---------------------------------------------------------------------------
def git(repo: Path, *args: str) -> str:
    proc = subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True,
        text=True,
        check=False,
        env={
            "GIT_AUTHOR_NAME": "gate",
            "GIT_AUTHOR_EMAIL": "gate@example.invalid",
            "GIT_COMMITTER_NAME": "gate",
            "GIT_COMMITTER_EMAIL": "gate@example.invalid",
            "HOME": str(repo),
            "PATH": "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin",
        },
    )
    if proc.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {proc.stderr.strip()[:200]}")
    return proc.stdout.strip()


def build_repository(repo: Path) -> dict[str, str]:
    """C1 has every file, C2 changes only `other`, C3 `reader`; C4 adds and C5 changes the awkward paths; C6 adds and C7 changes six more."""

    repo.mkdir(parents=True)
    git(repo, "init", "-q", "-b", "main")
    (repo / "src").mkdir()
    for rel in (READER, REGISTRY, WRITER, OTHER):
        (repo / rel).write_text(f"# {rel}\nVERSION = 1\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "c1")
    c1 = git(repo, "rev-parse", "HEAD")
    (repo / OTHER).write_text(f"# {OTHER}\nVERSION = 2\n")
    git(repo, "commit", "-q", "-am", "c2")
    c2 = git(repo, "rev-parse", "HEAD")
    (repo / READER).write_text(f"# {READER}\nVERSION = 3\n")
    git(repo, "commit", "-q", "-am", "c3")
    c3 = git(repo, "rev-parse", "HEAD")
    for rel in AWKWARD:
        (repo / rel).write_text(f"# {rel}\nVERSION = 4\n")
    git(repo, "add", "-A", "--", ".")
    git(repo, "commit", "-q", "-m", "c4")
    c4 = git(repo, "rev-parse", "HEAD")
    for rel in AWKWARD:
        (repo / rel).write_text(f"# {rel}\nVERSION = 5\n")
    git(repo, "add", "-A", "--", ".")
    git(repo, "commit", "-q", "-m", "c5")
    c5 = git(repo, "rev-parse", "HEAD")
    for rel in SIX_FILES:
        (repo / rel).write_text(f"# {rel}\nVERSION = 6\n")
    git(repo, "add", "-A", "--", ".")
    git(repo, "commit", "-q", "-m", "c6")
    c6 = git(repo, "rev-parse", "HEAD")
    for rel in SIX_FILES:
        (repo / rel).write_text(f"# {rel}\nVERSION = 7\n")
    git(repo, "add", "-A", "--", ".")
    git(repo, "commit", "-q", "-m", "c7")
    c7 = git(repo, "rev-parse", "HEAD")
    return {"c1": c1, "c2": c2, "c3": c3, "c4": c4, "c5": c5, "c6": c6, "c7": c7}


# ---------------------------------------------------------------------------
# The store
# ---------------------------------------------------------------------------
SUBSYSTEMS = (
    # id, name, status, claims, artifact
    ("B-01", "Read path", "mapped", True, True),
    ("B-02", "Write path", "mapped", False, True),
    ("B-03", "Queue", "mapped", False, False),
    ("B-04", "Cache", "mapped", False, False),
    ("B-05", "Console", "deferred", False, False),
    ("B-06", "Index", "concerns", False, False),
    ("B-07", "Gate", "concerns", False, False),
)
UNREACHABLE = "c" * 40


def artifact_path(sid: str) -> str:
    return f"{sid}-survey.md"


def artifact_text(sid: str) -> str:
    return f"# {sid} survey\n\n{sentinel(sid)}\n\n## Details\n\nA second paragraph.\n"


def seed(storage: Path, shas: dict[str, str], head: str) -> None:
    db = sqlite3.connect(storage / "memory.db")
    db.executescript(SCHEMA.read_text())
    cur = db.cursor()
    cur.execute(
        "INSERT INTO git_state (repo_id, canonical_branch, onboarding_sha,"
        " last_checked_sha, last_checked_at)"
        " VALUES ('default', 'main', ?, ?, '2026-11-06T12:00:00Z')",
        (shas["c1"], head),
    )
    cur.execute("INSERT INTO sessions (session_id, intent) VALUES ('ex11', 'fixture')")
    for sid, name, status, has_claims, has_artifact in SUBSYSTEMS:
        cur.execute(
            "INSERT INTO subsystems (id, name, status, layer, scope, jump_in_reading)"
            " VALUES (?, ?, ?, 'backend', ?, ?)",
            (
                sid,
                name,
                status,
                f"SCOPE-{sid}: src/ files of the {name.lower()}",
                f"START-{sid}: read src/reader.py first" if sid == "B-01" else None,
            ),
        )
        if has_claims:
            for n, segment in enumerate(("recoverability", "trust")):
                cur.execute(
                    "INSERT INTO claims (claim_id, claim_key, subject_type, subject_id,"
                    " statement, epistemic_kind, asserted_at_sha, valid_from_sha, session_id)"
                    " VALUES (?, ?, 'subsystem', ?, ?, 'observation', ?, ?, 'ex11')",
                    (
                        f"{sid}-c{n}",
                        f"{sid}/{segment}/x",
                        sid,
                        f"STATEMENT {sid} {segment}",
                        shas["c1"],
                        shas["c1"],
                    ),
                )
        if has_artifact:
            (storage / artifact_path(sid)).write_text(artifact_text(sid))
            cur.execute(
                "INSERT INTO artifacts (path, kind, subsystem_id, content_hash, ref_sha,"
                " session_id) VALUES (?, 'subsystem-survey', ?, ?, ?, 'ex11')",
                (artifact_path(sid), sid, HASH, shas["c1"]),
            )
    evidence: dict[str, int] = {}
    for rel in (READER, REGISTRY, WRITER):
        cur.execute(
            "INSERT INTO evidence (file_path, ref_sha, kind, session_id)"
            " VALUES (?, ?, 'code-verified', 'ex11')",
            (rel, shas["c1"]),
        )
        evidence[rel] = int(cur.lastrowid or 0)

    def explain(
        sid: str, slot: str, disposition: str, body: str, ref: str, cites: tuple[str, ...] = ()
    ) -> None:
        cur.execute(
            "INSERT INTO explanations (subject_type, subject_id, slot, disposition, body,"
            " ref_sha, session_id) VALUES ('subsystem', ?, ?, ?, ?, ?, 'ex11')",
            (sid, slot, disposition, body, ref),
        )
        explanation_id = cur.lastrowid
        for rel in cites:
            cur.execute(
                "INSERT INTO explanation_evidence (explanation_id, evidence_id) VALUES (?, ?)",
                (explanation_id, evidence[rel]),
            )

    c1 = shas["c1"]
    explain("B-01", "purpose", "recorded", PURPOSE_B01, c1, (READER, REGISTRY))
    explain("B-01", "account", "recorded", ACCOUNT_B01, c1, (READER, REGISTRY))
    explain("B-02", "account", "recorded", ACCOUNT_B02, c1, (WRITER,))
    explain("B-03", "purpose", "declined", REASON_PURPOSE_B03, c1)
    explain("B-03", "account", "declined", REASON_ACCOUNT_B03, c1)
    explain("B-05", "purpose", "recorded", PURPOSE_B05, c1, (READER,))
    explain("B-05", "account", "recorded", ACCOUNT_B05, c1, (READER,))
    explain("B-06", "purpose", "recorded", PURPOSE_B06, c1, (READER,))
    explain("B-06", "purpose", "withdrawn", "reset: resurveyed", c1)
    explain("B-07", "purpose", "recorded", PURPOSE_B07, UNREACHABLE, (READER,))
    db.commit()
    db.close()


def add_violations(storage: Path, c1: str) -> None:
    """Newer rows whose text carries survey-status vocabulary."""

    db = sqlite3.connect(storage / "memory.db")
    cur = db.cursor()
    cur.execute("SELECT id FROM evidence WHERE file_path = ?", (READER,))
    evidence_id = cur.fetchone()[0]
    for sid, slot, disposition, body in (
        ("B-01", "purpose", "recorded", VIOLATING_PURPOSE),
        ("B-01", "account", "recorded", VIOLATING_ACCOUNT),
        ("B-03", "purpose", "declined", VIOLATING_REASON_PURPOSE),
        ("B-03", "account", "declined", VIOLATING_REASON_ACCOUNT),
    ):
        cur.execute(
            "INSERT INTO explanations (subject_type, subject_id, slot, disposition, body,"
            " ref_sha, session_id) VALUES ('subsystem', ?, ?, ?, ?, ?, 'ex11')",
            (sid, slot, disposition, body, c1),
        )
        if disposition == "recorded":
            cur.execute(
                "INSERT INTO explanation_evidence (explanation_id, evidence_id) VALUES (?, ?)",
                (cur.lastrowid, evidence_id),
            )
    db.commit()
    db.close()


def append_row(
    storage: Path,
    sid: str,
    slot: str,
    disposition: str,
    body: str,
    ref: str,
    cites: tuple[str, ...] = (),
) -> None:
    """A newer row on its own, each cited path through an evidence row of its own."""

    db = sqlite3.connect(storage / "memory.db")
    cur = db.cursor()
    cur.execute(
        "INSERT INTO explanations (subject_type, subject_id, slot, disposition, body,"
        " ref_sha, session_id) VALUES ('subsystem', ?, ?, ?, ?, ?, 'ex11')",
        (sid, slot, disposition, body, ref),
    )
    explanation_id = cur.lastrowid
    for rel in cites:
        cur.execute(
            "INSERT INTO evidence (file_path, ref_sha, kind, session_id)"
            " VALUES (?, ?, 'code-verified', 'ex11')",
            (rel, ref),
        )
        cur.execute(
            "INSERT INTO explanation_evidence (explanation_id, evidence_id) VALUES (?, ?)",
            (explanation_id, cur.lastrowid),
        )
    db.commit()
    db.close()


def add_awkward_purpose(storage: Path, c4: str) -> None:
    """B-07's newest purpose, written at C4 and citing the paths C5 changes."""

    db = sqlite3.connect(storage / "memory.db")
    cur = db.cursor()
    cur.execute(
        "INSERT INTO explanations (subject_type, subject_id, slot, disposition, body,"
        " ref_sha, session_id) VALUES ('subsystem', 'B-07', 'purpose', 'recorded', ?, ?, 'ex11')",
        ("It cites files whose names git would rather quote.", c4),
    )
    explanation_id = cur.lastrowid
    for rel in AWKWARD:
        cur.execute(
            "INSERT INTO evidence (file_path, ref_sha, kind, session_id)"
            " VALUES (?, ?, 'code-verified', 'ex11')",
            (rel, c4),
        )
        cur.execute(
            "INSERT INTO explanation_evidence (explanation_id, evidence_id) VALUES (?, ?)",
            (explanation_id, cur.lastrowid),
        )
    db.commit()
    db.close()


def run_materializer(
    storage: Path,
    *args: str,
    workspace: Path | None = None,
    script_dir: Path = ROOT,
) -> dict[str, object]:
    cmd = [sys.executable, str(script_dir / "materialize.py"), "--storage", str(storage)]
    if workspace is not None:
        cmd += ["--workspace", str(workspace)]
    cmd += list(args)
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    lines = [ln for ln in proc.stdout.splitlines() if ln.strip()]
    try:
        summary = json.loads(lines[-1]) if lines else {}
    except json.JSONDecodeError:
        summary = {}
    if not isinstance(summary, dict):
        summary = {}
    summary["_returncode"] = proc.returncode
    summary["_diagnostic"] = scrub(proc.stderr)[-300:]
    return summary


def read(path: Path) -> str:
    try:
        return path.read_text()
    except OSError:
        return ""


def section(text: str, heading: str, level: int = 2) -> str:
    """The body of one Markdown section, up to the next heading of its level or higher."""

    marker = "#" * level + " "
    body: list[str] = []
    inside = False
    for line in text.splitlines():
        if not inside:
            inside = line.startswith(marker) and line[len(marker):].strip() == heading
            continue
        depth = len(line) - len(line.lstrip("#"))
        if line.startswith("#") and 0 < depth <= level:
            break
        body.append(line)
    return "\n".join(body)


def html_sections(text: str) -> dict[str, str]:
    """An HTML page's H2 sections in the article, heading to collapsed visible text."""

    visible = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", text)
    visible = re.sub(r'(?is)<a class="heading-anchor"[^>]*>.*?</a>', " ", visible)
    parts = re.split(r'(?is)<h2\b(?![^>]*nav-group-title)[^>]*>(.*?)</h2>', visible)
    plain = lambda fragment: " ".join(html.unescape(re.sub(r"<[^>]+>", " ", fragment)).split())  # noqa: E731
    return {plain(parts[i]): plain(parts[i + 1]) for i in range(1, len(parts) - 1, 2)}


def h2s(text: str) -> list[str]:
    return [ln[3:].strip() for ln in text.splitlines() if ln.startswith("## ")]


def h3s(text: str) -> list[str]:
    return [ln[4:].strip() for ln in text.splitlines() if ln.startswith("### ")]


def subsystem_page(docs: Path, sid: str) -> str:
    pages = sorted((docs / "subsystems").glob(f"{sid.lower().replace('-', '')}-*.md"))
    return read(pages[0]) if pages else ""


def squash(text: str) -> str:
    return " ".join(text.split())


def tree_digest(directory: Path) -> dict[str, str]:
    return {
        str(p.relative_to(directory)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(directory.rglob("*"))
        if p.is_file()
    }


def provenance(sha: str, n: int, ageing: str) -> str:
    return f"*Written by a survey session at `{sha[:8]}` from {n} evidence row(s). {ageing}*"


def none_changed(n: int) -> str:
    return f"None of the {n} file(s) it cites has changed since."


def declined_purpose(sha: str, reason: str) -> str:
    return (
        f"{NO_PURPOSE_STEM}: a survey session declined to write one at `{sha[:8]}`. {reason}"
    )


def declined_account(sha: str, reason: str) -> str:
    return (
        "A survey session declined to write an account of how this subsystem works at"
        f" `{sha[:8]}`. {reason}"
    )


def load_readback() -> object | None:
    sys.path.insert(0, str(ROOT))
    try:
        from amanuensis_materializer import readback  # noqa: PLC0415
    except Exception:
        return None
    return readback


def main() -> int:
    emit("GATE EX11 — the subsystem page leads with Purpose and How it works")
    emit("")
    root = Path(tempfile.mkdtemp(prefix="amanuensis-ex11-"))
    try:
        setup_error: str | None = None
        shas: dict[str, str] = {}
        repo = root / "repo"
        try:
            shas = build_repository(repo)
        except Exception as exc:
            setup_error = f"the fixture repository could not be built — {scrub(exc)}"

        def new_store(name: str, head: str, bound: bool = True) -> tuple[Path, dict[str, object]]:
            storage = root / name
            storage.mkdir()
            seed(storage, shas, head)
            return storage, run_materializer(
                storage, "--output", str(storage / "docs"), workspace=repo if bound else None
            )

        stores: dict[str, tuple[Path, dict[str, object]]] = {}
        seed_error: str | None = setup_error
        if seed_error is None:
            try:
                # H = C2: only `other` changed since C1, so nothing cited changed.
                stores["good"] = new_store("good", shas["c2"])
                # H = C3: `reader` changed.
                stores["one"] = new_store("one", shas["c3"])
                # H does not resolve in the repository.
                stores["lost"] = new_store("lost", "d" * 40)
                # No workspace bound, and the store's parent is not a repository.
                stores["unbound"] = new_store("unbound", shas["c2"], bound=False)
                # H = C5: every cited path is one git quotes, trims or reads as magic.
                awkward = root / "awkward"
                awkward.mkdir()
                seed(awkward, shas, shas["c5"])
                add_awkward_purpose(awkward, shas["c4"])
                stores["awkward"] = (
                    awkward,
                    run_materializer(awkward, "--output", str(awkward / "docs"), workspace=repo),
                )
            except Exception as exc:
                seed_error = f"the fixture could not be seeded — {scrub(exc)}"

        def docs_of(name: str) -> Path:
            return stores[name][0] / "docs"

        def page(name: str, sid: str) -> str:
            return subsystem_page(docs_of(name), sid)

        def published(name: str = "good") -> str | None:
            if seed_error:
                return seed_error
            outcome = stores[name][1]
            if outcome.get("_returncode") != 0:
                return f"the materializer failed — {outcome.get('_diagnostic')}"
            for sid, *_ in SUBSYSTEMS:
                if not page(name, sid):
                    return f"the {sid} subsystem page could not be read"
            return None

        # -- 1. the first assertion: a recorded purpose leads the page ---------
        def purpose_leads() -> str | None:
            if (why := published()):
                return why
            text = page("good", "B-01")
            order = [h for h in h2s(text) if h in SECTION_ORDER]
            if "Purpose" not in order:
                return f"{RED_EXPECT}: the page's sections are {h2s(text)[:5]}"
            if tuple(order) != SECTION_ORDER:
                return f"{RED_EXPECT}: the sections run {order}, not {list(SECTION_ORDER)}"
            if h2s(text)[0] != "Purpose":
                return f"{RED_EXPECT}: the first section is {h2s(text)[0]!r}"
            body = section(text, "Purpose")
            if PURPOSE_B01 not in body:
                return f"{RED_EXPECT}: the recorded body is not under `## Purpose`"
            if text.count(PURPOSE_B01) != 1:
                return "the recorded purpose is printed more than once"
            want = provenance(shas["c1"], 2, none_changed(2))
            if want not in body:
                return f"the provenance line is not `{want}`; the section reads {body.strip()!r}"
            scope = section(text, "Scope")
            if "SCOPE-B-01" not in scope:
                return "Scope no longer carries subsystems.scope verbatim"
            if NO_PURPOSE_STEM in scope or NO_PURPOSE_STEM in text:
                return "Scope prints the no-purpose disclaimer beside a recorded purpose"
            return None

        check("a recorded purpose leads the page, with its provenance", purpose_leads)

        # The HTML view is what a reader opens, and the Markdown assertions cannot
        # see it: stripping these sections from the projection left this gate green
        # (slice-S2, F2/codex).
        def html_view(sid: str) -> str:
            found = sorted((docs_of("good") / "subsystems").glob(f"{sid.replace('-', '').lower()}-*.html"))
            return read(found[0]) if found else ""

        def html_page_leads() -> str | None:
            if (why := published()):
                return why
            sections = html_sections(html_view("B-01"))
            order = [h for h in sections if h in SECTION_ORDER]
            if tuple(order) != SECTION_ORDER:
                return f"the HTML page's sections run {order}, not {list(SECTION_ORDER)}"
            if next(iter(sections)) != "Purpose":
                return f"the HTML page's first section is {next(iter(sections))!r}"
            if PURPOSE_B01 not in sections["Purpose"]:
                return "the recorded purpose is not under Purpose on the HTML page"
            for line in ACCOUNT_B01.splitlines():
                words = line.removeprefix("- ").strip()
                if words and words not in sections["How it works"]:
                    return f"the account line {words!r} is not under How it works on the HTML page"
            for heading in ("Purpose", "How it works"):
                if "Written by a survey session at" not in sections[heading]:
                    return f"{heading} carries no provenance line on the HTML page"
            declined = html_sections(html_view("B-03"))
            if REASON_PURPOSE_B03 not in declined.get("Purpose", ""):
                return "a declined purpose does not print its reason on the HTML page"
            if REASON_ACCOUNT_B03 not in " ".join(declined.values()):
                return "a declined account does not print its reason on the HTML page"
            return None

        check("the HTML page leads with Purpose and How it works", html_page_leads)

        # -- 2. How it works ---------------------------------------------------
        def how_it_works() -> str | None:
            if (why := published()):
                return why
            text = page("good", "B-01")
            body = section(text, "How it works")
            for line in ACCOUNT_B01.splitlines():
                if line.strip() and line not in body:
                    return f"the account line {line!r} is not under `## How it works`"
            if provenance(shas["c1"], 2, none_changed(2)) not in body:
                return "the account carries no provenance line"
            if text.count("ACCOUNT-B-01") != 1:
                return "the account is printed more than once"
            if "Structure" not in h2s(text):
                return "the page lost its Structure section"
            b02 = page("good", "B-02")
            if h2s(b02)[0] != "Scope" or "Purpose" in h2s(b02):
                return f"B-02 has no purpose record and its sections are {h2s(b02)[:3]}"
            if NO_PURPOSE_WITH_SCOPE not in section(b02, "Scope"):
                return "B-02's Scope lost the no-purpose sentence though no purpose is recorded"
            want = provenance(shas["c1"], 1, none_changed(1))
            if want not in section(b02, "How it works"):
                return "an account without a purpose does not render under `## How it works`"
            order = [h for h in h2s(b02) if h in SECTION_ORDER]
            if order != ["Scope", "How it works", "Structure"]:
                return f"B-02's sections run {order}"
            return None

        check("a recorded account renders under How it works", how_it_works)

        # -- 3. not recorded: never a Purpose heading without a record ---------
        def never_without_a_record() -> str | None:
            if (why := published()):
                return why
            for sid, why_not in (
                ("B-04", "nothing is recorded"),
                ("B-05", "the subsystem is not explanation-eligible"),
                ("B-06", "the newest row is a withdrawal"),
                ("B-07", "the only row's revision is not in the repository"),
            ):
                text = page("good", sid)
                order = h2s(text)
                if "Purpose" in order:
                    return f"{sid} renders a Purpose heading though {why_not}"
                if order[0] != "Scope":
                    return f"{sid} opens with {order[0]!r}, not Scope, though {why_not}"
                if "How it works" in order:
                    return f"{sid} renders How it works though {why_not}"
                scope = section(text, "Scope")
                if NO_PURPOSE_WITH_SCOPE not in scope:
                    return f"{sid}'s Scope lost the no-purpose sentence though {why_not}"
                if scope.strip().splitlines()[0].strip() != NO_PURPOSE_WITH_SCOPE:
                    return f"{sid}'s Scope does not open with the no-purpose sentence"
                for body in (PURPOSE_B05, ACCOUNT_B05, PURPOSE_B06, PURPOSE_B07):
                    if body in text:
                        return f"{sid} prints a body that is not its effective record"
            return None

        check("no record, no Purpose heading, and the page is today's", never_without_a_record)

        # -- 4. declined -------------------------------------------------------
        def declined() -> str | None:
            if (why := published()):
                return why
            text = page("good", "B-03")
            order = h2s(text)
            if order[:2] != ["Purpose", "Scope"]:
                return f"B-03's sections begin {order[:2]}, not Purpose then Scope"
            body = squash(section(text, "Purpose"))
            want = declined_purpose(shas["c1"], REASON_PURPOSE_B03)
            if want not in body:
                return f"the declined purpose reads {body!r}, not {want!r}"
            if "Written by a survey session" in body:
                return "a declination carries a provenance line"
            if NO_PURPOSE_STEM in section(text, "Scope"):
                return "Scope prints the disclaimer beside a declined purpose"
            if "How it works" in order:
                return "a declined account renders a How it works section"
            record = squash(section(text, "Survey record"))
            want_account = declined_account(shas["c1"], REASON_ACCOUNT_B03)
            if want_account not in record:
                return f"the survey record lacks {want_account!r}"
            if text.count(REASON_ACCOUNT_B03) != 1 or text.count(REASON_PURPOSE_B03) != 1:
                return "a declination reason is printed other than once"
            return None

        check("declined purpose and account print their §3.6 sentences", declined)

        # -- 5. ageing: three sentences ----------------------------------------
        def ageing() -> str | None:
            if (why := published("good")) or (why := published("one")):
                return why
            if (why := published("lost")) or (why := published("unbound")):
                return why
            cases = (
                ("good", none_changed(2)),
                ("one", f"1 of the 2 file(s) it cites changed since: `{READER}`."),
                ("lost", NOT_MEASURED),
                ("unbound", NOT_MEASURED),
            )
            for name, sentence in cases:
                body = section(page(name, "B-01"), "Purpose")
                want = provenance(shas["c1"], 2, sentence)
                if want not in body:
                    return f"store {name!r}: the provenance line is not `{want}`; got {body.strip()!r}"
            # The unbound reading is still rendered, never silently dropped.
            if PURPOSE_B01 not in page("unbound", "B-01"):
                return "with no workspace the explanation is not rendered"
            if "changed since" in page("unbound", "B-01").replace(NOT_MEASURED, ""):
                return "'not measured' is rendered as a change claim"
            return None

        check("the ageing sentence is computed for none, some, and not measured", ageing)

        # A changed file must read as changed whatever its name: git quotes a
        # non-ASCII path and the set intersection missed it, so "None of the 1
        # file(s)" was printed over a real change (slice-S2, F4/codex).
        def ageing_awkward_paths() -> str | None:
            if (why := published("awkward")):
                return why
            paths = ", ".join(f"`{rel}`" for rel in sorted(AWKWARD))
            sentence = f"{len(AWKWARD)} of the {len(AWKWARD)} file(s) it cites changed since: {paths}."
            body = section(page("awkward", "B-07"), "Purpose")
            if provenance(shas["c4"], len(AWKWARD), sentence) not in body:
                return f"a change to a path git quotes, trims or reads as magic is misreported: {body.strip()!r}"
            return None

        check("the ageing sentence sees a change to a path git would quote", ageing_awkward_paths)

        # "up to five paths", and rows are not files: one file through two evidence
        # rows has to read as one file in the ageing sentence and two rows in the
        # provenance line (F8, F9/claude, final).
        def ageing_counts() -> str | None:
            if seed_error:
                return seed_error
            storage = root / "six"
            storage.mkdir()
            seed(storage, shas, shas["c7"])
            append_row(
                storage,
                "B-07",
                "purpose",
                "recorded",
                "It cites six files through seven evidence rows.",
                shas["c6"],
                (*SIX_FILES, SIX_FILES[0]),
            )
            done = run_materializer(storage, "--output", str(storage / "docs"), workspace=repo)
            if done.get("_returncode") != 0:
                return f"the materializer failed — {done.get('_diagnostic')}"
            named = ", ".join(f"`{rel}`" for rel in sorted(SIX_FILES)[:5])
            sentence = f"6 of the 6 file(s) it cites changed since: {named}, and others."
            want = provenance(shas["c6"], 7, sentence)
            body = section(subsystem_page(storage / "docs", "B-07"), "Purpose")
            if want not in body:
                return f"the provenance line is not `{want}`; got {body.strip()!r}"
            return None

        check("the ageing sentence names five paths and counts files, the provenance rows", ageing_counts)

        # -- 6. the effective-row rule and its shared cases --------------------
        def effective_cases() -> str | None:
            readback = load_readback()
            if readback is None:
                return "readback cannot be imported, so the selection function is absent"
            select = getattr(readback, "select_explanation", None)
            if not callable(select):
                return "readback.select_explanation is absent"
            try:
                doc = json.loads(CASES.read_text())
            except (OSError, json.JSONDecodeError):
                return "the shared case file could not be read"
            cases = doc.get("cases") or []
            if len(cases) < 10:
                return f"the shared case file holds {len(cases)} case(s)"
            kinds = {c.get("kind") for c in cases}
            for case in cases:
                rows = [dict(r) for r in case["rows"]]
                resolvable = set(case["resolvable"]) if case["workspace"] else None
                got = select(rows, resolvable, bool(case["eligible"]))
                want = case["expect"]
                row = getattr(got, "row", None)
                got_id = row["id"] if row else None
                if getattr(got, "state", None) != want["state"]:
                    return f"{case['id']}: state {getattr(got, 'state', None)!r}, not {want['state']!r}"
                if got_id != want["row_id"]:
                    return f"{case['id']}: row {got_id!r}, not {want['row_id']!r}"
                if bool(getattr(got, "checked", None)) != bool(want["checked"]):
                    return f"{case['id']}: checked {getattr(got, 'checked', None)!r}"
            # Python read the project's eligibility from its subsystems and the
            # server did not, so one store answered two ways (slice-S2, F5/codex).
            eligible = getattr(readback, "subject_explanation_eligible", None)
            if not callable(eligible):
                return "readback.subject_explanation_eligible is absent"
            shared = doc.get("subject_eligibility") or []
            if len(shared) < 5:
                return "the shared case file holds no subject_eligibility cases"
            for case in shared:
                got = eligible(case["subject_type"], case["status"], case["all_statuses"])
                if got is not case["eligible"]:
                    return f"{case['id']}: eligible {got!r}, not {case['eligible']!r}"
            if len(kinds) < 6:
                return f"the case file covers only the kinds {sorted(k for k in kinds if k)}"
            return None

        check("the selection function agrees with every shared case", effective_cases)

        # -- 7. the survey narrative with a recorded account -------------------
        def narrative() -> str | None:
            if (why := published()):
                return why
            for sid, claims in (("B-01", True), ("B-02", False)):
                text = page("good", sid)
                if text.count(sentinel(sid)) != 1:
                    return f"{sid}: the survey narrative appears {text.count(sentinel(sid))} times"
                if "Survey narrative" in h3s(section(text, "Structure")):
                    return f"{sid}: a recorded account left the narrative inside Structure"
                record = section(text, "Survey record")
                if "Survey artifact" not in h3s(record):
                    return f"{sid}: the survey record has no `### Survey artifact`"
                if sentinel(sid) not in section(record, "Survey artifact", level=3):
                    return f"{sid}: the narrative is not under `### Survey artifact`"
                has_claims = "Key types" in text or "Recoverability" in text
                if claims != has_claims:
                    return f"{sid}: the fixture's claim state is not what the case needs"
            # The control: an unrecorded account keeps §2.3's other rows. B-04..B-07
            # have no artifact, so only the heading is checked.
            return None

        check("with a recorded account the narrative is under Survey record, claims or none", narrative)

        # -- 8. lint, the refusal sentence, and the clean publish --------------
        def lint_refusal() -> str | None:
            if seed_error:
                return seed_error
            storage = root / "lint"
            storage.mkdir()
            seed(storage, shas, shas["c2"])
            docs = storage / "docs"
            first = run_materializer(storage, "--clean-publish", workspace=repo)
            if first.get("_returncode") != 0 or not first.get("published"):
                return f"the clean fixture did not publish — {first.get('_diagnostic')}"
            before = tree_digest(docs)
            add_violations(storage, shas["c1"])
            refused = run_materializer(storage, "--clean-publish", workspace=repo)
            if refused.get("ok"):
                return "a violating explanation left the clean publish green"
            if refused.get("published"):
                return "a violating explanation was published"
            if refused.get("_returncode") == 0:
                return "the refused clean publish exited 0"
            warnings = " ".join(str(w) for w in refused.get("warnings") or [])
            if "B-01" not in warnings or "purpose" not in warnings:
                return f"no warning names the subsystem and the slot: {scrub(warnings)[:200]!r}"
            if tree_digest(docs) != before:
                return "the previously published output was touched"
            inplace = run_materializer(
                storage, "--output", str(storage / "docs-inplace"), workspace=repo
            )
            if inplace.get("ok"):
                return "an in-place render with violating explanations stayed green"
            text = subsystem_page(storage / "docs-inplace", "B-01")
            if not text:
                return "the in-place render produced no B-01 page"
            if REFUSAL.format(slot="purpose") not in section(text, "Purpose"):
                return "B-01's Purpose does not carry the refusal sentence"
            if REFUSAL.format(slot="account") not in section(text, "How it works"):
                return "B-01's How it works does not carry the refusal sentence"
            for bad in (VIOLATING_PURPOSE, VIOLATING_ACCOUNT):
                if bad in text:
                    return f"the violating text {bad!r} was printed"
            b03 = subsystem_page(storage / "docs-inplace", "B-03")
            if REFUSAL.format(slot="purpose") not in section(b03, "Purpose"):
                return "a violating declination reason is not replaced by the refusal sentence"
            if REFUSAL.format(slot="account") not in section(b03, "Survey record"):
                return "a violating account declination is not replaced by the refusal sentence"
            for bad in (VIOLATING_REASON_PURPOSE, VIOLATING_REASON_ACCOUNT):
                if bad in b03:
                    return f"the violating reason {bad!r} was printed"
            return None

        check("lint violations print the refusal and turn the clean publish red", lint_refusal)

        # The seed above also holds a purpose violation, which warns through the
        # excerpt on other pages in the same form, so removing the subsystem page's
        # own callback left that assertion green. These three print only there
        # (F3/claude, final).
        def lint_on_the_subsystem_page_alone() -> str | None:
            if seed_error:
                return seed_error
            c1 = shas["c1"]
            for sid, slot, disposition, bad in (
                ("B-01", "account", "recorded", VIOLATING_ACCOUNT),
                ("B-03", "account", "declined", VIOLATING_REASON_ACCOUNT),
                ("B-03", "purpose", "declined", VIOLATING_REASON_PURPOSE),
            ):
                storage = root / f"alone-{sid}-{slot}"
                storage.mkdir()
                seed(storage, shas, shas["c2"])
                docs = storage / "docs"
                first = run_materializer(storage, "--clean-publish", workspace=repo)
                if first.get("_returncode") != 0 or not first.get("published"):
                    return f"the clean fixture did not publish — {first.get('_diagnostic')}"
                before = tree_digest(docs)
                append_row(storage, sid, slot, disposition, bad, c1, (READER,) if disposition == "recorded" else ())
                refused = run_materializer(storage, "--clean-publish", workspace=repo)
                label = f"a violation only {sid}'s page prints ({disposition} {slot})"
                if refused.get("ok") or refused.get("published") or refused.get("_returncode") == 0:
                    return f"{label} left the clean publish green"
                warnings = " ".join(str(w) for w in refused.get("warnings") or [])
                if sid not in warnings or slot not in warnings:
                    return f"{label}: no warning names it: {scrub(warnings)[:200]!r}"
                if tree_digest(docs) != before:
                    return f"{label}: the previously published output was touched"
            return None

        check("a violation only the subsystem page prints turns the publish red", lint_on_the_subsystem_page_alone)

        # A refused row owes the refusal sentence, not its body, on both views
        # (F11/claude, final).
        def readback_of_a_refused_row() -> str | None:
            if seed_error:
                return seed_error
            storage = root / "refused-row"
            storage.mkdir()
            seed(storage, shas, shas["c2"])
            add_violations(storage, shas["c1"])
            docs = storage / "docs"
            run_materializer(storage, "--output", str(docs), workspace=repo)
            read_back = lambda: run_materializer(  # noqa: E731
                storage, "--readback-only", "--output", str(docs), workspace=repo
            )
            named = lambda outcome, kind: [  # noqa: E731
                m
                for m in outcome.get("mismatches") or []
                if m.get("object_type") == kind and m.get("object_id") == "B-01:purpose"
            ]
            control = read_back()
            for kind in ("explanation", "explanation-html"):
                if named(control, kind):
                    return f"the read-back wants the refused body on a page that rightly prints the refusal ({kind})"
            sentence = REFUSAL.format(slot="purpose")
            for suffix, kind in (("md", "explanation"), ("html", "explanation-html")):
                target = next(iter(sorted((docs / "subsystems").glob(f"b01-*.{suffix}"))), None)
                if target is None:
                    return f"the B-01 {suffix} page is absent"
                original = target.read_text()
                if sentence not in original:
                    return f"the B-01 {suffix} page does not carry the refusal sentence"
                target.write_text(original.replace(sentence, VIOLATING_PURPOSE))
                try:
                    printed = read_back()
                finally:
                    target.write_text(original)
                if not named(printed, kind):
                    return f"the read-back accepted the refused body in place of the refusal on the {suffix} page"
            return None

        check("the read-back owes the refusal on a refused row, in both directions", readback_of_a_refused_row)

        # The head is one of the page's sources. A page is rebuilt on every run, so
        # the ageing line is the reader's half and the source hash the record's
        # (F12/claude, final).
        def head_moves() -> str | None:
            if seed_error:
                return seed_error
            storage = root / "head-moves"
            storage.mkdir()
            seed(storage, shas, shas["c2"])
            docs = storage / "docs"

            def reading() -> tuple[str, str | None]:
                done = run_materializer(storage, "--output", str(docs), workspace=repo)
                if done.get("_returncode") != 0:
                    raise RuntimeError(f"the materializer failed — {done.get('_diagnostic')}")
                pages = json.loads(read(docs / ".manifest.json")).get("pages", [])
                sources = next(
                    (
                        p.get("sources") or {}
                        for p in pages
                        if str(p.get("path", "")).startswith("subsystems/b01-")
                    ),
                    {},
                )
                key = "db:subsystem:B-01:explanations"
                return section(subsystem_page(docs, "B-01"), "Purpose"), sources.get(key)

            page_before, hash_before = reading()
            if hash_before is None:
                return "the page lists no explanation source"
            db = sqlite3.connect(storage / "memory.db")
            db.execute("UPDATE git_state SET last_checked_sha = ?", (shas["c3"],))
            db.commit()
            db.close()
            page_after, hash_after = reading()
            if provenance(shas["c1"], 2, none_changed(2)) not in page_before:
                return "the fixture's ageing line is not the unchanged one"
            moved = f"1 of the 2 file(s) it cites changed since: `{READER}`."
            if provenance(shas["c1"], 2, moved) not in page_after:
                return f"the ageing line did not follow the head: {page_after.strip()!r}"
            if hash_after == hash_before:
                return "the page's explanation source hash did not move with the head"
            return None

        check("a moved head moves the page's ageing line and its source hash", head_moves)

        # The writers refuse a heading in an account, which is why removing the nesting
        # left this gate green. A row can still hold one: it was written around the
        # tools, or before they read every line break (F10/claude, F2/claude, final).
        def account_is_nested() -> str | None:
            if seed_error:
                return seed_error
            storage = root / "nested"
            storage.mkdir()
            seed(storage, shas, shas["c2"])
            append_row(storage, "B-02", "account", "recorded", NESTED_ACCOUNT, shas["c1"], (WRITER,))
            done = run_materializer(storage, "--clean-publish", workspace=repo)
            if not done.get("ok") or not done.get("published"):
                return f"an account holding a heading did not publish — {done.get('_diagnostic')}"
            text = subsystem_page(storage / "docs", "B-02")
            found = next(iter(sorted((storage / "docs" / "subsystems").glob("b02-*.html"))), None)
            outline = html_sections(read(found)) if found else {}
            for heading in NESTED_HEADINGS:
                if heading in h2s(text):
                    return f"the account opened a new section on the Markdown page: {heading!r}"
                body = section(text, "How it works")
                if not re.search(rf"(?m)^#{{3,6}} {re.escape(heading)}$", body):
                    return f"{heading!r} is not a heading below H2 under How it works: {body[:200]!r}"
                if heading in outline:
                    return f"the account opened a new section on the HTML page: {heading!r}"
                if heading not in outline.get("How it works", ""):
                    return f"{heading!r} is not under How it works on the HTML page"
            return None

        check("an account cannot open a section, whichever line break precedes the heading", account_is_nested)

        # -- 8b. a status in a code span --------------------------------------
        # The projection turns `mapped` into a chip reading "Mapped", and renames a
        # few schema phrases, so a read-back comparing the raw words failed a true
        # explanation with no hint of the cause (F1/codex, final). The expected line
        # comes from the projection's own inline renderer, which keeps the check
        # exact: a different status word in that place is still a missing line.
        def status_in_code_span() -> str | None:
            if seed_error:
                return seed_error
            storage = root / "chips"
            storage.mkdir()
            seed(storage, shas, shas["c2"])
            c1 = shas["c1"]
            append_row(storage, "B-01", "purpose", "recorded", PURPOSE_CHIP, c1, (READER,))
            append_row(storage, "B-01", "account", "recorded", ACCOUNT_CHIP, c1, (READER,))
            append_row(storage, "B-03", "purpose", "declined", REASON_CHIP, c1)
            done = run_materializer(storage, "--clean-publish", workspace=repo)
            if not done.get("ok") or not done.get("published"):
                readback = done.get("readback")
                listed = readback.get("mismatches") if isinstance(readback, dict) else None
                absent = [
                    str(m.get("detail"))[:160]
                    for m in listed or done.get("mismatches") or []
                    if "explanation" in str(m.get("object_type"))
                ]
                return (
                    "a true explanation naming a status in a code span failed the clean publish:"
                    f" {absent or done.get('_diagnostic')}"
                )
            docs = storage / "docs"
            target = next(iter(sorted((docs / "subsystems").glob("b01-*.html"))), None)
            if target is None:
                return "the B-01 HTML page is absent"
            original = target.read_text()
            wrong = re.sub(
                r"(The status\s*<span[^>]*>)Mapped(</span>)", r"\1Unmapped\2", original, count=1
            )
            if wrong == original:
                return "the HTML page does not render the code span as the projection's chip"
            target.write_text(wrong)
            try:
                red = run_materializer(
                    storage, "--readback-only", "--output", str(docs), workspace=repo
                )
            finally:
                target.write_text(original)
            hits = [
                m
                for m in red.get("mismatches") or []
                if m.get("axis") == "state" and m.get("object_type") == "explanation-html"
            ]
            if red.get("ok") or not hits:
                return "a different status word in the explanation's place passed the read-back"
            return None

        check("a status in a code span publishes, and a wrong one does not read back", status_in_code_span)

        # -- 8c. a workspace path git cannot answer in --------------------------
        # The same state the server reads: the newest row, unchecked, and its age
        # not measured (F2/codex, F19/claude, final).
        def workspace_git_cannot_answer() -> str | None:
            if seed_error:
                return seed_error
            plain = root / "not-a-repository"
            plain.mkdir()
            storage = root / "unanswered"
            storage.mkdir()
            seed(storage, shas, shas["c2"])
            done = run_materializer(storage, "--clean-publish", workspace=plain)
            if not done.get("ok") or not done.get("published"):
                return f"the publish over a path git cannot answer in failed — {done.get('_diagnostic')}"
            text = subsystem_page(storage / "docs", "B-01")
            body = section(text, "Purpose")
            if PURPOSE_B01 not in body:
                return "the newest row is not printed for a path git cannot answer in"
            if provenance(shas["c1"], 2, NOT_MEASURED) not in body:
                return f"the age is not 'not measured' for such a path: {body.strip()!r}"
            return None

        check("a workspace path git cannot answer in reads as no workspace", workspace_git_cannot_answer)

        def shared_binding_cases() -> str | None:
            if seed_error:
                return seed_error
            readback = load_readback()
            bound = getattr(readback, "workspace_is_bound", None)
            if not callable(bound):
                return "readback.workspace_is_bound is absent"
            cases = json.loads(CASES.read_text()).get("workspace_binding") or []
            kinds = {c.get("kind") for c in cases}
            for kind in ("git-work-tree", "plain-directory", "missing-path", "git-metadata-removed"):
                if kind not in kinds:
                    return f"the case file has no workspace_binding case of kind {kind}"
            plain = root / "binding-plain"
            plain.mkdir()
            for case in cases:
                kind = case["kind"]
                if kind == "git-metadata-removed":
                    moved = repo / ".git-gone"
                    (repo / ".git").rename(moved)
                    try:
                        got = bound(repo)
                    finally:
                        moved.rename(repo / ".git")
                else:
                    got = bound(
                        {"git-work-tree": repo, "plain-directory": plain}.get(kind, root / "no-such-path")
                    )
                if got is not case["bound"]:
                    return f"{case['id']}: bound {got!r}, not {case['bound']!r}"
            return None

        check("the workspace check agrees with every shared binding case", shared_binding_cases)

        # -- 9. custody: sources and the read-back state axis ------------------
        def custody_sources() -> str | None:
            if (why := published()):
                return why
            manifest = read(docs_of("good") / ".manifest.json")
            try:
                pages = json.loads(manifest).get("pages", [])
            except json.JSONDecodeError:
                return "the manifest could not be read"
            entries = [p for p in pages if str(p.get("path", "")).startswith("subsystems/b01-")]
            if not entries:
                return "the manifest has no B-01 page"
            keys = " ".join(str(k) for k in (entries[0].get("sources") or {}))
            if "explanation" not in keys:
                return f"B-01's sources do not list the explanation rows: {keys[:200]}"
            return None

        check("the page lists the explanation rows among its sources", custody_sources)

        def readback_red_case() -> str | None:
            if (why := published()):
                return why
            storage = stores["good"][0]
            docs = docs_of("good")
            control = run_materializer(
                storage, "--readback-only", "--output", str(docs), workspace=repo
            )
            if not control.get("ok"):
                return f"the read-back is red on the unmodified publication — {control.get('mismatches')}"
            target = next(iter(sorted((docs / "subsystems").glob("b01-*.md"))), None)
            if target is None:
                return "the B-01 page is absent"
            original = target.read_text()
            if PURPOSE_B01 not in original:
                return "the publication carries no purpose body to remove"
            target.write_text(original.replace(PURPOSE_B01, ""))
            try:
                red = run_materializer(
                    storage, "--readback-only", "--output", str(docs), workspace=repo
                )
            finally:
                target.write_text(original)
            if red.get("ok"):
                return "the read-back passed with a recorded body removed from its page"
            hits = [
                m
                for m in red.get("mismatches") or []
                if m.get("axis") == "state" and "explanation" in str(m.get("object_type"))
            ]
            if not hits:
                return (
                    "the state axis did not name the missing explanation; mismatches are"
                    f" {[(m.get('axis'), m.get('object_type')) for m in red.get('mismatches') or []]}"
                )
            return None

        check("the read-back state axis fails when a recorded body is off its page", readback_red_case)

        def readback_html_red_case() -> str | None:
            if (why := published()):
                return why
            storage = stores["good"][0]
            docs = docs_of("good")
            for sid, stem, removed in (
                ("B-01", "b01", PURPOSE_B01),
                ("B-01", "b01", "the registry never blocks a writer"),
                ("B-03", "b03", REASON_PURPOSE_B03),
            ):
                target = next(iter(sorted((docs / "subsystems").glob(f"{stem}-*.html"))), None)
                if target is None:
                    return f"the {sid} HTML page is absent"
                original = target.read_text()
                if removed not in original:
                    return f"the {sid} HTML page does not carry {removed!r} to remove"
                target.write_text(original.replace(removed, ""))
                try:
                    red = run_materializer(
                        storage, "--readback-only", "--output", str(docs), workspace=repo
                    )
                finally:
                    target.write_text(original)
                hits = [
                    m
                    for m in red.get("mismatches") or []
                    if m.get("axis") == "state" and m.get("object_type") == "explanation-html"
                ]
                if red.get("ok") or not hits:
                    return f"the read-back did not name {removed!r} missing from the {sid} HTML page"
            return None

        check("the read-back state axis fails when an explanation is off its HTML page", readback_html_red_case)

        # -- 10. labels come from the contract ---------------------------------
        def labels_from_contract() -> str | None:
            if (why := published()):
                return why
            if "declined to write one" not in page("good", "B-03"):
                return "the baseline declined sentence is not rendered"
            copy = root / "materializer-copy"
            shutil.copytree(
                ROOT,
                copy,
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".venv", "test-*.py"),
            )
            vocab = copy / "amanuensis_materializer" / "vocabulary.py"
            text = vocab.read_text()
            start = text.find('"explanation_discharge": {')
            marker = '"label": "Declined"'
            at = text.find(marker, start) if start >= 0 else -1
            if at < 0:
                return "the explanation_discharge label to change was not found in the vocabulary"
            vocab.write_text(text[:at] + '"label": "Withheld"' + text[at + len(marker):])
            storage = root / "relabel"
            storage.mkdir()
            seed(storage, shas, shas["c2"])
            outcome = run_materializer(
                storage, "--output", str(storage / "docs"), workspace=repo, script_dir=copy
            )
            if outcome.get("_returncode") != 0:
                return f"the relabelled materializer failed — {outcome.get('_diagnostic')}"
            changed = subsystem_page(storage / "docs", "B-03")
            if "declined to write" in squash(changed):
                return "a changed explanation_discharge label did not change the page"
            if "withheld to write" not in squash(changed).lower():
                return "the page does not carry the changed label"
            return None

        check("a changed explanation_discharge label changes the page", labels_from_contract)
    finally:
        shutil.rmtree(root, ignore_errors=True)

    # -- 11. the existing assertions this packet edits -------------------------
    def negative_corpus() -> str | None:
        source = read(ROOT / "test-overview-truthfulness.py")
        if not source:
            return "test-overview-truthfulness.py is not readable"
        corpus: tuple[str, ...] = ()
        for node in ast.walk(ast.parse(source)):
            if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id == "NEGATIVE_CORPUS" for t in node.targets
            ):
                corpus = tuple(ast.literal_eval(node.value))
        about_ids = [text for text in corpus if re.match(r"[A-Z]-\d+\s", text)]
        if len(about_ids) < 3:
            return f"the negative corpus holds {len(about_ids)} subsystem-id sentence(s), not three"
        sys.path.insert(0, str(ROOT))
        from amanuensis_materializer.lint import orientation_violations  # noqa: PLC0415

        flagged = [text for text in about_ids if orientation_violations(text)]
        if flagged:
            return f"the lint flags a negative-corpus sentence: {flagged[0]!r}"
        return None

    check("the lint's negative corpus has subsystem-id sentences", negative_corpus)

    def allowlist_released() -> str | None:
        source = read(ROOT / "test-prose-retention.py")
        if not source:
            return "test-prose-retention.py is not readable"
        if re.search(r'ALLOWLIST\["explanations\.body"\]', source):
            return "explanations.body is still on the retention allowlist"
        if re.search(r'^\s+"explanations\.body",\s*$', source.split("EXPECTED_ALLOWLIST")[1].split("}")[0], re.M):
            return "EXPECTED_ALLOWLIST still names explanations.body"
        return None

    check("explanations.body is off the retention allowlist", allowlist_released)

    def runs_in_ci() -> str | None:
        text = read(CI_FILE)
        if not text:
            return "the CI workflow .github/workflows/test.yml is not readable"
        if not re.search(r"python3 test-explanation-pages\.py", text):
            return "the workflow does not run test-explanation-pages.py"
        return None

    check("the gate runs in CI", runs_in_ci)

    emit("")
    if FAILURES:
        emit(f"GATE {PACKET} RED: {FAILURES[0].split(': ', 1)[1]}")
        return 1
    emit(f"GATE {PACKET} GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
