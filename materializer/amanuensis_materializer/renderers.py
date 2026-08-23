"""Page renderers — each function returns (markdown_text, sources_dict).

The sources dict maps source identifiers to their content hashes so the
manifest can detect when to re-render. DB sources are keyed as
`db:<logical-name>:<filter>` and prose sources as `prose:<rel-path>`.

Renderers are deliberately parallel — no shared state — so the
orchestrator can call them in any order.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from hashlib import sha256
from pathlib import Path
from typing import Any

from .db import row, rows
from .diagrams import (
    concern_coverage_heatmap,
    runtime_boundary_placeholder,
    seam_graph,
    staleness_map,
    subsystem_dependency_graph,
)
from .manifest import sha256_bytes, sha256_json
from .readback import finding_marker, stale_marker
from .slugs import matrix_slug

RenderResult = tuple[str, dict[str, str]]


def _fmt_time(ts: str | None) -> str:
    if not ts:
        return "—"
    try:
        dt = datetime.fromisoformat(ts.replace(" ", "T"))
        return dt.strftime("%Y-%m-%d %H:%M UTC")
    except ValueError:
        return ts


def _badge(status: str) -> str:
    return {
        "mapped": "🟢 mapped",
        "adversarial": "🟡 adversarial",
        "concerns": "🟡 concerns",
        "structural": "🟠 structural",
        "scoping": "🔵 scoping",
        "unmapped": "⚪ unmapped",
        "deferred": "⚫ deferred",
    }.get(status, f"· {status}")


def _sev_badge(sev: str) -> str:
    return {
        "CRITICAL": "🔴 CRITICAL",
        "HIGH": "🟠 HIGH",
        "MEDIUM": "🟡 MEDIUM",
        "LOW": "🔵 LOW",
    }.get(sev, sev)


def _prose_source(storage: Path, rel: str) -> dict[str, str]:
    p = storage / rel
    if not p.is_file():
        return {}
    return {f"prose:{rel}": sha256_bytes(p.read_bytes())}


def _db_source(name: str, data: Any) -> dict[str, str]:
    return {f"db:{name}": sha256_json(data)}


# ---------------------------------------------------------------------------
# Index / dashboard / architecture
# ---------------------------------------------------------------------------


def render_index(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    git = row(conn, "SELECT * FROM git_state WHERE repo_id='default'") or {}
    subs = rows(conn, "SELECT id, name, status, layer FROM subsystems ORDER BY id")
    findings_summary = rows(
        conn,
        "SELECT COUNT(*) AS total, SUM(CASE WHEN status='confirmed-bug' THEN 1 ELSE 0 END) AS open_bugs,"
        " SUM(CASE WHEN severity='CRITICAL' THEN 1 ELSE 0 END) AS crit,"
        " SUM(CASE WHEN severity='HIGH' THEN 1 ELSE 0 END) AS high"
        " FROM findings",
    )[0]
    stale_rows = rows(conn, "SELECT id, tier FROM entries WHERE stale=1 ORDER BY id, tier")
    stale = {"n": len(stale_rows)}
    open_notes = row(
        conn, "SELECT COUNT(*) AS n FROM field_notes WHERE follow_up='open'"
    ) or {"n": 0}
    unresolved = row(
        conn, "SELECT COUNT(*) AS n FROM contradictions WHERE resolution='unresolved'"
    ) or {"n": 0}

    mapped = sum(1 for s in subs if s["status"] == "mapped")
    total = len(subs)

    # Prefer the entry-point prose for the quick-orientation paragraph
    # if present.
    entry_point_path = storage / "entry-point.md"
    quick_orient = "_Onboarding has not been run yet — run the Amanuensis coordinator to generate the conspectus foundation._"
    if entry_point_path.is_file():
        text = entry_point_path.read_text()
        # Extract the first non-header paragraph as a quick orientation.
        in_para = False
        para: list[str] = []
        for line in text.splitlines():
            if line.startswith("#"):
                if para:
                    break
                continue
            if line.strip() == "":
                if in_para:
                    break
                continue
            in_para = True
            para.append(line.strip())
        if para:
            quick_orient = " ".join(para)

    latest_session = row(
        conn,
        "SELECT intent, started_at, ended_at FROM sessions ORDER BY started_at DESC LIMIT 1",
    )

    out = [
        "# Conspectus",
        "",
        f"**Canonical branch**: `{git.get('canonical_branch', '—')}`  ",
        f"**Onboarding SHA**: `{(git.get('onboarding_sha') or '—')[:12]}`  ",
        f"**Last checked SHA**: `{(git.get('last_checked_sha') or '—')[:12]}`",
        "",
        "## Quick orientation",
        "",
        quick_orient,
        "",
        "## Current state",
        "",
        "| Metric | Value |",
        "|---|---|",
        f"| Subsystems mapped | {mapped} / {total} |",
        f"| Confirmed findings | {findings_summary['total'] or 0} ({findings_summary['crit'] or 0} critical, {findings_summary['high'] or 0} high) |",
        f"| Open bugs | {findings_summary['open_bugs'] or 0} |",
        f"| Stale entries | {stale['n']} |",
        f"| Open field notes | {open_notes['n']} |",
        f"| Unresolved contradictions | {unresolved['n']} |",
        "",
        *[stale_marker(str(e["id"]), int(e["tier"])) for e in stale_rows],
        "" if stale_rows else "",
        "## Navigation",
        "",
        "New here? Start with [How to read this conspectus](how-to-read.md).",
        "",
        "- [Architecture →](architecture.md) — runtime topology, subsystem dependency graph, seam map",
        "- [Subsystems →](master-plan.md) — what's mapped, what isn't, with status badges",
        "- [Findings →](findings.md) — confirmed issues by severity",
        "- [Concerns →](concerns.md) — the calibrated checklist with coverage heatmap",
        "- [Seams →](seams.md) — inter-subsystem boundaries",
        "- [Contradictions →](contradictions.md) — unresolved epistemic conflicts",
        "- [Diagnosticity matrices →](diagnosticity.md) — when concerns compete (ACH)",
        "- [Glossary →](vocabulary.md) — the codebase's own language",
        "- [Field notes →](field-notes.md) — patterns, anomalies, tensions, candidate concerns",
        "- [Open questions →](open-questions.md) — items an autoprogress run logged for human review",
    ]
    if latest_session:
        out.extend(
            [
                "",
                "## Latest session",
                "",
                f"`{latest_session['intent']}` — started {_fmt_time(latest_session['started_at'])}"
                + (f" · ended {_fmt_time(latest_session['ended_at'])}" if latest_session["ended_at"] else " · **active**"),
            ]
        )
    text = "\n".join(out) + "\n"
    sources = {
        **_db_source("index:git", git),
        **_db_source("index:subs", subs),
        **_db_source("index:findings", findings_summary),
        **_db_source("index:stale", stale),
        **_db_source("index:stale-objects", stale_rows),
        **_db_source("index:notes", open_notes),
        **_db_source("index:unresolved", unresolved),
        **_db_source("index:session", latest_session or {}),
        **_prose_source(storage, "entry-point.md"),
    }
    return text, sources


def render_architecture(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    xrefs = rows(conn, "SELECT * FROM xrefs ORDER BY from_id")
    subs = rows(conn, "SELECT id, name, status FROM subsystems ORDER BY id")
    seams = rows(conn, "SELECT id, shared_object, party_a, party_b FROM seams ORDER BY id")
    out = [
        "# Architecture",
        "",
        "## Runtime boundary map",
        "",
        runtime_boundary_placeholder(),
        "",
        "## Subsystem dependency graph" if xrefs else "## Subsystem atlas",
        "",
        subsystem_dependency_graph(conn),
        "",
        "## Seam topology",
        "",
        seam_graph(conn),
        "",
        "## Staleness map",
        "",
        staleness_map(conn),
    ]
    sources = {
        **_db_source("arch:xrefs", xrefs),
        **_db_source("arch:subs", subs),
        **_db_source("arch:seams", seams),
        **_prose_source(storage, "onboarding-report.md"),
    }
    return "\n".join(out) + "\n", sources


# ---------------------------------------------------------------------------
# Master plan & subsystems
# ---------------------------------------------------------------------------


def render_master_plan(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    # Attempt a priority-aware query; fall back to the legacy shape on a
    # pre-migration DB where the column doesn't exist yet.
    try:
        subs = rows(
            conn,
            "SELECT id, name, status, layer, scope, jump_in_reading, notes, priority "
            "FROM subsystems ORDER BY layer, CASE WHEN priority IS NULL THEN 1 ELSE 0 END, priority, id",
        )
    except sqlite3.OperationalError:
        subs = rows(
            conn,
            "SELECT id, name, status, layer, scope, jump_in_reading, notes FROM subsystems "
            "ORDER BY layer, id",
        )
        for s in subs:
            s["priority"] = None
    finds = rows(
        conn,
        "SELECT subsystem_id, COUNT(*) AS n, SUM(CASE WHEN status='confirmed-bug' THEN 1 ELSE 0 END) AS open_bugs FROM findings GROUP BY subsystem_id",
    )
    finds_by_ss = {f["subsystem_id"]: f for f in finds}

    if not subs:
        body = ["_No subsystems registered yet. Run the Amanuensis coordinator to onboard._"]
    else:
        # Group by layer.
        layers: dict[str, list[dict[str, Any]]] = {}
        for s in subs:
            layers.setdefault(s["layer"] or "unlayered", []).append(s)
        body = []
        for layer, items in layers.items():
            body.append(f"## {layer}")
            body.append("")
            body.append("| Priority | ID | Name | Status | Scope | Jump-in | Findings |")
            body.append("|---|---|---|---|---|---|---|")
            for s in items:
                f = finds_by_ss.get(s["id"], {"n": 0, "open_bugs": 0})
                priority = "—" if s.get("priority") is None else str(s["priority"])
                body.append(
                    f"| {priority} | **{s['id']}** | {s['name']} | {_badge(s['status'])} | "
                    f"{(s['scope'] or '—').replace('|', '/')} | "
                    f"{(s['jump_in_reading'] or '—').replace('|', '/')} | "
                    f"{f['n']} ({f.get('open_bugs', 0)} open) |"
                )
            body.append("")
    text = "# Master plan\n\n" + "\n".join(body) + "\n"
    return text, _db_source("master-plan:subs", subs) | _db_source("master-plan:finds", finds)


def render_subsystem(conn: sqlite3.Connection, storage: Path, s: dict[str, Any]) -> RenderResult:
    sid = s["id"]
    files = rows(
        conn,
        "SELECT file_path, why_in_scope, classification, ref_sha FROM file_ledger WHERE subsystem_id = ? ORDER BY classification, file_path",
        (sid,),
    )
    dispositions = rows(
        conn,
        """
        SELECT d.*, c.category
        FROM dispositions d JOIN concerns c ON c.code = d.concern_code
        WHERE d.subsystem_id = ?
        ORDER BY d.concern_code
        """,
        (sid,),
    )
    findings = rows(
        conn,
        "SELECT * FROM findings WHERE subsystem_id = ? ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 END, finding_id",
        (sid,),
    )
    vocab = rows(
        conn,
        "SELECT term, gloss FROM vocabulary WHERE subsystem_id = ? ORDER BY term",
        (sid,),
    )
    xrefs = rows(
        conn,
        "SELECT from_id, to_id, relationship, strength, context FROM xrefs WHERE from_id = ? OR to_id = ? ORDER BY relationship",
        (sid, sid),
    )
    seams = rows(
        conn,
        "SELECT id, shared_object, party_a, party_b FROM seams WHERE party_a = ? OR party_b = ? ORDER BY id",
        (sid, sid),
    )

    # The per-subsystem survey artifact — hand-authored markdown lives in
    # storage root as <ID>-<slug>.md or similar. We look for any registered
    # artifact with kind='subsystem-survey' and this subsystem_id.
    survey_rows = rows(
        conn,
        "SELECT path, content_hash FROM artifacts WHERE kind = 'subsystem-survey' AND subsystem_id = ?",
        (sid,),
    )
    survey_prose = ""
    prose_sources: dict[str, str] = {}
    for sv in survey_rows:
        prose_path = storage / sv["path"]
        if prose_path.is_file():
            survey_prose += prose_path.read_text() + "\n\n"
            prose_sources.update(_prose_source(storage, sv["path"]))

    out = [
        f"# {sid} — {s['name']}",
        "",
        f"**Status**: {_badge(s['status'])}  ",
        f"**Layer**: {s.get('layer') or '—'}",
        "",
    ]
    if s.get("scope"):
        out += ["## Scope", "", s["scope"], ""]
    if s.get("jump_in_reading"):
        out += ["## Start here", "", s["jump_in_reading"], ""]
    if s.get("notes"):
        out += ["## Notes", "", s["notes"], ""]

    if files:
        out += ["## File ledger", "", "| Path | Classification | Why in scope | Ref SHA |", "|---|---|---|---|"]
        for f in files:
            out.append(
                f"| `{f['file_path']}` | {f['classification'] or '—'} | {f['why_in_scope'] or '—'} | "
                f"`{(f['ref_sha'] or '—')[:8]}` |"
            )
        out.append("")

    if dispositions:
        out += [
            "## Concern review",
            "",
            "| Concern | Classification | Evidence quality | Linchpin? | Rationale |",
            "|---|---|---|---|---|",
        ]
        for d in dispositions:
            lp = "🔗" if d["linchpin_dependent"] else ""
            out.append(
                f"| **{d['concern_code']}** | {d['classification']} | {d['evidence_quality']} | "
                f"{lp} | {(d['rationale'] or '—').replace('|', '/')} |"
            )
        out.append("")

    if findings:
        out += ["## Findings", ""]
        for f in findings:
            files_cited = json.loads(f["primary_files"]) if f["primary_files"] else []
            out += [
                f"### {f['finding_id']} · {_sev_badge(f['severity'])} · {f['status']}",
                "",
                f"**Symptom**: {f['symptom']}  ",
                f"**Root cause**: {f['root_cause']}",
                "",
            ]
            if f.get("business_context"):
                out += [f"_Business context_: {f['business_context']}", ""]
            if files_cited:
                out += ["**Primary files**:"]
                for fc in files_cited:
                    out.append(f"- `{fc}`")
                out.append("")

    if xrefs:
        out += [
            "## Related subsystems",
            "",
            "| From | → | To | Relationship | Strength | Context |",
            "|---|---|---|---|---|---|",
        ]
        for x in xrefs:
            out.append(
                f"| **{x['from_id']}** | → | **{x['to_id']}** | {x['relationship']} | "
                f"{x['strength']} | {(x['context'] or '—').replace('|', '/')} |"
            )
        out.append("")

    if seams:
        out += ["## Seams", "", "| Seam | Shared object | Other party |", "|---|---|---|"]
        for sm in seams:
            other = sm["party_b"] if sm["party_a"] == sid else sm["party_a"]
            out.append(f"| **{sm['id']}** | {sm['shared_object']} | **{other}** |")
        out.append("")

    if vocab:
        out += ["## Vocabulary", ""]
        for v in vocab:
            out.append(f"- **{v['term']}** — {v['gloss']}")
        out.append("")

    if survey_prose:
        out += ["## Survey notes", "", survey_prose]

    text = "\n".join(out).rstrip() + "\n"
    sources: dict[str, str] = (
        _db_source(f"subsystem:{sid}:row", s)
        | _db_source(f"subsystem:{sid}:files", files)
        | _db_source(f"subsystem:{sid}:disp", dispositions)
        | _db_source(f"subsystem:{sid}:findings", findings)
        | _db_source(f"subsystem:{sid}:vocab", vocab)
        | _db_source(f"subsystem:{sid}:xrefs", xrefs)
        | _db_source(f"subsystem:{sid}:seams", seams)
        | prose_sources
    )
    return text, sources


# ---------------------------------------------------------------------------
# Findings, concerns, seams, contradictions, diagnosticity, vocabulary, notes
# ---------------------------------------------------------------------------


def render_findings(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    fs = rows(
        conn,
        """SELECT f.*,
                  COALESCE(r.resolution_state,
                    CASE f.status WHEN 'fixed' THEN 'fixed-pending-verification'
                                  WHEN 'ruled-out' THEN 'ruled-out'
                                  WHEN 'confirmed-acceptable' THEN 'accepted'
                                  ELSE 'open' END) AS resolution_state,
                  r.fix_sha, r.evidence_id AS resolution_evidence_id
             FROM findings f
             LEFT JOIN finding_resolution_current r ON r.finding_id=f.finding_id
            ORDER BY CASE f.severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1
                       WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 END,
                     f.subsystem_id, f.finding_id""",
    )
    out = ["# Findings", ""]
    if not fs:
        out.append("_No confirmed findings yet._")
    else:
        # By severity, then sub-grouped by subsystem.
        for sev in ("CRITICAL", "HIGH", "MEDIUM", "LOW"):
            sev_rows = [f for f in fs if f["severity"] == sev]
            if not sev_rows:
                continue
            out += [f"## {_sev_badge(sev)} ({len(sev_rows)})", ""]
            out += [
                "| ID | Subsystem | Status | Symptom | Root cause | Ref SHA |",
                "|---|---|---|---|---|---|",
            ]
            for f in sev_rows:
                out.append(finding_marker(str(f["finding_id"])))
                out.append(
                    f"| <a id=\"{f['finding_id'].lower()}\"></a>**{f['finding_id']}** | "
                    f"**{f['subsystem_id']}** | {f['resolution_state']} | "
                    f"{f['symptom'].replace('|', '/')} | {f['root_cause'].replace('|', '/')} | "
                    f"`{(f['ref_sha'] or '—')[:8]}` |"
                )
            out.append("")
    return "\n".join(out) + "\n", _db_source("findings:all", fs)


def render_concerns(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    cs = rows(
        conn,
        "SELECT code, category, origin, status, discovered_in, notes FROM concerns ORDER BY status, code",
    )
    out = ["# Concerns", "", "## Coverage overview", "", concern_coverage_heatmap(conn), ""]
    active = [c for c in cs if c["status"] == "active"]
    retired = [c for c in cs if c["status"] in ("retired", "merged")]
    if active:
        out += ["## Active concerns", "", "| Code | Category | Origin | Discovered in | Notes |", "|---|---|---|---|---|"]
        for c in active:
            out.append(
                f"| <a id=\"{c['code'].lower()}\"></a>**{c['code']}** | {c['category'] or '—'} | "
                f"{c['origin']} | {c['discovered_in'] or '—'} | {(c['notes'] or '').replace('|', '/')} |"
            )
        out.append("")
    if retired:
        out += ["## Retired/merged concerns", ""]
        for c in retired:
            out.append(f"- **{c['code']}** — {c['status']} · {c['notes'] or ''}")
        out.append("")
    return "\n".join(out) + "\n", _db_source("concerns:all", cs) | _db_source(
        "concerns:disp", rows(conn, "SELECT * FROM dispositions")
    ) | _db_source("concerns:subs", rows(conn, "SELECT id FROM subsystems"))


def render_seams(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    seams = rows(conn, "SELECT * FROM seams ORDER BY id")
    assess = rows(conn, "SELECT * FROM seam_assessability")
    asmap = {a["seam_id"]: a for a in assess}
    out = ["# Seams", "", seam_graph(conn), ""]
    if not seams:
        out.append("_No seams recorded yet._")
    else:
        out += [
            "| Seam | Shared object | Kind | Parties | Assessable? | Notes |",
            "|---|---|---|---|---|---|",
        ]
        for s in seams:
            a = asmap.get(s["id"], {})
            assessable = "✅" if a.get("assessable") else "⏳"
            parties = f"**{s['party_a']}** ↔ **{s['party_b']}**"
            out.append(
                f"| <a id=\"{s['id'].lower()}\"></a>**{s['id']}** | {s['shared_object']} | {s['shared_object_kind'] or '—'} | "
                f"{parties} | {assessable} | {(s['notes'] or '').replace('|', '/')} |"
            )
        out.append("")
    return "\n".join(out) + "\n", _db_source("seams:all", seams) | _db_source("seams:assess", assess)


def render_contradictions(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    cs = rows(
        conn,
        "SELECT * FROM contradictions ORDER BY CASE resolution WHEN 'unresolved' THEN 0 ELSE 1 END, detected_at DESC",
    )
    out = ["# Contradictions", ""]
    unresolved = [c for c in cs if c["resolution"] == "unresolved"]
    resolved = [c for c in cs if c["resolution"] != "unresolved"]
    out.append(
        "_Contradictions are the conspectus's epistemic honesty surface — when two findings "
        "about the same code disagree, we record the disagreement explicitly instead of silently "
        "choosing one. Unresolved contradictions are a priority signal for the adversarial pass._"
    )
    out.append("")
    if unresolved:
        out += [
            "## Unresolved",
            "",
            "| Finding A | Finding B | Shared location | Conflict type | Detected |",
            "|---|---|---|---|---|",
        ]
        for c in unresolved:
            out.append(
                f"| **{c['finding_a']}** | **{c['finding_b']}** | "
                f"`{c['shared_location'] or '—'}` | {c['conflict_type']} | "
                f"{_fmt_time(c['detected_at'])} |"
            )
        out.append("")
    if resolved:
        out += [
            "## Resolved",
            "",
            "| Finding A | Finding B | Resolution | Scope note |",
            "|---|---|---|---|",
        ]
        for c in resolved:
            out.append(
                f"| **{c['finding_a']}** | **{c['finding_b']}** | {c['resolution']} | "
                f"{(c['scope_note'] or '—').replace('|', '/')} |"
            )
        out.append("")
    if not cs:
        out.append("_No contradictions recorded._")
    return "\n".join(out) + "\n", _db_source("contradictions:all", cs)


def render_diagnosticity(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    matrices = rows(
        conn,
        "SELECT id, subsystem_id, symptom, outcome, leading_concern, created_at FROM diagnosticity_sessions ORDER BY created_at DESC",
    )
    out = [
        "# Diagnosticity matrices",
        "",
        "_When two or more concerns could each explain the same symptom, we open a "
        "[diagnosticity matrix](https://en.wikipedia.org/wiki/Analysis_of_competing_hypotheses) "
        "and evaluate evidence row-by-row across the competing concerns. Evidence consistent "
        "with all concerns has zero diagnostic value; evidence that contradicts only one is "
        "decisive. We rank by inconsistency — the concern with the most contradicting evidence "
        "is rejected first. Linchpin evidence (single-point-of-failure for the leading "
        "hypothesis) is flagged explicitly._",
        "",
    ]
    if not matrices:
        out.append("_No diagnosticity matrices recorded._")
    else:
        out += [
            "| ID | Subsystem | Symptom | Outcome | Leading concern | Opened |",
            "|---|---|---|---|---|---|",
        ]
        for m in matrices:
            mid = f"DM-{m['id']}"
            out.append(
                f"| [**{mid}**](diagnosticity/{matrix_slug(m['id'])}.md) | "
                f"**{m['subsystem_id'] or '—'}** | {(m['symptom'] or '').replace('|', '/')} | "
                f"{m['outcome']} | {m['leading_concern'] or '—'} | "
                f"{_fmt_time(m['created_at'])} |"
            )
        out.append("")
    return "\n".join(out) + "\n", _db_source("diagnosticity:index", matrices)


def render_diagnosticity_matrix(
    conn: sqlite3.Connection, storage: Path, m: dict[str, Any]
) -> RenderResult:
    mid = m["id"]
    concerns = rows(
        conn,
        "SELECT concern_code, rank, eliminated FROM diagnosticity_concerns WHERE matrix_id = ? ORDER BY COALESCE(rank, 999), concern_code",
        (mid,),
    )
    evidence = rows(
        conn,
        """
        SELECT de.row_order, e.id, e.file_path, e.symbol, e.kind, e.note, e.excerpt, e.ref_sha
          FROM diagnosticity_evidence de JOIN evidence e ON e.id = de.evidence_id
         WHERE de.matrix_id = ?
         ORDER BY de.row_order
        """,
        (mid,),
    )
    cells = rows(
        conn,
        "SELECT concern_code, evidence_id, verdict, note FROM diagnosticity_cells WHERE matrix_id = ?",
        (mid,),
    )
    value = rows(
        conn,
        "SELECT evidence_id, n_contradicts, n_consistent, n_irrelevant, n_ambiguous FROM diagnosticity_evidence_value WHERE matrix_id = ?",
        (mid,),
    )
    cell_map = {(c["concern_code"], c["evidence_id"]): c for c in cells}
    value_map = {v["evidence_id"]: v for v in value}

    def _cell_emoji(verdict: str | None) -> str:
        return {
            "consistent": "✓",
            "contradicts": "✗",
            "irrelevant": "·",
            "ambiguous": "~",
        }.get(verdict or "", "—")

    out = [
        f"# DM-{mid} · {m['symptom']}",
        "",
        f"**Subsystem**: **{m['subsystem_id'] or '—'}**  ",
        f"**Shared location**: `{m['shared_location'] or '—'}`  ",
        f"**Outcome**: {m['outcome']}",
    ]
    if m.get("leading_concern"):
        out.append(f"**Leading concern**: **{m['leading_concern']}**  ")
    if m.get("linchpin_note"):
        out.append(f"**Linchpin note**: {m['linchpin_note']}")
    out += ["", "## Matrix", ""]
    if not concerns or not evidence:
        out.append("_Matrix has no concerns or evidence rows._")
    else:
        # Header: evidence row x concerns
        header = "| Evidence | " + " | ".join(f"**{c['concern_code']}**" for c in concerns) + " | Diagnostic value |"
        sep = "|---|" + "|".join(["---"] * len(concerns)) + "|---|"
        out += [header, sep]
        for e in evidence:
            loc = f"`{e['file_path']}`"
            if e["symbol"]:
                loc += f" · `{e['symbol']}`"
            loc += f" · _{e['kind']}_"
            cells_row = [
                _cell_emoji(cell_map.get((c["concern_code"], e["id"]), {}).get("verdict"))
                for c in concerns
            ]
            v = value_map.get(e["id"], {})
            dv = f"{v.get('n_contradicts', 0)}✗ / {v.get('n_consistent', 0)}✓"
            out.append(f"| {loc} | " + " | ".join(cells_row) + f" | {dv} |")
        out += ["", "**Cell legend**: ✓ consistent · ✗ contradicts · · irrelevant · ~ ambiguous", ""]

    if evidence:
        out += ["## Evidence detail", ""]
        for e in evidence:
            out.append(f"### Evidence #{e['id']}")
            out.append("")
            out.append(f"`{e['file_path']}` · `{e.get('symbol') or '—'}` · _{e['kind']}_ · ref `{(e['ref_sha'] or '')[:8]}`")
            if e.get("excerpt"):
                out += ["", "```", e["excerpt"], "```"]
            if e.get("note"):
                out.append("")
                out.append(f"_{e['note']}_")
            out.append("")

    text = "\n".join(out) + "\n"
    sources = (
        _db_source(f"matrix:{mid}:session", m)
        | _db_source(f"matrix:{mid}:concerns", concerns)
        | _db_source(f"matrix:{mid}:evidence", evidence)
        | _db_source(f"matrix:{mid}:cells", cells)
        | _db_source(f"matrix:{mid}:value", value)
    )
    return text, sources


def render_vocabulary(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    terms = rows(
        conn,
        "SELECT term, gloss, expansion, subsystem_id, first_seen FROM vocabulary ORDER BY COALESCE(subsystem_id, ''), term",
    )
    out = ["# Glossary", ""]
    if not terms:
        out.append("_No vocabulary recorded._")
    else:
        # Codebase-wide first, then grouped by subsystem.
        global_terms = [t for t in terms if not t["subsystem_id"]]
        scoped = [t for t in terms if t["subsystem_id"]]
        if global_terms:
            out += ["## Codebase-wide", ""]
            for t in global_terms:
                out.append(f"### {t['term']}")
                out += ["", f"_{t['gloss']}_"]
                if t.get("expansion"):
                    out += ["", t["expansion"]]
                if t.get("first_seen"):
                    out += ["", f"First seen: `{t['first_seen']}`"]
                out.append("")
        if scoped:
            # Group by subsystem_id.
            by_ss: dict[str, list[dict[str, Any]]] = {}
            for t in scoped:
                by_ss.setdefault(t["subsystem_id"], []).append(t)
            for sid, items in by_ss.items():
                out += [f"## Scoped to **{sid}**", ""]
                for t in items:
                    out.append(f"- **{t['term']}** — {t['gloss']}")
                out.append("")
    return "\n".join(out) + "\n", _db_source("vocab:all", terms)


def render_field_notes(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    notes = rows(
        conn,
        "SELECT * FROM field_notes ORDER BY created_at DESC",
    )
    out = [
        "# Field notes",
        "",
        "_Peripheral observations from every survey pass. Agents record patterns, anomalies, "
        "connections, tensions, and candidate concerns here when they notice something the "
        "phase structure does not ask for. The memory-auditor agent periodically reviews open "
        "notes for promotion to findings or dismissal._",
        "",
    ]
    if not notes:
        out.append("_No field notes recorded._")
    else:
        by_cat: dict[str, list[dict[str, Any]]] = {}
        for n in notes:
            by_cat.setdefault(n["category"], []).append(n)
        for cat in ("tension", "anomaly", "candidate-concern", "connection", "pattern"):
            items = by_cat.get(cat, [])
            if not items:
                continue
            out += [f"## {cat.replace('-', ' ').title()} ({len(items)})", ""]
            for n in items:
                state = "**OPEN**" if n["follow_up"] == "open" else f"→ {n['follow_up']}"
                loc = f" @ `{n['location']}`" if n["location"] else ""
                out.append(
                    f"- [{state}] {n['observation']}{loc} · _{_fmt_time(n['created_at'])}_"
                )
            out.append("")
    return "\n".join(out) + "\n", _db_source("notes:all", notes)


def render_how_to_read(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    """The reader's guide. Identical for every conspectus — Amanuensis
    explains how to read its own output so a stranger landing on the
    site understands the vocabulary and the epistemic guarantees
    without having to read the methodology upstream.

    This page is intentionally static (not DB-derived). It is declared
    as a synthetic source so the materializer's diff-aware re-render
    won't touch it unless the renderer itself changes — which is what
    we want.
    """
    del conn  # unused — content is static apart from optional provenance
    body = HOW_TO_READ_BODY
    for optional in ("provenance.md", "entry-point.md"):
        if not (storage / optional).is_file():
            body = body.replace(f"[`{optional}`]({optional})", f"`{optional}`")
    return body, {
        "synthetic:how-to-read": _hash_text(body),
        **_prose_source(storage, "provenance.md"),
        **_prose_source(storage, "entry-point.md"),
    }


HOW_TO_READ_BODY = """\
# How to read this conspectus

