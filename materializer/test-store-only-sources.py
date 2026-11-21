#!/usr/bin/env python3
"""Gate for store-only packet SO8 — the materializer reads the store, not files
(design/store-only/PLAN.md §3.3, §3.4, §5.4, §8 SO8).

Three stores are seeded and published, each by a driver that audits every file
the materializer opens:

  A  records and files   A store holding records (a recorded purpose, a project
                         name, runtime boundaries, an imported survey body) beside
                         storage files that carry different sentinels: an entry
                         point, an onboarding report, a concern checklist, a
                         survey file and a stray note, each registered in
                         `artifacts`.
  B  import only         The shape an import leaves: imported bodies, an imported
                         purpose, name and runtime rows, and *no file at all* in
                         storage. Five subsystems cover the placements: structure
                         narrative, inventory fallback, survey record, a withdrawn
                         import, and none.
  C  binding name        No profile, purpose, runtime row or import, beside storage
                         files that could fill each; `initialization.json` names the
                         project.

Turns red when:

  - any page, Markdown or HTML, in store A carries a sentinel that only a storage
    file holds, or lacks the one its record holds (thesis, project name, runtime
    rows, imported survey body);
  - the materializer opens any file under storage other than the database files
    (`memory.db` and its journals) and the three binding files
    (`workspace_path`, `initialization.json`, `project_identity`); the open is
    audited, so an attempt on an absent file is caught too;
  - the manifest of any store has a `prose:` source key, or a page the old
    passthroughs produced has a source that is not `db:`;
  - store B loses its thesis from the overview, its runtime table or diagram from
    the architecture page, its survey narrative from any of the three placements
    (inside Structure, standing in for claims, in the survey record), or any of
    Onboarding record, Review checklist or Where to begin;
  - an imported body is printed without the label "As written at <date>, revision
    <sha8>; kept as written, not tied to evidence", naming the date and revision
    its row carries, or one whose bytes differ from the registered hash is printed
    without saying it was edited after it was registered;
  - a withdrawn import renders, or a withdrawal appended before a second,
    incremental publish leaves the body on its page;
  - the master plan, which is held and never rendered, appears on any page;
  - a runtime edge withdrawn by a later row renders, or a superseded row's notes do;
  - store C does not name the project from its binding, or prints text from a
    storage file in a slot its store leaves empty;
  - the publish or its read-back is not green in any store;
  - the gate does not run in CI.

False green it cannot exclude: every sentinel is a word this gate chose, so a
renderer that opens no file and prints a store's text mangled still passes the
absence checks; the presence checks quote the stored prose and its label, and
nothing here judges how an imported body reads on the page.

Output protocol: exactly one status line, last, on stdout. Every subprocess is
captured and never echoed, and every message is scrubbed, so a missing
deliverable reports as an assertion failure and not as a crash.
"""

from __future__ import annotations

import hashlib
import html as htmllib
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
CI_FILE = REPO / ".github" / "workflows" / "test.yml"

PACKET = "SO8"

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
# What the plan fixes, written out here so that rewriting an implementation
# constant cannot rewrite what this gate expects.
# ---------------------------------------------------------------------------
HEAD = "cccccccccccc3333cccccccccccc3333cccccccc"
WRITTEN_SHA = "aaaaaaaa11111111aaaaaaaa11111111aaaaaaaa"
ACCOUNT_SHA = "bbbbbbbb22222222bbbbbbbb22222222bbbbbbbb"
EDITED_SHA = "eeeeeeee55555555eeeeeeee55555555eeeeeeee"
REGISTERED_HASH = "0123456789abcdef0123456789abcdef"
WRITTEN = "2026-10-02 09:30:00"
EDITED_WRITTEN = "2026-11-04 08:15:00"
ACCOUNT_RECORDED = "2026-11-10 14:05:00"

ACCOUNT_BODY = (
    "The queue hands each request to the writer and waits for the writer to answer."
)

FILE_MARKER = re.compile(r"FILE[A-Z]*MARKER")
EDITED_SENTENCE = "edited after it was registered"

