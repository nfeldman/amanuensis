#!/usr/bin/env python3
"""Gate for store-only packet SO9 — new records on pages, censused by the read-back
(design/store-only/PLAN.md §2.1, §2.2, §8 SO9).

Two stores are seeded in a temporary directory, with a git repository their
evidence cites, and published:

  A  records and an import   Narratives on subsystems and on the project, concern
                             territory and probe, territory dispositions and
                             runtime boundaries, beside an imported entry point.
  B  records only            The same project records and no import at all.

Turns red when:

  - a recorded narrative is missing from its HTML page: a structure narrative from its subsystem's Structure section, a
    concern-reasoning narrative from its Concern review, a challenge narrative
    from its Challenge section, a project narrative from Onboarding record or
    Where to begin;
  - a narrative's topic is not a subheading, or its date and revision are not
    printed beside it, or the files it cites changed since its revision and the
    page does not say so, or they did not change and the page says they did;
  - a superseded narrative, a withdrawn one or a withdrawn runtime edge renders,
    or a declined narrative's reason does not;
  - a concern's territory or probe, or a territory disposition (with the
    condition of a disqualified one), is missing from Review checklist; a
    superseded disposition renders;
  - a recorded runtime boundary is missing from the architecture page or from its
    drawing, or an imported row is not labelled as imported;
  - Onboarding record, Review checklist or Where to begin is not published in a
    store that holds records and no import, or the imported entry point is not
    still printed, labelled "As written", beside the records;
  - the read-back stays green after a narrative's text, a territory disposition's
    condition or a runtime boundary's mechanism is altered on a page, with
    `.projection-contract.json` resealed over the edited bytes (so
    the hash check cannot be what turns it red), or is not green before the edit;
  - the gate does not run in CI.

Since SO13 the publication is HTML only (PLAN §3.2 step 3), so every check
reads the HTML page; before it each ran on the Markdown page as well.

False green it cannot exclude: every sentinel is a word this gate chose, so a
renderer that prints the stored prose mangled but keeps the sentinels passes the
presence checks; the read-back sabotage alters one word of each kind of record.

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

PACKET = "SO9"

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
# What the plan fixes, written out here rather than imported.
# ---------------------------------------------------------------------------
READER = "src/reader.py"
WRITER = "src/writer.py"
OTHER = "src/other.py"

NARRATIVE_RECORDED = "2026-11-10 14:05:00"
NARRATIVE_DATE = "2026-11-10"

# Narratives. Each body is a sentinel the page must carry; the words avoid the
# survey-status vocabulary the orientation lint withholds.
FLOW_NEW = "NARRFLOWALPHA the read path hands a caller one committed snapshot of the rows."
FLOW_OLD = "NARRFLOWSUPERSEDED the read path used to lock the whole table."
LIFE_BODY = "NARRLIFEBETA a snapshot lives until its last reader lets go."
SOLO_BODY = "NARRSOLOGAMMA the writer applies one batch and then answers."
REASONING_BODY = "NARRREASONDELTA the cache concern applies because two readers share one slot."
CHALLENGE_BODY = "NARRCHALLENGEEPSILON an attempt to starve a reader left the snapshot intact."
WITHDRAWN_BODY = "NARRWITHDRAWNZETA this reading was retracted."
DECLINED_REASON = "NARRDECLINEDETA the queue is too small to need a structure narrative."

PROJECT_BODIES = {
    "repository-shape": "NARRSHAPETHETA the repository is one service and two command-line tools.",
    "runtime": "NARRRUNTIMEIOTA the service calls the store over a unix socket.",
    "stateful-entities": "NARRSTATEKAPPA the store keeps a snapshot registry between calls.",
    "concern-calibration": "NARRCALIBLAMBDA shared-state concerns apply and the network ones do not.",
    "survey-plan": "NARRPLANMU begin with the read path and then the write path.",
    "start-here": "NARRSTARTNU read the reader first and the writer second.",
}
PROJECT_OLD = "NARRSHAPESUPERSEDED the repository was one program."

TOPICS = {
    "flow": "Request flow",
    "life": "Snapshot lifetime",
    "reasoning": "Cache reasoning",
    "challenge": "Starvation attempt",
    "declined": "Queue structure",
    "solo": "Write batching",
}

# Concerns and territories.
PROBE = "PROBEXI check that two readers never share one slot unlocked"
# Territories are named by the ids `record_territory_disposition` accepts (T1 to
# T11); the page owes each id its name from concern-territories.md (F6/codex).
TERRITORY = "T8"
DISQUALIFIED = "T5"
DISQUALIFIED_CONDITION = "CONDITIONOMICRON the project keeps no event log"
APPLIES = "T2"
SUPERSEDED_TERRITORY = "T3"
# A condition may hold a pipe mid-line (the server refuses only a line that
# starts with one); the page must print it as written (F2/codex).
PIPE_TERRITORY = "T10"
PIPE_CONDITION = "CONDITIONPIPE neither A | B mode is supported"
TERRITORY_DOC = REPO / ".claude" / "skills" / "amanuensis" / "references" / "concern-territories.md"
# A withdrawal recorded at a revision the workspace cannot resolve still
# withdraws: the older row must not come back (F1/codex).
RECANTED_TOPIC = "Recanted reading"
RECANTED_BODY = "NARRRECANTEDPI the writer used to retry forever."
UNRESOLVABLE_SHA = "e" * 40
SUPERSEDED_CONDITION = "CONDITIONSUPERSEDED the service never leaves the host"

# Runtime boundaries.
RUNTIME_RECORDED = ("RuntimeAlphaPi", "Rust", "RuntimePeerRho", "unix socket", "RUNTIMENOTESIGMA")
RUNTIME_IMPORTED = ("RuntimeImportedTau", "Go", "RuntimeImportedPeerUpsilon", "pipe", "RUNTIMEIMPNOTE")
RUNTIME_SUPERSEDED_MECH = "MECHSUPERSEDEDPHI"
RUNTIME_WITHDRAWN = "RuntimeWithdrawnChi"
RUNTIME_PIPE = ("RuntimePipeKappa", "Rust", "RuntimePipePeer", "pipe", "NOTEPIPE reads | writes")

ENTRY_BODY = "# Where to begin\n\n## Reading order\n\nIMPORTEDENTRYPSI start at the reader.\n"
HASH = "0123456789abcdef0123456789abcdef"


# ---------------------------------------------------------------------------
# The repository the narratives cite
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
    """C1 has every file; C2 changes only the reader."""

    repo.mkdir(parents=True)
    git(repo, "init", "-q", "-b", "main")
    (repo / "src").mkdir()
    for rel in (READER, WRITER, OTHER):
        (repo / rel).write_text(f"# {rel}\nVERSION = 1\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "c1")
    c1 = git(repo, "rev-parse", "HEAD")
    (repo / READER).write_text(f"# {READER}\nVERSION = 2\n")
    git(repo, "commit", "-q", "-am", "c2")
    c2 = git(repo, "rev-parse", "HEAD")
    return {"c1": c1, "c2": c2}


# ---------------------------------------------------------------------------
# Seeding
# ---------------------------------------------------------------------------
class Seed:
    def __init__(self, storage: Path, shas: dict[str, str]) -> None:
        self.storage = storage
        self.shas = shas
        self.db = sqlite3.connect(storage / "memory.db")
        self.db.executescript(SCHEMA.read_text())
        self.db.execute(
            "INSERT INTO git_state (repo_id, canonical_branch, onboarding_sha,"
            " last_checked_sha, last_checked_at)"
            " VALUES ('default', 'main', ?, ?, '2026-11-12T12:00:00Z')",
            (shas["c1"], shas["c2"]),
        )
        self.db.execute("INSERT INTO sessions (session_id, intent) VALUES ('so9', 'fixture')")

    def subsystem(self, sid: str, name: str, *, claims: bool = False) -> None:
        self.db.execute(
            "INSERT INTO subsystems (id, name, status, layer, scope)"
            " VALUES (?, ?, 'adversarial', 'backend', ?)",
            (sid, name, f"src/ files of the {name.lower()}"),
        )
        if claims:
            self.db.execute(
                "INSERT INTO claims (claim_id, claim_key, subject_type, subject_id,"
                " statement, epistemic_kind, asserted_at_sha, valid_from_sha, session_id)"
                " VALUES (?, ?, 'subsystem', ?, 'CLAIMSTATEMENT the registry owns every snapshot', 'observation', ?, ?, 'so9')",
                (f"{sid}-c0", f"{sid}/recoverability/x", sid, self.shas["c1"], self.shas["c1"]),
            )

    def narrative(
        self,
        subject_type: str,
        subject_id: str,
        section: str,
        topic: str,
        body: str,
        *,
        disposition: str = "recorded",
        cites: tuple[str, ...] = (),
        ref: str | None = None,
    ) -> int:
        cur = self.db.execute(
            "INSERT INTO narratives (subject_type, subject_id, section, topic, disposition,"
            " body, ref_sha, session_id, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'so9', ?)",
            (
                subject_type,
                subject_id,
                section,
                topic,
                disposition,
                body,
                ref or self.shas["c1"],
                NARRATIVE_RECORDED,
            ),
        )
        narrative_id = int(cur.lastrowid or 0)
        for path in cites:
            ev = self.db.execute(
                "INSERT INTO evidence (file_path, ref_sha, kind, session_id)"
                " VALUES (?, ?, 'code-verified', 'so9')",
                (path, ref or self.shas["c1"]),
            )
            self.db.execute(
                "INSERT INTO narrative_evidence (narrative_id, evidence_id) VALUES (?, ?)",
                (narrative_id, ev.lastrowid),
            )
        return narrative_id

    def concern(self, code: str, category: str, territory: str, probe: str) -> None:
        self.db.execute(
            "INSERT INTO concerns (code, category, origin, status, territory, probe)"
            " VALUES (?, ?, 'seeded', 'active', ?, ?)",
            (code, category, territory, probe),
        )

    def territory_row(self, territory: str, disposition: str, condition: str | None) -> None:
        self.db.execute(
            "INSERT INTO territory_dispositions (territory, disposition, condition, ref_sha,"
            " session_id) VALUES (?, ?, ?, ?, 'so9')",
            (territory, disposition, condition, self.shas["c1"]),
        )

    def runtime(
        self,
        edge: tuple[str, str | None, str, str, str | None],
        *,
        origin: str = "recorded",
        withdrawn: int = 0,
    ) -> None:
        self.db.execute(
            "INSERT INTO runtime_boundaries (from_runtime, from_language, to_runtime, mechanism,"
            " notes, origin, withdrawn, ref_sha, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'so9')",
            (*edge, origin, withdrawn, self.shas["c1"]),
        )

    def project(self, with_import: bool) -> None:
        self.db.execute(
            "INSERT INTO explanations (subject_type, subject_id, slot, disposition, body,"
            " ref_sha, session_id) VALUES ('project', 'project', 'purpose', 'recorded',"
            " 'THESISRHO is a service that answers reads from a snapshot.', ?, 'so9')",
            (self.shas["c1"],),
        )
        self.db.execute(
            "INSERT INTO project_profile (name, ref_sha, session_id) VALUES ('RecordPages', ?, 'so9')",
            (self.shas["c1"],),
        )
        self.narrative(
            "project", "project", "repository-shape", "", PROJECT_OLD, cites=(READER,)
        )
        for section, body in PROJECT_BODIES.items():
            cites = () if section == "survey-plan" else (WRITER,)
            self.narrative("project", "project", section, "", body, cites=cites)
        self.runtime(RUNTIME_RECORDED)
        self.runtime(RUNTIME_IMPORTED, origin="imported")
        self.runtime(RUNTIME_PIPE)
        self.runtime(
            ("RuntimeSupersededOmega", "Rust", "RuntimeSupersededPeer", RUNTIME_SUPERSEDED_MECH, "OLDNOTE")
        )
        self.runtime(
            ("RuntimeSupersededOmega", "Rust", "RuntimeSupersededPeer", RUNTIME_SUPERSEDED_MECH, "NEWNOTEOMEGA")
        )
        self.runtime((RUNTIME_WITHDRAWN, "Go", "RuntimeWithdrawnPeer", "http", "WITHDRAWNNOTE"))
        self.runtime((RUNTIME_WITHDRAWN, "Go", "RuntimeWithdrawnPeer", "http", "WITHDRAWNNOTE"), withdrawn=1)
        self.concern("CC-1", "concurrency", TERRITORY, PROBE)
        self.concern("CC-2", "data-integrity", APPLIES, "PROBEUPSILON look for a stale snapshot")
        self.territory_row(DISQUALIFIED, "disqualified", DISQUALIFIED_CONDITION)
        self.territory_row(SUPERSEDED_TERRITORY, "disqualified", SUPERSEDED_CONDITION)
        self.territory_row(SUPERSEDED_TERRITORY, "applies", None)
        self.territory_row(TERRITORY, "applies", None)
        self.territory_row(PIPE_TERRITORY, "disqualified", PIPE_CONDITION)
        if with_import:
            self.db.execute(
                "INSERT INTO imported_artifacts (path, kind, subsystem_id, body, body_sha256,"
                " registered_hash, hash_matches, registered_ref_sha, written_at, session_id)"
                " VALUES ('entry-point.md', 'entry-point', NULL, ?, ?, ?, 1, ?, '2026-10-02 09:30:00', 'so9')",
                (ENTRY_BODY, hashlib.sha256(ENTRY_BODY.encode()).hexdigest(), HASH, self.shas["c1"]),
            )

    def finish(self) -> None:
        self.db.commit()
        self.db.close()


def seed_store(root: Path, name: str, shas: dict[str, str], *, with_import: bool) -> Path:
    storage = root / name
    storage.mkdir(parents=True)
    s = Seed(storage, shas)
    s.subsystem("B-01", "Read path", claims=True)
    s.subsystem("B-02", "Write path")
    s.subsystem("B-03", "Queue")
    # B-01: the aged narrative cites the file C2 changed; the other cites one it did not.
    s.narrative("subsystem", "B-01", "structure", TOPICS["flow"], FLOW_OLD, cites=(READER,))
    s.narrative("subsystem", "B-01", "structure", TOPICS["flow"], FLOW_NEW, cites=(READER,))
    s.narrative("subsystem", "B-01", "structure", TOPICS["life"], LIFE_BODY, cites=(WRITER,))
    s.narrative(
        "subsystem", "B-01", "structure", "Dropped topic", WITHDRAWN_BODY, cites=(WRITER,)
    )
    s.narrative(
        "subsystem", "B-01", "structure", "Dropped topic", "The reading was retracted.",
        disposition="withdrawn",
    )
    s.narrative(
        "subsystem", "B-01", "concern-reasoning", "", REASONING_BODY, cites=(WRITER,)
    )
    s.narrative(
        "subsystem", "B-01", "challenge", TOPICS["challenge"], CHALLENGE_BODY, cites=(WRITER,)
    )
    # B-02: no claims and no import, so the narrative is the only structure text.
    s.narrative("subsystem", "B-02", "structure", TOPICS["solo"], SOLO_BODY, cites=(WRITER,))
    s.narrative("subsystem", "B-02", "structure", RECANTED_TOPIC, RECANTED_BODY, cites=(WRITER,))
    s.narrative(
        "subsystem", "B-02", "structure", RECANTED_TOPIC, "The reading was retracted.",
        disposition="withdrawn", ref=UNRESOLVABLE_SHA,
    )
    # B-03: a declination.
    s.narrative(
        "subsystem", "B-03", "structure", TOPICS["declined"], DECLINED_REASON,
        disposition="declined",
    )
    s.project(with_import)
    s.finish()
    return storage


# ---------------------------------------------------------------------------
# Running the materializer and reading pages
# ---------------------------------------------------------------------------
def run_materializer(storage: Path, repo: Path, *args: str) -> dict[str, object]:
    proc = subprocess.run(
        [sys.executable, str(ROOT / "materialize.py"), "--storage", str(storage),
         "--workspace", str(repo), *args],
        capture_output=True,
        text=True,
        check=False,
    )
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


def squash(text: str) -> str:
    return " ".join(text.split())


def html_words(markup: str) -> str:
    body = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", markup)
    body = re.sub(r"<[^>]+>", " ", body)
    return squash(htmllib.unescape(body))


def heading_text(fragment: str) -> str:
    fragment = re.sub(r'(?is)<a class="heading-anchor"[^>]*>.*?</a>', " ", fragment)
    return squash(htmllib.unescape(re.sub(r"<[^>]+>", " ", fragment))).lstrip("§ ")


def raw_section(markup: str, heading: str, level: int) -> str:
    """The markup after the `<h{level}>` whose text is `heading`, up to the next
    heading of that level or above."""

    for match in re.finditer(rf"(?is)<h{level}\b(?![^>]*nav-group-title)[^>]*>(.*?)</h{level}>", markup):
        if heading_text(match.group(1)) == heading:
            rest = markup[match.end():]
            stop = re.search(rf"(?i)<h[1-{level}]\b", rest)
            return rest[: stop.start()] if stop else rest
    return ""


def html_sections(text: str) -> dict[str, str]:
    visible = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", text)
    visible = re.sub(r'(?is)<a class="heading-anchor"[^>]*>.*?</a>', " ", visible)
    parts = re.split(r"(?is)<h2\b(?![^>]*nav-group-title)[^>]*>(.*?)</h2>", visible)
    plain = lambda fragment: squash(htmllib.unescape(re.sub(r"<[^>]+>", " ", fragment)))  # noqa: E731
    return {plain(parts[i]): plain(parts[i + 1]) for i in range(1, len(parts) - 1, 2)}


def subsystem_file(docs: Path, sid: str) -> Path:
    stem = sid.lower().replace("-", "")
    found = sorted((docs / "subsystems").glob(f"{stem}-*.html"))
    return found[0] if found else docs / "subsystems" / f"{stem}-absent.html"


def window(text: str, needle: str, after: int = 420) -> str:
    at = text.find(needle)
    return "" if at < 0 else text[at : at + len(needle) + after]


def ageing_segment(text: str, body: str) -> str:
    """The text from a narrative's body to the end of the sentence that says how its files aged."""

    at = text.find(body)
    if at < 0:
        return ""
    end = text.find("since", at)
    return text[at : end + 40] if 0 <= end - at < 600 else text[at : at + 600]


