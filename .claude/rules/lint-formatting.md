---
paths:
  - "eslint.config.js"
  - ".prettierrc.json"
  - ".prettierignore"
  - "vite.config.ts"
  - "package.json"
---

# Lint / format (eslint + prettier) — gotchas from adding it (#1)

## `.prettierignore` is a GRADUAL-ADOPTION list, not just build artifacts

The pre-existing codebase was written by hand, not run through prettier. Even with a
config matched to the real style (tabs, single quotes, `trailingComma: "none"`,
`printWidth: 100` — read a few files to confirm before ever tuning further), a trial
`prettier --write .` still touched **80 files / ~5500 lines**, because prettier's
line-breaking algorithm for chained calls / ternaries / multi-line casts is NOT
configurable — it will disagree with hand-formatting no matter how the options are
tuned. That is not a config bug; it's how prettier works on a never-formatted repo.

`.prettierignore` therefore lists those 80 files under "gradual adoption" (tracked in
#98) — `npm run lint` (`eslint . && prettier --check .`) is real and blocking on
everything else. **Do not add a new file to that list to dodge a formatting failure** —
new/edited files must be prettier-clean; run `npm run format` (`prettier --write .`,
respects `.prettierignore`) before committing. When #98 reformats a listed file, remove
it from `.prettierignore` in the SAME PR that reformats it.

## The version-label fallback needs `package.json`, not raw `git describe --tags`

This repo has **never had a git tag**. `vite.config.ts`'s `APP_VERSION` fallback (used
whenever the env var isn't set — every local build AND the CI `test` job's build; only
the `deploy` job on `main` sets it explicitly) used to run
`git describe --tags --always --dirty`, which with zero tags always degrades to a bare
short SHA (e.g. `v9477686-dirty`) — silently violating the mandatory `v<semver>`
dashboard format (version-on-dashboard). Fixed to read the version from `package.json`
(single source of truth, per version-bumping) + a short SHA, in the same
`"<version> (<sha7>)"` shape the deploy job already sends. If you ever touch this
fallback again, verify with `npx playwright test app.spec.ts -g verzia` — the assertion
is `^v\d+\.\d+\.\d+(-dev\.\d+)?(\s\([0-9a-f]{7}\))?$`, which a bare-SHA fallback fails.

## eslint config quirks worth knowing

- No `svelte.config.js` exists in this repo (SvelteKit is configured inline in
  `vite.config.ts` via `sveltekit({...})`) — `eslint-plugin-svelte`'s docs assume one
  exists and import `svelteConfig` into the parser options; that import is skipped here
  (it only affects kit-route/type detection this repo doesn't rely on).
- `svelte/no-navigation-without-resolve` (typed `resolve()` navigation, SvelteKit
  2.12+) is `error` since #99 — every internal `<a href>` MUST go through `resolve()`
  from `$app/paths`. Two patterns that satisfy the rule's TS-type check:
  - Static path → `href={resolve('/route')}` directly at the usage site.
  - A `href` value built ahead of time (e.g. a nav-links array) → type the field as
    `RouteId` (`import type { RouteId } from '$app/types'`) and still call
    `resolve(l.href)` at the usage site — pre-resolving the array entries themselves
    (`href: resolve('/route')`) does NOT reliably satisfy the rule's type-checker at
    the template call site, even though the value is a `ResolvedPathname`.
  - Query strings work directly: `resolve(\`/route?param=${value}\`)` — `resolve()`
    accepts `${Pathname}?${string}`, no need to split off the query string.
  - `window.location.href = ...` assignments are NOT covered by this rule (it only
    checks `<a href>`, `goto()`, `pushState()`, `replaceState()`) — don't assume every
    navigation-shaped line needs `resolve()`.
- `@typescript-eslint/no-explicit-any` is `error`, not `warn` — `npm run lint` has no
  `--max-warnings 0`, so a bare `warn` never fails CI (a warn-only rule with no
  `--max-warnings` gate is toothless). A genuine edge case (e.g. an untyped exceljs
  cell) should get a targeted, justified `// eslint-disable-next-line` — never a
  blanket rule downgrade.

## Type-aware eslint (`recommendedTypeChecked`) — scope it to `src/**/*.ts` ONLY (#257)

Enabling type-aware rules (`ts.configs.recommendedTypeChecked` + `parserOptions.projectService`)
must be SCOPED, not global, via a flat-config `extends` block:

```js
{ files: ['src/**/*.ts'], ignores: ['**/*.svelte.ts'],
  extends: [ts.configs.recommendedTypeChecked],
  languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } } }
```

Why NOT global:
- `e2e/**/*.ts` is NOT in any tsconfig `include` (the generated `.svelte-kit/tsconfig.json`
  lists `src/**`, `tests/**`, `vite.config.ts` — not `e2e/`), so `projectService` throws a
  `Parsing error: … was not found by the project service` on all ~40 e2e specs. `allowDefaultProject`
  can't cover that many files.
- `.svelte` / `.svelte.ts` — the svelte parser and the TS program don't coexist; keep svelte on
  the non-typed `svelte.configs.recommended` (`.ts` glob doesn't match `.svelte`; exclude `.svelte.ts`).
- tests are synchronous (better-sqlite3) → no promise-safety value, and type-aware there adds only
  fixture-`any` noise.

Two rules deliberately calibrated (documented in `eslint.config.js`, NOT blanket disables):
- `no-base-to-string` OFF — every finding is the intentional `String(x ?? '')` coercion of
  `FormData.get()` (`string|File`) or JSON `unknown` at the Money input boundary; forms have no
  file inputs, so it's always string→string. Narrowing would rewrite ~100 Money-input sites.
- `require-await` OFF only for `src/routes/**` — SvelteKit `load`/`+server` handlers read from
  synchronous better-sqlite3, so `async`-without-`await` is idiomatic; the rule stays ON for `src/lib/**`.

`no-floating-promises` / `no-misused-promises` (the actual reason to go type-aware) found 0 — the
async Money path already awaits correctly; the rules now guard the future.

## Widening vitest coverage scope (#257)

- Spread `coverageConfigDefaults.exclude` (`import { coverageConfigDefaults } from 'vitest/config'`)
  into `coverage.exclude` — a bare explicit `exclude` REPLACES vitest's defaults (would then count
  `*.d.ts` etc.).
- The `text` reporter TRUNCATES rows (it silently drops files from the printed table) — do NOT trust
  it to enumerate what's measured. Read `coverage/coverage-summary.json` (`--coverage.reporter=json-summary`)
  for the true file list + `total`.
- v8 measures every file matching `include` that any test imports; `all` didn't change the set here.
- Excludes must be genuinely unmeasurable/empty only: `vizual/snimka.ts` (WebGL `gl.readPixels` + canvas
  2D, headless-unmeasurable — its one pure fn keeps a unit test), `vizual/spec.ts` (types), `index.ts`
  (empty `$lib` barrel). Keep partially-measurable files (e.g. `vizual/scena.ts` 74%) IN — don't exclude
  to inflate the number.
- Thresholds = measured − 2 %, integers, and NEVER below the previous effective gate. Switch
  `defineConfig` import from `'vite'` to `'vitest/config'` (natively types the `test` block) so you can
  drop the `/// <reference types="vitest/config" />` triple-slash — otherwise adding a `vitest/config`
  import trips `@typescript-eslint/triple-slash-reference` (prefer-import).
