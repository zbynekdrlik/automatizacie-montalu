---
paths:
  - 'src/lib/server/money-readback.ts'
  - 'src/routes/odpisy/+page.server.ts'
  - 'src/routes/odpisy/+page.svelte'
  - 'scripts/dlv-readback-snapshot.py'
  - 'tests/money-readback*.test.ts'
  - 'tests/odpisy-readback-load.test.ts'
---

# POST-import readback z Money DB (#298) — overenie, že odpis reálne prešiel

## Dátový tok (READ-ONLY súborom, appka do Money NIKDY nepíše ANI nečíta cez sieť)

Presne vzor `ceny.ts` denného snapshotu: externý producent `scripts/dlv-readback-snapshot.py`
beží MIMO appky (dev2, `money-ro-thirdparty` tunel + `montalu_ro` SQL účet — credentials LEN na
dev2, NIKDY v repe) → číta read-only nedávne Money DLV doklady → JSON `dlv-readback.json` → rsync
na VPS → appka LAZY naimportuje (`maybeImportDlvReadback`, mtime-gated) do `money_dlv`. Appka
teda k Money má LEN súborový vstup — žiadny mssql klient / tunel / credential v kontajneri.
`money.ts writeOdpis` sa NEDOTÝKA (Money safety — write cesta ostáva netknutá).

## Stav readbacku je ČISTÁ funkcia, počítaná on-the-fly (žiadna reconcile state)

`readbackStav(ids)` (volané z `/odpisy` load) = `(odpis_log + COUNT(odpis_polozky) + money_dlv snapshot)`.
Stavy: `ok` (DLV existuje, `PocetPolozek` v pásme), `nesulad` (`chyba-doklad` = doklad chýba /
`pocet` = počet nesedí — ALARM), `caka` (neoverené — nedá sa overiť, NIKDY neblokuje export).
Počet odoslaných = `COUNT(odpis_polozky)` (1:1 s xlsx, písané v tej istej txn ako odpis_log).

## Gotchy (stáli čas / boli by pasca)

- **ČAS: VŽDY cez SQL `strftime('%s', created_at)`, NIKDY `Date.parse`.** SQLite ukladá
  `datetime('now')` ako space-oddelený UTC (`YYYY-MM-DD HH:MM:SS`); V8 `Date.parse` taký tvar
  berie ako LOKÁLNY čas → posun. `strftime('%s')` ho berie ako UTC (a `NULL` pri nezmysle → safe).
- **PARKOVANÝ `caka=1` odpis NEALARMUJE.** `caka=1` odpis visí v `NA ODPIS/<subdir>` — Money ho
  NEIMPORTUJE, kým ho človek ručne nepresunie do dlv-import. Chýbajúci DLV pri `caka=1` NIE je
  skip → `caka`, nie `chyba-doklad`. SQL MUSÍ čítať `l.caka`.
- **EXKLUZÍVNE priradenie DLV↔odpis per zákazka (`priradGroup`).** `UNIQUE(modul,zak,op,live)` →
  zasklenia+pergola+bazén jednej zákazky zdieľajú zak+op; jeden prežitý DLV by inak overil VIAC
  odpisov (a tichý drop by prešiel ako ok). Dvojfázový greedy: najprv v-pásme, potom zvyšné; každý
  DLV = najviac jeden odpis. Plná per-send exkluzivita potrebuje per-send diskriminátor v Money
  doklade (názov súboru) — zatiaľ UNVERIFIED (provisioning).
- **Pásmo `[počet_nenulových .. počet_všetkých]`** — Money môže/nemusí rátať nulové riadky (bazén
  posiela aj nulové). Ak sa LIVE potvrdí, že Money nuly ráta → pripni pásmo na presný počet.
- **Okno chyba-doklad-alarmu:** merané od GENEROVANIA snapshotu (nie „teraz"), a klampnuté na
  producerovo (`windowDays` z JSON → `money_dlv_meta.window_days`) — kratšie producer okno by inak
  falošne alarmovalo. `moneyMalCas` (gen > odoslanie+grace) + `caka!=1` + v okne = alarm; inak `caka`.
- **`/odpisy` load MUSÍ byť try/catch okolo readbacku** — stránka hostí „Uvoľniť" (jediná cesta
  k oprave duplikátov); readback DB/IO chyba degraduje na „neoverené", NIKDY 500.

