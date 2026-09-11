---
paths:
  - "src/routes/objednavka-skla/**"
  - "src/lib/server/objednavka-skla.ts"
  - "src/routes/zasklenia/+page.server.ts"
  - "src/routes/fix/+page.server.ts"
  - "src/routes/pergola/narez/+page.server.ts"
---

# Objednávka skla — gotchas (#496)

## File upload: server-side extension allowlist + forced MIME

Client-side `accept` attribute on `<input type="file">` is UX only — a forged POST
bypasses it. The server action (`nahratSubor`) enforces `ALLOWED_EXTENSIONS` and ALWAYS
stores `application/octet-stream` as the MIME type. The download endpoint
(`/objednavka-skla/subor/[id]`) serves with `application/octet-stream` regardless of
what was uploaded. This prevents stored XSS from user-uploaded HTML files served from
the app's origin.

**Adding new allowed extensions:** update `ALLOWED_EXTENSIONS` in
`src/routes/objednavka-skla/[zak]/+page.server.ts` AND the `accept` attribute in
`src/routes/objednavka-skla/[zak]/+page.svelte`.

## BODY_SIZE_LIMIT coupling with MAX_SUBOR_VELKOST

`deploy/docker-compose.yml` sets `BODY_SIZE_LIMIT: 12M` (adapter-node, raised from 1M in
round 2). This covers `MAX_SUBOR_VELKOST` (10 MB) + multipart overhead. If
`MAX_SUBOR_VELKOST` is raised above 10 MB, also raise `BODY_SIZE_LIMIT` to match + 2 MB
headroom.

## Handoff contract for Odoo subdev

The Odoo side reads from two SQLite tables:
- `objednavka_skla` — glass order items (zak, op, modul, dimensions, type, count, rezim)
- `objednavka_skla_subory` — file attachments (polozka_id FK, nazov, data BLOB)

The FK has `ON DELETE CASCADE` — deleting a glass item auto-deletes its files.
`foreign_keys = ON` is set in `db.ts` at connection time.

## Module integration (producers) — WIRED (round 2)

Each module page has a `pridatSkla` (or `pridatSklaMulti`) named form action that
re-computes glass from form data and inserts. B2B guard rejects non-internal users.
`/fix` + `/pergola/narez` insert via `pridajSklaHromadne()` and **redirect** to
`/objednavka-skla/[zak]`. **`/zasklenia` is the EXCEPTION since #514** (see the #514
section below): it inserts idempotently and STAYS on the result screen instead of
redirecting.

| Module | Action | Glass source | Mapping |
|---|---|---|---|
| `/zasklenia` | `pridatSkla` | `ComputeResult.sklo: { sirka, vyska, pocet }` | 1 item per posuv |
| `/zasklenia` | `pridatSklaMulti` | `MultiResult.posuvy[i].sklo` | N items (per posuv) |
| `/fix` | `pridatSkla` | `FixVykres.polia[]: { sirka, vLavo, vPravo }` | N items (per pole); sikmy→vLavo/vPravo, rovny→vyska |
| `/pergola/narez` | `pridatSkla` | `StrechaSkloVypocet: { sirkaMm, dlzkaMm, pocetTabul, typ }` | 1 item; honest-null gate (no insert when sirkaMm, dlzkaMm, or pocetTabul is null) |

**ZAK/OP source per module:** zasklenia uses `parseVstup().zak/.op`, FIX uses
`parseFixVstup().zak/.op`, pergola uses `parseIdent(form).zak/.op` (separate from
pergola dimensions input). ZAK normalization: `normZak()` in the CRUD module handles
the `zak_norm` column (same as `zakazka-ceny.ts` pattern).

**Key discipline:** every action re-computes from raw form inputs (never trusts
client-sent computed values) — the same discipline as `odoslat`/`nahlad` actions.

