#!/usr/bin/env python3
"""Gate for store-only packet SO11 — the page model between a renderer and the HTML
(design/store-only/PLAN.md §3.1, §3.2, §8 SO11), as it stands after SO19 deleted the
Markdown parser.

SO11 split `MarkdownRenderer` into `parse_markdown` and `write_html`. SO19 deleted the
parser, so the half of this gate that fed recorded Markdown through it is retired with
it (the recorded Markdown stays in the corpus as history): the corpus is now compared by
rebuilding each store fixture from its recorded SQL dump and publishing it. The
`hooks` fixture, written Markdown with no store behind it, and `materializer-github`, a
second printing of the `materializer` store, cannot be rebuilt that way. The `hooks`
fixture's Markdown is read by the one Markdown reader left, the imported-body reader
(`legacy_prose.py`), and the elements of the block kinds no store fixture prints are
compared with its golden HTML; its page-level hooks, which SO19 deleted, are not.

Turns red when:

  - the golden corpus is absent, lacks a `VERSION` naming the packet that last wrote
    it, lacks one of its six fixtures, or holds fewer pages than it was written with
    (so a deleted fixture cannot pass as an identical one);
  - the HTML a rebuilt store fixture publishes differs from the golden HTML by one
    byte, or prints a page the corpus does not hold, or `write_html` does not run
    exactly once for each page (counted by instrumenting the module);
  - a relationship trace (edge direction and all), a diagram's printed source or a
    quote, read from the `hooks` fixture's Markdown by the imported-body reader,
    prints otherwise than in its golden HTML, or a block kind is printed by no page
    either comparison covers (slice-S3 review F2);
  - `page.py` lacks a block kind for any shape a page prints (the kinds the recognition
    hooks resolved to), or still carries a `HOOKS` table of the parser's;
  - `write_html`, or any function or method it reaches in its module, imports the
    Markdown reader or names a recognition constant (a `_*_PROJECTION(S)`, the marker
    or list pattern);
  - `write_html` handles Markdown: given a page model whose text holds emphasis, a
    link, a code span, an emoji status and a table whose headers are the subsystem
    atlas's signature, it prints any of them as anything but escaped literal text in
    an ordinary table;
  - the gate does not run in CI.

False green it cannot exclude: byte identity is proved on the four store fixtures; an
input shape none of their pages carry could still print differently.

Output protocol: exactly one status line, last, on stdout. Every message is scrubbed, so
a missing deliverable reports as an assertion failure and not as a crash.
"""

from __future__ import annotations

import ast
import contextlib
import dataclasses
import importlib
import io
import json
import re
import sqlite3
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
GOLDEN = ROOT / "fixtures" / "store-only-golden"
CI_FILE = REPO / ".github" / "workflows" / "test.yml"
PROJECTION_SOURCE = ROOT / "amanuensis_materializer" / "html_projection.py"
PACKET = "SO11"

FIXTURES = ("materializer", "materializer-github", "lens", "axiomdb-shaped", "self-shaped", "hooks")
# Pages the corpus held when SO11 wrote it; a smaller corpus has lost fixtures.
MIN_PAGES = 140

# The block kinds the recognition hooks resolved to (SO11's HOOKS table); each must stay a kind.
BLOCK_KINDS = (
    "Atlas", "EnumTable", "Topology", "BoundaryDiagram", "RuntimeDiagram", "ConcernChecklist", "RecordList",
    "SummaryList", "LifecycleTable", "CoverageIndex", "Table", "Facets", "RelationshipTrace", "StalenessBars",
    "DiagramSource", "Heading", "Section", "Details", "Paragraph", "List", "Code", "Quote", "Anchor", "RecordMarker",
)
STORES = ("materializer", "axiomdb-shaped", "self-shaped", "lens")
# Pages whose golden HTML was written against a git workspace the corpus does not carry.
WORKSPACE_DEPENDENT = {("lens", "index.html"), ("lens", "not-yet-surveyed.html")}
# Constants that exist only to recognise Markdown; the writer may name none.
RECOGNITION_PATTERNS = ("_MARKER_RE", "_LIST_ITEM")

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
# The corpus.
# ---------------------------------------------------------------------------


def unfold(text: str) -> str:
    return re.sub(
        r"@@golden-asset ([0-9a-f]{64})@@",
        lambda m: (GOLDEN / "assets" / m.group(1)).read_text(),
        text,
    )


