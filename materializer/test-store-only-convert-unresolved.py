#!/usr/bin/env python3
"""Gate for store-only packet SO16 — the Unresolved pages are built as page models
(design/store-only/PLAN.md §3.1, §3.2 step 4, §3.4, §8 SO16).

The family is `findings` (open findings), `disagreements`, `open-questions` (decisions
needed), `field-notes` (leads), `stale` (stale knowledge) and `hot-spots`. Each store
fixture of the golden corpus is rebuilt from its recorded SQL dump into a temporary
store and published in this process, with the Markdown parser instrumented. Two stores
are built here from the `lens` dump plus rows the corpus does not hold: a rich one
(findings of every severity and both states, carried obligations, contradictions,
matrices, competing reviews, questions in several categories, leads, stale rows in every
classification, recorded accesses) and a bare one (every record these pages read
removed, so each page prints its empty state). The tree this packet started from
publishes both too, and its HTML is the reference for every page of the family.

Turns red when:

  - the golden corpus is absent, or one of its stores lacks a family page;
  - a family page of a rebuilt fixture differs by one byte from the golden HTML (the
    `lens` fixture's `stale` page is compared with the start tree instead, as it is
    for every page the golden file cannot pin);
  - a family page of the rich or the bare store differs by one byte from what the
    packet's start tree publishes for the same store, or any other page of either
    store differs;
  - the Markdown parser runs while a family page is built, or never runs for any other
    page, so the counter would be blind;
  - a family renderer does not return a `Page` with a title, the page's own path, blocks
    and sources; the findings page's records do not carry the severity and subsystem a
    filter narrows on, or the hot-spot rows do not carry theirs; or a publication is
    not green on all three read-back axes;
  - the gate does not run in CI.

False green it cannot exclude: byte identity is proved on four golden stores and two
stores seeded here; a record shape none of them holds could print differently. The
parser stays in the tree until SO19, which is what makes the comparison possible.

Output protocol: exactly one status line, last, on stdout. Every message is scrubbed,
so a missing deliverable reports as an assertion failure and not as a crash.
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
START_SHA = "63db3a2dea3206f4feca3f4aa478f50c35c41d4c"

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

# SO24 adds sentences and figures to the System boundaries page; taking them out can leave the
# wrapper that held a run of paragraphs empty (PLAN §3.2's update rule).
_EMPTY_FLOW = re.compile(r'<div class="prose-flow">\s*</div>\n?')


def unmarked(text: str) -> str:
    return _EMPTY_FLOW.sub("", _SO20_MARKS.sub("", _SO22_FIGURES.sub("", text)))

FAMILY = ("findings", "disagreements", "open-questions", "field-notes", "stale", "hot-spots")
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


def golden_page(store: str, page: str) -> str | None:
    path = GOLDEN / store / "html" / f"{page}.html"
    return unfold(path.read_text()) if path.is_file() else None


SHA = "0e5ac6940690be78954049d81682906deb671336"
WHEN = "2026-11-12 09:30:00"


def seed_rich(storage: Path) -> None:
    """Add what the corpus lacks to the `lens` store, so every branch of the family prints."""

    db = sqlite3.connect(storage / "memory.db")
    try:
        cur = db.cursor()
        for sid, name, status in (("B-04", "Cache", "mapped"), ("B-05", "Index", "adversarial"), ("B-06", "Audit", "unmapped")):
            cur.execute(
                "INSERT INTO subsystems (id, name, status, layer, scope) VALUES (?, ?, ?, 'backend', 'src')",
                (sid, name, status),
            )
        cur.execute("INSERT INTO seams (id, shared_object, shared_object_kind, party_a, party_b) VALUES ('SM-4', 'cache', 'cache', 'B-04', 'B-05')")

        def finding(fid: str, sid: str, sev: str, status: str, symptom: str, cause: str, context: str | None, sha: str | None) -> None:
            cur.execute(
                "INSERT INTO findings (finding_id, subsystem_id, symptom, root_cause, severity, status,"
                " business_context, ref_sha, session_id, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'p9', ?, ?)",
                (fid, sid, symptom, cause, sev, status, context, sha, WHEN, WHEN),
            )

        finding("B01-2", "B-01", "CRITICAL", "confirmed-bug", "Rows repeat after a restart. The reader replays the last page.", "The cursor is saved before the page is acknowledged.", "A repeat bills a customer twice.", SHA)
        finding("B01-3", "B-01", "HIGH", "confirmed-bug", "A | in a name\nbreaks the log line.", "The formatter does not escape it.", None, None)
        finding("B04-1", "B-04", "HIGH", "confirmed-bug", "The cache never expires a slot.", "No timer is armed. See `cache.ts`, and B-02 for the writer.", "Memory grows without bound while B-01 waits.", SHA)
        finding("B04-2", "B-04", "MEDIUM", "confirmed-bug", "Stale slot served for **one** call.", "The slot is read before the check.", None, SHA)
        finding("B05-1", "B-05", "LOW", "confirmed-bug", "Index order is unstable across runs", "A map is iterated.", "", SHA)
        finding("B05-2", "B-05", "MEDIUM", "fixed", "Keys collide on case.", "Keys are not folded.", None, SHA)
        finding("B03-1", "B-03", "LOW", "fixed", "Queue depth is misreported. It lags by one.", "The counter is bumped late.", "Operators read the depth.", SHA)
        finding("B03-2", "B-03", "CRITICAL", "ruled-out", "A resolved one stays off the page.", "None.", None, SHA)
        cur.execute(
            "INSERT INTO carry_runs (id, source_kind, source_path, archived_store_id, archived_anchor, reason,"
            " expected_count, imported_count, session_id) VALUES (1, 'store', '/old/memory.db', 'old-store', ?, 'carry', 2, 2, 'p9')",
            (SHA,),
        )
        for fid, sid, sev, symptom, cause in (
            ("B09-1", "B-09", "HIGH", "An old defect nobody re-found.", "The old cause."),
            ("B09-2", "B-01", "LOW", "A second old defect. It had two sentences.\n\nA second paragraph naming B-02 and SM-1.", ""),
        ):
            cur.execute(
                "INSERT INTO carried_findings (archived_finding_id, archived_store_id, archived_anchor_sha, subsystem_id,"
                " severity, symptom, root_cause, carry_run_id, archived_resolution, carried_by_session)"
                " VALUES (?, 'old-store', ?, ?, ?, ?, ?, 1, 'open', 'p9')",
                (fid, SHA, sid, sev, symptom, cause),
            )
        for fa, fb, loc, kind, resolution in (
            ("B01-1", "B01-2", "src/reader.ts@abc", "classification-conflict", None),
            ("B01-3", "B04-1", None, "severity | conflict", "unresolved"),
            ("B04-1", "B04-2", "src/cache.ts", "severity-conflict", "a-supersedes-b"),
        ):
            cur.execute(
                "INSERT INTO contradictions (finding_a, finding_b, shared_location, conflict_type, detected_at, resolution)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (fa, fb, loc, kind, WHEN, resolution),
            )
        for sid, symptom, outcome in (
            ("B-04", "slots survive a restart", "unresolved-competition"),
            (None, "a global symptom | with a pipe", "open"),
            ("B-05", "a settled one", "resolved"),
        ):
            cur.execute(
                "INSERT INTO diagnosticity_sessions (subsystem_id, symptom, outcome, created_at) VALUES (?, ?, ?, ?)",
                (sid, symptom, outcome, WHEN),
            )
        for code, sid, cls, quality, linchpin, rationale in (
            ("CC-1", "B-04", "unresolved-competition", "name-inferred", 1, "Two concerns | explain it."),
            ("CC-2", "B-05", "unresolved-competition", None, 0, None),
            ("CC-3", "B-01", "unresolved-competition", "code-verified", 0, "Both fit."),
        ):
            cur.execute(
                "INSERT INTO dispositions (subsystem_id, concern_code, classification, evidence_quality,"
                " linchpin_dependent, rationale, assessed_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (sid, code, cls, quality, linchpin, rationale, WHEN),
            )
        for cat, sid, phase, question, blocked, assumed, resolution in (
            ("contradiction", "B-01", "phase-3", "Which reading is right?", "The merge of two pages, SM-1 included.", "The first one.", "open"),
            ("domain-knowledge", None, None, "Is tenancy per account in B-04?", None, None, "open"),
            ("domain-knowledge", "B-04", "phase-2", "Does the cache hold secrets?", "A review of the slots.", "It does not.", "open"),
            ("tooling-limit", None, "phase-1", "Could not run the suite.", "A runtime check.", None, "open"),
            ("other", "B-05", None, "Anything else | here?", None, "None.", "open"),
            ("scope-judgment", None, None, "A settled question.", None, None, "answered"),
        ):
            cur.execute(
                "INSERT INTO open_questions (category, subsystem_id, phase, question, what_blocked, what_assumed,"
                " resolution, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (cat, sid, phase, question, blocked, assumed, resolution, WHEN),
            )
        for cat, observation, location, follow_up in (
            ("candidate-concern", "Clock skew could reorder rows in B-02, see CC-1.", "src/clock.ts", "open"),
            ("anomaly", "A `retry` loop with no bound.", None, "open"),
            ("pattern", "Every reader checks twice.", "B-01", "open"),
            ("tension", "Two modules own the cursor.", "src/cursor.ts@abc", "open"),
            ("connection", "A closed one.", None, "B01-1"),
        ):
            cur.execute(
                "INSERT INTO field_notes (category, observation, location, follow_up, created_at) VALUES (?, ?, ?, ?, ?)",
                (cat, observation, location, follow_up, WHEN),
            )
        for sid, path, cls, sha, why, since, reason in (
            ("B-01", "src/moved.ts", "examined", SHA, "the read path | edge", "2026-11-10 08:00:00", "git-drift"),
            ("B-04", "src/cache.ts", "examined", None, None, None, None),
            ("B-04", "src/slot.ts", "candidate", SHA, "slots", "2026-11-11 08:00:00", "absent"),
            ("B-05", "src/idx.ts", "deferred-with-reason", SHA, "later", "2026-11-11 09:00:00", None),
            ("B-05", "gen/out.js", "generated-ignore", SHA, "generated", "2026-11-11 09:00:00", "git-drift"),
        ):
            cur.execute(
                "INSERT OR REPLACE INTO file_ledger (subsystem_id, file_path, why_in_scope, classification, ref_sha, stale,"
                " stale_since, stale_reason) VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
                (sid, path, why, cls, sha, since, reason),
            )
        cur.execute("INSERT INTO entries (id, tier, subsystem_id) VALUES ('E-1', 1, 'B-04')")
        cur.execute("INSERT INTO access_log (entry_id, entry_tier, trigger) VALUES ('E-1', 1, 'read')")
        cur.execute("INSERT INTO access_log (entry_id, entry_tier, trigger) VALUES ('E-1', 1, 'read')")
        db.commit()
    finally:
        db.close()


def seed_bare(storage: Path) -> None:
    """Remove every record the family reads from the `lens` store: each page prints its empty state."""

    db = sqlite3.connect(storage / "memory.db")
    try:
        db.execute("PRAGMA foreign_keys = OFF")
        for table in (
            "finding_resolution_events", "contradictions", "findings", "diagnosticity_sessions",
            "dispositions", "open_questions", "field_notes", "file_ledger",
        ):
            with contextlib.suppress(sqlite3.Error):
                db.execute(f"DELETE FROM {table}")
        db.commit()
    finally:
        db.close()


def seed_leaf(storage: Path) -> None:
    """The bare store with no subsystem either, so the hot-spot page prints its empty state."""

    seed_bare(storage)
    db = sqlite3.connect(storage / "memory.db")
    try:
        db.execute("PRAGMA foreign_keys = OFF")
        for table in (
            "seams", "claims", "narratives", "explanations", "scope_gaps", "scope_reconciliations",
            "xrefs", "imported_artifacts", "vocabulary", "subsystems",
        ):
            with contextlib.suppress(sqlite3.Error):
                db.execute(f"DELETE FROM {table}")
        db.commit()
    finally:
        db.close()


def publish_instrumented(storage: Path, output: Path) -> tuple[dict[str, Any], list[str]]:
    """Publish in this process, recording the page path of each Markdown parse."""

    hp, error = load("legacy_prose")
    if hp is None:
        raise RuntimeError(error)
    import materialize  # noqa: PLC0415 — the CLI module, run in this process

    calls: list[str] = []
    real = hp._LegacyParser.parse

    def counting(self: Any, markdown: str) -> Any:
        calls.append(self.current_html_path)
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


def flat(blocks: Any) -> list[Any]:
    out: list[Any] = []
    for block in blocks:
        out.append(block)
        inner = getattr(block, "blocks", None)
        if inner:
            out.extend(flat(inner))
    return out


# ---------------------------------------------------------------------------
# The checks.
# ---------------------------------------------------------------------------


def main() -> int:
    page_mod, page_error = load("page")

    def corpus_present() -> str | None:
        if not (GOLDEN / "VERSION").is_file():
            return "the golden corpus has no VERSION"
        missing = [f"{store}/{page}" for store in STORES for page in FAMILY if golden_page(store, page) is None]
        return f"golden pages are absent: {missing[:4]}" if missing else None

    check("the golden corpus holds the family's pages for every store fixture", corpus_present)

    with tempfile.TemporaryDirectory(prefix="amanuensis-so16-") as tmp:
        root = Path(tmp)
        runs: dict[str, tuple[Path, Path, dict[str, Any], list[str]]] = {}
        seeds: dict[str, Callable[[Path], None]] = {"rich": seed_rich, "bare": seed_bare, "leaf": seed_leaf}
        names = (*STORES, *seeds)

        def publish_all() -> str | None:
            for store in names:
                source = store if store in STORES else "lens"
                if not (GOLDEN / source / "memory.sql").is_file():
                    return f"{source}: the golden corpus has no memory.sql"
                storage = rebuild(source, root, store)
                if store in seeds:
                    seeds[store](storage)
                output = root / store / "docs"
                summary, calls = publish_instrumented(storage, output)
                runs[store] = (storage, output, summary, calls)
            return None

        check("every store fixture and every seeded store rebuilds and publishes", publish_all)

        def green() -> str | None:
            for store, (_storage, _output, summary, _calls) in runs.items():
                reason = axes_green(summary)
                if reason:
                    return f"{store}: {reason}"
            return None if len(runs) == len(names) else "not every store was published"

        check("each publication reads back green on all three axes", green)

        def seeds_reach() -> str | None:
            wanted = {
                "rich": {
                    "findings": ("Carried obligations", "Awaiting verification", "B04-1"),
                    "disagreements": ("Findings that cannot both be right", "DM-", "Concern reviews that recorded a competition"),
                    "open-questions": ("Domain knowledge", "Tooling limit", "Decision #12"),
                    "field-notes": ("Candidate concern", "recorded 2026-11-12"),
                    "stale": ("Scoped at", "Deferred at", "Read at"),
                    "hot-spots": ("Access heat", "Unassessed seam sides"),
                },
                "bare": {
                    "findings": ("No finding is open or awaiting verification",),
                    "disagreements": ("No record stands undiscriminated",),
                    "open-questions": ("No question is open",),
                    "field-notes": ("No lead is open",),
                    "stale": ("No file is recorded in the ledger",),
                },
                "leaf": {"hot-spots": ("No subsystem is recorded",)},
            }
            for store, pages in wanted.items():
                if store not in runs:
                    return f"{store} was not published"
                for page, words in pages.items():
                    text = (runs[store][1] / f"{page}.html").read_text()
                    absent = [word for word in words if word not in text]
                    if absent:
                        return f"{store}/{page}.html does not print {absent}, so the seed misses its branch"
            return None

        check("the seeded stores reach the branches they were made for", seeds_reach)

        def no_parse() -> str | None:
            if len(runs) != len(names):
                return "not every store was published"
            blind = 0
            for store, (_storage, _output, _summary, calls) in runs.items():
                called = sorted({path for path in calls if path[:-5] in FAMILY})
                if called:
                    return f"{store}: the Markdown parser ran while building {called}"
                blind += len(calls)
            return None if blind >= 20 else f"the counter saw {blind} parses of other pages, so it is not counting"

        check("no family page is built by the Markdown parser, and the counter counts the others", no_parse)

        def golden_equal() -> str | None:
            for store in STORES:
                if store not in runs:
                    return "not every store was published"
                output = runs[store][1]
                for page in FAMILY:
                    wanted = golden_page(store, page)
                    path = output / f"{page}.html"
                    if wanted is None or not path.is_file():
                        return f"{store}/{page}.html is missing"
                    if path.read_text() != wanted:
                        return f"{store}/{page}.html {differs(path.read_text(), wanted)}"
            return None

        check("every family page of every golden store is reproduced byte for byte", golden_equal)

        def start_equal() -> str | None:
            with tempfile.TemporaryDirectory(prefix="amanuensis-so16-start-") as old:
                tree = start_tree(Path(old))
                if tree is None:
                    return f"the tree at {START_SHA[:12]} cannot be extracted from git"
                for store in ("lens", *seeds):
                    if store not in runs:
                        return f"{store} was not published"
                    source = store if store in STORES else "lens"
                    storage = rebuild(source, Path(old), store)
                    if store in seeds:
                        seeds[store](storage)
                    before = Path(old) / store / "docs"
                    if not run_start_tree(tree, storage, before):
                        return f"the tree this packet started from did not publish the {store} store"
                    after = runs[store][1]
                    files = sorted(
                        {str(p.relative_to(before)) for p in before.rglob("*") if p.is_file() and p.suffix in (".html", ".js")}
                        | {str(p.relative_to(after)) for p in after.rglob("*") if p.is_file() and p.suffix in (".html", ".js")}
                    )
                    for name in FAMILY:
                        if f"{name}.html" not in files:
                            return f"{store} publishes no {name}.html"
                    for name in files:
                        a, b = after / name, before / name
                        if not a.is_file() or not b.is_file():
                            return f"{store}/{name} is published by only one of the two trees"
                        if unmarked(a.read_text()) != b.read_text():
                            return f"{store}/{name} {differs(unmarked(a.read_text()), b.read_text())}"
            return None

        check("the lens, rich, bare and leaf stores print what the packet's start tree prints for them", start_equal)

        def renderers_return_pages() -> str | None:
            if page_mod is None:
                return page_error
            core, error = load("core")
            renderers, error2 = load("renderers")
            if core is None or renderers is None:
                return error or error2
            if "rich" not in runs:
                return "the rich store was not published"
            storage = runs["rich"][0]
            conn = core.open_ro(storage / "memory.db")
            try:
                built: dict[str, Any] = {}
                for page, fn in (
                    ("findings", renderers.render_findings),
                    ("disagreements", renderers.render_disagreements),
                    ("open-questions", renderers.render_open_questions),
                    ("field-notes", renderers.render_field_notes),
                    ("stale", renderers.render_stale),
                    ("hot-spots", renderers.render_hot_spots),
                ):
                    model, sources = fn(conn, storage)
                    if not isinstance(model, page_mod.Page):
                        return f"the renderer of {page} returns {type(model).__name__}, not a Page"
                    if model.path != f"{page}.html":
                        return f"the Page of {page} has the path {model.path!r}"
                    if not model.title or not model.blocks or not sources:
                        return f"the {page} Page has no title, no blocks or no sources"
                    built[page] = model
            finally:
                conn.close()
            findings = built["findings"]
            records = [
                record
                for block in flat(findings.blocks)
                if isinstance(block, page_mod.RecordList) and block.kind == "finding"
                for record in block.records
            ]
            if len(records) != 9:
                return f"the rich store's open findings page holds {len(records)} finding records, not 9"
            if findings.facets is None or findings.facets.scope != "findings":
                return "the findings Page names no filter scope"
            wanted = {
                ("Cache", "High"), ("Cache", "Medium"), ("Read path", "Critical"), ("Read path", "High"), ("Index", "Low"),
                ("Write path", "High"), ("Index", "Medium"), ("Queue", "Low"),
            }
            got = {(r.filter.subsystem, r.filter.severity) for r in records if r.filter}
            if got != wanted:
                return f"the finding records carry the filter values {sorted(got)}, not {sorted(wanted)}"
            hot = built["hot-spots"]
            if hot.facets is None or hot.facets.scope != "hot-spots":
                return "the hot-spots Page names no filter scope"
            rows = [row for block in flat(hot.blocks) if isinstance(block, page_mod.Table) for row in block.rows]
            if len(rows) != 8 or any(row.filter is None for row in rows):
                return f"the hot-spot table holds {len(rows)} rows, not 8 each carrying a filter"
            if dict(hot.facets.values).get("subsystem") is None or "Open critical + high" not in dict(hot.facets.values).get("severity", ()):
                return "the hot-spots Page's facets do not name the subsystems and the severity bands"
            return None

        check("each renderer returns a Page; the filters ride on its records and rows", renderers_return_pages)

    def in_ci() -> str | None:
        text = CI_FILE.read_text() if CI_FILE.is_file() else ""
        return None if "test-store-only-convert-unresolved.py" in text else "test.yml does not run the gate"

    check("the gate runs in CI", in_ci)

    if FAILURES:
        emit(f"GATE SO16 RED: {FAILURES[0]}"[:480])
        return 1
    emit("GATE SO16 GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
