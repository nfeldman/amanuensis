#!/usr/bin/env python3
"""Write the store-only golden corpus (store-only PLAN §3.2).

The corpus pins the HTML the projection prints, page by page, so each step of
the route from Markdown to the page model can be checked byte for byte against
the step before it. For every fixture it records what the HTML stage is given
and what it printed:

  <fixture>/inputs.json   the page plan, the shell's context, the locus index
                          and the render notice, as `render_html_projection`
                          received them
  <fixture>/md/…          each page's finished Markdown at that moment
  <fixture>/html/…        each page's HTML, its inline stylesheet and script
                          folded to `@@golden-asset <sha256>@@`
  assets/<sha256>         each folded stylesheet or script, once
  <fixture>/memory.sql    the store the pages were rendered from (store fixtures)

`VERSION` names the packet that last wrote the corpus. Only the packets §3.2's
update rule names may run this script, each in the commit the rule says.

The fixtures are the stores the materializer tests seed (`test-materializer.py`,
`test-lens-pages.py`), the two committed legacy stores built by
`mcp-server/fixtures/build-legacy-stores.mjs` (shaped like AxiomDB and like this
repository's store), migrated and imported by the server, and `hooks`, a set of
written Markdown pages that reach the recognition hooks no store fixture prints
(a Mermaid graph, nested lists, quotes, fences, misnested emphasis). The
`materializer` fixture is printed a second time with a GitHub repository URL so
the ledger's source links are pinned too.

    python3 make-golden.py --packet SO11

Needs `node` and the server's `npm run build` output for the legacy fixtures.
Never reads a real store.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import importlib.util
import io
import json
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from dataclasses import asdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
MCP = REPO / "mcp-server"
LEGACY = MCP / "fixtures" / "legacy-stores"
GOLDEN = ROOT / "fixtures" / "store-only-golden"

sys.path.insert(0, str(ROOT))

from amanuensis_materializer import core  # noqa: E402
from amanuensis_materializer import html_projection as hp  # noqa: E402

# ---------------------------------------------------------------------------
# Capture: what `render_html_projection` is given, and what it prints.
# ---------------------------------------------------------------------------


def _json_ready(value: Any) -> Any:
    return json.loads(json.dumps(value, default=list))


def capture_publish(storage: Path, argv: list[str]) -> dict[str, Any]:
    """Run the materializer in process and keep the HTML stage's first call."""

    seen: dict[str, Any] = {}
    real = core.render_html_projection

    def recording(output, pages, context, previous_files=None, locus_index=None, notice=""):
        if "pages" not in seen:
            seen["pages"] = [asdict(page) for page in pages]
            seen["context"] = _json_ready(context)
            seen["locus_index"] = _json_ready(locus_index)
            seen["notice"] = notice
            seen["md"] = {
                page.markdown_path: (Path(output) / page.markdown_path).read_text()
                for page in pages
                if (Path(output) / page.markdown_path).is_file()
            }
        result = real(output, pages, context, previous_files, locus_index, notice)
        if "html" not in seen:
            seen["html"] = {
                page.html_path: (Path(output) / page.html_path).read_text()
                for page in pages
                if (Path(output) / page.html_path).is_file()
            }
        return result

    import materialize  # noqa: PLC0415 — the CLI module, run in this process

    core.render_html_projection = recording
    saved_argv = sys.argv
    sys.argv = ["materialize.py", "--storage", str(storage), *argv]
    stdout = io.StringIO()
    try:
        with contextlib.redirect_stdout(stdout):
            code = materialize.main()
    finally:
        sys.argv = saved_argv
        core.render_html_projection = real
    lines = [line for line in stdout.getvalue().splitlines() if line.strip()]
    summary = json.loads(lines[-1]) if lines else {}
    if code != 0 or "html" not in seen:
        raise SystemExit(f"the materializer did not publish {storage}: {summary}")
    return seen


