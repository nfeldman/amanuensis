"""Where do a survey session's tokens go? Classify tool-result bytes by tool, and sum usage.

usage: python3 -I transcripts.py <file.jsonl>...
Prints one JSON line per transcript plus a total.
"""
import json
import re
import sys
from collections import defaultdict

READ_BASH = re.compile(r"^\s*(cat|bat|sed\s+-n|head|tail|nl|less|awk)\b|\|\s*(sed\s+-n|head|tail)\b")
SEARCH_BASH = re.compile(r"^\s*(rg|grep|fd|find|ag|git\s+grep)\b")


def cat_for(name, inp):
    if name == "Read":
        return "read"
    if name in ("Grep", "Glob"):
        return "search"
    if name == "Bash":
        cmd = inp.get("command", "")
        if re.search(r"cat\s*>>?|<<\s*'?EOF|tee\s", cmd):
            return "bash-write"
        if re.search(r"sqlite3|materializ|amanuensis", cmd):
            return "bash-tooling"
        # Classify by the last command of a chain (`cd x && sed -n ...`), the one whose output
        # the agent reads.
        last = re.split(r"&&|;|\n", cmd.strip())[-1]
        if SEARCH_BASH.search(last):
            return "search"
        if READ_BASH.search(last):
            return "read"
        if re.search(r"\bgit\s+(show|diff|log)\b", cmd):
            return "git"
        return "bash-other"
    if name.startswith("mcp__amanuensis"):
        short = name.split("__")[-1]
        if short.startswith(("get_", "describe_", "list_", "lookup_")):
            return "amanuensis-read"
        return "amanuensis-write"
    if name in ("Agent", "Task"):
        return "subagent"
    return "other"


def size_of(content):
    if isinstance(content, str):
        return len(content.encode())
    if isinstance(content, list):
        n = 0
        for c in content:
            if isinstance(c, dict) and c.get("type") == "text":
                n += len(c.get("text", "").encode())
            elif isinstance(c, dict):
                n += len(json.dumps(c).encode()) // 4  # images etc: rough
        return n
    return 0


def analyze(path):
    pending = {}
    bytes_by = defaultdict(int)
    calls_by = defaultdict(int)
    usage = defaultdict(int)
    seen_msg = set()
    turns = 0
    timeline = []
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            try:
                ev = json.loads(line)
            except ValueError:
                continue
            msg = ev.get("message") or {}
            if ev.get("type") == "assistant":
                mid = msg.get("id")
                u = msg.get("usage") or {}
                if mid and mid not in seen_msg and u:
                    seen_msg.add(mid)
                    turns += 1
                    for k in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"):
                        usage[k] += u.get(k) or 0
                for c in msg.get("content") or []:
                    if isinstance(c, dict) and c.get("type") == "tool_use":
                        pending[c["id"]] = cat_for(c.get("name", ""), c.get("input") or {})
            elif ev.get("type") == "user":
                for c in msg.get("content") or [] if isinstance(msg.get("content"), list) else []:
                    if isinstance(c, dict) and c.get("type") == "tool_result":
                        cat = pending.pop(c.get("tool_use_id"), "unknown")
                        n = size_of(c.get("content"))
                        bytes_by[cat] += n
                        timeline.append((turns, cat, n))
                        calls_by[cat] += 1
    weighted = defaultdict(int)
    for t, cat, n in timeline:
        weighted[cat] += n * max(1, turns - t)
    return {"weighted": dict(weighted), "file": path, "turns": turns, "usage": dict(usage), "bytes": dict(bytes_by), "calls": dict(calls_by)}


if __name__ == "__main__":
    tot_b, tot_c, tot_u, tot_w = defaultdict(int), defaultdict(int), defaultdict(int), defaultdict(int)
    for p in sys.argv[1:]:
        r = analyze(p)
        print(json.dumps(r))
        for k, v in r["bytes"].items():
            tot_b[k] += v
        for k, v in r["weighted"].items():
            tot_w[k] += v
        for k, v in r["calls"].items():
            tot_c[k] += v
        for k, v in r["usage"].items():
            tot_u[k] += v
    print(json.dumps({"TOTAL": True, "bytes": dict(tot_b), "calls": dict(tot_c), "usage": dict(tot_u), "weighted": dict(tot_w), "n": len(sys.argv) - 1}))
