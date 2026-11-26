#!/usr/bin/env python3
"""Gate for store-only packet SO22 — diagram primitives, the survey workflow (B1) and the
status ladder (B2) (design/store-only/PLAN.md §7.3, §8 S5 and SO22, Appendix B).

A temporary store is seeded from the golden `materializer` store, given a status
history on two of its three subsystems, and published. The guide then carries B1
(three lanes: agent, server, you) and the ladder; every subsystem page carries the
ladder with its "here" marker and its climb. Every node and edge is compared with
the records the contract and the store hold, read independently of the renderer.

Turns red when:
  - the contract's `survey_passes` rows lack `actor` (one of agent/server/you) or
    `checkpoint` (a sentence on the pass that posts a summary to the reader, empty
    elsewhere), or the generated `vocabulary.py` does not carry them;
  - the contract's `status_prerequisites` name other rungs than `enforcePhasePrerequisites`
    checks, or other checks within a rung: dropping a rung, adding a check, removing
    a check from the TypeScript, or adding a rung to it is each reported;
  - `gen-vocabulary.mjs --check` fails;
  - `diagrams.py` lacks the pure model functions, or a model's nodes differ from the
    records the contract holds (a pass, a server check, a checkpoint; a rung, the
    deferred box, the marker) or its edges from the records that join them (pass
    order, a check, a checkpoint, a step of the ladder, a recorded transition);
  - a model draws an edge whose end is not one of its nodes, or a below-threshold input
    (a one-pass survey, a one-rung ladder) yields an SVG instead of a sentence;
  - the guide lacks B1 or the ladder, or a subsystem page lacks its ladder, or a drawn
    node or edge differs in count or record from the model, or has no `data-node` /
    `data-edge`, or an SVG line carries no record;
  - a counted node draws nothing: its `<g data-node>` holds no visible shape, lacks the
    words its record gives it (a pass's name, a rung's contract label, "Here" and the
    subject), or links to nothing (the marker included); and the read-back, resealed,
    passes a page whose marked node container was emptied or kept its box but lost its
    words (final review F2/codex);
  - an arrow is not a link a keyboard can reach;
  - an SVG's aria-labelledby does not name its `<title>` and `<desc>` ids, an arrow's link
    has no aria-label, a subject's ladder account does not quote what its depth authorizes,
    or a diagram at its declared minimum (two passes, two rungs) is not drawn (final
    review F5/codex, F7/codex, F12/claude, F15/claude);
  - an SVG lacks `role="img"`, a `<title>`, or a `<desc>` that counts its boxes and arrows,
    states a font size under 11, uses a colour that is not a CSS token, runs a script,
    or has a width other than the 960 viewBox;
  - no readable account sits beside a diagram (the pass list with its lanes; the rungs;
    one line per recorded move) or the revision it was read at is not printed;
  - a subsystem with no recorded moves does not say its history was not recorded,
    `deferred` is drawn as a rung, or a status with no pass is drawn in the survey lanes;
  - two publications differ in a figure, or a figure's links do not reach an anchor;
  - a sabotage that edits one page and reseals `.projection-contract.json` is not
    reported on the content or coverage axis with the diagram's object type: a node
    removed, an unmarked edge added, an edge retargeted, the marker moved, a rung
    re-marked, a ladder removed;
  - the golden corpus's `VERSION` is not SO22, or a golden page differs from the corpus this
    packet started from outside a `<figure data-diagram>` block, or fewer than ten pages
    gained one;
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
from collections import Counter
from collections.abc import Callable
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from typing import Any

import lineage_style  # noqa: E402

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
MCP = REPO / "mcp-server"
GOLDEN = ROOT / "fixtures" / "store-only-golden"
GOLDEN_REL = "materializer/fixtures/store-only-golden"
CI_FILE = REPO / ".github" / "workflows" / "test.yml"
CONTRACT = MCP / "contracts" / "conspectus-vocabulary.json"
INVARIANTS = MCP / "src" / "invariants.ts"
PACKET = "SO22"
# The commit this packet started from: its golden corpus is the reference.
START_SHA = "337a68eb20d389493c8e02d335382abba67b71af"

LADDER = ("unmapped", "scoping", "structural", "concerns", "adversarial", "mapped")
ACTORS = ("agent", "server", "you")
GUIDE = "how-to-read.html"
SUBSYSTEM_PAGES = {
    "B-01": "subsystems/b01-job-scheduler.html",
    "B-02": "subsystems/b02-auth-service.html",
    "F-01": "subsystems/f01-web-ui.html",
}
# Recorded moves: (subsystem, from, to). B-01 climbs, steps back and climbs again, so one
# pair repeats; its first move has no `from`. B-02 is parked and resumed. F-01 has none.
TRANSITIONS: tuple[tuple[str, str | None, str], ...] = (
    ("B-01", None, "scoping"),
    ("B-01", "scoping", "structural"),
    ("B-01", "structural", "concerns"),
    ("B-01", "concerns", "structural"),
    ("B-01", "structural", "concerns"),
    ("B-01", "concerns", "adversarial"),
    ("B-01", "adversarial", "mapped"),
    ("B-02", None, "unmapped"),
    ("B-02", "unmapped", "deferred"),
    ("B-02", "deferred", "mapped"),
)
SHA = "cafe1234deadbeef00"

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
# The contract, read as JSON, and the TypeScript it must agree with.
# ---------------------------------------------------------------------------


def contract_doc() -> dict[str, Any]:
    return json.loads(CONTRACT.read_text())


def contract_passes_ok(doc: dict[str, Any]) -> str | None:
    passes = doc.get("survey_passes") or []
    if len(passes) != 5:
        return f"the contract has {len(passes)} survey passes, not 5"
    for row in passes:
        if row.get("actor") not in ACTORS:
            return f"pass {row.get('pass')!r} has actor {row.get('actor')!r}, not one of {ACTORS}"
        checkpoint = row.get("checkpoint")
        if not isinstance(checkpoint, str):
            return f"pass {row.get('pass')!r} has no checkpoint string"
    posting = [row["pass"] for row in passes if row["checkpoint"].strip()]
    if posting != ["Packaging"]:
        return f"the passes that post a summary to the reader are {posting}; the guide says after each subsystem"
    if any(row["actor"] != "agent" for row in passes):
        return "a survey pass is done by someone other than the agent"
    return None


def checks_by_rung(doc: dict[str, Any]) -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    for rung in doc.get("status_prerequisites") or []:
        out.setdefault(str(rung.get("status")), set()).update(str(r.get("checked_by")) for r in rung.get("requires") or [])
    return out


_CALL = re.compile(r"\b((?:require|has)[A-Z]\w*)\(")
_TABLE = re.compile(r"\bFROM\s+(\w+)")


def checks_in_source(source: str) -> dict[str, set[str]]:
    """What `enforcePhasePrerequisites` checks, rung by rung: the helpers it calls and the tables it counts."""

    start = source.index("export function enforcePhasePrerequisites(")
    end = source.index("\n}\n", start)
    body = source[start:end]
    switch_end = body.index("default:")
    switch = body[:switch_end]
    tail = body[switch_end:]
    cases = list(re.finditer(r'case "(\w+)":', switch))
    out: dict[str, set[str]] = {}
    for index, match in enumerate(cases):
        segment = switch[match.end() : cases[index + 1].start() if index + 1 < len(cases) else len(switch)]
        out[match.group(1)] = set(_CALL.findall(segment)) | set(_TABLE.findall(segment))
    for guard in re.finditer(r"if \(((?:targetStatus === \"\w+\"(?: \|\| )?)+)\) \{(.*?)\n  \}", tail, re.S):
        for rung in re.findall(r'"(\w+)"', guard.group(1)):
            out.setdefault(rung, set()).update(_CALL.findall(guard.group(2)))
    return {rung: tokens for rung, tokens in out.items() if tokens}


def agreement(doc: dict[str, Any], source: str) -> str | None:
    named, checked = checks_by_rung(doc), checks_in_source(source)
    if set(named) != set(checked):
        return f"the contract names rungs {sorted(named)}, enforcePhasePrerequisites checks {sorted(checked)}"
    for rung in sorted(named):
        if named[rung] != checked[rung]:
            return (
                f"rung {rung}: the contract names {sorted(named[rung])}, "
                f"enforcePhasePrerequisites checks {sorted(checked[rung])}"
            )
    ladder = [v["value"] for v in doc["enums"]["subsystem_status"]["values"]]
    if any(rung not in ladder for rung in named):
        return "a prerequisite names a status that is not on the ladder"
    if any(not str(r.get("what", "")).strip() for rung in doc["status_prerequisites"] for r in rung["requires"]):
        return "a prerequisite has no plain statement"
    return None


def prerequisite_mutations(doc: dict[str, Any], source: str) -> str | None:
    """Each disagreement is reported; the unchanged pair agrees."""

    if (why := agreement(doc, source)) is not None:
        return f"the unchanged pair does not agree: {why}"

    def without_rung(d: dict[str, Any]) -> dict[str, Any]:
        d = json.loads(json.dumps(d))
        d["status_prerequisites"] = [r for r in d["status_prerequisites"] if r["status"] != "mapped"]
        return d

    def extra_check(d: dict[str, Any]) -> dict[str, Any]:
        d = json.loads(json.dumps(d))
        d["status_prerequisites"][0]["requires"].append({"what": "A made-up check.", "checked_by": "requireMadeUp"})
        return d

    def renamed_check(d: dict[str, Any]) -> dict[str, Any]:
        d = json.loads(json.dumps(d))
        d["status_prerequisites"][1]["requires"][0]["checked_by"] = "hasNothing"
        return d

    cases: list[tuple[str, dict[str, Any], str]] = [
        ("a rung dropped from the contract", without_rung(doc), source),
        ("a check added to the contract", extra_check(doc), source),
        ("a check renamed in the contract", renamed_check(doc), source),
        ("a check removed from the TypeScript", doc, source.replace("requireExaminedScope(db, subsystemId);", "", 1)),
        (
            "a rung added to the TypeScript",
            doc,
            source.replace('    case "adversarial": {', '    case "scoping": {\n      requireStructuralClaim(db, subsystemId);\n      break;\n    }\n    case "adversarial": {', 1),
        ),
        (
            "a guard dropped from the TypeScript",
            doc,
            source.replace('targetStatus === "concerns" || ', "", 1),
        ),
    ]
    for label, d, s in cases:
        if s == source and d is doc:
            return f"{label}: the mutation found nothing to change"
        if agreement(d, s) is None:
            return f"{label} is not reported"
    return None


# ---------------------------------------------------------------------------
# What the diagrams must draw, from the records, independent of the renderer.
# ---------------------------------------------------------------------------


def expected_workflow(doc: dict[str, Any]) -> tuple[set[str], list[str]]:
    passes = doc["survey_passes"]
    rungs = {rung["status"] for rung in doc["status_prerequisites"]}
    nodes = {f"survey-pass:{p['phase']}" for p in passes}
    edges = [f"pass-order:{a['phase']}:{b['phase']}" for a, b in zip(passes, passes[1:], strict=False)]
    for p in passes:
        if p["status"] in rungs:
            nodes.add(f"status-check:{p['status']}")
            edges.append(f"pass-check:{p['status']}")
        if p["checkpoint"].strip():
            nodes.add(f"checkpoint:{p['status']}")
            edges.append(f"pass-checkpoint:{p['status']}")
    return nodes, edges


def expected_ladder(doc: dict[str, Any], sid: str | None, moves: list[int]) -> tuple[set[str], list[str]]:
    nodes = {f"status:{value}" for value in (*LADDER, "deferred")}
    if sid is None:
        return nodes, [f"ladder-step:{a}:{b}" for a, b in zip(LADDER, LADDER[1:], strict=False)]
    return nodes | {f"subsystem:{sid}"}, [f"transition:{move}" for move in moves]


# ---------------------------------------------------------------------------
# The fixture store and its publication.
# ---------------------------------------------------------------------------


def build_store(root: Path) -> tuple[Path, dict[str, Any]]:
    storage = root / "storage"
    storage.mkdir(parents=True)
    (storage / "workspace_path").write_text("/example/FictionalProject\n")
    db = sqlite3.connect(storage / "memory.db")
    ids: dict[str, list[int]] = {}
    try:
        db.executescript((GOLDEN / "materializer" / "memory.sql").read_text())
        for sid, previous, status in TRANSITIONS:
            cur = db.execute(
                "INSERT INTO subsystem_status_transitions (subsystem_id, from_status, to_status, tool, session_id,"
                " ref_sha, created_at) VALUES (?, ?, ?, 'update_subsystem_status', 's1', ?, '2026-11-20 10:00:00')",
                (sid, previous, status, SHA),
            )
            ids.setdefault(sid, []).append(int(cur.lastrowid or 0))
        db.commit()
        statuses = {str(r[0]): str(r[1]) for r in db.execute("SELECT id, status FROM subsystems")}
    finally:
        db.close()
    return storage, {"moves": ids, "statuses": statuses}


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
    """Rewrite the receipt's hash for one edited page, so only the census can see the edit."""

    contract_path = output / ".projection-contract.json"
    contract = json.loads(contract_path.read_text())
    digest = hashlib.sha256((output / rel).read_bytes()).hexdigest()
    for page in contract["pages"]:
        if page["path"] == rel:
            page["content_hash"] = digest
    contract_path.write_text(json.dumps(contract, indent=2) + "\n")


