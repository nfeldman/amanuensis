#!/usr/bin/env python3
"""Fault-injection checks for trial-inspection.py detector 1.0.0."""

from __future__ import annotations

import importlib.util
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("trial_inspection", ROOT / "trial-inspection.py")
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="amanuensis-trial-red-proof-") as raw:
        base = Path(raw)
        write(base / "app.js", "console.log('ok')")
        write(base / "index.html", '<!doctype html><html><body><main><h1>X</h1><script src="app.js"></script></main></body></html>')
        clean = module.scan_candidate("clean", base)
        assert clean["remote_asset_urls"] == []
        assert clean["unresolved_local_references"] == []
        assert clean["module_scripts"] == 0

        write(base / "index.html", '<!doctype html><html><body><main><h1>X</h1><script src="https://example.invalid/app.js"></script></main></body></html>')
        remote = module.scan_candidate("remote", base)
        assert remote["remote_asset_urls"] == ["https://example.invalid/app.js"]

        write(base / "index.html", '<!doctype html><html><body><main><h1>X</h1><script src="missing.js"></script></main></body></html>')
        missing = module.scan_candidate("missing", base)
        assert missing["unresolved_local_references"] == ["index.html -> missing.js"]

        write(base / "index.html", '<!doctype html><html><body><main><h1>X</h1><script type="module">export {};</script></main></body></html>')
        module_arm = module.scan_candidate("module", base)
        assert module_arm["module_scripts"] == 1
        assert module_arm["inline_scripts"] == 1

    print("PASS: clean accept arm and remote, missing-reference, and module detection red arms")


if __name__ == "__main__":
    main()
