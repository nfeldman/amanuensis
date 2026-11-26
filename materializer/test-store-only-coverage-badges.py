#!/usr/bin/env python3
"""Gate for store-only packet SO23 — coverage bars (A5) and finding badges (A4)
(design/store-only/PLAN.md §7.3, §8 S5 and SO23, Appendix B).

Two temporary stores are seeded from the golden `materializer` store and published.
Store A has a dependency edge, a ledger, and two reconciliations; store B has no
dependency edge (so the architecture page draws the atlas) and no reconciliation.
Every drawn mark is compared with the records the store holds, read independently of
the renderer, and A4's counts with the Hot spots page's printed table.

Turns red when:
  - `diagrams.py` lacks `finding_badges`, `hot_spot_measures` or `coverage_bars_model`, or a
    below-threshold input (no reconciliation, a subsystem with no ledger row, a subsystem at
    a depth that authorizes no coverage) draws a bar instead of a sentence;
  - a badge's count differs from the same subsystem's cell on `hot-spots.html` (open critical +
    high, open medium + low, awaiting verification, undiscriminated), on the atlas or on the
    boundary diagram; a measure is merged into another; a zero count draws a badge; a subsystem
    below `concerns` (here `scoping`) draws one; a "clean" badge is drawn anywhere; a badge on
    a subsystem at `concerns` or `adversarial` is not marked "under review", or one at `mapped` is;
  - a coverage bar's segments differ from `file_standing`'s counts for its subsystem, a bar is
    drawn for a subsystem at `unmapped` or `deferred` (tested where it holds ledger rows and a
    reconciliation is recorded, so only its depth can stop the bar), a state with a zero count is drawn, or the
    account omits a state's count, the denominator, the revision the bar was read at, or the
    repository's tracked-path count from the latest reconciliation, or its sentence counts ledger
    rows whose paths are gone among the tracked paths the ledger holds;
  - the Files page's repository bar differs from the latest `scope_reconciliations` row
    (unledgered, exempt, ledgered) or uses an earlier row;
  - a store with no reconciliation draws a coverage bar, or its page lacks "coverage not
    measured", or prints a zero where nothing was measured;
  - (final review F4/claude, F11/claude) a subsystem with open findings is badged at a depth
    other than concerns, adversarial or mapped (structural, deferred, unmapped, scoping), a
    badge count differs from the store's open findings by severity, the badge note's "n of m"
    miscounts, or a coverage segment loses the line style its standing is drawn with;
  - an SVG lacks `role="img"`, a `<title>` or a `<desc>` that counts its segments, states a font
    size under 11, uses a literal colour, runs a script, or is not 960 wide, or a mark has no
    `data-node`;
  - a coverage account does not quote, for each subsystem it draws, what its depth authorizes and
    cannot justify (Appendix B rule 2);
  - the badge note or a coverage sentence names a depth other than by its contract label
    ("Concerns" for "Reviewing concerns", "Scoping" for "Scoped");
  - two publications of one store print different figures or badges;
  - a sabotage that edits one page and reseals `.projection-contract.json` is not reported with
    the right axis and object type: a badge count changed, a badge removed from the boundary
    diagram or the atlas, a badge added where the store holds none, a segment removed or
    re-pointed, a coverage figure removed, the repository bar's segment removed;
  - the read-back of either publication is not green on every axis;
  - the golden corpus's `VERSION` is not SO23, or a golden page differs from the corpus this
    packet started from outside a coverage figure, a "not measured" sentence, a badge, or a
    badge note (or a figure or sentence of SO22's diagrams, which a fix to the slice may reprint),
    or no golden page gained one;
  - the gate has no step in `.github/workflows/test.yml`.

Output protocol: exactly one status line, last, on stdout.
"""

from __future__ import annotations

import hashlib
import importlib
import json
import re
import shutil
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
GOLDEN_REL = "materializer/fixtures/store-only-golden"
CI_FILE = REPO / ".github" / "workflows" / "test.yml"
PACKET = "SO23"
# The commit this packet started from: its golden corpus is the reference.
START_SHA = "636d91df62d972759f67e0ab9306cf7a126da26a"

FILES = "files.html"
ARCHITECTURE = "architecture.html"
MASTER_PLAN = "master-plan.html"
HOT_SPOTS = "hot-spots.html"
PAGES = {
    "B-01": "subsystems/b01-job-scheduler.html",
    "B-02": "subsystems/b02-auth-service.html",
    "F-01": "subsystems/f01-web-ui.html",
}
# The four measures A4 badges, and the Hot spots column each one is read from.
MEASURES = {
    "crit-high": "Open critical + high",
    "med-low": "Open medium + low",
    "awaiting": "Awaiting verification",
    "undiscriminated": "Undiscriminated",
}
BADGED = ("concerns", "adversarial", "mapped")
UNDER_REVIEW = ("concerns", "adversarial")
STATES = ("examined", "examined-stale", "scoped-unread", "excluded", "absent")
LABELS = {
    "examined": "Examined",
    "examined-stale": "Examined, since changed",
    "scoped-unread": "In scope, not yet read",
    "excluded": "Excluded",
    "absent": "No longer in the repository",
}
SHA = "cafe1234deadbeef00112233445566778899aabb"
OLD_SHA = "0ld0ld0ld0ld0ld0ld0ld0ld0ld0ld0ld0ld0ld0"

