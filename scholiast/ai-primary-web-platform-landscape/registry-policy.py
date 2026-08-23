#!/usr/bin/env python3
"""Red-proved declared-payload policy for the pinned registry trial.

Detector 1.0.0 examines registry declarations and paths. It does not parse or
execute component source and cannot certify dependency or behavior safety.
"""

from __future__ import annotations

import copy
import json
import re
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent
SNAPSHOT = ROOT / "trials" / "shadcn-copy" / "registry-snapshot.json"
DETECTOR_VERSION = "1.0.0"
PINNED_GITHUB = re.compile(r"^[^/]+/[^/]+/.+#(?:[0-9a-fA-F]{40})$")


def violations(item: dict[str, object]) -> list[str]:
    found: list[str] = []
    if item.get("envVars"):
        found.append("environment variables requested")
    for dependency in item.get("registryDependencies", []):
        value = str(dependency)
        if value.startswith(("http://", "https://")):
            found.append(f"unpinned URL registry dependency: {value}")
        elif "/" in value and not value.startswith("@") and not PINNED_GITHUB.fullmatch(value):
            found.append(f"unpinned GitHub registry dependency: {value}")
    for file in item.get("files", []):
        value = str(file.get("path", ""))
        path = PurePosixPath(value)
        if path.is_absolute() or ".." in path.parts:
            found.append(f"unsafe file path: {value}")
    return found


def assert_rejected(item: dict[str, object], expected: str) -> None:
    observed = violations(item)
    assert any(expected in entry for entry in observed), (expected, observed)


def main() -> None:
    snapshot = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    clean = [violations(item) for item in snapshot["items"]]
    assert clean == [[] for _ in snapshot["items"]], clean

    base = copy.deepcopy(snapshot["items"][0])
    env_arm = copy.deepcopy(base)
    env_arm["envVars"] = {"REPORT_TOKEN": "required"}
    assert_rejected(env_arm, "environment variables")

    remote_arm = copy.deepcopy(base)
    remote_arm["registryDependencies"] = ["https://example.test/r/widget.json"]
    assert_rejected(remote_arm, "unpinned URL")

    github_arm = copy.deepcopy(base)
    github_arm["registryDependencies"] = ["example/widgets/widget#main"]
    assert_rejected(github_arm, "unpinned GitHub")

    path_arm = copy.deepcopy(base)
    path_arm["files"][0]["path"] = "../../outside.tsx"
    assert_rejected(path_arm, "unsafe file path")

    print(json.dumps({
        "detector": "registry-policy.py",
        "detector_version": DETECTOR_VERSION,
        "run_date": "2026-08-22",
        "clean_items_accepted": len(snapshot["items"]),
        "red_arms_rejected": ["envVars", "unpinned URL", "unpinned GitHub ref", "path traversal"],
        "limitations": [
            "Declared registry payload policy only; copied source is not executed or certified.",
            "Package-manager lifecycle scripts, transitive dependencies, and registry server compromise are out of scope.",
            "A clean result is not a security verdict.",
        ],
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
