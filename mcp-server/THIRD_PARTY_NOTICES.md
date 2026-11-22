# Third-party notices

This package ships files from the tree-sitter project and its official grammar packages. All of
them are MIT licensed. The grammar files are vendored, not npm dependencies: `npm pack` fetches
each package at the pinned version and integrity in `grammars/sources.json`, and
`scripts/vendor-grammars.mjs` extracts the compiled grammar (`grammar.wasm`), its `tags.scm`
and its `LICENSE` into `grammars/<language>/`. Each directory carries the license text its
package published, and `grammars/manifest.json` records the sha256 and size of every file.

## Runtime

- `web-tree-sitter@0.27.2`, Copyright (c) 2018 Max Brunsfeld. MIT. Installed as an npm
  dependency; its own `LICENSE` ships with it.

## Vendored grammars

| Language | Package | Copyright | Files |
|---|---|---|---|
| TypeScript | `tree-sitter-typescript@0.23.2` | Copyright (c) 2017 Max Brunsfeld | `grammars/typescript/` |
| TSX | `tree-sitter-typescript@0.23.2` | Copyright (c) 2017 Max Brunsfeld | `grammars/tsx/` |
| JavaScript | `tree-sitter-javascript@0.25.0` | Copyright (c) 2014 Max Brunsfeld | `grammars/javascript/` |
| Python | `tree-sitter-python@0.25.0` | Copyright (c) 2016 Max Brunsfeld | `grammars/python/` |
| Rust | `tree-sitter-rust@0.24.0` | Copyright (c) 2017 Maxim Sokolov | `grammars/rust/` |
| Go | `tree-sitter-go@0.25.0` | Copyright (c) 2014 Max Brunsfeld | `grammars/go/` |
| Java | `tree-sitter-java@0.23.5` | Copyright (c) 2017 Ayman Nadeem | `grammars/java/` |
| C | `tree-sitter-c@0.24.1` | Copyright (c) 2014 Max Brunsfeld | `grammars/c/` |
| C++ | `tree-sitter-cpp@0.23.4` | Copyright (c) 2014 Max Brunsfeld | `grammars/cpp/` |
| C# | `tree-sitter-c-sharp@0.24.0` | Copyright (c) 2014-2023 Max Brunsfeld, Damien Guard, Amaan Qureshi, and contributors. | `grammars/csharp/` |

## License text

Each package above is distributed under this license, with the copyright line in the table:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software
> and associated documentation files (the "Software"), to deal in the Software without
> restriction, including without limitation the rights to use, copy, modify, merge, publish,
> distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
> Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
> INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
> PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
> FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
> OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
> DEALINGS IN THE SOFTWARE.