def figures(text: str, kind: str) -> list[str]:
    return re.findall(rf'<figure\b[^>]*data-diagram="{kind}"[^>]*>.*?</figure>', text, re.S)


def drawn(figure: str) -> tuple[list[str], list[str], int]:
    nodes = re.findall(r'<g\b[^>]*\bdata-node="([^"]*)"', figure)
    edges = re.findall(r'<(?:line|path)\b[^>]*\bdata-edge="([^"]*)"', figure)
    unmarked = len(re.findall(r"<(?:line|path)\b(?![^>]*\bdata-edge=)[^>]*>", figure))
    return nodes, edges, unmarked


def node_words(doc: dict[str, Any], record: str) -> list[str]:
    """What a node's box must say, read from the contract rather than from the renderer."""

    kind, _, key = record.partition(":")
    if kind == "survey-pass":
        return [next(p["pass"] for p in doc["survey_passes"] if str(p["phase"]) == key)]
    if kind == "status-check":
        return ["Server checks"]
    if kind == "checkpoint":
        return ["Your checkpoint"]
    if kind == "status":
        return [next(v["label"] for v in doc["enums"]["subsystem_status"]["values"] if v["value"] == key)]
    if kind == "subsystem":
        return ["Here", key]
    return []


def node_faults(figure: str, doc: dict[str, Any]) -> str | None:
    """Each counted node must draw something: a visible box, the words its record gives it, and a link."""

    for record, inner in re.findall(r'<g\b[^>]*\bdata-node="([^"]*)"[^>]*>(.*?)</g>', figure, re.S):
        if not re.search(r"<(?:rect|polygon|circle|path)\b", inner):
            return f"the node {record} draws no visible shape"
        said = " ".join(re.sub(r"<[^>]+>", " ", inner).split())
        for words in node_words(doc, record):
            if " ".join(words.split()) not in said:
                return f"the node {record} does not say {words!r}; it says {said[:120]!r}"
        if not re.search(r'<a\b[^>]*\bhref="[^"]+"', inner):
            return f"the node {record} links to nothing"
    return None


