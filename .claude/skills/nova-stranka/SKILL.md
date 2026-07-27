# Nová stránka (route) — štyri pasce, ktoré appka stráži testom

Postup pri pridaní modulu (`/fix` bol posledný, 2026-07-27). Každý bod už raz padol.

## 1. `+page.server.ts` smie exportovať LEN load/actions/…

SvelteKit build spadne na `Invalid export 'parseXVstup' in src/routes/…/+page.server.ts`
(valid: `load, prerender, csr, ssr, trailingSlash, config, actions, entries` alebo `_`
prefix). Parser/validácia vstupu preto patrí do `$lib/server/<modul>-vstup.ts` — navyše
sa tak dá priamo unit-testovať bez SvelteKit runtime. Chyba sa NEUKÁŽE v `svelte-check`,
až v `npm run build`.

## 2. Nová route MUSÍ do `B2B_FORBIDDEN_PREFIXES`

`src/lib/server/b2b-access.ts` je denylist (nie allowlist — viď `access-control`).
Drift guard `tests/b2b-route-coverage.test.ts` enumeruje adresáre s `+page.server.ts`
a padne, kým novú route nepridáš. To je zámer: nová stránka je pre b2b zakázaná, kým
sa vedome nerozhodne inak. Nezabudni ani na odkaz v `src/routes/+layout.svelte`
(interné `links`).

## 3. `$effect`, ktorý zapisuje to, čo číta, sa ZACYKLÍ

```js
// ZLE: každý beh vyrobí nové pole → effect_update_depth_exceeded
$effect(() => { if (polia.length === 1) polia = [sirka]; });
// DOBRE: zapíš len keď sa hodnota naozaj líši
$effect(() => { if (polia.length === 1 && cislo(polia[0]) !== sirka) polia = [sirka]; });
```

Chytí to e2e kontrola „nula console errors" (`[pageerror] …/e/effect_update_depth_exceeded`)
— preto ju má KAŽDÝ test, nielen tie o vzhľade.

## 4. Formulárové polia sú `$state` + `bind:`, nikdy `value={}`

Jednosmerné `value={vstup.x}` sa pri re-renderi vymaže (pasca, ktorá už vynulovala
formuláre v pergole aj bazéne). Ku každému kroku „← Späť a upraviť" patrí echo akcia
na serveri + skrytý input na každé pole — a e2e test, že zadanie prežije.

## 5. Po REVERTE mutácie prebuilduj, inak testuješ mutáciu

`npx playwright test` bez `BASE_URL` servíruje existujúci `build/`. Po `mv …bak` späť
teda MUSÍ nasledovať `npm run build`, inak preview stále beží na zmutovanom bundli a
test „zázračne" padá/prechádza. (Živý zásah 2026-07-27 pri mutačnej kontrole zrkadlenia.)
