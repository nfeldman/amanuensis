"""What the import copies out of an earlier version's hand-written files.

`import_artifact_bodies` (the server, design/store-only/PLAN.md §5.2) stores
every registered file as written and extracts three things from them: the
thesis, the project name and the runtime boundary table. It extracts them with
the functions the pages print them with, by running this module, so there is
one copy of each rule:

- the thesis is what `read_thesis` returns, printed only when its state is
  `filled` (a refused or absent thesis is not one the overview prints);
- the project name is the `**Codebase**:` line, as `recorded_project_name`
  reads it;
- the runtime rows are the table `_runtime_boundary_table` finds, split into
  cells as the page splits them.

Nothing else is parsed. The module reads the storage directory and writes
nothing; it prints one JSON object on stdout:

    python -I -c "...; from amanuensis_materializer.legacy_extract import main; main([storage])"
"""

from __future__ import annotations

import json
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from .diagrams import RUNTIME_BOUNDARY_COLUMNS, _runtime_boundary_table, _table_cells
from .renderers import read_thesis, recorded_project_name

ONBOARDING_REPORT = "onboarding-report.md"


def runtime_rows(table: str | None) -> tuple[list[dict[str, str | None]], list[str]]:
    """The table's rows as runtime boundaries, and why any row was left out.

    A row is left out when it does not have one cell per column, or when the
    runtime, its peer or the mechanism is blank: the store cannot key an edge
    without them. The file keeps the row either way.
    """

    if not table:
        return [], []
    kept: list[dict[str, str | None]] = []
    skipped: list[str] = []
    for line in table.splitlines()[2:]:
        cells = _table_cells(line)
        if len(cells) != len(RUNTIME_BOUNDARY_COLUMNS):
            skipped.append(f"{line.strip()}: {len(cells)} cells, not {len(RUNTIME_BOUNDARY_COLUMNS)}")
            continue
        runtime, language, peer, mechanism, notes = cells
        if not (runtime and peer and mechanism):
            skipped.append(f"{line.strip()}: a runtime, its peer and the mechanism are each needed")
            continue
        kept.append(
            {
                "from_runtime": runtime,
                "from_language": language or None,
                "to_runtime": peer,
                "mechanism": mechanism,
                "notes": notes or None,
            }
        )
    return kept, skipped


def extract(storage: Path) -> dict[str, Any]:
    """The thesis, project name and runtime rows the storage directory's files carry."""

    thesis = read_thesis(storage)
    report = storage / ONBOARDING_REPORT
    table = _runtime_boundary_table(report.read_text() if report.is_file() else "")
    rows, skipped = runtime_rows(table)
    return {
        "thesis": {
            "state": thesis.state,
            "text": thesis.text if thesis.state == "filled" else None,
            "violations": list(thesis.violations),
        },
        "project_name": recorded_project_name(storage),
        "runtime_boundaries": rows,
        "runtime_boundaries_skipped": skipped,
    }


def main(argv: Sequence[str]) -> int:
    if len(argv) != 1:
        print("usage: legacy_extract <storage directory>", file=sys.stderr)
        return 2
    storage = Path(argv[0])
    if not storage.is_dir():
        print(f"legacy_extract: {storage} is not a directory", file=sys.stderr)
        return 2
    print(json.dumps(extract(storage), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
