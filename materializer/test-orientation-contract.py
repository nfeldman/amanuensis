#!/usr/bin/env python3
"""GATE O1 — the vocabulary contract carries the orientation sections (packet O1).

`design/orientation/PLAN.md` §4 O1, §2.1, §2.3, §5 D4, Appendices A–C.

Turns red when:
  - `gen-vocabulary.mjs --check` or `--check-sql` is red on the tree as committed;
  - the generator accepts a broken copy of the contract (it is run on a scratch
    copy of the tree, one sabotage at a time) carrying any of: a `reader_terms`
    entry without a definition; an alias equal to another term; a
    `survey_passes` status not in `subsystem_status`; a `set_when` other than
    `start`/`end`; `survey_passes` statuses out of ladder order; an enum missing
    `reader_facing`;
  - the generator rejects the unbroken copy, or writes on a rejected one;
  - `vocabulary.py` lacks `READER_TERMS`, `ID_KINDS` or `SURVEY_PASSES`, or they
    differ from Appendices A, B and C (terms and aliases, ID kinds, and the five
    passes with their phase, status and `set_when` per D4);
  - `VOCABULARY` does not carry `reader_facing` on every enum, or the enums
    marked true are not exactly the fourteen §4 O1 step 2 lists;
  - a `subsystem_status` value whose `survey_passes` row has `set_when: "start"`
    has a label that does not begin with an "-ing" word, or one with
    `set_when: "end"` has a label that does (so "Scoping" is red) or a meaning
    containing neither "done" nor "complete";
  - the D4 labels are not "Scoped", "Reviewing concerns" and "Challenging
    claims", the scoping and structural meanings are not D4's, or any stored
    value, `authorizes` or `cannot_justify` of `subsystem_status` changed, or
    the `pass_type` enum's own "Adversarial" label changed;
  - the "Survey depth" term's definition omits a depth label it describes;
  - `contract_version` is not 1.1.0;
  - CI does not run this gate.

Output protocol: exactly one status line, last, on stdout. Every message,
including anything captured from a spawned process, is scrubbed of the
launcher's crash signatures, so an absent deliverable reads as a failed
assertion rather than as a gate that never ran.
"""

from __future__ import annotations

import copy
import importlib
import json
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
CI_COMMAND = "test-orientation-contract.py"

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


# ---------------------------------------------------------------------------
# What the plan fixes. Appendix A's terms and aliases, Appendix B's kinds,
# Appendix C's pass table with D4's timing, and §4 O1 step 2's reader-facing set.
# ---------------------------------------------------------------------------
EXPECTED_TERMS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Amanuensis", ()),
    ("Conspectus", ("survey record",)),
    ("Survey", ()),
    ("Session", ()),
    ("Subsystem", ()),
    ("Layer", ("region",)),
    ("Survey depth", ("status",)),
    ("Mapped", ()),
    ("Scope", ("file ledger",)),
    ("Evidence", ()),
    ("Claim", ()),
    ("Challenge", ("adversarial pass",)),
    ("Concern", ()),
    ("Concern review", ("disposition",)),
    ("Finding", ()),
    ("Lead", ("field note",)),
    ("Decision needed", ("open question",)),
    ("Disagreement", ("contradiction",)),
    ("Competing explanations", ("diagnosticity matrix",)),
    ("System boundary", ("seam",)),
    ("Recorded edge", ("xref",)),
    ("Stale", ()),
    ("Checked at", ("revision",)),
    ("Standing", ()),
    ("Lens", ()),
    ("Thesis", ()),
    ("Purpose, account", ("explanation",)),
    ("Publication check", ("read-back",)),
)

EXPECTED_ID_KINDS = (
    "Subsystem",
    "Finding",
    "Seam",
    "Concern",
    "Seam concern",
    "Competing explanations",
    "Decision",
)
ID_KIND_FIELDS = ("kind", "shape", "names", "chosen_by", "links_to")

# (pass, phase, status, set_when), per D4.
EXPECTED_PASSES = (
    ("Scope", 1, "scoping", "end"),
    ("Structure", 2, "structural", "end"),
    ("Concern review", 3, "concerns", "start"),
    ("Challenge", 4, "adversarial", "start"),
    ("Packaging", 5, "mapped", "end"),
)

READER_FACING = {
    "finding_resolution_state",
    "severity",
    "subsystem_status",
    "standing_state",
    "stale_reason",
    "file_classification",
    "evidence_kind",
    "disposition_classification",
    "field_note_category",
    "open_question_category",
    "open_question_resolution",
    "contradiction_resolution",
    "diagnosticity_outcome",
    "lens",
}