def territory_names() -> dict[str, str]:
    """`T<n>` to its name, from the headings of the skill's territory catalog."""

    found = re.findall(r"(?m)^## Territory (\d+) — (.+?)\s*$", read(TERRITORY_DOC))
    return {f"T{n}": name for n, name in found}


def html_rows(markup: str, first: str) -> list[list[str]]:
    """The visible cells of every HTML table row whose first cell starts with `first`."""

    out = []
    for tr in re.findall(r"(?is)<tr\b.*?</tr>", markup):
        cells = [
            squash(htmllib.unescape(re.sub(r"<[^>]+>", " ", c)))
            for c in re.findall(r"(?is)<t[dh]\b[^>]*>(.*?)</t[dh]>", tr)
        ]
        if cells and cells[0].startswith(first):
            out.append(cells)
    return out


def reseal(docs: Path, rel: str) -> None:
    """Rewrite the contract's hash for one page, so only a semantic census can object."""

    contract_path = docs / ".projection-contract.json"
    contract = json.loads(contract_path.read_text())
    digest = hashlib.sha256((docs / rel).read_bytes()).hexdigest()
    for page in contract["pages"]:
        if page["path"] == rel:
            page["content_hash"] = digest
    contract_path.write_text(json.dumps(contract, indent=2) + "\n")


