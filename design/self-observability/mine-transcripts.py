# Baseline instrument for design/self-observability/README.md section 3.
# Usage: python3 -I mine-transcripts.py [file-of-defined-tool-names]
# Reads ~/.claude/projects/**/*.jsonl; Codex sessions are not covered.
import json, os, re, sys, collections, glob
from datetime import datetime

root = os.path.expanduser("~/.claude/projects")
PFX = "mcp__amanuensis-memory__"
calls = collections.Counter()
errs = collections.Counter()
errmsg = collections.Counter()
resp_bytes = collections.defaultdict(list)
latency = collections.defaultdict(list)
sessions_with = 0
retries = collections.Counter()  # same tool called right after its own error
first_err_tools = collections.Counter()
months = collections.Counter()

def norm(msg):
    m = re.sub(r"[0-9a-f]{7,40}", "<h>", msg)
    m = re.sub(r"\d+", "<n>", m)
    m = re.sub(r"`[^`]*`", "<q>", m)
    m = re.sub(r"'[^']*'", "<q>", m)
    m = re.sub(r'"[^"]*"', "<q>", m)
    return m[:110]

for path in glob.glob(os.path.join(root, "**", "*.jsonl"), recursive=True):
    try:
        with open(path, "rb") as fh:
            raw = fh.read()
    except Exception:
        continue
    if PFX.encode() not in raw:
        continue
    sessions_with += 1
    pending = {}  # tool_use_id -> (name, ts)
    last = None
    for line in raw.splitlines():
        try:
            ev = json.loads(line)
        except Exception:
            continue
        msg = ev.get("message") or {}
        content = msg.get("content")
        ts = ev.get("timestamp")
        if not isinstance(content, list):
            continue
        for c in content:
            if not isinstance(c, dict):
                continue
            if c.get("type") == "tool_use" and str(c.get("name", "")).startswith(PFX):
                name = c["name"][len(PFX):]
                calls[name] += 1
                pending[c.get("id")] = (name, ts)
                if ts:
                    months[ts[:7]] += 1
            elif c.get("type") == "tool_result" and c.get("tool_use_id") in pending:
                name, t0 = pending.pop(c["tool_use_id"])
                body = c.get("content")
                if isinstance(body, list):
                    body = "".join(x.get("text", "") for x in body if isinstance(x, dict))
                body = body if isinstance(body, str) else json.dumps(body)
                resp_bytes[name].append(len(body.encode()))
                if t0 and ts:
                    try:
                        d = (datetime.fromisoformat(ts.replace("Z", "+00:00")) - datetime.fromisoformat(t0.replace("Z", "+00:00"))).total_seconds()
                        latency[name].append(d)
                    except Exception:
                        pass
                is_err = bool(c.get("is_error"))
                em = None
                head = body[:600]
                if re.search(r'"ok"\s*:\s*false', head):
                    is_err = True
                    m = re.search(r'"error"\s*:\s*"((?:[^"\\]|\\.)*)', body)
                    em = m.group(1) if m else "ok:false"
                elif c.get("is_error"):
                    em = head
                if is_err:
                    errs[name] += 1
                    errmsg[(name, norm(em or ""))] += 1
                    if last and last[0] == name and last[1]:
                        retries[name] += 1
                last = (name, is_err)

def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(p * len(xs)))] if xs else None

tot = sum(calls.values()); te = sum(errs.values())
print(f"sessions={sessions_with} calls={tot} errors={te} ({te/tot:.1%}) distinct_tools={len(calls)}")
print("by month:", dict(sorted(months.items())))
print("\nTop tools by calls: name calls err% p50bytes p95bytes p50s p95s")
for n, k in calls.most_common(30):
    print(f"  {n:38s} {k:6d} {errs[n]/k:6.1%} {pct(resp_bytes[n],.5) or 0:7d} {pct(resp_bytes[n],.95) or 0:7d} {pct(latency[n],.5) or 0:6.1f} {pct(latency[n],.95) or 0:7.1f}")
print("\nHighest error rate (>=30 calls):")
for n, k in sorted(((n, k) for n, k in calls.items() if k >= 30), key=lambda x: -errs[x[0]] / x[1])[:15]:
    print(f"  {n:38s} {errs[n]:5d}/{k:<6d} {errs[n]/k:.1%}  immediate-retry-after-error={retries[n]}")
print("\nTop error classes:")
for (n, m), k in errmsg.most_common(30):
    print(f"  {k:5d}  {n}: {m}")
if len(sys.argv) > 1:
    defined = set(open(sys.argv[1]).read().split())
    unused = sorted(defined - set(calls))
    print(f"\nDefined tools never called ({len(unused)} of {len(defined)}):", ", ".join(unused))
