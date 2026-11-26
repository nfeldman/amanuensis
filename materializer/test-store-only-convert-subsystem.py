#!/usr/bin/env python3
"""Gate for store-only packet SO15 — the subsystem pages are built as page models
(design/store-only/PLAN.md §3.1, §3.2 step 4, §3.4, §5.4, §8 SO15).

Each store fixture of the golden corpus is rebuilt from its recorded SQL dump into a
temporary store and published in this process, with the Markdown parser instrumented.
A fifth store is built here from the `lens` dump plus rows the corpus does not hold:
claims in every group, recorded and declined narratives, purposes and accounts, and an
imported survey body in each of the four placements `narrative_placement` gives. The
tree this packet started from publishes that store too, and its HTML is the reference.

Turns red when:

  - the golden corpus is absent, or one of its stores lacks a subsystem page;
  - a subsystem page of a rebuilt fixture differs by one byte from the golden HTML;
  - any file the rich store publishes (every page, not only the subsystem pages)
    differs by one byte from what the packet's start tree publishes for the same store;
  - the Markdown parser is reached by anything but
    `legacy_prose.py`, while a subsystem page is built; `legacy_prose.py` reads a
    page's imported bodies and nothing else, so the parser must run exactly once for
    each imported body a page prints and never for a page that prints none; or the
    counter is blind (it sees no parse of any other page);
  - `render_subsystem` does not return a `Page` with a title, the page's own path,
    blocks and sources, or the publication is not green on all three read-back axes;
  - `legacy_prose.render_body` does not read an imported body as today's parser reads
    it: headings shifted beneath the section, a table captioned by that section, a
    table with a record projection's header as that record list, a fence kept as
    code whatever it holds, a link written to `.md` printed as `.html`;
  - a fence the writers accept (tildes, four backticks, an indented opener, a longer
    closer) renders a line inside it as anything but code (final review F3/codex);
  - `renderers.py` still defines or imports `_nest_prose`, or `test-materializer.py`
    still reaches it through the renderers;
  - the gate does not run in CI.

False green it cannot exclude: byte identity is proved on fourteen golden pages and on
the rich store's pages; a record shape neither holds could print differently. The
parser stays in the tree until SO19, which is what makes the comparison possible.

Output protocol: exactly one status line, last, on stdout. Every message is scrubbed,
so a missing deliverable reports as an assertion failure and not as a crash.
"""

from __future__ import annotations

import contextlib
import hashlib
import importlib
import io
import json
import re
import sqlite3
import subprocess
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from typing import Any

import lineage_style  # noqa: E402

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
GOLDEN = ROOT / "fixtures" / "store-only-golden"
SCHEMA = REPO / "mcp-server" / "src" / "schema.sql"
CI_FILE = REPO / ".github" / "workflows" / "test.yml"
START_SHA = "9e55fe1f2777d2b27ff2afc3be31aa0ed6260519"

# SO20 marks every rendered record and drawn node or edge with these four attributes
# (PLAN §3.5). The start tree predates them, so the current page is compared with
# them removed; SO20's own gate checks their values.
_SO20_MARKS = re.compile(r' data-(?:record|state|node|edge)="[^"]*"')


# SO22 adds a drawn figure to the guide and to each subsystem page (PLAN §3.2's update
# rule); the start tree predates them, so a figure is removed whole as well. SO23 adds more.
_SO22_FIGURES = re.compile(
    # A figure that closes its container takes the newline before it.
    r'\n<figure\b[^>]*data-diagram="[^"]*"[^>]*>(?:(?!</figure>).)*</figure>(?=</)'
    r'|<figure\b[^>]*data-diagram="[^"]*"[^>]*>.*?</figure>\n?'
    # SO23 adds a "not measured" sentence, finding badges and the note under them (PLAN §3.2's update rule).
    r'|\n<p class="(?:diagram-below|finding-badge-note)"[^>]*>(?:(?!</p>).)*</p>(?=</)'
    r'|<p class="(?:diagram-below|finding-badge-note)"[^>]*>(?:(?!</p>).)*</p>\n?'
    r'|<div class="atlas-badges"[^>]*>.*?</div>'
    r'|<g class="boundary-svg-badge"[^>]*>.*?</g>',
    re.S,
)

