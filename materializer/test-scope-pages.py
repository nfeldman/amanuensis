#!/usr/bin/env python3
"""GATE SC7 — pages and read-back over the survey set.

design/scope/PLAN.md §3 SC7; §2.8, and §2.6a's publication rule.

Turns red when:

  1. with each kind of exclusion (gitignore, an owner rule, meta sorting), a
     store does not publish, or an excluded path appears in any listing, on any
     page, in the search index or in the locus index (P1, P2, P3);
  2. a store with records made before an exclusion prints one of their
     citations of an excluded path as a link, drops the citation, or keeps a
     locus-index entry for its symbol; an in-survey citation stops being a
     link (C1, C2, C3);
  3. a link on any page targets a page or an anchor that does not exist (L1);
  4. a ledger-exempt path (a generated golden) no longer prints (E1);
  5. a subsystem outside the survey, with a claim, a disposition and a
     finding, has no page, is not headed "Outside this survey", carries a file
     listing, or drops any of the three records; its seam is drawn on a
     diagram, is not listed on its page, or an in-survey seam is no longer
     drawn, or it is drawn as a topology edge or a seam-contract block (O1-O4);
  6. coverage is not computed over the survey set: the overview's files read,
     the not-yet-surveyed denominator, and the coverage bars (V1, V2, V3); the
     not-yet-surveyed page owes work for a seam or a subsystem outside the
     survey (N1); an excluded stale row is listed, or an included one is not
     (S1);
  7. the overview's line does not name each source's count and the owner's
     exclude patterns, names a path, or is printed when nothing is excluded
     (W1, W2);
  8. read-back is not green on a valid store, or stays green when a
     `scope_exclusions` row is added, swapped or re-sourced, or when a rule
     changes without a reconciliation, or when a reconciliation without scope
     columns is read as standing while a rule exists (R1–R6); a digest this
     package restates orders paths otherwise than the server does, so a
     non-BMP path breaks it (D1);
  9. a store with no scope tables does not render byte-identical to the
     golden corpus (G1);
 10. this gate is not registered in CI (CI1).

Every store is seeded in a temporary directory from `mcp-server/src/schema.sql`
over a temporary git repository, and the digests a reconciliation carries are
restated here (§2.5) rather than imported, so rewriting an implementation
formula cannot also rewrite what this gate expects. Nothing here reads a real
store or the network.

False green it cannot exclude: the reconciliation rows are written by this gate,
not by `detect_changes`; whether the server writes them correctly is SC4's gate.
Agreement here proves the projection reads the rows it is handed.

Output protocol: exactly one status line, last, on stdout: `GATE SC7 GREEN`, or
`GATE SC7 RED: <reason>`. Every message is scrubbed of the launcher's crash
signatures, so a missing deliverable reads as a failed assertion.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from collections.abc import Callable
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
SCHEMA = REPO / "mcp-server" / "src" / "schema.sql"
GOLDEN = ROOT / "fixtures" / "store-only-golden"
CI_FILE = REPO / ".github" / "workflows" / "test.yml"
CI_COMMAND = "test-scope-pages.py"

# ---------------------------------------------------------------------------
# Output funnel.
# ---------------------------------------------------------------------------
_SCRUB: tuple[tuple[str, str], ...] = (
    ("Traceback (most recent call last)", "trace-back"),
    ("MODULE_NOT_FOUND", "module-absent"),
    ("ModuleNotFoundError", "python-module-absent"),
    ("Cannot find module", "cannot load module"),
    ("ERR_MODULE_NOT_FOUND", "module-absent"),
    ("No such file or directory", "path is absent"),
    ("No such file", "path is absent"),
    ("can't open file", "cannot open path"),
    ("SyntaxError", "syntax-error"),
    ("ImportError", "python-import-error"),
    ("ReferenceError", "reference-error"),
    ("TypeError", "type-error"),
    ("AttributeError", "attribute-error"),
    ("KeyError", "key-error"),
    ("ENOENT", "PATH-ABSENT"),
    ("is not defined", "is undeclared"),
    ("is not a function", "is not callable"),
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
# The fixture: one tree, three stores over it.
# ---------------------------------------------------------------------------
NUL = "\x00"
SESSION = "sc7-session"
BRANCH = "main"
PROJECT = "ScopeFixture"

TREE: dict[str, str] = {
    ".gitignore": "build/\n",
    "build/out.ts": "export const built = true;\n",
    "design/proto.ts": "export const proto = 1;\n",
    "notes/n.md": "# Notes\nWhat was tried, and why.\n",
    "src/a.ts": "export const alpha = 1;\n",
    "src/b.ts": "export const beta = 2;\n",
    "golden/out.txt": "generated output\n",
}
GITIGNORED = "build/out.ts"
OWNER_EXCLUDED = "design/proto.ts"
META = "notes/n.md"
EXCLUDED = (GITIGNORED, OWNER_EXCLUDED, META)
EXEMPT_GOLDEN = "golden/out.txt"
SURVEY = (".gitignore", "src/a.ts", "src/b.ts", EXEMPT_GOLDEN)
STALE_CONTROL = "src/b.ts"

OWNER_PATTERN = "design/"
# (id, pattern, action)
RULES = ((1, OWNER_PATTERN, "exclude"),)
# (id, pattern, category)
SORTING = ((1, "src/", "product"), (2, "golden/", "product"), (3, "notes/", "meta"), (4, ".gitignore", "product"))
# (file_path, source, rule_id)
EXCLUSIONS = ((GITIGNORED, "gitignore", None), (OWNER_EXCLUDED, "user", 1), (META, "meta", 3))

OUTSIDE = "B-02"
SEAM_OUTSIDE = "SM-OUT"
SEAM_INSIDE = "SM-IN"


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def utf16(text: str) -> bytes:
    """The order the server's JavaScript `<` and `sort()` put strings in: by UTF-16 code units."""

    return text.encode("utf-16-be")


