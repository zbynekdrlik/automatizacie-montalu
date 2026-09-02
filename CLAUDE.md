# automatizacie-montalu — Project Instructions

## Overview

SvelteKit web app (TypeScript + Vite) for **Montalu automations**. Reads/writes Excel
(`exceljs`) and persists to SQLite (`better-sqlite3`). Scaffolded from `sv create`
(minimal, TS). The global airuleset rules (`~/.claude/CLAUDE.md`) apply on top of this file.

## Dashboards

- **Prod:** `https://app.montalu.cloud` — health + deployed version: `https://app.montalu.cloud/health`
- **No dev environment** — there is only prod; there is no dev URL. Verify changes
  locally (`npm run preview` + Playwright); post-deploy verification reads the version
  label from the prod DOM (see "CI + deploy").

## Branch model

Two branches: `main` (production) + `dev` (development). All work on `dev`; open a PR
dev→main when ready. Merge commits only (no squash/rebase). Auto-merge default — no
`<!-- airuleset:merge=manual -->` marker (only the user adds one).

## Version

Version file: `package.json` `"version"` — the web UI must display it (footer
`data-testid="version"`, see "CI + deploy"). Every-ticket rule:

1. Bump to the next `-dev.N` **FIRST**, before any work (so `dev` > `main`).
2. Right before opening the dev→main PR, bump to the clean released `X.Y.Z` (no `-dev`).
3. Before opening the PR, `Read` `package.json` and confirm it has **no** `-dev` suffix
   — don't trust that you bumped it earlier (#174: a `-dev.1` reached `main` live).

