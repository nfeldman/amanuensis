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
import subprocess
from collections import Counter
from dataclasses import dataclass
from html import unescape
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
LINKED_SUFFIXES = {".md", ".html", ".htm"}

# The generated locus index (spec §8.1.1). It is a projection file like any
# page: inventoried, hashed into the receipt, and — unlike a page — read back
# against the ledger and the evidence it indexes.
SEARCH_INDEX_NAME = "search-index.js"
SEARCH_INDEX_ASSIGNMENT = re.compile(
    r"window\.__amanuensisLocusIndex\s*=\s*(\{.*\})\s*;", re.DOTALL
)

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


#: Every durable marker kind the projection emits, named once. The HTML view
#: accepts raw HTML from the Markdown bytes only for these, so a marker kind
#: added here reaches both corpora and one added only to a renderer is stripped
#: out of the HTML and reported by the state axis as absent (§11.3).
MARKER_KINDS: tuple[str, ...] = ("finding", "stale-entry", "ledger-stale", "carried")


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


# ---------------------------------------------------------------------------
# The standing reconciliation (spec.md §3.2, §3.3, §3.4)
#
# The projection is a reader of the store, never the system of record, and this
# is the one reading that decides whether any coverage fraction on any page has
# a denominator at all.  It lives here rather than in `renderers.py` so the
# renderer and the independent read-back cannot disagree about whether a store
# is reconciled: one definition, read by the page that prints the number and by
# the axis that checks it (GP28).
# ---------------------------------------------------------------------------

#: The one byte a repository path cannot contain, so a joined set is unambiguous.
NUL = "\x00"

# The classifications that exempt a tracked path from the obligation to be read
# come from the generated vocabulary, never from a list maintained here.
EXEMPT_CLASSIFICATIONS: tuple[str, ...] = tuple(
    value
    for value in values_of("file_classification")
    if value not in OBLIGATION_BEARING_CLASSIFICATIONS
)


#: What the overview prints where a coverage figure has no denominator (§3.4).
UNMEASURED = "not measured"

#: The two overview rows §3.4 moves to the standing reconciliation, named once
#: and read by the renderer that prints them and the axis that checks them.
COVERAGE_ROW_FILES_READ = "Files read, of those carrying an obligation"
COVERAGE_ROW_UNLEDGERED = "Paths in scope with no ledger row"
COVERAGE_ROW_CARRIED = "Carried defects undecided"

OVERVIEW_PAGE_MD = "index.md"
OVERVIEW_PAGE_HTML = "index.html"

_MD_ROW_RE = re.compile(r"^\s*\|(?P<cells>.*)\|\s*$")
# The HTML view renders a metric table as a description list, and a data table
# as a table; both shapes are read, so this axis does not depend on which one
# the shared template happens to use.
_HTML_PAIR_RE = re.compile(
    r"<dt\b[^>]*>(?P<label>.*?)</dt>\s*<dd\b[^>]*>(?P<value>.*?)</dd>", re.S | re.I
)
_HTML_ROW_RE = re.compile(r"<tr\b[^>]*>(?P<body>.*?)</tr>", re.S | re.I)
_HTML_CELL_RE = re.compile(r"<t[dh]\b[^>]*>(?P<cell>.*?)</t[dh]>", re.S | re.I)
_TAG_RE = re.compile(r"<[^>]+>")


def _plain(fragment: str) -> str:
    return unescape(_TAG_RE.sub("", fragment)).strip()


def _metric_cell(text: str, label: str, suffix: str) -> str | None:
    """The value cell of one `| label | value |` metric row, in either format.

    The HTML view is derived from the finished Markdown bytes, so the same row
    is checkable in both corpora — and both are checked, because a healthy
    Markdown page must not stand in for its companion (§11.3's rule, applied to
    a reading rather than to a marker).
    """

    if suffix in HTML_SUFFIXES:
        for pair in _HTML_PAIR_RE.finditer(text):
            if _plain(pair.group("label")).strip("*` ") == label:
                return _plain(pair.group("value"))
        for match in _HTML_ROW_RE.finditer(text):
            cells = [_plain(c.group("cell")) for c in _HTML_CELL_RE.finditer(match.group("body"))]
            if len(cells) >= 2 and cells[0].strip("*` ") == label:
                return cells[1]
        return None
    for line in text.splitlines():
        match = _MD_ROW_RE.match(line)
        if not match:
            continue
        cells = [cell.strip() for cell in match.group("cells").split("|")]
        if len(cells) >= 2 and cells[0].strip("*` ") == label:
            return cells[1]
    return None


