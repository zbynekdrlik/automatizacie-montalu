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

## `glass_order` API export do Odoo + špecifikácia tabule pre IZOS oceňovanie (#521)

Objednávka skla sa DNES posiela do Odoo cez `POST /json/2/sale.order/montalu_narezak_upload`
s `glass_order.items[]` (NIE už len „Odoo číta SQLite" — to bol pôvodný #496 zámer; skutočný
kontrakt je API). Kód:

- **Payload builder** `buildGlassOrder(items)` + `derivGlassComposition(typSkla)` sú v
  `src/lib/server/odoo-rozpis-lines.ts` (deklarovaný „domov payload shapingu"). Čisté, žiadny IO.
- **Upload** `uploadGlassOrderToOdoo(zak)` v `src/lib/server/odoo-glass-order-upload.ts` —
  reuse `odoo-json2` (`callJson2`/`odooJson2Config`/`isNarezUploadEnabled`), OP z
  `zakazkaPrehlad` (live-first, ako plan-rezov upload), `kind='sklo'`, `doc_id='glass-order-<zak>-<op>'`,
  fire-and-forget, **Money-NEUTRÁLNE** (objednávka u dodávateľa skla). VŽDY vráti postavený
  `payload` (pre náhľad na podklade), aj keď upload vypnutý/zlyhal; NIKDY nehádže.
- **Podklad** `/objednavka-skla/[zak]`: per-riadok `<details>` „Ďalšie možnosti (zriedkavé)"
  (default off) → akcia `ulozitSpec`; akcia `odoslatDoOdoo` (náhľad `<pre data-testid="glass-order-payload">`
  + gated upload). Keď `ODOO_NAREZ_UPLOAD_ENABLED !== 1` → len náhľad, PROD Odoo sa NEVOLÁ.

### Spec kľúče (PLOCHÉ na item, NIE vnorené pod `spec`)

Kontrakt: `zbynekdrlik/odoo-erp` `.claude/rules/montalu-narezak-upload.md` (@ develop po #7378).
5 základných kľúčov (`width_mm/height_mm/glass_type/qty/note`) je BIT-IDENTICKÝCH keď žiadny spec.
Voliteľné (pridané LEN keď non-default): `composition`, `spacer_mm`, `warm_edge`, `colored_frame`,
`muntin_cross_qty`, `holes_qty`, `hole_size` (`d30` 4–30mm | `d50` 31–50mm — **posiela sa VŽDY keď
holes_qty>0, default d30**, lebo Odoo defaultne na d50/vyššiu sadzbu), `cutout_small_qty`,
`cutout_large_qty`, `edge_finish` (`none|ksr|trapez_brusena|trapez_lestena`, `none` sa vynecháva),
`hst`, `tempering_own_glass`. `catalog_code` appka NEPOZNÁ (IZOS kódy) → neposiela.

### Derivácia `composition` z `typ_skla` (KONZERVATÍVNA — radšej vynechať než mis-price)

`typ_skla` je voľnotextový názov (žiadna katalóg→zloženie mapa v `sklo.ts`). `derivGlassComposition`:

| vzor `typ_skla` | composition | spacer_mm |
|---|---|---|
| IZO `A/B/C`\|`A.B.C` (aj `5esg/14/5esg`), stred `B>=6` | `A-B-C` (+` ESG` ak „esg"/„kalen") | `B` |
| jednosklo `N mm` + kalené/esg | `N ESG` | — |
| jednosklo `N mm` bez kalenia | `N` | — |
| VSG kód `dd.d` (44.2) / `d.d.d` (3.3.1, 4.4.2) | ten kód | — |
| „polykarbonát…" / nerozpoznané | — (omit) | — |

Guard `B>=6` odlíši IZO od VSG kódu (`3.3.1`→B=3<6 → NIE IZO). Odoo mapuje `glass_type`
tolerantne aj bez `composition`, takže vynechanie je bezpečné; NESPRÁVNE zloženie by mis-priclo.

### Perzistencia + migrácia

Spec kľúče, ktoré appka nevie z katalógu, sa ukladajú do `objednavka_skla` `spec_*` stĺpcov
(migrácia **v48**, aditívne ADD COLUMN, defaulty vypnuté → existujúce toky byte-identické).
`nastavSpec(id, spec)` validuje (neplatný počet/hrana = throw pred zápisom → akcia `fail(400)`);
`mapSpec` normalizuje neplatné uložené texty na predvolené. Deriváty (composition/spacer) sa
NEUKLADAJÚ — počítajú sa pri builde z `typ_skla`.

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

## Odoo typy skla = OBJEDNÁVKOVÝ picker + auto glass_order pri pláne so sklom (#540)

Dve nezávislé, aditívne, Money-NEUTRÁLNE zmeny (Prístup 1). **Odoo `montalu.glass.type` je ORDERING
zoznam, NIKDY nenahrádza výpočtový katalóg** (viď `glass-catalog.md`).

### (1a) Picker typu skla z Odoo — deliaca čiara „objednávka vs výpočet"

- Zoznam typov v riadku `/objednavka-skla/[zak]` je `<select name="typ_skla">` plnený z
  **`fetchGlassTypes()`** (`src/lib/server/odoo-glass-types.ts`): `montalu.glass.type` `search_read`
  domain `[["active","=",true]]`, fields `code,name,composition_spec`, order `name`, cez generický
  **`searchReadJson2`** (`odoo-json2.ts`, ČISTÝ transport bez `db` väzby — fallback žije v samostatnom
  module, aby `odoo-json2` testy nebootovali native sqlite).
- **In-process cache ~5 min** (aj fallback → auto-heal po oprave Odoo). **Fallback pri AKEJKOĽVEK
  chybe** (403/sieť/timeout) alebo keď integrácia nie je nakonfigurovaná: LOKÁLNY zoznam z
  `listGlassTypes()` (`code=name=nazov`, dedup podľa názvu), **warn LEN RAZ za proces** (config-absent
  v deve NIE je chyba → nevaruje). `source: 'odoo'|'local'` sa zobrazí v UI (`data-testid=
  "glass-types-source"`) — nikdy tichý prázdny select.
- **Úložisko zvoleného typu = existujúci `typ_skla` stĺpec (BEZ migrácie).** Akcia `nastavTyp` →
  `nastavTypSkla(id, code)` uloží Odoo `code` do `typ_skla` = `glass_order.items[].glass_type` (cez
  doterajší `buildGlassOrderItem`). Staré podklady (voľnotext `typ_skla`) ostávajú spätne kompatibilné
  — mapovanie sa nemení. NIKDY sa nedotýka `glass_types` katalógu / `migracie.ts` / compute cesty.
- Tlač: `typ_skla` sa vytlačí cez `.print-only` span (select je `.noprint`).

### (1b) Auto glass_order pri uložení plánu rezov so sklom

- Po ÚSPEŠNOM `uploadNarezak` v `uploadPlanRezovToOdoo` (`odoo-plan-rezov-upload.ts`) sa **best-effort**
  pošle `uploadGlassOrderToOdoo(zak, op)` na TÚ ISTÚ OP. `uploadGlassOrderToOdoo` dostal voliteľný
  **explicitný `op` override** — auto-send posiela op nárezáku priamo (nie `zakazkaOp` re-derive);
  explicitná akcia `odoslatDoOdoo` (bez op) ostáva a re-derivuje.
- **Best-effort ako PDF príloha:** zlyhanie glass_order NIKDY nezhodí nárezák upload (log warn).
  `uploadGlassOrderToOdoo` sám vráti `no-items` keď zákazka nemá sklo (žiadny Odoo call).
- **Idempotentný `doc_id` `glass-order-<zak>-<op>`** → neskoršia ručná akcia na /objednavka-skla tú
  istú objednávku len prepíše (nová verzia), nevytvorí druhú.
- Wiring používa **DYNAMICKÝ import** `odoo-glass-order-upload` — drží STATICKÝ graf
  `odoo-plan-rezov-upload` bez `db` väzby (jeho test je zámerne db-free; mockne `uploadGlassOrderToOdoo`).
- **VEDOME MIMO scope:** backfill (`backfill-narezaky-deps.ts`) auto-send NEmá — bulk retroaktívne
  objednávky skla za mesiac by mohli duplikovať už ručne zadané objednávky u dodávateľa (design
  Architektúra scope-uje (ii) na ŽIVÉ plán-rezov uloženie). Prípadné doplnenie = samostatné rozhodnutie.