An Amanuensis conspectus is a **persistent, evidence-driven
architectural record** of a codebase. This site is the human-facing
view; behind it sits a SQLite database every claim on the site was
generated from. Every assertion carries provenance: who said it, when,
against what commit, with what evidence, at what depth of survey.

This page is shipped automatically with every conspectus. Read it
once; you won't need to read it again.

## What to look at first

| If you're here because… | Start here |
|---|---|
| You've never seen this project before | [`entry-point.md`](entry-point.md) → [`master-plan.md`](master-plan.md) |
| You're investigating a specific bug | [`findings.md`](findings.md), filtered by severity |
| You want to understand the architecture | [`architecture.md`](architecture.md), then a subsystem page |
| You're evaluating how trustworthy this is | [`open-questions.md`](open-questions.md), [`contradictions.md`](contradictions.md), [`diagnosticity.md`](diagnosticity.md) |
| You want to reproduce or extend the survey | [`provenance.md`](provenance.md) (if present) + the repo's git log |

## Reading the status badges

Every subsystem carries a **status** that defines what claims about
it you should accept. This is the knowledge-depth contract — the
methodology's most important epistemic guardrail.

| Status | What claims are authorized |
|---|---|
| `unmapped` | **None.** No assertions about behavior. |
| `scoping` | File scope only: "F is in scope for S." No behavioral claims. |
| `structural` | Types, state containers, data flows, concurrency model. **No correctness claims.** |
| `concerns` | Concern review with evidence. Findings at evidence_quality ≥ code-verified. |
| `adversarial` | As above, plus findings survived attempted refutation. **Highest confidence.** |
| `mapped` | Complete. Seam contracts filled in. Ready for composition with mapped peers. |
| `deferred` | Orthogonal flag: "do not survey yet." Not a knowledge level. |