def resolve_workspace(storage: Path) -> Path:
    """The surveyed workspace: the recorded path, else the storage's parent."""

    record = storage / "workspace_path"
    if record.is_file():
        recorded = record.read_text().strip()
        if recorded:
            return Path(recorded)
    return storage.parent


def set_digest(parts: list[str]) -> str:
    """A set, as one hash: sorted, NUL-joined, SHA-256 (§3.2).

    Sorted so the digest states the set and not the order git or SQLite
    happened to return it in, and joined on NUL because that is the one byte a
    repository path cannot contain.  The same construction the server uses
    (`mcp-server/src/invariants.ts` `digestOf`); a second construction here
    would make every reconciliation this process reads look stale.
    """

    return hashlib.sha256(NUL.join(sorted(parts)).encode()).hexdigest()


def tracked_path_digest(paths: list[str]) -> str:
    """§3.2's `tree_digest`: the tracked path set the counts were taken over."""

    return set_digest(paths)


def ledger_digest(conn: Any) -> str:
    """§3.2's `ledger_digest`: the ledger the counts were taken against."""

    return set_digest(
        [
            f"{r['file_path']}{NUL}{r['classification'] or ''}"
            for r in rows(conn, "SELECT file_path, classification FROM file_ledger")
        ]
    )


def tree_paths(workspace: Path, revision: str) -> list[str] | None:
    """The paths the **tree** at `revision` carries, or None when git cannot say.

    `git ls-files` reads the index, which moves under an unrelated `git add`
    and does not describe the revision at all (§3.3).  `-z` because git quotes
    any path it cannot print literally, and a quoted path is a different string
    from the one the ledger stores.
    """

    if not revision or not workspace.is_dir():
        return None
    try:
        result = subprocess.run(
            ["git", "-C", str(workspace), "ls-tree", "-r", "--name-only", "-z", revision],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    return [path for path in result.stdout.split(NUL) if path]


#: Why a reading does not stand, in the words the projection prints.  Named
#: constants because §8.6 makes an omitted reason a red condition: a sentence
#: that says only "not measured" tells a reader nothing to repair.
WHY_NONE_RECORDED = "no reconciliation has been recorded at that revision"
WHY_NONE_AT_ALL = (
    "no reconciliation has been recorded, at that revision or at any other"
)
WHY_LEDGER_MOVED = (
    "the file ledger has changed since the reconciliation recorded there was taken"
)
WHY_OTHER_TREE = "the reconciliation recorded there was taken over a different tree"
WHY_NO_REVISION = "the store records no checked revision to reconcile against"


@dataclass(frozen=True)
class ReconciliationStanding:
    """Whether the store is *reconciled at* the revision it stamps, and why not.

    `record` is the standing reconciliation (§3.3: the most recent qualifying
    row) or None.  `why` is None exactly when `record` is not, so a caller can
    never read a reason for a reading that stands, or a reading from a store
    that has none.
    """

    sha: str
    record: dict[str, Any] | None
    latest_sha: str | None
    why: str | None

    @property
    def stands(self) -> bool:
        return self.record is not None

    @property
    def tracked_paths(self) -> int | None:
        """|tracked| at the reconciled revision, or None — never 0 for absent."""

        return None if self.record is None else int(self.record["tracked_paths"] or 0)

    @property
    def unledgered(self) -> int | None:
        return None if self.record is None else int(self.record["unledgered"] or 0)

    @property
    def obligation_paths(self) -> int | None:
        """§1.2's D2: tracked paths minus those an exempting classification frees."""

        if self.record is None:
            return None
        return int(self.record["tracked_paths"] or 0) - int(self.record["exempt"] or 0)


def reconciliation_standing(conn: Any, storage: Path) -> ReconciliationStanding:
    """§3.3, as far as a read-only reader of the store can evaluate it.

    Conditions 1 and 3 collapse here: the revision the projection stamps *is*
    `git_state.last_checked_sha`, so a row's `detected_sha` is compared against
    the revision the pages are stamped with.  Condition 5 — the ledger digest
    re-derived now — is pure SQL and is always checked; it is the ordinary
    invalidation, because every later `add_files_to_scope` or classification
    change moves it.  Condition 4 is checked whenever the bound workspace can
    enumerate the tree at that revision.

    **Where git cannot answer**, condition 4 is unevaluated and the row's own
    `ledger_digest` and recorded revision are what the reading stands on.  That
    is a gap §3.4 leaves open for a projection that may run with no workspace
    in reach, and it is strictly stronger than the ledger-derived universe it
    replaces, which carried no witness at all.  `GATE SR1` owns whether a
    written reconciliation was correct; this reader owns whether one is being
    read at the revision it claims.
    """

    sha = str((row(conn, "SELECT last_checked_sha FROM git_state WHERE repo_id='default'") or {}).get("last_checked_sha") or "")
    if not table_exists(conn, "scope_reconciliations"):
        return ReconciliationStanding(sha, None, None, WHY_NONE_AT_ALL)
    latest = row(
        conn, "SELECT detected_sha FROM scope_reconciliations ORDER BY id DESC LIMIT 1"
    )
    latest_sha = str(latest["detected_sha"]) if latest else None
    if not sha:
        return ReconciliationStanding(sha, None, latest_sha, WHY_NO_REVISION)
    at_sha = rows(
        conn,
        "SELECT id, detected_sha, tree_digest, ledger_digest, tracked_paths, ledger_rows,"
        " unledgered, absent, exempt, detected_at FROM scope_reconciliations"
        " WHERE detected_sha = ? ORDER BY id DESC",
        (sha,),
    )
    if not at_sha:
        return ReconciliationStanding(
            sha, None, latest_sha, WHY_NONE_AT_ALL if latest_sha is None else WHY_NONE_RECORDED
        )
    current_ledger = ledger_digest(conn)
    tracked = tree_paths(resolve_workspace(storage), sha)
    expected_tree = None if tracked is None else tracked_path_digest(tracked)
    for candidate in at_sha:
        if str(candidate["ledger_digest"]) != current_ledger:
            continue
        if expected_tree is not None and str(candidate["tree_digest"]) != expected_tree:
            continue
        return ReconciliationStanding(sha, candidate, latest_sha, None)
    # No qualifying row. Name which condition failed: a store whose ledger moved
    # under the reading and one whose revision was re-pointed both run
    # `detect_changes`, but a reader told only "unreconciled" cannot tell one
    # lost reading from a reading never taken.
    if any(str(c["ledger_digest"]) == current_ledger for c in at_sha):
        return ReconciliationStanding(sha, None, latest_sha, WHY_OTHER_TREE)
    return ReconciliationStanding(sha, None, latest_sha, WHY_LEDGER_MOVED)


# ---------------------------------------------------------------------------
# Carried obligations (spec.md §5.2, §5.6)
#
# Lens membership for a carried record, defined once and read by the renderer
# and by the census below.  The partition is over *decidedness*, not over the
# archived resolution state: a carried record is an obligation this store has
# either discharged or not, and the archived store's own verdict is history
# that travelled with it.
# ---------------------------------------------------------------------------
CARRIED_UNDECIDED = "undecided"

CARRIED_LENS_PAGES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("Unresolved", "findings.md", (CARRIED_UNDECIDED,)),
    (
        "History",
        "resolved-findings.md",
        ("successor-finding", "ruled-out", "repaired", "archived-terminal"),
    ),
)

