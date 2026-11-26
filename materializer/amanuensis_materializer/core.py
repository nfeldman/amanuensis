"""Materializer orchestrator.

Public API:
    m = Materializer(storage=..., output=..., force_full=False)
    summary = m.materialize()

The orchestrator:
  1. Opens memory.db read-only.
  2. Discovers all pages that the current DB state requires (static
     + per-subsystem + per-diagnosticity-matrix).
  3. For each page, builds its model and its source hash map, and compares
     both to the manifest to count it rendered or unchanged.
  4. Runs the global cross-reference resolver over every page's model, since
     a different page changing can change what an ID links to.
  5. Writes each page's HTML from its model, `search-index.js` and the shared
     `assets/site.*` stylesheet and script beside it, and retires the HTML
     of pages that no longer have a generator.
  6. Saves the manifest and the publication receipt, and reads the
     publication back against the store.

No `.md` page is written (store-only PLAN §3.2 step 3). `.md` pages a manifest
from before then claims are deleted. The one `.md` a publication holds is the
README that points at `index.html` (D10, `README_TEXT`).
"""
from __future__ import annotations

import html
import re
import subprocess
import traceback
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from . import renderers
from .db import (
    VIEW_ABSENT_CAUSE,
    missing_views,
    open_ro,
    row,
    rows,
    survey_exclusions,
    survey_filter,
)
from .html_projection import (
    SEARCH_INDEX_PATH,
    SitePage,
    UnknownNavGroup,
    assert_nav_groups,
    render_html_projection,
    terms_line,
)
from .legacy_prose import RENDERED_BODIES
from .manifest import (
    MATERIALIZER_VERSION,
    Manifest,
    prune_retired,
    remove_markdown_pages,
    sha256_bytes,
    sources_differ,
)
from .page import Page
from .readback import ProjectionVerifier, finding_page, write_contract
from .renderers import RenderResult
from .slugs import matrix_page, subsystem_page
from .xref import XrefIndex, resolve_model

PageFn = Callable[[], RenderResult]


