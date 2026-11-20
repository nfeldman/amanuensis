#!/usr/bin/env python3
"""Gate for orientation packet O13 — date the survey notes under the account
(design/orientation/PLAN.md §4 O13, "Publishing defects").

Seeds four subsystems, each with a registered survey artifact whose prose
contradicts the recorded account where there is one:

  B-01  account, claims, artifact      → survey-record placement
  B-02  no account, claims, artifact   → the narrative sits inside Structure
  B-03  no account, no claims, artifact → the narrative stands in for claims
  B-04  account, no claims, artifact   → survey-record placement, no claims
  B-05  account, claims, two artifacts  → survey-record placement, one dated line each

Turns red when, in the Markdown or the HTML of the subsystem pages:

  - any line of B-01's artifact prose appears above the account's "How it works"
    heading;
  - B-01's "Survey artifact" does not open, before the prose, with the dated
    line: "Written on <date> at revision <sha8> as the survey's working notes,
    and kept as written. The account above was recorded on <date> at revision
    <sha8>; where the two disagree, the later one is the current reading.", or
    names the wrong date or revision for either record;
  - a subsystem with an account carries that dated line more than once per
    artifact, or one without an account carries it at all;
  - B-05's "Survey artifact" lacks, before its prose, a dated line for each of its
    two artifacts with that artifact's own date and revision, or its provenance
    lacks either artifact's "written on" date;
  - the narrative's provenance on B-01 to B-04 lacks "written on <artifact date>"
    (the first ten characters of the artifact's stored timestamp);
  - an artifact file's bytes change in the publish;
  - the gate does not run in CI.

False green it cannot exclude: it checks the dated line's words and place, not
that a reader takes the later record as the current one.

Output protocol: exactly one status line, last, on stdout. Every subprocess is
captured and never echoed, and every message is scrubbed.
"""

from __future__ import annotations

import html as htmllib
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
CI_FILE = REPO / ".github" / "workflows" / "test.yml"

PACKET = "O13"

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
# Fixture
# ---------------------------------------------------------------------------
HEAD = "cccccccccccc3333cccccccccccc3333cccccccc"
NOTES_SHA = "aaaaaaaa11111111aaaaaaaa11111111aaaaaaaa"
ACCOUNT_SHA = "bbbbbbbb22222222bbbbbbbb22222222bbbbbbbb"
HASH = "0123456789abcdef0123456789abcdef"
NOTES_WRITTEN = "2026-10-02 09:30:00"
ACCOUNT_RECORDED = "2026-11-10 14:05:00"
NOTES_DATE = NOTES_WRITTEN[:10]
LATER_NOTES_SHA = "dddddddd44444444dddddddd44444444dddddddd"
LATER_NOTES_WRITTEN = "2026-10-20 16:45:00"
LATER_NOTES_DATE = LATER_NOTES_WRITTEN[:10]
ACCOUNT_DATE = ACCOUNT_RECORDED[:10]

# (id, name, has_account, has_claims)
SUBSYSTEMS = (
    ("B-01", "Read path", True, True),
    ("B-02", "Write path", False, True),
    ("B-03", "Queue", False, False),
    ("B-04", "Cache", True, False),
    ("B-05", "Index", True, True),
)

# A second artifact for B-05: (path, prose, revision, written_at).
LATER_PATH = "B-05-followup-survey.md"
LATER_PROSE = "NOTES-B-05-LATER the index is rebuilt on every write"
EXTRA_ARTIFACTS = {"B-05": ((LATER_PATH, f"# B-05 follow-up\n\n{LATER_PROSE}\n", LATER_NOTES_SHA, LATER_NOTES_WRITTEN),)}

ACCOUNT_BODY = (
    "The read path serves each request from the cache and falls back to the store"
    " only on a miss. It drains the queue in batches of fifty."
)


def prose_lines(sid: str) -> list[str]:
    return [
        f"NOTES-{sid}-ONE the read path drains the queue one item per tick",
        f"NOTES-{sid}-TWO the cache is bypassed on every request",
    ]


