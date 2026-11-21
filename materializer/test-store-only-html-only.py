#!/usr/bin/env python3
"""Gate for store-only packet SO13 — HTML is the only output
(design/store-only/PLAN.md §3.2 step 3, §3.5, §6, §8 SO13).

The run builds each page as a model, resolves cross-references on it, and writes HTML,
`search-index.js` and the two contract files. Nothing else. (When it was written the
run held each page's Markdown in memory and parsed it; SO19 deleted that parser.)

Turns red when:

  - a publish (in place or clean) writes any `.md` file;
  - a publish over a previous output that holds `.md` pages beside their
    `.html` twins, with the pre-SO13 manifest claiming them, leaves a claimed
    `.md` behind (in place, and through a clean publish);
  - a clean publish over an output holding an unmanaged `.md` (one no manifest
    claims, including one named like a page after an HTML-only publication) is
    not refused, or the refusal changes the output;
  - the publication receipt (`.projection-contract.json`) or the manifest's
    projection files list a `.md`, or lack `index.html` or `search-index.js`;
  - the read-back is not green on all three axes for a fresh publication, as
    the render reports it and as `--readback-only` reports it;
  - a finding's HTML marker removed from its page, or duplicated onto another
    page, with the receipt resealed for the edited bytes, does not turn the
    state axis red (an unedited, resealed control must stay green);
  - cross-references are not resolved: the imported entry point's bare B-01
    and SM-01 are not linked, or B-01's name is not printed beside it;
  - the reader's guide still mentions a Markdown view, or a page carries the
    command-line render notice anywhere but its page head;
  - any local link in any page (or in the golden corpus) targets a `.md`;
  - the golden corpus's `VERSION` is not SO13 (or SO20, which only adds the
    record attributes of §3.5; they are removed before comparing), it holds a
    different page set, or its HTML differs from SO11's anywhere but the removed Markdown links, the
    guide's views paragraph, and the clock and commit values a re-seeded store
    carries (PLAN §3.2's update rule), or one of those values differs where the
    fixture's recorded inputs still hold the old one, for a value of another kind,
    or not one-to-one across the fixture's pages;
  - the gate does not run in CI.

Retired by SO19: the check that SO11's recorded Markdown inputs, printed through the HTML
stage, equal SO11's golden HTML but for the two Markdown links. It needed the parser. What
it carried is held by `test-store-only-model.py` and `test-store-only-no-markdown.py` (the
four store fixtures rebuilt and published equal today's golden HTML) and by the golden
check below (today's golden HTML equals SO11's but for the removed links).

False green it cannot exclude: the sabotage covers the finding marker census
only; the other censuses are exercised by their own suites, which run on HTML
alone after this packet.

Output protocol: exactly one status line, last, on stdout. Every subprocess is
captured and never echoed, and every message is scrubbed, so a missing
deliverable reports as an assertion failure and not as a crash.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from collections.abc import Callable
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
GOLDEN = ROOT / "fixtures" / "store-only-golden"
CI_FILE = REPO / ".github" / "workflows" / "test.yml"
PACKET = "SO13"
# Later writers of the corpus under PLAN §3.2's rule whose changes this gate can
# remove: SO20 adds only `data-record`, `data-state`, `data-node` and `data-edge`.
LATER_WRITERS = {"SO20": re.compile(r' data-(?:record|state|node|edge)="[^"]*"')}
# The commit this packet started from; its golden corpus is the one SO11 wrote.
START_SHA = "67db121aea4482be8fbfaa3990d47f67c3557fa9"
GOLDEN_FIXTURES = ("materializer", "materializer-github", "lens", "axiomdb-shaped", "self-shaped", "hooks")

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
    ("Traceback (most recent call last)", "stack trace"),
    ("ENOENT", "PATH-ABSENT"),
    ("is not defined", "is undeclared"),
    ("command not found", "executable is absent"),
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


# ---------------------------------------------------------------------------
# Fixture: the store `test-materializer.py` seeds, with the onboarding imports
# `make-golden.py` adds, so every page family and an open finding are present.
# ---------------------------------------------------------------------------
def _load_script(name: str) -> Any:
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), ROOT / f"{name}.py")
    if spec is None or spec.loader is None:
        raise RuntimeError(f"{name}.py cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def seed_store(storage: Path) -> None:
    sys.path.insert(0, str(ROOT))
    golden = _load_script("make-golden")
    fixture = _load_script("test-materializer")
    from store_only_seed import import_onboarding  # noqa: PLC0415

    storage.mkdir(parents=True, exist_ok=True)
    (storage / "workspace_path").write_text("/example/FictionalProject\n")
    db = sqlite3.connect(storage / "memory.db")
    fixture.seed(db)
    import_onboarding(
        db,
        session_id="s1",
        entry_point=golden.MATERIALIZER_ENTRY_POINT,
        onboarding_report=golden.MATERIALIZER_ONBOARDING,
        concern_checklist=golden.MATERIALIZER_CHECKLIST,
        ref_sha="deadbeef",
    )
    db.commit()
    db.close()


def materialize(storage: Path, *args: str) -> tuple[int, dict[str, Any]]:
    proc = subprocess.run(
        [sys.executable, str(ROOT / "materialize.py"), "--storage", str(storage), *args],
        capture_output=True,
        text=True,
        cwd=ROOT,
    )
    lines = [line for line in proc.stdout.splitlines() if line.strip()]
    try:
        summary = json.loads(lines[-1]) if lines else {}
    except json.JSONDecodeError:
        summary = {"unparsed": lines[-1][:300]}
    if not lines:
        summary = {"stderr": scrub(proc.stderr[-300:])}
    return proc.returncode, summary


def files_under(root: Path) -> list[str]:
    return sorted(str(p.relative_to(root)) for p in root.rglob("*") if p.is_file())


# The one `.md` a publication holds (PLAN §6, D10, SO21): a README that points at index.html.
README = "README.md"


def md_files(root: Path) -> list[str]:
    return [rel for rel in files_under(root) if rel.endswith(".md") and rel != README]


def axes_green(summary: dict[str, Any] | None) -> str | None:
    if not isinstance(summary, dict):
        return "no read-back summary"
    axes = summary.get("axes") or {}
    red = [axis for axis in ("state", "coverage", "content") if not (axes.get(axis) or {}).get("ok")]
    if red or not summary.get("ok"):
        first = (summary.get("mismatches") or [{}])[0]
        return f"axes not green: {red or 'summary not ok'}; first mismatch {json.dumps(first)[:240]}"
    return None


def reseal(docs: Path) -> None:
    """Rewrite the receipt's hashes for the bytes on disk, so the hash check cannot turn a sabotage red."""

    path = docs / ".projection-contract.json"
    contract = json.loads(path.read_text())
    for page in contract.get("pages", []):
        target = docs / str(page["path"])
        if target.is_file():
            page["content_hash"] = hashlib.sha256(target.read_bytes()).hexdigest()
    path.write_text(json.dumps(contract, indent=2) + "\n")


