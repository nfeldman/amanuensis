#!/usr/bin/env python3
"""Gate for explanation packet EX6 — the unfilled-slot census (spec.md §2.5;
claims C9, C10, C11, C12).

Publishes four fixture stores and reads the `unfilled_slots` list the
materializer returns:

  - `empty`: nothing recorded. The census must hold a thesis row, a runtime
    boundary map row and one vocabulary row per subsystem, and each row's
    sentence must be on its page;
  - `refused`: a thesis that carries status vocabulary, then one that carries a
    composite figure. The slot is unfilled in the state `refused`;
  - `mixed`: the thesis and one subsystem's vocabulary recorded, the other
    subsystem's declination anchored to a revision the repository lacks. Only the
    slots whose sentence is printed have a row;
  - `filled`: every slot recorded or declined. The census is an empty list and
    none of the sentences is on any page.

Turns red when:

  - a rendered placeholder has no census row, or a row's sentence is not on its
    page, or the rows are not exactly the slots whose sentence is printed;
  - a row lacks one of the five fields, names a slot other than the three
    in scope, or carries a discharge that names neither the file nor the tool;
  - the census holds a row for an empty-state sentence that is not a slot;
  - `PLACEHOLDER_SENTENCES` is not exported, or one of the six strings in
    `dev/measure-reader-prose.mjs` occurs in none of its sentences;
  - the heading `onboarding.md` or `artifact-templates.md` names for the thesis,
    or the runtime table either names, is not read back by the materializer from
    a record built out of that text;
  - an unfilled slot makes the publication fail, or the clean-publish summary
    carries different rows;
  - `phase-5-packaging.md` step 5 does not read `unfilled_slots` and fill or
    report each row;
  - a sentence about the census calls it a gate or a guard;
  - the gate is not listed in `.github/workflows/test.yml`.

False green it cannot exclude: the discharge names the right file and tool and
a session still cannot act on it. This gate asserts the text, not whether a
session follows it.

Output protocol: exactly one status line, last, on stdout. Every subprocess is
captured and never echoed, and every message is scrubbed, so a missing
deliverable reports as an assertion failure and not as a crash.
"""

from __future__ import annotations

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
MEASURE_FILE = REPO / "dev" / "measure-reader-prose.mjs"
SKILL = REPO / ".claude" / "skills" / "amanuensis" / "references"
ONBOARDING = SKILL / "onboarding.md"
TEMPLATES = SKILL / "artifact-templates.md"
PACKAGING = SKILL / "phase-5-packaging.md"
CENSUS_TEXT = (
    ROOT / "amanuensis_materializer" / "core.py",
    ROOT / "amanuensis_materializer" / "renderers.py",
    ROOT / "amanuensis_materializer" / "diagrams.py",
    ONBOARDING,
    PACKAGING,
)

PACKET = "EX6"
RED_EXPECT = "a rendered placeholder has no census row"

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


FAILURES: list[tuple[str, str]] = []


def check(label: str, fn: Callable[[], str | None]) -> None:
    try:
        reason = fn()
    except Exception as exc:  # the gate must survive any absent deliverable
        reason = f"raised while checking — {exc!r}"
    if reason:
        FAILURES.append((label, reason))
        emit(f"  FAIL {label}: {reason}")
    else:
        emit(f"  ok   {label}")


def read(path: Path) -> str:
    try:
        return path.read_text()
    except OSError:
        return ""


