import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { writeFile } from "node:fs/promises"

const items = ["button", "input", "label", "table"]
const cli = new URL("../node_modules/.bin/shadcn", import.meta.url).pathname
const result = spawnSync(cli, ["view", ...items], {
  cwd: new URL("..", import.meta.url),
  encoding: "utf8",
})

if (result.status !== 0) {
  throw new Error(result.stderr || `shadcn view exited ${result.status}`)
}

const payload = JSON.parse(result.stdout)
const snapshot = {
  schema_version: "1.0.0",
  retrieved_at: "2026-08-22",
  cli: "shadcn@4.19.0",
  project_style: "base-nova",
  caveat: "The CLI is pinned; the official registry address is mutable. Per-item payload hashes freeze this retrieval.",
  items: payload.map((item) => ({
    ...item,
    payload_sha256: createHash("sha256").update(JSON.stringify(item)).digest("hex"),
  })),
}

await writeFile("registry-snapshot.json", `${JSON.stringify(snapshot, null, 2)}\n`)
