#!/usr/bin/env python3
"""Measure installed dependency closures for the pinned build trials.

Detector 1.0.0. Counts reflect npm's concrete, deduplicated installation on
this machine; they are neither registry tarball sizes nor browser payloads.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "trials"
NODE_MODULES = ROOT / "node_modules"
DETECTOR_VERSION = "1.0.0"

ROOTS = {
    "eleventy": ["@11ty/eleventy"],
    "astro": ["astro"],
    "observable-framework": ["@observablehq/framework"],
    "lit-iife": ["lit", "esbuild"],
    "alpine-csp": ["@alpinejs/csp"],
}


def package_path(base: Path, name: str) -> Path | None:
    current = base
    while True:
        candidate = current / "node_modules" / name
        if (candidate / "package.json").exists():
            return candidate.resolve()
        if current == ROOT or current.parent == current:
            break
        if current.name == "node_modules":
            current = current.parent
        elif current.parent.name == "node_modules" and current.name.startswith("@"):
            current = current.parent.parent
        else:
            current = current.parent
    candidate = NODE_MODULES / name
    return candidate.resolve() if (candidate / "package.json").exists() else None


def dependencies(path: Path) -> list[str]:
    manifest = json.loads((path / "package.json").read_text(encoding="utf-8"))
    names: set[str] = set()
    for field in ("dependencies", "optionalDependencies"):
        names.update(manifest.get(field, {}))
    return sorted(names)


def directory_bytes(path: Path) -> int:
    return sum(p.stat().st_size for p in path.rglob("*") if p.is_file() and not p.is_symlink())


def closure(roots: list[str]) -> dict[str, object]:
    queue: list[Path] = []
    unresolved: list[str] = []
    for name in roots:
        found = package_path(ROOT, name)
        if found is None:
            unresolved.append(name)
        else:
            queue.append(found)
    seen: set[Path] = set()
    while queue:
        path = queue.pop()
        if path in seen:
            continue
        seen.add(path)
        manifest = json.loads((path / "package.json").read_text(encoding="utf-8"))
        for name in dependencies(path):
            found = package_path(path, name)
            if found is None:
                unresolved.append(f"{manifest.get('name')} -> {name}")
            else:
                queue.append(found)
    return {
        "root_packages": roots,
        "installed_package_directories": len(seen),
        "installed_bytes": sum(directory_bytes(path) for path in seen),
        "unresolved_optional_or_platform_dependency_count": len(set(unresolved)),
    }


def main() -> None:
    print(json.dumps({
        "detector": "dependency-footprint.py",
        "detector_version": DETECTOR_VERSION,
        "run_date": "2026-08-22",
        "limitations": [
            "Concrete npm 11.17.0 installation on macOS with Node 26.5.0.",
            "Counts include optional dependencies installed for this platform and omit peer-only packages not reached as dependency edges.",
            "Bytes can overlap across candidate closures because npm deduplicates shared packages.",
            "Installed bytes are build-environment cost, not delivered browser bytes.",
        ],
        "candidates": {name: closure(roots) for name, roots in ROOTS.items()},
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
