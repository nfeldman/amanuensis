#!/usr/bin/env python3
"""Amanuensis materializer.

Reads `memory.db` + prose artifacts from a project storage directory
and renders a navigable documentation site under `<storage>/docs/`.

Diff-aware: per-page source hashes are tracked in `docs/.manifest.json`;
on subsequent runs only pages whose DB or prose sources changed are
re-rendered. Cross-references (B-01, CC-1, SM-3, B01-1, etc.) are
resolved to working relative links in a global post-processing pass.

Exit status is 0 on success, non-zero on error. The last line of stdout
is a JSON summary the MCP server parses.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from amanuensis_materializer import Materializer


def main() -> int:
    parser = argparse.ArgumentParser(description="Render Amanuensis docs from memory.db + prose.")
    parser.add_argument(
        "--storage",
        required=True,
        help="Project storage directory (contains memory.db and prose artifacts).",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Output directory (default: <storage>/docs).",
    )
    parser.add_argument(
        "--force-full",
        action="store_true",
        help="Re-render every page regardless of manifest state.",
    )
    parser.add_argument(
        "--json-summary",
        action="store_true",
        default=True,
        help="Emit a JSON summary as the final stdout line (on by default).",
    )
    args = parser.parse_args()

    storage = Path(args.storage).resolve()
    if not storage.is_dir():
        print(json.dumps({"ok": False, "error": f"storage dir not found: {storage}"}))
        return 2
    db_path = storage / "memory.db"
    if not db_path.is_file():
        print(json.dumps({"ok": False, "error": f"memory.db not found at {db_path}"}))
        return 2

    output = Path(args.output).resolve() if args.output else (storage / "docs").resolve()
    output.mkdir(parents=True, exist_ok=True)

    m = Materializer(storage=storage, output=output, force_full=args.force_full)
    summary = m.materialize()
    print(json.dumps(summary))
    return 0 if summary.get("ok", True) else 1


if __name__ == "__main__":
    sys.exit(main())