def unlinked_marks(figure: str) -> str | None:
    """Appendix B rules 1 and 8: every arrow and every box is a link a keyboard can reach."""

    for record in re.findall(r'<path\b[^>]*\bdata-edge="([^"]*)"', figure):
        link = re.search(rf'<a\b([^>]*)\bhref="[^"]+"([^>]*)>\s*<path\b[^>]*\bdata-edge="{re.escape(record)}"', figure)
        if not link:
            return f"the arrow {record} is not a link"
        # The link holds only a path and a hidden head: without a name it is a focus
        # stop a screen reader cannot announce (final review F5/codex, F15/claude).
        name = re.search(r'\baria-label="([^"]*)"', link.group(1) + link.group(2))
        if name is None or not name.group(1).strip():
            return f"the arrow {record}'s link has no accessible name"
    for record, inner in re.findall(r'<g\b[^>]*\bdata-node="([^"]*)"[^>]*>(.*?)</g>', figure, re.S):
        if not re.search(r'<a\b[^>]*\bhref="[^"]+"', inner):
            return f"the box {record} is not a link"
    return None

def svg_faults(figure: str, nodes: int, edges: int) -> str | None:
    svg = re.search(r"<svg\b[^>]*>.*?</svg>", figure, re.S)
    if svg is None:
        return "the figure holds no SVG"
    text = svg.group(0)
    start = re.match(r"<svg\b[^>]*>", text).group(0)  # type: ignore[union-attr]
    if 'role="img"' not in start:
        return 'the SVG has no role="img"'
    if "viewBox=\"0 0 960 " not in start:
        return f"the SVG's viewBox is not 960 wide: {start[:200]}"
    title = re.search(r"<title\b[^>]*>(.+?)</title>", text, re.S)
    desc = re.search(r"<desc\b[^>]*>(.+?)</desc>", text, re.S)
    if title is None or not title.group(1).strip():
        return "the SVG has no <title>"
    if desc is None:
        return "the SVG has no <desc>"
    # The SVG's name and description are its title and desc only if it points at them
    # (final review F7/codex, F12/claude).
    labelled = re.search(r'\baria-labelledby="([^"]*)"', start)
    title_id = re.search(r'\bid="([^"]+)"', title.group(0))
    desc_id = re.search(r'\bid="([^"]+)"', desc.group(0))
    if labelled is None or title_id is None or desc_id is None:
        return "the SVG is not labelled by ids on its <title> and <desc>"
    if labelled.group(1).split() != [title_id.group(1), desc_id.group(1)]:
        return f"aria-labelledby names {labelled.group(1)!r}, not the <title> and <desc> ids {title_id.group(1)!r} {desc_id.group(1)!r}"
    said_boxes = re.search(r"(\d+) box(?:es)?\b", desc.group(1))
    said_arrows = re.search(r"(\d+) arrows?\b", desc.group(1))
    if said_boxes is None or said_arrows is None:
        return f"the <desc> does not count its boxes and arrows: {desc.group(1)[:160]!r}"
    if (int(said_boxes.group(1)), int(said_arrows.group(1))) != (nodes, edges):
        return f"the <desc> says {said_boxes.group(1)} boxes and {said_arrows.group(1)} arrows; the SVG draws {nodes} and {edges}"
    for size in re.findall(r'font-size[:=]\s*"?(\d+(?:\.\d+)?)', text):
        if float(size) < 11:
            return f"text is {size}px, under 11"
    if re.search(r"#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(", text):
        return "a colour is written as a literal, not a CSS token"
    if re.search(r"<script|\son\w+=", figure):
        return "the figure runs script"
    return None


