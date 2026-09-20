---
paths:
  - "src/lib/server/migracie.ts"
  - "src/lib/server/db.ts"
  - "src/lib/styl.ts"
  - "src/lib/sklo.ts"
  - "src/routes/zasklenia/nastavenia/**"
  - "tests/migration-*.test.ts"
  - "tests/sklo-*.test.ts"
---

# Katalóg skiel (`glass_types`) — model, Money-neutralita, migračná pasca

## Sklá sú DÁTA, nie kód

Voľby skla sú riadky v `glass_types(nazov, redukcia_zero, poradie, system, hrubka, money_kod, sklo_korekcia, hrubka_trieda)`,
seedované sekvenčnými `PRAGMA user_version` migráciami v `src/lib/server/migracie.ts`.
**Pridať / zmeniť sklo = MIGRÁCIA, nikdy vetva v kóde.** Katalóg pre systém dáva
`glassTypesForSystem(system)` v `db.ts`.

## VÝPOČTOVÝ katalóg vs OBJEDNÁVKOVÝ zoznam typov z Odoo — deliaca čiara (#540/#546)

Tento `glass_types` katalóg (sklo → skloHrubka → profily → Money kód, compute cesta) je JEDNA vec.
Odoo `montalu.glass.type` je INÁ, ÚPLNE ODDELENÁ vec — LEN ordering zoznam pre objednávkový picker
(`/objednavka-skla`, `src/lib/server/odoo-glass-types.ts` `fetchGlassTypes`), NIKDY nenahrádza tento
výpočtový katalóg (Money-neutrálne). **Skutočné polia `montalu.glass.type` = `name, category,
cennik_code, composition, active`** (#546, relay #540) — NIE `code`/`composition_spec` (tie na
modeli neexistujú → Odoo 500 → lokálny fallback). Uložený `typ_skla` (= `glass_order.items[].glass_type`)
= `cennik_code || name` (ak `cennik_code` chýba, posiela sa presný `name`; Odoo `resolve_glass_type`
páruje kód → presný názov → zloženie). Detail objednávkovej vrstvy je v `objednavka-skla.md`.

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

## Editor vzorcov — dvojkrokový výber Systém → Štýl (#518)

`/zasklenia/nastavenia` používa DVA selecty (`#system` → `#styl`) ako nárezák, NIE jeden
plochý „Systém · štýl" (ten miešal „Štandard plus" a „Starý štandard" — Patrik upravil zlý;
Odoo úloha 922). Nadpis `data-testid="editor-nadpis"` („Upravuješ: <Systém> · <Štýl>")
jednoznačne ukáže, ktorý z dvoch Štandardov (zdieľajú katalóg cez `GLASS_SYSTEM_ALIAS`
vyššie) sa práve edituje.

- **Zoznam systémov = JEDINÝ zdroj `systemyZoStylov(styly)` v `db.ts`** (poradie = prvý
  výskyt v `listSysStyly()` = `ORDER BY sys_styl`), zdieľaný nárezákom
  (`zasklenia/+page.server.ts`) aj editorom (`nastavenia/+page.server.ts`). Labely pre
  človeka dáva `nazovSystemu` (`$lib/system-nazvy`). Poradie kľúčov je dnes
  `Deluxe, Robust, Slide, Štandard +, Štandard Drevo, Štandard` → labely
  `Deluxe, Robust, Slide, Štandard plus, Drevostavby, Starý štandard`.
- **Pridanie/odobratie systému** → zdvihni DRIFT GUARD `tests/nastavenia-editor-systemy.test.ts`
  (`OCAKAVANE_KLUCE` + `OCAKAVANE_LABELY`) — inak padne (to je jeho účel).
- **Štýl krok editora = SUROVÉ cfg `styl` kľúče systému** (`data.styly.filter(system===sys)`,
  vrátane IZO variantov ako `2x4K IZO`) — NIE „ponuka" nárezáka (`stylyForSystem`/`stylyDoPonuky`,
  ktorá IZO kolabuje a odvodzuje zo skla). Editor edituje SUROVÉ vzorce, preto musí ísť na
  každý reálny `sysStyl` kľúč.
- **Stav žije v URL `?sysStyl=`** → reload/„Upraviť ďalší štýl" ho zachovajú; navigácia je
  plný reload cez `window.location.href` (žiadny klientsky `$state` — editor sa aj tak
  načítava per `sysStyl` na serveri). Selection-only, Money-neutrálne.