def fixture_pages(name: str) -> dict[str, str]:
    base = GOLDEN / name / "html"
    return {str(p.relative_to(base)): unfold(p.read_text()) for p in sorted(base.rglob("*.html"))}


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


# The block kinds the compared store pages print, collected as `write_html` runs.
PRINTED_KINDS: set[str] = set()

# The elements of the block kinds no store fixture prints, compared on the `hooks`
# fixture; each pattern is the element its writer branch prints.
HOOKS_ELEMENTS = {
    "RelationshipTrace": r'<figure class="figure"><figcaption class="figure-label">Relationship trace</figcaption>.*?</figure>',
    "DiagramSource": r'<figure class="figure"><figcaption class="figure-label">Diagram source</figcaption>.*?</figure>',
    "Quote": r"<blockquote>.*?</blockquote>",
}


def publish(hp: Any, storage: Path, output: Path) -> tuple[int, int, int]:
    """Publish in this process: the CLI's exit code and how many times `write_html` ran for how many pages."""

    import materialize  # noqa: PLC0415 — the CLI module, run in this process

    counts = [0]
    real = hp.write_html

    def counted(*args: Any, **kwargs: Any) -> Any:
        counts[0] += 1
        PRINTED_KINDS.update(type(item).__name__ for item in walk_model(args[0]))
        return real(*args, **kwargs)

    hp.write_html = counted
    saved = sys.argv
    sys.argv = ["materialize.py", "--storage", str(storage), "--output", str(output), "--allow-external-output"]
    buffer = io.StringIO()
    try:
        with contextlib.redirect_stdout(buffer):
            code = materialize.main()
    finally:
        sys.argv = saved
        hp.write_html = real
    lines = [line for line in buffer.getvalue().splitlines() if line.strip()]
    summary = json.loads(lines[-1]) if lines else {}
    return code, counts[0], int(summary.get("html_pages_total", -1))


def first_difference(left: str, right: str) -> str:
    index = next((i for i, (a, b) in enumerate(zip(left, right, strict=False)) if a != b), min(len(left), len(right)))
    return f"at byte {index}: golden {left[max(0, index - 40):index + 40]!r} vs now {right[max(0, index - 40):index + 40]!r}"


# ---------------------------------------------------------------------------
# The writer's reach, read from the module's syntax tree.
# ---------------------------------------------------------------------------


def module_defs(tree: ast.Module) -> dict[str, ast.AST]:
    defs: dict[str, ast.AST] = {}
    for node in tree.body:
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
            defs[node.name] = node
    return defs


def reach(defs: dict[str, ast.AST], root: str) -> tuple[set[str], set[str], list[str]]:
    """Module definitions `root` reaches, the module names it reads, its imports.

    A class reached by name brings every method, and `self.x` inside a method
    resolves to the class's own methods, so a writer class cannot hide a call
    behind an attribute.
    """

    reached: set[str] = set()
    names: set[str] = set()
    imports: list[str] = []
    methods: dict[str, set[str]] = {}
    for name, node in defs.items():
        if isinstance(node, ast.ClassDef):
            methods[name] = {
                item.name for item in node.body if isinstance(item, ast.FunctionDef | ast.AsyncFunctionDef)
            }
    owner_of = {m: cls for cls, ms in methods.items() for m in ms}
    stack = [root]
    while stack:
        current = stack.pop()
        if current in reached or current not in defs:
            continue
        reached.add(current)
        for node in ast.walk(defs[current]):
            if isinstance(node, ast.Name):
                names.add(node.id)
                if node.id in defs:
                    stack.append(node.id)
            elif isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id in {"self", "cls"}:
                if node.attr in owner_of:
                    stack.append(owner_of[node.attr])
            elif isinstance(node, ast.ImportFrom):
                imports.extend(f"{node.module}.{alias.name}" for alias in node.names)
            elif isinstance(node, ast.Import):
                imports.extend(alias.name for alias in node.names)
    return reached, names, imports


def walk_model(value: Any) -> list[Any]:
    found: list[Any] = []
    stack = [value]
    while stack:
        item = stack.pop()
        if dataclasses.is_dataclass(item) and not isinstance(item, type):
            found.append(item)
            stack.extend(getattr(item, field.name) for field in dataclasses.fields(item))
        elif isinstance(item, list | tuple):
            stack.extend(item)
        elif isinstance(item, dict):
            stack.extend(item.values())
    return found