# SO24 adds sentences and figures to the Boundaries page; taking them out can leave the
# wrapper that held a run of paragraphs empty (PLAN §3.2's update rule).
_EMPTY_FLOW = re.compile(r'<div class="prose-flow">\s*</div>\n?')


def unmarked(text: str) -> str:
    return _EMPTY_FLOW.sub("", _SO20_MARKS.sub("", _SO22_FIGURES.sub("", text)))

STORES = ("materializer", "axiomdb-shaped", "self-shaped", "lens")
LEGACY = "amanuensis_materializer.legacy_prose"

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
    ("Traceback (most recent call last)", "trace follows"),
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


def load(name: str) -> tuple[Any, str | None]:
    sys.path.insert(0, str(ROOT))
    try:
        return importlib.import_module(f"amanuensis_materializer.{name}"), None
    except Exception as exc:  # absent or broken module: an assertion, not a crash
        return None, f"amanuensis_materializer/{name}.py could not be loaded ({type(exc).__name__}: {exc})"


# ---------------------------------------------------------------------------
# The corpus, the rich store, and the stores rebuilt from them.
# ---------------------------------------------------------------------------


def unfold(text: str) -> str:
    return re.sub(
        r"@@golden-asset ([0-9a-f]{64})@@",
        lambda m: (GOLDEN / "assets" / m.group(1)).read_text(),
        text,
    )


def golden_pages(store: str) -> dict[str, str]:
    base = GOLDEN / store / "html" / "subsystems"
    return {path.name: unfold(path.read_text()) for path in sorted(base.glob("*.html"))} if base.is_dir() else {}


def rebuild(store: str, root: Path, name: str | None = None) -> Path:
    """A storage directory holding the fixture's recorded database."""

    storage = root / (name or store) / "storage"
    storage.mkdir(parents=True)
    db = sqlite3.connect(storage / "memory.db")
    try:
        db.executescript((GOLDEN / store / "memory.sql").read_text())
        db.commit()
    finally:
        db.close()
    if store == "materializer":
        (storage / "workspace_path").write_text("/example/FictionalProject\n")
    return storage


SHA = "0e5ac6940690be78954049d81682906deb671336"
WHEN = "2026-11-12 09:30:00"

IMPORTED_BODY = """# Survey of {sid}

It reads `{sid}` end to end, with a [page link](../architecture.md#seam-topology) and a mention of B-02.

## Key types

| Symbol | Role | Source |
|---|---|---|
| `Reader` | drains rows from the buffer | src/reader.ts |
| `Cursor` | marks the read position | src/cursor.ts |

## Flow

1. the writer fills the buffer
2. the reader drains it

| Name | Note |
|---|---|
| buffer | shared by both paths |

```text
# not a heading
| nor a table |
```

> a quoted line

- an item with **strong** text
- another with *emphasis*

### Closing note

Nothing else is claimed here.
"""