CARRIED_PAGE_BY_OUTCOME: dict[str, str] = {
    outcome: page for _lens, page, outcomes in CARRIED_LENS_PAGES for outcome in outcomes
}

CARRIED_HEADING = "Carried obligations"


def carried_page(outcome: str | None) -> str | None:
    """The page a carried record with this outcome renders on, or None."""

    return CARRIED_PAGE_BY_OUTCOME.get(str(outcome or CARRIED_UNDECIDED))


def _carried_token(archived_store_id: str, archived_finding_id: str) -> str:
    """One digest per carried record, over the key the store is unique by.

    `carried_findings` is `UNIQUE (archived_store_id, archived_finding_id)`, and
    §5.7 refuses an unqualified id for exactly that reason: two archives can
    carry the same finding id.  The marker is qualified the same way, so two
    archives' records cannot collide into one marker.
    """

    return hashlib.sha256(
        f"{archived_store_id}{NUL}{archived_finding_id}".encode()
    ).hexdigest()


def carried_marker(archived_store_id: str, archived_finding_id: str) -> str:
    """The durable marker for one carried obligation (§5.6)."""

    return f"<!-- amanuensis:carried:{_carried_token(archived_store_id, archived_finding_id)} -->"


def carried_anchor(archived_store_id: str, archived_finding_id: str) -> str:
    """A collision-resistant anchor for one carried record."""

    return f"cf-{_carried_token(archived_store_id, archived_finding_id)[:10]}"


