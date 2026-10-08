#!/usr/bin/env node
// Pre-publication custody test: pack the exact npm artifact, install it and its
// declared dependency closure into a clean prefix, run every adapter through
// the installed bin shim, and handshake through the installed server shim.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

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

async function verifyRelocatedMaterialization(server) {
  const bound = join(scratch, "bound-checkout");
  const original = join(scratch, "original-checkout");
  for (const directory of [bound, original]) {
    mkdirSync(directory);
    run("git", ["init", "--quiet", "--initial-branch=main"], { cwd: directory });
    run("git", ["remote", "add", "origin", "https://github.com/acme/fixture.git"], {
      cwd: directory,
    });
    writeFileSync(join(directory, "README.md"), `# ${directory}\n`);
    run("git", ["add", "README.md"], { cwd: directory });
    run(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "--quiet",
        "--no-verify",
        "-m",
        "fixture",
      ],
      { cwd: directory },
    );
  }
  const head = run("git", ["rev-parse", "HEAD"], { cwd: bound }).stdout.trim();
  const oldHead = run("git", ["rev-parse", "HEAD"], { cwd: original }).stdout.trim();
  assert(head !== oldHead, "relocation fixture must distinguish the two checkouts");
  const client = new Client({ name: "packed-materializer-workspace", version: "1" });
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith("AMANUENSIS_") && key !== "CLAUDE_PROJECT_DIR",
    ),
  );
  env.AMANUENSIS_AUTOPROGRESS = "0";
  async function call(name, args) {
    const result = await client.callTool({ name, arguments: args });
    const value = result.structuredContent ?? JSON.parse(result.content[0].text);
    assert(value.ok !== false, `${name}: ${JSON.stringify(value)}`);
    return value;
  }
  try {
    await client.connect(new StdioClientTransport({ command: server, cwd: "/", env }));
    await call("get_project_info", { workspace: bound });
    await call("start_session", { intent: "Packed relocated materializer regression" });
    await call("set_git_state", {
      canonical_branch: "main",
      onboarding_sha: head,
      last_checked_sha: head,
    });
    await call("upsert_subsystem", { id: "B-01", name: "Fixture" });
    await call("add_files_to_scope", {
      subsystem_id: "B-01",
      ref_sha: head,
      files: [{ file_path: "README.md", classification: "examined" }],
    });
    await call("detect_changes", { current_sha: head });
    const info = await call("get_project_info", {});
    const record = join(info.storage_path, "workspace_path");
    writeFileSync(record, original);
    const published = await call("materialize_docs", {
      clean_publish: true,
      verify_readback: true,
    });
    assert(published.published && published.readback.ok, "packed publication must pass read-back");
    for (const suffix of ["md", "html"]) {
      const page = readFileSync(join(info.storage_path, "docs", `index.${suffix}`), "utf8");
      assert(page.includes(head.slice(0, 12)), "bound revision missing from published overview");
      assert(!page.includes(oldHead.slice(0, 12)), "overview used the original checkout's HEAD");
    }
    assert(readFileSync(record, "utf8") === original, "historical provenance was rewritten");
    assert((await call("verify_materialized_docs", {})).ok, "packed independent read-back failed");
  } finally {
    await client.close();
  }
}

try {
  const npmCache = join(scratch, "npm-cache");
  // Also run this exact gate against a registry version after publication.
  let packageSpec = process.env.AMANUENSIS_TEST_PACKAGE;
  if (!packageSpec) {
    run("npm", ["pack", "--silent", "--pack-destination", scratch], {
      cwd: moduleDir,
      env: { ...process.env, npm_config_cache: npmCache },
    });
    const tarballs = readdirSync(scratch).filter((name) => name.endsWith(".tgz"));
    assert(tarballs.length === 1, `expected one npm tarball, found ${tarballs.length}`);
    packageSpec = join(scratch, tarballs[0]);
  }
  const installRoot = join(scratch, "install");
  run("npm", ["install", "--prefix", installRoot, "--no-audit", "--no-fund", packageSpec], {
    cwd: scratch,
    env: { ...process.env, npm_config_cache: npmCache },
  });

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
  await verifyRelocatedMaterialization(server);
  console.log(
    "OK — clean-installed artifact exposes both bins, installs every adapter, completes an MCP handshake, and materializes the bound relocated checkout from cwd=/.",
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