def seed_rich(storage: Path) -> dict[str, int]:
    """Add what the corpus lacks to the `lens` store; return the imported bodies printed per subsystem."""

    db = sqlite3.connect(storage / "memory.db")
    try:
        cur = db.cursor()

        def evidence(path: str, line: str | None = None) -> int:
            cur.execute(
                "INSERT INTO evidence (file_path, line_range, ref_sha, kind, session_id, collected_at)"
                " VALUES (?, ?, ?, 'code-verified', 'p8', ?)",
                (path, line, SHA, WHEN),
            )
            return int(cur.lastrowid or 0)

        def subsystem(sid: str, name: str, scope: str | None = None, notes: str | None = None) -> None:
            cur.execute(
                "INSERT INTO subsystems (id, name, status, layer, scope, notes)"
                " VALUES (?, ?, 'mapped', 'backend', ?, ?)",
                (sid, name, scope, notes),
            )

        def claim(sid: str, key: str, statement: str, *, subject: str | None = None, cites: tuple[tuple[str, str | None, str], ...] = ()) -> None:
            cid = f"{sid}-{key.replace('/', '-')}"
            cur.execute(
                "INSERT INTO claims (claim_id, claim_key, subject_type, subject_id, statement,"
                " epistemic_kind, asserted_at_sha, valid_from_sha, session_id)"
                " VALUES (?, ?, 'subsystem', ?, ?, 'observation', ?, ?, 'p8')",
                (cid, key, subject or sid, statement, SHA, SHA),
            )
            for path, line, role in cites:
                cur.execute(
                    "INSERT INTO claim_evidence (claim_id, evidence_id, role) VALUES (?, ?, ?)",
                    (cid, evidence(path, line), role),
                )

        def narrative(sid: str, section: str, topic: str, body: str, *, disposition: str = "recorded", cites: tuple[str, ...] = ()) -> None:
            cur.execute(
                "INSERT INTO narratives (subject_type, subject_id, section, topic, disposition,"
                " body, ref_sha, session_id, recorded_at) VALUES ('subsystem', ?, ?, ?, ?, ?, ?, 'p8', ?)",
                (sid, section, topic, disposition, body, SHA, WHEN),
            )
            for path in cites:
                cur.execute(
                    "INSERT INTO narrative_evidence (narrative_id, evidence_id) VALUES (?, ?)",
                    (cur.lastrowid, evidence(path)),
                )

        def explanation(sid: str, slot: str, body: str, disposition: str = "recorded") -> None:
            cur.execute(
                "INSERT INTO explanations (subject_type, subject_id, slot, disposition, body,"
                " ref_sha, session_id, recorded_at) VALUES ('subsystem', ?, ?, ?, ?, ?, 'p8', ?)",
                (sid, slot, disposition, body, SHA, WHEN),
            )

        printed: dict[str, int] = {}

        def imported(sid: str, *, withdrawn: bool = False, edited: bool = False) -> None:
            body = IMPORTED_BODY.format(sid=sid)
            path = f"subsystems/{sid.lower()}-survey.md"
            cur.execute(
                "INSERT INTO imported_artifacts (path, kind, subsystem_id, body, body_sha256,"
                " registered_hash, hash_matches, registered_ref_sha, written_at, session_id)"
                " VALUES (?, 'subsystem-survey', ?, ?, ?, ?, ?, ?, '2026-10-02 09:30:00', 'p8')",
                (path, sid, body, hashlib.sha256(body.encode("utf-8")).hexdigest(), "0123456789abcdef0123", 0 if edited else 1, SHA),
            )
            if withdrawn:
                cur.execute(
                    "INSERT INTO imported_artifact_withdrawals (path, reason, session_id) VALUES (?, 'reset', 'p8')",
                    (path,),
                )
            else:
                printed[sid] = printed.get(sid, 0) + 1

        # B-01: every section; an account, so the artifact goes to the survey record.
        cur.execute(
            "UPDATE subsystems SET scope = ?, notes = ? WHERE id = 'B-01'",
            (
                "src/reader.ts and the files it re-exports:\n- src/cursor.ts\n- src/buffer.ts",
                "Written by hand during the first read.\n\nA second paragraph with `code`.",
            ),
        )
        explanation("B-01", "purpose", "It drains the shared buffer for **readers**.\n\n- one page at a time\n- never ahead of the writer")
        explanation(
            "B-01",
            "account",
            "The reader walks the buffer in order.\n\n```ts\nconst page = buffer.next();\n```\n\n1. fetch\n2. decode",
        )
        claim("B-01", "B-01/key-type/reader", "The reader owns the cursor.", cites=(("src/reader.ts", "10-20", "supports"), ("src/cursor.ts", None, "qualifies")))
        claim("B-01", "B-01/flow/drain", "A drain moves one page.", cites=(("src/reader.ts", "30-40", "supports"),))
        claim("B-01", "B-01/storage-lifecycle/rows", "Rows live until drained.")
        claim("B-01", "B-01/other/misc", "An unrecognised segment keeps its name.")
        claim("B-01", "elsewhere/x", "A claim reached through its subject.", cites=(("src/reader.ts", None, "supports"),))
        narrative("B-01", "structure", "Reading order", "Read the cursor first, then the drain.\n\n- cursor\n- drain", cites=("src/reader.ts", "src/cursor.ts"))
        narrative("B-01", "structure", "", "An untitled paragraph of structure.")
        narrative("B-01", "challenge", "Hostile reading", "What if the writer stalls? The reader waits.")
        narrative("B-01", "concern-reasoning", "", "The concerns were weighed against the cursor.")
        cur.execute(
            "INSERT INTO vocabulary_declinations (subsystem_id, reason, session_id, ref_sha, declared_at)"
            " VALUES ('B-01', 'It used no terms of its own at first.', 'p8', ?, ?)",
            (SHA, WHEN),
        )
        imported("B-01")

        # B-02: no account, so the artifact stands in Structure beside two claims.
        explanation("B-02", "purpose", "Declined: the writer is described elsewhere.", "declined")
        explanation("B-02", "account", "Declined: nothing beyond the claims is known.", "declined")
        claim("B-02", "B-02/key-type/writer", "The writer owns the buffer.")
        claim("B-02", "B-02/concurrency/lock", "One lock guards the buffer.", cites=(("src/writer.ts", "5-9", "supports"),))
        narrative("B-02", "structure", "Why no narrative", "Nothing more was recorded.", disposition="declined")
        imported("B-02", edited=True)

        # B-03: no claims, a narrative, an artifact: the artifact follows the narrative.
        narrative("B-03", "structure", "Queue shape", "A queue of pending rows, drained in order.", cites=("src/queue.ts",))
        imported("B-03")

        # F-01: no claims, no narrative: the artifact stands alone in Structure.
        imported("F-01")

        # F-02: an account and an artifact, nothing else.
        explanation("F-02", "account", "The widgets draw what the console hands them.")
        imported("F-02")

        # B-04: an account, a narrative and an artifact: the narrative is pointed to.
        subsystem("B-04", "Cache", "src/cache.ts")
        explanation("B-04", "account", "The cache keeps the last page.")
        narrative("B-04", "structure", "Cache layout", "One slot per reader.")
        imported("B-04")

        # B-05: a narrative and no artifact.
        subsystem("B-05", "Index", "src/index.ts")
        narrative("B-05", "structure", "", "The index maps keys to pages.")

        # B-06: nothing at all.
        subsystem("B-06", "Audit")

        # B-07: claims and no artifact.
        subsystem("B-07", "Metrics")
        claim("B-07", "B-07/state-container/counters", "Counters live in memory.")

        # B-08: an artifact withdrawn by a reset.
        subsystem("B-08", "Legacy")
        imported("B-08", withdrawn=True)
        db.commit()
        return printed
    finally:
        db.close()