If you see a confident-sounding claim about a subsystem that is still
`structural`, that's a methodology violation — treat the claim as
speculation. The server enforces this at write time, but readers are
the final check.

## Reading evidence quality

Every disposition and every finding carries an `evidence_quality`
tag that describes how solid the underlying observation is. Higher
quality supports stronger claims.

| Quality | What it means |
|---|---|
| `code-verified` | The reviewer read the code and confirmed the behavior. Strongest. |
| `contract-stated` | An explicit contract (type signature, schema, docstring with semantics) asserts the behavior. |
| `comment-asserted` | A code comment claims the behavior, but the code was not verified against the claim. |
| `name-inferred` | Inferred from a symbol's name (e.g. `sanitizeInput` must sanitize). Weak; needs adversarial review. |
| `pattern-matched` | Fits a pattern we've seen elsewhere. Weakest; used only as a scoping signal. |

Any finding classified `confirmed-bug` should rest on
`code-verified` or `contract-stated` evidence. If you see a
confirmed-bug with `name-inferred` evidence that survived adversarial
review, that's a flag to look closely — either the adversarial pass
was inadequate or the reviewer genuinely had no better evidence and
flagged the finding as linchpin-dependent.

## Reading finding severity

Severity reflects impact, not confidence.

| Severity | Typical shape |
|---|---|
| `CRITICAL` | Data loss, security hole, privilege escalation, production outage path. |
| `HIGH` | Incorrect behavior on a common code path; corrupt state; wedged queues. |
| `MEDIUM` | Incorrect behavior on an edge case; correctness issue with a known workaround. |
| `LOW` | Readability/maintainability; defensive-coding gaps; would bite a future change. |

