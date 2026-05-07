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

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from . import renderers
from .db import open_ro, rows
from .manifest import (
    MATERIALIZER_VERSION,
    Manifest,
    prune_retired,
    sha256_bytes,
    sources_differ,
)
from .renderers import RenderResult
from .slugs import matrix_page, subsystem_page
from .xref import XrefIndex, resolve_all

PageFn = Callable[[], RenderResult]


@dataclass
class PagePlan:
    """One page the materializer intends to produce."""

    path: str
    build: PageFn
    xref_id: str | None = None
    xref_display: str | None = None


@dataclass
class Summary:
    ok: bool = True
    output_dir: str = ""
    pages_total: int = 0
    pages_rendered: int = 0
    pages_unchanged: int = 0
    pages_retired: list[str] = field(default_factory=list)
    xref_updates: int = 0
    warnings: list[str] = field(default_factory=list)


class Materializer:
    def __init__(self, storage: Path, output: Path, force_full: bool = False) -> None:
        self.storage = storage
        self.output = output
        self.force_full = force_full
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
                except Exception as e:  # pragma: no cover — surface but don't crash
                    self.summary.warnings.append(f"renderer failed for {p.path}: {e!r}")
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
            # Adjust unchanged count if xref resolution wrote to them.
            self.manifest.version = MATERIALIZER_VERSION
            self.manifest.save(self.manifest_path)

            return {
                "ok": True,
                "output_dir": str(self.output),
                "pages_total": self.summary.pages_total,
                "pages_rendered": self.summary.pages_rendered,
                "pages_unchanged": self.summary.pages_unchanged,
                "pages_retired": self.summary.pages_retired,
                "xref_updates": self.summary.xref_updates,
                "warnings": self.summary.warnings,
            }
        finally:
            conn.close()

    # ---------------------------------------------------------------------
    def _plan(self, conn) -> list[PagePlan]:
        storage = self.storage
        plan: list[PagePlan] = []

        # Static top-level pages.
        plan.append(PagePlan("index.md", lambda: renderers.render_index(conn, storage)))
        plan.append(PagePlan("architecture.md", lambda: renderers.render_architecture(conn, storage)))
        plan.append(PagePlan("master-plan.md", lambda: renderers.render_master_plan(conn, storage)))
        plan.append(PagePlan("findings.md", lambda: renderers.render_findings(conn, storage)))
        plan.append(PagePlan("concerns.md", lambda: renderers.render_concerns(conn, storage)))
        plan.append(PagePlan("seams.md", lambda: renderers.render_seams(conn, storage)))
        plan.append(PagePlan("contradictions.md", lambda: renderers.render_contradictions(conn, storage)))
        plan.append(PagePlan("diagnosticity.md", lambda: renderers.render_diagnosticity(conn, storage)))
        plan.append(PagePlan("vocabulary.md", lambda: renderers.render_vocabulary(conn, storage)))
        plan.append(PagePlan("field-notes.md", lambda: renderers.render_field_notes(conn, storage)))
        plan.append(PagePlan("open-questions.md", lambda: renderers.render_open_questions(conn, storage)))

        # Prose passthroughs for canonical artifacts — only if they
        # exist. Each passes through the file with a tiny header if
        # needed.
        for rel_src, out_rel, title in (
            ("onboarding-report.md", "onboarding-report.md", "Onboarding report"),
            ("entry-point.md", "entry-point.md", "Entry point"),
            ("concern-checklist.md", "concern-checklist.md", "Concern checklist (calibrated)"),
        ):
            if (storage / rel_src).is_file():
                plan.append(
                    PagePlan(
                        out_rel,
                        (lambda r=rel_src, t=title: renderers.passthrough_prose(storage, r, t) or ("", {})),
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
                )
            )

        return plan

    # ---------------------------------------------------------------------
    def _build_xref_index(self, conn, plan: list[PagePlan]) -> XrefIndex:
        entries: dict[str, tuple[str, str]] = {}

        # Subsystems.
        for s in rows(conn, "SELECT id, name FROM subsystems"):
            entries[s["id"]] = (s["id"], subsystem_page(s["id"], s["name"]))

        # Concerns → concerns.md#<lower-code>
        for c in rows(conn, "SELECT code FROM concerns"):
            entries[c["code"]] = (c["code"], f"concerns.md#{c['code'].lower()}")

        # Seams.
        for s in rows(conn, "SELECT id FROM seams"):
            entries[s["id"]] = (s["id"], "seams.md")

        # Findings → findings.md#<lower-id>
        for f in rows(conn, "SELECT finding_id FROM findings"):
            entries[f["finding_id"]] = (f["finding_id"], f"findings.md#{f['finding_id'].lower()}")

        # Diagnosticity matrices.
        for m in rows(conn, "SELECT id FROM diagnosticity_sessions"):
            entries[f"DM-{m['id']}"] = (f"DM-{m['id']}", matrix_page(m["id"]))

        return XrefIndex(entries=entries)