def _repository_web_url(workspace: Path) -> str | None:
    """The web URL of the workspace's origin, when it is on a host whose file pages are known.

    GitHub, GitLab and Bitbucket, by their public hostnames (`SOURCE_HOSTS`).
    Anything else, a self-hosted forge included, gets no URL rather than a guess.
    """

    if not workspace.is_dir():
        return None
    try:
        result = subprocess.run(
            ["git", "-C", str(workspace), "remote", "get-url", "origin"],
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    remote = result.stdout.strip()
    for host, nested in (("github.com", False), ("gitlab.com", True), ("bitbucket.org", False)):
        h = re.escape(host)
        patterns = (
            rf"^git@{h}:(?P<path>[^\s]+)$",
            rf"^ssh://git@{h}(?::\d+)?/(?P<path>[^\s]+)$",
            rf"^https?://(?:[^@/\s]+@)?{h}/(?P<path>[^\s]+)$",
        )
        for pattern in patterns:
            match = re.match(pattern, remote, re.IGNORECASE)
            if not match:
                continue
            path = re.sub(r"\.git$", "", match.group("path").rstrip("/"), flags=re.IGNORECASE)
            segments = path.split("/")
            if all(segments) and (len(segments) == 2 or (nested and len(segments) > 2)):
                return f"https://{host}/{path}"
    return None


def _repository_web_ref(workspace: Path, revision: str) -> str | None:
    """The branch a host link names: one the origin is known to have.

    A link naming a commit breaks until that commit is pushed, so pages
    published from unpushed work would link to nothing. A branch link opens the
    file as the branch has it now, which can be ahead of the checked revision;
    the revision itself stays on every path as `data-source-rev`.

    In order: the origin's default branch when it holds the checked revision;
    otherwise a pushed branch that holds it, the workspace's upstream first
    (work surveyed before it is integrated); otherwise the default branch, where
    only the paths that branch holds link (`_remote_tree_paths`).
    "Known" means a remote-tracking ref this checkout has, so the answer is as
    of the last fetch and a render makes no network call. With no such ref there
    is no branch, and no link.
    """

    def git(*args: str) -> str:
        try:
            result = subprocess.run(
                ["git", "-C", str(workspace), *args],
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )
        except (OSError, subprocess.SubprocessError):
            return ""
        return result.stdout.strip() if result.returncode == 0 else ""

    if not workspace.is_dir():
        return None
    remote_branches = {
        ref
        for ref in git("for-each-ref", "--format=%(refname:short)", "refs/remotes/origin/").split()
        if ref.startswith("origin/") and ref != "origin/HEAD"
    }
    if not remote_branches:
        return None
    default = git("symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD")
    if default not in remote_branches:
        default = next((b for b in ("origin/main", "origin/master") if b in remote_branches), "")
    holding: set[str] = set()
    if re.fullmatch(r"[0-9a-fA-F]{7,40}", revision or ""):
        holding = set(
            git("branch", "-r", "--contains", revision, "--format=%(refname:short)").split()
        ) & remote_branches
    upstream = git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")
    for candidate in (default, upstream, *sorted(holding)):
        if candidate in holding:
            return candidate.removeprefix("origin/")
    return default.removeprefix("origin/") or None


def _remote_tree_paths(workspace: Path, ref: str | None) -> list[str] | None:
    """The paths `origin/<ref>` holds, as of the last fetch, or None when unknown.

    A link names a branch, not the checked commit, so a path the commit has and
    the branch does not (a file added since the last push, or one an imported
    table still names after it was deleted) would 404. Only these paths link.
    """

    if not ref or not workspace.is_dir():
        return None
    try:
        result = subprocess.run(
            ["git", "-C", str(workspace), "ls-tree", "-r", "-z", "--name-only", f"refs/remotes/origin/{ref}"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    return [p for p in result.stdout.split("\0") if p]


def _compact_definition(label: str, detail: str | None = None, *, limit: int = 220) -> str:
    """Build a concise human expansion for an opaque report identifier."""

    heading = re.sub(r"\s+", " ", html.unescape(label or "")).strip(" .:—-")
    prose = re.sub(r"<[^>]+>", " ", html.unescape(detail or ""))
    prose = re.sub(r"[`*_]", "", prose)
    prose = re.sub(r"^T\d+\s*[,.:;-]?\s*", "", prose.strip(), flags=re.IGNORECASE)
    prose = re.sub(r"^(?:and|or|but)\s+", "", prose, flags=re.IGNORECASE)
    prose = re.sub(r"\s+", " ", prose).strip()
    if prose:
        sentence = re.split(r"(?<=[.!?])\s+", prose, maxsplit=1)[0]
        sentence = sentence[:1].upper() + sentence[1:]
        if len(sentence) > limit:
            sentence = sentence[:limit].rsplit(" ", 1)[0].rstrip(" ,;:") + "…"
        return f"{heading}: {sentence}" if heading else sentence
    return heading or "Report record"


@dataclass
class PagePlan:
    """One page the materializer intends to produce."""

    path: str
    build: PageFn
    xref_id: str | None = None
    xref_display: str | None = None
    title: str = ""
    label: str = ""
    hint: str = ""
    # The reader's question the page answers, as the clause that follows "Use it
    # when" (Appendix D). Subsystem pages and evidence matrices share one per
    # family, so the index prints it once per subgroup.
    use_when: str = ""
    group: str = "Codebase"
    kind: str = "reference"
    status: str | None = None
    # A subsystem's layer, which its page head names beside its id.
    layer: str = ""
    # A named division inside `group` (spec §7.1). Subsystem pages and evidence
    # matrices are families with one page per record, so they render under their
    # own heading rather than flooding the group they belong to.
    subgroup: str = ""


# The route table on the reader's guide is generated from the page plan (§7.8).
# One tuple per planned page, in plan order, carrying only what the guide
# renders — so the guide never reaches into the plan's build closures.
def _routes(plan: list[PagePlan]) -> list[tuple[str, str, str, str, str, str]]:
    return [
        (p.path, p.label or p.title, p.hint, p.group, p.subgroup, p.use_when)
        for p in plan
    ]


def _locus_index(conn) -> dict[str, list[dict[str, Any]]]:
    """The generated locus index ⌘K reads (spec §8.1.1).

    One entry per distinct ledger path — the Files index's own row set, so
    every entry's anchor resolves to a row a reader can reach with scripts
    disabled — and one entry per cited `evidence` symbol. The path's standing
    is the owners' state when they agree and `mixed` when they do not, which is
    the rule §2.4.2 fixes and the Files index already renders; a single owner's
    state stood in for the file would assert an agreement the ledger does not
    record.

    A symbol whose file no ledger row names has no Files row to land on, so it
    carries the index page itself rather than an anchor that resolves nowhere.

    A path outside the survey set is in neither half: the Files index does not
    list it, and an older record's citation of it is not a destination
    (design/scope/PLAN.md §2.6a, §2.8).
    """

    excluded = {str(r["file_path"]) for r in survey_exclusions(conn)}
    by_path: dict[str, list[dict[str, Any]]] = {}
    for entry in rows(
        conn,
        "SELECT file_path, subsystem_id, standing_state FROM file_standing"
        f" WHERE {survey_filter(conn)} ORDER BY file_path, subsystem_id",
    ):
        by_path.setdefault(str(entry["file_path"]), []).append(entry)

    paths: list[dict[str, Any]] = []
    for file_path, owners in sorted(by_path.items()):
        states = {str(owner["standing_state"]) for owner in owners}
        paths.append(
            {
                "p": file_path,
                "o": [str(owner["subsystem_id"]) for owner in owners],
                "s": next(iter(states)) if len(states) == 1 else "mixed",
                "h": f"files.html#{renderers.file_anchor(file_path)}",
            }
        )

    symbols: list[dict[str, Any]] = []
    for entry in rows(
        conn,
        "SELECT DISTINCT symbol, file_path FROM evidence"
        " WHERE symbol IS NOT NULL AND TRIM(symbol) <> ''"
        " ORDER BY symbol, file_path",
    ):
        file_path = str(entry["file_path"])
        if file_path in excluded:
            continue
        anchor = (
            f"files.html#{renderers.file_anchor(file_path)}"
            if file_path in by_path
            else "files.html"
        )
        symbols.append({"y": str(entry["symbol"]), "p": file_path, "h": anchor})

    return {"paths": paths, "symbols": symbols}


@dataclass
class Summary:
    ok: bool = True
    output_dir: str = ""
    pages_total: int = 0
    pages_rendered: int = 0
    pages_unchanged: int = 0
    pages_retired: list[str] = field(default_factory=list)
    markdown_removed: list[str] = field(default_factory=list)
    xref_updates: int = 0
    html_pages_total: int = 0
    html_pages_rendered: int = 0
    html_pages_unchanged: int = 0
    html_pages_retired: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    readback: dict[str, Any] | None = None


class Materializer:
    def __init__(
        self,
        storage: Path,
        output: Path,
        force_full: bool = False,
        verify_readback: bool = True,
        notice: str = "",
    ) -> None:
        self.storage = storage
        self.output = output
        self.force_full = force_full
        self.verify_readback = verify_readback
        # The command-line render notice every page ends with (PLAN O15); empty
        # when the caller records this render's read-back in the store.
        self.notice = notice
        self.manifest_path = output / ".manifest.json"
        self.manifest = Manifest.load(self.manifest_path)
        self.summary = Summary(output_dir=str(output))

    # ---------------------------------------------------------------------
    def _warn(self, message: str) -> None:
        """Record a renderer's refusal and fail the run.

        A guard that reports and still publishes is prose with better timing
        (GP25), so every warning routed here also clears `ok`.
        """

        self.summary.warnings.append(message)
        self.summary.ok = False

    # ---------------------------------------------------------------------
    def _refused(self, message: str) -> dict[str, Any]:
        """The summary shape a render that never started still has to return."""

        self._warn(message)
        return {
            "ok": False,
            "output_dir": str(self.output),
            "html_entrypoint": str(self.output / "index.html"),
            "pages_total": 0,
            "pages_rendered": 0,
            "pages_unchanged": 0,
            "pages_retired": [],
            "markdown_removed": [],
            "xref_updates": 0,
            "html_pages_total": 0,
            "html_pages_rendered": 0,
            "html_pages_unchanged": 0,
            "html_pages_retired": [],
            "warnings": self.summary.warnings,
            "readback": None,
        }

    # ---------------------------------------------------------------------
    def materialize(self) -> dict[str, Any]:
        # A run reads each imported body once: the read-back after the render
        # compares the page with the blocks it was printed from (§3.5).
        token = RENDERED_BODIES.set({})
        try:
            return self._materialize()
        finally:
            RENDERED_BODIES.reset(token)

    def _materialize(self) -> dict[str, Any]:
        conn = open_ro(self.storage / "memory.db")
        try:
            # The reader-lens views are created by the MCP server's schema
            # application and by nothing else; this process opens the store
            # read-only. A store last opened by an older server therefore
            # reaches here without them while the pages below read them.
            # Refuse by name rather than render a projection that silently
            # drops whichever lens the absent view feeds, and never fall back
            # to an inline copy of the predicate: two copies of one definition
            # is the drift the views exist to remove.
            absent = missing_views(conn)
            if absent:
                return self._refused(
                    f"required view(s) absent from the store: {', '.join(absent)} — "
                    f"{VIEW_ABSENT_CAUSE}"
                )
            plan = self._plan(conn)
            # A page whose group is not in NAV_GROUPS is a render error (§7.1).
            # It is caught here, before a byte is written: the rail would have
            # nowhere to route it from, and a group appended silently is a lens
            # the reader's guide never explains. `_nav` asserts the same thing
            # again for callers that reach it directly.
            try:
                assert_nav_groups([(p.path, p.group) for p in plan])
            except UnknownNavGroup as unknown:
                return self._refused(str(unknown))
            self.summary.pages_total = len(plan)

            # A publication written before HTML became the only view left its
            # `.md` pages beside the HTML; the manifest it wrote claims them.
            self.summary.markdown_removed = remove_markdown_pages(self.manifest, self.output)

            # Build each page's model. It is the input to the HTML stage; the
            # manifest keeps its hash so a page whose sources and model are
            # unchanged counts as unchanged.
            rendered: list[str] = []
            fresh_models: dict[str, Page] = {}
            version_drift = self.manifest.version != MATERIALIZER_VERSION
            for p in plan:
                try:
                    model, sources = p.build()
                except Exception as e:  # pragma: no cover — exercised via fault injection
                    # Keep batch-tool behaviour — one failed page doesn't
                    # abort the whole run — but include the traceback so a
                    # typo'd column name or missing dict key is immediately
                    # obvious, and propagate the failure to the process
                    # exit code via summary.ok.
                    self.summary.warnings.append(
                        f"renderer failed for {p.path}: {e!r}\n{traceback.format_exc()}"
                    )
                    self.summary.ok = False
                    continue
                terms = terms_line(p.path, renderers.page_terms(p.path))
                # A page's hash is over its model and the head the shell prints
                # beside it.
                fresh_models[p.path] = model
                new_hash = sha256_bytes(repr((model, p.hint, p.use_when, terms)).encode("utf-8"))
                prev = self.manifest.page(p.path)
                needs = (
                    self.force_full
                    or version_drift
                    or not (self.output / p.path).is_file()
                    or sources_differ(prev.sources, sources)
                    or prev.content_hash != new_hash
                )
                if needs:
                    prev.sources = sources
                    prev.content_hash = new_hash
                    prev.rendered_at = datetime.now(UTC).strftime(
                        "%Y-%m-%dT%H:%M:%SZ"
                    )
                    rendered.append(p.path)
                else:
                    self.summary.pages_unchanged += 1

            # Build the global xref index once, then resolve every page's
            # model against it. Every page is resolved, changed or not,
            # because a *different* page changing can change which IDs resolve
            # to what (a new subsystem makes an ID link; a resolved finding's
            # record moves from findings to resolved-findings). A page whose
            # own text is unchanged but whose links are not counts as an xref
            # update.
            index = self._build_xref_index(conn, plan)
            alive = {p.path for p in plan}
            linked_models = {
                path: resolve_model(model, path, index) for path, model in fresh_models.items()
            }
            linked_hashes = {
                path: sha256_bytes(repr(model).encode("utf-8")) for path, model in linked_models.items()
            }
            unchanged = alive.difference(rendered)
            self.summary.xref_updates = sum(
                1
                for path in unchanged
                if path in linked_hashes and self.manifest.page(path).linked_hash != linked_hashes[path]
            )
            for path, digest in linked_hashes.items():
                self.manifest.page(path).linked_hash = digest

            # Drop the page ids no plan holds any more; their HTML is retired
            # below with the projection files.
            self.summary.pages_retired = prune_retired(self.manifest, alive)
            self.summary.pages_rendered = len(rendered)

            # HTML is the published view, derived from the post-xref models. Its shared navigation is rebuilt from the
            # complete page plan so names, statuses, and routes cannot drift
            # independently.
            git = row(conn, "SELECT * FROM git_state WHERE repo_id='default'") or {}
            # The freshness strip reads `file_ledger`, under the same names
            # `get_dashboard` returns, so the two readings cannot disagree about
            # the same store (§11.2). The `entries`-derived count it replaced was
            # a zero-denominator green: no code path writes that table (B03-2).
            freshness = renderers.ledger_freshness(conn)
            # Identity resolution lives beside the renderer that publishes it, so
            # the HTML shell and the overview cannot name the project differently.
            workspace = renderers.resolve_workspace(self.storage)
            project_name = renderers.project_name(conn, self.storage)
            html_context = {
                **git,
                "project_name": project_name,
                "stale_entries": freshness["stale_obligation"],
                "stale_exempt": freshness["stale_exempt"],
                "scoped_files": freshness["scoped_files"],
                "staleness_measured": freshness["scoped_files"] > 0,
                "repository_url": _repository_web_url(workspace),
                "repository_ref": (
                    web_ref := _repository_web_ref(workspace, str(git.get("last_checked_sha") or ""))
                ),
                # The paths a link may name: those the linked branch holds.
                "linkable_paths": _remote_tree_paths(workspace, web_ref),
                # The paths prose may link to the host: every path the ledger
                # holds, which the reconciliation keeps true of the checked tree.
                "source_paths": [
                    r["file_path"] for r in rows(conn, "SELECT DISTINCT file_path FROM file_ledger")
                ],
                "identifier_definitions": {
                    identifier: definition
                    for identifier, (_display, _target, definition) in index.entries.items()
                },
            }
            site_pages = [
                SitePage(
                    path=p.path,
                    title=p.title,
                    label=p.label or p.title,
                    hint=p.hint,
                    use_when=p.use_when,
                    terms=renderers.page_terms(p.path),
                    group=p.group,
                    subgroup=p.subgroup,
                    kind=p.kind,
                    record_id=p.xref_id,
                    status=p.status,
                    layer=p.layer,
                )
                for p in plan
            ]
            html_result = render_html_projection(
                self.output,
                site_pages,
                html_context,
                previous_files=self.manifest.projection_files,
                locus_index=_locus_index(conn),
                notice=self.notice,
                models=linked_models,
            )
            self.manifest.projection_files = html_result.files
            self.summary.html_pages_total = len(site_pages)
            self.summary.html_pages_rendered = html_result.rendered
            self.summary.html_pages_unchanged = html_result.unchanged
            self.summary.html_pages_retired = html_result.retired
            self.summary.warnings.extend(html_result.warnings)
            if html_result.warnings:
                self.summary.ok = False

            self.manifest.version = MATERIALIZER_VERSION
            self.manifest.save(self.manifest_path)

            # The incremental manifest records renderer-input hashes.  The
            # projection receipt is deliberately separate and hashes the bytes
            # a reader sees: every HTML page, the search index and the site assets.
            expected_paths = sorted(html_result.files)
            write_contract(self.output, expected_paths, notice=self.notice)
            if self.verify_readback:
                self.summary.readback = ProjectionVerifier(
                    self.storage, self.output, expected_paths, notice=self.notice
                ).verify()
                if not self.summary.readback["ok"]:
                    self.summary.ok = False

            # A report of what no session has written yet, from the same
            # predicates the pages print by. It is read by the caller and
            # never by the publication above.
            unfilled = renderers.unfilled_slots(conn, self.storage)

            return {
                "ok": self.summary.ok,
                "output_dir": str(self.output),
                "html_entrypoint": str(self.output / "index.html"),
                "pages_total": self.summary.pages_total,
                "pages_rendered": self.summary.pages_rendered,
                "pages_unchanged": self.summary.pages_unchanged,
                "pages_retired": self.summary.pages_retired,
                "markdown_removed": self.summary.markdown_removed,
                "xref_updates": self.summary.xref_updates,
                "html_pages_total": self.summary.html_pages_total,
                "html_pages_rendered": self.summary.html_pages_rendered,
                "html_pages_unchanged": self.summary.html_pages_unchanged,
                "html_pages_retired": self.summary.html_pages_retired,
                "warnings": self.summary.warnings,
                "readback": self.summary.readback,
                "unfilled_slots": unfilled,
            }
        finally:
            conn.close()

    def verify_projection(self) -> dict[str, Any]:
        """Read back an existing projection without rendering or repairing it.

        The page plan names each page's HTML; it does not name the generated
        artifacts a render produces beside them, so `manifest.projection_files`
        is read as well (§8.2). Without it the
        coverage axis would report `search-index.js` as an unplanned file the
        moment the inventory learned to see it — a read-back that turns red on
        a correct projection is worse than one that never looked.
        """
        conn = open_ro(self.storage / "memory.db")
        try:
            plan = self._plan(conn)
            expected_paths = [p.path for p in plan]
        finally:
            conn.close()
        expected_paths = sorted(
            set(expected_paths) | {SEARCH_INDEX_PATH} | set(self.manifest.projection_files)
        )
        summary = ProjectionVerifier(self.storage, self.output, expected_paths).verify()
        summary["html_entrypoint"] = str(self.output / "index.html")
        return summary

    # ---------------------------------------------------------------------
    def _plan(self, conn) -> list[PagePlan]:
        storage = self.storage
        plan: list[PagePlan] = []

        def imported(
            rel_src: str, kind: str, title: str, label: str, use_when: str
        ) -> PagePlan | None:
            """One of the three pages an earlier version wrote by hand, from the store.

            Planned inline rather than in a trailing loop so the rail's order
            inside Method is §7.1's table order, not "every generated page,
            then whatever imports happened to exist". A store with no record
            for the page and no unwithdrawn import of its kind has no such page
            (store-only PLAN §3.3, §5.4).
            """

            if not renderers.record_page_exists(conn, storage, kind):
                return None
            return PagePlan(
                rel_src,
                (lambda t=title, k=kind: renderers.record_page(conn, storage, k, t, warn=self._warn) or ("", {})),
                title=title,
                label=label,
                use_when=use_when,
                group="Method",
                kind="artifact",
            )

        # Static top-level pages, in §7.1's order. `group` is one of
        # `NAV_GROUPS` and nothing else; `subgroup` names a division inside it.
        # A top-level page has no hint: its title says what it holds, and
        # "Use it when" is in the page's "About this page" popover. No page has
        # one: a subsystem's layer is on the line above its title.
        plan.extend(
            page
            for page in [
                PagePlan("index.html", lambda: renderers.render_index(conn, storage, warn=self._warn), title="Overview", label="Overview", use_when="you want to know what the codebase is and what its parts are.", group="Overview", kind="overview"),
                PagePlan("architecture.html", lambda: renderers.render_architecture(conn, storage, warn=self._warn), title="Architecture", label="Architecture", use_when="you want the overall shape before reading any one part.", group="Codebase", kind="architecture"),
                PagePlan("master-plan.html", lambda: renderers.render_master_plan(conn, storage, warn=self._warn), title="Subsystems", label="Subsystems", use_when="you are looking for the part of the code that does something.", group="Codebase", kind="registry"),
                PagePlan("files.html", lambda: renderers.render_files(conn, storage), title="Files", label="Files", use_when="you want to know whether a particular file was read.", group="Codebase", kind="files"),
                PagePlan("not-yet-surveyed.html", lambda: renderers.render_not_yet_surveyed(conn, storage), title="Not yet surveyed", label="Not yet surveyed", use_when="you want to know what the survey has not covered.", group="Codebase", kind="gaps"),
                PagePlan("seams.html", lambda: renderers.render_seams(conn, storage), title="Boundaries", label="Boundaries", use_when="you are changing something two subsystems share.", group="Codebase", kind="seams"),
                PagePlan("vocabulary.html", lambda: renderers.render_vocabulary(conn, storage), title="Glossary", label="Glossary", use_when="a project-specific name is unfamiliar.", group="Codebase", kind="glossary"),
                PagePlan("findings.html", lambda: renderers.render_findings(conn, storage), title="Open findings", label="Open findings", use_when="you want the defects still open.", group="Unresolved", kind="findings"),
                PagePlan("disagreements.html", lambda: renderers.render_disagreements(conn, storage), title="Records that disagree", label="Disagreements", use_when="you want to know where the record contradicts itself.", group="Unresolved", kind="undiscriminated"),
                PagePlan("open-questions.html", lambda: renderers.render_open_questions(conn, storage), title="Decisions needed", label="Decisions needed", use_when="you want to know what the agent needs from you.", group="Unresolved", kind="questions"),
                PagePlan("field-notes.html", lambda: renderers.render_field_notes(conn, storage), title="Leads", label="Leads", use_when="you want things noticed but not yet confirmed.", group="Unresolved", kind="notes"),
                PagePlan("stale.html", lambda: renderers.render_stale(conn, storage), title="Stale knowledge", label="Stale knowledge", use_when="you want to know what may be out of date since the code changed.", group="Unresolved", kind="stale"),
                PagePlan("hot-spots.html", lambda: renderers.render_hot_spots(conn, storage), title="Hot spots", label="Hot spots", use_when="you want to know where open work concentrates.", group="Unresolved", kind="hotspots"),
                PagePlan("resolved-findings.html", lambda: renderers.render_resolved_findings(conn, storage), title="Resolved findings", label="Resolved findings", use_when="you want to know what was fixed or ruled out, and on what basis.", group="History", kind="findings"),
                PagePlan("resolution-history.html", lambda: renderers.render_resolution_history(conn, storage), title="Resolution history", label="Resolution history", use_when="you want to know how a record reached its state.", group="History", kind="timeline"),
                PagePlan("resolved-leads.html", lambda: renderers.render_resolved_leads(conn, storage), title="Resolved leads and questions", label="Resolved leads and questions", use_when="you want to know how a question was answered.", group="History", kind="resolved-leads"),
                PagePlan("sessions.html", lambda: renderers.render_sessions(conn, storage), title="Sessions", label="Sessions", use_when="you want to know when the survey ran.", group="History", kind="sessions"),
                PagePlan("contradictions.html", lambda: renderers.render_contradictions(conn, storage), title="Settled conflicts", label="Settled conflicts", use_when="you want to see how a disagreement was settled.", group="History", kind="contradictions"),
                # The reader's guide is generated from the vocabulary contract
                # and from this plan (§7.8), so it reads `plan` — complete by the
                # time any page is built — rather than a hand-written route list
                # a new page could be left out of.
                PagePlan("how-to-read.html", lambda: renderers.render_how_to_read(conn, storage, _routes(plan)), title="Reader's guide", label="Reader's guide", use_when="a word, an ID or a page is unfamiliar.", group="Method", kind="guide"),
                PagePlan("concerns.html", lambda: renderers.render_concerns(conn, storage), title="Review coverage", label="Review coverage", use_when="you want to know which defect kinds were checked where.", group="Method", kind="coverage"),
                imported("concern-checklist.html", "concern-checklist", "Review checklist", "Review checklist", "you want the list of defect kinds and where it came from."),
                PagePlan("diagnosticity.html", lambda: renderers.render_diagnosticity(conn, storage), title="Competing explanations", label="Competing explanations", use_when="you want to see how a symptom's cause was weighed.", group="Method", kind="diagnosticity"),
                imported("onboarding-report.html", "onboarding-report", "Onboarding record", "Onboarding record", "you want the first pass's decisions about scope and split."),
                imported("entry-point.html", "entry-point", "First reading path", "First reading path", "you want the reading path an earlier session wrote."),
                # The survey's own bookkeeping, moved off the Overview (owner,
                # 2026-11-26): last in Method, where a reader who wants it looks.
                PagePlan("about.html", lambda: renderers.render_about(conn, storage, warn=self._warn), title="About this survey", label="About this survey", use_when="you want to know how much of the code was read, what is open, and when the survey last ran.", group="Method", kind="about"),
            ]
            if page is not None
        )

        # Per-subsystem pages.
        for s in rows(
            conn,
            "SELECT id, name, status, layer, scope, jump_in_reading, notes FROM subsystems ORDER BY id",
        ):
            plan.append(
                PagePlan(
                    path=subsystem_page(s["id"], s["name"]),
                    build=(lambda row=s: renderers.render_subsystem(conn, storage, row, warn=self._warn)),
                    xref_id=s["id"],
                    xref_display=f"{s['id']}",
                    title=s["name"],
                    label=s["name"],
                    # No subheading: the layer is named in the page head beside the
                    # subsystem's id and depth (owner, 2026-11-26).
                    layer=s["layer"] or "",
                    use_when="you have picked a subsystem.",
                    group="Codebase",
                    subgroup="Subsystems",
                    kind="subsystem",
                    status=s["status"],
                )
            )

        # Per-diagnosticity-matrix pages.
        for m in rows(
            conn,
            "SELECT * FROM diagnosticity_sessions ORDER BY id",
        ):
            plan.append(
                PagePlan(
                    path=matrix_page(m["id"]),
                    build=(lambda mm=m: renderers.render_diagnosticity_matrix(conn, storage, mm)),
                    xref_id=f"DM-{m['id']}",
                    xref_display=f"DM-{m['id']}",
                    title=m["symptom"],
                    label=m["symptom"],
                    use_when="you followed a DM- link.",
                    group="Method",
                    subgroup="Evidence matrices",
                    kind="matrix",
                    status=m.get("outcome"),
                )
            )

        return plan

    # ---------------------------------------------------------------------
    def _build_xref_index(self, conn, plan: list[PagePlan]) -> XrefIndex:
        # Database records carry the human definitions. The plan carries the
        # generated copy every page head and the guide's index print (hints,
        # "Use it when" sentences, terms lines): constant prose, so a lowercase
        # ID that is an ordinary word in it ("the part of the code") is not a
        # mention of that subsystem.
        protected = tuple(
            sorted(
                {
                    text
                    for p in plan
                    for text in (p.hint, p.use_when, terms_line(p.path, renderers.page_terms(p.path)))
                    if text and text.strip()
                }
            )
        )
        entries: dict[str, tuple[str, str, str]] = {}

        # Subsystems.
        # A recorded purpose adds its first sentence to the name (§3.7), compacted
        # as every other identifier is; without one the definition is the name.
        purposes = renderers.recorded_purposes(conn, self.storage)
        for s in rows(conn, "SELECT id, name FROM subsystems"):
            entries[s["id"]] = (
                s["id"],
                subsystem_page(s["id"], s["name"]),
                _compact_definition(s["name"], purposes.get(s["id"]))
                if s["id"] in purposes
                else s["name"],
            )

        subsystem_names = {
            s["id"]: s["name"] for s in rows(conn, "SELECT id, name FROM subsystems")
        }

        # Concerns → concerns.html#<lower-code>
        for c in rows(conn, "SELECT code, category, notes FROM concerns"):
            entries[c["code"]] = (
                c["code"],
                f"concerns.html#{c['code'].lower()}",
                _compact_definition(
                    (c["category"] or "Concern").replace("-", " ").title(),
                    c["notes"],
                ),
            )

        # Seams.
        for s in rows(conn, "SELECT id, shared_object, party_a, party_b FROM seams"):
            parties = (
                f"{subsystem_names.get(s['party_a'], s['party_a'])} ↔ "
                f"{subsystem_names.get(s['party_b'], s['party_b'])}"
            )
            entries[s["id"]] = (
                s["id"],
                f"seams.html#{s['id'].lower()}",
                _compact_definition(parties, s["shared_object"]),
            )

        # Findings → the page their resolution state selects (spec §6.2). A
        # resolved finding's full record moves to resolved-findings.html, so
        # routing every id to findings.html would leave each recorded reference
        # pointing at an anchor that no longer exists and the coverage axis
        # reporting cross-link-anchor.
        for f in rows(
            conn,
            """SELECT v.finding_id, v.subsystem_id, v.resolution_state, f.symptom
                 FROM finding_state_current v
                 JOIN findings f ON f.finding_id = v.finding_id""",
        ):
            subsystem = subsystem_names.get(f["subsystem_id"], f["subsystem_id"])
            page = finding_page(f["resolution_state"]) or "findings.html"
            entries[f["finding_id"]] = (
                f["finding_id"],
                f"{page}#{f['finding_id'].lower()}",
                _compact_definition(f"Finding in {subsystem}", f["symptom"]),
            )

        # Diagnosticity matrices.
        for m in rows(conn, "SELECT id, subsystem_id, symptom FROM diagnosticity_sessions"):
            subsystem = subsystem_names.get(
                m["subsystem_id"], m["subsystem_id"] or "codebase"
            )
            entries[f"DM-{m['id']}"] = (
                f"DM-{m['id']}",
                matrix_page(m["id"]),
                _compact_definition(
                    f"Competing explanations in {subsystem}", m["symptom"]
                ),
            )

        # The resolver names a subsystem beside its first mention on a page and
        # introduces a concern code as one (PLAN §2.2 items 3 and 5); it needs
        # each ID's kind for that, and the subsystem's name.
        kinds = dict.fromkeys(subsystem_names, "subsystem")
        kinds.update({c["code"]: "concern" for c in rows(conn, "SELECT code FROM concerns")})
        kinds.update({s["id"]: "seam" for s in rows(conn, "SELECT id FROM seams")})
        kinds.update(
            {f["finding_id"]: "finding" for f in rows(conn, "SELECT finding_id FROM findings")}
        )
        kinds.update(
            {f"DM-{m['id']}": "matrix" for m in rows(conn, "SELECT id FROM diagnosticity_sessions")}
        )
        # A later family overwrites an earlier one's entry for a shared ID, so
        # the kind follows the entry the index kept.
        kinds = {identifier: kinds[identifier] for identifier in entries if identifier in kinds}
        names = {
            identifier: name
            for identifier, name in subsystem_names.items()
            if kinds.get(identifier) == "subsystem"
        }
        return XrefIndex(entries=entries, names=names, kinds=kinds, protected=protected)