BINDING_FILES = {"workspace_path", "initialization.json", "project_identity"}
DATABASE_FILES = {"memory.db", "memory.db-wal", "memory.db-shm", "memory.db-journal"}


def label_for(date: str, sha: str) -> str:
    return f"As written at {date[:10]}, revision {sha[:8]}; kept as written, not tied to evidence"


# ---------------------------------------------------------------------------
# Seeding
# ---------------------------------------------------------------------------
def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def new_store(root: Path, name: str) -> tuple[Path, sqlite3.Connection]:
    storage = root / name / "storage"
    storage.mkdir(parents=True)
    db = sqlite3.connect(storage / "memory.db")
    db.executescript(SCHEMA.read_text())
    db.execute(
        "INSERT INTO git_state (repo_id, canonical_branch, onboarding_sha,"
        " last_checked_sha, last_checked_at)"
        " VALUES ('default', 'main', ?, ?, '2026-11-12T12:00:00Z')",
        (HEAD, HEAD),
    )
    db.execute("INSERT INTO sessions (session_id, intent) VALUES ('so8', 'fixture')")
    return storage, db


def add_subsystem(db: sqlite3.Connection, sid: str, name: str, *, claims: bool = False) -> None:
    db.execute(
        "INSERT INTO subsystems (id, name, status, layer) VALUES (?, ?, 'mapped', 'backend')",
        (sid, name),
    )
    if claims:
        for n, segment in enumerate(("recoverability", "trust")):
            db.execute(
                "INSERT INTO claims (claim_id, claim_key, subject_type, subject_id,"
                " statement, epistemic_kind, asserted_at_sha, valid_from_sha, session_id)"
                " VALUES (?, ?, 'subsystem', ?, ?, 'observation', ?, ?, 'so8')",
                (f"{sid}-c{n}", f"{sid}/{segment}/x", sid, f"STATEMENT {sid} {segment}", HEAD, HEAD),
            )


def add_import(
    db: sqlite3.Connection,
    path: str,
    kind: str,
    body: str,
    *,
    subsystem_id: str | None = None,
    sha: str = WRITTEN_SHA,
    written: str = WRITTEN,
    hash_matches: int = 1,
) -> None:
    db.execute(
        "INSERT INTO imported_artifacts (path, kind, subsystem_id, body, body_sha256,"
        " registered_hash, hash_matches, registered_ref_sha, written_at, session_id)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'so8')",
        (path, kind, subsystem_id, body, sha256(body), REGISTERED_HASH, hash_matches, sha, written),
    )


def withdraw_import(db: sqlite3.Connection, path: str) -> None:
    db.execute(
        "INSERT INTO imported_artifact_withdrawals (path, reason, session_id)"
        " VALUES (?, 'the subsystem was surveyed again', 'so8')",
        (path,),
    )


def add_purpose(db: sqlite3.Connection, body: str, disposition: str) -> None:
    db.execute(
        "INSERT INTO explanations (subject_type, subject_id, slot, disposition, body,"
        " ref_sha, session_id) VALUES ('project', 'project', 'purpose', ?, ?, ?, 'so8')",
        (disposition, body, HEAD),
    )


def add_profile(db: sqlite3.Connection, name: str) -> None:
    db.execute(
        "INSERT INTO project_profile (name, ref_sha, session_id) VALUES (?, ?, 'so8')",
        (name, HEAD),
    )


def add_runtime(
    db: sqlite3.Connection,
    source: str,
    language: str | None,
    peer: str,
    mechanism: str,
    notes: str | None,
    *,
    origin: str = "recorded",
    withdrawn: int = 0,
) -> None:
    db.execute(
        "INSERT INTO runtime_boundaries (from_runtime, from_language, to_runtime, mechanism,"
        " notes, origin, withdrawn, ref_sha, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'so8')",
        (source, language, peer, mechanism, notes, origin, withdrawn, HEAD),
    )


def register_file(db: sqlite3.Connection, storage: Path, path: str, kind: str, text: str) -> None:
    (storage / path).write_text(text)
    db.execute(
        "INSERT INTO artifacts (path, kind, subsystem_id, content_hash, ref_sha, session_id,"
        " written_at) VALUES (?, ?, ?, ?, ?, 'so8', ?)",
        (path, kind, "B-01" if kind == "subsystem-survey" else None, REGISTERED_HASH, WRITTEN_SHA, WRITTEN),
    )