_SCRUB: tuple[tuple[str, str], ...] = (
    ("MODULE_NOT_FOUND", "module-absent"),
    ("ModuleNotFoundError", "python-module-absent"),
    ("Cannot find module", "cannot load module"),
    ("No such file or directory", "path is absent"),
    ("No such file", "path is absent"),
    ("SyntaxError", "syntax-error"),
    ("ImportError", "python-import-error"),
    ("ReferenceError", "reference-error"),
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
# The fixture stores.
# ---------------------------------------------------------------------------

LEDGER_B01 = (
    ("scheduler/a.ts", "examined", 0, None),
    ("scheduler/b.ts", "examined", 0, None),
    ("scheduler/c.ts", "examined", 0, None),
    ("scheduler/d.ts", "examined", 1, "git-drift"),
    ("scheduler/e.ts", "candidate", 0, None),
    ("scheduler/f.ts", "candidate", 0, None),
    ("scheduler/vendor.ts", "vendor-ignore", 0, None),
)
LEDGER_B02 = (("auth/x.ts", "candidate", 0, None), ("auth/y.ts", "candidate", 0, None))
LEDGER_F01 = (("web/p.tsx", "candidate", 0, None), ("web/q.tsx", "candidate", 0, None))
# Two readings; the latest is the one drawn. tracked = ledgered-in-tree + unledgered.
RECONCILIATIONS = (
    (OLD_SHA, 12, 6, 6, 0, 1),
    (SHA, 28, 9, 19, 0, 1),
)


def build_store(root: Path, *, kind: str) -> Path:
    """Store A (kind="a") or store B (kind="b"); see the module docstring."""

    storage = root / "storage"
    storage.mkdir(parents=True)
    (storage / "workspace_path").write_text("/example/FictionalProject\n")
    db = sqlite3.connect(storage / "memory.db")
    try:
        db.executescript((GOLDEN / "materializer" / "memory.sql").read_text())
        db.execute("UPDATE subsystems SET status = 'concerns' WHERE id = 'B-01'")
        for fid, sid, severity, status in (
            ("B01-2", "B-01", "MEDIUM", "confirmed-bug"),
            ("B01-3", "B-01", "LOW", "confirmed-bug"),
            ("B01-4", "B-01", "HIGH", "fixed"),
            ("F01-1", "F-01", "CRITICAL", "confirmed-bug"),
        ):
            db.execute(
                "INSERT INTO findings (finding_id, subsystem_id, symptom, root_cause, severity, status, ref_sha, session_id, pass_type)"
                " VALUES (?, ?, 'a symptom', 'a cause', ?, ?, 'deadbeef', 's1', 'survey')",
                (fid, sid, severity, status),
            )
        db.execute(
            "INSERT INTO dispositions (subsystem_id, concern_code, classification, rationale, ref_sha, session_id, pass_type)"
            " VALUES ('B-02', 'CB-1', 'unresolved-competition', 'two readings', 'deadbeef', 's1', 'survey')"
        )
        ledger = [("B-01", *r) for r in LEDGER_B01] + [("B-02", *r) for r in LEDGER_B02]
        if kind == "b":
            db.execute("DELETE FROM xrefs")
            db.execute("UPDATE subsystems SET status = 'unmapped' WHERE id = 'F-01'")
            ledger += [("F-01", *r) for r in LEDGER_F01]
        for sid, path, classification, stale, reason in ledger:
            db.execute(
                "INSERT INTO file_ledger (subsystem_id, file_path, classification, ref_sha, stale, stale_reason)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (sid, path, classification, "deadbeef" if classification == "examined" else None, stale, reason),
            )
        if kind == "a":
            for sha, tracked, ledgered, unledgered, absent, exempt in RECONCILIATIONS:
                db.execute(
                    "INSERT INTO scope_reconciliations (detected_sha, tree_digest, ledger_digest, tracked_paths, ledger_rows,"
                    " unledgered, absent, exempt) VALUES (?, 'tree', 'ledger', ?, ?, ?, ?, ?)",
                    (sha, tracked, ledgered, unledgered, absent, exempt),
                )
        db.commit()
    finally:
        db.close()
    return storage


def publish(storage: Path) -> tuple[Path | None, str | None]:
    proc = subprocess.run(
        [sys.executable, str(ROOT / "materialize.py"), "--storage", str(storage), "--force-full"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    lines = [line for line in proc.stdout.splitlines() if line.strip()]
    try:
        summary = json.loads(lines[-1]) if lines else {}
    except json.JSONDecodeError:
        summary = {}
    output = storage / "docs"
    if not (output / "index.html").is_file():
        said = summary.get("error") or proc.stderr[-300:]
        return None, f"the fixture was not published (exit {proc.returncode}): {scrub(said)}"
    return output, None


def verify(core: Any, storage: Path, output: Path) -> dict[str, Any]:
    return core.Materializer(storage=storage, output=output).verify_projection()


def reseal(output: Path, rel: str) -> None:
    contract_path = output / ".projection-contract.json"
    contract = json.loads(contract_path.read_text())
    digest = hashlib.sha256((output / rel).read_bytes()).hexdigest()
    for page in contract["pages"]:
        if page["path"] == rel:
            page["content_hash"] = digest
    contract_path.write_text(json.dumps(contract, indent=2) + "\n")


# ---------------------------------------------------------------------------
# Reading the pages.
# ---------------------------------------------------------------------------


def plain(html: str) -> str:
    return " ".join(re.sub(r"<[^>]+>", " ", html).split())


def figures(text: str, kind: str = "coverage-bars") -> list[str]:
    return re.findall(rf'<figure\b[^>]*data-diagram="{kind}"[^>]*>.*?</figure>', text, re.S)


def drawn(figure: str) -> tuple[list[str], list[str]]:
    nodes = re.findall(r'<g\b[^>]*\bdata-node="([^"]*)"', figure)
    edges = re.findall(r'<(?:line|path)\b[^>]*\bdata-edge="([^"]*)"', figure)
    return nodes, edges


def account_of(figure: str) -> str:
    match = re.search(r'<div class="diagram-account"[^>]*>(.*?)</div>', figure, re.S)
    return plain(match.group(1)) if match else ""


def svg_faults(figure: str, segments: int) -> str | None:
    svg = re.search(r"<svg\b[^>]*>.*?</svg>", figure, re.S)
    if svg is None:
        return "the figure holds no SVG"
    text = svg.group(0)
    start = re.match(r"<svg\b[^>]*>", text).group(0)  # type: ignore[union-attr]
    if 'role="img"' not in start:
        return 'the SVG has no role="img"'
    if 'viewBox="0 0 960 ' not in start:
        return f"the SVG's viewBox is not 960 wide: {start[:200]}"
    title = re.search(r"<title\b[^>]*>(.+?)</title>", text, re.S)
    desc = re.search(r"<desc\b[^>]*>(.+?)</desc>", text, re.S)
    if title is None or not title.group(1).strip():
        return "the SVG has no <title>"
    if desc is None:
        return "the SVG has no <desc>"
    said = re.search(r"(\d+) segments?\b", desc.group(1))
    if said is None or int(said.group(1)) != segments:
        return f"the <desc> does not count the {segments} segments it draws: {desc.group(1)[:160]!r}"
    for size in re.findall(r'font-size[:=]\s*"?(\d+(?:\.\d+)?)', text):
        if float(size) < 11:
            return f"text is {size}px, under 11"
    if re.search(r"#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(", text):
        return "a colour is written as a literal, not a CSS token"
    if re.search(r"<script|\son\w+=", figure):
        return "the figure runs script"
    if re.search(r"<(?:line|path)\b[^>]*data-edge", text):
        return "a coverage bar draws an arrow no record joins"
    return None


def badges_on(text: str) -> list[dict[str, Any]]:
    """Every badge a page prints: where, whose, which measure, its count, its mark, its printed words."""

    out = []
    for m in re.finditer(r'<(span|g)\b([^>]*\bdata-finding-badge="[^"]*"[^>]*)>(.*?)</\1>', text, re.S):
        attrs = dict(re.findall(r'([\w-]+)="([^"]*)"', m.group(2)))
        out.append(
            {
                "surface": "atlas" if m.group(1) == "span" else "boundary",
                "subsystem": attrs.get("data-subsystem", ""),
                "measure": attrs.get("data-finding-badge", ""),
                "count": attrs.get("data-count", ""),
                "review": attrs.get("data-under-review", ""),
                "words": plain(m.group(3)),
            }
        )
    return out


def hot_spot_cells(text: str) -> dict[str, dict[str, int]]:
    """The Hot spots table, as printed: subsystem id → measure → count."""

    out: dict[str, dict[str, int]] = {}
    for row in re.findall(r"<tr data-filter-row.*?</tr>", text, re.S):
        sid = re.search(r">([A-Z]+-\d+)</abbr>", row)
        if sid is None:
            continue
        out[sid.group(1)] = {
            measure: int(re.search(rf'data-label="{re.escape(label)}">(\d+)<', row).group(1))  # type: ignore[union-attr]
            for measure, label in MEASURES.items()
        }
    return out


def table(storage: Path, sql: str, args: tuple[Any, ...] = ()) -> list[tuple[Any, ...]]:
    db = sqlite3.connect(f"file:{storage / 'memory.db'}?mode=ro", uri=True)
    try:
        return list(db.execute(sql, args))
    finally:
        db.close()


def standing_counts(storage: Path, sid: str) -> dict[str, int]:
    return {
        str(state): int(n)
        for state, n in table(storage, "SELECT standing_state, COUNT(*) FROM file_standing WHERE subsystem_id = ? GROUP BY 1", (sid,))
    }


def statuses(storage: Path) -> dict[str, str]:
    return {str(a): str(b) for a, b in table(storage, "SELECT id, status FROM subsystems")}


def wanted_badges(storage: Path, hot: dict[str, dict[str, int]]) -> dict[tuple[str, str], int]:
    """What A4 must show: a count per (subsystem, measure) that is above zero, at `concerns` or above."""

    status = statuses(storage)
    return {
        (sid, measure): n
        for sid, cells in hot.items()
        for measure, n in cells.items()
        if n > 0 and status.get(sid) in BADGED
    }


# ---------------------------------------------------------------------------
# The golden corpus.
# ---------------------------------------------------------------------------

_ADDED = re.compile(
    r'<figure\b[^>]*data-diagram="(?:coverage-bars|seam-contract|flow-strip)"[^>]*>.*?</figure>\n?'
    r'|<p class="diagram-below"[^>]*data-diagram="(?:coverage-bars|seam-contract|flow-strip)"[^>]*>.*?</p>\n?'
    r'|<div class="atlas-badges"[^>]*>.*?</div>'
    r'|<g class="boundary-svg-badge"[^>]*>.*?</g>'
    r'|<p class="finding-badge-note"[^>]*>.*?</p>\n?',
    re.S,
)


# The slice's earlier diagrams (SO22): a fix to slice S5 may reprint them, so they are taken out of
# both the start's corpus and the current one, which still pins everything around them.
_EARLIER = re.compile(
    r'<figure\b[^>]*data-diagram="(?:survey-workflow|status-ladder)"[^>]*>.*?</figure>\n?'
    r'|<p class="diagram-below"[^>]*data-diagram="(?:survey-workflow|status-ladder)"[^>]*>.*?</p>\n?',
    re.S,
)


# SO24 adds seam contracts to the Boundaries page and SO25 flow strips to the subsystem pages
# (PLAN §3.2's update rule); taking them out can leave the wrapper that held a run of paragraphs empty.
_EMPTY_FLOW = re.compile(r'<div class="prose-flow">\s*</div>\n?')


def _carry_excluded_meaning(corpus: Path) -> Path:
    """The start's corpus with the one sentence the survey-scope lane changed on purpose (SC6):
    what `excluded` means. Every other byte is still held to what the packet started from."""

    old = "A ledger row classifies the path as generated, vendored, irrelevant, or deferred with a recorded reason."
    new = (
        "The path is outside the survey set (an owner rule, the repository's ignore files, or meta sorting), "
        "or a ledger row inside it classifies the path as generated, vendored, irrelevant, or deferred with a recorded reason."
    )
    for page in corpus.rglob("*.html"):
        text = page.read_text()
        if old in text:
            page.write_text(text.replace(old, new))
    return corpus


def start_corpus(into: Path) -> Path | None:
    archive = subprocess.run(["git", "-C", str(REPO), "archive", START_SHA, GOLDEN_REL], capture_output=True)
    if archive.returncode != 0 or not archive.stdout:
        return None
    tar = into / "start.tar"
    tar.write_bytes(archive.stdout)
    unpacked = subprocess.run(["tar", "-xf", str(tar), "-C", str(into)], capture_output=True)
    corpus = into / GOLDEN_REL
    return _carry_excluded_meaning(corpus) if unpacked.returncode == 0 and corpus.is_dir() else None


# SO20's record marks (`data-record`, `data-state`, `data-node`, `data-edge`) are not this
# packet's addition; the slice-S4 fix added more of them after it landed (F3-F5), so a page is
# compared with them taken out on both sides.
_SO20_MARKS = re.compile(r' data-(?:record|state|node|edge)="[^"]*"')

def golden_additions_only(previous: Path | None) -> str | None:
    version = GOLDEN / "VERSION"
    if not version.is_file() or version.read_text().strip() not in (PACKET, "SO24", "SO25"):
        return f"the golden corpus's VERSION is {version.read_text().strip() if version.is_file() else 'absent'!r}, not {PACKET} or a later diagram packet"
    if previous is None:
        return f"the golden corpus cannot be read from git at {START_SHA[:12]}"
    before = {str(p.relative_to(previous)): p for p in previous.rglob("*.html") if "/html/" in str(p)}
    after = {str(p.relative_to(GOLDEN)): p for p in GOLDEN.rglob("*.html") if "/html/" in str(p)}
    if sorted(before) != sorted(after):
        return f"the corpus holds {len(after)} HTML pages for the start's {len(before)}"
    gained = 0
    for rel in sorted(after):
        new, old = (_EARLIER.sub("", _SO20_MARKS.sub("", t)) for t in lineage_style.pair(after[rel].read_text(), before[rel].read_text()))
        # Blocks are joined by a newline, so taking one out can leave a newline behind; only that is let go.
        if _EMPTY_FLOW.sub("", _ADDED.sub("", new)).replace("\n", "") != old.replace("\n", ""):
            return f"{rel} differs from the start's corpus outside a coverage figure, a sentence, a badge or its note, or the slice's earlier diagrams"
        gained += new != old
    for asset in (previous / "assets").iterdir():
        if not (GOLDEN / "assets" / asset.name).is_file():
            return f"the folded asset {asset.name[:12]} changed"
    return None if gained >= 5 else f"only {gained} golden pages gained a coverage figure, sentence or badge"


# ---------------------------------------------------------------------------


def main() -> int:
    diagrams, error = load("diagrams")
    core, error2 = load("core")
    page_mod, error3 = load("page")
    projection, error4 = load("html_projection")
    readback, error5 = load("readback")
    missing = error or error2 or error3 or error4 or error5
    if not missing:
        absent = [n for n in ("finding_badges", "hot_spot_measures", "coverage_bars_model") if not hasattr(diagrams, n)]
        if absent:
            missing = f"diagrams.py lacks {', '.join(absent)}"
    if missing:
        emit(f"GATE SO23 RED: {missing}")
        return 1

    with tempfile.TemporaryDirectory(prefix="amanuensis-so23-") as tmp:
        root = Path(tmp)
        store_a = build_store(root / "a", kind="a")
        store_b = build_store(root / "b", kind="b")
        out_a, why_a = publish(store_a)
        out_b, why_b = publish(store_b)
        if out_a is None or out_b is None:
            emit(f"GATE SO23 RED: {why_a or why_b}")
            return 1

        def green(storage: Path, output: Path) -> str | None:
            summary = verify(core, storage, output)
            if summary.get("ok"):
                return None
            first = (summary.get("mismatches") or [{}])[0]
            return f"{summary.get('mismatch_count')} mismatch(es), first {first}"

        check("store A reads back green on every axis", lambda: green(store_a, out_a))
        check("store B reads back green on every axis", lambda: green(store_b, out_b))

        hot_a = hot_spot_cells((out_a / HOT_SPOTS).read_text())
        hot_b = hot_spot_cells((out_b / HOT_SPOTS).read_text())

        # -- A4 --------------------------------------------------------------
        def model_badges() -> str | None:
            db = sqlite3.connect(f"file:{store_a / 'memory.db'}?mode=ro", uri=True)
            db.row_factory = sqlite3.Row
            try:
                got = diagrams.finding_badges(db)
            finally:
                db.close()
            seen = {(sid, b.measure): b.count for sid, found in got.items() for b in found}
            want = wanted_badges(store_a, hot_a)
            if seen != want:
                return f"finding_badges says {sorted(seen.items())}; Hot spots, at concerns or above, says {sorted(want.items())}"
            if not want:
                return "the fixture holds no badge to compare"
            return None

        check("the badge model equals Hot spots' counts at concerns or above", model_badges)

        def boundary_badges() -> str | None:
            found = [b for b in badges_on((out_a / ARCHITECTURE).read_text()) if b["surface"] == "boundary"]
            seen = {(b["subsystem"], b["measure"]): int(b["count"] or -1) for b in found}
            want = wanted_badges(store_a, hot_a)
            if seen != want or len(found) != len(want):
                return f"the boundary diagram's badges are {sorted(seen.items())}; hot-spots.html's counts are {sorted(want.items())}"
            for b in found:
                if str(b["count"]) not in re.findall(r"\d+", b["words"]):
                    return f"a {b['measure']} badge on {b['subsystem']} says {b['words']!r}, not its count {b['count']}"
            return None

        check("the boundary diagram's badges equal Hot spots' counts", boundary_badges)

        def atlas_badges() -> str | None:
            # The subsystem atlas (O7) on the master plan, always drawn; the architecture page's atlas
            # only when no dependency edge is recorded (store B).
            for label, output, storage, hot in (("A", out_a, store_a, hot_a), ("B", out_b, store_b, hot_b)):
                want = wanted_badges(storage, hot)
                pages = [MASTER_PLAN] + ([ARCHITECTURE] if label == "B" else [])
                for rel in pages:
                    text = (output / rel).read_text()
                    if 'class="subsystem-atlas"' not in text:
                        return f"store {label}: {rel} draws no atlas"
                    found = [b for b in badges_on(text) if b["surface"] == "atlas"]
                    seen = {(b["subsystem"], b["measure"]): int(b["count"] or -1) for b in found}
                    if seen != want or len(found) != len(want):
                        return f"store {label}: the atlas on {rel} badges {sorted(seen.items())}; hot-spots.html's counts are {sorted(want.items())}"
                    for m in re.finditer(r'<li class="atlas-item"[^>]*data-record="subsystem:([^"]+)"[^>]*>(.*?)</li>', text, re.S):
                        inside = {b["measure"] for b in badges_on(m.group(2))}
                        held = {measure for (sid, measure) in want if sid == m.group(1)}
                        if inside != held:
                            return f"store {label}: {rel}'s atlas item for {m.group(1)} carries badges {sorted(inside)}; it should carry {sorted(held)}"
                boundary = [b for b in badges_on((output / ARCHITECTURE).read_text()) if b["surface"] == "boundary"]
                if {(b["subsystem"], b["measure"]) for b in boundary} != set(want):
                    return f"store {label}: the boundary diagram carries different badges from the atlas"
            return None

        check("the atlas's badges equal Hot spots' counts, one item each", atlas_badges)

        def badge_rules() -> str | None:
            for label, output, storage in (("A", out_a, store_a), ("B", out_b, store_b)):
                text = (output / ARCHITECTURE).read_text() + (output / MASTER_PLAN).read_text()
                status = statuses(storage)
                for b in badges_on(text):
                    if status.get(b["subsystem"]) not in BADGED:
                        return f"store {label}: {b['subsystem']} is at {status.get(b['subsystem'])}, below concerns, and carries a badge"
                    if b["count"] in ("", "0"):
                        return f"store {label}: a zero count draws a badge on {b['subsystem']}"
                    under = status[b["subsystem"]] in UNDER_REVIEW
                    if under != (b["review"] == "yes"):
                        return f"store {label}: {b['subsystem']} ({status[b['subsystem']]}) is {'not ' if under else ''}marked under review"
                    if under and "under review" not in text:
                        return f"store {label}: the page never says 'under review'"
                names = re.findall(r'data-finding-badge="([^"]*)"', text)
                if any(n not in MEASURES for n in names):
                    return f"store {label}: a badge names a measure outside {sorted(MEASURES)}: {sorted(set(names))}"
                if re.search(r"\bclean\b|no open findings|all clear", " ".join(b["words"] for b in badges_on(text)), re.I):
                    return f"store {label}: a badge reads as clean"
            # Separate badges per measure: B-01 holds two measures, so it carries two badges.
            a = badges_on((out_a / ARCHITECTURE).read_text())
            if len({b["measure"] for b in a if b["subsystem"] == "B-01"}) < 2:
                return "B-01 holds more than one measure and does not carry a badge for each"
            if any(b["subsystem"] == "F-01" for b in a):
                return "F-01 is at scoping and its open critical finding is badged"
            return None

        check("badges: none at zero, none below concerns, none clean, under review where it applies", badge_rules)

        def badge_depths() -> str | None:
            # Appendix B rule 2: badges from `concerns` up, at no other depth. The fixtures hold no
            # open finding at `structural` or `deferred`, so B-01, which holds open findings, is
            # moved through every depth on a copy of store A (final review F4/claude, F11/claude).
            source = sqlite3.connect(f"file:{store_a / 'memory.db'}?mode=ro", uri=True)
            db = sqlite3.connect(":memory:")
            try:
                source.backup(db)
            finally:
                source.close()
            db.row_factory = sqlite3.Row
            try:
                vocab = json.loads((REPO / "mcp-server" / "contracts" / "conspectus-vocabulary.json").read_text())
                depths = [str(v["value"]) for v in vocab["enums"]["subsystem_status"]["values"]]
                for depth in [*depths, "deferred"]:
                    db.execute("UPDATE subsystems SET status = ? WHERE id = 'B-01'", (depth,))
                    badged = bool(diagrams.finding_badges(db).get("B-01"))
                    if badged != (depth in BADGED):
                        return f"B-01 at {depth} {'carries' if badged else 'lacks'} a badge"
                # A mapped subsystem with nothing to count is one more eligible subsystem with no
                # badge, and the note's "n of m" must say so (F11/claude: `bare = 0` stayed green).
                db.execute("UPDATE subsystems SET status = 'concerns' WHERE id = 'B-01'")

                def note_counts() -> tuple[int, int] | None:
                    note = " ".join(b.text for b in diagrams.badge_note(db, diagrams.finding_badges(db)))
                    said = re.search(r"(\d+) of (\d+) subsystems", note)
                    return (int(said.group(1)), int(said.group(2))) if said else None

                before = note_counts()
                db.execute("INSERT INTO subsystems (id, name, status) VALUES ('Z-09', 'Quiet fixture', 'mapped')")
                after = note_counts()
                if before is None or after != (before[0] + 1, before[1] + 1):
                    return f"a mapped subsystem with no open finding moved the badge note from {before} to {after}, not one more of one more"
            finally:
                db.close()
            return None

        check("a subsystem with open findings is badged at concerns, adversarial and mapped and at no other depth", badge_depths)

        def badge_counts_and_note() -> str | None:
            # The counts are the store's open findings by severity, read here without the
            # renderer's measures (F11/claude), and the note's "n of m" counts the eligible
            # subsystems that show none.
            open_rows = table(
                store_a,
                "SELECT f.subsystem_id, f.severity FROM finding_state_current v"
                " JOIN findings f ON f.finding_id = v.finding_id WHERE v.resolution_state = 'open'",
            )
            seeded = {
                "crit-high": sum(1 for sid, sev in open_rows if sid == "B-01" and sev in ("CRITICAL", "HIGH")),
                "med-low": sum(1 for sid, sev in open_rows if sid == "B-01" and sev in ("MEDIUM", "LOW")),
            }
            boundary = {b["measure"]: b["count"] for b in badges_on((out_a / ARCHITECTURE).read_text())
                        if b["surface"] == "boundary" and b["subsystem"] == "B-01"}
            for measure, n in seeded.items():
                if str(boundary.get(measure, "0") or "0") != str(n):
                    return f"B-01's {measure} badge says {boundary.get(measure)!r}; the store holds {n} such open findings"
            if seeded["med-low"] < 2:
                return "the fixture holds fewer than two open medium or low findings on B-01"
            status = statuses(store_a)
            eligible = sorted(sid for sid, st in status.items() if st in BADGED)
            shown = {sid for (sid, _measure) in wanted_badges(store_a, hot_a)}
            bare = len([sid for sid in eligible if sid not in shown])
            note = re.search(r'<p class="finding-badge-note"[^>]*>(.*?)</p>', (out_a / ARCHITECTURE).read_text(), re.S)
            said = re.search(r"(\d+) of (\d+) subsystems", plain(note.group(1)) if note else "")
            if said is None or (int(said.group(1)), int(said.group(2))) != (bare, len(eligible)):
                return f"the badge note says {said.group(0) if said else None!r}; {bare} of {len(eligible)} eligible subsystems show no badge"
            return None

        check("badge counts are the store's open findings, and the note counts the eligible subsystems with none", badge_counts_and_note)

        def segment_lines() -> str | None:
            # Appendix B rule 9: colour is never the only signal, so each standing keeps its line.
            want = {"examined": None, "examined-stale": "5 3", "scoped-unread": None, "excluded": "1.5 3", "absent": "5 3"}
            figure = figures((out_a / PAGES["B-01"]).read_text())
            if len(figure) != 1:
                return "B-01's page holds no single coverage figure"
            seen = 0
            for state, dash in want.items():
                node = re.search(rf'<g\b[^>]*data-node="coverage:B-01:{state}"[^>]*>(.*?)</g>', figure[0], re.S)
                if node is None:
                    continue
                seen += 1
                got = re.search(r'stroke-dasharray="([^"]*)"', node.group(1))
                if (got.group(1) if got else None) != dash:
                    return f"B-01's {state} segment is drawn with dash {got.group(1) if got else None!r}, not {dash!r}"
            if seen < 2 or 'data-node="coverage:B-01:examined-stale"' not in figure[0]:
                return "B-01's bar does not draw a stale segment beside another to compare"
            return None

        check("each coverage segment keeps the line its standing is drawn with", segment_lines)

        # -- A5 --------------------------------------------------------------
        def segment_nodes(storage: Path, sid: str) -> list[str]:
            return sorted(f"coverage:{sid}:{state}" for state, n in standing_counts(storage, sid).items() if n)

        def subsystem_bar() -> str | None:
            for sid in ("B-01", "B-02"):
                page = (out_a / PAGES[sid]).read_text()
                found = figures(page)
                if len(found) != 1:
                    return f"{PAGES[sid]} holds {len(found)} coverage figures, not 1"
                nodes, edges = drawn(found[0])
                if sorted(nodes) != segment_nodes(store_a, sid) or edges:
                    return f"{sid}'s bar draws {sorted(nodes)} and {len(edges)} arrows; file_standing holds {segment_nodes(store_a, sid)}"
                if (fault := svg_faults(found[0], len(nodes))) is not None:
                    return f"{sid}: {fault}"
                if f'data-subject="{sid}"' not in found[0]:
                    return f"{sid}'s bar does not name its subject"
                counts = standing_counts(store_a, sid)
                total = sum(counts.values())
                text = account_of(found[0])
                for state in STATES:
                    n = counts.get(state, 0)
                    if n and not re.search(rf"{re.escape(LABELS[state])}[^.]*\b{n} of {total}\b", text):
                        return f"{sid}'s account does not say {LABELS[state]!r}: {n} of {total}"
                    if not n and not re.search(rf"{re.escape(LABELS[state])}[^.]*\bnone\b", text, re.I):
                        return f"{sid}'s account does not say that no file is {LABELS[state]!r}"
                if SHA[:8] not in plain(found[0]):
                    return f"{sid}'s bar does not print the revision it was read at ({SHA[:8]})"
                if OLD_SHA[:8] in plain(found[0]):
                    return f"{sid}'s bar was read at an earlier reconciliation"
                if not re.search(r"\b28\b", text):
                    return f"{sid}'s account does not give the repository's 28 tracked paths"
            return None

        check("each subsystem page's coverage bar is its file_standing counts, with an account", subsystem_bar)

        def no_bar_when_unmeasured() -> str | None:
            f01 = (out_a / PAGES["F-01"]).read_text()
            if figures(f01):
                return "F-01 has no ledger row and a bar is drawn"
            if not re.search(r"no file is recorded", plain(f01), re.I) or "coverage not measured" not in plain(f01).lower():
                return "F-01 has no ledger row and its page does not say coverage is not measured"
            for sid, rel in PAGES.items():
                page = (out_b / rel).read_text()
                if figures(page) or "data-node=\"coverage:" in page:
                    return f"store B has no reconciliation and {sid}'s page draws coverage"
                if "coverage not measured" not in plain(page).lower():
                    return f"store B has no reconciliation and {sid}'s page does not say coverage is not measured"
            files = (out_b / FILES).read_text()
            if figures(files) or "coverage not measured" not in plain(files).lower():
                return "store B has no reconciliation and its Files page draws coverage or does not say it is not measured"
            sentence = " ".join(re.findall(r'<p class="diagram-below"[^>]*>(.*?)</p>', files, re.S))
            if re.search(r"\b0 of\b|\b0%|\bzero\b", plain(sentence)):
                return f"the Files page prints a zero where nothing was measured: {plain(sentence)[:200]!r}"
            return None

        check("no reconciliation, or no ledger row: coverage not measured, never zero", no_bar_when_unmeasured)

        def depth_gate() -> str | None:
            # F-01 is `unmapped` in store B and holds two ledger rows; Appendix B rule 2 draws a box only.
            for output in (out_b,):
                page = (output / PAGES["F-01"]).read_text()
                if figures(page):
                    return "an unmapped subsystem draws coverage"
            db = sqlite3.connect(f"file:{store_a / 'memory.db'}?mode=ro", uri=True)
            db.row_factory = sqlite3.Row
            try:
                model = diagrams.coverage_bars_model(db, "F-01")
                top = diagrams.coverage_bars_model(db, "B-01")
            finally:
                db.close()
            if model.nodes or not model.below.strip():
                return "a subsystem with no ledger row is drawn, not said in a sentence"
            if not top.nodes or top.below:
                return "B-01 holds a ledger and a reconciliation and is not drawn"
            # The depth guard on its own: a copy of store A, where a reconciliation is recorded, with
            # F-01 `unmapped` and B-02 `deferred`, each holding ledger rows. Only depth can stop their bars.
            parked = root / "parked.db"
            shutil.copyfile(store_a / "memory.db", parked)
            db = sqlite3.connect(parked)
            db.row_factory = sqlite3.Row
            try:
                db.execute("UPDATE subsystems SET status = 'unmapped' WHERE id = 'F-01'")
                db.execute("UPDATE subsystems SET status = 'deferred' WHERE id = 'B-02'")
                for path, classification, stale, reason in LEDGER_F01:
                    db.execute(
                        "INSERT INTO file_ledger (subsystem_id, file_path, classification, ref_sha, stale, stale_reason)"
                        " VALUES ('F-01', ?, ?, NULL, ?, ?)",
                        (path, classification, stale, reason),
                    )
                db.commit()
                if not db.execute("SELECT 1 FROM scope_reconciliations").fetchone():
                    return "the depth fixture lost its reconciliation"
                whole = diagrams.coverage_bars_model(db)
                for sid, depth in (("F-01", "Unmapped"), ("B-02", "Deferred")):
                    if not db.execute("SELECT 1 FROM file_standing WHERE subsystem_id = ?", (sid,)).fetchone():
                        return f"the depth fixture gives {sid} no ledger row"
                    one = diagrams.coverage_bars_model(db, sid)
                    if one.nodes or not one.below.strip():
                        return f"{sid} is {depth.lower()}, holds ledger rows and a reconciliation, and its bar is drawn"
                    if depth not in one.below:
                        return f"{sid}'s sentence does not say it is at {depth}: {one.below[:160]!r}"
                    if any(n.record.startswith(f"coverage:{sid}:") for n in whole.nodes):
                        return f"{sid} is {depth.lower()} and the repository's figure draws its bar"
            finally:
                db.close()
            return None

        check("below its minimum, or at a depth that authorizes none, a bar is a sentence", depth_gate)

        def absent_paths_counted() -> str | None:
            # 10 tracked = (8 ledger rows - 2 for paths gone from the tree) + 4 with no row: the sentence
            # must say 6 tracked paths are in the ledger, as the repository bar draws, and name the 2 gone.
            db = sqlite3.connect(":memory:")
            db.row_factory = sqlite3.Row
            source = sqlite3.connect(f"file:{store_a / 'memory.db'}?mode=ro", uri=True)
            try:
                source.backup(db)
                db.execute(
                    "INSERT INTO scope_reconciliations (detected_sha, tree_digest, ledger_digest, tracked_paths, ledger_rows,"
                    " unledgered, absent, exempt) VALUES ('feedface', 'tree', 'ledger', 10, 8, 4, 2, 0)"
                )
                model = diagrams.coverage_bars_model(db)
            finally:
                source.close()
                db.close()
            text = " ".join(" ".join(model.account).split())
            repo = {n.record: n.count for n in model.nodes if n.record.startswith("coverage:repository:")}
            if repo.get("coverage:repository:ledgered") != 6 or repo.get("coverage:repository:unledgered") != 4:
                return f"the repository bar draws {repo}, not 6 in the ledger and 4 in none"
            if not re.search(r"\b10 paths\b[^.]*\bholds 6 of them\b", text):
                return f"the account does not say the ledger holds 6 of the 10 tracked paths: {text[-400:]!r}"
            if not re.search(r"\b2\b[^.]*no longer", text):
                return f"the account does not count the 2 ledger rows whose paths are gone: {text[-400:]!r}"
            return None

        check("the reconciliation sentence counts tracked paths in the ledger as the bar does, apart from absent ones", absent_paths_counted)

        def contract_labels() -> str | None:
            # Prose names a depth by its contract label, never by its stored value capitalised.
            vocab = json.loads((REPO / "mcp-server" / "contracts" / "conspectus-vocabulary.json").read_text())
            depths = vocab["enums"]["subsystem_status"]["values"]
            wrong = {v["value"].capitalize(): v["label"] for v in depths if v["value"].capitalize() != v["label"]}
            db = sqlite3.connect(":memory:")
            db.row_factory = sqlite3.Row
            source = sqlite3.connect(f"file:{store_a / 'memory.db'}?mode=ro", uri=True)
            try:
                source.backup(db)
                db.execute("UPDATE subsystems SET status = 'adversarial' WHERE id = 'B-02'")
                note = " ".join(b.text for b in diagrams.badge_note(db, diagrams.finding_badges(db)))
                db.execute("DELETE FROM file_ledger")
                bare = diagrams.coverage_bars_model(db).below
            finally:
                source.close()
                db.close()
            for where, said, needs in (
                ("the badge note", note, ("concerns", "adversarial")),
                ("the coverage sentence", bare, ("scoping",)),
            ):
                if not said:
                    return f"{where} is empty"
                for stored, label in wrong.items():
                    if re.search(rf"\b{stored}\b", said):
                        return f"{where} says {stored!r}, not the contract's label {label!r}: {said!r}"
                for value in needs:
                    label = next(v["label"] for v in depths if v["value"] == value)
                    if label not in said:
                        return f"{where} does not name {value} by its label {label!r}: {said!r}"
            return None

        check("badge and coverage prose names depths by their contract labels", contract_labels)

        def qualified() -> str | None:
            # Appendix B rule 2: a subject's coverage quotes what its depth authorizes and cannot justify.
            vocab = json.loads((REPO / "mcp-server" / "contracts" / "conspectus-vocabulary.json").read_text())
            depth = {v["value"]: v for v in vocab["enums"]["subsystem_status"]["values"]}
            status = statuses(store_a)
            files = " ".join(account_of(figures((out_a / FILES).read_text())[0]).split())
            for sid in ("B-01", "B-02"):
                text = " ".join(account_of(figures((out_a / PAGES[sid]).read_text())[0]).split())
                for field in ("authorizes", "cannot_justify"):
                    quoted = " ".join(str(depth[status[sid]][field]).split())
                    if quoted not in plain(text):
                        return f"{sid}'s coverage does not quote what {status[sid]} {field.replace('_', ' ')}: {quoted!r}"
                    if quoted not in plain(files):
                        return f"the Files page's coverage does not quote what {sid}'s depth {field.replace('_', ' ')}"
            return None

        check("coverage quotes what each drawn subject's depth authorizes and cannot justify", qualified)

        def files_page() -> str | None:
            found = figures((out_a / FILES).read_text())
            if len(found) != 1:
                return f"the Files page holds {len(found)} coverage figures, not 1"
            nodes, edges = drawn(found[0])
            want = [n for sid in ("B-01", "B-02") for n in segment_nodes(store_a, sid)]
            want += ["coverage:repository:ledgered", "coverage:repository:exempt", "coverage:repository:unledgered"]
            if sorted(nodes) != sorted(want) or edges:
                return f"the Files page draws {sorted(nodes)}; the records are {sorted(want)}"
            if (fault := svg_faults(found[0], len(nodes))) is not None:
                return fault
            text = account_of(found[0])
            for needle in ("28", "19"):
                if not re.search(rf"\b{needle}\b", text):
                    return f"the Files page's account omits {needle}, from the latest reconciliation"
            if SHA[:8] not in plain(found[0]):
                return "the Files page does not print the reconciliation's revision"
            if OLD_SHA[:8] in plain(found[0]) or re.search(r"\b12 tracked\b", text):
                return "the Files page draws an earlier reconciliation"
            if not re.search(r"1 of 3 subsystems? (?:has|have) no (?:recorded )?(?:ledger row|file)", text):
                return f"the Files page does not count the subsystem with no ledger row (1 of 3): {text[:300]!r}"
            return None

        check("the Files page draws one bar per subsystem and the repository's, from the latest reconciliation", files_page)

        def two_publications() -> str | None:
            storage2 = build_store(root / "a2", kind="a")
            out2, why = publish(storage2)
            if out2 is None:
                return why
            for rel in (FILES, ARCHITECTURE, *PAGES.values()):
                a, b = (out_a / rel).read_text(), (out2 / rel).read_text()
                if figures(a) != figures(b) or badges_on(a) != badges_on(b):
                    return f"{rel}: the figures or badges of two publications differ"
            return None

        check("two publications of one store print the same figures and badges", two_publications)

        def links_resolve() -> str | None:
            for rel in (FILES, *PAGES.values()):
                text = (out_a / rel).read_text()
                for figure in figures(text):
                    for href in re.findall(r'<a\b[^>]*href="([^"]+)"', figure):
                        path, _, fragment = href.partition("#")
                        target = (out_a / rel).parent / path if path else out_a / rel
                        if not target.resolve().is_file():
                            return f"{rel}: a coverage link goes to {href}, which is not a page"
                        if fragment and f'id="{fragment}"' not in target.read_text():
                            return f"{rel}: a coverage link goes to {href}, and no anchor {fragment} is there"
            return None

        check("every coverage link reaches an anchor", links_resolve)

        # -- sabotage, resealed ----------------------------------------------
        def sabotage(label: str, storage: Path, output: Path, page: str, edit: Callable[[str], str], axis: str, object_type: str, object_id: str) -> None:
            def run() -> str | None:
                copy = root / "sabotage"
                if copy.exists():
                    shutil.rmtree(copy)
                shutil.copytree(output, copy)
                target = copy / page
                before = target.read_text()
                after = edit(before)
                if after == before:
                    return f"the edit found nothing to change on {page}"
                target.write_text(after)
                reseal(copy, page)
                mismatches = verify(core, storage, copy).get("mismatches") or []
                if any("differ from the publication receipt" in str(m.get("detail")) for m in mismatches):
                    return "the receipt was not resealed; the hash check saw the edit"
                hit = [
                    m for m in mismatches
                    if m.get("axis") == axis and m.get("object_type") == object_type
                    and (not object_id or object_id in str(m.get("object_id")))
                ]
                if hit:
                    return None
                seen = sorted({(m.get("axis"), m.get("object_type"), m.get("object_id")) for m in mismatches})
                return f"no {axis} mismatch on {object_type} {object_id or '(any)'}; saw {seen[:4]}"

            check(f"sabotage, resealed: {label}", run)

        def first(pattern: str, replace: Callable[[re.Match[str]], str]) -> Callable[[str], str]:
            return lambda text: re.sub(pattern, replace, text, count=1, flags=re.S)

        badge_g = r'<g\b[^>]*data-finding-badge="crit-high"[^>]*data-subsystem="B-02"[^>]*>.*?</g>|<g\b[^>]*data-subsystem="B-02"[^>]*data-finding-badge="crit-high"[^>]*>.*?</g>'
        sabotage("a badge's count changed on the boundary diagram", store_a, out_a, ARCHITECTURE,
                 first(r'(<g\b[^>]*data-finding-badge="crit-high"[^>]*?)data-count="(\d+)"', lambda m: f'{m.group(1)}data-count="{int(m.group(2)) + 5}"'),
                 "content", "finding-badge", "")
        sabotage("a badge removed from the boundary diagram", store_a, out_a, ARCHITECTURE,
                 first(badge_g, lambda m: ""), "content", "finding-badge", "B-02")
        sabotage("a badge added where the store holds none", store_a, out_a, ARCHITECTURE,
                 lambda t: t.replace("</svg>", '<g class="boundary-svg-badge" data-finding-badge="crit-high" data-subsystem="F-01" data-count="1"><text>C+H 1</text></g></svg>', 1),
                 "content", "finding-badge", "F-01")
        sabotage("a badge removed from the atlas", store_b, out_b, MASTER_PLAN,
                 first(r'<span\b[^>]*data-finding-badge="[^"]*"[^>]*>.*?</span>', lambda m: ""), "content", "finding-badge", "")
        sabotage("a segment removed from B-01's bar", store_a, out_a, PAGES["B-01"],
                 first(r'<g\b[^>]*data-node="coverage:B-01:examined"[^>]*>.*?</g>', lambda m: ""), "content", "coverage-bars-diagram-node", "coverage:B-01:examined")
        sabotage("a segment re-pointed to another state", store_a, out_a, PAGES["B-01"],
                 lambda t: t.replace('"coverage:B-01:scoped-unread"', '"coverage:B-01:excluded"', 1), "content", "coverage-bars-diagram-node", "coverage:B-01")
        sabotage("B-02's coverage figure removed", store_a, out_a, PAGES["B-02"],
                 first(r'<figure\b[^>]*data-diagram="coverage-bars"[^>]*>.*?</figure>', lambda m: ""), "coverage", "coverage-bars-diagram", "B-02")
        sabotage("the repository's segment removed from the Files page", store_a, out_a, FILES,
                 first(r'<g\b[^>]*data-node="coverage:repository:unledgered"[^>]*>.*?</g>', lambda m: ""), "content", "coverage-bars-diagram-node", "coverage:repository:unledgered")

    with tempfile.TemporaryDirectory(prefix="amanuensis-so23-golden-") as tmp:
        previous = start_corpus(Path(tmp))
        check("the golden corpus is SO23's or a later diagram packet's and differs from the start's only where this packet adds",
              lambda: golden_additions_only(previous))

    def in_ci() -> str | None:
        try:
            text = CI_FILE.read_text()
        except OSError as exc:
            return f"test.yml cannot be read: {exc}"
        return None if "test-store-only-coverage-badges.py" in text else "test.yml has no step for this gate"

    check("the gate is a step in test.yml", in_ci)

    if FAILURES:
        emit(f"GATE SO23 RED: {len(FAILURES)} check(s) failed; first: {FAILURES[0]}")
        return 1
    emit("GATE SO23 GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
