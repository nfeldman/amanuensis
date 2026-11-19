import { spawnSync } from "node:child_process"
import { writeFile } from "node:fs/promises"

// Bounded, so a stalled registry fails the capture instead of hanging (B07-1).
const result = spawnSync("npm", ["audit", "--json"], { encoding: "utf8", timeout: 120_000 })
if (result.error) throw new Error(`npm audit: ${result.error.message}`)
if (!result.stdout) throw new Error(result.stderr || "npm audit returned no JSON")
const audit = JSON.parse(result.stdout)
audit._amanuensis_record = {
  retrieved_at: "2026-08-22",
  command: "npm audit --json",
  note: "Audit scope is the exact package-lock graph; absence of advisories would not prove safety.",
}
await writeFile("npm-audit.json", `${JSON.stringify(audit, null, 2)}\n`)

if (![0, 1].includes(result.status)) process.exit(result.status ?? 2)