def set_digest(parts: list[str]) -> str:
    """§3.2's construction: sorted, NUL-joined, SHA-256."""

    return sha256(NUL.join(sorted(parts, key=utf16)))


def scope_digest(rules: tuple[tuple[Any, ...], ...], sorting: tuple[tuple[Any, ...], ...]) -> str:
    """§2.5's `scope_digest`, restated."""

    return sha256(
        "\n".join(
            [NUL.join(("rule", str(i), p, a)) for i, p, a in rules]
            + [NUL.join(("sorting", str(i), p, c)) for i, p, c in sorting]
        )
    )


def exclusion_digest(exclusions: tuple[tuple[Any, ...], ...]) -> str:
    """§2.5's `exclusion_digest`, restated."""

    return sha256(
        "\n".join(NUL.join((p, s, "" if r is None else str(r))) for p, s, r in sorted(exclusions, key=lambda e: utf16(e[0])))
    )


def anchor(file_path: str) -> str:
    """§7.4's Files anchor, recomputed."""

    return "f-" + hashlib.sha1(file_path.encode()).hexdigest()[:10]


GIT_ENV = {**os.environ, "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_NOSYSTEM": "1"}


def git(cwd: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-c", "core.hooksPath=/dev/null", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        env=GIT_ENV,
        check=False,
    )


def make_workspace(root: Path) -> tuple[Path, str]:
    ws = root / "workspace"
    for rel, body in TREE.items():
        (ws / rel).parent.mkdir(parents=True, exist_ok=True)
        (ws / rel).write_text(body)
    steps = (
        ("init", "-q", "--template=", "-b", BRANCH),
        ("add", "-A"),
        ("add", "-f", GITIGNORED),
        ("-c", "user.email=sc7@localhost", "-c", "user.name=sc7", "-c", "commit.gpgsign=false",
         "commit", "-q", "--no-verify", "-m", "fixture"),
    )
    for step in steps:
        done = git(ws, *step)
        if done.returncode != 0:
            raise RuntimeError(f"git {step[0]} failed: {done.stderr.strip()}")
    head = git(ws, "rev-parse", "HEAD").stdout.strip()
    listed = sorted(p for p in git(ws, "ls-tree", "-r", "--name-only", "-z", head).stdout.split(NUL) if p)
    if listed != sorted(TREE):
        raise RuntimeError(f"the fixture tree is {listed}")
    return ws, head


