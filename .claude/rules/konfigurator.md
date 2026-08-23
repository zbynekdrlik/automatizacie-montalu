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
3. Akcie routy musia ostať `['default']` (žiadna Money-zápisová akcia) — strážené v
   `b2b-route-coverage.test.ts`.

## 2. HARD hranica: žiadna CENA / Money kód / nárez na verejnú plochu

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
