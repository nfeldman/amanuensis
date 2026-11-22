#!/usr/bin/env python3
"""Gate for store-only packet SO25 — the flow strip (A3)
(design/store-only/PLAN.md §7.2, §7.3, §8 S5 and SO25, Appendix B).

A temporary store is seeded from the golden `materializer` store and given eight flows on
three subsystems: `login` (five steps, every kind of mark, a withdrawn mark and a mark on a
closed claim), `refresh` (two steps), `audit` (four steps, no marks), `readonly` (three steps,
a declination), `sweep` (fourteen steps, a step with three exits), `twelve` (twelve steps),
`huge` (twenty-two steps) and `render` (three steps on a subsystem that is only `scoping`).
It is published, and every drawn mark is compared with the records the store holds, read
independently of the renderer.

Turns red when:
  - `diagrams.py` lacks `flow_strip_model`, or a flow with fewer than three current steps
    draws a strip instead of a sentence, a flow with more than twenty steps draws one instead
    of a sentence and a numbered table of every step, a flow of twelve steps wraps, one of
    thirteen does not, or a subsystem below `structural` draws a flow (Appendix B rule 2) or
    does not say why it did not;
  - a strip's boxes are not its current steps (one box per step, in `<nn>` order, left to
    right, then down) and the marks the store holds for them (one per current, unwithdrawn
    mark of a current claim, except the exits of a step that has more than two), or an arrow
    joins two boxes that are not neighbours on one row; a withdrawn mark, or a mark on a closed
    claim, is drawn; a step's box is not solid for an observation, dashed for an inference and
    dotted for a hypothesis or an open question;
  - a commit point is not a vertical line just after its step, a crash point, a trigger or a
    seam crossing is not above its step, an exit is not below its step, a seam crossing does
    not link the seam on System boundaries, or a step with more than two exits draws any of
    them or does not list them all in the account, or an exit's box or account line names a
    target other than its stored one (a step it unwinds to, or `leaves-flow`);
  - an arrow or a box of a strip is not a link a keyboard can reach (rules 1 and 8);
  - a mark's account line or box does not open with its kind's `claim_mark_kind` label, or a
    kind the contract does not hold is drawn rather than refused (final review F18/claude);
  - a step is hatched for a file another subsystem's ledger row holds as stale while its
    own subsystem's reading is fresh (final review F4/codex);
  - a step whose cited file the ledger holds as stale is not hatched, or its box and account do
    not say "cited file changed since <the revision it was examined at>", or a step citing only
    an unchanged file is hatched (Appendix B rule 3);
  - a step or mark resting only on comment-asserted, name-inferred or pattern-matched evidence
    lacks the linchpin mark (◆, and the word in its label and account), a step that survived a
    challenge lacks the tick (✓), or either is drawn where the store holds neither (rule 7);
  - a flow with no marks and no declination does not say "marks not recorded", one with a
    declination does not print its reason or still says so, a flow with marks says so, or the
    account does not count the steps that have no recorded mark ("n of m");
  - an SVG lacks `role="img"`, a `<title>` or a `<desc>` that counts its boxes and arrows,
    states a font size under 11, uses a literal colour, runs a script, is not 960 wide, or a
    mark has no `data-node` or `data-edge`; a figure has no readable account listing every
    step and every mark, no statement of the revision it was read at (a sentence in place of a
    strip included) and each revision a drawn mark was recorded at, or a link that reaches
    no anchor, or an account anchor is not unique;
  - two publications of one store print different figures;
  - a sabotage that edits the subsystem page and reseals `.projection-contract.json` is not
    reported with the right axis and object type: a box removed or re-pointed, an arrow removed
    or added that no records join, a mark removed, a figure removed, a figure for a flow that
    draws a sentence;
  - the read-back of the publication is not green on every axis;
  - the golden corpus's `VERSION` is not SO25, or a golden page differs from the corpus this
    packet started from outside a flow-strip figure or sentence (or a figure or sentence of the
    slice's earlier diagrams, which a fix to the slice may reprint), or no golden page gained one;
  - the gate has no step in `.github/workflows/test.yml`.

Output protocol: exactly one status line, last, on stdout.
"""

from __future__ import annotations

import hashlib
import html
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
from typing import Any

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
GOLDEN = ROOT / "fixtures" / "store-only-golden"
GOLDEN_REL = "materializer/fixtures/store-only-golden"
CI_FILE = REPO / ".github" / "workflows" / "test.yml"
PACKET = "SO25"
# The commit this packet started from: its golden corpus is the reference.
START_SHA = "f5222b41382b11c5b4599f30f226461c80283d61"

KIND = "flow-strip"
NOT_RECORDED = "marks not recorded"
BAND = 12
MAX_STEPS = 20
MIN_STEPS = 3
FROM_STRUCTURAL = ("structural", "concerns", "adversarial", "mapped")
DASH = {"inference": "5 3", "hypothesis": "1.5 3", "open-question": "1.5 3"}
ABOVE = ("trigger", "crash-point", "crosses-seam")

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

SHA = "deadbeef"
# One mark is recorded at a later revision than its flow's steps; the strip must print both.
MARK_SHA = "cafebabe"
MARK_SHA_LABEL = "locked out"
# Files cited by login's steps: one changed since it was examined at EXAMINED_SHA, one not.
STALE_FILE, FRESH_FILE, EXAMINED_SHA = "auth/flow-stale.ts", "auth/flow-fresh.ts", "abad1dea"
OTHER_EXAMINED_SHA = "0ddba11"
# Appendix B rule 7: login step 03 rests only on comment-asserted evidence, as does the crash mark on step
# 01 (the golden store's evidence row 2); step 04 survived a challenge.
WEAK_EVIDENCE, WEAK_MARK_LABEL, WEAK_STEP, SURVIVED_STEP = 2, "session row half written", "03", "04"
# (subsystem, slug, step count, {step: epistemic kind} where not an observation)
FLOWS = (
    ("B-02", "login", 5, {"01": "inference", "03": "hypothesis"}),
    ("B-02", "refresh", 2, {}),
    ("B-02", "audit", 4, {}),
    ("B-02", "readonly", 3, {}),
    ("B-01", "sweep", 14, {"06": "open-question"}),
    ("B-01", "twelve", 12, {}),
    ("B-01", "huge", 22, {}),
    ("F-01", "render", 3, {}),
)
DECLINED = "B-02/flow/readonly"
DECLINATION = "The flow only reads, so it keeps nothing and has no commit point."
# (flow, step, kind, label, target)
MARKS = (
    ("B-02/flow/login", "00", "trigger", None, None),
    ("B-02/flow/login", "01", "crash-point", "session row half written", None),
    ("B-02/flow/login", "02", "commit-point", None, None),
    ("B-02/flow/login", "03", "crash-point", "token issued, audit row missing", None),
    ("B-02/flow/login", "03", "exit", "denied", "01"),
    ("B-02/flow/login", "03", "exit", "locked out", "leaves-flow"),
    ("B-02/flow/login", "04", "crosses-seam", None, "SM-01"),
    ("B-01/flow/sweep", "02", "crosses-seam", None, "SM-01"),
    ("B-01/flow/sweep", "05", "commit-point", None, None),
    ("B-01/flow/sweep", "07", "exit", "stale lock", "03"),
    ("B-01/flow/sweep", "07", "exit", "disk full", "leaves-flow"),
    ("B-01/flow/sweep", "07", "exit", "cancelled", "05"),
    ("B-01/flow/sweep", "08", "exit", "bad record", "leaves-flow"),
    ("B-01/flow/sweep", "12", "crash-point", "second band crash", None),
)
# Marks the page must not draw: a withdrawn one, and one on a closed claim.
WITHDRAWN = ("B-02/flow/login", "02", "crash-point", "withdrawn by the survey", None)
CLOSED = ("B-02/flow/login", "02", "commit-point", None, None)