def mismatch_kinds(outcome: dict[str, object]) -> list[str]:
    return [str(m.get("object_type")) for m in outcome.get("mismatches") or [] if isinstance(m, dict)]  # type: ignore[union-attr]


def finish(reason: str | None = None) -> int:
    if reason:
        FAILURES.append(reason)
    if FAILURES:
        emit(f"GATE {PACKET} RED: {FAILURES[0]}"[:400])
        return 1
    emit(f"GATE {PACKET} GREEN")
    return 0


# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------
def main() -> int:
    work = Path(tempfile.mkdtemp(prefix="so9-"))
    try:
        return run(work)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def run(work: Path) -> int:
    if not SCHEMA.is_file():
        return finish("the schema is absent")
    try:
        repo = work / "repo"
        shas = build_repository(repo)
        a = seed_store(work, "a", shas, with_import=True)
        b = seed_store(work, "b", shas, with_import=False)
    except Exception as exc:
        return finish(f"the fixture could not be seeded — {exc!r}")

    result_a = run_materializer(a, repo, "--clean-publish")
    docs_a = a / "docs"
    result_b = run_materializer(b, repo, "--clean-publish")
    docs_b = b / "docs"
    emit(f"store A published: ok={result_a.get('ok')}; store B published: ok={result_b.get('ok')}")

    def published() -> str | None:
        for label, result in (("A", result_a), ("B", result_b)):
            readback = result.get("readback")
            if result.get("ok") is not True or result.get("_returncode") != 0:
                return f"store {label} did not publish — {result.get('error') or result.get('_diagnostic')}"
            if not isinstance(readback, dict) or readback.get("ok") is not True:
                return f"store {label} read-back was not green: {str(readback)[:300]}"
        return None

    check("both stores publish, and the read-back is green", published)

    # ---- Subsystem narratives -------------------------------------------
    b01_html_path = subsystem_file(docs_a, "B-01")
    b01_html = read(b01_html_path)
    b01_html_text = html_words(b01_html)
    b01_sections = html_sections(b01_html)

    def structure_narratives() -> str | None:
        html_structure = b01_sections.get("Structure", "")
        for label, body in (("Request flow", FLOW_NEW), ("Snapshot lifetime", LIFE_BODY)):
            sentinel = body.split()[0]
            if sentinel not in html_structure:
                return f"the {label} narrative is not in the HTML Structure section"
        return None

    def topics_are_subheadings() -> str | None:
        structure = raw_section(b01_html, "Structure", 2)
        for key in ("flow", "life"):
            if not raw_section(structure, TOPICS[key], 3) and not raw_section(structure, TOPICS[key], 4):
                return f"the topic {TOPICS[key]!r} is not a subheading of Structure"
        under = raw_section(structure, TOPICS["flow"], 3) or raw_section(structure, TOPICS["flow"], 4)
        if not html_words(under).startswith(FLOW_NEW.split()[0]):
            return "the narrative does not follow its topic's subheading"
        return None

    check("structure narratives print under Structure", structure_narratives)
    check("each topic is a subheading", topics_are_subheadings)

    def concern_reasoning_and_challenge() -> str | None:
        # PLAN §8 SO9: concern reasoning under Review coverage (`concerns.html`),
        # under its subsystem (F8/codex).
        coverage_html = read(docs_a / "concerns.html")
        reasoning = html_sections(coverage_html).get("Concern reasoning", "")
        if REASONING_BODY.split()[0] not in reasoning:
            return "the concern-reasoning narrative is not under Concern reasoning on Review coverage"
        if "B-01" not in reasoning.split(REASONING_BODY.split()[0])[0]:
            return "the concern-reasoning narrative on Review coverage is not under its subsystem"
        challenge = html_words(raw_section(raw_section(b01_html, "Survey record", 2), "Challenge", 3))
        if CHALLENGE_BODY.split()[0] not in challenge:
            return "the challenge narrative is not under Challenge in the Survey record"
        if f"{TOPICS['challenge']}" not in challenge:
            return "the challenge topic is not printed under Challenge"
        if REASONING_BODY.split()[0] in b01_sections.get("Structure", ""):
            return "the concern-reasoning narrative also prints under Structure"
        return None

    check("concern reasoning and challenge print where the plan puts them", concern_reasoning_and_challenge)

    def dated_and_aged() -> str | None:
        for view, text in (("HTML", b01_html_text),):
            aged = ageing_segment(text, FLOW_NEW)
            if NARRATIVE_DATE not in aged or shas["c1"][:8] not in aged:
                return f"{view}: the aged narrative carries no date and revision beside it"
            if "changed since:" not in aged or READER not in aged or "None of the" in aged:
                return f"{view}: the narrative whose cited file moved is not marked ageing"
            fresh = ageing_segment(text, LIFE_BODY)
            if NARRATIVE_DATE not in fresh or shas["c1"][:8] not in fresh:
                return f"{view}: the unchanged narrative carries no date and revision"
            if "None of the" not in fresh or "changed since:" in fresh:
                return f"{view}: the unchanged narrative is not marked as unchanged"
        return None

    check("each narrative prints its date and revision; only the moved one is ageing", dated_and_aged)

    def superseded_and_withdrawn() -> str | None:
        for name, text in (
            ("B-01 HTML", b01_html_text),
            ("B-01 HTML source", b01_html),
        ):
            for sentinel in (FLOW_OLD.split()[0], WITHDRAWN_BODY.split()[0]):
                if sentinel in text:
                    return f"{sentinel} renders on {name}"
        if "Dropped topic" in b01_html_text:
            return "a withdrawn narrative's topic still renders as a heading"
        for path in (subsystem_file(docs_a, "B-02"),):
            text = read(path)
            if RECANTED_BODY.split()[0] in text or RECANTED_TOPIC in text:
                return (
                    f"{path.suffix} B-02: a narrative withdrawn at a revision the workspace"
                    " cannot resolve came back as its older recorded row"
                )
        return None

    check("a superseded or withdrawn narrative does not render", superseded_and_withdrawn)

    def solo_and_declined() -> str | None:
        b02_html = subsystem_file(docs_a, "B-02")
        b03_html = subsystem_file(docs_a, "B-03")
        for label, path in (("B-02 HTML", b02_html),):
            text = read(path)
            if SOLO_BODY.split()[0] not in text:
                return f"the structure narrative is missing from {label}"
            if "no narrative was left in its place" in text:
                return f"{label} says no narrative exists although one is recorded"
        for label, path in (("B-03 HTML", b03_html),):
            if DECLINED_REASON.split()[0] not in read(path):
                return f"the declined narrative's reason is missing from {label}"
        return None

    check("a lone narrative and a declination both print", solo_and_declined)

    # ---- Project pages ---------------------------------------------------
    def onboarding_record() -> str | None:
        for label, docs in (("A", docs_a), ("B", docs_b)):
            html = html_words(read(docs / "onboarding-report.html"))
            if not html:
                return f"store {label} publishes no Onboarding record"
            for section in ("repository-shape", "runtime", "stateful-entities", "concern-calibration", "survey-plan"):
                sentinel = PROJECT_BODIES[section].split()[0]
                if sentinel not in html:
                    return f"store {label}: the {section} narrative is missing from Onboarding record"
            if PROJECT_OLD.split()[0] in html:
                return f"store {label}: a superseded project narrative renders"
            if PROJECT_BODIES["start-here"].split()[0] in html:
                return f"store {label}: the start-here narrative is on Onboarding record"
        return None

    check("Onboarding record prints the project narratives", onboarding_record)

    def where_to_begin() -> str | None:
        for label, docs in (("A", docs_a), ("B", docs_b)):
            html = html_words(read(docs / "entry-point.html"))
            sentinel = PROJECT_BODIES["start-here"].split()[0]
            if sentinel not in html:
                return f"store {label}: the start-here narrative is missing from Where to begin"
        html = html_words(read(docs_a / "entry-point.html"))
        for view, text in (("HTML", html),):
            if "IMPORTEDENTRYPSI" not in text:
                return f"the imported entry point is gone from Where to begin ({view})"
            if "As written at 2026-10-02" not in text:
                return f"the imported entry point lost its 'As written' label ({view})"
        if "IMPORTEDENTRYPSI" in read(docs_b / "entry-point.html"):
            return "store B prints an imported body it does not hold"
        return None

    check("Where to begin prints start-here and keeps the import beside it", where_to_begin)

    def review_checklist() -> str | None:
        for label, docs in (("A", docs_a), ("B", docs_b)):
            html = html_words(read(docs / "concern-checklist.html"))
            if not html:
                return f"store {label} publishes no Review checklist"
            for view, text in (("HTML", html),):
                for needle in (
                    PROBE.split()[0],
                    "PROBEUPSILON",
                    TERRITORY,
                    DISQUALIFIED,
                    DISQUALIFIED_CONDITION.split()[0],
                    APPLIES,
                ):
                    if needle not in text:
                        return f"store {label}: {needle!r} is missing from Review checklist ({view})"
                if SUPERSEDED_CONDITION.split()[0] in text:
                    return f"store {label}: a superseded territory disposition renders ({view})"
                if SUPERSEDED_TERRITORY not in text:
                    return f"store {label}: the newer disposition of {SUPERSEDED_TERRITORY} is missing ({view})"
        return None

    def territories_named_and_disposed() -> str | None:
        names = territory_names()
        if len(names) != 11:
            return f"concern-territories.md names {len(names)} territories, not T1 to T11"
        expected = {
            DISQUALIFIED: ("disqualified", DISQUALIFIED_CONDITION),
            SUPERSEDED_TERRITORY: ("applies", "—"),
            TERRITORY: ("applies", "—"),
            PIPE_TERRITORY: ("disqualified", PIPE_CONDITION),
        }
        for label, docs in (("A", docs_a), ("B", docs_b)):
            markup = read(docs / "concern-checklist.html")
            for view in ("HTML",):
                for territory, (disposition, condition) in expected.items():
                    found = html_rows(markup, territory)
                    if len(found) != 1:
                        return f"store {label}: {len(found)} Territories rows for {territory} ({view})"
                    cells = found[0]
                    if names[territory] not in cells[0]:
                        return f"store {label}: {territory} is printed without its name {names[territory]!r} ({view})"
                    if len(cells) < 3 or cells[1].lower() != disposition or squash(cells[2]) != condition:
                        return f"store {label}: {territory} reads {cells[1:]!r}, not {disposition!r} and {condition!r} ({view})"
                for territory in (TERRITORY, APPLIES):
                    if f"{territory} ({names[territory]})" not in html_words(markup):
                        return f"store {label}: the concern territory {territory} is printed without its name ({view})"
            for heading in re.findall(r'(?is)<h3 class="concern-family-heading".*?</h3>', markup):
                ids = re.findall(r"\bT\d+\b", html_words(heading))
                for territory in ids:
                    if names.get(territory, "\0") not in html_words(heading):
                        return f"store {label}: the concern-family heading prints {territory} without its name"
        return None

    check("each territory carries its name and its own disposition", territories_named_and_disposed)

    check("Review checklist prints territory, probe and territory dispositions", review_checklist)

    # ---- Runtime ---------------------------------------------------------
    def runtime_boundaries() -> str | None:
        raw_html = read(docs_a / "architecture.html")
        text = html_words(raw_html)
        for view, page in (("HTML", text),):
            for needle in (*RUNTIME_RECORDED[:4], RUNTIME_RECORDED[4], *RUNTIME_IMPORTED[:3], "NEWNOTEOMEGA"):
                if needle and needle not in page:
                    return f"{needle!r} is missing from the architecture page ({view})"
            if RUNTIME_PIPE[4] not in page.replace("\\|", "|"):
                return f"the runtime note {RUNTIME_PIPE[4]!r} is not printed as written ({view})"
            for needle in ("OLDNOTE", RUNTIME_WITHDRAWN, "WITHDRAWNNOTE"):
                if needle in page:
                    return f"{needle!r} renders on the architecture page although it is superseded or withdrawn ({view})"
        svgs = re.findall(r"(?is)<svg\b.*?</svg>", raw_html)
        drawing = " ".join(svgs)
        for needle in (RUNTIME_RECORDED[0], RUNTIME_RECORDED[2], RUNTIME_IMPORTED[0], RUNTIME_RECORDED[3]):
            if needle not in drawing:
                return f"the runtime drawing does not carry {needle!r}"
        if RUNTIME_WITHDRAWN in drawing:
            return "the runtime drawing carries a withdrawn edge"
        return None

    check("recorded runtime boundaries are on the page and in the drawing", runtime_boundaries)

    def imported_rows_labelled() -> str | None:
        label = "Imported from the onboarding report"
        text = html_words(read(docs_a / "architecture.html"))
        for view, page in (("HTML", text),):
            at = page.find(label)
            if at < 0:
                return f"the imported runtime row is not labelled as imported ({view})"
            sentence = page[at : at + 260]
            if RUNTIME_IMPORTED[0] not in sentence or RUNTIME_IMPORTED[2] not in sentence:
                return f"the imported label does not name the imported edge ({view})"
            if RUNTIME_RECORDED[0] in sentence or RUNTIME_RECORDED[2] in sentence:
                return f"a recorded runtime edge is labelled as imported ({view})"
            if page.count(label) != 1:
                return f"the imported label is printed {page.count(label)} times ({view})"
        return None

    check("an imported runtime row is labelled, a recorded one is not", imported_rows_labelled)

    # ---- Read-back -------------------------------------------------------
    def readback_green_first() -> str | None:
        outcome = run_materializer(a, repo, "--readback-only", "--output", str(docs_a))
        if outcome.get("ok") is not True:
            return f"the read-back of store A is not green before any edit: {mismatch_kinds(outcome)}"
        return None

    check("the read-back is green on the unaltered projection", readback_green_first)

    def sabotage(rel: str, needle: str, replacement: str, expect: str) -> str | None:
        target = docs_a / rel
        if not target.is_file():
            return f"{rel} is not published"
        original = target.read_text()
        if needle not in original:
            return f"{rel} does not carry {needle!r} to alter"
        target.write_text(original.replace(needle, replacement))
        reseal(docs_a, rel)
        try:
            outcome = run_materializer(a, repo, "--readback-only", "--output", str(docs_a))
        finally:
            target.write_text(original)
            reseal(docs_a, rel)
        if outcome.get("ok") is True:
            return f"the read-back stayed green after {needle!r} was altered on {rel} with the contract resealed"
        if not any(expect in kind for kind in mismatch_kinds(outcome)):
            return f"altering {needle!r} on {rel} was not reported as a {expect} mismatch: {mismatch_kinds(outcome)}"
        return None

    def narrative_sabotage() -> str | None:
        rel_html = str(b01_html_path.relative_to(docs_a))
        reason = sabotage(rel_html, "NARRFLOWALPHA", "NARRFLOWOMEGA", "narrative")
        if reason:
            return reason
        reason = sabotage("onboarding-report.html", "NARRRUNTIMEIOTA", "NARRRUNTIMEIOTB", "narrative")
        if reason:
            return reason
        reason = sabotage("concerns.html", "NARRREASONDELTA", "NARRREASONDELTB", "narrative")
        if reason:
            return reason
        return sabotage("entry-point.html", "NARRSTARTNU", "NARRSTARTNV", "narrative")

    check("altering a narrative on a page turns the resealed read-back red", narrative_sabotage)

    def territory_sabotage() -> str | None:
        reason = sabotage("concern-checklist.html", "CONDITIONOMICRON", "CONDITIONOMICRXN", "territory")
        if reason:
            return reason
        # The verdict itself: a ruled-out territory printed as applying (F11/codex).
        markup = read(docs_a / "concern-checklist.html")
        tr = next((t for t in re.findall(r"(?is)<tr\b.*?</tr>", markup) if f">{DISQUALIFIED} " in t or f">{DISQUALIFIED}<" in t), "")
        if "disqualified" not in tr.lower():
            return f"concern-checklist.html has no disqualified row for {DISQUALIFIED} to alter"
        flipped = re.sub(r"(?i)disqualified", "applies", tr, count=1)
        return sabotage("concern-checklist.html", tr, flipped, "territory")

    check("altering a territory disposition turns the resealed read-back red", territory_sabotage)

    def runtime_sabotage() -> str | None:
        return sabotage("architecture.html", "unix socket", "unix sockex", "runtime")

    check("altering a runtime boundary turns the resealed read-back red", runtime_sabotage)

    # ---- An appended withdrawal leaves the page on an incremental publish --
    def incremental_withdrawal() -> str | None:
        db = sqlite3.connect(a / "memory.db")
        db.execute(
            "INSERT INTO narratives (subject_type, subject_id, section, topic, disposition,"
            " body, ref_sha, session_id) VALUES ('subsystem', 'B-01', 'structure', ?, 'withdrawn',"
            " 'The reading was retracted.', ?, 'so9')",
            (TOPICS["life"], shas["c1"]),
        )
        db.commit()
        db.close()
        outcome = run_materializer(a, repo)
        if outcome.get("ok") is not True:
            return f"the incremental publish failed: {outcome.get('_diagnostic')}"
        page = read(subsystem_file(docs_a, "B-01"))
        if LIFE_BODY.split()[0] in page:
            return "a narrative withdrawn after the first publish is still on its page"
        if FLOW_NEW.split()[0] not in page:
            return "the incremental publish dropped a narrative that was not withdrawn"
        return None

    check("a withdrawal appended before an incremental publish removes the narrative", incremental_withdrawal)

    def in_ci() -> str | None:
        text = read(CI_FILE)
        if "test-store-only-record-pages.py" not in text:
            return "the gate has no step in .github/workflows/test.yml"
        return None

    check("the gate runs in CI", in_ci)

    return finish()


if __name__ == "__main__":
    sys.exit(main())
