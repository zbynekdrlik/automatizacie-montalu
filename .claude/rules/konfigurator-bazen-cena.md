---
paths:
  - 'src/lib/server/konfigurator-bazen-cena.ts'
  - 'src/lib/server/konfigurator-bazen-vstup.ts'
  - 'src/lib/server/cennik-bazen.json'
  - 'tests/konfigurator-bazen-cena.test.ts'
  - 'scripts/konfigurator-bazen-cennik-fetch.mjs'
  - 'scripts/konfigurator-bazen-cennik-drift.mjs'
---

# Interim cenotvorba bazéna (#404) — matica montalu.sk + produkt-aware cenová dispatch

Zrkadlo pergolovej interim cenotvorby (`konfigurator-cena.md`), parametrizované na bazénové osi.
Server-only, Money-neutrálne. #404 ODBLOKOVAL orientačnú cenu bazéna (`cenovyZdroj:true`).

## Endpoint montalu.sk — bazénová signatúra je INÁ než pergolová

`POST https://montalu.sk/konfigurator/update-pools` (multipart). Konfigurátor:
`GET /konfigurator/zastresenia-bazenov` (NEOČAKÁVANÝ slug — nie `-bazeny`). Read-only, len cenový
endpoint. Kontext (token/valid_from/session cookie) rovnako ako pergola (`getSetCookie` headless funguje).

- **Cenotvorný vstup:** `length`(m) + `width`(m) + `segments_length` (`standardna`|`skratena`) +
  `calculate[]` = `{"model":"PBPPP00001"}` (Premier), `PBSPP00001` (Star), `PBEPP00001` (Exclusive).
  `configurator_id=pools`, `variants` ľubovoľný validný (`PBSPP00143`). ŽIADNY `roofing` (bazén je
  vždy polykarbonát) — to je hlavný rozdiel oproti pergole.
- **Odpoveď:** `calculate[]` = `{value, price (MO net), priceB2B (VO net)}`; `0`/absent = nedostupné.
  Cena NEZÁVISÍ od farby / koľaje / výšky / počtu segmentov / výplne — LEN model × length × width ×
  segments_length. Orientačná = `segments_length=standardna` (bázová, default).
- **Reverzné odvodenie = Playwright network capture, NIE WebFetch** (§12 pasca): zachyť REÁLNY
  `update-pools` request browserom → vidíš presný tvar `calculate[]`; potom headless fetch enumeruje.

## Mriežka + envelope + zaokrúhlenie

- Naša mriežka: dlzka 3–15 m /0,5, sirka 2–7 m /0,5 (`BAZEN_RANGES`, `RozmerStepper` tlačidlá krokujú
  po 500 mm). Seed enumerujeme PRESNE v 0,5 m bodoch → lookup je EXAKTNÝ pre on-grid vstupy.
- montalu: length round-nearest 0,5; width **floor 0,25**. Náš modul zaokrúhľuje na najbližší 0,5 m
  bod — pre on-grid EXAKTNÉ, pre off-grid (metrový textový stepper píše na 100 mm mriežku,
  `parseMetreNaMm`!) je to APROXIMÁCIA (smer NADhodnotenie = bezpečné pre orientačnú cenu). Preto
  `zaokruhliNaMriezku` komentár NEsmie tvrdiť „faithful mirror pre všetky vstupy".
- Reálne pokrytie: dlzka do 12,5 m; sirka Premier do 6,0 / Exclusive 5,5 / Star 4,5 (per-model
  envelope). Nad pokrytie/katalóg ⇒ `individualna-ponuka` (NIKDY neextrapoluj).

## DPH 23 % half-up v centoch + HRANIČNÁ parity kotva

`sDphEur` = `Math.round(round(net*100)*123/100)/100` (identické s pergolou; PHP `round()`).
**`verifikaciaDph` MUSÍ obsahovať .xx5 hranicu**, inak test nerozlíši celocentový half-up od naivného
`net*1.23` FP driftu. Kotva #404: Premier 8,5×6,0 — VO net 13732,5 → montalu „16 890,98" (naivné FP
dá 16 890,97). Pri regen je `[8.5, 6]` v `DPH_VZORKY` fetch skriptu; entry je aj ručne v seede
(pridanie do `verifikaciaDph` NEMENÍ `CENNIK_HASH` — ten je len nad `cennik`+`dph`+`mriezka`).

## Produkt-aware cenová dispatch (kľúčové — cena NIE JE len flag)

Celá cenová cesta bola hard-coded na pergolu (`cenaZCfg` = `hlbka`+pergolový `model`+`sirka`). Bazén
má INÉ polia. Riešenie:
- `PonukaConfig` +neutrálne pole **`systemKod?:string`** = bazénový model (uložené v cfg JSON →
  deterministické pri re-downloade; NIE string-parse zo `system`). `bazenPonukaConfig` ho nastavuje.
- `VerejnaCena.model`/`CenaModelu.model`: `ModelPergoly` → **`string`** (nesie aj bazén modely; len
  label). `hlbkaGridM` pri bazéne nesie DĹŽKU (grid-note v `cenaRiadky` je produkt-aware: `cfg.hlbka ??
  cfg.dlzka`, poradie „d × š" keď `cfg.dlzka`).
- `dopyt-cena-stamp.cenaZCfgProdukt(cfg, produkt, hladina)`: `bazen` → bazénová matica (potrebuje
  `systemKod`+`dlzka`+`sirka`; bez `systemKod` — starý riadok — vráti null, honest-degrade); inak
  pergola. `opeciatkujCenuPreProdukt`/`ponuka-pdf` fallback ho volajú. **PASCA:** akýkoľvek NOVÝ
  volateľ `generatePonukaPdf` MUSÍ zaniesť `produkt` (napr. `odoo-lead.regeneratePdfBase64` #404 —
  inak sfalšovaná bazén cfg s pergolovými poľami dostane pergolovú cenu v prílohe).

## Zapojenie na stránke + guardy

- Bazén podstránka: nová `vypocet` akcia (server cena — modul je server-only) + on-page orientačná
  cena cez `use:enhance` (klik „Zobraziť orientačnú cenu"; `cenaAktualna` gating — pri zmene rozmeru
  cena zmizne, tlačidlo „Prepočítať", NIKDY neukáž cenu pre iný rozmer). `use:enhance` MUSÍ mať
  `result.type==='error'` vetvu. Cenu renderujem INLINE (`baz-cena-*`), nie zdieľaný pergolový
  `KonfCena` (má „...pergoly" label) — vedomá voľba, drží bazén self-contained.
- b2b-route-coverage: bazén action-set `['dopyt','vypocet']`. Money-safety (C): bazén `vypocet` MO
  odpoveď nesie MO, NIE VO/`hladina`/maticu. Static guard v `konfigurator-bazen-cena.test.ts` (seed+
  modul bez moneyKod/BPK*; **v komentároch píš „Money kód", NIE literál `moneyKod`** — inak guard
  false-flagne vlastný modul, #387 pasca).
- Seed `cennik-bazen.json` = dátový JSON, musí byť **prettier-clean** (`npm run format` po regen).
  Model kódy PBPPP/PBSPP/PBEPP sú montalu CENOVÉ kľúče, NIE Money ERP — nematchujú `\bBP[KP]\d{5}\b`
  (word-boundary pred „BP" v „PBPPP" nie je).

## Vzťah k #279 a scope

Toto je INTERIM orientačná cena (zrkadlo montalu.sk), NIE finálny cenník od šéfa (#279 = marže/práca/
montáž, samostatné). #404 spravil kroky 1–3 (cena); krok 4 (bazénová záväzná objednávka) = #422.
