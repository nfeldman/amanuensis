#!/usr/bin/env python3
"""Gate for reader-lenses packet P10 — the generated locus index and the
accessible interface enhancement (spec.md §8.1, §8.2, §8.3, §7.4; claims C39,
C40, C41, C55, C63).

Turns red when:

  - `search-index.js` is not written into the projection, is not parseable as
    `window.__amanuensisLocusIndex = {…}`, or carries a `paths`/`symbols` shape
    other than the one §8.1.1 fixes;
  - an obligation-bearing `file_ledger.file_path` is missing from `paths` or
    appears more than once, a path's owners are not every owning subsystem, a
    path's standing state differs from a **declared fixture table** covering
    examined, examined-stale, scoped-unread, excluded, absent, and the
    disagreeing-owner `mixed` case, or a path's `h` is not the `f-<sha1>` anchor
    §7.4 fixes;
  - an `evidence` row with a non-null `symbol` is missing from `symbols`, or a
    row whose `symbol` is null contributes an entry;
  - a page is removed from `.projection-contract.json`'s `pages` while its
    bytes stay on disk and read-back still reports the content axis green;
  - `search-index.js` is absent from `.projection-contract.json`'s `pages`, from
    `manifest.projection_files`, or its recorded hash is not the file's bytes;
  - removing one path entry from the index leaves the **state** axis green;
    removing one symbol entry leaves it green; deleting the file leaves the
    **coverage** axis green; a clean publish with the file present is not green;
  - a file's `f-<sha1>` anchor is unreachable from `files.html` with scripts
    disabled, or the three paths that collide under `slugify` do not reach three
    distinct anchors;
  - the projection references an external host from any `script`, `link`,
    `img`, `iframe`, or `source`, from CSS `url()`/`@import`, or reaches the
    network at runtime (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`,
    `sendBeacon`);
  - **driven in a real browser**: the search control does not expose
    `role="combobox"` with `aria-expanded`, `aria-controls`, and
    `aria-activedescendant`; there is no polite live region; ⌘K does not focus
    it; typing does not open a `role="listbox"` of `role="option"` elements;
    `ArrowDown`/`ArrowUp` do not move the active option and its
    `aria-selected`; `Enter` does not activate the active option and move focus
    to its target; `Escape` does not close the list and restore focus to the
    element focused before the search; the live region does not announce the
    result count;
  - **driven in a real browser**: the in-page filters on `findings.html` and
    `hot-spots.html` are not native controls inside a labelled `<fieldset>`, do
    not hide the rows they exclude, or do not announce "n of m rows shown";
  - **driven in a real browser with script execution disabled**: a page, a file
    anchor, or a filterable row is unreachable or invisible, or a filter control
    appears at all;
  - no Chromium-family browser is available, so none of the behavioural
    assertions above can be evaluated. A skipped behavioural arm is a
    zero-denominator green (VP4), so absence turns this gate red rather than
    passing it quietly;
  - the gate does not run in CI.

False green it cannot exclude: an index entry proves reachability, not
usefulness. Every path, owner, and symbol is read from the one store this gate
seeded, so agreement proves the builder reads the store it was given, never that
`add_evidence` or `detect_changes` wrote the right rows. The browser arm drives
one engine; a keyboard interaction that works in Chromium is not proof that
every assistive technology announces it, and this gate never inspects an
accessibility tree — it reads the ARIA attributes and the DOM the engine
computed.

Output protocol: exactly one status line, last, on stdout. Every subprocess and
every browser reply is captured and never echoed, and every message is scrubbed,
so a missing deliverable reports as an assertion failure rather than as a crash.
"""

from __future__ import annotations

import base64
import contextlib
import glob
import json
import os
import re
import shutil
import socket
import sqlite3
import struct
import subprocess
import sys
import tempfile
import time
from collections.abc import Callable
from hashlib import sha1, sha256
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
SCHEMA = REPO / "mcp-server" / "src" / "schema.sql"
CI_FILE = REPO / ".github" / "workflows" / "test.yml"

INDEX_FILE = "search-index.js"

