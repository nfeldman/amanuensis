#!/usr/bin/env python3
"""Gate for store-only packet SO19 — the Markdown intermediate is deleted
(design/store-only/PLAN.md §3.2 step 5, §3.4, §8 SO19).

Every page is built as a page model and printed by `write_html`. What is left of
Markdown is stored prose (`prose.py`) and the one reader of imported bodies,
`legacy_prose.py`. This gate publishes the four store fixtures of the golden
corpus, rebuilt from their recorded SQL dumps in a temporary store each, and
looks at what is left in the tree and in what the publication does.

Turns red when:

  - `parse_markdown`, `MarkdownRenderer`, the old parser class, the Markdown xref
    rewrite (`resolve_text`, `resolve_pages`) or the page-head text helpers
    (`insert_page_head`, `strip_page_head`, `strip_notice`) is defined anywhere
    in the materializer, or a page-level `_*_PROJECTION` signature constant (a
    module-level name ending `_PROJECTION`) is left in any module of the package;
  - `render_html_projection` still takes Markdown, or `SitePage` still names a
    `markdown_path`;
  - the Markdown parser is reached by anything but `legacy_prose.py` on an
    imported body: it is not read at all (the counter is blind), it is called
    from outside `render_body` or `imported_page`, or it is called while a page is
    built that prints no imported body;
  - a `PagePlan` path, a `SitePage` path, a key of the run's manifest or a
    cross-reference target ends in `.md`, or a published page links to one;
  - a composite-index violation seeded into the overview page is not caught
    (the lint runs over the overview model's text, not over its thesis alone),
    or the warning names `index.md`;
  - the HTML of any golden page of a rebuilt fixture differs by one byte, or a
    publication is not green on all three read-back axes;
  - the gate does not run in CI.

False green it cannot exclude: byte identity is proved on four golden stores; an
imported body shaped unlike the ones they hold could print differently, and the
source scan sees names, not behaviour.

Output protocol: exactly one status line, last, on stdout. Every message is
scrubbed, so a missing deliverable reports as an assertion failure and not as
a crash.
"""

from __future__ import annotations

import ast
import contextlib
import dataclasses
import importlib
import inspect
import io
import json
import re
import shutil
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
PACKAGE = ROOT / "amanuensis_materializer"
STORES = ("materializer", "axiomdb-shaped", "self-shaped", "lens")
LEGACY_PARSER = "_LegacyParser"
# Pages whose golden HTML was written against a git workspace the corpus does not carry.
WORKSPACE_DEPENDENT = {("lens", "index"), ("lens", "not-yet-surveyed")}

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
# The corpus, and the stores rebuilt from it.
# ---------------------------------------------------------------------------


def unfold(text: str) -> str:
    return re.sub(
        r"@@golden-asset ([0-9a-f]{64})@@",
        lambda m: (GOLDEN / "assets" / m.group(1)).read_text(),
        text,
    )


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


def golden_pages(store: str) -> list[str]:
    base = GOLDEN / store / "html"
    return sorted(str(p.relative_to(base)) for p in base.rglob("*.html"))


def differs(got: str, wanted: str) -> str:
    at = next((i for i, (a, b) in enumerate(zip(got, wanted, strict=False)) if a != b), min(len(got), len(wanted)))
    return f"differs at byte {at}: {got[at:at + 70]!r} for {wanted[at:at + 70]!r}"


class Run:
    """One in-process publication, with what the parser and the HTML stage were given."""

    def __init__(self) -> None:
        self.summary: dict[str, Any] = {}
        self.parses: list[tuple[str, str]] = []  # (page path, legacy_prose function that called)
        self.outside: list[str] = []  # callers of the parser that are not legacy_prose
        self.site_pages: list[dict[str, Any]] = []
        self.targets: list[str] = []
        self.imports: list[tuple[str | None, str]] = []


