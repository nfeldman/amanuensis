#!/usr/bin/env python3
"""Audit Markdown link targets in the durable survey workspace.

Detector 1.0.0. HTTP 401/403/405/429 responses count as resolving but access-
limited; only DNS/transport failures and 404/410 responses count as broken.
"""

from __future__ import annotations

import concurrent.futures
import json
import re
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
LINK_RE = re.compile(r"\[[^\]]*\]\(([^)]+)\)")
DETECTOR_VERSION = "1.0.0"


def extract() -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    local: list[dict[str, str]] = []
    remote: list[dict[str, str]] = []
    for source in sorted(ROOT.glob("*.md")):
        text = source.read_text(encoding="utf-8")
        for match in LINK_RE.finditer(text):
            raw = match.group(1).strip()
            if raw.startswith("<") and raw.endswith(">"):
                raw = raw[1:-1]
            target = raw.split("#", 1)[0]
            if not target:
                continue
            parsed = urlparse(target)
            item = {"source": source.name, "target": raw}
            if parsed.scheme in {"http", "https"}:
                remote.append(item)
            elif parsed.scheme == "":
                path = Path(unquote(target))
                resolved = path if path.is_absolute() else source.parent / path
                item["resolved"] = str(resolved.resolve())
                local.append(item)
    return local, remote


def check_remote(url: str) -> dict[str, object]:
    headers = {"User-Agent": "Amanuensis-Scholiast-Link-Audit/1.0"}
    for method in ("HEAD", "GET"):
        request = urllib.request.Request(url, method=method, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                return {"url": url, "status": response.status, "ok": response.status < 400, "method": method}
        except urllib.error.HTTPError as error:
            if error.code == 405 and method == "HEAD":
                continue
            return {"url": url, "status": error.code, "ok": error.code in {401, 403, 405, 429}, "method": method}
        except Exception as error:  # transport result is part of the audit record
            if method == "HEAD":
                continue
            return {"url": url, "status": None, "ok": False, "method": method, "error": f"{type(error).__name__}: {error}"}
    return {"url": url, "status": None, "ok": False, "method": "GET", "error": "no result"}


def main() -> None:
    local, remote = extract()
    local_results = [{**item, "ok": Path(item["resolved"]).exists()} for item in local]
    urls = sorted({item["target"] for item in remote})
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        remote_results = list(pool.map(check_remote, urls))
    print(json.dumps({
        "detector": "link-audit.py",
        "detector_version": DETECTOR_VERSION,
        "run_date": "2026-08-22",
        "local": {
            "references": len(local_results),
            "unique_targets": len({item["resolved"] for item in local_results}),
            "failures": [item for item in local_results if not item["ok"]],
        },
        "remote": {
            "references": len(remote),
            "unique_targets": len(urls),
            "failures": [item for item in remote_results if not item["ok"]],
            "access_limited": [item for item in remote_results if item.get("status") in {401, 403, 405, 429}],
            "status_counts": {str(status): sum(1 for item in remote_results if item.get("status") == status) for status in sorted({item.get("status") for item in remote_results}, key=lambda value: (-1 if value is None else value))},
        },
        "limitations": [
            "Resolution does not prove that a page supports the associated claim.",
            "Anchor fragments are not checked.",
            "Access-limited HTTP responses are not classified as broken.",
        ],
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
