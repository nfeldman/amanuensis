#!/usr/bin/env python3
"""Gate for orientation packet O15 — a command-line render stays in the store's docs
and says it was not recorded (design/orientation/PLAN.md §4 O15, §5 D6 option B).

Turns red when:

  - a default-mode or --clean-publish render to a directory outside <storage>/docs,
    without --allow-external-output, exits 0 (or with any status but 2), leaves any
    file there, or does not name the flag in its JSON refusal;
  - the same render with --allow-external-output fails;
  - --readback-only against an outside directory is refused;
  - a default CLI render leaves any .md or .html page without the notice (in the
    Markdown, as its last paragraph; in the HTML, once, in the page head), or its
    summary lacks "recorded": false;
  - a render with --recorded-publication carries the notice on any page, or its
    summary lacks "recorded": true; a recorded render over a stamped one leaves a
    notice behind, or a CLI render over a recorded one misses a page;
  - the --no-verify-readback variant has the wrong sentence;
  - materialize.ts's execute does not pass both --recorded-publication and
    --allow-external-output;
  - the read-back of a stamped CLI render is not green on all three axes, or the
    read-back stays green when a page loses the notice it should carry, or gains one
    under a recorded publication (with the receipt rewritten to match the bytes): in
    the Markdown italic or plain, or in the HTML;
  - the gate does not run in CI.

Also red when a published HTML page hides its report from assistive technology
(`orientation_exposure.hidden_pages`: `aria-hidden="true"`, `hidden`, `inert`,
an inline `display: none` or `role="presentation"` on `<main>`, the page head,
the article or any element around them), which every text check above reads
straight through.

False green it cannot exclude: it reads the server's source for the two flags rather
than running the server; and it reads bytes, it does not drive a browser.

Output protocol: exactly one status line, last, on stdout. Every subprocess is
captured and never echoed, and every message is scrubbed.
"""

from __future__ import annotations

import hashlib
import html as htmllib
import json
import re
import sqlite3
import subprocess
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path

from orientation_exposure import hidden_pages

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
SCHEMA = REPO / "mcp-server" / "src" / "schema.sql"
CI_FILE = REPO / ".github" / "workflows" / "test.yml"
SERVER_TOOL = REPO / "mcp-server" / "src" / "tools" / "materialize.ts"

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


# What PLAN.md fixes, written out here rather than imported, so that rewriting an
# implementation string cannot also rewrite what this gate expects.
NOTICE = (
    "Rendered from the command line. Its read-back was not recorded in the survey's"
    " record, so the Publication integrity figures on the overview describe an earlier"
    " publication."
)
NOTICE_UNVERIFIED = "Rendered from the command line and not read back."
NOTICE_STEM = "Rendered from the command line"
REFUSAL = "refusing to write outside"
FLAG = "--allow-external-output"
SHA = "aaaaaaaaaaaa1111aaaaaaaaaaaa1111aaaaaaaa"


def seed(storage: Path) -> None:
    db = sqlite3.connect(storage / "memory.db")
    db.executescript(SCHEMA.read_text())
    db.execute(
        "INSERT INTO git_state (repo_id, canonical_branch, onboarding_sha,"
        " last_checked_sha, last_checked_at)"
        " VALUES ('default', 'main', ?, ?, '2026-11-20T12:00:00Z')",
        (SHA, SHA),
    )
    db.execute(
        "INSERT INTO subsystems (id, name, status, layer, scope)"
        " VALUES ('B-01', 'Parser', 'structural', 'backend', 'src/parser')"
    )
    db.commit()
    db.close()
    (storage / "entry-point.md").write_text("# Where to begin\n\nStart at the reader.\n")


def run(storage: Path, *args: str) -> tuple[int, dict]:
    proc = subprocess.run(
        [sys.executable, str(ROOT / "materialize.py"), "--storage", str(storage), *args],
        capture_output=True,
        text=True,
        check=False,
    )
    lines = [line for line in proc.stdout.splitlines() if line.strip()]
    try:
        summary = json.loads(lines[-1]) if lines else {}
    except json.JSONDecodeError:
        summary = {}
    if not isinstance(summary, dict):
        summary = {}
    return proc.returncode, summary


def fresh_store(base: Path, name: str) -> Path:
    storage = base / name
    storage.mkdir()
    seed(storage)
    return storage


def files_under(path: Path) -> list[str]:
    if not path.exists():
        return []
    return sorted(str(p.relative_to(path)) for p in path.rglob("*") if p.is_file())


def pages(docs: Path) -> list[Path]:
    return sorted(p for p in docs.rglob("*") if p.is_file() and p.suffix in (".md", ".html"))


def squash(text: str) -> str:
    return " ".join(text.split())


