#!/usr/bin/env python3
"""Gate for explanation packet EX12 — purposes and the project account elsewhere
on the pages (spec.md §3.7, §3.6 custody and lint, §2.5; claims C31, C33, C34,
C35, C44).

Builds one temporary git repository and several stores over it. Subsystems:

  B-01  mapped, a recorded purpose containing `|` and two sentences, a recorded account
  B-02  mapped, a declined purpose
  B-03  mapped, nothing recorded
  B-04  `deferred` (not explanation-eligible) with a recorded purpose
  B-05  `unmapped`, nothing recorded

The project account varies by store: recorded, declined, not recorded, and a
store with no explanation-eligible subsystem at all.

Turns red when:

  - the master plan has no Purpose column, or a cell is not the recorded purpose
    with `|` replaced by `/` (recorded), the state's label from the contract
    (declined, not recorded, ineligible), or the HTML record list drops it;
  - a subsystem id's hover definition is not its name and the first sentence of
    its recorded purpose, or changes for a subsystem without a recorded one;
  - the architecture page does not open with `## How the parts fit together`, the
    project account with its provenance line, the declination sentence, or the
    no-account sentence, then one line per subsystem;
  - a project account, its declination reason, or a purpose excerpt that the
    orientation lint refuses is printed, the refusal sentence is absent, or the
    clean publish stays green, publishes, or touches the published output;
  - the architecture and master-plan pages do not list the explanation rows
    among their sources, or the read-back passes with the project account
    removed from the architecture page;
  - the census omits an unfilled explanation slot, holds a row for an ineligible
    subsystem (a `deferred` one included) or for a declined slot, drops the
    vocabulary row of an ineligible subsystem, or the extended census gate is
    not green;
  - the overview differs from the overview of the same store with no explanation
    rows, or the gate is not listed in CI.

False green it cannot exclude: prose that passes the lint and misleads. This
gate asserts where an explanation appears and that the pages, the census and
the read-back agree, not that it is true.

Output protocol: exactly one status line, last, on stdout. Every subprocess is
captured and never echoed, and every message is scrubbed, so a missing
deliverable reports as an assertion failure and not as a crash.
"""

from __future__ import annotations

import hashlib
import html
import json
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
SCHEMA = REPO / "mcp-server" / "src" / "schema.sql"
CI_FILE = REPO / ".github" / "workflows" / "test.yml"

PACKET = "EX12"
RED_EXPECT = "the master plan does not carry a recorded purpose"

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
    ("NameError", "name-error"),
    ("Traceback (most recent call last)", "stack trace"),
    ("ENOENT", "PATH-ABSENT"),
    ("is not a function", "is not callable"),
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
# What the specification fixes, written out here rather than imported.
# ---------------------------------------------------------------------------
NO_PURPOSE_STEM = "No purpose statement is recorded for this subsystem"
# The not-recorded sentence ends at `.` or `;`; a declined purpose opens with the same
# words and a `:`, and is a filled slot.
NO_PURPOSE_PATTERN = re.compile(re.escape(NO_PURPOSE_STEM) + r"[.;]")
NO_ACCOUNT = "No account of how the parts fit together is recorded."
ARCH_HEADING = "How the parts fit together"
REFUSAL = (
    "The recorded {slot} carries survey-status vocabulary and was not published;"
    " record a corrected version."
)
LABEL_DECLINED = "Declined"
LABEL_NOT_RECORDED = "Not recorded"
ACCOUNT_DECLINED_STEM = "A survey session declined to write an account of how the parts fit together at"
HOW_IT_WORKS_DECLINED_STEM = "declined to write an account of how this subsystem works"

READER = "src/reader.py"
REGISTRY = "src/registry.py"
WRITER = "src/writer.py"
OTHER = "src/other.py"

FIRST_SENTENCE_B01 = "PURPOSE-B-01 the read path hands each caller a committed snapshot | not a live view."
PURPOSE_B01 = f"{FIRST_SENTENCE_B01} SECOND-B-01 names the rows it never reads."
ACCOUNT_B01 = "ACCOUNT-B-01 a read begins at the snapshot registry and walks the page index."
REASON_B02 = "REASON-PURPOSE-B-02 the write path has no purpose beyond its caller."
PURPOSE_B04 = "PURPOSE-B-04 the console prints status."
ACCOUNT_PROJECT = "ACCOUNT-PROJECT the read path feeds the write path through one queue."
REASON_PROJECT = "REASON-PROJECT the system is too small for an account of its parts."