# ---------------------------------------------------------------------------
# What the three slots print, as the spec's table and the measure script name it
# ---------------------------------------------------------------------------
THESIS_SENTENCES = {
    "absent": "No thesis section is recorded",
    "refused": "The recorded thesis carries status vocabulary and was not published",
    "refused-composite": "The recorded thesis presents a composite index of the record and was not published",
}
RUNTIME_SENTENCE = "No structured runtime boundary map is recorded yet"
VOCABULARY_SENTENCE = "**Domain vocabulary** — not recorded"
ALL_THESIS = tuple(THESIS_SENTENCES.values())
SLOTS_IN_SCOPE = {"thesis", "runtime-boundary-map", "subsystem-vocabulary"}
NOT_SLOTS = ("No seams recorded yet", "No dependency edges are recorded")
ROW_FIELDS = {"slot", "page", "subject", "state", "discharge"}

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
HEAD_FILE = "src/queue.ts"
THESIS_BODY = "A queue service in TypeScript that drains jobs into a SQLite store.\n"
ENTRY_OK = f"# Entry point\n\n## What is this codebase?\n\n{THESIS_BODY}\n## Directory map\n\nx\n"
ENTRY_REFUSED = "# Entry point\n\n## What is this codebase?\n\nThis codebase is stale.\n"
ENTRY_COMPOSITE = (
    "# Entry point\n\n## What is this codebase?\n\nIt scores an overall health of 82%.\n"
)
ONBOARDING_OK = (
    "# Onboarding report\n\n## Runtime boundary map\n\n"
    "| Runtime / Process | Language | Communicates with | Mechanism | Notes |\n"
    "|---|---|---|---|---|\n"
    "| worker | TypeScript | store | SQL | drains jobs |\n"
)


def git(workspace: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(workspace), "-c", "user.name=fixture", "-c", "user.email=f@example.test", *args],
        capture_output=True,
        text=True,
        check=False,
    )


def make_workspace(root: Path) -> tuple[Path, str]:
    workspace = root / "workspace"
    (workspace / "src").mkdir(parents=True)
    (workspace / HEAD_FILE).write_text("export const drain = () => 1;\n")
    git(workspace, "-c", "init.defaultBranch=main", "init", "--quiet")
    git(workspace, "add", "-A")
    git(workspace, "commit", "--quiet", "-m", "fixture")
    head = git(workspace, "rev-parse", "HEAD").stdout.strip()
    if not head:
        raise RuntimeError("the fixture workspace has no commit")
    return workspace, head


def seed(
    storage: Path,
    workspace: Path,
    head: str,
    *,
    entry: str | None,
    onboarding: str | None,
    vocab: dict[str, str],
) -> None:
    """`vocab` maps a subsystem id to `term`, `declined` or `declined-unresolved`."""

    db = sqlite3.connect(storage / "memory.db")
    db.executescript(SCHEMA.read_text())
    cur = db.cursor()
    cur.execute(
        "INSERT INTO git_state (repo_id, canonical_branch, onboarding_sha,"
        " last_checked_sha, last_checked_at)"
        " VALUES ('default', 'main', ?, ?, '2026-11-05T12:00:00Z')",
        (head, head),
    )
    cur.execute("INSERT INTO sessions (session_id, intent) VALUES ('ex6', 'fixture')")
    cur.execute(
        "INSERT INTO subsystems (id, name, status, layer) VALUES ('B-01', 'Queue', 'mapped', 'backend')"
    )
    cur.execute(
        "INSERT INTO subsystems (id, name, status, layer, scope)"
        " VALUES ('B-02', 'Lease', 'mapped', 'backend', 'The lease clock and its renewal.')"
    )
    for sid, how in vocab.items():
        if how == "term":
            term = f"drain-{sid.lower()}"
            cur.execute(
                "INSERT INTO vocabulary (term, gloss, subsystem_id, first_seen, ref_sha)"
                " VALUES (?, 'move jobs out of the queue', ?, ?, ?)",
                (term, sid, f"{HEAD_FILE}:drain@{head}", head),
            )
            cur.execute(
                "INSERT INTO vocabulary_scopes (term, subsystem_id) VALUES (?, ?)", (term, sid)
            )
        else:
            ref = head if how == "declined" else "0" * 40
            cur.execute(
                "INSERT INTO vocabulary_declinations (subsystem_id, reason, session_id, ref_sha)"
                " VALUES (?, 'the names here are ordinary words', 'ex6', ?)",
                (sid, ref),
            )
    db.commit()
    db.close()
    if entry is not None:
        (storage / "entry-point.md").write_text(entry)
    if onboarding is not None:
        (storage / "onboarding-report.md").write_text(onboarding)
    (storage / "workspace_path").write_text(f"{workspace}\n")


