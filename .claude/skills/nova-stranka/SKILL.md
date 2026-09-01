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
sa vedome nerozhodne inak. Nezabudni ani na odkaz v `src/routes/+layout.svelte` —
od #392 už nie je jeden plochý `links` zoznam, ale tri polia: `moduleLinks`
(primárna skupina „Moduly", oba roly — má tam ísť VÄČŠINA nových výpočtových
modulov), `toolLinks` (sekundárna „Nástroje", len interní) a samostatný
natvrdo-zapísaný odkaz „Používatelia" v user menu (len admin). Pridaj novú route do
toho poľa, ktoré sedí (a do OBOCH vetiev `moduleLinks`, ak má stránku vidieť aj b2b).

**Keď b2b MÁ stránku vidieť** (napr. `/sietka`, #89 — Patrik: „hlavne pre externých"),
route sa jednoducho NEPRIDÁ do `B2B_FORBIDDEN_PREFIXES` — ale drift guard test to
očakáva ako VEDOMÉ rozhodnutie, nie obídenie: pridaj cestu do `ALLOWED` množiny v
`tests/b2b-route-coverage.test.ts` s komentárom prečo, a pridaj pozitívny test
(`b2bRedirectTarget('/nova') === null`) — inak nabudúce niekto uvidí padajúci drift
guard a route bez rozmyslu zakáže.

**Ak stránka NESKÔR dostane vlastnú Money-zápis akciu** (presne toto sa stalo
`/sietka` — #86 korekcia 2026-08-02, `/review` nález PR #108): route-level povolenie
v `ALLOWED`/`B2B_FORBIDDEN_PREFIXES` sa NEMENÍ (b2b smie stránku naďalej OTVORIŤ),
ale nová akcia musí mať VLASTNÚ akcia-úrovňovú obranu — `isB2B(locals.user)` guard
ako PRVÝ riadok akcie (rovnaký vzor ako `/zasklenia` `odoslat`), plus forged-POST test
v `tests/b2b-money-reject.test.ts` (volaj `actions.odoslat` priamo s b2b `locals.user`,
nie len „tlačidlo je skryté"). A **aktualizuj komentáre**, ktoré tvrdia „stránka nemá
žiaden zápis do Money" — na dvoch miestach naraz (`tests/b2b-route-coverage.test.ts`
aj tu) — zastaraný komentár na Money-bezpečnostnej hranici je presne ten typ pasce,
čo zmýli budúceho čitateľa.

## 3. `$effect`, ktorý zapisuje to, čo číta, sa ZACYKLÍ

```js
// ZLE: každý beh vyrobí nové pole → effect_update_depth_exceeded
$effect(() => { if (polia.length === 1) polia = [sirka]; });
// DOBRE: zapíš len keď sa hodnota naozaj líši
$effect(() => { if (polia.length === 1 && cislo(polia[0]) !== sirka) polia = [sirka]; });
```

Chytí to e2e kontrola „nula console errors" (`[pageerror] …/e/effect_update_depth_exceeded`)
— preto ju má KAŽDÝ test, nielen tie o vzhľade.

**SILENTNÝ variant (#162, LIVE nález — console-error kontrola ho NEODHALÍ):**
zacyklenie nemusí byť do NEKONEČNA a nemusí hodiť `effect_update_depth_exceeded`
— stačí, keď effect PREČÍTA hodnotu, ktorú TEN ISTÝ effect zapísal o riadok
vyššie, aj keď na PRVÝ pohľad ide o "restore z formulára" kód, nie o zjavný
`if (x) x = ...` self-check:

```js
// ZLE: reštart-effect (obnoví formulár z `form?.vstup` po serverovom kole)
// číta systemS HNEĎ PO tom, čo ho TEN ISTÝ effect zapísal — effect sa tak
// sám prihlási na `systemS`, takže KAŽDÁ POUŽÍVATEĽOVA zmena <select
// bind:value={systemS}> effect znova spustí, a keďže `form` je pred
// odoslaním stále `null`, effect systemS TICHO PREPÍŠE SPÄŤ na default.
// Jeden extra beh, žiadna slučka do nekonečna, ŽIADNA konzolová chyba —
// select navonok vyzerá funkčný (DOM ukáže zvolenú hodnotu na okamih), ale
// odoslaný formulár vždy nesie PRVÚ hodnotu v zozname, nikdy zvolenú.
$effect(() => {
	const v = form?.vstup ?? null;
	systemS = v?.system || data.systemy[0] || '';
	stylS = v?.styl ?? stylyForSystem(systemS)[0] ?? ''; // ← číta systemS, ktoré effect PRÁVE zapísal
});

// DOBRE: reštart-effect NEČÍTA vlastný zápis vôbec — samostatný fixup effect
// (ktorý závislosť na `systemS`/`stylyPre` má ZÁMERNE) rieši "stylS nie je
// v aktuálnom zozname štýlov" bez tejto slučky.
$effect(() => {
	const v = form?.vstup ?? null;
	systemS = v?.system || data.systemy[0] || '';
	stylS = v?.styl ?? '';
});
let stylyPre = $derived(stylyForSystem(systemS));
$effect(() => {
	if (!stylyPre.includes(stylS)) stylS = stylyPre[0] ?? '';
});
```

Toto NEODHALILI lokálne e2e testy pred mergom — existujúce testy vždy vyberali
`Robust`, ktorý bol zhodou okolností PRVÝ systém v lokálnom/CI seede, takže
revert-na-default náhodou dal SPRÁVNU hodnotu. Na produkcii bol prvý systém
iný (`Deluxe`), čo bug hneď odhalilo pri prvom manuálnom výbere. **Nauč sa z
toho pri písaní e2e pre podobný "vyber zo zoznamu" formulár: aspoň JEDEN test
musí vyberať hodnotu ZISTENÚ ZA BEHU ako NIE prvú v zozname** (`options[0]`),
nikdy natvrdo prvú hodnotu podľa mena — inak môže presne táto trieda bugu
prejsť testom zhodou okolností.

## 4. Formulárové polia sú `$state` + `bind:`, nikdy `value={}`

Jednosmerné `value={vstup.x}` sa pri re-renderi vymaže (pasca, ktorá už vynulovala
formuláre v pergole aj bazéne). Ku každému kroku „← Späť a upraviť" patrí echo akcia
na serveri + skrytý input na každé pole — a e2e test, že zadanie prežije.

## 5. Po REVERTE mutácie prebuilduj, inak testuješ mutáciu

`npx playwright test` bez `BASE_URL` servíruje existujúci `build/`. Po `mv …bak` späť
teda MUSÍ nasledovať `npm run build`, inak preview stále beží na zmutovanom bundli a
test „zázračne" padá/prechádza. (Živý zásah 2026-07-27 pri mutačnej kontrole zrkadlenia.)

## 6. Nová akcia MUSÍ vrátiť VŠETKY polia, na ktoré je zdieľaný render blok gejtovaný

Keď `+page.svelte` renderuje viac krokov v JEDNOM zdieľanom bloku (napr.
`{#if (step === 'vysledok' || step === 'duplikat') && r}`), KAŽDÁ server akcia, ktorá
vracia niektorý z tých `step` hodnôt, musí vrátiť aj polia, na ktoré je blok gejtovaný
— inak sa vykreslí PRÁZDNA stránka, žiadna chyba v konzole ani v builde. Presne toto
sa stalo `/sietka` (nezávislý code-review nález, PR #108): `odoslat`'s `duplicate`
vetva vrátila `{ step: 'duplikat', error, vstup }` bez `r`, takže duplicitné odoslanie
zobrazilo prázdnu stránku namiesto „už bola odoslaná" hlášky. Pri pridávaní NOVEJ
vetvy do existujúcej akcie (alebo novej akcie vracajúcej existujúci `step`) skontroluj
`+page.svelte`-in `{#if}` podmienku pre ten `step` a vráť VŠETKO, čo podmienka aj telo
bloku čítajú — nielen polia, ktoré sa ti zdajú relevantné pre tú konkrétnu vetvu.

## 7. Živá kalkulačka (display-only) — `use:enhance` obíde pasce #3 a #4

Body 3/4 vyššie (reštart-effect a value-reset) sú pasce plného POST-reloadu s
serverovým echom `form?.vstup`. Pre **živú kalkulačku bez perzistencie a bez
viackrokového wizardu** (napr. `/optimalizator`, #212) je jednoduchší a robustnejší
vzor `use:enhance` (jadro SvelteKit, nie cudzí pattern): POST ide cez fetch, stránka
sa NEreloadne, takže klientske `$state` vstupy ostanú tak, ako ich používateľ zadal —
**žiadne value={} echo, žiadny reštart-effect, teda ani pasca #3 ani #4.** Výsledok
napĺňaš z enhance callbacku do vlastného `$state` (`update()` zámerne NEvoláš, aby sa
vstupy neresetovali). Dva detaily, ktoré sa oplatia:

- **Jednotný tvar návratu akcie** (`{ vysledok, error }`, jedno je vždy `null`; chyba cez
  `fail(400, { vysledok: null, error })`) → `ActionData` je bez union-vetiev, takže
  `result.data?.vysledok` / `?.error` sa čítajú bez TS narrowingu.
- **Žiadny `let { form } = $props()` fallback, ak appka je JS-first** — čítať `form` v
  `$state(...)` initializeri spustí `state_referenced_locally` warning (zachytí len
  úvodnú hodnotu). Buď to nechaj tak (result iba z callbacku), alebo fallback čítaj v
  `$derived`. `/optimalizator` ho nemá vôbec.

Pozn.: toto je JEDINÉ miesto v appke s `use:enhance` (ostatné stránky sú plný POST +
echo, lebo sú viackrokové s tlačou/PDF). Pre kalkulačku je enhance správna voľba; pre
wizard s krokmi ostáva plný POST + echo vzor z bodov 1–6.
