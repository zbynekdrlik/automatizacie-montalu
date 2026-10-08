---
paths:
  - 'src/lib/odpad.ts'
  - 'src/lib/components/RozpisRezov.svelte'
  - 'src/lib/server/optimalizator.ts'
  - 'src/lib/server/odpad-store.ts'
  - 'tests/*odpad*.test.ts'
  - 'tests/rozpis-rezov*.test.ts'
  - 'e2e/odpad-kg-*.spec.ts'
---

# Odpad z nárezov (offcut / zvyšky tyčí) — #417

Kde v appke žije „odpad z rezu" (zvyšný materiál po nareze), aby si to nemusel
zakaždým odznova hľadať:

- **Zdroj pravdy = `ffdPack` (bin-packing) v `src/lib/server/compute-model.ts`.**
  Každá `Tyc` má `zvysok` (koncový offcut v mm), `MaterialRow` má `odpadMm` +
  `odpadPct` **per profil** (vzorec `odpadMm / (tyce × barLen)`, `×1000 → round → /10`).
- **Počíta sa LEN pri zaskleniach** — `computeFlat`/`computeMulti` v
  `compute-odpis.ts`. **Pergola nárez, bazén ani CLIP offcut NEpočítajú** (iný engine;
  ich „zvyšok" v kóde znamená konštrukčnú geometriu, nie odpad z rezu). Ak treba odpad
  aj tam, je to samostatná väčšia práca (nový výpočet), nie doplnenie zobrazenia.
- **Zobrazenie = `RozpisRezov.svelte`** (klientský display): hlavička profilu ukazuje
  per-profil `odpad {mm} ({%})`, každá tyč má šrafovaný „odpad" segment. Používa sa v
  `zasklenia/PlanKarty.svelte` (1 posuv), `zasklenia/PlanKartyMulti.svelte` (viac
  posuvov, zdieľané tyče) a v `routes/optimalizator/+page.svelte` (samostatná #212
  kalkulačka, jednomateriálová — má vlastný „Celkový odpad" riadok).
- **Kumulatívny súčet naprieč profilmi (#417) = `sumaOdpad(material)` v
  `src/lib/odpad.ts`** (pure, client-safe — importuje LEN typ `MaterialRow`, rovnaká
  disciplína ako `cut.ts`). `RozpisRezov` z neho kreslí riadok `data-testid="odpad-spolu"`
  **gated `profily > 1`** (pri 1 profile je súčet totožný s per-profil hlavičkou → skrytý,
  aby sa v `/optimalizator` nezdvojoval). `%` = `Σ odpadMm / Σ(tyce × barLen)` — vážený,
  identický so per-profil vzorcom. Filter vylúči NaN/nekonečný riadok (obrana ako
  `m.barLen ?? bar` v komponente).
- **Money-neutrálne:** odpad je čisto display — žiadny `writeOdpis`, žiadny import
  `server/money`, žiadne katalógové kódy/ceny. `odpad.ts` sa preto NESMIE dotknúť Money.
- **RozpisRezov each-key: `(m.kod || m.nazov)` (#482 review nález).** `{#each}` je
  kľúčovaný cez `(m.kod || m.nazov)`. Konzument s prázdnym `kod` (display-only modul
  bez Money kódov, napr. `/plan-rezov`) a 2+ profilmi by bez fallbacku na `nazov` hodil
  Svelte `each_key_duplicate` v prode. Existujúci Money konzumenti (zasklenia, pergola,
  optimalizátor) majú vždy neprázdny `kod`, takže fallback na `nazov` sa u nich neuplatní.
- **Odoo evidencia (#417 fáza 2) = `odpis_odpad` DB tabuľka + sekcia v Odoo log-note.**
  Form akcia zasklenia po úspešnom `writeOdpis` zavolá `saveOdpisOdpad(zak, op, material)`
  (`odpad-store.ts`), ktorý uloží per-profil offcut do tabuľky `odpis_odpad` (FK CASCADE
  na `odpis_log`). Note builder (`pushZakazkaToOdoo` v `odoo-zakazka.ts`) ich agreguje cez
  `getOdpadForOdpisy` a vykreslí sekciu „Odpad z nárezov" v HTML log-note (tabuľka per profil
  + súčet). Retry/sweep (#349) funguje — dáta sú v DB, re-derivácia ich vždy nájde.
  `money.ts` sa NEMENÍ (odpad sa ukladá z form akcie, nie z writeOdpis).

## Odpad aj v KILOGRAMOCH (#606, Odoo úloha 1366, vzorec 1:1 s odoo-erp 9076)

- **kg/m LEN z Odoo karty** — `MaterialRow.kgNaM?: number | null` (`compute-model.ts`) doplní server
  cez `odoo-katalog.ts` `planSKgNaM(plan)` (aktívna `product.product` podľa kódu, `montalu_kg_per_m`;
  detail čítania + 403 pasca v `odoo-katalog.md`). `undefined` = nezisťované (Odoo nedostupné, b2b,
  modul bez kódov — optimalizátor, /plan-rezov — alebo modul, ktorý ešte nie je napojený: CLIP pílový
  plán MÁ Money kódy, ale #606 ho podľa návrhu nenapojil), `null` = karta kg/m nemá. ŽIADNA kg/m
  tabuľka v appke ani z Money (druhá pravda — #9076 zamietlo).
- **Čistá matematika v `odpad.ts`** (client-safe, žiadny Money import): `odpadKgProfilu(m)` =
  `odpadMm/1000 × kg/m` (2 desatinné) alebo `null`; `sumaOdpadKg(material)` → `{zobrazit, odpadKg,
  materialKg, hmotnostPct, chybaKgNaM}`. Materiál kg = `tyce × barLen/1000 × kg/m`; % hmotnosti =
  Σ odpad kg / Σ materiál kg z NEzaokrúhlených súčtov (VÁŽENÉ — 1 z 10 + 30 zo 100 = 28,18 %, nie 20 %).
  Profil bez kg/m sa do kg nezaráta (ako Odoo: 0 v oboch súčtoch) a ide menovite do `chybaKgNaM`
  (kód, inak názov). Rovnaká množina profilov ako `sumaOdpad` (tyce > 0, bez NaN). `sumaOdpad` sa
  NEMENÍ (jeho testy porovnávajú presný tvar výsledku) — kg sú VEDĽA, dĺžkové % ostáva.
- **`zobrazit=false` keď kg/m nemá ŽIADNY profil** (dnešný PROD 403, CI bez Odoo, karty bez kg/m) →
  `RozpisRezov` je TEXTOVO rovnaký ako pred #606 (žiadne „kg/m chýba" šum; SSR pridá len prázdne
  `{#if}` komentárové značky). Inak hlavička profilu
  „odpad 1204 mm (8 %) · 1,55 kg" (`data-testid="odpad-kg"` + `data-kod`) alebo „· kg/m chýba"; riadok
  súčtu „· X kg z Y kg (Z % hmotnosti)" (`odpad-spolu-kg`) + „· neúplné — kg/m chýba: KÓD"
  (`odpad-kg-neuplne`). Súčtový riadok ostáva gated `profily > 1`. Nie je `noprint` → tlačí sa.
- **Pasca whitespace:** Svelte zmaže medzeru na ZAČIATKU tagu aj okolo `{#if}` → oddeľovač „ · " je
  vo výraze (`SEP` konštanta / `kgProfilu()`); `{' · '}` literál zas zhodí eslint
  `svelte/no-useless-mustaches`. SSR test `tests/rozpis-rezov-kg-606.test.ts` stráži aj „(8 %) · rez".
- **Kde sa obohacuje:** `zasklenia/+page.server.ts` cez `kgPlanPre(user, r)` — `stavNahlad`/
  `stavNahladMulti` (v `Promise.all` s cenami/skladom, jeden 3 s timeout), `odoslat`/`odoslatMulti`
  re-náhľad aj hotovo (hotovo: promise sa spustí PRED `writeOdpis`, súbežne so zápisom; nikdy nehádže,
  takže nemôže spadnúť do catch „Zápis odpisu zlyhal"). `planSKgNaM` vstup NIKDY nemení — `r.material`
  pre `saveOdpisOdpad`/`writeOdpis`/`planHash` ostáva (akčný test `tests/zasklenia-odpad-kg-606.test.ts`:
  rovnaký `planHash`, rovnaké `odpis_odpad` riadky ako referenčný odpis BEZ Odoo).
- **b2b = bez kg** (`kgPlanPre`, hranica ako `cenyPre`): kg/m je v Odoo len pre interné roly a z kg
  odpadu by si ho veľkoobchod dopočítal. Test s b2b `locals` pri živom kanáli.
- **Ďalší modul** s kódmi profilov a `RozpisRezov` (CLIP pílový plán `clip-narez.ts`, …) = zavolať
  `planSKgNaM` na jeho plán (+ b2b hranica tej routy) — #606 to podľa návrhu (scope zasklenia) nerobí.
- **E2E:** `e2e/odpad-kg-606.spec.ts` porovnáva UI s `/health` `kgZdroj` (vzor #599 zdroj cien) — CI
  bez Odoo = žiadny kg text; vetvu „kg zobrazené" deterministicky kryje SSR render s fixtúrou kg/m.
  Ručne v prehliadači: lokálny mock Odoo (node http, odpovedá len `product.product` read s
  `montalu_kg_per_m`, inak 403) + `vite dev` s `ODOO_JSON2_URL` na mock + `BASE_URL` → spec ide
  vetvou `odoo` (overené 8.10.: 7,76 kg z 30,57 kg = 25,37 %, „kg/m chýba: ZASP00010", tlač aj zero-console).
