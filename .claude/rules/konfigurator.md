---
paths:
  - 'src/routes/konfigurator/**'
  - 'src/lib/konfigurator.ts'
  - 'src/lib/konfigurator-sklo.ts'
  - 'src/lib/components/konfigurator/**'
  - 'src/lib/server/konfigurator-vstup.ts'
  - 'src/lib/server/public-throttle.ts'
  - 'tests/konfigurator*.test.ts'
  - 'e2e/konfigurator.spec.ts'
---

# Verejný zákaznícky konfigurátor pergoly (`/konfigurator`, #275, tracking #280)

Prvá VEREJNÁ (bez prihlásenia) route v appke. Fáza 1 = zákaznícka vrstva BEZ CIEN nad
existujúcim jadrom `pergola-navrh.ts`. Sesterské fázy (#276 3D vizuál, #277 PDF+kontakt,
#278 Odoo lead, #279 cenotvorba) STAVAJÚ na tejto route — nasledujúce hranice MUSIA ostať.

## 1. Verejná route = 3 miesta, nie len `PUBLIC_PATHS`

Pridať verejnú route znamená VŠETKY tri:
1. `src/hooks.server.ts` → pridať prefix do `PUBLIC_PATHS` (explicitná allowlist výnimka
   z auth brány; prefix match je `pathname===p || startsWith(p+'/')` → `/konfiguratorX`
   NEprejde, fail-closed).
2. `tests/b2b-route-coverage.test.ts` → pridať do `ALLOWED` množiny (verejná route je
   top-level, mimo Money-denylist prefixov, takže `b2bRedirectTarget`=null) + pozitívny
   assert. Drift guard inak PADNE.
3. Akcie routy sú PRESNE `['dopyt','objednavka','vypocet']` (žiadna Money-zápisová akcia) —
   `vypocet` = kalkulačka súhrnu, `dopyt` = verejný formulár → PDF ponuka (#277), `objednavka`
   (#319) = záväzná objednávka → uloženie (`je_objednavka=1`) + PDF + Odoo lead ako OPPORTUNITY
   (viď `.claude/rules/dopyt-ponuka.md`). Všetky Money-neutrálne (žiadny odpis, žiadny `/data`
   zápis, žiadna platobná brána). SvelteKit NEDOVOLÍ `default` + pomenované akcie naraz, preto sú
   všetky pomenované. Množina akcií je strážená v `b2b-route-coverage.test.ts` (fail-closed —
   pridanie akejkoľvek ďalšej akcie ROZBIJE test, kým sa doň nedoplní).

## 2. HARD hranica: žiadny Money kód / nárez / VO cena (ORIENTAČNÁ cena SMIE — #279 Fáza C)

**#279 Fáza C (owner ROZHODNUTÉ, `issuecomment-5396941067`, 2026-08-24) VEDOME dvihol zákaz
CIEN pre PRICES ONLY:** verejná odpoveď (route akcia `vypocet`, PDF ponuka) teraz SMIE niesť
ORIENTAČNÚ **maloobchodnú (MO)** predajnú cenu (zrkadlí montalu.sk). NAĎALEJ NIKDY na verejnú
plochu: Money kód (`moneyKod`/TS*), nárez, **VEĽKOOBCHOD (VO)** cena (`priceB2B`) ani raw cenová
matica (seed). Cenový modul je server-only (`konfigurator-cena.ts` v `$lib/server/`) — do klienta
sa nedostane; verejná route dostane LEN MO cez `verejnaCenaPreModel`/`verejneCenyModelov` (VO
strip). Leak-guard testy sú podľa toho REDEFINOVANÉ (blanket „žiadne €" → „cena áno, VO/Money/
nárez/matica nie"). **PASCA (Fáza C, stálo 2 fix-kolá): STARÁ „žiadne ceny" politika bola
rozsypaná v ŠIESTICH súboroch, nielen v očividnom leak-guarde** — pred dvíhaním takého guardu
`grep -rnE "PRICE_RE|bez cien|nezáväzná špecifikácia|nie cenová ponuka|not\.toMatch\(/€"` cez celé
`tests/` + `e2e/`. Redefinované: `konfigurator-money-safety.test.ts` (C, load bez ceny / akcia MO
áno + VO nie), `e2e/konfigurator.spec.ts` (3 leak bloky + PDF metadáta), `ponuka-pdf.test.ts`
(PRICE_RE → orientačná cena), `dopyt-pdf-regen.test.ts` (regen PDF cena), `ponuka.test.ts`
(DISCLAIMER text), `konfigurator-cena.test.ts` (route-import assert). Detaily cenovej vrstvy:
`.claude/rules/konfigurator-cena.md`.

**#318 VO (veľkoobchodná) hladina — presný leak-bar.** Prihlásený b2b vidí VO cenu (konfigurátor +
PDF ponuka + pečiatka), neprihlásený/interný ostáva MO. Hladinu rozhoduje SERVER
(`konfigurator-hladina.ts` `cenovaHladina(locals.user)`), NIKDY klient (verejný návštevník nesmie
forgeovať „som b2b"). Čo presne guardy vynucujú (a čo je vedome zúžené):
- **VO HODNOTA (cena/pomer/`priceB2B`) sa NIKDY nedostane do MO/verejnej odpovede ani bundle** —
  airtight: `VerejnaCena.hladina` je typovo `'VO'` (MO ju štrukturálne nemôže niesť), MO výstup je
  byte-identický (`naCenu` MO nespreaduje nič), `konfigurator-money-safety.test.ts` (C) overuje, že
  reálne VO čísla všetkých 3 modelov ANI názov diskriminátora (`hladina`) nie sú v MO odpovedi.
- **VO tier LABEL v klientovi príde zo SERVERA** (`VerejnaCena.hladinaLabel`, nastavený LEN pri VO) —
  verejný `+page.svelte` NEnesie žiadny VO literál („Veľkoobchodná cena"), nadpis je generický
  „Orientačná cena", odznak renderuje `cena.hladinaLabel`. Tak MO/neprihlásený nevidí VO ani v DOM
  ani v bundle.
- **Vedome zúžené (žiadny value-leak):** `formatCenaKratko` (`$lib/ponuka`) nesie 2-znakový `· VO`
  marker pre INTERNÝ admin zoznam `/dopyty-konfigurator` (auth-gated, b2b-denylist) — je v
  zdieľanom chunku, ale číslo/hodnotu nenesie a v praxi je z verejného bundlu tree-shaknutý (verejná
  route ho nevolá). PDF `ponuka-pdf.ts` je `$lib/server/*` (mimo klienta), takže jeho „Veľkoobchodná
  cena" nadpis/keyword je bezpečný. Bar = „žiadna VO HODNOTA nikam k MO; VO LABEL len serverom
  oprávnenému b2b".

Katalóg `src/lib/sklo-strecha.ts` nesie pole `moneyKod` — TO je únikový vektor. Pravidlá:
- **Klientsky bundle NIKDY neimportuje `sklo-strecha` (ani `sklo-cena`/`server/*`).** Názvy
  skla + RAL farby idú z `+page.server.ts` `load` (servera) ako `data` — `.svelte` ich číta
  z `data`, neimportuje katalóg. Server súbory (`+page.server.ts`, `$lib/server/*`) SMÚ
  importovať `sklo-strecha`, ale používajú LEN `.nazov`, nikdy `.moneyKod`.
- **Čistý compute `konfigurator.ts` je client-safe** — importuje LEN geometriu
  `pergola-navrh` (bez moneyKod). `.svelte` z neho importuje len TYP (`import type`).
- **Leak guard = rekurzívny import-graf** (`tests/konfigurator-money-safety.test.ts`,
  vzor `vizual-money-guard.test.ts`): prejde graf klientsky dosiahnuteľných súborov
  (mimo `*.server.ts`) a spadne pri dosiahnutí katalógu/ceny/Money/servera alebo
  referencii `moneyKod`. Pokrýva BUDÚCE súbory — NEROB pevný zoznam súborov (review #275:
  pevný zoznam nevidí novú `Foo.svelte` importujúcu `sklo-strecha`).

## 3. Živá kalkulačka = `use:enhance` + submit (nie live-on-keystroke)

Vzor `/optimalizator` (nova-stranka pasca #7): POST cez enhance, žiadny reload → vstupy
ostanú. Ranges z `data` cez `$derived`, default `<select>` cez `untrack(() => data...)` v
`$state` initializeri (inak `state_referenced_locally` warning). Jednotný návrat akcie
`{ vysledok, error }`. Parser v `$lib/server/konfigurator-vstup.ts` (nova-stranka #1).

## 4. Rate-limit verejného endpointu (`public-throttle.ts`)

Per-IP fixed-window (vzor `login-throttle.ts`, in-memory Map, žiadna 3rd-party lib).
Kľúč = `resolveClientIp` (za Cloudflare, #264). **IPv6 sa kľúčuje na /64 PREFIX, nie /128**
— rotujúce SLAAC privacy adresy v jednej /64 by inak dostali každá vlastné okno (bypass).
Throttluje sa len drahý POST; GET SSR render je lacný, zámerne bez limitu (ako `/login`).

## 5. Money-neutrálne → bezpečné aj proti LIVE prode

Žiadny zápis (`server/money`/`server/db`/`server/pergola`) → E2E aj unit testy sa smú
púšťať aj proti nasadenej appke (BASE_URL), žiadny `skipAkLive` (ako `/optimalizator`).

## 6. ŽIVÝ 3D náhľad na verejnej route (#276 integrácia → #325 split-screen)

**#325 (owner ROZHODNUTÉ, split-screen ako Tesla/Apple):** 3D náhľad je teraz v ĽAVOM
STICKY stĺpci `+page.svelte`, viditeľný HNEĎ pri načítaní (defaultná pergola, BEZ submitu),
a aktualizuje sa ŽIVO pri zmene voľby. PRAVÝ (scrollovací) panel = formulár + cena/súhrn/
dopyt/objednávka/AR. Split je čistý CSS Grid + `position:sticky` (desktop `@media
min-width:900px` 2 stĺpce; mobil-first default = 1 stĺpec, vizuál hore sticky-zmenšený).
Stránka je rozdelená do subkomponentov `src/lib/components/konfigurator/` (`KonfVizual`
= ľavý 3D stĺpec, `KonfCena`, `KonfSuhrn`) — `+page.svelte` ostáva state/compute HUB
(large-file-split #239). Kľúčové vzory:

- **Money guard prejde CELÝ vizuál graf.** Guard (A) rekurzívne prechádza import
  graf klientsky dosiahnuteľných súborov — import `VizualPergolaZakaznik` doň vtiahne
  `Vizual3D` + celý `$lib/vizual/**`, a nové `components/konfigurator/**` sú tiež
  auto-pokryté (neimportujú `sklo-strecha`/`cena`/`server`). Pred montážou vizuál vetvy
  grep-ni, že nenesie zakázaný reťazec — inak guard (A) SPADNE.
- **Lazy dynamic import v `onMount`** (`KonfVizual.svelte`: `import('…VizualPergolaZakaznik
  .svelte').then(m => VizualKomp = m.default)`) — three.js ostáva SAMOSTATNÝ chunk
  (chunk-size guard ≤220KB), len sa spustí pri MOUNTE namiesto pri submite (#325: náhľad
  je viditeľný hneď). Guard (A) `extrahujSpecifikatory` číta aj `import()`.
- **ŽIVÝ update = hybrid (#325):** FARBA (RAL) + typ SKLA prúdia LIVE ako props → okamžitý
  in-place update materiálu vo `Vizual3D` (`prekresliRAL`/`prekresliSklo`, žiadny rebuild
  geometrie). ROZMERY prúdia cez DEBOUNCED (~320 ms) snapshot (`rozmeryStabilne` `$state`
  aktualizovaný v `$effect` s `setTimeout`+cleanup, LEN pri platnom vstupe) → `{#key vizKluc}`
  remount, ktorý REFITNE celý scénický rig (kamera/tiene/dekal/stena — dimenzované raz pri
  mounte, #170/#174). Rozmery do 3D idú z debounced snapshotu (nie live) → žiadny prechodný
  „stena je užšia než pergola" glitch. Prečo NIE plný in-place refit rigu: to je nevyriešené
  #170/#174 obmedzenie + veľký blast-radius do zdieľaného `Vizual3D`.
- **`{#key vizKluc}`** kľúčuje LEN podpis (debounced) rozmerov → remount/refit iba pri zmene
  rozmeru; zmena skla/RAL pri rovnakých rozmeroch → in-place (žiadny remount). Remount je
  sankcionovaný teardown+mount (NIE zakázané `forceContextLoss` na tom istom canvase, viď
  `vizual3d.md`).
- **RAL kód pre 3D = form-state `farba`** (select `value={f.kod}` = priamo RAL kód „7016").
  Sklo → `typSkla3D(nazovSkla)` (client-safe odtieň, žiadny katalóg).
- **CENA/SÚHRN ostávajú SERVER-side na submite** (owner #325 to dovolil — §3 „live kalkulačka
  = enhance + submit" platí pre CENU, nie pre 3D). AR náhľad ostáva POST-SUBMIT (model-viewer
  bundle sa nenačíta pri loade); `arViz` = snapshot vstupov PRI submite.
- **`zobrazOvladanie={false}`** — form ostáva jediný zdroj pravdy (vlastné RAL/sklo čipy
  komponentu by duplikovali formulár); drag-to-orbit ostáva (OrbitControls nezávislý od čipov).
- **Mapovanie názov skla → vizuálny odtieň**: `typSkla3D(nazovSkla)` v `konfigurator.ts`
  (číre→cire, mliečne/matné/STADUR→matne, bronz→bronzove, default cire) — pure, testované,
  bez katalógového importu.

## 7. AR náhľad (#286) — nové sub-routy pod /konfigurator

`/konfigurator` má AR náhľad („pergola u teba na záhrade" cez telefón). Detaily GLB
exportu + model-viewer sú v `.claude/rules/vizual3d.md` (auto-loaduje sa na
`src/lib/vizual/**`); tu je len ROUTE/guard vzor pre túto verejnú plochu:

- **Nové sub-routy sú UŽ verejné cez prefix** — `PUBLIC_PATHS` má `/konfigurator`
  a match je `startsWith(p + '/')`, takže `/konfigurator/model.glb` aj
  `/konfigurator/ar` prejdú BEZ pridania do `PUBLIC_PATHS` (na rozdiel od §1, ktoré
  platí pre TOP-LEVEL verejnú route).
- **`GET /konfigurator/model.glb` (`+server.ts`)** = serverový GLB endpoint. Je
  „write-bearing" (má `+server.ts`) → MUSÍ byť v `ALLOWED` v
  `tests/b2b-route-coverage.test.ts` (inak drift guard padne) A v `SERVEROVE_ROUTY`
  v `tests/konfigurator-money-safety.test.ts` (B) (money-neutralita). Money-neutrálny:
  vstup rozmery + typ skla (KĽÚČ cire/dymove/…, nie katalóg) + RAL kód; výstup čistá
  geometria/materiály (žiadny kód/cena/nárez).
- **`/konfigurator/ar` (`+page.ts`, NIE `+page.server.ts`)** = samostatná AR viewer
  stránka. Univerzálny `+page.ts` load ju drží MIMO „write-bearing" množiny b2b guardu
  (číta len query params, žiadny server) → netreba `ALLOWED` zápis.
- **`+server.ts` je server-only ako `+page.server.ts`** — money-safety guard (A)
  `jeKlientskyReachable` ho vylučuje (bez toho by ho bral ako klientsky vstup a spadol
  na jeho legitímnom `$lib/server/*` importe).

## 8. Prémiový showroom redizajn (#327) — chrome, ovládanie, E2E pasce

**Vizuál (owner „uplne trapny dizajn"):** svetlý Tesla-style showroom. Split-screen
štruktúra z §6 ostáva; mení sa RÁMOVANIE + ovládacie prvky, NIE výpočty/3D scéna.

- **Chrome = 2 vrstvy.** Root `+layout.svelte` má `jeKonfig = $derived(pathname === '/konfigurator'
  || startsWith('/konfigurator/'))` a TROJVETVU `{#if /login}{:else if jeKonfig}{:else}`: pre
  `jeKonfig` renderuje LEN `{@render children()}` (žiadny admin nav — `{#if data.user && !jeKonfig}`,
  žiadny `.wrap`, žiadny root footer). Route `konfigurator/+layout.svelte` dodá vlastný minimal
  header (MONTALU + montalu.sk; prihlásený → „← interná aplikácia" cez `resolve('/zasklenia')`) +
  pätičku s JEDINÝM `data-testid="version"`. Root pre konf vetvu footer NErenderuje → práve jeden
  version testid (E2E strict-mode inak padne). `data-hydrated` `$effect` v roote ostáva (E2E naň čaká).
- **Dizajnové tokeny na JEDNOM mieste** — `.konf-app` v `konfigurator/+layout.svelte` (`--k-bg`,
  `--k-ink`, `--k-line`, Inter font), kaskádujú do všetkých konf komponentov cez dedené CSS
  custom properties. NIKDY do `app.css` (prenieslo by showroom tému do internej admin appky).
- **Font:** `@fontsource-variable/inter/index.css` (npm, žiadny CDN; `index.css` má latin-ext →
  slovenčina). Vzor existujúceho `@fontsource-variable/archivo` v `login/+page.svelte`.
- **Ovládanie = `KonfOvladace.svelte`** (7× `$bindable`), renderované VNÚTRI `<form id="konf-form"
  use:enhance>` v `+page.svelte` → jeho `name=` inputy sú v POST-e (DOM-based membership, vzor
  #239). Submit tlačidlo je MIMO formu, spojené cez `form="konf-form"` (prilepený CTA panel dole) —
  natívne submitne form, enhance ho zachytí. Výsledkové sekcie (DopytForm/ObjednavkaForm = vlastné
  `<form>`) sú MIMO konf-form (žiadny nested form). **VŠETKY non-submit `<button>` = `type="button"`**
  (default submit → stepper/chip/swatch by POSToval form). Model = sr-only radio (clip-pattern,
  fokusovateľný) v labeli; sklo/farba = `<button aria-pressed>` chip/swatch + skrytý `<input
  name= value>` (POSTuje kód/názov nezmenene). E2E: model/chip/swatch = `.click()`, nie `.check()`/
  `.selectOption()`.
- **RAL hex na swatche** ber cez `farbaKonstrukcie()` z `$lib/vykres/ral` (čistý leaf bez moneyKod,
  UŽ v klientskom grafe cez Vizual3D → guard (A) prejde konštrukčne). Zoznam farieb z `data.farby`
  (server = zdroj), ral.ts len na hex/`tmavyObrys`. **PASCA (stálo CI cyklus): guard (A) grepuje
  DOSLOVNÝ reťazec `moneyKod` aj v KOMENTÁROCH** — nepíš `moneyKod` v komentári nového klientskeho
  súboru, píš „Money kódu".
- **Sklon = slider + číselný „twin".** `<input type=range>` (bez name/testid) + `<input type=number
  name="sklonDeg" data-testid="sklonDeg" bind:value>` oba na `sklonDeg`. Playwright `.fill()`
  NEfunguje na `type=range` → testy mieria na number twin, žiadny helper netreba.
- **E2E timing pasca:** edge-to-edge 3D náhľad je ~2.5× ťažší na softvérovom CI WebGL (Vizual3D
  renderuje na veľkosť kontajnera, bez pixel-ratio capu). Form-testy MUSIA počkať na
  `[data-viz-ready="true"]` PRED interakciou (helper `konfReady`/`submitKonfig`), inak (a) enhance
  callback (cena/súhrn/chyba) mešká za synchrónnou stavbou 3D scény a (b) `{#key}` remount pretekáva
  s ešte-mountujúcou scénou → `forceContextLoss`. Benígny warning `CONTEXT_LOST_WEBGL: loseContext:
  context lost` (explicitný teardown, nie GPU pád — ten Chrome loguje bez „loseContext:") je
  filtrovaný v `e2e/helpers.ts` `collectConsole`.
- **Edge-to-edge 3D bez úniku:** KonfVizual mení rámovanie zdieľaného `Vizual3D` LEN cez scoped
  `:global(.konf-vizual …)` (výška 100%, `aspect-ratio:auto`, caption ako overlay v rohu). Nič sa
  neprenesie do zasklenia. Layout: čistý CSS grid (mobil 2 riadky 3D-hore/panel-scroll-dole, desktop
  2 stĺpce), CTA je flex dieťa na spodku panela (NIE sticky-overlay → neprekrýva klikateľný obsah;
  sticky-overlay 3D/CTA spôsoboval Playwright „scrolling into view" timeout).

## 9. Zákaznícke kategórie skla + fotky/hover + realistický sklon (#329 iterácia 2)

- **Zákaznícka vrstva skla `src/lib/konfigurator-sklo.ts` (client-safe).** Verejný konfigurátor
  ukazuje 6 zákazníckych KATEGÓRIÍ (`KONF_SKLO_KATEGORIE`: label + popis + ikona + KONKRÉTNY
  katalógový `nazov`), NIE 14 katalógových typov s hrúbkami. Chip POSTuje konkrétny `nazov`
  (v `data-value` + hidden inpute), takže cena/PDF/dopyt/Odoo pipeline dostáva nezmenený názov.
  **Zákazník NIKDY nevidí hrúbky:** chip label AJ on-page `KonfSuhrn` (`s-sklo`) ukazujú
  ZÁKAZNÍCKY label kategórie (`konfSkloKategoriaPreNazov`), hrúbka je len v neviditeľnom POST
  payloade. Modul nesie LEN katalógový nazov (žiadny Money kód) → klientsky bundle ho smie
  importovať (leak-guard zelený). Zhoda `katalogNazov` s reálnym `SKLO_STRECHA_TYPY` je overená
  unit testom `tests/konfigurator-sklo.test.ts` (ten SMIE importovať `sklo-strecha`, nie je klient).
  Interné stránky (/zasklenia*, /pergola*) ostávajú na PLNOM katalógu — táto vrstva je len pre /konfigurator.
- **Info karty `KonfInfoKarta.svelte` (fotka + text).** Reusable: desktop HOVER (`@media (hover:hover)`),
  mobil TAP na ⓘ (`otvorene` stav). Karta je `position:absolute` overlay — NEposúva layout a
  NEblokuje klik na výber pod ňou. ⓘ tlačidlo má `e.stopPropagation()+preventDefault()`, takže
  klik naň NEvyberie model/sklo. Obrázky = webp v `static/konfigurator/` (stiahnuté z montalu.sk
  cez `cwebp`, žiadny CDN/hotlink). Model fotky mapované v `KonfOvladace` (`MODEL_FOTA` keyed na kód).
- **Model → hrúbky profilov v 3D:** `model` prúdi LIVE do viz reťaze (viz3d → KonfVizual →
  VizualPergolaZakaznik → `geo/pergola.ts`). Detaily (lokálny `PergolaModel` typ, `MODEL_PROFIL_SKALA`,
  in-place prestavba) sú vo `vizual3d.md`.
- **Sklon:** `KONF_SKLON_MAX` je 10° (nie 30 — flat-ceiling realita), default 3° (`+page.svelte`
  `KONF_DEFAULT.sklon`). Výpočet výšok nezmenený. Testy, čo overujú „nad rozmedzie" chybu, MUSIA
  použiť sklon ≤10 s vysokou výškou vpredu+hĺbkou (napr. 4000+tan(10°)·6000≈5058 > VYSKA_MAX).

## 10. Rozmery v METROCH v stepperi (#333, owner „plus nech pridáva v metroch")

- **Zobrazenie = metre, interné = mm.** `RozmerStepper.svelte` (subkomponent, 3× inštancia v
  `KonfOvladace`): VIDITEĽNÝ `type=text inputmode=decimal` ukazuje metre („4,0 m", čiarka, 1
  desatinné) a NEMÁ `name`; SKRYTÝ `<input type=hidden name=sirka value={hodnotaMm}>` POSTuje
  INTERNÉ mm nezmenene. Cena/PDF/Odoo/AR pipeline dostáva mm ako doteraz — v pipeline sa NIČ nemení.
- **Čistý prevod modul `$lib/konfigurator-jednotky.ts`** (client-safe, žiadny Money/DOM):
  `mmNaMetreText` (mm→„4,0"), `parseMetreNaMm` (čiarka AJ bodka → mm, 100 mm mriežka = 1 desatinné,
  clamp; prázdny/nečíselný → `null`, aby sa hodnota počas mazania neprepísala), `krokMetre`
  (smerový snap na mriežku kroku). Krok: šírka/hĺbka 0,5 m (500 mm), výška 0,1 m (100 mm; rozsah 2–4 m).
- **Display-text sync focus-flagom (NIE parse-comparison).** `$effect` číta `hodnotaMm` PRVÉ, potom
  `if (upravuje) return` (dead-effect pasca `vizual3d.md`); počas fokusu neprepisuje užívateľa, blur
  normalizuje EXPLICITNE, stepper tlačidlá nastavia text priamo. Parse-comparison padá na
  ekvivalentných tvaroch („4.0"/„4,0") a klobrce rozpísané „4,".
- **Layout WRAP-PROOF:** `.rs-stepper` má `flex-wrap:nowrap` + tlačidlá `flex-shrink:0`, riadok
  `.rs-rozmer` má `flex-wrap:wrap` (label sa smie zalomiť NAD stepper), takže `−[hodnota]+` sa NIKDY
  nezalomí (owner bug: `+` nad číslom na úzkom viewporte). E2E overuje zhodný vertikálny stred −/input/+
  na 360 px.
- **E2E: fills sú v METROCH** (`getByTestId('sirka').fill('4')` / `'2.8'` — dot aj comma OK, parser
  znáša oboje). `toHaveValue` po blure je čiarková („4,0"); pri rozpísanej hodnote pred blurom je
  ako sa zadalo. Stepper krok testuj cez `getByLabel('Zväčšiť šírku')`/`'Zmenšiť šírku'`.
