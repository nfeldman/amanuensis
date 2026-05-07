"""Slug, id, and path helpers.

Consistent routing for cross-reference resolution: every subsystem,
concern, seam, finding, diagnosticity matrix, and field note gets a
deterministic slug. The cross-ref resolver pass uses the same rules
to turn text like "B-01", "CC-1", "SM-3", "B01-1" into links.
"""
from __future__ import annotations

import re

SUBSYSTEM_ID_PAT = re.compile(r"(?<![\w-])([A-Z]+-\d{1,3})(?![\w-])")
CONCERN_ID_PAT = re.compile(r"(?<![\w-])([A-Z]{2,3}-\d{1,3})(?![\w-])")
# Finding codes like B01-1 or B-01-1 or similar
FINDING_ID_PAT = re.compile(r"(?<![\w-])([A-Z]+\d+-\d+)(?![\w-])")
# Diagnosticity matrix ids like DM-12
MATRIX_ID_PAT = re.compile(r"(?<![\w-])(DM-\d+)(?![\w-])")


def slugify(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^a-z0-9-]+", "-", text)
    return re.sub(r"-+", "-", text).strip("-") or "untitled"


def subsystem_slug(subsystem_id: str, name: str | None = None) -> str:
    sid = subsystem_id.lower().replace("-", "")
    if name:
        return f"{sid}-{slugify(name)}"
    return sid


def subsystem_page(subsystem_id: str, name: str | None = None) -> str:
    return f"subsystems/{subsystem_slug(subsystem_id, name)}.md"


def seam_slug(seam_id: str, shared_object: str | None = None) -> str:
    sid = seam_id.lower().replace("-", "")
    if shared_object:
        return f"{sid}-{slugify(shared_object)}"
    return sid


def seam_page(seam_id: str, shared_object: str | None = None) -> str:
    return f"seams/{seam_slug(seam_id, shared_object)}.md"


def matrix_slug(matrix_id: int) -> str:
    return f"dm-{matrix_id}"


def matrix_page(matrix_id: int) -> str:
    return f"diagnosticity/{matrix_slug(matrix_id)}.md"