def seed(storage: Path, ws: Path, head: str, world: str) -> None:
    """One store. `A`: exclusions only. `B`: records made before them. `C`: scope rows, nothing excluded."""

    sys.path.insert(0, str(ROOT))
    from store_only_seed import import_onboarding  # noqa: PLC0415

    storage.mkdir(parents=True)
    db = sqlite3.connect(storage / "memory.db")
    db.executescript(SCHEMA.read_text())
    x = db.execute
    x("INSERT INTO git_state (repo_id, canonical_branch, onboarding_sha, last_checked_sha, last_checked_at)"
      " VALUES ('default', ?, ?, ?, '2026-11-24T00:00:00Z')", (BRANCH, head, head))
    x("INSERT INTO sessions (session_id, intent) VALUES (?, 'fixture')", (SESSION,))
    x("INSERT INTO scope_mode_changes (mode, reason) VALUES ('sorted', 'fixture')")
    subsystems = [("B-01", "Ledger core", "mapped", "core"), ("B-03", "Helpers", "mapped", "core")]
    if world == "B":
        subsystems.append((OUTSIDE, "Prototype plans", "mapped", "plans"))
    db.executemany("INSERT INTO subsystems (id, name, status, layer, scope) VALUES (?, ?, ?, ?, 'fixture scope')",
                   subsystems)
    ledger = [
        ("B-01", "src/a.ts", "examined"),
        ("B-01", EXEMPT_GOLDEN, "generated-ignore"),
        ("B-01", META, "examined"),
        ("B-01", GITIGNORED, "candidate"),
        ("B-03", "src/b.ts", "candidate"),
    ]
    if world == "B":
        ledger.append((OUTSIDE, OWNER_EXCLUDED, "examined"))
    # Every excluded row is stale, and so is one included control (S1).
    stale = (*EXCLUDED, STALE_CONTROL) if world != "C" else ()
    db.executemany("INSERT INTO file_ledger (subsystem_id, file_path, why_in_scope, classification, ref_sha, stale)"
                   " VALUES (?, ?, 'fixture', ?, ?, ?)", [(s, p, c, head, int(p in stale)) for s, p, c in ledger])
    x("INSERT INTO scope_gaps (file_path, kind, subsystem_id, detected_sha) VALUES ('.gitignore', 'unledgered', NULL, ?)",
      (head,))
    x("INSERT INTO concerns (code, category, origin, status) VALUES ('CC-1', 'cache', 'seeded', 'active')")

    def evidence(path: str, symbol: str) -> int:
        cur = x("INSERT INTO evidence (file_path, symbol, line_range, ref_sha, kind, session_id)"
                " VALUES (?, ?, '1', ?, 'code-verified', ?)", (path, symbol, head, SESSION))
        return int(cur.lastrowid or 0)

    def finding(fid: str, sid: str, primary: list[str], state: str = "open", evidence_id: int | None = None) -> None:
        x("INSERT INTO findings (finding_id, subsystem_id, symptom, root_cause, severity, status, ref_sha,"
          " session_id, pass_type, primary_files) VALUES (?, ?, ?, 'fixture cause', 'HIGH', 'confirmed-bug', ?, ?,"
          " 'survey', ?)", (fid, sid, f"defect {fid}", head, SESSION, json.dumps(primary)))
        x("INSERT INTO finding_resolution_events (finding_id, resolution_state, rationale, session_id) VALUES"
          " (?, 'open', 'fixture', ?)", (fid, SESSION))
        if state != "open":
            x("INSERT INTO finding_evidence (finding_id, evidence_id, role) VALUES (?, ?, 'fix-verification')",
              (fid, evidence_id))
            x("INSERT INTO finding_resolution_events (finding_id, resolution_state, fix_location, fix_sha,"
              " effective_sha, evidence_id, rationale, session_id) VALUES (?, ?, 'src/a.ts', ?, ?, ?, 'fixture', ?)",
              (fid, state, head, head, evidence_id, SESSION))

    def claim(cid: str, sid: str, statement: str, evidence_id: int) -> None:
        x("INSERT INTO claims (claim_id, claim_key, subject_type, subject_id, statement, epistemic_kind,"
          " asserted_at_sha, valid_from_sha, session_id) VALUES (?, ?, 'subsystem', ?, ?, 'observation', ?, ?, ?)",
          (cid, f"{sid}.fixture", sid, statement, head, head, SESSION))
        x("INSERT INTO claim_evidence (claim_id, evidence_id, role) VALUES (?, ?, 'supports')", (cid, evidence_id))

    alpha = evidence("src/a.ts", "alphaSymbol")
    claim("CL-B01", "B-01", "The ledger core appends rows.", alpha)
    finding("B01-1", "B-01", [f"src/a.ts:alphaSymbol@{head}"])
    seams = [(SEAM_INSIDE, "B-01", "B-03", "the helper table")]
    if world == "B":
        proto = evidence(OWNER_EXCLUDED, "protoSymbol")
        notes = evidence(META, "notesSymbol")
        claim("CL-B02", OUTSIDE, "The prototype plans name the cache.", proto)
        x("INSERT INTO dispositions (subsystem_id, concern_code, classification, evidence, evidence_quality,"
          " rationale, ref_sha, session_id) VALUES (?, 'CC-1', 'ruled-out', ?, 'code-verified',"
          " 'the prototype holds no cache', ?, ?)", (OUTSIDE, f"{OWNER_EXCLUDED}:protoSymbol@{head}", head, SESSION))
        x("INSERT INTO disposition_evidence (subsystem_id, concern_code, evidence_id, role)"
          " VALUES (?, 'CC-1', ?, 'supports')", (OUTSIDE, proto))
        finding("B02-1", OUTSIDE, [f"{OWNER_EXCLUDED}:protoSymbol@{head}"])
        finding("B01-2", "B-01", [f"{META}:notesSymbol@{head}"], "verified-fixed", notes)
        finding("B01-3", "B-01", [f"src/a.ts:alphaSymbol@{head}"], "verified-fixed", alpha)
        x("INSERT INTO vocabulary (term, gloss, subsystem_id, first_seen) VALUES ('protoTerm',"
          " 'a term the prototype named', ?, ?)", (OUTSIDE, f"{OWNER_EXCLUDED}:protoSymbol@{head}"))
        seams.append((SEAM_OUTSIDE, "B-01", OUTSIDE, "the prototype queue"))
    db.executemany("INSERT INTO seams (id, party_a, party_b, shared_object) VALUES (?, ?, ?, ?)", seams)
    if world == "B":
        # The outside seam records its contract, so a diagram that drew it would draw it whole (O4).
        x("UPDATE seams SET a_writes='queued plans', a_reads='plan receipts', b_writes='plan receipts',"
          " b_reads='queued plans' WHERE id=?", (SEAM_OUTSIDE,))


    if world == "C":
        rules: tuple[tuple[Any, ...], ...] = ((1, "build/", "include"),)
        sorting: tuple[tuple[Any, ...], ...] = (*SORTING[:2], (3, "notes/", "product"), SORTING[3],
                                                (5, "design/", "product"), (6, "build/", "product"))
        exclusions: tuple[tuple[Any, ...], ...] = ()
    else:
        rules, sorting, exclusions = RULES, SORTING, EXCLUSIONS
    for i, p, a in rules:
        x("INSERT INTO scope_rules (id, pattern, action, reason, owner_words, session_id) VALUES (?, ?, ?, 'fixture',"
          " '\"leave it out\"', ?)", (i, p, a, SESSION))
    for i, p, c in sorting:
        x("INSERT INTO scope_sorting (id, pattern, category, description, session_id) VALUES (?, ?, ?, 'fixture', ?)",
          (i, p, c, SESSION))
    excluded = {p for p, _s, _r in exclusions}
    active = [(p, c) for _s, p, c in ledger if p not in excluded]
    exempt = {p for p, c in active if c in ("generated-ignore", "vendor-ignore", "irrelevant")}
    cur = x(
        "INSERT INTO scope_reconciliations (detected_sha, tree_digest, ledger_digest, tracked_paths, ledger_rows,"
        " unledgered, absent, exempt, session_id, detected_at, scope_digest, exclusion_digest, excluded, unsorted,"
        " survey_paths, scope_mode) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?, '2026-11-24T00:00:00Z', ?, ?, ?, 0, ?,"
        " 'sorted')",
        (head, set_digest(list(TREE)), set_digest([f"{p}{NUL}{c}" for p, c in active]), len(TREE),
         len({p for p, _c in active}), len(exempt), SESSION, scope_digest(rules, sorting),
         exclusion_digest(exclusions), len(exclusions), len(TREE) - len(exclusions)),
    )
    db.executemany("INSERT INTO scope_exclusions (reconciliation_id, file_path, source, rule_id) VALUES (?, ?, ?, ?)",
                   [(cur.lastrowid, p, s, r) for p, s, r in exclusions])
    import_onboarding(db, session_id=SESSION, entry_point=f"# Where to begin\n\nRead `src/a.ts`.\n\n"
                      f"## What is this codebase?\n\n{PROJECT} appends ledger rows and reads them back.\n",
                      onboarding_report=f"# Onboarding report\n\n**Codebase**: {PROJECT} — SC7 fixture\n")
    db.commit()
    db.close()
    (storage / "workspace_path").write_text(f"{ws}\n")


