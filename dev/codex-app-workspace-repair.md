# Codex app workspace binding repair

2026-10-03. Local implementation and installed-source build verified. Existing
app connections still need to reload the server; native app verification after
that reload has not been performed.

## Reproduced failure

The MCP connection in the repair chat returned `workspace_path: "/"`,
`storage_path: "/.amanuensis"`, and
`selectionSource: "process-cwd-non-git"`. Its database was absent. The chat's
environment named the Amanuensis checkout as its workspace.

The user-scoped registration already launched the checkout's `dist/index.js`
with `cwd = "."` and `codex-user-cwd-v1`. The installed skill was a directory
symlink to `.claude/skills/amanuensis`. Neither an incorrect installation path
nor a stale skill copy explains this failure.

The actual MCP parent was the desktop's bundled `codex`, launched with
`-c features.code_mode_host=true app-server`. The old resolver only recovered
`codex --cd`; otherwise it treated the MCP process cwd as the target, including
filesystem root. The skill's initial `get_project_info({})` supplied no chat
workspace, and that tool's schema did not accept one.

## Repair

- `get_project_info({workspace: absoluteProjectDirectory})` selects an unbound
  connection once, or verifies an existing connection before database access.
  A nested target directory is normalized to its Git worktree root.
- Desktop app-server launches wait for that handshake even if their incidental
  process cwd happens to be a Git repository. Codex user launches with a non-Git
  cwd also wait. CLI Git-cwd and explicit `--cd` selection remain supported.
- Unbound responses advertise neither a workspace nor a store, and omit
  `db_exists` so they cannot be confused with cold starts. Every other project
  tool refuses unbound access.
- `resolveProject` rejects filesystem root, including explicit pins. Bound
  connections refuse different workspaces, even for two clones with the same
  logical repository identity.
- The skill and server initialization instructions both require the workspace
  from the chat's environment. The skill identifies an old schema as a reload
  requirement and forbids a global project-pin workaround.

## Verification

The new stdio regression was run against the original server sources at
`c541d63bbd24ea864305ba53f48b762cf3c32493`, transpiled into an isolated temporary
runtime. It failed specifically at **desktop cwd=/ was treated as a project**.
The repaired build passes that same regression.

`mcp-server/test-codex-app-workspace.mjs` exercises discovery at `/`, refusal of
unbound reader/writer calls, invalid handshakes, filesystem-root rejection,
lazy initialization, nested-root selection, simultaneous clone isolation,
immutable binding before and after writes, restart recovery, explicit pins,
the observed desktop parent-command shape from an incidental Git cwd, and CLI
`--cd` recovery. CI now runs this test.

Also passed: TypeScript build, Biome, tool schema compilation and inventory
read-back, MCP compatibility, parent-workspace parsing, installer tests,
activation contract, repository-binding containment, nested activation,
first-use laziness and recovery, startup timeout controls, and smoke tests.

A separate read-back launched the exact command, arguments, and environment
from the installed user registration with process cwd `/`. Its initial probe
returned `unbound`; the workspace handshake then returned the real Amanuensis
checkout and its existing `.amanuensis` store, with
`selectionSource: "tool-workspace-handshake"` and server version
`0.2.0-beta.2`. This verifies the installed launcher and rebuilt runtime,
independently of the synthetic fixture suite.

## Activation boundary

The installed registration points directly to the rebuilt output, and its skill
symlink exposes the updated instructions. No global workspace pin was added.
Already-running MCP processes retain the old code and schema until the app
restarts or reconnects them. Computer-use access to the app was unavailable, so
the current chat's connection was not reloaded. The tests above are actual
stdio process tests with the reproduced desktop launch boundary; they do not
claim a post-reload native app session has been observed.

## Native app read-back on October 7

The current native Codex app connection successfully called
`get_project_info({workspace: "/Users/nfeldman/repos/amanuensis"})` and returned
this repository, its existing `.amanuensis` store, and selection source
`tool-workspace-handshake`. The server instance was
`2eb15f64-7684-4ed3-a637-5cbdda104f29` and its version was `0.2.0-beta.2`,
with the rebuilt repair loaded. This establishes a live native app handshake
for the repair; it does not establish a beta.3 reconnect or verification in
another chat.
