#!/usr/bin/env python3
"""Deterministic structural inspection of an Amanuensis HTML projection.

Detector version is independent of the JSON schema version per practice-catalog
v2.10 VP26. This is a structural instrument, not an accessibility or semantic
truth oracle.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

SCHEMA_VERSION = "1.0.0"
DETECTOR_VERSION = "1.0.0"


class Inspector(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tags: Counter[str] = Counter()
        self.attrs: Counter[str] = Counter()
        self.ids: list[str] = []
        self.links: list[str] = []
        self.images: list[dict[str, str | None]] = []
        self.scripts: list[dict[str, str | None]] = []
        self.styles = 0
        self.headings: list[dict[str, str]] = []
        self.tables: list[dict[str, int]] = []
        self.landmarks: Counter[str] = Counter()
        self.controls: list[dict[str, str | None]] = []
        self._heading_tag: str | None = None
        self._heading_text: list[str] = []
        self._table: dict[str, int] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        self.tags[tag] += 1
        self.attrs.update(name for name, _ in attrs)
        if values.get("id"):
            self.ids.append(values["id"] or "")
        if tag in {"a", "link"} and values.get("href"):
            self.links.append(values["href"] or "")
        if tag in {"img", "svg"}:
            self.images.append({"tag": tag, "alt": values.get("alt"), "aria_label": values.get("aria-label")})
        if tag == "script":
            self.scripts.append({"src": values.get("src"), "type": values.get("type")})
        if tag == "style":
            self.styles += 1
        if tag in {"main", "nav", "aside", "header", "footer"}:
            self.landmarks[tag] += 1
        if tag in {"button", "input", "select", "textarea", "details", "summary"}:
            self.controls.append(
                {
                    "tag": tag,
                    "type": values.get("type"),
                    "id": values.get("id"),
                    "aria_label": values.get("aria-label"),
                    "aria_expanded": values.get("aria-expanded"),
                }
            )
        if re.fullmatch(r"h[1-6]", tag):
            self._heading_tag = tag
            self._heading_text = []
        if tag == "table":
            self._table = {"captions": 0, "th": 0, "th_scope": 0, "td": 0}
        elif self._table is not None:
            if tag == "caption":
                self._table["captions"] += 1
            elif tag == "th":
                self._table["th"] += 1
                if values.get("scope"):
                    self._table["th_scope"] += 1
            elif tag == "td":
                self._table["td"] += 1

    def handle_endtag(self, tag: str) -> None:
        if self._heading_tag == tag:
            self.headings.append({"level": tag, "text": " ".join("".join(self._heading_text).split())})
            self._heading_tag = None
            self._heading_text = []
        if tag == "table" and self._table is not None:
            self.tables.append(self._table)
            self._table = None

    def handle_data(self, data: str) -> None:
        if self._heading_tag:
            self._heading_text.append(data)


def classify_url(url: str) -> str:
    if url.startswith("#"):
        return "fragment"
    parsed = urlsplit(url)
    if parsed.scheme in {"http", "https"}:
        return "remote"
    if parsed.scheme:
        return "other-scheme"
    return "local"


def heading_skips(headings: list[dict[str, str]]) -> list[dict[str, str | int]]:
    result: list[dict[str, str | int]] = []
    prior = 0
    for heading in headings:
        level = int(heading["level"][1])
        if prior and level > prior + 1:
            result.append({"from": prior, "to": level, "text": heading["text"]})
        prior = level
    return result


def inspect(path: Path) -> dict[str, object]:
    payload = path.read_bytes()
    text = payload.decode("utf-8")
    parser = Inspector()
    parser.feed(text)
    url_classes = Counter(classify_url(url) for url in parser.links)
    duplicate_ids = sorted(value for value, count in Counter(parser.ids).items() if count > 1)
    remote_asset_urls = sorted(
        set(
            re.findall(r'''(?:src|href)=["'](https?://[^"']+)["']''', text, flags=re.IGNORECASE)
        )
    )
    return {
        "schema_version": SCHEMA_VERSION,
        "detector_version": DETECTOR_VERSION,
        "path": str(path.resolve()),
        "sha256": hashlib.sha256(payload).hexdigest(),
        "bytes": len(payload),
        "lines": text.count("\n") + 1,
        "doctype_html": bool(re.match(r"\s*<!doctype\s+html>", text, flags=re.IGNORECASE)),
        "lang_en": bool(re.search(r'<html\b[^>]*\blang=["\']en["\']', text, flags=re.IGNORECASE)),
        "meta_viewport": bool(re.search(r'<meta\b[^>]*\bname=["\']viewport["\']', text, flags=re.IGNORECASE)),
        "tag_counts": dict(sorted(parser.tags.items())),
        "landmarks": dict(sorted(parser.landmarks.items())),
        "headings": parser.headings,
        "heading_skips": heading_skips(parser.headings),
        "ids": {"total": len(parser.ids), "unique": len(set(parser.ids)), "duplicates": duplicate_ids},
        "links": {"total": len(parser.links), "classes": dict(sorted(url_classes.items()))},
        "remote_asset_urls": remote_asset_urls,
        "images": parser.images,
        "scripts": parser.scripts,
        "style_blocks": parser.styles,
        "controls": parser.controls,
        "tables": parser.tables,
        "static_signals": {
            "skip_link": 'class="skip-link"' in text,
            "focus_visible": ":focus-visible" in text,
            "prefers_reduced_motion": "prefers-reduced-motion" in text,
            "prefers_color_scheme": "prefers-color-scheme" in text,
            "print_styles": "@media print" in text,
            "uses_local_storage": "localStorage" in text,
            "uses_match_media": "matchMedia(" in text,
            "uses_color_mix": "color-mix(" in text,
            "uses_backdrop_filter": "backdrop-filter" in text,
            "inline_style_attribute_count": len(re.findall(r'''\sstyle=["']''', text, flags=re.IGNORECASE)),
            "inline_event_handler_count": len(re.findall(r'''\son[a-z]+\s*=["']''', text, flags=re.IGNORECASE)),
            "unsafe_eval_count": len(re.findall(r"\beval\s*\(", text)),
            "document_write_count": len(re.findall(r"\bdocument\.write\s*\(", text)),
        },
        "instrument_scope": "Static HTML structure and lexical signals only; no CSS layout, keyboard, screen-reader, runtime, or semantic accessibility verdict.",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("html", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = inspect(args.html)
    rendered = json.dumps(result, indent=2, ensure_ascii=False) + "\n"
    if args.output:
        args.output.write_text(rendered)
    else:
        print(rendered, end="")


if __name__ == "__main__":
    main()