def md_last_paragraph(text: str) -> str:
    blocks = [b for b in re.split(r"\n\s*\n", text.strip()) if b.strip()]
    if not blocks:
        return ""
    return squash(re.sub(r"[*_]", "", blocks[-1]))


def html_text(fragment: str) -> str:
    return squash(htmllib.unescape(re.sub(r"<[^>]+>", " ", fragment)))


def html_head(text: str) -> str:
    match = re.search(r'<header class="page-head">(.*?)</header>', text, re.S)
    return match.group(1) if match else ""


def stamped_problem(docs: Path, notice: str, other: str) -> str | None:
    """Every page carries `notice` once, in its place, and never `other`."""

    found = pages(docs)
    if not any(p.suffix == ".md" for p in found) or not any(p.suffix == ".html" for p in found):
        return "the render wrote no Markdown or no HTML pages"
    for page in found:
        rel = page.relative_to(docs)
        text = page.read_text()
        if page.suffix == ".md":
            flat = squash(re.sub(r"[*_]", "", text))
            if flat.count(notice) != 1:
                return f"{rel} carries the notice {flat.count(notice)} times, not once"
            if md_last_paragraph(text) != notice:
                return f"{rel}: the notice is not the page's last paragraph"
        else:
            flat = html_text(text)
            if flat.count(notice) != 1:
                return f"{rel} carries the notice {flat.count(notice)} times, not once"
            if notice not in html_text(html_head(text)):
                return f"{rel}: the notice is not in the page head"
        if other in flat:
            return f"{rel} carries the other variant of the notice"
    return None


def unstamped_problem(docs: Path) -> str | None:
    found = pages(docs)
    if not found:
        return "the render wrote no pages"
    for page in found:
        text = page.read_text()
        flat = html_text(text) if page.suffix == ".html" else squash(re.sub(r"[*_]", "", text))
        if NOTICE_STEM in flat:
            return f"{page.relative_to(docs)} carries the command-line notice"
    return None


def axes_problem(summary: dict, where: str) -> str | None:
    readback = summary.get("readback") if "readback" in summary else summary
    if not isinstance(readback, dict):
        return f"{where}: the summary carries no read-back"
    axes = readback.get("axes") or {}
    red = [axis for axis in ("state", "coverage", "content") if not (axes.get(axis) or {}).get("ok")]
    if red:
        details = [m.get("detail") for m in readback.get("mismatches") or []][:2]
        return f"{where}: read-back red on {', '.join(red)} ({details})"
    return None


def rewrite_receipt(docs: Path, rel: str) -> None:
    """Make the receipt agree with a page's new bytes, so only the notice check can see it."""

    receipt_path = docs / ".projection-contract.json"
    receipt = json.loads(receipt_path.read_text())
    for page in receipt.get("pages", []):
        if page.get("path") == rel:
            page["content_hash"] = hashlib.sha256((docs / rel).read_bytes()).hexdigest()
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")