def artifact_path(sid: str) -> str:
    return f"{sid}-survey.md"


def artifact_text(sid: str) -> str:
    one, two = prose_lines(sid)
    return f"# {sid} survey\n\n{one}\n\n## Details\n\n{two}\n"


def dated_line(date: str = NOTES_DATE, sha: str = NOTES_SHA) -> str:
    return (
        f"Written on {date} at revision {sha[:8]} as the survey's working"
        f" notes, and kept as written. The account above was recorded on {ACCOUNT_DATE}"
        f" at revision {ACCOUNT_SHA[:8]}; where the two disagree, the later one is the"
        " current reading."
    )


def seed(storage: Path) -> None:
    db = sqlite3.connect(storage / "memory.db")
    db.executescript(SCHEMA.read_text())
    cur = db.cursor()
    cur.execute(
        "INSERT INTO git_state (repo_id, canonical_branch, onboarding_sha,"
        " last_checked_sha, last_checked_at)"
        " VALUES ('default', 'main', ?, ?, '2026-11-12T12:00:00Z')",
        (HEAD, HEAD),
    )
    cur.execute("INSERT INTO sessions (session_id, intent) VALUES ('o13', 'fixture')")
    for sid, name, has_account, has_claims in SUBSYSTEMS:
        cur.execute(
            "INSERT INTO subsystems (id, name, status, layer) VALUES (?, ?, 'mapped', 'backend')",
            (sid, name),
        )
        if has_claims:
            for n, segment in enumerate(("recoverability", "trust")):
                cur.execute(
                    "INSERT INTO claims (claim_id, claim_key, subject_type, subject_id,"
                    " statement, epistemic_kind, asserted_at_sha, valid_from_sha, session_id)"
                    " VALUES (?, ?, 'subsystem', ?, ?, 'observation', ?, ?, 'o13')",
                    (f"{sid}-c{n}", f"{sid}/{segment}/x", sid, f"STATEMENT {sid} {segment}",
                     HEAD, HEAD),
                )
        if has_account:
            cur.execute(
                "INSERT INTO explanations (subject_type, subject_id, slot, disposition, body,"
                " ref_sha, session_id, recorded_at)"
                " VALUES ('subsystem', ?, 'account', 'recorded', ?, ?, 'o13', ?)",
                (sid, ACCOUNT_BODY, ACCOUNT_SHA, ACCOUNT_RECORDED),
            )
        (storage / artifact_path(sid)).write_text(artifact_text(sid))
        cur.execute(
            "INSERT INTO artifacts (path, kind, subsystem_id, content_hash, ref_sha,"
            " session_id, written_at) VALUES (?, 'subsystem-survey', ?, ?, ?, 'o13', ?)",
            (artifact_path(sid), sid, HASH, NOTES_SHA, NOTES_WRITTEN),
        )
        for path, text, sha, written in EXTRA_ARTIFACTS.get(sid, ()):
            (storage / path).write_text(text)
            cur.execute(
                "INSERT INTO artifacts (path, kind, subsystem_id, content_hash, ref_sha,"
                " session_id, written_at) VALUES (?, 'subsystem-survey', ?, ?, ?, 'o13', ?)",
                (path, sid, HASH, sha, written),
            )
    db.commit()
    db.close()


def publish(storage: Path) -> dict[str, object]:
    proc = subprocess.run(
        [sys.executable, str(ROOT / "materialize.py"), "--storage", str(storage)],
        capture_output=True,
        text=True,
        check=False,
    )
    return {"returncode": proc.returncode, "diagnostic": scrub(proc.stderr)[-300:]}


def read(path: Path) -> str:
    try:
        return path.read_text()
    except OSError:
        return ""


def pages(docs: Path, sid: str, suffix: str) -> str:
    found = sorted((docs / "subsystems").glob(f"{sid.lower().replace('-', '')}-*.{suffix}"))
    return read(found[0]) if found else ""


