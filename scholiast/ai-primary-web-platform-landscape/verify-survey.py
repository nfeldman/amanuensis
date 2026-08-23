#!/usr/bin/env python3
"""Structural handoff audit for the durable Scholiast survey."""

from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REQUIRED_DOCS = {
    "README.md",
    "conspectus.md",
    "vocabulary.md",
    "baseline.md",
    "taxonomy.md",
    "vendor-matrix.md",
    "shortlist.md",
    "trials.md",
    "claims.md",
    "sources.md",
    "notes.md",
    "registry-trial-verification.md",
}
CLAIM_FIELDS = {
    "what",
    "how",
    "where",
    "when",
    "why",
    "confidence",
    "see-also",
    "classification",
}


def fail(message: str) -> None:
    raise SystemExit(f"FAIL: {message}")


missing_docs = sorted(name for name in REQUIRED_DOCS if not (ROOT / name).is_file())
if missing_docs:
    fail(f"missing required documents: {missing_docs}")

claims_text = (ROOT / "claims.md").read_text()
claim_sections = re.split(r"(?=^## C\d{3}\b)", claims_text, flags=re.MULTILINE)[1:]
claim_ids: set[str] = set()
for section in claim_sections:
    match = re.match(r"## (C\d{3})\b", section)
    if not match:
        fail("malformed claim heading")
    claim_id = match.group(1)
    if claim_id in claim_ids:
        fail(f"duplicate claim ID {claim_id}")
    claim_ids.add(claim_id)
    fields = set(re.findall(r"^- \*\*([a-z-]+):\*\*", section, flags=re.MULTILINE))
    if fields != CLAIM_FIELDS:
        fail(f"{claim_id} fields differ: missing={sorted(CLAIM_FIELDS-fields)}, extra={sorted(fields-CLAIM_FIELDS)}")

source_text = (ROOT / "sources.md").read_text()
source_ids = re.findall(r"^\| (S\d{3}) \|", source_text, flags=re.MULTILINE)
if len(source_ids) != len(set(source_ids)):
    fail("duplicate source IDs")
source_id_set = set(source_ids)

unknown_refs: list[str] = []
for path in sorted(ROOT.glob("*.md")):
    text = path.read_text()
    for source_id in set(re.findall(r"\bS\d{3}\b", text)):
        if source_id not in source_id_set:
            unknown_refs.append(f"{path.name}:{source_id}")
    for claim_id in set(re.findall(r"\bC\d{3}\b", text)):
        if claim_id not in claim_ids:
            unknown_refs.append(f"{path.name}:{claim_id}")
if unknown_refs:
    fail(f"unknown claim/source references: {unknown_refs}")

for path in sorted(ROOT.glob("*.json")):
    with path.open() as handle:
        json.load(handle)

print(
    "PASS: "
    f"{len(REQUIRED_DOCS)} required docs, "
    f"{len(claim_ids)} complete claims, "
    f"{len(source_ids)} unique sources, "
    "all top-level JSON parsed, and all claim/source IDs resolved"
)
