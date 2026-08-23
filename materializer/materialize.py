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
import shutil
import sys
import tempfile
import uuid
from pathlib import Path

from amanuensis_materializer import Materializer


def unmanaged_output_files(output: Path) -> list[str]:
    """Return files a prior Amanuensis manifest does not claim.

    Clean publication replaces the directory as one unit.  A manifest proves
    Amanuensis has custody of its listed pages, not of arbitrary files a human
    may have placed beside them.
    """
    if not output.exists() or not any(output.iterdir()):
        return []
    manifest_path = output / ".manifest.json"
    if not manifest_path.is_file():
        return [str(path.relative_to(output)) for path in output.rglob("*") if path.is_file()]
    try:
        manifest = json.loads(manifest_path.read_text())
    except (json.JSONDecodeError, OSError):
        return [str(manifest_path.relative_to(output))]
    owned = {
        ".manifest.json",
        ".projection-contract.json",
        *(str(page["path"]) for page in manifest.get("pages", []) if "path" in page),
        *(str(item["path"]) for item in manifest.get("projection_files", []) if "path" in item),
    }
    return sorted(
        str(path.relative_to(output))
        for path in output.rglob("*")
        if path.is_file() and str(path.relative_to(output)) not in owned
    )


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
        "--clean-publish",
        action="store_true",
        help="Render and verify in an isolated staging directory, then replace a known generated output only if every read-back axis is green.",
    )
    parser.add_argument(
        "--readback-only",
        action="store_true",
        help="Verify the existing projection without rendering or changing it.",
    )
    parser.add_argument(
        "--no-verify-readback",
        action="store_true",
        help="Skip post-render read-back (diagnostic compatibility escape hatch; not suitable for publication).",
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
    if args.clean_publish and args.readback_only:
        print(
            json.dumps(
                {"ok": False, "error": "--clean-publish and --readback-only are mutually exclusive"}
            )
        )
        return 2
    if args.readback_only:
        summary = Materializer(storage=storage, output=output).verify_projection()
        summary.update(
            {
                "output_dir": str(output),
                "html_entrypoint": str(output / "index.html"),
                "mode": "readback",
                "published": False,
            }
        )
        print(json.dumps(summary))
        return 0 if summary.get("ok", False) else 1

    if args.clean_publish:
        output.parent.mkdir(parents=True, exist_ok=True)
        unmanaged = unmanaged_output_files(output)
        if unmanaged:
            print(
                json.dumps(
                    {
                        "ok": False,
                        "error": f"refusing clean replacement; output contains unmanaged files: {', '.join(unmanaged[:10])}",
                        "output_dir": str(output),
                        "mode": "clean-publish",
                        "published": False,
                    }
                )
            )
            return 2
        stage = Path(
            tempfile.mkdtemp(prefix=f".{output.name}.amanuensis-stage-", dir=output.parent)
        )
        backup: Path | None = None
        try:
            summary = Materializer(
                storage=storage,
                output=stage,
                force_full=True,
                verify_readback=not args.no_verify_readback,
            ).materialize()
            summary.update({"output_dir": str(output), "mode": "clean-publish", "published": False})
            if summary.get("ok", False):
                if output.exists():
                    backup = output.with_name(
                        f".{output.name}.amanuensis-backup-{uuid.uuid4().hex}"
                    )
                    output.rename(backup)
                stage.rename(output)
                summary["published"] = True
                if backup is not None:
                    try:
                        shutil.rmtree(backup)
                        backup = None
                    except OSError as exc:
                        summary.setdefault("warnings", []).append(
                            f"published successfully but retained prior output at {backup}: {exc}"
                        )
                        summary["backup_retained"] = str(backup)
            else:
                shutil.rmtree(stage)
        except Exception:
            if stage.exists():
                shutil.rmtree(stage)
            if backup is not None and backup.exists() and not output.exists():
                backup.rename(output)
            raise
    else:
        output.mkdir(parents=True, exist_ok=True)
        summary = Materializer(
            storage=storage,
            output=output,
            force_full=args.force_full,
            verify_readback=not args.no_verify_readback,
        ).materialize()
        summary.update({"mode": "readback", "published": summary.get("ok", False)})
    summary["html_entrypoint"] = str(output / "index.html")
    print(json.dumps(summary))
    return 0 if summary.get("ok", False) else 1


if __name__ == "__main__":
    sys.exit(main())
