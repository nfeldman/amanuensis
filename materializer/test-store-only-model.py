#!/usr/bin/env python3
"""Gate for store-only packet SO11 — the parser split: Markdown → page model → HTML
(design/store-only/PLAN.md §3.1, §3.2, §8 SO11).

The golden corpus under `fixtures/store-only-golden/` was written by
`make-golden.py` from the tree before the split. It holds, per fixture, what
the HTML stage was given (page plan, context, locus index, notice, each page's
finished Markdown) and the HTML it printed. This gate prints the same inputs
again through today's HTML stage and compares bytes.

Turns red when:

  - the golden corpus is absent, lacks a `VERSION` naming the packet that wrote
    it, lacks one of its six fixtures, or holds fewer pages than it was written
    with (so a deleted fixture cannot pass as an identical one);
  - the HTML for any golden page differs from the golden HTML by one byte;
  - `render_html_projection` does not build each page by `parse_markdown` and
    then `write_html` (each called once per page, counted by instrumenting the
    module), or `MarkdownRenderer` still parses inside the render;
  - `page.py` is absent, has no `HOOKS` table, or `HOOKS` misses any
    `_*_PROJECTION(S)` constant of the base tree or of today's
    `html_projection.py`, or either Mermaid shape (`graph`, `pie showData`);
  - a `HOOKS` entry is not a block kind defined in `page.py`, `EnumTable` is
    not the guide's enum table's kind, or `parse_markdown` does not resolve a
    table carrying each hook's header signature (every signature of the
    dict- and set-valued constants), or each Mermaid shape, to that kind;
  - `write_html`, or any function or method it reaches in its module, calls or
    imports `parse_markdown` or another function the parser reaches, or names a
    recognition constant (a `_*_PROJECTION(S)`, the marker or list pattern);
  - `write_html` handles Markdown: given a page model whose text holds
    emphasis, a link, a code span, an emoji status and a table whose headers
    are the subsystem atlas's signature, it prints any of them as anything but
    escaped literal text in an ordinary table;
  - the gate does not run in CI.

False green it cannot exclude: byte identity is proved on the corpus only.
The corpus reaches every recognition hook at least once (the `hooks` fixture
exists for those no store fixture prints), but an input shape none of its pages
carry could still print differently after the split.

Output protocol: exactly one status line, last, on stdout. Every message is
scrubbed, so a missing deliverable reports as an assertion failure and not as
a crash.
"""

from __future__ import annotations

import ast
import dataclasses
import importlib
import json
import re
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

# The recognition constants `rg '_[A-Z_]+_PROJECTIONS?\b'` finds in
# html_projection.py on the base tree (32ad430) and at SO11's start (528199f,
# which added the recorded checklist's signature in SO9). Written out so that
# deleting a constant cannot also delete what this gate expects.
BASE_TREE_HOOKS = (
    "_BOUNDARY_PROJECTION",
    "_CONCERN_CHECKLIST_PROJECTION",
    "_DEPENDENCY_TOPOLOGY_PROJECTION",
    "_ENUM_TABLE_PROJECTION",
    "_LIFECYCLE_TABLE_PROJECTIONS",
    "_RECORDED_CHECKLIST_PROJECTION",
    "_RECORD_PROJECTIONS",
    "_RUNTIME_BOUNDARY_PROJECTION",
    "_SEAM_TOPOLOGY_PROJECTION",
    "_SUBSYSTEM_ATLAS_PROJECTION",
    "_SUMMARY_LIST_PROJECTIONS",
)
MERMAID_HOOKS = {
    "mermaid graph": 'graph LR\n    A["B-01<br>Reader"]\n    A -->|"drains"| B',
    "mermaid pie showData": 'pie showData\n    "a" : 1',
}
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


def fixture_inputs(name: str) -> tuple[dict[str, Any], dict[str, str], dict[str, str]]:
    base = GOLDEN / name
    inputs = json.loads((base / "inputs.json").read_text())
    md = {str(p.relative_to(base / "md")): p.read_text() for p in sorted((base / "md").rglob("*.md"))}
    golden = {
        str(p.relative_to(base / "html")): unfold(p.read_text())
        for p in sorted((base / "html").rglob("*.html"))
    }
    return inputs, md, golden