def publish_instrumented(
    storage: Path, output: Path
) -> tuple[dict[str, Any], list[tuple[str, str]]]:
    """Publish in this process, recording each parser run as (page path, calling module)."""

    hp, error = load("legacy_prose")
    if hp is None:
        raise RuntimeError(error)
    import materialize  # noqa: PLC0415 — the CLI module, run in this process

    calls: list[tuple[str, str]] = []
    real = hp._LegacyParser.parse

    def counting(self: Any, markdown: str) -> Any:
        caller = sys._getframe(1).f_globals.get("__name__", "")
        calls.append((self.current_html_path, caller))
        return real(self, markdown)

    hp._LegacyParser.parse = counting
    saved = sys.argv
    sys.argv = ["materialize.py", "--storage", str(storage), "--output", str(output), "--allow-external-output"]
    buffer = io.StringIO()
    try:
        with contextlib.redirect_stdout(buffer):
            code = materialize.main()
    finally:
        sys.argv = saved
        hp._LegacyParser.parse = real
    lines = [line for line in buffer.getvalue().splitlines() if line.strip()]
    summary = json.loads(lines[-1]) if lines else {}
    summary["exit"] = code
    return summary, calls


def axes_green(summary: dict[str, Any]) -> str | None:
    readback = summary.get("readback") or {}
    axes = readback.get("axes") or {}
    red = [axis for axis in ("state", "coverage", "content") if not (axes.get(axis) or {}).get("ok")]
    if summary.get("exit") != 0 or not summary.get("ok") or red:
        first = (readback.get("mismatches") or [{}])[0]
        return f"publish not green: exit {summary.get('exit')}, axes {red or 'ok'}, {json.dumps(first)[:200]}"
    return None