def render_inputs(inputs: dict[str, Any], md: dict[str, str]) -> dict[str, str]:
    """Render HTML from recorded inputs, as the gate does."""

    pages = [
        hp.SitePage(**{**page, "terms": tuple(tuple(term) for term in page["terms"])})
        for page in inputs["pages"]
    ]
    with tempfile.TemporaryDirectory() as tmp:
        output = Path(tmp)
        for path, text in md.items():
            target = output / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text)
        hp.render_html_projection(
            output,
            pages,
            inputs["context"],
            locus_index=inputs["locus_index"],
            notice=inputs["notice"],
        )
        return {
            page.html_path: (output / page.html_path).read_text()
            for page in pages
            if (output / page.html_path).is_file()
        }


# Every page carries the same inline stylesheet and script, some 60 KB of each
# page's bytes. They are stored once under `assets/` and a page holds their
# digest; `unfold` puts them back before any comparison, so the corpus is still
# compared byte for byte.
_FOLDABLE = re.compile(r"(<style>|<script>)(.{1024,}?)(</style>|</script>)", re.DOTALL)


def fold(text: str) -> str:
    def replace(match: re.Match[str]) -> str:
        body = match.group(2)
        digest = hashlib.sha256(body.encode("utf-8")).hexdigest()
        asset = GOLDEN / "assets" / digest
        if not asset.is_file():
            asset.parent.mkdir(parents=True, exist_ok=True)
            asset.write_text(body)
        return f"{match.group(1)}@@golden-asset {digest}@@{match.group(3)}"

    folded = _FOLDABLE.sub(replace, text)
    if unfold(folded) != text:
        raise SystemExit("a page does not unfold to its own bytes")
    return folded


def unfold(text: str) -> str:
    return re.sub(
        r"@@golden-asset ([0-9a-f]{64})@@",
        lambda m: (GOLDEN / "assets" / m.group(1)).read_text(),
        text,
    )


def write_fixture(name: str, seen: dict[str, Any], store: Path | None) -> None:
    target = GOLDEN / name
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    inputs = {key: seen[key] for key in ("pages", "context", "locus_index", "notice")}
    (target / "inputs.json").write_text(json.dumps(inputs, indent=1, sort_keys=True) + "\n")
    for folder, files in (("md", seen["md"]), ("html", seen["html"])):
        for path, text in files.items():
            out = target / folder / path
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(fold(text) if folder == "html" else text)
    if store is not None:
        db = sqlite3.connect(store)
        try:
            (target / "memory.sql").write_text("\n".join(db.iterdump()) + "\n")
        finally:
            db.close()
    # What is recorded must be what the recorded inputs print: a corpus whose
    # HTML depends on anything else (a clock, the order files were found) would
    # make every later comparison meaningless.
    again = render_inputs(inputs, seen["md"])
    if again != seen["html"]:
        differing = sorted(path for path in seen["html"] if again.get(path) != seen["html"][path])
        raise SystemExit(f"{name}: the recorded inputs do not reprint the HTML: {differing[:5]}")


# ---------------------------------------------------------------------------
# Fixtures.
# ---------------------------------------------------------------------------


def _load_script(name: str) -> Any:
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), ROOT / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# The prose `test-materializer.py` imports into its store, as it writes it.
MATERIALIZER_ENTRY_POINT = (
    "# Entry point\n\nThis is a fictional test codebase with three subsystems: "
    "B-01 (scheduler), B-02 (auth), and F-01 (web UI). The seam SM-01 connects them.\n\n"
    "## File ledger\n\n"
    "| Path | Classification | Why in scope | Ref SHA |\n"
    "|---|---|---|---|\n"
    "| `scheduler/main.ts` | examined | Owns the job dispatch boundary and its auth call. | `deadbeef` |\n\n"
    "## State containers\n\n"
    "| Name | Location | Stores | Lifetime | Populated by | Invalidated by |\n"
    "|---|---|---|---|---|---|\n"
    "| `JobQueue` | `scheduler/main.ts` | Pending jobs | Process | Dispatcher | Restart |\n\n"
    "## Non applicable territories\n\n"
    "| Territory | Attenuating condition |\n"
    "|---|---|\n"
    "| Native memory | The runtime owns allocation for this service. |\n"
)
MATERIALIZER_ONBOARDING = (
    "# Onboarding report\n\n**Codebase**: FictionalProject — materializer fixture\n\n"
    "## Directory clusters\n\n- scheduler/ — B-01\n- auth/ — B-02\n- web/ — F-01\n\n"
    "## Runtime boundary map\n\n"
    "| Runtime / Process | Language | Communicates with | Mechanism | Notes |\n"
    "|---|---|---|---|---|\n"
    "| Host agent | external | scheduler service | stdio RPC | Starts the scheduler process. |\n"
    "| Scheduler service | Python | auth service | HTTPS request | Dispatches authenticated jobs. |\n"
    "| Auth service | TypeScript | policy database | SQL transaction | Owns authorization decisions. |\n"
)
MATERIALIZER_CHECKLIST = (
    "# Concern checklist (calibrated)\n\n"
    "## Active concerns (3)\n\n"
    "| Code | Category | Territory | Codebase-specific probe (abbreviated) | Primary subsystems |\n"
    "|---|---|---|---|---|\n"
    "| CC-1 | cache-coherence | T2 | Does the scheduler retain stale authorization state after a policy change? | B-01, B-02 |\n"
    "| CC-2 | cache-coherence | T2 | Trace every holder of the shared policy snapshot. | B-02 |\n"
    "| TC-1 | trust-boundary | T10 | Verify that every public request path validates its caller. | B-02, F-01 |\n"
)