def publish(storage: Path, *extra: str) -> dict[str, object]:
    proc = subprocess.run(
        [sys.executable, str(ROOT / "materialize.py"), "--storage", str(storage), *extra],
        capture_output=True,
        text=True,
        check=False,
    )
    summary: dict[str, object] = {}
    for line in reversed(proc.stdout.strip().splitlines()):
        try:
            parsed = json.loads(line)
        except ValueError:
            continue
        if isinstance(parsed, dict):
            summary = parsed
            break
    return {
        "returncode": proc.returncode,
        "summary": summary,
        "diagnostic": scrub(proc.stderr)[-300:],
    }


class Fixture:
    """One published store: its summary, its rows and its pages."""

    def __init__(self, root: Path, name: str, **seed_args: object) -> None:
        self.name = name
        self.storage = root / name
        self.storage.mkdir()
        self.error: str | None = None
        self.outcome: dict[str, object] = {}
        try:
            workspace = root / f"{name}-workspace"
            workspace.mkdir()
            workspace, head = make_workspace(workspace)
            seed(self.storage, workspace, head, **seed_args)  # type: ignore[arg-type]
            self.outcome = publish(self.storage)
        except Exception as exc:
            self.error = f"the {name} fixture could not be published — {scrub(exc)}"
        self.docs = self.storage / "docs"
        summary = self.outcome.get("summary")
        self.summary: dict[str, object] = summary if isinstance(summary, dict) else {}

    def page(self, rel: str) -> str:
        return read(self.docs / rel)

    def subsystem_page(self, sid: str) -> tuple[str, str]:
        found = sorted((self.docs / "subsystems").glob(f"{sid.lower().replace('-', '')}-*.md"))
        if not found:
            return "", ""
        return f"subsystems/{found[0].name}", read(found[0])

    def rows(self) -> list[dict[str, object]] | str:
        """The census rows, or why they cannot be read."""

        if self.error:
            return self.error
        if "unfilled_slots" not in self.summary:
            return (
                f"{RED_EXPECT}: the {self.name} summary has no unfilled_slots"
                f" (exit {self.outcome.get('returncode')}; {self.outcome.get('diagnostic')})"
            )
        rows = self.summary["unfilled_slots"]
        if not isinstance(rows, list) or not all(isinstance(r, dict) for r in rows):
            return f"the {self.name} unfilled_slots is not a list of rows"
        return rows


def expected_rows(
    fx: Fixture,
    *,
    thesis: tuple[str, str] | None,
    runtime: bool,
    vocabulary: list[str],
) -> list[tuple[str, str, str]]:
    """(slot, subject, state) for each slot whose sentence is on its page."""

    out: list[tuple[str, str, str]] = []
    if thesis is not None:
        out.append(("thesis", "project", thesis[0]))
    if runtime:
        out.append(("runtime-boundary-map", "project", "absent"))
    out += [("subsystem-vocabulary", sid, "not-recorded") for sid in vocabulary]
    return out


