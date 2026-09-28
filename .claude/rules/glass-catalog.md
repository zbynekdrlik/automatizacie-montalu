---
paths:
  - "src/lib/server/migracie.ts"
  - "src/lib/server/db.ts"
  - "src/lib/styl.ts"
  - "src/lib/sklo.ts"
  - "src/lib/sklo-povolene.ts"
  - "src/lib/server/vstup.ts"
  - "src/lib/server/znova.ts"
  - "src/lib/server/glass-match.ts"
  - "src/lib/server/sklo-odoo.ts"
  - "src/lib/server/odoo-glass-types.ts"
  - "tests/glass-match.test.ts"
  - "src/routes/zasklenia/+page.svelte"
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

**Zmazanie/premenovanie skla migráciou rozbije REKOMPUTU starých odpisov (#570).** Uložený
`detail.vstupRaw` drží starý názov → `skloPre` null → nárezák na kiosk 0 riadkov (OPDL260208 po v44).
Ak má zmazané sklo Money-identickú náhradu, pridaj ju do `LEGACY_SKLO` v `zasklenia-sklo.ts`
(detail v `backfill-narezaky.md` „Legacy názvy skiel"). Formulár ani Money sa tým nemenia.

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

## Povolené sklá PER SYSTÉM = allow-list NAD katalógom, nie zmena katalógu (#573, 27.9.2026)

„Ktoré sklo smie systém ponúknuť" (meeting výroby 25.9.: Robust len 4/16/4 číre/mliečne,
Štandard plus bez Float 4 mm a 10 mm, Deluxe 6/10) žije v JEDNOM mieste:
`POVOLENE_SKLA` v `src/lib/sklo-povolene.ts` (client-safe — importuje ho klient aj server).
**Zmena zoznamu (napr. Patrik pošle presný) = úprava LEN tam** + `tests/sklo-povolene.test.ts`
+ E2E `e2e/sklo-povolene-573.spec.ts` (a grep e2e na zakázané sklá — pozri sekciu nižšie).

- **Kde sa aplikuje:** klient `sklaForSystem` (ponuka single aj multi posuv → `defaultSklo`
  a reset pri zmene systému vždy padnú na povolené sklo) + `triedyPre` (triedy vlastnej
  skladby `triedyIne`, inak by „Iné" allow-list obišlo); server `parseVstup`/`parseMultiVstup`
  (tá istá hláška ako neplatné sklo) a `znova.ts` (`platneSklo`: zakázané katalógové sklo sa
  pri „Použiť znova" zahodí + nahlási; vlastná skladba ostane, ale jej zakázaná trieda sa
  zahodí + nahlási). Klient katalóg systému berie cez `ponukaSkielSystemu` (zrkadlo
  `glassTypesForSystem` + allow-list, parita so serverom v teste) a triedu, ktorú štýl/systém
  už neponúka, zruší (sklo efekt + `fixPosuv`).
- **Kde sa ZÁMERNE NEaplikuje: `skloPre` / `recomputeVstup` / `recomputeMultiVstup`** — tie
  prepočítavajú aj ULOŽENÉ staré odpisy (backfill, kiosk). Allow-list tam = staré Robust 3.3.1
  odpisy by dali 0 riadkov nárezáku (presne pasca #570). Preto NIKDY nemaž „zakázané" sklo z
  katalógu migráciou — allow-list je filter NOVÉHO vstupu, katalóg + `money_kod` ostávajú.
- **Systém bez záznamu = celý katalóg** (starý Štandard „bez zmeny", Drevostavby, Slide).
  Pozor: starý Štandard zdieľa katalóg so Štandard + cez `GLASS_SYSTEM_ALIAS`, ale allow-list je
  kľúčovaný POŽADOVANÝM systémom (`'Štandard +'` vs `'Štandard'`) — ich ponuky sa teda líšia.
- Názvy v zozname musia byť riadky katalógu systému (`arrayContaining` test — preklep padne);
  prázdne sklo parseVstup allow-listom neodmieta (hlási ho výpočet).
- E2E „žiadna voľba nemá `viac typov`" je v CI (preview bez Odoo) vákuová — `cennikPopis` je tam
  vždy `''`; skutočne ju kryje unit `tests/glass-match.test.ts` (a post-deploy beh proti PROD).
- Fixtúry testov/E2E so sklom mimo zoznamu (placeholder `'X'`, Robust „Izolačné 4/16/4 číre" bez
  „sklo", Štandard + Float 4 mm, trieda 4) sa pri rozšírení zoznamu musia prepísať na povolené.

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
  kategória ∧ **odtieň** (#556 hotfix) ∧ **povlak** (#579); **viac kandidátov (napr. AL/TH pri „4-16-4") → istota
  `'viac'`, `typ=null` (NIKDY tichý výber)**; žiadna → `'ziadne'`.
- **Os ODTIEŇA (`glassTint`, #556 hotfix).** Bez odtieňa by sa „Izolačné sklo 4/8/4 mliečne"
  spárovalo na „Izolačné sklo 4/8/4- číre" → do objednávky u dodávateľa by šlo NESPRÁVNE SKLO (PROD
  incident, main run 35514443000). `glassTint(name)` → `cire` (default, aj „číre"/„clear"/bez
  tokenu) | `mliecne` („mlieč"/„satin"/„matn") | `bronz` | `seda` („šed"/„grey"/„gray") | `grafit`.
  Párovanie je ASYMETRICKÉ: lokálne sklo má JEDEN odtieň, Odoo typ môže niesť VIAC v názve
  („bronz/šedý"). Lokálne **číre** sa zhoduje LEN s Odoo typmi bez ne-číreho tokenu; lokálny
  **ne-číry** odtieň sa zhoduje s Odoo typom, ktorého názov ten odtieň spomína (aj keď ich je viac);
  Odoo typ s ne-čírymi tokenmi sa NIKDY nespáruje s lokálnym číre. Odtieň NIE je Money os — mení sa
  len text `glass_type` v objednávke. `stopsol` NIE je odtieň — má vlastnú os povlaku (nižšie).
- **Os POVLAKU (`glassPovlak`, #579 finding 1).** Povlak je NEZÁVISLÝ od odtieňa: „ESG Stopsol
  Classic Clear" je odtieňom ČÍRE („Clear"), ale so stopsol povlakom — bez tejto osi sa „Izolačné sklo
  4/8/4 stopsol" párovalo na „4/8/4- číre" (nárezák „· cenník: …číre", objednávka ČÍRE sklo) a číre
  „Float kalené 6 mm" dostalo navyše stopsol kandidáta („viac" namiesto E6). `glassPovlak(name)` →
  `stopsol` | `ziadny`; zhoda je SYMETRICKÁ (stopsol len na stopsol, bez povlaku nikdy na stopsol),
  bez kandidáta honest null. **Pasca pri novom povlaku / reflexnom skle v Odoo** (napr. low-E,
  „Planibel", „Sunergy"): pridaj ho do `glassPovlak` + vektor do `tests/glass-match.test.ts` — token,
  ktorý matcher nepozná, sa páruje ako BEZ povlaku = na číre sklo.
- `cennikPopis` pri „viac" → **`''` (bez popisu)** (#573, Palo 25.9. — predtým #556 „viac typov
  (N)"), NIKDY meno prvého kandidáta — pri odtieňoch by ukázalo zavádzajúci názov iného odtieňa;
  operátor rozhodne na podklade.
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
pri lokálnom skle **„· cenník: <Odoo name>"** LEN pri jednoznačnej zhode (pri „viac" bez popisu, #573) — `cennikPopisSkla`
mapa z `load` cez `ZasklieniaForm` prop. FIX nemá select typu skla (jedno `name="sklo"` hidden),
pergola honest-null formulár už používa priamo Odoo picker → popis v selecte dáva zmysel len v
zaskleniach. **Money-NEUTRÁLNE, bez migrácie** — výpočtový `glass_types`, hrúbky, profily, Money kódy
NEDOTKNUTÉ. Pri rozšírení na ďalší producent: `await priradOdooTypy(...)` pred insertom + vitest.

**E2E a Odoo-obohatený sufix (`bareSkloLabel`, #556 hotfix).** Nárezák `<option>` skla nesie
`value` = HOLÝ lokálny názov, ale TEXT = „<názov> · cenník: <Odoo name>" — a to LEN keď je Odoo
dostupné (PROD/post-deploy), nie v CI `test` jobe (bez Odoo). E2E, ktoré čítajú `option.textContent`
a porovnávajú MNOŽINU skiel (nie sufix), preto MUSIA strippnúť sufix cez `e2e/helpers.ts`
`bareSkloLabel(text)` = text pred „ · cenník:" (trim). Je to JEDINÉ miesto, kde sa sufix strippuje;
platí pre každý budúci Odoo enrichment popiskov v selecte (inak test zelený lokálne / CI, ale padne
v post-deploy proti PROD). Sufix samotný je ZÁMERNÉ #556 správanie — testy overujú množinu skiel.

## Odoo sklá v ponuke nárezáka podľa HRÚBKY systému (#579, 28.9.2026)

Owner: „ak Robust používa 24 mm, má mu ponúknuť všetky sklá s tou hrúbkou" (nové sklo v Odoo sa má
objaviť bez releasu). Hrúbka je SPOJKA medzi Odoo a výpočtom — výpočtový katalóg sa NEMENÍ.

- **Jeden zdroj hrúbok per systém = SQLite `cfg_sklo_hrubka(id, system, mm, druh)`** (#579 časť 2,
  Odoo úloha 1180: „Povolené hrúbky pri systéme si nastaví výroba"; migrácia v52, `UNIQUE(system,
  mm)`, CHECK druh/mm>0). Seed = `ODOO_HRUBKY_SEED` v `src/lib/sklo-povolene.ts` (Robust 24
  izolačné; Slide 16 izolačné + 6 jednoduché; Deluxe 6/10 LEN `esg`; Štandard + / starý Štandard /
  Drevostavby 6 jednoduché + 16 a 24 izolačné) — konštanta je LEN seed, živé hodnoty číta
  `src/lib/server/sklo-hrubky.ts` (`skloHrubkyPre`, cache invalidovaná pri zápise). Výroba ich mení
  v `/zasklenia/nastavenia` (karta „Povolené hrúbky skla z Odoo", akcie `pridatHrubku` /
  `odobratHrubku`, `use:enhance`), každý zápis + `cfg_audit` v JEDNEJ transakcii (sys_styl =
  systém). `druh` páruje Odoo `category` (`izolacne` / `esg` / jednoduché = všetko okrem
  izolačných). **Izolačné triedy LEN `category=izolacne`** — pri 16 mm sú aj jednosklá VSG 88.x.
- **Výpočtové sklo sa NIKDY nezadáva — odvodí ho `vypocetneSkloPre(mm, druh, lokalne)`** (čistá, v
  `sklo-povolene.ts`) z lokálnej povolenej ponuky systému: izolačné → „Izolačné sklo A/B/C číre" s
  A+B+C = mm; jednoduché → „Float sklo N mm", inak „Nmm číre"; len kalené → „Float kalené N mm",
  inak „ESG kalené N mm". Žiadny kandidát → `null` = kombinácia NEPLATÍ (editor ju odmietne s
  hláškou, ponuka ju vynechá). Pre seed dáva presne pôvodné `sklo` konštanty (test
  `tests/sklo-hrubky-579.test.ts` + nezmenený snapshot `sklo-odoo-579`). **Pasca:** nový lokálny
  názov skla mimo týchto vzorov (napr. „Izolačné sklo 4/12/4 číre" je OK, „4-16-4 číre" nie) sa
  pravidlom nenájde — pridaj vzor + vektor do testu, nie výnimku v editore. **Pasca 2:** odvodenie
  číta LOKÁLNU povolenú ponuku, takže zmena `POVOLENE_SKLA` / katalógu môže ZMENIŤ výpočtové sklo
  Odoo volieb (napr. „Float sklo 6 mm" pridané do Slide → Slide 6 mm jednoduché sa začne počítať
  ním namiesto „6mm číre" = iný Money odpis). Chytí to seed test + snapshot `sklo-odoo-579` — ich
  zmena je vedomé rozhodnutie, nikdy slepé `-u`. `ponukaSkielPre(system,
  lokalne, odoo, hrubky = skloHrubkyPre(system))` — v testoch sa dá `hrubky` podať explicitne.
- **Ponuka** (`src/lib/server/sklo-odoo.ts` `ponukaSkielPre`, load `ponukaSkiel`): skupina „Sklá
  appky" (lokálne povolené, predvolené ako doteraz) + skupiny „Odoo — <druh>" (reuse
  `zoskupTypySkla(…, [], false)`). Odoo nedostupné → lokálna ponuka bez skupín. Typ s
  `total_thickness_mm` 0 sa neponúkne (warn raz za fetch v `fetchGlassTypes`).
- **Lokálne sklá sa NESKRÝVAJÚ** (ROZHODNUTÉ na #579): 4/16/4 číre má AL aj TH → skrytie = tichý
  výber (zakázaný #556) a rozbilo by výber podľa názvu (post-deploy E2E, „Použiť znova").
- **Výpočtové sklo Odoo voľby** = lokálne sklo, ktoré naň matcher #556 mapuje, keď je JEDINÉ (napr.
  ESG Float čirý 6mm → „ESG kalené 6 mm"), inak výpočtové sklo triedy (`vypocetneSkloPre`). **Tri kroky (#579 finding
  1):** (1) jediná PRESNÁ zhoda vrátane povlaku (stopsol ↔ stopsol); (2) pri 0 presných typ s
  povlakom bez lokálneho náprotivku sa počíta ako jeho sklo BEZ povlaku (`matchOdooGlassType(…, {
  povlak: 'ignoruj' })`, lokálne stopsol vynechané) — „ESG Stopsol Classic Clear 6mm" = „ESG kalené
  6 mm", nie predvolené NEkalené „Float sklo 6 mm"; (3) inak predvolené sklo triedy. **Pasca:**
  prísny matcher (os povlaku) rovno na výber výpočtového skla zmenil výpočet stopsol ESG 6 mm (= iný
  Money odpis) — review to chytil. **Stála stráž Money-neutrality:** snapshot `vypocet` každej Odoo
  voľby v každom systéme na PROD výreze (`tests/sklo-odoo-579.test.ts` „Money-neutrálny snapshot",
  `tests/__snapshots__/sklo-odoo-579.test.ts.snap`; overený jednorazovým parity behom proti 0.25.49,
  122 volieb, 0 rozdielov). Zmena snapshotu = zmena výpočtu Odoo voľby → vedome, NIKDY slepé `-u`.
  `'ignoruj'` NIKDY pre objednávku / cenníkový popis / podklad.
- **Formulár nesie DVE polia:** `sklo` = lokálne výpočtové (všetka klientska aj serverová logika —
  default, IZO nárezák, RAL hrúbka, tesnenie, B2B, compute, Money — beží bez zmeny) + `skloOdoo`
  (Odoo `cennik_code || name`). Select hodnota je ODVODENÁ (`$lib/sklo-odoo` `volbaSkla` /
  `rozlozVolbu`, `<option value>` Odoo voľby má prefix `odoo:`), žiadny nový `$effect`. Server
  `parseVstupSOdoo`/`parseMultiVstupSOdoo` overí `skloOdoo` voči živému katalógu (typ v ponuke
  systému A počítaný zvoleným `sklo`, inak chyba) a doplní `skloOdooNazov`; pri nedostupnom Odoo ho
  prijme bez overenia (ovplyvňuje len text). Pole vo vstupe/detaile LEN keď je zvolené → golden
  `zasklenia-posuvspec-golden` + detail bez Odoo byte-identické (`skloOdoo: undefined` kľúč by
  snapshot rozbil — pridávaj podmienene).
- **Kam ide:** objednávka skla `typSkla = skloOdoo || skloPresne || sklo` (priradOdooTypy platnú
  Odoo hodnotu NEPREKLÁPA); plán/história `skloPresne || skloOdooNazov || sklo`; detail
  `skloOdoo`/`skloOdooNazov`; „Použiť znova" obnoví `skloOdoo` (Odoo názov NIE je `skloPresne`).
  Rekompute/backfill/kiosk (#570) čítajú `skloZaklad`/`vstupRaw.sklo` = lokálne sklo — nezmenené.
- **Duplicitný `cennik_code` v Odoo** (PROD: „001" = Izolačné 4/8/4 AJ IZOS DOUBLE 4-16-4 AL):
  kód je pre Odoo `resolve_glass_type` (páruje kód PRVÝ) nejednoznačný → VŠETCI nositelia dostanú
  `value = name` (páruje presný názov), žiadny typ sa nezahodí (warn o duplicite). Staré riadky
  podkladu s `typ_skla='001'` sú odteraz „nepriradené" — zámerne (kód nevie, ktoré sklo).
- **Odoo typ JE presné zloženie:** pri `skloOdoo` parse zahodí `skloPresne` a formulár pole skryje
  → plán aj objednávka nesú TEN ISTÝ typ (review #579). Pri nedostupnom Odoo sa `skloOdooNazov`
  NEvyplní (plán ukáže lokálne sklo, nie holý kód).
- **E2E:** CI nemá Odoo → fallback vetva; post-deploy PROD → Odoo vetva (`e2e/sklo-odoo-579.spec.ts`
  pokrýva obe, relačne). Specy nad MNOŽINOU lokálnej ponuky čítajú `LOKALNE_SKLA`
  (`e2e/helpers.ts`, `option:not([value^="odoo:"])`). Lokálne Odoo vetvu over cez `vite dev` +
  mock JSON-2 servera (`ODOO_JSON2_URL=http://127.0.0.1:<port>`, odpovedá len
  `/json/2/montalu.glass.type/search_read`); vo worktree so symlinknutým `node_modules` treba
  dočasný vite config so `server.fs.allow` na hlavný `node_modules` (inak 403 na fonty v konzole).