# ---------------------------------------------------------------------------
# Output funnel. Nothing reaches stdout except through emit(), and everything is
# scrubbed of the launcher's crash signatures so a genuine assertion failure is
# never mistaken for a gate that never ran.
# ---------------------------------------------------------------------------
_SCRUB: tuple[tuple[str, str], ...] = (
    ("MODULE_NOT_FOUND", "module-absent"),
    ("ModuleNotFoundError", "python-module-absent"),
    ("Cannot find module", "cannot load module"),
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


def read(path: Path) -> str | None:
    try:
        return path.read_text()
    except OSError:
        return None


# ---------------------------------------------------------------------------
# What the specification fixes, written out here rather than imported, so that
# rewriting an implementation constant cannot also rewrite what this gate
# expects (§7.4, §8.1, §8.2).
# ---------------------------------------------------------------------------
PROJECT_NAME = "IndexFixture"
SHA_A = "aaaaaaaaaaaa1111aaaaaaaaaaaa1111aaaaaaaa"
SHA_B = "bbbbbbbbbbbb2222bbbbbbbbbbbb2222bbbbbbbb"


def expected_anchor(file_path: str) -> str:
    """§7.4's anchor, recomputed rather than imported."""

    return "f-" + sha1(file_path.encode("utf-8")).hexdigest()[:10]


SUBSYSTEMS: tuple[tuple[str, str, str, str, str | None, str | None, str | None], ...] = (
    ("B-01", "Read path", "mapped", "backend", "src/reader.ts and what it re-exports", None, None),
    ("B-02", "Write path", "mapped", "backend", "src/writer.ts, src/shared.ts", None, None),
    ("B-03", "Queue", "scoping", "backend", "the queue handle and its owners", None, None),
)

# Three paths that collide under `slugify` (every non-alphanumeric run becomes
# one dash), so a slug anchor would give all three the same id (§7.4).
COLLIDING_PATHS: tuple[str, str, str] = ("src/a/b.ts", "src/a-b.ts", "src/a.b.ts")
MULTI_OWNER_PATH = "src/shared.ts"
ABSENT_PATH = "src/gone.ts"
UNLEDGERED_CITED_PATH = "src/orphan.ts"

# (subsystem, path, classification, stale, ref_sha, stale_reason)
LEDGER: tuple[tuple[str, str, str, int, str, str | None], ...] = (
    ("B-01", "src/a/b.ts", "examined", 0, SHA_A, None),
    ("B-01", "src/a-b.ts", "examined", 1, SHA_A, "git-drift"),
    ("B-01", "src/a.b.ts", "candidate", 0, SHA_A, None),
    ("B-01", MULTI_OWNER_PATH, "examined", 0, SHA_A, None),
    ("B-02", MULTI_OWNER_PATH, "candidate", 0, SHA_B, None),
    ("B-03", "src/queue.ts", "candidate", 0, SHA_A, None),
    ("B-02", ABSENT_PATH, "examined", 1, SHA_A, "absent"),
    ("B-03", "ui/legacy.ts", "deferred-with-reason", 0, SHA_A, None),
    ("B-01", "dist/bundle.js", "generated-ignore", 0, SHA_A, None),
    ("B-01", "vendor/lib.js", "vendor-ignore", 0, SHA_A, None),
)
EXEMPT_CLASSIFICATIONS = ("generated-ignore", "vendor-ignore", "irrelevant")
LEDGER_PATHS: tuple[str, ...] = tuple(
    dict.fromkeys(path for _s, path, _c, _st, _r, _rr in LEDGER)
)
OBLIGATION_PATHS: tuple[str, ...] = tuple(
    path
    for path in LEDGER_PATHS
    if any(
        row[1] == path and row[2] not in EXEMPT_CLASSIFICATIONS for row in LEDGER
    )
)
OWNERS_OF: dict[str, list[str]] = {}
for _s, _p, *_rest in LEDGER:
    OWNERS_OF.setdefault(_p, []).append(_s)

# The declared standing table (§2.2's CASE plus §2.4.2's disagreeing-owner
# rule), written out rather than read from `file_standing`, so a view whose
# predicate drifts cannot also drift what this gate expects. Every one of the
# states the index can carry is exercised.
EXPECTED_STANDING: dict[str, str] = {
    "src/a/b.ts": "examined",
    "src/a-b.ts": "examined-stale",
    "src/a.b.ts": "scoped-unread",
    MULTI_OWNER_PATH: "mixed",           # examined (B-01) vs scoped-unread (B-02)
    "src/queue.ts": "scoped-unread",
    ABSENT_PATH: "absent",
    "ui/legacy.ts": "excluded",
    "dist/bundle.js": "excluded",
    "vendor/lib.js": "excluded",
}

# (file_path, symbol) — the fourth row carries no symbol and must contribute
# nothing, and the third cites a path no ledger row names.
EVIDENCE: tuple[tuple[str, str | None], ...] = (
    ("src/a/b.ts", "writeRow"),
    (MULTI_OWNER_PATH, "RowBuffer::drain"),
    (UNLEDGERED_CITED_PATH, "orphanSymbol"),
    ("src/a-b.ts", None),
)
CITED_SYMBOLS: tuple[tuple[str, str], ...] = tuple(
    (path, symbol) for path, symbol in EVIDENCE if symbol
)

# (finding_id, subsystem, severity, status, resolution_state, primary_files)
FINDINGS: tuple[tuple[str, str, str, str, str, list[str]], ...] = (
    ("B01-1", "B-01", "CRITICAL", "confirmed-bug", "open", ["src/a/b.ts:writeRow@" + SHA_A]),
    ("B01-2", "B-01", "HIGH", "confirmed-bug", "open", [MULTI_OWNER_PATH]),
    ("B02-1", "B-02", "MEDIUM", "confirmed-bug", "open", [MULTI_OWNER_PATH]),
    ("B02-2", "B-02", "LOW", "fixed", "fixed-pending-verification", [ABSENT_PATH]),
    ("B03-1", "B-03", "HIGH", "confirmed-acceptable", "accepted", ["src/queue.ts"]),
)
# findings.html carries the four non-terminal records: one per severity, two
# subsystems. Both numbers are distinct from every other count in the fixture,
# so a filter that narrows on the wrong facet cannot coincide with the right
# answer.
OPEN_RECORDS = 4
CRITICAL_RECORDS = 1
READ_PATH_RECORDS = 2
HOT_SPOT_ROWS = len(SUBSYSTEMS)

CONCERNS: tuple[tuple[str, str, str], ...] = (
    ("SC-1", "composition", "active"),
    ("CC-1", "concurrency", "active"),
)
DISPOSITIONS: tuple[tuple[str, str, str], ...] = (
    ("B-01", "SC-1", "confirmed-acceptable"),
    ("B-01", "CC-1", "confirmed-bug"),
)
SEAMS: tuple[tuple[str, str, str, str], ...] = (
    ("SM-1", "the row buffer", "B-01", "B-02"),
)

THESIS_SENTENCE = (
    "IndexFixture writes rows on one path and reads them on another, with a "
    "shared buffer between them."
)
ENTRY_POINT = f"""# Where to begin

A dated reading path recorded by an earlier session.

## What is this codebase?

{THESIS_SENTENCE}
"""
ONBOARDING_REPORT = f"""# Onboarding report

**Codebase**: {PROJECT_NAME} — P10 gate fixture

## Directory clusters

- src/ — the read and write paths
"""


# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------
def seed(storage: Path) -> None:
    db = sqlite3.connect(storage / "memory.db")
    db.executescript(SCHEMA.read_text())
    cur = db.cursor()
    cur.execute(
        "INSERT INTO git_state (repo_id, canonical_branch, onboarding_sha,"
        " last_checked_sha, last_checked_at)"
        f" VALUES ('default', 'main', '{SHA_A}', '{SHA_A}', '2026-09-12T12:00:00Z')"
    )
    cur.execute("INSERT INTO sessions (session_id, intent) VALUES ('p10', 'fixture')")
    cur.executemany(
        "INSERT INTO subsystems (id, name, status, layer, scope, jump_in_reading, notes)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        list(SUBSYSTEMS),
    )
    cur.executemany(
        "INSERT INTO file_ledger (subsystem_id, file_path, why_in_scope, classification,"
        " ref_sha, examined_at, stale, stale_since, stale_reason)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (
                subsystem,
                path,
                f"In scope for {subsystem}.",
                classification,
                ref_sha,
                "2026-09-12T11:00:00Z" if classification == "examined" else None,
                stale,
                "2026-09-12T11:30:00Z" if stale else None,
                stale_reason,
            )
            for subsystem, path, classification, stale, ref_sha, stale_reason in LEDGER
        ],
    )
    cur.executemany(
        "INSERT INTO scope_gaps (file_path, kind, subsystem_id, detected_sha)"
        f" VALUES (?, 'unledgered', NULL, '{SHA_A}')",
        [("README.md",), ("docs/guide.md",), (UNLEDGERED_CITED_PATH,)],
    )
    cur.execute(
        "INSERT INTO scope_gaps (file_path, kind, subsystem_id, detected_sha)"
        f" VALUES ('{ABSENT_PATH}', 'absent', 'B-02', '{SHA_A}')"
    )
    cur.executemany(
        "INSERT INTO concerns (code, category, origin, status) VALUES (?, ?, 'seeded', ?)",
        list(CONCERNS),
    )
    cur.executemany(
        "INSERT INTO dispositions (subsystem_id, concern_code, classification,"
        " evidence_quality, rationale, ref_sha, session_id, pass_type)"
        f" VALUES (?, ?, ?, 'code-verified', 'fixture', '{SHA_A}', 'p10', 'survey')",
        list(DISPOSITIONS),
    )
    cur.executemany(
        "INSERT INTO seams (id, shared_object, party_a, party_b, ordering_assumption)"
        " VALUES (?, ?, ?, ?, 'the buffer is written before it is read')",
        list(SEAMS),
    )
    cur.executemany(
        "INSERT INTO evidence (file_path, symbol, ref_sha, kind, note, session_id)"
        f" VALUES (?, ?, '{SHA_A}', 'code-verified', 'fixture', 'p10')",
        list(EVIDENCE),
    )
    cur.executemany(
        "INSERT INTO findings (finding_id, subsystem_id, symptom, root_cause, severity,"
        " status, primary_files, ref_sha, session_id, pass_type)"
        f" VALUES (?, ?, ?, ?, ?, ?, ?, '{SHA_A}', 'p10', 'survey')",
        [
            (
                fid,
                sid,
                f"{fid} drops a row under load",
                "the buffer is reused before the reader is done with it",
                severity,
                status,
                json.dumps(files),
            )
            for fid, sid, severity, status, _state, files in FINDINGS
        ],
    )
    for fid, _sid, _sev, _status, state, _files in FINDINGS:
        if state in ("fixed-pending-verification", "verified-fixed"):
            cur.execute(
                "INSERT INTO finding_resolution_events (finding_id, resolution_state,"
                " fix_location, fix_sha, rationale, session_id)"
                f" VALUES (?, ?, 'src/writer.ts', '{SHA_B}', 'fixture', 'p10')",
                (fid, state),
            )
        else:
            cur.execute(
                "INSERT INTO finding_resolution_events (finding_id, resolution_state,"
                " rationale, session_id) VALUES (?, ?, 'fixture', 'p10')",
                (fid, state),
            )
    cur.execute(
        "INSERT INTO vocabulary (term, gloss, subsystem_id, first_seen, ref_sha)"
        f" VALUES ('row buffer', 'the shared page the writer fills', 'B-01',"
        f" 'src/reader.ts', '{SHA_A}')"
    )
    db.commit()
    db.close()
    (storage / "entry-point.md").write_text(ENTRY_POINT)
    (storage / "onboarding-report.md").write_text(ONBOARDING_REPORT)