def start_tree(into: Path) -> Path | None:
    """The materializer as it was when this packet started, extracted from git."""

    archive = subprocess.run(
        ["git", "-C", str(REPO), "archive", START_SHA, "materializer"], capture_output=True
    )
    if archive.returncode != 0 or not archive.stdout:
        return None
    tarball = into / "start.tar"
    tarball.write_bytes(archive.stdout)
    if subprocess.run(["tar", "-xf", str(tarball), "-C", str(into)], capture_output=True).returncode != 0:
        return None
    tree = into / "materializer"
    if not (tree / "materialize.py").is_file():
        return None
    # The one text the survey-scope lane changed on purpose (SC6): what `excluded` means.
    # The reference is the start tree with that sentence, so every other byte is still held.
    vocabulary = tree / "amanuensis_materializer" / "vocabulary.py"
    if vocabulary.is_file():
        vocabulary.write_text(
            vocabulary.read_text().replace(
                '"meaning": "A ledger row classifies the path as generated, vendored, irrelevant, or deferred with a recorded reason.",',
                '"meaning": "The path is outside the survey set (an owner rule, the repository\'s ignore files, or meta sorting), or a ledger row inside it classifies the path as generated, vendored, irrelevant, or deferred with a recorded reason.",',
            )
        )
    return tree


def run_start_tree(tree: Path, storage: Path, output: Path) -> bool:
    proc = subprocess.run(
        [sys.executable, str(tree / "materialize.py"), "--storage", str(storage), "--output", str(output),
         "--allow-external-output"],
        capture_output=True,
        text=True,
        cwd=tree,
    )
    return proc.returncode == 0 and (output / "index.html").is_file()


def differs(got: str, wanted: str) -> str:
    at = next((i for i, (a, b) in enumerate(zip(got, wanted, strict=False)) if a != b), min(len(got), len(wanted)))
    return f"differs at byte {at}: {got[at:at + 70]!r} for {wanted[at:at + 70]!r}"


def printed_bodies(storage: Path) -> dict[str, int]:
    """Each subsystem's unwithdrawn imported survey bodies, counted from the store."""

    db = sqlite3.connect(storage / "memory.db")
    try:
        return {
            str(sid): int(count)
            for sid, count in db.execute(
                "SELECT a.subsystem_id, COUNT(*) FROM imported_artifacts a"
                " WHERE a.kind = 'subsystem-survey' AND NOT EXISTS"
                " (SELECT 1 FROM imported_artifact_withdrawals w WHERE w.path = a.path)"
                " GROUP BY a.subsystem_id"
            )
        }
    finally:
        db.close()


def subsystem_paths(storage: Path) -> dict[str, str]:
    """The HTML path of each subsystem page, by subsystem id."""

    slugs, error = load("slugs")
    if slugs is None:
        raise RuntimeError(error)
    db = sqlite3.connect(storage / "memory.db")
    try:
        return {
            str(sid): slugs.subsystem_page(str(sid), str(name))
            for sid, name in db.execute("SELECT id, name FROM subsystems")
        }
    finally:
        db.close()


# ---------------------------------------------------------------------------
# The checks.
# ---------------------------------------------------------------------------


