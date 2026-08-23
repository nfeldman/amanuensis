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
from .db import open_ro, row, rows
from .html_projection import SitePage, render_html_projection
from .manifest import (
    MATERIALIZER_VERSION,
    Manifest,
    prune_retired,
    sha256_bytes,
    sources_differ,
)
from .readback import ProjectionVerifier, write_contract
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
    prose = re.sub(r"\s+", " ", prose).strip()
    if prose:
        sentence = re.split(r"(?<=[.!?])\s+", prose, maxsplit=1)[0]
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
    group: str = "Reference"
    kind: str = "reference"
    status: str | None = None


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
    def materialize(self) -> dict[str, Any]:
        conn = open_ro(self.storage / "memory.db")
        try:
            plan = self._plan(conn)
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
            stale = row(conn, "SELECT COUNT(*) AS n FROM entries WHERE stale=1") or {"n": 0}
            workspace_record = self.storage / "workspace_path"
            workspace = self.storage.parent
            if workspace_record.is_file():
                recorded_workspace = workspace_record.read_text().strip()
                if recorded_workspace:
                    workspace = Path(recorded_workspace)
            project_name = workspace.name or "Project"
            onboarding_report = self.storage / "onboarding-report.md"
            if onboarding_report.is_file():
                for line in onboarding_report.read_text().splitlines():
                    if line.startswith("**Codebase**:"):
                        recorded_name = (
                            line.partition(":")[2]
                            .strip()
                            .split(" — ", 1)[0]
                            .strip()
                        )
                        if recorded_name:
                            project_name = recorded_name
                        break
            html_context = {
                **git,
                "project_name": project_name,
                "stale_entry_count": int(stale["n"] or 0),
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
        """Read back an existing projection without rendering or repairing it."""
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
        summary = ProjectionVerifier(self.storage, self.output, expected_paths).verify()
        summary["html_entrypoint"] = str(self.output / "index.html")
        return summary

    # ---------------------------------------------------------------------
    def _plan(self, conn) -> list[PagePlan]:
        storage = self.storage
        plan: list[PagePlan] = []

        # Static top-level pages.
        plan.extend(
            [
                PagePlan("index.md", lambda: renderers.render_index(conn, storage), title="Project overview", label="Overview", hint="Start here for the survey's present state, freshness, and highest-signal routes into the codebase.", group="Orientation", kind="overview"),
                PagePlan("architecture.md", lambda: renderers.render_architecture(conn, storage), title="Architecture at a glance", label="Architecture", hint="Read the runtime shape, subsystem dependencies, boundaries, and stale areas as one connected system.", group="Orientation", kind="architecture"),
                PagePlan("master-plan.md", lambda: renderers.render_master_plan(conn, storage), title="Subsystem map", label="Subsystem map", hint="See every architectural region, how deeply it has been surveyed, and where a reader should enter it.", group="Orientation", kind="registry"),
                PagePlan("findings.md", lambda: renderers.render_findings(conn, storage), title="Confirmed findings", label="Findings", hint="Review defects that survived the evidence and adversarial gates, ordered by impact.", group="Evidence", kind="findings"),
                PagePlan("concerns.md", lambda: renderers.render_concerns(conn, storage), title="Review coverage", label="Review coverage", hint="See which failure modes were tested in each subsystem and the disposition reached for every applicable concern.", group="Evidence", kind="coverage"),
                PagePlan("seams.md", lambda: renderers.render_seams(conn, storage), title="System boundaries", label="System boundaries", hint="Inspect shared objects and ordering assumptions where independently understandable subsystems meet.", group="Evidence", kind="seams"),
                PagePlan("contradictions.md", lambda: renderers.render_contradictions(conn, storage), title="Conflicting evidence", label="Conflicting evidence", hint="Find places where credible records disagree instead of having their differences silently smoothed away.", group="Evidence", kind="contradictions"),
                PagePlan("diagnosticity.md", lambda: renderers.render_diagnosticity(conn, storage), title="Competing explanations", label="Competing explanations", hint="Follow evidence matrices used when more than one concern could explain the same observed symptom.", group="Evidence", kind="diagnosticity"),
                PagePlan("open-questions.md", lambda: renderers.render_open_questions(conn, storage), title="Decisions needed", label="Decisions needed", hint="Work the questions the autonomous survey could not settle safely, including the assumptions used to keep moving.", group="Working record", kind="questions"),
                PagePlan("field-notes.md", lambda: renderers.render_field_notes(conn, storage), title="Field notes", label="Field notes", hint="Browse anomalies, tensions, recurring patterns, and leads that have not yet become confirmed findings.", group="Working record", kind="notes"),
                PagePlan("vocabulary.md", lambda: renderers.render_vocabulary(conn, storage), title="Codebase glossary", label="Codebase glossary", hint="Translate project-native names into the meanings Amanuensis observed in context.", group="Reference", kind="glossary"),
                PagePlan("how-to-read.md", lambda: renderers.render_how_to_read(conn, storage), title="How to read the conspectus", label="Reader's guide", hint="Understand survey depth, evidence quality, findings, contradictions, and the limits on what each state authorizes.", group="Reference", kind="guide"),
            ]
        )

        # Prose passthroughs for canonical artifacts — only if they
        # exist. Each passes through the file with a tiny header if
        # needed.
        for rel_src, out_rel, title, label, hint in (
            ("onboarding-report.md", "onboarding-report.md", "Onboarding record", "Onboarding record", "Review the repository boundary, runtime inventory, and initial decomposition that established this conspectus."),
            ("entry-point.md", "entry-point.md", "Where to begin", "Where to begin", "Use the shortest useful reading path into an unfamiliar codebase before exploring subsystem detail."),
            ("concern-checklist.md", "concern-checklist.md", "Calibrated review checklist", "Review checklist", "See the concern set used to test each subsystem and the provenance of those checks."),
        ):
            if (storage / rel_src).is_file():
                plan.append(
                    PagePlan(
                        out_rel,
                        (lambda r=rel_src, t=title: renderers.passthrough_prose(storage, r, t) or ("", {})),
                        title=title,
                        label=label,
                        hint=hint,
                        group="Reference",
                        kind="artifact",
                    )
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
                    hint=f"Survey record for {s['name']}: scope, reading path, concern review, findings, boundaries, vocabulary, and notes.",
                    group="Subsystems",
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
                    hint="Compare the evidence against each viable explanation and see which contradictions drove the recorded outcome.",
                    group="Evidence matrices",
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

        # Findings → findings.md#<lower-id>
        for f in rows(conn, "SELECT finding_id, subsystem_id, symptom FROM findings"):
            subsystem = subsystem_names.get(f["subsystem_id"], f["subsystem_id"])
            entries[f["finding_id"]] = (
                f["finding_id"],
                f"findings.md#{f['finding_id'].lower()}",
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
