#!/usr/bin/env python3
"""Gate for store-only packet SO14 — the renderers of the overview, the architecture page,
the subsystem map and the reader's guide build the page model themselves
(design/store-only/PLAN.md §3.1, §3.2 step 4, §3.4, §8 SO14).

Each store fixture of the golden corpus is rebuilt from its recorded SQL dump into
a temporary store and published in this process with the Markdown parser instrumented.
The family is `index`, `architecture`, `master-plan` and `how-to-read`.

Turns red when:

  - the golden corpus is absent, or one of its store fixtures (`materializer`,
    `axiomdb-shaped`, `self-shaped`, `lens`) lacks a family page's golden HTML;
  - a family page's HTML for a rebuilt fixture differs by one byte from the golden
    HTML (the `lens` fixture's pages are compared with the tree this packet started
    from instead, run over the same store, because its golden pages carry the
    revision of a git workspace this gate cannot recreate);
  - the Markdown parser is called while a family page is built (counted per page by
    instrumenting the module), or is never called for any other page, so the
    counter would be blind;
  - a family renderer does not return a `Page` for the page's content, or the
    publish is not green on all three read-back axes;
  - `prose.py` is absent, or `render_prose` does not turn paragraphs, `-`, `*` and
    numbered lists, fenced code, a blockquote and a link to `<page>.md` into the
    blocks and inlines the Markdown parser gave them, or reads a heading or a table
    row as structure;
  - `xref.resolve_model` does not give a model the links, the first-mention names,
    the concern prefix and the self-reference emphasis that the Markdown text pass
    followed by the Markdown parser gave the same text (read from the tree SO19 started
    from, `d4fd052`, which still held both): bare IDs, IDs inside code spans, inside
    emphasis, in headings, in table rows beside their name, and in a link already
    written;
  - the gate does not run in CI.

False green it cannot exclude: byte identity is proved on four stores and on the
sampled texts; an input shape none of them holds could print differently. SO19
deleted the text pass and the parser; the xref comparison now runs the tree it started
from in a subprocess.

Output protocol: exactly one status line, last, on stdout. Every message is
scrubbed, so a missing deliverable reports as an assertion failure and not as a
crash.
"""

from __future__ import annotations

import contextlib
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
from typing import Any

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
GOLDEN = ROOT / "fixtures" / "store-only-golden"
CI_FILE = REPO / ".github" / "workflows" / "test.yml"
START_SHA = "65d2a403bc09b853e47d2e18ad9bff5dba157b4a"
# The tree SO19 started from: it still held the text pass and the parser the xref check compares with.
SO19_START_SHA = "d4fd052932cc64fb083228ba81ce1ed206fdab51"
FAMILY = ("index", "architecture", "master-plan", "how-to-read")
STORES = ("materializer", "axiomdb-shaped", "self-shaped", "lens")

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
# The corpus and the stores rebuilt from it.
# ---------------------------------------------------------------------------


def unfold(text: str) -> str:
    return re.sub(
        r"@@golden-asset ([0-9a-f]{64})@@",
        lambda m: (GOLDEN / "assets" / m.group(1)).read_text(),
        text,
    )


def golden_page(store: str, page: str) -> str | None:
    path = GOLDEN / store / "html" / f"{page}.html"
    return unfold(path.read_text()) if path.is_file() else None


def rebuild(store: str, root: Path) -> Path:
    """A storage directory holding the fixture's recorded database."""

    storage = root / store / "storage"
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


def publish_instrumented(storage: Path, output: Path) -> tuple[dict[str, Any], dict[str, int]]:
    """Publish in this process, counting the Markdown parser's runs by page.

    The parser is counted where it reads (`_LegacyParser.parse`, in `legacy_prose.py`),
    because once every page is a model its only readers are the imported bodies.
    """

    hp, error = load("legacy_prose")
    if hp is None:
        raise RuntimeError(error)
    import materialize  # noqa: PLC0415 — the CLI module, run in this process

    calls: dict[str, int] = {}
    real = hp._LegacyParser.parse

    def counting(self: Any, markdown: str) -> Any:
        calls[self.current_html_path] = calls.get(self.current_html_path, 0) + 1
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


