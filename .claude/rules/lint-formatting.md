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