def carried_records(conn: Any) -> list[dict[str, Any]]:
    """Every carried obligation, with its outcome or the word `undecided`."""

    if not table_exists(conn, "carried_findings"):
        return []
    return rows(
        conn,
        "SELECT c.carried_id, c.archived_finding_id, c.archived_store_id,"
        " c.archived_anchor_sha, c.subsystem_id, c.severity, c.symptom, c.root_cause,"
        " c.archived_resolution, c.primary_files,"
        " COALESCE(o.outcome, ?) AS outcome, o.successor_id, o.repaired_sha,"
        " o.rationale, o.ref_sha AS outcome_ref_sha"
        " FROM carried_findings c"
        " LEFT JOIN carried_finding_outcomes o ON o.carried_id = c.carried_id"
        " ORDER BY CASE c.severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1"
        "   WHEN 'MEDIUM' THEN 2 ELSE 3 END, c.archived_store_id, c.archived_finding_id",
        (CARRIED_UNDECIDED,),
    )


def carry_was_run(conn: Any) -> bool:
    """Whether any carry ran at all, including a reasoned empty one (§5.2).

    "Nothing was carried" and "nobody ran a carry" are different facts, and the
    overview must not report the first when it means the second: the row is
    published when a carry is on record, and omitted when none is.
    """

    if table_exists(conn, "carry_runs") and int(
        (row(conn, "SELECT COUNT(*) AS n FROM carry_runs") or {"n": 0})["n"] or 0
    ):
        return True
    return bool(carried_records(conn))


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
    # Only the two prose formats carry cross-links. The generated index is
    # JavaScript, and running a Markdown link pattern over a JSON payload would
    # invent link targets for the coverage axis to fail to resolve.
    if suffix not in LINKED_SUFFIXES:
        return []
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

        # `*.js` joins the inventory so the generated index is a page the
        # coverage axis can find. Without it the file is present, expected, and
        # reported missing — the wrong red, which is as much a defect as the
        # wrong green (§8.2).
        projection = {
            str(path.relative_to(self.output)): path.read_text()
            for pattern in ("*.md", "*.html", "*.js")
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
            mismatches.extend(self._locus_index_census(conn, projection))
            mismatches.extend(self._carried_record_census(conn, projection))
            mismatches.extend(self._coverage_measurement_census(conn, projection))
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
        #
        # Membership is checked before the hashes, because hashing the receipt's
        # own members can only ever prove the receipt agrees with itself. A page
        # removed from the receipt while its bytes stay on disk shortens the
        # list this loop walks, and coverage does not see it either — that axis
        # compares the plan to the files present, and the file is present. Left
        # unchecked, the receipt is a place to hide a page from custody
        # (F11/codex).
        receipt_paths = {str(page["path"]) for page in contract.get("pages", [])}
        for rel in self.expected_pages:
            if rel in receipt_paths:
                continue
            if not (self.output / rel).is_file():
                continue  # coverage already owns the missing-page diagnostic
            mismatches.append(
                {
                    "axis": "content",
                    "object_type": "page",
                    "object_id": rel,
                    "detail": "projected page is absent from the publication receipt",
                }
            )
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

    def _locus_index_census(
        self, conn: Any, projection: dict[str, str]
    ) -> list[dict[str, str]]:
        """The generated locus index, read back against what it indexes (§8.2).

        The content axis proves the file's bytes match the receipt and the
        coverage axis proves it is present; neither can tell a correct index
        from an empty one that was hashed honestly. This axis reads the two
        durable tables the index is derived from:

        * every obligation-bearing `file_ledger.file_path` appears in `paths`
          exactly once — a path indexed twice gives a reader two results for
          one file and hides which is current, and a path missing is a file
          ⌘K cannot reach;
        * every `evidence` row with a non-null `symbol` appears in `symbols` at
          least once. At least, not exactly: one symbol can carry evidence in
          several files, and each of those is a separate place to land.

        A row exempt from the survey obligation may be indexed — the Files
        index lists it — but nothing here requires it, so the denominator is
        the obligation, not the ledger's whole extent.
        """

        mismatches: list[dict[str, str]] = []
        text = projection.get(SEARCH_INDEX_NAME)
        if text is None:
            mismatches.append(
                {
                    "axis": "state",
                    "object_type": "locus-index",
                    "object_id": SEARCH_INDEX_NAME,
                    "detail": "the generated locus index is absent from the projection",
                }
            )
            return mismatches
        found = SEARCH_INDEX_ASSIGNMENT.search(text)
        if not found:
            mismatches.append(
                {
                    "axis": "state",
                    "object_type": "locus-index",
                    "object_id": SEARCH_INDEX_NAME,
                    "detail": "the index carries no window.__amanuensisLocusIndex assignment",
                }
            )
            return mismatches
        try:
            index = json.loads(found.group(1))
        except json.JSONDecodeError as exc:
            mismatches.append(
                {
                    "axis": "state",
                    "object_type": "locus-index",
                    "object_id": SEARCH_INDEX_NAME,
                    "detail": f"the index payload is unreadable: {exc}",
                }
            )
            return mismatches

        indexed = Counter(
            str(entry.get("p"))
            for entry in index.get("paths") or []
            if isinstance(entry, dict)
        )
        if not table_exists(conn, "file_ledger"):
            mismatches.append(
                {
                    "axis": "state",
                    "object_type": "locus-index",
                    "object_id": "file_ledger",
                    "detail": "the file ledger is absent from the store",
                }
            )
            return mismatches
        for ledger_row in rows(
            conn,
            "SELECT DISTINCT file_path FROM file_ledger"
            f" WHERE {OBLIGATION_BEARING_SQL} ORDER BY file_path",
        ):
            file_path = str(ledger_row["file_path"])
            count = indexed.get(file_path, 0)
            if count != 1:
                mismatches.append(
                    {
                        "axis": "state",
                        "object_type": "locus-index-path",
                        "object_id": file_path,
                        "detail": (
                            "the obligation-bearing ledger path is indexed"
                            f" {count} time(s), not exactly once"
                        ),
                    }
                )

        symbols = {
            (str(entry.get("y")), str(entry.get("p")))
            for entry in index.get("symbols") or []
            if isinstance(entry, dict)
        }
        if table_exists(conn, "evidence"):
            for cited in rows(
                conn,
                "SELECT DISTINCT symbol, file_path FROM evidence"
                " WHERE symbol IS NOT NULL AND TRIM(symbol) <> ''"
                " ORDER BY symbol, file_path",
            ):
                pair = (str(cited["symbol"]), str(cited["file_path"]))
                if pair not in symbols:
                    mismatches.append(
                        {
                            "axis": "state",
                            "object_type": "locus-index-symbol",
                            "object_id": f"{pair[0]} in {pair[1]}",
                            "detail": "the cited symbol is absent from the index",
                        }
                    )
        return mismatches

    def _carried_record_census(
        self, conn: Any, projection: dict[str, str]
    ) -> list[dict[str, str]]:
        """Every carried obligation, recorded once, on the lens its outcome selects.

        A carried record is an obligation this store inherited and has either
        decided or not.  The census is the finding partition's shape applied to
        the second population `readback.py` had never seen (§5.6, C39):

        * every `carried_finding_outcome` value, and the word `undecided`, is
          claimed by exactly one lens — an outcome with no lens is a partition
          hole, not a rendering detail;
        * each carried record carries exactly one marker in the Markdown corpus
          and exactly one in the HTML corpus, both on the page its outcome
          selects.  One healthy format cannot mask drift in its companion.

        A store that carried nothing has no denominator here and reports
        nothing, which is the honest reading: `carry_runs` is where "nobody ran
        a carry" is told apart from "a carry found nothing" (§5.2).
        """

        mismatches: list[dict[str, str]] = []
        claimed: dict[str, list[str]] = {}
        for lens, _page, outcomes in CARRIED_LENS_PAGES:
            for outcome in outcomes:
                claimed.setdefault(outcome, []).append(lens)
        for outcome in (*values_of("carried_finding_outcome"), CARRIED_UNDECIDED):
            lenses = claimed.get(outcome, [])
            if len(lenses) != 1:
                named = ", ".join(lenses) or "no lens"
                mismatches.append(
                    {
                        "axis": "state",
                        "object_type": "carried-partition-vocabulary",
                        "object_id": outcome,
                        "detail": (
                            f"the carried outcome is claimed by {named}"
                            f" ({len(lenses)} lenses), not by exactly one"
                        ),
                    }
                )
        for outcome in claimed:
            if outcome != CARRIED_UNDECIDED and outcome not in values_of(
                "carried_finding_outcome"
            ):
                mismatches.append(
                    {
                        "axis": "state",
                        "object_type": "carried-partition-vocabulary",
                        "object_id": outcome,
                        "detail": "a lens claims an outcome the vocabulary does not carry",
                    }
                )

        records = carried_records(conn)
        if not records:
            return mismatches
        corpora = {
            suffix: "\n".join(
                body for rel, body in projection.items() if Path(rel).suffix == suffix
            )
            for suffix in (".md", ".html")
        }
        for record in records:
            store_id = str(record["archived_store_id"])
            archived_id = str(record["archived_finding_id"])
            marker = carried_marker(store_id, archived_id)
            expected = carried_page(str(record["outcome"]))
            if expected is None:
                mismatches.append(
                    {
                        "axis": "state",
                        "object_type": "carried-record",
                        "object_id": f"{store_id}:{archived_id}",
                        "detail": (
                            f"the recorded outcome {record['outcome']!r} selects no lens"
                        ),
                    }
                )
                continue
            for suffix, label in ((".md", "markdown"), (".html", "html")):
                page = str(Path(expected).with_suffix(suffix))
                page_count = projection.get(page, "").count(marker)
                corpus_count = corpora[suffix].count(marker)
                if page_count != 1 or corpus_count != 1:
                    mismatches.append(
                        {
                            "axis": "state",
                            "object_type": (
                                "carried-record" if label == "markdown" else "carried-record-html"
                            ),
                            "object_id": f"{store_id}:{archived_id}",
                            "detail": (
                                f"outcome {record['outcome']} selects {page}, which carries"
                                f" the {label} record {page_count} time(s); the {label}"
                                f" corpus carries it {corpus_count} time(s)"
                            ),
                        }
                    )
        return mismatches

    def _coverage_measurement_census(
        self, conn: Any, projection: dict[str, str]
    ) -> list[dict[str, str]]:
        """Each published coverage row, against the store's own standing (§3.4).

        The coverage axis already asks whether a planned page and a recorded
        link are present.  This asks the same question of a *reading*: a
        `not measured` row is present and honest, and is never a satisfied
        coverage claim.  Both directions turn it red, because both are silent
        failures:

        * an **unreconciled** store whose overview publishes a number has
          published a fraction of a set nobody inventoried (§1.4);
        * a **reconciled** store whose overview withholds the reading it has,
          or publishes one the record contradicts, is no more honest — the
          numbers are checked against the standing reconciliation here, read
          from the database, not from the page that printed them.

        No other axis is touched: the state axis still owns markers and the
        content axis still owns bytes.
        """

        mismatches: list[dict[str, str]] = []
        standing = reconciliation_standing(conn, self.storage)
        expected: dict[str, str | None] = {
            COVERAGE_ROW_UNLEDGERED: (
                None if standing.unledgered is None else str(standing.unledgered)
            ),
            COVERAGE_ROW_FILES_READ: (
                None
                if standing.obligation_paths is None
                else f"of {standing.obligation_paths}"
            ),
        }
        for rel in (OVERVIEW_PAGE_MD, OVERVIEW_PAGE_HTML):
            text = projection.get(rel)
            if text is None:
                continue  # coverage already owns the missing-page diagnostic
            for label, wanted in expected.items():
                cell = _metric_cell(text, label, Path(rel).suffix.lower())
                if cell is None:
                    mismatches.append(
                        {
                            "axis": "coverage",
                            "object_type": "coverage-measurement",
                            "object_id": f"{rel}:{label}",
                            "detail": "the overview publishes no such row",
                        }
                    )
                    continue
                if UNMEASURED in cell:
                    if standing.stands:
                        mismatches.append(
                            {
                                "axis": "coverage",
                                "object_type": "coverage-measurement",
                                "object_id": f"{rel}:{label}",
                                "detail": (
                                    f"the store is reconciled at {standing.sha[:12]} and the"
                                    " row withholds the reading the record carries"
                                ),
                            }
                        )
                    continue
                if not standing.stands:
                    mismatches.append(
                        {
                            "axis": "coverage",
                            "object_type": "coverage-measurement",
                            "object_id": f"{rel}:{label}",
                            "detail": (
                                "the store is unreconciled and the row publishes a reading"
                                f" anyway: {cell!r} ({standing.why})"
                            ),
                        }
                    )
                    continue
                if wanted is not None and wanted not in cell:
                    mismatches.append(
                        {
                            "axis": "coverage",
                            "object_type": "coverage-measurement",
                            "object_id": f"{rel}:{label}",
                            "detail": (
                                f"the row reads {cell!r}; the standing reconciliation at"
                                f" {standing.sha[:12]} says {wanted!r}"
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