def publish(storage: Path, *args: str) -> dict[str, Any]:
    """Run the materializer, capturing everything. Never echoes its output."""

    proc = subprocess.run(
        [sys.executable, str(ROOT / "materialize.py"), "--storage", str(storage), *args],
        capture_output=True,
        text=True,
        check=False,
    )
    lines = [line for line in proc.stdout.splitlines() if line.strip()]
    summary: dict[str, Any] = {}
    if lines:
        try:
            summary = json.loads(lines[-1])
        except json.JSONDecodeError:
            summary = {}
    summary["_returncode"] = proc.returncode
    if not summary:
        summary["_diagnostic"] = scrub(proc.stderr)[-400:]
    return summary


def axis_ok(summary: dict[str, Any], axis: str) -> bool | None:
    """Whether one read-back axis reported green; None when unreadable."""

    readback = summary.get("readback") if "readback" in summary else summary
    axes = (readback or {}).get("axes") or {}
    entry = axes.get(axis)
    if not isinstance(entry, dict) or "ok" not in entry:
        return None
    return bool(entry["ok"])


def parse_index(text: str) -> dict[str, Any]:
    """Read the assignment §8.1.1 fixes back into Python."""

    match = re.search(
        r"window\.__amanuensisLocusIndex\s*=\s*(\{.*\})\s*;", text, re.DOTALL
    )
    if not match:
        raise ValueError("the file carries no window.__amanuensisLocusIndex assignment")
    return json.loads(match.group(1))


class _Ids(HTMLParser):
    """Every `id` and the attributes of interest, with no script having run."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.ids: set[str] = set()
        self.hidden: list[str] = []
        self.filter_rows = 0
        self.script_srcs: list[str] = []
        self.resource_srcs: list[str] = []
        self.fieldsets = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {name: (value or "") for name, value in attrs}
        if values.get("id"):
            self.ids.add(values["id"])
        if "data-filter-row" in values:
            self.filter_rows += 1
            if "hidden" in values:
                self.hidden.append(values.get("data-filter-subsystem") or tag)
        if tag == "fieldset":
            self.fieldsets += 1
        if tag == "script" and values.get("src"):
            self.script_srcs.append(values["src"])
        if tag in ("link", "img", "iframe", "source", "audio", "video", "track", "embed"):
            for attribute in ("href", "src", "srcset", "poster", "data"):
                if values.get(attribute):
                    self.resource_srcs.append(values[attribute])


EXTERNAL = re.compile(r"^(?:[a-zA-Z][a-zA-Z0-9+.-]*:)?//")
NETWORK_CALLS = (
    "fetch(",
    "XMLHttpRequest",
    "new WebSocket",
    "EventSource",
    "sendBeacon",
    "importScripts",
)


# ---------------------------------------------------------------------------
# A real browser, driven over the DevTools protocol. No dependency is installed
# for this: the WebSocket framing below is the minimum CDP needs, so the gate
# runs from a bare checkout wherever a Chromium-family binary exists.
# ---------------------------------------------------------------------------
_BROWSER_NAMES = (
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "microsoft-edge",
    "microsoft-edge-stable",
)
_BROWSER_PATHS = (
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
)
_BROWSER_GLOBS = (
    "~/.cache/puppeteer/chrome/*/chrome-*/Google Chrome for Testing.app/Contents/MacOS/"
    "Google Chrome for Testing",
    "~/.cache/puppeteer/chrome/*/chrome-*/chrome",
    "~/Library/Caches/ms-playwright/chromium-*/chrome-*/Chromium.app/Contents/MacOS/Chromium",
    "~/Library/Caches/ms-playwright/chromium-*/chrome-*/chrome",
    "~/.cache/ms-playwright/chromium-*/chrome-*/chrome",
)


def find_browser() -> str | None:
    override = os.environ.get("AMANUENSIS_TEST_BROWSER")
    if override:
        return override if Path(override).is_file() else None
    for name in _BROWSER_NAMES:
        found = shutil.which(name)
        if found:
            return found
    for candidate in _BROWSER_PATHS:
        if Path(candidate).is_file():
            return candidate
    for pattern in _BROWSER_GLOBS:
        for hit in sorted(glob.glob(os.path.expanduser(pattern)), reverse=True):
            if Path(hit).is_file():
                return hit
    return None


class _Socket:
    """A client WebSocket, text frames only — everything CDP needs."""

    def __init__(self, url: str) -> None:
        parsed = re.match(r"ws://([^:/]+):(\d+)(/.*)$", url)
        if not parsed:
            raise RuntimeError("the browser reported an unparsable debugging endpoint")
        host, port, path = parsed.group(1), int(parsed.group(2)), parsed.group(3)
        self.sock = socket.create_connection((host, port), timeout=30)
        self.sock.settimeout(30)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(
            (
                f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\n"
                "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
            ).encode()
        )
        self.reader = self.sock.makefile("rb")
        status = self.reader.readline()
        if b"101" not in status:
            raise RuntimeError("the browser refused the debugging handshake")
        while True:
            line = self.reader.readline()
            if line in (b"\r\n", b"\n", b""):
                break

    def send(self, text: str) -> None:
        payload = text.encode("utf-8")
        mask = os.urandom(4)
        header = bytearray([0x81])
        length = len(payload)
        if length < 126:
            header.append(0x80 | length)
        elif length < 65536:
            header.append(0x80 | 126)
            header += struct.pack(">H", length)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", length)
        header += mask
        self.sock.sendall(
            bytes(header) + bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        )

    def _exact(self, count: int) -> bytes:
        chunk = self.reader.read(count)
        if chunk is None or len(chunk) != count:
            raise RuntimeError("the browser closed the debugging connection")
        return chunk

    def recv(self) -> str:
        chunks: list[bytes] = []
        while True:
            first, second = self._exact(2)
            final = bool(first & 0x80)
            opcode = first & 0x0F
            masked = bool(second & 0x80)
            length = second & 0x7F
            if length == 126:
                length = struct.unpack(">H", self._exact(2))[0]
            elif length == 127:
                length = struct.unpack(">Q", self._exact(8))[0]
            mask = self._exact(4) if masked else b""
            data = self._exact(length) if length else b""
            if masked:
                data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
            if opcode == 0x9:  # ping
                self.sock.sendall(
                    b"\x8a" + bytes([0x80 | len(data)]) + os.urandom(4) + data
                )
                continue
            if opcode == 0xA:
                continue
            if opcode == 0x8:
                raise RuntimeError("the browser closed the debugging connection")
            chunks.append(data)
            if final:
                return b"".join(chunks).decode("utf-8", "replace")

    def close(self) -> None:
        with contextlib.suppress(OSError):
            self.sock.close()


class Browser:
    """One headless page, driven with real input events."""

    META = 4

    def __init__(self, binary: str) -> None:
        self.profile = tempfile.mkdtemp(prefix="amanuensis-p10-browser-")
        self.process = subprocess.Popen(
            [
                binary,
                "--headless=new",
                "--remote-debugging-port=0",
                f"--user-data-dir={self.profile}",
                "--no-first-run",
                "--no-default-browser-check",
                "--no-sandbox",
                "--disable-gpu",
                "--disable-dev-shm-usage",
                "--disable-extensions",
                "--disable-background-networking",
                "--disable-component-update",
                "--window-size=1280,1400",
                "about:blank",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
        )
        endpoint = None
        deadline = time.time() + 45
        while time.time() < deadline:
            line = self.process.stderr.readline()
            if not line:
                if self.process.poll() is not None:
                    break
                continue
            found = re.search(r"(ws://\S+)", line)
            if found:
                endpoint = found.group(1)
                break
        if not endpoint:
            raise RuntimeError("the browser never reported a debugging endpoint")
        self.socket = _Socket(endpoint)
        self.counter = 0
        self.session = ""
        target = self.call("Target.createTarget", {"url": "about:blank"})["targetId"]
        self.session = self.call(
            "Target.attachToTarget", {"targetId": target, "flatten": True}
        )["sessionId"]
        self.call("Page.enable")
        self.call("Runtime.enable")

    def call(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        self.counter += 1
        message: dict[str, Any] = {
            "id": self.counter,
            "method": method,
            "params": params or {},
        }
        if self.session:
            message["sessionId"] = self.session
        self.socket.send(json.dumps(message))
        while True:
            reply = json.loads(self.socket.recv())
            if reply.get("id") == self.counter:
                if "error" in reply:
                    raise RuntimeError(
                        f"{method} was refused: {reply['error'].get('message')}"
                    )
                return reply.get("result", {})

    def scripts(self, *, enabled: bool) -> None:
        self.call("Emulation.setScriptExecutionDisabled", {"value": not enabled})

    def open(self, url: str) -> None:
        self.call("Page.navigate", {"url": url})
        deadline = time.time() + 30
        while time.time() < deadline:
            if self.raw("document.readyState") == "complete":
                time.sleep(0.05)
                return
            time.sleep(0.05)
        raise RuntimeError("the page never finished loading")

    def raw(self, expression: str) -> Any:
        result = self.call(
            "Runtime.evaluate",
            {"expression": expression, "returnByValue": True, "awaitPromise": True},
        )
        if result.get("exceptionDetails"):
            raise RuntimeError(
                scrub(result["exceptionDetails"].get("text"))[:160]
            )
        return result.get("result", {}).get("value")

    def js(self, body: str) -> Any:
        """Evaluate a block and return its value, never leaking a stack trace."""

        return self.raw("(() => {" + body + "})()")

    def key(self, key: str, code: str, vk: int, *, modifiers: int = 0) -> None:
        for phase in ("keyDown", "keyUp"):
            self.call(
                "Input.dispatchKeyEvent",
                {
                    "type": phase,
                    "key": key,
                    "code": code,
                    "windowsVirtualKeyCode": vk,
                    "nativeVirtualKeyCode": vk,
                    "modifiers": modifiers,
                },
            )
        time.sleep(0.03)

    def type(self, text: str) -> None:
        self.call("Input.insertText", {"text": text})
        time.sleep(0.05)

    def close(self) -> None:
        try:
            self.socket.close()
        finally:
            try:
                self.process.terminate()
                self.process.wait(timeout=10)
            except Exception:
                self.process.kill()
            shutil.rmtree(self.profile, ignore_errors=True)


# ---------------------------------------------------------------------------
# The browser arm. One page load per concern, every assertion read back from the
# DOM the engine computed rather than from the served bytes.
# ---------------------------------------------------------------------------
COMBOBOX_PROBE = """
  const input = document.querySelector('[data-nav-search]');
  if (!input) return { error: 'no element carries data-nav-search' };
  const controls = input.getAttribute('aria-controls');
  const listbox = controls ? document.getElementById(controls) : null;
  const live = Array.from(document.querySelectorAll('[aria-live="polite"]'));
  return {
    role: input.getAttribute('role'),
    expanded: input.getAttribute('aria-expanded'),
    controls: controls,
    hasActiveDescendantAttribute: input.hasAttribute('aria-activedescendant'),
    listboxRole: listbox ? listbox.getAttribute('role') : null,
    liveRegions: live.length,
    liveText: live.map((node) => node.textContent.trim()).join(' | '),
    autocomplete: input.getAttribute('aria-autocomplete')
  };
