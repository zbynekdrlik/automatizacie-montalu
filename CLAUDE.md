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
- interim cenotvorba bazéna (update-pools endpoint, produkt-aware cena dispatch, systemKod, DPH boundary) → `.claude/rules/konfigurator-bazen-cena.md`
- interim cenotvorba zimnej záhrady (update-winter-gardens, length=hĺbka pasca, round-UP mriezka, systemKod display-only, model≠cenotvorná os) → `.claude/rules/konfigurator-zimna-zahrada-cena.md`
- interim cenotvorba oplotenia (update-fencings endpoint, typ×model×výška×šírka×počet, kompozitný systemKod, per-typ obálka, DPH boundary) → `.claude/rules/konfigurator-oplotenie-cena.md`
- cenníkové rozmerové OBÁLKY do UI (per-typ oplotenie / per-model bazén; odvodenie zo seedu, mimo-obálky hláška, anti-drift, rozšírenie na ďalší produkt) → `.claude/rules/konfigurator-obalky.md`
- zdieľané cenové helpery 4 modulov (cennik-spolocne.ts DPH/EUR/hash/label + cenaThrottle vypocet throttle shell; pri 5. produkte IMPORTUJ, nekopíruj) → `.claude/rules/cennik-spolocne.md`
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
- `zasklenia/+page.svelte` smart-default checkbox / reštart-efekt / config-derivované form gaty (maFab/maFarbu) / system-aware `defaultSklo` → `.claude/rules/zasklenia-form-reactivity.md`
- kóta helper / výkresový hárok (vykres) → `.claude/rules/vykres.md`
- pergola nárez/výkres z rozmerov → `.claude/rules/pergola-narez.md`
- pergola/zasklenia/bazén `odoslat` akcie, `vstup.ts` → `.claude/rules/odpis-detail.md`
- bazén kusové komponenty (BPK*, computeBazenAll, mj ks, model whitelist, E2E prefix kolízia) → `.claude/rules/bazen-komponenty.md`
- CLIP zábradlie nárez + Money odpis (#372, parametrický vzorec, honest-null, whitelist, rozšírenie po Patrikovi = dáta) → `.claude/rules/clip.md`
- odpad z nárezov (offcut/zvyšky tyčí — zdroj `ffdPack`, per-profil v `RozpisRezov`, súčet `sumaOdpad`, len zasklenia; Money-neutrálne) → `.claude/rules/odpad.md`
- verejný dopyt / PDF ponuka s orientačnou cenou / slovenský text v pdf-lib / DopytForm → `.claude/rules/dopyt-ponuka.md`
- Odoo CRM lead z dopytu (XML-RPC, dvojité escapovanie, súbeh/retry, štartový sweep) → `.claude/rules/odoo-lead.md`
- interný zoznam materiálu zákazky → Odoo sale.order log-note (odoo-rpc, mt_note, observer hook, ZAK/OP match) → `.claude/rules/odoo-zakazka.md`
- 1000-r. strop pre celé `src/**` (split vzory) → `.claude/rules/large-file-split.md`
- e2e zero-console assert + guard (`e2e/**`, `tests/e2e-console-guard.test.ts`) → `.claude/rules/e2e-console.md`
- celoplošný vizuálny redizajn (`--m-*` tokeny, h1/app.css leak pasca, stage rollout) → `.claude/rules/redizajn.md`
