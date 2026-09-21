---
paths:
  - 'src/lib/sietka.ts'
  - 'src/lib/server/compute-sietka.ts'
  - 'src/routes/sietka/**'
  - 'src/lib/components/zasklenia/PlanKarty.svelte'
  - 'src/lib/components/zasklenia/PlanKartyMulti.svelte'
---

# Sieťka (moskytiéra) — jokle, honest-null, jeden zdroj vzorca

Doména sieťky je rozliata cez `sietka.ts` (čisté helpery + konštanty) → `compute-sietka.ts`
(samostatná /sietka výpočet + multi) → `compute-odpis.ts` (sieťka NA posuve, Money delta)
→ UI karty `PlanKarty`/`PlanKartyMulti` + route `/sietka`. Historické korekcie sú v hlavičke
`sietka.ts` (#86–#110) a v `tests/compute.test.ts` (kontraktové Money vektory).

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
tam nie je). Preto rovnaký **honest-null** kontrakt ako CLIP drobné (`clip.ts`, `clip.md`):

- `SietkaSamostatnaMaterialRow.kod: string | null` — jokle sú 2 riadky s `kod: null`
  (šírka 4 ks, výška 4 ks), ZOBRAZIA sa, ale do `odpis` NEVSTUPUJÚ. Money-neutralita je
  **štrukturálna**: `odpis` sa plní len z reálnych `byKod` profilov, jokle sa tam nikdy
  nedostanú (`OdpisRow.kod: string` je typová bariéra). Guard: Robust vektory `odpis`
  ostávajú byte-identické (`tests/compute.test.ts`, `tests/sietka-jokle.test.ts`).
- **Keď výroba založí Money kartu „Jokel 12x8" s kódom** → jokle sa zapnú do odpisu ZMENOU
  `JOKLE_PROFIL` → skutočný kód (dáta), bez zásahu do compute/route (rovnaký kontrakt ako
  CLIP drobné, `clip.md`).

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
