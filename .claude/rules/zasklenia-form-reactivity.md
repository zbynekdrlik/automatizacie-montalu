---
paths:
  - "src/routes/zasklenia/+page.svelte"
---

# `+page.svelte` (zasklenia) — reaktívne gotchas nad rámec `nova-stranka` §3

## „Smart default" checkbox (predvyplň, ale nechaj odškrtnuteľné) — HRANOVO, nie „vždy keď true"

Vzor z #132 (`pridavnaKolajnicaS` — predvyplní sa zaškrtnutá pri Štandard + s IZO
sklom). Keď má checkbox DEFAULT odvodený z iného poľa (systém/štýl/sklo…), ale
obsluha ho smie kedykoľvek prebiť, `$effect`, ktorý ho nastavuje, **NESMIE** bežať
„vždy keď podmienka platí" — to by pri KAŽDEJ zmene nesúvisiaceho poľa (rozmery,
poznámka…) prepísalo ručný klik obsluhy späť na default. Namiesto toho:

```js
let odporucanaPrev = $state(false);           // hranový tracker
let odporucana = $derived(vypocitajDefault(system, styl, sklo));
$effect(() => {
	const chce = odporucana;
	if (chce !== untrack(() => odporucanaPrev)) {   // len na SKUTOČNEJ zmene
		checkboxS = chce;
		odporucanaPrev = chce;
	}
});
```

`untrack()` na čítaní `odporucanaPrev` je POVINNÝ — bez neho by effect sledoval aj
vlastný zápis a pridal zbytočný extra beh (nie nekonečnú slučku, lebo druhý beh už
nevidí rozdiel, ale zbytočný).

**„Použiť znova" (reštart-efekt) sa NESMIE prepísať.** Ak checkbox obnovuješ z
histórie v tom istom (alebo skoršom) `$effect`, ktorý nastavuje `system`/`styl`,
MUSÍŠ tam ZASIAŤ `odporucanaPrev` priamo z OBNOVENÝCH dát (`p?.system`, nie
reaktívne `system`, ktoré sa ešte neustálilo) — inak hranový effect po obnovení
uvidí zmenu (default sa líši od uloženej hodnoty) a prepíše presne to, čo si práve
obnovil. Over to e2e testom cez skutočný „Použiť znova" tok (`gh issue view 132`
komentáre — nestačí to len okomentovať, treba to prebehnúť).

**Multi-posuv:** ak je pole ZDIEĽANÉ naprieč posuvmi (over v `+page.server.ts`
komentároch — `pridavnaKolajnica` je „vstup na úrovni objednávky"), default sa
odvodzuje LEN z PRIMÁRNEHO posuvu — presne ako viditeľnosť checkboxu už dnes.
Neizobretaj per-posuvovú logiku, ktorú viditeľnosť checkboxu sama nemá.

**Test round-trip cez REÁLNY formulár, nie len cez čistú funkciu.** Vitest overí
LEN `vypocitajDefault()`; Svelte-5 efekt-poradie (reštart-efekt → styl/sklo-fixup
efekty → hranový efekt) sa overuje výhradne Playwrightom — pozri
`e2e/pridavna-kolajnica-izo-default.spec.ts` ako vzor (default ON/OFF, ručné
odškrtnutie prežije nesúvisiacu zmenu poľa, prepnutie preč z podmienky a späť,
zmiešaný multi-posuv, „Použiť znova").

## Gate podmienky duplikuj vedome, nie mlčky

`system === 'Štandard +' && !styl.startsWith('6K')` dnes žije na TROCH miestach
(`railUpsize` v `compute.ts`, viditeľnosť checkboxu tu, `pridavnaKolajnicaDefault`
v `styl.ts`) — #134 čaká na zjednotenie do jedného zdieľaného predikátu. Kým to
niekto neurobí, KAŽDÁ zmena veľkosti/rozsahu koľajnice musí prejsť VŠETKY tri
miesta, nie len to, ktoré práve upravuješ.