def main() -> int:
    legacy, legacy_error = load("legacy_prose")
    hp, hp_error = load("html_projection")

    def corpus_present() -> str | None:
        if not (GOLDEN / "VERSION").is_file():
            return "the golden corpus has no VERSION"
        empty = [store for store in STORES if not golden_pages(store)]
        return f"these stores hold no golden subsystem page: {empty}" if empty else None

    check("the golden corpus holds subsystem pages for every store fixture", corpus_present)

    with tempfile.TemporaryDirectory(prefix="amanuensis-so15-") as tmp:
        root = Path(tmp)
        runs: dict[str, tuple[Path, Path, dict[str, Any], list[tuple[str, str]]]] = {}

        def publish_all() -> str | None:
            for store in STORES:
                if not (GOLDEN / store / "memory.sql").is_file():
                    return f"{store}: the golden corpus has no memory.sql"
                storage = rebuild(store, root)
                output = root / store / "docs"
                summary, calls = publish_instrumented(storage, output)
                runs[store] = (storage, output, summary, calls)
            return None

        check("every store fixture rebuilds and publishes", publish_all)

        rich_storage = rebuild("lens", root, "rich")
        seed_rich(rich_storage)
        rich_output = root / "rich" / "docs"

        def publish_rich() -> str | None:
            summary, calls = publish_instrumented(rich_storage, rich_output)
            runs["rich"] = (rich_storage, rich_output, summary, calls)
            return None

        check("the rich store publishes", publish_rich)

        def green() -> str | None:
            for store, (_storage, _output, summary, _calls) in runs.items():
                reason = axes_green(summary)
                if reason:
                    return f"{store}: {reason}"
            return None if len(runs) == len(STORES) + 1 else "not every store was published"

        check("each publication reads back green on all three axes", green)

        def parser_use() -> str | None:
            if len(runs) != len(STORES) + 1:
                return "not every store was published"
            blind = 0
            for store, (storage, _output, _summary, calls) in runs.items():
                paths = subsystem_paths(storage)
                bodies = printed_bodies(storage)
                family = set(paths.values())
                stray = [(path, caller) for path, caller in calls if path in family and caller != LEGACY]
                if stray:
                    return f"{store}: the parser was reached for {stray[0][0]} by {stray[0][1]}, not by legacy_prose"
                for sid, path in paths.items():
                    legacy_calls = sum(1 for page, caller in calls if page == path and caller == LEGACY)
                    if legacy_calls != bodies.get(sid, 0):
                        return (
                            f"{store}: {path} was parsed {legacy_calls} time(s) for its imported bodies;"
                            f" the store holds {bodies.get(sid, 0)}"
                        )
                blind += sum(1 for path, _caller in calls if path not in family)
            return None if blind >= 5 else f"the counter saw {blind} parses of other pages, so it is not counting"

        check("only legacy_prose reads Markdown for a subsystem page, once per imported body", parser_use)

        def golden_equal() -> str | None:
            for store in STORES:
                if store not in runs:
                    return "not every store was published"
                _storage, output, _summary, _calls = runs[store]
                for name, wanted in golden_pages(store).items():
                    path = output / "subsystems" / name
                    if not path.is_file():
                        return f"{store}/subsystems/{name} is missing"
                    got = path.read_text()
                    if got != wanted:
                        return f"{store}/subsystems/{name} {differs(got, wanted)}"
            return None

        check("every golden subsystem page is reproduced byte for byte", golden_equal)

        def rich_equal() -> str | None:
            if "rich" not in runs:
                return "the rich store was not published"
            with tempfile.TemporaryDirectory(prefix="amanuensis-so15-start-") as old:
                tree = start_tree(Path(old))
                if tree is None:
                    return f"the tree at {START_SHA[:12]} cannot be extracted from git"
                storage = rebuild("lens", Path(old), "rich")
                seed_rich(storage)
                before = Path(old) / "docs"
                if not run_start_tree(tree, storage, before):
                    return "the tree this packet started from did not publish the rich store"
                after = runs["rich"][1]
                names = sorted(
                    {str(p.relative_to(before)) for p in before.rglob("*") if p.is_file() and p.suffix in (".html", ".js") and not lineage_style.is_style_asset(str(p.relative_to(before if p.is_relative_to(before) else after)))}
                    | {str(p.relative_to(after)) for p in after.rglob("*") if p.is_file() and p.suffix in (".html", ".js") and not lineage_style.is_style_asset(str(p.relative_to(before if p.is_relative_to(before) else after)))}
                )
                if sum(1 for name in names if name.startswith("subsystems/")) < 10:
                    return "the rich store published fewer than ten subsystem pages"
                for name in names:
                    a, b = after / name, before / name
                    if not a.is_file() or not b.is_file():
                        return f"{name} is published by only one of the two trees"
                    if lineage_style.current(unmarked(a.read_text())) != lineage_style.start(b.read_text()):
                        return f"{name} {differs(lineage_style.current(unmarked(a.read_text())), lineage_style.start(b.read_text()))}"
            return None

        check("the rich store's pages equal what the packet's start tree prints for it", rich_equal)

        def renderer_returns_page() -> str | None:
            page_mod, error = load("page")
            core, error2 = load("core")
            renderers, error3 = load("renderers")
            if page_mod is None or core is None or renderers is None:
                return error or error2 or error3
            storage = runs["materializer"][0]
            conn = core.open_ro(storage / "memory.db")
            try:
                subsystem = conn.execute(
                    "SELECT id, name, status, layer, scope, jump_in_reading, notes FROM subsystems ORDER BY id"
                ).fetchone()
                built, sources = renderers.render_subsystem(
                    conn, storage, dict(subsystem) if not isinstance(subsystem, dict) else subsystem
                )
            finally:
                conn.close()
            if not isinstance(built, page_mod.Page):
                return f"render_subsystem returns {type(built).__name__}, not a Page"
            path = subsystem_paths(storage)[str(dict(subsystem)["id"])]
            if built.path != path:
                return f"the Page's path is {built.path!r}, not {path!r}"
            if not built.title.startswith(str(dict(subsystem)["id"])) or not built.blocks or not sources:
                return "the Page has no title naming the subsystem, no blocks or no sources"
            return None

        check("render_subsystem returns a Page with the subsystem's title and path", renderer_returns_page)

    # ------------------------------------------------------- legacy_prose.py
    def legacy_reads() -> str | None:
        if legacy is None or hp is None:
            return legacy_error or hp_error
        if not hasattr(legacy, "render_body"):
            return "legacy_prose.py has no render_body"
        body = (
            "# Title\n\nSee [the map](architecture.md#subsystem-atlas).\n\n"
            "## Sub\n\n"
            "| Symbol | Role | Source |\n|---|---|---|\n| `A` | holds a | a.ts |\n\n"
            "| Name | Note |\n|---|---|\n| x | y |\n\n"
            "```md\n# kept\n```\n"
        )
        blocks = legacy.render_body(body, under=3, section="Structure", path="subsystems/x.html")
        kinds = [type(block).__name__ for block in blocks]
        if kinds != ["Heading", "Paragraph", "Heading", "RecordList", "Table", "Code"]:
            return f"render_body gives {kinds}"
        if blocks[0].level != 4 or blocks[2].level != 5:
            return f"headings are at levels {blocks[0].level} and {blocks[2].level}, not 4 and 5"
        link = next(node for node in blocks[1].text.nodes if type(node).__name__ == "Link")
        if link.href != "architecture.html#subsystem-atlas":
            return f"a link to a .md page prints as {link.href!r}"
        if blocks[3].kind != "structural-inventory" or blocks[3].caption != "structure":
            return f"the projection table is {blocks[3].kind!r} captioned {blocks[3].caption!r}"
        if blocks[4].caption != "structure":
            return f"a plain table is captioned {blocks[4].caption!r}, not by its section"
        if blocks[5].source != "# kept":
            return "a fence's contents were read as structure"
        tilde = legacy.render_body("before\n\n~~~\n## inside\n~~~\n\nafter", under=3, section="Structure", path="subsystems/x.html")
        if not all(word in repr(tilde) for word in ("before", "inside", "after")):
            return "a body with a tilde fence lost text after it"
        if legacy.render_body("", under=3, section="Structure", path="subsystems/x.html") != ():
            return "an empty body is not an empty tuple"
        deeper = legacy.render_body("# A\n## B\n### C", under=3, section="Survey record", path="subsystems/x.html")
        if [block.level for block in deeper] != [4, 5, 6]:
            return f"a three-level body sits at levels {[block.level for block in deeper]}, not 4, 5, 6"
        return None

    check("legacy_prose.render_body reads an imported body as the parser does", legacy_reads)

    def stored_headings_nest() -> str | None:
        prose, error = load("prose")
        if prose is None:
            return error
        body = "Intro.\n\n## Sneaked\r# Carriage\u2028### Deep\n\nTail."
        kinds = [type(b).__name__ for b in prose.render_prose(body, under=2)]
        got = [b.level for b in prose.render_prose(body, under=2) if type(b).__name__ == "Heading"]
        if got != [4, 3, 5] or kinds[0] != "Paragraph" or kinds[-1] != "Paragraph":
            return f"headings in a stored body sit at levels {got} ({kinds}), not 4, 3, 5 between its paragraphs"
        if any(type(b).__name__ == "Heading" for b in prose.render_prose(body)):
            return "a heading was read without `under`, so the §3.4 grammar changed"
        return None

    check("a heading in a stored body nests beneath its section, and is text when no section is named", stored_headings_nest)

    def stored_fences_are_code() -> str | None:
        # The writers (`isStoredProse`) open a fence on three or more backticks or
        # tildes, indented up to three spaces, and close it only on a run of the same
        # character at least as long; the renderer must read the same blocks, or a
        # `# comment` the writer accepted inside a fence prints as a heading (final
        # review F3/codex).
        prose, error = load("prose")
        if prose is None:
            return error
        for body in (
            "~~~\n# literal comment\n~~~",
            "````\n# literal comment\n````",
            "   ```sh\n# literal comment\n```",
            "````\n```\n# literal comment\n````",
            "~~~\n```\n# literal comment\n~~~",
            "Intro.\n~~~\n# literal comment\n~~~",
        ):
            blocks = prose.render_prose(body, under=3)
            if any(type(b).__name__ == "Heading" for b in blocks):
                return f"{body!r}: a line inside a fence the writer accepts rendered as a heading"
            code = [b for b in blocks if type(b).__name__ == "Code"]
            if len(code) != 1 or "# literal comment" not in code[0].source:
                return f"{body!r}: rendered as {[type(b).__name__ for b in blocks]}, not one code block holding the comment"
        return None

    check("a fence the writers accept renders as code, whatever its character and length", stored_fences_are_code)

    def nest_prose_gone() -> str | None:
        source = (ROOT / "amanuensis_materializer" / "renderers.py").read_text()
        if re.search(r"\b_nest_prose\b", source):
            return "renderers.py still names _nest_prose"
        tests = (ROOT / "test-materializer.py").read_text()
        if re.search(r"\brmod\._nest_prose\b|renderers\._nest_prose", tests):
            return "test-materializer.py still reaches _nest_prose through the renderers"
        if legacy is None or not callable(getattr(legacy, "nest_headings", None)):
            return "legacy_prose.nest_headings is gone"
        return None

    check("_nest_prose is gone from the renderers and nothing reaches it", nest_prose_gone)

    # ------------------------------------------------------------------ CI
    def in_ci() -> str | None:
        text = CI_FILE.read_text() if CI_FILE.is_file() else ""
        return None if "test-store-only-convert-subsystem.py" in text else "test.yml does not run the gate"

    check("the gate runs in CI", in_ci)

    if FAILURES:
        emit(f"GATE SO15 RED: {FAILURES[0]}"[:480])
        return 1
    emit("GATE SO15 GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
