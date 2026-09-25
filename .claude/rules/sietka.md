---
paths:
  - 'src/lib/sietka.ts'
  - 'src/lib/server/compute-sietka.ts'
  - 'src/routes/sietka/**'
  - 'src/lib/components/zasklenia/PlanKarty.svelte'
  - 'src/lib/components/zasklenia/PlanKartyMulti.svelte'
  - 'src/lib/sietka-standard.ts'
  - 'src/lib/server/migracie-sietka.ts'
  - 'tests/sietka-standard*.test.ts'
---

# Sieťka (moskytiéra) — jokle, honest-null, jeden zdroj vzorca

Doména sieťky je rozliata cez `sietka.ts` (čisté helpery + konštanty) → `compute-sietka.ts`
(samostatná /sietka výpočet + multi) → `compute-odpis.ts` (sieťka NA posuve, Money delta)
→ UI karty `PlanKarty`/`PlanKartyMulti` + route `/sietka`. Historické korekcie sú v hlavičke
`sietka.ts` (#86–#110) a v `tests/compute.test.ts` (kontraktové Money vektory).

## Sieťka Štandard / Štandard + — geometrický model z RÁMU posuvu (#569, Patrik Odoo úloha 1070)

- **JEDEN zdroj vzorca: `src/lib/sietka-standard.ts`** (čistý, client-safe). Server volá
  `sietovinaPre` (`compute-sietka.ts`) → `ComputeResult.sietovina` / `PosuvInfo.sietovina`;
  `PlanKarty`/`PlanKartyMulti` len ZOBRAZIA `p.sietovina` (klient nič nepočíta). Robust/Slide
  ostávajú `rozmerSietoviny` = sklo +2/+1 cez tú istú `sietovinaPre`.
- **Vzorec:** kladkový sieťky = kladkový posuvu + Δkríž; šírka sieťoviny = kladkový posuvu
  (NEzaokrúhlený, `val(...,true)`) + Δkríž + R; výška = ZÁKLADNÉ (ne-IZO) sklo V toho istého
  systému/štýlu (`cfg[system|zakladnyStyl(styl)]`, bez per-sklo korekcie) + H. Zaokrúhli RAZ na
  konci. Δkríž (`krizDelta`) = **+K** Š+ posuv + stará sieťka, **−K** starý posuv + sieťka plus,
  0 rovnaká rodina — TEN ISTÝ Δ ide do Money rezu kladkového (`sietkaStandardExtra`).
- **Prečo NIE zo skla:** IZO sklo má rozširovací profil (ZASP202439), ktorý do sieťky nejde → IZO
  sklo je o 23 × 20 mm menšie a sieťka „sklo +3/+3" (#110, zrušená `rozmerSietovinyStandard`/
  `rozmerSietovinyPre`) vyšla malá. Nikdy neodvádzaj sieťku Štandard znovu zo `sklo`.
- **Konštanty K/R/H** (seed 16,5 / 17 / 3) sú v tabuľke `cfg_sietka_standard` (migrácia v50,
  `migracie-sietka.ts`), `loadCfg` ich nesie v `Cfg` pod symbolom `SIETKA_STANDARD_CFG` (čítaj
  `sietkaStandardParams(cfg)`; ručne postavené cfg v testoch = seed). Editor `/zasklenia/nastavenia`
  sekcia „Sieťka Štandard" (len pri Štandard-rodine) → `saveCfgChanges({ sietkaStandard })` s
  auditom. **R = 17 je konštantné pre VŠETKY štýly** (seed: základné sklo S − kladkový S = 14 mm
  pre každé N 2K–6K aj opona, sieťovina = sklo + 3) — keď by nový štýl mal iný vzťah sklo/kladkový,
  sieťka Štandard by preň nesedela: over pred pridaním štýlu (`tests/sietka-standard-569.test.ts`
  A/E parita cez všetky štýly to chytí).
- **Money:** mení LEN K (kladkový ZASP202415 pri krížovej sieťke). Issue 416 malo +16,5 oboma
  smermi (zlé čítanie) — #569 opravil starý posuv + sieťka plus na −K (seed 3K 3000: 969 → 936).
  Guard `tests/sietka-standard-569.test.ts`: tabuľka 8 buniek + odpis fixtúra
  `tests/fixtures/sietka-standard-odpis-569.json` (zachytená PRED zmenou). Tabuľka 3K 3000 × 1850:
  A/B 960×1738, C/D 976×1738, E/F 969×1738, G/H 953×1738 (C/D = 942,5+16,5 = 959 + 17 = 976).
- **E2E relačne** (PROD cfg upravuje editor): kladkový sieťky > / < rez posuvu podľa smeru,
  sieťovina pri IZO skle == pri základnom (`e2e/sietka-standard.spec.ts`), nikdy seed mm.

## Jokle Robust (#555, Patrik Odoo úloha 1010)