# ---------------------------------------------------------------------------
# Store A: records beside files that say something else
# ---------------------------------------------------------------------------
RECORDED_THESIS = "RECORDEDTHESISMARKER is a service that answers reads from a cache."
PROFILE_NAME = "ProfileName"
RECORDED_SURVEY = "IMPORTEDSURVEYAMARKER the read path serves each request from the cache"

FILE_ENTRY = (
    "# Where to begin\n\n## What is this codebase?\n\nFILETHESISMARKER is a toolkit.\n"
)
FILE_ONBOARDING = (
    "# Onboarding\n\n**Codebase**: FILENAMEMARKER — a fixture\n\n## Runtime boundary map\n\n"
    "| Runtime / Process | Language | Communicates with | Mechanism | Notes |\n"
    "|---|---|---|---|---|\n"
    "| FILERUNTIMEMARKER | Go | FILEPEERMARKER | pipe | FILENOTEMARKER |\n"
)
FILE_CHECKLIST = "# Checklist\n\n## Active concerns\n\nFILECHECKLISTMARKER is listed here.\n"
FILE_SURVEY = "# B-01 survey\n\nFILESURVEYMARKER the read path drains the queue.\n"
FILE_NOTE = "A stray note. FILEOTHERMARKER\n"


def seed_a(root: Path) -> Path:
    storage, db = new_store(root, "a")
    add_subsystem(db, "B-01", "Read path")
    add_purpose(db, RECORDED_THESIS, "recorded")
    add_profile(db, PROFILE_NAME)
    add_runtime(db, "RecordedRuntimeAlpha", "Rust", "RecordedPeerBeta", "unix socket", "RECORDEDNOTE")
    add_runtime(db, "SupersededRuntimeAlpha", "Rust", "SupersededPeerBeta", "http", "OLDNOTESMARKER")
    add_runtime(db, "SupersededRuntimeAlpha", "Rust", "SupersededPeerBeta", "http", "NEWNOTESMARKER")
    add_runtime(db, "WithdrawnRuntimeGamma", "Go", "WithdrawnPeerDelta", "pipe", "WITHDRAWNNOTEMARKER")
    add_runtime(db, "WithdrawnRuntimeGamma", "Go", "WithdrawnPeerDelta", "pipe", "WITHDRAWNNOTEMARKER", withdrawn=1)
    add_import(db, "B-01-survey.md", "subsystem-survey", f"# B-01 survey\n\n{RECORDED_SURVEY}\n", subsystem_id="B-01")
    register_file(db, storage, "entry-point.md", "entry-point", FILE_ENTRY)
    register_file(db, storage, "onboarding-report.md", "onboarding-report", FILE_ONBOARDING)
    register_file(db, storage, "concern-checklist.md", "concern-checklist", FILE_CHECKLIST)
    register_file(db, storage, "B-01-survey.md", "subsystem-survey", FILE_SURVEY)
    (storage / "notes.md").write_text(FILE_NOTE)
    (storage / "subsystems").mkdir()
    (storage / "subsystems" / "B-01-structural.md").write_text("FILESURVEYMARKER again\n")
    db.commit()
    db.close()
    return storage


# ---------------------------------------------------------------------------
# Store B: what an import leaves
# ---------------------------------------------------------------------------
IMPORTED_THESIS = "IMPORTEDTHESISMARKER is a service that answers reads from a cache."
IMPORTED_NAME = "ImportedName"