def start_tree(into: Path, sha: str = START_SHA) -> Path | None:
    """The materializer as it was at `sha` (by default when this packet started), extracted from git."""

    archive = subprocess.run(
        ["git", "-C", str(REPO), "archive", sha, "materializer"], capture_output=True
    )
    if archive.returncode != 0 or not archive.stdout:
        return None
    tarball = into / "start.tar"
    tarball.write_bytes(archive.stdout)
    if subprocess.run(["tar", "-xf", str(tarball), "-C", str(into)], capture_output=True).returncode != 0:
        return None
    tree = into / "materializer"
    return tree if (tree / "materialize.py").is_file() else None


def run_start_tree(tree: Path, storage: Path, output: Path) -> bool:
    proc = subprocess.run(
        [sys.executable, str(tree / "materialize.py"), "--storage", str(storage), "--output", str(output),
         "--allow-external-output"],
        capture_output=True,
        text=True,
        cwd=tree,
    )
    return proc.returncode == 0 and (output / "index.html").is_file()


# ---------------------------------------------------------------------------
# The checks.
# ---------------------------------------------------------------------------


def main() -> int:
    page_mod, page_error = load("page")
    prose, prose_error = load("prose")
    xref, xref_error = load("xref")
    hp, hp_error = load("html_projection")

    def corpus_present() -> str | None:
        version = GOLDEN / "VERSION"
        if not version.is_file():
            return "the golden corpus has no VERSION"
        missing = [
            f"{store}/{page}"
            for store in STORES
            for page in FAMILY
            if golden_page(store, page) is None
        ]
        return f"golden pages are absent: {missing[:4]}" if missing else None

    check("the golden corpus holds the family's pages for every store fixture", corpus_present)

    # ---------------------------------------------------- the rebuilt stores
    with tempfile.TemporaryDirectory(prefix="amanuensis-so14-") as tmp:
        root = Path(tmp)
        runs: dict[str, tuple[Path, Path, dict[str, Any], dict[str, int]]] = {}

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

        def green() -> str | None:
            for store, (_storage, _output, summary, _calls) in runs.items():
                reason = axes_green(summary)
                if reason:
                    return f"{store}: {reason}"
            return None if len(runs) == len(STORES) else "not every fixture was published"

        check("each publication reads back green on all three axes", green)

        def no_parse() -> str | None:
            if len(runs) != len(STORES):
                return "not every fixture was published"
            others = 0
            for store, (_storage, _output, _summary, calls) in runs.items():
                called = [page for page in FAMILY if calls.get(f"{page}.html")]
                if called:
                    return f"{store}: the Markdown parser was called while building {called}"
                others += sum(count for path, count in calls.items() if path[:-5] not in FAMILY)
            # Every page is a model by SO18; what the parser still reads is the imported bodies.
            if others < 5:
                return f"the counter saw {others} parse calls for the other pages, so it is not counting"
            return None

        check("no family page is built by the Markdown parser, and the counter counts the others", no_parse)

        def golden_equal() -> str | None:
            if len(runs) != len(STORES):
                return "not every fixture was published"
            for store in STORES:
                _storage, output, _summary, _calls = runs[store]
                for page in FAMILY:
                    if store == "lens" and page == "index":
                        continue  # its Repository head row names a workspace; see the start-tree check
                    wanted = golden_page(store, page)
                    path = output / f"{page}.html"
                    if wanted is None or not path.is_file():
                        return f"{store}/{page}.html is missing"
                    got = path.read_text()
                    if got != wanted:
                        at = next((i for i, (a, b) in enumerate(zip(got, wanted, strict=False)) if a != b), min(len(got), len(wanted)))
                        return f"{store}/{page}.html differs from the golden HTML at byte {at}: {got[at:at + 70]!r} for {wanted[at:at + 70]!r}"
            return None

        check("the family's HTML equals the golden HTML, byte for byte", golden_equal)

        def start_equal() -> str | None:
            if "lens" not in runs:
                return "the lens fixture was not published"
            with tempfile.TemporaryDirectory(prefix="amanuensis-so14-start-") as old:
                tree = start_tree(Path(old))
                if tree is None:
                    return f"the tree at {START_SHA[:12]} cannot be extracted from git"
                storage = rebuild("lens", Path(old) / "store")
                before = Path(old) / "docs"
                if not run_start_tree(tree, storage, before):
                    return "the tree this packet started from did not publish the lens fixture"
                _s, output, _summary, _calls = runs["lens"]
                for page in FAMILY:
                    if (output / f"{page}.html").read_text() != (before / f"{page}.html").read_text():
                        return f"lens/{page}.html differs from the page the start tree printed for the same store"
            return None

        check("the lens fixture's family equals what the packet's start tree prints for it", start_equal)

        def renderers_return_pages() -> str | None:
            if page_mod is None:
                return page_error
            core, error = load("core")
            renderers, error2 = load("renderers")
            if core is None or renderers is None:
                return error or error2
            if "materializer" not in runs:
                return "the materializer fixture was not published"
            storage = runs["materializer"][0]
            conn = core.open_ro(storage / "memory.db")
            try:
                calls = {
                    "index": lambda: renderers.render_index(conn, storage),
                    "architecture": lambda: renderers.render_architecture(conn, storage),
                    "master-plan": lambda: renderers.render_master_plan(conn, storage),
                    "how-to-read": lambda: renderers.render_how_to_read(conn, storage, [("index.md", "Overview", "h", "Overview", "", "u")]),
                }
                for name, call in calls.items():
                    built, sources = call()
                    if not isinstance(built, page_mod.Page):
                        return f"render for {name} returns {type(built).__name__}, not a Page"
                    if not built.title or not built.blocks or not sources:
                        return f"the {name} Page has no title, no blocks or no sources"
            finally:
                conn.close()
            return None

        check("each family renderer returns a Page with a title, blocks and sources", renderers_return_pages)

    # ------------------------------------------------------------- prose.py
    def prose_blocks() -> str | None:
        if prose is None or page_mod is None:
            return prose_error or page_error
        pm = page_mod
        text = (
            "First paragraph with `code`, **strong**, *emphasis* and a [link](architecture.md#subsystem-atlas).\n"
            "It continues here.\n\n"
            "- one\n"
            "  continued\n"
            "  - nested\n"
            "- two\n\n"
            "1. first\n"
            "2. second\n\n"
            "```ts\nconst a = 1 < 2;\n```\n\n"
            "> quoted\n> lines\n\n"
            "# not a heading\n"
            "| a | b |\n"
        )
        blocks = prose.render_prose(text)
        kinds = [type(block).__name__ for block in blocks]
        wanted = ["Paragraph", "List", "List", "Code", "Quote", "Paragraph"]
        if kinds != wanted:
            return f"render_prose gives {kinds}, not {wanted}"
        first = blocks[0].text
        nodes = [type(node).__name__ for node in first.nodes]
        if "CodeSpan" not in nodes or "Strong" not in nodes or "Emph" not in nodes or "Link" not in nodes:
            return f"the first paragraph's inlines are {nodes}"
        link = next(node for node in first.nodes if isinstance(node, pm.Link))
        if link.href != "architecture.html#subsystem-atlas":
            return f"a link to <page>.md prints as {link.href!r}, not its .html"
        if "It continues here." not in first.plain:
            return "a paragraph's lines are not joined"
        bullets = blocks[1]
        if bullets.ordered or len(bullets.items) != 2 or not bullets.items[0].children:
            return "a `-` list with a nested child is not one list of two items with a child"
        if not blocks[2].ordered or len(blocks[2].items) != 2:
            return "a numbered list is not an ordered list of two items"
        if blocks[3].language != "ts" or blocks[3].source != "const a = 1 < 2;":
            return f"the fence is {blocks[3]!r}"
        if "# not a heading" not in blocks[5].text.plain or "| a | b |" not in blocks[5].text.plain:
            return "a heading or table line was read as structure, not kept as text"
        if any(isinstance(block, pm.Heading | pm.Table) for block in blocks):
            return "render_prose produced a Heading or a Table"
        if prose.render_prose("") != ():
            return "an empty body is not an empty tuple"
        return None

    check("render_prose reads the stored-prose grammar and nothing more", prose_blocks)

    # A link label keeps the code spans and emphasis inside it, as the start tree's
    # `_inline` printed them (slice-S3 review F1); a stashed placeholder must never
    # reach the page. Expected strings were printed by `_inline` at 528199f.
    def link_label_inlines() -> str | None:
        if hp is None:
            return hp_error
        wanted = {
            "see [`Reader`](architecture.md) now": 'see <a href="architecture.html"><code>Reader</code></a> now',
            "[**bold** `x` y](a.md#q)": '<a href="a.html#q">bold <code>x</code> y</a>',
            "[`A` and `B`](https://e.com)": '<a href="https://e.com" rel="noreferrer"><code>A</code> and <code>B</code></a>',
        }
        for text, expected in wanted.items():
            got = hp._inline(text)
            if got != expected:
                return f"{text!r} prints {got!r}, not {expected!r}"
        if prose is not None and page_mod is not None:
            (block,) = prose.render_prose("A [`Reader`](architecture.md) link.")
            labels = [node.label for node in block.text.nodes if isinstance(node, page_mod.Link)]
            if labels != ["Reader"]:
                return f"a link's label reads {labels!r}, not ['Reader']"
        return None

    check("a link label prints the code spans inside it", link_label_inlines)

    # ------------------------------------------------------------- xref.py
    def model_xref() -> str | None:
        if xref is None or hp is None or page_mod is None:
            return xref_error or hp_error or page_error
        if not hasattr(xref, "resolve_model"):
            return "xref.py has no resolve_model"
        index = xref.XrefIndex(
            entries={
                "B-01": ("B-01", "subsystems/b-01-auth.md", "Auth"),
                "B-02": ("B-02", "subsystems/b-02-jobs.md", "Job queue"),
                "CC-1": ("CC-1", "concerns.md#cc-1", "Cache coherence"),
                "SM-01": ("SM-01", "seams.md#sm-01", "Auth and jobs"),
                "auth": ("auth", "subsystems/auth.md", "Lowercase id"),
            },
            names={"B-01": "Auth", "B-02": "Job queue", "auth": "authentication"},
            kinds={"B-01": "subsystem", "B-02": "subsystem", "CC-1": "concern", "SM-01": "seam", "auth": "subsystem"},
        )
        samples = {
            "index.md": (
                "# Title\n\n"
                "B-01 calls B-02 and then B-01 again, with CC-1 and the concern CC-1.\n\n"
                "`B-01` in code stays, so does\n\n"
                "```\nB-02 in a fence\n```\n\n"
                "**B-01** strong and **B-02** strong; B-02 plain.\n\n"
                "## B-02 and CC-1 in a heading\n\n"
                "- item naming B-01 beside Auth\n"
                "- an auth word and the id auth, plus SM-01\n"
                "- [B-02](subsystems/b-02-jobs.md) already linked, and [the B-01 thing](x.md)\n\n"
                "| Value | Label | What it means |\n|---|---|---|\n| `mapped` | Mapped | B-01 is mapped, beside CC-1. |\n\n"
                "| Metric | Value |\n|---|---|\n| Checked B-02 | 3 of B-01 |\n"
            ),
            "subsystems/b-01-auth.md": (
                "# Auth\n\nB-01 is this page, B-02 is another, and **B-01** again.\n\n"
                "| Seam | Party A | Object | Party B |\n|---|---|---|---|\n"
                "| SM-01 | **[B-01](subsystems/b-01-auth.md)** Auth | queue | **[B-02](subsystems/b-02-jobs.md)** Job queue |\n"
            ),
        }
        lp, lp_error = load("legacy_prose")
        if lp is None:
            return lp_error
        with tempfile.TemporaryDirectory(prefix="amanuensis-so14-xref-") as tmp:
            tree = start_tree(Path(tmp), SO19_START_SHA)
            if tree is None:
                return f"the tree at {SO19_START_SHA[:12]} cannot be extracted from git"
            script = (
                "import json, sys\n"
                "from amanuensis_materializer import html_projection as hp, xref\n"
                "spec = json.load(sys.stdin)\n"
                "index = xref.XrefIndex(entries={k: tuple(v) for k, v in spec['entries'].items()},"
                " names=spec['names'], kinds=spec['kinds'])\n"
                "out = {}\n"
                "for path, markdown in spec['samples'].items():\n"
                "    page = hp.parse_markdown(xref.resolve_text(markdown, path, index), path.replace('.md', '.html'))\n"
                "    out[path] = repr(page)\n"
                "json.dump(out, sys.stdout)\n"
            )
            spec = {
                "entries": index.entries,
                "names": index.names,
                "kinds": index.kinds,
                "samples": samples,
            }
            done = subprocess.run(
                [sys.executable, "-c", script], input=json.dumps(spec), capture_output=True, text=True, cwd=tree
            )
            if done.returncode != 0:
                return f"the start tree's text pass could not be run: {scrub(done.stderr)[-200:]}"
            expected = json.loads(done.stdout)
        for path, markdown in samples.items():
            html_path = path.replace(".md", ".html")
            got = xref.resolve_model(lp._LegacyParser(html_path).parse(markdown), path, index)
            if repr(got) != expected[path]:
                at = next(
                    (i for i, (a, b) in enumerate(zip(repr(got), expected[path], strict=False)) if a != b), 0
                )
                return f"{path}: the resolved model differs from the text pass then the parser at {at}: {repr(got)[at:at + 160]} for {expected[path][at:at + 160]}"
        return None

    check("resolve_model links, names and prefixes as the start tree's text pass then parser did", model_xref)

    # The text pass built its ID pattern once per index (`XrefIndex.pattern`); building
    # the alternation of every ID for every line made a 2,000-ID store's resolution
    # twelve times slower (slice-S3 review F4). Counted, not timed, so it cannot flake.
    def patterns_once() -> str | None:
        if xref is None or page_mod is None:
            return xref_error or page_error
        pm = page_mod
        ids = [f"B-{n:04d}" for n in range(300)]
        index = xref.XrefIndex(
            entries={i: (i, f"subsystems/{i.lower()}.md", f"Sub {i}") for i in ids},
            names={i: f"Sub {i}" for i in ids},
            kinds=dict.fromkeys(ids, "subsystem"),
            protected=("Use it when B-0001 changes.",),
        )
        built = 0
        real = xref.identifier_alternation

        def counted(keys: Any) -> str:
            nonlocal built
            built += 1
            return real(keys)

        lines = [f"Line {n} names {ids[n]} and {ids[(n * 7) % 300]}." for n in range(200)]
        xref.identifier_alternation = counted
        try:
            for path in ("index.md", "architecture.md"):
                page = pm.Page("T", path.replace(".md", ".html"), tuple(
                    pm.Paragraph(pm.Inlines((pm.Text(line),), line)) for line in lines
                ))
                resolved = xref.resolve_model(page, path, index)
        finally:
            xref.identifier_alternation = real
        if not any(isinstance(node, pm.Link) for node in resolved.blocks[0].text.nodes):
            return "the counted resolution linked nothing, so the count is blind"
        if built > 3:
            return f"two 200-line pages built the ID alternation {built} times; one index builds it at most 3"
        return None

    check("resolve_model builds an index's ID patterns once, not once per line", patterns_once)

    # ------------------------------------------------------------------ CI
    def in_ci() -> str | None:
        text = CI_FILE.read_text() if CI_FILE.is_file() else ""
        return None if "test-store-only-convert-overview.py" in text else "test.yml does not run the gate"

    check("the gate runs in CI", in_ci)

    if FAILURES:
        emit(f"GATE SO14 RED: {FAILURES[0]}"[:480])
        return 1
    emit("GATE SO14 GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
