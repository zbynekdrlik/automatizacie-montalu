---
paths:
  - 'src/routes/konfigurator/**'
  - 'src/lib/konfigurator.ts'
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
3. Akcie routy sú PRESNE `['dopyt','vypocet']` (žiadna Money-zápisová akcia) — `vypocet` =
   kalkulačka súhrnu, `dopyt` = verejný formulár → PDF ponuka bez cien (#277, Money-neutrálny,
   viď `.claude/rules/dopyt-ponuka.md`). SvelteKit NEDOVOLÍ `default` + pomenované akcie naraz,
   preto je aj kalkulačka pomenovaná (`?/vypocet`). Množina akcií je strážená v
   `b2b-route-coverage.test.ts`.

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

## 6. 3D náhľad na verejnej route (#276 integrácia)

Zákaznícky 3D vizuál (`VizualPergolaZakaznik`, `$lib/components/vizual/**`) je
namontovaný do `+page.svelte` ako predajný „hero" súhrnu (vnútri `{#if suhrn}`,
nad tabuľkou). Kľúčové vzory pri montáži ĎALŠEJ vizuál/3D schopnosti sem:

- **Money guard prejde CELÝ vizuál graf.** Guard (A) rekurzívne prechádza import
  graf klientsky dosiahnuteľných súborov — import `VizualPergolaZakaznik` doň vtiahne
  `Vizual3D` + celý `$lib/vizual/**`. To je BEZPEČNÉ, lebo vizuál strom neobsahuje
  žiadny `moneyKod`/`sklo-strecha`/`/server/` (má vlastný `vizual-money-guard.test.ts`)
  a `Vizual3D` neimportuje `Vizual3DPoster`/`ZaskleniaNavrhVykres` (poster ide cez
  `posterZaznam` snippet). Pred montážou over grep-om, že nová vizuál vetva nenesie
  zakázaný reťazec — inak guard (A) SPADNE.
- **Lazy dynamic import** (`import('…VizualPergolaZakaznik.svelte').then(m => VizualKomp = m.default)`
  v `$state`, spustený v `use:enhance` success callbacku) — 3D/three.js bundle sa
  nenačíta pred zobrazením náhľadu. Guard (A) `extrahujSpecifikatory` číta aj `import()`.
- **`viz` SNAPSHOT pri submite**, nie live form-state → 3D je konzistentný so
  zobrazeným (server-autoritatívnym) súhrnom aj keď zákazník po submite prepíše input.
- **RAL kód pre 3D = form-state `farba` zachytený PRI submite** (`const odoslanaFarba = farba`
  v enhance) — `suhrn.farba` je len display label „RAL 7016 ANTRACIT", 3D `ralKod` chce kód „7016".
- **`{#key}` na rozmeroch** remountne 3D pri zmene rozmerov (nový canvas = sanktimovaný
  teardown+mount, NIE zakázané `forceContextLoss` na tom istom canvase, viď `vizual3d.md`),
  aby sa scénický rig (kamera/tiene/dekal, dimenzované raz pri mounte) prefitoval; zmena
  len skla/RAL pri rovnakých rozmeroch → in-place update komponentu.
- **`zobrazOvladanie={false}`** — form ostáva jediný zdroj pravdy (vlastné RAL/sklo čipy
  komponentu by duplikovali formulár a rozišli sa so súhrnom/PDF #277); drag-to-orbit
  ostáva (OrbitControls je nezávislý od čipov).
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
