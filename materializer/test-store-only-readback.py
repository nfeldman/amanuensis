#!/usr/bin/env python3
"""Gate for store-only packet SO20 — the read-back checks the HTML against the store
(design/store-only/PLAN.md §3.5, §8 SO20).

The golden `materializer` store is rebuilt from its recorded SQL, given a
narrative and an imported survey body on B-01, and published. Every rendered
record then carries `data-record="<type>:<id>"` (and `data-state` where a state
is printed), and every drawn node and edge of the two architecture SVGs carries
`data-node` or `data-edge`. The read-back recomputes those from the store. Each
sabotage below edits one page and then reseals `.projection-contract.json` for
the edited bytes, so the hash check cannot be what turns it red.

Turns red when:
  - `readback.py` or the materializer cannot be loaded, or the fixture cannot be
    published;
  - an unsabotaged publication does not read back green on all three axes;
  - a rendered finding, subsystem, seam, narrative, imported body, runtime
    boundary, claim, concern disposition, explanation or territory disposition does
    not carry its `data-record` mark, or its `data-state` is not the store's value;
  - a drawn edge of the runtime SVG, or a node or edge of the boundary SVG, does
    not carry `data-edge` / `data-node` naming its record;
  - any sabotage is not reported on its axis with its `object_type` and id, or is
    reported only as a hash drift:
      * a finding's printed state changed (its chip and its mark together, its
        chip alone, and the chip's words alone): state axis, `finding`;
      * a subsystem depth label changed: state axis, `subsystem`;
      * a narrative body altered: content axis, `narrative`;
      * an imported body truncated: content axis, `imported-body`;
      * a record removed from its page (a seam), and a finding printed twice:
        coverage axis, `seam` / `finding`;
      * an edge added to the runtime SVG (one naming a real boundary, one naming
        none): content axis, `runtime-diagram-edge`;
      * a node removed from the boundary SVG: content axis, `boundary-diagram-node`;
      * beyond the plan's table, one per record type it adds: a disposition's
        verdict re-marked (state, `disposition`), a claim removed (coverage,
        `claim`), an explanation altered (content, `explanation`), a territory row
        re-marked (state, `territory`), and a mark naming a record the store does
        not hold (coverage);
  - the golden corpus's `VERSION` is not SO20 or a later packet the update rule names
    (SO22–SO25, which add `<figure data-diagram>` blocks), or a golden page differs
    from the corpus this packet started from by anything but `data-record`,
    `data-state`, `data-node` and `data-edge` attributes and those figure blocks, or
    no golden page gained one;
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
from typing import Any

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
GOLDEN = ROOT / "fixtures" / "store-only-golden"
GOLDEN_REL = "materializer/fixtures/store-only-golden"
CI_FILE = REPO / ".github" / "workflows" / "test.yml"
PACKET = "SO20"
# The commit this packet started from: its golden corpus is the reference.
START_SHA = "29eb0798b4b90d9e9081da226c93536e8e92d47f"

NARRATIVE_BODY = (
    "The scheduler takes a job from the queue, checks the caller with the auth"
    " service and then starts it.\n\nA job that fails its check is put back on the"
    " queue with its attempt count raised."
)
EXPLANATION_BODY = (
    "The auth service decides whether a caller may run a job, and keeps the policy it"
    " decides by."
)
SURVEY_PATH = "subsystems/B-01-structural.md"
SURVEY_BODY = (
    "## Overview\n\nThe scheduler owns the job queue and the dispatch loop.\n\n"
    "## Dispatch\n\nEach tick reads one job, checks it and hands it to a worker.\n\n"
    "- The queue is read in order.\n- A failed check requeues the job.\n"
)

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
# The fixture store and its publication.
# ---------------------------------------------------------------------------


def build_store(root: Path) -> tuple[Path, dict[str, Any]]:
    """The golden `materializer` store with a narrative and an imported survey body on B-01."""

    storage = root / "storage"
    storage.mkdir(parents=True)
    (storage / "workspace_path").write_text("/example/FictionalProject\n")
    db = sqlite3.connect(storage / "memory.db")
    try:
        db.executescript((GOLDEN / "materializer" / "memory.sql").read_text())
        cur = db.cursor()
        cur.execute(
            "INSERT INTO narratives (subject_type, subject_id, section, topic, disposition,"
            " body, ref_sha, session_id, recorded_at) VALUES ('subsystem', 'B-01', 'structure',"
            " 'Dispatch loop', 'recorded', ?, 'deadbeef', 's1', '2026-11-20 10:00:00')",
            (NARRATIVE_BODY,),
        )
        narrative_id = cur.lastrowid
        cur.execute(
            "INSERT INTO imported_artifacts (path, kind, subsystem_id, body, body_sha256,"
            " registered_hash, hash_matches, registered_ref_sha, written_at, session_id)"
            " VALUES (?, 'subsystem-survey', 'B-01', ?, ?, ?, 1, 'deadbeef', '2026-11-19T09:00:00Z', 's1')",
            (
                SURVEY_PATH,
                SURVEY_BODY,
                hashlib.sha256(SURVEY_BODY.encode()).hexdigest(),
                hashlib.sha256(SURVEY_BODY.encode()).hexdigest(),
            ),
        )
        cur.execute(
            "INSERT INTO claims (claim_id, claim_key, subject_type, subject_id, statement,"
            " epistemic_kind, asserted_at_sha, valid_from_sha, session_id)"
            " VALUES ('B-02-token-check', 'B-02/flow/token-check', 'subsystem', 'B-02',"
            " 'The gateway checks every token before it reaches the policy store.', 'observation',"
            " 'deadbeef', 'deadbeef', 's1')"
        )
        cur.execute(
            "INSERT INTO explanations (subject_type, subject_id, slot, disposition, body,"
            " ref_sha, session_id, recorded_at) VALUES ('subsystem', 'B-02', 'purpose', 'recorded', ?,"
            " 'deadbeef', 's1', '2026-11-20 10:00:00')",
            (EXPLANATION_BODY,),
        )
        explanation_id = cur.lastrowid
        cur.execute(
            "INSERT INTO territory_dispositions (territory, disposition, condition, ref_sha, session_id)"
            " VALUES ('T2', 'disqualified', 'The service holds no cache between requests.', 'deadbeef', 's1')"
        )
        db.commit()
        facts = {
            "explanation_id": explanation_id,
            "dispositions": {
                f"{r[0]}:{r[1]}": str(r[2])
                for r in db.execute("SELECT subsystem_id, concern_code, classification FROM dispositions")
            },
            "narrative_id": narrative_id,
            "findings": {
                str(r[0]): str(r[1])
                for r in db.execute("SELECT finding_id, resolution_state FROM finding_state_current")
            },
            "subsystems": {str(r[0]): str(r[1]) for r in db.execute("SELECT id, status FROM subsystems")},
            "seams": [str(r[0]) for r in db.execute("SELECT id FROM seams ORDER BY id")],
            "runtime": [
                (int(r[0]), str(r[1]), str(r[2]))
                for r in db.execute(
                    "SELECT id, from_runtime, to_runtime FROM runtime_boundaries WHERE withdrawn = 0 ORDER BY id"
                )
            ],
        }
    finally:
        db.close()
    return storage, facts


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


def element(text: str, tag: str, attr: str) -> re.Match[str] | None:
    """The first `<tag …attr…>…</tag>` (no nesting of the same tag inside), as a match."""

    return re.search(rf"<{tag}\b[^>]*{re.escape(attr)}[^>]*>.*?</{tag}>", text, re.S)


def start_tags(text: str, attr: str) -> list[str]:
    return re.findall(rf"<[a-zA-Z][^>]*{re.escape(attr)}[^>]*>", text)


# ---------------------------------------------------------------------------
# The sabotage table.
# ---------------------------------------------------------------------------


def _finding_state(page: str, fid: str, *, mark_too: bool) -> Callable[[str], str]:
    def edit(text: str) -> str:
        found = element(text, "article", f'data-record="finding:{fid}"')
        if found is None:
            return text
        chunk = found.group(0)
        changed = re.sub(
            r'(<span class="status[^"]*?) status-[a-z-]+(")([^>]*>)[^<]*(</span>)',
            r"\1 status-fixed-pending-verification\2\3Fixed, pending verification\4",
            chunk,
            count=1,
        )
        if mark_too:
            changed = re.sub(r'data-state="[^"]*"', 'data-state="fixed-pending-verification"', changed, count=1)
        return text.replace(chunk, changed)

    return edit


def _chip_words(fid: str) -> Callable[[str], str]:
    """Only the chip's visible words, its class and the record's mark left as they were."""

    def edit(text: str) -> str:
        found = element(text, "article", f'data-record="finding:{fid}"')
        if found is None:
            return text
        chunk = found.group(0)
        changed = re.sub(r'(<span class="status[^"]*"[^>]*>)[^<]*(</span>)', r"\1Verified fixed\2", chunk, count=1)
        return text.replace(chunk, changed)

    return edit


def _depth_label(sid: str) -> Callable[[str], str]:
    def edit(text: str) -> str:
        found = element(text, "li", f'data-record="subsystem:{sid}"')
        if found is None:
            return text
        chunk = found.group(0)
        changed = re.sub(
            r'(<span class="status[^"]*?) status-[a-z-]+(")([^>]*>)[^<]*(</span>)',
            r"\1 status-mapped\2\3Mapped\4",
            chunk,
            count=1,
        )
        changed = re.sub(r'data-state="[^"]*"', 'data-state="mapped"', changed, count=1)
        return text.replace(chunk, changed)

    return edit


def _narrative_altered(narrative_id: int) -> Callable[[str], str]:
    def edit(text: str) -> str:
        found = element(text, "p", f'data-record="narrative:{narrative_id}"')
        if found is None:
            return text
        chunk = found.group(0)
        return text.replace(chunk, chunk.replace("checks the caller", "skips the caller"))

    return edit


def _imported_truncated(text: str) -> str:
    marks = list(re.finditer(rf'<(ul|p|h\d)\b[^>]*data-record="imported-body:{re.escape(SURVEY_PATH)}"[^>]*>.*?</\1>', text, re.S))
    if not marks:
        return text
    last = marks[-1]
    return text[: last.start()] + text[last.end():]


def _seam_removed(text: str) -> str:
    found = element(text, "article", 'data-record="seam:SM-01"')
    return text if found is None else text.replace(found.group(0), "")


def _finding_twice(fid: str) -> Callable[[str], str]:
    def edit(text: str) -> str:
        found = element(text, "article", f'data-record="finding:{fid}"')
        return text if found is None else text.replace(found.group(0), found.group(0) * 2, 1)

    return edit


def _runtime_edge_added(record: str | None) -> Callable[[str], str]:
    def edit(text: str) -> str:
        mark = f' data-edge="{record}"' if record else ""
        line = f'<line class="runtime-svg-edge" x1="268" y1="90" x2="692" y2="140"{mark}/>'
        return text.replace("</svg>", line + "</svg>", 1) if 'class="runtime-boundary-svg"' in text else text

    return edit


def _boundary_node_removed(sid: str) -> Callable[[str], str]:
    def edit(text: str) -> str:
        found = re.search(rf'<g class="boundary-svg-node"[^>]*data-node="subsystem:{re.escape(sid)}"[^>]*>.*?</g>', text, re.S)
        return text if found is None else text.replace(found.group(0), "")

    return edit


def _remark(tag: str, record: str, state: str) -> Callable[[str], str]:
    def edit(text: str) -> str:
        found = re.search(rf'<{tag}\b[^>]*data-record="{re.escape(record)}"[^>]*>', text)
        if found is None:
            return text
        return text.replace(found.group(0), re.sub(r'data-state="[^"]*"', f'data-state="{state}"', found.group(0)), 1)

    return edit


def _claim_removed(text: str) -> str:
    found = re.search(r'<li data-record="claim:B-02-token-check">.*?</ul></li>', text, re.S)
    return text if found is None else text.replace(found.group(0), "")


def _explanation_altered(explanation_id: int) -> Callable[[str], str]:
    def edit(text: str) -> str:
        found = element(text, "p", f'data-record="explanation:{explanation_id}"')
        return text if found is None else text.replace(found.group(0), found.group(0).replace("may run a job", "may run any job"))

    return edit


def _unheld_mark(text: str) -> str:
    return text.replace('data-record="seam:SM-01"', 'data-record="seam:SM-99"', 1)


def sabotages(facts: dict[str, Any]) -> list[tuple[str, str, Callable[[str], str], str, str, str]]:
    """(label, page, edit, axis, object_type, object_id)."""

    open_finding = next(fid for fid, state in sorted(facts["findings"].items()) if state == "open")
    shallow = next(sid for sid, status in sorted(facts["subsystems"].items()) if status != "mapped")
    first_runtime = facts["runtime"][0][0]
    disposition = sorted(facts["dispositions"])[0]
    disposition_page = {"B-01": "b01-job-scheduler.html", "B-02": "b02-auth-service.html", "F-01": "f01-web-ui.html"}[disposition.split(":")[0]]
    return [
        ("a finding's printed state changed with its mark", "findings.html",
         _finding_state("findings.html", open_finding, mark_too=True), "state", "finding", open_finding),
        ("a finding's printed state changed under its mark", "findings.html",
         _finding_state("findings.html", open_finding, mark_too=False), "state", "finding", open_finding),
        ("a finding's chip words changed alone", "findings.html", _chip_words(open_finding), "state", "finding", open_finding),
        ("a subsystem depth label changed", "master-plan.html", _depth_label(shallow), "state", "subsystem", shallow),
        ("a narrative body altered", "subsystems/b01-job-scheduler.html",
         _narrative_altered(facts["narrative_id"]), "content", "narrative", str(facts["narrative_id"])),
        ("an imported body truncated", "subsystems/b01-job-scheduler.html",
         _imported_truncated, "content", "imported-body", SURVEY_PATH),
        ("a record removed from its page", "seams.html", _seam_removed, "coverage", "seam", "SM-01"),
        ("a finding printed twice", "findings.html", _finding_twice(open_finding), "coverage", "finding", open_finding),
        ("an edge added to the runtime SVG for a real boundary", "architecture.html",
         _runtime_edge_added(f"runtime-boundary:{first_runtime}"), "content", "runtime-diagram-edge",
         f"runtime-boundary:{first_runtime}"),
        ("an edge no record joins added to the runtime SVG", "architecture.html",
         _runtime_edge_added(None), "content", "runtime-diagram-edge", ""),
        ("a node removed from the boundary SVG", "architecture.html", _boundary_node_removed("F-01"),
         "content", "boundary-diagram-node", "subsystem:F-01"),
        ("a disposition's verdict re-marked", f"subsystems/{disposition_page}",
         _remark("article", f"disposition:{disposition}", "ruled-out" if facts["dispositions"][disposition] != "ruled-out" else "out-of-scope"),
         "state", "disposition", disposition),
        ("a claim removed from its page", "subsystems/b02-auth-service.html", _claim_removed, "coverage", "claim", "B-02-token-check"),
        ("an explanation altered", "subsystems/b02-auth-service.html", _explanation_altered(facts["explanation_id"]),
         "content", "explanation", str(facts["explanation_id"])),
        ("a territory row re-marked", "concern-checklist.html", _remark("tr", "territory:T2", "applies"), "state", "territory", "T2"),
        ("a mark naming a record the store does not hold", "seams.html", _unheld_mark, "coverage", "seam", "SM-99"),
    ]


# ---------------------------------------------------------------------------
# The golden corpus.
# ---------------------------------------------------------------------------

MARK_ATTRIBUTE = re.compile(r' data-(?:record|state|node|edge)="[^"]*"')
# Packets SO22–SO25 add diagrams to the corpus (PLAN §3.2's update rule); a figure is
# their whole addition, so a page is compared without them.
FIGURE_BLOCK = re.compile(
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
EMPTY_FLOW = re.compile(r'<div class="prose-flow">\s*</div>\n?')
CORPUS_VERSIONS = ("SO20", "SO22", "SO23", "SO24", "SO25")


def start_corpus(into: Path) -> Path | None:
    archive = subprocess.run(["git", "-C", str(REPO), "archive", START_SHA, GOLDEN_REL], capture_output=True)
    if archive.returncode != 0 or not archive.stdout:
        return None
    tar = into / "start.tar"
    tar.write_bytes(archive.stdout)
    unpacked = subprocess.run(["tar", "-xf", str(tar), "-C", str(into)], capture_output=True)
    corpus = into / GOLDEN_REL
    return corpus if unpacked.returncode == 0 and corpus.is_dir() else None


def golden_attributes_only(previous: Path | None) -> str | None:
    version = GOLDEN / "VERSION"
    if not version.is_file() or version.read_text().strip() not in CORPUS_VERSIONS:
        return f"the golden corpus's VERSION is {version.read_text().strip() if version.is_file() else 'absent'!r}, not one of {CORPUS_VERSIONS}"
    if previous is None:
        return f"the golden corpus cannot be read from git at {START_SHA[:12]}"
    before = {str(p.relative_to(previous)): p for p in previous.rglob("*.html") if "/html/" in str(p)}
    after = {str(p.relative_to(GOLDEN)): p for p in GOLDEN.rglob("*.html") if "/html/" in str(p)}
    if sorted(before) != sorted(after):
        return f"the corpus holds {len(after)} HTML pages for the start's {len(before)}"
    marked = 0
    for rel in sorted(after):
        new, old = EMPTY_FLOW.sub("", FIGURE_BLOCK.sub("", after[rel].read_text())), before[rel].read_text()
        if MARK_ATTRIBUTE.sub("", new) != old:
            return f"{rel} differs from the start's corpus by more than the record attributes"
        if new != old:
            marked += 1
    for asset in (previous / "assets").iterdir():
        if not (GOLDEN / "assets" / asset.name).is_file():
            return f"the folded asset {asset.name[:12]} changed"
    return None if marked >= 10 else f"only {marked} golden pages gained a record attribute"


# ---------------------------------------------------------------------------


def main() -> int:
    readback, error = load("readback")
    core, error2 = load("core")
    if readback is None or core is None:
        emit(f"GATE SO20 RED: {error or error2}")
        return 1

    with tempfile.TemporaryDirectory(prefix="amanuensis-so20-") as tmp:
        root = Path(tmp)
        storage, facts = build_store(root)
        output, why = publish(storage)
        if output is None:
            emit(f"GATE SO20 RED: {why}")
            return 1

        def green() -> str | None:
            summary = verify(core, storage, output)
            if summary.get("ok"):
                return None
            first = (summary.get("mismatches") or [{}])[0]
            return f"{summary.get('mismatch_count')} mismatch(es), first {first}"

        check("an unsabotaged publication reads back green", green)

        def finding_marks() -> str | None:
            for fid, state in facts["findings"].items():
                page = "findings.html" if state in ("open", "fixed-pending-verification") else "resolved-findings.html"
                tags = start_tags((output / page).read_text(), f'data-record="finding:{fid}"')
                if not tags:
                    return f"{page} carries no data-record for finding {fid}"
                if any(f'data-state="{state}"' not in tag for tag in tags):
                    return f"finding {fid} is not marked with its state {state!r}: {tags[0][:160]}"
            return None

        check("each finding carries its record mark and the store's state", finding_marks)

        def subsystem_marks() -> str | None:
            text = (output / "master-plan.html").read_text()
            for sid, status in facts["subsystems"].items():
                tags = start_tags(text, f'data-record="subsystem:{sid}"')
                if len(tags) != 2:
                    return f"master-plan.html marks {sid} {len(tags)} times, not in its atlas item and its record"
                if any(f'data-state="{status}"' not in tag for tag in tags):
                    return f"{sid} is not marked with its depth {status!r}"
            return None

        check("each subsystem's atlas item and record carry its mark and depth", subsystem_marks)

        def seam_and_prose_marks() -> str | None:
            seams = (output / "seams.html").read_text()
            for seam in facts["seams"]:
                if len(start_tags(seams, f'data-record="seam:{seam}"')) != 1:
                    return f"seams.html does not mark seam {seam} once"
            page = (output / "subsystems" / "b01-job-scheduler.html").read_text()
            narrative = start_tags(page, f'data-record="narrative:{facts["narrative_id"]}"')
            if not narrative or any('data-state="recorded"' not in tag for tag in narrative):
                return "the narrative's body is not marked with its record and its disposition"
            if len(start_tags(page, f'data-record="imported-body:{SURVEY_PATH}"')) < 3:
                return "the imported survey body's blocks are not marked"
            return None

        check("seams, narratives and imported bodies carry their marks", seam_and_prose_marks)

        def other_marks() -> str | None:
            page = (output / "subsystems" / "b02-auth-service.html").read_text()
            if len(start_tags(page, 'data-record="claim:B-02-token-check"')) != 1:
                return "the claim on B-02 is not marked once on its page"
            explanation = start_tags(page, f'data-record="explanation:{facts["explanation_id"]}"')
            if not explanation or any('data-state="recorded"' not in tag for tag in explanation):
                return "B-02's purpose is not marked with its row and its state"
            for key, verdict in facts["dispositions"].items():
                sid = key.split(":")[0]
                name = {"B-01": "b01-job-scheduler", "B-02": "b02-auth-service", "F-01": "f01-web-ui"}[sid]
                tags = start_tags((output / "subsystems" / f"{name}.html").read_text(), f'data-record="disposition:{key}"')
                if len(tags) != 1 or f'data-state="{verdict}"' not in tags[0]:
                    return f"disposition {key} is not marked once with its verdict {verdict!r}"
            checklist = (output / "concern-checklist.html").read_text()
            tags = start_tags(checklist, 'data-record="territory:T2"')
            if len(tags) != 1 or 'data-state="disqualified"' not in tags[0]:
                return "territory T2 is not marked once with its disposition"
            return None

        check("claims, dispositions, explanations and territories carry their marks", other_marks)

        def diagram_marks() -> str | None:
            text = (output / "architecture.html").read_text()
            runtime = re.search(r'<svg class="runtime-boundary-svg".*?</svg>', text, re.S)
            boundary = re.search(r'<svg class="boundary-svg".*?</svg>', text, re.S)
            if runtime is None or boundary is None:
                return "architecture.html lacks the runtime or the boundary SVG"
            for row_id, from_runtime, to_runtime in facts["runtime"]:
                if len(re.findall(rf'<line[^>]*data-edge="runtime-boundary:{row_id}"', runtime.group(0))) != 1:
                    return f"the runtime SVG does not draw boundary {row_id} as one marked edge"
                for name in (from_runtime, to_runtime):
                    if f'data-node="runtime:{name}"' not in runtime.group(0):
                        return f"the runtime SVG has no node marked runtime:{name}"
            if re.search(r"<line(?![^>]*data-edge=)[^>]*>", runtime.group(0) + boundary.group(0)):
                return "an SVG draws a line with no data-edge"
            for sid in facts["subsystems"]:
                if len(re.findall(rf'<g class="boundary-svg-node"[^>]*data-node="subsystem:{sid}"', boundary.group(0))) != 1:
                    return f"the boundary SVG does not draw {sid} as one marked node"
            for seam in facts["seams"]:
                if f'data-edge="seam:{seam}"' not in boundary.group(0):
                    return f"the boundary SVG draws seam {seam} with no mark"
            return None

        check("every drawn node and edge carries its record", diagram_marks)

        for label, page, edit, axis, object_type, object_id in sabotages(facts):

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

    with tempfile.TemporaryDirectory(prefix="amanuensis-so20-golden-") as tmp:
        previous = start_corpus(Path(tmp))
        check("the golden corpus is SO20's or a later diagram packet's and differs from the start's only in record attributes and diagram figures",
              lambda: golden_attributes_only(previous))

    def in_ci() -> str | None:
        try:
            text = CI_FILE.read_text()
        except OSError:
            return "the CI workflow cannot be read"
        return None if "test-store-only-readback.py" in text else "the gate has no step in test.yml"

    check("the gate runs in CI", in_ci)

    if FAILURES:
        emit(f"GATE SO20 RED: {FAILURES[0][:300]}")
        return 1
    emit("GATE SO20 GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
