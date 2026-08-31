---
paths:
  - 'src/lib/bazen-komponenty.ts'
  - 'src/lib/server/bazen.ts'
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
- Výklopné čelo „zapnuté" = existujúci `vyklopneCelo (počet) > 0` (žiadny nový boolean).
- `model` je **whitelist** v `parseBazenVstup` (`'Premier'|'Exclusive'|'Star'`, iné →
  `Premier`) — EXCLUSIVE = `model.includes('exclusive')`. POZOR: legacy zlúčené
  `'Premier / Exclusive'` obsahuje `exclusive` → bez whitelistu by odpísalo spojku M8
  `BPK00108` aj Premier zákazke (preto whitelist mapuje legacy → `Premier`, bezpečný smer).

## E2E pasca — `BPK*` kódy majú PREFIXOVÉ kolízie

`BPK20251` je podreťazec `BPK202510` (a `BPK20252` ⊂ `BPK202521`, `BPK20254` ⊂ `BPK202540`…).
Playwright `.locator('.row', { hasText: kod })` je substring + strict-mode → holý `kod`
matchne DVA riadky. Cieľ riadok cez **`${kod} ·`** (kód + medzera + oddeľovač z
`{o.kod} · {o.nazov}`) — `"BPK20251 ·"` nie je podreťazcom `"BPK202510 · …"` (za prefixom
je `0`, nie medzera). Viď `e2e/audit3.spec.ts` parity slučku.
