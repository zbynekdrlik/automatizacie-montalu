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
  - **A SHARED `{#snippet}` rendering several nav-link arrays MUST NOT type its param
    as bare `RouteId`** (#392) — `RouteId` is the union of EVERY route in the app
    (~24+ members), and `resolve()`'s overloaded per-literal signature fails
    TypeScript's overload resolution against that full width (`svelte-check`: "Type
    '[…every route…]' is not assignable to type '[route: "/last-checked-route"]'").
    A `const links = $derived(cond ? A : B) satisfies {href: RouteId}[]` variable used
    DIRECTLY in a template `{#each}` is fine (`satisfies` doesn't widen — TS keeps the
    narrower per-branch literal union) — the trap is only in an EXTRACTED snippet/
    function whose PARAMETER you annotate with the wide `RouteId` type yourself. Fix:
    type the snippet param `typeof arrayA | typeof arrayB` (the exact `$derived`
    variables), not `{ href: RouteId; label: string }[]` — keeps the narrow literal
    union, `resolve()` typechecks. Same trap hit a standalone helper function
    (`const isActive = (href: RouteId) => …`) — inline the comparison at each call
    site instead, or generic-type the helper the same way.
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

## `noUncheckedIndexedAccess` — honest narrowing taxonomy (#255)

`tsconfig.json` has `strict: true` AND `noUncheckedIndexedAccess: true`. Every index
access (`arr[i]`, `record[key]`, `s.split('|')[0]`, a regex `m[1]`) is `T | undefined`.
`npm run check` (svelte-check) is the gate — 0 errors. Fix by honest narrowing that
reflects the REAL invariant, NEVER a `?? default` that changes a value (Money-critical).
`@typescript-eslint/no-non-null-assertion` is NOT enabled (it's `stylistic`, not in
`recommendedTypeChecked`), and `no-unnecessary-condition` is NOT enabled (it's `strict`),
so a locally-provable `!` and a never-firing `if (!x) continue` guard both pass lint.

Pattern → fix:
- **Bounded C-loop that needs the index** `for (let i=0;i<a.length;i++){const x=a[i];…i…}`
  → `for (const [i, x] of a.entries())` — `entries()` gives `[number, T]` so `x` is
  DEFINED, index kept. No index needed → `for (const x of a)`. This is the cleanest
  (structural, zero `!`).
- **`s.split(sep)[0]`** (always defined) → `?? ''` — matches the repo's existing
  `[1] ?? ''` convention; the `??` never fires, zero value change. Array-destructure
  default works too: `const [system = '', styl = ''] = s.split('|')`.
- **Record/map lookup after a presence-guard** (`pool[k]` after `if(!pool[k]) pool[k]={…}`)
  → capture a local `let bucket = pool[k]; if(!bucket){bucket={…}; pool[k]=bucket; …}` and
  use `bucket` — TS doesn't narrow a re-indexed access across statements, a local it does.
- **`for…in`/`Object.keys` key access** (`cfg[k]` for `k in cfg`) → local `const g=cfg[k];
  if(!g) continue;` (never fires) or `cfg[k]!` with a `k ∈ Object.keys(...)` comment.
- **Dense counter array in a bounded loop** (`counts[i]`, `used[i]` from `new Array(n).fill(0)`):
  read `counts[i]!`; a WRITE `++counts[i]`/`used[i]+=p` can't take `!` on the l-value —
  rewrite via a local: `const nv = counts[i]! + 1; counts[i] = nv;`.
- **Regex capture group** `m[1]` after `if(!m)` → `m[1]!` (mandatory groups are always
  present when the match succeeds — a known TS limitation, `!` + a "regex has N groups"
  comment).
- **Length-guarded access** (`fit[0]` after `fit.length ?`, `avail[0]` in `if(avail.length===1)`,
  `candidates[len-1]` after `if(len===0) throw`) → `!` with the guard cited.
- **SvelteKit `export const actions: Actions = {…}`** → `… satisfies Actions`. `Actions` is
  `Record<string, Action>` (index signature) so `actions.nahlad` typed `Action|undefined` and
  every TEST doing `actions.nahlad(event)` errors. `satisfies` keeps the literal type (runtime
  identical — satisfies is erased), fixing the source AND all its test errors at once, without
  losing the conformance check. Applied to all 16 route `+page.server.ts`.
- **Provable-non-empty array-of-derived** (`popisUhlov = $derived([{…},{…}])`, geometry arrays
  `stlpiky`/`pozicie`/`vysky`/`postX` whose length === a known `n±1` via `deliaceStlpiky`/
  `sekcieVysky`/`sekciePozicie`/`stlpyZPolí`) → `[i]!` with the length-invariant in a comment.
  Display/Vykres components only — `!` preserves the exact (never-hit-empty) runtime.
- **Test assertions** (`r.material[0].barLen`, `find(...)!.rezy[0].x`) → add `!` at the
  index (`r.material[0]!.barLen`). NEVER changes what the test asserts (`!` is erased; an
  undefined element still throws) — the ONLY safe test edit. NEVER `?.`, never touch a
  `.toBe(...)`/vector value. `tests/compute.test.ts` (109 Money vectors) stays byte-identical.

A genuine possible-undefined that is a REAL latent bug (not a provable invariant) gets a
guard + explicit error + RED→GREEN regression test, not a silencing `!`.

## Dve svelte-check pasce z #294/#295 (obe stáli debug cyklus)

- **`*/` VNÚTRI `/** … */` JSDoc komentára ho PREDČASNE ZAVRIE.** Glob ako `ZASP*/ZASK*` (alebo
  `PRP*/BPP*`) obsahuje `*/`, čo ukončí blokový komentár → zvyšok textu sa parsuje ako KÓD →
  kaskáda „Cannot find name 'BPP'" / arithmetic errors (13 chýb naraz z jedného komentára v
  `ceny.ts`). Fix: v JSDoc nepíš `*/` — použi `ZASP.../ZASK...` alebo `ZASP*` `/` `ZASK*` s medzerou,
  prípadne `ZASP\*` mimo bloku. Riadkový `//` komentár túto pascu NEMÁ (nemá terminátor).
- **Optional-chaining PRÍSTUP DO POĽA: `x?.[0].y` je stále „possibly undefined".** `x?.[0]` skráti
  na `T | undefined`, takže `.y` na tom pod `strict` (noUncheckedIndexedAccess) padne. Píš
  `x?.[0]?.y`. **svelte-check kryje aj `.ts` TESTY** — takže po pridaní testových asercií s
  optional-chainingom ZNOVA spusti `npm run check` (nie len `vitest`+`lint`); `?.[0].dovod` v teste
  prešlo cez vitest aj eslint, ale svelte-check ho odhalil (chytila to až review).