**Adding a new producer module:** add a `pridatSkla` named action to the module's
`+page.server.ts`, import `pridajSklaHromadne` + `NoveSklo`, map the module's glass
output to `NoveSklo[]`, redirect to `/objednavka-skla/[zak]`. Add the route path to
this rule's `paths:` frontmatter. Add a vitest in `tests/objednavka-skla-producenti.test.ts`.

## `/zasklenia`: obe akcie („Odoslať sklo" + „uložiť nárezák") v ľubovoľnom poradí (#514)

Odoo úloha 885 (Marek): na výsledkovej obrazovke zasklení sa „Odoslať sklo" (`pridatSkla`)
a „uložiť nárezák" (= `odoslat`, Money odpis) vzájomne vylučovali — `pridatSkla`
`redirect(303)` odnavigoval preč (odpis zmizol), a po odpise (`step:'hotovo'`) chýbalo
sklo-tlačidlo. Oprava (Money-NEUTRÁLNA — `writeOdpis`/`money.ts`/dedup/xlsx SA NEDOTÝKA):

- `pridatSkla`/`pridatSklaMulti` **už NEpresmerúva** — vráti späť `nahlad`/`nahladMulti`
  s plným payloadom (cez zdieľané server-helpery `stavNahlad`/`stavNahladMulti`, ktoré
  ťahá aj `nahlad`/`nahladMulti`) + `sklaPridane:{pridane,zak}`; odpisové tlačidlo zostáva.
- **Poradie NEZÁLEŽÍ:** vetvy `hotovo`/`hotovoMulti` (`+page.svelte`) majú `?/pridatSkla`
  (resp. Multi) formulár (gated `{#if !isB2B}`), takže sklo ide aj PO odpise.
- **Potvrdenie:** `{#snippet sklaPridaneBanner()}` (`data-testid="skla-pridane"` + odkaz
  `resolve(\`/objednavka-skla/${encodeURIComponent(zak)}\`)`) na nahlad AJ nahladMulti.
- **Idempotencia (dvojklik neduplikuje):** zasklenia používa
  `pridajSklaHromadneIdempotentne()` (NIE `pridajSklaHromadne`) — preskočí už existujúci
  riadok podľa null-safe `IS` zhody na identite (`zak_norm,op,modul,popis,sirka_mm,
  vyska_mm,v_lavo_mm,v_pravo_mm,pocet,typ_skla`), vráti počet NOVO vložených. `modul`
  v identite izoluje /fix + /pergola riadky; multi popis `Zasklenie ${i+1}` nespojí dva
  identické posuvy. `pridajSklaHromadne` (bez dedupu) ostáva pre /fix + /pergola.
- **Poradie v akcii:** náhľad (`stavNahlad`) zostav PRED `pridajSklaHromadneIdempotentne`
  (validácia pred vedľajším efektom — kovanie-fail nevloží sklá).
- **Existujúci `objednavka-skla.spec.ts`** overuje handoff cez klik na `skla-pridane-odkaz`
  (NIE cez auto-redirect); nový regres je `e2e/zasklenia-akcie-poradie.spec.ts` (oba smery
  + idempotencia, zero-console) + `tests/zasklenia-akcie-poradie.test.ts` (akcia nevracia
  redirect, vracia `sklaPridane`).

## Testing gotcha: glass type names must be EXACT catalog matches

`spocitajStrechaSklo` (pergola) checks glass type against `SKLO_STRECHA_TYPY` in
`src/lib/sklo-strecha.ts` — e.g. `'4.4.2 číre'`, `'5.5.2 mliečne'`, `'polykarbonát 16 mm číry'`.
A generic description like `'Lepené bezp. sklo (VSG)'` is NOT in the catalog and will
return `null` for all dimensions. Always use an EXACT `nazov` from `SKLO_STRECHA_TYPY`
in tests. Similarly, zasklenia glass types must match `listGlassTypes()` (`glass_types`
seed table). FIX glass type (`vstup.sklo`) is free text (no catalog validation).
