---
paths:
  - "src/routes/objednavka-skla/**"
  - "e2e/objednavka-skla*.spec.ts"
  - "src/lib/server/objednavka-skla.ts"
  - "src/lib/server/money-nazov-skla.ts"
  - "src/lib/objednavka-skla-pozicia.ts"
  - "src/lib/objednavka-skla-typy.ts"
  - "src/lib/server/objednavka-skla-odoslanie.ts"
  - "src/lib/sklo-otvory.ts"
  - "src/lib/server/sklo-otvor-pdf.ts"
  - "src/lib/server/odoo-glass-order-upload.ts"
  - "src/lib/components/zasklenia/SkloOtvoryRozpis.svelte"
  - "src/lib/components/Nahlad2D.svelte"
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
| `/zasklenia` | `pridatSkla` | `ComputeResult.sklo: { sirka, vyska, pocet }` | 1 item per posuv (Deluxe: s otvorom + bez, #578 `sklaPosuvu`) |
| `/zasklenia` | `pridatSklaMulti` | `MultiResult.posuvy[i].sklo` | 1–2 items per posuv (`sklaPosuvu`, #578) |
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
  domain `[["active","=",true]]`, order `name`, cez generický **`searchReadJson2`** (`odoo-json2.ts`,
  ČISTÝ transport bez `db` väzby — fallback žije v samostatnom module, aby `odoo-json2` testy
  nebootovali native sqlite).
- **SPRÁVNE polia `montalu.glass.type` = `name,category,cennik_code,composition,active` (#546, relay
  #540 11:18).** POZOR: pôvodná #540 verzia čítala `code`/`composition_spec` — tie na tomto modeli
  NEEXISTUJÚ → Odoo vrátil 500 → appka na PROD trvalo bežala na lokálnom fallbacku (Marekov
  screenshot „Odoo nedostupné"). Picker položka je `GlassTypeOption { value, label, category }`:
  `value = cennik_code || name` (keď `cennik_code` chýba, posiela sa PRESNÝ `name` — Odoo
  `resolve_glass_type` páruje kód → presný názov → zloženie), `label = name (+ ' · ' + composition)`,
  `category` = skupina (IZO/VSG/jednosklo…). `value` je to, čo sa uloží ako `typ_skla` =
  `glass_order.items[].glass_type`. Riadok bez `cennik_code` AJ bez `name` sa vynechá.
- **In-process cache ~5 min** (aj fallback → auto-heal po oprave Odoo). **Fallback pri AKEJKOĽVEK
  chybe** (403/500/sieť/timeout) alebo keď integrácia nie je nakonfigurovaná: LOKÁLNY zoznam z
  `listGlassTypes()` (`value=label=nazov`, `category=''`, dedup podľa názvu), **warn LEN RAZ za
  proces** (config-absent v deve NIE je chyba → nevaruje). `source: 'odoo'|'local'` sa zobrazí v UI
  (`data-testid="glass-types-source"`) — nikdy tichý prázdny select.
- **Úložisko zvoleného typu = existujúci `typ_skla` stĺpec (BEZ migrácie).** Akcia `nastavTyp` →
  `nastavTypSkla(id, value)` uloží `value` do `typ_skla` = `glass_order.items[].glass_type` (cez
  doterajší `buildGlassOrderItem`). Staré podklady (voľnotext `typ_skla`) ostávajú spätne kompatibilné
  — mapovanie sa nemení. NIKDY sa nedotýka `glass_types` katalógu / `migracie.ts` / compute cesty.
- **Konzumenti pickera** používajú `t.value`/`t.label` (NIE staré `t.code`/`t.name`): podklad
  `/objednavka-skla/[zak]` (ručný riadok + per-riadok select) A honest-null pergola formulár
  (`/pergola/narez`, #546 nižšie). Picker sa plní z `data.glassTypes` (load `fetchGlassTypes`).
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

## Ručné riadky (`modul='manual'`) + samostatná objednávka len skla bez odpisu (#545)

Marek (Odoo úloha 951): jeden doklad na zákazku so VŠETKÝMI tabuľami (posuvy z výpočtu +
ATYP + V.O. + priobjednané), a servisná objednávka len skla (rozbité balkónové sklo) BEZ
nárezáku/odpisu. Prístup 1 — pridal producent `manual` + ručné pole OP, žiadna nová route,
žiadna migrácia (stĺpce existujú). Money-NEUTRÁLNE, b2b naďalej zakázané.

- **Producent `manual`** = ďalší zdroj riadkov popri zasklenia/fix/pergola. `pridajSkloManual(s)`
  (`objednavka-skla.ts`) reuse `pridajSklo` s `modul='manual'`: typ skla POVINNÝ (prázdny → throw,
  nič sa neuloží — z pickera `fetchGlassTypes`, Odoo `code` alebo lokálny názov), popis voľný
  („ATYP podľa výkresu", „V.O."), rozmery celé > 0, počet celý >= 1, `m2 = š×v×ks/1e6` (ako FIX),
  `rezim` rozmery|atyp (atyp sa nastaví PO vložení cez `nastavRezim`, lebo `pridajSklo` vkladá
  vždy `rezim='rozmery'`). `MODUL_NAZVY.manual = 'Pridané položky'` (`modul-nazov.ts`) → vlastná
  sekcia „Pridané položky". Akcia `pridatRiadok` re-validuje vstup na serveri (nikdy nedôveruje
  klientovi). Prílohy/spec/mazanie/atyp-upload rovnaké ako iné riadky (`buildGlassOrderItem`
  nezmenený). `manual` riadky sa NEdedupujú (vlastná sekcia, operátor maže).
- **Formulár „Pridať riadok" je MIMO `{#if polozky.length === 0}` guardu** (`+page.svelte`) →
  existuje aj na PRÁZDNOM podklade (servisná zákazka bez výpočtu). Guard obaľuje LEN
  tabuľky/sekcie + OP pole + odoslanie.
- **OP objednávky = jedno OP na celý podklad.** `nastavOpZakazky(zak, op)` (validácia `normOp`,
  throw na prázdne) zapíše do `op` VŠETKÝCH riadkov zákazky (akcia `nastavOp`). Zobrazí sa OP
  z odpisu READ-ONLY keď existuje (`zakazkaOp`, prednosť), inak ručné pole.
- **Upload OP precedencia** (`uploadGlassOrderToOdoo`): `opOverride ?? zakazkaOp(zak) ??
  opPodkladu(zak)`. `opPodkladu` vráti `''` (žiadne OP → `missing`), samotné OP keď sú riadky
  jednotné, `null` keď sa OP riadkov ROZCHÁDZAJÚ (mixed → `missing` s hláškou „nastavte jedno OP").
  Tak servisná zákazka BEZ odpisu odošle s ručným OP z podkladu; `doc_id` `glass-order-<zak>-<op>`
  + Money-neutralita nezmenené. Tlačidlo Odoslať je zapnuté len keď má podklad ≥ 1 riadok A OP.
- **`.xlsx` v upload allowliste** (`ALLOWED_EXTENSIONS` + `accept`) — Money OVSKL-štýl objednávky
  ako v prílohe úlohy 951. Príloh do Odoo `glass_order.items[].attachments` = ČASŤ 3, follow-up
  po potvrdení kontraktu (odoo-erp #7371) — TÁTO zmena ich NErobí.

## Meeting výroba 18.9. — Hrana-only spec, glass.type polia, pergola honest-null, index (#546)

Relay z meetingu (Patrik + Dominik Volek, odoo-erp #7371/#7578). Prístup 1 = štyri malé aditívne
zmeny, žiadna migrácia, Money-neutrálne, b2b naďalej zakázané. Bod 2 (pridať riadok) bol už hotový
(#545); bod 3 („iné sklo" + cena za m²) je OUT (čaká na Odoo kontrakt + cenový stĺpec = migrácia,
owner ho odložil → ops-wait na #546).

- **(a) Skutočné polia `montalu.glass.type`** — viď oprava v #540 sekcii vyššie (`name,category,
  cennik_code,composition,active`; `value = cennik_code || name`). Toto opravilo trvalý PROD 500 →
  lokálny fallback.
- **(b) Spec blok = LEN „Hrana".** Podklad `/objednavka-skla/[zak]/+page.svelte` zobrazuje v
  `<details>` už IBA `spec_edge_finish` (Hrana); ostatných 8 IZOS príplatkov (teplá hrana, farebný
  rámik, priečky kríž, otvory, priemer, výrezy 35×60/60×120, HST, kalenie) je z UI ODSTRÁNENÝCH
  (výroba ich nechce). **NEDOTKNUTÉ:** `validateSpec`, `GLASS_SPEC_OFF`, `spec_*` DB stĺpce,
  `buildGlassOrderItem`. Default riadok → payload BYTE-IDENTICKÝ (skryté polia sa neposielajú).
  **STARÝ riadok s nastavenou hodnotou** skrytého poľa ju ĎALEJ pošle: skryté polia sa echujú cez
  CONDITIONAL `<input type="hidden">` (renderované LEN keď hodnota != default), takže re-save Hrany
  ich NEZMAŽE (`parseSpec` ich prečíta z hidden inputov). `mapSpec`/`nastavSpec` bez zmeny.
- **(c) Pergola honest-null → ručný formulár „Sklo do objednávky".** `/pergola/narez`: keď producent
  strešného skla nepozná rozmery (honest-null #223 — neoverená kotva), na výsledku sa MIESTO tlačidla
  „Pridať sklá do objednávky" zobrazí formulár (typ z pickera `data.glassTypes`, šírka × výška, počet)
  → akcia `pridatSkloRucne` → `pridajSkloManual({ modul: 'pergola' })` (popis „Strešné sklo — <typ>"
  ako automatický producent). Keď producent VIE počítať → dnešné správanie (tlačidlo, žiadny formulár
  navyše). Podmienka honest-null v svelte = presne serverový gate (`sirkaMm/dlzkaMm/pocetTabul`).
  Load pridal `glassTypes`/`glassTypesSource` (`fetchGlassTypes`). `pridajSkloManual` dostal voliteľný
  `modul` override (default `'manual'`).
- **(d) Index `/objednavka-skla` = „Nová objednávka len skla".** `default` akcia (route má LEN
  `default`, žiadne pomenované — sveltekit-actions.md) validuje `normZak`/`normOp` (bez Odoo lookup),
  NIČ neukladá, presmeruje na `/objednavka-skla/<zak>?op=<OP>`. Podklad load číta `?op=` do
  `prefillOp`; OP pole sa predvyplní `podkladOp || prefillOp` (uloží ho `nastavOp` až keď podklad má
  riadky). Servis (popraskané sklá) tak dostane podklad + OP bez odpisu/nárezáku.
- **Testy:** `odoo-glass-types.test.ts` (nové polia + value/label), `objednavka-skla-manual.test.ts`
  (modul override + `op` prenos), `objednavka-skla-index.test.ts` (index redirect + validácia). E2E:
  `objednavka-skla-spec.spec.ts` (rescope na Hrana + skryté polia nie sú v UI), `objednavka-skla.spec.ts`
  (index formulár), `objednavka-skla-pergola.spec.ts` (honest-null → ručné strešné sklo).
- **PASCA — množina akcií `/pergola/narez` je strážená DVOMA drift testami**, nie jedným: pridanie
  akcie (napr. `pridatSkloRucne`) treba pridať do EXPECTED zoznamu v OBOCH: `b2b-route-coverage.test.ts`
  AJ `pergola-narez-money-safety.test.ts` (`akcie routy = form + rezervácia + expedícia, nič viac`).
  Zabudnutý druhý = plná suita padne až po ~5 min serial coverage behu. Pred pridaním akcie na
  `/pergola/narez` grepni `Object.keys(actions).sort()` cez `tests/`.
- **Pergola honest-null riadok NESIE OP** (`pridajSkloManual({ op: ident.op })`, review 🟡) — rovnako
  ako automatický `pridatSkla` producent (`op: ident.op`); inak by operátorom zadané OP z pergola
  formulára zmizlo a muselo sa zadať znova cez `nastavOp`. Ručný podklad `pridatRiadok` OP naďalej
  NEzadáva (jedno OP na CELÝ podklad cez `nastavOp`), takže `pridajSkloManual.op` je default `''`.


## Kontrakt `glass_order` v2 — description, mode, „iné sklo", prílohy per riadok, outcome (#548)

v2 je ADITÍVNE rozšírenie v1 (Odoo intake toleruje neznáme kľúče — appka posiela v2 hneď, kým Odoo
strana #7586 nie je na PROD `glass_type_manual` = DQ „nie je v katalógu"/cena 0, `require_order` sa
nectí, OSK odpoveď chýba — vyrieši sa samo po nasadení). Money-NEUTRÁLNE (cena dodávateľa skla).

- **Builder** (`odoo-rozpis-lines.ts` `buildGlassOrder` teraz vracia `{ order, droppedAttachments }`,
  NIE holý `GlassOrder`): `order.version=2`, `items[].description=popis` (keď je), `items[].mode=rezim`
  ('rozmery'|'atyp', vždy), všetky v1 kľúče nezmenené. Volajúci destrukturuje `{ order }`.
- **mimetype prílohy** = pure `mimetypeZNazvu(nazov)` (jediný zdroj mapy): pdf→application/pdf,
  dxf→application/dxf, dwg→application/acad, step/stp→model/step, igs/iges→model/iges,
  xlsx→…spreadsheetml.sheet, neznáme→application/octet-stream. **POZOR — v komentároch odoo-rozpis-lines.ts
  NEPÍŠ literál `€`** (money-safety source-guard `odoo-rozpis-lines-money-safety.test.ts` skenuje celý
  súbor na `€`); píš „EUR za m2".
- **Strop príloh** `GLASS_ORDER_ATTACH_MAX_BYTES=25 MB` base64 na CELÚ objednávku (`enforceAttachmentCap`):
  nad limitom zahodí NAJVÄČŠIU jednotlivú prílohu (deterministicky), pripíše poznámku „príloha <name>
  vynechaná — limit" na riadok a vráti `droppedAttachments[]`. Prílohy sa načítavajú (`buildGlassOrderForZak`
  `nacitajPrilohy`) LEN pre riadky, ktoré majú súbory (bez BLOB fetchu inak).
- **„Iné sklo" (vlastný typ + cena/m²)** — migrácia **v49** (`typ_skla_manual TEXT NULL`,
  `cena_m2_manual REAL NULL`). `rozriesTypSkla` = XOR: katalógový `typSkla` ALEBO
  (`typSklaManual` + `cenaM2Manual>0`), NIKDY oboje/nič (throw). `pridajSkloManual` ho volá; per-riadok
  akcia `nastavTypManual` (registrovaná v `b2b-route-coverage.test.ts`) prepne existujúci riadok na iné
  sklo a vynuluje `typ_skla`. **SYMETRIA (GK review, KRITICKÉ):** `nastavTypSkla` (prepnutie SPÄŤ na
  katalóg) MUSÍ vynulovať `typ_skla_manual`+`cena_m2_manual` — inak riadok ostane v XOR-zakázanom stave
  a `buildGlassOrderItem` (manuál = `typSklaManual.length>0 && cenaM2Manual>0`) ticho pošle staré iné sklo.
  Builder pri manuáli posiela `glass_type_manual`+`price_m2_manual` a `glass_type` VYNECHÁ (aj composition).
  UI: sentinel `__ine__` v pickeri odkryje vlastný typ + cenu (`novyIne` $derived; per-riadok `ineRiadok`
  record + `onTypSelect`).
- **`require_order:false`** VŽDY v `uploadGlassOrderToOdoo` — Odoo vytvorí objednávku skla aj bez
  sale.order (servis bez zákazky), `order_number`=zak + OP precedencia nezmenené.
- **Outcome** `parseOdooOutcome(res)` tolerantne číta `{glass_order_id, name, lines, dq}` (v1 intake
  nevracia nič → `undefined`); `GlassOrderUploadOutcome.odoo` + `droppedAttachments`. Podklad po odoslaní
  ukáže „Odoslané do Odoo: <OSK name>" + DQ zoznam + vynechané prílohy.
- **v49 wiring pretlačil `migracie.ts` cez 1000-r. strop** → PURE MOVE inline v29 (`money_dlv` bloku) do
  `migracie-seed.ts` (`migrateMoneyDlv`), byte-identické (viď `migrations.md` + `large-file-split.md`).

## Výkres priamo vo formulári „Pridať riadok" — multipart + zdieľaný `validujSubor` (#553)

Formulár „Pridať riadok" (`+page.svelte`, `?/pridatRiadok`) je `enctype="multipart/form-data"`
+ `use:enhance` (multipart funguje natívne v SvelteKit enhance) a má vždy renderované pole na
súbor `data-testid="manual-subor"` (`accept` z allowlistu; pri režime `atyp` vizuálne zvýraznené
cez `class:atyp-zvyraznene` — progressive enhancement, funguje aj bez JS). Operátor pri atype
priloží výkres jedným odoslaním; predtým sa dal pripnúť len na UŽ pridaný riadok.

- **JEDEN zdroj pravdy pre validáciu prílohy = `validujSubor(FormDataEntryValue | null)`**
  (`+page.server.ts`) → `{ ok: true; subor: File } | { ok: false; error }`. Synchrónna kontrola
  (File instance, `size>0`, `size<=MAX_SUBOR_VELKOST`, `allowedExtension`); byte-obsah
  (`arrayBuffer`) číta až volajúci. Používajú ho OBE akcie — `nahratSubor` (existujúci riadok) aj
  `pridatRiadok` (nový riadok s výkresom). Pri pridaní ĎALŠEJ akcie s uploadom reuse tento helper,
  needuplikuj vetvy „File/size/extension".
- **Poradie v `pridatRiadok`:** validuj súbor PRED `pridajSkloManual` (neplatná prípona/veľkosť →
  `fail(400, { pridatChyba })`, NIČ sa nevloží). Po úspešnom vložení (`id`) → `pridajSubor(id,
  name, 'application/octet-stream', buf)` (vynútený bezpečný MIME, rovnako ako `nahratSubor`).
- **atyp bez výkresu = upozornenie, NIE chyba:** `return { ok: true, pridatUpozornenie: 'atyp bez
  výkresu — pripni súbor pri riadku' }` (Odoo vráti DQ, operátor doplní na riadku). UI ho ukáže
  `data-testid="manual-upozornenie"` (`.warn`, nie `.err`). Rozmery: pozri #565 nižšie (atyp s výkresom = nepovinné). POZOR (#565 čítanie kódu): Odoo v2 príjem atyp riadok BEZ prílohy ODMIETNE (UserError → pri odoslaní zlyhá CELÁ objednávka, nie DQ) — výkres musí byť pripnutý PRED „Odoslať do Odoo".
- **Test akcie s multipart:** mock event `{ params:{zak}, request:{ formData: async()=>fd },
  locals:{user} }`; súbor cez `fd.set('subor', new File([content], name, {type}))` — obsah **string**
  (BlobPart), NIE `Uint8Array` (TS lib `SharedArrayBuffer` nie je `BlobPart` → `svelte-check` padne).
  E2E: `setInputFiles({ name, mimeType, buffer })` s inline PDF bufferom (žiadny fixture súbor na disku).

## Podklad pre výrobu: nadpis OP+zákazník, „Zasklenie N", m² vopred, Money názov skla (#563)

Patrik (Odoo úloha 625, vzor 37880): podklad musí vyzerať ako Money doklad. Prístup 1 — LEN
zobrazenie + producenti, žiadna migrácia, Money-NEUTRÁLNE (`typ_skla`/`money_kod`/Odoo payload
nezmenené okrem `description` nových riadkov = „Zasklenie N").

- **Čisté helpery `src/lib/objednavka-skla-pozicia.ts`** (client-safe, svelte ich importuje):
  `popisPozicie(popis, modul)` — LEN `modul='zasklenia'`: „Zasklenie N[: Robust 3K]" → „Zasklenie N",
  starý single riadok („Robust 2K", bez pozície) → „Zasklenie 1"; iné moduly (ručný text operátora,
  FIX, pergola) NEMENÍ. Používa ho podklad (zobrazenie), `buildGlassOrderForZak` (Odoo
  `description`/`note` — aj staré riadky = zhoda s tlačou) A idempotentná identita. `m2Tabule(š,v,ks)`
  (JEDINÝ vzorec m² — ručné riadky, zasklenia single/multi, pergola producent), `nadpisObjednavky`.
- **Nadpis** = `effektivneOp` + `zakazkaPrehlad(zak).zakaznik` (JEDEN prehľad → `opZPrehladu`,
  live-first ako `zakazkaOp`); bez OP → ZAK, bez zákazníka (servis bez odpisu) → len OP. Testid
  `objednavka-nadpis`. **E2E NESMÚ hľadať heading podľa ZAK**, keď podklad má OP — assertuj
  `toHaveURL(/objednavka-skla/<zak>/)` + `objednavka-nadpis` (OP / zákazník).
- **m²**: `mapRow` fallback `r.m2 ?? (vyska ? m2Tabule : null)` — uložené m² má prednosť (FIX
  lichobežník `pole.m2`), šikmý bez výšky ostáva null. E2E m² ODVOĎ z rozmerov/počtu v DOM.
- **Popis**: zasklenia posiela len „Zasklenie N" (single = „Zasklenie 1"). FIX („FIX pole N — názov")
  a pergola („Strešné sklo — typ") NEMENENÉ — nenesú systém/štýl. **Idempotencia
  (`existujeRovnaka`) porovnáva POZÍCIU (`popisPozicie`), nie surový popis** — SQL vyberie geometrických
  kandidátov, pozícia sa porovná v JS. Inak by opakované „Pridať sklá" po zmene textu producenta
  zduplikovalo riadky spred zmeny (= duplicitná objednávka u dodávateľa). Dôsledok: rovnaké sklo
  (rozmer+ks+typ) na tej istej pozícii zákazky sa nepridá druhýkrát ani pri inom systéme.
- **Money názov skla** `src/lib/server/money-nazov-skla.ts` `moneyNazvySkiel(typy)`: lokálny názov →
  `glassMoneyKodPodlaNazvu` (db.ts — kód LEN keď je naprieč systémami JEDNOZNAČNÝ; riadok objednávky
  systém neukladá, `glassMoneyKod(system,…)` sa nedá) → Odoo `product.product` `default_code in [...]`
  → `name` (JEDEN read pre všetky kódy podkladu); inak cenníková hodnota → `montalu.glass.type.name`
  (`fetchGlassTypes` cache); inak uložený typ. Vzor #551: 3 s timeout, cache 5 min / 60 s,
  single-flight, `false` char pole = prázdne, warn raz. Dnes len 4 sklá majú `money_kod`
  (TS00016/17/21/22) — ostatné zobrazujú lokálny názov; doplnenie = dátové rozhodnutie výroby (migrácia
  `money_kod` MENÍ Money odpis skla → nie bez potvrdenia). Zobrazuje sa v `.print-only` spane
  (`typ-nazov-<id>`) a v záložnej `<option>` pickera. Testy mockujú LEN `setJson2Transport`.

## Atyp s výkresom BEZ šírky/výšky (#565)

Patrik (Odoo úloha 1051, výkres FIX Květoň — 9 lichobežníkových tabúľ): jeden rozmer neexistuje,
formulár ho blokoval („Vyplňte toto pole"). Owner 23.9. „1": atyp s výkresom = rozmery nepovinné.
Money-NEUTRÁLNE, BEZ migrácie.

- **Pravidlo (server = zdroj pravdy):** `pridajSkloManual` → `rozmeryManual`: OBE rozmery nezadané
  (`null`) sú povolené LEN pri `rezim='atyp'` A `maVykres` (súbor priložený v TOM ISTOM odoslaní —
  `pridatRiadok` ho validuje zdieľaným `validujSubor` PRED vložením). Atyp bez výkresu bez rozmerov →
  throw „Atyp bez výkresu potrebuje šírku a výšku — alebo priložte výkres…" (fail 400, nič sa
  nevloží). Jeden zadaný rozmer / režim rozmery → doterajšia validácia (obe celé > 0). Akcia číta
  prázdne pole ako `null` (`volitelnyRozmer`), NIE `Math.trunc(Number(''))=0`.
- **Úložisko bez migrácie:** schéma v41 má `sirka_mm REAL NOT NULL`, `vyska_mm REAL` a `m2 REAL`
  nullable → riadok bez rozmerov = `sirka_mm=0`, `vyska_mm=NULL`, `m2=NULL`. `mapRow` m² fallback
  (`vyska_mm != null ? m2Tabule : null`) ostane `null` → žiadne 0 m² do súčtov/tlače.
- **Detekcia = JEDEN čistý helper** `bezRozmerov(p)` (`objednavka-skla-pozicia.ts`, client-safe):
  `!sikmy && sirkaMm <= 0` (šikmý FIX s výškou null NIE JE „bez rozmerov"). `fmtRozmerTabule(p)` je
  jediné zobrazenie rozmeru riadka (svelte `data-testid="rozmer-<id>"`): „podľa výkresu" / „š × v mm" /
  „š × Ľ/P mm (šikmé)".
- **UI:** `required={!novyAtyp}` na `manual-sirka`/`manual-vyska` (hviezdička len pri rozmery) + hint
  `manual-rozmery-hint` pri atype. Per-riadok select režimu má `rozmery` `disabled` pre riadok bez
  rozmerov; server `nastavRezim(id,'rozmery')` to STRÁŽI tiež (throw → akcia fail 400) — Odoo príjem
  by riadok 0 × 0 v režime rozmery odmietol a zlyhala by CELÁ objednávka.
- **Odoo kontrakt (prečítané v odoo-erp @ main):** `addons/company_montalu_install_config/models/
  sale_order_narezak_glass.py` — `width = int(item.get("width_mm") or 0)`; kontrola `width <= 0` /
  `height <= 0` beží LEN `if mode == "rozmery"` („atyp berie plochu z výkresu (rozmery voliteľné)");
  `if mode == "atyp" and not line_atts: raise UserError(... vyžaduje aspoň jednu prílohu (výkres))`.
  Plocha ATYP = voliteľný kľúč `area_m2` → `area_m2_manual`; odoslanie dodávateľovi IZOS
  (`montalu_glass_order.py` `action_send`) vyžaduje pri ATYP `area_m2_manual > 0` — plochu teda
  doplní Odoo strana (appka ju nepozná, NEPOSIELA `area_m2`). Payload: `buildGlassOrderItem` pošle
  `width_mm=0, height_mm=0, mode='atyp'` + `attachments[]`; bez popisu operátora `description =
  'ATYP podľa výkresu'` (len pre atyp 0 × 0; ostatné riadky byte-identické).
- **Riadok bez rozmerov NIKDY bez výkresu (review):** (1) `pridajSkloManual({ vykres: { nazov, data } })`
  uloží výkres v TEJ ISTEJ transakcii ako riadok (akcia načíta `arrayBuffer` PRED vložením) —
  zlyhanie `pridajSubor` zruší aj riadok; `maVykres` bool NEEXISTUJE, pravidlo sa odvodzuje z `vykres`.
  (2) `zmazSubor` odmietne zmazať POSLEDNÝ výkres riadka `bezRozmerov` (throw → akcia `zmazatSubor`
  fail 400, UI `podklad-chyba` zobrazí `form.error`). Riadok s rozmermi maže výkres ako doteraz.
- **Testy:** `tests/objednavka-skla-atyp-bez-rozmerov-565.test.ts` (akcia OK/400/400/polovičné,
  prepnutie režimu blokované, `buildGlassOrderForZak` payload, `buildGlassOrderItem`, helpery). E2E
  `objednavka-skla.spec.ts` „atyp s výkresom bez šírky/výšky" (required zmizne, riadok „podľa výkresu").

## Cudzie riadky na podklade — upozornenie, NIKDY blok (#571)

PROD 25.9.: podklad je kľúčovaný číslom zákazky (`zak_norm`), NIE používateľom → opakovane použitý
skúšobný názov („test", „te") zdieľa jeden podklad a `palo@montalu.sk` nevedomky pridal sklo do
podkladu s riadkami iného používateľa. ROZHODNUTÉ (gk z poverenia ownera 27.9.): **upozorniť, nič
neblokovať, skúšobné podklady „test"/„te" NEMAZAŤ** (ani migráciou, ani skriptom). Money-NEUTRÁLNE,
bez migrácie.

- **JEDEN helper** `cudzieRiadky(zak, username)` (`objednavka-skla.ts`) → `{ pocet, autori:[{user, od}] }`
  — ROVNAKÝ WHERE ako `listSklaPreZakazku` (aj legacy `zak_norm` s medzerou), `created_by <> ''` AND
  `<> username`, `od` = najstarší `created_at` autora. Prázdne meno → nič. `textCudzichRiadkov(c)` =
  hláška („1 riadok / 2–4 riadky / 5+ riadkov", dátum cez `sqliteUtcToIso` + `formatDatumSk`, nie UTC
  default). `upozornenieCudzie(zak, user)` = oboje, BEZ logu (volá ho zasklenia producent aj load —
  load beží pri každom reloade). LOG je v zápisovej vrstve: `logCudzieRiadky` po `pridajSklaHromadne` /
  `pridajSklaHromadneIdempotentne` / `pridajSkloManual` (raz na zákazku+autora) → pokryje VŠETKÝCH
  producentov vrátane FIX/pergoly/ručného riadku; nový producent cez tieto funkcie loguje sám.
- **Kde sa zobrazí:** zasklenia `pridatSkla`/`pridatSklaMulti` → `sklaPridane.upozornenieCudzie` (testid
  `skla-pridane-cudzie` v `sklaPridaneBanner`); podklad `/objednavka-skla/[zak]` load → `data.cudzie` →
  banner `cudzie-riadky` pod nadpisom + `cudzie-riadky-pridat` vo formulári „Pridať riadok". FIX a
  pergola producenti presmerujú na podklad → pokryje ich banner (žiadna zmena ich akcií). **Nový
  producent podkladu:** ak NEpresmeruje na podklad, vráť `upozornenieCudzie(...)` vo výsledku akcie.
- **Známe obmedzenie:** porovnáva sa `created_by` = prihlasovacie meno. Spoločný účet (`vyroba`, ktorý
  vytvára väčšinu podkladov) sa SÁM neupozorní — dvaja ľudia pod jedným účtom sú pre appku jeden
  používateľ. Riešenie je organizačné (osobné účty), nie v kóde.
- **E2E bez nového skip guardu:** druhý používateľ sa v E2E NEseeduje priamo do DB (to by vyžadovalo
  nový BASE_URL skip riadok = blok integračného pushu, viď `e2e-console.md`), ale vytvorí sa cez UI
  `/pouzivatelia` (interný účet → pridá riadok → späť `e2e` → banner → kolega B2B → Zmazať). Dátum v
  očakávanom texte sa počíta v teste tou istou Intl `Europe/Bratislava` logikou (nie pevný literál).
- **Testy:** `tests/objednavka-skla-cudzie-571.test.ts` (helper, text/TZ/skloňovanie, zasklenia akcia,
  load), E2E `objednavka-skla.spec.ts` „riadky iného používateľa → upozornenie".

## `hydration_mismatch` na PROD = Cloudflare prepísal e-mail v texte → `Cache-Control: no-transform` (#571 follow-up)

PROD 27.9. (0.25.45): `/objednavka-skla/test` hlásil 1× `[svelte] hydration_mismatch`, CI E2E #571
čisté. NEBOLA to časová zóna (banner sa formátuje na serveri — `upozornenieCudzie`), ani Odoo kód
typu skla / `<optgroup>` kandidátov / QR (všetko overené lokálne, 0 varovaní). **Príčina:** PROD
`app.montalu.cloud` je za **Cloudflare**, ktorého „Email Address Obfuscation" prepíše každý e-mail v
TEXTE HTML (mimo `<script>`) na `<a class="__cf_email__">[email protected]</a>` + dekódovací skript.
Autor riadku `palo@montalu.sk` v banneri → `<span data-testid="cudzie-riadky">` má iné uzly než SSR,
serializované `data` (v `<script>`) ostali → Svelte `reset()` nájde navyše súrodenca → mismatch.
To isté zasiahne `+layout.svelte` user menu (`{data.user.username}`) pre KAŽDÉHO používateľa s
e-mailovým menom — na každej stránke.

- **Oprava (globálna, jedno miesto):** `hooks.server.ts` `handle` → `pridajNoTransform` pridá
  `Cache-Control: no-transform` LEN k `text/html` odpovediam (existujúce direktívy zachová, nezdvojí).
  Cloudflare potom HTML nemení (developers.cloudflare.com/waf/tools/scrape-shield/email-address-obfuscation).
  NEOBCHÁDZAJ to per-miesto (`<!--email_off-->` Svelte zo šablóny odstráni; rozbíjanie e-mailu na
  uzly = hack v každom texte).
- **TRADE-OFF (review):** no-transform vypne pre to HTML aj Cloudflare brotli/gzip
  (developers.cloudflare.com/speed/optimization/content/compression) — preto LEN `text/html`; JSON
  (`__data.json` pri klientskej navigácii, endpointy) ostáva komprimovaný. **Čistejšie riešenie** je
  vypnúť Email Obfuscation v Cloudflare zóne `montalu.cloud` (Configuration Rule pre
  `app.montalu.cloud`) — infra mimo repa; potom `pridajNoTransform` odstráň a HTML je znova komprimované.
- **Diagnóza „PROD mismatch, CI čisté":** najprv porovnaj, čo medzi serverom a prehliadačom STOJÍ
  (proxy/CDN transformácie: e-mail obfuscation, Rocket Loader, minify) — nie len dáta/TZ. Repro:
  Playwright `page.route` dokumentu, ktorý aplikuje transformáciu proxy → presne 1× mismatch.
- **Testy:** `tests/cache-no-transform-571.test.ts` (hlavička), E2E
  `objednavka-skla-proxy-hydratacia.spec.ts` — seed riadku s e-mailovým autorom priamo do e2e DB
  (`skipAkLive`, NIE nový doslovný BASE_URL skip riadok — `e2e-console.md`). `page.route` emuluje
  Cloudflare (prepis e-mailu na `<a class="__cf_email__">` + dekódovací skript pred `</body>`):
  KONTROLNÝ test prepíše vždy a čaká presne 1× `hydration_mismatch` (dôkaz vernosti emulácie),
  REGRESNÝ prepíše len bez `no-transform` a čaká zero-console. `timezoneId: 'America/New_York'` len
  potvrdzuje, že banner (formátovaný na serveri) nezávisí od TZ prehliadača — príčinou TZ nebola.
- **Lokálne spustenie jedného E2E bez buildu (Tier 0):** `vite dev` na vlastnom porte (DATABASE_PATH do
  scratchpadu) + dočasný playwright config bez `webServer` s `baseURL` na ten port; v dev móde Vite
  HMR websocket loguje `ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS` — to je šum dev servera, v CI
  (preview build) neexistuje; hodnoť len ostatné správy.

## Picker typu skla zoskupený podľa druhu (#576) + trvalý odkaz do Odoo po odoslaní (#577)

Marek D. (Odoo úlohy 1180/1181, 28.9.): 99 Odoo typov v plochom `<select>` bolo neprehľadné, a po
„Odoslať do Odoo" musela výroba objednávku v Odoo hľadať. Money-NEUTRÁLNE.

- **JEDNA funkcia `zoskupTypySkla(items, kandidati)`** (`src/lib/objednavka-skla-typy.ts`, ČISTÁ,
  client-safe — svelte ju volá per riadok s `nav?.kandidati`, aj pre „Pridať riadok" s `[]`) →
  `{label, items}[]` v PEVNOM poradí: „Odporúčané" (kandidáti matchera #556, keď sú) → „Izolačné
  (IZOS)" `izolacne` → „Kalené ESG" `esg` → „Lepené VSG" `vsg` → „Rezané / float" `rezane` → „Ostatné"
  (neznáma/prázdna kategória = aj lokálny fallback) → „Iné sklo" (sentinel, VŽDY posledné). V skupine
  `localeCompare(…, 'sk')`; prázdne skupiny sa vynechajú; kandidát sa v kategórii NEopakuje (žiadne
  duplicitné `value` v jednom selecte). **`value` sa NEMENÍ** → uložený `typ_skla` aj payload
  bit-identické. Nový picker typu skla inde (napr. pergola honest-null) → reuse tejto funkcie.
  Kategórie `izolacne/esg/vsg/rezane` = Odoo read 28.9. (99 typov: 11/28/31/29); porovnanie je
  trim+lowercase. **Drift guard:** load volá `neznameKategorie(glassTypes)` a NEPRÁZDNU neznámu
  kategóriu zaloguje `warn` RAZ za proces (inak by ticho spadla do „Ostatné" — CI to nevidí, beží na
  lokálnom fallbacku s `category=''`). Nová Odoo kategória = pridať riadok do `KATEGORIE`.
  `PORADIE_SKUPIN` (export) = jeden zdroj poradia pre E2E. Riadok BEZ kandidátov používa zdieľané
  `skupinyTypov` ($derived raz), per-riadok sa zoskupuje len pri kandidátoch.
- **Sentinel „iné sklo" = `SENTINEL_INE_SKLO`** z toho istého modulu — svelte aj server
  (`MANUAL_TYP_SENTINEL`) ho importujú (jeden zdroj). E2E vyberá `'__ine__'` hodnotou — optgroup to
  nemení. Prvá NEprázdna voľba pickera je v CI prvý typ skupiny „Ostatné" (lokálny fallback).
- **Odkaz** `odooObjednavkaSklaUrl(id)` (`src/lib/server/objednavka-skla-odoslanie.ts`) =
  `<base>/odoo/action-1008/<id>`, base = `odooJson2Config().url` (ODOO_JSON2_URL, trailing `/`
  orezaný), inak `https://erp.montalu.cloud`; neplatné id → `null` (žiadny mŕtvy odkaz).
- **Trvalosť = tabuľka `objednavka_skla_odoslanie(zak_norm PK, glass_order_id CHECK>0, name,
  odoslane_at, odoslal)`** (migrácia **v51**, vlastný súbor `migracie-objednavka-odoslanie.ts`).
  Podklad nemá hlavičkovú tabuľku → jeden riadok per `normZak(zak)`, upsert (Odoo `doc_id` je
  idempotentný = tá istá objednávka). Akcia `odoslatDoOdoo` uloží LEN pri `result==='uploaded'` A
  `odoo.glassOrderId` (v1 intake/vypnuté/chyba → nič, `odkaz:null`); zlyhanie uloženia sa zaloguje a
  odkaz sa aj tak vráti. Load vráti `odoslanieOdoo` (čas cez `sqliteUtcToIso`+`formatDatumCasSk`).
- **UI:** blok `odoo-objednavka` / `odoo-objednavka-link` (target `_blank`, `rel=noopener noreferrer`)
  je MIMO guardu položiek (objednávka v Odoo existuje ďalej); zdroj = `data.odoslanieOdoo`, fallback
  `form.odoslane.odkaz`. Externý `href` potrebuje scoped `eslint-disable
  svelte/no-navigation-without-resolve` (vzor `KonfVyber.svelte`).
- **Testy:** `tests/objednavka-skla-typy-576.test.ts`, `tests/objednavka-skla-odoslanie-577.test.ts`
  (akcia s mocknutým `setJson2Transport` + load „po obnovení"), `tests/migration-v51.test.ts`. E2E:
  `objednavka-skla.spec.ts` „zoskupený podľa druhu" (RELAČNE: ≥2 optgroup, posledná „Iné sklo", každá
  voľba v skupine, bez duplicít — len čítanie, beží aj proti PROD) + `objednavka-skla-odoo-odkaz-577.spec.ts`
  (seed `objednavka_skla_odoslanie` do e2e DB so syntetickým id, `skipAkLive`; v CI je upload vypnutý,
  preto reálny odkaz z akcie kryje unit test).

## Tabule s otvorom vs bez — JEDNO pravidlo pre výkres aj objednávku (#578)

Marek (Odoo úloha 1185): IZOS cení tabuľu s otvorom inak než bez → objednávka musí povedať, KTORÉ
tabule vŕtať. Money-NEUTRÁLNE, bez migrácie (spec stĺpce v48).

- **Pravidlo `otvoryVSkle(system, N)`** (`src/lib/sklo-otvory.ts`, client-safe) — Deluxe: krajné
  sklá (`N===1 → [0]`, inak `[0, N-1]`), 1 otvor na tabuľu, trieda `d50` (⌀46 ∈ 31–50 mm); ostatné
  systémy `[]`. Štýl (opona/2x) pravidlo NEmení — `Nahlad2D` ho nedostáva a kreslí rovnako polia
  0 a N−1. `Nahlad2D` berie indexy z pravidla (`zamky`), takže výkres a objednávka nemôžu nesedieť
  (test `tests/sklo-otvory-578.test.ts` SSR-renderuje `Nahlad2D` cez `svelte/server` `render` a
  porovná počet `circle[stroke-dasharray]` s pravidlom). Ďalší otvor (madlo D56, iný systém) = zmena
  LEN v `otvoryVSkle`.
- **Producent** `sklaPosuvu(pozicia, posuv, ident)` (`objednavka-skla.ts`, zdieľa single aj multi
  akcia `/zasklenia`) → `riadkySklaPosuvu`: riadok „Zasklenie N — s otvorom ⌀46" (`pocet = sOtvorom`,
  `holesQty = 1`, `holeSize = 'd50'`) + riadok „Zasklenie N" (zvyšok; pri 0 ks NEvznikne — Deluxe 2K
  = len jeden riadok s otvorom). m² z kusov KAŽDÉHO riadku.
- **`NoveSklo.holesQty/holeSize`** → `pridajSklo` zapíše `spec_holes_qty/spec_hole_size` (validácia +
  default d30 ako `nastavSpec`). **Dedup** `stmtRovnake` má `AND spec_holes_qty = ?` — Deluxe 4K =
  2 + 2 ks rovnakej geometrie, rozlišuje ich otvor + prípona pozície.
- **`popisPozicie` ponechá príponu `PRIPONA_S_OTVOROM`** (regex `(?::|$| — )`). PASCA: starý regex
  `(?::|$)` by „Zasklenie 3 — s otvorom ⌀46" zmenil na „Zasklenie 1" (fallback) → zlý popis na
  podklade, v Odoo `description` aj v dedup-identite. Podklad zobrazuje otvor práve cez tento popis
  (read-only; editácia otvorov ostáva skrytá podľa #546, hidden echo ich pri uložení Hrany zachová).
- **Kontrakt Odoo: `holes_qty` je NA TABUĽU**, nie na riadok — odoo-erp `montalu_glass_price.py`
  `price_unit = (base × plocha + Σ príplatky) × nadrozmer`, `price_purchase = price_unit × qty`;
  `montalu_glass_line_spec.py` vŕtanie `items.append((code, holes_qty, 1))` „raz na jednotku".
  Riadok s otvorom teda posiela `qty = 2, holes_qty = 1, hole_size = d50` (nie `holes_qty = 2`).
- **Prechod (review 🟡):** riadok celého posuvu spred #578 („Zasklenie 1", N ks, 0 otvorov) sa s
  novými riadkami nespáruje (iné `pocet`) → bez ošetrenia by opakované „Pridať sklá" pridalo tabule
  NAVYŠE (Deluxe 4K = 8 ks). `prevedStaryCelok` (v `pridajSklaHromadneIdempotentne`) ho PREVEDIE na
  riadok „s otvorom" (UPDATE popis/pocet/m2/spec — id aj prílohy ostanú) a „bez" sa vloží bežne.
  Celok = súčet `pocet` riadkov tej istej `zakladPozicie` + skla v tom istom pridaní; starý riadok
  s iným počtom (iný posuv) sa NEprevádza. Otvory starého riadku sa NEfiltrujú (ručne nastavené cez
  #521 spec by inak znova zdvojili) — prepíše ich pravidlo. Test `tests/objednavka-skla-otvory-prechod-578.test.ts`.
- **Prípona otvoru je všeobecná** (`PRIPONA_OTVOR_RE = / — s otvorom ⌀\d+$/`), `zakladPozicie`
  ju odreže — ďalší priemer (madlo ⌀56) = nový riadok s inou príponou bez zmeny `popisPozicie`.
- **Styl vs otvory:** pravidlo štýl ignoruje (výkres ho nedostáva); ak výroba potvrdí iné polia pre
  oponu/2x, zmena je v `otvoryVSkle` (ROZHODNUTÉ na #578 to explicitne predpokladá).
- **E2E** `e2e/objednavka-skla-otvory.spec.ts` — relačne: ks s otvorom = kruhy vo výkrese, súčet = ks
  skla z karty „Sklo (mm)" (Počet nemá testid → `div:has(> span:text-is("Počet")) > b`).

## Výkres tabule s otvorom (PDF) ide s objednávkou do Odoo/IZOS (#587)

Odoo úloha 1185 „Výkres alebo DXF k sklu pôjde s objednávkou z appky". Nadväzuje na #578 (riadky s
otvorom / bez). Money-NEUTRÁLNE, migrácia **v52**, DXF ZAMIETNUTÉ (PDF stačí; DXF sa dá doplniť z
toho istého pravidla).

- **Poloha = JEDEN zdroj `src/lib/sklo-otvory.ts`:** `OKRAJ_ZAMOK_MM` (50, stred od zvislej hrany),
  `VRTANIE_ZAMKU_DEFAULT_MM` (1050, stred od spodku), `D_ZAMOK_MM` (46) + `polohaOtvoru(vrtanie, š, v)`.
  `Nahlad2D` (náhľad), `vstup.ts`/`znova.ts`, formulár (`zasklenia/+page.svelte`, `ZasklieniaForm`)
  aj PDF generátor z nich čítajú. Guard `tests/sklo-otvor-poloha-587.test.ts`: `sklo-otvor-pdf.ts`
  nesmie obsahovať `\b(50|46|1050)\b` — **ani v komentároch**, píš „⌀…"; Nahlad2D nesmie mať
  `OKRAJ_ZAMOK = <číslo>` ani `vrtanieZamku = <číslo>`; formulár + Nahlad2D nesmú mať literál `1050`.
  Pomocníci: `popisPolohyOtvoru` (text), `triedaOtvoru` (d30/d50), `stranyOtvorov` (ľavé/pravé
  krídlo), `fmtMmOtvoru`. `polohaOtvoru` vráti
  `null`, keď by otvor nebol CELÝ v skle (náhľad výšku len oreže do kresby, dodávateľovi sa
  nedomýšľa) → riadok ostane „s otvorom" (cena IZOS), ale výkres sa negeneruje.
- **Producent:** `riadkySklaPosuvu(pozícia, systém, N, rozmer?)` dá riadku s otvorom `otvor`;
  `sklaPosuvu` posiela `vrtanieZamku` (single `/zasklenia` z formulára cez `{ ...r, vrtanieZamku }`;
  **multi posuv výšku nezadáva → default**, rovnako ako ho kreslí `PlanKartyMulti` → `Nahlad2D`).
  Bez `rozmer` kľúč `otvor` chýba → existujúce `toEqual` vektory #578 ostali platné.
- **Úložisko:** `objednavka_skla.otvor_od_hrany_mm/otvor_od_spodku_mm/otvor_priemer_mm` (REAL NULL,
  `migracie-objednavka-otvor.ts`). `pridajSklo` ich zapíše LEN pri `holesQty > 0`; `mapRow` →
  `SkloPolozka.otvor` — `null` pri neúplnej polohe ALEBO keď spec riadku nesedí (`spec_holes_qty !== 1`
  alebo `spec_hole_size !== triedaOtvoru(priemer)` — obsluha zmenila otvory cez #521 spec → výkres
  by odporoval objednávke). **Dedup prevezme polohu:** `najdiRovnaku` + `doplnPolohu` — riadok spred
  #587 (0.25.48–0.25.51) dostane polohu opakovaným „Pridať sklá"; zmenená výška prepíše uloženú; nová
  výška MIMO skla (`otvor: null` od producenta) starú ZMAŽE (honest-null); producent bez polohy
  (`otvor` chýba) nič nemení — `sklaPosuvu` preto posiela `rd.otvor` BEZ `?? null`. Zmena polohy sa
  NEpočíta do `pridane` (nič sa nepridalo): voliteľný `stats.polohaZmenena` → zasklenia banner
  `skla-poloha-zmenena` „odošli objednávku znova do Odoo". `prevedStaryCelok` polohu tiež zapisuje.
- **PDF** `src/lib/server/sklo-otvor-pdf.ts` (`pdf-common` + DejaVu): A4, ĽAVÉ krídlo (otvor pri ľavej
  hrane) a pri 2 ks aj PRAVÉ krídlo (otvor ZRKADLOVO pri pravej hrane) vedľa seba, každé s kótami
  skla + otvoru (od hrany, od spodku). ŽIADNE „otoč tabuľu" (review: vrstvené/pokovované/matné sklo má
  stranu). **DejaVu subset NEMÁ „⌀" (U+2300)** → v tele „Ø" (`pdfText`), v metadátach „⌀". Hodnoty sú
  v Subject/Keywords (`od_hrany_mm=`, `od_spodku_mm=`, `priemer_mm=`, `ks_lave=`, `ks_prave=` …) =
  testovací kanál; BEZ cien. `vykresOtvoruZPolozky(p)` = honest-null brána (bez otvoru/platnej polohy,
  **atyp** — obsluha dodáva vlastný výkres, šikmý, bez výšky/šírky). Vizuálna kontrola: vitest
  jednorazovka zapíše PDF → `pdftoppm -png -r 70`.
- **Odoo:** `buildGlassOrderForZak` je od #587 **async** (pdf-lib `save()`) — riadok s otvorom dostane
  `attachments: [...ručné, Vykres-otvoru-<zak>-<pozícia>.pdf]` (`application/pdf`) A poznámku
  `note = "<pozícia> — otvor ⌀46: stred 50 mm od zvislej hrany, 1100 mm od spodku skla"`
  (`GlassOrderItemInput.poznamkaOtvoru` → `buildGlassNote`). **PASCA (review 🔴, odoo-erp
  `sale_order_narezak_glass.py`):** Odoo pri opätovnom odoslaní porovnáva polia riadkov + prílohy
  CELEJ objednávky, NIE prílohy riadku → bez poznámky by nový/zmenený výkres pri re-odoslaní zapadol
  („identická" objednávka). Poznámka je tiež textová záloha pre IZOS. Zlyhanie generovania sa
  zaloguje, objednávka ide bez výkresu. Strop príloh (`enforceAttachmentCap`) platí aj pre výkres.
- **Podklad:** stĺpec Prílohy — `vykres-otvoru-<id>` odkaz na GET `/objednavka-skla/vykres-otvoru/[id]`
  (inline `application/pdf` — generované z NAŠICH dát, preto nie octet-stream ako nahraté súbory;
  b2b kryje prefix) + `otvor-poloha-<id>` (`popisPolohyOtvoru`). Odkaz sa zobrazí podľa
  `data.vykresOtvoru[id]` = load volá TÚ ISTÚ bránu `vykresOtvoruZPolozky` (nie vlastná svelte
  podmienka). Upozornenie `otvor-neznamy-<id>` LEN pri riadku „— s otvorom" z nárezáka
  (`PRIPONA_OTVOR_RE`), nie atyp, bez výkresu; dva texty: `otvoryRucneZmenene` (spec ručne zmenená →
  „prepni na atyp + vlastný výkres" — znova „Pridať sklá" by riadok NESPÁROVAL, dedup kľúč = otvory
  → duplicitné sklo!) inak „poloha neznáma" (znova „Pridať sklá" so správnou výškou, alebo atyp).
  Ručné nahratie na rozmery-riadok NEPONÚKAME — `nahratSubor` prepína riadok na atyp.
- **Nárezák karta „Sklo (mm)":** `SkloOtvoryRozpis` (`rozpisOtvorovSkla`) „z toho s otvorom ⌀46: 2 ks
  · bez otvoru: 2 ks" — single (`sklo-otvory`, pod Počet, hodnota Počet nezmenená) aj multi
  (`posuv-sklo-otvory-<i>` v bunke skla). Systém bez otvorov → nič. Tlačí sa s kartou.
- **Testy:** `tests/sklo-otvor-poloha-587.test.ts` (pravidlo, SSR komponent, zdroj konštánt),
  `tests/objednavka-skla-vykres-otvoru-587.test.ts` (producent, dedup doplnenie/zmazanie, poznámka
  pre Odoo re-send, spec nesúlad, atyp, payload, PDF metadáta, GET), `tests/migration-v52.test.ts`;
  E2E `objednavka-skla-otvory.spec.ts` rozšírený (rozpis na karte, odkaz len pri riadku s otvorom,
  poloha 1100/50, PDF 200 `%PDF-`).
- **`objednavka-skla.ts` má ~966 r.** — ďalšia funkcia v ňom = najprv split (napr. otvory/dedup do
  vlastného modulu), `large-file-split.md`.
