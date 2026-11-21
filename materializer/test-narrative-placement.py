#!/usr/bin/env python3
"""Gate for explanation packet EX4 — the survey narrative sits inside Structure
when claims exist (spec.md §2.3, rows 1 and 2; claims C7, C41).

Seeds four subsystems, each with a registered survey artifact whose prose carries
one sentinel line:

  B-01  one or more current claims, an artifact   → the narrative is inside
        Structure, after the last claim group, under a `Survey narrative` heading
  B-02  no claim, an artifact                      → today's page, unchanged
  B-03  claims, no artifact                        → no narrative heading at all
  B-04  no claim, no artifact                      → no narrative heading at all

Turns red when:

  - B-01's Structure does not end with `### Survey narrative` after the last
    claim group, led by the NARRATIVE_LABEL sentence and the provenance, with the
    artifact's prose nested beneath it;
  - the sentinel appears other than once on B-01's page, or its `## Survey record`
    does not carry `### Survey artifact` with the one pointer sentence and the
    provenance;
  - B-02 stops rendering the narrative under `### Structural inventory not
    recorded as claims`, with today's sentence and today's pointer in its survey
    record;
  - a subsystem with no artifact renders a narrative heading;
  - the placement helper is absent or does not decide placement from
    (has_account, has_claims, has_artifact) as §2.3 tabulates it;
  - the gate is not listed in `.github/workflows/test.yml`.

False green it cannot exclude: the narrative is placed correctly and still reads
badly beside the claims. This gate asserts where the prose is, not how it reads.

Output protocol: exactly one status line, last, on stdout. Every subprocess is
captured and never echoed, and every message is scrubbed, so a missing
deliverable reports as an assertion failure and not as a crash.
"""

from __future__ import annotations

import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from collections.abc import Callable
from html.parser import HTMLParser
from pathlib import Path

from store_only_seed import import_body

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
SCHEMA = REPO / "mcp-server" / "src" / "schema.sql"
CI_FILE = REPO / ".github" / "workflows" / "test.yml"

PACKET = "EX4"
RED_EXPECT = "the survey narrative is not inside Structure for a subsystem with claims"

NARRATIVE_LABEL = "Narrative from the survey artifact; not individually bound to a revision"
NO_CLAIMS_HEADING = "Structural inventory not recorded as claims"
POINTER = "The survey artifact is rendered above, under Structure."

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
SHA = "aaaaaaaaaaaa1111aaaaaaaaaaaa1111aaaaaaaa"
SENTINEL = "SENTINEL-NARRATIVE-{sid}: the scheduler drains one queue per tick"
HASH = "0123456789abcdef0123456789abcdef"
WRITTEN = "2026-10-02 09:30:00"

SUBSYSTEMS = (
    ("B-01", "Read path", True, True),
    ("B-02", "Write path", False, True),
    ("B-03", "Queue", True, False),
    ("B-04", "Cache", False, False),
)


def sentinel(sid: str) -> str:
    return SENTINEL.format(sid=sid)


def artifact_path(sid: str) -> str:
    return f"{sid}-survey.md"


def artifact_text(sid: str) -> str:
    return f"# {sid} survey\n\n{sentinel(sid)}\n\n## Details\n\nA second paragraph.\n"


def provenance(sid: str) -> str:
    """The provenance as a reader sees it; code spans are `<code>` elements."""

    return f"{artifact_path(sid)} at content hash {HASH[:12]}, recorded at {SHA[:12]}, written on {WRITTEN[:10]}"


