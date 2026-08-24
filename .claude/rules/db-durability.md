---
paths:
  - "src/lib/server/db.ts"
  - "src/lib/server/money.ts"
  - "src/lib/server/migracie.ts"
---

# SQLite / Money durability (#246)

Durability gotchy pre dedup DB (`odpis_log`) + atomický zápis xlsx do Money importu.
Migračná časť (recreate pri zmene CHECK/UNIQUE, „user_version všade" testová pasca,
`db.transaction(() => { DDL; bump })()` vzor) je v `glass-catalog.md` — tu je len to,
čo tam NIE je.

## `synchronous` je na tomto better-sqlite3 builde UŽ FULL (2) — NEPREDPOKLADAJ NORMAL, PROBE-ni

Bežná durability-audit domnienka: „WAL zníži `synchronous` na NORMAL, takže commitnutý
záznam sa môže stratiť pred checkpointom". Na bundlovanej SQLite v `better-sqlite3` to
NEPLATÍ — probe (`new Database(); pragma('synchronous')`) vráti **2 (FULL)** pred aj po
`journal_mode = WAL` (build nemá `SQLITE_DEFAULT_WAL_SYNCHRONOUS=1`). Takže default už
fsync-uje pri každom commite. **Pred „synchronous je NORMAL → strata dát" nálezom vždy
empiricky over `db.pragma('synchronous', { simple: true })`** — neber to z SQLite docs
(závisí od compile-flagov konkrétneho buildu). Appka aj tak drží explicitný
`db.pragma('synchronous = FULL')` v `db.ts` ako PIN (aby kontrakt nezávisel od budúcej
verzie) + guard test `tests/db-synchronous.test.ts` (== 2). Ten test NIE je RED —
hodnota je 2 pred aj po; je to pin, nie fix aktívneho bugu.

## Atomický zápis xlsx do Money importu = fd + fsync PRED rename (nie `writeFileSync`)

`writeOdpis` (money.ts) nechce spoliehať len na `writeFileSync(tmp)+rename` — `writeFileSync`
nechá dáta v OS page cache a vráti sa; pri výpadku prúdu môže rename metadáta prežiť s
NEÚPLNÝM obsahom → Money watcher naimportuje skrátený xlsx. Vzor (#246):

```
const fd = fs.openSync(tmp, 'w');
try { fs.writeFileSync(fd, buf); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
fs.renameSync(tmp, target);
try { const d = fs.openSync(dir, 'r'); try { fs.fsyncSync(d); } finally { fs.closeSync(d); } } catch { /* dir fsync best-effort: Windows/Samba */ }
```

- `writeFileSync(fd, buf)` (fd, nie cesta) zachová plný zápisový loop, fd necháva otvorený.
- fsync SÚBORU je kritický a ide PRED rename; fsync ADRESÁRA ide PO rename (spraví durable
  samotný rename dir-entry) a je **best-effort** — cez Samba / na Windows sa adresár nemusí
  dať otvoriť na fsync, čo nie je fatálne (dáta sú už durable cez fsync(fd)).
- tmp MUSÍ ostať BEZ prípony `.xlsx` (Money watcher importuje `*.xlsx` z live priečinka).
- Celý zápis ostáva v tom istom `try/catch` ako kompenzácia (DELETE `odpis_log` pri zlyhaní
  → uvoľní dedup kľúč) — fsync refaktor ju nesmie vytrhnúť z tohto bloku.
- Durability sa NEDÁ unit-testom dokázať (výpadok sa nesimuluje) → guard je štrukturálny:
  `tests/money-fsync.test.ts` overí, že target je neprázdny + plne parsovateľný xlsx +
  žiadny `.tmp-*` zvyšok; golden testy v `money.test.ts` ostávajú 1:1 zelené.

## `deleteB2BUser` píše audit (v24) — actor sa MUSÍ prevliecť z volajúceho

`deleteB2BUser(id, actor)` číta `target_username` PRED delete a píše `user_audit`
riadok (`action='delete'`) v TEJ ISTEJ transakcii ako DELETE. Volajúci
(`pouzivatelia/+page.server.ts` akcia `zmazat`) posiela `locals.user.username` —
rovnako ako `addUser`. `action` enum je rozšírený migráciou v24 (recreate tabuľky,
SQLite nevie ALTER CHECK) o `'delete'` + `'seed'` (`seedUsers` píše seed-audit).

## Lane-merge: duplicitná migrácia a testy predpokladajúce staršiu verziu (#282)

Pri integrácii STARŠEJ build-only lane sa stáva, že lane pridala migráciu, ktorú `dev`
medzitým už dostal INÝM tiketom pod ROVNAKÝM číslom (napr. lane `#277 v25 CREATE TABLE
dopyt`, kým `dev` má to isté `v25` + navyše `#278 v26 ALTER … ADD odoo_lead_id`). To
NIE JE nová migrácia na prečíslovanie — je to DUPLIKÁT. Riešenie:

- **`migracie.ts` = ponechať dev verziu, lane duplikát ZAHODIŤ.** Prečíslovanie (v25→v27)
  urobíš LEN keď lane pridala GENUÍNNE novú, odlišnú migráciu. Duplikát tej istej tabuľky
  sa nikdy nezdvojuje ani nerenumberuje — over `grep -nE '< 2[0-9]\)' migracie.ts` = jedna
  každá.
- **Lane testy predpokladajúce staršiu schému sa MUSIA zosúladiť s merged verziou.** Lane
  `#282` testy predpokladali čerstvú `v25` (bez `odoo_lead_id`) a simulovali budúce `#278`
  cez `ALTER TABLE dopyt ADD COLUMN odoo_lead_id` — po merge je zdieľaná test DB na `v26`,
  stĺpec už existuje → `hasOdooLeadColumn()` je `true` a `ALTER` padne na *duplicate column*.
  Uprav aserície na v26 realitu.
- **Defenzívnu feature-detect vetvu ZACHOVAJ cez explicitný FLAG param, nie cez simuláciu
  starej schémy.** `listDopyty(off, lim, hasOdoo=false)` otestuje SELECT bez odoo stĺpca aj
  na v26 DB (kľúč na riadku chýba) — žiadna strata pokrytia bez potreby column-less DB.
- Kontrola po každom kroku: `grep -c '<<<<<<<' <súbor>` = 0 (PreToolUse block na compound
  príkaze = NIČ z neho nebežalo — píš merge-resolve a jeho overenie ako SAMOSTATNÉ volania).
- **Renumber lane migrácie × SÚRODENECKÝ minimal-fixture migračný test (#296/#297 kolo,
  commit 50786ef).** Pri renumber lane migrácie na `dev`, ktorý medzitým pridal SÚRODENECKÚ
  minimal-fixture migračnú test (napr. #294 ledger v27 test), treba do fixtúry súrodenca
  doplniť prázdnu tabuľku, ktorej sa renumbered krok dotýka, + zdvihnúť final-version assert
  — kríži sa #282 renumber a no-such-table gotcha.
