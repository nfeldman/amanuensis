import { spawnSync } from "node:child_process"
import { writeFile } from "node:fs/promises"

const result = spawnSync("npm", ["audit", "--json"], { encoding: "utf8" })
if (!result.stdout) throw new Error(result.stderr || "npm audit returned no JSON")
const audit = JSON.parse(result.stdout)
audit._amanuensis_record = {
  retrieved_at: "2026-08-22",
  command: "npm audit --json",
  note: "Audit scope is the exact package-lock graph; absence of advisories would not prove safety.",
}
await writeFile("npm-audit.json", `${JSON.stringify(audit, null, 2)}\n`)

if (![0, 1].includes(result.status)) process.exit(result.status ?? 2)