def html_text(markup: str) -> str:
    """The reader's text of an HTML page: tags dropped, entities decoded, one line per block."""

    body = re.sub(r"(?is)<(script|style)\b.*?</\1>", "", markup)
    body = re.sub(r"(?i)</?(p|li|h[1-6]|div|section|tr|br|ul|ol|table|pre)\b[^>]*>", "\n", body)
    body = re.sub(r"<[^>]+>", "", body)
    return htmllib.unescape(body)


def squash(text: str) -> str:
    return " ".join(text.split())


def section(text: str, heading: str, level: int = 2) -> str:
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


def main() -> int:
    emit("GATE O13 — date the survey notes under the account")
    emit("")
    root = Path(tempfile.mkdtemp(prefix="amanuensis-o13-"))
    try:
        storage = root / "store"
        storage.mkdir()
        seed_error: str | None = None
        before: dict[str, bytes] = {}
        try:
            seed(storage)
            before = {p.name: p.read_bytes() for p in storage.glob("*-survey.md")}
        except Exception as exc:
            seed_error = f"the fixture could not be seeded — {scrub(exc)}"
        outcome = publish(storage) if seed_error is None else {}
        docs = storage / "docs"
        md = {sid: pages(docs, sid, "md") for sid, *_ in SUBSYSTEMS}
        html = {sid: html_text(pages(docs, sid, "html")) for sid, *_ in SUBSYSTEMS}
        views = {"Markdown": md, "HTML": html}

        def published() -> str | None:
            if seed_error:
                return seed_error
            if outcome.get("returncode") != 0:
                return f"the materializer failed — {outcome.get('diagnostic')}"
            for view, texts in views.items():
                for sid, page in texts.items():
                    if not page.strip():
                        return f"the {sid} {view} page could not be read"
            return None

        # -- 1. no prose above the account's heading ------------------------
        def prose_below_account() -> str | None:
            if (why := published()):
                return why
            for view, texts in views.items():
                for sid in ("B-01", "B-04"):
                    text = texts[sid]
                    heading = text.find("How it works")
                    if heading < 0:
                        return f"{sid} {view}: the page has no `How it works` heading"
                    for line in prose_lines(sid):
                        at = text.find(line)
                        if at < 0:
                            return f"{sid} {view}: the artifact's prose is gone"
                        if at < heading:
                            return f"{sid} {view}: `{line}` is above the account's heading"
            return None

        check("the artifact's prose stays below the account", prose_below_account)

        # -- 2. the dated line, before the prose ------------------------------
        def dated_under_account() -> str | None:
            if (why := published()):
                return why
            want = dated_line()
            for view, texts in views.items():
                for sid in ("B-01", "B-04"):
                    text = squash(texts[sid])
                    n = text.count(want)
                    if n != 1:
                        got = re.findall(r"Written on [^.]*\.[^.]*\.", text)
                        return f"{sid} {view}: the dated line appears {n} times; found {got[:1]}"
                    first_prose = text.find(prose_lines(sid)[0])
                    if text.find(want) > first_prose:
                        return f"{sid} {view}: the dated line comes after the prose"
                    survey = text.rfind("Survey artifact", 0, text.find(want))
                    if survey < 0 or text.find("Survey artifact") > text.find(want):
                        return f"{sid} {view}: the dated line is not under `Survey artifact`"
            if squash(md["B-01"]).count("*" + want + "*") != 1:
                return "B-01 Markdown: the dated line is not one italic line"
            if not re.search(r"<em>\s*Written on " + NOTES_DATE, read_html_raw(docs, "B-01")):
                return "B-01 HTML: the dated line is not italic"
            return None

        check("the survey artifact opens with the dated line", dated_under_account)

        def dated_per_artifact() -> str | None:
            if (why := published()):
                return why
            for view, texts in views.items():
                text = squash(texts["B-05"])
                first_prose = min(
                    (at for at in (text.find(prose_lines("B-05")[0]), text.find(LATER_PROSE)) if at >= 0),
                    default=-1,
                )
                if first_prose < 0:
                    return f"B-05 {view}: the artifacts' prose is gone"
                for date, sha in ((NOTES_DATE, NOTES_SHA), (LATER_NOTES_DATE, LATER_NOTES_SHA)):
                    want = dated_line(date, sha)
                    n = text.count(want)
                    if n != 1:
                        return f"B-05 {view}: the dated line for the artifact at {sha[:8]} appears {n} times"
                    if text.find(want) > first_prose:
                        return f"B-05 {view}: the dated line for the artifact at {sha[:8]} comes after the prose"
                for date in (NOTES_DATE, LATER_NOTES_DATE):
                    if f"written on {date}" not in text.lower():
                        return f"B-05 {view}: the provenance lacks `written on {date}`"
            return None

        check("each survey artifact under an account has its own dated line", dated_per_artifact)

        # -- 3. no account: no dated line --------------------------------------
        def none_without_account() -> str | None:
            if (why := published()):
                return why
            for view, texts in views.items():
                for sid in ("B-02", "B-03"):
                    text = squash(texts[sid])
                    if "The account above was recorded" in text or "as the survey's working" in text:
                        return f"{sid} {view}: a subsystem with no account carries the dated line"
            return None

        check("a subsystem with no account has no dated line", none_without_account)

        # -- 4. every placement carries the artifact's date ---------------------
        def provenance_dated() -> str | None:
            if (why := published()):
                return why
            want = f"recorded at `{NOTES_SHA[:12]}`, written on {NOTES_DATE}"
            for sid, text in (("B-02", md["B-02"]), ("B-03", md["B-03"]), ("B-04", md["B-04"])):
                if want not in text:
                    return f"{sid} Markdown: the narrative's provenance lacks `{want}`"
            for sid in ("B-01", "B-02", "B-03", "B-04"):
                if f"written on {NOTES_DATE}" not in squash(html[sid]).lower():
                    return f"{sid} HTML: the provenance lacks `written on {NOTES_DATE}`"
            structure = section(md["B-02"], "Structure")
            if f"written on {NOTES_DATE}" not in structure:
                return "B-02: the narrative inside Structure carries no `written on` date"
            structure = section(md["B-03"], "Structure")
            if f"written on {NOTES_DATE}" not in structure:
                return "B-03: the fallback narrative carries no `written on` date"
            structure = section(md["B-04"], "Structure")
            if f"written on {NOTES_DATE}" not in structure:
                return "B-04: the pointer to the recorded account carries no `written on` date"
            if f"written on {ACCOUNT_DATE}" in md["B-02"] + md["B-03"]:
                return "a narrative's provenance names the account's date as its own"
            return None

        check("every placement's provenance says when the notes were written", provenance_dated)

        # -- 5. the artifact files are untouched -----------------------------
        def files_unchanged() -> str | None:
            if (why := published()):
                return why
            for name, data in before.items():
                after = (storage / name).read_bytes() if (storage / name).is_file() else None
                if after != data:
                    return f"{name} was modified by the publish"
            if not before:
                return "no artifact file was seeded"
            return None

        check("no artifact file is modified", files_unchanged)
    finally:
        shutil.rmtree(root, ignore_errors=True)

    # -- CI ------------------------------------------------------------------
    def runs_in_ci() -> str | None:
        text = read(CI_FILE)
        if not text:
            return "the CI workflow .github/workflows/test.yml is not readable"
        if not re.search(r"python3 test-orientation-survey-notes\.py", text):
            return "the workflow does not run test-orientation-survey-notes.py"
        return None

    check("the gate runs in CI", runs_in_ci)

    emit("")
    if FAILURES:
        emit(f"GATE {PACKET} RED: {FAILURES[0].split(': ', 1)[1]}")
        return 1
    emit(f"GATE {PACKET} GREEN")
    return 0


def read_html_raw(docs: Path, sid: str) -> str:
    return pages(docs, sid, "html")


if __name__ == "__main__":
    sys.exit(main())
