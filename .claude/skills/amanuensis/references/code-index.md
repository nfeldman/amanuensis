# Code index

The code index reads a source file at one revision and keeps what it finds in a
cache beside the store. It adds to reading a file: whole files may be read
whenever they help, and nothing here is a reason not to. The index is for
finding a definition, seeing a file's shape, and citing code exactly. The style
of labels and prose is in [`reporting-style.md`](reporting-style.md).

The cache is built from the repository's own revisions and holds no record.
Deleting it is always safe. `AMANUENSIS_CODE_INDEX=off` removes the index's
tools and `add_evidence` behaves as it does without a symbol.

## Languages

TypeScript, TSX, JavaScript, Python, Rust, Go, Java, C, C++ and C#. A file in
any other language is refused as `unsupported-language`; read it directly.

## `outline_file`

`outline_file(path, ref_sha)` lists a file's definitions as a nested list, each
with its `symbol_id`, kind, lines, signature and first documentation line, then
its imports, `bytes`, `lines`, `blob_sha` and `status`. It returns no source.
`ref_sha` defaults to the workspace HEAD and comes back resolved.

- `start_line` and `end_line` are the declaration's. `doc_start_line` appears
  when the leading comment, decorators or wrappers start earlier; the citeable
  span runs from there to `end_line`.
- `occurrence` appears when one `symbol_id` names several definitions in the
  file, for example two branches of an `if` that each define the same Python
  function. The occurrences are numbered in file order for this revision only,
  so the number is a label for this response and never an identity.
- `status: "parse-partial"` means the file has a syntax error. Definitions whose
  declaration holds an error are not listed; the intact ones are.

## `read_symbol`

`read_symbol(path, symbol, ref_sha, line_range, context_lines)` reads one
definition. `symbol` is a `symbol_id`, a qualified name such as `Label.render`
or a bare name.

- One match returns `source`, exactly the citeable span's text with its leading
  documentation, with `start_line` and `end_line`, and `evidence_args`.
- `evidence_args` holds the location fields of `add_evidence`: `file_path`,
  `symbol` (the canonical `symbol_id`), `ref_sha` and `line_range` (the whole
  citeable span). It is not a complete call. Add `kind`, which only the reader
  can choose, and an `excerpt` or `note` when they help:
  `add_evidence(file_path, symbol, ref_sha, line_range, kind, excerpt, note)`.
  Narrow `line_range` inside the definition when the claim rests on part of it.
- Several matches return `ambiguous: true` and the candidates with their lines,
  and no source. Two definitions that share a name are different candidates; two
  occurrences of one `symbol_id` carry `occurrence`. Pass `line_range` with a
  candidate's lines (`N` or `N-M`) to read that one.
- `context_lines` (0 to 50) adds `context_before` and `context_after` beside the
  span. The span and `evidence_args` do not change.
- A definition over 400 lines returns its first 400 lines, its nested
  definitions, `truncated: true` and no `evidence_args`, so a citation never
  covers source the reader was not shown. Read the whole file, or a nested
  definition, to go on.

## Refusals and how to recover

Each refusal carries a `rule` and says what to do instead. In every case the way
on is the same: read the file.

- `<path> is not in a language the code index parses (unsupported-language)`:
  the extension is outside the list above. Read the file itself.
- `<path> is not in the tree at <revision>`: the revision does not hold that
  path. Check the path, or give a `ref_sha` that does.
- `<path> is a symlink at <revision> and the code index does not follow it`: the
  entry is a symlink or a submodule. Read the path it points to. A gitlink names
  a submodule, which is a different repository.
- `the code index cannot read <path>`: the index database is busy or
  unreadable, the revision's file is missing from this clone (a shallow clone, for
  example), or the index is off. Read the file directly; the next call may
  succeed.
- `the code index did not parse <path>`: the file is over 2 MB or is not valid
  UTF-8. Read the file.
- `<symbol> names no definition in <path>`: `read_symbol` found nothing under
  that name at that revision. The refusal lists the nearest `symbol_id`s; pass
  one of them, or take the name from `outline_file`. With `line_range`, the
  refusal lists the definitions that exist and where they start.

A `ref_sha` that does not resolve to a commit in the workspace is refused as for
every other tool that takes one.