# subsystem_status as it stood before D4: values, authorizes and cannot_justify
# must not move; only the three labels and two meanings below change.
STATUS_VALUES = ("unmapped", "scoping", "structural", "concerns", "adversarial", "mapped", "deferred")
STATUS_FIXED = {
    "unmapped": ("nothing", "any claim about this subsystem's behavior"),
    "scoping": (
        "which files are in scope for this subsystem",
        "any behavioral claim; file scope is all that is established",
    ),
    "structural": (
        "claims about types, state containers, flows, and the concurrency model",
        "any correctness claim",
    ),
    "concerns": (
        "concern review decisions that cite evidence",
        "that a finding survived adversarial challenge",
    ),
    "adversarial": (
        "provisional conclusions while the challenge pass runs; a finding counts as survived only"
        " where its recorded adversarial evidence or terminal review aggregation says so",
        "that the challenge pass has finished",
    ),
    "mapped": (
        "the recorded survey through structural analysis, concern review, and adversarial challenge",
        "that the reading is current at the repository head",
    ),
    "deferred": ("nothing", "anything about this subsystem's behavior"),
}
D4_LABELS = {
    "scoping": "Scoped",
    "concerns": "Reviewing concerns",
    "adversarial": "Challenging claims",
}
D4_MEANINGS = {
    "scoping": "The scope pass is done: the subsystem's boundary and files are established, nothing more.",
    "structural": (
        "The structure pass is done: types, state, flows and concurrency are mapped;"
        " correctness claims are not yet authorized."
    ),
}


# ---------------------------------------------------------------------------
# Loading, defensively.
# ---------------------------------------------------------------------------
def load_vocabulary() -> Any:
    sys.path.insert(0, str(ROOT))
    try:
        return importlib.import_module("amanuensis_materializer.vocabulary")
    except Exception as exc:
        emit(f"  note vocabulary.py could not be loaded: {exc!r}")
        return None


VOCAB = load_vocabulary()


def constant(name: str) -> Any:
    if VOCAB is None:
        raise LookupError("vocabulary.py could not be loaded")
    if not hasattr(VOCAB, name):
        raise LookupError(f"vocabulary.py has no {name}")
    return getattr(VOCAB, name)


def run(cmd: list[str], cwd: Path) -> tuple[int, str]:
    try:
        r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=120)
    except Exception as exc:
        return 1, f"could not run {' '.join(cmd)}: {exc!r}"
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def ing_word(label: str) -> bool:
    words = label.split()
    return bool(words) and words[0].lower().endswith("ing")


# ---------------------------------------------------------------------------
# The committed tree.
# ---------------------------------------------------------------------------
def check_generator_green() -> str | None:
    bad = []
    for flag in ("--check", "--check-sql"):
        code, out = run(["node", "scripts/gen-vocabulary.mjs", flag], REPO / "mcp-server")
        if code != 0:
            bad.append(f"{flag} exits {code}: {out.strip().splitlines()[-1:] or ''}")
    return "; ".join(bad) or None


def check_version() -> str | None:
    got = constant("VOCABULARY_CONTRACT_VERSION")
    return None if got == "1.1.0" else f"contract_version is {got!r}, not '1.1.0'"


def check_constants_shape() -> str | None:
    bad = []
    for name in ("READER_TERMS", "ID_KINDS", "SURVEY_PASSES"):
        value = constant(name)
        if not isinstance(value, tuple) or not value or not all(isinstance(v, dict) for v in value):
            bad.append(f"{name} is not a non-empty tuple of dicts")
    return "; ".join(bad) or None


def check_reader_terms() -> str | None:
    terms = constant("READER_TERMS")
    got = tuple((t.get("term"), tuple(t.get("aliases") or ())) for t in terms)
    if got != EXPECTED_TERMS:
        want_names = [t for t, _ in EXPECTED_TERMS]
        got_names = [t for t, _ in got]
        if want_names != got_names:
            return f"terms are {got_names}, Appendix A lists {want_names}"
        diff = [f"{a[0]}: {a[1]} != {b[1]}" for a, b in zip(got, EXPECTED_TERMS, strict=True) if a != b]
        return f"aliases differ from Appendix A: {diff}"
    bad = []
    for t in terms:
        definition = t.get("definition")
        if not isinstance(definition, str) or len(definition.strip()) < 20:
            bad.append(f"{t.get('term')}: no definition")
        pages = t.get("pages")
        if not isinstance(pages, (list, tuple)) or not pages or not all(
            isinstance(p, str) and p.endswith(".md") for p in pages
        ):
            bad.append(f"{t.get('term')}: pages is not a non-empty list of .md paths")
    return "; ".join(bad) or None


