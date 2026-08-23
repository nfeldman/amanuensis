#!/usr/bin/env python3
"""Verify that live detector output matches the recorded trial snapshot."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
recorded = json.loads((ROOT / "trial-inspection.json").read_text(encoding="utf-8"))
live = json.loads(subprocess.check_output([sys.executable, str(ROOT / "trial-inspection.py")], text=True))
assert live == recorded, "live trial inspection differs from trial-inspection.json"
print("PASS: live trial inspection exactly matches recorded snapshot")