- **Zvyšný drift (mimo #518):** `zasklenia/navrh/+page.server.ts` a `sietka/+page.svelte`
  ešte inline-ujú `[...new Set(styly.map(s=>s.system))]`. `navrh` (server) môže importovať
  `systemyZoStylov`; `sietka` je KLIENT (nemôže importovať server-only `db.ts`) — potreboval
  by klientsky helper. Neurobené (mimo scope #518).

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

## Odoo `montalu.glass.type` NIKDY nenahrádza výpočtový katalóg (#540)

`fetchGlassTypes()` (`odoo-glass-types.ts`) ťahá Odoo `montalu.glass.type` LEN ako ORDERING zoznam
typov skla pre picker v `/objednavka-skla` (Odoo `code` → `glass_order.items[].glass_type`). Tento
lokálny `glass_types` katalóg (sklo → `skloHrubka` → profily → Money kódy) je zdroj pravdy pre VÝPOČET
a MENÍ SA LEN MIGRÁCIOU — Odoo zoznam ho nikdy neprepisuje (Prístup 2 ZAMIETNUTÝ: Odoo
`composition_spec` nenesie hrúbkové triedy/profily/Money mapovanie appky). Detaily objednávkovej
strany: `objednavka-skla.md` sekcia „Odoo typy skla = OBJEDNÁVKOVÝ picker".

## PASCA: Odoo JSON-2 `false` pre prázdne char polia + dedupe pickerov pri zdroji (#551)

**Odoo JSON-2 `search_read` vracia pre NEVYPLNENÉ char pole boolean `false` — NIE `null` ani `''`.**
Preto `String(x ?? '').trim()` je pasca: `false ?? ''` je `false` → `String(false)` = `"false"` →
po `.trim()` truthy → hodnota `"false"` prenikne do `value`/`label`/`category`. Na `odoo-glass-types.ts`
to zhodilo PROD picker typov skla (0.25.32–0.25.33): každý typ bez `cennik_code` dostal
`value === "false"`, ≥ 2 také riadky = duplicitný `{#each … as t (t.value)}` kľúč → Svelte
client-side `each_key_duplicate` → hydratácia padla, `each` blok sa odstránil, ostal len placeholder
+ „iné sklo". SSR kľúče nevaliduje → bez JS to „fungovalo", takže CI/E2E to nechytili (preview beží
na `localFallback()` z SQLite = reálne reťazce; unit fixtures používali `cennik_code: ''`, hodnotu
ktorú Odoo NIKDY nepošle).

Dve pravidlá pre KAŽDÉ budúce Odoo `search_read` char-pole mapovanie:

1. **NIKDY `String(x ?? '')` na surovej Odoo char hodnote — vždy normalizuj cez helper**
   `s(v) = (v == null || v === false) ? '' : String(v).trim()` (`odoo-glass-types.ts`). Číselné
   polia majú svoj vlastný ekvivalent `numOrNull` (`odoo-prices.ts:99` — `v === false → null`); toto
   je jeho char verzia. `false` = prázdne pole.
2. **Každý `{#each … as t (t.value)}` picker MUSÍ byť dedupnutý PRI ZDROJI** (v mapovacom module,
   `Set` idiom ako `localFallback`), nie až v šablóne. Odoo dáta (duplicitné kódy, prázdne polia)
   nesmú nikdy zhodiť picker duplicitným kľúčom; duplicita → warn RAZ za fetch + vynechať riadok.

Kandidát na neskôr (ZAMIETNUTÝ pre hotfix, príliš široký dosah): typovaný `charField()` helper priamo
v transporte `searchReadJson2` — normalizoval by `false` globálne pre všetkých volajúcich, ale zmenil
by sémantiku boolean polí. Pre teraz normalizuj v KAŽDOM mapovacom module zvlášť.

## PASCA: NIKDY neblokuj page load na Odoo — krátky timeout + cachovaný fallback (#551 noha 2)

**`+page.server.ts` load, ktorý `await`-uje Odoo read, je latenčná bomba.** `searchReadJson2`/`callJson2`
mali `DEFAULT_TIMEOUT_MS = 15_000` a `fetchGlassTypes` napĺňal cache až PO návrate volania — takže
pomalé-ale-nepadajúce PROD Odoo zdržalo KAŽDÝ load `/pergola/narez` aj `/objednavka-skla/[zak]` až
15 s. PROD post-deploy E2E (2 loady/test) prestrelil 30 s Playwright limit a celý deploy run 0.25.33
spadol (main CI 35380772116), hoci appka „fungovala" (SSR fallback).

Pravidlá pre KAŽDÝ Odoo read v horúcej ceste page loadu:

1. **Krátky PER-VOLANIE timeout, nie 15 s default.** `callJson2`/`searchReadJson2` majú voliteľný
   `timeoutMs`; page-load fetch ho nastaví nízko (`fetchGlassTypes` default **3000 ms**). Uploady
   (`montalu_narezak_upload`, `get_prices`) si držia 15 s default — timeout ZUŽUJ len tam, kde blokuje
   používateľa. Timeout = AbortController, pri abort okamžitý lokálny fallback (nikdy nehádž do loadu).
2. **Fallback cachuj len KRÁTKO (60 s), úspech DLHO (5 min).** Inak buď (a) hanging Odoo fanuje 15 s
   čakanie na každý request (žiadny short-circuit), alebo (b) dlho-cachovaný fallback nezachytí, že sa
   Odoo vrátil. Krátky fallback TTL = rýchly auto-heal + žiadny fan-out.
3. **Single-flight.** Súbežní volajúci (N paralelných loadov) MUSIA zdieľať JEDEN in-flight fetch
   (`_inflight` promise), nie každý spustiť vlastné Odoo volanie — inak pomalé Odoo × N requestov =
   thundering herd. Cache-miss + prebiehajúci fetch → vráť ten istý promise.

Vzor je v `odoo-glass-types.ts` (`fetchGlassTypes` + `_doFetch` + `_inflight`); zopakuj ho pri každom
ďalšom Odoo reade viazanom na page load. NIKDY nenechaj `+page.server.ts` čakať na Odoo bez timeoutu
a fallbacku.

## Mapovanie LOKÁLNE sklo → Odoo `montalu.glass.type` — matcher + podklad badge (#556)

Producenti riadkov objednávky (`zasklenia`/`fix`/`pergola` `pridatSkla`) nesú `typ_skla` = LOKÁLNY
voľnotextový názov z výpočtového katalógu. Odoo `resolve_glass_type` páruje kód → presný názov →
zloženie, a FORMÁT zloženia sa líši (Odoo „4/8/4" lomítka vs appka „4-8-4" pomlčky). Preto
**`src/lib/server/glass-match.ts`** (ČISTÁ funkcia, žiadny IO):

- `normalizeComposition(raw)` kanonizuje zloženie na „A-B-C" (zvláda lomítka/pomlčky/bodky/medzery,
  písmená pri tabuli „5esg/14/5esg", IZO dvoj/trojsklo „4/16/4/16/4", VSG „3.3.1"/„44.2", jednosklo
  „6 mm"). `localGlassCategory(nazov)` = izol→izolacne, kalen/esg→esg, vsg/kód d.d.d→vsg, inak float.
- `matchOdooGlassType(lokalneSklo, odooTypy)` → `{ typ, istota, kandidati }`; zhoda = zloženie ∧
  kategória; **viac kandidátov (napr. AL/TH pri „4-16-4") → istota `'viac'`, `typ=null` (NIKDY tichý
  výber)**; žiadna → `'ziadne'`.
- `naviazanieRiadku(typSkla, odooTypy, source)` a `cennikPopis(typSkla, odooTypy, source)` — GATOVANÉ
  na `source==='odoo'`: pri lokálnom fallbacku (Odoo nedostupné) sa NIČ nenaväzuje (bez Odoo dát niet
  na čo) a nárezák nemá popis.

Kotva na `fetchGlassTypes`: **`GlassTypeOption` nesie aj surové `name` + `composition`** (nielen
`value`/`label`/`category`) — matcher aj nárezák popis čítajú z tej ISTEJ cache, žiadny druhý zdroj
pravdy. **`priradOdooTypy(polozky)`** (v `odoo-glass-types.ts`, fetch RAZ pre pole) volajú producenti
PRED vložením: jednoznačná zhoda uloží Odoo `value` (`cennik_code || name`) → objednávka ide do Odoo
presne; „viac"/„ziadne" ostáva lokálny názov.

Podklad `/objednavka-skla/[zak]`: riadok, ktorého `typSkla` nie je platná Odoo `value` (a nie je
manuál „iné sklo"), dostane badge **„nepriradené — vyber typ"** + kandidátov navrchu pickera
(`load` počíta `naviazanie: Record<id, {nepriradene, kandidati}>`). Nárezák `zasklenia` select ukáže
pri lokálnom skle **„· cenník: <Odoo name>"** (pri „viac" prvý kandidát + „(+N)") — `cennikPopisSkla`
mapa z `load` cez `ZasklieniaForm` prop. FIX nemá select typu skla (jedno `name="sklo"` hidden),
pergola honest-null formulár už používa priamo Odoo picker → popis v selecte dáva zmysel len v
zaskleniach. **Money-NEUTRÁLNE, bez migrácie** — výpočtový `glass_types`, hrúbky, profily, Money kódy
NEDOTKNUTÉ. Pri rozšírení na ďalší producent: `await priradOdooTypy(...)` pred insertom + vitest.