## Reading finding status

After adversarial review, each finding carries one of:

| Status | What it means |
|---|---|
| `confirmed-bug` | The bug is real at the surveyed commit, survived refutation. |
| `confirmed-acceptable` | The behavior exists but is the intended design — documented as such. |
| `ruled-out` | Claim was made but adversarial review overturned it. Record preserved so future analysts don't re-tread the same ground. |
| `fixed` | Confirmed at the surveyed commit; a later commit has addressed it. |

Note that `ruled-out` findings stay in the record. That's a feature,
not dead wood — if somebody reads a later version of the code and
starts to form the same suspicion, the overturn argument is already
written down.

## Reading open questions

If the conspectus was produced by the autoprogress coordinator
(cloud mode), [`open-questions.md`](open-questions.md) is the queue
of things the agent could not answer without human input. Each entry
records:

- the **question** (what the agent couldn't decide)
- **what it blocked** (the classification or decision that was held up)
- **what the agent assumed** (the best-available interpretation it
  proceeded with)

A small open-question queue, mostly in the `priority-ranking` or
`scope-judgment` categories, means the run was confident. A large
queue weighted toward `domain-knowledge` or `contradiction` means
the survey is walking on thin ice — treat its findings with more
skepticism and plan a focused human pass on those subsystems.

## Reading contradictions

[`contradictions.md`](contradictions.md) pairs findings that make
incompatible claims about the same `file:symbol@sha`. The conspectus
preserves these rather than smoothing them away; an unresolved
contradiction is the most honest thing a survey can say about a
genuinely ambiguous situation.

Resolutions:

- `a-supersedes-b` / `b-supersedes-a` — one claim is now considered
  correct; the other stays on record for traceability.
- `scope-distinction` — both claims are right, about different
  scopes (different inputs, different code paths). The `scope_note`
  explains.
- `unresolved` — the evidence genuinely does not disambiguate.

If you see `unresolved`, that's the survey telling you: "two
credible readings, no way to choose between them yet." That is
information.

## Reading diagnosticity matrices

When two or more concerns could independently explain the same
observable symptom in a subsystem, the coordinator opens a matrix
(the Analysis of Competing Hypotheses pattern). The matrix's columns
are the competing concerns; its rows are pieces of evidence; each
cell records whether that evidence is `consistent`, `contradicts`,
`irrelevant`, or `ambiguous` for that concern.

The methodology ranks concerns by **inconsistency** — the one with
the most contradicting evidence is rejected first — rather than by
supporting evidence, because an evidence base consistent with all
competing explanations tells you nothing. The `leading_concern` on
a resolved matrix is the surviving best explanation; the
`linchpin_note` identifies the single piece of evidence the
resolution most depends on (and therefore the one a reviewer should
re-verify first).

Matrices that resolve to `unresolved-competition` are analogous to
unresolved contradictions: a legitimate terminal state when the
evidence does not disambiguate.

## Provenance

If the conspectus ships with a [`provenance.md`](provenance.md)
page, that is the chronological event log: sessions in order,
findings within sessions in order, with commit SHAs and timestamps.
It's the evidence that the survey was run in the order it claims —
not retroactively curated.

Combined with the git log of the conspectus repo itself (every
phase gate is a commit; every commit is timestamped), provenance is
the strongest claim the methodology can make about its own honesty.

## Reproducing what you're reading

Anyone with:

- the surveyed codebase's commit SHA (the `ref_sha` on findings and
  evidence),
