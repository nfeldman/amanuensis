import { spawnSync } from "node:child_process"
import { writeFile } from "node:fs/promises"

const repositories = [
  "shadcn-ui/ui",
  "chakra-ui/park-ui",
  "intentui/intentui",
  "markmead/hyperui",
  "keenthemes/reui",
  "shadcnblocks/kibo",
  "chakra-ui/ark",
  "mui/base-ui",
  "adobe/react-spectrum",
  "radix-ui/primitives",
  "chakra-ui/panda",
  "chakra-ui/chakra-ui",
  "unovue/shadcn-vue",
  "huntabyte/shadcn-svelte",
  "tailwindlabs/tailwindcss",
  "tailwindlabs/headlessui",
]

const packages = [
  "shadcn",
  "@base-ui/react",
  "react-aria-components",
  "@ark-ui/react",
  "@pandacss/dev",
  "@chakra-ui/react",
  "@radix-ui/react-dialog",
  "@headlessui/react",
  "tailwindcss",
  "class-variance-authority",
  "tailwind-merge",
]

async function github(repo) {
  const url = `https://api.github.com/repos/${repo}`
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "amanuensis-scholiast-survey" },
  })
  if (!response.ok) throw new Error(`${url}: ${response.status} ${await response.text()}`)
  const data = await response.json()
  return {
    repo,
    url: data.html_url,
    archived: data.archived,
    disabled: data.disabled,
    pushed_at: data.pushed_at,
    updated_at: data.updated_at,
    default_branch: data.default_branch,
    stargazers_count: data.stargazers_count,
    forks_count: data.forks_count,
    open_issues_and_pull_requests: data.open_issues_count,
    license: data.license ? { spdx_id: data.license.spdx_id, name: data.license.name } : null,
  }
}

function npmMetadata(name) {
  const result = spawnSync(
    "npm",
    ["view", name, "version", "time.modified", "license", "dist.unpackedSize", "dependencies", "peerDependencies", "engines", "repository", "--json"],
    { encoding: "utf8" },
  )
  if (result.status !== 0) throw new Error(result.stderr || `npm view ${name} exited ${result.status}`)
  return { package: name, ...JSON.parse(result.stdout) }
}

const snapshot = {
  schema_version: "1.0.0",
  retrieved_at: "2026-08-22",
  limitations: [
    "GitHub stars and open-item counts are orientation signals, not quality rankings.",
    "GitHub open_issues_count combines issues and pull requests.",
    "pushed_at can reflect automation or non-product changes; it establishes recency only.",
    "npm unpacked size is package/build footprint, not delivered browser payload.",
    "Registry metadata and repository state can change after retrieval.",
  ],
  github: await Promise.all(repositories.map(github)),
  npm: packages.map(npmMetadata),
}

await writeFile("component-landscape-metadata.json", `${JSON.stringify(snapshot, null, 2)}\n`)