def account_of(figure: str) -> str:
    match = re.search(r'<div class="diagram-account"[^>]*>(.*?)</div>', figure, re.S)
    return match.group(1) if match else ""


# ---------------------------------------------------------------------------
# The golden corpus.
# ---------------------------------------------------------------------------

_FIGURE_BLOCK = re.compile(
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

def golden_figures_only(previous: Path | None) -> str | None:
    version = GOLDEN / "VERSION"
    if not version.is_file() or version.read_text().strip() not in (PACKET, "SO23", "SO24", "SO25"):
        return f"the golden corpus's VERSION is {version.read_text().strip() if version.is_file() else 'absent'!r}, not {PACKET} or a later diagram packet"
    if previous is None:
        return f"the golden corpus cannot be read from git at {START_SHA[:12]}"
    before = {str(p.relative_to(previous)): p for p in previous.rglob("*.html") if "/html/" in str(p) and not lineage_style.is_uncompared_golden(str(p.relative_to(previous)))}
    after = {str(p.relative_to(GOLDEN)): p for p in GOLDEN.rglob("*.html") if "/html/" in str(p) and not lineage_style.is_uncompared_golden(str(p.relative_to(GOLDEN)))}
    if sorted(before) != sorted(after):
        return f"the corpus holds {len(after)} HTML pages for the start's {len(before)}"
    gained = 0
    for rel in sorted(after):
        new, old = (_SO20_MARKS.sub("", t) for t in lineage_style.pair(after[rel].read_text(), before[rel].read_text()))
        if _EMPTY_FLOW.sub("", _FIGURE_BLOCK.sub("", new)) != old:
            return f"{rel} differs from the start's corpus outside its <figure data-diagram> blocks"
        gained += new != old
    for asset in (previous / "assets").iterdir():
        if not (GOLDEN / "assets" / asset.name).is_file():
            return f"the folded asset {asset.name[:12]} changed"
    return None if gained >= 10 else f"only {gained} golden pages gained a diagram"


# ---------------------------------------------------------------------------


def main() -> int:
    diagrams, error = load("diagrams")
    core, error2 = load("core")
    page_mod, error3 = load("page")
    projection, error4 = load("html_projection")
    readback, error5 = load("readback")
    vocabulary, error6 = load("vocabulary")
    missing = error or error2 or error3 or error4 or error5 or error6
    if missing:
        emit(f"GATE SO22 RED: {missing}")
        return 1

    doc = contract_doc()

    # -- contract --------------------------------------------------------
    check("the contract's survey passes carry actor and checkpoint", lambda: contract_passes_ok(doc))

    def generated_passes() -> str | None:
        got = [(p.get("actor"), p.get("checkpoint")) for p in getattr(vocabulary, "SURVEY_PASSES", ())]
        want = [(p.get("actor"), p.get("checkpoint")) for p in doc["survey_passes"]]
        return None if got == want and got else f"vocabulary.py's SURVEY_PASSES carry {got}; the contract has {want}"

    check("vocabulary.py carries them as the contract has them", generated_passes)

    def generated_prerequisites() -> str | None:
        got = [(r.get("status"), [c.get("checked_by") for c in r.get("requires", ())]) for r in getattr(vocabulary, "STATUS_PREREQUISITES", ())]
        want = [(r["status"], [c["checked_by"] for c in r["requires"]]) for r in doc.get("status_prerequisites", [])]
        return None if got == want and got else f"vocabulary.py's STATUS_PREREQUISITES carry {got}; the contract has {want}"

    check("vocabulary.py carries the rung prerequisites", generated_prerequisites)

    source = INVARIANTS.read_text()
    check("the contract's rung prerequisites agree with enforcePhasePrerequisites", lambda: agreement(doc, source))
    check("each disagreement between them is reported", lambda: prerequisite_mutations(doc, source))

    def gen_check() -> str | None:
        proc = subprocess.run(["node", "scripts/gen-vocabulary.mjs", "--check"], cwd=MCP, capture_output=True, text=True)
        return None if proc.returncode == 0 else f"gen-vocabulary --check exits {proc.returncode}: {scrub(proc.stdout + proc.stderr)[-300:]}"

    check("the generated vocabulary is current", gen_check)

    # -- models ----------------------------------------------------------
    def workflow_model() -> str | None:
        model = diagrams.survey_workflow_model()
        want_nodes, want_edges = expected_workflow(doc)
        got_nodes = [n.record for n in model.nodes]
        if sorted(got_nodes) != sorted(want_nodes):
            return f"B1's nodes are {sorted(got_nodes)}; the contract's records are {sorted(want_nodes)}"
        if sorted(e.record for e in model.edges) != sorted(want_edges):
            return f"B1's edges are {sorted(e.record for e in model.edges)}; the records that join are {sorted(want_edges)}"
        for edge in model.edges:
            if edge.source not in got_nodes or edge.target not in got_nodes:
                return f"edge {edge.record} joins {edge.source} to {edge.target}, which are not both nodes"
        lanes = {n.record.split(":")[0]: n.row for n in model.nodes}
        if len({lanes["survey-pass"], lanes["status-check"], lanes["checkpoint"]}) != 3:
            return "the agent, server and reader marks do not sit in three lanes"
        if tuple(model.lanes) != ("Agent", "Server", "You"):
            return f"the lanes are {model.lanes}, not Agent, Server, You"
        return None

    check("B1's model is the contract's records", workflow_model)

    def ladder_model() -> str | None:
        model = diagrams.status_ladder_model()
        want_nodes, want_edges = expected_ladder(doc, None, [])
        if sorted(n.record for n in model.nodes) != sorted(want_nodes):
            return f"the guide ladder's nodes are {sorted(n.record for n in model.nodes)}"
        if sorted(e.record for e in model.edges) != sorted(want_edges):
            return f"the guide ladder's edges are {sorted(e.record for e in model.edges)}"
        rows = {n.record: n for n in model.nodes}
        if rows["status:deferred"].column <= max(rows[f"status:{v}"].column for v in LADDER):
            return "`deferred` is not drawn beside the ladder"
        climbing = [rows[f"status:{v}"].row for v in LADDER]
        if climbing != sorted(climbing, reverse=True) or len(set(climbing)) != len(LADDER):
            return f"the rungs do not climb, one row each: {climbing}"
        return None

    check("the ladder's model is the contract's rungs, with `deferred` beside it", ladder_model)

    def below_threshold() -> str | None:
        one = [dict(doc["survey_passes"][0])]
        sparse = diagrams.survey_workflow_model(passes=one, prerequisites=[])
        if sparse.nodes or sparse.edges or not sparse.below.strip():
            return "a one-pass survey is drawn, not said in a sentence"
        short = diagrams.status_ladder_model(rungs=[{"value": "unmapped", "label": "Unmapped"}])
        if short.nodes or not short.below.strip():
            return "a one-rung ladder is drawn, not said in a sentence"
        # At the declared minimum a diagram is drawn (Appendix B rule 11): two passes, two rungs.
        two = [dict(p) for p in doc["survey_passes"][:2]]
        if not diagrams.survey_workflow_model(passes=two, prerequisites=[]).nodes:
            return "a two-pass survey, the declared minimum, is not drawn"
        pair = [{"value": "unmapped", "label": "Unmapped"}, {"value": "scoping", "label": "Scoping"}]
        if not diagrams.status_ladder_model(rungs=pair).nodes:
            return "a two-rung ladder, the declared minimum, is not drawn"
        text = projection.write_html(page_mod.Page("t", GUIDE, (sparse,)))
        if "<svg" in text or "<figure" in text or sparse.below.strip().rstrip(".") not in re.sub(r"<[^>]+>", "", text):
            return f"the writer prints the sentence's model as an SVG or loses its sentence: {text[:200]!r}"
        return None

    check("below its minimum a diagram is a sentence", below_threshold)

    def deterministic_writer() -> str | None:
        model = diagrams.survey_workflow_model()
        first = projection.write_html(page_mod.Page("t", GUIDE, (model,)))
        second = projection.write_html(page_mod.Page("t", GUIDE, (diagrams.survey_workflow_model(),)))
        if first != second:
            return "two renders of one model differ"
        if not figures(first, "survey-workflow"):
            return "the writer prints no <figure data-diagram> for the model"
        return None

    check("the writer prints a model the same way twice", deterministic_writer)

    # -- the published pages ---------------------------------------------
    with tempfile.TemporaryDirectory(prefix="amanuensis-so22-") as tmp:
        root = Path(tmp)
        storage, facts = build_store(root)
        output, why = publish(storage)
        if output is None:
            emit(f"GATE SO22 RED: {why}")
            return 1

        def green() -> str | None:
            summary = verify(core, storage, output)
            if summary.get("ok"):
                return None
            first = (summary.get("mismatches") or [{}])[0]
            return f"{summary.get('mismatch_count')} mismatch(es), first {first}"

        check("the publication reads back green on every axis", green)

        guide = (output / GUIDE).read_text()

        def b1_published() -> str | None:
            found = figures(guide, "survey-workflow")
            if len(found) != 1:
                return f"the guide holds {len(found)} survey-workflow figures, not 1"
            nodes, edges, unmarked = drawn(found[0])
            want_nodes, want_edges = expected_workflow(doc)
            if Counter(nodes) != Counter(want_nodes):
                return f"B1 draws nodes {sorted(nodes)}; the records are {sorted(want_nodes)}"
            if Counter(edges) != Counter(want_edges):
                return f"B1 draws edges {sorted(edges)}; the records that join are {sorted(want_edges)}"
            if unmarked:
                return f"B1 draws {unmarked} line or path with no data-edge"
            if (fault := svg_faults(found[0], len(nodes), len(edges))) is not None:
                return fault
            if (fault := node_faults(found[0], doc)) is not None:
                return fault
            account = account_of(found[0])
            plain = re.sub(r"<[^>]+>", " ", account)
            for row in doc["survey_passes"]:
                if row["pass"] not in plain:
                    return f"B1's account does not name the pass {row['pass']!r}"
            checkpoint = next(r["checkpoint"] for r in doc["survey_passes"] if r["checkpoint"].strip())
            if checkpoint.strip().rstrip(".") not in " ".join(plain.split()):
                return "B1's account does not give the checkpoint's sentence"
            scoping_check = [r for r in doc["status_prerequisites"] if r["status"] == "scoping"]
            if not scoping_check and not re.search(r"\b1 of 5 passes? (?:has|have) no (?:server )?check", plain):
                return "B1's account does not count the passes with no check (1 of 5)"
            if "Read from" not in " ".join(re.sub(r"<[^>]+>", " ", found[0]).split()):
                return "B1 does not print what it was read from"
            return None

        check("the guide's survey workflow draws the contract's records, with an account", b1_published)

        def lanes_published() -> str | None:
            found = figures(guide, "survey-workflow")[0]
            for lane in ("Agent", "Server", "You"):
                if f">{lane}<" not in found.replace("\n", ""):
                    return f"the lane {lane!r} is not labelled in the SVG"
            if "data-node=\"status-check:scoping\"" in found or "data-node=\"status-check:unmapped\"" in found:
                return "a status with no recorded check is drawn as a server check"
            return None

        check("the three lanes are labelled and the unchecked pass has no check drawn", lanes_published)

        def guide_ladder() -> str | None:
            found = figures(guide, "status-ladder")
            if len(found) != 1:
                return f"the guide holds {len(found)} ladders, not 1"
            nodes, edges, unmarked = drawn(found[0])
            want_nodes, want_edges = expected_ladder(doc, None, [])
            if Counter(nodes) != Counter(want_nodes) or Counter(edges) != Counter(want_edges) or unmarked:
                return f"the guide ladder draws nodes {sorted(nodes)}, edges {sorted(edges)}, {unmarked} unmarked"
            if (fault := svg_faults(found[0], len(nodes), len(edges))) is not None:
                return fault
            if (fault := node_faults(found[0], doc)) is not None:
                return fault
            plain = " ".join(re.sub(r"<[^>]+>", " ", account_of(found[0])).split())
            for value in doc["enums"]["subsystem_status"]["values"]:
                if value["label"] not in plain:
                    return f"the ladder's account does not name {value['label']!r}"
            for rung in doc["status_prerequisites"]:
                for need in rung["requires"]:
                    if need["what"].strip().rstrip(".") not in plain:
                        return f"the ladder's account omits the check {need['what']!r}"
            if "deferred" in " ".join(re.findall(r'data-node="status:(\w+)"[^>]*data-rung="(?:yes|true)"', found[0])):
                return "`deferred` is marked as a rung"
            return None

        check("the guide's ladder draws the rungs and says what each rung asks", guide_ladder)

        def subsystem_ladders() -> str | None:
            for sid, rel in SUBSYSTEM_PAGES.items():
                page = (output / rel).read_text()
                found = figures(page, "status-ladder")
                moves = facts["moves"].get(sid, [])
                if len(found) != 1:
                    return f"{rel} holds {len(found)} ladders, not 1"
                nodes, edges, unmarked = drawn(found[0])
                want_nodes, want_edges = expected_ladder(doc, sid, moves)
                if Counter(nodes) != Counter(want_nodes):
                    return f"{sid}'s ladder draws nodes {sorted(nodes)}; the records are {sorted(want_nodes)}"
                if Counter(edges) != Counter(want_edges):
                    return f"{sid}'s ladder draws edges {sorted(edges)}; the recorded moves are {sorted(want_edges)}"
                if unmarked:
                    return f"{sid}'s ladder draws {unmarked} line or path with no data-edge"
                if (fault := svg_faults(found[0], len(nodes), len(edges))) is not None:
                    return f"{sid}: {fault}"
                if (fault := node_faults(found[0], doc)) is not None:
                    return f"{sid}: {fault}"
                if f'data-subject="{sid}"' not in found[0]:
                    return f"{sid}'s ladder does not name its subject"
                plain = " ".join(re.sub(r"<[^>]+>", " ", account_of(found[0])).split())
                labels = {v["value"]: v["label"] for v in doc["enums"]["subsystem_status"]["values"]}
                here = facts["statuses"][sid]
                if labels[here] not in plain or "here" not in plain.lower():
                    return f"{sid}'s account does not say it is here, at {labels[here]!r}"
                standing = next(v for v in doc["enums"]["subsystem_status"]["values"] if v["value"] == here)
                if standing["cannot_justify"].strip().rstrip(".") not in plain:
                    return f"{sid}'s account does not quote what {labels[here]!r} cannot justify"
                # Appendix B rule 2: captions quote the contract's `authorizes` too (F12/claude).
                if standing["authorizes"].strip().rstrip(".") not in plain:
                    return f"{sid}'s account does not quote what {labels[here]!r} authorizes"
                items = re.findall(r"<li\b[^>]*>(.*?)</li>", account_of(found[0]), re.S)
                if len(items) < len(moves) or (moves and len(items) != len(moves)):
                    return f"{sid}'s account lists {len(items)} moves; the store recorded {len(moves)}"
                if moves and SHA[:8] not in re.sub(r"<[^>]+>", " ", found[0]):
                    return f"{sid}'s ladder does not print the revision it was read at"
                if not moves and not re.search(r"history (?:was|is) not recorded", plain):
                    return f"{sid} has no recorded moves and its account does not say its history was not recorded"
                if moves and re.search(r"history (?:was|is) not recorded", plain):
                    return f"{sid} has recorded moves yet its account says its history was not recorded"
            return None

        check("each subsystem page's ladder has its marker, its climb and its account", subsystem_ladders)

        def deferred_beside() -> str | None:
            found = figures((output / SUBSYSTEM_PAGES["B-02"]).read_text(), "status-ladder")[0]
            if 'data-node="status:deferred"' not in found:
                return "B-02 was parked, yet no deferred box is drawn"
            nodes = re.findall(r'<g\b[^>]*data-node="status:(\w+)"[^>]*>', found)
            if sorted(nodes) != sorted((*LADDER, "deferred")):
                return f"the ladder's boxes are {nodes}"
            return None

        check("a parked subsystem's `deferred` is a box beside the ladder, not a rung", deferred_beside)

        def links_resolve() -> str | None:
            for rel in (GUIDE, *SUBSYSTEM_PAGES.values()):
                text = (output / rel).read_text()
                for figure in re.findall(r"<figure\b[^>]*data-diagram=.*?</figure>", text, re.S):
                    for href in re.findall(r'<a\b[^>]*href="([^"]+)"', figure):
                        path, _, fragment = href.partition("#")
                        target = (output / rel).parent / path if path else output / rel
                        if not target.resolve().is_file():
                            return f"{rel}: a diagram link goes to {href}, which is not a page"
                        if fragment and f'id="{fragment}"' not in target.read_text():
                            return f"{rel}: a diagram link goes to {href}, and no anchor {fragment} is there"
            return None

        check("every diagram link reaches an anchor", links_resolve)

        def marks_linked() -> str | None:
            for rel in (GUIDE, *SUBSYSTEM_PAGES.values()):
                text = (output / rel).read_text()
                for kind in ("survey-workflow", "status-ladder"):
                    for figure in figures(text, kind):
                        if (fault := unlinked_marks(figure)) is not None:
                            return f"{rel}: {kind}: {fault}"
            return None

        check("every arrow and every box is a link", marks_linked)

        def second_publication() -> str | None:
            again = root / "second"
            again.mkdir()
            storage2, _ = build_store(again)
            out2, why2 = publish(storage2)
            if out2 is None:
                return why2
            for rel in (GUIDE, *SUBSYSTEM_PAGES.values()):
                a = figures((output / rel).read_text(), "status-ladder") + figures((output / rel).read_text(), "survey-workflow")
                b = figures((out2 / rel).read_text(), "status-ladder") + figures((out2 / rel).read_text(), "survey-workflow")
                if not a or a != b:
                    return f"{rel}: the figures of two publications differ or are absent"
            return None

        check("two publications of one store print the same figures", second_publication)

        # -- sabotage, resealed -------------------------------------------
        def drop(record: str, kind: str = "node") -> Callable[[str], str]:
            def edit(text: str) -> str:
                if kind == "node":
                    return re.sub(rf'<g\b[^>]*data-node="{re.escape(record)}"[^>]*>.*?</g>', "", text, count=1, flags=re.S)
                return re.sub(rf'<(?:line|path)\b[^>]*data-edge="{re.escape(record)}"[^>]*/?>(?:</(?:line|path)>)?', "", text, count=1)

            return edit

        def hollow(record: str, keep: str = "") -> Callable[[str], str]:
            """Empty a node's container, or keep only its shapes (`keep="shape"`), leaving the mark (F2/codex)."""

            def edit(text: str) -> str:
                def gut(match: re.Match[str]) -> str:
                    inner = re.sub(r"<text\b.*?</text>", "", match.group(2), flags=re.S) if keep == "shape" else ""
                    return match.group(1) + inner + "</g>"

                return re.sub(rf'(<g\b[^>]*data-node="{re.escape(record)}"[^>]*>)(.*?)</g>', gut, text, count=1, flags=re.S)

            return edit

        def retarget(old: str, new: str) -> Callable[[str], str]:
            return lambda text: text.replace(f'"{old}"', f'"{new}"', 1)

        def unmarked_edge(text: str) -> str:
            return text.replace("</svg>", '<line x1="10" y1="10" x2="300" y2="40" stroke="var(--text)"/></svg>', 1)

        def remove_figure(kind: str) -> Callable[[str], str]:
            return lambda text: re.sub(rf'<figure\b[^>]*data-diagram="{kind}"[^>]*>.*?</figure>', "", text, count=1, flags=re.S)

        b01 = SUBSYSTEM_PAGES["B-01"]
        first_move = facts["moves"]["B-01"][1]
        sabotages: list[tuple[str, str, Callable[[str], str], str, str, str]] = [
            ("a pass removed from B1", GUIDE, drop("survey-pass:3"), "content", "survey-workflow-diagram-node", "survey-pass:3"),
            ("an unmarked edge added to B1", GUIDE, lambda t: re.sub(r"(<figure\b[^>]*data-diagram=\"survey-workflow\".*?)</svg>", lambda m: m.group(1) + '<line x1="10" y1="10" x2="300" y2="40" stroke="var(--text)"/></svg>', t, count=1, flags=re.S), "content", "survey-workflow-diagram-edge", ""),
            ("a server check re-pointed to another status in B1", GUIDE, retarget("pass-check:structural", "pass-check:mapped"), "content", "survey-workflow-diagram-edge", "pass-check"),
            ("a checkpoint removed from B1", GUIDE, drop("checkpoint:mapped"), "content", "survey-workflow-diagram-node", "checkpoint:mapped"),
            ("a pass's box and words emptied from its kept mark in B1", GUIDE, hollow("survey-pass:1"), "content", "survey-workflow-diagram-node", "survey-pass:1"),
            ("a pass's words removed from its kept box in B1", GUIDE, hollow("survey-pass:2", "shape"), "content", "survey-workflow-diagram-node", "survey-pass:2"),
            ("a rung re-marked on the guide's ladder", GUIDE, retarget("status:concerns", "status:mapped"), "content", "status-ladder-diagram-node", "status:"),
            ("a recorded move removed from B-01's ladder", b01, drop(f"transition:{first_move}", "edge"), "content", "status-ladder-diagram-edge", f"transition:{first_move}"),
            # The ladder's marker, by its attribute: the page's status line carries the same record.
            ("B-01's marker moved to B-02", b01, lambda text: text.replace('data-node="subsystem:B-01"', 'data-node="subsystem:B-02"', 1), "content", "status-ladder-diagram-node", "subsystem:"),
            ("an unmarked edge added to B-02's ladder", SUBSYSTEM_PAGES["B-02"], unmarked_edge, "content", "status-ladder-diagram-edge", ""),
            ("F-01's ladder removed", SUBSYSTEM_PAGES["F-01"], remove_figure("status-ladder"), "coverage", "status-ladder-diagram", "F-01"),
            ("B1 removed from the guide", GUIDE, remove_figure("survey-workflow"), "coverage", "survey-workflow-diagram", ""),
        ]
        for label, page, edit, axis, object_type, object_id in sabotages:

            def sabotaged(page: str = page, edit: Callable[[str], str] = edit, axis: str = axis,
                          object_type: str = object_type, object_id: str = object_id) -> str | None:
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
                summary = verify(core, storage, copy)
                mismatches = summary.get("mismatches") or []
                if any("differ from the publication receipt" in str(m.get("detail")) for m in mismatches):
                    return "the receipt was not resealed; the hash check saw the edit"
                hit = [
                    m for m in mismatches
                    if m.get("axis") == axis
                    and m.get("object_type") == object_type
                    and (not object_id or object_id in str(m.get("object_id")))
                ]
                if hit:
                    return None
                seen = sorted({(m.get("axis"), m.get("object_type"), m.get("object_id")) for m in mismatches})
                return f"no {axis} mismatch on {object_type} {object_id or '(any)'}; saw {seen[:4]}"

            check(f"sabotage, resealed: {label}", sabotaged)

    with tempfile.TemporaryDirectory(prefix="amanuensis-so22-golden-") as tmp:
        previous = start_corpus(Path(tmp))
        check("the golden corpus is SO22's or a later diagram packet's and differs from the start's only inside diagram figures",
              lambda: golden_figures_only(previous))

    def in_ci() -> str | None:
        try:
            text = CI_FILE.read_text()
        except OSError as exc:
            return f"test.yml cannot be read: {exc}"
        return None if "test-store-only-method-diagrams.py" in text else "test.yml has no step for this gate"

    check("the gate is a step in test.yml", in_ci)

    if FAILURES:
        emit(f"GATE SO22 RED: {len(FAILURES)} check(s) failed; first: {FAILURES[0]}")
        return 1
    emit("GATE SO22 GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
