---
paths:
  - "src/lib/server/migracie.ts"
  - "src/lib/server/db.ts"
  - "src/lib/styl.ts"
  - "src/lib/sklo.ts"
  - "tests/migration-*.test.ts"
  - "tests/sklo-*.test.ts"
---

# Katalóg skiel (`glass_types`) — model, Money-neutralita, migračná pasca

## Sklá sú DÁTA, nie kód

Voľby skla sú riadky v `glass_types(nazov, redukcia_zero, poradie, system, hrubka, money_kod, sklo_korekcia, hrubka_trieda)`,
seedované sekvenčnými `PRAGMA user_version` migráciami v `src/lib/server/migracie.ts`.
**Pridať / zmeniť sklo = MIGRÁCIA, nikdy vetva v kóde.** Katalóg pre systém dáva
`glassTypesForSystem(system)` v `db.ts`.

## Per-sklo korekcia rozmeru skla (`sklo_korekcia`, #440)

`sklo_korekcia INTEGER` (nullable, migrácia v36) je **ABSOLÚTNY per-sklo override** systémovej
korekcie `cfg_sys.sklo_offset`: `listGlassTypes`/`glassTypesForSystem` ho vracajú ako
`GlassType.skloKorekcia: number | null`, `NULL = použiť systémový skloOffset` (bit-identické
doterajšie správanie — kontraktové vektory `tests/compute.test.ts` ostávajú platné). Vzorec rozmeru
skla `Math.round(val(...) - (skloKorekcia ?? g.skloOffset))` je na 4 miestach (`compute-odpis.ts`
computeFlat/computeMulti, `compute-profily.ts` undersizeCut sklo-guard, `compute-sietka.ts`
sietkaSamostatnaVypocet); override sa prevlieka tým istým kanálom ako `redukciaZero` (param na
`computeFlat`/`safeCompute`/`undersizeCut`/`sietkaSamostatnaVypocet` PRIPOJENÝ NA KONIEC + pole
`PosuvSpec.skloKorekcia` pre computeMulti). Editor `/zasklenia/nastavenia` má per-sklo číselný input
`korekcia_<id>` (id-keyed `UPDATE glass_types SET sklo_korekcia=? WHERE id=?` — rovnaký #438 per-row
vzor; **prázdne pole = NULL zruší override, 0 je legitímna explicitná hodnota**). **Money-neutrálne:**
mení sa LEN vypočítaný rozmer skla (plán/objednávka), Money odpis/dedup nedotknutý. Rozšírenie na
ĎALŠIE per-sklo číselné pole = rovnaký kanál; NIKDY nehľadaj sklo len podľa názvu (kľúč row `id`).

## Korekcia + varianta nárezáku PODĽA TRIEDY skladby (`hrubka_trieda`/`cfg_sklo_trieda`, #443)

Nasledovník #440: pri desiatkach/stovkách skiel z Odoo je per-sklo korekcia neudržateľná — Patrik
(msg 1789477/1789479) chce ju nastaviť RAZ na (systém × trieda skladby 6mm/16mm), nie per sklo.

- **`glass_types.hrubka_trieda INTEGER`** (nullable, migrácia v37) = `6 | 16 | NULL` — TRIEDA
  SKLADBY posuvu (6 = jednoduché sklo, 16 = izolačné dvojsklo), **NIE fyzická hrúbka** — nekoliduje
  s existujúcim `hrubka` (Deluxe-only 6/10 mm, vyberá kladka/klzný profil cez `cfg_rez.sklo_hrubka`).
  `NULL` = trieda sa neuplatňuje (Deluxe, Robust, spoločné `'ALL'` sklá — správanie nezmenené).
  Backfill je z KURÁTOROVANÝCH dát, nikdy z názvu naslepo: Slide z `redukcia_zero` (1→16, 0→6,
  presné Patrikovo zoskupenie), Štandard + z existujúceho `jeIzoSklo(nazov)` regexu (jednorazové
  zrkadlo). `GlassType.hrubkaTrieda` je `6 | 16 | null` (nie plain `number`).
- **`cfg_sklo_trieda(system, trieda, korekcia)`** (nová tabuľka, PK `(system, trieda)`) — korekcia
  nastavená RAZ na (systém × trieda), čítaná/písaná cez `resolveGlassSystem` (ten istý alias ako
  `glassTypesForSystem` — starý „Štandard" a „Štandard +" čítajú/píšu TEN ISTÝ riadok).
