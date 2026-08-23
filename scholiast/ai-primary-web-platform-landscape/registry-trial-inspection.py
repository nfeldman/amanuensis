#!/usr/bin/env python3
"""Measure the pinned copy-owned registry trial and its reject arm."""

from __future__ import annotations

import importlib.util
import json
import re
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TRIAL = ROOT / "trials" / "shadcn-copy"
DETECTOR_VERSION = "1.0.0"

spec = importlib.util.spec_from_file_location("base_trial_inspection", ROOT / "trial-inspection.py")
assert spec and spec.loader
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


class DomDetail(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.elements = 0
        self.class_attributes = 0
        self.class_tokens = 0
        self.data_slot_elements = 0
        self.divs = 0
        self.buttons = 0
        self.labels_for_filter = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.elements += 1
        values = dict(attrs)
        if tag == "div":
            self.divs += 1
        if tag == "button":
            self.buttons += 1
        if tag == "label" and values.get("for") == "filter":
            self.labels_for_filter += 1
        if "class" in values:
            self.class_attributes += 1
            self.class_tokens += len((values.get("class") or "").split())
        if "data-slot" in values:
            self.data_slot_elements += 1


def metrics(paths: list[Path]) -> dict[str, int]:
    return {
        "files": len(paths),
        "bytes": sum(path.stat().st_size for path in paths),
        "nonblank_lines": sum(
            sum(1 for line in path.read_text(encoding="utf-8").splitlines() if line.strip())
            for path in paths
        ),
        "import_statements": sum(
            len(re.findall(r"^import\s", path.read_text(encoding="utf-8"), re.MULTILINE))
            for path in paths
            if path.suffix in {".ts", ".tsx", ".js", ".mjs"}
        ),
    }


def installed_footprint() -> dict[str, int]:
    root = TRIAL / "node_modules"
    files = [path for path in root.rglob("*") if path.is_file() and not path.is_symlink()]
    packages = [path for path in root.rglob("package.json") if ".cache" not in path.parts]
    return {
        "installed_package_directories": len(packages),
        "installed_files": len(files),
        "installed_bytes": sum(path.stat().st_size for path in files),
    }


def dom_detail(path: Path) -> dict[str, int]:
    parser = DomDetail()
    parser.feed(path.read_text(encoding="utf-8"))
    return {
        "elements": parser.elements,
        "class_attributes": parser.class_attributes,
        "class_tokens": parser.class_tokens,
        "data_slot_elements": parser.data_slot_elements,
        "divs": parser.divs,
        "buttons": parser.buttons,
        "labels_for_filter": parser.labels_for_filter,
    }


def main() -> None:
    copied = sorted((TRIAL / "src" / "components" / "ui").glob("*.tsx")) + [TRIAL / "src" / "lib" / "utils.ts"]
    authored = [
        TRIAL / "src" / "report.tsx",
        TRIAL / "src" / "client.tsx",
        TRIAL / "src" / "report-filter.js",
        TRIAL / "scripts" / "build-document.tsx",
    ]
    document = base.scan_candidate("shadcn-copy-document", TRIAL / "dist")
    client = base.scan_candidate("shadcn-copy-client-owned-reject", TRIAL / "dist-client")
    result = {
        "detector": "registry-trial-inspection.py",
        "detector_version": DETECTOR_VERSION,
        "run_date": "2026-08-22",
        "registry_cli": "shadcn@4.19.0",
        "registry_style": "base-nova",
        "source_metrics": {
            "registry_copied_plus_init_utility": metrics(copied),
            "fixture_authored": metrics(authored),
        },
        "installed_footprint": installed_footprint(),
        "outputs": [document, client],
        "generated_dom_detail": {
            "document": dom_detail(TRIAL / "dist" / "index.html"),
            "client_authored_html": dom_detail(TRIAL / "dist-client" / "index.html"),
        },
        "limitations": [
            "Static inspection only; JavaScript and assistive technology were not executed.",
            "The fixture is a feasibility probe, not evidence of AI productivity or typical project size.",
            "Installed bytes include the CLI and build-only packages and are not browser payload.",
            "The copied-source group includes the CLI-generated cn utility because installed components import it.",
        ],
    }
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
