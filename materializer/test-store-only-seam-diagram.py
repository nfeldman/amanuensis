#!/usr/bin/env python3
"""Gate for store-only packet SO24 — the seam contract (A2)
(design/store-only/PLAN.md §7.3, §8 S5 and SO24, Appendix B).

A temporary store is seeded from the golden `materializer` store and given four more
seams, then published. SM-01 records two of its four fields; SM-02 records all four and
every assumption; SM-03 records no field (only an ordering assumption); SM-04 joins a
subsystem at `mapped` to one at `scoping`. Every drawn mark is compared with the records
the store holds, read independently of the renderer.

Turns red when:
  - `diagrams.py` lacks `seam_contract_model`, or a seam that records none of its four
    fields (a_writes, a_reads, b_writes, b_reads) draws a figure instead of a sentence, or
    the sentence omits the seam's id, its two parties or the shared object, or drops an
    assumption the seam does record;
  - a drawn seam has a node count other than three (party A, the shared object, party B) or
    an arrow that is not one of the four fields; a field's arrow has the wrong direction, a
    recorded field is drawn dashed or unlabelled, an unrecorded field is drawn solid or is
    not labelled "not recorded", or a recorded field's text is not on the drawing and in the
    account;
  - a party's half is drawn for a subsystem at `unmapped`, `scoping` or `deferred` (Appendix B
    rule 2), or the account does not say that the half is not drawn and why;
  - the assumptions (ordering, cardinality, staleness tolerance, schema owner) are not a
    caption of the drawing, an unrecorded one is not named, or the account does not count the
    arrows and assumptions that have no recorded value ("n of 4");
  - an SVG lacks `role="img"`, a `<title>` or a `<desc>` that counts its boxes and arrows,
    states a font size under 11, uses a literal colour, runs a script, is not 960 wide, or a
    mark has no `data-node` or `data-edge`; a party's box is not headed with its own ID, or the
    shared object's box with its recorded name; a figure has no readable account beside it, no
    statement of what it was read from, or a link that reaches no anchor;
  - two publications of one store print different figures;
  - a sabotage that edits seams.html and reseals `.projection-contract.json` is not reported
    with the right axis and object type: an arrow removed, an arrow added that no field
    joins, a box removed or re-pointed, a figure removed, a figure for a seam that records no
    field;
  - an arrow or a box of a seam figure is not a link a keyboard can reach (rules 1 and 8);
  - a seam's account does not quote what each party's depth authorizes and cannot justify
    (Appendix B rule 2);
  - a seam naming one subsystem as both parties draws fewer boxes than its model holds, or an
    arrow of one half joins the other half's box;
  - the read-back of the publication is not green on every axis;
  - the golden corpus's `VERSION` is not SO24, or a golden page differs from the corpus this
    packet started from outside a seam-contract figure or sentence (or a figure or sentence of the
    slice's other diagrams, which a fix to the slice may reprint), or no golden page gained one;
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
import lineage_style  # noqa: E402
from typing import Any

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
GOLDEN = ROOT / "fixtures" / "store-only-golden"
GOLDEN_REL = "materializer/fixtures/store-only-golden"
CI_FILE = REPO / ".github" / "workflows" / "test.yml"
PACKET = "SO24"
# The commit this packet started from: its golden corpus is the reference.
START_SHA = "d8b1c74b8c16c5cc50ebbdc93397f176ac89bc8f"

SEAMS = "seams.html"
KIND = "seam-contract"
FIELDS = ("a_writes", "a_reads", "b_writes", "b_reads")
ASSUMPTIONS = (
    ("ordering_assumption", "Ordering"),
    ("cardinality", "Cardinality"),
    ("staleness_tolerance", "Staleness tolerance"),
    ("schema_owner", "Schema owner"),
)
# Depths at which a subsystem's half of a seam is drawn (Appendix B rule 2).
HALVES_FROM = ("structural", "concerns", "adversarial", "mapped")
NOT_RECORDED = "not recorded"

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
# The fixture store.
# ---------------------------------------------------------------------------

SEAM_ROWS = (
    # id, shared object, kind, A, B, a_writes, a_reads, b_writes, b_reads, ordering, cardinality, staleness, owner
    ("SM-02", "orders table", "table", "B-01", "B-02", "inserts an order", "reads the order status", "sets the order status", "reads new orders",
     "causal", "n-to-n", "bounded:5s", "B-02"),
    ("SM-03", "audit log", "file", "B-01", "B-02", None, None, None, None, "none", None, None, None),
    ("SM-04", "session cache", "cache", "B-02", "F-01", "writes a session", "reads a session", "writes a page hit", "reads page hits",
     "total-ordering", "fan-out", "eventual", "F-01"),
)


def build_store(root: Path) -> Path:
    storage = root / "storage"
    storage.mkdir(parents=True)
    (storage / "workspace_path").write_text("/example/FictionalProject\n")
    db = sqlite3.connect(storage / "memory.db")
    try:
        db.executescript((GOLDEN / "materializer" / "memory.sql").read_text())
        for row in SEAM_ROWS:
            db.execute(
                "INSERT INTO seams (id, shared_object, shared_object_kind, party_a, party_b, a_writes, a_reads, b_writes, b_reads,"
                " ordering_assumption, cardinality, staleness_tolerance, schema_owner) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                row,
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


def table(storage: Path, sql: str, args: tuple[Any, ...] = ()) -> list[sqlite3.Row]:
    db = sqlite3.connect(f"file:{storage / 'memory.db'}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    try:
        return list(db.execute(sql, args))
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Reading the pages.
# ---------------------------------------------------------------------------


def plain(html: str) -> str:
    return " ".join(re.sub(r"<[^>]+>", " ", html).split())


def figures(text: str, kind: str = KIND) -> list[str]:
    return re.findall(rf'<figure\b[^>]*data-diagram="{kind}"[^>]*>.*?</figure>', text, re.S)


def figure_of(text: str, sid: str) -> str | None:
    for figure in figures(text):
        if f'data-subject="{sid}"' in figure:
            return figure
    return None


def sentences(text: str) -> list[str]:
    return re.findall(rf'<p class="diagram-below"[^>]*data-diagram="{KIND}"[^>]*>.*?</p>', text, re.S)


def drawn(figure: str) -> tuple[list[str], list[str]]:
    nodes = re.findall(r'<g\b[^>]*\bdata-node="([^"]*)"', figure)
    edges = re.findall(r'<path\b[^>]*\bdata-edge="([^"]*)"', figure)
    return nodes, edges


def edge_paths(figure: str) -> dict[str, str]:
    return {m.group(1): m.group(0) for m in re.finditer(r'<path\b[^>]*\bdata-edge="([^"]*)"[^>]*>', figure)}


def account_of(figure: str) -> str:
    match = re.search(r'<div class="diagram-account"[^>]*>(.*?)</div>', figure, re.S)
    return plain(match.group(1)) if match else ""


def unlinked_marks(figure: str) -> str | None:
    """Appendix B rules 1 and 8: every arrow and every box is a link a keyboard can reach."""

    for record in re.findall(r'<path\b[^>]*\bdata-edge="([^"]*)"', figure):
        if not re.search(rf'<a\b[^>]*\bhref="[^"]+"[^>]*>\s*<path\b[^>]*\bdata-edge="{re.escape(record)}"', figure):
            return f"the arrow {record} is not a link"
    for record, inner in re.findall(r'<g\b[^>]*\bdata-node="([^"]*)"[^>]*>(.*?)</g>', figure, re.S):
        if not re.search(r'<a\b[^>]*\bhref="[^"]+"', inner):
            return f"the box {record} is not a link"
    return None

def svg_faults(figure: str, boxes: int, arrows: int) -> str | None:
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
    said_boxes = re.search(r"(\d+) box(?:es)?\b", desc.group(1))
    said_arrows = re.search(r"(\d+) arrows?\b", desc.group(1))
    if said_boxes is None or int(said_boxes.group(1)) != boxes or said_arrows is None or int(said_arrows.group(1)) != arrows:
        return f"the <desc> does not count the {boxes} boxes and {arrows} arrows it draws: {desc.group(1)[:160]!r}"
    for size in re.findall(r'font-size[:=]\s*"?(\d+(?:\.\d+)?)', text):
        if float(size) < 11:
            return f"text is {size}px, under 11"
    if re.search(r"#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(", text):
        return "a colour is written as a literal, not a CSS token"
    if re.search(r"<script|\son\w+=", figure):
        return "the figure runs script"
    return None


# What the store says a seam draws, read without the renderer.
def wanted(storage: Path) -> dict[str, dict[str, Any]]:
    depth = {str(r["id"]): str(r["status"] or "unmapped") for r in table(storage, "SELECT id, status FROM subsystems")}
    out: dict[str, dict[str, Any]] = {}
    for s in table(storage, "SELECT * FROM seams ORDER BY id"):
        values = {f: (str(s[f]).strip() if s[f] is not None and str(s[f]).strip() else None) for f in FIELDS}
        if not any(values.values()):
            out[str(s["id"])] = {"figure": False, "seam": s}
            continue
        edges = [
            f"seam-field:{s['id']}:{f}"
            for f in FIELDS
            if depth.get(str(s["party_a" if f.startswith("a") else "party_b"]), "unmapped") in HALVES_FROM
        ]
        out[str(s["id"])] = {
            "figure": True,
            "seam": s,
            "values": values,
            "nodes": sorted([f"subsystem:{s['party_a']}", f"seam:{s['id']}", f"subsystem:{s['party_b']}"]),
            "edges": sorted(edges),
            "hidden": [p for p in (str(s["party_a"]), str(s["party_b"])) if depth.get(p, "unmapped") not in HALVES_FROM],
            "depth": depth,
        }
    return out


# ---------------------------------------------------------------------------
# The golden corpus.
# ---------------------------------------------------------------------------

# SO25 adds flow strips to the subsystem pages; they are let go of as well.
_ADDED = re.compile(
    rf'<figure\b[^>]*data-diagram="(?:{KIND}|flow-strip)"[^>]*>.*?</figure>\n?'
    rf'|<p class="diagram-below"[^>]*data-diagram="(?:{KIND}|flow-strip)"[^>]*>.*?</p>\n?',
    re.S,
)
# Consecutive paragraphs share a wrapper; taking the figures out can leave it empty.
_EMPTY_FLOW = re.compile(r'<div class="prose-flow">\s*</div>\n?')


# The slice's earlier diagrams (SO22, SO23): a fix to slice S5 may reprint them, so they are taken
# out of both the start's corpus and the current one, which still pins everything around them.
_EARLIER = re.compile(
    r'<figure\b[^>]*data-diagram="(?:survey-workflow|status-ladder|coverage-bars)"[^>]*>.*?</figure>\n?'
    r'|<p class="diagram-below"[^>]*data-diagram="(?:survey-workflow|status-ladder|coverage-bars)"[^>]*>.*?</p>\n?'
    # SO23's note under a surface that draws finding badges.
    r'|<p class="finding-badge-note"[^>]*>.*?</p>\n?',
    re.S,
)
_SEAM_ADDED = re.compile(rf'<(?:figure|p)\b[^>]*data-diagram="{KIND}"')


def _without_additions(text: str) -> str:
    return _EMPTY_FLOW.sub("", _ADDED.sub("", _EARLIER.sub("", text))).replace("\n", "")


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
    if not version.is_file() or version.read_text().strip() not in (PACKET, "SO25"):
        return f"the golden corpus's VERSION is {version.read_text().strip() if version.is_file() else 'absent'!r}, not {PACKET} or a later diagram packet"
    if previous is None:
        return f"the golden corpus cannot be read from git at {START_SHA[:12]}"
    before = {str(p.relative_to(previous)): p for p in previous.rglob("*.html") if "/html/" in str(p)}
    after = {str(p.relative_to(GOLDEN)): p for p in GOLDEN.rglob("*.html") if "/html/" in str(p)}
    if sorted(before) != sorted(after):
        return f"the corpus holds {len(after)} HTML pages for the start's {len(before)}"
    gained = 0
    for rel in sorted(after):
        new, old = (_SO20_MARKS.sub("", t) for t in lineage_style.pair(after[rel].read_text(), before[rel].read_text()))
        if _without_additions(new) != _EMPTY_FLOW.sub("", _EARLIER.sub("", old)).replace("\n", ""):
            return f"{rel} differs from the start's corpus outside a seam-contract figure or sentence, or the slice's earlier diagrams"
        gained += bool(_SEAM_ADDED.search(new))
    for asset in (previous / "assets").iterdir():
        if not (GOLDEN / "assets" / asset.name).is_file():
            return f"the folded asset {asset.name[:12]} changed"
    return None if gained >= 3 else f"only {gained} golden pages gained a seam-contract figure or sentence"


# ---------------------------------------------------------------------------


def main() -> int:
    diagrams, error = load("diagrams")
    core, error2 = load("core")
    missing = error or error2
    if not missing and not hasattr(diagrams, "seam_contract_model"):
        missing = "diagrams.py lacks seam_contract_model"
    if missing:
        emit(f"GATE SO24 RED: {missing}")
        return 1

    with tempfile.TemporaryDirectory(prefix="amanuensis-so24-") as tmp:
        root = Path(tmp)
        store = build_store(root / "a")
        output, why = publish(store)
        if output is None:
            emit(f"GATE SO24 RED: {why}")
            return 1
        want = wanted(store)
        page = (output / SEAMS).read_text()

        def green() -> str | None:
            summary = verify(core, store, output)
            if summary.get("ok"):
                return None
            first = (summary.get("mismatches") or [{}])[0]
            return f"{summary.get('mismatch_count')} mismatch(es), first {first}"

        check("the publication reads back green on every axis", green)

        def census() -> str | None:
            drawn_ids = sorted(re.findall(r'data-subject="([^"]*)"', " ".join(re.findall(rf'<figure\b[^>]*data-diagram="{KIND}"[^>]*>', page))))
            owed = sorted(sid for sid, w in want.items() if w["figure"])
            if drawn_ids != owed:
                return f"System boundaries draws a contract for {drawn_ids}; the seams that record a field are {owed}"
            if len(owed) < 3:
                return f"the fixture holds only {len(owed)} drawn seams"
            return None

        check("one contract per seam that records a field, on System boundaries", census)

        def marks() -> str | None:
            for sid, w in want.items():
                if not w["figure"]:
                    continue
                figure = figure_of(page, sid)
                if figure is None:
                    return f"{sid} has no figure"
                nodes, edges = drawn(figure)
                if sorted(nodes) != w["nodes"]:
                    return f"{sid} draws boxes {sorted(nodes)}; its party A, shared object and party B are {w['nodes']}"
                if sorted(edges) != w["edges"]:
                    return f"{sid} draws arrows {sorted(edges)}; its recorded halves hold {w['edges']}"
                if (fault := svg_faults(figure, len(nodes), len(edges))) is not None:
                    return f"{sid}: {fault}"
                # Each box shows who it is: a party its own ID, the shared object the start of its recorded name.
                seam = w["seam"]
                for record, inner in re.findall(r'<g\b[^>]*\bdata-node="([^"]*)"[^>]*>(.*?)</g>', figure, re.S):
                    heads = re.findall(r'<text\b[^>]*font-weight="600"[^>]*>(.*?)</text>', inner, re.S)
                    head = " ".join(plain(heads[0]).split()) if heads else ""
                    if not re.search(r"<rect\b", inner) or not head:
                        return f"{sid}'s box {record} draws no box or no heading"
                    if record.startswith("subsystem:"):
                        if head != record.split(":", 1)[1]:
                            return f"{sid}'s box {record} is headed {head!r}"
                    elif not " ".join(str(seam["shared_object"]).split()).startswith(head):
                        return f"{sid}'s shared object box is headed {head!r}; the seam records {seam['shared_object']!r}"
            return None

        check("nodes are party A, the shared object and party B; arrows are the recorded halves' fields", marks)

        def dashes() -> str | None:
            for sid, w in want.items():
                if not w["figure"]:
                    continue
                figure = figure_of(page, sid) or ""
                paths = edge_paths(figure)
                for record, tag in paths.items():
                    field = record.rsplit(":", 1)[-1]
                    unrecorded = w["values"][field] is None
                    dashed = "stroke-dasharray" in tag
                    if unrecorded != dashed:
                        return f"{sid}'s {field} is {'unrecorded' if unrecorded else 'recorded'} and its arrow is {'dashed' if dashed else 'solid'}"
                svg = re.search(r"<svg\b.*?</svg>", figure, re.S).group(0)  # type: ignore[union-attr]
                said = plain(svg)
                for field, value in w["values"].items():
                    if f"seam-field:{sid}:{field}" not in paths:
                        continue
                    if value is None:
                        continue
                    if value not in said:
                        return f"{sid}'s drawing does not print {field}: {value!r}"
                unrecorded = [f for f, v in w["values"].items() if v is None and f"seam-field:{sid}:{f}" in paths]
                if said.count(NOT_RECORDED) < len(unrecorded):
                    return f"{sid} has {len(unrecorded)} unrecorded arrows and its drawing says {NOT_RECORDED!r} {said.count(NOT_RECORDED)} time(s)"
            return None

        check("a recorded field is solid and printed; an unrecorded one is dashed and says 'not recorded'", dashes)

        def directions() -> str | None:
            for sid, w in want.items():
                if not w["figure"]:
                    continue
                figure = figure_of(page, sid) or ""
                pos: dict[str, float] = {}
                for m in re.finditer(r'<g\b[^>]*data-node="([^"]*)"[^>]*>(.*?)</g>', figure, re.S):
                    rect = re.search(r'<rect\b[^>]*\bx="([\d.]+)"[^>]*\bwidth="([\d.]+)"', m.group(2))
                    if rect:
                        pos[m.group(1)] = float(rect.group(1)) + float(rect.group(2)) / 2
                s = w["seam"]
                for record, tag in edge_paths(figure).items():
                    field = record.rsplit(":", 1)[-1]
                    d = re.search(r'\bd="M ([\d.]+) [\d.]+ [LQ] (?:[\d.]+ [\d.]+ )?([\d.]+) [\d.]+"', tag)
                    if d is None:
                        return f"{record}'s path is not a line or curve from a start to an end: {tag[:120]}"
                    start, end = float(d.group(1)), float(d.group(2))
                    party = f"subsystem:{s['party_a' if field.startswith('a') else 'party_b']}"
                    shared = f"seam:{sid}"
                    if party not in pos or shared not in pos:
                        return f"{sid}: a box of {record} is not drawn"
                    toward_shared = abs(end - pos[shared]) < abs(start - pos[shared])
                    if field.endswith("writes") != toward_shared:
                        return f"{record} runs {'into' if toward_shared else 'out of'} the shared object; a write goes in and a read comes out"
                    near_party = abs((start if field.endswith("writes") else end) - pos[party]) < abs((start if field.endswith("writes") else end) - pos[shared])
                    if not near_party:
                        return f"{record} does not join party {field[0].upper()} and the shared object"
            return None

        check("each arrow joins its party and the shared object, a write in and a read out", directions)

        def assumptions() -> str | None:
            for sid, w in want.items():
                if not w["figure"]:
                    continue
                figure = figure_of(page, sid) or ""
                svg = plain(re.search(r"<svg\b.*?</svg>", figure, re.S).group(0))  # type: ignore[union-attr]
                text = account_of(figure)
                s = w["seam"]
                missing = 0
                for column, label in ASSUMPTIONS:
                    value = (str(s[column]).strip() if s[column] is not None else "")
                    if value:
                        if value not in svg or value not in text:
                            return f"{sid}: the {label.lower()} {value!r} is not both on the drawing and in the account"
                    else:
                        missing += 1
                        if not re.search(rf"{re.escape(label)}[^.;]*{NOT_RECORDED}", svg, re.I) or not re.search(rf"{re.escape(label)}[^.;]*{NOT_RECORDED}", text, re.I):
                            return f"{sid}: the {label.lower()} is unrecorded and the drawing or the account does not say so"
                if not re.search(rf"\b{missing} of 4 assumptions?\b", text):
                    return f"{sid}: the account does not count {missing} of 4 assumptions as unrecorded: {text[:300]!r}"
                absent = sum(1 for f in FIELDS if w["values"][f] is None)
                if not re.search(rf"\b{absent} of 4 (?:fields|arrows)\b", text):
                    return f"{sid}: the account does not count {absent} of 4 fields as unrecorded: {text[:300]!r}"
                for field in FIELDS:
                    value = w["values"][field]
                    if value is not None and value not in text:
                        return f"{sid}: the account omits {field}: {value!r}"
            return None

        check("assumptions are a caption and counted in the account, unrecorded ones named", assumptions)

        def status_rule() -> str | None:
            w = want["SM-04"]
            if w["hidden"] != ["F-01"]:
                return f"the fixture's SM-04 should hide F-01's half, hides {w['hidden']}"
            text = account_of(figure_of(page, "SM-04") or "")
            shown = diagrams._DEPTH_LABELS.get("scoping", "Scoped")
            if not re.search(rf"F-01[^.]*{shown}[^.]*not drawn|F-01[^.]*not drawn[^.]*{shown}", text):
                return f"the account does not say F-01's half is not drawn because it is at {shown}: {text[:300]!r}"
            db = sqlite3.connect(f"file:{store / 'memory.db'}?mode=ro", uri=True)
            db.row_factory = sqlite3.Row
            try:
                copy = sqlite3.connect(":memory:")
                copy.row_factory = sqlite3.Row
                db.backup(copy)
            finally:
                db.close()
            try:
                for status, expect in (("unmapped", 2), ("deferred", 2), ("structural", 4), ("adversarial", 4)):
                    copy.execute("UPDATE subsystems SET status = ? WHERE id = 'F-01'", (status,))
                    model = diagrams.seam_contract_model(copy, "SM-04")
                    if len(model.edges) != expect or len(model.nodes) != 3:
                        return f"with F-01 at {status}, SM-04 draws {len(model.nodes)} boxes and {len(model.edges)} arrows, not 3 and {expect}"
            finally:
                copy.close()
            return None

        check("a half is drawn from Structural up, and said not to be below", status_rule)

        def qualified() -> str | None:
            # Appendix B rule 2: a seam quotes what each party's depth authorizes and cannot justify.
            vocab = json.loads((REPO / "mcp-server" / "contracts" / "conspectus-vocabulary.json").read_text())
            depth = {v["value"]: v for v in vocab["enums"]["subsystem_status"]["values"]}
            for sid, w in want.items():
                if not w["figure"]:
                    continue
                text = " ".join(plain(account_of(figure_of(page, sid) or "")).split())
                for party in (str(w["seam"]["party_a"]), str(w["seam"]["party_b"])):
                    status = w["depth"].get(party, "unmapped")
                    for field in ("authorizes", "cannot_justify"):
                        quoted = " ".join(str(depth[status][field]).split())
                        if not re.search(rf"{re.escape(party)}[^.]*{re.escape(quoted)}", text):
                            return f"{sid}'s account does not quote what {party}'s depth ({status}) {field.replace('_', ' ')}: {quoted!r}"
            return None

        check("a seam quotes what each party's depth authorizes and cannot justify", qualified)

        def self_seam() -> str | None:
            # A seam may name one subsystem as both parties (the server allows it): both boxes are drawn,
            # each half's arrows join its own box, and every model node is one drawn node.
            db = sqlite3.connect(f"file:{store / 'memory.db'}?mode=ro", uri=True)
            copy = sqlite3.connect(":memory:")
            copy.row_factory = sqlite3.Row
            try:
                db.backup(copy)
            finally:
                db.close()
            try:
                copy.execute(
                    "INSERT INTO seams (id, shared_object, party_a, party_b, a_writes, a_reads, b_writes, b_reads)"
                    " VALUES ('SM-99', 'loopback buffer', 'B-01', 'B-01', 'frames', 'acks', 'acks', 'frames')"
                )
                copy.execute("UPDATE subsystems SET status = 'structural' WHERE id = 'B-01'")
                model = diagrams.seam_contract_model(copy, "SM-99")
            finally:
                copy.close()
            svg = diagrams.draw_svg(model)
            groups = re.findall(r'<g\b[^>]*\bdata-node="([^"]*)"[^>]*>(.*?)</g>', svg, re.S)
            if len(groups) != len(model.nodes) or len(model.nodes) != 3:
                return f"the self-seam's model holds {len(model.nodes)} nodes and its SVG draws {len(groups)}"
            centres = []
            for _record, inner in groups:
                rect = re.search(r'<rect\b[^>]*\sx="([\d.]+)"[^>]*\swidth="([\d.]+)"', inner)
                centres.append(float(rect.group(1)) + float(rect.group(2)) / 2 if rect else -1.0)
            if len(set(centres)) != 3:
                return f"the self-seam's boxes sit at {centres}, not three places"
            party_a, shared, party_b = sorted(centres)
            for record, tag in edge_paths(svg).items():
                d = re.search(r'\bd="M ([\d.]+) [\d.]+ [LQ] (?:[\d.]+ [\d.]+ )?([\d.]+) [\d.]+"', tag)
                if d is None:
                    return f"{record}'s path has no start and end"
                ends = (float(d.group(1)), float(d.group(2)))
                party = party_a if record.rsplit(":", 1)[1].startswith("a_") else party_b
                if not all(min(abs(x - party), abs(x - shared)) < 100 for x in ends):
                    return f"{record} runs {ends}; its half joins the box at {party} and the shared object at {shared}"
            return None

        check("a seam whose two parties are one subsystem draws both boxes, each half on its own side", self_seam)

        def below() -> str | None:
            found = sentences(page)
            mine = [s for s in found if 'data-subject="SM-03"' in s]
            if len(mine) != 1:
                return f"SM-03 records no field and has {len(mine)} sentences"
            if figure_of(page, "SM-03") is not None:
                return "SM-03 records no field and a figure is drawn"
            text = plain(mine[0])
            for needle in ("SM-03", "B-01", "B-02", "audit log", "none"):
                if needle not in text:
                    return f"the sentence for SM-03 omits {needle!r}: {text!r}"
            if re.search(r"\b0 of\b|\bzero\b", text, re.I):
                return f"the sentence prints a zero where nothing was recorded: {text!r}"
            db = sqlite3.connect(f"file:{store / 'memory.db'}?mode=ro", uri=True)
            db.row_factory = sqlite3.Row
            try:
                model = diagrams.seam_contract_model(db, "SM-03")
                drawn_model = diagrams.seam_contract_model(db, "SM-01")
            finally:
                db.close()
            if model.nodes or model.edges or not model.below.strip():
                return "a seam with no field is drawn, not said in a sentence"
            if not drawn_model.nodes or drawn_model.below:
                return "SM-01 records two fields and is not drawn"
            return None

        check("a seam that records no field is a sentence, with the assumptions it does record", below)

        def mostly_empty() -> str | None:
            # A recorded field in only one half still draws all four arrows, two of them dashed.
            w = want["SM-01"]
            if sorted(f for f, v in w["values"].items() if v is not None) != ["a_writes", "b_reads"]:
                return "the fixture's SM-01 should record a_writes and b_reads only"
            figure = figure_of(page, "SM-01") or ""
            paths = edge_paths(figure)
            dashed = sorted(r.rsplit(":", 1)[-1] for r, tag in paths.items() if "stroke-dasharray" in tag)
            if dashed != ["a_reads", "b_writes"]:
                return f"SM-01 dashes {dashed}; it records a_writes and b_reads and not the other two"
            return None

        check("SM-01 draws two solid arrows and two dashed ones", mostly_empty)

        def read_at() -> str | None:
            for sid, w in want.items():
                if not w["figure"]:
                    continue
                figure = figure_of(page, sid) or ""
                said = re.search(r'<p class="diagram-read-at"[^>]*>(.*?)</p>', figure, re.S)
                if said is None or not plain(said.group(1)):
                    return f"{sid} does not say what it was read from"
                updated = str(w["seam"]["updated_at"])[:10]
                if updated not in plain(said.group(1)):
                    return f"{sid} does not print the date its seam row was last updated ({updated}): {plain(said.group(1))!r}"
                if not account_of(figure):
                    return f"{sid} has no account beside it"
                if f'data-subject="{sid}"' not in figure or sid not in figure.split("<svg", 1)[0]:
                    return f"{sid}'s figure does not name its seam in the caption"
            return None

        check("each figure names its seam and says what it was read from", read_at)

        def two_publications() -> str | None:
            storage2 = build_store(root / "a2")
            out2, why2 = publish(storage2)
            if out2 is None:
                return why2
            if figures(page) != figures((out2 / SEAMS).read_text()) or sentences(page) != sentences((out2 / SEAMS).read_text()):
                return "the figures of two publications differ"
            return None

        check("two publications of one store print the same figures", two_publications)

        def links_resolve() -> str | None:
            for figure in figures(page):
                for href in re.findall(r'<a\b[^>]*href="([^"]+)"', figure):
                    path, _, fragment = href.partition("#")
                    target = (output / SEAMS).parent / path if path else output / SEAMS
                    if not target.resolve().is_file():
                        return f"a seam link goes to {href}, which is not a page"
                    if fragment and f'id="{fragment}"' not in target.read_text():
                        return f"a seam link goes to {href}, and no anchor {fragment} is there"
                for line_id in re.findall(r'<li id="([^"]+)"', figure):
                    if page.count(f'id="{line_id}"') != 1:
                        return f"the account item {line_id} is not unique on the page"
            return None

        check("every link of a seam figure reaches an anchor, and account anchors are unique", links_resolve)

        def marks_linked() -> str | None:
            for figure in figures(page):
                if (fault := unlinked_marks(figure)) is not None:
                    return fault
            return None

        check("every arrow and every box of a seam figure is a link", marks_linked)

        # -- sabotage, resealed ----------------------------------------------
        def sabotage(label: str, edit: Callable[[str], str], axis: str, object_type: str, object_id: str) -> None:
            def run() -> str | None:
                copy = root / "sabotage"
                if copy.exists():
                    shutil.rmtree(copy)
                shutil.copytree(output, copy)
                target = copy / SEAMS
                before = target.read_text()
                after = edit(before)
                if after == before:
                    return f"the edit found nothing to change on {SEAMS}"
                target.write_text(after)
                reseal(copy, SEAMS)
                mismatches = verify(core, store, copy).get("mismatches") or []
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

        sabotage("an arrow removed from SM-02", first(r'<path\b[^>]*data-edge="seam-field:SM-02:a_writes"[^>]*/>', lambda m: ""),
                 "content", f"{KIND}-diagram-edge", "seam-field:SM-02:a_writes")
        sabotage("an arrow re-pointed to the wrong field", lambda t: t.replace('"seam-field:SM-02:b_reads"', '"seam-field:SM-02:a_reads"', 1),
                 "content", f"{KIND}-diagram-edge", "seam-field:SM-02")
        sabotage("an arrow added that no field joins", lambda t: t.replace(
            "</svg>", '<path data-edge="seam-field:SM-03:a_writes" d="M 10 10 L 90 10" fill="none" stroke="var(--accent)"/></svg>', 1),
                 "content", f"{KIND}-diagram-edge", "seam-field:SM-03:a_writes")
        sabotage("the shared object's box removed", first(r'<g\b[^>]*data-node="seam:SM-04"[^>]*>.*?</g>', lambda m: ""),
                 "content", f"{KIND}-diagram-node", "seam:SM-04")
        sabotage("a party's box re-pointed", lambda t: t.replace('data-node="subsystem:B-02"', 'data-node="subsystem:F-01"', 1),
                 "content", f"{KIND}-diagram-node", "subsystem:")
        sabotage("SM-02's figure removed", first(rf'<figure\b[^>]*data-diagram="{KIND}"[^>]*data-subject="SM-02"[^>]*>.*?</figure>', lambda m: ""),
                 "coverage", f"{KIND}-diagram", "SM-02")
        sabotage("a figure drawn for the seam that records no field",
                 lambda t: t.replace("</section>", f'<figure class="diagram" data-diagram="{KIND}" data-subject="SM-03"><svg></svg></figure></section>', 1)
                 if "</section>" in t else t + f'<figure class="diagram" data-diagram="{KIND}" data-subject="SM-03"><svg></svg></figure>',
                 "coverage", f"{KIND}-diagram", "SM-03")

    with tempfile.TemporaryDirectory(prefix="amanuensis-so24-golden-") as tmp:
        previous = start_corpus(Path(tmp))
        check("the golden corpus is SO24's or a later diagram packet's and differs from the start's only where this packet adds",
              lambda: golden_additions_only(previous))

    def in_ci() -> str | None:
        try:
            text = CI_FILE.read_text()
        except OSError as exc:
            return f"test.yml cannot be read: {exc}"
        return None if "test-store-only-seam-diagram.py" in text else "test.yml has no step for this gate"

    check("the gate is a step in test.yml", in_ci)

    if FAILURES:
        emit(f"GATE SO24 RED: {len(FAILURES)} check(s) failed; first: {FAILURES[0]}")
        return 1
    emit("GATE SO24 GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