def publish(storage: Path, output: Path) -> Run:
    run = Run()
    core, error = load("core")
    lp, error2 = load("legacy_prose")
    if core is None or lp is None:
        raise RuntimeError(error or error2)
    import materialize  # noqa: PLC0415 — the CLI module, run in this process

    conn = sqlite3.connect(f"file:{storage / 'memory.db'}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        run.imports = [(b.subsystem_id, b.kind) for b in lp.imported_bodies(conn)]
    finally:
        conn.close()

    parser = getattr(lp, LEGACY_PARSER, None)
    real_parse = parser.parse if parser is not None and hasattr(parser, "parse") else None

    def counting(self: Any, text: str) -> Any:
        frame, depth = sys._getframe(1), 1
        while frame is not None and frame.f_globals.get("__name__", "").endswith("legacy_prose") and frame.f_code.co_name in ("parse", "_block"):
            frame = frame.f_back
            depth += 1
        caller_module = frame.f_globals.get("__name__", "") if frame else ""
        caller_name = frame.f_code.co_name if frame else ""
        if caller_module.endswith("legacy_prose"):
            run.parses.append((getattr(self, "current_html_path", ""), caller_name))
        else:
            run.outside.append(f"{caller_module}.{caller_name}")
        return real_parse(self, text)

    real_render = core.render_html_projection

    def recording(output_dir: Any, pages: Any, *args: Any, **kwargs: Any) -> Any:
        run.site_pages = [dataclasses.asdict(page) for page in pages]
        return real_render(output_dir, pages, *args, **kwargs)

    real_resolve = core.resolve_model

    def resolving(model: Any, path: str, index: Any) -> Any:
        if not run.targets:
            run.targets = [target for (_d, target, _x) in index.entries.values()]
        return real_resolve(model, path, index)

    if real_parse is not None:
        parser.parse = counting
    core.render_html_projection = recording
    core.resolve_model = resolving
    saved = sys.argv
    sys.argv = ["materialize.py", "--storage", str(storage), "--output", str(output), "--allow-external-output"]
    buffer = io.StringIO()
    try:
        with contextlib.redirect_stdout(buffer):
            code = materialize.main()
    finally:
        sys.argv = saved
        core.render_html_projection = real_render
        core.resolve_model = real_resolve
        if real_parse is not None:
            parser.parse = real_parse
    lines = [line for line in buffer.getvalue().splitlines() if line.strip()]
    run.summary = json.loads(lines[-1]) if lines else {}
    run.summary["exit"] = code
    return run


def page_id(page: dict[str, Any]) -> str:
    """A planned page's path, as HTML."""

    return str(page.get("path") or page.get("markdown_path") or "").replace(".md", ".html")


def axes_green(summary: dict[str, Any]) -> str | None:
    readback = summary.get("readback") or {}
    axes = readback.get("axes") or {}
    red = [axis for axis in ("state", "coverage", "content") if not (axes.get(axis) or {}).get("ok")]
    if summary.get("exit") != 0 or not summary.get("ok") or red:
        first = (readback.get("mismatches") or [{}])[0]
        return f"publish not green: exit {summary.get('exit')}, axes {red or 'ok'}, {json.dumps(first)[:200]}"
    return None


# ---------------------------------------------------------------------------
# What is left in the tree.
# ---------------------------------------------------------------------------

DELETED_NAMES = (
    "parse_markdown", "MarkdownRenderer", "_MarkdownParser", "resolve_text", "resolve_pages",
    "insert_page_head", "strip_page_head", "strip_notice",
)
PROJECTION_NAME = re.compile(r"^_[A-Z][A-Z_]*_PROJECTION$")


def package_sources() -> list[Path]:
    return sorted([*PACKAGE.glob("*.py"), ROOT / "materialize.py"])


def leftovers() -> str | None:
    found: list[str] = []
    for path in package_sources():
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            names: list[str] = []
            if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
                names = [node.name]
            elif isinstance(node, ast.Assign):
                names = [t.id for t in node.targets if isinstance(t, ast.Name)]
            elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
                names = [node.target.id]
            elif isinstance(node, ast.ImportFrom | ast.Import):
                names = [a.asname or a.name for a in node.names]
            for name in names:
                if name in DELETED_NAMES or PROJECTION_NAME.match(name):
                    found.append(f"{path.name}: {name}")
    return f"still in the tree: {sorted(set(found))[:6]}" if found else None


def html_stage_signature() -> str | None:
    hp, error = load("html_projection")
    if hp is None:
        return error
    parameters = inspect.signature(hp.render_html_projection).parameters
    if "markdown" in parameters:
        return "render_html_projection still takes `markdown`"
    fields = {f.name for f in dataclasses.fields(hp.SitePage)}
    if "markdown_path" in fields:
        return "SitePage still names a markdown_path"
    return None


def parser_only_in_legacy() -> str | None:
    lp, error = load("legacy_prose")
    if lp is None:
        return error
    if not hasattr(getattr(lp, LEGACY_PARSER, None), "parse"):
        return f"legacy_prose.py has no {LEGACY_PARSER} to read an imported body with"
    return None


# ---------------------------------------------------------------------------
# The composite-index lint over the overview model.
# ---------------------------------------------------------------------------


def composite_in_overview(root: Path) -> str | None:
    """Publish a scratch copy whose overview grows a row naming a composite index."""

    storage = rebuild("lens", root / "composite")
    scratch = root / "scratch-materializer"
    shutil.copytree(ROOT, scratch, ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "fixtures"))
    target = scratch / "amanuensis_materializer" / "renderers.py"
    text = target.read_text()
    anchor = '    page = Page(name, "index.html", tuple(blocks))\n'
    if anchor not in text:
        return "render_index does not build its page from blocks as `Page(name, \"index.html\", ...)`"
    target.write_text(
        text.replace(anchor, '    blocks.append(_section("Zq", _paragraph("Overall health: 72%")))\n' + anchor, 1)
    )
    proc = subprocess.run(
        [sys.executable, str(scratch / "materialize.py"), "--storage", str(storage),
         "--output", str(root / "composite" / "docs"), "--allow-external-output"],
        capture_output=True, text=True, check=False,
    )
    lines = [line for line in proc.stdout.splitlines() if line.strip()]
    summary = json.loads(lines[-1]) if lines else {}
    warnings = [str(w) for w in summary.get("warnings", [])]
    hit = [w for w in warnings if "composite index" in w]
    if not hit:
        return f"a bare percentage seeded into the overview raised no composite-index warning (warnings: {warnings[:2]})"
    if "index.md" in hit[0] or "index.html" not in hit[0]:
        return f"the warning names the wrong page: {hit[0][:100]}"
    if summary.get("ok"):
        return "the publication stayed ok with a composite index on the overview"
    return None


