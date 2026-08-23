# Copy-owned registry trial verification record

**Run date:** 2026-08-22  
**Fixture:** [`trials/shadcn-copy/`](trials/shadcn-copy/)  
**Decision contract:** the same heading, report navigation, labeled filter, three-row status table, caption/scoped headers, and method disclosure as TR-04.

## Frozen inputs

- Node 24.18.0 through the repository’s `mise` environment; npm 11.17.0.
- `shadcn@4.19.0`, Vite 8.2.2, React/React DOM 19.2.8, Tailwind CSS 4.3.3, Base UI React 1.7.0; direct declarations are exact-pinned and npm lockfile v3 freezes the installed graph.
- Official `base-nova` items: `button`, `input`, `label`, and `table`.
- The CLI is pinned but the official registry address is mutable. [`registry-snapshot.json`](trials/shadcn-copy/registry-snapshot.json) therefore records the retrieved payloads and hashes: `button` `70010dfb…`, `input` `d3175ee1…`, `label` `e2f2e126…`, `table` `57d0e14c…`.
- The Nova preset initially added a packaged Geist font and CSS import. The document trial removed that optional dependency and changed the token to `system-ui, sans-serif` before the confirmation build; this is an explicit offline-hardening customization, not the unmodified preset.

## Executed sequence and results

1. The preregistered expectations were written in [`trials.md`](trials.md) before installation or registry retrieval.
2. `shadcn init --base base --preset nova` recognized the hand-pinned Vite project, wrote `components.json` and `src/lib/utils.ts`, updated CSS, and installed the enabling stack.
3. `shadcn add table input label button --yes` copied four TypeScript files into `src/components/ui/`.
4. `npm run build` produced:
   - document arm: 3 files / 46,216 bytes; 5,459 HTML bytes; one local classic script; one complete table, caption, five scoped headers, labeled search input, and header/nav/main landmarks; zero remote assets and unresolved local references;
   - client-owned reject arm: 3 files / 278,244 bytes; one local module; zero static headings, landmarks, tables, captions, scoped headers, or search inputs.
5. Detector 1.0.0 measured 5 copied/CLI-initialized source files, 7,434 bytes and 197 nonblank lines. The four fixture-authored files measured 3,968 bytes and 112 nonblank lines. Generated document HTML contained 44 elements, 20 `data-slot` elements, 34 class attributes, and 209 class tokens.
6. The full installed development/CLI tree measured 397 package directories, 16,803 files, and 189,709,898 bytes. This is build-environment cost, not browser payload. The copy-owned components still import package-owned Base UI, React, CVA, `clsx`, and `tailwind-merge` layers.
7. A local provenance comment was added to `button.tsx`. `shadcn add button --diff src/components/ui/button.tsx` exposed that exact one-line drift and made no changes. Neither `components.json` nor the lockfile contains a per-component upstream version or three-way merge base; the payload snapshot in this trial is survey-added state.
8. [`registry-policy.py`](registry-policy.py) accepted all four captured official declarations and rejected four red arms: requested environment variables, an unpinned URL dependency, an unpinned GitHub ref, and path traversal. It does not inspect code behavior or package-manager lifecycle scripts.
9. `npm audit --json` found one low-severity advisory for esbuild 0.27.3–0.28.0, scoped to arbitrary file read from the Windows development server. The inspected generated report has no esbuild runtime. A disclosed-advisory query is not a general security verdict.
10. The first sandboxed document build compiled Tailwind but the `tsx` runner could not open its temporary IPC socket (`EPERM`). The exact build succeeded outside that sandbox restriction. This is an environment/instrument incident, not a candidate failure.
11. A confirmation rebuild succeeded. [`verify-registry-trial-snapshot.py`](verify-registry-trial-snapshot.py) then established that live output exactly matched [`registry-trial-inspection.json`](registry-trial-inspection.json).

## Coverage and limitations

The trial establishes source materialization, two output-ownership modes, static report structure, dependency/build size on this installation, declared registry-policy red proof, upgrade-diff visibility, and exact snapshot reproducibility. It does not execute browser behavior, keyboard navigation, assistive technology, modern HTML conformance, npm lifecycle behavior, a complex registry block, or a real long-term upgrade. It does not measure AI comprehension, authoring speed, correctness, or maintenance outcomes.

## Final gate repeat

After documentation reconciliation and the full reread:

- `npm run build`: PASS — document and client arms rebuilt successfully.
- `npx --no-install tsc --noEmit`: PASS.
- `npm ls --all`: PASS; platform-inapplicable optional packages were reported as unmet optional dependencies, not graph errors.
- `registry-policy.py`: PASS — four clean items accepted and four declared-payload red arms rejected.
- `verify-registry-trial-snapshot.py`: PASS — live inspection exactly matched the recorded snapshot.
- `verify-survey.py`: PASS — 12 required documents, 27 complete claims, 68 source IDs, all top-level JSON parsed, and all references resolved.
- Original `trial-red-proof.py` and `verify-trial-snapshot.py`: PASS.
- Current `materializer/test-materializer.py` and `materializer/test-readback.py`: PASS.
- Updated `link-audit.py`: PASS — 64 local references / 46 targets and 118 web references / 116 targets, zero failures; one access-limited HyperUI 403.
