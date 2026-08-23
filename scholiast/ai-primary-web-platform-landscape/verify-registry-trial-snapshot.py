#!/usr/bin/env python3
"""Require live registry-trial inspection to match the recorded snapshot."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
recorded = json.loads((ROOT / "registry-trial-inspection.json").read_text(encoding="utf-8"))
live = json.loads(subprocess.check_output(["python3", "registry-trial-inspection.py"], cwd=ROOT))
assert live == recorded, "live registry-trial inspection differs from recorded snapshot"
print("registry trial snapshot matches live outputs")
