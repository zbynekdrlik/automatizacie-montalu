---
paths:
  - "src/routes/zasklenia/+page.svelte"
  - "src/routes/zasklenia/+page.server.ts"
  - "src/lib/sklo.ts"
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

## Krokové subkomponenty (#250) — kde žije stav, kam pridať nový vstup

`routes/zasklenia/+page.svelte` (kedysi 1620 r. monolit) je rozdelený vzorom #239
(pergola/narez): `+page.svelte` (~758 r.) = **state + compute hub**, kroky sú komponenty
v `src/lib/components/zasklenia/`:

- **`ZasklieniaForm.svelte`** — krok `form` (zadanie plánu). 31 editovateľných polí ako
  `$bindable` + `posuvyExtra` array ako `$bindable`. Derivované hodnoty
  (`stylyPre`/`sklaPre`/`otvaraniaPre`/`b2b*`/`jeOpona`/`jeRobust`/`maSietka`/`sietkaStranaVal`/
  `posuvyJSON`/…) + pure helpery (`stylyForSystem`/`sklaForSystem`/`otvaraniaForStyl`/
  `kolajnicaPre` — uzávery nad `data`/`existuje` v +page) + mutátory
  (`addPosuv`/`removePosuv`/`fixPosuv`) prídu ako **propy s ROVNAKÝMI menami** ako v +page →
  markup ostal 1:1 (jediná zmena `data.systemy`→`systemy`, `data.kovania`→`kovania`).
- **`PlanKarty.svelte` / `PlanKartyMulti.svelte`** — výsledkové karty (`nahlad`/`hotovo`/
  `nahladMulti`/`hotovoMulti`). Čistá prezentácia; propy `plan`/`multi`, `vstup`,
  `kovanie`/`ceny`/`skloCeny`. Importujú si vlastné display helpery + `Nahlad2D`/
  `ProfilObrazok`/`RozpisRezov`/`CenyTabulka`/`SkloCena`.
- **`PoznamkaRal.svelte` / `KovanieStrany.svelte`** — zdieľané malé display komponenty
  (bývalé snippety `poznamkaRal`/`kovanieStrany`).
- **`src/lib/zasklenia-form.ts`** — zdieľané `type PosuvRow`, `type PlanVstup`, `const fmtM`
  (type-only + čistá fn, nula reaktivity — potrebuje ich +page aj deti).

**Kritické pre round-trip a reaktivitu:** VŠETOK `$state`, `$effect` echo (reštart-efekt),
normalizačné `$effect`y (styl/sklo/otvaranie/kolajnica), hranový `pridavnaKolajnica` efekt,
`posuvyJSON` serializácia A **oba serializačné snippety `hiddenVstup`/`hiddenMulti` + celé
nahlad/hotovo vetvy** ostávajú v `+page.svelte` (jediná autorita). Reaktívne jadro sa
NEPRESÚVA — `$effect` poradie (`zasklenia-form-reactivity.md` vyššie) ostalo **byte-identické**
(over: `diff` `<script>` bloku voči `git show origin/dev:…`). Editovateľné polia
`ZasklieniaForm` sú `$bindable`; rodič ostáva ich zdrojom (echo `$effect` ich obnoví). **Nový
carried-through stav = nový `$state` + `<input type="hidden">` v +page snippete, NIE v dieťati.**

**CSS:** `+page.svelte` NEMÁ `<style>` blok — všetky triedy (`card`/`sec`/`field`/`posuv-box`/
`kov-posuv`/`poznamka-ral`/…) sú GLOBÁLNE v `src/app.css`. Preto — na rozdiel od #239 — NIET
page-scoped CSS na presun ANI `.sec .badge` pasce (žiadny `.sec`-hlavičkový odznak sa v tomto
strome nerenderuje; `.badge` je len v `<p class="sub">` nahlad/hotovo hlavičiek). Deti nemajú
`<style>` blok.

