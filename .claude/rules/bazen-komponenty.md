---
paths:
  - 'src/lib/bazen-komponenty.ts'
  - 'src/lib/server/bazen.ts'
  - 'src/routes/bazen/+page.svelte'
  - 'tests/bazen-komponenty.test.ts'
  - 'e2e/bazen-komponenty.spec.ts'
---

# Bazén — kusové komponenty odpisu (BPK*, #355)

Bazénový odpis má DVE compute vrstvy, ktoré sa NESMÚ zlúčiť do jednej:

- **`computeBazen`** (`src/lib/server/bazen.ts`) = metrážové profily `BPP*` (jednotka
  `m`). Má **golden vektory** (`tests/bazen.test.ts` — `out.length`, presné kódy) → NIKDY
  ho nemeň pri pridávaní komponentov (append by rozbil `out.length`).
- **`pocitajBazenKomponenty`** (`src/lib/bazen-komponenty.ts`) = kusové komponenty `BPK*`
  (jednotka `ks`). Client-safe dátový katalóg `[kod, nazov, (ctx)=>qty][]` (vzor #338
  `komponenty.ts`): 0/záporné qty → riadok sa VYNECHÁ (nikdy „0 ks" do Money), nezvolený
  variant (RAL 9006/7016, strana L/P, pant ELOX/9005) vráti 0 = absent.
- **`computeBazenAll`** zreťazí `[...profily, ...komponenty]` — volajú ho route akcie
  (`+page.server.ts` `spocitat`/`odoslat`), NIE `computeBazen`.

## Jednotka `ks` a Money zápis

- `BazenPolozka.mj?: 'm'|'ks'` — profily bez `mj` (default `m`), komponenty `mj:'ks'`.
  Tečie cez `applyEdits` (`{...o}` spread) → `odpis_polozky.mj` → xlsx MJ stĺpec
  (`money.ts` `o.mj ?? 'm'`). Money má MJ na karte zásoby.
- **`applyEdits` odmieta ZLOMKOVÚ ručnú úpravu na `mj==='ks'` riadku** (kusový výdaj =
  celé číslo). Pole je `step="any"`, takže bez tejto kontroly by `2,5 ks` išlo do Money.
- Nový `BPK*` kód sa NEDÁ overiť offline (v repe nie je Money snapshot katalógu zásob);
  pri prvom LIVE importe ho odchytí existujúci `writeOdpis` `unknown-kod` blok.

## Voľby a mapovanie na existujúce vstupy

- `kolaj` (jedno/dvoj), `dvere`, `pocetSekcii` a veľkosti sekcií (`vs/ss/ms` → veľká=
  `vs4500+vs6000`, stredná=`ss*`, malá=`ms*`) sú EXISTUJÚCE vstupy — napájaj na ne, neduplikuj.
- **Výklopné čelo „zapnuté" = SAMOSTATNÝ checkbox `vyklopneCeloOn` (#450), NIE odvodené
  z počtu.** Do #450 platilo „`vyklopneCelo (počet) > 0`, žiadny nový boolean" — Dominik
  (screenshot formulára) chcel EXPLICITNÝ prepínač, lebo dropdown „Pant výklopného čela"
  pôsobil ako vždy aktívny. `vyklopneCeloOn` (form checkbox, presne ako `vetraciaKlapka`)
  je odteraz JEDINÝ zdroj pravdy pre Madlo/Pant ELOX/Pant 9005/Krídlová matica
  (BPK202514/516/517/520). Číselné pole „Výklopné čelo (počet)" (`vyklopneCelo`) ostáva
  NEZÁVISLÉ — poháňa LEN metrážový profil BPP00083 (surový materiál), nič v BPK vrstve.
  Obe polia môžu byť nastavené nezávisle (checkbox zapnutý s počtom 0, alebo naopak) —
  to je ZÁMER, nie chyba: BPK a BPP sú oddelené vrstvy, presne ako táto rules-hlavička
  zdôrazňuje vyššie.
- `model` je **whitelist** v `parseBazenVstup` (`'Premier'|'Exclusive'|'Star'`, iné →
  `Premier`) — EXCLUSIVE = `model.includes('exclusive')`. POZOR: legacy zlúčené
  `'Premier / Exclusive'` obsahuje `exclusive` → bez whitelistu by odpísalo spojku M8
  `BPK00108` aj Premier zákazke (preto whitelist mapuje legacy → `Premier`, bezpečný smer).

## Testovacia pasca: `computeBazen` (BPP*) NIKDY nevynecháva riadky — `computeBazenAll` výstup testuj podľa `qty`, nie podľa prítomnosti (#450)

`computeBazen`'s `out` = **CELÝ** BOM (`BOM.map(...)`, bez filtra) — aj riadky s `qty: 0`
zostávajú v poli (komentár priamo v kóde: „celý rozpis (aj nulové položky) — kontrolná
stránka ukáže všetko editovateľné"). Toto je OPAČNÉ ako `pocitajBazenKomponenty` (BPK*),
ktorá 0/záporné qty VYNECHÁVA (vyššie). Pri písaní testu nad `computeBazenAll(...).out`,
ktorý overuje, že istý BPP kód „sa neodpíše": `out.find(o => o.kod==='BPP0008X')` VŽDY
nájde záznam — assertuj `?.qty` na `0` (alebo `toBe(0)`), NIE `toBeUndefined()`. Zámena
stála prvý red-run kolo pri #450 (test čakal `toBeUndefined()`, dostal `{qty:0}`).

## `.grid3` (3-stĺpcový) riadok — pridanie 4. poľa osirotí posledné pole na samote (#450)

`app.css` `.grid3` je `grid-template-columns: 1fr 1fr 1fr` — 4. `<div class="field">`
vloženého do existujúceho 3-poľového `.grid3` riadku sa NEZALOMÍ pekne, len presunie
POSLEDNÉ pôvodné pole samo do nového riadku s 2 prázdnymi bunkami vedľa (review 🔵 pri
#450, checkbox „Výklopné čelo" pridaný medzi RAL krytiek a Pant dropdown). Fix: NEcpi 4.
pole do existujúceho grid3 — buď rozdeľ na dva grid3 riadky s presne 3 poľami každý,
alebo (keď je 4. pole logicky nezávislé od zvyšných 3, ako tu Vetracia klapka) vytiahni
ho mimo grid úplne, ako **plain `<div class="field">`** (vzor „Čaká na materiál" nižšie
v tom istom formulári — `class="opt"` bez `opt-grid`, žiadny grid wrapper).

## E2E pasca — `BPK*` kódy majú PREFIXOVÉ kolízie

`BPK20251` je podreťazec `BPK202510` (a `BPK20252` ⊂ `BPK202521`, `BPK20254` ⊂ `BPK202540`…).
Playwright `.locator('.row', { hasText: kod })` je substring + strict-mode → holý `kod`
matchne DVA riadky. Cieľ riadok cez **`${kod} ·`** (kód + medzera + oddeľovač z
`{o.kod} · {o.nazov}`) — `"BPK20251 ·"` nie je podreťazcom `"BPK202510 · …"` (za prefixom
je `0`, nie medzera). Viď `e2e/audit3.spec.ts` parity slučku.

## Drift-guard KATALOG proti Dominikovej tabuľke (#368)

`bazen-komponenty.ts` exportuje `BPK_KODY` = `KATALOG.map(([kod]) => kod)` (usporiadaný
zoznam všetkých BPK kódov, jeden zdroj pravdy). `tests/bazen-komponenty-katalog.test.ts`
ho zamyká proti **nezávisle prepísanému** 57-kódovému zoznamu z `att 14674` (poradie riadkov
tabuľky = poradie kódov). Kľúčové: expected list je transkript Z TABUĽKY, NIE odvodený z
`KATALOG` — inak by bol test tautologický. Test kontroluje množinu + poradie + dosiahnuteľnosť
(union 12 variantov pokrývajúcich všetky výlučné voľby = presne celá tabuľka). Tichý
drop/add/reorder kódu padne v CI. Pri zmene katalógu (Dominik dodá revíziu) uprav OBOJE:
`KATALOG` aj `TABULKA_14674` v teste, a over negatívnou mutáciou (odober 1 kód → test RED).

**Verify-vs-source pasca:** #368 ("overiť/doplniť podľa 98-riadkovej tabuľky") mieril na
funkciu, ktorú #355 už implementoval z TOHO ISTÉHO `ir.attachment 14674` / `msg 1768496` —
57/57 kódov, identická množina aj poradie. Kým píšeš nový kód, over MECHANICKY (openpyxl:
extrahuj `BPK` kódy z xlsx, porovnaj set+poradie s `KATALOG`), či zdroj tiketu nie je ten
istý súbor ako predošlá implementácia. 98 riadkov ≠ 98 kódov: hlavičky sekcií + viacriadkové
pravidlá nožičkových krytiek (VELKÁ/STREDNÁ/MALÁ na 3 riadkoch) dávajú 57 skutočných kódov.
