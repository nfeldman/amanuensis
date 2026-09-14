"""Materializer orchestrator.

Public API:
    m = Materializer(storage=..., output=..., force_full=False)
    summary = m.materialize()

The orchestrator:
  1. Opens memory.db read-only.
  2. Discovers all pages that the current DB state requires (static
     + per-subsystem + per-diagnosticity-matrix).
  3. For each page, computes its source hash map via a renderer.
  4. Compares to the on-disk manifest. Only writes the page if the
     sources changed or the file is missing.
  5. Runs a global cross-reference resolver on every written or
     unchanged page whose content_hash changed in the manifest. (If
     nothing changed, we still re-resolve pages whose linked pages
     changed — conservatively we re-run resolver on every page when
     any new page appears or any page is removed.)
  6. Retires pages that no longer have a generator (deletes files,
     drops manifest entries).
  7. Saves the manifest.
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
from .db import VIEW_ABSENT_CAUSE, missing_views, open_ro, row, rows
from .html_projection import (
    SEARCH_INDEX_PATH,
    SitePage,
    UnknownNavGroup,
    assert_nav_groups,
    render_html_projection,
)
from .manifest import (
    MATERIALIZER_VERSION,
    Manifest,
    prune_retired,
    sha256_bytes,
    sources_differ,
)
from .readback import ProjectionVerifier, finding_page, write_contract
from .renderers import RenderResult
from .slugs import matrix_page, subsystem_page
from .xref import XrefIndex, resolve_all

PageFn = Callable[[], RenderResult]


def _github_repository_url(workspace: Path) -> str | None:
    """Return a verified github.com web URL for the workspace's origin."""

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
    patterns = (
        r"^git@github\.com:(?P<path>[^\s]+)$",
        r"^ssh://git@github\.com/(?P<path>[^\s]+)$",
        r"^https?://github\.com/(?P<path>[^\s]+)$",
    )
    for pattern in patterns:
        match = re.match(pattern, remote, re.IGNORECASE)
        if not match:
            continue
        path = re.sub(r"\.git$", "", match.group("path").rstrip("/"), flags=re.IGNORECASE)
        if path.count("/") == 1:
            return f"https://github.com/{path}"
    return None


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
    group: str = "Codebase"
    kind: str = "reference"
    status: str | None = None
    # A named division inside `group` (spec §7.1). Subsystem pages and evidence
    # matrices are families with one page per record, so they render under their
    # own heading rather than flooding the group they belong to.
    subgroup: str = ""