def seed(storage: Path) -> None:
    db = sqlite3.connect(storage / "memory.db")
    db.executescript(SCHEMA.read_text())
    cur = db.cursor()
    cur.execute(
        "INSERT INTO git_state (repo_id, canonical_branch, onboarding_sha,"
        " last_checked_sha, last_checked_at)"
        " VALUES ('default', 'main', ?, ?, '2026-11-05T12:00:00Z')",
        (SHA, SHA),
    )
    cur.execute("INSERT INTO sessions (session_id, intent) VALUES ('ex4', 'fixture')")
    for sid, name, has_claims, has_artifact in SUBSYSTEMS:
        cur.execute(
            "INSERT INTO subsystems (id, name, status, layer) VALUES (?, ?, 'mapped', 'backend')",
            (sid, name),
        )
        if has_claims:
            for n, segment in enumerate(("recoverability", "trust")):
                cur.execute(
                    "INSERT INTO claims (claim_id, claim_key, subject_type, subject_id,"
                    " statement, epistemic_kind, asserted_at_sha, valid_from_sha, session_id)"
                    " VALUES (?, ?, 'subsystem', ?, ?, 'observation', ?, ?, 'ex4')",
                    (
                        f"{sid}-c{n}",
                        f"{sid}/{segment}/x",
                        sid,
                        f"STATEMENT {sid} {segment}",
                        SHA,
                        SHA,
                    ),
                )
        if has_artifact:
            # The page reads the body the import stored, never a file in storage
            # (store-only PLAN §3.3).
            import_body(
                db,
                artifact_path(sid),
                "subsystem-survey",
                artifact_text(sid),
                session_id="ex4",
                subsystem_id=sid,
                ref_sha=SHA,
                written_at=WRITTEN,
                registered_hash=HASH,
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


class Node:
    def __init__(self, tag: str, parent: Node | None, attrs: dict[str, str | None]) -> None:
        self.tag = tag
        self.parent = parent
        self.attrs = attrs
        self.children: list[Node | str] = []

    def text(self) -> str:
        return "".join(c if isinstance(c, str) else c.text() for c in self.children)

    def walk(self):
        yield self
        for child in self.children:
            if isinstance(child, Node):
                yield from child.walk()


_VOID = {"br", "hr", "img", "meta", "link", "input"}


class TreeBuilder(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = Node("#root", None, {})
        self.cursor = self.root

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        node = Node(tag, self.cursor, dict(attrs))
        self.cursor.children.append(node)
        if tag not in _VOID:
            self.cursor = node

    def handle_endtag(self, tag: str) -> None:
        node: Node | None = self.cursor
        while node is not None and node.tag != tag:
            node = node.parent
        if node is not None and node.parent is not None:
            self.cursor = node.parent

    def handle_data(self, data: str) -> None:
        self.cursor.children.append(data)


def parse_html(text: str) -> Node:
    builder = TreeBuilder()
    builder.feed(text)
    return builder.root


HEADINGS = {"h1": 1, "h2": 2, "h3": 3, "h4": 4, "h5": 5, "h6": 6}


def heading_text(node: Node) -> str:
    """A heading's words, without the `§` anchor link every heading carries."""

    return " ".join(node.text().removeprefix("§").split())


def flat(blocks: list[Node]) -> str:
    return " ".join(" ".join(b.text().split()) for b in blocks)


def section(page: Node, heading: str) -> list[Node]:
    """The blocks of the `<section>` whose `<h2>` reads `heading`, heading excluded."""

    for node in page.walk():
        if node.tag != "section":
            continue
        kids = [c for c in node.children if isinstance(c, Node)]
        if kids and kids[0].tag == "h2" and heading_text(kids[0]) == heading:
            return kids[1:]
    return []


def under(blocks: list[Node], heading: str, level: int = 3) -> list[Node]:
    """The blocks after the level-`level` heading `heading`, up to the next heading
    of that level or higher; deeper headings stay inside, as the narrative's own do."""

    body: list[Node] = []
    inside = False
    for block in blocks:
        depth = HEADINGS.get(block.tag, 0)
        if not inside:
            inside = depth == level and heading_text(block) == heading
            continue
        if 0 < depth <= level:
            break
        body.append(block)
    return body


def subsystem_page(docs: Path, sid: str) -> Node | None:
    pages = sorted((docs / "subsystems").glob(f"{sid.lower().replace('-', '')}-*.html"))
    return parse_html(read(pages[0])) if pages else None


def h3s(blocks: list[Node]) -> list[str]:
    return [heading_text(b) for b in blocks if b.tag == "h3"]


def placement_helper() -> Callable[..., str] | None:
    sys.path.insert(0, str(ROOT))
    try:
        from amanuensis_materializer import renderers  # noqa: PLC0415
    except Exception:
        return None
    fn = getattr(renderers, "narrative_placement", None)
    return fn if callable(fn) else None


def main() -> int:
    emit("GATE EX4 — the survey narrative sits inside Structure when claims exist")
    emit("")
    root = Path(tempfile.mkdtemp(prefix="amanuensis-ex4-"))
    try:
        storage = root / "store"
        storage.mkdir()
        seed_error: str | None = None
        try:
            seed(storage)
        except Exception as exc:
            seed_error = f"the fixture could not be seeded — {scrub(exc)}"
        outcome = publish(storage) if seed_error is None else {}
        docs = storage / "docs"
        pages = {sid: subsystem_page(docs, sid) for sid, *_ in SUBSYSTEMS}

        def published() -> str | None:
            if seed_error:
                return seed_error
            if outcome.get("returncode") != 0:
                return f"the materializer failed — {outcome.get('diagnostic')}"
            for sid, page in pages.items():
                if page is None:
                    return f"the {sid} subsystem page could not be read"
            return None

        # -- 1. the first assertion: the narrative is inside Structure ---------
        def narrative_inside_structure() -> str | None:
            if (why := published()):
                return why
            page = pages["B-01"]
            structure = section(page, "Structure")
            heads = h3s(structure)
            if not heads or heads[-1] != "Survey narrative":
                return f"{RED_EXPECT}: Structure's `###` headings are {heads}"
            if sum(1 for h in heads if h == "Survey narrative") != 1:
                return f"{RED_EXPECT}: more than one `### Survey narrative`"
            if heads.index("Survey narrative") != len(heads) - 1 or len(heads) < 3:
                return f"{RED_EXPECT}: it does not follow the claim groups {heads}"
            body = under(structure, "Survey narrative")
            if sentinel("B-01") not in flat(body):
                return f"{RED_EXPECT}: the artifact's prose is not under `### Survey narrative`"
            lead = next((flat([b]) for b in body if flat([b])), "")
            want = f"{NARRATIVE_LABEL}. Its source is {provenance('B-01')}."
            if lead != want:
                return f"the narrative opens `{lead}`, not `{want}`"
            if not any(b.tag == "h5" and heading_text(b) == "Details" for b in body):
                return "the artifact's own headings are not nested beneath the narrative"
            return None

        check("the narrative follows the last claim group inside Structure", narrative_inside_structure)

        # -- 2. exactly once, and the survey record points at it ---------------
        def once_and_pointer() -> str | None:
            if (why := published()):
                return why
            page = pages["B-01"]
            n = page.text().count(sentinel("B-01"))
            if n != 1:
                return f"the artifact's prose appears {n} times on the page, not once"
            record = section(page, "Survey record")
            if "Survey artifact" not in h3s(record):
                return "the survey record has no `### Survey artifact`"
            body = under(record, "Survey artifact")
            want = f"{POINTER} Its source is {provenance('B-01')}."
            if want not in flat(body):
                return f"the survey artifact entry reads `{flat(body)}`, not `{want}`"
            if sentinel("B-01") in flat(body):
                return "the survey record repeats the prose"
            return None

        check("the prose appears once and the survey record points at it", once_and_pointer)

        # -- 3. the control: no claim, today's page ------------------------------
        def no_claim_control() -> str | None:
            if (why := published()):
                return why
            page = pages["B-02"]
            structure = section(page, "Structure")
            heads = h3s(structure)
            if heads != [NO_CLAIMS_HEADING]:
                return f"B-02's Structure headings are {heads}, not [{NO_CLAIMS_HEADING!r}]"
            body = under(structure, NO_CLAIMS_HEADING)
            want = (
                f"No structural claim is recorded for this subsystem. {NARRATIVE_LABEL}."
                f" Its source is {provenance('B-02')}."
            )
            if want not in flat(body):
                return f"B-02's fallback sentence reads `{flat(body)[:200]}`"
            if sentinel("B-02") not in flat(body):
                return "B-02's narrative is not under the existing heading"
            if "Survey narrative" in page.text():
                return "B-02 carries a `### Survey narrative` heading"
            if page.text().count(sentinel("B-02")) != 1:
                return "B-02's prose does not appear exactly once"
            record = under(section(page, "Survey record"), "Survey artifact")
            pointer = (
                "The survey artifact is rendered above, under Structure, because no"
                " structural claim is recorded to stand in its place."
                f" Its source is {provenance('B-02')}."
            )
            if pointer not in flat(record):
                return "B-02's survey record no longer carries today's pointer"
            return None

        check("with no claim the page is today's page", no_claim_control)

        # -- 4. no artifact, no narrative heading ------------------------------
        def no_artifact() -> str | None:
            if (why := published()):
                return why
            for sid in ("B-03", "B-04"):
                page = pages[sid]
                if "Survey narrative" in page.text():
                    return f"{sid} has no artifact and carries `### Survey narrative`"
                if "Survey artifact" in h3s(section(page, "Survey record")):
                    return f"{sid} has no artifact and carries `### Survey artifact`"
            if "Survey narrative" in h3s(section(pages["B-03"], "Structure")):
                return "B-03 has claims and no artifact and renders a narrative"
            if NO_CLAIMS_HEADING not in h3s(section(pages["B-04"], "Structure")):
                return "B-04's Structure lost the existing heading"
            return None

        check("with no artifact no narrative heading renders", no_artifact)

        # -- 5. the helper EX11 will supply an account to ---------------------
        def helper() -> str | None:
            fn = placement_helper()
            if fn is None:
                return "renderers.narrative_placement is absent"
            cases = {
                (False, True, True): "structure-narrative",
                (False, False, True): "inventory-fallback",
                (True, True, True): "survey-record",
                (True, False, True): "survey-record",
            }
            seen = {}
            for (acct, claims, art), _want in cases.items():
                seen[(acct, claims, art)] = fn(has_account=acct, has_claims=claims, has_artifact=art)
            if len(set(seen.values())) != 3:
                return f"the helper does not tell three placements apart: {seen}"
            if seen[(False, True, True)] == seen[(False, False, True)]:
                return "the helper places claims and no-claims alike"
            if seen[(True, True, True)] != seen[(True, False, True)]:
                return "a recorded account does not take precedence whatever the claim count"
            if seen[(True, True, True)] in (seen[(False, True, True)], seen[(False, False, True)]):
                return "a recorded account is placed as if it were absent"
            for acct in (False, True):
                for claims in (False, True):
                    absent = fn(has_account=acct, has_claims=claims, has_artifact=False)
                    if absent in seen.values():
                        return "with no artifact the helper still names a placement"
            return None

        check("one helper decides placement from account, claims and artifact", helper)
    finally:
        shutil.rmtree(root, ignore_errors=True)

    # -- CI ------------------------------------------------------------------
    def runs_in_ci() -> str | None:
        text = read(CI_FILE)
        if not text:
            return "the CI workflow .github/workflows/test.yml is not readable"
        if not re.search(r"python3 test-narrative-placement\.py", text):
            return "the workflow does not run test-narrative-placement.py"
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
