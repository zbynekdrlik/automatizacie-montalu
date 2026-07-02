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
the foundation gap below.

## Local build policy (Tier 0)

- Before pushing, run the cheap type gate locally: `npm run check` (svelte-check = tsc,
  no bundle) — fix errors before push.
- `npm run build` / `vite build` is a bundler build → **CI only, not local** (no-local-builds).
- No eslint/prettier configured yet — `svelte-check` is the current type gate.
- `better-sqlite3` is a native module (needs a compile step on `npm ci`).

## Testing

- Unit: **Vitest**. E2E: **Playwright** through the real browser (e2e-real-user-testing) —
  every E2E asserts **zero console errors/warnings** (browser-console-zero-errors).
- Both are dev-deps already; the `test` scripts + CI wiring are a foundation gap (below).
- Bug fixes: RED regression test committed BEFORE the fix (regression-test-first).

## Foundation gaps (tracked as issues — address before/with feature work)

- **No CI pipeline** (`.github/workflows` absent) — check/lint/test/build/coverage gates missing.
- **No visible version label** on the UI (version-on-dashboard) + no E2E asserting its format.

## Secrets

`.env` / `.env.*` are gitignored. Keep SQLite DB files and any Montalu/Excel data OUT of
git — add `*.db` / `*.sqlite` / a `data/` ignore if they land in the tree. Credentials
live in local memory, never committed (per security-basics).

## Playbook router

Load the matching skill BEFORE working on that area (don't re-derive):
- (none yet — add `.claude/skills/<area>/SKILL.md` as procedures/gotchas accumulate,
  per project-playbook-maintenance)