class Links(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.hrefs: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        for name, value in attrs:
            if name in ("href", "src") and value:
                self.hrefs.append(value)


def md_targets(html_text: str) -> list[str]:
    parser = Links()
    parser.feed(html_text)
    return [
        href
        for href in parser.hrefs
        if not re.match(r"^[a-z][a-z0-9+.-]*:", href, re.I)
        and re.search(r"\.md(?:$|[#?])", href, re.I)
    ]


def visible_text(html_text: str) -> str:
    body = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", html_text)
    body = re.sub(r"<[^>]+>", " ", body)
    return " ".join(body.split())


def legacy_output(docs: Path) -> list[str]:
    """Turn an HTML-only publication into what a pre-SO13 run leaves: each page's
    `.md` beside its `.html`, and a manifest in the base tree's format claiming
    them. Returns the `.md` paths written."""

    manifest = json.loads((docs / ".manifest.json").read_text())
    written: list[str] = []
    pages = []
    for rel in files_under(docs):
        if not rel.endswith(".html"):
            continue
        md = rel[: -len(".html")] + ".md"
        (docs / md).write_text(f"# {md}\n\nWritten by an earlier version.\n")
        written.append(md)
        pages.append({"path": md, "sources": {}, "content_hash": "", "rendered_at": "2026-11-01T00:00:00Z"})
    legacy = {
        "version": "0.6.0",
        "generated_at": "2026-11-01T00:00:00Z",
        "pages": pages,
        "projection_files": manifest.get("projection_files", []),
    }
    (docs / ".manifest.json").write_text(json.dumps(legacy, indent=2))
    return written


# ---------------------------------------------------------------------------
# What the golden corpus may differ in from SO11's (PLAN §3.2's update rule):
# the two links to a page's Markdown, and the guide's views paragraph.
# ---------------------------------------------------------------------------
_MD_RAIL_LINK = re.compile(r'<a class="quiet-button" href="[^"]*\.md">Markdown source</a>')
_MD_FOOTER = re.compile(r'\n\s*<footer class="page-foot"><p><a href="[^"]*\.md">Inspect Markdown</a></p></footer>')
_VIEWS_PARAGRAPH = re.compile(r"<p>Each page is (?:written|HTML)[^<]*?(?:</?em>[^<]*?)*</p>")


def normalise(text: str) -> str:
    text = _MD_RAIL_LINK.sub("", text)
    text = _MD_FOOTER.sub("", text)
    return _VIEWS_PARAGRAPH.sub("<p>@@views@@</p>", text)


def without_md_links(text: str) -> str:
    return _MD_FOOTER.sub("", _MD_RAIL_LINK.sub("", text))


# A regenerated corpus re-seeds its stores, so the clock, the lens fixture's
# git commits and the server's session ids differ from SO11's run. Timestamps,
# commit ids (7 to 40 hex digits; a marker digest is 64 and stays) and session
# ids (two runs of 8 base-36 characters) are masked; nothing else is.
_VOLATILE = re.compile(
    r"\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?Z?(?: UTC)?"
    r"|\b[0-9a-f]{7,40}\b|\b[0-9a-z]{8}-[0-9a-z]{8}\b"
)


def masked(text: str) -> str:
    return _VOLATILE.sub("@@volatile@@", normalise(text))


def _volatile_kind(token: str) -> str:
    if re.fullmatch(r"[0-9a-f]{7,40}", token):
        return f"hex{len(token)}"
    return "session" if re.fullmatch(r"[0-9a-z]{8}-[0-9a-z]{8}", token) else "time"


def recorded_inputs(corpus: Path, name: str) -> str:
    """What a fixture's store and context recorded; a value in it is fixed, not volatile."""

    return "".join(
        (corpus / name / part).read_text() for part in ("memory.sql", "inputs.json") if (corpus / name / part).is_file()
    )


def volatile_drift(pairs: dict[str, str], before: str, after: str, fixed: str) -> str | None:
    """Where a masked token differs: one a re-seeded run made, or a changed value.

    A token may differ only for one of the same kind, the same way on every page of
    the fixture (one value to one value), and only when the fixture's recorded inputs
    no longer hold the old value: a value the store still records cannot have moved
    with the clock or a re-seeded workspace (slice-S3 review F5).
    """

    old, new = _VOLATILE.findall(normalise(before)), _VOLATILE.findall(normalise(after))
    if len(old) != len(new):
        return f"{len(old)} volatile values became {len(new)}"
    reverse = {value: key for key, value in pairs.items()}
    for was, now in zip(old, new, strict=True):
        if was == now:
            continue
        if _volatile_kind(was) != _volatile_kind(now):
            return f"{was!r} became {now!r}, a different kind of value"
        if pairs.setdefault(was, now) != now or reverse.setdefault(now, was) != was:
            return f"{was!r} became {now!r} here and something else elsewhere"
        stamp = was[:16].replace(" ", "T") if _volatile_kind(was) == "time" else was
        if was in fixed or stamp in fixed:
            return f"{was!r} became {now!r}, but the fixture's recorded inputs still hold {was!r}"
    return None


def so11_corpus(into: Path) -> Path | None:
    """SO11's golden corpus, extracted from git at the packet's start commit."""

    archive = subprocess.run(
        ["git", "-C", str(REPO), "archive", START_SHA, "materializer/fixtures/store-only-golden"],
        capture_output=True,
    )
    if archive.returncode != 0 or not archive.stdout:
        return None
    tar = into / "so11.tar"
    tar.write_bytes(archive.stdout)
    unpacked = subprocess.run(["tar", "-xf", str(tar), "-C", str(into)], capture_output=True)
    corpus = into / "materializer" / "fixtures" / "store-only-golden"
    return corpus if unpacked.returncode == 0 and (corpus / "VERSION").is_file() else None


def unfold_from(corpus: Path, text: str) -> str:
    def replace(match: re.Match[str]) -> str:
        asset = corpus / "assets" / match.group(1)
        if not asset.is_file():
            raise RuntimeError(f"golden asset {match.group(1)[:12]} is absent")
        return asset.read_text()

    return re.sub(r"@@golden-asset ([0-9a-f]{64})@@", replace, text)


def html_pages(corpus: Path, name: str) -> dict[str, str]:
    base = corpus / name / "html"
    return {
        p.relative_to(base).as_posix(): unfold_from(corpus, p.read_text())
        for p in sorted(base.rglob("*.html"))
    } if base.is_dir() else {}


def main() -> int:
    emit(f"GATE {PACKET} — HTML is the only output")
    with tempfile.TemporaryDirectory(prefix="amanuensis-so13-") as tmp:
        root = Path(tmp)
        storage = root / "store"
        seeded: list[str] = []

        def seeded_store() -> str | None:
            seed_store(storage)
            seeded.append("yes")
            return None

        check("the fixture store is seeded", seeded_store)
        docs = storage / "docs"
        first: dict[str, Any] = {}

        def publish() -> str | None:
            if not seeded:
                return "no store"
            code, summary = materialize(storage)
            first.update(summary)
            if code != 0 or not summary.get("ok"):
                return f"the publish exited {code}: {json.dumps(summary)[:300]}"
            return None

        check("an in-place publish succeeds", publish)

        def no_md_in_place() -> str | None:
            if not first:
                return "no publication"
            found = md_files(docs)
            if found:
                return f"the publish wrote {len(found)} .md file(s): {found[:5]}"
            pages = [rel for rel in files_under(docs) if rel.endswith(".html")]
            if "index.html" not in pages or len(pages) < 20:
                return f"the publish wrote {len(pages)} HTML pages, not the site"
            extra = [
                rel
                for rel in files_under(docs)
                if not rel.endswith(".html")
                and rel not in {"search-index.js", ".manifest.json", ".projection-contract.json", README}
            ]
            if extra:
                return f"the publication holds files beyond HTML, the index and the two contract files: {extra[:5]}"
            return None

        check("an in-place publish writes no .md, only HTML, search-index.js and the two contract files", no_md_in_place)

        def readme_only() -> str | None:
            if not first:
                return "no publication"
            from amanuensis_materializer.html_projection import README_TEXT  # noqa: PLC0415

            target = docs / README
            if not target.is_file():
                return "the publication has no README.md"
            if target.read_text() != README_TEXT:
                return "the README is not the generated pointer text"
            return None

        check("the one .md is the generated README that points at index.html (SO21, D10)", readme_only)

        def contract_over_html() -> str | None:
            if not first:
                return "no publication"
            contract = json.loads((docs / ".projection-contract.json").read_text())
            listed = [str(page["path"]) for page in contract.get("pages", [])]
            md = [rel for rel in listed if rel.endswith(".md") and rel != README]
            if md:
                return f"the receipt lists {len(md)} .md page(s): {md[:5]}"
            if "index.html" not in listed or "search-index.js" not in listed:
                return "the receipt lacks index.html or search-index.js"
            on_disk = sorted(rel for rel in files_under(docs) if not rel.startswith("."))
            if sorted(listed) != on_disk:
                return f"the receipt lists {len(listed)} files for {len(on_disk)} published"
            links = [link for link in contract.get("local_links", []) if ".md" in str(link.get("target"))]
            if links:
                return f"the receipt records links to .md targets: {links[:3]}"
            manifest = json.loads((docs / ".manifest.json").read_text())
            files = [str(item["path"]) for item in manifest.get("projection_files", [])]
            if any(rel.endswith(".md") and rel != README for rel in files) or "index.html" not in files:
                return f"the manifest's projection files are not the HTML and the index: {files[:5]}"
            return None

        check("the receipt and the manifest list HTML and search-index.js, never a .md", contract_over_html)

        def readback_green() -> str | None:
            if not first:
                return "no publication"
            if (why := axes_green(first.get("readback"))):
                return f"the render's read-back: {why}"
            code, summary = materialize(storage, "--readback-only")
            if code != 0:
                return f"--readback-only exited {code}: {axes_green(summary) or json.dumps(summary)[:200]}"
            if (why := axes_green(summary)):
                return f"--readback-only: {why}"
            return None

        check("the read-back is green on all three axes for a fresh publication", readback_green)

        def no_md_links() -> str | None:
            if not first:
                return "no publication"
            for rel in files_under(docs):
                if rel.endswith(".html"):
                    targets = md_targets((docs / rel).read_text())
                    if targets:
                        return f"{rel} links {targets[:3]}"
            return None

        check("no link in any page targets a .md", no_md_links)

        marker_page: list[str] = []

        def xref_resolved() -> str | None:
            if not first:
                return "no publication"
            sys.path.insert(0, str(ROOT))
            from amanuensis_materializer.readback import finding_marker  # noqa: PLC0415

            marker = finding_marker("B02-1")
            holders = [
                rel for rel in files_under(docs) if rel.endswith(".html") and marker in (docs / rel).read_text()
            ]
            if len(holders) != 1:
                return f"the open finding's marker is on {holders}, not one page"
            marker_page.append(holders[0])
            # The entry point's imported prose names B-01 and SM-01 as bare IDs;
            # only the resolver links them and names the subsystem beside its first
            # mention, so a skipped or broken resolution shows here.
            page = (docs / "entry-point.html").read_text()
            for href in ('href="subsystems/b01-job-scheduler.html"><abbr', 'href="seams.html#sm-01"><abbr'):
                if href not in page:
                    return f"entry-point.html has no resolved link {href!r}; cross-references were not resolved"
            if "(Job Scheduler) (scheduler)" not in visible_text(page):
                return "entry-point.html does not name B-01's subsystem beside its first mention"
            return None

        check("cross-references resolve in memory: imported prose links B-01 and SM-01 and names B-01", xref_resolved)

        def sabotage(edit: Callable[[Path, str], None], label: str) -> str | None:
            if not marker_page:
                return "no marker page"
            copy = root / f"sabotage-{label}"
            if copy.exists():
                shutil.rmtree(copy)
            shutil.copytree(docs, copy)
            edit(copy, marker_page[0])
            reseal(copy)
            code, summary = materialize(storage, "--readback-only", "--output", str(copy))
            state = ((summary.get("axes") or {}).get("state") or {}).get("ok")
            if label == "control":
                return None if code == 0 and axes_green(summary) is None else f"the resealed control is red: {axes_green(summary)}"
            if code == 0 or state is not False:
                return f"the read-back stayed green on the state axis (exit {code})"
            objects = {str(m.get("object_type")) for m in summary.get("mismatches", []) if m.get("axis") == "state"}
            if not objects & {"finding-html", "finding-partition", "finding"}:
                return f"the state axis is red for {sorted(objects)}, not the finding marker"
            other = {m.get("axis") for m in summary.get("mismatches", [])} - {"state"}
            if other:
                return f"the sabotage also turned {sorted(other)} red; the reseal did not hold"
            return None

        from amanuensis_materializer.readback import finding_marker as _marker  # noqa: PLC0415

        def remove(copy: Path, page: str) -> None:
            target = copy / page
            target.write_text(target.read_text().replace(_marker("B02-1"), ""))

        def duplicate(copy: Path, page: str) -> None:
            target = copy / ("index.html" if page != "index.html" else "files.html")
            text = target.read_text()
            target.write_text(text.replace("</main>", _marker("B02-1") + "</main>", 1))

        check("a resealed, unedited copy reads back green", lambda: sabotage(lambda c, p: None, "control"))
        check("a removed HTML finding marker, receipt resealed, turns the state axis red", lambda: sabotage(remove, "removed"))
        check("a duplicated HTML finding marker, receipt resealed, turns the state axis red", lambda: sabotage(duplicate, "duplicated"))

        def guide_one_view() -> str | None:
            if not first:
                return "no publication"
            text = visible_text((docs / "how-to-read.html").read_text())
            if re.search(r"markdown", text, re.I):
                at = re.search(r"markdown", text, re.I)
                return f"the guide mentions Markdown: {text[max(0, at.start() - 80):at.end() + 60]!r}"
            if "index.html" not in text:
                return "the guide no longer says where the HTML starts"
            return None

        check("the reader's guide does not mention a Markdown view", guide_one_view)

        def notice_in_head_only() -> str | None:
            if not first:
                return "no publication"
            from html import escape  # noqa: PLC0415

            from amanuensis_materializer.html_projection import CLI_RENDER_NOTICE  # noqa: PLC0415

            for rel in files_under(docs):
                if not rel.endswith(".html"):
                    continue
                text = (docs / rel).read_text()
                head = re.search(r'<header class="page-head">(.*?)</header>', text, re.S)
                if text.count(escape(CLI_RENDER_NOTICE)) != 1 or head is None or escape(CLI_RENDER_NOTICE) not in head.group(1):
                    return f"{rel} does not carry the command-line render notice once, in its page head"
            return None

        check("a command-line render's notice is in each page head, once", notice_in_head_only)

        # -- over a previous .md + .html publication -----------------------------
        def upgrade_in_place() -> str | None:
            if not first:
                return "no publication"
            written = legacy_output(docs)
            if len(written) < 20:
                return f"the legacy output holds {len(written)} .md pages"
            code, summary = materialize(storage)
            left = md_files(docs)
            if left:
                return f"the publish left {len(left)} claimed .md file(s): {left[:5]}"
            if code != 0 or not summary.get("ok"):
                return f"the publish over the legacy output exited {code}: {axes_green(summary.get('readback')) or json.dumps(summary)[:200]}"
            if (why := axes_green(summary.get("readback"))):
                return why
            return None

        check("an in-place publish over a .md + .html output removes every .md the old manifest claimed", upgrade_in_place)

        def upgrade_clean() -> str | None:
            if not first:
                return "no publication"
            legacy_output(docs)
            code, summary = materialize(storage, "--clean-publish")
            if code != 0 or not summary.get("published"):
                return f"the clean publish over the legacy output exited {code}: {json.dumps(summary)[:240]}"
            left = md_files(docs)
            if left:
                return f"the clean publish left {len(left)} .md file(s): {left[:5]}"
            return None

        check("a clean publish over a .md + .html output leaves no .md", upgrade_clean)

        def refuses(name: str) -> str | None:
            if not first:
                return "no publication"
            stray = docs / name
            stray.write_text("# A note someone left here\n")
            before = {rel: (docs / rel).read_bytes() for rel in files_under(docs)}
            try:
                code, summary = materialize(storage, "--clean-publish")
                after = {rel: (docs / rel).read_bytes() for rel in files_under(docs)}
            finally:
                if stray.exists():
                    stray.unlink()
            if code == 0 or summary.get("published"):
                return f"a clean publish over an unmanaged {name} was not refused"
            if name not in str(summary.get("error", "")):
                return f"the refusal does not name {name}: {str(summary.get('error'))[:200]}"
            if after != before:
                return "the refused clean publish changed the output"
            return None

        check("a clean publish over an unmanaged notes.md is refused", lambda: refuses("notes.md"))
        check("a clean publish over an index.md no manifest claims is refused", lambda: refuses("index.md"))

    # -- the golden corpus --------------------------------------------------------
    with tempfile.TemporaryDirectory(prefix="amanuensis-so13-golden-") as tmp:
        previous = so11_corpus(Path(tmp))

        def golden_regenerated() -> str | None:
            version = GOLDEN / "VERSION"
            written_by = version.read_text().strip() if version.is_file() else ""
            if written_by != PACKET and written_by not in LATER_WRITERS:
                return f"the golden corpus's VERSION is {written_by or 'absent'!r}, not {PACKET}"
            later = LATER_WRITERS.get(written_by)
            if previous is None:
                return f"SO11's golden corpus cannot be read from git at {START_SHA[:12]}"
            compared = 0
            for name in GOLDEN_FIXTURES:
                before = html_pages(previous, name)
                after = html_pages(GOLDEN, name)
                pairs: dict[str, str] = {}
                fixed = recorded_inputs(GOLDEN, name)
                if not after or sorted(after) != sorted(before):
                    return f"the golden fixture {name} holds {len(after)} pages for SO11's {len(before)}"
                for rel, new in after.items():
                    if later is not None:
                        new = later.sub("", new)
                    if md_targets(new):
                        return f"golden {name}/{rel} links {md_targets(new)[:3]}"
                    if masked(before[rel]) != masked(new):
                        return f"golden {name}/{rel} differs from SO11's outside the Markdown links and the views paragraph"
                    drift = volatile_drift(pairs, before[rel], new, fixed)
                    if drift:
                        return f"golden {name}/{rel}: {drift}"
                    compared += 1
            return None if compared >= 140 else f"only {compared} golden pages were compared"

        check("the golden corpus is SO13's and differs from SO11's only where HTML-only output changes it", golden_regenerated)

    def in_ci() -> str | None:
        text = CI_FILE.read_text() if CI_FILE.is_file() else ""
        if "test-store-only-html-only.py" not in text:
            return ".github/workflows/test.yml has no step running this gate"
        return None

    check("the gate runs in CI", in_ci)

    if FAILURES:
        emit(f"GATE {PACKET} RED: {FAILURES[0]}")
        return 1
    emit(f"GATE {PACKET} GREEN")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except BaseException as exc:  # noqa: BLE001 — the protocol needs one status line
        emit(f"GATE {PACKET} RED: the gate itself failed — {exc!r}")
        sys.exit(1)