def check_depth_term_names_labels() -> str | None:
    terms = {t["term"]: t for t in constant("READER_TERMS")}
    definition = terms.get("Survey depth", {}).get("definition", "")
    labels = [v["label"] for v in constant("VOCABULARY")["subsystem_status"]["values"]]
    missing = [label for label in labels if label not in definition]
    return f"Survey depth definition omits {missing}" if missing else None


def check_id_kinds() -> str | None:
    kinds = constant("ID_KINDS")
    got = tuple(k.get("kind") for k in kinds)
    if got != EXPECTED_ID_KINDS:
        return f"kinds are {list(got)}, Appendix B lists {list(EXPECTED_ID_KINDS)}"
    bad = [
        f"{k['kind']}.{f}"
        for k in kinds
        for f in ID_KIND_FIELDS
        if not isinstance(k.get(f), str) or not k[f].strip()
    ]
    return f"empty fields: {bad}" if bad else None


def check_survey_passes() -> str | None:
    passes = constant("SURVEY_PASSES")
    got = tuple((p.get("pass"), p.get("phase"), p.get("status"), p.get("set_when")) for p in passes)
    if got != EXPECTED_PASSES:
        return f"rows are {list(got)}, §4 O1 step 1 fixes {list(EXPECTED_PASSES)}"
    empty = [p["pass"] for p in passes if not isinstance(p.get("does"), str) or not p["does"].strip()]
    return f"no 'does' for {empty}" if empty else None


def check_reader_facing() -> str | None:
    vocabulary = constant("VOCABULARY")
    missing = [name for name, decl in vocabulary.items() if not isinstance(decl.get("reader_facing"), bool)]
    if missing:
        return f"reader_facing missing on {missing}"
    true = {name for name, decl in vocabulary.items() if decl["reader_facing"]}
    if true != READER_FACING:
        return f"extra {sorted(true - READER_FACING)}, missing {sorted(READER_FACING - true)}"
    return None


def check_label_timing() -> str | None:
    by_value = {v["value"]: v for v in constant("VOCABULARY")["subsystem_status"]["values"]}
    bad = []
    for row in constant("SURVEY_PASSES"):
        entry = by_value.get(row.get("status"))
        if entry is None:
            bad.append(f"{row.get('status')} is not a subsystem_status value")
            continue
        label, meaning = entry["label"], entry["meaning"]
        if row.get("set_when") == "start" and not ing_word(label):
            bad.append(f"{entry['value']} is set as its pass starts, but {label!r} does not open with an -ing word")
        if row.get("set_when") == "end":
            if ing_word(label):
                bad.append(f"{entry['value']} is set when its pass is done, but {label!r} reads as under way")
            if "done" not in meaning and "complete" not in meaning:
                bad.append(f"{entry['value']} is set when its pass is done, but its meaning says neither done nor complete")
    return "; ".join(bad) or None


def check_d4_status() -> str | None:
    values = constant("VOCABULARY")["subsystem_status"]["values"]
    got_values = tuple(v["value"] for v in values)
    if got_values != STATUS_VALUES:
        return f"stored values changed: {list(got_values)}"
    bad = []
    for v in values:
        fixed = STATUS_FIXED[v["value"]]
        if (v.get("authorizes"), v.get("cannot_justify")) != fixed:
            bad.append(f"{v['value']}: authorizes or cannot_justify changed")
        if v["value"] in D4_LABELS and v["label"] != D4_LABELS[v["value"]]:
            bad.append(f"{v['value']} label is {v['label']!r}, D4 sets {D4_LABELS[v['value']]!r}")
        if v["value"] in D4_MEANINGS and v["meaning"] != D4_MEANINGS[v["value"]]:
            bad.append(f"{v['value']} meaning is not D4's")
    pass_type = {v["value"]: v["label"] for v in constant("VOCABULARY")["pass_type"]["values"]}
    if pass_type.get("adversarial") != "Adversarial":
        bad.append("pass_type's own 'Adversarial' label changed")
    return "; ".join(bad) or None


# ---------------------------------------------------------------------------
# The generator's validation, driven on a scratch copy of the tree.
# ---------------------------------------------------------------------------
SENTINEL = "# untouched by a rejected source\n"


def scratch_tree(doc: dict[str, Any]) -> Path:
    tmp = Path(tempfile.mkdtemp(prefix="o1-contract-"))
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