def publish(storage: Path, output: Path, *extra: str) -> dict[str, Any]:
    proc = subprocess.run(
        [sys.executable, str(ROOT / "materialize.py"), "--storage", str(storage), "--output", str(output),
         "--allow-external-output", *extra],
        capture_output=True, text=True, check=False, cwd=ROOT,
    )
    lines = [line for line in proc.stdout.splitlines() if line.strip()]
    summary: dict[str, Any] = {}
    if lines:
        try:
            summary = json.loads(lines[-1])
        except json.JSONDecodeError:
            summary = {}
    summary["_exit"] = proc.returncode
    if not summary.get("ok"):
        summary["_diagnostic"] = scrub((proc.stderr or proc.stdout)[-300:])
    return summary


def green(summary: dict[str, Any]) -> str | None:
    # A publish nests its read-back; `--readback-only` reports it at the top level.
    readback = summary.get("readback") or summary
    axes = readback.get("axes") or {}
    red = [a for a in ("state", "coverage", "content") if not (axes.get(a) or {}).get("ok")]
    if summary.get("_exit") != 0 or not summary.get("ok") or red:
        first = (readback.get("mismatches") or [{}])[0]
        return (f"not green: exit {summary.get('_exit')}, red axes {red}, {json.dumps(first)[:240]}"
                f" {summary.get('_diagnostic', '')}")
    return None


