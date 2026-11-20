#!/usr/bin/env python3
"""GATE SO1 — contract enums for the store-only records (packet SO1).

`design/store-only/PLAN.md` §8 SO1, §2.1 (narrative sections), §2.2, §7.2 (flow marks).

Turns red when:
  - `gen-vocabulary.mjs --check` or `--check-sql` is red on the tree as committed;
  - the contract lacks any of `narrative_section`, `narrative_disposition`,
    `claim_mark_kind`, `territory_disposition`, `runtime_boundary_origin`, or one of
    them differs from the plan: the values and their order; the nine sections with
    their `subject_type`, `min_status` (scoping, concerns, adversarial on the three
    subsystem sections, none on a project section) and `evidence` (required, except
    optional for `survey-plan`); the five mark kinds with `applies_to` a claim key
    family (`flow`), `requires`, and `only_step` 00 on `trigger`; a missing label,
    meaning or `cannot_justify`; a missing `reader_facing` flag;
  - any of the five carries an `sql` binding (SO2 adds them with the DDL, so
    `--check-sql` holds at every commit);
  - the generated `vocabulary.py` or `vocabulary.ts` lacks the enums, their constant
    arrays, or the per-value metadata the contract carries;
  - the generator accepts a broken copy of the contract (run on a scratch copy of
    the tree, one sabotage at a time) carrying: a subsystem section without a
    `min_status`; one whose `min_status` is not on the subsystem_status ladder; a
    project section with a `min_status`; a mark kind whose `applies_to` is missing or
    not a claim key family; a duplicate label (as spelled, or in other case and
    padded with whitespace); a `requires` naming a column a mark does not have; an
    `evidence` other than required or optional; a section with a `subject_type`
    other than subsystem or project; a new enum missing `reader_facing`;
  - the generator rejects the unbroken copy, rejects a valid copy that adds a
    section, or writes any file on a rejected copy; the accepted addition does not
    reach the generated Python;
  - `contract_version` is not 1.2.0 (the minor bump);
  - CI does not run this gate.

Output protocol: exactly one status line, last, on stdout. Every message, including
anything captured from a spawned process, is scrubbed of the launcher's crash
signatures, so an absent deliverable reads as a failed assertion rather than as a
gate that never ran.
"""

from __future__ import annotations

import copy
import importlib.util
import json
import re
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
SOURCE_REL = "mcp-server/contracts/conspectus-vocabulary.json"
GEN_REL = "mcp-server/scripts/gen-vocabulary.mjs"
PY_REL = "materializer/amanuensis_materializer/vocabulary.py"
TS_REL = "mcp-server/src/vocabulary.ts"
CI_FILE = REPO / ".github" / "workflows" / "test.yml"
CI_COMMAND = "test-store-only-contract.py"
GATE = "GATE SO1"

_SCRUB: tuple[tuple[str, str], ...] = (
    ("Traceback (most recent call last)", "trace follows"),
    ("MODULE_NOT_FOUND", "module-absent"),
    ("ModuleNotFoundError", "python-module-absent"),
    ("Cannot find module", "cannot load module"),
    ("No such file or directory", "path is absent"),
    ("No such file", "path is absent"),
    ("SyntaxError", "syntax-error"),
    ("ImportError", "python-import-error"),
    ("ReferenceError", "reference-error"),
    ("ENOENT", "PATH-ABSENT"),
    ("is not defined", "is undeclared"),
    ("command not found", "executable is absent"),
)


def scrub(text: object) -> str:
    out = "" if text is None else str(text)
    for needle, replacement in _SCRUB:
        out = out.replace(needle, replacement)
    return out


def emit(line: str = "") -> None:
    sys.stdout.write(f"{scrub(line)}\n")


FAILURES: list[str] = []