- **Vzorec žije LEN v `sietka.ts` — `rozmerJokle(sietovina)`** (jeden zdroj pravdy pre
  samostatnú sieťku aj zasklenie). Odvodzuje sa zo **SIEŤOVINY**, nie zo skla:
  `šírka = sieťovina.šírka + JOKLE_DELTA.sirka (+10)`, `výška = sieťovina.výška + JOKLE_DELTA.vyska (−22)`,
  `ks = JOKLE_KS (4)` na jednu sieťku. Sieťovina Robust = sklo +2/+1 (`rozmerSietoviny`), takže
  jokel efektívne = sklo +12 / sklo −21. Excel príloha 37652: Robust 3K zasklenie 5000×2150 →
  sklo 1563×1945 → sieťovina 1565×1946 → jokel šírka 4 ks 1575, výška 4 ks 1924.
- **LEN Robust** — `jeJokleSystem(system) === (system === 'Robust')`. Slide/Štandard jokle
  NEMAJÚ (Patrik verbatim „pre robust"). Gate na jokle VŽDY cez `jeJokleSystem`, nikdy
  natvrdo `=== 'Robust'` v komponente.

## Honest-null (kód doplní výroba = ZMENA KONŠTANTY, nie prerábka)

Jokle dnes NEMAJÚ Money kód (Odoo katalóg má 24× „Jokel AxB" bez `default_code`, „Jokel 12x8"
tam nie je). Preto **honest-null** (`kod: null`) — zobrazí sa, do odpisu nevstupuje:

- `SietkaSamostatnaMaterialRow.kod: string | null` — jokle sú 2 riadky s `kod: null`
  (šírka 4 ks, výška 4 ks), ZOBRAZIA sa, ale do `odpis` NEVSTUPUJÚ. Money-neutralita je
  **štrukturálna**: `odpis` sa plní len z reálnych `byKod` profilov, jokle sa tam nikdy
  nedostanú (`OdpisRow.kod: string` je typová bariéra). Guard: Robust vektory `odpis`
  ostávajú byte-identické (`tests/compute.test.ts`, `tests/sietka-jokle.test.ts`).
- **POZOR — zapnutie do Money NIE je len zmena konštanty.** Na rozdiel od CLIP drobných
  (ktoré cez odpisovú slučku PRECHÁDZAJÚ a `continue`-ujú na `kod===null`, takže tam
  doplnenie kódu naozaj stačí), jokle sú DISPLAY-only push MIMO `byKod`. Keď výroba dodá
  Money kartu „Jokel 12x8" s kódom, treba jokle ZARADIŤ do odpisovej cesty (najčistejšie
  ako cfg RezRow, nech idú cez `byKod`/`ffdPack` ako ostatné profily, a zrušiť honest-null
  push) + overiť množstvo proti reálnemu Money odpisu. Nestačí premenovať `JOKLE_PROFIL`.

## Pasce

- **`{#each ... (m.kod)}` s `kod: null` KOLIDUJE** — dva jokle riadky majú oba `kod: null`,
  Svelte kľúč musí byť unikátny. Na `/sietka` material tabuľke je kľúč `(m.kod ?? \`jokle-${mi}\`)`.
  Pri každom novom honest-null riadku (kod:null) skontroluj kľúč cyklu.
- **Odoo nárezák backfill nesie `kod?: string`, nie `null`** — `backfill-narezaky.ts`
  odfiltruje jokle (`bezJoklov`) pred `linesFrom`/`materialRowsFromRozpis`, takže Odoo
  line-sync ostáva byte-identický (jokle bez kódu tam nejdú, rovnako ako CLIP drobné).
- **TDD vektor: sklo sa počíta z otvoru, over ho pred hardcodom** — návrhový príklad mal
  preklep (S=4994 dáva sklo 1561, nie 1563). Správny Robust 3K vektor pre sklo 1563×1945 je
  **S=5000/V=2150** (= príloha 37652). Sklo dimenzie NEHÁDŽ — over `sietkaSamostatnaVypocet`
  probom pred zápisom do testu.
- **E2E jokle asercie NIKDY pevný mm literál zo seedu — post-deploy beží proti PROD cfg (#555 HOTFIX).**
  Robust vzorce sú na PROD upravené editorom (sklo/sieťovina +3 mm vs seed), takže pevný jokel
  literál (napr. „4×1575 mm") padne LEN v deploy jobe (CI `test` so seedom prejde). E2E preto
  **odvodzuje** očakávaný jokel z rozmeru sieťoviny na tej istej stránke cez `jokleZoSietoviny`
  (`e2e/helpers.ts`, testid `sietka-rozmer` / `sietka-samostatna-rozmer`); delta drží paritu s
  `JOKLE_DELTA`/`JOKLE_KS` cez `tests/sietka-jokle.test.ts`. **Unit vektory ostávajú pevné**
  (seed = deterministický). Plné pravidlo: `.claude/rules/testing.md` — „Post-deploy E2E beží
  proti ŽIVEJ PROD cfg".
