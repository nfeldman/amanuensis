"""Independent read-back checks for a materialized conspectus.

The renderer is a projection, never the system of record.  This verifier reads
the durable database and the finished files independently along three axes:

* state: authoritative objects have exactly one durable marker in the output;
* coverage: every planned page and recorded local cross-link is present;
* content: finished page bytes match the post-xref publication receipt.

The receipt is intentionally post-processing-aware.  The older incremental
manifest hashes pre-xref renderer output and therefore cannot prove the bytes a
reader actually sees.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

from .db import open_ro, row, rows, table_exists
from .manifest import sha256_bytes
from .vocabulary import (
    OBLIGATION_BEARING_CLASSIFICATIONS,
    OBLIGATION_BEARING_SQL,
    values_of,
)

CONTRACT_NAME = ".projection-contract.json"
CONTRACT_VERSION = "2"
LINK_RE = re.compile(r"\[[^\]]*\]\(([^)]+)\)")
HTML_SUFFIXES = {".html", ".htm"}

# Lens membership for a finding, defined once (spec §6.1) and read by the
# renderer, the cross-reference index, and the census below.  A finding renders
# as a full marked record on exactly one of these pages; every other surface
# links to it.  The order is the page order a reader meets.
FINDING_LENS_PAGES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("Unresolved", "findings.md", ("open", "fixed-pending-verification")),
    ("History", "resolved-findings.md", ("verified-fixed", "ruled-out", "accepted")),
)

FINDING_PAGE_BY_STATE: dict[str, str] = {
    state: page for _lens, page, states in FINDING_LENS_PAGES for state in states
}


def finding_page(resolution_state: str | None) -> str | None:
    """The page a finding in this resolution state renders on, or None."""
    return FINDING_PAGE_BY_STATE.get(str(resolution_state or ""))


def finding_marker(finding_id: str) -> str:
    token = hashlib.sha256(finding_id.encode("utf-8")).hexdigest()
    return f"<!-- amanuensis:finding:{token} -->"


def stale_marker(entry_id: str, tier: int) -> str:
    token = hashlib.sha256(f"{entry_id}:{tier}".encode()).hexdigest()
    return f"<!-- amanuensis:stale-entry:{token} -->"


# Where a stale ledger row is recorded, and under which heading (spec §6.1,
# §6.2, §11.3).  Defined once and read by the renderer and the census below.
#
# The partition is over the obligation-bearing classifications, not over
# staleness: `detect_changes` marks drift on every row that carries a `ref_sha`
# regardless of classification, so a file nobody has read can be stale.  Saying
# so under "Examined files the repository has changed under" would assert a
# reading the ledger does not record, which is why a `candidate` row is
# reported under its own heading with its own denominator (C60), and why
# `deferred-with-reason` gets a third heading rather than being folded into
# either of the other two.
LEDGER_STALE_PAGE = "stale.md"

LEDGER_STALE_SECTIONS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Examined files the repository has changed under", ("examined",)),
    ("Scoped but unread, and changed since scoping", ("candidate",)),
    (
        "Deferred files that changed after they were set aside",
        ("deferred-with-reason",),
    ),
)

LEDGER_STALE_HEADING_BY_CLASSIFICATION: dict[str, str] = {
    classification: heading
    for heading, classifications in LEDGER_STALE_SECTIONS
    for classification in classifications
}


def _ledger_row_token(subsystem_id: str, file_path: str) -> str:
    """One digest per `(subsystem_id, file_path)`, the ledger's own key.

    The NUL separator keeps the pair unambiguous: no path or subsystem id may
    contain it, so two different rows cannot produce one token by concatenating
    to the same string.
    """

    return hashlib.sha256(f"{subsystem_id}\x00{file_path}".encode()).hexdigest()


def ledger_stale_marker(subsystem_id: str, file_path: str) -> str:
    """The durable marker for one stale `file_ledger` row (§11.3)."""

    return f"<!-- amanuensis:ledger-stale:{_ledger_row_token(subsystem_id, file_path)} -->"


def ledger_stale_anchor(subsystem_id: str, file_path: str) -> str:
    """A collision-resistant anchor for that row's record (§7.4).

    `slugify` collapses every run of non-`[a-z0-9-]` characters, so
    `src/a/b.ts`, `src/a-b.ts`, and `src/a.b.ts` would share one anchor. The
    digest does not, and the readable path stays beside it as link text.
    """

    return f"ls-{_ledger_row_token(subsystem_id, file_path)[:10]}"


class _HtmlInventory(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[str] = []
        self.anchors: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if values.get("id"):
            self.anchors.add(str(values["id"]))
        if tag == "a" and values.get("href"):
            self.links.append(str(values["href"]))


def _links(text: str, suffix: str) -> list[str]:
    if suffix in HTML_SUFFIXES:
        parser = _HtmlInventory()
        parser.feed(text)
        return parser.links
    return LINK_RE.findall(text)


def _anchors(text: str, suffix: str) -> set[str]:
    if suffix in HTML_SUFFIXES:
        parser = _HtmlInventory()
        parser.feed(text)
        return parser.anchors
    anchors = set(re.findall(r'<a\s+id="([^"]+)"', text))
    # GitHub-style heading anchors are a useful fallback for authored prose.
    for heading in re.findall(r"^#{1,6}\s+(.+?)\s*$", text, flags=re.MULTILINE):
        value = re.sub(r"[`*_\[\]()]", "", heading).lower()
        value = re.sub(r"[^a-z0-9 -]", "", value)
        value = re.sub(r"[\s-]+", "-", value).strip("-")
        if value:
            anchors.add(value)
    return anchors


def _local_links(text: str, suffix: str = ".md") -> list[str]:
    return [
        target
        for target in _links(text, suffix)
        if not target.startswith(("http://", "https://", "mailto:", "#"))
    ]


def write_contract(output: Path, page_paths: list[str]) -> dict[str, Any]:
    pages: list[dict[str, Any]] = []
    links: list[dict[str, str]] = []
    for rel in sorted(page_paths):
        path = output / rel
        if not path.is_file():
            continue
        body = path.read_text()
        pages.append({"path": rel, "content_hash": sha256_bytes(path.read_bytes())})
        links.extend(
            {"source": rel, "target": target}
            for target in _local_links(body, path.suffix.lower())
        )
    contract = {
        "version": CONTRACT_VERSION,
        "pages": pages,
        "local_links": sorted(links, key=lambda x: (x["source"], x["target"])),
    }
    (output / CONTRACT_NAME).write_text(json.dumps(contract, indent=2) + "\n")
    return contract


class ProjectionVerifier:
    def __init__(self, storage: Path, output: Path, expected_pages: list[str]) -> None:
        self.storage = storage
        self.output = output
        self.expected_pages = sorted(expected_pages)

    def verify(self) -> dict[str, Any]:
        mismatches: list[dict[str, str]] = []
        contract_path = self.output / CONTRACT_NAME
        contract: dict[str, Any] = {}
        if not contract_path.is_file():
            for axis in ("state", "coverage", "content"):
                mismatches.append(
                    {
                        "axis": axis,
                        "object_type": "projection-contract",
                        "object_id": CONTRACT_NAME,
                        "detail": "publication receipt is missing",
                    }
                )
            return self._summary(mismatches)
        try:
            contract = json.loads(contract_path.read_text())
        except (json.JSONDecodeError, OSError) as exc:
            for axis in ("state", "coverage", "content"):
                mismatches.append(
                    {
                        "axis": axis,
                        "object_type": "projection-contract",
                        "object_id": CONTRACT_NAME,
                        "detail": f"publication receipt is unreadable: {exc}",
                    }
                )
            return self._summary(mismatches)

        projection = {
            str(path.relative_to(self.output)): path.read_text()
            for pattern in ("*.md", "*.html")
            for path in self.output.rglob(pattern)
            if path.is_file()
        }

        # State correspondence comes from the DB, not from the renderer or its
        # receipt.  A missing or duplicated marker is independently visible.
        conn = open_ro(self.storage / "memory.db")
        try:
            findings = rows(conn, "SELECT finding_id FROM findings ORDER BY finding_id")
            stale = rows(conn, "SELECT id, tier FROM entries WHERE stale=1 ORDER BY id, tier")
            mismatches.extend(self._finding_partition_census(conn, projection))
            mismatches.extend(self._ledger_stale_census(conn, projection))
        finally:
            conn.close()
        # The Markdown and HTML views must each carry authoritative markers.
        # One healthy format cannot mask drift in its companion.
        for suffix, label in ((".md", "markdown"), (".html", "html")):
            format_text = "\n".join(
                body for rel, body in projection.items() if Path(rel).suffix == suffix
            )
            for finding in findings:
                marker = finding_marker(str(finding["finding_id"]))
                count = format_text.count(marker)
                if count != 1:
                    mismatches.append(
                        {
                            "axis": "state",
                            "object_type": "finding" if label == "markdown" else "finding-html",
                            "object_id": str(finding["finding_id"]),
                            "detail": f"expected exactly one {label} state marker, found {count}",
                        }
                    )
            for stale_row in stale:
                marker = stale_marker(str(stale_row["id"]), int(stale_row["tier"]))
                count = format_text.count(marker)
                if count != 1:
                    mismatches.append(
                        {
                            "axis": "state",
                            "object_type": "stale-entry" if label == "markdown" else "stale-entry-html",
                            "object_id": f"{stale_row['id']}:{stale_row['tier']}",
                            "detail": f"expected exactly one {label} stale marker, found {count}",
                        }
                    )

        # Coverage compares both the current page plan and the link receipt to
        # the completed output.  This catches retired/missing pages and links
        # stripped after xref resolution.
        actual_pages = sorted(projection)
        expected_set = set(self.expected_pages)
        actual_set = set(actual_pages)
        for rel in sorted(expected_set - actual_set):
            mismatches.append(
                {
                    "axis": "coverage",
                    "object_type": "page",
                    "object_id": rel,
                    "detail": "planned page is missing",
                }
            )
        for rel in sorted(actual_set - expected_set):
            mismatches.append(
                {
                    "axis": "coverage",
                    "object_type": "page",
                    "object_id": rel,
                    "detail": "unplanned page remains in the clean projection",
                }
            )

        expected_links = Counter(
            (str(link["source"]), str(link["target"])) for link in contract.get("local_links", [])
        )
        actual_links = Counter(
            (source, target)
            for source, body in projection.items()
            for target in _local_links(body, Path(source).suffix.lower())
        )
        for (source, target), expected_count in sorted(expected_links.items()):
            actual_count = actual_links[(source, target)]
            if actual_count < expected_count:
                mismatches.append(
                    {
                        "axis": "coverage",
                        "object_type": "cross-link",
                        "object_id": f"{source}->{target}",
                        "detail": f"expected {expected_count} occurrence(s), found {actual_count}",
                    }
                )
            target_path = target.split("#", 1)[0]
            if target_path:
                resolved = (self.output / source).parent.joinpath(target_path).resolve()
                try:
                    resolved.relative_to(self.output.resolve())
                except ValueError:
                    exists = False
                else:
                    exists = resolved.is_file()
                if not exists:
                    mismatches.append(
                        {
                            "axis": "coverage",
                            "object_type": "cross-link-target",
                            "object_id": f"{source}->{target}",
                            "detail": "local link target does not resolve inside the projection",
                        }
                    )
                elif "#" in target:
                    fragment = target.split("#", 1)[1]
                    target_rel = str(resolved.relative_to(self.output.resolve()))
                    target_text = projection.get(target_rel)
                    if target_text is None:
                        try:
                            target_text = resolved.read_text()
                        except OSError:
                            target_text = ""
                    if fragment not in _anchors(target_text, resolved.suffix.lower()):
                        mismatches.append(
                            {
                                "axis": "coverage",
                                "object_type": "cross-link-anchor",
                                "object_id": f"{source}->{target}",
                                "detail": "local link fragment does not resolve to an anchor",
                            }
                        )

        # Content is a byte-for-byte drift check against the post-xref receipt.
        # It proves projection correspondence, not the semantic truth of the DB.
        for page in contract.get("pages", []):
            rel = str(page["path"])
            path = self.output / rel
            if not path.is_file():
                continue  # coverage already owns this diagnostic
            actual_hash = sha256_bytes(path.read_bytes())
            if actual_hash != page.get("content_hash"):
                mismatches.append(
                    {
                        "axis": "content",
                        "object_type": "page",
                        "object_id": rel,
                        "detail": "finished page bytes differ from the publication receipt",
                    }
                )
        return self._summary(mismatches)

    def _finding_partition_census(
        self, conn: Any, projection: dict[str, str]
    ) -> list[dict[str, str]]:
        """Exhaustive census of the finding partition (spec §6.1, §6.2).

        Three properties, each able to turn the state axis red on its own:

        * every value of the resolution vocabulary is claimed by exactly one
          lens — a new enum value with no lens is a partition hole, not a
          rendering detail;
        * `finding_state_current` returns exactly one row per `findings` row,
          and each row lands in exactly one lens membership query.  A row in
          both or in neither is reported by id;
        * the row's marker is on the page its lens selects, in both corpora.
          The marker count check above proves a finding renders once; this
          proves it renders in the right lens.
        """
        mismatches: list[dict[str, str]] = []
        claimed: dict[str, list[str]] = {}
        for lens, _page, states in FINDING_LENS_PAGES:
            for state in states:
                claimed.setdefault(state, []).append(lens)
        for state in values_of("finding_resolution_state"):
            lenses = claimed.get(state, [])
            if len(lenses) != 1:
                named = ", ".join(lenses) or "no lens"
                mismatches.append(
                    {
                        "axis": "state",
                        "object_type": "finding-partition-vocabulary",
                        "object_id": state,
                        "detail": (
                            f"the resolution state is claimed by {named}"
                            f" ({len(lenses)} lenses), not by exactly one"
                        ),
                    }
                )
        for state in claimed:
            if state not in values_of("finding_resolution_state"):
                mismatches.append(
                    {
                        "axis": "state",
                        "object_type": "finding-partition-vocabulary",
                        "object_id": state,
                        "detail": "a lens claims a resolution state the vocabulary does not carry",
                    }
                )

        if not table_exists(conn, "finding_state_current"):
            mismatches.append(
                {
                    "axis": "state",
                    "object_type": "finding-partition",
                    "object_id": "finding_state_current",
                    "detail": "the partition view is absent from the store",
                }
            )
            return mismatches

        recorded = [str(r["finding_id"]) for r in rows(conn, "SELECT finding_id FROM findings")]
        membership: dict[str, list[str]] = {finding_id: [] for finding_id in recorded}
        states: dict[str, str] = {}
        for lens, _page, lens_states in FINDING_LENS_PAGES:
            placeholders = ",".join("?" for _ in lens_states)
            for r in rows(
                conn,
                "SELECT finding_id, resolution_state FROM finding_state_current"
                f" WHERE resolution_state IN ({placeholders})",
                list(lens_states),
            ):
                finding_id = str(r["finding_id"])
                membership.setdefault(finding_id, []).append(lens)
                states[finding_id] = str(r["resolution_state"])
        view_total = (
            row(conn, "SELECT COUNT(*) AS n FROM finding_state_current") or {"n": 0}
        )["n"]
        if int(view_total or 0) != len(recorded):
            mismatches.append(
                {
                    "axis": "state",
                    "object_type": "finding-partition",
                    "object_id": "finding_state_current",
                    "detail": (
                        f"the partition view returns {view_total} rows for {len(recorded)}"
                        " findings rows"
                    ),
                }
            )
        for finding_id in sorted(membership):
            lenses = membership[finding_id]
            if len(lenses) != 1:
                named = ", ".join(lenses) or "no lens"
                mismatches.append(
                    {
                        "axis": "state",
                        "object_type": "finding-partition",
                        "object_id": finding_id,
                        "detail": (
                            f"the finding lands in {named} ({len(lenses)} lens membership"
                            " queries), not in exactly one"
                        ),
                    }
                )
                continue
            expected = finding_page(states.get(finding_id))
            if expected is None:
                continue
            marker = finding_marker(finding_id)
            for suffix in (".md", ".html"):
                page = str(Path(expected).with_suffix(suffix))
                count = projection.get(page, "").count(marker)
                if count != 1:
                    mismatches.append(
                        {
                            "axis": "state",
                            "object_type": "finding-partition",
                            "object_id": finding_id,
                            "detail": (
                                f"{states.get(finding_id)} selects {page}, which carries the"
                                f" state marker {count} times"
                            ),
                        }
                    )
        return mismatches

    def _ledger_stale_census(
        self, conn: Any, projection: dict[str, str]
    ) -> list[dict[str, str]]:
        """Every obligation-bearing stale ledger row, recorded once (§11.3).

        The `entries`-derived marker check in `verify` is unchanged and stays
        beside this one.  It could never turn red: no code path writes that
        table, so its denominator is zero (finding B03-2, recorded in
        `schema.sql`).  `file_ledger` is populated by construction — a subsystem
        cannot leave scoping without rows in it — so this axis has a
        denominator, and deleting one record turns it red (VP4).

        Three properties, each able to turn the state axis red on its own:

        * every obligation-bearing classification is claimed by exactly one
          section of `stale.md` — a new classification with no section is a
          partition hole, not a rendering detail;
        * each obligation-bearing stale row carries exactly one marker in the
          Markdown corpus and exactly one in the HTML corpus, both on the page
          §6.2 selects;
        * a row exempt from the survey obligation carries none.  Recording one
          would report drift in generated or vendored territory as survey
          staleness, which is the reading §11.2 keeps separate.
        """

        mismatches: list[dict[str, str]] = []
        if not table_exists(conn, "file_ledger"):
            mismatches.append(
                {
                    "axis": "state",
                    "object_type": "ledger-stale",
                    "object_id": "file_ledger",
                    "detail": "the file ledger is absent from the store",
                }
            )
            return mismatches

        claimed: dict[str, list[str]] = {}
        for heading, classifications in LEDGER_STALE_SECTIONS:
            for classification in classifications:
                claimed.setdefault(classification, []).append(heading)
        for classification in OBLIGATION_BEARING_CLASSIFICATIONS:
            sections = claimed.get(classification, [])
            if len(sections) != 1:
                named = ", ".join(sections) or "no section"
                mismatches.append(
                    {
                        "axis": "state",
                        "object_type": "ledger-stale-partition",
                        "object_id": classification,
                        "detail": (
                            f"the classification is claimed by {named}"
                            f" ({len(sections)} sections), not by exactly one"
                        ),
                    }
                )
        for classification in claimed:
            if classification not in OBLIGATION_BEARING_CLASSIFICATIONS:
                mismatches.append(
                    {
                        "axis": "state",
                        "object_type": "ledger-stale-partition",
                        "object_id": classification,
                        "detail": (
                            "a section claims a classification that carries no survey"
                            " obligation"
                        ),
                    }
                )

        corpora = {
            suffix: "\n".join(
                body for rel, body in projection.items() if Path(rel).suffix == suffix
            )
            for suffix in (".md", ".html")
        }
        for ledger_row in rows(
            conn,
            "SELECT subsystem_id, file_path,"
            " COALESCE(classification,'candidate') AS classification"
            f" FROM file_ledger WHERE stale=1 AND {OBLIGATION_BEARING_SQL}"
            " ORDER BY subsystem_id, file_path",
        ):
            subsystem_id = str(ledger_row["subsystem_id"])
            file_path = str(ledger_row["file_path"])
            marker = ledger_stale_marker(subsystem_id, file_path)
            for suffix, label in ((".md", "markdown"), (".html", "html")):
                page = str(Path(LEDGER_STALE_PAGE).with_suffix(suffix))
                page_count = projection.get(page, "").count(marker)
                corpus_count = corpora[suffix].count(marker)
                if page_count != 1 or corpus_count != 1:
                    mismatches.append(
                        {
                            "axis": "state",
                            "object_type": (
                                "ledger-stale" if label == "markdown" else "ledger-stale-html"
                            ),
                            "object_id": f"{subsystem_id}:{file_path}",
                            "detail": (
                                f"expected exactly one {label} record on {page};"
                                f" found {page_count} there and {corpus_count} in the"
                                f" {label} corpus"
                            ),
                        }
                    )
        for ledger_row in rows(
            conn,
            "SELECT subsystem_id, file_path FROM file_ledger"
            f" WHERE stale=1 AND NOT ({OBLIGATION_BEARING_SQL})"
            " ORDER BY subsystem_id, file_path",
        ):
            subsystem_id = str(ledger_row["subsystem_id"])
            file_path = str(ledger_row["file_path"])
            marker = ledger_stale_marker(subsystem_id, file_path)
            for suffix, label in ((".md", "markdown"), (".html", "html")):
                count = corpora[suffix].count(marker)
                if count:
                    mismatches.append(
                        {
                            "axis": "state",
                            "object_type": (
                                "ledger-stale-exempt"
                                if label == "markdown"
                                else "ledger-stale-exempt-html"
                            ),
                            "object_id": f"{subsystem_id}:{file_path}",
                            "detail": (
                                "a row exempt from the survey obligation carries"
                                f" {count} {label} stale record(s)"
                            ),
                        }
                    )
        return mismatches

    @staticmethod
    def _summary(mismatches: list[dict[str, str]]) -> dict[str, Any]:
        axes = {
            axis: {"ok": not any(m["axis"] == axis for m in mismatches)}
            for axis in ("state", "coverage", "content")
        }
        return {
            "ok": all(result["ok"] for result in axes.values()),
            "axes": axes,
            "mismatch_count": len(mismatches),
            "mismatches": mismatches,
        }
