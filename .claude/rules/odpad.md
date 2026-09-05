---
paths:
  - 'src/lib/odpad.ts'
  - 'src/lib/components/RozpisRezov.svelte'
  - 'src/lib/server/optimalizator.ts'
  - 'src/lib/server/odpad-store.ts'
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
- **Odoo evidencia (#417 fáza 2) = `odpis_odpad` DB tabuľka + sekcia v Odoo log-note.**
  Form akcia zasklenia po úspešnom `writeOdpis` zavolá `saveOdpisOdpad(zak, op, material)`
  (`odpad-store.ts`), ktorý uloží per-profil offcut do tabuľky `odpis_odpad` (FK CASCADE
  na `odpis_log`). Note builder (`pushZakazkaToOdoo` v `odoo-zakazka.ts`) ich agreguje cez
  `getOdpadForOdpisy` a vykreslí sekciu „Odpad z nárezov" v HTML log-note (tabuľka per profil
  + súčet). Retry/sweep (#349) funguje — dáta sú v DB, re-derivácia ich vždy nájde.
  `money.ts` sa NEMENÍ (odpad sa ukladá z form akcie, nie z writeOdpis).
