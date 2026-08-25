#!/usr/bin/env node
// Pre-publication custody test: pack the exact npm artifact, install it and its
// declared dependency closure into a clean prefix, run every adapter through
// the installed bin shim, and handshake through the installed server shim.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  assert(
    result.status === 0,
    `${command} ${args.join(" ")} failed (${result.status})\n${result.stdout}\n${result.stderr}`,
  );
  return result;
}

const moduleDir = fileURLToPath(new URL(".", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "amanuensis-package-artifact-"));

try {
  const npmCache = join(scratch, "npm-cache");
  run("npm", ["pack", "--silent", "--pack-destination", scratch], {
    cwd: moduleDir,
    env: { ...process.env, npm_config_cache: npmCache },
  });
  const tarballs = readdirSync(scratch).filter((name) => name.endsWith(".tgz"));
  assert(tarballs.length === 1, `expected one npm tarball, found ${tarballs.length}`);
  const installRoot = join(scratch, "install");
  run(
    "npm",
    ["install", "--prefix", installRoot, "--no-audit", "--no-fund", join(scratch, tarballs[0])],
    { cwd: scratch, env: { ...process.env, npm_config_cache: npmCache } },
  );

  const packageRoot = join(installRoot, "node_modules", "@gruetech", "amanuensis");
  const binRoot = join(installRoot, "node_modules", ".bin");
  const cli = join(binRoot, "amanuensis");
  const server = join(binRoot, "amanuensis-memory");
  const skill = join(packageRoot, "skills", "amanuensis");
  assert(existsSync(cli), "installed amanuensis bin shim is missing");
  assert(existsSync(server), "installed amanuensis-memory bin shim is missing");
  assert(existsSync(join(skill, "SKILL.md")), "packed skill is missing");
  assert(existsSync(join(skill, "references", "setup.md")), "packed skill references are missing");
  assert(
    existsSync(join(packageRoot, "materializer", "materialize.py")),
    "materializer is missing",
  );
  assert(!existsSync(join(packageRoot, "agents")), "obsolete custom-agent bundle was packed");
  assert(
    !existsSync(join(packageRoot, "materializer", "test-readback.py")),
    "materializer test leaked into the package",
  );
  assert(
    !existsSync(join(packageRoot, "materializer", "test-materializer.py")),
    "materializer test leaked into the package",
  );

  for (const client of ["claude", "codex", "vscode", "generic"]) {
    const workspace = join(scratch, `workspace-${client}`);
    mkdirSync(workspace, { recursive: true });
    const initArgs = ["init", "--client", client, "--dir", workspace];
    if (client === "codex") initArgs.push("--scope", "project");
    const installed = run(cli, initArgs, {
      cwd: moduleDir,
    });
    const skillRoot =
      client === "claude"
        ? join(workspace, ".claude", "skills", "amanuensis")
        : join(workspace, ".agents", "skills", "amanuensis");
    assert(existsSync(join(skillRoot, "SKILL.md")), `${client}: packed skill did not install`);
    assert(
      readFileSync(join(skillRoot, "SKILL.md"), "utf8") ===
        readFileSync(join(skill, "SKILL.md"), "utf8"),
      `${client}: installed skill differs from packed source`,
    );
    if (client === "claude") {
      const config = JSON.parse(readFileSync(join(workspace, ".mcp.json"), "utf8"));
      assert(
        config.mcpServers?.["amanuensis-memory"]?.command === "amanuensis-memory",
        "packed Claude adapter did not use the installed bin",
      );
    } else if (client === "codex") {
      assert(
        readFileSync(join(workspace, ".codex", "config.toml"), "utf8").includes(
          'command = "amanuensis-memory"',
        ),
        "packed Codex adapter did not use the installed bin",
      );
    } else if (client === "vscode") {
      const config = JSON.parse(readFileSync(join(workspace, ".vscode", "mcp.json"), "utf8"));
      assert(
        config.servers?.["amanuensis-memory"]?.command === "amanuensis-memory",
        "packed VS Code adapter did not use the installed bin",
      );
    } else {
      assert(
        installed.stdout.includes('command: "amanuensis-memory"'),
        "packed generic adapter did not print the installed bin",
      );
    }
  }

  run(process.execPath, [join(moduleDir, "test-mcp-compatibility.mjs")], {
    cwd: moduleDir,
    env: { ...process.env, AMANUENSIS_SERVER_COMMAND: server },
  });
  console.log(
    "OK — clean-installed artifact exposes both bins, installs every adapter, and completes an MCP handshake.",
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