- the Amanuensis version that ran the survey (captured in commit
  messages on the conspectus repo), and
- sufficient API budget to drive an LLM through the same phases

…can replay the survey and see whether their conclusions overlap
with these. Non-determinism in the LLM means the two runs won't be
identical; structural overlap is the expected property, and the
[`compare_conspectuses`](https://github.com/search?q=compare_conspectuses)
tool in the Amanuensis server measures it.

## If something here looks wrong

Say so. The conspectus treats reader-surfaced disagreement as a
first-class signal: a reviewer who disagrees with a finding should
open an issue against this conspectus repo; the next survey session
records the disagreement as a field note or converts it into a
diagnosticity matrix if the reviewer's argument looks credible
enough to compete with the existing finding.

A methodology that refuses to hear its readers is one that should
not be trusted.
"""


def _hash_text(s: str) -> str:
    return sha256(s.encode("utf-8")).hexdigest()[:16]


def render_open_questions(conn: sqlite3.Connection, storage: Path) -> RenderResult:
    """Queue of items the autoprogress coordinator could not decide
    without human input. In cloud runs this page IS the human's
    intervention point — a reviewer works through the open entries,
    answers what they can, and dismisses what's no longer relevant.
    """
    del storage  # unused — kept for renderer signature uniformity
    # Include resolved rows too, grouped separately, so the page serves
    # as an audit trail after review.
    questions = rows(
        conn,
        "SELECT * FROM open_questions ORDER BY resolution = 'open' DESC, created_at DESC",
    )
    out = [
        "# Open questions",
        "",
        "_Items the autoprogress coordinator could not decide without human input. "
        "Each entry records the question, what the agent could not do because of it, "
        "and what assumption (if any) the agent proceeded with. Close out via "
        "`resolve_open_question` once answered; the reviewer's answers can feed back "
        "into a `reset_subsystem` + re-survey if the assumption turned out wrong._",
        "",
    ]
    if not questions:
        out.append("_No open questions recorded. Either the survey is pristine, or it hasn't run yet._")
        return "\n".join(out) + "\n", _db_source("open_questions:all", questions)

    by_state: dict[str, list[dict[str, Any]]] = {"open": [], "other": []}
    for q in questions:
        by_state["open" if q["resolution"] == "open" else "other"].append(q)

    if by_state["open"]:
        out += [f"## Open ({len(by_state['open'])})", ""]
        # Group by category within open — the reviewer usually wants to
        # batch similar questions.
        by_cat: dict[str, list[dict[str, Any]]] = {}
        for q in by_state["open"]:
            by_cat.setdefault(q["category"], []).append(q)
        category_order = (
            "contradiction",
            "domain-knowledge",
            "scope-judgment",
            "ambiguous-evidence",
            "priority-ranking",
            "tooling-limit",
            "other",
        )
        for cat in category_order:
            items = by_cat.get(cat, [])
            if not items:
                continue
            out += [f"### {cat.replace('-', ' ').title()} ({len(items)})", ""]
            for q in items:
                loc = f" · subsystem `{q['subsystem_id']}`" if q["subsystem_id"] else ""
                phase = f" · phase `{q['phase']}`" if q["phase"] else ""
                out.append(f"#### #{q['id']}{loc}{phase}")
                out.append("")
                out.append(f"> {q['question']}")
                out.append("")
                if q["what_blocked"]:
                    out.append(f"- **What this blocked:** {q['what_blocked']}")
                if q["what_assumed"]:
                    out.append(f"- **Assumption the agent proceeded with:** {q['what_assumed']}")
                out.append(f"- _recorded {_fmt_time(q['created_at'])}_")
                out.append("")

    if by_state["other"]:
        out += [f"## Resolved ({len(by_state['other'])})", ""]
        out += ["| # | Category | Question | Resolution | Answer |", "|---|---|---|---|---|"]
        for q in by_state["other"]:
            answer = (q["answer"] or "").replace("|", "\\|").replace("\n", " ") if q["answer"] else ""
            qtxt = q["question"].replace("|", "\\|").replace("\n", " ")
            out.append(f"| #{q['id']} | {q['category']} | {qtxt} | {q['resolution']} | {answer} |")
        out.append("")

    return "\n".join(out) + "\n", _db_source("open_questions:all", questions)


# ---------------------------------------------------------------------------
# Prose passthroughs (onboarding report, entry-point, concern-checklist)
# ---------------------------------------------------------------------------


def passthrough_prose(storage: Path, rel_source: str, title: str) -> RenderResult | None:
    p = storage / rel_source
    if not p.is_file():
        return None
    body = p.read_text()
    # Prepend a banner only if the source doesn't already start with #.
    if not body.lstrip().startswith("#"):
        body = f"# {title}\n\n{body}"
    return body, _prose_source(storage, rel_source)
