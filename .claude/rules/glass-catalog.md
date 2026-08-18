---
paths:
  - "src/lib/server/migracie.ts"
  - "src/lib/server/db.ts"
  - "src/lib/styl.ts"
  - "tests/migration-*.test.ts"
  - "tests/sklo-*.test.ts"
---

# Katalóg skiel (`glass_types`) — model, Money-neutralita, migračná pasca

## Sklá sú DÁTA, nie kód

Voľby skla sú riadky v `glass_types(nazov, redukcia_zero, poradie, system, hrubka)`,
seedované sekvenčnými `PRAGMA user_version` migráciami v `src/lib/server/migracie.ts`.
**Pridať / zmeniť sklo = MIGRÁCIA, nikdy vetva v kóde.** Katalóg pre systém dáva
`glassTypesForSystem(system)` v `db.ts`.

## Kľúč je (nazov, system), NIE globálne unikátny názov (od v22, #214)

- Do v22 bol `glass_types.nazov` **globálne UNIQUE** → dva systémy nemohli mať sklo
  rovnakého názvu. v22 to zmenil na `UNIQUE(nazov, system)`, takže to isté fyzické sklo
  môže legitímne existovať vo viacerých systémoch pod tým istým názvom (napr. „3.3.1" je
  Slide aj Štandard +).
- **NIKDY nehľadaj sklo len podľa názvu naprieč systémami** — vždy cez
  `glassTypesForSystem(system)`. Miesta, čo čítajú sklá GLOBÁLNE po názve (cfg-editor
  redukcia toggle, `nastavenia/+page.server.ts` render) MUSIA deduplikovať po názve
  (dnes `GROUP BY nazov, MAX(redukcia_zero)`; tie-break musí sedieť medzi render a save).
- Štandard + a **starý Štandard zdieľajú JEDEN katalóg**: riadky sú uložené pod
  `system='Štandard +'`, starý „Štandard" k nim smeruje cez `GLASS_SYSTEM_ALIAS`
  (server `glassTypesForSystem`) a cez `sklaForSystem` (klient `zasklenia/+page.svelte`).
  Sklo pridané pod `Štandard +` sa teda objaví v OBOCH a nepretečie do Slide/Robust/Deluxe.

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

## Recreate tabuľky v migrácii (zmena constraintu)

SQLite nevie ALTER-nuť UNIQUE → recreate: `CREATE glass_types_new (... UNIQUE(...))` →
`INSERT ... SELECT` (explicitný zoznam stĺpcov, zachová `id`) → `DROP` → `RENAME`. Bezpečné,
lebo na `glass_types` NIE je žiadny FK. Celé v `db.transaction(() => { DDL; pragma user_version })()`
(vzor v18/v19) — atomické, crash → rollback, blok sa prehrá. Fresh aj existujúca DB konvergujú
až v tej migrácii (nový seed do starého bloku by narazil na iný systém s tým istým názvom, kým
je constraint ešte globálny).
