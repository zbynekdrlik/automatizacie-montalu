# automatizacie-montalu

SvelteKit (TypeScript + Vite) web app for **Montalu automations**. It computes glazing/
construction jobs from dimensions and writes the resulting **Money odpis** (`.xlsx`
material-consumption sheets) into the Money accounting import — for zasklenia, pergola,
bazén, FIX (pevné zasklenie) and sieťka. It also renders workshop cut-lists (nárez) and
technical drawings (výkres). Data is read/written with `exceljs` and persisted in SQLite
(`better-sqlite3`).

> Project conventions, Money-safety rules, versioning and the playbook router live in
> [`CLAUDE.md`](./CLAUDE.md). Read it before working here.

## Module map (route ↔ server)

Each user-facing area is a SvelteKit route under `src/routes/` backed by pure compute +
input serialization in `src/lib/server/`:

| Route (`src/routes/`) | Server (`src/lib/server/`) | What it does |
|---|---|---|
| `zasklenia` | `compute.ts`, `vstup.ts`, `b2b-limits.ts` | Glazing quote + odpis (the one page b2b may open) |
| `pergola`, `pergola/narez` | `pergola.ts`, `pergola-narez-vstup.ts`, `pergola-rezervacia.ts` | Pergola quote, cut-list + drawing, reservation odpis |
| `bazen` | `bazen.ts`, `bazen-navrh-vstup.ts` | Pool cover quote + odpis |
| `fix` | `fix-vstup.ts` | Fixed-glazing (FIX) quote + odpis |
| `sietka` | `sietka-samostatna.ts` | Standalone insect-screen quote + odpis |
| `optimalizator` | `optimalizator.ts`, `optimalizator-vstup.ts` | Cut optimization |
| `odpisy` | `money.ts` | Money odpis log + the sanctioned "Uvoľniť" release |
| `ulozit-ponuku` (#5960) | `odoo-quote.ts`, `odoo-call-kw.ts`, `ulozit-ponuku-client.ts` | "Uložiť ponuku" → Odoo `sale.order` as the logged-in Odoo user (SSO session forwarded via `call_kw`, never a shared key); `UlozitPonuku.svelte` button seam wired per calculator at go-live #5820 |
| `pouzivatelia`, `login`, `logout` | `auth.ts`, `b2b-access.ts` | Auth, roles (internal / b2b), route gating |
| `vykresy`, `problem`, `health` | `db.ts`, `migracie.ts`, `ceny.ts`, `sklo-cena.ts` | Drawings, feedback, health/version, prices, DB + migrations |

## Run

```sh
npm ci                 # installs deps (better-sqlite3 compiles natively)
npm run dev            # dev server (add -- --open to launch a browser tab)
npm run check          # svelte-check (tsc, no bundle) — run before every push
npm run lint           # eslint + prettier --check — run before every push
```

`npm run build` / `vite build` is a bundler build and runs in **CI only**, not locally.

## Test

```sh
npm test               # unit — Vitest with coverage (thresholds in vite.config.ts)
npx playwright test    # E2E — real browser, asserts zero console errors/warnings
```

Without `BASE_URL`, Playwright builds and serves a local preview. With
`BASE_URL=<deployed-url>` it runs against a live deployment; **write tests auto-skip when
the target reports `live: true` on `/health`**, so test data can never reach the real
Money import. Bug fixes ship a RED regression test committed before the GREEN fix.

## Deploy

CI deploys `dev`→`main` merges to the VPS (docker compose build from the rsynced ref,
health + version verified). The full manual/verification procedure is in
[`.claude/skills/deploy`](./.claude/skills/deploy/SKILL.md). Live app + health:
`https://app.montalu.cloud` (`/health`).

## Money safety

Nothing test-related may ever reach the live Money import. `MONEY_LIVE=1` on the VPS is
the only switch that lets writes through, and flipping it is the user's call. The full
hard rules (dedup, release path, watched-dir naming) are in
[`CLAUDE.md`](./CLAUDE.md#money-safety-the-hard-rules).