def materializer_fixture(root: Path) -> tuple[dict[str, Any], Path]:
    from store_only_seed import import_onboarding  # noqa: PLC0415

    module = _load_script("test-materializer")
    storage = root / "materializer"
    storage.mkdir()
    (storage / "workspace_path").write_text("/example/FictionalProject\n")
    db = sqlite3.connect(storage / "memory.db")
    module.seed(db)
    import_onboarding(
        db,
        session_id="s1",
        entry_point=MATERIALIZER_ENTRY_POINT,
        onboarding_report=MATERIALIZER_ONBOARDING,
        concern_checklist=MATERIALIZER_CHECKLIST,
        ref_sha="deadbeef",
    )
    db.commit()
    db.close()
    return capture_publish(storage, []), storage / "memory.db"


def lens_fixture(root: Path) -> tuple[dict[str, Any], Path]:
    module = _load_script("test-lens-pages")
    workspace, checked = module.make_workspace(root / "lens")
    if not checked:
        raise SystemExit("the lens fixture's workspace could not be committed")
    module.CHECKED_SHA = checked
    storage = root / "lens" / "store"
    storage.mkdir(parents=True)
    module.seed(storage)
    (storage / "workspace_path").write_text(f"{workspace}\n")
    return capture_publish(storage, []), storage / "memory.db"


# Loads one committed legacy dump, opens it with the server (which migrates it),
# and imports its files the way an owner's first session would.
_LEGACY_IMPORT = r"""
import { readFileSync } from "node:fs";
import { join } from "node:path";
const [dist, dump, storage] = process.argv.slice(1);
const Database = (await import("better-sqlite3")).default;
const dbPath = join(storage, "memory.db");
const raw = new Database(dbPath);
raw.exec(readFileSync(dump, "utf8"));
raw.close();
const { openDatabase } = await import(join(dist, "db.js"));
const tools = new Map();
for (const [file, key] of [["tools/project.js", "projectTools"], ["tools/import.js", "importTools"]]) {
  for (const tool of (await import(join(dist, file)))[key]) tools.set(tool.name, tool);
}
const db = openDatabase(dbPath);
const project = { workspacePath: join(storage, "..", "workspace"), projectKey: "golden", storagePath: storage, dbPath, storageGitReady: false };
const ctx = { project, db, sessionId: null };
const session = tools.get("start_session").handler({ intent: "golden corpus import" }, ctx);
ctx.sessionId = session.session_id;
tools.get("import_artifact_bodies").handler({}, ctx);
db.close();
"""


def legacy_fixture(root: Path, name: str) -> tuple[dict[str, Any], Path]:
    storage = root / name / "storage"
    shutil.copytree(LEGACY / name / "storage", storage)
    built = subprocess.run(["npm", "run", "build"], cwd=MCP, capture_output=True, text=True)
    if built.returncode != 0:
        raise SystemExit(f"the server could not be built: {built.stderr[-400:]}")
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", _LEGACY_IMPORT, str(MCP / "dist"),
         str(LEGACY / name / "memory.sql"), str(storage)],
        cwd=MCP,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise SystemExit(f"{name}: the import did not run: {proc.stderr[-800:]}")
    return capture_publish(storage, []), storage / "memory.db"


