#!/usr/bin/env python3
"""Static packaging checks for the pinned candidate trial outputs.

Detector 1.0.0. This instrument measures emitted files and references. It does
not execute JavaScript or certify accessibility, HTML conformance, or security.
"""

from __future__ import annotations

import hashlib
import json
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
TRIALS = ROOT / "trials"
DETECTOR_VERSION = "1.0.1"

CANDIDATES = {
    "eleventy": TRIALS / "eleventy" / "dist",
    "astro": TRIALS / "astro" / "dist",
    "observable-framework": TRIALS / "observable" / "dist",
    "lit-iife": TRIALS / "lit" / "dist",
    "alpine-csp": TRIALS / "alpine",
}

ASSET_ATTRS = {
    "script": "src",
    "link": "href",
    "img": "src",
    "source": "src",
    "video": "src",
    "audio": "src",
}


class Scan(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.assets: list[dict[str, str]] = []
        self.links: list[str] = []
        self.module_scripts = 0
        self.classic_scripts = 0
        self.inline_scripts = 0
        self.landmarks: dict[str, int] = {tag: 0 for tag in ("header", "nav", "main", "aside", "footer")}
        self.h1 = 0
        self.tables = 0
        self.captions = 0
        self.scoped_headers = 0
        self.search_inputs = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag in self.landmarks:
            self.landmarks[tag] += 1
        if tag == "h1":
            self.h1 += 1
        elif tag == "table":
            self.tables += 1
        elif tag == "caption":
            self.captions += 1
        elif tag == "th" and values.get("scope") in {"row", "col", "rowgroup", "colgroup"}:
            self.scoped_headers += 1
        elif tag == "input" and values.get("type", "text") == "search":
            self.search_inputs += 1
        if tag == "a" and values.get("href"):
            self.links.append(values["href"] or "")
        if tag in ASSET_ATTRS and values.get(ASSET_ATTRS[tag]):
            self.assets.append({"tag": tag, "url": values[ASSET_ATTRS[tag]] or ""})
        if tag == "script":
            if values.get("type") == "module":
                self.module_scripts += 1
            else:
                self.classic_scripts += 1
            if not values.get("src"):
                self.inline_scripts += 1


def is_remote(url: str) -> bool:
    return urlparse(url).scheme in {"http", "https", "//"}


def resolve_local(html: Path, url: str) -> Path | None:
    if not url or url.startswith("#") or is_remote(url) or url.startswith(("data:", "mailto:", "javascript:")):
        return None
    clean = url.split("?", 1)[0].split("#", 1)[0]
    return (html.parent / clean).resolve()


def scan_candidate(name: str, bundle: Path) -> dict[str, object]:
    files = sorted(p for p in bundle.rglob("*") if p.is_file() and "node_modules" not in p.parts)
    html_files = [p for p in files if p.suffix.lower() == ".html"]
    aggregate = {
        "module_scripts": 0,
        "classic_scripts": 0,
        "inline_scripts": 0,
        "remote_asset_urls": [],
        "remote_link_urls": [],
        "unresolved_local_references": [],
        "h1": 0,
        "tables": 0,
        "captions": 0,
        "scoped_headers": 0,
        "search_inputs": 0,
        "landmarks": {tag: 0 for tag in ("header", "nav", "main", "aside", "footer")},
    }
    for html in html_files:
        scanner = Scan()
        scanner.feed(html.read_text(encoding="utf-8"))
        for field in ("module_scripts", "classic_scripts", "inline_scripts", "h1", "tables", "captions", "scoped_headers", "search_inputs"):
            aggregate[field] += getattr(scanner, field)
        for tag, count in scanner.landmarks.items():
            aggregate["landmarks"][tag] += count
        for asset in scanner.assets:
            url = asset["url"]
            if is_remote(url):
                aggregate["remote_asset_urls"].append(url)
            else:
                resolved = resolve_local(html, url)
                if resolved is not None and not resolved.exists():
                    aggregate["unresolved_local_references"].append(f"{html.relative_to(bundle)} -> {url}")
        for link in scanner.links:
            if is_remote(link):
                aggregate["remote_link_urls"].append(link)
            else:
                resolved = resolve_local(html, link)
                if resolved is not None and not resolved.exists():
                    aggregate["unresolved_local_references"].append(f"{html.relative_to(bundle)} -> {link}")
    for field in ("remote_asset_urls", "remote_link_urls", "unresolved_local_references"):
        aggregate[field] = sorted(set(aggregate[field]))
    byte_count = sum(p.stat().st_size for p in files)
    try:
        bundle_label = str(bundle.relative_to(ROOT))
    except ValueError:
        bundle_label = str(bundle)
    return {
        "name": name,
        "bundle": bundle_label,
        "file_count": len(files),
        "html_file_count": len(html_files),
        "total_bytes": byte_count,
        "html_bytes": sum(p.stat().st_size for p in html_files),
        "sha256": hashlib.sha256("".join(f"{p.relative_to(bundle)}:{hashlib.sha256(p.read_bytes()).hexdigest()}\n" for p in files).encode()).hexdigest(),
        **aggregate,
    }


def source_metrics() -> dict[str, dict[str, int]]:
    groups = {
        "eleventy": [TRIALS / "eleventy" / "src" / "index.njk", TRIALS / "eleventy" / ".eleventy.js", TRIALS / "shared" / "classic-filter.js"],
        "astro": [TRIALS / "astro" / "src" / "pages" / "index.astro", TRIALS / "astro" / "astro.config.mjs"],
        "observable-framework": [TRIALS / "observable" / "src" / "index.md", TRIALS / "observable" / "observablehq.config.js"],
        "lit-iife": [TRIALS / "lit" / "src" / "report-filter.js", TRIALS / "lit" / "dist" / "index.html"],
        "alpine-csp": [TRIALS / "alpine" / "index.html", TRIALS / "alpine" / "report-filter.js"],
    }
    return {
        name: {
            "files": len(paths),
            "bytes": sum(p.stat().st_size for p in paths),
            "nonblank_lines": sum(sum(1 for line in p.read_text(encoding="utf-8").splitlines() if line.strip()) for p in paths),
        }
        for name, paths in groups.items()
    }


def main() -> None:
    result = {
        "detector": "trial-inspection.py",
        "detector_version": DETECTOR_VERSION,
        "run_date": "2026-08-22",
        "limitations": [
            "Static inspection only; JavaScript was not executed.",
            "Source metrics describe hand-built feasibility fixtures, not typical projects or AI quality.",
            "Remote hyperlinks are separated from remote runtime assets.",
        ],
        "source_metrics": source_metrics(),
        "outputs": [scan_candidate(name, bundle) for name, bundle in CANDIDATES.items()],
    }
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
