---
paths:
  - 'src/lib/server/money-readback.ts'
  - 'src/lib/server/money-presun.ts'
  - 'src/routes/odpisy/+page.server.ts'
  - 'src/routes/odpisy/+page.svelte'
  - 'scripts/dlv-readback-snapshot.py'
  - 'tests/money-readback*.test.ts'
  - 'tests/odpisy-readback-load.test.ts'
  - 'tests/money-manual-move.test.ts'
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
- **DÁTUM-TOLERANCIA je DATE-ONLY aware — porovnávaj KALENDÁRNE dni, nie sekundy (#308).** Money
  `datum` (`DatumVystaveni`) je **date-only** (producer emituje „YYYY-MM-DDT00:00:00", polnoc
  kalendárneho dňa). Pôvodná sekundová tolerancia (`DATUM_TOL_S` 12 h proti `createdEpoch`)
  zamietla REÁLNY doklad TOHO ISTÉHO dňa: odoslané 12:28 − Money polnoc = 12h28m > 12h → falošný
  „chýba doklad" (ZAK2026464, DLV20251398). Fix: `compat` porovnáva kalendárny deň DLV (`isoDayNum`
  z `datum.slice(0,10)`) proti bratislavskému kalendárnemu dňu odoslania (`bratDayNum` cez
  `formatDatumIsoSk`(`src/lib/datum.ts`) z `createdEpoch` — Intl + IANA zóna, DST-safe, NIKDY
  `Date.parse` na SQLite stringu), s toleranciou `DATUM_TOL_DAYS = 1` deň spätne (kryje TZ/
  near-midnight/clock-skew; stále zamietne reálne staršie 2+ dni). Money `datum` je BRATISLAVSKÝ
  kalendárny deň, takže sa berie priamo (`.slice(0,10)`, žiadna TZ konverzia).