ENTRY_BODY = (
    "# Where to begin\n\n## What is this codebase?\n\nIMPORTEDTHESISMARKER is a service.\n\n"
    "## Reading order\n\nIMPORTEDENTRYMARKER start at the reader.\n"
)
ONBOARDING_BODY = (
    f"# Onboarding\n\n**Codebase**: {IMPORTED_NAME} — a fixture\n\nIMPORTEDONBOARDINGMARKER one repository.\n\n"
    "## Runtime boundary map\n\n"
    "| Runtime / Process | Language | Communicates with | Mechanism | Notes |\n"
    "|---|---|---|---|---|\n"
    "| ImportedRuntimeAlpha | Go | ImportedPeerBeta | pipe | IMPORTEDRUNTIMENOTE |\n"
)
CHECKLIST_BODY = "# Checklist\n\n## Active concerns\n\nIMPORTEDCHECKLISTMARKER is listed here.\n"
MASTER_PLAN_BODY = "# Master plan\n\nMASTERPLANMARKER the plan is held and never printed.\n"

SURVEY_BODY = "# {sid} survey\n\nIMPORTEDSURVEY{tag}MARKER the scheduler drains one queue per tick\n\n## Details\n\nA second paragraph.\n"
SURVEY_TAGS = {"B-01": "ONE", "B-02": "TWO", "B-03": "THREE", "B-04": "FOUR"}


def survey_marker(sid: str) -> str:
    return f"IMPORTEDSURVEY{SURVEY_TAGS[sid]}MARKER"


def seed_b(root: Path) -> Path:
    storage, db = new_store(root, "b")
    add_subsystem(db, "B-01", "Read path", claims=True)
    add_subsystem(db, "B-02", "Write path")
    add_subsystem(db, "B-03", "Queue", claims=True)
    add_subsystem(db, "B-04", "Cache")
    add_subsystem(db, "B-05", "Index")
    db.execute(
        "INSERT INTO explanations (subject_type, subject_id, slot, disposition, body,"
        " ref_sha, session_id, recorded_at)"
        " VALUES ('subsystem', 'B-03', 'account', 'recorded', ?, ?, 'so8', ?)",
        (ACCOUNT_BODY, ACCOUNT_SHA, ACCOUNT_RECORDED),
    )
    add_purpose(db, IMPORTED_THESIS, "imported")
    add_profile(db, IMPORTED_NAME)
    add_runtime(db, "ImportedRuntimeAlpha", "Go", "ImportedPeerBeta", "pipe", "IMPORTEDRUNTIMENOTE", origin="imported")
    add_import(db, "entry-point.md", "entry-point", ENTRY_BODY, sha=EDITED_SHA, written=EDITED_WRITTEN, hash_matches=0)
    add_import(db, "onboarding-report.md", "onboarding-report", ONBOARDING_BODY)
    add_import(db, "concern-checklist.md", "concern-checklist", CHECKLIST_BODY)
    add_import(db, "master-plan.md", "master-plan", MASTER_PLAN_BODY)
    for sid, tag in SURVEY_TAGS.items():
        add_import(
            db,
            f"{sid}-structural.md",
            "subsystem-survey",
            SURVEY_BODY.format(sid=sid, tag=tag),
            subsystem_id=sid,
        )
    withdraw_import(db, "B-04-structural.md")
    db.commit()
    db.close()
    return storage


# ---------------------------------------------------------------------------
# Store C: the name comes from the binding
# ---------------------------------------------------------------------------
def seed_c(root: Path) -> Path:
    storage, db = new_store(root, "c")
    add_subsystem(db, "B-01", "Read path")
    # No purpose, no profile, no runtime row and no import: every slot a file
    # could fill is empty, and the files that could fill them are all there.
    register_file(db, storage, "entry-point.md", "entry-point", FILE_ENTRY)
    register_file(db, storage, "onboarding-report.md", "onboarding-report", FILE_ONBOARDING)
    register_file(db, storage, "concern-checklist.md", "concern-checklist", FILE_CHECKLIST)
    register_file(db, storage, "B-01-survey.md", "subsystem-survey", FILE_SURVEY)
    db.commit()
    db.close()
    (storage / "initialization.json").write_text(
        json.dumps(
            {
                "projectIdentity": "remote:github.com/acme/bindrepo",
                "projectKey": "github.com/acme/bindrepo",
            }
        )
    )
    return storage


