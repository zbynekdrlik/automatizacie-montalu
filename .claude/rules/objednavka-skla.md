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
  `data-testid="manual-upozornenie"` (`.warn`, nie `.err`). Rozmery ostávajú povinné (m² pre cenu).
- **Test akcie s multipart:** mock event `{ params:{zak}, request:{ formData: async()=>fd },
  locals:{user} }`; súbor cez `fd.set('subor', new File([content], name, {type}))` — obsah **string**
  (BlobPart), NIE `Uint8Array` (TS lib `SharedArrayBuffer` nie je `BlobPart` → `svelte-check` padne).
  E2E: `setInputFiles({ name, mimeType, buffer })` s inline PDF bufferom (žiadny fixture súbor na disku).