# The route table on the reader's guide is generated from the page plan (§7.8).
# One tuple per planned page, in plan order, carrying only what the guide
# renders — so the guide never reaches into the plan's build closures.
def _routes(plan: list[PagePlan]) -> list[tuple[str, str, str, str, str]]:
    return [
        (p.path, p.label or p.title, p.hint, p.group, p.subgroup) for p in plan
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
    """

    by_path: dict[str, list[dict[str, Any]]] = {}
    for entry in rows(
        conn,
        "SELECT file_path, subsystem_id, standing_state FROM file_standing"
        " ORDER BY file_path, subsystem_id",
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
    ) -> None:
        self.storage = storage
        self.output = output
        self.force_full = force_full
        self.verify_readback = verify_readback
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

            # Render each page if sources changed.
            rendered: list[str] = []
            for p in plan:
                try:
                    text, sources = p.build()
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
                new_hash = sha256_bytes(text.encode("utf-8"))
                prev = self.manifest.page(p.path)
                abs_out = self.output / p.path
                # Force re-render if version bumped.
                version_drift = self.manifest.version != MATERIALIZER_VERSION
                needs = (
                    self.force_full
                    or version_drift
                    or not abs_out.is_file()
                    or sources_differ(prev.sources, sources)
                    or prev.content_hash != new_hash
                )
                if needs:
                    abs_out.parent.mkdir(parents=True, exist_ok=True)
                    abs_out.write_text(text)
                    prev.sources = sources
                    prev.content_hash = new_hash
                    prev.rendered_at = datetime.now(UTC).strftime(
                        "%Y-%m-%dT%H:%M:%SZ"
                    )
                    rendered.append(p.path)
                else:
                    self.summary.pages_unchanged += 1

            # Build the global xref index once, then run the resolver over
            # every alive page. We re-resolve on every page even if its
            # content didn't change, because a *different* page changing
            # can change which IDs resolve to what (e.g., new subsystem
            # added → IDs previously unresolved now link).
            index = self._build_xref_index(conn, plan)
            alive = {p.path for p in plan}
            self.summary.xref_updates = resolve_all(self.output, alive, index)

            # Retire pages that used to exist but no longer have a plan.
            self.summary.pages_retired = prune_retired(
                self.manifest, alive, self.output
            )
            self.summary.pages_rendered = len(rendered)

            # HTML is a first-class reading surface, derived from the final
            # post-xref Markdown bytes.  Its shared navigation is rebuilt from
            # the complete page plan so names, statuses, and routes cannot
            # drift independently.
            git = row(conn, "SELECT * FROM git_state WHERE repo_id='default'") or {}
            # The freshness strip reads `file_ledger`, under the same names
            # `get_dashboard` returns, so the two readings cannot disagree about
            # the same store (§11.2). The `entries`-derived count it replaced was
            # a zero-denominator green: no code path writes that table (B03-2).
            freshness = renderers.ledger_freshness(conn)
            # Identity resolution lives beside the renderer that publishes it, so
            # the HTML shell and the overview cannot name the project differently.
            workspace = renderers.resolve_workspace(self.storage)
            project_name = renderers.project_name(self.storage)
            html_context = {
                **git,
                "project_name": project_name,
                "stale_entries": freshness["stale_obligation"],
                "stale_exempt": freshness["stale_exempt"],
                "scoped_files": freshness["scoped_files"],
                "staleness_measured": freshness["scoped_files"] > 0,
                "repository_url": _github_repository_url(workspace),
                "identifier_definitions": {
                    identifier: definition
                    for identifier, (_display, _target, definition) in index.entries.items()
                },
            }
            site_pages = [
                SitePage(
                    markdown_path=p.path,
                    title=p.title,
                    label=p.label or p.title,
                    hint=p.hint,
                    group=p.group,
                    subgroup=p.subgroup,
                    kind=p.kind,
                    record_id=p.xref_id,
                    status=p.status,
                )
                for p in plan
            ]
            html_result = render_html_projection(
                self.output,
                site_pages,
                html_context,
                previous_files=self.manifest.projection_files,
                locus_index=_locus_index(conn),
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
            # after global xref resolution — the bytes a reader will see.
            expected_paths = sorted(alive | set(html_result.files))
            write_contract(self.output, expected_paths)
            if self.verify_readback:
                self.summary.readback = ProjectionVerifier(
                    self.storage, self.output, expected_paths
                ).verify()
                if not self.summary.readback["ok"]:
                    self.summary.ok = False

            return {
                "ok": self.summary.ok,
                "output_dir": str(self.output),
                "html_entrypoint": str(self.output / "index.html"),
                "pages_total": self.summary.pages_total,
                "pages_rendered": self.summary.pages_rendered,
                "pages_unchanged": self.summary.pages_unchanged,
                "pages_retired": self.summary.pages_retired,
                "xref_updates": self.summary.xref_updates,
                "html_pages_total": self.summary.html_pages_total,
                "html_pages_rendered": self.summary.html_pages_rendered,
                "html_pages_unchanged": self.summary.html_pages_unchanged,
                "html_pages_retired": self.summary.html_pages_retired,
                "warnings": self.summary.warnings,
                "readback": self.summary.readback,
            }
        finally:
            conn.close()

    def verify_projection(self) -> dict[str, Any]:
        """Read back an existing projection without rendering or repairing it.

        The page plan names the Markdown pages and their HTML companions; it
        does not name the generated artifacts a render produces beside them, so
        `manifest.projection_files` is read as well (§8.2). Without it the
        coverage axis would report `search-index.js` as an unplanned file the
        moment the inventory learned to see it — a read-back that turns red on
        a correct projection is worse than one that never looked.
        """
        conn = open_ro(self.storage / "memory.db")
        try:
            plan = self._plan(conn)
            expected_paths = [
                rel
                for p in plan
                for rel in (p.path, str(Path(p.path).with_suffix(".html")).replace("\\", "/"))
            ]
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

        def passthrough(rel_src: str, title: str, label: str, hint: str) -> PagePlan | None:
            """One canonical artifact, passed through when it is on disk.

            Planned inline rather than in a trailing loop so the rail's order
            inside Method is §7.1's table order, not "every generated page,
            then whatever prose happened to exist".
            """

            if not (storage / rel_src).is_file():
                return None
            return PagePlan(
                rel_src,
                (lambda r=rel_src, t=title: renderers.passthrough_prose(storage, r, t) or ("", {})),
                title=title,
                label=label,
                hint=hint,
                group="Method",
                kind="artifact",
            )

        # Static top-level pages, in §7.1's order. `group` is one of
        # `NAV_GROUPS` and nothing else; `subgroup` names a division inside it.
        # Every hint opens with the clause §7.1 fixes for it, so the rail, the
        # page's own description meta, and the table a reviewer reads say the
        # same thing.
        plan.extend(
            page
            for page in [
                PagePlan("index.md", lambda: renderers.render_index(conn, storage, warn=self._warn), title="Project overview", label="Overview", hint="", group="Overview", kind="overview"),
                PagePlan("architecture.md", lambda: renderers.render_architecture(conn, storage), title="Architecture at a glance", label="Architecture", hint="Runtime shape, recorded edges, and boundaries, read as one connected system.", group="Codebase", kind="architecture"),
                PagePlan("master-plan.md", lambda: renderers.render_master_plan(conn, storage), title="Subsystem map", label="Subsystems", hint="Every region, grouped by layer, with the scope recorded for it.", group="Codebase", kind="registry"),
                PagePlan("files.md", lambda: renderers.render_files(conn, storage), title="Files", label="Files", hint="One row per ledger file with owners, standing, and open defects.", group="Codebase", kind="files"),
                PagePlan("not-yet-surveyed.md", lambda: renderers.render_not_yet_surveyed(conn, storage), title="Not yet surveyed", label="Not yet surveyed", hint="The recorded edge of the map, each gap counted over the unit it occupies.", group="Codebase", kind="gaps"),
                PagePlan("seams.md", lambda: renderers.render_seams(conn, storage), title="System boundaries", label="System boundaries", hint="Shared objects and ordering assumptions where independently understandable subsystems meet.", group="Codebase", kind="seams"),
                PagePlan("vocabulary.md", lambda: renderers.render_vocabulary(conn, storage), title="Codebase glossary", label="Codebase glossary", hint="The project's own names, with the meanings Amanuensis observed in context.", group="Codebase", kind="glossary"),
                PagePlan("findings.md", lambda: renderers.render_findings(conn, storage), title="Open findings", label="Open findings", hint="Defects open or awaiting verification at the checked revision.", group="Unresolved", kind="findings"),
                PagePlan("disagreements.md", lambda: renderers.render_disagreements(conn, storage), title="Records that disagree", label="Disagreements", hint="Where credible records disagree or the evidence does not discriminate between them.", group="Unresolved", kind="undiscriminated"),
                PagePlan("open-questions.md", lambda: renderers.render_open_questions(conn, storage), title="Decisions needed", label="Decisions needed", hint="Questions the survey could not settle, with the assumption used to keep moving.", group="Unresolved", kind="questions"),
                PagePlan("field-notes.md", lambda: renderers.render_field_notes(conn, storage), title="Leads", label="Leads", hint="Open observations that are not yet findings.", group="Unresolved", kind="notes"),
                PagePlan("stale.md", lambda: renderers.render_stale(conn, storage), title="Stale knowledge", label="Stale knowledge", hint="Examined files the repository has changed under, and scoped files that changed before anyone read them.", group="Unresolved", kind="stale"),
                PagePlan("hot-spots.md", lambda: renderers.render_hot_spots(conn, storage), title="Hot spots", label="Hot spots", hint="Where unresolved work and unread territory concentrate, as separate measures.", group="Unresolved", kind="hotspots"),
                PagePlan("resolved-findings.md", lambda: renderers.render_resolved_findings(conn, storage), title="Resolved findings", label="Resolved findings", hint="Verified, ruled out, and accepted, each with the basis its resolution rests on.", group="History", kind="findings"),
                PagePlan("resolution-history.md", lambda: renderers.render_resolution_history(conn, storage), title="Resolution history", label="Resolution history", hint="The append-only account of how records reached their state.", group="History", kind="timeline"),
                PagePlan("resolved-leads.md", lambda: renderers.render_resolved_leads(conn, storage), title="Resolved leads and questions", label="Resolved leads and questions", hint="Questions that were answered or dismissed, and leads that were closed.", group="History", kind="resolved-leads"),
                PagePlan("sessions.md", lambda: renderers.render_sessions(conn, storage), title="Sessions and publications", label="Sessions and publications", hint="What ran, when, and what it produced.", group="History", kind="sessions"),
                PagePlan("contradictions.md", lambda: renderers.render_contradictions(conn, storage), title="Conflicting evidence", label="Conflicting evidence", hint="Resolved disagreements and the evidence that settled them.", group="History", kind="contradictions"),
                # The reader's guide is generated from the vocabulary contract
                # and from this plan (§7.8), so it reads `plan` — complete by the
                # time any page is built — rather than a hand-written route list
                # a new page could be left out of.
                PagePlan("how-to-read.md", lambda: renderers.render_how_to_read(conn, storage, _routes(plan)), title="How to read the conspectus", label="Reader's guide", hint="", group="Method", kind="guide"),
                PagePlan("concerns.md", lambda: renderers.render_concerns(conn, storage), title="Review coverage", label="Review coverage", hint="Which failure modes were tested where, and the disposition each one reached.", group="Method", kind="coverage"),
                passthrough("concern-checklist.md", "Calibrated review checklist", "Review checklist", "The concern set and its provenance."),
                PagePlan("diagnosticity.md", lambda: renderers.render_diagnosticity(conn, storage), title="Competing explanations", label="Competing explanations", hint="Index of evidence matrices and their outcomes.", group="Method", kind="diagnosticity"),
                passthrough("onboarding-report.md", "Onboarding record", "Onboarding record", "The repository boundary and initial decomposition that established this conspectus."),
                passthrough("entry-point.md", "Where to begin", "Where to begin", "A dated reading path recorded by an earlier session; it is survey history, not a current index."),
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
                    build=(lambda row=s: renderers.render_subsystem(conn, storage, row)),
                    xref_id=s["id"],
                    xref_display=f"{s['id']}",
                    title=s["name"],
                    label=s["name"],
                    hint=f"Scope, structure, boundaries, defects, and the survey record for {s['name']}.",
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
                    hint="One matrix: the evidence against each viable explanation, and the outcome it drove.",
                    group="Method",
                    subgroup="Evidence matrices",
                    kind="matrix",
                    status=m.get("outcome"),
                )
            )

        return plan

    # ---------------------------------------------------------------------
    def _build_xref_index(self, conn, plan: list[PagePlan]) -> XrefIndex:
        del plan  # database records carry the human definitions
        entries: dict[str, tuple[str, str, str]] = {}

        # Subsystems.
        for s in rows(conn, "SELECT id, name FROM subsystems"):
            entries[s["id"]] = (
                s["id"],
                subsystem_page(s["id"], s["name"]),
                s["name"],
            )

        subsystem_names = {
            s["id"]: s["name"] for s in rows(conn, "SELECT id, name FROM subsystems")
        }

        # Concerns → concerns.md#<lower-code>
        for c in rows(conn, "SELECT code, category, notes FROM concerns"):
            entries[c["code"]] = (
                c["code"],
                f"concerns.md#{c['code'].lower()}",
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
                f"seams.md#{s['id'].lower()}",
                _compact_definition(parties, s["shared_object"]),
            )

        # Findings → the page their resolution state selects (spec §6.2). A
        # resolved finding's full record moves to resolved-findings.md, so
        # routing every id to findings.md would leave each recorded reference
        # pointing at an anchor that no longer exists and the coverage axis
        # reporting cross-link-anchor.
        for f in rows(
            conn,
            """SELECT v.finding_id, v.subsystem_id, v.resolution_state, f.symptom
                 FROM finding_state_current v
                 JOIN findings f ON f.finding_id = v.finding_id""",
        ):
            subsystem = subsystem_names.get(f["subsystem_id"], f["subsystem_id"])
            page = finding_page(f["resolution_state"]) or "findings.md"
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

        return XrefIndex(entries=entries)
