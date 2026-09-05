---
paths:
  - 'src/lib/server/ceny.ts'
  - 'src/lib/server/sklo-cena.ts'
  - 'src/lib/sklo-strecha.ts'
  - 'tests/sklo-strecha.test.ts'
  - 'src/lib/components/CenyTabulka.svelte'
  - 'src/lib/components/SkloCena.svelte'
  - 'scripts/ceny-snapshot.py'
  - 'tests/ceny*.test.ts'
  - 'tests/sklo-cena*.test.ts'
  - 'tests/pergola-ceny*.test.ts'
  - 'e2e/*ceny*.spec.ts'
  - 'e2e/sklo-cena*.spec.ts'
---

# Ceny materiálu + cena skla — denný Money snapshot (#154, #225)

## Dátový tok (READ-ONLY, appka do Money NIKDY nepíše)

Producent `scripts/ceny-snapshot.py` beží **mimo repa na dev2**
(`/home/newlevel/montalu-ceny/run-snapshot.sh`, cron 05:30) → číta Money read-only cez
tunel → JSON `{generatedAt, rows:[{kod, nakupCennik, nakupPoslednaFaktura, predajVo,
mena, sklad, rozvin}]}` → rsync na VPS `/opt/automatizacie-montalu/ceny/ceny.json`. Appka ho
**lazy** naimportuje (`ceny.ts` `maybeImportSnapshot`, gejtuje na mtime) do
`material_prices` (kľúč = Money `kod`). Chýbajúca/nulová cena = **`null`** („neznáma"),
NIKDY 0 — Money má reálne kódy kde `Cena=0` = „nikdy zadané".

**`rozvin` (#369, migrácia v38, `material_prices.rozvin REAL`):** m²/bm = merná jednotka
`m2` na Money artikli (`Artikly_ArtiklJednotka.Mnozstvi`, `Jednotka_ID=44EC8AD6-…`) = obvod
prierezu v metroch. Ťahaný LEFT JOIN-om (1:1 — žiadny profil nemá >1 aktívny `m2` riadok,
+ defenzívny dedupe podľa kódu vo `fetch_rows`). Kovanie/tesnenie (ZASK) `m2` NEMÁ (0/138),
takže je to spoľahlivý signál lakovaného profilu. Konzument = `computeLakovanie`
(`src/lib/lakovanie.ts`) → sekcia „Lakovanie" v `CenyTabulka` (spotreba farby
`rozvin × dĺžka × 0,150 kg/m²`; €-náklad honest-null, čaká na RAL sadzby). Producent na dev2
potrebuje `git pull` + jeden beh, kým sa rozvin objaví — dovtedy je pri profiloch `null`
(sekcia ukáže „neúplné").

## Money cenníky — kde je ktorá cena (overené read-only 2026-08-19)

- **Producent dnes ťahá 6 rodín:** `WHERE Kod LIKE 'ZASP%'/'ZASK%'/'TS%'/'PRP%'/'BPP%'/'BPK%'`
  (profily/kovanie zasklenia + sklá + pergolové profily + bazénové profily/komponenty —
  bazén pridal #359). Producent (`scripts/ceny-snapshot.py`) beží na dev2 **priamo z app
  checkoutu** (`run-snapshot.sh` → `PRODUCER=…/automatizacie-montalu/scripts/ceny-snapshot.py`),
  takže commit v repe + `git pull` na dev2 ho nasadí (žiadny osobitný deploy krok).
- **Profily/kovanie (ZASP*/ZASK*):** `nakupCennik` z cenníka **NC** (Nákupný cenník,
  GUID `BA7DA0F8-…`), `predajVo` z **PRF_VO** (appka `predajVo` nuluje pre VŠETKY non-ZASP
  kódy — veľkoobchodnému cenníku pri komponentoch šéf neverí).
- **Bazén (BPP*/BPK*, #359, live overené 2026-08-31):** **BPP** (profily) sú v NC ako
  PRP/ZASP → reálny `nakupCennik` (22/25 app kódov > 0). **BPK** (kusové komponenty) sú v NC
  tiež, ale nákupná cena je pri VŠETKÝCH 0 → honest-null (Money nemá nákupnú cenu bazénových
  komponentov). Jediná nenulová cena BPK žije v predajnom cenníku **PCMO „Predajný cenník
  polykarbonát MO"** (`F298CAD0-…`, TypCeniku=0) — PREDAJNÁ cena, do `nakupCennik` sa
  ZÁMERNE nemapuje; jej zobrazenie je follow-up #364. Obe bazénové rodiny majú sklad (57/57
  BPK, 25/25 BPP). Odkedy sú v snapshote, `validateOdpisKody` (#295) bazén odpisy validuje.
- **SKLÁ (`TS*` kódy):** cenené LEN v cenníku **IZOS** (`Ceniky_Cenik.Kod='IZOS'`, ID
  `f4a1dfee-9298-45d2-9891-1548741b2063`), **v NC vôbec nie sú** (0 riadkov). Názvy nesú
  kompozíciu, napr. `TS00016 = Izolačné sklo 4/16/4- číre`, `TS00021 = 4/8/4- číre`. Sklo
  sa účtuje na **m²**. Producent **od `9ffbccf` (19.8.) ťahá aj `Kod LIKE 'TS%'`** a pre
  TS* zdrojuje `nakupCennik` z IZOS (`CASE WHEN a.Kod LIKE 'TS%' THEN iz.Cena ELSE nc.Cena
  END`) — live overené: v NC **0** TS riadkov, v IZOS **141**; v dennom snapshote je **149
  TS riadkov** (136 s cenou > 0; zvyšok null/0 = „cena neznáma"). Bez zmeny schémy (appka
  číta existujúce pole `nakupCennik`). Pôvodne #235 bod 1.

## Cena skla v nárezáku (#225) — display-only

- **NIE je Money odpis.** Sklo nie je v `job.polozky` (do Money idú len profily+kovanie),
  takže `enrichPolozky`/`CenyTabulka` sklo NIKDY neukáže. Cena skla je samostatný blok
  `SkloCena.svelte` (noprint, len interní).
- **Plocha na náklad = `sklo.sirka × sklo.vyska × sklo.pocet / 1e6` (m²)** — reálne
  tabule, NIE otvorová plocha `ComputeResult.m2` (tá je `S×V`).
- **Mapovanie variant→Money kód:** `glass_types.money_kod` (nullable, migrácia v23),
  čítané cez `glassMoneyKod(system, nazov)` v `db.ts` — kľúč per RIADOK `(nazov, system)`
  s tým istým alias+own/ALL princípom ako `glassTypesForSystem`, **NIKDY name-only**
  (v22 collision trap: to isté „3.3.1"/„4.8.4" žije vo viacerých systémoch). Seedujú sa
  LEN jednoznačné zhody kompozície (`4/16/4 → TS00016/17`, `4/8/4 → TS00021/22`); zvyšok
  NULL. Rozšírenie ZASKLIEVACIEHO mapovania = ďalšia migrácia + potvrdenie Dominikom (#235).
- **Strešné sklo pergoly = SAMOSTATNÝ katalóg** (`src/lib/sklo-strecha.ts`,
  `SKLO_STRECHA_TYPY` + `skloStrechaMoneyKod(nazov)`, #235 cesta A) — NIE `glass_types` (to
  je katalóg zasklení posuvných dverí, iné sklá). 6 potvrdených mapovaní strešného skla → TS
  (dôkaz v Money názve: 4.4.2 číre=TS00070, mliečne=TS00071, 5.5.2 číre=TS00076, IZO
  4.4.2-8-6 číre=TS00014, mliečne=TS00129, 4.4.2ml/8/6ml=TS00012), 8 typov honest-null
  (Dominik doplní/založí — otázka #198). Konzument (výber typu + €/m² zo snapshotu) = #223;
  #235 ostáva otvorený, kým #223 cenu reálne nezobrazí.
- **Honest-null:** kód/cena chýba → „cena nedostupná", nič sa nedopočítava; súhrn sa
  prizná ako neúplný (vzor `CenySucet.kompletne`). Súhrn (tfoot) je jednomenový EUR (IZOS
  je EUR-only), riadky nesú svoju `mena`.

## Testy

Ceny v testoch sú VŽDY VYMYSLENÉ (repo je verejné). `material_prices` je UPSERT (nemaže
staré kódy) a `db.ts` je singleton → v teste s viac prípadmi resetuj
`DELETE FROM material_prices; DELETE FROM material_prices_meta;` v `beforeEach`, inak cena
z predošlého testu prežije. E2E fixture: `CENY_SNAPSHOT_PATH=./data/e2e-ceny.json`
(playwright.config), zapisovateľný len pri lokálnom preview (BASE_URL beh sa auto-skipne).

**E2E DB je ZDIEĽANÁ medzi spec súbormi (#232 pasca — stála CI za jeden beh).** Playwright
beží `workers:1` proti JEDNÉMU preview serveru s JEDNOU DB na celý beh. `fs.rmSync` fixture
SÚBORU NEvynuluje už naimportovanú snapshot-metu v DB (`maybeImportSnapshot` na chýbajúci
súbor len vráti `no-file`, DB nechá tak). Takže „snapshot nebol naimportovaný" (prázdna
`material_prices_meta`) platí LEN na čistej DB — t.j. iba pre spec, ktorý beží v abecednom
poradí PRVÝ (napr. `ceny.spec.ts` a jeho úvodný test). Spec, ktorý beží NESKÔR (napr.
`pergola-ceny.spec.ts` po `ceny.spec.ts`, ktorý medzitým seedol), vidí v DB metu skoršieho
seedu → `ceny-snapshot-vek` ukáže reálny dátum, nie „nebol naimportovaný". **Pravidlo:** v
neskoršom spece netvrď virgin-DB hlášku; testuj honest-null, ktorý platí VŽDY — kód, ktorý
NIE JE v žiadnom seede (pergolové `PRP*` nie sú v žiadnom ceny/sklo seede), ukáže „cena
neznáma". Reprodukuj poradie lokálne: `npx playwright test e2e/ceny.spec.ts e2e/<tvoj>.spec.ts`.

## dev2 Money read-only kanál — snapshot AJ ad-hoc dotazy (NIKDY credentials v repe)

Producent snapshotu beží na **dev2** v checkoute `~/montalu-ceny/` (cron `run-snapshot.sh`,
05:30) → SSH tunel na Money read-only → JSON → rsync na VPS. Ten istý mechanizmus je
**funkčný kanál aj pre jednorazové ad-hoc read-only SQL dotazy** do Money (nielen denný
snapshot) — použitý napr. na lookup názvov všetkých 149 TS kódov (#235, 21.8.). Mechanizmus
(BEZ akýchkoľvek credentials — tie žijú LEN na dev2, NIKDY v repe):

- throwaway SSH tunel cez kľúč `money-ro-thirdparty` na Money SQL host (port `1433`), `pymssql`
- DB `S4_Agenda_MONT_ALUSro`, účet len na ČÍTANIE (`montalu_ro`)
- credentials sa parsujú za behu na dev2 z `MONEY-READONLY-PRISTUP.md` (mimo repa)
- tunel po dotaze zavrieť (žiadny visiaci proces — overené 21.8., 5 pokusov čisté)

Použiteľné pre ďalšie cenové/kódové lookupy bez potreby nového prístupu; v logu/výstupe
NIKDY heslo (grep overený).

## `enrichPolozky` náhľad ceny je AJ na odpisovej Kontrola obrazovke, nielen na /odpisy/zakazka (#454)

`enrichPolozky` + `CenyTabulka` (materiálová cena z denného snapshotu) sa zobrazuje na
**predodpisovom náhľade/Kontrole** viacerých modulov, NIE len na `/odpisy/zakazka` (po
importe): `/pergola` (`+page.svelte:231`), `/zasklenia` náhľad, a od #454 aj `/bazen`
Kontrola. Ide o „pozrieť koľko to bude stáť a NEODPÍSAŤ to" — čisto čítanie snapshotu,
odoslanie do Money sa nemení.

- **Rozšírenie na ĎALŠÍ odpisový modul = ten istý vzor:** v `spocitat` (a `odoslat`-error
  re-renderi Kontroly) spočítaj `enrichPolozky(nenulové položky)`, vráť ako `ceny`, a na
  stránke `<CenyTabulka {ceny} />`. Ceníme LEN nenulové (`out.filter(o => o.qty > 0)`, vzor
  pergola `nonzero`). Na route s viacerými náhľadovými poľami (sklad + ceny) zabaľ ich do
  JEDNÉHO helpera (bazén `nahladCien(out)` → `{skladVarovania, ceny}`) a spreadni ho do oboch
  akcií — nekopíruj inline.
- **b2b gate:** ceny odhaľujú nákupnú cenu/maržu (interné). Ak je route b2b-forbidden
  (`B2B_FORBIDDEN_PREFIXES` v `b2b-access.ts`, fail-closed test `b2b-route-coverage`) —
  napr. `/bazen` — gate NETREBA (b2b sa na akciu nedostane; konzistentné s tamojším
  `skladVarovania`). Na route DOSTUPNEJ b2b (`/zasklenia`) MUSÍ byť `cenyPre`-štýl gate
  (`if (isB2B(user)) return undefined`) — druhá vrstva obrany, dáta sa vôbec nedopočítajú.
- **Bazén honest-null:** BPK* kusové komponenty majú v snapshote nákup=null → súčet
  `CenySucet.kompletne=false` (priznaný neúplný). To je zámer (Money nemá nákup BPK, PCMO
  predajná = follow-up #364), nie chyba testu.

## `SkladVarovania.svelte` — výrazný blok + akcia „Odobrať z odpisu" (#451)

`SkladVarovania` komponent (pôvodne #448 advisory) je od #451 **výrazný červený blok**
s per-položka tlačidlom „Odobrať z odpisu" (owner directive: Money pri jednej položke
s nedostatočným skladom ticho zahodí CELÝ doklad — ZAK2026493, 57 položiek zahodených
kvôli 1 krytke BPK202535 so skladom 0).

- **`SkladVarovanie` interface** (`ceny.ts`): `{kod, nazov, sklad, mnozstvo}` — `nazov`
  pridaný #451 (ľudsky čitateľný názov položky v upozornení). `skladoveVarovania()` vstup
  rozšírený na `{kod, nazov, mnozstvo}` — VŠETCI volajúci (6 modulov) majú `nazov` na
  položkových objektoch, len pridaj do mapy.
- **`snapshotDatum` prop** (`SkladVarovania.svelte`): dátum snapshotu pre transparentnosť
  čerstvosti dát, čerpaný z `getSnapshotMeta().generatedAt`. Slovenský formát D.M.YYYY.
- **„Odobrať z odpisu" mechanizmus:** klient-side `odobrat(kod)` nájde
  `document.querySelector('input[name="qty_${kod}"]')` (konvencia `qty_{o.kod}` konzistentná
  naprieč VŠETKÝMI 6 modulmi), natívny setter + `input`/`change` event (Svelte 5 bindingy),
  vizuálny flash na inpute. Žiadna nová server akcia — používateľ klikne normálne „Odoslať"
  s qty=0 pre odobratú položku.
- **Slovak plurály:** 3 tvary — 1="položka má", 2-4="položky majú", 5+="položiek má". Vždy
  pri slovenských počítadlách v UI.