- **PARKOVANÝ `caka=1` odpis sa z matchingu VYLUČUJE ÚPLNE → vždy `caka` (#308).** `caka=1` odpis
  visí v `NA ODPIS/<subdir>` — appka ho do Money ZÁMERNE neposlala; do dlv-import ho môže presunúť
  LEN človek ručne, čo appka NEVIE (`caka` je po inserte NEMENNÉ — `releaseOdpis` riadok MAŽE,
  žiadny `UPDATE … SET caka`). Párovanie parkovaného odpisu len po zak+počte je preto nespoľahlivé:
  pôvodne poistka `caka!=1` chránila LEN `chyba-doklad` vetvu, takže parkovaný odpis sa mohol
  cross-matchnúť na cudzí doklad (napr. jeho FIX 5r) → falošný `pocet` „len 5/25" (ZAK2026450).
  `priradGroup` teraz priradí každému `caka=1` odpisu `caka` HNEĎ na začiatku a NEPUSTÍ ho do
  matchingu → nikdy falošný alarm ANI falošné `ok`, a hlavne NECLAIMuje DLV (nepokradne doklad
  legit súrodencovi tej istej zákazky). „Neoverené" je čestný stav. SQL MUSÍ čítať `l.caka`.
- **#299 VÝNIMKA — DETEKOVANÝ ručný presun VSTUPUJE do matchingu (`caka=1 AND presunute_at IS NULL`).**
  Keďže `caka` je nemenné, presunutý parkovaný odpis by inak ostal navždy „neoverený" aj po tom, čo je
  reálne v Money. `detectManualStagingMoves` (`money.ts`, volané z `/odpisy` load) diffom staging dir
  označí `odpis_log.presunute_at`, keď staged súbor zmizol (rodičovský dir stále existuje — fail-safe).
  Readback SQL preto číta AJ `CASE WHEN l.presunute_at IS NOT NULL THEN 1 ELSE 0 END AS presunute` a
  `priradGroup` vylúči LEN `o.caka === 1 && o.presunute === 0`. Presunutý (`presunute=1`) odpis vstúpi
  do matchingu ako aktívny → dostane reálny Money verdikt (✅/⛔). Detekcia je READ-ONLY na staging.
- **EXKLUZÍVNE priradenie DLV↔odpis per zákazka (`priradGroup`).** `UNIQUE(modul,zak,op,live)` →
  zasklenia+pergola+bazén jednej zákazky zdieľajú zak+op; jeden prežitý DLV by inak overil VIAC
  odpisov (a tichý drop by prešiel ako ok). Dvojfázový greedy: najprv v-pásme, potom zvyšné; každý
  DLV = najviac jeden odpis. Plná per-send exkluzivita potrebuje per-send diskriminátor v Money
  doklade (názov súboru) — zatiaľ UNVERIFIED (provisioning).
- **Pásmo `[počet_nenulových .. počet_všetkých]`** — Money môže/nemusí rátať nulové riadky (bazén
  posiela aj nulové). Ak sa LIVE potvrdí, že Money nuly ráta → pripni pásmo na presný počet.
- **Okno chyba-doklad-alarmu:** merané od GENEROVANIA snapshotu (nie „teraz"), a klampnuté na
  producerovo (`windowDays` z JSON → `money_dlv_meta.window_days`) — kratšie producer okno by inak
  falošne alarmovalo. `moneyMalCas` (gen > odoslanie+grace) + v okne = alarm; inak `caka`. (Parkované
  `caka=1` sa sem už nedostanú — sú vylúčené na začiatku `priradGroup`, viď bullet vyššie, #308.)
- **`/odpisy` load MUSÍ byť try/catch okolo readbacku** — stránka hostí „Uvoľniť" (jediná cesta
  k oprave duplikátov); readback DB/IO chyba degraduje na „neoverené", NIKDY 500.

## #299 detekcia ručného presunu zo staging (`money-presun.ts`) — gotchy

`detectManualStagingMoves()` (volané z `/odpisy` load) diffom staging dir ↔ `caka=1 live` riadky
označí `odpis_log.presunute_at`, keď staged súbor zmizol → presunutý odpis vstúpi do readback
matchingu (viď #299 VÝNIMKA bullet vyššie). Tri neintuitívne pasce (všetky našiel Money-safety
review, nie prvý návrh):

- **Readback presunutého odpisu MERAJ grace/okno od PRESUNU, nie od vytvorenia (`refEpoch`).** Parkovaný
  odpis vzniká dni/týždne pred ručným presunom; súbor doráta do Money AŽ presunom, takže DLV vznikne až
  potom. `moneyMalCas`/`vOkne` proti `createdEpoch` by dali falošný ⛔ „chyba-doklad" pri KAŽDOM
  korektnom presune (snapshot ešte nemá čerstvý DLV) a >30d-parkovaný presun by z okna vypadol a nikdy
  nealarmoval. `priradGroup` phase 2 preto počíta `refEpoch = presunute===1 ? max(created, presunute) :
  created` (SELECT nesie `presunuteEpoch = strftime('%s', presunute_at)`). Date-compat (`bratDay` z
  vytvorenia) sa NEMENÍ — move-datovaný DLV vždy prejde spätnou toleranciou.
- **Detekcia MUSÍ mať vekový prah `created_at <= now-10min` (race guard).** `writeOdpis` zaberie DB
  riadok ATOMICKY (caka=1, target, presunute_at NULL), ale súbor zapíše až PO `await buildXlsx`. V tom
  okne súbežný /odpisy load vidí dir-existuje (subdir sa recykluje) + target-chýba → označí ČERSTVÝ
  riadok ako presunutý = TRVALÝ false-positive (presun sa neruší). Človek nikdy nepresunie súbor do
  minút od staging → 10-min prah okno zatvára. (Crash-residue medzi claim a zápisom je iný, dokumentovaný
  okraj.)
- **„Súbor zmizol?" na sieťovom share = `statSync` + LEN ENOENT, NIE `existsSync`.** `fs.existsSync` vráti
  `false` na AKEJKOĽVEK stat chybe (EACCES/EIO/stale CIFS handle), nie len ENOENT — degradovaný (nie
  odpojený) share by tak označil CELÝ subdir presunutý (trvalo). Použi `statSync` v try/catch: dir musí byť
  DOSTUPNÝ (dir-stat chyba → skip), „presunutý" = LEN čistý `err.code==='ENOENT'` na TARGETE; iná chyba →
  skip. Detekcia je inak READ-ONLY na staging (žiadny move/write/delete), `writeOdpis` sa NEDOTÝKA.
- **Ledger append je IDEMPOTENTNÝ (`imports<=overrides`), nie bezpodmienečný.** V prode `writeOdpis` (aj v27
  backfill) už nechal `import` riadok (`imports=1`), takže detekčný append je tam no-op; bezpodmienečný
  append by rozbil #294 invariant „1 override = 1 re-import" (imports=2 → legit override neodblokuje).
- **NIKDY synchrónny `fs.*Sync` na staged cesty — je to CIFS/SMB share cez WireGuard (#315).** `detectManualStagingMoves`
  bežala v `/odpisy` load SYNCHRÓNNE (`fs.statSync`); na PRODE tie `target` cesty ležia na `//192.168.1.200/...`
  CIFS mounte (`soft, actimeo=1`) kde jeden `statSync` trvá **0,7–8,8 s** (namerané) → synchrónne staty na 22
  parkovaných riadkoch ZABLOKOVALI event loop na desiatky sekúnd, aj `/health` timeoutol (celá appka zamrzla).
  Lokálne/CI mikrosekundový fs to NIKDY neodhalí. Preto je detekcia teraz celá **async cez `fs.promises`** s
  tvrdým wall-clock rozpočtom (`Promise.race`, `PRESUN_DETECT_BUDGET_MS=2500`) — pri prekročení sa ČESTNE
  preskočí (parkované ostávajú, WARN), stránka sa VŽDY načíta; **jedna in-flight detekcia** (gate držaný kým fs
  ops doznejú) + sekvenčne → max 1 libuv threadpool worker (visiaci `readdir`/`stat` neuvoľní vlákno hneď).
  `readdir`-per-adresár (nie stat-per-súbor) redukuje počet volaní; MARK stále LEN po POTVRDZUJÚCOM exact-path
  `stat` s čistým ENOENT (timeout/EACCES NIKDY neoznačí presun). **Pravidlo: každý nový fs prístup na `target`/
  staging cesty MUSÍ byť async + pod rozpočtom — sieťový mount môže visieť sekundy.** (Testovacia pasca: mock
  visiaci `readdir` cez injektovanú `DetectDeps`, over že detekcia dobehne v rozpočte a NEoznačí; orphan op
  drží `detectBusy` gate → v teste ho uvoľni + počkaj, nech ďalší test nevidí „už beží".)

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