"""

LISTBOX_PROBE = """
  const input = document.querySelector('[data-nav-search]');
  if (!input) return { error: 'no element carries data-nav-search' };
  const controls = input.getAttribute('aria-controls');
  const listbox = controls ? document.getElementById(controls) : null;
  const options = listbox ? Array.from(listbox.querySelectorAll('[role="option"]')) : [];
  const live = Array.from(document.querySelectorAll('[aria-live="polite"]'))
    .map((node) => node.textContent.trim()).filter(Boolean).join(' | ');
  return {
    expanded: input.getAttribute('aria-expanded'),
    active: input.getAttribute('aria-activedescendant') || '',
    focused: document.activeElement === input,
    focusedId: document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : '',
    count: options.length,
    ids: options.map((option) => option.id),
    selected: options.map((option) => option.getAttribute('aria-selected')),
    texts: options.map((option) => option.textContent.replace(/\\s+/g, ' ').trim()),
    live: live,
    hash: location.hash
  };
"""

HEADING_PROBE = """
  return Array.from(document.querySelectorAll('h2, h3, h4, h5, h6')).map((heading) => ({
    text: heading.textContent.replace(/\\s+/g, ' ').replace(/^§\\s*/, '').trim(),
    hidden: heading.hidden,
    rows: heading.hidden === undefined ? -1 : 0
  }));
"""

FILTER_PROBE = """
  const scope = document.querySelector('fieldset[data-filter-controls]');
  const rows = Array.from(document.querySelectorAll('[data-filter-row]'));
  const shown = rows.filter((row) => !row.hidden && row.getClientRects().length > 0);
  const status = document.querySelector('[data-filter-status]');
  return {
    fieldsets: document.querySelectorAll('fieldset[data-filter-controls]').length,
    legend: scope ? !!scope.querySelector('legend') : false,
    selects: scope ? scope.querySelectorAll('select').length : 0,
    checkboxes: scope ? scope.querySelectorAll('input[type="checkbox"]').length : 0,
    labelled: scope
      ? Array.from(scope.querySelectorAll('input[type="checkbox"], select')).every((control) =>
          (control.labels && control.labels.length > 0) || control.getAttribute('aria-label'))
      : false,
    rows: rows.length,
    shown: shown.length,
    statusLive: status ? status.getAttribute('aria-live') : null,
    statusText: status ? status.textContent.replace(/\\s+/g, ' ').trim() : ''
  };