# ---------------------------------------------------------------------------
def main() -> int:
    check("no Markdown parser, text xref pass, page-head text helper or page-level projection is left", leftovers)
    check("the HTML stage takes page models only", html_stage_signature)
    check("legacy_prose.py holds the one parser", parser_only_in_legacy)

    with tempfile.TemporaryDirectory(prefix="amanuensis-so19-") as tmp:
        root = Path(tmp)
        runs: dict[str, tuple[Run, Path]] = {}

        def publish_all() -> str | None:
            for store in STORES:
                if not (GOLDEN / store / "memory.sql").is_file():
                    return f"{store}: the golden corpus has no memory.sql"
                storage = rebuild(store, root)
                output = root / store / "docs"
                runs[store] = (publish(storage, output), output)
            return None

        check("every store fixture rebuilds and publishes", publish_all)

        def green() -> str | None:
            for store, (run, _output) in runs.items():
                reason = axes_green(run.summary)
                if reason:
                    return f"{store}: {reason}"
            return None if len(runs) == len(STORES) else "not every store was published"

        check("each publication reads back green on all three axes", green)

        def identical() -> str | None:
            if not runs:
                return "nothing was published"
            seen = 0
            for store, (_run, output) in runs.items():
                for page in golden_pages(store):
                    if (store, page.removesuffix(".html")) in WORKSPACE_DEPENDENT:
                        continue
                    path = output / page
                    if not path.is_file():
                        return f"{store}/{page} is not published"
                    wanted = unfold((GOLDEN / store / "html" / page).read_text())
                    if path.read_text() != wanted:
                        return f"{store}/{page} {differs(path.read_text(), wanted)}"
                    seen += 1
            return None if seen >= 100 else f"only {seen} golden pages were compared"

        check("the HTML of every golden page is byte for byte the golden HTML", identical)

        def parser_calls() -> str | None:
            outside = [o for _s, (run, _o) in runs.items() for o in run.outside]
            if outside:
                return f"the Markdown parser was called from {sorted(set(outside))[:3]}, not from legacy_prose.py"
            total = 0
            for store, (run, _output) in runs.items():
                by_record = {
                    str(p.get("record_id") or ""): page_id(p) for p in run.site_pages if p.get("record_id")
                }
                allowed = {f"{kind}.html" for sid, kind in run.imports if not sid}
                allowed |= {by_record[sid] for sid, _kind in run.imports if sid and sid in by_record}
                if run.imports and not run.parses:
                    return f"{store}: imported bodies are stored but none was read by legacy_prose.py"
                for page, caller in run.parses:
                    total += 1
                    if caller not in ("render_body", "imported_page"):
                        return f"{store}: {page} was read by legacy_prose.{caller}, not by render_body or imported_page"
                    if page not in allowed:
                        return f"{store}: legacy_prose read {page}, which prints no imported body"
            if total == 0:
                return "legacy_prose.py was never asked to read an imported body, so the counter is blind"
            return None

        check("the Markdown parser is reached only by legacy_prose.py, on imported bodies", parser_calls)

        def no_md_ids() -> str | None:
            if not runs:
                return "nothing was published"
            for store, (run, output) in runs.items():
                if not run.site_pages:
                    return f"{store}: the HTML stage was not reached"
                for page in run.site_pages:
                    for key, value in page.items():
                        if isinstance(value, str) and value.endswith(".md"):
                            return f"{store}: a page's {key} is {value}"
                bad = [t for t in run.targets if t.split("#", 1)[0].endswith(".md")]
                if bad:
                    return f"{store}: a cross-reference target is {bad[0]}"
                manifests = list((output.parent / "storage").rglob("*manifest*.json"))
                manifests += list(output.rglob("*manifest*.json"))
                for manifest in manifests:
                    keys = re.findall(r'"([^"]+\.md)"\s*:', manifest.read_text())
                    if keys:
                        return f"{store}: {manifest.name} keys a page {keys[0]}"
                for html_file in output.rglob("*.html"):
                    link = re.search(r'(?:href|src)="[^"]*\.md(?:#[^"]*)?"', html_file.read_text())
                    if link:
                        return f"{store}: {html_file.relative_to(output)} links {link.group(0)}"
                if list(output.rglob("*.md")):
                    return f"{store}: the output holds a .md file"
            return None

        check("no page id, cross-reference target, manifest key or link ends in .md", no_md_ids)
        check("a composite index on the overview is caught by the lint over its model", lambda: composite_in_overview(root))

    def in_ci() -> str | None:
        try:
            text = CI_FILE.read_text()
        except OSError:
            return "the CI workflow cannot be read"
        return None if "test-store-only-no-markdown.py" in text else "the gate has no step in test.yml"

    check("the gate runs in CI", in_ci)

    if FAILURES:
        emit(f"GATE SO19 RED: {FAILURES[0][:300]}")
        return 1
    emit("GATE SO19 GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