# ---------------------------------------------------------------------------
# Reading the pages.
# ---------------------------------------------------------------------------
class _Text(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def plain(fragment: str) -> str:
    parser = _Text()
    parser.feed(fragment)
    parser.close()
    return " ".join("".join(parser.parts).split())


class _Links(HTMLParser):
    """Every `<a href>` with its visible text, and every id on the page."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[list[str]] = []
        self.ids: set[str] = set()
        self._open: list[list[str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        found = dict(attrs)
        for key in ("id", "name"):
            if found.get(key):
                self.ids.add(str(found[key]))
        if tag == "a" and found.get("href") is not None:
            link = [str(found["href"]), ""]
            self.links.append(link)
            self._open.append(link)

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._open:
            self._open.pop()

    def handle_data(self, data: str) -> None:
        for link in self._open:
            link[1] += data


def parse(text: str) -> _Links:
    parser = _Links()
    parser.feed(text)
    parser.close()
    return parser


def pages(output: Path) -> dict[str, str]:
    return {str(p.relative_to(output)): p.read_text() for p in sorted(output.rglob("*.html"))}


def locus_index(output: Path) -> dict[str, Any]:
    text = (output / "search-index.js").read_text()
    start = text.index("{")
    return json.loads(text[start : text.rindex("}") + 1])


def broken_links(output: Path) -> list[str]:
    broken: list[str] = []
    parsed = {rel: parse(text) for rel, text in pages(output).items()}
    for rel, page in parsed.items():
        for href, _text in page.links:
            if re.match(r"^[a-z][a-z0-9+.-]*:", href) or href.startswith("//"):
                continue
            target, _, fragment = href.partition("#")
            target_rel = os.path.normpath(os.path.join(os.path.dirname(rel), target)) if target else rel
            if target and not (output / target_rel).exists():
                broken.append(f"{rel} → {href} (no page)")
                continue
            if fragment and target_rel.endswith(".html"):
                ids = parsed[target_rel].ids if target_rel in parsed else set()
                if fragment not in ids:
                    broken.append(f"{rel} → {href} (no anchor)")
    return broken


_FIGURE = re.compile(r"<figure\b.*?</figure>|<svg\b.*?</svg>", re.S)


def figures(text: str) -> str:
    return "\n".join(m.group(0) for m in _FIGURE.finditer(text))


def ledger_anchor(sid: str, file_path: str) -> str:
    """§7.4's per-owner ledger entry anchor, recomputed."""

    return "le-" + hashlib.sha1(f"{sid}\x00{file_path}".encode()).hexdigest()[:10]


def ledger_anchors(text: str) -> list[str]:
    return sorted(i for i in parse(text).ids if i.startswith("le-"))


def subsystem_page(output: Path, sid: str) -> Path | None:
    found = sorted((output / "subsystems").glob(f"{sid.replace('-', '').lower()}-*.html"))
    return found[0] if found else None


# ---------------------------------------------------------------------------
# The golden corpus (G1).
# ---------------------------------------------------------------------------
def unfold(text: str) -> str:
    return re.sub(r"@@golden-asset ([0-9a-f]{64})@@", lambda m: (GOLDEN / "assets" / m.group(1)).read_text(), text)


def golden_identical(root: Path) -> str | None:
    for store in ("materializer", "axiomdb-shaped", "self-shaped"):
        dump = GOLDEN / store / "memory.sql"
        if "scope_exclusions" in dump.read_text():
            return f"the {store} golden store carries scope tables, so it cannot stand for a store without them"
        storage = root / "golden" / store / "storage"
        storage.mkdir(parents=True)
        db = sqlite3.connect(storage / "memory.db")
        db.executescript(dump.read_text())
        db.commit()
        db.close()
        if store == "materializer":
            (storage / "workspace_path").write_text("/example/FictionalProject\n")
        output = root / "golden" / store / "docs"
        summary = publish(storage, output)
        if summary.get("_exit") != 0:
            return f"{store} did not publish: {summary.get('_diagnostic', '')}"
        wanted = sorted((GOLDEN / store / "html").rglob("*.html"))
        if not wanted:
            return f"the {store} golden corpus holds no pages"
        for golden in wanted:
            rel = golden.relative_to(GOLDEN / store / "html")
            got = output / rel
            if not got.is_file():
                return f"{store}/{rel} was not written"
            if got.read_text() != unfold(golden.read_text()):
                return f"{store}/{rel} differs from the golden corpus"
    return None


# ---------------------------------------------------------------------------
# Tampering for read-back (R2–R5).
# ---------------------------------------------------------------------------
def tampered(source: Path, docs: Path, root: Path, name: str, sql: str) -> dict[str, Any]:
    base = root / f"tamper-{name}"
    storage = base / "storage"
    shutil.copytree(source, storage)
    shutil.copytree(docs, base / "docs")
    db = sqlite3.connect(storage / "memory.db")
    for table in ("scope_exclusions", "scope_rules", "scope_reconciliations"):
        for (trigger,) in db.execute("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name=?", (table,)):
            db.execute(f'DROP TRIGGER IF EXISTS "{trigger}"')
    db.executescript(sql)
    db.commit()
    db.close()
    return publish(storage, base / "docs", "--readback-only")


def main() -> int:
    emit("GATE SC7 — pages and read-back over the survey set")
    root = Path(tempfile.mkdtemp(prefix="amanuensis-sc7-"))
    try:
        run(root)
    finally:
        shutil.rmtree(root, ignore_errors=True)
    if FAILURES:
        emit(f"GATE SC7 RED: {len(FAILURES)} assertion(s) failed; first: {FAILURES[0]}")
        return 1
    emit("GATE SC7 GREEN")
    return 0


def run(root: Path) -> None:
    try:
        ws, head = make_workspace(root)
    except Exception as exc:
        failed = f"it was not: {exc!r}"
        check("the fixture repository is built", lambda: failed)
        return
    stores: dict[str, tuple[Path, Path, dict[str, Any]]] = {}
    for world in ("A", "B", "C"):
        storage = root / world / "storage"
        output = root / world / "docs"
        try:
            seed(storage, ws, head, world)
            summary = publish(storage, output)
        except Exception as exc:
            summary = {"_exit": -1, "_diagnostic": scrub(repr(exc))}
        stores[world] = (storage, output, summary)

    for world in ("A", "B", "C"):
        check(f"R1/P1 store {world} publishes and reads back green", lambda w=world: green(stores[w][2]))
    if any(green(stores[w][2]) for w in stores):
        check("G1 a store with no scope tables renders byte-identical to the golden corpus",
              lambda: golden_identical(root))
        _ci()
        return
    out_a, out_b, out_c = stores["A"][1], stores["B"][1], stores["C"][1]
    pages_a, pages_b, pages_c = pages(out_a), pages(out_b), pages(out_c)

    def nowhere() -> str | None:
        found = [f"{path} on {rel}" for rel, text in pages_a.items() for path in EXCLUDED if path in text]
        index = (out_a / "search-index.js").read_text()
        found += [f"{path} in search-index.js" for path in EXCLUDED if path in index]
        return f"excluded paths printed: {found[:5]}" if found else None

    check("P2 with every kind of exclusion, no excluded path is printed on any page or in the index", nowhere)

    def index_rows(output: Path, symbols: list[tuple[str, str, str]]) -> str | None:
        got = locus_index(output)
        paths = [(e["p"], e["o"], e["s"], e["h"]) for e in got.get("paths", [])]
        want = [
            (EXEMPT_GOLDEN, ["B-01"], "excluded", f"files.html#{anchor(EXEMPT_GOLDEN)}"),
            ("src/a.ts", ["B-01"], "examined", f"files.html#{anchor('src/a.ts')}"),
            ("src/b.ts", ["B-03"], "scoped-unread", f"files.html#{anchor('src/b.ts')}"),
        ]
        if paths != want:
            return f"the locus index paths are {paths}, want {want}"
        syms = [(e["y"], e["p"], e["h"]) for e in got.get("symbols", [])]
        return None if syms == symbols else f"the locus index symbols are {syms}, want {symbols}"

    in_symbol = [("alphaSymbol", "src/a.ts", f"files.html#{anchor('src/a.ts')}")]
    check("P3 the locus index of store A is exactly the survey set's ledgered paths", lambda: index_rows(out_a, in_symbol))
    check("C3 the locus index of store B carries no path or symbol on an excluded path",
          lambda: index_rows(out_b, in_symbol))

    def files_listing() -> str | None:
        links = parse(pages_a["files.html"])
        listed = sorted(i for i in links.ids if i.startswith("f-"))
        want = sorted(anchor(p) for p in (EXEMPT_GOLDEN, "src/a.ts", "src/b.ts"))
        return None if listed == want else f"files.html anchors {listed}, want {want}"

    check("P1 the Files page lists exactly the survey set's ledgered paths", files_listing)
    check("E1 the ledger-exempt golden still prints on the Files page and its subsystem page",
          lambda: None if EXEMPT_GOLDEN in pages_a["files.html"]
          and EXEMPT_GOLDEN in subsystem_page(out_a, "B-01").read_text() else "golden/out.txt is not printed")

    def plain_citations() -> str | None:
        problems: list[str] = []
        for rel, text in pages_b.items():
            for href, label in parse(text).links:
                for path in EXCLUDED:
                    if anchor(path) in href or path in label or path in href:
                        problems.append(f"{rel}: a link {href!r} on {label!r}")
        if problems:
            return f"an excluded path is a link: {problems[:3]}"
        resolved = plain(pages_b.get("resolved-findings.html", ""))
        if f"{META} notesSymbol" not in resolved:
            return "the resolution basis citing notes/n.md is not printed on resolved-findings.html"
        printed = [p for p in (OWNER_EXCLUDED, META) if not any(p in t for t in pages_b.values())]
        return f"the citations of {printed} are dropped" if printed else None

    check("C1 citations of excluded paths made before the exclusion print as plain text", plain_citations)

    def linked_citation() -> str | None:
        links = parse(pages_b.get("resolved-findings.html", "")).links
        wanted = f"files.html#{anchor('src/a.ts')}"
        return None if any(href.endswith(wanted) for href, _ in links) else "src/a.ts's citation is not a link"

    check("C2 a citation of an in-survey path is still a link", linked_citation)
    for world, output in (("A", out_a), ("B", out_b), ("C", out_c)):
        check(f"L1 no link on any page of store {world} targets a page or an anchor that does not exist",
              lambda o=output: (lambda b: f"broken: {b[:4]}" if b else None)(broken_links(o)))

    def outside_page() -> str | None:
        page = subsystem_page(out_b, OUTSIDE)
        if page is None:
            return "B-02 has no page"
        text = page.read_text()
        headings = [plain(h).lstrip("\u00a7").strip() for h in re.findall(r"<h[1-6]\b[^>]*>.*?</h[1-6]>", text, re.S)]
        if "Outside this survey" not in headings:
            return f"the page is not headed 'Outside this survey': {headings[:8]}"
        if "File ledger" in headings or ledger_anchors(text):
            return f"the page carries a file listing: {ledger_anchors(text)}"
        body = plain(text)
        missing = [w for w in ("The prototype plans name the cache.", "CC-1", "B02-1", SEAM_OUTSIDE) if w not in body]
        if 'data-record="claim:CL-B02"' not in text:
            missing.append("the record of claim CL-B02")
        return f"the page drops {missing}" if missing else None

    check("O1 a subsystem outside the survey keeps its page, headed 'Outside this survey', with no file listing,"
          " its claim, disposition, finding and seam", outside_page)

    def seams_drawn() -> str | None:
        drawn = "\n".join(figures(t) for t in pages_b.values())
        if SEAM_OUTSIDE in drawn:
            return f"{SEAM_OUTSIDE} is drawn on a diagram"
        return None if SEAM_INSIDE in drawn else f"{SEAM_INSIDE} is drawn on no diagram, so the check cannot see seams"

    check("O2 a seam outside the survey is drawn on no diagram, and a seam inside it still is", seams_drawn)

    def seams_drawn_anywhere() -> str | None:
        spokes = [m.group(0) for t in pages_b.values()
                  for m in re.finditer(r'<article class="topology-spoke".*?</article>', t, re.S)]
        problems = [f"{SEAM_OUTSIDE} is a topology edge" for spoke in spokes if SEAM_OUTSIDE in spoke][:1]
        problems += [f"{rel} draws a {kind} block for it" for rel, t in pages_b.items()
                     for kind in re.findall(rf'data-diagram="([^"]+)" data-subject="{SEAM_OUTSIDE}"', t)]
        if not any(SEAM_INSIDE in spoke for spoke in spokes):
            problems.append(f"{SEAM_INSIDE} is no topology edge, so the check cannot see edges")
        return "; ".join(problems) if problems else None

    check("O4 a seam outside the survey, with its contract recorded, is no topology edge and no seam-contract block",
          seams_drawn_anywhere)
    check("O3 the in-survey subsystem lists exactly its rows inside the survey set",
          lambda: (lambda got, want: None if got == want else f"B-01's ledger anchors {got}, want {want}")(
              ledger_anchors(subsystem_page(out_b, "B-01").read_text()),
              sorted(ledger_anchor("B-01", p) for p in ("src/a.ts", EXEMPT_GOLDEN))))

    def overview_files_read() -> str | None:
        text = plain(pages_a["index.html"])
        match = re.search(r"Files read[^0-9]*?(\d+ of \d+)", text)
        got = match.group(1) if match else None
        return None if got == "1 of 3" else f"the overview's files read is {got!r}, want '1 of 3' (survey set less exempt)"

    check("V1 the overview's files read is counted over the survey set", overview_files_read)
    check("V2 the not-yet-surveyed denominator is the survey set",
          lambda: None if "1 of 4" in plain(pages_a["not-yet-surveyed.html"])
          else "not-yet-surveyed.html does not print 1 of 4 paths")

    def bars() -> str | None:
        text = plain(pages_a["files.html"])
        wanted = ("In the ledger — 2 of 4", "In the ledger, exempt from the survey — 1 of 4", "In no ledger — 1 of 4",
                  "1 of 2 files")
        missing = [w for w in wanted if w not in text]
        return f"the coverage bars do not print {missing}" if missing else None

    check("V3 the coverage bars are drawn over the survey set", bars)

    def owed_work() -> str | None:
        text = plain(pages_b["not-yet-surveyed.html"])
        wanted = ("2 of 2 (seam, side) pairs", "2 of 2 (subsystem, active concern) pairs")
        problems = [f"does not print {w!r}" for w in wanted if w not in text]
        owed = text[text.find("Seam sides no one has assessed"):]
        problems += [f"owes work for {w}" for w in (SEAM_OUTSIDE, OUTSIDE) if w in owed]
        return f"store B's not-yet-surveyed page {problems}" if problems else None

    check("N1 the not-yet-surveyed page owes nothing for a seam or a subsystem outside the survey", owed_work)

    def stale_listing() -> str | None:
        text = plain(pages_a["stale.html"])
        if STALE_CONTROL not in text or "1 of 1 file in scope but not yet read has changed" not in text:
            return f"stale.html does not list the included stale row {STALE_CONTROL}"
        listed = [p for p in EXCLUDED if p in pages_a["stale.html"]]
        return f"stale.html lists excluded stale rows {listed}" if listed else None

    check("S1 the stale page lists an included stale row and no excluded one", stale_listing)

    def overview_line() -> str | None:
        want = (f"Outside this survey: 1 path ignored by git, 1 the owner excluded (`{OWNER_PATTERN}`),"
                " 1 sorted as meta.")
        for world, text in (("A", pages_a["index.html"]), ("B", pages_b["index.html"])):
            body = plain(text).replace("‘", "`").replace("’", "`")
            if want.replace("`", "") not in body.replace("`", ""):
                return f"store {world}'s overview does not print {want!r}"
            if any(p in text for p in EXCLUDED):
                return f"store {world}'s overview names an excluded path"
        return None

    check("W1 the overview names each source's count and the owner's patterns", overview_line)
    check("W2 no overview line when nothing is excluded",
          lambda: "store C's overview prints the line" if "Outside this survey" in pages_c["index.html"] else None)

    storage_a, docs_a = stores["A"][0], stores["A"][1]
    tampers = {
        "R2 an added scope_exclusions row": "INSERT INTO scope_exclusions (reconciliation_id, file_path, source,"
        " rule_id) VALUES (1, 'src/b.ts', 'user', 1);",
        "R3 two scope_exclusions rows swapped": "UPDATE scope_exclusions SET source='meta', rule_id=3 WHERE"
        f" file_path='{OWNER_EXCLUDED}'; UPDATE scope_exclusions SET source='user', rule_id=1 WHERE file_path='{META}';",
        "R4 a re-sourced scope_exclusions row": f"UPDATE scope_exclusions SET source='user', rule_id=1 WHERE"
        f" file_path='{META}';",
        "R5 a rule recorded without a reconciliation": "INSERT INTO scope_rules (id, pattern, action, reason,"
        " owner_words, session_id) VALUES (2, 'golden/', 'exclude', 'fixture', '\"drop it\"', 'sc7-session');",
    }
    for label, sql in tampers.items():
        name = label.split()[0]
        check(f"{label} turns read-back red",
              lambda s=sql, n=name: "read-back stayed green"
              if green(tampered(storage_a, docs_a, root, n, s)) is None else None)
    # Store C excludes nothing, so with its scope columns cleared its reconciliation reads as one
    # from before survey scope: it stands only while the store has no rule and no sorting row (§2.9).
    legacy = ("UPDATE scope_reconciliations SET scope_digest=NULL, exclusion_digest=NULL, excluded=NULL,"
              " unsorted=NULL, survey_paths=NULL, scope_mode=NULL;")
    check("R6 a reconciliation without scope columns, on a store with rules, turns read-back red",
          lambda: "read-back stayed green"
          if green(tampered(stores["C"][0], stores["C"][1], root, "R6", legacy)) is None else None)
    check("R1 read-back of the untouched copy stays green",
          lambda: green(tampered(storage_a, docs_a, root, "none", "SELECT 1;")))
    check("D1 the digests read-back restates order paths as the server does, non-BMP paths included", digests_agree)
    check("G1 a store with no scope tables renders byte-identical to the golden corpus", lambda: golden_identical(root))
    _ci()


# Paths whose UTF-16 order differs from their code-point order: a private-use character sorts
# after a surrogate pair by code units and before it by code points.
NON_BMP = ("x/\ue000.ts", "x/\U00010000.ts", "d/\U0001F600.md", "d/\ufb01.md")


def digests_agree() -> str | None:
    """The server's `exclusionDigest` and `trackedPathDigest`, run from the build, against this package's."""

    sys.path.insert(0, str(ROOT))
    from amanuensis_materializer import db as mdb  # noqa: PLC0415
    from amanuensis_materializer import readback  # noqa: PLC0415

    exclusions = [{"file_path": p, "source": "user", "rule_id": 1} for p in NON_BMP]
    dist = REPO / "mcp-server" / "dist"
    script = (
        "const [{exclusionDigest}, {trackedPathDigest}] = await Promise.all(["
        f"import({json.dumps(str(dist / 'scope.js'))}), import({json.dumps(str(dist / 'invariants.js'))})]);"
        f"const rows = {json.dumps(exclusions)}; const paths = rows.map((r) => r.file_path);"
        "console.log(JSON.stringify([exclusionDigest(rows), trackedPathDigest(paths)]));"
    )
    proc = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        return f"the server's digests could not be run: {scrub(proc.stderr.strip()[-200:])}"
    server_exclusion, server_tree = json.loads(proc.stdout)
    rows3 = tuple((p, "user", 1) for p in NON_BMP)
    problems = []
    if mdb.exclusion_digest(exclusions) != server_exclusion:
        problems.append("db.exclusion_digest differs from the server's exclusionDigest")
    if exclusion_digest(rows3) != server_exclusion:
        problems.append("this gate's restated exclusion_digest differs from the server's")
    if readback.tracked_path_digest(list(NON_BMP)) != server_tree:
        problems.append("readback.tracked_path_digest differs from the server's trackedPathDigest")
    return "; ".join(problems) if problems else None


def _ci() -> None:
    def in_ci() -> str | None:
        try:
            text = CI_FILE.read_text()
        except OSError:
            return "the CI workflow is not readable"
        return None if CI_COMMAND in text else f"the workflow does not run {CI_COMMAND}"

    check("CI1 the gate runs in CI", in_ci)


if __name__ == "__main__":
    try:
        code = main()
    except Exception as exc:  # the status line is always the last line
        emit(f"GATE SC7 RED: the gate did not finish: {exc!r}")
        code = 1
    sys.exit(code)