# ---------------------------------------------------------------------------
# Publishing under an audit of every open
# ---------------------------------------------------------------------------
DRIVER = """
import runpy, sys
log, root, script = sys.argv[1], sys.argv[2], sys.argv[3]
sys.argv = [script, *sys.argv[4:]]
sys.path.insert(0, root)
opened = open(log, "a", buffering=1)
def hook(event, args):
    if event == "open" and args and isinstance(args[0], (str, bytes)):
        name = args[0].decode("utf-8", "replace") if isinstance(args[0], bytes) else args[0]
        opened.write(name + "\\n")
sys.addaudithook(hook)
runpy.run_path(script, run_name="__main__")
"""


def publish(storage: Path, log: Path, *args: str) -> dict[str, object]:
    proc = subprocess.run(
        [
            sys.executable,
            "-c",
            DRIVER,
            str(log),
            str(ROOT),
            str(ROOT / "materialize.py"),
            "--storage",
            str(storage),
            *args,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    lines = [line for line in proc.stdout.splitlines() if line.strip()]
    summary: dict[str, object] = {}
    if lines:
        try:
            summary = json.loads(lines[-1])
        except json.JSONDecodeError:
            summary = {}
    summary["_returncode"] = proc.returncode
    if not summary.get("html_entrypoint"):
        summary["_diagnostic"] = scrub(proc.stderr)[-400:]
    return summary


def opened_under_storage(storage: Path, log: Path) -> list[str]:
    """Every audited open of a path under storage that is neither allowed nor the output."""

    root = str(storage.resolve())
    docs = str((storage / "docs").resolve())
    stray: list[str] = []
    seen: set[str] = set()
    for name in log.read_text().splitlines() if log.is_file() else []:
        try:
            resolved = str(Path(name).resolve())
        except OSError:
            continue
        if not (resolved == root or resolved.startswith(root + "/")):
            continue
        if resolved == docs or resolved.startswith(docs + "/"):
            continue
        relative = resolved[len(root) + 1 :]
        if relative in BINDING_FILES or relative in DATABASE_FILES:
            continue
        if relative not in seen:
            seen.add(relative)
            stray.append(relative)
    return stray


def read(path: Path) -> str:
    try:
        return path.read_text()
    except OSError:
        return ""


def html_text(markup: str) -> str:
    body = re.sub(r"(?is)<(script|style)\b.*?</\1>", "", markup)
    body = re.sub(r"(?i)</?(p|li|h[1-6]|div|section|tr|br|ul|ol|table|pre)\b[^>]*>", "\n", body)
    body = re.sub(r"<[^>]+>", "", body)
    return " ".join(htmllib.unescape(body).split())


def squash(text: str) -> str:
    return " ".join(text.split())


def page_pair(docs: Path, stem: str) -> dict[str, str]:
    """A page as Markdown (squashed) and as the reader's HTML text."""

    return {
        "md": squash(read(docs / f"{stem}.md")),
        "html": html_text(read(docs / f"{stem}.html")),
    }


def subsystem_page(docs: Path, sid: str) -> dict[str, str]:
    stem = sid.lower().replace("-", "")
    md = sorted((docs / "subsystems").glob(f"{stem}-*.md"))
    page = {"md": "", "html": ""}
    if md:
        page["md"] = squash(read(md[0]))
        page["html"] = html_text(read(md[0].with_suffix(".html")))
    return page


def md_section(text: str, heading: str, level: int) -> str:
    """The Markdown section opened by `heading`, from the unsquashed page text."""

    marker = "#" * level + " "
    body: list[str] = []
    inside = False
    for line in text.splitlines():
        if line.startswith(marker + heading):
            inside = True
            continue
        if inside and re.match(rf"^#{{1,{level}}} ", line):
            break
        if inside:
            body.append(line)
    return "\n".join(body)


def all_pages(docs: Path) -> dict[str, str]:
    pages: dict[str, str] = {}
    for path in sorted(docs.rglob("*")):
        if path.suffix in {".md", ".html"} and path.is_file():
            pages[str(path.relative_to(docs))] = read(path)
    return pages


def manifest_of(docs: Path) -> dict[str, object]:
    try:
        return json.loads(read(docs / ".manifest.json"))
    except json.JSONDecodeError:
        return {}


# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------
def main() -> int:
    work = Path(tempfile.mkdtemp(prefix="so8-"))
    try:
        return run(work)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def run(work: Path) -> int:
    if not SCHEMA.is_file():
        return finish("the schema is absent")

    # ---- Store A -----------------------------------------------------------
    a = seed_a(work)
    log_a = work / "a-opened.log"
    result_a = publish(a, log_a)
    docs_a = a / "docs"
    pages_a = all_pages(docs_a)
    emit(f"store A published: {len(pages_a)} files")

    def a_published() -> str | None:
        if result_a.get("ok") is not True:
            return f"the publish was not green: {result_a}"
        if not pages_a:
            return "nothing was published"
        return None

    check("store A publishes green", a_published)

    def a_no_file_sentinel() -> str | None:
        hits = {
            name: sorted(set(FILE_MARKER.findall(text)))
            for name, text in pages_a.items()
            if FILE_MARKER.search(text)
        }
        if hits:
            return f"a storage file's text reached the published pages: {hits}"
        return None

    check("no storage file's text reaches a page", a_no_file_sentinel)

    def a_records() -> str | None:
        index = page_pair(docs_a, "index")
        architecture = page_pair(docs_a, "architecture")
        survey = subsystem_page(docs_a, "B-01")
        for view in ("md", "html"):
            for label, page, want in (
                ("the recorded purpose", index, "RECORDEDTHESISMARKER"),
                ("a recorded runtime", architecture, "RecordedRuntimeAlpha"),
                ("its peer", architecture, "RecordedPeerBeta"),
                ("its mechanism", architecture, "unix socket"),
                ("its note", architecture, "RECORDEDNOTE"),
                ("the newest row of an edge", architecture, "NEWNOTESMARKER"),
                ("the imported survey body", survey, "IMPORTEDSURVEYAMARKER"),
            ):
                if want not in page[view]:
                    return f"{label} ({want}) is missing from the {view} view"
        if PROFILE_NAME not in index["html"]:
            return "the profile's project name is missing from the overview's HTML"
        return None

    check("records reach their pages in both views", a_records)

    def a_edges() -> str | None:
        architecture = page_pair(docs_a, "architecture")
        for view in ("md", "html"):
            for gone in ("OLDNOTESMARKER", "WithdrawnRuntimeGamma", "WITHDRAWNNOTEMARKER"):
                if gone in architecture[view]:
                    return f"{gone} is printed in the {view} view of the runtime map"
        return None

    check("a superseded or withdrawn runtime edge is not printed", a_edges)

    def a_table_shape() -> str | None:
        text = read(docs_a / "architecture.md")
        header = "| Runtime / Process | Language | Communicates with | Mechanism | Notes |"
        if header not in text:
            return "the runtime map is not the five-column table the page draws from"
        rows = [line for line in text.splitlines() if "Runtime" in line and "Alpha" in line]
        if not any("RecordedRuntimeAlpha" in line and "Rust" in line and "unix socket" in line for line in rows):
            return f"the recorded edge's row does not carry its runtime, language and mechanism: {rows}"
        return None

    check("the runtime map keeps its five columns", a_table_shape)

    def a_opens() -> str | None:
        stray = opened_under_storage(a, log_a)
        if stray:
            return f"files under storage were opened: {stray}"
        return None

    check("store A opens only the database and binding files", a_opens)

    # ---- Store B -----------------------------------------------------------
    b = seed_b(work)
    log_b = work / "b-opened.log"
    result_b = publish(b, log_b)
    docs_b = b / "docs"
    pages_b = all_pages(docs_b)
    emit(f"store B published: {len(pages_b)} files")

    def b_published() -> str | None:
        if result_b.get("ok") is not True:
            return f"the publish was not green: {result_b}"
        readback = result_b.get("readback")
        if not isinstance(readback, dict) or readback.get("ok") is not True:
            return f"the read-back was not green: {readback}"
        return None

    check("store B publishes green with a green read-back", b_published)

    def b_opens() -> str | None:
        stray = opened_under_storage(b, log_b)
        if stray:
            return f"the materializer reached for files under storage: {stray}"
        return None

    check("store B (no file in storage) is read without reaching for one", b_opens)

    def b_overview() -> str | None:
        index = page_pair(docs_b, "index")
        for view in ("md", "html"):
            if "IMPORTEDTHESISMARKER" not in index[view]:
                return f"the imported thesis is missing from the {view} overview"
        if IMPORTED_NAME not in index["html"]:
            return "the imported project name is missing from the overview's HTML"
        return None

    check("the import-only overview keeps its thesis and name", b_overview)

    def b_architecture() -> str | None:
        text = read(docs_b / "architecture.md")
        if "| ImportedRuntimeAlpha | Go | ImportedPeerBeta | pipe | IMPORTEDRUNTIMENOTE |" not in text:
            return "the imported runtime row is not in the architecture table"
        markup = read(docs_b / "architecture.html")
        if "<svg" not in markup or "ImportedRuntimeAlpha" not in markup.split("<svg", 1)[1]:
            return "the runtime diagram was not drawn from the imported row"
        return None

    check("the import-only architecture keeps its runtime table and diagram", b_architecture)

    def placement(sid: str, heading: str, level: int) -> str | None:
        page = subsystem_page(docs_b, sid)
        marker = survey_marker(sid)
        md_text = read(next(iter(sorted((docs_b / "subsystems").glob(f"{sid.lower().replace('-', '')}-*.md"))), docs_b / "x"))
        for view in ("md", "html"):
            if page[view].count(marker) != 1:
                return f"{marker} is on the {view} page {page[view].count(marker)} times, wanted once"
        if marker not in md_section(md_text, heading, level):
            return f"{marker} is not under the '{heading}' heading"
        return None

    check(
        "an import renders inside Structure beside claims (structure narrative)",
        lambda: placement("B-01", "Survey narrative", 3),
    )
    check(
        "an import stands in for absent claims (inventory fallback)",
        lambda: placement("B-02", "Structural inventory not recorded as claims", 3),
    )
    check(
        "an import renders in the survey record under an account",
        lambda: placement("B-03", "Survey artifact", 3),
    )

    def b_withdrawn() -> str | None:
        page = subsystem_page(docs_b, "B-04")
        for view in ("md", "html"):
            if survey_marker("B-04") in page[view]:
                return f"a withdrawn import renders in the {view} view"
        if not page["md"]:
            return "the page of the subsystem with a withdrawn import was not published"
        return None

    check("a withdrawn import does not render", b_withdrawn)

    def b_label() -> str | None:
        for sid in ("B-01", "B-02", "B-03"):
            page = subsystem_page(docs_b, sid)
            wanted = label_for(WRITTEN, WRITTEN_SHA)
            for view in ("md", "html"):
                if wanted not in page[view].replace("`", ""):
                    return f"{sid}'s {view} page lacks the label '{wanted}'"
        return None

    check("an imported survey body carries its as-written label, date and revision", b_label)

    def b_pages() -> str | None:
        for stem, marker, date, sha in (
            ("onboarding-report", "IMPORTEDONBOARDINGMARKER", WRITTEN, WRITTEN_SHA),
            ("entry-point", "IMPORTEDENTRYMARKER", EDITED_WRITTEN, EDITED_SHA),
            ("concern-checklist", "IMPORTEDCHECKLISTMARKER", WRITTEN, WRITTEN_SHA),
        ):
            page = page_pair(docs_b, stem)
            for view in ("md", "html"):
                if marker not in page[view]:
                    return f"{stem} is missing its imported body ({marker}) in the {view} view"
                if page[view].count(marker) != 1:
                    return f"{stem} prints {marker} more than once in the {view} view"
                if label_for(date, sha) not in page[view].replace("`", ""):
                    return f"{stem}'s {view} view lacks the label '{label_for(date, sha)}'"
        return None

    check("Onboarding record, Where to begin and Review checklist render from imports", b_pages)

    def b_edited() -> str | None:
        entry = page_pair(docs_b, "entry-point")
        other = page_pair(docs_b, "onboarding-report")
        for view in ("md", "html"):
            if EDITED_SENTENCE not in entry[view]:
                return f"an import whose bytes differ from its registered hash lacks '{EDITED_SENTENCE}' in the {view} view"
            if EDITED_SENTENCE in other[view]:
                return f"an import whose bytes match its registered hash says '{EDITED_SENTENCE}' in the {view} view"
        return None

    check("an edited import says so and a matching one does not", b_edited)

    def b_held() -> str | None:
        for name, text in pages_b.items():
            if "MASTERPLANMARKER" in text:
                return f"the held master plan is printed on {name}"
        return None

    check("the held master plan is printed nowhere", b_held)

    manifest_b = manifest_of(docs_b)

    def manifests() -> str | None:
        for label, manifest in (("A", manifest_of(docs_a)), ("B", manifest_b)):
            pages = manifest.get("pages")
            if not isinstance(pages, list) or not pages:
                return f"store {label} wrote no page entries in its manifest"
            for entry in pages:
                for key in entry.get("sources", {}):
                    if str(key).startswith("prose:"):
                        return f"store {label}'s manifest page {entry.get('path')} has the source {key}"
        wanted = {"index.md", "architecture.md", "onboarding-report.md", "entry-point.md", "concern-checklist.md"}
        by_path = {entry["path"]: entry for entry in manifest_b["pages"]}  # type: ignore[index]
        for path in sorted(wanted):
            entry = by_path.get(path)
            if entry is None:
                return f"store B's manifest has no entry for {path}"
            sources = entry.get("sources", {})
            if not sources or any(not str(key).startswith("db:") for key in sources):
                return f"{path}'s sources are not all db: {sorted(sources)}"
        return None

    check("no manifest source is prose:, and the passthrough pages' are db:", manifests)

    # An incremental publish after a withdrawal must notice it.
    db = sqlite3.connect(b / "memory.db")
    withdraw_import(db, "B-02-structural.md")
    db.commit()
    db.close()
    result_b2 = publish(b, log_b)
    docs_b2 = b / "docs"

    def b_incremental() -> str | None:
        if result_b2.get("ok") is not True:
            return f"the second publish was not green: {result_b2}"
        page = subsystem_page(docs_b2, "B-02")
        for view in ("md", "html"):
            if survey_marker("B-02") in page[view]:
                return f"a withdrawal appended before an incremental publish left the body in the {view} view"
        if survey_marker("B-01") not in subsystem_page(docs_b2, "B-01")["md"]:
            return "the incremental publish dropped a body that was not withdrawn"
        return None

    check("a withdrawal reaches the page on an incremental publish", b_incremental)

    # ---- Store C -----------------------------------------------------------
    c = seed_c(work)
    log_c = work / "c-opened.log"
    result_c = publish(c, log_c)

    def c_name() -> str | None:
        if result_c.get("ok") is not True:
            return f"the publish was not green: {result_c}"
        index = page_pair(c / "docs", "index")
        if "bindrepo" not in index["html"]:
            return "the project is not named from its binding when no profile is recorded"
        for name, text in all_pages(c / "docs").items():
            if FILE_MARKER.search(text):
                return f"a storage file filled a slot the store leaves empty, on {name}"
        if "No thesis section is recorded" not in index["md"]:
            return "with no purpose recorded the overview does not say so"
        if "No structured runtime boundary map is recorded yet" not in page_pair(c / "docs", "architecture")["md"]:
            return "with no runtime boundary recorded the architecture page does not say so"
        stray = opened_under_storage(c, log_c)
        if stray:
            return f"files under storage were opened: {stray}"
        return None

    check("with no profile the name comes from the binding", c_name)

    # ---- CI ----------------------------------------------------------------
    def in_ci() -> str | None:
        text = read(CI_FILE)
        if "test-store-only-sources.py" not in text:
            return "test-store-only-sources.py is not a step in .github/workflows/test.yml"
        return None

    check("the gate runs in CI", in_ci)

    return finish()


def finish(reason: str | None = None) -> int:
    if reason:
        FAILURES.append(reason)
    if FAILURES:
        emit(f"GATE {PACKET} RED: {scrub(FAILURES[0])[:300]}")
        return 1
    emit(f"GATE {PACKET} GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
