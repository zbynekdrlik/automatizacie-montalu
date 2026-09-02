---
paths:
  - 'src/lib/server/konfigurator-obalky.ts'
  - 'src/routes/konfigurator/oplotenie/+page.svelte'
  - 'src/routes/konfigurator/bazen/+page.svelte'
  - 'tests/konfigurator-obalky.test.ts'
---

# Cenníkové rozmerové OBÁLKY vystavené do UI konfigurátora (#427)

Per-typ (oplotenie) / per-model (bazén) rozmerová obálka = hranice rozmerov, ktoré MAJÚ v
katalógu orientačnú cenu. Zákazník ju vidí ako „Cenníkový rozsah pre <typ/model>: …" pri
Rozmeroch + čestnú „mimo rozsah = na vyžiadanie" hlášku — namiesto „nemej steny" individuálnej
ponuky (predtým sa dozvedel až po kliku na cenu).

## Odvodenie zo seedu v SAMOSTATNOM server module — nie v cena module

`src/lib/server/konfigurator-obalky.ts` odvodí `OPLOTENIE_OBALKY` (per-typ) / `BAZEN_OBALKY`
(per-model) PRIAMO z cenníkových seedov (`cennik-oplotenie.json` = typ→model→výška→šírka;
`cennik-bazen.json` = model→dĺžka→šírka) — bunka je/nie je → min/max rozmerový kľúč × 1000 = mm.
Seed = jediný zdroj pravdy → žiadny drift.

- **VLASTNÝ modul, NIE export do `konfigurator-*-cena.ts`.** Cena moduly refaktoruje paralelná
  práca (#426/#428 = vnútro cenových modulov) — samostatný modul = nulový merge konflikt, a
  odvodenie je čisto nad DÁTOVÝM seedom (žiadna zmena aritmetiky ceny).
- **Obálka oplotenia je PER-TYP (model-nezávislá v rámci typu)** — overené: všetkých 6 cenových
  modelov má v rámci typu identické rozmerové pokrytie; ATYP je MODEL (nie typ) a nemá v seede
  bunky → vždy individuálna → v UI zvlášť vetva „na mieru". Bazén obálka je PER-MODEL (Premier/
  Star/Exclusive sa líšia šírkou; výška NIE JE cenotvorná os → nie je v obálke).
- Seedy sú plné obdĺžniky (fullness overená) → „šírka do X m" je presné (každý bod v
  [min,max]×[min,max] má cenu).

## Money-safety: obálka = LEN rozmery

Modul je server-only (`$lib/server/`) → SvelteKit blokne klientsky import + leak-guard (A)
`KLIENT_ZAKAZANE_SPEC /\/server\//` ho stráži. `load` pošle klientovi `data.obalky` = LEN
číselné mm rozmery (žiadna cena/VO/Money kód/matica) → prejde existujúcimi (C) load guardmi
(`not.toMatch(/cena|priceB2B|cennik|€|moneyKod|hladina/)`). Klient `.svelte` číta `data.obalky`,
NEIMPORTUJE modul.

## „mimo obálky" hláška PODFLAGUJE (bezpečný smer)

Cena zaokrúhľuje rozmer na najbližší katalógový bod (`zaokruhliNaMriezku`, krok = `r.<os>.krok`).
Preto `mimoObalky = rozmer > maxMm + r.<os>.krok/2` — teda hlášku ukáž až keď by sa rozmer
zaokrúhlil ZA obálku. NIKDY neflaguj „mimo" pri rozmere, čo sa ešte zaokrúhli na cenu (falošná
hláška by klamala). Generózne steppery ostávajú (atypický rozmer sa STÁLE dá zadať → dopyt lead;
owner rozhodnutie: hybrid, NIE clamp ako #389 tienenie — clamp stráca atypický lead).

## ANTI-DRIFT test je povinný (nevákuový)

`tests/konfigurator-obalky.test.ts` viaže odvodenú obálku na REÁLNE správanie `vypocitajCenu*`:
rohy obálky (min×min, maxV×maxŠ) MAJÚ cenu, o krok za maxom (šírka +500 / výška +100 mm) je
`individualna-ponuka`. Zmena seedu tak posunie obálku AJ toto správanie spolu, alebo test spadne.
Presný `toEqual` na hranice (nie len „nie je prázdne") je druhá vrstva.

## Ďalší produkt (zimná záhrada, tienenie…) = rozšírenie modulu

Nový produkt s cenníkovým seedom: pridaj `<produkt>Obalky` do `konfigurator-obalky.ts` (rovnaké
odvodenie zo seedu), `load` → `data.obalky`, stránka zobrazí rozsah + mimo-hlášku. Pridaj do
`konfigurator-obalky.test.ts` presné hranice + anti-drift sondu. Produkt bez vyťaženej matice
(honest-null cena) obálku NEMÁ — nič nevystavuj.
