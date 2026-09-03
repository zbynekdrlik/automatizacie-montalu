---
paths:
  - 'src/lib/server/konfigurator-zimna-zahrada-cena.ts'
  - 'src/lib/server/konfigurator-zimna-zahrada-vstup.ts'
  - 'src/lib/server/cennik-zimna-zahrada.json'
  - 'src/lib/konfigurator-zimna-zahrada.ts'
  - 'tests/konfigurator-zimna-zahrada-cena.test.ts'
  - 'tests/konfigurator-zimna-zahrada.test.ts'
  - 'scripts/konfigurator-zimna-zahrada-cennik-fetch.mjs'
  - 'scripts/konfigurator-zimna-zahrada-cennik-drift.mjs'
  - 'src/routes/konfigurator/zimna-zahrada/+page.server.ts'
  - 'src/routes/konfigurator/zimna-zahrada/+page.svelte'
---

# Interim cenotvorba zimných záhrad (#408 báza + #429 systém stien) — matica montalu.sk + osi, ktoré NESEDIA s ticketom

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
  **šírku**" (pozdĺž steny) + `glazing` (systém STIEN: `delux|standard-plus|slide|robust` × sklo stien,
  6 kombinácií — **#429: TERAZ cenotvorná os, PREDTÝM #408 fixná báza**) + `roofing` (STREŠNÉ
  zasklenie: 4 slugy). `glass_add` = príplatok. **`color` a `warranty` cenu NEMENIA.**
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

## Interim mapovanie (Prístup 3, #408) → Prístup 1 rozšírenie (#429 — systém stien TERAZ vystavený)

**#429 (owner directive „rob čo vieš robiť" 2026-09-03) REALIZOVAL Prístup 1 z #408's follow-up:**
systém stien (`glazing`) je TERAZ 4. reálna cenotvorná os, zákazník si ho vyberá (predtým bol fixný
báza). Interim mapuje VŠETKY 4 REÁLNE voliteľné osi: `hlbka → length`, `sirka → width`, `Zasklenie(4)
→ roofing(4)` 1:1 (nezmenené #408 mapovanie), **`Systém stien(6) → glazing(6)` 1:1 (#429 NOVÉ)** —
`glass_add=Bez úpravy`, neutrálnej farbe nezmenené. Default systém stien = báza
`slide|izolacne-sklo-16-mm` (NON-BREAKING — kto voľbu nezmení, dostane byte-identickú cenu ako pred
#429).

- **6 kombinácií systém stien × sklo** (`data-update` radio labely, network capture na
  `/konfigurator/zimne-zahrady`, `name="glazing"`): `delux|kalene-sklo-10-mm` (Deluxe bezrámový -
  10mm), `standard-plus|rezane-sklo-6-mm` (Štandard plus - 6mm), `standard-plus|izolacne-sklo-16-mm`
  (Štandard plus - 16mm), `slide|rezane-sklo-6-mm` (Slide - 6mm), `slide|izolacne-sklo-16-mm` (Slide -
  16mm, = báza/default), `robust|izolacne-sklo-24-mm` (Robust - 24mm IZO). Rozptyl pri hĺbke 4×šírke 3
  m (roofing izo24): MO net 11 671,55 € (standard-plus 6mm, najlacnejší) až 13 717,63 € (robust 24mm,
  najdrahší) — presne ~2 000 € rozptyl, ktorý #429 ticket predpokladal.
- **Model ROBUST/MASSIVE = ĎALEJ DISPLAY spec, NIE cenotvorná os** (nezmenené #429). Nesie sa cez
  **KOMPOZITNÝ** `PonukaConfig.systemKod = "${model}|${systemStien}"` (`zzSystemKod`/`parseZzSystemKod`
  v `konfigurator-zimna-zahrada.ts`, presný vzor #410 oplotenie kompozitný systemKod — pozri
  `konfigurator-oplotenie-cena.md`) — model časť je LEN display label do `VerejnaCena.model`, systém
  stien časť je CENOTVORNÁ. Matica je TERAZ `glazing × roofing × hĺbka × šírka` (predtým `roofing ×
  hĺbka × šírka`).
- **Delimiter `|` je bezpečný**, lebo ani `ZzModel` (ROBUST/MASSIVE) ani `ZZ_SYSTEMY_STIEN.nazov`
  (žiadna z 6 hodnôt) neobsahujú `|` (drift guard test).
- **STARÝ riadok (spred #429, `systemKod` = LEN model, žiadny `|`) sa degraduje na BÁZOVÝ systém
  stien** (`parseZzSystemKod` fallback bez `indexOf('|')` zásahu) — presne to, čo bolo v čase podania
  jediné cenené (čestné honest-degrade, nie tiché prepočítanie na inú cenu).
- **`hlbkaGridM` nesie HĹBKU, `sirkaGridM` ŠÍRKU** — grid-note v PDF (`cenaRiadky`, `cfg.hlbka ?? cfg.dlzka`
  → tu `cfg.hlbka`) renderuje „šírka × hĺbka" (ELSE vetva bez `cfg.dlzka`), zhodne so stránkou „Rozmery (š × h)".

## Produkt-aware dispatch + honest-degrade (systemKod-gated)

- `dopyt-cena-stamp.cenaZCfgProdukt` má rameno `zimna-zahrada`: `hlbka`+`sirka`+`sklo`(zasklenie→roofing)
  + **`systemKod`(→ #429 `parseZzSystemKod` → model+systém stien→glazing)**; **`systemKod` PRÍTOMNOSŤ
  odlišuje NOVÝ (opečiatkovateľný) riadok od STARÉHO honest-null dopytu pred #408** — bez neho vráť
  `null` (aby starému honest-null zimná dopytu nedostal ticho cenu; vzor bazén). Nová vetva je ADITÍVNA
  (paralela k #410 oplotenie ramenu) — drž ju minimálnu pre čistý serial-merge.
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

## Regenerácia seedu (#429: teraz 4D matica, ~2600 buniek, ~9 min)

`node scripts/konfigurator-zimna-zahrada-cennik-fetch.mjs` teraz sweepuje `glazing(6) × roofing(4) ×
hĺbka(9) × šírka(12) = 2592` buniek (predtým #408 `roofing(4) × hĺbka(9) × šírka(12) = 432`) — v
rozsahu už existujúceho oplotenia (~3690 buniek), žiadny nový výkonový limit. Drift-check
(`konfigurator-zimna-zahrada-cennik-drift.mjs`) vzorkuje PER (glazing,roofing) pár (rohy + pár
vnútorných), 24 párov namiesto pôvodných 4 roofingov — stále bounded (~58 s).

## Vzťah k #279 a scope

Interim orientačná cena (zrkadlo montalu.sk), NIE finálny cenník od šéfa (#279). **#429 Prístup 1
(systém stien vystavený, cena naň reaguje) je DOKONČENÝ** — pôvodný #408 follow-up „owner-decision:
expozícia systému stien" je vyriešený, žiadny ďalší otvorený follow-up k tejto osi.