- **Reťaz precedencie** (rieši sa NA HRANICI `zasklenia/+page.server.ts`, compute vrstva sa
  NEMENÍ): `efektivnaKorekcia(g, system)` = `g.skloKorekcia` (#440, per-sklo, ostáva ako výnimka)
  `?? triedaKorekcia(system, g.hrubkaTrieda)` (#443, per trieda) `?? null` (padne ďalej na
  systémovú `cfg_sys.sklo_offset`, fallback `?? g.skloOffset` ostáva VO compute vrstve,
  `compute-odpis.ts`/`compute-profily.ts`/`compute-sietka.ts`, nedotknuté).
- **`efektivnaRedukciaZero(g)`** — pre KLASIFIKOVANÉ Slide sklo (`g.system === 'Slide' &&
  g.hrubkaTrieda !== null`) sa `redukcia_zero` DERIVUJE z triedy (`trieda === 16`), inak sa číta
  uložený stĺpec. Gate na `system === 'Slide'` je POVINNÝ — derivovanie pre iný systém by zmenilo
  `PosuvSpec.redukciaZero` mimo Slide (kde je dnes inertné) a rozbilo `zasklenia-posuvspec-golden`
  snapshot. Editor: redukcia checkbox sa pre klasifikované sklo VÔBEC nerenderuje (filtrovaný na
  `hrubkaTrieda === null`) — server akcia preto MUSÍ iterovať TEN ISTÝ filtrovaný set, nikdy
  všetky sklá systému (HTML checkbox nevie odlíšiť „nerenderované" od „odškrtnuté" — inak by
  neodoslaný checkbox klasifikovaného skla ticho prepísal jeho `redukcia_zero` na `false`).
- **`jeIzoTrieda(trieda, nazov)`** (`styl.ts`) = trieda-first (`trieda === 16`), regex `jeIzoSklo`
  len fallback pre `trieda == null`. `sysStylPre`/`sklaDoPonuky`/`pridavnaKolajnicaDefault` majú
  VOLITEĽNÝ `trieda` parameter — SERVER (skutočný compute + B2B pred-check v `nahlad`/
  `nahladMulti`, cez `skloPre`'s `g.hrubkaTrieda`) ho vždy vypĺňa; KLIENT (`+page.svelte`) ho
  zámerne nevypĺňa (design #443: parita pre všetky dnešné sklá je dokázaná testom, klient je
  len UI-hint, nie Money-cesta) — `data.skla[].trieda` existuje pre budúce klientske využitie.
- **Promócia jednotných #440 per-sklo hodnôt pri migrácii v37** — pre každú (system, trieda), ak
  KAŽDÉ jej sklo malo ROVNAKÚ non-NULL `sklo_korekcia`, povýši sa na `cfg_sklo_trieda` a per-sklo
  hodnoty sa vynulujú (bit-parita — efektívne číslo sa nemení). Nejednotné skupiny NEDOTKNUTÉ.
  Dôsledok pre editor: per-sklo korekcia grid (#440) je teraz FILTROVANÝ na existujúce overridy
  (`skloKorekcia !== null`) — dá sa len zrušiť/upraviť, NIE založiť nový (Patrik: „zbytočné tie
  korekcie jednotlivo" — trieda je teraz primárny kanál, per-sklo ostáva len ako výnimka).

## Kľúč je (nazov, system), NIE globálne unikátny názov (od v22, #214)

- Do v22 bol `glass_types.nazov` **globálne UNIQUE** → dva systémy nemohli mať sklo
  rovnakého názvu. v22 to zmenil na `UNIQUE(nazov, system)`, takže to isté fyzické sklo
  môže legitímne existovať vo viacerých systémoch pod tým istým názvom (napr. „3.3.1" je
  Slide aj Štandard +).
- **NIKDY nehľadaj sklo len podľa názvu naprieč systémami** — vždy cez
  `glassTypesForSystem(system)`. Editor vzorcov (`nastavenia/+page.server.ts` render +
  action + `cfg-editor` redukcia toggle) je od **#438 PER SYSTÉM**: load ukazuje LEN sklá
  vybraného systému (`glassTypesForSystem(systemFromSysStyl(sysStyl))`, bez dedup-by-name),
  checkbox identita je **row `id`** (`name=glass_<id>`) a save zapisuje `WHERE id = ?`
  (jednoznačný riadok). Pôvodný `GROUP BY nazov, MAX(redukcia_zero)` + `WHERE nazov = ?`
  bol cross-systémový leak (prod `cfg_audit` id 16: úprava „3.3.1" v jednom systéme
  prehodila to isté meno aj v druhom) — **už ho nepoužívaj, kľúčuj vždy row `id`.**
- Štandard + a **starý Štandard zdieľajú JEDEN katalóg**: riadky sú uložené pod
  `system='Štandard +'`, starý „Štandard" k nim smeruje cez `GLASS_SYSTEM_ALIAS`
  (server `glassTypesForSystem`) a cez `sklaForSystem` (klient `zasklenia/+page.svelte`).
  Sklo pridané pod `Štandard +` sa teda objaví v OBOCH a nepretečie do Slide/Robust/Deluxe.

## Money-neutralita skla v Štandardoch — jediný kanál je `jeIzoSklo`

V systémoch **Štandard + / Štandard** sklo ovplyvní odpis LEN cez `jeIzoSklo` (izolačné →
IZO nárezák, inak basic — cez `sysStylPre` v `styl.ts`). `redukcia_zero` má vplyv IBA v
Slide (má sklozávislý „Redukcia 6mm" profil), `hrubka` IBA v Deluxe (vyberá kladka/klzný).
→ **Každé neizolačné sklo je v Štandarde Money-identické s „Float sklo 6 mm".** Dôkaz v
teste: rovnaký `sysStylPre` + `computeFlat(cfg, resolved, S, V, redukciaZero, hrubka)` ako
6 mm (vzor `tests/sklo-3-3-1-standard.test.ts` a `tests/sklo-default.test.ts`). Vlastnosti
skla čítaj z MIGROVANEJ DB (`glassTypesForSystem`), nie z hardkódu — inak je test tautológia.

## Migračná pasca: každý `migration-*.test.ts` beží po NAJNOVŠIU verziu

Každý `tests/migration-*.test.ts` postaví DB v starom stave a spraví
`await import('../src/lib/server/db')` → `migrate()` prebehne až po AKTUÁLNU `user_version`.
Preto KAŽDÝ z nich asertuje FINÁLNE `user_version` (nie svoje cieľové) a plný katalóg.
**Pridanie migrácie znamená: zdvihnúť `user_version` asercie vo VŠETKÝCH ~15 migračných
testoch + upraviť každú exaktnú `toEqual`/count aserciu katalógu skiel, ktorú zmena dotkne.**
Nehádaj — spusti `npx vitest run` a zlyhania ti presne povedia, čo dopnúť (mechanická úprava
na novú realitu, nie oslabovanie testov).

**Nie len `migration-*.test.ts`:** aj INÉ súbory, ktoré (aj tranzitívne) importujú `db.ts`
a asertujú `user_version`, sa zdvihnú na novú finálnu verziu — napr. `dopyt-store.test.ts`
a `sklo-3-3-1-standard.test.ts` (#278: v25→v26). Preto po pridaní migrácie `grep -rn
"user_version.*toBe(" tests/` a zdvihni VŠETKY, nie len `migration-*` (a nechytni pritom
nesúvisiaci `toBe(N)`, napr. `polozky.length` count v `pergola-rezervacia.test.ts`).

**Nová migrácia, čo sa dotýka INEJ tabuľky než tie minimálne fixtúry vytvárajú, hodí
`SqliteError: no such table` pri IMPORTE `db.ts` — nie failnutú aserciu (#296).** Novšie
migračné fixtúry sú minimálne: vytvárajú len tabuľky, ktoré ich cieľová migrácia +
seed čítajú (napr. `migration-v24/v25/v26.test.ts` majú users/cfg_sys/glass_types/dopyt,
ale NEMAJÚ `cfg_rez`). Reálna DB má `cfg_rez` od v1, no fixtúra ju vynechá — takže NOVÁ
migrácia, čo `UPDATE cfg_rez ...` (napr. v27, oprava Money kódu), padne v týchto fixtúrach
skôr, než sa vôbec dostane k aserciám. Symptóm je INÝ ako „zdvihni toBe(N)": crash pri
`await import(db)`, nie assertion fail. Fix: pridaj PRÁZDNU chýbajúcu tabuľku (plná v26
schéma) do CREATE bloku dotknutých fixtúr — `UPDATE` nad prázdnou tabuľkou je no-op a
aserzie fixtúry ostanú nezmenené. Migráciu NEguarduj `if (tabuľka existuje)` — reálna
prod DB tabuľku vždy má (vzor v12/v15 tiež neguarduje); neúplná je fixtúra, nie prod.

**Výnimka — ADD COLUMN feature-detect JE v poriadku (v31/v36 vzor):** vyššie „NEguarduj"
platí pre UPDATE/data migrácie (v27), kde guard skryje diery vo fixtúre. Additívna
`ALTER … ADD COLUMN` migrácia v `migracie-seed.ts` NAOPAK feature-detektuje EXISTENCIU
tabuľky (`SELECT 1 FROM sqlite_master WHERE name='…'`) — tak to predpisuje `migrations.md`
§1 a robia to všetky v30–v35 (`dopyt`), v31 `migrateManualMoveColumn` (`odpis_log`) aj v36
`migrateGlassKorekcia` (`glass_types`), aby minimálne fixtúry bez tej tabuľky ALTER
preskočili namiesto crashu. Reálna prod DB `glass_types` ju má od v1/v22, takže ALTER prebehne.

## UNIQUE(nazov, system) index mení poradie `WHERE nazov = ?` výsledkov (#235, v43)

Od v22 je na `glass_types` index `UNIQUE(nazov, system)`. Dopytovanie `WHERE nazov = ?`
BEZ system filtra vracia riadky v **indexovom** poradí (podľa `system` abecedne), NIE
podľa `rowid` — takže `db.prepare('SELECT ... WHERE nazov = ?').get(nazov)` vráti
riadok s abecedne PRVÝM systémom (napr. 'Robust' < 'Slide' < 'Štandard +'). V testoch,
ktoré robia globálny lookup podľa mena (napr. `glass(nazov)`), po pridaní toho istého
skla do viacerých systémov padne assertion na neočakávaný systém. **Fix: v teste vždy
scope cez `glassTypesForSystem(system).find(g => g.nazov === ...)`, nie globálny
`WHERE nazov = ?`** — rovnaká zásada ako v produkčnom kóde (glass-catalog rule §3).

## Nová glass_types migrácia s neskoršími stĺpcami — oprav FIXTÚRU, nie migráciu (#235, v43)

`hrubka_trieda` (v37), `sklo_korekcia` (v36), `money_kod` (v23) neexistujú v minimálnych
test fixtúrach z pred tých migrácií. INSERT do neexistujúceho stĺpca crashne pri importe
`db.ts`. **Fix: pridaj chýbajúci stĺpec do CREATE v dotknutej fixtúre** (rovnaký princíp
ako „pridaj PRÁZDNU chýbajúcu tabuľku" vyššie). Na reálnej DB stĺpec VŽDY existuje (v37
beží pred v43), takže migráciu NEguarduj — guard v migrácii skryje dieru vo fixtúre.
(v43 `migrateGlassCatalogExpansion` obsahuje historický feature-detect `hasTrieda` ako
obrannú vrstvu; nová migrácia by mala radšej opraviť fixtúru.)

## Recreate tabuľky v migrácii (zmena constraintu)

SQLite nevie ALTER-nuť UNIQUE → recreate: `CREATE glass_types_new (... UNIQUE(...))` →
`INSERT ... SELECT` (explicitný zoznam stĺpcov, zachová `id`) → `DROP` → `RENAME`. Bezpečné,
lebo na `glass_types` NIE je žiadny FK. Celé v `db.transaction(() => { DDL; pragma user_version })()`
(vzor v18/v19) — atomické, crash → rollback, blok sa prehrá. Fresh aj existujúca DB konvergujú
až v tej migrácii (nový seed do starého bloku by narazil na iný systém s tým istým názvom, kým
je constraint ešte globálny).

## Vlastná (nekatalógová) skladba `SKLO_INE` — syntetické sklo, a pasca s obídeným gate-om (#235 slice 2)

`sklo.ts` `SKLO_INE = 'Iné (vlastná skladba)'` je SENTINEL voľby v glass selecte (NIE riadok
`glass_types`). Keď je zvolený, obsluha zadá voľný text skladby (reuse `skloPresne`) + hrúbkovú
triedu `skloTrieda` (4/6/10/16/24). Server (`zasklenia/+page.server.ts` `skloPre`) z nej postaví
SYNTETICKÝ `GlassType`, aby sa vlastné sklo počítalo BIT-IDENTICKY ako katalógové sklo tej istej
triedy. Odvodenie (`sklo.ts` `ineHrubkaTrieda`/`ineHrubka`): `hrubkaTrieda = trieda>=16?16:6`,
`hrubka = Deluxe?(10→10 else 6):0`, `skloKorekcia=null`, `redukciaZero=false` (Slide derivuje
z triedy cez `efektivnaRedukciaZero`). Cena honest-null (variant=sentinel → `glassMoneyKod`=null).
Tesnenie: `klasifikujSkloPreTesnenie(nazov, skloTrieda?)` — vlastné sklo klasifikuje z TRIEDY
(4→ZASK00005, 6→ZASK00006, 10→nezname, 16/24→izolačné/bez gumy), katalóg ostáva name-based.

## Zmena PONUKY skiel = oprav asserty ponuky v TEJ ISTEJ lane (#504×#235, 11.9.2026)

Lane nevie Playwright (Tier 0) → zastarané asserty ponuky vybuchnú až v dev CI (11.9. 3×:
`standard-stary`, `standard-narezak`, unit IZO-gate). Pri zmene toho, čo `sklaDoPonuky`/
`sklaForSystem`/`triedyPre` ponúkajú (nový `… IZO` sysStyl, nové sklo, sentinel):
`grep -rn "Izola\|toEqual(\[\|skla.filter\|SKLO_INE" e2e/*.spec.ts tests/zasklenia-*.test.ts`
a prepíš na novú realitu (vlastný `test(e2e)` commit). Po #504 má každý basic štýl
Štandard/Štandard + svoj `… IZO` → IZO-gate negatívny prípad je so seedom nedosiahnuteľný.

**Dve pasce, ktoré stáli RED nález pri review — dodrž pri KAŽDOM budúcom rozšírení:**

1. **Syntetické sklo MUSÍ prejsť TÝM ISTÝM system×štýl gate-om ako katalóg (`sklaDoPonuky`),
   inak spočíta stav, aký žiadne katalógové sklo v tej kombinácii nevie.** `sklaDoPonuky`
   FILTRUJE izolačné sklá tam, kde pre daný štýl IZO nárezák neexistuje (Štandard + opona 2x*).
   Sentinel branch v `skloPre` preto MUSÍ odmietnuť (`return null`) izolačnú vlastnú skladbu na
   takom štýle: `skloVyberaIzo(system) && ineHrubkaTrieda(trieda)===16 && !existuje(\`sys|zakladnyStyl IZO\`)`.
   Bez toho `sysStylPre` ticho padne na BASIC nárezák a pritom sadne trieda-16 korekciu — Money
   stav, aký katalógová IZO tam nevie. Klient zrkadli cez `triedyPre(system, styl)`.
2. **`hrubkaTrieda` syntetického skla nastav non-null LEN pre systémy, ktoré klasifikujú
   skladbu (Slide + Štandardy).** Robust/Deluxe majú v katalógu `hrubka_trieda=NULL` — ak by
   syntetické sklo malo non-null, `efektivnaKorekcia` by sadla triedovú korekciu (`cfg_sklo_trieda`)
   tam, kde katalóg NIKDY. Deluxe hrúbku rieši `hrubka` (6/10), nie trieda.

**Zobrazenie vs compute = DVA oddelené kanály:** base `sklo` (sentinel) ide do `skloPre`/ceny;
displej (plán/tlač/objednávka) je `skloPresne||sklo`. V multi-posuve `PosuvSpec.sklo` (echo do
`PosuvInfo.skloNazov`) nes text, ale `skloPre` číta RAW `p.sklo`. Perzistencia: detail `sklo`=text,
`skloZaklad`=sentinel, `skloTrieda`; `znova` obnoví `skloPresne` LEN keď `d.sklo !== d.skloZaklad`
(inak by holé katalógové sklo dostalo svoj názov ako „presné zloženie"), a `platneSklo` akceptuje
sentinel.