def main() -> int:
    emit(f"GATE {PACKET} — the page model between a renderer and the HTML, byte for byte on the golden corpus")
    hp, hp_error = load("html_projection")
    page, page_error = load("page")
    legacy, legacy_error = load("legacy_prose")

    # ------------------------------------------------------------- the corpus
    def corpus_present() -> str | None:
        version = GOLDEN / "VERSION"
        if not version.is_file():
            return "fixtures/store-only-golden/VERSION is absent"
        if not re.fullmatch(r"SO\d+", version.read_text().strip()):
            return f"VERSION names no packet: {version.read_text().strip()!r}"
        missing = [name for name in FIXTURES if not (GOLDEN / name / "inputs.json").is_file()]
        if missing:
            return f"fixture(s) absent from the corpus: {missing}"
        total = sum(len(fixture_pages(name)) for name in FIXTURES)
        if total < MIN_PAGES:
            return f"the corpus holds {total} pages, fewer than the {MIN_PAGES} it was written with"
        return None

    check("C1 the golden corpus is present, versioned and whole", corpus_present)

    def byte_identical() -> str | None:
        if hp is None:
            return hp_error
        compared = 0
        with tempfile.TemporaryDirectory(prefix="amanuensis-so11-") as tmp:
            for name in STORES:
                if not (GOLDEN / name / "memory.sql").is_file():
                    return f"{name}: the corpus has no memory.sql"
                golden = fixture_pages(name)
                output = Path(tmp) / name / "docs"
                code, writes, planned = publish(hp, rebuild(name, Path(tmp)), output)
                if code != 0:
                    return f"{name} did not publish (exit {code})"
                if writes != planned:
                    return f"{name}: write_html ran {writes} times for {planned} pages; each must run once per page"
                for path, expected in golden.items():
                    if (name, path) in WORKSPACE_DEPENDENT:
                        continue
                    target = output / path
                    if not target.is_file():
                        return f"{name}/{path} was not printed"
                    actual = target.read_text()
                    if actual != expected:
                        return f"{name}/{path} differs {first_difference(expected, actual)}"
                    compared += 1
                extra = sorted(
                    str(p.relative_to(output)) for p in output.rglob("*.html") if str(p.relative_to(output)) not in golden
                )
                if extra:
                    return f"{name} printed pages the corpus does not hold: {extra[:3]}"
        emit(f"       {compared} golden pages compared byte for byte")
        return None if compared >= 100 else f"only {compared} golden pages were compared"

    check("C2 HTML for every golden page of a rebuilt store is byte-identical, one write_html per page", byte_identical)

    def hooks_elements() -> str | None:
        if hp is None or legacy is None:
            return hp_error or legacy_error
        base = GOLDEN / "hooks"
        inputs = json.loads((base / "inputs.json").read_text())
        pages: list[Any] = []
        models: dict[str, Any] = {}
        for entry in inputs["pages"]:
            fields = dict(entry)
            markdown = base / "md" / fields.pop("markdown_path")
            fields["path"] = markdown.relative_to(base / "md").with_suffix(".html").as_posix()
            fields["terms"] = tuple(tuple(term) for term in fields["terms"])
            pages.append(hp.SitePage(**fields))
            models[fields["path"]] = legacy._LegacyParser(fields["path"]).parse(markdown.read_text())
        with tempfile.TemporaryDirectory(prefix="amanuensis-so11-hooks-") as tmp:
            output = Path(tmp)
            hp.render_html_projection(
                output, pages, inputs["context"], locus_index=inputs["locus_index"], notice=inputs["notice"], models=models
            )
            printed = {page.path: (output / page.path).read_text() for page in pages if (output / page.path).is_file()}
        golden = fixture_pages("hooks")
        if sorted(printed) != sorted(golden):
            return f"the hooks fixture printed {sorted(printed)}, not {sorted(golden)}"
        for kind, pattern in HOOKS_ELEMENTS.items():
            wanted = [m for rel in sorted(golden) for m in re.findall(pattern, golden[rel], re.S)]
            got = [m for rel in sorted(printed) for m in re.findall(pattern, printed[rel], re.S)]
            if not wanted:
                return f"the hooks fixture's golden HTML prints no {kind}, so the comparison is blind"
            if got != wanted:
                at = next((i for i, (a, b) in enumerate(zip(got, wanted, strict=False)) if a != b), min(len(got), len(wanted)))
                shown = got[at] if at < len(got) else "nothing"
                return f"hooks {kind} #{at + 1} prints {first_difference(wanted[at] if at < len(wanted) else '', shown)}"
        if not PRINTED_KINDS:
            return "no block kind was collected from the store fixtures, so the coverage check is blind"
        unseen = [kind for kind in BLOCK_KINDS if kind not in PRINTED_KINDS and kind not in HOOKS_ELEMENTS]
        if unseen:
            return f"block kinds printed by no compared page: {unseen}"
        return None

    check("C2b the block kinds no store prints match the hooks fixture's golden HTML, edges and all", hooks_elements)

    # ---------------------------------------------------- the block kinds
    def block_kinds() -> str | None:
        if page is None:
            return page_error
        absent = [
            name
            for name in BLOCK_KINDS
            if not (
                isinstance(getattr(page, name, None), type) and dataclasses.is_dataclass(getattr(page, name))
            )
        ]
        if absent:
            return f"page.py lacks block kinds {absent}"
        if hasattr(page, "HOOKS"):
            return "page.py still carries the parser's HOOKS table"
        return None

    check("C3 page.py defines a block kind for every shape a page prints, and no parser table", block_kinds)

    # ---------------------------------------------------------- the writer
    def writer_reach() -> str | None:
        if hp is None:
            return hp_error
        tree = ast.parse(PROJECTION_SOURCE.read_text())
        defs = module_defs(tree)
        if "write_html" not in defs:
            return "write_html is not defined in html_projection.py"
        writer, writer_names, writer_imports = reach(defs, "write_html")
        named = sorted(
            name
            for name in writer_names
            if re.fullmatch(r"_[A-Z_]+_PROJECTIONS?", name) or name in RECOGNITION_PATTERNS
        )
        if named:
            return f"write_html's code names recognition constants: {named}"
        parser_imports = [item for item in writer_imports if "legacy_prose" in item or "parse_markdown" in item]
        if parser_imports:
            return f"write_html's code imports the Markdown reader: {parser_imports}"
        if len(writer) < 5:
            return f"write_html reaches only {sorted(writer)}; the builders are not its own"
        return None

    check("C4 write_html neither imports nor names the Markdown reader", writer_reach)
    def writer_is_literal() -> str | None:
        if hp is None or page is None:
            return hp_error or page_error
        markdown = "**bold** _em_ [link](target.md) `mapped` 🟢 mapped <b>"

        def inlines(text: str) -> Any:
            return page.Inlines(nodes=(page.Text(text),), plain=text)

        headers = ("Region", "Subsystem", "Survey depth")
        model = page.Page(
            title="Literal",
            path="concern-checklist.html",
            blocks=(
                page.Section(
                    slug="literal",
                    blocks=(
                        page.Paragraph(text=inlines(markdown)),
                        page.Table(
                            caption="literal",
                            headers=tuple(inlines(h) for h in headers),
                            rows=(page.Row(cells=(inlines("core"), inlines("[B-01](b.md)"), inlines("mapped"))),),
                        ),
                    ),
                ),
            ),
        )
        out = hp.write_html(model, route_map={})
        problems = []
        for needle, what in (
            ("<strong>", "emphasis"),
            ("<em>", "emphasis"),
            ('href="target', "a link"),
            ("<code>", "a code span"),
            ("status-", "a status chip"),
            ("subsystem-atlas", "the atlas signature"),
            ("<b>", "raw HTML"),
        ):
            if needle in out:
                problems.append(what)
        if "**bold** _em_ [link](target.md) `mapped` 🟢 mapped &lt;b&gt;" not in out:
            problems.append("the text is not printed literally")
        if "<table" not in out or "[B-01](b.md)" not in out:
            problems.append("the table is not printed as an ordinary table")
        return f"write_html recognised Markdown: {sorted(set(problems))}" if problems else None

    check("C5 write_html prints Markdown in a model as literal text", writer_is_literal)

    def runs_in_ci() -> str | None:
        try:
            workflow = CI_FILE.read_text()
        except OSError:
            return ".github/workflows/test.yml is unreadable"
        return None if "python3 test-store-only-model.py" in workflow else "no CI step runs this gate"

    check("C6 the gate runs in CI", runs_in_ci)

    if FAILURES:
        emit(f"GATE {PACKET} RED: {FAILURES[0]}")
        return 1
    emit(f"GATE {PACKET} GREEN")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