def main() -> int:
    emit("GATE O15 — a command-line render stays in the store's docs and says it was not recorded")
    emit("")

    with tempfile.TemporaryDirectory(prefix="o15-gate-") as tmp:
        base = Path(tmp)

        # 1. Outside <storage>/docs without the flag: refused, nothing written.
        def refuses(mode: tuple[str, ...]) -> Callable[[], str | None]:
            def body() -> str | None:
                storage = fresh_store(base, "refuse" + "".join(mode).replace("-", "_"))
                outside = storage / "elsewhere"
                status, summary = run(storage, *mode, "--output", str(outside))
                if status == 0:
                    return "the render exited 0"
                if status != 2:
                    return f"the render exited {status}, not 2"
                if files_under(outside):
                    return f"the refused render left files: {files_under(outside)[:3]}"
                strays = [p.name for p in storage.iterdir() if "amanuensis-stage" in p.name]
                if strays:
                    return f"the refused render left a staging directory: {strays[0]}"
                if summary.get("ok") is not False:
                    return "the JSON summary does not say ok: false"
                error = str(summary.get("error") or "")
                if REFUSAL not in error or FLAG not in error or "docs" not in error:
                    return f"the refusal does not name the docs directory and the flag: {error[:160]}"
                return None

            return body

        check("a default render outside <storage>/docs is refused and writes nothing", refuses(()))
        check("a clean publish outside <storage>/docs is refused and writes nothing", refuses(("--clean-publish",)))

        # 2. The same renders with the flag succeed; read-back-only there is not refused.
        def allowed(mode: tuple[str, ...]) -> Callable[[], str | None]:
            def body() -> str | None:
                storage = fresh_store(base, "allow" + "".join(mode).replace("-", "_"))
                outside = storage / "elsewhere"
                status, summary = run(storage, *mode, FLAG, "--output", str(outside))
                if status != 0 or summary.get("ok") is not True:
                    return f"the render failed: {str(summary.get('error') or summary.get('warnings'))[:160]}"
                if not (outside / "index.html").is_file():
                    return "the render wrote no index.html outside"
                status, verified = run(storage, "--readback-only", "--output", str(outside))
                if REFUSAL in str(verified.get("error") or ""):
                    return "--readback-only against the outside directory was refused"
                if status != 0:
                    return f"--readback-only exited {status}: {axes_problem(verified, 'read-back')}"
                return None

            return body

        check("with --allow-external-output a default render outside succeeds", allowed(()))
        check("with --allow-external-output a clean publish outside succeeds", allowed(("--clean-publish",)))

        # 3. A default CLI render to <storage>/docs stamps every page.
        cli = fresh_store(base, "cli")
        cli_status, cli_summary = run(cli)
        cli_docs = cli / "docs"

        def cli_render_publishes() -> str | None:
            if cli_status != 0 or cli_summary.get("ok") is not True:
                return f"the render failed: {str(cli_summary.get('error') or cli_summary.get('warnings'))[:160]}"
            if "recorded" not in cli_summary or cli_summary["recorded"] is not False:
                return f"the summary's recorded is {cli_summary.get('recorded', 'absent')!r}, not false"
            return None

        check("a default CLI render publishes and its summary says recorded: false", cli_render_publishes)
        check("no published page hides its report from assistive technology", lambda: hidden_pages(cli_docs))
        check(
            "every page of a CLI render carries the notice (Markdown last paragraph, HTML page head)",
            lambda: stamped_problem(cli_docs, NOTICE, NOTICE_UNVERIFIED),
        )
        check("the stamped render's own read-back is green on all three axes", lambda: axes_problem(cli_summary, "render"))

        def readback_only_green() -> str | None:
            status, verified = run(cli, "--readback-only")
            problem = axes_problem(verified, "--readback-only")
            if problem:
                return problem
            return None if status == 0 else f"--readback-only exited {status}"

        check("--readback-only of the stamped render is green on all three axes", readback_only_green)

        # 4. The read-back requires the notice: a page that lost it turns red.
        def lost_notice_is_red() -> str | None:
            rel = "entry-point.md"
            page = cli_docs / rel
            original = page.read_text()
            receipt = (cli_docs / ".projection-contract.json").read_text()
            try:
                page.write_text(original.replace(NOTICE, "Rendered somewhere."))
                rewrite_receipt(cli_docs, rel)
                status, verified = run(cli, "--readback-only")
                if status == 0 or verified.get("ok") is not False:
                    return "the read-back stayed green with a page missing its notice"
                return None
            finally:
                page.write_text(original)
                (cli_docs / ".projection-contract.json").write_text(receipt)

        check("the read-back turns red when a stamped page loses its notice", lost_notice_is_red)

        def html_lost_notice_is_red() -> str | None:
            rel = "index.html"
            page = cli_docs / rel
            original = page.read_text()
            receipt = (cli_docs / ".projection-contract.json").read_text()
            try:
                stripped = re.sub(r"Rendered from the command line\.[^<]*", "", original)
                if stripped == original:
                    return "index.html has no notice text to remove"
                page.write_text(stripped)
                rewrite_receipt(cli_docs, rel)
                status, verified = run(cli, "--readback-only")
                if status == 0 or verified.get("ok") is not False:
                    return "the read-back stayed green with an HTML page missing its notice"
                return None
            finally:
                page.write_text(original)
                (cli_docs / ".projection-contract.json").write_text(receipt)

        check("the read-back turns red when a stamped HTML page loses its notice", html_lost_notice_is_red)

        # 5. A recorded render over the stamped one removes every notice.
        def recorded_over_cli() -> str | None:
            status, summary = run(cli, "--recorded-publication")
            if status != 0 or summary.get("ok") is not True:
                return f"the recorded render failed: {str(summary.get('error') or summary.get('warnings'))[:160]}"
            if summary.get("recorded") is not True:
                return f"the summary's recorded is {summary.get('recorded', 'absent')!r}, not true"
            return unstamped_problem(cli_docs) or axes_problem(summary, "recorded render")

        check("a --recorded-publication render carries no notice on any page", recorded_over_cli)

        def gained_notice_is_red(rel: str, inject: Callable[[str], str]) -> Callable[[], str | None]:
            def body() -> str | None:
                page = cli_docs / rel
                original = page.read_text()
                receipt = (cli_docs / ".projection-contract.json").read_text()
                try:
                    gained = inject(original)
                    if gained == original:
                        return f"{rel} has no place to put the notice"
                    page.write_text(gained)
                    rewrite_receipt(cli_docs, rel)
                    status, verified = run(cli, "--readback-only")
                    if status == 0 or verified.get("ok") is not False:
                        return "the read-back stayed green with a notice on a recorded publication"
                    return None
                finally:
                    page.write_text(original)
                    (cli_docs / ".projection-contract.json").write_text(receipt)

            return body

        check(
            "the read-back turns red when a recorded publication carries the notice",
            gained_notice_is_red("entry-point.md", lambda text: text.rstrip("\n") + f"\n\n*{NOTICE}*\n"),
        )
        # The emphasis is presentation: the plain sentence is the same notice.
        check(
            "the read-back turns red when a recorded publication carries the notice without emphasis",
            gained_notice_is_red("entry-point.md", lambda text: text.rstrip("\n") + f"\n\n{NOTICE}\n"),
        )
        check(
            "the read-back turns red when a recorded HTML page carries the notice",
            gained_notice_is_red(
                "index.html",
                lambda text: text.replace(
                    '<header class="page-head">',
                    f'<header class="page-head"><p>{htmllib.escape(NOTICE)}</p>',
                    1,
                ),
            ),
        )

        def cli_over_recorded() -> str | None:
            status, summary = run(cli)
            if status != 0 or summary.get("ok") is not True:
                return f"the render failed: {str(summary.get('error') or summary.get('warnings'))[:160]}"
            return stamped_problem(cli_docs, NOTICE, NOTICE_UNVERIFIED)

        check("an incremental CLI render over a recorded one stamps every page again", cli_over_recorded)

        # 6. --no-verify-readback: the other sentence.
        def unverified_variant() -> str | None:
            storage = fresh_store(base, "unverified")
            status, summary = run(storage, "--no-verify-readback")
            if status != 0 or summary.get("ok") is not True:
                return f"the render failed: {str(summary.get('error') or summary.get('warnings'))[:160]}"
            if summary.get("recorded") is not False:
                return "the summary does not say recorded: false"
            return stamped_problem(storage / "docs", NOTICE_UNVERIFIED, NOTICE)

        check("a --no-verify-readback render says it was not read back", unverified_variant)

        def unverified_clean_publish() -> str | None:
            storage = fresh_store(base, "unverified-clean")
            status, summary = run(storage, "--clean-publish", "--no-verify-readback")
            if status != 0 or summary.get("ok") is not True:
                return f"the clean publish failed: {str(summary.get('error') or summary.get('warnings'))[:160]}"
            return stamped_problem(storage / "docs", NOTICE_UNVERIFIED, NOTICE)

        check("a --no-verify-readback clean publish says it was not read back", unverified_clean_publish)

        def clean_publish_stamped() -> str | None:
            storage = fresh_store(base, "clean")
            status, summary = run(storage, "--clean-publish")
            if status != 0 or summary.get("ok") is not True or summary.get("published") is not True:
                return f"the clean publish failed: {str(summary.get('error') or summary.get('warnings'))[:160]}"
            if summary.get("recorded") is not False:
                return "the summary does not say recorded: false"
            return stamped_problem(storage / "docs", NOTICE, NOTICE_UNVERIFIED) or axes_problem(
                summary, "clean publish"
            )

        check("a CLI clean publish stamps every page and reads back green", clean_publish_stamped)

    # 7. The server passes both flags on every run.
    def server_passes_both() -> str | None:
        try:
            source = SERVER_TOOL.read_text()
        except OSError:
            return "materialize.ts is absent"
        match = re.search(r"\nfunction execute\((.*?)\n}\n", source, re.S)
        if not match:
            return "materialize.ts has no execute function"
        body = re.sub(r"//[^\n]*", "", match.group(1))
        spawn = re.search(r"spawnSync\(\s*py,\s*\[(.*?)\]", body, re.S)
        if not spawn:
            return "execute does not spawn the materializer with a literal argument list"
        args = spawn.group(1)
        for flag in ("--recorded-publication", FLAG):
            if f'"{flag}"' not in args:
                return f"execute's materializer arguments lack {flag}"
        return None

    check("materialize.ts's execute passes --recorded-publication and --allow-external-output", server_passes_both)

    def runs_in_ci() -> str | None:
        try:
            text = CI_FILE.read_text()
        except OSError:
            return "test.yml is absent"
        if "test-orientation-cli-render.py" not in text:
            return "test.yml has no step for test-orientation-cli-render.py"
        return None

    check("the gate runs in CI", runs_in_ci)

    emit("")
    if FAILURES:
        emit(f"GATE O15 RED: {FAILURES[0]}")
        return 1
    emit("GATE O15 GREEN")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except BaseException as exc:  # a crash is red with a reason, never a stack trace
        emit(f"GATE O15 RED: the gate itself failed — {exc!r}")
        sys.exit(1)
