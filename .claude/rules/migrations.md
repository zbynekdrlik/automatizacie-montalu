---
paths:
  - 'src/lib/server/migracie.ts'
  - 'src/lib/server/migracie-seed.ts'
  - 'tests/migration*.test.ts'
---

# Pridanie novej SQLite migrácie — kontrolný zoznam (#318)

Schéma je verzovaná `PRAGMA user_version`; `migrate()` (`migracie.ts`) beží pri module-load
`db.ts` PRED HTTP listenerom, better-sqlite3 je synchrónny → žiadny request nevidí pol-migrovanú
schému. Pridanie migrácie `vN → vN+1` má ŠTYRI kroky — vynechanie ktoréhokoľvek padne CI/gaty:

## 1. Migračná funkcia ide do `migracie-seed.ts`, NIE do `migrate()` v `migracie.ts`

`migracie.ts` je CHRONICKY na 1000-riadkovom strope (`tests/server-file-size-cap.test.ts` ho
vynúti). Aj len 2-riadkové zapojenie (import symbolu + call riadok) ho vie pretlačiť cez 1000 —
**#318: pridanie `migrateDopytCenaHladina` posunulo migracie.ts na 1002 → padol file-size-cap.**
Preto novú migráciu píš ako funkciu v `migracie-seed.ts` (parameter injection `(db, bump)`, vzor
`migrateDopytCenaStamp`/`migrateManualMoveColumn`): guard `>= N return`, feature-detect tabuľky
(`SELECT 1 FROM sqlite_master WHERE name='…'` — minimálne migračné fixtures skáču za skorú verziu
bez tej tabuľky), celé v `db.transaction`, `bump(N)`. V `migracie.ts` pridaj len import + jeden
call riadok na správnu pozíciu (poradie = vzostupne podľa verzie).

**Ak to zapojenie aj tak pretlačí migracie.ts cez 1000 → v TOM ISTOM tickete extrahuj EXISTUJÚCI
inline blok do `migracie-seed.ts` (PURE MOVE).** #318 extrahoval v28 `migrateDeluxe5KRail` (najmenší
samostatný blok): identické SQL/loop/filter/transakcia, guard `< N` (inline) ↔ `>= N return`
(funkcia), volaný na PÔVODNEJ pozícii. Pure move = žiadna zmena správania (viď `large-file-split.md`).

## 2. Aditívne + idempotentné (appka je LIVE, má prod dáta)

`ALTER TABLE … ADD COLUMN <col> TEXT` s NULL defaultom je O(1) a neprepíše žiadny existujúci
riadok (`database-migrations.md`). NIKDY needituj/nedropuj migráciu, čo už bežala na prode.

## 3. Bumpni HLAVU vo VŠETKÝCH migračných testoch (najčastejší zabudnutý krok)