**Lokálna sieť pred CI (Tier-0 E2E lokálne nebeží):** pri každej zmene tohto splitu over
`check` + `lint` + unit, a pri pochybnosti o 1:1 fidelite porovnaj množiny — 58 `data-testid`
hodnôt, všetky `name=` atribúty formulára, `action=`/`formaction=` a `KlinPolia`/`SietkaPolia`/
`Nahlad2D` bindingy MUSIA ostať identické (`diff` origin vs nový); E2E `zasklenia*.spec.ts` +
`app.spec.ts` v CI je konečná sieť.

## Config-derivované form gaty (viditeľnosť polí) — odvoď z konfigurácie, nie z názvu systému

Viditeľnosť polí formulára, ktoré závisia od SYSTÉMU, sa NEgate-uje hardcodom
`system === 'X'` — derivuje sa zo servera z konfigurácie kovania. Server (`+page.server.ts`
`load()`) vracia množiny systémov, klient (`+page.svelte`) z nich robí `$derived` gate
(úniou naprieč posuvmi, keď je pole na úrovni objednávky — ako farba/FAB):

| Pole | server množina | odvodené z | klient gate |
|---|---|---|---|
| „Jednostranná FAB" | `systemyFab` | kovanie má položku `pravidlo.typ==='naUzaverPodlaFab'` (kľučka/krytka vložky — **dnes iba Robust**) | `maFab` (únia posuvov) |
| „Farba kovania (RAL)" | `systemyFarba` | kovanie má položku s `.farba` | `maFarbu` (únia posuvov) |
| ručná koľajnica | `systemyKolajnica` | `systemyRucnaKolajnica(cfg)` | `maKolajnicu` (primárny) |

**Dôsledok (#431):** FAB checkbox sa NEriadi „má systém kovanie?" — Deluxe/Slide/Štandard
kovanie DO Money majú, ale FAB položky (`naUzaverPodlaFab`) NIE, takže tam checkbox nič
nemenil a je skrytý. Starý gate `maKovanie`/`systemyKovanie` (= `komponentyPre(sys)!==null`)
bol nahradený `maFab`/`systemyFab`. Pri PRIDANÍ nového systému s kľučkou/krytkou vložky sa
FAB checkbox objaví AUTOMATICKY (žiadna úprava stránky). Order-level pole ⇒ **únia naprieč
posuvmi** (inak mixed objednávka primárny-Deluxe + ďalší-posuv-Robust o FAB pre Robust
príde — testuj to e2e cez `#ps0-sys`, viď `e2e/kovanie-odpis.spec.ts`). Skryté order-level
pole vynuluj reset-`$effect`om `if (!maX) hodnotaS = false` (vzor `maKolajnicu`).

## Predvolené sklo je system-aware — `defaultSklo(skla, system)`, nie migrácia poradia

Per-systém predvoľba skla žije v `src/lib/sklo.ts` `defaultSklo(skla, system?)` (display-only,
nič odtiaľ nejde do Money): číre pre väčšinu, **Deluxe = „10 mm"** (#431, Patrik). Nový
per-systém default pridaj TAM (guardovaný `system === '<X>'`, graceful fallback na spoločné
pravidlo), NIE zmenou `poradie` v glass_types seede (to je migrácia na prod + mení poradie
v `<select>`). Volá sa z `+page.svelte` na dvoch miestach (primárny sklo-effect + `fixPosuv`)
— obom posielaj `system`/`p.system`. POZOR: predvoľba je Money-neutrálna len „pre dané sklo"
— zmena Deluxe defaultu 6→10 mm zmení KTORÉ sklo je prednastavené a 10 mm dáva iný (úplnejší)
odpis; sklo→odpis kanály sú tri: Slide (`redukcia_zero`), Deluxe (`hrubka`), Štandard IZO
(`sysStylPre`) — viď `.claude/rules/glass-catalog.md`.