# Each carries survey-status vocabulary the orientation lint refuses.
VIOLATING_PROJECT = "The survey is up to date with the canonical branch."
VIOLATING_REASON = "The conspectus is fully surveyed for the project."
VIOLATING_PURPOSE_B03 = "B-03 is mapped and its ledger is complete."

SUBSYSTEMS = (
    # id, name, status
    ("B-01", "Read path", "mapped"),
    ("B-02", "Write path", "mapped"),
    ("B-03", "Queue", "mapped"),
    ("B-04", "Console", "deferred"),
    ("B-05", "Cache", "unmapped"),
)
INELIGIBLE_ONLY = (
    ("B-04", "Console", "deferred"),
    ("B-05", "Cache", "unmapped"),
    ("B-06", "Index", "scoping"),
)


# ---------------------------------------------------------------------------
# The repository the explanations cite
# ---------------------------------------------------------------------------
def git(repo: Path, *args: str) -> str:
    proc = subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True,
        text=True,
        check=False,
        env={
            "GIT_AUTHOR_NAME": "gate",
            "GIT_AUTHOR_EMAIL": "gate@example.invalid",
            "GIT_COMMITTER_NAME": "gate",
            "GIT_COMMITTER_EMAIL": "gate@example.invalid",
            "HOME": str(repo),
            "PATH": "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin",
        },
    )
    if proc.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {proc.stderr.strip()[:200]}")
    return proc.stdout.strip()