def check(label: str, fn: Callable[[], str | None]) -> None:
    try:
        reason = fn()
    except Exception as exc:  # the gate must survive any absent deliverable
        reason = f"raised while checking — {exc!r}"
    if reason:
        FAILURES.append(f"{label}: {reason}")
        emit(f"  FAIL {label}: {reason}")
    else:
        emit(f"  ok   {label}")


def run(cmd: list[str], cwd: Path) -> tuple[int, str]:
    try:
        done = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=180)
    except (OSError, subprocess.SubprocessError) as exc:
        return 1, f"could not run {cmd[0]}: {exc!r}"
    return done.returncode, (done.stdout or "") + (done.stderr or "")


# ---------------------------------------------------------------------------
# What the plan fixes (§2.1, §2.2, §7.2, §8 SO1).
# ---------------------------------------------------------------------------
NEW_ENUMS = (
    "narrative_section",
    "narrative_disposition",
    "claim_mark_kind",
    "territory_disposition",
    "runtime_boundary_origin",
)
CONST_NAMES = {
    "narrative_section": "NARRATIVE_SECTIONS",
    "narrative_disposition": "NARRATIVE_DISPOSITIONS",
    "claim_mark_kind": "CLAIM_MARK_KINDS",
    "territory_disposition": "TERRITORY_DISPOSITIONS",
    "runtime_boundary_origin": "RUNTIME_BOUNDARY_ORIGINS",
}
# value -> (subject_type, min_status or None, evidence)
SECTIONS: dict[str, tuple[str, str | None, str]] = {
    "structure": ("subsystem", "scoping", "required"),
    "concern-reasoning": ("subsystem", "concerns", "required"),
    "challenge": ("subsystem", "adversarial", "required"),
    "repository-shape": ("project", None, "required"),
    "runtime": ("project", None, "required"),
    "stateful-entities": ("project", None, "required"),
    "concern-calibration": ("project", None, "required"),
    "start-here": ("project", None, "required"),
    "survey-plan": ("project", None, "optional"),
}
# kind -> (requires, only_step or None); every kind applies to the `flow` key family.
MARKS: dict[str, tuple[tuple[str, ...], str | None]] = {
    "commit-point": ((), None),
    "crash-point": (("label",), None),
    "exit": (("label", "target"), None),
    "crosses-seam": (("target",), None),
    "trigger": ((), "00"),
}
PLAIN: dict[str, tuple[str, ...]] = {
    "narrative_disposition": ("recorded", "declined", "withdrawn"),
    "territory_disposition": ("applies", "disqualified"),
    "runtime_boundary_origin": ("recorded", "imported"),
}


def load_source() -> dict[str, Any]:
    return json.loads((REPO / SOURCE_REL).read_text())


