---
paths:
  - 'src/lib/server/konfigurator-zimna-zahrada-cena.ts'
  - 'src/lib/server/konfigurator-zimna-zahrada-vstup.ts'
  - 'src/lib/server/cennik-zimna-zahrada.json'
  - 'tests/konfigurator-zimna-zahrada-cena.test.ts'
  - 'scripts/konfigurator-zimna-zahrada-cennik-fetch.mjs'
  - 'scripts/konfigurator-zimna-zahrada-cennik-drift.mjs'
---

# Interim cenotvorba zimných záhrad (#408) — matica montalu.sk + osi, ktoré NESEDIA s ticketom

Zrkadlo bazénovej/pergolovej interim cenotvorby (`konfigurator-bazen-cena.md` / `konfigurator-cena.md`),
parametrizované na osi zimnej záhrady. Server-only, Money-neutrálne. #408 ODBLOKOVAL orientačnú cenu
(`cenovyZdroj:true`).

## KĽÚČOVÝ NÁLEZ — ticket predpokladal ZLÉ osi (montalu configurator ≠ marketingová stránka)

Ticket (a #386) predpokladal maticu `rozmery × model ROBUST/MASSIVE × zasklenie`. Reverzným odvodením
(Playwright network capture) sa POTVRDILO, že **živý konfigurátor `montalu.sk/konfigurator/zimne-zahrady`
NEMÁ os „model ROBUST/MASSIVE"** — tie prišli z MARKETINGOVEJ stránky `montalu.sk/produkty/zimne-zahrady`
(#386 best-guess). To je presne §12 pasca „VARIANTY NEVYMÝŠĽAJ" — over KAŽDÝ variant proti CENOVÉMU
konfigurátoru, nie proti produktovej stránke.

## Endpoint montalu.sk — signatúra (reverzné odvodenie = Playwright network capture, NIE WebFetch)

`POST https://montalu.sk/konfigurator/update-winter-gardens` (multipart). Konfigurátor:
`GET /konfigurator/zimne-zahrady`, `configurator_id=winter-gardens`. Kontext (token/valid_from/session
cookie) rovnako ako pergola/bazén (`getSetCookie` headless funguje).

- **Cenotvorné osi:** `length` = „A – Zadajte **hĺbku**" (vysunutie, DOMINANTNÁ os) + `width` = „B – Zadajte
  **šírku**" (pozdĺž steny) + `glazing` (systém STIEN: `delux|standard-plus|slide|robust` × sklo stien) +
  `roofing` (STREŠNÉ zasklenie: 4 slugy). `glass_add` = príplatok. **`color` a `warranty` cenu NEMENIA.**
- **POZOR na mapovanie length↔width:** montalu `length` = HĹBKA (nie šírka!). Zisti z LABELOV v HTML
  (`A - Zadajte hĺbku` → next `name="length"`), nie z rozsahu. Cena je NEsymetrická 2D plocha
  `f(hĺbka, šírka)`: hĺbka2×šírka3 ≠ hĺbka3×šírka2.
- **Odpoveď:** TOP-LEVEL `price` (MO net) + `priceB2B` (VO net) = cena CELÉHO configu (NIE per-model
  `calculate[]` ako bazén — `calculate[].price` je len fixná „od" bázová cena 5364.29). Použi top-level.
- `width` pridáva LEN nad 4 m (do 4 m rovná cena); glazing/roofing sú ADITÍVNE a ŠKÁLUJÚ s hĺbkou.

## Mriežka + zaokrúhľovanie NAHOR (iné než bazén!)

- Rozsahy: hĺbka **2–6 m** /0,5 (nad 6 mimo katalógu), šírka **2–7,5 m** /0,5 (nad 7,5 mimo). Zákaznícka
  `sirka` do 8 m → nad 7,5 m individuálna ponuka.
- montalu zaokrúhľuje rozmer **NAHOR** („Vyberáme najbližší väčší rozmer z nášho katalógu") — `zaokruhliNahor`
  (`Math.ceil`), NIE na najbližší bod ako bazén (`zaokruhliNaMriezku`). Pre on-grid vstupy (metrový stepper
  na 0,5 m) je lookup EXAKTNÝ. Nad max ⇒ null (individuálna, NIKDY neextrapoluj).

## Interim mapovanie (Prístup 3 — čestný, minimálny; owner-decision follow-up open)

Zákaznícke UI sa NEPREROBILO (Prístup 1 = expozícia systému stien = PRODUKTOVÉ rozhodnutie ownera,
follow-up). Interim mapuje REÁLNE voliteľné osi: `hlbka → length`, `sirka → width`, `Zasklenie(4) →
roofing(4)` 1:1 (Izolačné→izo24, Bezpečnostné→bezp441, Polykarbonát→polykarbonat16, Panel ISODOMUS→panel-izo24)
pri BÁZOVOM systéme stien `slide|izolacne-sklo-16-mm`, `glass_add=Bez úpravy`, neutrálnej farbe.

- **Model ROBUST/MASSIVE = DISPLAY spec, NIE cenotvorná os.** Nesie sa cez neutrálny `PonukaConfig.systemKod`
  (vzor bazén) LEN do `VerejnaCena.model` (label v PDF/on-page); cenu NEMENÍ (presné zasklenie stien sa
  upresní po obhliadke — čestná poznámka na stránke + disclaimer). Matica = `roofing × hĺbka × šírka`.
- **`hlbkaGridM` nesie HĹBKU, `sirkaGridM` ŠÍRKU** — grid-note v PDF (`cenaRiadky`, `cfg.hlbka ?? cfg.dlzka`
  → tu `cfg.hlbka`) renderuje „šírka × hĺbka" (ELSE vetva bez `cfg.dlzka`), zhodne so stránkou „Rozmery (š × h)".

## Produkt-aware dispatch + honest-degrade (systemKod-gated)

- `dopyt-cena-stamp.cenaZCfgProdukt` má rameno `zimna-zahrada`: `hlbka`+`sirka`+`sklo`(zasklenie→roofing);
  **`systemKod` PRÍTOMNOSŤ odlišuje NOVÝ (opečiatkovateľný) riadok od STARÉHO honest-null dopytu pred #408**
  — bez neho vráť `null` (aby starému honest-null zimná dopytu nedostal ticho cenu; vzor bazén). Nová vetva
  je ADITÍVNA (paralela k #410 oplotenie ramenu) — drž ju minimálnu pre čistý serial-merge.
- **PASCA (honest-null test):** `opeciatkujCenuPreProdukt('zimna-zahrada', cfg-bez-systemKod)` vráti
  `cena:null` ALE `cennikVerzia:CENNIK_VERZIA_ZZ` (audit, z ktorej matice — `maCenovyZdroj('zimna-zahrada')`
  je true). NEasertuj `cennikVerzia toBeNull` — honest-null sa dokazuje `cena:null` (cena_druh NULL →
  žiadna cena na re-downloade), nie null verziou.

## DPH 23 % half-up v centoch + .xx5 kotva

`sDphEur` = `Math.round(round(net*100)*123/100)/100` (identické s pergolou/bazénom; PHP `round()` half-up).
**`verifikaciaDph` MUSÍ mať .xx5 hraničnú bunku** (fetch skript ju hľadá cez `(moCent*23)%100===50`), inak
test nerozlíši celocentový half-up od naivného FP. Kotva: net 20641,5 → montalu „25 389,05" (naivné FP aj
Python banker's round dá 25 389,04; JS `Math.round` half-up dá .05 = montalu). Live parity kotva: hĺbka4×šírka3
izo24 → MO net 13201,66, s DPH 16238,04, VO net 8581,08, VO s DPH 10554,73.

## Testy #386 → #408 (honest-null → priced) — ktoré sa MENIA

Prepnutie `cenovyZdroj:true` MENÍ #386 honest-null kontrakt na priced (očakávaná zmena, nie weakening):
`konfigurator-produkty.test` (S_CENNIKOM +zimna-zahrada), `konfigurator-zimna-zahrada.test` (2 describe:
opeciatkujCenuPreProdukt → cena; DB round-trip → cena_druh='cena'; PDF subject „Orientačná cena"),
`b2b-route-coverage` (akcie `['dopyt','vypocet']`), `konfigurator-money-safety` (C: vypocet MO áno + VO nie),
E2E (cena na klik + `zz-cena-*`, nie „Cena na vyžiadanie"). `zz-cena-info` testid ZANIKOL.

## Vzťah k #279 a scope

Interim orientačná cena (zrkadlo montalu.sk pri bázovom systéme stien), NIE finálny cenník od šéfa (#279).
Follow-up (owner-decision): expozícia systému stien (`glazing`) v zákazníckom UI = Prístup 1.
