---
paths:
  - 'src/routes/konfigurator/**'
  - 'src/lib/konfigurator.ts'
  - 'src/lib/konfigurator-sklo.ts'
  - 'src/lib/konfigurator-produkty.ts'
  - 'src/lib/components/konfigurator/**'
  - 'src/lib/server/konfigurator-vstup.ts'
  - 'src/lib/server/public-throttle.ts'
  - 'tests/konfigurator*.test.ts'
  - 'e2e/konfigurator*.spec.ts'
---

# Verejný zákaznícky konfigurátor (`/konfigurator`, #275, tracking #280; jednotný rám #384)

> **#384 (etapa 1/7): `/konfigurator` je odteraz VÝBEROVÁ obrazovka produktov; pergolový
> konfigurátor sa presunul na podstránku `/konfigurator/pergola`.** Sekcie §1–§10 nižšie
> popisujú PERGOLOVÝ konfigurátor — všetko z nich platí ďalej, len žije na `/konfigurator/pergola`
> (`+page.svelte` + `+page.server.ts` sa `git mv`-li tam, zdieľaný `konfigurator/+layout.svelte`
> ostal). Rám + `produkt` diskriminátor = §11. Sesterské produkty (#385–#390) = ďalšie podstránky.

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
`.claude/rules/konfigurator-cena.md`. (#384: pergolový E2E `e2e/konfigurator.spec.ts` sa
premenoval na `e2e/konfigurator-pergola.spec.ts`; výberová obrazovka má `e2e/konfigurator-vyber.spec.ts`.)

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
dopyt/objednávka. Split je čistý CSS Grid + `position:sticky` (desktop `@media
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
  = enhance + submit" platí pre CENU, nie pre 3D).
- **`zobrazOvladanie={false}`** — form ostáva jediný zdroj pravdy (vlastné RAL/sklo čipy
  komponentu by duplikovali formulár); drag-to-orbit ostáva (OrbitControls nezávislý od čipov).
- **Mapovanie názov skla → vizuálny odtieň**: `typSkla3D(nazovSkla)` v `konfigurator.ts`
  (číre→cire, mliečne/matné/STADUR→matne, bronz→bronzove, default cire) — pure, testované,
  bez katalógového importu.

## 7. AR náhľad — ODOBRATÉ (#337, owner „zapis si issue odobrat ten AR")

**AR bol z konfigurátora KOMPLETNE odstránený (#337).** Bol konfigurátor-only (interné
/zasklenia/navrh/zakaznicky ho nepoužívali). Zmazané: `PergolaAR.svelte`, sub-routy
`/konfigurator/ar` + `/konfigurator/model.glb` (GLB endpoint), `src/lib/vizual/glb.ts`,
`src/lib/server/filereader-polyfill.ts`, deps `@google/model-viewer`+`qrcode`, typ
model-viewer v `app.d.ts`, a CI model-viewer bundle-gate (`ci.yml`). Guardy
(`b2b-route-coverage`, `konfigurator-money-safety`) už `/konfigurator/model.glb`
neuvádzajú.

Ostáva ŽIVÝ 3D náhľad (#276/#325, §6 vyššie) — projektový three@0.185 / KonfVizual /
Vizual3D. **`+server.ts` je server-only** — money-safety guard (A) `jeKlientskyReachable`
ho stále vylučuje (platí pre iné endpointy: dopyty-konfigurator/pdf, logout, health).
Ak by sa AR niekedy vracalo, obnov ROUTE/guard vzor z histórie tohto tiketu.

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
- **ŽIVÝ-UPDATE assert NIKDY nepolluj cez DOM VNÚTRI `{#key vizKluc}` bloku s fixným sub-budgetom
  (#361 recidíva flaky).** Caption `pergola-caption-rozmer` (vo `VizualPergolaZakaznik`) žije VNÚTRI
  keyed remountu; pri debounced (~320 ms) zmene rozmerov sa jeho nový text commitne až v rámci
  rebuild-flushu (`forceContextLoss` + HDRI/scene rebuild), a Playwrightov `expect.poll(innerText,
  {timeout:6000})` súperí o JEDINÉ hlavné vlákno s tým CPU-viazaným softvérovým GL rebuildom → pod
  záťažou MAIN behov (nie PR/rerun) občas vyhladovel nad 6 s (blokoval deploy). **Vzor fixu:** vystav
  od-GL-frame-ODPOJENÝ stavový signál na STABILNOM uzle MIMO `{#key}` bloku — `KonfVizual`
  `<section data-testid="konf-viz" data-viz-rozmer={`${viz.sirkaMm}×${viz.hlbkaMm}`}>` (patchne sa
  in-place, žiaden teardown/detach-window) — a test čaká na PRESNÚ hodnotu
  (`toHaveAttribute('data-viz-rozmer','5000×3800',{timeout:30000})` + caption `toHaveText('Pergola
  5000 × 3800 mm')`) s VEĽKORYSÝM budgetom v rámci `test.setTimeout(60000)`, NIE arbitrárny fixný
  poll. `×` = U+00D7 v atribúte AJ v asserte (byte-identické). NIE plný in-place refit kamery
  (nevyriešené #170/#174, veľký blast-radius — viac vyššie v §6). Determinizmus (presná hodnota) +
  od-GL odpojený signál je zdôvodnený záver vyšetrenia, nie slepý timeout band-aid.
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
  INTERNÉ mm nezmenene. Cena/PDF/Odoo pipeline dostáva mm ako doteraz — v pipeline sa NIČ nemení.
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

## 11. Jednotný rám — výberová obrazovka + produkt diskriminátor (#384, etapa 1/7)

`/konfigurator` je VÝBEROVÁ obrazovka (grid produktových kariet); každý produkt = vlastná
podstránka `/konfigurator/<slug>`. Rám (PR 1/7) je pergola-only live; #385–#390 pridávajú produkty.

- **Katalóg = client-safe `src/lib/konfigurator-produkty.ts`** (`KONF_PRODUKTY`: `kod/nazov/pdfNadpis/
  popis/foto/alt/stav('live'|'pripravujeme')/odkaz/externy`). Nesie LEN prezentačné texty + montalu.sk
  URL + webp názvy (žiadny Money kód/cena) → leak-guard (A) ho prejde. Fotky = lokálne webp v
  `static/konfigurator/vyber/` (cwebp z montalu.sk, žiadny hotlink). `pripravujeme` karta = badge +
  externý odkaz na montalu.sk (žiadny mŕtvy klik, žiadny fake konfigurátor).
- **Výber = `KonfVyber.svelte`.** Live karta → interná `resolve(p.odkaz as LiveRoute)` navigácia (#99);
  `LiveRoute` je únia interných route literálov — každý PR čo prepne kartu na `live` sem pridá svoj
  `/konfigurator/<slug>` (guard: `konfigurator-produkty.test.ts` overuje, že každý live `odkaz` má reálny
  `src/routes/konfigurator/<slug>/+page.svelte` — typo inak 404-uje). Externý (montalu.sk) href je
  dynamický → scoped `eslint-disable svelte/no-navigation-without-resolve` LEN na tej vetve. Prvá karta
  (LCP) = `loading="eager"` + `fetchpriority="high"`, ostatné lazy. Späť z podstránky: `konf-spat-vyber`
  odkaz v `konfigurator/+layout.svelte` (viditeľný len keď `page.url.pathname !== '/konfigurator'`).
- **`produkt` je SERVER-AUTORITATÍVNY, NIE klientske pole.** Route pozná svoj produkt a viaže ho pri
  mountnutí akcie: `dopyt: (e) => dopytAction(e, 'pergola')` / `objednavka: (e) => objednavkaAction(e,
  'pergola')` (`dopytAction(event, produkt: KonfProduktKod = 'pergola')`). Klient produkt NEPOSIELA
  (žiadne skryté pole — inak sfalšovateľný → mislabelovaný lead). Produktový PR mountuje svoju akciu s
  vlastným kódom.
- **`produkt` stĺpec na `dopyt`** (migrácia **v35** `migrateDopytProdukt`, extrahovaná do
  `migracie-seed.ts`, feature-detect `dopyt`; `migracie.ts` je na strope). `insertDopyt`/`insertObjednavka`
  ho píšu; `getDopyt`/`getDopytForLead`/`leadSelectCols` ho čítajú; `listDopyty` feature-detect
  (`hasProduktColumn`) → interný `/dopyty-konfigurator` zobrazí produkt. Staré riadky = `produkt IS NULL`.
- **Produkt-aware PDF titul + názov Odoo leadu.** `produktNazov(kod)` (nominatív, lead prefix + admin),
  `produktPdfNadpis(kod)` (PDF nadpis) — oba fallback na 'Pergola'/'Špecifikácia pergoly' pri NULL/neznámom
  (byte-identické pre pergolu). `generatePonukaPdf(cfg, { produkt })` (titul + `setTitle`),
  `leadName`/`buildDescription` v `odoo-lead.ts`. Wiring (nie len pure helpery) je testovaný v
  `tests/dopyt-produkt-wiring.test.ts`.
- **b2b-route-coverage:** `/konfigurator/pergola` v `ALLOWED` + self-check poli (picker `/konfigurator`
  NEMÁ `+page.server.ts` → nie je write-bearing, ale ostáva verejný a nepresmerovaný); akcie routy
  presne `['dopyt','objednavka','vypocet']` (nezmenené wrapovaním). Money-safety guard (A) recurzuje do
  pergola podstránky + `KonfVyber`/katalógu (pozitívny reach assert); guard (B/C) preadresované na
  `konfigurator/pergola/+page.server.ts`.

## 12. Nový PRODUKTOVÝ konfigurátor (podstránka `/konfigurator/<slug>`, #385 bazén = vzor)

Sesterský produkt (#385–#390) = nová podstránka. Vzor: `konfigurator/bazen/`. Checklist (paralela §1):

- **Client-safe zákaznícky modul `src/lib/konfigurator-<produkt>.ts`** (vzor `konfigurator-bazen.ts` /
  `konfigurator-sklo.ts`): modely/varianty/rozmedzia + pure súhrn + `<produkt>PonukaConfig()`. **NIKDY
  neimportuje interný Money katalóg** (`bazen-komponenty` nesie BPK*, `sklo-strecha` moneyKod,
  `server/*`) — zákaznícka vrstva je ODDELENÁ od odpisovej. Importuje LEN `import type { PonukaConfig }`.
- **`/konfigurator/<slug>/+page.server.ts`**: `load` (client-safe katalóg + `RAL_PALETA`) + akcia
  `dopyt: (e) => dopytAction(e, '<slug>')` (produkt SERVER-autoritatívny). Množinu akcií zamkne
  `b2b-route-coverage` describe (bazén = presne `['dopyt']`; pergola má navyše `vypocet`/`objednavka`).
- **`KONF_PRODUKTY`**: kartu prepni `stav:'live'` + `odkaz:'/konfigurator/<slug>'` + `externy:false` +
  `cenovyZdroj` (viď honest-null nižšie). `KonfVyber.svelte` `LiveRoute` úniu rozšír o `/konfigurator/<slug>`.
- **Guardy** (fail-closed): `b2b-route-coverage` (ALLOWED + self-check + action-set describe + „nie je
  presmerovaný"), `konfigurator-produkty.test` (`live` set), `konfigurator-money-safety` (A pozitívny
  reach na nové client súbory + B server route + **C runtime `load()` assert**).
- **HONEST-NULL cena (kľúčové) — cenový gate je PRODUKTOVÝ, nie rozmerový.** Ak produkt NEMÁ overený
  cenový zdroj (rady bez vyťaženej matice; pergola #279 + bazén #404 UŽ zdroj MAJÚ — bazénová matica
  `update-pools` je vyťažená, viď `.claude/rules/konfigurator-bazen-cena.md`), NEVYMÝŠĽAJ ceny. Gate =
  `KonfProdukt.cenovyZdroj` + `maCenovyZdroj(kod)` (`konfigurator-produkty`), zapojený v `dopyt-cena-stamp`
  `opeciatkujCenuPreProdukt` (stamp = `{cena:null, cennikVerzia:null}`) A v `ponuka-pdf` (`opts.cena ??
  (maCenovyZdroj(produkt) ? cenaZCfg(cfg) : null)`). **Bez oboch by `opeciatkujCenu`/`cenaZCfg` spočítalo
  z rozmerov produktu nesprávnu PERGOLOVÚ cenu — na submite AJ na re-downloade** (`regeneratePonukaPdf`).
  `maCenovyZdroj(null)=true` = pergola default (staré dopyty pred v35); neznámy NEPRÁZDNY kód → `false`
  (odobraný produkt nesmie ticho získať cenu). **PDF PROSE tiež honest-null:** podnadpis/`DISCLAIMER`/
  keyword/placeholder/tagline v `ponuka-pdf` sú cena+produkt-aware (pergola cesta BYTE-IDENTICKÁ).
- **`PonukaConfig` mapovanie = NEUTRÁLNE polia** (zvolené tak, aby PDF nebolo zavádzajúce): model →
  `system`; **hlavný rozmer DĹŽKA → `dlzka`** (nové neutrálne pole → `zhrnutieRiadky` vykreslí „Rozmery
  (d × š)"), NIE pergolová `hlbka` (tá renderuje „š × h" a poradie by sa líšilo od stránky); výška/koľaj/
  segmenty/plocha → `popis`. Pergolové polia (`hlbka`/`vyskaVpredu`/`model`/`pocetPoli`) NEPOUŽÍVAJ.
- **PASCA `sklo` render-cesta (#390):** `PonukaConfig.sklo` sa v `zhrnutieRiadky` (PDF/lead riadok
  „Sklo / výplň") prepúšťa cez `konfSkloKategoriaPreNazov(cfg.sklo)` — teda ak názov výplne/krytiny
  PRESNE sedí s pergolovým katalógovým `katalogNazov` skla, riadok sa TICHO premenuje na zákaznícky
  label kategórie (nie na to, čo zákazník vybral). Dnes bazén (polykarbonáty) ani prístrešok (4
  krytiny) nekolidujú → renderujú RAW. Ale **#387 zasklenia = SKLO** → vysoké riziko kolízie: pri
  novom produkte over render-cestu testom `expect(zhrnutieRiadky(cfg)).toContainEqual({ label: 'Sklo
  / výplň', value: <názov> })` PRE KAŽDÝ názov výplne (nie len `cfg.sklo` dátové pole — tá regresia by
  ostala zelená). Pri reálnej kolízii daj výplni disjunktný názov alebo mapuj do iného poľa.
- **Money-safety (A) obsahový grep chytá LEN literál `moneyKod`** — nový Money kód (BPK*/BPP* ako holé
  stringy) potrebuje VLASTNÝ vzor: pridaj `/(^|\/)<katalog>$/` do `KLIENT_ZAKAZANE_SPEC` (import) +
  obsahový regex do (A) grafu aj (B). Inak by import Money katalógu prešiel. Vzory doteraz:
  `\bBP[KP]\d{5}\b` (bazén #385), `\bZAS[PK]\d{4,}\b` (zasklenie #387 — case-sensitive, aby
  NEmatchol slovenské „zasklievacie"/`ZASKLENIE_*` konštanty). **PASCA (stálo #387 fix-kolo): nový
  obsahový vzor si zachytí AJ VLASTNÝ klientsky modul, ak má v KOMENTÁRI/príklade literálny Money
  kód** (napr. `konfigurator-zasklenie.ts` mal v hlavičke „…ZASP00116, ZASK202538" → guard (A) ho
  označil za únik). Do komentárov nového client modulu píš rodinu bez čísla („kódy rodiny ZAS-P /
  ZAS-K", „BPK*") — NIKDY konkrétny `ZASP00116`/`BPK00108`. Guard beží aj nad novým modulom (je v
  klientskom grafe).
- **Rozmery = `RozmerStepper`** (metre, #333 owner directive; zdieľaj so pergolou — `bind:hodnotaMm`,
  funguje aj bez `<form>`). Podmienka: rozmer na 100 mm mriežke (1 desatinné metre) — krok 250 mm sa
  nezmestí do metrového displeja, drž 500/100 mm. Počty (segmenty/kusy) = `<select>` (constrained →
  súhrn/dopyt sa pri editovaní neodmontuje). Súhrn je čisto klientsky `$derived` keď produkt NEMÁ cenu
  (žiadny server round-trip netreba); pergolový `vypocet` submit je potrebný LEN kvôli server-cene.
- **Varianty over RAW DOM-om, NIE WebFetch súhrnom (#386 pasca).** „VARIANTY NEVYMÝŠĽAJ" =
  over KAŽDÝ model/zasklenie/terminológiu proti DOSLOVNÉMU obsahu montalu.sk. WebFetch (malý
  sumarizačný model) si na #386 VYMYSLEL zasklievacie termíny („izolačné dvojsklo/trojsklo"),
  ktoré `curl … | grep -oi` na živej stránke mal 0× — použi len termíny s reálnym hitom (na #386
  to boli „polykarbonát, bezpečnostné sklo, izolačné sklo, panel ISODOMUS"). Grep literálne reťazce,
  needôveruj prozaickému súhrnu.
- **Cenový zdroj over PRED honest-null zdôvodnením (#386 pasca).** Nepíš „montalu.sk nemá cenník"
  bez overenia — VÄČŠINA radov cenu MÁ: `montalu.sk/konfigurator` má produktové karty „od X € bez
  DPH" a per-produkt konfigurátor `montalu.sk/konfigurator/<produkt>` (napr. `…/zimne-zahrady`, HTTP
  200). Honest-null (`cenovyZdroj:false`) je aj tak správny pre PR (vyťaženie matice = #279-scale
  follow-up, vzor bazén #404, zimná záhrada #408) — ale ZDÔVODNENIE je „zdroj existuje, vyťaženie je
  samostatná práca", nie „zdroj neexistuje".
- **HONEST-NULL testy sú TAUTOLOGICKÉ, ak cfg nemá `hlbka`+`model` (#388 review 🟡 — pasca pre KAŽDÝ
  ďalší honest-null produkt).** `cenaZCfg`/`opeciatkujCenu` vráti `null`, keď cfg NEMÁ `hlbka`+`model`
  (bez rozmerov cenu neurčí), takže „PDF/pečiatka bez ceny" prejde AJ keby sa gate `maCenovyZdroj(<produkt>)`
  rozbil — test nič nestráži. Testuj FORGED CENOTVORNOU cfg (`{ model:'LIGHT', sirka:4000, hlbka:3500 }`)
  pod svojím produktom → dokáže, že PRODUKTOVÝ gate blokuje cenu, hoci rozmery+model by ju vedeli dať
  (submit AJ DB re-download cez `regeneratePonukaPdf`, ktorý threadne `produkt`); + KONTROLA že TÁ ISTÁ
  cfg pod `'pergola'` cenu DOSTANE (inak je gate potenciálny no-op). Toto je aj cesta, ktorú vie klient
  sfalšovať v POST `konfiguracia`.
- **Zavádzajúci label over na RENDER vrstve, nie ako absenciu poľa (#388 review 🔵).** „PonukaConfig
  nemá `vyskaVpredu`" je slabé — assertni `zhrnutieRiadky(cfg).map(r=>r.label)` na PRESNÚ množinu
  (napr. oplotenie = `[Systém, Šírka, Farba konštrukcie, Popis]`), aby budúca zmena logiky riadkov v
  `ponuka.ts` (reinterpretácia `sirka`/`dlzka`) zavádzajúci pergolový label zachytila.
- **montalu.sk cenový endpoint má NEOČAKÁVANÝ anglický slug** — pergola `update-pergolas`, bazén
  `update-pools`, oplotenie **`update-fencings`** (konfigurátor na `/konfigurator/oplotenia`, nie
  `-oplotenie`). Nájdeš ho v HTML konfigurátora daného radu (`data-update="…update-<slug>"`); 419 =
  existuje (CSRF), 404 = neexistuje. Vyťaženie matice je vždy #279-scale follow-up (honest-null v PR).
- **PER-MODEL limity = FUNKCIA modelu, NIE jedna konštanta (#389 tienenie, review 🟡).** Keď má produkt
  varianty s RÔZNYMI reálnymi rozmerovými maximami (markíza XLINE š7500/v6000, XLIGHT 6000/5000, roleta
  ZIPLINE 4000/v3000), NEROB jeden „generózny" `RANGES` const — vytvorí to nemožné konfigurácie
  (ZIPLINE výška 6000 pri reálnom max 3000) a PDF/lead by ich zapísal. Honest-null rieši CENU, nie SPEC.
  Vzor: limit na `<Produkt>ModelInfo` (`sirka`/`rozmer2` `{min,max}`), `<produkt>Ranges(model)` funkcia,
  `r = $derived(<produkt>Ranges(model))` v stránke, a `$effect` čo pri prepnutí typu CLAMPne rozmery do
  nových limitov (zápis rovnakej hodnoty = no-op, žiadna slučka). To isté pre voľby dostupné len pri
  niektorých modeloch (tienenie: „Ručné" LEN XLIGHT — filtruj katalóg per model + resetni pri prepnutí).
- **Reálnu ponuku OVER na webe, nič nevymýšľaj (#389).** Rozmerové maximá, dostupné varianty aj
  ovládanie ťahaj z montalu.sk produktovej stránky (per model), nie z pamäte. Farbu, ktorú web ponúka
  len „podľa vzorkovníka" (tienenie látka), NEROB ako fixný picker s vymyslenými kódmi — poznámka do
  súhrnu/PDF. ASCII `id` pre voľby s diakritikou v `kod` (E2E testid stabilita, review 🔵).
- **Honest-null test NESMIE byť vákuový (#389 review 🟡).** `cenaZCfg` vráti null bez `hlbka` v cfg
  BEZ OHĽADU na gate — takže test s `{system,sirka}` by prešiel aj keby gate NEBOL. Testuj gate FORGED
  pergola-tvarom (`hlbka`+`model` — `sanitizePonukaConfig` ho prijme) + pozitívnou kontrolou, že ten
  istý cfg s `'pergola'` cenu MÁ.