def render(hp: Any, inputs: dict[str, Any], md: dict[str, str]) -> dict[str, str]:
    pages = [
        hp.SitePage(**{**page, "terms": tuple(tuple(term) for term in page["terms"])})
        for page in inputs["pages"]
    ]
    with tempfile.TemporaryDirectory(prefix="amanuensis-so11-") as tmp:
        output = Path(tmp)
        for path, text in md.items():
            target = output / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text)
        hp.render_html_projection(
            output,
            pages,
            inputs["context"],
            locus_index=inputs["locus_index"],
            notice=inputs["notice"],
        )
        return {
            page.html_path: (output / page.html_path).read_text()
            for page in pages
            if (output / page.html_path).is_file()
        }


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


def signatures(value: Any) -> list[tuple[str, ...]]:
    if isinstance(value, dict):
        return [tuple(key) for key in value]
    if isinstance(value, set | frozenset):
        return sorted(tuple(item) for item in value)
    return [tuple(value)]


def table(signature: tuple[str, ...]) -> str:
    header = "| " + " | ".join(signature) + " |"
    rule = "|" + "---|" * len(signature)
    row = "| " + " | ".join(f"cell {i}" for i in range(len(signature))) + " |"
    return f"{header}\n{rule}\n{row}\n"


def main() -> int:
    emit(f"GATE {PACKET} — Markdown → page model → HTML, byte for byte on the golden corpus")
    hp, hp_error = load("html_projection")
    page, page_error = load("page")

    # ------------------------------------------------------------- the corpus
    corpus: dict[str, tuple[dict[str, Any], dict[str, str], dict[str, str]]] = {}

    def corpus_present() -> str | None:
        version = GOLDEN / "VERSION"
        if not version.is_file():
            return "fixtures/store-only-golden/VERSION is absent"
        if not re.fullmatch(r"SO\d+", version.read_text().strip()):
            return f"VERSION names no packet: {version.read_text().strip()!r}"
        missing = [name for name in FIXTURES if not (GOLDEN / name / "inputs.json").is_file()]
        if missing:
            return f"fixture(s) absent from the corpus: {missing}"
        for name in FIXTURES:
            corpus[name] = fixture_inputs(name)
        total = sum(len(golden) for _inputs, _md, golden in corpus.values())
        if total < MIN_PAGES:
            return f"the corpus holds {total} pages, fewer than the {MIN_PAGES} it was written with"
        return None

    check("C1 the golden corpus is present, versioned and whole", corpus_present)

    def byte_identical() -> str | None:
        if hp is None:
            return hp_error
        if not corpus:
            return "no corpus to compare"
        compared = 0
        for name, (inputs, md, golden) in corpus.items():
            printed = render(hp, inputs, md)
            for path, expected in golden.items():
                actual = printed.get(path)
                if actual is None:
                    return f"{name}/{path} was not printed"
                if actual != expected:
                    return f"{name}/{path} differs {first_difference(expected, actual)}"
                compared += 1
            extra = sorted(set(printed) - set(golden))
            if extra:
                return f"{name} printed pages the corpus does not hold: {extra[:3]}"
        emit(f"       {compared} golden pages compared byte for byte")
        return None

    check("C2 HTML for every golden page is byte-identical", byte_identical)

    # ------------------------------------------------- the route of a render
    def routed() -> str | None:
        if hp is None:
            return hp_error
        for name in ("parse_markdown", "write_html"):
            if not callable(getattr(hp, name, None)):
                return f"html_projection.{name} is absent"
        if "hooks" not in corpus:
            return "no corpus to render"
        inputs, md, _golden = corpus["hooks"]
        counts = {"parse_markdown": 0, "write_html": 0}
        originals = {name: getattr(hp, name) for name in counts}

        def counted(name: str) -> Callable[..., Any]:
            def wrapper(*args: Any, **kwargs: Any) -> Any:
                counts[name] += 1
                return originals[name](*args, **kwargs)

            return wrapper

        legacy = getattr(hp, "MarkdownRenderer", None)
        legacy_render = getattr(legacy, "render", None) if legacy else None
        legacy_calls = [0]
        if legacy_render is not None:
            def counted_legacy(self: Any, *args: Any, **kwargs: Any) -> Any:
                legacy_calls[0] += 1
                return legacy_render(self, *args, **kwargs)

            legacy.render = counted_legacy
        try:
            for name in counts:
                setattr(hp, name, counted(name))
            render(hp, inputs, md)
        finally:
            for name, original in originals.items():
                setattr(hp, name, original)
            if legacy_render is not None:
                legacy.render = legacy_render
        pages = len(inputs["pages"])
        if counts != {"parse_markdown": pages, "write_html": pages}:
            return f"for {pages} pages the render called {counts}; each must run once per page"
        if legacy_calls[0]:
            return f"the render still calls MarkdownRenderer.render ({legacy_calls[0]} times)"
        return None

    check("C3 the render builds each page by parse_markdown then write_html", routed)

    # ---------------------------------------------------------- the HOOKS table
    def hooks_table() -> str | None:
        if page is None:
            return page_error
        hooks = getattr(page, "HOOKS", None)
        if not isinstance(hooks, dict):
            return "page.py has no HOOKS table"
        source = PROJECTION_SOURCE.read_text()
        required = set(BASE_TREE_HOOKS) | set(re.findall(r"\b(_[A-Z_]+_PROJECTIONS?)\b", source)) | set(MERMAID_HOOKS)
        missing = sorted(required - set(hooks))
        if missing:
            return f"HOOKS lacks {missing}"
        not_kinds = sorted(
            name
            for name, kind in hooks.items()
            if not (isinstance(kind, type) and dataclasses.is_dataclass(kind) and kind.__module__ == page.__name__)
        )
        if not_kinds:
            return f"HOOKS entries that are not block kinds defined in page.py: {not_kinds}"
        if hooks["_ENUM_TABLE_PROJECTION"].__name__ != "EnumTable":
            return f"the guide's enum tables resolve to {hooks['_ENUM_TABLE_PROJECTION'].__name__}, not EnumTable"
        return None

    check("C4 page.py's HOOKS names a block kind for every recognition hook", hooks_table)

    def hooks_resolve() -> str | None:
        if hp is None or page is None:
            return hp_error or page_error
        parse = getattr(hp, "parse_markdown", None)
        hooks = getattr(page, "HOOKS", None)
        if not callable(parse) or not isinstance(hooks, dict):
            return "parse_markdown or HOOKS is absent"
        failures: list[str] = []
        exercised = 0
        for name, kind in sorted(hooks.items()):
            if name in MERMAID_HOOKS:
                samples = [f"```mermaid\n{MERMAID_HOOKS[name]}\n```\n"]
            elif name.startswith("_") and hasattr(hp, name):
                samples = [table(signature) for signature in signatures(getattr(hp, name))]
            elif name in BASE_TREE_HOOKS:
                failures.append(f"{name} is no longer in html_projection.py to recognise")
                continue
            else:
                continue
            for sample in samples:
                exercised += 1
                model = parse(f"# Hook\n\n## Hooked section\n\n{sample}", "hook.html")
                kinds = {type(item) for item in walk_model(model)}
                if kind not in kinds:
                    failures.append(f"{name} {sample.splitlines()[0][:60]!r} parsed to no {kind.__name__}")
        if exercised < len(BASE_TREE_HOOKS) + len(MERMAID_HOOKS):
            return f"only {exercised} hook samples were exercised"
        return "; ".join(failures[:3]) if failures else None

    check("C5 parse_markdown resolves each hook's signature to its block kind", hooks_resolve)

    # ---------------------------------------------------------- the writer
    def writer_reach() -> str | None:
        if hp is None:
            return hp_error
        tree = ast.parse(PROJECTION_SOURCE.read_text())
        defs = module_defs(tree)
        if "write_html" not in defs or "parse_markdown" not in defs:
            return "write_html or parse_markdown is not defined in html_projection.py"
        writer, writer_names, writer_imports = reach(defs, "write_html")
        parser, _names, _imports = reach(defs, "parse_markdown")
        shared = sorted(writer & parser)
        if shared:
            return f"write_html reaches parser code: {shared[:6]}"
        named = sorted(
            name
            for name in writer_names
            if re.fullmatch(r"_[A-Z_]+_PROJECTIONS?", name) or name in RECOGNITION_PATTERNS
        )
        if named:
            return f"write_html's code names recognition constants: {named}"
        parser_imports = [item for item in writer_imports if "parse_markdown" in item or item.endswith("._inline")]
        if parser_imports:
            return f"write_html's code imports the parser: {parser_imports}"
        if len(writer) < 5:
            return f"write_html reaches only {sorted(writer)}; the builders are not its own"
        return None

    check("C6 write_html neither calls, imports nor names the parser", writer_reach)

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

    check("C7 write_html prints Markdown in a model as literal text", writer_is_literal)

    def runs_in_ci() -> str | None:
        try:
            workflow = CI_FILE.read_text()
        except OSError:
            return ".github/workflows/test.yml is unreadable"
        return None if "python3 test-store-only-model.py" in workflow else "no CI step runs this gate"

    check("C8 the gate runs in CI", runs_in_ci)

    if FAILURES:
        emit(f"GATE {PACKET} RED: {FAILURES[0]}")
        return 1
    emit(f"GATE {PACKET} GREEN")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