def sentence_correspondence(fx: Fixture) -> str | None:
    """A row exists if and only if its slot's sentence is on its page."""

    rows = fx.rows()
    if isinstance(rows, str):
        return rows
    index = fx.page("index.md")
    architecture = fx.page("architecture.md")
    by_key = {(str(r.get("slot")), str(r.get("subject"))): r for r in rows}
    if len(by_key) != len(rows):
        return f"the {fx.name} census names one slot and subject twice"
    thesis_on_page = [s for s in ALL_THESIS if s in index]
    if bool(thesis_on_page) != (("thesis", "project") in by_key):
        return (
            f"{RED_EXPECT}: the {fx.name} overview "
            f"{'prints a thesis sentence' if thesis_on_page else 'prints none'}"
            f" and the census {'has' if ('thesis', 'project') in by_key else 'has no'} thesis row"
        )
    if (RUNTIME_SENTENCE in architecture) != (("runtime-boundary-map", "project") in by_key):
        return (
            f"{RED_EXPECT}: the {fx.name} architecture page "
            f"{'prints' if RUNTIME_SENTENCE in architecture else 'omits'} the runtime sentence"
            " and the census disagrees"
        )
    for sid in ("B-01", "B-02"):
        _rel, text = fx.subsystem_page(sid)
        if not text:
            return f"the {fx.name} fixture has no page for {sid}"
        if (VOCABULARY_SENTENCE in text) != (("subsystem-vocabulary", sid) in by_key):
            return (
                f"{RED_EXPECT}: the {fx.name} page for {sid} "
                f"{'prints' if VOCABULARY_SENTENCE in text else 'omits'} the vocabulary sentence"
                " and the census disagrees"
            )
    return None


def row_shape(fx: Fixture, want: list[tuple[str, str, str]]) -> str | None:
    rows = fx.rows()
    if isinstance(rows, str):
        return rows
    got = sorted((str(r.get("slot")), str(r.get("subject")), str(r.get("state"))) for r in rows)
    if got != sorted(want):
        return f"the {fx.name} census is {got}, not {sorted(want)}"
    for r in rows:
        if set(r) != ROW_FIELDS:
            return f"a {fx.name} row carries fields {sorted(r)}, not {sorted(ROW_FIELDS)}"
        if r["slot"] not in SLOTS_IN_SCOPE:
            return f"a {fx.name} row names the slot `{r['slot']}`, outside the three in scope"
        discharge = str(r["discharge"])
        slot = r["slot"]
        if slot == "thesis":
            if r["page"] != "index.md" or "entry-point.md" not in discharge:
                return f"the thesis row's page or discharge is wrong: {r}"
            if r["state"] == "absent" and "## What is this codebase?" not in discharge:
                return f"the absent thesis discharge does not name the heading: {discharge}"
        elif slot == "runtime-boundary-map":
            if (
                r["page"] != "architecture.md"
                or "## Runtime boundary map" not in discharge
                or "onboarding-report.md" not in discharge
            ):
                return f"the runtime row's page or discharge is wrong: {r}"
        else:
            rel, _text = fx.subsystem_page(str(r["subject"]))
            if not rel or r["page"] != rel:
                return f"the vocabulary row for {r['subject']} names page `{r['page']}`, not `{rel}`"
            if "define_term" not in discharge or "decline_domain_vocabulary" not in discharge:
                return f"the vocabulary discharge names neither tool: {discharge}"
    return None