# Written Markdown for the hooks no store fixture prints. Each page is rendered
# by the HTML stage exactly as a materialized page is.
HOOK_PAGES: dict[str, str] = {
    "hooks.md": (
        "# Recognition hooks\n\n"
        "Lead paragraph before any section, with `code`, **strong**, *emphasis*, _underscore_,"
        " __double__ and a [link](architecture.md#subsystem-atlas).\n\n"
        "## Inline subset\n\n"
        "A **misnested *pair** of* emphasis marks and _a **crossing_ pair** print as the"
        " parser always printed them.\n"
        "Status 🟢 mapped, severity 🔴 HIGH, code chips `mapped`, `code-verified` and `ACH`,"
        " an [external link](https://example.com/a?b=1) and & < > escapes.\n\n"
        "Concern dispositions and jump-in reading are display phrases. <a id=\"inline-anchor\"></a>"
        " Line one  \nline two.\n\n"
        "<a id=\"block-anchor\"></a>\n"
        "<!-- amanuensis:record kind=finding id=B-01-1 -->\n\n"
        "## Lists and quotes\n\n"
        "- first item\n"
        "  continued on the next line\n"
        "  - nested child\n"
        "    - grandchild\n"
        "  - second child\n"
        "- second item\n"
        "1. ordered after unordered\n"
        "2. second ordered\n\n"
        "> A quoted line\n"
        "> that continues.\n\n"
        "## Fences\n\n"
        "```ts\nconst a = 1 < 2;\n```\n\n"
        "```\nplain fence\n```\n\n"
        "```mermaid\ngraph LR\n"
        '    A["B-01<br>Job Scheduler"]\n'
        '    B["B-02<br>Auth Service"]\n'
        '    C["X-9 Unrouted"]\n'
        '    A -->|"calls<br>sync"| B\n'
        '    B <-->|"shares"| C\n'
        "```\n\n"
        "```mermaid\npie showData\n"
        '    title Stale entries\n'
        '    "B-01" : 3\n'
        '    "B-02" : 1.5\n'
        "```\n\n"
        "```mermaid\nsequenceDiagram\n    A->>B: hi\n```\n\n"
        "```mermaid\ngraph TD\n    A[\"only nodes\"]\n```\n\n"
        "## Tables\n\n"
        "| Value | Label | What it means | What it cannot justify |\n"
        "|---|---|---|---|\n"
        "| `adversarial` | Adversarial | A pass that challenges claims. | A defect. |\n"
        "| plain | Plain | Not a code span. | Nothing. |\n\n"
        "| Seam | Party A | Shared object | Party B |\n"
        "|---|---|---|---|\n"
        "| [SM-01](seams.md#sm-01) | [B-01](subsystems/b-01.md) Job Scheduler | `jobs_queue` | [B-02](subsystems/b-02.md) Auth |\n"
        "| SM-02 | B-02 Auth | token cache | F-01 Web |\n\n"
        "| From | Relationship | To | Strength | Context |\n"
        "|---|---|---|---|---|\n"
        "| [B-01](subsystems/b-01.md) Job Scheduler | depends-on | [B-02](subsystems/b-02.md) Auth | confirmed | dispatch |\n"
        "| B-02 Auth | calls | F-01 Web | | |\n"
        "| F-01 Web | calls | B-01 Job Scheduler | inferred | polling |\n\n"
        "| Layer | Subsystem | Boundary | Other end |\n"
        "|---|---|---|---|\n"
        "| backend | [B-01](subsystems/b-01.md) Job Scheduler | [SM-01](seams.md#sm-01) jobs queue | [B-02](subsystems/b-02.md) Auth |\n"
        "| backend | [B-02](subsystems/b-02.md) Auth | depends-on → | F-01 Web |\n"
        "| frontend | F-01 Web | — | — |\n\n"
        "| Subsystem | CC-1 | TC-1 |\n"
        "|---|---|---|\n"
        "| [B-01](subsystems/b-01.md) Job Scheduler | 🔴 🔗 | 🟢 |\n"
        "| B-02 Auth | ⚪ | — |\n"
        "| F-01 Web | ✅ odd | ⚠ |\n\n"
        "| Metric | Value |\n"
        "|---|---|\n"
        "| Subsystems | 3 |\n"
        "| Pipe \\| cell | `a|b` |\n\n"
        "| Plain | Table | Short row |\n"
        "|---|---|---|\n"
        "| a | b |\n"
        "| c | d | e | f |\n"
    ),
    "subsystems/b-01.md": (
        "# B-01 Job Scheduler\n\n"
        "## Findings\n\n"
        "| ID | Status | Symptom | Why it matters | Root cause | Ref SHA |\n"
        "|---|---|---|---|---|---|\n"
        "| B-01-1 | open | Jobs drop. Under load the queue loses entries! | Lost work. | Reuse. | `deadbeef` |\n"
        "| B-01-2 | fixed | One sentence only | | Root. | |\n\n"
        "## Seams\n\n"
        "| Seam | Shared object | Kind | Parties | Assessable? | Notes |\n"
        "|---|---|---|---|---|---|\n"
        "| SM-01 | jobs queue | data | B-01, B-02 | yes | |\n\n"
        "## Open questions\n\n"
        "| # | Category | Question | Resolution | Answer |\n"
        "|---|---|---|---|---|\n"
        "| 1 | scope | Who drains it? | answered | The reader. |\n"
    ),
    "architecture.md": "# Architecture\n\n## Subsystem atlas\n\nA page the hooks link to.\n",
    "seams.md": "# Seams\n\nA page the hooks link to.\n",
}