def build_repository(repo: Path) -> dict[str, str]:
    """C1 has every file; C2 changes only `other`."""

    repo.mkdir(parents=True)
    git(repo, "init", "-q", "-b", "main")
    (repo / "src").mkdir()
    for rel in (READER, REGISTRY, WRITER, OTHER):
        (repo / rel).write_text(f"# {rel}\nVERSION = 1\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "c1")
    c1 = git(repo, "rev-parse", "HEAD")
    (repo / OTHER).write_text(f"# {OTHER}\nVERSION = 2\n")
    git(repo, "commit", "-q", "-am", "c2")
    c2 = git(repo, "rev-parse", "HEAD")
    return {"c1": c1, "c2": c2}


# ---------------------------------------------------------------------------
# The store
# ---------------------------------------------------------------------------
def seed(
    storage: Path,
    shas: dict[str, str],
    *,
    subsystems: tuple[tuple[str, str, str], ...] = SUBSYSTEMS,
    project: str = "none",
    explain: bool = True,
) -> None:
    """`project` is `recorded`, `declined` or `none`; `explain=False` seeds no explanation row."""

    db = sqlite3.connect(storage / "memory.db")
    db.executescript(SCHEMA.read_text())
    cur = db.cursor()
    cur.execute(
        "INSERT INTO git_state (repo_id, canonical_branch, onboarding_sha,"
        " last_checked_sha, last_checked_at)"
        " VALUES ('default', 'main', ?, ?, '2026-11-06T12:00:00Z')",
        (shas["c1"], shas["c2"]),
    )
    cur.execute("INSERT INTO sessions (session_id, intent) VALUES ('ex12', 'fixture')")
    for sid, name, status in subsystems:
        cur.execute(
            "INSERT INTO subsystems (id, name, status, layer, scope)"
            " VALUES (?, ?, ?, 'backend', ?)",
            (sid, name, status, f"SCOPE-{sid}: src/ files of the {name.lower()}"),
        )
    evidence: dict[str, int] = {}
    for rel in (READER, REGISTRY, WRITER):
        cur.execute(
            "INSERT INTO evidence (file_path, ref_sha, kind, session_id)"
            " VALUES (?, ?, 'code-verified', 'ex12')",
            (rel, shas["c1"]),
        )
        evidence[rel] = int(cur.lastrowid or 0)

    def add(
        subject_type: str,
        sid: str,
        slot: str,
        disposition: str,
        body: str,
        cites: tuple[str, ...] = (),
    ) -> None:
        cur.execute(
            "INSERT INTO explanations (subject_type, subject_id, slot, disposition, body,"
            " ref_sha, session_id) VALUES (?, ?, ?, ?, ?, ?, 'ex12')",
            (subject_type, sid, slot, disposition, body, shas["c1"]),
        )
        explanation_id = cur.lastrowid
        for rel in cites:
            cur.execute(
                "INSERT INTO explanation_evidence (explanation_id, evidence_id) VALUES (?, ?)",
                (explanation_id, evidence[rel]),
            )

    present = {sid for sid, _name, _status in subsystems}
    if explain:
        if "B-01" in present:
            add("subsystem", "B-01", "purpose", "recorded", PURPOSE_B01, (READER, REGISTRY))
            add("subsystem", "B-01", "account", "recorded", ACCOUNT_B01, (READER, REGISTRY))
        if "B-02" in present:
            add("subsystem", "B-02", "purpose", "declined", REASON_B02)
        if "B-04" in present:
            add("subsystem", "B-04", "purpose", "recorded", PURPOSE_B04, (READER,))
        if project == "recorded":
            add("project", "project", "account", "recorded", ACCOUNT_PROJECT, (READER, REGISTRY, WRITER))
        elif project == "declined":
            add("project", "project", "account", "declined", REASON_PROJECT)
    db.commit()
    db.close()


def add_violations(storage: Path, shas: dict[str, str], *, reason: bool) -> None:
    """Newer rows whose text carries survey-status vocabulary."""

    db = sqlite3.connect(storage / "memory.db")
    cur = db.cursor()
    cur.execute("SELECT id FROM evidence WHERE file_path = ?", (READER,))
    evidence_id = cur.fetchone()[0]
    rows = [("subsystem", "B-03", "purpose", "recorded", VIOLATING_PURPOSE_B03)]
    if reason:
        rows.append(("project", "project", "account", "declined", VIOLATING_REASON))
    else:
        rows.append(("project", "project", "account", "recorded", VIOLATING_PROJECT))
    for subject_type, sid, slot, disposition, body in rows:
        cur.execute(
            "INSERT INTO explanations (subject_type, subject_id, slot, disposition, body,"
            " ref_sha, session_id) VALUES (?, ?, ?, ?, ?, ?, 'ex12')",
            (subject_type, sid, slot, disposition, body, shas["c1"]),
        )
        if disposition == "recorded":
            cur.execute(
                "INSERT INTO explanation_evidence (explanation_id, evidence_id) VALUES (?, ?)",
                (cur.lastrowid, evidence_id),
            )
    db.commit()
    db.close()


def run_materializer(storage: Path, *args: str, workspace: Path | None = None) -> dict[str, object]:
    cmd = [sys.executable, str(ROOT / "materialize.py"), "--storage", str(storage)]
    if workspace is not None:
        cmd += ["--workspace", str(workspace)]
    cmd += list(args)
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    lines = [ln for ln in proc.stdout.splitlines() if ln.strip()]
    try:
        summary = json.loads(lines[-1]) if lines else {}
    except json.JSONDecodeError:
        summary = {}
    if not isinstance(summary, dict):
        summary = {}
    summary["_returncode"] = proc.returncode
    summary["_diagnostic"] = scrub(proc.stderr)[-300:]
    return summary


def read(path: Path) -> str:
    try:
        return path.read_text()
    except OSError:
        return ""


def section(text: str, heading: str, level: int = 2) -> str:
    """The body of one Markdown section, up to the next heading of its level or higher."""

    marker = "#" * level + " "
    body: list[str] = []
    inside = False
    for line in text.splitlines():
        if not inside:
            inside = line.startswith(marker) and line[len(marker):].strip() == heading
            continue
        depth = len(line) - len(line.lstrip("#"))
        if line.startswith("#") and 0 < depth <= level:
            break
        body.append(line)
    return "\n".join(body)


def h2s(text: str) -> list[str]:
    return [ln[3:].strip() for ln in text.splitlines() if ln.startswith("## ")]


def subsystem_page(docs: Path, sid: str) -> str:
    pages = sorted((docs / "subsystems").glob(f"{sid.lower().replace('-', '')}-*.md"))
    return read(pages[0]) if pages else ""


def tree_digest(directory: Path) -> dict[str, str]:
    return {
        str(p.relative_to(directory)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(directory.rglob("*"))
        if p.is_file()
    }


def master_table(text: str) -> tuple[list[str], dict[str, list[str]]]:
    """The master plan's subsystem table: its header, and each row's cells by subsystem id."""

    header: list[str] = []
    by_id: dict[str, list[str]] = {}
    for line in text.splitlines():
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if cells and cells[0] == "Priority":
            header = cells
        elif header and len(cells) >= 2 and not set(cells[0]) <= set("-: "):
            by_id[cells[1].strip("*")] = cells
    return header, by_id


def provenance(n: int, ageing: str, sha: str) -> str:
    return f"*Written by a survey session at `{sha[:8]}` from {n} evidence row(s). {ageing}*"


def main() -> int:
    emit("GATE EX12 — purposes and the project account elsewhere on the pages")
    emit("")
    root = Path(tempfile.mkdtemp(prefix="amanuensis-ex12-"))
    try:
        setup_error: str | None = None
        shas: dict[str, str] = {}
        repo = root / "repo"
        try:
            shas = build_repository(repo)
        except Exception as exc:
            setup_error = f"the fixture repository could not be built — {scrub(exc)}"

        stores: dict[str, tuple[Path, dict[str, object]]] = {}
        seed_error: str | None = setup_error

        def new_store(name: str, **seed_args: object) -> None:
            storage = root / name
            storage.mkdir()
            seed(storage, shas, **seed_args)  # type: ignore[arg-type]
            stores[name] = (
                storage,
                run_materializer(storage, "--output", str(storage / "docs"), workspace=repo),
            )

        if seed_error is None:
            try:
                new_store("good", project="recorded")
                new_store("declined", project="declined")
                new_store("none", project="none")
                new_store("ineligible", subsystems=INELIGIBLE_ONLY, project="recorded")
                new_store("baseline", explain=False)
                new_store("plain", project="none", explain=False)
            except Exception as exc:
                seed_error = f"the fixture could not be seeded — {scrub(exc)}"

        def docs_of(name: str) -> Path:
            return stores[name][0] / "docs"

        def page(name: str, rel: str) -> str:
            return read(docs_of(name) / rel)

        def published(name: str = "good") -> str | None:
            if seed_error:
                return seed_error
            outcome = stores[name][1]
            if outcome.get("_returncode") != 0:
                return f"the materializer failed — {outcome.get('_diagnostic')}"
            return None

        # -- 1. the first assertion: the master plan carries the purpose --------
        def master_plan() -> str | None:
            if (why := published()):
                return why
            header, by_id = master_table(page("good", "master-plan.md"))
            if "Purpose" not in header:
                return f"{RED_EXPECT}: the subsystem table's columns are {header}"
            at = header.index("Purpose")
            for sid, want in (
                ("B-01", FIRST_SENTENCE_B01.replace("|", "/") + " SECOND-B-01 names the rows it never reads."),
                ("B-02", LABEL_DECLINED),
                ("B-03", LABEL_NOT_RECORDED),
                ("B-04", LABEL_NOT_RECORDED),
                ("B-05", LABEL_NOT_RECORDED),
            ):
                cells = by_id.get(sid)
                if cells is None or len(cells) != len(header):
                    return (
                        f"{RED_EXPECT}: the {sid} row has {None if cells is None else len(cells)}"
                        f" cells against {len(header)} columns"
                    )
                if cells[at] != want:
                    return f"{RED_EXPECT}: the {sid} Purpose cell is {cells[at]!r}, not {want!r}"
            if PURPOSE_B04 in page("good", "master-plan.md"):
                return "the master plan prints a purpose recorded for a deferred subsystem"
            if "provenance" in by_id["B-01"][at].lower() or "Written by a survey session" in by_id["B-01"][at]:
                return "the master plan's purpose excerpt carries a provenance line"
            return None

        check("the master plan carries each subsystem's purpose, or the state's label", master_plan)

        def master_plan_html() -> str | None:
            if (why := published()):
                return why
            text = page("good", "master-plan.html")
            plain = html.unescape(re.sub(r"<[^>]+>", " ", text))
            wanted = FIRST_SENTENCE_B01.replace("|", "/")
            if wanted not in " ".join(plain.split()):
                return "the HTML master plan drops the recorded purpose"
            if "Purpose" not in plain:
                return "the HTML master plan's subsystem records carry no Purpose field"
            return None

        check("the HTML master plan projects the Purpose column", master_plan_html)

        # -- 2. hover definitions ---------------------------------------------
        def hovers() -> str | None:
            if (why := published()):
                return why
            titles: dict[str, set[str]] = {}
            for path in sorted(docs_of("good").rglob("*.html")):
                for sid, title in re.findall(
                    r'<abbr class="identifier-definition" title="(B-0\d) — ([^"]*)"', path.read_text()
                ):
                    titles.setdefault(sid, set()).add(html.unescape(title))
            want = {
                "B-01": f"Read path: {FIRST_SENTENCE_B01}",
                "B-02": "Write path",
                "B-03": "Queue",
                "B-04": "Console",
            }
            for sid, expected in want.items():
                seen = titles.get(sid)
                if not seen:
                    return f"no page carries a hover definition for {sid}"
                if seen != {expected}:
                    return f"{sid}'s hover definition is {sorted(seen)}, not {expected!r}"
            return None

        check("a subsystem id's hover definition carries the first sentence of its purpose", hovers)

        # -- 3. the architecture page ------------------------------------------
        def architecture() -> str | None:
            if (why := published()):
                return why
            text = page("good", "architecture.md")
            if h2s(text)[:1] != [ARCH_HEADING]:
                return f"the architecture page opens with {h2s(text)[:2]}, not `## {ARCH_HEADING}`"
            body = section(text, ARCH_HEADING)
            if ACCOUNT_PROJECT not in body:
                return "the project account is not under the opening section"
            want = provenance(3, "None of the 3 file(s) it cites has changed since.", shas["c1"])
            if want not in body:
                return f"the provenance line is not `{want}`"
            if text.count(ACCOUNT_PROJECT) != 1:
                return "the project account is printed more than once"
            if NO_ACCOUNT in body:
                return "the no-account sentence is printed beside a recorded account"
            lines = [ln.lstrip("-* ").strip() for ln in body.splitlines()]
            for sid, name, rest in (
                ("B-01", "Read path", PURPOSE_B01),
                ("B-02", "Write path", LABEL_DECLINED),
                ("B-03", "Queue", LABEL_NOT_RECORDED),
                ("B-04", "Console", LABEL_NOT_RECORDED),
                ("B-05", "Cache", LABEL_NOT_RECORDED),
            ):
                line = f"**{sid} — {name}**: {rest}"
                if line not in lines:
                    return f"the section has no line `{line}`"
            if sum("Written by a survey session" in ln for ln in lines) != 1:
                return "the section does not carry exactly one provenance line, the account's"
            rest = h2s(text)[1:]
            if "Runtime boundary map" not in rest or "Staleness map" not in rest:
                return f"the architecture page lost its other sections: {rest}"
            return None

        check("the architecture page opens with the project account and one line per subsystem", architecture)

        def architecture_states() -> str | None:
            if (why := published("declined")) or (why := published("none")) or (why := published("ineligible")):
                return why
            lines = lambda text: [ln.lstrip("-* ").strip() for ln in section(text, ARCH_HEADING).splitlines()]  # noqa: E731
            declined = page("declined", "architecture.md")
            body = section(declined, ARCH_HEADING)
            declination = f"{ACCOUNT_DECLINED_STEM} `{shas['c1'][:8]}`. {REASON_PROJECT}"
            if declination not in " ".join(body.split()):
                return f"a declined project account does not print `{declination}`"
            if "**B-01 — Read path**:" not in " ".join(lines(declined)):
                return "a declined project account drops the per-subsystem lines"
            absent = page("none", "architecture.md")
            if h2s(absent)[:1] != [ARCH_HEADING] or NO_ACCOUNT not in section(absent, ARCH_HEADING):
                return "an unrecorded project account does not print the no-account sentence"
            if f"**B-03 — Queue**: {LABEL_NOT_RECORDED}" not in lines(absent):
                return "the per-subsystem lines do not render beside the no-account sentence"
            nothing = page("ineligible", "architecture.md")
            if NO_ACCOUNT not in section(nothing, ARCH_HEADING):
                return "a store with no eligible subsystem does not print the no-account sentence"
            if ACCOUNT_PROJECT in nothing:
                return "a project account recorded with no eligible subsystem is printed"
            return None

        check("a declined, absent or ineligible project account prints its sentence", architecture_states)

        # -- 4. the lint, the refusal sentence, and the clean publish ----------
        def lint_refusal() -> str | None:
            if seed_error:
                return seed_error
            for variant, bad in (("account", VIOLATING_PROJECT), ("reason", VIOLATING_REASON)):
                storage = root / f"lint-{variant}"
                storage.mkdir()
                seed(storage, shas, project="recorded")
                docs = storage / "docs"
                first = run_materializer(storage, "--clean-publish", workspace=repo)
                if first.get("_returncode") != 0 or not first.get("published"):
                    return f"the clean fixture did not publish — {first.get('_diagnostic')}"
                before = tree_digest(docs)
                add_violations(storage, shas, reason=variant == "reason")
                refused = run_materializer(storage, "--clean-publish", workspace=repo)
                if refused.get("ok"):
                    return f"a violating project {variant} left the clean publish green"
                if refused.get("published"):
                    return f"a violating project {variant} was published"
                if refused.get("_returncode") == 0:
                    return f"the refused clean publish of a violating {variant} exited 0"
                warnings = " ".join(str(w) for w in refused.get("warnings") or [])
                if "project" not in warnings or "account" not in warnings:
                    return f"no warning names the project account: {scrub(warnings)[:200]!r}"
                if tree_digest(docs) != before:
                    return "the previously published output was touched"
                inplace = run_materializer(
                    storage, "--output", str(storage / "docs-inplace"), workspace=repo
                )
                if inplace.get("ok"):
                    return f"an in-place render with a violating {variant} stayed green"
                arch = read(storage / "docs-inplace" / "architecture.md")
                if REFUSAL.format(slot="account") not in section(arch, ARCH_HEADING):
                    return f"the architecture page does not carry the refusal sentence for the {variant}"
                if bad in arch:
                    return f"the violating {variant} {bad!r} was printed"
                master = read(storage / "docs-inplace" / "master-plan.md")
                header, by_id = master_table(master)
                if "Purpose" not in header:
                    return f"{RED_EXPECT}: the lint fixture's master plan has no Purpose column"
                cell = by_id.get("B-03", [""] * len(header))[header.index("Purpose")]
                if cell != REFUSAL.format(slot="purpose"):
                    return f"the master plan's B-03 Purpose cell is {cell!r}, not the refusal sentence"
                if VIOLATING_PURPOSE_B03 in master or VIOLATING_PURPOSE_B03 in arch:
                    return "a violating purpose was printed as an excerpt"
                for path in (storage / "docs-inplace").rglob("*.html"):
                    if VIOLATING_PURPOSE_B03 in html.unescape(path.read_text()):
                        return f"a violating purpose reached the hover text in {path.name}"
            return None

        check("lint violations print the refusal and turn the clean publish red", lint_refusal)

        # -- 5. custody: sources and the read-back -----------------------------
        def custody_sources() -> str | None:
            if (why := published()):
                return why
            try:
                pages = json.loads(read(docs_of("good") / ".manifest.json")).get("pages", [])
            except json.JSONDecodeError:
                return "the manifest could not be read"
            for rel in ("architecture.md", "master-plan.md"):
                entries = [p for p in pages if p.get("path") == rel]
                if not entries:
                    return f"the manifest has no {rel}"
                keys = " ".join(str(k) for k in (entries[0].get("sources") or {}))
                if "explanation" not in keys:
                    return f"{rel}'s sources do not list the explanation rows: {keys[:200]}"
            return None

        check("the architecture and master-plan pages list the explanation rows among their sources", custody_sources)

        def readback_red_case() -> str | None:
            if (why := published()):
                return why
            storage = stores["good"][0]
            docs = docs_of("good")
            control = run_materializer(storage, "--readback-only", "--output", str(docs), workspace=repo)
            if not control.get("ok"):
                return f"the read-back is red on the unmodified publication — {control.get('mismatches')}"
            target = docs / "architecture.md"
            original = target.read_text()
            if ACCOUNT_PROJECT not in original:
                return "the publication carries no project account to remove"
            target.write_text(original.replace(ACCOUNT_PROJECT, ""))
            try:
                red = run_materializer(storage, "--readback-only", "--output", str(docs), workspace=repo)
            finally:
                target.write_text(original)
            if red.get("ok"):
                return "the read-back passed with the project account removed from the architecture page"
            hits = [
                m
                for m in red.get("mismatches") or []
                if m.get("axis") == "state"
                and "explanation" in str(m.get("object_type"))
                and "project" in str(m.get("object_id"))
            ]
            if not hits:
                return (
                    "the state axis did not name the missing project account; mismatches are"
                    f" {[(m.get('axis'), m.get('object_type'), m.get('object_id')) for m in red.get('mismatches') or []]}"
                )
            return None

        check("the read-back state axis fails when the project account is off its page", readback_red_case)

        # -- 6. the census -----------------------------------------------------
        def census_rows(name: str) -> list[dict[str, object]] | str:
            if (why := published(name)):
                return why
            rows = stores[name][1].get("unfilled_slots")
            if not isinstance(rows, list):
                return f"the {name} summary has no unfilled_slots"
            return [r for r in rows if isinstance(r, dict)]

        def explanation_keys(rows: list[dict[str, object]]) -> set[tuple[str, str]]:
            return {
                (str(r.get("slot")), str(r.get("subject")))
                for r in rows
                if str(r.get("slot")) in ("subsystem-purpose", "subsystem-account", "project-account")
            }

        def census() -> str | None:
            rows = census_rows("good")
            if isinstance(rows, str):
                return rows
            got = explanation_keys(rows)
            want = {
                ("subsystem-account", "B-02"),
                ("subsystem-purpose", "B-03"),
                ("subsystem-account", "B-03"),
            }
            if got != want:
                return f"the census holds explanation rows {sorted(got)}, not {sorted(want)}"
            for r in rows:
                if r.get("slot") in ("subsystem-purpose", "subsystem-account", "project-account"):
                    if set(r) != {"slot", "page", "subject", "state", "discharge"} or r.get("state") != "not-recorded":
                        return f"an explanation row is malformed: {r}"
                    if "record_explanation" not in str(r.get("discharge")) or "decline_explanation" not in str(
                        r.get("discharge")
                    ):
                        return f"an explanation row's discharge names neither tool: {r.get('discharge')}"
            vocabulary = {str(r.get("subject")) for r in rows if r.get("slot") == "subsystem-vocabulary"}
            if vocabulary != {"B-01", "B-02", "B-03", "B-04", "B-05"}:
                return f"the vocabulary rows are {sorted(vocabulary)}, not every subsystem"
            # subsystem-purpose: a row exists iff the eligible page prints the no-purpose sentence.
            for sid in ("B-01", "B-02", "B-03"):
                printed = bool(NO_PURPOSE_PATTERN.search(subsystem_page(docs_of("good"), sid)))
                if printed != (("subsystem-purpose", sid) in got):
                    return f"{sid}: the no-purpose sentence is {'printed' if printed else 'absent'} and the census disagrees"
            # subsystem-account is one-directional: a row iff no section and no declination.
            for sid in ("B-01", "B-02", "B-03"):
                text = subsystem_page(docs_of("good"), sid)
                owed = "## How it works" not in text and HOW_IT_WORKS_DECLINED_STEM not in text
                if owed != (("subsystem-account", sid) in got):
                    return f"{sid}: the account section is {'absent' if owed else 'present'} and the census disagrees"
            return None

        check("the census reports the unfilled purpose and account of an eligible subsystem", census)

        def census_exempt() -> str | None:
            rows = census_rows("good")
            if isinstance(rows, str):
                return rows
            for sid in ("B-04", "B-05"):
                text = subsystem_page(docs_of("good"), sid)
                if not NO_PURPOSE_PATTERN.search(text):
                    return f"{sid} (not explanation-eligible) does not print the no-purpose sentence"
                for slot in ("subsystem-purpose", "subsystem-account"):
                    if (slot, sid) in explanation_keys(rows):
                        return f"{sid} (not explanation-eligible) has a `{slot}` row"
            none_rows = census_rows("none")
            ineligible = census_rows("ineligible")
            if isinstance(none_rows, str) or isinstance(ineligible, str):
                return none_rows if isinstance(none_rows, str) else str(ineligible)
            if ("project-account", "project") not in explanation_keys(none_rows):
                return "an eligible subsystem with no project account leaves no project-account row"
            declined = census_rows("declined")
            if isinstance(declined, str):
                return declined
            if ("project-account", "project") in explanation_keys(declined) or (
                ("project-account", "project") in explanation_keys(rows)
            ):
                return "a declined or recorded project account has a row"
            if explanation_keys(ineligible):
                return f"a store with no eligible subsystem has explanation rows {sorted(explanation_keys(ineligible))}"
            if {str(r.get("subject")) for r in ineligible if r.get("slot") == "subsystem-vocabulary"} != {
                "B-04",
                "B-05",
                "B-06",
            }:
                return "an ineligible subsystem lost its vocabulary row"
            for sid in ("B-04", "B-05", "B-06"):
                if not NO_PURPOSE_PATTERN.search(subsystem_page(docs_of("ineligible"), sid)):
                    return f"{sid} in the ineligible store does not print the no-purpose sentence"
            return None

        check("an ineligible subsystem has no explanation row and keeps its vocabulary row", census_exempt)

        def census_extension() -> str | None:
            source = read(ROOT / "test-placeholder-census.py")
            for needle in ("subsystem-purpose", "subsystem-account", "project-account", "deferred"):
                if needle not in source:
                    return f"test-placeholder-census.py has no case naming `{needle}`"
            proc = subprocess.run(
                [sys.executable, str(ROOT / "test-placeholder-census.py")],
                capture_output=True,
                text=True,
                check=False,
            )
            last = (proc.stdout.strip().splitlines() or [""])[-1]
            if proc.returncode != 0 or last != "GATE EX6 GREEN":
                return f"the extended census gate is not green — {scrub(last)[:200]}"
            return None

        check("the extended census gate is green", census_extension)

        # -- 7. the overview is unchanged --------------------------------------
        def overview_unchanged() -> str | None:
            if (why := published("good")) or (why := published("baseline")):
                return why
            for name in ("index.md", "index.html"):
                with_rows = page("good", name)
                without = page("baseline", name)
                if not with_rows or with_rows != without:
                    return f"{name} differs between a store with explanation rows and one with none"
            return None

        check("the overview is byte-identical with and without explanation rows", overview_unchanged)

        def no_rows_unchanged() -> str | None:
            if (why := published("plain")) or (why := published("baseline")):
                return why
            for rel in ("index.md", "master-plan.md"):
                text = page("plain", rel)
                if rel == "master-plan.md":
                    # With no explanation row anywhere every cell is the not-recorded label.
                    if text.count(LABEL_NOT_RECORDED) < len(SUBSYSTEMS):
                        return "a store with no explanation rows does not label every purpose"
                elif text != page("baseline", rel):
                    return f"{rel} differs between two stores with no explanation rows"
            return None

        check("a store with no explanation rows labels every purpose as not recorded", no_rows_unchanged)
    finally:
        shutil.rmtree(root, ignore_errors=True)

    def runs_in_ci() -> str | None:
        text = read(CI_FILE)
        if not text:
            return "the CI workflow .github/workflows/test.yml is not readable"
        if not re.search(r"python3 test-explanation-orientation\.py", text):
            return "the workflow does not run test-explanation-orientation.py"
        return None

    check("the gate runs in CI", runs_in_ci)

    emit("")
    if FAILURES:
        emit(f"GATE {PACKET} RED: {FAILURES[0].split(': ', 1)[1]}")
        return 1
    emit(f"GATE {PACKET} GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
