#!/usr/bin/env python3
"""Profile the Markdown table shapes in a materialized Amanuensis corpus."""

from __future__ import annotations

import argparse
import re
import statistics
from collections import defaultdict
from pathlib import Path


def split_row(line: str) -> list[str]:
    raw = line.strip().strip("|")
    return [cell.strip().replace(r"\|", "|") for cell in re.split(r"(?<!\\)\|", raw)]


def is_separator(line: str) -> bool:
    cells = split_row(line)
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells)


def plain(value: str) -> str:
    value = re.sub(r"<[^>]+>", "", value)
    value = re.sub(r"\[([^]]+)]\([^)]+\)", r"\1", value)
    return value.replace("**", "").replace("__", "").replace("`", "").strip()


def percentile(values: list[int], fraction: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, round((len(ordered) - 1) * fraction))]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("docs", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    tables: dict[tuple[str, ...], list[list[str]]] = defaultdict(list)
    files_by_shape: dict[tuple[str, ...], set[str]] = defaultdict(set)

    for path in sorted(args.docs.rglob("*.md")):
        lines = path.read_text().splitlines()
        index = 0
        while index + 1 < len(lines):
            if lines[index].startswith("|") and is_separator(lines[index + 1]):
                headers = tuple(plain(cell) for cell in split_row(lines[index]))
                index += 2
                while index < len(lines):
                    if lines[index].startswith("<!--") and lines[index].rstrip().endswith("-->"):
                        index += 1
                        continue
                    if not lines[index].startswith("|"):
                        break
                    values = split_row(lines[index])
                    values += [""] * max(0, len(headers) - len(values))
                    tables[headers].append(values[: len(headers)])
                    files_by_shape[headers].add(str(path.relative_to(args.docs)))
                    index += 1
                continue
            index += 1

    ranked = sorted(tables, key=lambda shape: (-len(files_by_shape[shape]), -len(tables[shape]), shape))
    report = [
        "# AxiomDB table-shape profile",
        "",
        f"**Corpus:** `{args.docs.resolve()}`",
        "",
        f"Found {len(ranked)} distinct table schemas across {sum(len(v) for v in tables.values())} data rows.",
        "",
        "Lengths are visible-text characters after removing Markdown links, emphasis, code delimiters, and raw anchors. They describe this corpus, not reader performance.",
        "",
    ]

    for headers in ranked:
        rows = tables[headers]
        report.extend(
            [
                f"## {' · '.join(headers)}",
                "",
                f"**Occurrence:** {len(files_by_shape[headers])} file(s), {len(rows)} row(s)",
                "",
                "| Field | Median | 90th percentile | Maximum | Empty |",
                "|---|---:|---:|---:|---:|",
            ]
        )
        for column, header in enumerate(headers):
            lengths = [len(plain(row[column])) for row in rows]
            report.append(
                f"| {header} | {round(statistics.median(lengths))} | {percentile(lengths, .9)} | {max(lengths, default=0)} | {sum(length == 0 for length in lengths)} |"
            )
        if "Symptom" in headers:
            symptom_index = headers.index("Symptom")
            lead_lengths = [
                len(re.split(r"(?<=[.!?])\s+", plain(row[symptom_index]), maxsplit=1)[0])
                for row in rows
            ]
            report.extend(
                [
                    "",
                    "**Finding lead-sentence length:** "
                    f"median {round(statistics.median(lead_lengths))}, "
                    f"90th percentile {percentile(lead_lengths, .9)}, "
                    f"maximum {max(lead_lengths, default=0)} characters. "
                    "The source model has no separate finding-title field.",
                ]
            )
        report.append("")

    args.output.write_text("\n".join(report) + "\n")


if __name__ == "__main__":
    main()