def generate(doc: dict[str, Any]) -> tuple[int, str, str]:
    tmp = scratch_tree(doc)
    try:
        code, out = run(["node", str(tmp / GEN_REL)], tmp)
        written = (tmp / PY_REL).read_text()
        return code, out, written
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def load_source() -> dict[str, Any]:
    return json.loads((REPO / SOURCE_REL).read_text())


def check_control() -> str | None:
    code, out, written = generate(load_source())
    if code != 0:
        return f"the unbroken contract is rejected: {out.strip()[-300:]}"
    if written != (REPO / PY_REL).read_text():
        return "the scratch tree's generated vocabulary.py differs from the committed one"
    return None


def _drop_definition(doc: dict[str, Any]) -> None:
    del doc["reader_terms"][2]["definition"]


def _empty_definition(doc: dict[str, Any]) -> None:
    doc["reader_terms"][3]["definition"] = "  "


def _alias_is_term(doc: dict[str, Any]) -> None:
    doc["reader_terms"][15]["aliases"] = ["field note", doc["reader_terms"][4]["term"].lower()]


def _status_unknown(doc: dict[str, Any]) -> None:
    doc["survey_passes"][1]["status"] = "reviewed"


def _set_when_other(doc: dict[str, Any]) -> None:
    doc["survey_passes"][2]["set_when"] = "during"


def _out_of_order(doc: dict[str, Any]) -> None:
    rows = doc["survey_passes"]
    rows[2]["status"], rows[3]["status"] = rows[3]["status"], rows[2]["status"]


def _missing_reader_facing(doc: dict[str, Any]) -> None:
    del doc["enums"]["severity"]["reader_facing"]


SABOTAGE: tuple[tuple[str, Callable[[dict[str, Any]], None], str], ...] = (
    ("a term without a definition", _drop_definition, "definition"),
    ("a term with an empty definition", _empty_definition, "definition"),
    ("an alias equal to another term", _alias_is_term, "alias"),
    ("a survey_passes status not in subsystem_status", _status_unknown, "subsystem_status"),
    ("a set_when other than start or end", _set_when_other, "set_when"),
    ("survey_passes statuses out of ladder order", _out_of_order, "order"),
    ("an enum missing reader_facing", _missing_reader_facing, "reader_facing"),
)


def sabotage_check(mutate: Callable[[dict[str, Any]], None], word: str) -> Callable[[], str | None]:
    def fn() -> str | None:
        doc = copy.deepcopy(load_source())
        mutate(doc)
        code, out, written = generate(doc)
        if code == 0:
            return "the generator accepted it"
        if word not in out:
            return f"rejected, but the message does not name {word!r}: {out.strip()[-200:]}"
        if written != SENTINEL:
            return "rejected, but it wrote vocabulary.py anyway"
        return None

    return fn


def check_ci() -> str | None:
    try:
        text = CI_FILE.read_text()
    except OSError:
        return "the CI workflow could not be read"
    return None if CI_COMMAND in text else f"{CI_FILE.name} does not run {CI_COMMAND}"


def main() -> int:
    emit("GATE O1 — vocabulary contract: terms, ID kinds, survey passes, reader-facing flag, D4 labels")
    check("gen-vocabulary --check and --check-sql are green", check_generator_green)
    check("contract_version is 1.1.0", check_version)
    check("vocabulary.py carries READER_TERMS, ID_KINDS, SURVEY_PASSES", check_constants_shape)
    check("READER_TERMS matches Appendix A", check_reader_terms)
    check("the Survey depth term names every depth label", check_depth_term_names_labels)
    check("ID_KINDS matches Appendix B", check_id_kinds)
    check("SURVEY_PASSES matches §4 O1 step 1 (D4 timing)", check_survey_passes)
    check("reader_facing is on every enum and true for exactly the listed fourteen", check_reader_facing)
    check("each depth's label and meaning agree with when its pass sets it", check_label_timing)
    check("D4 labels and meanings; values, authorizes and cannot_justify unchanged", check_d4_status)
    check("the generator accepts the unbroken contract", check_control)
    for label, mutate, word in SABOTAGE:
        check(f"the generator rejects {label}", sabotage_check(mutate, word))
    check("CI runs this gate", check_ci)
    emit("")
    if FAILURES:
        emit(f"GATE O1 RED: {len(FAILURES)} check(s) failed; first: {FAILURES[0]}")
        return 1
    emit("GATE O1 GREEN")
    return 0


if __name__ == "__main__":
    try:
        code = main()
    except Exception as exc:  # never a stack trace: a crash is not a red
        emit(f"GATE O1 RED: the gate itself failed — {exc!r}")
        code = 1
    sys.exit(code)