"""


def run_browser_checks(binary: str, docs: Path) -> None:
    browser = Browser(binary)
    try:
        files_url = (docs / "files.html").as_uri()

        def combobox_contract() -> str | None:
            browser.scripts(enabled=True)
            browser.open(files_url)
            probe = browser.js(COMBOBOX_PROBE)
            if not isinstance(probe, dict) or probe.get("error"):
                return str((probe or {}).get("error", "the page returned no probe"))
            if probe.get("role") != "combobox":
                return f"the search control's role is {probe.get('role')!r}, not combobox"
            if probe.get("expanded") != "false":
                return (
                    "aria-expanded is"
                    f" {probe.get('expanded')!r} on a closed list, not \"false\""
                )
            if not probe.get("controls"):
                return "the combobox carries no aria-controls"
            if probe.get("listboxRole") != "listbox":
                return (
                    "aria-controls points at an element whose role is"
                    f" {probe.get('listboxRole')!r}, not listbox"
                )
            if not probe.get("hasActiveDescendantAttribute"):
                return "the combobox exposes no aria-activedescendant"
            if probe.get("autocomplete") != "list":
                return (
                    "the combobox does not declare aria-autocomplete=\"list\"; it"
                    f" declares {probe.get('autocomplete')!r}"
                )
            if not probe.get("liveRegions"):
                return "no aria-live=\"polite\" region is present"
            return None

        check("the search control is a combobox with a polite live region", combobox_contract)

        def command_k_focuses() -> str | None:
            browser.js("document.querySelector('[data-theme-toggle]').focus(); return 1;")
            before = browser.raw(
                "document.activeElement && document.activeElement.dataset"
                " && 'themeToggle' in document.activeElement.dataset"
            )
            if not before:
                return "the probe could not place focus outside the search control"
            browser.key("k", "KeyK", 75, modifiers=Browser.META)
            probe = browser.js(LISTBOX_PROBE)
            if not probe.get("focused"):
                return f"⌘K left focus on {probe.get('focusedId')!r}"
            if probe.get("expanded") != "false":
                return "the list is expanded before anything was typed"
            return None

        check("⌘K moves focus to the search control", command_k_focuses)

        def typing_opens_the_list() -> str | None:
            browser.type("src/a")
            probe = browser.js(LISTBOX_PROBE)
            if probe.get("expanded") != "true":
                return "aria-expanded stayed false after a query with matches"
            if int(probe.get("count") or 0) < 2:
                return (
                    f"the listbox carries {probe.get('count')} option(s) for a query the"
                    " index answers with several"
                )
            if not any(
                "a.b.ts" in text or "a-b.ts" in text for text in probe.get("texts") or []
            ):
                return (
                    "no option names a ledger path; the list reads"
                    f" {(probe.get('texts') or [])[:4]!r}"
                )
            if not re.search(r"\d", probe.get("live") or ""):
                return (
                    "the live region announces no result count; it reads"
                    f" {probe.get('live')!r}"
                )
            if probe.get("active"):
                return (
                    "an option is active before any arrow key was pressed:"
                    f" {probe.get('active')!r}"
                )
            if any(value == "true" for value in probe.get("selected") or []):
                return "an option reports aria-selected=true before any arrow key"
            return None

        check("typing opens a listbox of options and announces the count", typing_opens_the_list)

        def arrows_move_the_active_option() -> str | None:
            browser.key("ArrowDown", "ArrowDown", 40)
            first = browser.js(LISTBOX_PROBE)
            ids = first.get("ids") or []
            if len(ids) < 2:
                return "fewer than two options are available to move between"
            if first.get("active") != ids[0]:
                return (
                    f"ArrowDown set aria-activedescendant to {first.get('active')!r},"
                    f" not to the first option {ids[0]!r}"
                )
            selected = first.get("selected") or []
            if selected[:1] != ["true"] or any(value == "true" for value in selected[1:]):
                return f"aria-selected does not follow the active option: {selected!r}"
            browser.key("ArrowDown", "ArrowDown", 40)
            second = browser.js(LISTBOX_PROBE)
            if second.get("active") != ids[1]:
                return (
                    "a second ArrowDown left the active option at"
                    f" {second.get('active')!r}"
                )
            browser.key("ArrowUp", "ArrowUp", 38)
            back = browser.js(LISTBOX_PROBE)
            if back.get("active") != ids[0]:
                return f"ArrowUp left the active option at {back.get('active')!r}"
            return None

        check("arrow keys move the active option and its aria-selected", arrows_move_the_active_option)

        def escape_closes_and_restores_focus() -> str | None:
            browser.key("Escape", "Escape", 27)
            probe = browser.js(LISTBOX_PROBE)
            if probe.get("expanded") != "false":
                return "Escape left aria-expanded true"
            if int(probe.get("count") or 0) != 0:
                return f"Escape left {probe.get('count')} option(s) in the listbox"
            if probe.get("active"):
                return f"Escape left aria-activedescendant at {probe.get('active')!r}"
            restored = browser.raw(
                "document.activeElement && document.activeElement.dataset"
                " && 'themeToggle' in document.activeElement.dataset"
            )
            if not restored:
                return (
                    "Escape did not restore focus to the element focused before the"
                    f" search; focus is on {probe.get('focusedId')!r}"
                )
            return None

        check("Escape closes the list and restores the prior focus", escape_closes_and_restores_focus)

        def enter_activates_and_moves_focus() -> str | None:
            browser.open(files_url)
            browser.key("k", "KeyK", 75, modifiers=Browser.META)
            browser.type("a.b.ts")
            opened = browser.js(LISTBOX_PROBE)
            if int(opened.get("count") or 0) != 1:
                return (
                    f"the query matched {opened.get('count')} options; the fixture makes"
                    " it unique so activation is unambiguous"
                )
            browser.key("ArrowDown", "ArrowDown", 40)
            browser.key("Enter", "Enter", 13)
            time.sleep(0.15)
            anchor = expected_anchor("src/a.b.ts")
            after = browser.js(
                "return { hash: location.hash, focus: document.activeElement"
                " ? document.activeElement.id : '' };"
            )
            if (after or {}).get("hash") != f"#{anchor}":
                return (
                    f"Enter left the fragment at {(after or {}).get('hash')!r}, not"
                    f" #{anchor}"
                )
            if (after or {}).get("focus") != anchor:
                return (
                    "Enter did not move focus to the target; the focused element is"
                    f" {(after or {}).get('focus')!r}"
                )
            return None

        check("Enter activates the active option and moves focus to its target", enter_activates_and_moves_focus)

        def findings_filters() -> str | None:
            browser.open((docs / "findings.html").as_uri())
            probe = browser.js(FILTER_PROBE)
            if int(probe.get("fieldsets") or 0) != 1:
                return f"the page carries {probe.get('fieldsets')} filter fieldsets, not one"
            if not probe.get("legend"):
                return "the filter fieldset carries no legend"
            if int(probe.get("selects") or 0) < 1:
                return "no <select> narrows by subsystem"
            if int(probe.get("checkboxes") or 0) < 2:
                return f"only {probe.get('checkboxes')} severity checkbox(es) are offered"
            if not probe.get("labelled"):
                return "a filter control carries no accessible name"
            if int(probe.get("rows") or 0) != OPEN_RECORDS:
                return (
                    f"{probe.get('rows')} filterable records are present, not"
                    f" {OPEN_RECORDS}"
                )
            if int(probe.get("shown") or 0) != OPEN_RECORDS:
                return "the page does not open with every record visible"
            if probe.get("statusLive") != "polite":
                return f"the filter status region is aria-live={probe.get('statusLive')!r}"
            severity = browser.js(
                """
                const boxes = Array.from(document.querySelectorAll(
                  'fieldset[data-filter-controls] input[type="checkbox"]'));
                const target = boxes.find((box) => /critical/i.test(box.value || ''));
                if (!target) return { error: 'no checkbox carries a critical severity value' };
                target.click();
                return { ok: true };
                """
            )
            if (severity or {}).get("error"):
                return str(severity["error"])
            after = browser.js(FILTER_PROBE)
            expected = OPEN_RECORDS - CRITICAL_RECORDS
            if int(after.get("shown") or 0) != expected:
                return (
                    f"unchecking one severity left {after.get('shown')} records visible,"
                    f" not {expected}"
                )
            if f"{expected} of {OPEN_RECORDS}" not in (after.get("statusText") or ""):
                return (
                    "the live region does not announce"
                    f" \"{expected} of {OPEN_RECORDS} rows shown\"; it reads"
                    f" {after.get('statusText')!r}"
                )
            headings = browser.js(HEADING_PROBE) or []
            emptied = [
                heading
                for heading in headings
                if re.match(r"critical findings$", heading.get("text", ""), re.IGNORECASE)
            ]
            if not emptied:
                return "the page carries no severity heading to fold"
            if not all(heading.get("hidden") for heading in emptied):
                return (
                    "a severity group whose every record is filtered out is still"
                    " announced as a group with records in it"
                )
            kept = [
                heading
                for heading in headings
                if heading.get("text", "").strip().lower() == "open"
            ]
            if kept and any(heading.get("hidden") for heading in kept):
                return (
                    "the resolution-state heading folded while records under it are"
                    " still shown"
                )
            restored = browser.js(
                """
                const boxes = Array.from(document.querySelectorAll(
                  'fieldset[data-filter-controls] input[type="checkbox"]'));
                boxes.filter((box) => !box.checked).forEach((box) => box.click());
                const select = document.querySelector(
                  'fieldset[data-filter-controls] select');
                const option = Array.from(select.options).find(
                  (candidate) => /read path/i.test(candidate.textContent));
                if (!option) return { error: 'no option names the Read path subsystem' };
                select.value = option.value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                return { ok: true };
                """
            )
            if (restored or {}).get("error"):
                return str(restored["error"])
            narrowed = browser.js(FILTER_PROBE)
            if int(narrowed.get("shown") or 0) != READ_PATH_RECORDS:
                return (
                    f"narrowing to one subsystem left {narrowed.get('shown')} records"
                    f" visible, not {READ_PATH_RECORDS}"
                )
            return None

        check("the findings filters narrow the page and announce the count", findings_filters)

        def hot_spot_filters() -> str | None:
            browser.open((docs / "hot-spots.html").as_uri())
            probe = browser.js(FILTER_PROBE)
            if int(probe.get("fieldsets") or 0) != 1:
                return f"the page carries {probe.get('fieldsets')} filter fieldsets, not one"
            if int(probe.get("rows") or 0) != HOT_SPOT_ROWS:
                return (
                    f"{probe.get('rows')} filterable rows are present, not"
                    f" {HOT_SPOT_ROWS}"
                )
            picked = browser.js(
                """
                const select = document.querySelector(
                  'fieldset[data-filter-controls] select');
                if (!select) return { error: 'no <select> narrows by subsystem' };
                const option = Array.from(select.options).find(
                  (candidate) => /read path/i.test(candidate.textContent));
                if (!option) return { error: 'no option names the Read path subsystem' };
                select.value = option.value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                return { ok: true };
                """
            )
            if (picked or {}).get("error"):
                return str(picked["error"])
            after = browser.js(FILTER_PROBE)
            if int(after.get("shown") or 0) != 1:
                return (
                    f"narrowing to one subsystem left {after.get('shown')} rows visible,"
                    " not 1"
                )
            if f"1 of {HOT_SPOT_ROWS}" not in (after.get("statusText") or ""):
                return (
                    f"the live region does not announce \"1 of {HOT_SPOT_ROWS} rows"
                    f" shown\"; it reads {after.get('statusText')!r}"
                )
            headings = browser.js(HEADING_PROBE) or []
            prose = [
                heading
                for heading in headings
                if "each column measures" in heading.get("text", "").lower()
            ]
            if not prose:
                return "the page carries no prose heading to check against folding"
            if any(heading.get("hidden") for heading in prose):
                return (
                    "a heading with no filterable row under it was folded away; the"
                    " filter hid prose the reader still needs to read the columns"
                )
            return None

        check("the hot-spot filters narrow the table and announce the count", hot_spot_filters)

        def no_script_path() -> str | None:
            browser.scripts(enabled=False)
            for page, rows_expected in (
                ("files.html", 0),
                ("findings.html", OPEN_RECORDS),
                ("hot-spots.html", HOT_SPOT_ROWS),
                ("index.html", 0),
            ):
                browser.open((docs / page).as_uri())
                probe = browser.js(
                    """
                    const rows = Array.from(document.querySelectorAll('[data-filter-row]'));
                    return {
                      title: document.title,
                      links: document.querySelectorAll('.nav-rail a').length,
                      listboxes: document.querySelectorAll('[role="listbox"]').length,
                      fieldsets: document.querySelectorAll('fieldset[data-filter-controls]').length,
                      rows: rows.length,
                      visible: rows.filter((row) => !row.hidden
                        && row.getClientRects().length > 0).length,
                      hidden: document.querySelectorAll('[hidden]').length
                    };
                    """
                )
                if not probe or not probe.get("title"):
                    return f"{page} did not render without script"
                if int(probe.get("links") or 0) < len(SUBSYSTEMS):
                    return (
                        f"{page} lists {probe.get('links')} navigation links without"
                        " script"
                    )
                if int(probe.get("listboxes") or 0):
                    return f"{page} serves a listbox that only script can populate"
                if int(probe.get("fieldsets") or 0):
                    return f"{page} serves a filter control that cannot work without script"
                if int(probe.get("rows") or 0) != rows_expected:
                    return (
                        f"{page} serves {probe.get('rows')} filterable rows without"
                        f" script, not {rows_expected}"
                    )
                if int(probe.get("visible") or 0) != rows_expected:
                    return (
                        f"{page} hides {rows_expected - int(probe.get('visible') or 0)}"
                        " row(s) that no script will reveal"
                    )
                if int(probe.get("hidden") or 0):
                    return (
                        f"{page} serves {probe.get('hidden')} element(s) marked hidden,"
                        " which script would have to reveal"
                    )
            browser.open((docs / "files.html").as_uri())
            missing = browser.js(
                "return "
                + json.dumps(sorted(expected_anchor(path) for path in LEDGER_PATHS))
                + ".filter((id) => !document.getElementById(id));"
            )
            if missing:
                return (
                    f"{len(missing)} file anchor(s) are unreachable without script;"
                    f" first {missing[0]!r}"
                )
            focusable = browser.js(
                "const a = document.getElementById("
                + json.dumps(expected_anchor(COLLIDING_PATHS[2]))
                + "); return a ? a.getBoundingClientRect().top >= 0 : null;"
            )
            if focusable is None:
                return "the colliding path's anchor is absent from the no-script page"
            return None

        check("every page, anchor, and row is reachable with script disabled", no_script_path)
    finally:
        browser.close()


# ---------------------------------------------------------------------------
def main() -> int:
    emit("P10 — locus search index and accessible interface enhancement")
    emit("")

    root = Path(tempfile.mkdtemp(prefix="amanuensis-p10-"))
    storage = root / "store"
    storage.mkdir(parents=True)
    docs = storage / "docs"
    clean = root / "clean-docs"
    index_path = docs / INDEX_FILE
    browser_binary = find_browser()

    try:
        seed(storage)
        summary = publish(storage)

        def publish_is_green() -> str | None:
            if not summary.get("ok"):
                warnings = summary.get("warnings") or []
                return (
                    "the materializer refused to publish the fixture:"
                    f" {scrub(warnings[0])[:200] if warnings else scrub(summary)[:200]}"
                )
            return None

        check("the fixture publishes with every read-back axis green", publish_is_green)

        index_text = read(index_path) or ""
        parsed: dict[str, Any] = {}

        def index_is_written() -> str | None:
            if not index_text:
                return (
                    f"the search-index artifact {INDEX_FILE} was not written into the"
                    " projection"
                )
            try:
                loaded = parse_index(index_text)
            except Exception as exc:
                return f"the search-index artifact is unreadable — {scrub(exc)[:160]}"
            if not isinstance(loaded.get("paths"), list) or not isinstance(
                loaded.get("symbols"), list
            ):
                return (
                    "the search-index assignment carries no paths/symbols arrays;"
                    f" its keys are {sorted(loaded)!r}"
                )
            parsed.update(loaded)
            return None

        check("the materializer writes a parseable search-index artifact", index_is_written)

        def paths_exactly_once() -> str | None:
            entries = parsed.get("paths") or []
            if not entries:
                return "the search-index carries no path entries"
            seen: dict[str, int] = {}
            for entry in entries:
                seen[str(entry.get("p"))] = seen.get(str(entry.get("p")), 0) + 1
            missing = [path for path in OBLIGATION_PATHS if path not in seen]
            if missing:
                return (
                    f"{len(missing)} obligation-bearing ledger path(s) are absent from"
                    f" the search-index; first {missing[0]!r}"
                )
            duplicated = sorted(path for path, count in seen.items() if count != 1)
            if duplicated:
                return (
                    f"{len(duplicated)} path(s) appear more than once in the"
                    f" search-index; first {duplicated[0]!r}"
                )
            unknown = sorted(set(seen) - set(LEDGER_PATHS))
            if unknown:
                return (
                    "the search-index carries a path no ledger row names:"
                    f" {unknown[0]!r}"
                )
            return None

        check("every obligation-bearing ledger path is indexed exactly once", paths_exactly_once)

        def path_entries_carry_owners_standing_and_anchor() -> str | None:
            by_path = {str(entry.get("p")): entry for entry in parsed.get("paths") or []}
            if not by_path:
                return "the search-index carries no path entries"
            for path in LEDGER_PATHS:
                entry = by_path.get(path)
                if entry is None:
                    return f"{path!r} is absent from the search-index"
                owners = entry.get("o")
                if sorted(owners or []) != sorted(OWNERS_OF[path]):
                    return (
                        f"{path!r} records owners {owners!r}; the ledger gives"
                        f" {sorted(OWNERS_OF[path])!r}"
                    )
                if entry.get("s") != EXPECTED_STANDING[path]:
                    return (
                        f"{path!r} carries standing {entry.get('s')!r}; the declared"
                        f" table gives {EXPECTED_STANDING[path]!r}"
                    )
                expected = f"files.html#{expected_anchor(path)}"
                if entry.get("h") != expected:
                    return (
                        f"{path!r} links to {entry.get('h')!r}, not to its Files anchor"
                        f" {expected!r}"
                    )
            return None

        check("each indexed path carries its owners, standing, and Files anchor", path_entries_carry_owners_standing_and_anchor)

        def symbols_at_least_once() -> str | None:
            entries = parsed.get("symbols") or []
            pairs = {(str(entry.get("y")), str(entry.get("p"))) for entry in entries}
            for path, symbol in CITED_SYMBOLS:
                if (symbol, path) not in pairs:
                    return (
                        f"the cited symbol {symbol!r} in {path!r} is absent from the"
                        " search-index"
                    )
            empty = [entry for entry in entries if not str(entry.get("y") or "").strip()]
            if empty:
                return (
                    f"{len(empty)} symbol entr(ies) carry no symbol; an evidence row"
                    " with a null symbol must contribute none"
                )
            for entry in entries:
                if not str(entry.get("h") or "").strip():
                    return f"the symbol entry {entry.get('y')!r} carries no anchor"
            return None

        check("every cited symbol is indexed at least once", symbols_at_least_once)

        def custody_records_the_index() -> str | None:
            contract = read(docs / ".projection-contract.json")
            manifest = read(docs / ".manifest.json")
            if contract is None or manifest is None:
                return "the publication receipt or the manifest is unreadable"
            try:
                receipt = json.loads(contract)
                custody = json.loads(manifest)
            except json.JSONDecodeError as exc:
                return f"custody records are not valid JSON — {scrub(exc)[:120]}"
            pages = {
                str(page.get("path")): str(page.get("content_hash"))
                for page in receipt.get("pages", [])
            }
            if INDEX_FILE not in pages:
                return f"{INDEX_FILE} is absent from .projection-contract.json's pages"
            digest = sha256((index_text or "").encode("utf-8")).hexdigest()
            if pages[INDEX_FILE] != digest:
                return "the receipt's hash for the search-index is not the file's bytes"
            projection = {
                str(item.get("path")) for item in custody.get("projection_files", [])
            }
            if INDEX_FILE not in projection:
                return f"{INDEX_FILE} is absent from manifest.projection_files"
            return None

        check("the receipt and the manifest both record the search-index", custody_records_the_index)

        def every_page_references_the_index() -> str | None:
            pages = sorted(path for path in docs.rglob("*.html") if path.is_file())
            if not pages:
                return "the projection carries no HTML page"
            for page in pages:
                parser = _Ids()
                parser.feed(read(page) or "")
                resolved = [
                    (page.parent / src).resolve()
                    for src in parser.script_srcs
                    if not EXTERNAL.match(src)
                ]
                if index_path.resolve() not in resolved:
                    return (
                        f"{page.relative_to(docs)} does not reference {INDEX_FILE}"
                        " with a relative script src"
                    )
            return None

        check("every page loads the index with a relative script src", every_page_references_the_index)

        def no_external_host() -> str | None:
            for page in sorted(docs.rglob("*.html")):
                text = read(page) or ""
                parser = _Ids()
                parser.feed(text)
                for src in parser.script_srcs + parser.resource_srcs:
                    if EXTERNAL.match(src.strip()):
                        return (
                            f"{page.relative_to(docs)} loads {src.strip()[:80]!r} from"
                            " another host"
                        )
                for url in re.findall(r"url\(\s*['\"]?([^'\")]+)", text):
                    if EXTERNAL.match(url.strip()) and not url.strip().startswith("data:"):
                        return f"{page.relative_to(docs)} fetches {url.strip()[:80]!r} in CSS"
                if "@import" in text:
                    return f"{page.relative_to(docs)} carries a CSS @import"
                for call in NETWORK_CALLS:
                    if call in text:
                        return f"{page.relative_to(docs)} reaches the network with {call!r}"
            for script in sorted(docs.rglob("*.js")):
                text = read(script) or ""
                for call in NETWORK_CALLS:
                    if call in text:
                        return (
                            f"{script.relative_to(docs)} reaches the network with"
                            f" {call!r}"
                        )
                if re.search(r"https?://", text):
                    return f"{script.relative_to(docs)} names an external host"
            return None

        check("the projection references no external host and makes no request", no_external_host)

        def anchors_survive_collision() -> str | None:
            parser = _Ids()
            parser.feed(read(docs / "files.html") or "")
            anchors = {path: expected_anchor(path) for path in COLLIDING_PATHS}
            if len(set(anchors.values())) != len(COLLIDING_PATHS):
                return "the declared anchors are not distinct; the gate's own table is wrong"
            missing = [path for path, anchor in anchors.items() if anchor not in parser.ids]
            if missing:
                return (
                    f"{len(missing)} colliding path(s) have no anchor on files.html;"
                    f" first {missing[0]!r}"
                )
            absent = [
                path
                for path in LEDGER_PATHS
                if expected_anchor(path) not in parser.ids
            ]
            if absent:
                return (
                    f"{len(absent)} ledger path(s) carry no anchor in the served"
                    f" files.html; first {absent[0]!r}"
                )
            return None

        check("every file anchor is in the served files.html bytes", anchors_survive_collision)

        def served_bytes_hide_nothing() -> str | None:
            for page in ("findings.html", "hot-spots.html"):
                parser = _Ids()
                parser.feed(read(docs / page) or "")
                if parser.hidden:
                    return (
                        f"{page} serves {len(parser.hidden)} filterable row(s) marked"
                        f" hidden; first {parser.hidden[0]!r}"
                    )
                if not parser.filter_rows:
                    return f"{page} marks no row as filterable"
                if parser.fieldsets:
                    return (
                        f"{page} serves {parser.fieldsets} fieldset(s); the filters are"
                        " a script enhancement and must be absent without it"
                    )
            return None

        check("no filterable row or filter control is in the served bytes", served_bytes_hide_nothing)

        # -- Sabotage: the read-back axes must turn red -----------------------
        def removing_a_path_turns_state_red() -> str | None:
            if not parsed.get("paths"):
                return "there is no index to sabotage"
            victim = OBLIGATION_PATHS[0]
            kept = [
                entry for entry in parsed["paths"] if str(entry.get("p")) != victim
            ]
            if len(kept) == len(parsed["paths"]):
                return f"the fixture path {victim!r} was not in the index to remove"
            index_path.write_text(
                "window.__amanuensisLocusIndex = "
                + json.dumps({**parsed, "paths": kept})
                + ";\n"
            )
            verified = publish(storage, "--readback-only")
            state = axis_ok(verified, "state")
            if state is None:
                return "the read-back summary reports no state axis"
            if state:
                return (
                    f"removing {victim!r} from the index left the state axis green"
                )
            return None

        check("removing one indexed path turns the state axis red", removing_a_path_turns_state_red)

        def removing_a_symbol_turns_state_red() -> str | None:
            if not parsed.get("symbols"):
                return "there is no index to sabotage"
            kept = parsed["symbols"][1:]
            index_path.write_text(
                "window.__amanuensisLocusIndex = "
                + json.dumps({**parsed, "symbols": kept})
                + ";\n"
            )
            verified = publish(storage, "--readback-only")
            state = axis_ok(verified, "state")
            if state is None:
                return "the read-back summary reports no state axis"
            if state:
                return "removing one cited symbol from the index left the state axis green"
            return None

        check("removing one cited symbol turns the state axis red", removing_a_symbol_turns_state_red)

        def duplicating_a_path_turns_state_red() -> str | None:
            if not parsed.get("paths"):
                return "there is no index to sabotage"
            victim = OBLIGATION_PATHS[0]
            twice = [
                entry
                for entry in parsed["paths"]
                for _ in range(2 if str(entry.get("p")) == victim else 1)
            ]
            if len(twice) != len(parsed["paths"]) + 1:
                return f"the fixture path {victim!r} was not in the index to duplicate"
            index_path.write_text(
                "window.__amanuensisLocusIndex = "
                + json.dumps({**parsed, "paths": twice})
                + ";\n"
            )
            verified = publish(storage, "--readback-only")
            state = axis_ok(verified, "state")
            if state is None:
                return "the read-back summary reports no state axis"
            if state:
                return (
                    f"indexing {victim!r} twice left the state axis green; a reader"
                    " gets two results for one file and no way to tell them apart"
                )
            return None

        check("indexing one path twice turns the state axis red", duplicating_a_path_turns_state_red)

        def deleting_the_index_turns_coverage_red() -> str | None:
            if index_path.is_file():
                index_path.unlink()
            verified = publish(storage, "--readback-only")
            coverage = axis_ok(verified, "coverage")
            if coverage is None:
                return "the read-back summary reports no coverage axis"
            if coverage:
                return (
                    f"deleting {INDEX_FILE} left the coverage axis green; the inventory"
                    " does not see it"
                )
            return None

        check("deleting the index turns the coverage axis red", deleting_the_index_turns_coverage_red)

        def republishing_restores_green() -> str | None:
            restored = publish(storage, "--force-full")
            if not restored.get("ok"):
                warnings = restored.get("warnings") or []
                return (
                    "republishing did not restore a green projection:"
                    f" {scrub(warnings[0])[:200] if warnings else scrub(restored)[:200]}"
                )
            if not index_path.is_file():
                return f"republishing did not rewrite {INDEX_FILE}"
            verified = publish(storage, "--readback-only")
            if not verified.get("ok"):
                return "the restored projection does not read back green"
            return None

        check("republishing restores the index and a green read-back", republishing_restores_green)

        def dropping_the_index_from_the_receipt_turns_content_red() -> str | None:
            """The receipt is the content axis's own list of what to hash.

            Every other sabotage here changes a file the receipt names. This
            one changes the receipt: the file stays on disk, byte-identical,
            and only its row is removed. A content axis that iterates the
            receipt and hashes what it finds cannot see that — it hashes a
            shorter list and reports agreement — so the receipt becomes a
            place to hide a page from custody (C41).
            """
            receipt_path = docs / ".projection-contract.json"
            original = read(receipt_path)
            if original is None:
                return "the publication receipt is unreadable"
            try:
                receipt = json.loads(original)
            except json.JSONDecodeError as exc:
                return f"the publication receipt is not valid JSON — {scrub(exc)[:120]}"
            kept = [
                page for page in receipt.get("pages", []) if str(page.get("path")) != INDEX_FILE
            ]
            if len(kept) == len(receipt.get("pages", [])):
                return f"{INDEX_FILE} was not in the receipt to begin with"
            receipt["pages"] = kept
            receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
            try:
                if not index_path.is_file():
                    return f"{INDEX_FILE} was removed from disk as well as from the receipt"
                verified = publish(storage, "--readback-only")
                content = axis_ok(verified, "content")
                if content is None:
                    return "the read-back summary reports no content axis"
                if content:
                    return (
                        f"removing {INDEX_FILE} from the receipt left the content axis"
                        " green; the receipt is checked against itself, so a page can be"
                        " dropped from custody without read-back noticing"
                    )
                if verified.get("ok"):
                    return "read-back reported verified with a page missing from the receipt"
                return None
            finally:
                receipt_path.write_text(original)

        check(
            "dropping a page from the receipt turns the content axis red",
            dropping_the_index_from_the_receipt_turns_content_red,
        )

        def clean_publish_is_green() -> str | None:
            published = publish(storage, "--clean-publish", "--output", str(clean))
            if not published.get("ok") or not published.get("published"):
                warnings = published.get("warnings") or []
                return (
                    "the clean publish was refused:"
                    f" {scrub(warnings[0])[:200] if warnings else scrub(published)[:200]}"
                )
            if not (clean / INDEX_FILE).is_file():
                return f"the clean publish did not carry {INDEX_FILE}"
            (clean / INDEX_FILE).unlink()
            verified = publish(storage, "--readback-only", "--output", str(clean))
            coverage = axis_ok(verified, "coverage")
            if coverage is None:
                return "the read-back summary reports no coverage axis"
            if coverage:
                return (
                    "removing the index from a clean publish left the coverage axis"
                    " green"
                )
            return None

        check("a clean publish carries the index, and removing it turns coverage red", clean_publish_is_green)

        # -- The browser arm -------------------------------------------------
        if browser_binary is None:
            FAILURES.append(
                "the behavioural arm could not run: no Chromium-family browser is"
                " available, so keyboard operation, the live region, and the"
                " no-script path are unverified"
            )
            emit(
                "  FAIL the behavioural arm ran: no Chromium-family browser is available"
                " — set AMANUENSIS_TEST_BROWSER to one"
            )
        else:
            try:
                run_browser_checks(browser_binary, docs)
            except Exception as exc:
                FAILURES.append(f"the browser arm aborted — {scrub(exc)[:200]}")
                emit(f"  FAIL the browser arm ran: {scrub(exc)[:200]}")
    finally:
        shutil.rmtree(root, ignore_errors=True)

    def runs_in_ci() -> str | None:
        text = read(CI_FILE)
        if text is None:
            return "the CI workflow .github/workflows/test.yml is not readable"
        if "test-search-index.py" not in text:
            return "the workflow does not run test-search-index.py"
        return None

    check("the gate runs in CI", runs_in_ci)

    emit("")
    if FAILURES:
        emit(
            "GATE P10 RED: the generated search-index and the accessible search"
            f" enhancement do not hold — {len(FAILURES)} assertion(s) failed; first:"
            f" {FAILURES[0]}"
        )
        return 1
    emit("GATE P10 GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