def hooks_fixture() -> dict[str, Any]:
    pages = [
        hp.SitePage("hooks.md", "Recognition hooks", "Hooks", "Every hook once.", "Overview"),
        hp.SitePage("architecture.md", "Architecture", "Architecture", "", "Codebase"),
        hp.SitePage("seams.md", "Seams", "Seams", "", "Codebase"),
        hp.SitePage(
            "subsystems/b-01.md", "B-01 Job Scheduler", "Job Scheduler", "", "Codebase",
            kind="subsystem", record_id="B-01", status="mapped", subgroup="Subsystems",
        ),
    ]
    context = {
        "canonical_branch": "main",
        "project_name": "Hooks",
        "last_checked_sha": "deadbeefdeadbeef",
        "last_checked_at": "2026-11-20T00:00:00Z",
        "staleness_measured": False,
        "repository_url": "https://github.com/acme/hooks",
        "identifier_definitions": {"B-01": "Job Scheduler", "SM-01": "jobs queue seam"},
    }
    inputs = {
        "pages": [asdict(page) for page in pages],
        "context": context,
        "locus_index": {"paths": [], "symbols": []},
        "notice": "",
    }
    return {**inputs, "md": dict(HOOK_PAGES), "html": render_inputs(inputs, HOOK_PAGES)}


def with_repository(seen: dict[str, Any], url: str) -> dict[str, Any]:
    inputs = {key: seen[key] for key in ("pages", "context", "locus_index", "notice")}
    inputs = json.loads(json.dumps(inputs))
    inputs["context"]["repository_url"] = url
    return {**inputs, "md": seen["md"], "html": render_inputs(inputs, seen["md"])}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--packet", required=True, help="The packet writing the corpus (PLAN §3.2).")
    args = parser.parse_args()
    if GOLDEN.exists():
        shutil.rmtree(GOLDEN)
    GOLDEN.mkdir(parents=True)
    with tempfile.TemporaryDirectory(prefix="amanuensis-golden-") as tmp:
        root = Path(tmp)
        seen, store = materializer_fixture(root)
        write_fixture("materializer", seen, store)
        write_fixture(
            "materializer-github",
            with_repository(seen, "https://github.com/acme/fictional"),
            None,
        )
        seen, store = lens_fixture(root)
        write_fixture("lens", seen, store)
        for name in ("axiomdb-shaped", "self-shaped"):
            seen, store = legacy_fixture(root, name)
            write_fixture(name, seen, store)
    write_fixture("hooks", hooks_fixture(), None)
    (GOLDEN / "VERSION").write_text(f"{args.packet}\n")
    print(f"golden corpus written by {args.packet} under {GOLDEN.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
