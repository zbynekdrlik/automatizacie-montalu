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

**28 migračných test súborov** (aktualizované #443, 2026-09-03 — reálny počet cez
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
Iné migračné fixtures (`v28`/`v29`) tú tabuľku nemajú, netreba ich meniť.

**NOVÁ tabuľka (nie ALTER `dopyt`) → krok 4 SA NETÝKA** (#349 v34 `odoo_zakazka_push`): `CREATE TABLE`
nemení `dopyt`, takže exaktné v25/v26 zoznamy stĺpcov ostávajú platné. Rovnako `sqlite_master`
kontroly v `migration-fresh-db`/`dopyt-store` sú `name IN (...)`/`name='dopyt'` scoped (nie
exhaustívny zoznam tabuliek), takže nová tabuľka ich nerozbije. Stačia kroky 1–3 (funkcia v seede +
zapojenie + head-bump ~24 testov na novú hlavu) + vlastný `migration-vNN.test.ts` (nová tabuľka +
stĺpce + index + zapisovateľnosť + prežitie base dát; vzor `migration-v34.test.ts`).

**Overenie:** `npx vitest run --no-file-parallelism tests/migration*.test.ts tests/server-file-size-cap.test.ts`
(a `--coverage` na celé `npm test`, prahy v `vite.config.ts`).
