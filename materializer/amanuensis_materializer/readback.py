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

from .db import open_ro, rows
from .manifest import sha256_bytes

CONTRACT_NAME = ".projection-contract.json"
CONTRACT_VERSION = "2"
LINK_RE = re.compile(r"\[[^\]]*\]\(([^)]+)\)")
HTML_SUFFIXES = {".html", ".htm"}


def finding_marker(finding_id: str) -> str:
    token = hashlib.sha256(finding_id.encode("utf-8")).hexdigest()
    return f"<!-- amanuensis:finding:{token} -->"


def stale_marker(entry_id: str, tier: int) -> str:
    token = hashlib.sha256(f"{entry_id}:{tier}".encode()).hexdigest()
    return f"<!-- amanuensis:stale-entry:{token} -->"


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