Bump MECHANICS (tab-preserving edit, never `JSON.stringify` — #161) and the recovery
when a `-dev.N` already landed on `main` (#98/#174 `sort -V`) → auto-loads
`.claude/rules/version-bump.md` on `package.json` / `.github/workflows/ci.yml`.

## Working in this repo as a montalu4 sub-dev stream

This repo is developed by the **owner** directly (the sections above describe the owner's
dev→main release flow). A **montalu4 sub-dev stream** (an odoo-erp sidecar-integration
worker, epic odoo-erp#5808) also lands app-side changes here, with a DIFFERENT contract:

- **Access = a per-repo GitHub App token** (`~/.config/gh-app-tokens/zbynekdrlik__automatizacie-montalu`),
  delivered to the subdev box. `git` picks it up via the credential helper; `gh` needs it
  explicitly (`GH_TOKEN="$(gh-app-token zbynekdrlik/automatizacie-montalu)" gh -R zbynekdrlik/automatizacie-montalu …`).
  Run all git/gh from a **clone** in your own scratch dir (never the odoo-erp checkout).
- **Stream PRs target `dev` and STOP at the green PR — NEVER merge.** The merge/deploy
  decision (and the `dev→main` release + version-bump-to-clean-`X.Y.Z`) is the OWNER's —
  `main` = live VPS deploy (167.233.125.9). Do not merge, do not push `main`.
- **There is NO PR-triggered CI** — `ci.yml` runs only on push to `dev`/`main`. A "clean"/
  green PR proves nothing on its own. So run the CI-equivalent gates **locally before
  pushing** and cite the results: `npm run lint`, `npm run check`, `npm test`, **and
  `npm run build`** (yes, locally — the owner's "vite build = CI only" rule above assumes
  PR-CI, which a stream branch never gets), plus a Playwright E2E run.
- **The App token has no `workflows` permission** — any `.github/workflows/**` change is
  rejected on push. Deliver a workflow change as a `git format-patch` inside a
  `GATEKEEPER-ACTION:` comment on the odoo-erp ticket, not a push here.
- **Version: bump only when the version-check needs it.** The gate is `dev` version >
  `main` version. If `dev` is already ahead of `main` (the usual case), a stream PR needs
  **no** bump — resolve `package.json` to `dev`'s current `-dev.N` on re-sync. (The owner's
  "bump `-dev.N` first every ticket" above is the dev→main release cadence, not per stream PR.)
- **Re-sync with `origin/dev` right before pushing** — the owner develops concurrently, so
  `dev` moves under you; confirm `git diff --stat origin/dev HEAD` shows ONLY your files.
- **Env-gated, live-safe changes.** A change that alters serving/deploy (base path, headers,
  cookies) MUST be env-gated with defaults that keep today's live behaviour byte-identical,
  and land atomically in one PR (the live app is used daily). Ticket odoo-erp#5822 is the
  reference: `APP_BASE_PATH` (build-time base path, default `''`) + `APP_FRAME_ANCESTORS`
  (runtime CSP `frame-ancestors`, default = keep `X-Frame-Options: DENY`).

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

Load the matching entry BEFORE working on that area (rules auto-load on their `paths:`;
skills load only on an explicit `Skill` call by name) — one line per area:

- lint / prettier / eslint config / version-label fallback → `.claude/rules/lint-formatting.md`
- version bump mechanics (tabs/#161) + `-dev`-on-`main` recovery (#98/#174) → `.claude/rules/version-bump.md`
- deploy / post-deploy E2E / LIVE flip → skill `.claude/skills/deploy`
- Money odpis / článkové kódy / nový systém-štýl / compute → skill `.claude/skills/money-odpis`
- NOVÁ stránka/route (exporty, b2b denylist, nav, `$effect` slučka) → skill `.claude/skills/nova-stranka`
- roly / b2b / route gating / Money-write boundary / auth migrácia → `.claude/rules/access-control.md`
- VEREJNÁ route `/konfigurator` (bez auth) + zákaznícka vrstva bez cien, únik/Money guard → `.claude/rules/konfigurator.md`
- interim cenotvorba pergoly (matica montalu.sk, endpoint, DPH half-up, seed/parity/drift) → `.claude/rules/konfigurator-cena.md`
- SvelteKit form actions (`default` vs pomenované — nedajú sa miešať) → `.claude/rules/sveltekit-actions.md`
- login brute-force throttle / timing oracle / bezpečnostné hlavičky / getClientAddress za Caddy → `.claude/rules/login-hardening.md`
- unit/E2E test behy, lokálna Playwright verifikácia → `.claude/rules/testing.md`
- štruktúrovaný logger (`log.ts`), handleError, chybová stránka, testovanie logov → `.claude/rules/logging.md`
- SQLite/Money durability (synchronous pin, fsync zápis, v24 audit) → `.claude/rules/db-durability.md`
- pridanie novej SQLite migrácie (seed-extrakcia, 1000-r. strop, head-bump ~23 testov, v25/v26 stĺpce) → `.claude/rules/migrations.md`
- pridanie nového `writeOdpis` block-reason (audited-override 6-touch checklist) → `.claude/rules/money-block-reason.md`
- katalóg skiel, pridanie/zmena skla, Money-neutralita skla, migračná pasca → `.claude/rules/glass-catalog.md`
- ceny materiálu / cena skla / denný Money snapshot → `.claude/rules/ceny-snapshot.md`
- POST-import readback z Money DB (money_dlv snapshot, /odpisy overenie, exkluzívne párovanie) → `.claude/rules/money-readback.md`
- cenový zoznam k zákazke `/odpisy/zakazka/[zak]` (agregácia, zak_norm legacy pasca, ReadbackBadge) → `.claude/rules/zakazka-ceny.md`
- FIX (pevné zasklenie) modul → `.claude/rules/fix-module.md`
- server-side wall-clock timestamp na obrazovke/tlači (UTC default pasca) → `.claude/rules/timestamps.md`
- `.github/workflows/*.yml` CI/deploy pipeline → `.claude/rules/ci.md`
- štruktúrovaný logger (`log.ts`) / handleError / chybová stránka / testovanie logov → `.claude/rules/logging.md`
- three.js 3D náhľad (vizual) → `.claude/rules/vizual3d.md`
- `zasklenia/+page.svelte` smart-default checkbox / reštart-efekt poradie → `.claude/rules/zasklenia-form-reactivity.md`
- kóta helper / výkresový hárok (vykres) → `.claude/rules/vykres.md`
- pergola nárez/výkres z rozmerov → `.claude/rules/pergola-narez.md`
- pergola/zasklenia/bazén `odoslat` akcie, `vstup.ts` → `.claude/rules/odpis-detail.md`
- bazén kusové komponenty (BPK*, computeBazenAll, mj ks, model whitelist, E2E prefix kolízia) → `.claude/rules/bazen-komponenty.md`
- CLIP zábradlie nárez + Money odpis (#372, parametrický vzorec, honest-null, whitelist, rozšírenie po Patrikovi = dáta) → `.claude/rules/clip.md`
- verejný dopyt / PDF ponuka s orientačnou cenou / slovenský text v pdf-lib / DopytForm → `.claude/rules/dopyt-ponuka.md`
- Odoo CRM lead z dopytu (XML-RPC, dvojité escapovanie, súbeh/retry, štartový sweep) → `.claude/rules/odoo-lead.md`
- interný zoznam materiálu zákazky → Odoo sale.order log-note (odoo-rpc, mt_note, observer hook, ZAK/OP match) → `.claude/rules/odoo-zakazka.md`
- SSO cez Odoo session (interní = Odoo účet; undici stripuje Host → node:http; efemérna identita, env-gated) → `.claude/rules/odoo-sso.md`
- odpis materiálu → Odoo montalu.material.odpis paralelne s Money (append-only log, cross-pass FIFO, silný sha256 dedup kľúč, aj-aj) → `.claude/rules/odoo-odpis-push.md`
- 1000-r. strop pre celé `src/**` (split vzory) → `.claude/rules/large-file-split.md`
- e2e zero-console assert + guard (`e2e/**`, `tests/e2e-console-guard.test.ts`) → `.claude/rules/e2e-console.md`
- celoplošný vizuálny redizajn (`--m-*` tokeny, h1/app.css leak pasca, stage rollout) → `.claude/rules/redizajn.md`
