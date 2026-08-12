# automatizacie-montalu — Project Instructions

## Overview

SvelteKit web app (TypeScript + Vite) for **Montalu automations**. Reads/writes Excel
(`exceljs`) and persists to SQLite (`better-sqlite3`). Scaffolded from `sv create`
(minimal, TS). The global airuleset rules (`~/.claude/CLAUDE.md`) apply on top of this file.

## Branch model

Two branches: `main` (production) + `dev` (development). All work on `dev`; open a PR
dev→main when ready. Merge commits only (no squash/rebase). Auto-merge default — no
`<!-- airuleset:merge=manual -->` marker (only the user adds one).

## Version

Version file: `package.json` `"version"`. Bump it on `dev` FIRST (before any work) so
`dev` > `main` (per version-bumping). The web UI MUST display this version label — see
"CI + deploy" below.

**Convention: `dev` carries `X.Y.Z-dev.N`, `main` carries the clean `X.Y.Z`.** The
FIRST commit on `dev` after a merge bumps to the next `-dev.1`; right before opening the
PR to `main`, bump again to the clean released version (no `-dev` suffix). A `-dev`
string ending up on `main` is a real bug, not cosmetic — it happened twice (#1/#101) and
was fixed in #98 (which also taught `sort -V` to rank `X-dev.N` above the clean `X`, so
the CI version-check compares correctly either way).

## Local build policy (Tier 0)

- Before pushing, run the cheap gates locally: `npm run check` (svelte-check = tsc, no
  bundle) and `npm run lint` (eslint + `prettier --check`) — fix before push.
- `npm run build` / `vite build` is a bundler build → **CI only, not local** (no-local-builds).
- eslint (`eslint.config.js`) + prettier (`.prettierrc.json`) are configured — tabs,
  single quotes, ~100 print width, matching the pre-existing hand-formatted code. Most of
  the existing tree is hand-formatted (not run through prettier) and is listed in
  `.prettierignore` under gradual adoption (#98) — new/edited files must be
  prettier-clean; don't add to that list.
- `better-sqlite3` is a native module (needs a compile step on `npm ci`).

## Testing

- Unit: **Vitest** (`npm test` = `vitest run --coverage`, thresholds in `vite.config.ts` —
  never lower them). The compute vectors in `tests/compute.test.ts` are CONTRACTUAL 1:1
  ports of the verified Money odpis numbers — never change them without re-verifying
  against real odpis Excels.
- E2E: **Playwright** through the real browser — every E2E asserts **zero console
  errors/warnings**. `BASE_URL=<deployed>` runs against a deployment (write tests
  auto-skip when the target reports `live: true` on /health — test data must NEVER
  reach the real Money import). Without BASE_URL it builds + runs a preview server.
- Bug fixes: RED regression test committed BEFORE the fix (regression-test-first).

## CI + deploy (foundation COMPLETE)

- `.github/workflows/ci.yml`: version-check (dev > main), svelte-check, vitest+coverage,
  build, Playwright E2E; on main → deploy to VPS 167.233.125.9 (`/opt/automatizacie-montalu`,
  docker compose build on the VPS from the rsynced ref, health+version verified).
- Version label: footer `data-testid="version"` on every page, injected from
  `APP_VERSION`/git describe at build; E2E asserts it.
- Runtime env on the VPS: `/opt/automatizacie-montalu/.env` (SEED_USERS, MONEY_LIVE) —
  NOT in git. `MONEY_LIVE=1` is the ONLY switch that lets writes reach the real Money
  import; flipping it is the USER's call, never the agent's.

## Money safety (the hard rules)

- Nothing test-related may EVER reach the live Money import (`/data/dlv-import`).
- Dedup = DB `UNIQUE(zak, op, live)` in `odpis_log` + claim-then-write with compensation
  (`src/lib/server/money.ts`) — never weaken; the "Uvoľniť" action on /odpisy is the
  only sanctioned release path.
- Temp files in the watched import dir must never match `*.xlsx` (Money watcher races).

## Secrets

`.env` / `.env.*` are gitignored. Keep SQLite DB files and any Montalu/Excel data OUT of
git — add `*.db` / `*.sqlite` / a `data/` ignore if they land in the tree. Credentials
live in local memory, never committed (per security-basics).

## Playbook router

Load the matching skill BEFORE working on that area (don't re-derive):
- eslint / prettier / lint config / version-label fallback → auto-loads
  `.claude/rules/lint-formatting.md` on its `paths:`
- deploy / post-deploy E2E / LIVE flip → load `.claude/skills/deploy`
- Money odpis / článkové kódy / nový systém-štýl / compute → load `.claude/skills/money-odpis`
- unit/E2E test runs, local Playwright verification → load `.claude/skills/testing`
- roles / b2b / route gating / Money-write boundary / auth migration → load `.claude/skills/access-control`
- pridávam NOVÚ stránku/route (exporty, b2b denylist, nav, `$effect` slučka) → load `.claude/skills/nova-stranka`
- FIX (pevné zasklenie) modul → auto-loads `.claude/rules/fix-module.md` on its `paths:`
- server-side wall-clock timestamp zobrazovaný na obrazovke/tlači → auto-loads
  `.claude/rules/timestamps.md` on its `paths:` (Docker nemá TZ → UTC default gotcha)
- `.github/workflows/*.yml` (CI/deploy pipeline) → auto-loads `.claude/rules/ci.md`
  on its `paths:` (zombie run recovery, `workflow_dispatch` retry, deploy-landed check)
- `src/routes/zasklenia/+page.svelte` (smart-default checkbox, reštart-efekt poradie)
  → auto-loads `.claude/rules/zasklenia-form-reactivity.md` on its `paths:`
- `src/lib/vykres/**`, `src/lib/components/vykres/**` (kóta helper, výkresový
  hárok) → auto-loads `.claude/rules/vykres.md` on its `paths:` (route-scoped
  `@page` print, SVG arc sweep round-trip check)
- pergola/zasklenia/bazén `odoslat` akcie, `vstup.ts` (nové pole do `odpis_log.detail`,
  FormData `\r\n` test gotcha) → auto-loads `.claude/rules/odpis-detail.md` on its `paths:`
