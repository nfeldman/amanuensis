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

## `find_symbol`

`find_symbol(query, mode, kind, path_prefix, ref_sha, limit)` searches the
whole tree at one revision and returns rows, never bodies. A definition row
carries `path`, `symbol_id`, `kind`, its lines and `signature`: read it with
`read_symbol`, or read the file. A reference row carries `path`, `name`,
`kind`, `line` and `match`, and no `symbol_id`: read the file at that line.

- `mode: "definitions"` (the default) ranks definitions by BM25 over their
  names split on case and punctuation, their qualified names, signatures and
  doc comments. `Request` finds `parseHTTPRequest`; a word from a doc comment
  finds the definition it documents. Every word of the query must match.
- `mode: "references"` returns each place where `query` appears as an
  identifier. A reference is matched by name only and is never resolved, so it
  may be a different thing with the same name: every row carries
  `match: "name"`. Treat a row as a lead to read, not as proof of a call.
- `kind` keeps one definition kind (or one reference kind, such as `call`);
  `path_prefix` keeps paths that start with it. `limit` defaults to 20, and
  `more: true` says more rows matched. When every file under `path_prefix` is
  in a language the index does not parse, the empty answer carries
  `status: "unsupported-language"`: search those files with `rg` and read them.
- The revision's tree is indexed on first use. `partial: true` means that
  index is incomplete, with `partial_reason` saying why (a budget, or files
  missing from this clone): a row that is not there proves nothing yet. The
  next call resumes the index.

## `search_records`

`search_records(query, kinds, subject, include_history, limit)` is full-text
search (BM25) over the store's records: claims, narratives, explanations,
findings, field notes, open questions and vocabulary. Each hit carries `kind`,
`id`, `subject`, `status` and a snippet of at most 240 bytes. Open the record
with its own reader.

A hit is returned only as the store's own reader returns it, read at the
workspace HEAD where the reader takes a revision:

- claims as `get_claims` with `query_sha` at HEAD: superseded, invalidated
  and inapplicable claims are left out;
- narratives as `get_narratives`: the effective row per section and topic,
  with withdrawn keys left out;
- explanations as `get_explanations`: the newest row whose revision the
  workspace reaches, and none for a subsystem below its phase;
- open questions as `get_open_questions`: the open ones;
- findings, field notes and vocabulary as `get_findings`, `get_field_notes`
  and `lookup_term` return them, with their status.

`include_history: true` adds the rows those readers leave out, each with the
status that says why: `superseded`, `invalidated` or `inapplicable` for a
claim; `replaced` or `withdrawn` for a narrative; `replaced`, `withdrawn`,
`unreachable` or `not-eligible` for an explanation; `answered`, `dismissed` or
`superseded` for an open question. A claim closed at a revision HEAD does not
descend from still holds at HEAD, so `get_claims` returns it and its status is
`applies-at-head`.

`kinds` keeps some kinds; `subject` keeps one subsystem id (with claims whose
`claim_key` starts with it, and terms scoped to it, as `list_vocabulary`
scopes them). Each call brings the index up to date with the
store first, so a record written a moment ago is found.

## Citing a definition with `add_evidence`

`add_evidence(file_path, symbol, line_range, ref_sha, kind, excerpt, note)`
takes the same fields with or without the index. In a language the index
parses, the server resolves `symbol` against the definitions at `ref_sha` by
`symbol_id`, then qualified name, then a bare name that names one definition.

- The row stores the canonical `symbol_id` as its `symbol`, and an anchor is
  written with it in one transaction: the blob, the `symbol_id`, the
  definition's kind, its citeable lines and the hash of their bytes. The
  response carries `anchored: true`, the stored `symbol` and `line_range`.
- An omitted `line_range` is filled with the citeable span
  (`range_source: "filled"`). A given one may be narrower, a comma list
  included, but every span must lie inside the definition.
- `excerpt` must be the definition's own text within the cited lines. Text from
  a neighbouring definition is refused even when it sits on the same line.
- A `symbol` that names several definitions, such as two occurrences of one
  `symbol_id` or a bare name two classes define, needs a `line_range` inside
  exactly one of them.
- No `symbol`, a file in another language, a file the index cannot read, or
  `AMANUENSIS_CODE_INDEX=off` writes the row as before, with no anchor. Cite a
  whole file, or a region that is not a definition, this way.

`describe_locus` finds an anchored row by its bare name, its qualified name or
its `symbol_id`. A bare name that names two `symbol_id`s in the file is
reported as ambiguous, with both, and their evidence is not merged: ask again
with the `symbol_id`.

Its refusals:

- `add_evidence refuses: <symbol> names no definition in <path>`: the refusal
  lists the nearest `symbol_id`s. Pass one of them, or omit symbol: a
  free-text label belongs in note.
- `add_evidence refuses: <symbol> names N definitions in <path>` … `and
  line_range does not fall within exactly one of them`: the refusal lists each
  candidate's `symbol_id` and lines. Give a `line_range` inside the one to
  cite.
- `add_evidence refuses: line_range <range> reaches outside <symbol_id>`: the
  refusal names the definition's lines. Cite lines inside the definition, or
  omit symbol to cite lines no definition holds.
- `add_evidence refuses: the excerpt is not inside <symbol_id>`: quote that
  definition's own text; text from a neighbouring definition, even on the
  same line, is not part of it.

## Refusals and how to recover

Each refusal carries a `rule` and says its own way on. Most say to read the
file itself; the others say to name a file the revision holds, to search with
`rg`, to read the records with their own tools, or to pass one of the listed
`symbol_id`s. Reading the files directly is always open.

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
- `the code index cannot read the tree at <revision>`: `find_symbol` could not
  list or index that revision's tree, or the index is off. Search the files
  with `rg` and read them.
- `the code index cannot read the store's records`: `search_records` could
  not open the index database, or the index is off. Read the records with
  their own tools: `get_claims`, `get_narratives`, `get_explanations`,
  `get_findings`, `get_field_notes`, `get_open_questions` or `lookup_term`.
- `the code index did not parse <path>`: the file is over 2 MB or is not valid
  UTF-8. Read the file.
- `<symbol> names no definition in <path>`: `read_symbol` found nothing under
  that name at that revision. The refusal lists the nearest `symbol_id`s; pass
  one of them, or take the name from `outline_file`. With `line_range`, the
  refusal lists the definitions that exist and where they start.

A `ref_sha` that does not resolve to a commit in the workspace is refused as for
every other tool that takes one.
