#!/usr/bin/env node
// A transparent stdio launch witness used by the A25 real-host negative
// control. It records the exact cwd/argv delivered by Codex and the server's
// diagnostic stderr while leaving MCP stdin/stdout byte-for-byte connected.
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";

const [auditPath, command, ...args] = process.argv.slice(2);
if (!auditPath || !command) {
  throw new Error("usage: capture-activation-launch.mjs AUDIT_PATH COMMAND [ARG ...]");
}

function record(event) {
  appendFileSync(auditPath, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
}

record({ type: "launch", cwd: process.cwd(), command, args, witnessPid: process.pid });
const child = spawn(command, args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["inherit", "inherit", "pipe"],
});
child.stderr.on("data", (chunk) => {
  const text = chunk.toString("utf8");
  record({ type: "server-stderr", text });
  process.stderr.write(chunk);
});
child.on("error", (error) => {
  record({ type: "server-error", message: error.message });
  process.exitCode = 1;
});
child.on("close", (code, signal) => {
  record({ type: "server-exit", code, signal });
  process.exitCode = code ?? 1;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