def statement(sid: str, slug: str, step: str) -> str:
    return f"{slug} step {step} of {sid} does its part"


def build_store(root: Path) -> Path:
    storage = root / "storage"
    storage.mkdir(parents=True)
    (storage / "workspace_path").write_text("/example/FictionalProject\n")
    db = sqlite3.connect(storage / "memory.db")
    try:
        db.executescript((GOLDEN / "materializer" / "memory.sql").read_text())
        for sid, slug, count, kinds in FLOWS:
            for n in range(count):
                step = f"{n:02d}"
                key = f"{sid}/flow/{slug}/{step}"
                db.execute(
                    "INSERT INTO claims (claim_id, claim_key, subject_type, subject_id, statement, epistemic_kind,"
                    " asserted_at_sha, valid_from_sha, session_id) VALUES (?,?,?,?,?,?,?,?,?)",
                    (key, key, "subsystem", sid, statement(sid, slug, step), kinds.get(step, "observation"), SHA, SHA, "s1"),
                )
        closed_key = "B-02/flow/login/02"
        db.execute(
            "INSERT INTO claims (claim_id, claim_key, subject_type, subject_id, statement, epistemic_kind,"
            " asserted_at_sha, valid_from_sha, valid_until_sha, session_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (f"{closed_key}@old", closed_key, "subsystem", "B-02", "an earlier reading of login step 02", "observation", SHA, SHA, SHA, "s1"),
        )
        for flow, step, kind, label, target in (*MARKS, WITHDRAWN):
            db.execute(
                "INSERT INTO claim_marks (claim_id, kind, label, target, evidence_id, ref_sha, session_id) VALUES (?,?,?,?,?,?,?)",
                (f"{flow}/{step}", kind, label, target, WEAK_EVIDENCE if label == WEAK_MARK_LABEL else 1, MARK_SHA if label == MARK_SHA_LABEL else SHA, "s1"),
            )
        withdrawn_id = db.execute("SELECT id FROM claim_marks WHERE label = ?", (WITHDRAWN[3],)).fetchone()[0]
        db.execute("INSERT INTO claim_mark_withdrawals (mark_id, reason, session_id) VALUES (?,?,?)", (withdrawn_id, "mistaken", "s1"))
        closed_mark = CLOSED
        db.execute(
            "INSERT INTO claim_marks (claim_id, kind, label, target, evidence_id, ref_sha, session_id) VALUES (?,?,?,?,?,?,?)",
            (f"{closed_mark[0]}/{closed_mark[1]}@old", closed_mark[2], closed_mark[3], closed_mark[4], 1, SHA, "s1"),
        )
        db.execute("INSERT INTO claim_mark_declinations (flow_key, reason, ref_sha, session_id) VALUES (?,?,?,?)", (DECLINED, DECLINATION, SHA, "s1"))
        db.execute(
            "INSERT INTO claim_evidence (claim_id, evidence_id, role) VALUES (?, ?, 'supports')",
            (f"B-02/flow/login/{WEAK_STEP}", WEAK_EVIDENCE),
        )
        db.execute(
            "INSERT INTO claim_challenge_outcomes (claim_id, claim_key, outcome, challenge, at_sha, session_id)"
            " VALUES (?, ?, 'survived', 'Could the token be issued before the session row is written?', ?, 's1')",
            (f"B-02/flow/login/{SURVIVED_STEP}", f"B-02/flow/login/{SURVIVED_STEP}", SHA),
        )
        # Login step 01 cites a file the repository changed after it was examined; step 02 one that has not changed.
        for path, step, stale in ((STALE_FILE, "01", 1), (FRESH_FILE, "02", 0)):
            evidence = db.execute(
                "INSERT INTO evidence (file_path, symbol, ref_sha, kind, note, session_id) VALUES (?, NULL, ?, 'code-verified', 'cited by a flow step', 's1')",
                (path, SHA),
            ).lastrowid
            db.execute("INSERT INTO claim_evidence (claim_id, evidence_id, role) VALUES (?, ?, 'supports')", (f"B-02/flow/login/{step}", evidence))
            db.execute(
                "INSERT INTO file_ledger (subsystem_id, file_path, classification, ref_sha, stale) VALUES ('B-02', ?, 'examined', ?, ?)",
                (path, EXAMINED_SHA, stale),
            )
        # The fresh file is in B-01's scope too, and B-01's reading of it is stale: freshness
        # is the claim's own subsystem's, so login step 02 stays solid (final review F4/codex).
        db.execute(
            "INSERT INTO file_ledger (subsystem_id, file_path, classification, ref_sha, stale) VALUES ('B-01', ?, 'examined', ?, 1)",
            (FRESH_FILE, OTHER_EXAMINED_SHA),
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


def plain(text: str) -> str:
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", text)).split())


def figures(text: str, kind: str = KIND) -> list[str]:
    return re.findall(rf'<figure\b[^>]*data-diagram="{kind}"[^>]*>.*?</figure>', text, re.S)


def figure_of(text: str, flow: str) -> str | None:
    for figure in figures(text):
        if f'data-subject="{flow}"' in figure:
            return figure
    return None


def sentence_of(text: str, flow: str) -> str | None:
    found = re.findall(rf'<p class="diagram-below"[^>]*data-diagram="{KIND}"[^>]*data-subject="{re.escape(flow)}"[^>]*>.*?</p>', text, re.S)
    return plain(found[0]) if found else None


def drawn(figure: str) -> tuple[list[str], list[str]]:
    nodes = re.findall(r'<g\b[^>]*\bdata-node="([^"]*)"', figure)
    edges = re.findall(r'<path\b[^>]*\bdata-edge="([^"]*)"', figure)
    return nodes, edges


def node_body(figure: str, record: str) -> str:
    match = re.search(rf'<g\b[^>]*\bdata-node="{re.escape(record)}"[^>]*>(.*?)</g>', figure, re.S)
    return match.group(1) if match else ""


def rect_of(figure: str, record: str) -> tuple[float, float, float, float] | None:
    body = node_body(figure, record)
    match = re.search(r'<rect\b[^>]*\bx="(-?[\d.]+)"[^>]*\by="(-?[\d.]+)"[^>]*\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"', body)
    return tuple(float(v) for v in match.groups()) if match else None  # type: ignore[return-value]


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


# What the store says a flow draws, read without the renderer.
def wanted(storage: Path) -> dict[str, dict[str, Any]]:
    status = {str(r["id"]): str(r["status"] or "unmapped") for r in table(storage, "SELECT id, status FROM subsystems")}
    out: dict[str, dict[str, Any]] = {}
    for sid, slug, _count, _kinds in FLOWS:
        flow = f"{sid}/flow/{slug}"
        steps = sorted(
            table(
                storage,
                "SELECT claim_id, claim_key, statement, epistemic_kind FROM claims"
                " WHERE valid_until_sha IS NULL AND claim_key LIKE ? ORDER BY claim_key",
                (f"{flow}/%",),
            ),
            key=lambda r: int(str(r["claim_key"]).rsplit("/", 1)[1]),
        )
        marks = table(
            storage,
            "SELECT m.* FROM claim_marks m JOIN claims c ON c.claim_id = m.claim_id"
            " WHERE c.valid_until_sha IS NULL AND c.claim_key LIKE ?"
            " AND NOT EXISTS (SELECT 1 FROM claim_mark_withdrawals w WHERE w.mark_id = m.id) ORDER BY m.id",
            (f"{flow}/%",),
        )
        step_of = {str(s["claim_id"]): str(s["claim_key"]).rsplit("/", 1)[1] for s in steps}
        exits: dict[str, int] = {}
        for m in marks:
            if m["kind"] == "exit":
                exits[step_of[str(m["claim_id"])]] = exits.get(step_of[str(m["claim_id"])], 0) + 1
        drawn_marks = [m for m in marks if not (m["kind"] == "exit" and exits[step_of[str(m["claim_id"])]] > 2)]
        n = len(steps)
        shows = status.get(sid, "unmapped") in FROM_STRUCTURAL and MIN_STEPS <= n <= MAX_STEPS
        order = [str(s["claim_id"]) for s in steps]
        out[flow] = {
            "sid": sid,
            "slug": slug,
            "figure": shows,
            "steps": steps,
            "marks": marks,
            "drawn_marks": drawn_marks,
            "step_of": step_of,
            "exits": exits,
            "status": status.get(sid, "unmapped"),
            "nodes": sorted([f"flow-step:{c}" for c in order] + [f"flow-mark:{m['id']}" for m in drawn_marks]),
            "edges": sorted(f"flow-next:{a}:{b}" for i, (a, b) in enumerate(zip(order, order[1:], strict=False)) if i // BAND == (i + 1) // BAND),
        }
    return out


# ---------------------------------------------------------------------------
# The golden corpus.
# ---------------------------------------------------------------------------

_ADDED = re.compile(
    rf'<figure\b[^>]*data-diagram="{KIND}"[^>]*>.*?</figure>\n?'
    rf'|<p class="diagram-below"[^>]*data-diagram="{KIND}"[^>]*>.*?</p>\n?',
    re.S,
)
# Consecutive paragraphs share a wrapper; taking the figures out can leave it empty.
_EMPTY_FLOW = re.compile(r'<div class="prose-flow">\s*</div>\n?')


# The slice's earlier diagrams (SO22–SO24): a fix to slice S5 may reprint them, so they are taken
# out of both the start's corpus and the current one, which still pins everything around them.
_EARLIER = re.compile(
    r'<figure\b[^>]*data-diagram="(?:survey-workflow|status-ladder|coverage-bars|seam-contract)"[^>]*>.*?</figure>\n?'
    r'|<p class="diagram-below"[^>]*data-diagram="(?:survey-workflow|status-ladder|coverage-bars|seam-contract)"[^>]*>.*?</p>\n?'
    # SO23's note under a surface that draws finding badges.
    r'|<p class="finding-badge-note"[^>]*>.*?</p>\n?',
    re.S,
)


def _without_additions(text: str) -> str:
    return _EMPTY_FLOW.sub("", _ADDED.sub("", _EARLIER.sub("", text))).replace("\n", "")


def start_corpus(into: Path) -> Path | None:
    archive = subprocess.run(["git", "-C", str(REPO), "archive", START_SHA, GOLDEN_REL], capture_output=True)
    if archive.returncode != 0 or not archive.stdout:
        return None
    tar = into / "start.tar"
    tar.write_bytes(archive.stdout)
    unpacked = subprocess.run(["tar", "-xf", str(tar), "-C", str(into)], capture_output=True)
    corpus = into / GOLDEN_REL
    return corpus if unpacked.returncode == 0 and corpus.is_dir() else None


# SO20's record marks (`data-record`, `data-state`, `data-node`, `data-edge`) are not this
# packet's addition; the slice-S4 fix added more of them after it landed (F3-F5), so a page is
# compared with them taken out on both sides.
_SO20_MARKS = re.compile(r' data-(?:record|state|node|edge)="[^"]*"')

def golden_additions_only(previous: Path | None) -> str | None:
    version = GOLDEN / "VERSION"
    if not version.is_file() or version.read_text().strip() != PACKET:
        return f"the golden corpus's VERSION is {version.read_text().strip() if version.is_file() else 'absent'!r}, not {PACKET}"
    if previous is None:
        return f"the golden corpus cannot be read from git at {START_SHA[:12]}"
    before = {str(p.relative_to(previous)): p for p in previous.rglob("*.html") if "/html/" in str(p)}
    after = {str(p.relative_to(GOLDEN)): p for p in GOLDEN.rglob("*.html") if "/html/" in str(p)}
    if sorted(before) != sorted(after):
        return f"the corpus holds {len(after)} HTML pages for the start's {len(before)}"
    gained = 0
    for rel in sorted(after):
        new, old = _SO20_MARKS.sub("", after[rel].read_text()), _SO20_MARKS.sub("", before[rel].read_text())
        if _without_additions(new) != _EMPTY_FLOW.sub("", _EARLIER.sub("", old)).replace("\n", ""):
            return f"{rel} differs from the start's corpus outside a flow-strip figure or sentence, or the slice's earlier diagrams"
        gained += bool(_ADDED.search(new))
    for asset in (previous / "assets").iterdir():
        if not (GOLDEN / "assets" / asset.name).is_file():
            return f"the folded asset {asset.name[:12]} changed"
    return None if gained >= 1 else "no golden page gained a flow-strip figure or sentence"


# ---------------------------------------------------------------------------


def main() -> int:
    diagrams, error = load("diagrams")
    core, error2 = load("core")
    slugs, error3 = load("slugs")
    missing = error or error2 or error3
    if not missing and not hasattr(diagrams, "flow_strip_model"):
        missing = "diagrams.py lacks flow_strip_model"
    if missing:
        emit(f"GATE SO25 RED: {missing}")
        return 1

    with tempfile.TemporaryDirectory(prefix="amanuensis-so25-") as tmp:
        root = Path(tmp)
        store = build_store(root / "a")
        output, why = publish(store)
        if output is None:
            emit(f"GATE SO25 RED: {why}")
            return 1
        want = wanted(store)
        names = {str(r["id"]): str(r["name"]) for r in table(store, "SELECT id, name FROM subsystems")}

        def page_of(sid: str) -> str:
            return slugs.subsystem_page(sid, names[sid])

        def text_of(sid: str) -> str:
            return (output / page_of(sid)).read_text()

        def green() -> str | None:
            summary = verify(core, store, output)
            if summary.get("ok"):
                return None
            first = (summary.get("mismatches") or [{}])[0]
            return f"{summary.get('mismatch_count')} mismatch(es), first {first}"

        check("the publication reads back green on every axis", green)

        def census() -> str | None:
            for sid in sorted({w["sid"] for w in want.values()}):
                page = text_of(sid)
                found = sorted(re.findall(r'data-subject="([^"]*)"', " ".join(re.findall(rf'<figure\b[^>]*data-diagram="{KIND}"[^>]*>', page))))
                owed = sorted(f for f, w in want.items() if w["sid"] == sid and w["figure"])
                if found != owed:
                    return f"{page_of(sid)} draws strips for {found}; the flows owed one are {owed}"
                for flow, w in want.items():
                    if w["sid"] == sid and not w["figure"] and sentence_of(page, flow) is None:
                        return f"{flow} draws no strip and has no sentence on {page_of(sid)}"
            if sum(1 for w in want.values() if w["figure"]) < 4:
                return "the fixture holds fewer than four drawn flows"
            return None

        check("one strip per flow of three to twenty steps from Structural up, a sentence for the others", census)

        def marks() -> str | None:
            for flow, w in want.items():
                if not w["figure"]:
                    continue
                figure = figure_of(text_of(w["sid"]), flow)
                if figure is None:
                    return f"{flow} has no figure"
                nodes, edges = drawn(figure)
                if sorted(nodes) != w["nodes"]:
                    return f"{flow} draws boxes {sorted(nodes)}; its steps and marks are {w['nodes']}"
                if sorted(edges) != w["edges"]:
                    return f"{flow} draws arrows {sorted(edges)}; its neighbouring steps are {w['edges']}"
                if (fault := svg_faults(figure, len(nodes), len(edges))) is not None:
                    return f"{flow}: {fault}"
            return None

        check("boxes are the current steps and marks, arrows join neighbouring steps on a row", marks)

        def order_and_wrap() -> str | None:
            for flow, w in want.items():
                if not w["figure"]:
                    continue
                figure = figure_of(text_of(w["sid"]), flow) or ""
                spots = []
                for s in w["steps"]:
                    rect = rect_of(figure, f"flow-step:{s['claim_id']}")
                    if rect is None:
                        return f"{flow}: the box of step {s['claim_key']} has no rectangle"
                    spots.append(rect)
                rows_y = sorted({round(r[1], 1) for r in spots})
                expected_rows = (len(spots) + BAND - 1) // BAND
                if len(rows_y) != expected_rows:
                    return f"{flow} has {len(spots)} steps and draws {len(rows_y)} row(s), not {expected_rows}"
                if sorted(range(len(spots)), key=lambda i: (round(spots[i][1], 1), spots[i][0])) != list(range(len(spots))):
                    return f"{flow}: the boxes are not in step order, left to right and then down"
                if len([r for r in spots if round(r[1], 1) == rows_y[0]]) > BAND:
                    return f"{flow} puts more than {BAND} steps on a row"
            return None

        check("steps run in number order, left to right, and wrap after twelve", order_and_wrap)

        def commit_line() -> str | None:
            seen = 0
            for flow, w in want.items():
                if not w["figure"]:
                    continue
                figure = figure_of(text_of(w["sid"]), flow) or ""
                for m in w["drawn_marks"]:
                    if m["kind"] != "commit-point":
                        continue
                    seen += 1
                    step = f"flow-step:{m['claim_id']}"
                    rect = rect_of(figure, step)
                    body = node_body(figure, f"flow-mark:{m['id']}")
                    thin = [
                        tuple(float(v) for v in r.groups())
                        for r in re.finditer(r'<rect\b[^>]*\bx="(-?[\d.]+)"[^>]*\by="(-?[\d.]+)"[^>]*\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"', body)
                        if float(r.group(3)) <= 4
                    ]
                    if rect is None or not thin:
                        return f"{flow}: the commit point on {step} is not a line"
                    lx, ly, lw, lh = thin[0]
                    x1 = lx + lw / 2
                    if lh < rect[3]:
                        return f"{flow}: the commit point is not a vertical line at least as tall as its step"
                    if not (rect[0] + rect[2] < x1 and ly <= rect[1] and ly + lh >= rect[1] + rect[3]):
                        return f"{flow}: the commit line is not after its step"
                    # No other step's box lies between the step and its line.
                    for s in w["steps"]:
                        other = rect_of(figure, f"flow-step:{s['claim_id']}")
                        if other is not None and other != rect and abs(other[1] - rect[1]) < 1 and rect[0] + rect[2] < other[0] < x1:
                            return f"{flow}: the commit line is drawn after a later step than {step}"
            return None if seen >= 2 else f"the fixture draws {seen} commit points, not two"

        check("a commit point is a vertical line just after its step", commit_line)

        def placement() -> str | None:
            seen = {"above": 0, "below": 0}
            for flow, w in want.items():
                if not w["figure"]:
                    continue
                figure = figure_of(text_of(w["sid"]), flow) or ""
                for m in w["drawn_marks"]:
                    if m["kind"] == "commit-point":
                        continue
                    step = rect_of(figure, f"flow-step:{m['claim_id']}")
                    spot = rect_of(figure, f"flow-mark:{m['id']}")
                    if step is None or spot is None:
                        return f"{flow}: mark {m['id']} ({m['kind']}) or its step has no rectangle"
                    centre = spot[0] + spot[2] / 2
                    if not (step[0] - 1 <= centre <= step[0] + step[2] + 1):
                        return f"{flow}: {m['kind']} mark {m['id']} is not over its step"
                    if m["kind"] in ABOVE:
                        seen["above"] += 1
                        if spot[1] + spot[3] > step[1] + 0.5:
                            return f"{flow}: {m['kind']} mark {m['id']} is not above its step"
                    else:
                        seen["below"] += 1
                        if spot[1] < step[1] + step[3] - 0.5:
                            return f"{flow}: exit {m['id']} is not below its step"
            return None if seen["above"] >= 5 and seen["below"] >= 3 else f"the fixture draws {seen} marks"

        check("trigger, crash point and seam crossing sit above their step; an exit hangs below", placement)

        def crowded_exits() -> str | None:
            w = want["B-01/flow/sweep"]
            if w["exits"].get("07") != 3:
                return f"the fixture's sweep should have three exits on step 07, has {w['exits']}"
            figure = figure_of(text_of("B-01"), "B-01/flow/sweep") or ""
            on_seven = [m for m in w["marks"] if m["kind"] == "exit" and w["step_of"][str(m["claim_id"])] == "07"]
            for m in on_seven:
                if f"flow-mark:{m['id']}" in figure:
                    return f"exit {m['id']} of a step with three exits is drawn"
            account = account_of(figure)
            for m in on_seven:
                if m["label"] not in account:
                    return f"the account does not list the exit {m['label']!r} of the crowded step"
            if not re.search(r"step 07[^.]*\b3 exits\b[^.]*(?:more than two|not drawn)|3 exits[^.]*step 07", account, re.I):
                return f"the account does not say step 07 has three exits, listed and not drawn: {account[:400]!r}"
            one = [m for m in w["marks"] if m["kind"] == "exit" and w["step_of"][str(m["claim_id"])] == "08"]
            if not one or f"flow-mark:{one[0]['id']}" not in figure:
                return "the single exit on step 08 is not drawn"
            return None

        check("a step with more than two exits lists them and draws none", crowded_exits)

        def exit_targets() -> str | None:
            # Where each exit goes is the stored target: a step of the flow, or out of it. The drawn box
            # names it, and so does the account, for drawn and listed exits alike.
            seen = {"step": 0, "leaves": 0}
            for flow, w in want.items():
                if not w["figure"]:
                    continue
                figure = figure_of(text_of(w["sid"]), flow) or ""
                text = " ".join(account_of(figure).split())
                drawn_ids = {str(m["id"]) for m in w["drawn_marks"]}
                for m in w["marks"]:
                    if m["kind"] != "exit":
                        continue
                    step = w["step_of"][str(m["claim_id"])]
                    target = str(m["target"])
                    leaves = target == "leaves-flow"
                    seen["leaves" if leaves else "step"] += 1
                    where = "leaves the flow" if leaves else f"unwinds to step {target}"
                    if not re.search(rf"Exit at step {step}: {re.escape(str(m['label']))}, {re.escape(where)}\.", text):
                        return f"{flow}: the account does not say exit {m['id']} ({m['label']!r}) {where}"
                    if str(m["id"]) in drawn_ids:
                        body = html.unescape(node_body(figure, f"flow-mark:{m['id']}"))
                        named = re.search(r'aria-label="([^"]*)"', body)
                        box = " ".join(plain(body).split())
                        goes = "leaves flow" if leaves else f"step {target}"
                        if named is None or goes not in named.group(1):
                            return f"{flow}: exit {m['id']}'s box does not name where it goes ({goes!r}): {named.group(1) if named else None!r}"
                        if not leaves and goes not in box and "…" not in box:
                            return f"{flow}: exit {m['id']}'s box reads {box!r}, not its target {goes!r}"
            return None if seen["step"] >= 2 and seen["leaves"] >= 2 else f"the fixture's exits are {seen}"

        check("each exit, drawn or listed, names the target the store holds", exit_targets)

        def mark_words_from_contract() -> str | None:
            # A mark is named by its kind's `claim_mark_kind` label, in the account and in its box,
            # and a kind the contract does not hold is an error, never a trigger (F18/claude).
            vocab = json.loads((REPO / "mcp-server" / "contracts" / "conspectus-vocabulary.json").read_text())
            names = {str(v["value"]): str(v["label"]) for v in vocab["enums"]["claim_mark_kind"]["values"]}
            for kind, label in names.items():
                mark = {"kind": kind, "step": "03", "label": "half written", "target": "SM-01" if kind == "crosses-seam" else "leaves-flow"}
                line = diagrams._flow_mark_text(mark)
                box = diagrams._flow_mark_box(mark)
                if not line.startswith(label) or not box.startswith(label):
                    return f"a {kind} mark reads {line!r} / {box!r}; the contract names it {label!r}"
            try:
                said = diagrams._flow_mark_box({"kind": "rollback", "step": "03", "label": "", "target": ""})
            except ValueError:
                return None
            return f"a mark of a kind the contract does not hold is drawn as {said!r}"

        check("flow marks are named by the contract's claim_mark_kind labels", mark_words_from_contract)

        def stale_hatched() -> str | None:
            # Appendix B rule 3: a current claim whose cited file is stale is hatched, and says since when.
            figure = figure_of(text_of("B-02"), "B-02/flow/login") or ""
            hatched = [
                record for record, body in re.findall(r'<g\b[^>]*\bdata-node="(flow-step:[^"]*)"[^>]*>(.*?)</g>', figure, re.S)
                if re.search(r'fill="url\(#[^)]+\)"', body)
            ]
            if hatched != ["flow-step:B-02/flow/login/01"]:
                return f"the login strip hatches {hatched}; only step 01 cites a file changed since it was examined"
            pattern = re.search(r'<pattern\b[^>]*\bid="([^"]+)"', figure)
            if pattern is None or f"url(#{pattern.group(1)})" not in node_body(figure, "flow-step:B-02/flow/login/01"):
                return "step 01's hatching names no pattern the SVG defines"
            label = re.search(r'aria-label="([^"]*)"', html.unescape(node_body(figure, "flow-step:B-02/flow/login/01")))
            if label is None or f"changed since {EXAMINED_SHA}" not in label.group(1):
                return f"step 01's box does not say its cited file changed since {EXAMINED_SHA}: {label.group(1) if label else None!r}"
            text = " ".join(account_of(figure).split())
            if not re.search(rf"Step 01:.*?cited file changed since {EXAMINED_SHA}: {re.escape(STALE_FILE)}", text, re.I):
                return f"the account does not say step 01's cited file {STALE_FILE} changed since {EXAMINED_SHA}: {text[:500]!r}"
            if FRESH_FILE in text or OTHER_EXAMINED_SHA in figure:
                return f"the account calls {FRESH_FILE} changed, and it is not for B-02, whatever B-01's reading says"
            return None

        check("a step whose cited file changed since it was examined is hatched and says since when", stale_hatched)

        def linchpins_and_ticks() -> str | None:
            # Appendix B rule 7: a mark resting only on comment-asserted, name-inferred or pattern-matched
            # evidence carries the linchpin mark; a claim that survived a challenge carries a tick.
            figure = figure_of(text_of("B-02"), "B-02/flow/login") or ""
            crash = next(m for m in want["B-02/flow/login"]["marks"] if m["label"] == WEAK_MARK_LABEL)
            expect = {
                "flow-step:B-02/flow/login/" + WEAK_STEP: ("linchpin", "◆"),
                "flow-step:B-02/flow/login/" + SURVIVED_STEP: ("survived a challenge", "✓"),
                f"flow-mark:{crash['id']}": ("linchpin", "◆"),
            }
            for record, body in re.findall(r'<g\b[^>]*\bdata-node="([^"]*)"[^>]*>(.*?)</g>', figure, re.S):
                body = html.unescape(body)
                named = re.search(r'aria-label="([^"]*)"', body)
                said = named.group(1) if named else ""
                shown = " ".join(plain(body).split())
                if record in expect:
                    words, glyph = expect[record]
                    if words not in said or glyph not in shown:
                        return f"{record} does not carry {words!r} ({glyph}): label {said!r}, drawn {shown!r}"
                elif "linchpin" in said or "survived" in said or "◆" in shown or "✓" in shown:
                    return f"{record} carries a linchpin or a tick the store does not hold: {said!r}"
            text = " ".join(account_of(figure).split())
            if not re.search(rf"Step {WEAK_STEP}:[^.]*\.[^.]*Comment asserted[^.]*linchpin", text):
                return f"the account does not say step {WEAK_STEP} rests only on comment-asserted evidence, a linchpin: {text[:600]!r}"
            if not re.search(rf"Step {SURVIVED_STEP}:[^.]*\.[^.]*survived a challenge", text):
                return f"the account does not say step {SURVIVED_STEP} survived a challenge: {text[:600]!r}"
            if not re.search(rf"{re.escape(WEAK_MARK_LABEL)}\.[^.]*Comment asserted[^.]*linchpin", text):
                return f"the account does not say the crash mark rests only on comment-asserted evidence: {text[:600]!r}"
            return None

        check("a step or mark resting only on weak evidence carries the linchpin mark; a survived challenge a tick", linchpins_and_ticks)

        def seam_links() -> str | None:
            seams = (output / "seams.html").read_text()
            found = 0
            for flow, w in want.items():
                if not w["figure"]:
                    continue
                figure = figure_of(text_of(w["sid"]), flow) or ""
                for m in w["drawn_marks"]:
                    if m["kind"] != "crosses-seam":
                        continue
                    found += 1
                    body = node_body(figure, f"flow-mark:{m['id']}")
                    href = re.search(r'<a\b[^>]*href="([^"]+)"', body)
                    if href is None:
                        return f"{flow}: the crossing of {m['target']} is not a link"
                    path, _, fragment = href.group(1).partition("#")
                    if Path(path).name != "seams.html" or fragment != str(m["target"]).lower():
                        return f"{flow}: the crossing of {m['target']} links {href.group(1)}"
                    target = ((output / page_of(w["sid"])).parent / path).resolve()
                    if target != (output / "seams.html").resolve() or f'id="{fragment}"' not in seams:
                        return f"{flow}: the link {href.group(1)} reaches no seam on System boundaries"
                    if m["target"] not in plain(body):
                        return f"{flow}: the crossing does not name {m['target']}"
            return None if found >= 2 else f"the fixture draws {found} seam crossings"

        check("a seam crossing links the seam on System boundaries", seam_links)

        def uncertainty() -> str | None:
            for flow in ("B-02/flow/login", "B-01/flow/sweep"):
                w = want[flow]
                figure = figure_of(text_of(w["sid"]), flow) or ""
                for s in w["steps"]:
                    body = node_body(figure, f"flow-step:{s['claim_id']}")
                    rect = re.search(r"<rect\b[^>]*>", body)
                    tag = rect.group(0) if rect else ""
                    dash = re.search(r'stroke-dasharray="([^"]+)"', tag)
                    want_dash = DASH.get(str(s["epistemic_kind"]))
                    if (dash.group(1) if dash else None) != want_dash:
                        return f"{s['claim_key']} is {s['epistemic_kind']} and its box dashes {dash.group(1) if dash else 'nothing'}, not {want_dash}"
            return None

        check("an inference is dashed, a hypothesis or open question dotted, an observation solid", uncertainty)

        def absent_marks() -> str | None:
            def says(flow: str) -> bool:
                w = want[flow]
                figure = figure_of(text_of(w["sid"]), flow)
                text = account_of(figure) if figure else (sentence_of(text_of(w["sid"]), flow) or "")
                return NOT_RECORDED in text.lower()

            for flow in ("B-02/flow/audit", "B-02/flow/refresh", "B-01/flow/twelve"):
                if not says(flow):
                    return f"{flow} has no mark and no declination, and does not say {NOT_RECORDED!r}"
            for flow in ("B-02/flow/login", "B-01/flow/sweep"):
                if says(flow):
                    return f"{flow} records marks and says {NOT_RECORDED!r}"
            figure = figure_of(text_of("B-02"), "B-02/flow/readonly") or ""
            text = account_of(figure)
            if DECLINATION not in text:
                return f"the account of readonly does not print the declination's reason: {text[:300]!r}"
            if says("B-02/flow/readonly"):
                return f"readonly was declined and still says {NOT_RECORDED!r}"
            return None

        check("'marks not recorded' for a flow with neither marks nor a declination; a declination's reason otherwise", absent_marks)

        def account() -> str | None:
            for flow, w in want.items():
                if not w["figure"]:
                    continue
                figure = figure_of(text_of(w["sid"]), flow) or ""
                text = account_of(figure)
                if not text:
                    return f"{flow} has no account beside it"
                for s in w["steps"]:
                    if str(s["statement"]) not in text:
                        return f"{flow}: the account omits the statement of {s['claim_key']}"
                for m in w["marks"]:
                    if m["label"] and str(m["label"]) not in text:
                        return f"{flow}: the account omits mark {m['id']} ({m['label']!r})"
                    if m["kind"] == "crosses-seam" and m["target"] not in text:
                        return f"{flow}: the account omits the seam crossing {m['target']}"
                marked = {w["step_of"][str(m["claim_id"])] for m in w["marks"]}
                bare = len(w["steps"]) - len(marked)
                if not re.search(rf"\b{bare} of {len(w['steps'])} steps? (?:has|have) no recorded marks?\b", text):
                    return f"{flow}: the account does not count {bare} of {len(w['steps'])} steps as having no recorded mark: {text[:300]!r}"
                kinds = {m["kind"] for m in w["marks"]}
                for kind in kinds:
                    cannot = next(
                        str(v["cannot_justify"]) for v in diagrams.VOCABULARY["claim_mark_kind"]["values"] if v["value"] == kind
                    )
                    if cannot not in text:
                        return f"{flow}: the account does not quote what a {kind} cannot justify"
            figure = figure_of(text_of("B-02"), "B-02/flow/login") or ""
            text = account_of(figure)
            for needle in ("withdrawn by the survey", "an earlier reading"):
                if needle in text or needle in figure:
                    return f"a withdrawn mark or a closed claim ({needle!r}) is on the login strip"
            return None

        check("the account lists every step and mark, counts the steps with no mark, quotes what a mark cannot justify", account)

        def read_at() -> str | None:
            for flow, w in want.items():
                if not w["figure"]:
                    continue
                figure = figure_of(text_of(w["sid"]), flow) or ""
                said = re.search(r'<p class="diagram-read-at"[^>]*>(.*?)</p>', figure, re.S)
                if said is None or SHA not in plain(said.group(1)):
                    return f"{flow} does not print the revision it was read at ({SHA}): {plain(said.group(1)) if said else None!r}"
                for sha in sorted({str(m["ref_sha"])[:8] for m in w["marks"]}):
                    if sha not in plain(said.group(1)):
                        return f"{flow} does not print the revision {sha} a mark was recorded at: {plain(said.group(1))!r}"
                caption = figure.split("<svg", 1)[0]
                if flow.split("/")[-1] not in plain(caption):
                    return f"{flow}'s caption does not name the flow"
            return None

        check("each strip names its flow and prints the revision it was read at", read_at)

        def thresholds() -> str | None:
            db = sqlite3.connect(f"file:{store / 'memory.db'}?mode=ro", uri=True)
            db.row_factory = sqlite3.Row
            copy = sqlite3.connect(":memory:")
            copy.row_factory = sqlite3.Row
            try:
                db.backup(copy)
            finally:
                db.close()
            try:
                for count, drawn_expected, rows_expected in ((2, False, 0), (3, True, 1), (12, True, 1), (13, True, 2), (20, True, 2), (21, False, 0), (0, False, 0)):
                    copy.execute("DELETE FROM claims WHERE claim_key LIKE 'B-02/flow/probe/%'")
                    for n in range(count):
                        key = f"B-02/flow/probe/{n:02d}"
                        copy.execute(
                            "INSERT INTO claims (claim_id, claim_key, subject_type, subject_id, statement, epistemic_kind,"
                            " asserted_at_sha, valid_from_sha, session_id) VALUES (?,?,?,?,?,?,?,?,?)",
                            (key, key, "subsystem", "B-02", f"probe step {n}", "observation", SHA, SHA, "s1"),
                        )
                    model = diagrams.flow_strip_model(copy, "B-02/flow/probe")
                    if bool(model.nodes) != drawn_expected:
                        return f"{count} steps: {'a strip is drawn' if model.nodes else 'a sentence is printed'}, expected {'a strip' if drawn_expected else 'a sentence'}"
                    if not drawn_expected and not model.below.strip():
                        return f"{count} steps: no strip and no sentence"
                    if drawn_expected:
                        used = {n.row for n in model.nodes if n.record.startswith("flow-step:")}
                        if len(used) != rows_expected:
                            return f"{count} steps wrap onto {len(used)} row(s), expected {rows_expected}"
                    if count == 21 and not re.search(r"\b21 steps\b", model.below):
                        return f"the sentence for 21 steps does not count them: {model.below!r}"
                    if count == 2 and not re.search(r"\b2 steps\b", model.below):
                        return f"the sentence for 2 steps does not count them: {model.below!r}"
                    if count == 0 and "probe" not in model.below:
                        return f"a flow with no current step does not say so: {model.below!r}"
                return None
            finally:
                copy.close()

        check("two steps is a sentence, three a strip, twelve one row, thirteen two, twenty a strip, twenty-one a table", thresholds)

        def big_table() -> str | None:
            page = text_of("B-01")
            sentence = sentence_of(page, "B-01/flow/huge")
            if sentence is None or not re.search(r"\b22 steps\b", sentence) or "table" not in sentence.lower():
                return f"the sentence for the 22-step flow does not count its steps and point at a table: {sentence!r}"
            tail = page.split('data-subject="B-01/flow/huge"', 1)[1]
            tbl = re.search(r"<table\b.*?</table>", tail, re.S)
            if tbl is None:
                return "no table follows the sentence for the 22-step flow"
            body = re.findall(r"<tr\b.*?</tr>", tbl.group(0), re.S)
            data_rows = [plain(r) for r in body if "<td" in r]
            if len(data_rows) != 22:
                return f"the table has {len(data_rows)} rows for 22 steps"
            for n, text in enumerate(data_rows):
                expect = statement("B-01", "huge", f"{n:02d}")
                if not text.startswith(f"{n:02d}") and f" {n:02d} " not in f" {text} ":
                    return f"row {n} does not carry its step number: {text!r}"
                if expect not in text:
                    return f"row {n} does not carry its step's statement: {text!r}"
            return None

        check("more than twenty steps is a sentence and a numbered table of every step", big_table)

        def below_structural() -> str | None:
            sentence = sentence_of(text_of("F-01"), "F-01/flow/render")
            w = want["F-01/flow/render"]
            if w["figure"] or sentence is None:
                return "F-01 is only scoping and its flow draws a strip, or says nothing"
            shown = diagrams._DEPTH_LABELS.get("scoping", "Scoped")
            if "Structural" not in sentence or shown not in sentence or "F-01" not in sentence:
                return f"the sentence does not say F-01 is {shown} and a flow is drawn from Structural up: {sentence!r}"
            db = sqlite3.connect(f"file:{store / 'memory.db'}?mode=ro", uri=True)
            db.row_factory = sqlite3.Row
            copy = sqlite3.connect(":memory:")
            copy.row_factory = sqlite3.Row
            try:
                db.backup(copy)
            finally:
                db.close()
            try:
                for status, expect in (("unmapped", False), ("deferred", False), ("structural", True), ("concerns", True), ("adversarial", True), ("mapped", True)):
                    copy.execute("UPDATE subsystems SET status = ? WHERE id = 'F-01'", (status,))
                    model = diagrams.flow_strip_model(copy, "F-01/flow/render")
                    if bool(model.nodes) != expect:
                        return f"with F-01 at {status} its flow {'is' if model.nodes else 'is not'} drawn, expected {'drawn' if expect else 'a sentence'}"
            finally:
                copy.close()
            return None

        check("a flow is drawn from Structural up and said not to be below", below_structural)

        def sentences() -> str | None:
            refresh = sentence_of(text_of("B-02"), "B-02/flow/refresh") or ""
            for needle in ("refresh", "2 steps", "3"):
                if needle not in refresh:
                    return f"the sentence for the two-step flow omits {needle!r}: {refresh!r}"
            if NOT_RECORDED not in refresh.lower():
                return f"the sentence for a flow with no marks does not say {NOT_RECORDED!r}: {refresh!r}"
            return None

        check("a flow of fewer than three steps is a sentence that counts them", sentences)

        def sentence_provenance() -> str | None:
            # A sentence in place of a strip still says what it was read at (Appendix B rule 3).
            for flow in ("B-02/flow/refresh", "B-01/flow/huge", "F-01/flow/render"):
                said = sentence_of(text_of(flow.split("/", 1)[0]), flow)
                if said is None:
                    return f"{flow} has no sentence"
                if f"revision {SHA}" not in said:
                    return f"the sentence for {flow} does not print the revision it was read at ({SHA}): {said!r}"
            return None

        check("a flow drawn as a sentence prints the revision it was read at", sentence_provenance)

        def two_publications() -> str | None:
            storage2 = build_store(root / "a2")
            out2, why2 = publish(storage2)
            if out2 is None:
                return why2
            for sid in ("B-01", "B-02", "F-01"):
                one, two = text_of(sid), (out2 / page_of(sid)).read_text()
                if figures(one) != figures(two):
                    return f"the figures of two publications of {sid} differ"
            return None

        check("two publications of one store print the same figures", two_publications)

        def links_resolve() -> str | None:
            for flow, w in want.items():
                page = text_of(w["sid"])
                if not w["figure"]:
                    continue
                figure = figure_of(page, flow) or ""
                for href in re.findall(r'<a\b[^>]*href="([^"]+)"', figure):
                    path, _, fragment = href.partition("#")
                    target = (output / page_of(w["sid"])).parent / path if path else output / page_of(w["sid"])
                    if not target.resolve().is_file():
                        return f"a link of {flow} goes to {href}, which is not a page"
                    if fragment and f'id="{fragment}"' not in target.read_text():
                        return f"a link of {flow} goes to {href}, and no anchor {fragment} is there"
                links = len(re.findall(r'<a\b[^>]*href="', figure))
                boxes = len(drawn(figure)[0])
                if links < boxes:
                    return f"{flow} draws {boxes} boxes and {links} links: a box is not reachable from the keyboard"
                for line_id in re.findall(r'<li id="([^"]+)"', figure):
                    if page.count(f'id="{line_id}"') != 1:
                        return f"the account item {line_id} is not unique on the page"
            return None

        check("every box links an anchor that exists, and account anchors are unique", links_resolve)

        def marks_linked() -> str | None:
            for flow, w in want.items():
                if w["figure"] and (fault := unlinked_marks(figure_of(text_of(w["sid"]), flow) or "")) is not None:
                    return f"{flow}: {fault}"
            return None

        check("every arrow and every box of a strip is a link", marks_linked)

        # -- sabotage, resealed ----------------------------------------------
        def sabotage(label: str, sid: str, edit: Callable[[str], str], axis: str, object_type: str, object_id: str) -> None:
            def run() -> str | None:
                copy = root / "sabotage"
                if copy.exists():
                    shutil.rmtree(copy)
                shutil.copytree(output, copy)
                rel = page_of(sid)
                target = copy / rel
                before = target.read_text()
                after = edit(before)
                if after == before:
                    return f"the edit found nothing to change on {rel}"
                target.write_text(after)
                reseal(copy, rel)
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

        login = want["B-02/flow/login"]
        a_step, b_step = (str(s["claim_id"]) for s in login["steps"][1:3])
        a_mark = str(next(m["id"] for m in login["drawn_marks"] if m["kind"] == "crash-point"))
        sabotage("a step's box removed", "B-02", first(rf'<g\b[^>]*data-node="flow-step:{re.escape(a_step)}"[^>]*>.*?</g>', lambda m: ""),
                 "content", f"{KIND}-diagram-node", f"flow-step:{a_step}")
        sabotage("a step's box re-pointed to another step", "B-02", lambda t: t.replace(f'data-node="flow-step:{a_step}"', f'data-node="flow-step:{b_step}"', 1),
                 "content", f"{KIND}-diagram-node", "flow-step:")
        sabotage("a mark removed", "B-02", first(rf'<g\b[^>]*data-node="flow-mark:{a_mark}"[^>]*>.*?</g>', lambda m: ""),
                 "content", f"{KIND}-diagram-node", f"flow-mark:{a_mark}")
        sabotage("an arrow removed", "B-02", first(rf'<path\b[^>]*data-edge="flow-next:{re.escape(a_step)}:[^"]*"[^>]*/>', lambda m: ""),
                 "content", f"{KIND}-diagram-edge", f"flow-next:{a_step}")
        sabotage("an arrow added that no records join", "B-02", lambda t: t.replace(
            "</svg>", '<path data-edge="flow-next:invented:invented" d="M 10 10 L 90 10" fill="none" stroke="var(--accent)"/></svg>', 1),
                 "content", f"{KIND}-diagram-edge", "flow-next:invented")
        sabotage("the login figure removed", "B-02", first(rf'<figure\b[^>]*data-diagram="{KIND}"[^>]*data-subject="B-02/flow/login"[^>]*>.*?</figure>', lambda m: ""),
                 "coverage", f"{KIND}-diagram", "B-02/flow/login")
        sabotage("a figure drawn for the flow that is a sentence", "B-02", lambda t: t.replace(
            "</section>", f'<figure class="diagram" data-diagram="{KIND}" data-subject="B-02/flow/refresh"><svg></svg></figure></section>', 1),
                 "coverage", f"{KIND}-diagram", "B-02/flow/refresh")

    with tempfile.TemporaryDirectory(prefix="amanuensis-so25-golden-") as tmp:
        previous = start_corpus(Path(tmp))
        check("the golden corpus is SO25's and differs from the start's only where this packet adds",
              lambda: golden_additions_only(previous))

    def in_ci() -> str | None:
        try:
            text = CI_FILE.read_text()
        except OSError as exc:
            return f"test.yml cannot be read: {exc}"
        return None if "test-store-only-flow-strip.py" in text else "test.yml has no step for this gate"

    check("the gate is a step in test.yml", in_ci)

    if FAILURES:
        emit(f"GATE SO25 RED: {len(FAILURES)} check(s) failed; first: {FAILURES[0]}")
        return 1
    emit("GATE SO25 GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