## Producer schéma je LIVE-OVERENÁ (#298, 2026-08-24)

`scripts/dlv-readback-snapshot.py` má fixný JSON kontrakt (`{generatedAt, windowDays, rows:[{dlv,
zak, op, datum, pocetPolozek, popis}]}`). Money DLV tabuľky/stĺpce sú od 2026-08-24 **LIVE OVERENÉ**
proti `montalu_ro` (read-only tunel, provisioning #298) — repo SQL už NIE je best-effort. Money je
**Money S5 (Solitea/Seyfor)** s table-per-concrete-type modelom:

- `EconomicBase_Doklad` je PRÁZDNA abstraktná báza (0 riadkov) — nečítať z nej.
- Reálne DLV žijú v konkrétnej `SkladovyDoklad_DodaciListVydany`: hlavička `CisloDokladu` (dlv, tvar
  „DLV…"), `DatumVystaveni` (datum, date-only), `PocetPolozek`, `Nazev` (popis; nesie OP).
- **ZAK je LINE-LEVEL** — hlavičkové `Zakazka_ID` je pri AUTOMATICKOM importe NULL; zakázka žije v
  `SkladovyDoklad_PolozkaDodacihoListuVydaneho.Zakazka_ID` (FK → `Ciselniky_Zakazka.Kod`, tvar
  „ZAK…"), riadok ↔ hlavička cez `Parent_ID = d.ID`. Každý DLV = práve jedna zakázka → `OUTER APPLY
  TOP 1` je presné. Appka páruje LEN po `zak`, preto MUSÍ byť spoľahlivé (a je — z line zakázky).
- **`op = ''` (PRÁZDNE, zámerne)** — `Nazev` nesie OP v nekonzistentnom tvare (OP260387 vs
  OPDL260182), ktorý sa nedá zaručene zladiť s appkiným `op_norm`; nesprávny op by spravil reálny DLV
  NEkompatibilným (appkin `compat`: `!c.opNorm || !o.opNorm || c.opNorm === o.opNorm`) → FALOŠNÝ
  „chýba doklad" alarm. Prázdny op = appka ho ignoruje = bezpečné; párovanie stojí na ZAK + počte-
  v-pásme + exkluzívnom greedy (OP je len best-effort spresnenie).

### Automat filter — Create_ID GUID (nový systém, dev2 wrapper)

Doklady vytvorené ľuďmi (ručný import skladu) NEsú náš odpis. Filtrujeme na účet **automatického
importu**: `Create_ID = 467d0e89-dade-40c7-b0e4-f07adc3afc85` (LIVE overené: 193/195 nedávnych DLV je
od tohto účtu; 2 ručné vynechá — cudzí DLV nesmie falošne overiť odpis). Producer wrapper na **dev2**
nastavuje `MONEY_AUTOMAT_CREATE_ID=467d0e89-dade-40c7-b0e4-f07adc3afc85` (GUID je KONFIG cez env, nie
hardcode v repe; prázdne env = bez filtra na tvorcu). Porovnanie je case-insensitive cez
`LOWER(CONVERT(varchar(50), d.Create_ID))`.

## Testy

Seeduj `odpis_log`/`odpis_polozky`/`money_dlv`/`money_dlv_meta` PRIAMO (izoluje stavovú logiku);
`DLV_READBACK_PATH` daj na neexistujúci súbor, nech lazy import nechá seed na pokoji. E2E
(`e2e/odpisy.spec.ts`) seeduje LIVE odpis + `money_dlv` cez `new Database('./data/e2e.db')` (WAL →
preview server to vidí), `test.skip(!!process.env.BASE_URL)` (nedá sa proti nasadenému cieľu).
Migrácia = `money_dlv` + `money_dlv_meta` (vzor `material_prices`); pri base-sync sa čísluje podľa
najvyššej na deve (bola v29 po kolízii s #296 v28) — viď `db-durability.md` „Lane-merge".