def load_py() -> Any:
    spec = importlib.util.spec_from_file_location("so1_vocabulary", REPO / PY_REL)
    if spec is None or spec.loader is None:
        raise RuntimeError("vocabulary.py could not be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def entries(doc: dict[str, Any], name: str) -> list[dict[str, Any]]:
    decl = doc["enums"].get(name)
    if decl is None:
        raise KeyError(f"enum {name} is absent")
    return decl["values"]


# ---------------------------------------------------------------------------
# The committed contract and its generated copies.
# ---------------------------------------------------------------------------
def check_generator_green() -> str | None:
    bad = []
    for flag in ("--check", "--check-sql"):
        code, out = run(["node", str(REPO / GEN_REL), flag], REPO / "mcp-server")
        if code != 0:
            bad.append(f"{flag} exits {code}: {out.strip()[-200:]}")
    return "; ".join(bad) or None


def check_version() -> str | None:
    got = load_source().get("contract_version")
    return None if got == "1.2.0" else f"contract_version is {got!r}, not '1.2.0'"


def check_shape_of_each() -> str | None:
    doc = load_source()
    bad = []
    for name in NEW_ENUMS:
        decl = doc["enums"].get(name)
        if decl is None:
            bad.append(f"{name} is absent")
            continue
        if decl.get("const_name") != CONST_NAMES[name]:
            bad.append(f"{name}.const_name is {decl.get('const_name')!r}")
        if not isinstance(decl.get("reader_facing"), bool):
            bad.append(f"{name}.reader_facing is not a boolean")
        if not decl.get("axis"):
            bad.append(f"{name} has no axis")
        if "sql" in decl:
            bad.append(f"{name} carries an sql binding; SO2 adds it with the DDL")
        for value in decl["values"]:
            for field in ("value", "label", "meaning", "cannot_justify"):
                if not isinstance(value.get(field), str) or not value[field].strip():
                    bad.append(f"{name}.{value.get('value')}: {field} is missing or empty")
    return "; ".join(bad) or None


def check_sections() -> str | None:
    values = entries(load_source(), "narrative_section")
    if [v["value"] for v in values] != list(SECTIONS):
        return f"values are {[v['value'] for v in values]}"
    bad = []
    for v in values:
        subject, min_status, evidence = SECTIONS[v["value"]]
        if v.get("subject_type") != subject:
            bad.append(f"{v['value']}.subject_type is {v.get('subject_type')!r}")
        if v.get("min_status") != min_status:
            bad.append(f"{v['value']}.min_status is {v.get('min_status')!r}, want {min_status!r}")
        if v.get("evidence") != evidence:
            bad.append(f"{v['value']}.evidence is {v.get('evidence')!r}, want {evidence!r}")
    labels = [v["label"].strip().lower() for v in values]
    if len(set(labels)) != len(labels):
        bad.append("two sections share a label")
    return "; ".join(bad) or None


def check_marks() -> str | None:
    values = entries(load_source(), "claim_mark_kind")
    if [v["value"] for v in values] != list(MARKS):
        return f"values are {[v['value'] for v in values]}"
    bad = []
    for v in values:
        requires, only_step = MARKS[v["value"]]
        if v.get("applies_to") != "flow":
            bad.append(f"{v['value']}.applies_to is {v.get('applies_to')!r}, want 'flow'")
        if tuple(v.get("requires", ("?",))) != requires:
            bad.append(f"{v['value']}.requires is {v.get('requires')!r}, want {list(requires)!r}")
        if v.get("only_step") != only_step:
            bad.append(f"{v['value']}.only_step is {v.get('only_step')!r}, want {only_step!r}")
    return "; ".join(bad) or None


def check_plain() -> str | None:
    doc = load_source()
    bad = []
    for name, want in PLAIN.items():
        got = tuple(v["value"] for v in entries(doc, name))
        if got != want:
            bad.append(f"{name} is {got}, want {want}")
    return "; ".join(bad) or None


def check_python() -> str | None:
    module = load_py()
    doc = load_source()
    bad = []
    for name in NEW_ENUMS:
        const = CONST_NAMES[name]
        want = tuple(v["value"] for v in entries(doc, name))
        got = getattr(module, const, None)
        if got != want:
            bad.append(f"{const} is {got!r}")
        decl = module.VOCABULARY.get(name)
        if decl is None:
            bad.append(f"VOCABULARY lacks {name}")
            continue
        if decl.get("reader_facing") is not doc["enums"][name]["reader_facing"]:
            bad.append(f"VOCABULARY[{name}].reader_facing differs from the contract")
        for src, out in zip(entries(doc, name), decl["values"], strict=False):
            for field in ("label", "meaning", "cannot_justify", "subject_type", "min_status", "evidence", "applies_to", "only_step"):
                if src.get(field) != out.get(field):
                    bad.append(f"{name}.{src['value']}.{field}: {out.get(field)!r}, contract {src.get(field)!r}")
            if tuple(src.get("requires", ())) != tuple(out.get("requires", ())):
                bad.append(f"{name}.{src['value']}.requires differs from the contract")
    if bad:
        return "; ".join(bad[:6])
    if tuple(module.CLAIM_KEY_FAMILIES) != ("key-type", "state-container", "flow"):
        return f"CLAIM_KEY_FAMILIES is {module.CLAIM_KEY_FAMILIES!r}"
    # The sections are readable through the generated accessors, by value.
    if module.labels("narrative_section").get("structure") != "Structure":
        return "labels('narrative_section') does not map structure to its label"
    return None


def ts_block(text: str, name: str) -> str:
    m = re.search(rf"^  {name}: \{{\n(.*?)^  \}},\n", text, re.S | re.M)
    if not m:
        raise KeyError(f"vocabulary.ts has no {name} entry")
    return m.group(1)


def check_typescript() -> str | None:
    text = (REPO / TS_REL).read_text()
    doc = load_source()
    bad = []
    for name in NEW_ENUMS:
        const = CONST_NAMES[name]
        m = re.search(rf"export const {const} = \[(.*?)\] as const;", text, re.S)
        want = [v["value"] for v in entries(doc, name)]
        got = re.findall(r'"([^"]+)"', m.group(1)) if m else None
        if got != want:
            bad.append(f"{const} is {got!r}")
        block = ts_block(text, name)
        for src in entries(doc, name):
            seg = re.search(rf'value:\s*"{re.escape(src["value"])}",(.*?)\n      \}},', block, re.S)
            if not seg:
                bad.append(f"{name}.{src['value']} has no entry in VOCABULARY")
                continue
            for field in ("subject_type", "min_status", "evidence", "applies_to", "only_step"):
                if field in src and not re.search(rf'\b{field}:\s*"{re.escape(src[field])}"', seg.group(1)):
                    bad.append(f"{name}.{src['value']}.{field} is not {src[field]!r} in vocabulary.ts")
                if field not in src and re.search(rf"\b{field}:", seg.group(1)):
                    bad.append(f"{name}.{src['value']}.{field} appears in vocabulary.ts but not the contract")
            if "requires" in src:
                want_req = "[" + ", ".join(f'"{r}"' for r in src["requires"]) + "]"
                if want_req not in re.sub(r"\s+", " ", seg.group(1)).replace("[ ", "[").replace(", ]", "]"):
                    bad.append(f"{name}.{src['value']}.requires is not {want_req} in vocabulary.ts")
    if not re.search(r'CLAIM_KEY_FAMILIES = \[\s*"key-type",\s*"state-container",\s*"flow",?\s*\] as const', text):
        bad.append("CLAIM_KEY_FAMILIES is not the three families of requireStableClaimKey")
    for table in ("VOCABULARY_SQL_BINDINGS", "SQL_CONSTRAINED_VOCABULARIES"):
        m = re.search(rf"export const {table}[^=]*= \{{(.*?)\n\}};", text, re.S)
        if not m:
            bad.append(f"vocabulary.ts has no {table}")
            continue
        for name in NEW_ENUMS:
            if re.search(rf"^  {name}:", m.group(1), re.M):
                bad.append(f"{table} binds {name}")
    return "; ".join(bad[:6]) or None


# ---------------------------------------------------------------------------
# The generator's validation, driven on a scratch copy of the tree.
# ---------------------------------------------------------------------------
SENTINEL = "# untouched by a rejected source\n"


def scratch_tree(doc: dict[str, Any]) -> Path:
    tmp = Path(tempfile.mkdtemp(prefix="so1-contract-"))
    for rel in (GEN_REL, "mcp-server/src/schema.sql"):
        dest = tmp / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(REPO / rel, dest)
    for rel in (PY_REL, TS_REL):
        dest = tmp / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(SENTINEL)
    source = tmp / SOURCE_REL
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_text(json.dumps(doc, indent=2) + "\n")
    return tmp


def generate(doc: dict[str, Any]) -> tuple[int, str, str, str]:
    tmp = scratch_tree(doc)
    try:
        code, out = run(["node", str(tmp / GEN_REL)], tmp)
        return code, out, (tmp / PY_REL).read_text(), (tmp / TS_REL).read_text()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def check_control() -> str | None:
    code, out, py, ts = generate(load_source())
    if code != 0:
        return f"the unbroken contract is rejected: {out.strip()[-300:]}"
    if py != (REPO / PY_REL).read_text() or ts != (REPO / TS_REL).read_text():
        return "the scratch tree's generated files differ from the committed ones"
    return None


def section(doc: dict[str, Any], value: str) -> dict[str, Any]:
    return next(v for v in entries(doc, "narrative_section") if v["value"] == value)


def mark(doc: dict[str, Any], value: str) -> dict[str, Any]:
    return next(v for v in entries(doc, "claim_mark_kind") if v["value"] == value)


def _no_min_status(doc: dict[str, Any]) -> None:
    del section(doc, "concern-reasoning")["min_status"]


def _min_status_off_ladder(doc: dict[str, Any]) -> None:
    section(doc, "structure")["min_status"] = "reviewed"


def _min_status_is_a_status_of_another_axis(doc: dict[str, Any]) -> None:
    section(doc, "challenge")["min_status"] = "recorded"


def _project_with_min_status(doc: dict[str, Any]) -> None:
    section(doc, "runtime")["min_status"] = "structural"


def _project_with_empty_min_status(doc: dict[str, Any]) -> None:
    section(doc, "start-here")["min_status"] = ""


def _mark_without_applies_to(doc: dict[str, Any]) -> None:
    del mark(doc, "exit")["applies_to"]


def _mark_applies_to_unknown_family(doc: dict[str, Any]) -> None:
    mark(doc, "crash-point")["applies_to"] = "flow-step"


def _mark_applies_to_seam(doc: dict[str, Any]) -> None:
    mark(doc, "crosses-seam")["applies_to"] = "seam"


def _duplicate_label(doc: dict[str, Any]) -> None:
    section(doc, "runtime")["label"] = section(doc, "structure")["label"]


def _duplicate_label_padded(doc: dict[str, Any]) -> None:
    section(doc, "runtime")["label"] = f"  {section(doc, 'structure')['label'].upper()} "


def _duplicate_mark_label(doc: dict[str, Any]) -> None:
    mark(doc, "exit")["label"] = mark(doc, "trigger")["label"]


def _requires_unknown_column(doc: dict[str, Any]) -> None:
    mark(doc, "exit")["requires"] = ["label", "status"]


def _evidence_other(doc: dict[str, Any]) -> None:
    section(doc, "start-here")["evidence"] = "sometimes"


def _subject_type_other(doc: dict[str, Any]) -> None:
    section(doc, "runtime")["subject_type"] = "seam"


def _subject_type_missing(doc: dict[str, Any]) -> None:
    del section(doc, "runtime")["subject_type"]


def _new_enum_missing_reader_facing(doc: dict[str, Any]) -> None:
    del doc["enums"]["claim_mark_kind"]["reader_facing"]


SABOTAGE: tuple[tuple[str, Callable[[dict[str, Any]], None], str], ...] = (
    ("a subsystem section without a min_status", _no_min_status, "min_status"),
    ("a subsystem section whose min_status is not a rung", _min_status_off_ladder, "min_status"),
    ("a subsystem section whose min_status is another axis's value", _min_status_is_a_status_of_another_axis, "min_status"),
    ("a project section with a min_status", _project_with_min_status, "min_status"),
    ("a project section with an empty min_status", _project_with_empty_min_status, "min_status"),
    ("a mark kind without applies_to", _mark_without_applies_to, "applies_to"),
    ("a mark kind applying to an unknown key family", _mark_applies_to_unknown_family, "applies_to"),
    ("a mark kind applying to a seam, which is not a claim key family", _mark_applies_to_seam, "applies_to"),
    ("a duplicate section label", _duplicate_label, "label"),
    ("a duplicate section label in other case, padded", _duplicate_label_padded, "label"),
    ("a duplicate mark label", _duplicate_mark_label, "label"),
    ("a requires naming a column a mark lacks", _requires_unknown_column, "requires"),
    ("an evidence other than required or optional", _evidence_other, "evidence"),
    ("a section for a subject type other than subsystem or project", _subject_type_other, "subject_type"),
    ("a section without a subject_type", _subject_type_missing, "subject_type"),
    ("a new enum missing reader_facing", _new_enum_missing_reader_facing, "reader_facing"),
)


def sabotage_check(mutate: Callable[[dict[str, Any]], None], word: str) -> Callable[[], str | None]:
    def fn() -> str | None:
        doc = copy.deepcopy(load_source())
        mutate(doc)
        code, out, py, ts = generate(doc)
        if code == 0:
            return "the generator accepted it"
        if word not in out:
            return f"rejected, but the message does not name {word!r}: {out.strip()[-200:]}"
        if py != SENTINEL or ts != SENTINEL:
            return "rejected, but it wrote a generated file anyway"
        return None

    return fn


def check_accepts_valid_addition() -> str | None:
    """A valid variation is accepted, persisted and read back: a refuse-everything generator is red."""
    doc = copy.deepcopy(load_source())
    extra = copy.deepcopy(section(doc, "concern-reasoning"))
    extra.update(value="reread", label="Reread", min_status="mapped")
    entries(doc, "narrative_section").append(extra)
    extra_mark = copy.deepcopy(mark(doc, "exit"))
    extra_mark.update(value="retry-point", label="Retry point", requires=["target"])
    entries(doc, "claim_mark_kind").append(extra_mark)
    code, out, py, ts = generate(doc)
    if code != 0:
        return f"a valid addition is rejected: {out.strip()[-300:]}"
    if '"reread"' not in py or '"retry-point"' not in py:
        return "the accepted addition is not in the generated Python"
    if '"reread"' not in ts or '"retry-point"' not in ts:
        return "the accepted addition is not in the generated TypeScript"
    if not re.search(r'"min_status": "mapped"', py):
        return "the accepted addition's min_status did not reach the generated Python"
    return None


def check_ci() -> str | None:
    try:
        text = CI_FILE.read_text()
    except OSError:
        return "the CI workflow could not be read"
    return None if CI_COMMAND in text else f"{CI_FILE.name} does not run {CI_COMMAND}"


def main() -> int:
    emit("GATE SO1 — contract enums: narrative sections, claim mark kinds, territory dispositions")
    check("gen-vocabulary --check and --check-sql are green", check_generator_green)
    check("contract_version is 1.2.0", check_version)
    check("the five enums exist, with labels, meanings, flags and no sql binding", check_shape_of_each)
    check("narrative_section matches §2.1", check_sections)
    check("claim_mark_kind matches §7.2", check_marks)
    check("the dispositions and origin match §2.1, §2.2", check_plain)
    check("vocabulary.py carries the enums and their metadata", check_python)
    check("vocabulary.ts carries the enums and their metadata, bound to no SQL column", check_typescript)
    check("the generator accepts the unbroken contract", check_control)
    check("the generator accepts a valid added section and mark kind", check_accepts_valid_addition)
    for label, mutate, word in SABOTAGE:
        check(f"the generator rejects {label}", sabotage_check(mutate, word))
    check("CI runs this gate", check_ci)
    emit("")
    if FAILURES:
        emit(f"{GATE} RED: {len(FAILURES)} check(s) failed; first: {FAILURES[0]}")
        return 1
    emit(f"{GATE} GREEN")
    return 0


if __name__ == "__main__":
    try:
        code = main()
    except Exception as exc:  # never a stack trace: a crash is not a red
        emit(f"{GATE} RED: the gate itself failed — {exc!r}")
        code = 1
    sys.exit(code)