def main() -> int:
    emit("GATE EX6 — the unfilled-slot census")
    emit("")
    root = Path(tempfile.mkdtemp(prefix="amanuensis-ex6-"))
    try:
        empty = Fixture(root, "empty", entry=None, onboarding=None, vocab={})
        refused = Fixture(root, "refused", entry=ENTRY_REFUSED, onboarding=ONBOARDING_OK, vocab={"B-01": "term", "B-02": "declined"})
        composite = Fixture(root, "composite", entry=ENTRY_COMPOSITE, onboarding=ONBOARDING_OK, vocab={"B-01": "term", "B-02": "declined"})
        mixed = Fixture(root, "mixed", entry=ENTRY_OK, onboarding=None, vocab={"B-01": "term", "B-02": "declined-unresolved"})
        filled = Fixture(root, "filled", entry=ENTRY_OK, onboarding=ONBOARDING_OK, vocab={"B-01": "term", "B-02": "declined"})

        # -- 1. the first assertion: every printed placeholder has its row -------
        check("empty: a row exists if and only if its sentence is on its page", lambda: sentence_correspondence(empty))
        check(
            "empty: the census is the thesis, the runtime map and both vocabularies",
            lambda: row_shape(
                empty,
                expected_rows(empty, thesis=("absent", ""), runtime=True, vocabulary=["B-01", "B-02"]),
            ),
        )
        check("refused: the correspondence holds for a refused thesis", lambda: sentence_correspondence(refused))
        check(
            "refused: the thesis row is `refused` and nothing else is unfilled",
            lambda: row_shape(refused, expected_rows(refused, thesis=("refused", ""), runtime=False, vocabulary=[])),
        )
        check("composite: the correspondence holds for a composite thesis", lambda: sentence_correspondence(composite))
        check(
            "composite: the thesis row is `refused`",
            lambda: row_shape(composite, expected_rows(composite, thesis=("refused", ""), runtime=False, vocabulary=[])),
        )
        check("mixed: the correspondence holds subject by subject", lambda: sentence_correspondence(mixed))
        check(
            "mixed: an unresolved declination leaves the vocabulary row and a recorded term does not",
            lambda: row_shape(mixed, expected_rows(mixed, thesis=None, runtime=True, vocabulary=["B-02"])),
        )

        # -- 2. the control: a store with every slot filled ---------------------
        def filled_empty() -> str | None:
            rows = filled.rows()
            if isinstance(rows, str):
                return rows
            if rows != []:
                return f"a store with every slot filled returns {rows}, not an empty list"
            printed = [
                s
                for s in (*ALL_THESIS, RUNTIME_SENTENCE, VOCABULARY_SENTENCE)
                if s in filled.page("index.md") + filled.page("architecture.md")
                + filled.subsystem_page("B-01")[1] + filled.subsystem_page("B-02")[1]
            ]
            if printed:
                return f"the filled store still prints {printed}"
            if THESIS_BODY.strip() not in filled.page("index.md"):
                return "the filled store does not publish its thesis"
            return None

        check("filled: the census is an empty list and no sentence is printed", filled_empty)

        # -- 3. no other empty-state sentence is a slot -------------------------
        def only_three_slots() -> str | None:
            for fx in (empty, refused, mixed):
                rows = fx.rows()
                if isinstance(rows, str):
                    return rows
                for r in rows:
                    if r.get("slot") not in SLOTS_IN_SCOPE:
                        return f"{fx.name} carries a row for `{r.get('slot')}`"
            seams = empty.page("seams.md") + empty.page("architecture.md")
            if not any(s in seams for s in NOT_SLOTS):
                return "the empty fixture prints none of the empty-state sentences the control needs"
            return None

        check("an empty-state sentence that is not a slot has no row", only_three_slots)

        # -- 4. nothing halts, and clean-publish carries the same rows ----------
        def never_halts() -> str | None:
            for fx in (empty, mixed):
                if fx.outcome.get("returncode") != 0 or fx.summary.get("ok") is not True:
                    return (
                        f"the {fx.name} publication failed with unfilled slots —"
                        f" exit {fx.outcome.get('returncode')}, ok {fx.summary.get('ok')},"
                        f" warnings {fx.summary.get('warnings')}"
                    )
            again = publish(empty.storage, "--clean-publish")
            summary = again["summary"]
            if not isinstance(summary, dict) or summary.get("unfilled_slots") != empty.summary.get("unfilled_slots"):
                return "the clean-publish summary does not carry the same unfilled_slots"
            if summary.get("published") is not True:
                return "a clean publish with unfilled slots did not publish"
            return None

        check("publication does not halt on an unfilled slot", never_halts)

        # -- 5. PLACEHOLDER_SENTENCES ------------------------------------------
        def placeholder_sentences() -> str | None:
            sys.path.insert(0, str(ROOT))
            try:
                from amanuensis_materializer import renderers  # noqa: PLC0415
            except Exception as exc:
                return f"the renderers could not be imported — {scrub(exc)}"
            sentences = getattr(renderers, "PLACEHOLDER_SENTENCES", None)
            if not isinstance(sentences, tuple) or not sentences or not all(isinstance(s, str) for s in sentences):
                return "PLACEHOLDER_SENTENCES is not exported from the materializer as a tuple of strings"
            source = read(MEASURE_FILE)
            block = re.search(r"MEASURE_PLACEHOLDERS\s*=\s*\[(.*?)\];", source, re.S)
            if block is None:
                return "dev/measure-reader-prose.mjs no longer declares MEASURE_PLACEHOLDERS"
            measured = [json.loads(m) for m in re.findall(r'"(?:[^"\\]|\\.)*"', block.group(1))]
            if len(measured) != 6:
                return f"MEASURE_PLACEHOLDERS holds {len(measured)} strings, not six"
            for needle in measured:
                if not any(needle in s for s in sentences):
                    return f"the measured string `{needle}` occurs in no sentence the materializer emits"
            for s in sentences:
                if any(n in s for n in NOT_SLOTS):
                    return f"PLACEHOLDER_SENTENCES holds `{s}`, which is not a slot"
            pages = "\n".join(
                [empty.page("index.md"), refused.page("index.md"), composite.page("index.md"), empty.page("architecture.md")]
                + [empty.subsystem_page(sid)[1] for sid in ("B-01", "B-02")]
            )
            for s in sentences:
                if s.rstrip(".") not in pages and s.split(";")[0].rstrip(".") not in pages:
                    return f"PLACEHOLDER_SENTENCES holds a sentence no fixture page prints: `{s[:48]}…`"
            return None

        check("PLACEHOLDER_SENTENCES covers the six measured strings and prints", placeholder_sentences)

        # -- 6. the skill text and the renderer name the same headings ----------
        def pattern_parity() -> str | None:
            sys.path.insert(0, str(ROOT))
            from amanuensis_materializer.renderers import THESIS_SECTION_PATTERN  # noqa: PLC0415

            for path in (ONBOARDING, TEMPLATES):
                text = read(path)
                if not text:
                    return f"{path.name} is not readable"
                named = re.findall(r"^#{1,6}\s*What is this[^\n`]*$|`(#{1,6}\s*What is this[^`\n]*)`", text, re.M | re.I)
                headings = [h for h in named if h] + re.findall(r"^(#{1,6}\s*What is this[^\n`]*)$", text, re.M | re.I)
                if "## What is this codebase?" not in headings:
                    return f"{path.name} does not name the heading `## What is this codebase?` literally"
                for heading in headings:
                    if not THESIS_SECTION_PATTERN.match(heading):
                        return f"THESIS_SECTION_PATTERN does not match `{heading}` from {path.name}"
            return None

        check("THESIS_SECTION_PATTERN matches the heading both skill files name", pattern_parity)

        def read_back(path: Path) -> str | None:
            """Build the records out of the skill text and let the materializer read them."""

            text = read(path)
            heading = next(
                iter(
                    re.findall(r"^(#{1,6}\s*What is this[^\n`]*)$", text, re.M | re.I)
                    + re.findall(r"`(#{1,6}\s*What is this[^`\n]*)`", text, re.I)
                ),
                "",
            )
            runtime = re.search(
                r"^(#{1,6}\s+Runtime boundary map\s*\n\n(?:\|[^\n]*\n){2})", text, re.M | re.I
            )
            if not heading:
                return f"{path.name} has no thesis heading line to build a record from"
            if runtime is None:
                return f"{path.name} has no `## Runtime boundary map` heading followed by a table header"
            store = Fixture(
                root,
                f"parity-{path.stem}",
                entry=f"# Entry point\n\n{heading}\n\n{THESIS_BODY}",
                onboarding=f"# Onboarding report\n\n{runtime.group(1)}| worker | TypeScript | store | SQL | drains jobs |\n",
                vocab={"B-01": "term", "B-02": "declined"},
            )
            rows = store.rows()
            if isinstance(rows, str):
                return rows
            if rows != []:
                return (
                    f"a record built from {path.name}'s headings is not read back: "
                    f"{[(r.get('slot'), r.get('subject')) for r in rows]}"
                )
            if "| worker |" not in store.page("architecture.md"):
                return f"the runtime table built from {path.name} is not on the architecture page"
            return None

        check("the onboarding text builds a thesis and a runtime table the renderer reads", lambda: read_back(ONBOARDING))
        check("the artifact templates build a thesis and a runtime table the renderer reads", lambda: read_back(TEMPLATES))

        def onboarding_asks() -> str | None:
            text = read(ONBOARDING)
            if "## Runtime boundary map" not in text:
                return "onboarding.md does not name `## Runtime boundary map`"
            sys.path.insert(0, str(ROOT))
            try:
                from amanuensis_materializer import diagrams  # noqa: PLC0415
            except Exception as exc:
                return f"diagrams could not be imported — {scrub(exc)}"
            headers = getattr(diagrams, "_RUNTIME_BOUNDARY_HEADERS", ())
            header_line = next(
                (
                    ln
                    for ln in text.splitlines()
                    if ln.lstrip().startswith("|")
                    and tuple(c.strip().lower() for c in ln.strip().strip("|").split("|")) == tuple(headers)
                ),
                None,
            )
            if not headers or header_line is None:
                return "onboarding.md does not carry the five column names diagrams.py requires, as one table header"
            return None

        check("onboarding.md names the runtime heading and its five columns", onboarding_asks)

        # -- 7. packaging step 5 ------------------------------------------------
        def packaging() -> str | None:
            text = read(PACKAGING)
            match = re.search(r"^### 5\.[^\n]*\n(.*?)(?=^### 6\.)", text, re.S | re.M)
            if match is None:
                return "phase-5-packaging.md has no step 5"
            step = match.group(1)
            if "unfilled_slots" not in step:
                return "phase-5-packaging.md step 5 does not read unfilled_slots"
            if not re.search(r"\bfill", step, re.I) or not re.search(r"\breport", step, re.I):
                return "step 5 does not say each row is filled or reported"
            if not re.search(r"each row", step, re.I):
                return "step 5 does not treat each row"
            if not re.search(r"summary", step, re.I):
                return "step 5 does not say where an unfilled row is reported"
            return None

        check("phase-5 step 5 reads unfilled_slots and fills or reports each row", packaging)

        # -- 8. nothing calls the census a gate or a guard -----------------------
        def not_a_guard() -> str | None:
            seen = 0
            for path in CENSUS_TEXT:
                text = read(path)
                if not text:
                    return f"{path.name} is not readable"
                blocks = re.split(r"\n\s*\n", text)
                for block in blocks:
                    sentences = re.split(r"(?<=[.!?])\s+", " ".join(block.split()))
                    for sentence in sentences:
                        if not re.search(r"unfilled[_ ]slot|census", sentence, re.I):
                            continue
                        seen += 1
                        hit = re.search(r"\b(gate|guard)s?\b", sentence, re.I)
                        if hit:
                            return f"{path.name} calls the census a {hit.group(0).lower()}: {sentence[:80]}"
            if seen < 4:
                return f"only {seen} sentences across the census text mention it"
            return None

        check("no text calls the census a gate or a guard", not_a_guard)
    finally:
        shutil.rmtree(root, ignore_errors=True)

    # -- CI ------------------------------------------------------------------
    def runs_in_ci() -> str | None:
        text = read(CI_FILE)
        if not text:
            return "the CI workflow .github/workflows/test.yml is not readable"
        if not re.search(r"python3 test-placeholder-census\.py", text):
            return "the workflow does not run test-placeholder-census.py"
        return None

    check("the gate runs in CI", runs_in_ci)

    emit("")
    if FAILURES:
        emit(f"GATE {PACKET} RED: {FAILURES[0][1]}")
        return 1
    emit(f"GATE {PACKET} GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
