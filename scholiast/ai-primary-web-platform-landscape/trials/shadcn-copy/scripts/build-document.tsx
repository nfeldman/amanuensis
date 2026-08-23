import { copyFile, mkdir, writeFile } from "node:fs/promises"

import { renderToStaticMarkup } from "react-dom/server"

import { Report } from "../src/report"

const body = renderToStaticMarkup(<Report />)
const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Trial report — shadcn copy-owned document arm</title>
    <link rel="stylesheet" href="report.css">
  </head>
  <body>${body}<script src="report-filter.js"></script></body>
</html>
`

await mkdir("dist", { recursive: true })
await writeFile("dist/index.html", html)
await copyFile("src/report-filter.js", "dist/report-filter.js")