**38 migračných test súborov** (aktualizované #506, 2026-09-10 — po prečíslovaní
v44→v45 kvôli kolízii s #504 v44 (#505) a následne v44→v45 kvôli kolízii s #505 v45
(#506, prečíslovaná na v45→v46) — reálny počet cez
`grep -rln "user_version" tests/ | while read f; do grep -q "toBe(<oldhead>)" "$f" && echo "$f"; done | wc -l`
— tento počet rastie s KAŽDOU migráciou, ktorá dotýka existujúcu `user_version` asserciu +
pridá si vlastný nový `migration-vNN.test.ts`; neber ho ako fixné číslo, vždy prepočítaj)
tvrdí HLAVU po `migrate()`:
`expect(db.pragma('user_version', { simple: true })).toBe(<oldhead>)`. Nová migrácia zvýši hlavu →
VŠETKY treba prepnúť na `<newhead>`. Recept (scoped na `user_version` riadok, nie slepý sed):

```bash
grep -rl "toBe(<oldhead>)" tests/ | xargs sed -i "/user_version/ s/toBe(<oldhead>)/toBe(<newhead>)/"
grep -rn "toBe(<oldhead>)" tests/   # over: 0 zvyškov; a že žiadny setter `user_version = <oldhead>` sa nezmenil
```

## 4. Rozšír PRESNÝ zoznam stĺpcov v `migration-v25`/`v26` testoch

Tie dva testy overujú EXAKTNÝ zoznam stĺpcov tabuľky (`dopyt` pre v25/v26). Pri ALTER tej tabuľky
pridaj nový stĺpec do oboch `toEqual([...])` polí (na správne miesto — na koniec pridaného poradia).
Iné migračné fixtures (`v28`/`v29`) tú tabuľku nemajú, netreba ich meniť. **`material_prices` má
EXAKTNÉ zoznamy stĺpcov v `migration-v21.test.ts`, `migration-v38.test.ts`, `migration-v42.test.ts`**
— pri ALTER `material_prices` (pridanie stĺpca) pridaj nový stĺpec do VŠETKÝCH troch.

**NOVÁ tabuľka (nie ALTER `dopyt`) → krok 4 SA NETÝKA** (#349 v34 `odoo_zakazka_push`): `CREATE TABLE`
nemení `dopyt`, takže exaktné v25/v26 zoznamy stĺpcov ostávajú platné. Rovnako `sqlite_master`
kontroly v `migration-fresh-db`/`dopyt-store` sú `name IN (...)`/`name='dopyt'` scoped (nie
exhaustívny zoznam tabuliek), takže nová tabuľka ich nerozbije. Stačia kroky 1–3 (funkcia v seede +
zapojenie + head-bump ~24 testov na novú hlavu) + vlastný `migration-vNN.test.ts` (nová tabuľka +
stĺpce + index + zapisovateľnosť + prežitie base dát; vzor `migration-v34.test.ts`).

**Overenie:** `npx vitest run --no-file-parallelism tests/migration*.test.ts tests/server-file-size-cap.test.ts`
(a `--coverage` na celé `npm test`, prahy v `vite.config.ts`).


## v49 (#548) — objednavka_skla „iné sklo": typ_skla_manual + cena_m2_manual

Aditívne nullable `ADD COLUMN` (`migrateObjednavkaSklaManual` v `migracie-seed.ts`, feature-detect
tabuľky + existencie stĺpca). **Wiring pretlačil `migracie.ts` cez strop → v TOM ISTOM tickete PURE MOVE
inline v29 `money_dlv` bloku do `migrateMoneyDlv` v seede** (vzor #318, byte-identické). Head-bump: teraz
**40 test súborov** asertuje `user_version` (48→49). Krok 4 (v25/v26/material_prices exaktné zoznamy) SA
NETÝKA — ALTER je na `objednavka_skla`, nie `dopyt`/`material_prices` (a existujúce testy používajú
`toContain`, nie exaktný `toEqual` na objednavka_skla). Nový `migration-v49.test.ts` (fixtúra v48 musí
niesť base tabuľky pre seedData/seedUsers: users, cfg_sys, **cfg_rez**, glass_types, cfg_sklo_trieda,
odpis_log, **user_audit**, objednavka_skla — inak `SqliteError: no such table` pri importe db.ts).

## v50 (#569) — `cfg_sietka_standard` (K/R/H sieťky Štandard) vo VLASTNOM súbore

`migracie-seed.ts` bol na 996 r. → nová migrácia `migrateSietkaStandard` žije v novom
`src/lib/server/migracie-sietka.ts` (rovnaký `(db, bump)` vzor, guard `>= 50`, transakcia,
`CREATE TABLE IF NOT EXISTS` + `INSERT OR IGNORE` zo `SIETKA_STANDARD_SEED` — jeden zdroj s kódom).
**Ďalšia migrácia: tiež nový/malý súbor, NIE do `migracie-seed.ts`** (je na strope). `migracie.ts`
968 r. (import + call). Head-bump: **41 test súborov** (49 → 50). NOVÁ tabuľka → krok 4 sa netýka.
