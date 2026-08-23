"""Manifest tracking for diff-aware rendering.

The manifest (`<output>/.manifest.json`) records, for every rendered
page, the sources it was derived from and their hashes. On subsequent
runs we re-hash each source and only re-render pages whose inputs
changed.

Source identifiers:
  - `db:<table>:<filter>`   — a DB query result; hash is sha256 of the
    canonical-JSON-serialized rows.
  - `prose:<rel-path>`      — a markdown file in the project storage
    directory; hash is sha256 of the file bytes.
  - `synthetic:<name>`      — generated page with no stable external
    source (used sparingly; always re-rendered).

The manifest also records the materializer version, so a version bump
invalidates every page automatically.
"""
from __future__ import annotations

import hashlib
import json
import warnings
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC
from pathlib import Path

MATERIALIZER_VERSION = "0.3.0"


def _now_iso() -> str:
    from datetime import datetime

    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass
class PageManifest:
    """Per-page record in the manifest."""

    path: str
    sources: dict[str, str] = field(default_factory=dict)  # source_id -> hash
    content_hash: str = ""
    rendered_at: str = ""


@dataclass
class Manifest:
    version: str = MATERIALIZER_VERSION
    generated_at: str = ""
    pages: dict[str, PageManifest] = field(default_factory=dict)
    # Generated companions that are derived from the finished Markdown
    # projection rather than directly from DB/prose sources.  Keeping them in
    # the same custody manifest lets clean publication distinguish our HTML
    # from unrelated files a human placed beside the docs.
    projection_files: dict[str, str] = field(default_factory=dict)

    @classmethod
    def load(cls, path: Path) -> Manifest:
        if not path.is_file():
            return cls(version=MATERIALIZER_VERSION)
        try:
            data = json.loads(path.read_text())
        except json.JSONDecodeError as e:
            # A corrupt manifest usually signals a concurrent write or a
            # filesystem issue. Rebuild from scratch so the next render
            # still produces consistent output, but surface the problem
            # rather than silently erasing the previous build's provenance.
            warnings.warn(
                f"manifest at {path} is corrupt ({e}); rebuilding from scratch",
                stacklevel=2,
            )
            return cls(version=MATERIALIZER_VERSION)
        m = cls(
            version=data.get("version", ""),
            generated_at=data.get("generated_at", ""),
            pages={
                p["path"]: PageManifest(
                    path=p["path"],
                    sources=dict(p.get("sources", {})),
                    content_hash=p.get("content_hash", ""),
                    rendered_at=p.get("rendered_at", ""),
                )
                for p in data.get("pages", [])
            },
            projection_files={
                str(p["path"]): str(p.get("content_hash", ""))
                for p in data.get("projection_files", [])
                if "path" in p
            },
        )
        return m

    def save(self, path: Path) -> None:
        self.generated_at = _now_iso()
        path.parent.mkdir(parents=True, exist_ok=True)
        serialized = {
            "version": MATERIALIZER_VERSION,
            "generated_at": self.generated_at,
            "pages": [
                {
                    "path": p.path,
                    "sources": dict(sorted(p.sources.items())),
                    "content_hash": p.content_hash,
                    "rendered_at": p.rendered_at,
                }
                for _, p in sorted(self.pages.items())
            ],
            "projection_files": [
                {"path": path, "content_hash": digest}
                for path, digest in sorted(self.projection_files.items())
            ],
        }
        path.write_text(json.dumps(serialized, indent=2, sort_keys=False))

    def page(self, path: str) -> PageManifest:
        if path not in self.pages:
            self.pages[path] = PageManifest(path=path)
        return self.pages[path]

    def drop(self, path: str) -> None:
        self.pages.pop(path, None)


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha256_json(obj: object) -> str:
    """Canonical JSON hash — sorted keys, stable separators."""
    return sha256_bytes(
        json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    )


def stable_sources(pairs: Iterable[tuple[str, str]]) -> dict[str, str]:
    return dict(sorted(pairs))


def sources_differ(prev: dict[str, str], curr: dict[str, str]) -> bool:
    if set(prev) != set(curr):
        return True
    return any(prev.get(k) != v for k, v in curr.items())


def prune_retired(manifest: Manifest, alive_paths: set[str], output_root: Path) -> list[str]:
    """Remove files that used to be rendered but no longer have an
    owning page. Returns the relative paths that were deleted."""
    retired: list[str] = []
    for path in list(manifest.pages):
        if path not in alive_paths:
            abs_path = output_root / path
            if abs_path.is_file():
                abs_path.unlink()
            manifest.drop(path)
            retired.append(path)
    return retired
