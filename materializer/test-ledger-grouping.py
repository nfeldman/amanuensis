#!/usr/bin/env python3
"""Gate for explanation packet EX5 — the file ledger groups rows that share a
reason (spec.md §2.4; claim C8).

Seeds one subsystem whose ledger holds:

  - 40 `examined` rows sharing one reason and one revision;
  - two `examined` singletons, each with its own reason;
  - a `candidate` group of 3 rows and a `generated-ignore` group of 3 rows, each
    sharing a reason and each carrying a `ref_sha` (the revision it was recorded
    at, not an examination);
  - an `examined` group of 2 rows sharing a reason but recorded at two revisions;
  - an `examined` row with no reason, and one with a reason and no revision.

Turns red when:

  - a reason shared by several rows is printed more than once on the subsystem
    page;
  - a group's head line does not carry the reason in bold, the classification, the
    file count and the revision label with the short revision;
  - a path is not its own nested list item, or an anchor is absent or repeated, or
    a `files.md` link no longer resolves to an anchor on the page;
  - a candidate or exempt group says `examined at`, or an examined group does not;
  - a group with two revisions does not say `<label> 2 revisions` and give each
    path its own short revision;
  - the HTML does not carry one `<li>` per path inside a nested `<ul>`;
  - the row with no reason or no revision is not labelled as §2.4 says;
  - the groups are not in the existing order (classification, then first path);
  - the gate is not listed in `.github/workflows/test.yml`.

False green it cannot exclude: the grouping is right and the page still reads
badly. This gate asserts the structure and the labels, not how they read.

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
from hashlib import sha1
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
SCHEMA = REPO / "mcp-server" / "src" / "schema.sql"
CI_FILE = REPO / ".github" / "workflows" / "test.yml"

PACKET = "EX5"
RED_EXPECT = "a reason shared by several ledger rows is printed more than once"

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
SID = "B-01"
SHA1 = "aaaaaaaa11112222aaaaaaaa11112222aaaaaaaa"
SHA2 = "bbbbbbbb33334444bbbbbbbb33334444bbbbbbbb"
HEAD = "cccccccc55556666cccccccc55556666cccccccc"

R_SHARED = "SHARED-REASON-ALPHA: part of the queue drain loop"
R_ONE = "SINGLETON-REASON-ONE: owns the retry table"
R_TWO = "SINGLETON-REASON-TWO: owns the lease clock"
R_CAND = "CANDIDATE-REASON: scoped for the next reading"
R_EXEMPT = "EXEMPT-REASON: emitted by the schema generator"
R_MULTI = "MULTI-REASON: read twice at different revisions"
R_NOREV = "NOREV-REASON: read before revisions were kept"

# (path, why_in_scope, classification, ref_sha)
ROWS: list[tuple[str, str | None, str, str | None]] = (
    [(f"src/shared/f{n:02d}.ts", R_SHARED, "examined", SHA1) for n in range(40)]
    + [
        ("src/one.ts", R_ONE, "examined", SHA1),
        ("src/two.ts", R_TWO, "examined", SHA1),
    ]
    + [(f"src/next/c{n}.ts", R_CAND, "candidate", SHA1) for n in range(3)]
    + [(f"gen/g{n}.ts", R_EXEMPT, "generated-ignore", SHA1) for n in range(3)]
    + [
        ("src/multi/m0.ts", R_MULTI, "examined", SHA1),
        ("src/multi/m1.ts", R_MULTI, "examined", SHA2),
        ("src/noreason.ts", None, "examined", SHA1),
        ("src/norev.ts", R_NOREV, "examined", None),
    ]
)

# Group heads in the order §2.4 gives: classification, then the first path.
EXPECTED_GROUPS: list[tuple[str, str, int]] = [
    (R_CAND, "candidate", 3),
    (R_MULTI, "examined", 2),
    ("No reason recorded", "examined", 1),
    (R_NOREV, "examined", 1),
    (R_ONE, "examined", 1),
    (R_SHARED, "examined", 40),
    (R_TWO, "examined", 1),
    (R_EXEMPT, "generated-ignore", 3),
]


def anchor(path: str) -> str:
    return "le-" + sha1(f"{SID}\x00{path}".encode()).hexdigest()[:10]


def seed(storage: Path) -> None:
    db = sqlite3.connect(storage / "memory.db")
    db.executescript(SCHEMA.read_text())
    cur = db.cursor()
    cur.execute(
        "INSERT INTO git_state (repo_id, canonical_branch, onboarding_sha,"
        " last_checked_sha, last_checked_at)"
        " VALUES ('default', 'main', ?, ?, '2026-11-05T12:00:00Z')",
        (HEAD, HEAD),
    )
    cur.execute("INSERT INTO sessions (session_id, intent) VALUES ('ex5', 'fixture')")
    cur.execute(
        "INSERT INTO subsystems (id, name, status, layer) VALUES (?, 'Queue', 'mapped', 'backend')",
        (SID,),
    )
    for path, why, classification, ref in ROWS:
        cur.execute(
            "INSERT INTO file_ledger (subsystem_id, file_path, why_in_scope, classification,"
            " ref_sha, examined_at) VALUES (?, ?, ?, ?, ?, ?)",
            (
                SID,
                path,
                why,
                classification,
                ref,
                "2026-11-05T11:00:00Z" if classification == "examined" else None,
            ),
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


def subsystem_file(docs: Path, suffix: str) -> Path | None:
    pages = sorted((docs / "subsystems").glob(f"b01-*.{suffix}"))
    return pages[0] if pages else None


HEAD_LINE = re.compile(r"^- \*\*(?P<why>.+?)\*\* — (?P<cls>[a-z-]+), (?P<n>\d+) files?, (?P<rev>.*)$")


def parse_groups(ledger: str) -> list[dict[str, object]]:
    """Each top-level `- **reason**` line with the nested items beneath it."""

    groups: list[dict[str, object]] = []
    for line in ledger.splitlines():
        m = HEAD_LINE.match(line)
        if m:
            groups.append({**m.groupdict(), "head": line, "items": []})
        elif groups and re.match(r"^\s+- ", line):
            groups[-1]["items"].append(line)  # type: ignore[union-attr]
    return groups


def main() -> int:
    emit("GATE EX5 — the file ledger groups rows that share a reason")
    emit("")
    root = Path(tempfile.mkdtemp(prefix="amanuensis-ex5-"))
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
        md_path = subsystem_file(docs, "md")
        html_path = subsystem_file(docs, "html")
        page = read(md_path) if md_path else ""
        html = read(html_path) if html_path else ""
        files_md = read(docs / "files.md")
        ledger = section(page, "File ledger", level=3)
        groups = parse_groups(ledger)

        def published() -> str | None:
            if seed_error:
                return seed_error
            if outcome.get("returncode") != 0:
                return f"the materializer failed — {outcome.get('diagnostic')}"
            if not page or not ledger.strip():
                return "the subsystem page or its file ledger could not be read"
            return None

        # -- 1. the first assertion: a shared reason prints once ---------------
        def reason_once() -> str | None:
            if (why := published()):
                return why
            for reason in (R_SHARED, R_CAND, R_EXEMPT, R_MULTI):
                n = ledger.count(reason)
                if n != 1:
                    return f"{RED_EXPECT}: `{reason[:28]}…` is printed {n} times, not once"
            return None

        check("each shared reason prints once in the ledger", reason_once)

        # -- 2. group head lines ----------------------------------------------
        def heads() -> str | None:
            if (why := published()):
                return why
            seen = [(str(g["why"]), str(g["cls"]), int(str(g["n"]))) for g in groups]
            if seen != EXPECTED_GROUPS:
                return f"the groups are {seen}, not {EXPECTED_GROUPS}"
            shared = next(g for g in groups if g["why"] == R_SHARED)
            if str(shared["rev"]).strip() != f"examined at `{SHA1[:8]}`":
                return f"the shared group's revision reads `{shared['rev']}`"
            if len(shared["items"]) != 40:  # type: ignore[arg-type]
                return "the shared group does not list its 40 paths beneath it"
            return None

        check("each group's head carries reason, classification, count and revision", heads)

        # -- 3. anchors, nesting, and files.md ----------------------------------
        def anchors() -> str | None:
            if (why := published()):
                return why
            for path, *_ in ROWS:
                a = anchor(path)
                n = page.count(f'<a id="{a}"></a>')
                if n != 1:
                    return f"the anchor for `{path}` appears {n} times, not once"
                items = [ln for ln in ledger.splitlines() if f'<a id="{a}"></a>' in ln]
                if not re.match(rf'^\s{{2,}}- <a id="{a}"></a>`{re.escape(path)}`', items[0]):
                    return f"`{path}` is not its own nested list item: `{items[0].strip()[:80]}`"
            for g in groups:
                if len(g["items"]) != int(str(g["n"])):  # type: ignore[arg-type]
                    return f"the group `{str(g['why'])[:24]}` says {g['n']} files and lists {len(g['items'])}"  # type: ignore[arg-type]
            return None

        check("every path is a nested item keeping its anchor exactly once", anchors)

        def files_links() -> str | None:
            if (why := published()):
                return why
            for path, *_ in ROWS:
                a = anchor(path)
                if f"#{a})" not in files_md:
                    return f"files.md no longer links to the ledger entry for `{path}`"
                if f'<a id="{a}"></a>' not in page:
                    return f"files.md links to #{a} and the page has no such anchor"
            return None

        check("files.md links still resolve", files_links)

        # -- 4. the revision label ----------------------------------------------
        def labels() -> str | None:
            if (why := published()):
                return why
            for g in groups:
                rev = str(g["rev"])
                if g["cls"] == "examined":
                    if "recorded at" in rev and str(g["why"]) != R_NOREV:
                        return f"an examined group says `recorded at`: `{g['head']}`"
                    if "examined at" not in rev and str(g["why"]) != R_NOREV:
                        return f"an examined group does not say `examined at`: `{g['head']}`"
                else:
                    if "examined at" in rev:
                        return f"a {g['cls']} group says `examined at`: `{g['head']}`"
                    if not rev.startswith(f"recorded at `{SHA1[:8]}`"):
                        return f"a {g['cls']} group's revision reads `{rev}`, not `recorded at`"
            if any("examined at" in ln for ln in ledger.splitlines() if ", candidate," in ln or ", generated-ignore," in ln):
                return "a candidate or exempt line says `examined at`"
            return None

        check("`examined at` only for examined rows, `recorded at` otherwise", labels)

        def multi_revision() -> str | None:
            if (why := published()):
                return why
            g = next((g for g in groups if g["why"] == R_MULTI), None)
            if g is None:
                return "the two-revision group is absent"
            if str(g["rev"]).strip() != "examined at 2 revisions":
                return f"the two-revision group's head reads `{g['rev']}`"
            for item, sha in zip(g["items"], (SHA1, SHA2), strict=False):  # type: ignore[arg-type]
                if f"(`{sha[:8]}`)" not in str(item):
                    return f"a path in the two-revision group lacks its own `({sha[:8]})`"
            single = next(g for g in groups if g["why"] == R_SHARED)
            if any("(`" in str(item) for item in single["items"]):  # type: ignore[arg-type]
                return "a single-revision group prints a revision on each path"
            return None

        check("a group spanning revisions says so and each path carries its own", multi_revision)

        # -- 5. the missing reason and the missing revision ---------------------
        def missing() -> str | None:
            if (why := published()):
                return why
            noreason = next((g for g in groups if g["why"] == "No reason recorded"), None)
            if noreason is None or int(str(noreason["n"])) != 1:
                return "the row with no reason is not grouped under `No reason recorded`"
            norev = next((g for g in groups if g["why"] == R_NOREV), None)
            if norev is None or "no revision recorded" not in str(norev["rev"]):
                return "the row with no revision does not print `no revision recorded`"
            if "—" in "".join(str(g["rev"]) for g in groups if "`" in str(g["rev"])):
                return "a revision slot prints a bare dash"
            return None

        check("no reason and no revision are labelled", missing)

        # -- 6. HTML: one li per path in a nested ul ----------------------------
        def html_nesting() -> str | None:
            if (why := published()):
                return why
            if not html:
                return "the subsystem HTML could not be read"
            for path, *_ in ROWS:
                a = anchor(path)
                n = len(re.findall(rf'id="{a}"', html))
                if n != 1:
                    return f"the HTML anchor for `{path}` appears {n} times, not once"
                if not re.search(rf"<li><span id=\"{a}\"", html, re.S):
                    return f"`{path}` is not inside its own <li> in the HTML"
            li_per_path = re.findall(r'<li><span id="le-[0-9a-f]{10}"', html)
            if len(li_per_path) != len(ROWS):
                return f"the HTML has {len(li_per_path)} path <li> elements for {len(ROWS)} paths"
            if "<ul><li><span id=\"le-" not in html:
                return "the HTML paths are not a nested <ul> opening on a path item"
            if html.count(R_SHARED) != 1:
                return f"the shared reason appears {html.count(R_SHARED)} times in the HTML"
            return None

        check("the HTML has one <li> per path inside a nested <ul>", html_nesting)
    finally:
        shutil.rmtree(root, ignore_errors=True)

    # -- CI ------------------------------------------------------------------
    def runs_in_ci() -> str | None:
        text = read(CI_FILE)
        if not text:
            return "the CI workflow .github/workflows/test.yml is not readable"
        if not re.search(r"python3 test-ledger-grouping\.py", text):
            return "the workflow does not run test-ledger-grouping.py"
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
