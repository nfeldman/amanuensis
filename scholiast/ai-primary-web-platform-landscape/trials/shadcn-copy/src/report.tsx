import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const candidates = [
  ["Native HTML", "shortlist"],
  ["Observable Framework", "reject as primary"],
  ["Quarto", "benchmark"],
]

export function Report() {
  return (
    <>
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-10 focus:rounded-md focus:bg-background focus:p-2"
        href="#content"
      >
        Skip to content
      </a>
      <header className="border-b">
        <nav aria-label="Report" className="mx-auto max-w-4xl p-4">
          <ul className="flex list-none gap-4 p-0">
            <li><a aria-current="page" className="underline" href="index.html">Overview</a></li>
            <li><a className="underline" href="#methods">Methods</a></li>
          </ul>
        </nav>
      </header>
      <main className="mx-auto max-w-4xl p-4" id="content">
        <h1 className="text-3xl font-semibold tracking-tight">Candidate status</h1>
        <p className="mt-2 text-muted-foreground">A document-first filter trial.</p>
        <div className="my-4 flex max-w-lg items-end gap-2">
          <div className="flex-1 space-y-2">
            <Label htmlFor="filter">Filter candidates</Label>
            <Input data-report-filter id="filter" type="search" />
          </div>
          <Button data-report-reset type="button" variant="outline">Reset</Button>
        </div>
        <Table>
          <TableCaption>Candidate evidence</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Candidate</TableHead>
              <TableHead scope="col">Disposition</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {candidates.map(([candidate, disposition]) => (
              <TableRow key={candidate}>
                <TableHead scope="row">{candidate}</TableHead>
                <TableCell>{disposition}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <details className="mt-6" id="methods">
          <summary className="cursor-pointer font-medium">Method note</summary>
          <p className="mt-2">Content remains readable when JavaScript is disabled.</p>
        </details>
      </main>
    </>
  )
}
