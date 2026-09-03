---
paths:
  - 'src/lib/lakovanie.ts'
  - 'tests/lakovanie.test.ts'
---

# Lakovanie — spotreba farby na rozvin profilov (#369)

Display-only, **Money-NEUTRÁLNE** (žiadny odpis/write). `computeLakovanie` (`src/lib/lakovanie.ts`)
je čistý modul (vzor `clip.ts`); volá ho `enrichPolozky` (`ceny.ts`) → `CenyResult.lakovanie` →
sekcia „Lakovanie" v `CenyTabulka.svelte`. Ceny v testoch sú VŽDY vymyslené (repo je verejné).

## Kde žije rozvin (kľúčový vstup — nehľadaj ho nanovo)

- **Rozvin = merná jednotka `m2` na Money artikli** — `Artikly_ArtiklJednotka.Mnozstvi`, kde
  `Jednotka_ID = 44EC8AD6-D6EF-4713-9F6A-D929206D4D03` (`Ciselniky_Jednotka.Kod='m2'`). Hodnota =
  m² povrchu na 1 bežný meter = **obvod prierezu v metroch** (Dominik ch427 msg 1788176: „čistý
  rozvin = obvod, bez automatického ×1m — plochu dopočítame z dĺžky sami"). Fyzikálny cross-check:
  `kg` merná jednotka (váha/m) ≈ obvod × stena × 2700 kg/m³ — sedí.
- Ťahá ho `scripts/ceny-snapshot.py` (LEFT JOIN, 1:1 — žiadny profil nemá >1 aktívny `m2` riadok,
  + defenzívny dedupe podľa kódu) → `material_prices.rozvin` (migrácia v38) → `PriceRow.rozvin` →
  `CenaRiadok.rozvin`. Podrobný dátový tok: `ceny-snapshot.md`. Producent na dev2 potrebuje
  `git pull` + jeden beh, kým sa rozvin objaví (dovtedy je pri profiloch `null`).
- **`m2` je spoľahlivý signál lakovaného profilu:** kovanie/tesnenie (ZASK) ho má **0/138**
  (overené live read-only). Ad-hoc Money lookupy = ten istý dev2 `money-ro-thirdparty` kanál
  (`ceny-snapshot.md`, „dev2 Money read-only kanál").

## Vzorec + eligibilita

`spotreba [kg] = rozvin [m²/bm] × dĺžka [bm] × 0,150 kg/m²` (Dominik: „150 g na 1 m²", ch207
msg 1768822). Lakovaný riadok = **prefix ∈ {ZASP, PRP, BPP}** (profilové rodiny — NIE ZASK
kovanie/tesnenie ani BPK komponenty) A kód ∉ výnimky. **Výnimky (Dominik ch427 msg 1788178,
NElakuje sa):** `BPP00092, BPP00091, BPP00097, BPP00094, PRP00047` — v Money rozvin MAJÚ, preto
sa vylučujú EXPLICITNE (nie absenciou dát).

- **Honest-null, NIKDY tiché zahodenie:** lakovaný profil, ktorý sa spočítať nedá — chýbajúci
  rozvin ALEBO **množstvo NIE v bežných metroch** (`mj !== 'm'`; napr. CLIP posiela ZASP profily
  ako `mj:'ks'` počty tyčí — bez dĺžky tyče nevieme plochu) — sa pridá ako riadok s `null`
  plochou/spotrebou a `kompletne=false` (súčet „⚠ neúplné"). „Priznáva medzeru", neskrýva ju.
- **€-náklad je zámerne `eurSpolu = null`** („čaká na sadzby"). RAL sadzba (Money cenník **LAKOVNA**:
  Lakovanie profilu 20,16 / s pigmentom 24,12 / v štruktúre 22,18 €/m²) sa nedá vybrať, kým Dominik
  nedodá **RAL rozdelenie štandard/pigment/štruktúra** (9 štandardných RAL dodal 3.9.: 9016 9006
  8003 8007 1013 7002 7012 7016 9005, „viac príde"). Po dodaní = pridať RAL→sadzba mapu + naceniť
  `plocha × sadzba`. **NIKDY hádaná cena.**

## Zobrazenie (CenyTabulka)

Sekcia „Lakovanie" je **VLASTNÁ karta `data-testid=lakovanie-card` MIMO `ceny-tabulka`** — inak
by profilový honest-null riadok duplikoval `tr` vnútri `ceny-tabulka` a rozbil by existujúce
`getByTestId('ceny-tabulka').locator('tr', { hasText: <kód> })` E2E lokátory (strict-mode
violation → červené CI, #369 review 🔴). testids: `lakovanie-tabulka`, `lak-rozvin-<kod>`,
`lak-spotreba-<kod>`, `lakovanie-sucet-spotreba`, `lakovanie-naklad-eur`. Neznáme = „neznáme"
(rodovo neutrálne, ako `skladBunka`). E2E honest-null cesty je v `ceny.spec.ts`; compute so
seednutým rozvinom server-side v `ceny.test.ts`/`lakovanie.test.ts` (nezavádzaj nový BASE_URL
`test.skip` — blokuje integračný push, `e2e-console.md`).

## Rozšírenie = DÁTA od Dominika, nie vetva v kóde

Ako CLIP (`clip.md`): koeficient/výnimky/RAL sadzby sú Dominikove potvrdené hodnoty. Rozšírenie
(RAL €-náklad, ďalšie výnimky, ks→dĺžka konverzia z Money `ks` koeficientu) = nové potvrdené dáta
+ testy, nikdy hádané čísla.
