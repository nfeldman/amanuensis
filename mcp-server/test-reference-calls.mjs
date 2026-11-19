#!/usr/bin/env node
// Red arms for scripts/check-reference-calls.mjs (finding B01-R1).
//
// The checker passing on the real references says nothing about whether it can
// see a drifted call. These cases are the two it missed when first written: a
// later call in a fenced block swallowed into an earlier call's arguments, and
// an inline call wrapped across lines that the span pairing skipped.
//
// Usage: node test-reference-calls.mjs   (needs a built dist/)

import { callsIn, checkReferenceCalls, spansIn } from "./scripts/check-reference-calls.mjs";

let passed = 0;
let failed = 0;
function check(name, fn) {
  const problem = fn();
  if (problem) {
    failed += 1;
    console.log(`  FAIL ${name}: ${problem}`);
  } else {
    passed += 1;
    console.log(`  ok   ${name}`);
  }
}

const callsOf = (text) => spansIn(text).flatMap((span) => callsIn(span.body));
const show = (calls) => JSON.stringify(calls);

check("every call in a fenced block is read, each to its own closing parenthesis", () => {
  const calls = callsOf("```\ndetect_changes(current_sha=<HEAD>)\nget_stale_backlog(limit=10)\n```\n");
  const names = calls.map(([name]) => name).join(",");
  if (names !== "detect_changes,get_stale_backlog") return `read ${show(calls)}`;
  if (calls[0][1] !== "current_sha=<HEAD>") return `the first call's arguments are ${show(calls[0][1])}`;
  return null;
});

check("nested parentheses and quoted parentheses stay inside their call", () => {
  const calls = callsOf('`add_finding(title="a (b", rationale=f(x))`');
  if (calls.length !== 1 || calls[0][1] !== 'title="a (b", rationale=f(x)') return `read ${show(calls)}`;
  return null;
});

check("an inline call wrapped across lines after another span is read", () => {
  const text = "Use `x` first. Record a `field_note(category=\"c\",\nlocation=<seam>)` describing it.";
  const calls = callsOf(text);
  if (!calls.some(([name]) => name === "field_note")) return `read ${show(calls)}`;
  return null;
});

check("an inline span does not cross a blank line", () => {
  const calls = callsOf("A stray ` backtick.\n\nThen `get_dashboard()` alone.");
  if (calls.length !== 1 || calls[0][0] !== "get_dashboard") return `read ${show(calls)}`;
  return null;
});

const { calls, problems } = await checkReferenceCalls();
check("the skill's references agree with the server", () =>
  problems.length ? `${problems.length} problem(s); first: ${problems[0]}` : null,
);
check("the checker reads a plausible number of calls", () =>
  calls >= 140 ? null : `only ${calls} call(s) read; a span parser that went blind would look green`,
);

console.log(`reference calls: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
