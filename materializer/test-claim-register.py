#!/usr/bin/env python3
"""Gate for explanation packet EX3 — claims as a readable register (spec.md
§2.2; claims C4, C5, C6, C41).

Seeds a store whose subsystem B-01 carries claims keyed `<sid>/recoverability/…`,
`<sid>/key-type/…`, `<sid>/storage-lifecycle/…` and `<sid>/trust/…`, plus one claim
whose key is outside B-01's namespace that is reached through its evidence, and
whose evidence covers a ranged row, an unranged row, a `contradicts` row, a
`qualifies` row and no row at all. It materializes the store and reads the
subsystem page in Markdown and in HTML.

Turns red when:

  - a claim's statement is not the first text of a list item, or its record is
    not one nested list item four spaces deeper, or a claim has a heading of its
    own;
  - a record's coordinates differ from `claim key · subject · epistemic kind
    label · asserted at · evidence:` as §2.2 fixes them;
  - the evidence text lacks `:<line_range>` for a ranged row, shows a range for
    an unranged one, omits the role of a row that is not `supports`, prints a
    role for one that is, lists rows out of evidence id order, or does not say
    `evidence: none attached` for a claim with no row;
  - a claim lands under a heading other than the one its key's segment names,
    the groups are out of order (recognised kinds, other segments
    alphabetically, **Other claims**), or **Other claims** holds a claim whose
    key is inside the subsystem's namespace or is printed in a subsystem that
    has no such claim;
  - the HTML page does not render each statement as its own `<li>` whose
    coordinates are a nested `<ul>`, or the nested list needs a script;
  - the gate is not listed in `.github/workflows/test.yml`.

False green it cannot exclude: the record is ordered correctly and still hard to
read. This gate asserts the structure of the register, not that a reader finds it
short.

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
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
SCHEMA = REPO / "mcp-server" / "src" / "schema.sql"
VOCABULARY = REPO / "mcp-server" / "contracts" / "conspectus-vocabulary.json"
CI_FILE = REPO / ".github" / "workflows" / "test.yml"

PACKET = "EX3"
RED_EXPECT = "a claim's statement does not lead its record"

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
SHA_A = "aaaaaaaaaaaa1111aaaaaaaaaaaa1111aaaaaaaa"
SHA_B = "bbbbbbbbbbbb2222bbbbbbbbbbbb2222bbbbbbbb"
SHORT_A = f"`{SHA_A[:12]}`"
SHORT_B = f"`{SHA_B[:12]}`"

# claim id → (key, subject, statement, epistemic kind, asserted-at sha,
#             evidence rows as (path, line_range, role) in insertion order)
CLAIMS: dict[str, tuple[str, str, str, str, str, tuple[tuple[str, str | None, str], ...]]] = {
    "c1": (
        "B-01/recoverability/x",
        "B-01",
        "STATEMENT recoverability x: a checkpoint is recoverable from Git",
        "observation",
        SHA_A,
        (("src/wal.ts", "10-20", "supports"),),
    ),
    "c1b": (
        "B-01/recoverability/a",
        "B-01",
        "STATEMENT recoverability a: the log is replayed in order",
        "inference",
        SHA_B,
        (("src/replay.ts", None, "supports"),),
    ),
    "c2": (
        "B-01/key-type/y",
        "src/keys.ts",
        "STATEMENT key-type y: a row key is an opaque string",
        "hypothesis",
        SHA_A,
        (("src/keys.ts", None, "supports"),),
    ),
    "c3": (
        "B-01/storage-lifecycle/z",
        "B-01",
        "STATEMENT storage-lifecycle z: pages are never rewritten in place",
        "direct-intent",
        SHA_B,
        (("src/pages.ts", None, "contradicts"), ("src/free.ts", "5-9", "qualifies")),
    ),
    "c4": (
        "B-01/trust/w",
        "B-01",
        "STATEMENT trust w: callers are not authenticated here",
        "open-question",
        SHA_A,
        (),
    ),
    # Subject B-02, key outside B-01's namespace, reached through evidence that
    # cites a file in B-01's ledger.
    "c5": (
        "B-02/flow/q",
        "B-02",
        "STATEMENT outside q: the writer drains B-01's queue",
        "inferred-intent",
        SHA_B,
        (("src/queue.ts", "1-4", "supports"),),
    ),
    # B-03 carries only claims inside its own namespace.
    "c6": (
        "B-03/flow/a",
        "B-03",
        "STATEMENT inside only a: the queue is first-in first-out",
        "decision",
        SHA_A,
        (),
    ),
}

# Under B-01: heading → claim ids, in the order the page must print them.
EXPECTED_B01: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Key types", ("c2",)),
    ("Recoverability", ("c1b", "c1")),
    ("Storage lifecycle", ("c3",)),
    ("Trust", ("c4",)),
    ("Other claims", ("c5",)),
)

SUBSYSTEMS = (
    ("B-01", "Read path"),
    ("B-02", "Write path"),
    ("B-03", "Queue"),
)


def epistemic_labels() -> dict[str, str]:
    data = json.loads(VOCABULARY.read_text())
    return {v["value"]: v["label"] for v in data["enums"]["claim_epistemic_kind"]["values"]}


def seed(storage: Path) -> None:
    db = sqlite3.connect(storage / "memory.db")
    db.executescript(SCHEMA.read_text())
    cur = db.cursor()
    cur.execute(
        "INSERT INTO git_state (repo_id, canonical_branch, onboarding_sha,"
        " last_checked_sha, last_checked_at)"
        " VALUES ('default', 'main', ?, ?, '2026-11-05T12:00:00Z')",
        (SHA_A, SHA_A),
    )
    cur.execute("INSERT INTO sessions (session_id, intent) VALUES ('ex3', 'fixture')")
    for sid, name in SUBSYSTEMS:
        cur.execute(
            "INSERT INTO subsystems (id, name, status, layer) VALUES (?, ?, 'mapped', 'backend')",
            (sid, name),
        )
    cur.execute(
        "INSERT INTO file_ledger (subsystem_id, file_path, classification, ref_sha)"
        " VALUES ('B-01', 'src/queue.ts', 'examined', ?)",
        (SHA_A,),
    )
    for claim_id, (key, subject, statement, kind, sha, rows) in CLAIMS.items():
        subject_type = "file" if "/" in subject else "subsystem"
        cur.execute(
            "INSERT INTO claims (claim_id, claim_key, subject_type, subject_id, statement,"
            " epistemic_kind, asserted_at_sha, valid_from_sha, session_id)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ex3')",
            (claim_id, key, subject_type, subject, statement, kind, sha, sha),
        )
        for path, line_range, role in rows:
            cur.execute(
                "INSERT INTO evidence (file_path, line_range, ref_sha, kind, session_id)"
                " VALUES (?, ?, ?, 'code-verified', 'ex3')",
                (path, line_range, sha),
            )
            cur.execute(
                "INSERT INTO claim_evidence (claim_id, evidence_id, role)"
                " VALUES (?, last_insert_rowid(), ?)",
                (claim_id, role),
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


def subsystem_page(docs: Path, sid: str, suffix: str) -> str:
    pages = sorted((docs / "subsystems").glob(f"{sid.lower().replace('-', '')}-*.{suffix}"))
    return read(pages[0]) if pages else ""


def groups(structure: str) -> list[tuple[str, list[str]]]:
    """`###` headings under Structure and the lines under each, in page order."""

    out: list[tuple[str, list[str]]] = []
    for line in structure.splitlines():
        if line.startswith("### "):
            out.append((line[4:].strip(), []))
        elif out:
            out[-1][1].append(line)
    return out


def evidence_text(claim_id: str) -> str:
    rows = CLAIMS[claim_id][5]
    if not rows:
        return "evidence: none attached"
    parts = []
    for path, line_range, role in rows:
        cited = f"`{path}:{line_range}`" if line_range else f"`{path}`"
        parts.append(cited if role == "supports" else f"{cited} ({role})")
    return "evidence: " + ", ".join(parts)


def record_line(claim_id: str, labels: dict[str, str]) -> str:
    key, subject, _statement, kind, sha, _rows = CLAIMS[claim_id]
    return (
        f"    - `{key}` · subject `{subject}` · {labels[kind]} · asserted at `{sha[:12]}`"
        f" · {evidence_text(claim_id)}"
    )


# ---------------------------------------------------------------------------
# A tiny element tree, so the HTML assertions are about structure.
# ---------------------------------------------------------------------------
class Node:
    def __init__(self, tag: str, parent: Node | None) -> None:
        self.tag = tag
        self.parent = parent
        self.children: list[Node | str] = []

    def own_text(self) -> str:
        return "".join(c for c in self.children if isinstance(c, str))

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
        self.root = Node("#root", None)
        self.cursor = self.root

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        node = Node(tag, self.cursor)
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


def main() -> int:
    emit("GATE EX3 — claims as a readable register, grouped by recorded segment")
    emit("")
    labels: dict[str, str] = {}
    label_error: str | None = None
    try:
        labels = epistemic_labels()
    except Exception as exc:
        label_error = f"the epistemic-kind labels could not be read — {scrub(exc)}"

    root = Path(tempfile.mkdtemp(prefix="amanuensis-ex3-"))
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
        page_md = subsystem_page(docs, "B-01", "md")
        page_html = subsystem_page(docs, "B-01", "html")
        structure = section(page_md, "Structure")
        claim_groups = groups(structure)

        def published() -> str | None:
            if seed_error:
                return seed_error
            if label_error:
                return label_error
            if outcome.get("returncode") != 0:
                return f"the materializer failed — {outcome.get('diagnostic')}"
            if not structure:
                return "the B-01 page has no Structure section"
            return None

        # -- 1. the first assertion: each statement leads its record -------------
        def statement_leads() -> str | None:
            if (why := published()):
                return why
            lines = structure.splitlines()
            for claim_id, (key, _s, statement, *_rest) in CLAIMS.items():
                if claim_id in ("c5", "c6"):
                    continue
                item = f"- {statement}"
                if item not in lines:
                    return f"{RED_EXPECT}: `{key}` has no list item `- <statement>`"
                at = lines.index(item)
                following = lines[at + 1] if at + 1 < len(lines) else ""
                if not following.startswith("    - `"):
                    return f"{RED_EXPECT}: the record of `{key}` is not one nested item"
                if page_md.index(statement) > page_md.index(f"`{key}`"):
                    return f"{RED_EXPECT}: `{key}` precedes its statement"
            return None

        check("each claim's statement leads its record", statement_leads)

        # -- 2. the record's coordinates --------------------------------------
        def coordinates() -> str | None:
            if (why := published()):
                return why
            lines = structure.splitlines()
            for claim_id, (key, _s, statement, *_rest) in CLAIMS.items():
                if claim_id == "c6":
                    continue
                item = f"- {statement}"
                if item not in lines:
                    return f"`{key}` has no list item"
                at = lines.index(item)
                got = lines[at + 1] if at + 1 < len(lines) else ""
                want = record_line(claim_id, labels)
                if got != want:
                    return f"the record of `{key}` is `{got}`, not `{want}`"
                if len(lines[at + 1 :]) > 1 and lines[at + 2].startswith("    "):
                    return f"the record of `{key}` is more than one nested item"
            return None

        check("each record carries key, subject, kind, revision and evidence", coordinates)

        # -- 3. no claim has a heading of its own -----------------------------
        def no_claim_heading() -> str | None:
            if (why := published()):
                return why
            for line in page_md.splitlines():
                if line.startswith("#") and any(
                    c[0] in line or c[2] in line for c in CLAIMS.values()
                ):
                    return f"a claim has a heading: {line[:80]}"
            return None

        check("no claim has a heading of its own", no_claim_heading)

        # -- 4. grouping -------------------------------------------------------
        def grouping() -> str | None:
            if (why := published()):
                return why
            headings = [g[0] for g in claim_groups]
            want = [h for h, _ in EXPECTED_B01]
            if headings != want:
                return f"the groups are {headings}, not {want}"
            for heading, claim_ids in EXPECTED_B01:
                body = "\n".join(dict(claim_groups)[heading])
                found = [
                    cid
                    for cid, c in CLAIMS.items()
                    if cid != "c6" and f"- {c[2]}" in body.splitlines()
                ]
                wanted = list(claim_ids)
                if sorted(found) != sorted(wanted):
                    return f"under `{heading}` are {sorted(found)}, not {sorted(wanted)}"
                if heading == "Recoverability":
                    keys = [
                        k for k in re.findall(r"^    - `([^`]+)`", body, flags=re.M)
                    ]
                    if keys != sorted(keys):
                        return f"claims under `{heading}` are not in key order: {keys}"
            return None

        check("claims group by the segment their key names", grouping)

        def other_claims_only_outside() -> str | None:
            if (why := published()):
                return why
            body = "\n".join(dict(claim_groups).get("Other claims", []))
            if CLAIMS["c5"][2] not in body:
                return "the claim keyed outside the namespace is not under Other claims"
            inside = [c[0] for c in CLAIMS.values() if c[0].startswith("B-01/") and c[0] in body]
            if inside:
                return f"Other claims holds claims inside the namespace: {inside}"
            sibling = section(subsystem_page(docs, "B-03", "md"), "Structure")
            headings = [g[0] for g in groups(sibling)]
            if "Other claims" in headings:
                return "a subsystem with only in-namespace claims prints Other claims"
            if "Flow steps" not in headings:
                return f"B-03's `flow` claim is not under Flow steps: {headings}"
            return None

        check("Other claims holds only claims outside the namespace", other_claims_only_outside)

        # -- 5. evidence text, case by case ------------------------------------
        def evidence_cases() -> str | None:
            if (why := published()):
                return why
            cases = {
                "a ranged row": ("c1", "evidence: `src/wal.ts:10-20`"),
                "an unranged row": ("c1b", "evidence: `src/replay.ts`"),
                "contradicts and qualifies rows, in evidence id order": (
                    "c3",
                    "evidence: `src/pages.ts` (contradicts), `src/free.ts:5-9` (qualifies)",
                ),
                "no row": ("c4", "evidence: none attached"),
            }
            for label, (claim_id, text) in cases.items():
                line = next(
                    (l for l in structure.splitlines() if l.startswith(f"    - `{CLAIMS[claim_id][0]}`")),
                    "",
                )
                if not line.endswith(text):
                    return f"{label}: `{line}` does not end with `{text}`"
            return None

        check("the evidence text for ranged, unranged, contradicting and absent rows", evidence_cases)

        # -- 6. HTML: each statement an <li>, coordinates a nested <ul> --------
        def html_nesting() -> str | None:
            if (why := published()):
                return why
            if not page_html:
                return "the B-01 page has no HTML projection"
            tree = parse_html(page_html)
            items = [n for n in tree.walk() if n.tag == "li"]
            for claim_id, (key, _s, statement, *_rest) in CLAIMS.items():
                if claim_id in ("c5", "c6"):
                    # c5 and c6 are asserted on the pages that carry them below.
                    continue
                own = [li for li in items if li.own_text().strip() == statement]
                if len(own) != 1:
                    return f"`{key}`: the statement is {len(own)} `<li>` elements of its own, not one"
                nested = [c for c in own[0].children if isinstance(c, Node) and c.tag == "ul"]
                if len(nested) != 1:
                    return f"`{key}`: the `<li>` has {len(nested)} nested `<ul>`, not one"
                record = [c for c in nested[0].children if isinstance(c, Node) and c.tag == "li"]
                if len(record) != 1 or key not in record[0].text():
                    return f"`{key}`: the nested `<ul>` is not one `<li>` carrying the key"
                want = evidence_text(claim_id)
                if want not in record[0].text().replace(" ", " "):
                    return f"`{key}`: the nested record's text lacks `{want}`"
                if any(n.tag == "script" for n in own[0].walk()):
                    return f"`{key}`: the nested list needs a script"
                if statement in record[0].text():
                    return f"`{key}`: the statement is repeated inside its record"
            return None

        check("HTML renders each statement as an <li> with a nested <ul>", html_nesting)

        def html_other_claim() -> str | None:
            if (why := published()):
                return why
            tree = parse_html(page_html)
            statement = CLAIMS["c5"][2]
            own = [n for n in tree.walk() if n.tag == "li" and n.own_text().strip() == statement]
            if len(own) != 1:
                return f"the outside claim is {len(own)} `<li>` elements of its own, not one"
            if not any(isinstance(c, Node) and c.tag == "ul" for c in own[0].children):
                return "the outside claim's coordinates are not a nested `<ul>`"
            return None

        check("HTML nests the claim reached through evidence too", html_other_claim)
    finally:
        shutil.rmtree(root, ignore_errors=True)

    # -- CI ------------------------------------------------------------------
    def runs_in_ci() -> str | None:
        text = read(CI_FILE)
        if not text:
            return "the CI workflow .github/workflows/test.yml is not readable"
        if "test-claim-register.py" not in text:
            return "the workflow does not run test-claim-register.py"
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
