"""Manifest tracking for diff-aware rendering.

The manifest (`<output>/.manifest.json`) records, for every planned page
(by its plan id), the sources it was derived from and their hashes, and the
files the publication wrote (`projection_files`). On subsequent
runs we re-hash each source and only re-render pages whose inputs
changed.

Source identifiers:
  - `db:<table>:<filter>`   — a DB query result; hash is sha256 of the
    canonical-JSON-serialized rows.
  - `db:imports:<kind>`     — the imported bodies a page printed, which
    the store holds as written; hash is sha256 of their canonical JSON. No
    source names a file under the storage directory: a page's inputs are
    the store's rows (store-only PLAN §3.3).
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

MATERIALIZER_VERSION = "0.6.0"


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
    # The hash of the page's Markdown after cross-reference resolution, so a
    # page whose own text is unchanged but whose links changed is counted.
    linked_hash: str = ""


@dataclass
class Manifest:
    version: str = MATERIALIZER_VERSION
    generated_at: str = ""
    pages: dict[str, PageManifest] = field(default_factory=dict)
    # The files a publication writes: every HTML page, `search-index.js` and the
    # content-hashed `assets/site.*.css` and `.js`.
    # Keeping them in the custody manifest lets clean publication distinguish
    # our HTML from unrelated files a human placed beside the docs.
    projection_files: dict[str, str] = field(default_factory=dict)
    # True when loaded from a manifest written before HTML became the only view
    # (it has no `views` key): its `pages` paths are `.md` files that run wrote
    # beside the HTML. Since then `pages` holds page ids and their source
    # hashes only, and no `.md` is written (store-only PLAN §3.2 step 3).
    markdown_pages: bool = False

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
                    linked_hash=p.get("linked_hash", ""),
                )
                for p in data.get("pages", [])
            },
            projection_files={
                str(p["path"]): str(p.get("content_hash", ""))
                for p in data.get("projection_files", [])
                if "path" in p
            },
            markdown_pages="views" not in data,
        )
        return m

    def save(self, path: Path) -> None:
        self.generated_at = _now_iso()
        path.parent.mkdir(parents=True, exist_ok=True)
        serialized = {
            "version": MATERIALIZER_VERSION,
            "generated_at": self.generated_at,
            "views": ["html"],
            "pages": [
                {
                    "path": p.path,
                    "sources": dict(sorted(p.sources.items())),
                    "content_hash": p.content_hash,
                    "rendered_at": p.rendered_at,
                    "linked_hash": p.linked_hash,
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


def prune_retired(manifest: Manifest, alive_paths: set[str]) -> list[str]:
    """Drop the page ids no plan holds any more. Returns the ids dropped.

    A page id names no file: a retired page's HTML is removed with the
    publication's projection files (`render_html_projection`).
    """
    retired = [path for path in manifest.pages if path not in alive_paths]
    for path in retired:
        manifest.drop(path)
    return retired


def remove_markdown_pages(manifest: Manifest, output_root: Path) -> list[str]:
    """Delete the `.md` pages a manifest from before HTML-only output claims.

    Only files that manifest names are removed; any other `.md` in the output
    is not ours, and a clean publish refuses it (`unmanaged_output_files`).
    Returns the paths deleted, and marks the manifest as holding ids only.
    """
    if not manifest.markdown_pages:
        return []
    root = output_root.resolve()
    removed: list[str] = []
    for path in sorted(manifest.pages):
        if not path.endswith(".md"):
            continue
        target = (root / path).resolve()
        try:
            target.relative_to(root)
        except ValueError:
            continue
        if target.is_file():
            target.unlink()
            removed.append(path)
    manifest.markdown_pages = False
    return removed
