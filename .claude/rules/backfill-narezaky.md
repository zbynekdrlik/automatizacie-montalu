---
paths:
  - 'src/lib/server/backfill-narezaky.ts'
  - 'src/lib/server/backfill-narezaky-deps.ts'
  - 'src/routes/admin/backfill-narezaky/+server.ts'
  - 'scripts/backfill-narezaky-cli.mjs'
  - 'tests/backfill-narezaky.test.ts'
  - 'tests/backfill-narezaky-endpoint.test.ts'
  - 'tests/backfill-narezaky-money-safety.test.ts'
---

# Backfill nárezákov (ostrých odpisov) → Odoo `lines` (#524)

Jednorazový nástroj: pre posledných ~30 dní `odpis_log` (`live=1`) znovu dopočíta rozpis rezov tým
istým enginom modulu z uloženého `detail` a pošle do Odoo `montalu.rozpis.line` cez existujúcu
`montalu_narezak_upload` cestu (#522), aby tablet „Čo rezať" (odoo-erp #6949) mal riadky aj pre už
rozpracované zákazky. Nadväzuje na #522 (živý plán-rezov upload).

## Architektúra (prečo endpoint + wrapper, nie samostatný CLI)

Deployed kontajner je **bundle-only** (Dockerfile kopíruje LEN `build/` + prod `node_modules`, žiadny
`src/`/TS toolchain; Vite 8 bundluje cez rolldown, esbuild nie je). Samostatný TS CLI proces sa tam
nedá spustiť. Preto:

- **Ťažkú prácu robí server** cez admin endpoint `POST /admin/backfill-narezaky`
  (`src/routes/admin/backfill-narezaky/+server.ts`) — beží v už-nabootovanom serveri, ktorý má DB,
  compute a `callJson2` (súčasť `build/`). Volá `runBackfill` (`backfill-narezaky.ts`) s reálnymi
  deps (`backfill-narezaky-deps.ts`).
- **`npm run backfill:narezaky`** = tenký node ESM klient (`scripts/backfill-narezaky-cli.mjs`,
  žiadny src import) → POST na lokálny endpoint → vypíše sumár. Dockerfile ho kopíruje do kontajnera.

## Recompute per modul (`detail` → `MaterialRow`-tvar → `rozpisLinesFromMaterial`)

`rozpisLinesFromMaterial` (`odoo-rozpis-lines.ts`) je JEDEN zdroj pravdy tvaru riadku (zdieľané s #522).

| modul (marker v `detail`) | rekomputa | pozn. |
|---|---|---|
| `zasklenia` (jednoposuv) | `recomputeVstup(detail.vstupRaw, cfg)` → `r.material` | `zasklenia-sklo.ts` (pure-move z route) |
| `zasklenia` + `multiZasklenie`/`zimnaZahrada` | `recomputeMultiVstup(detail.vstupRaw, cfg)` | zimná záhrada |
| `zasklenia` + `sietkaSamostatna` | `sietkaSamostatnaVypocet(cfg, system,styl,otvorS,otvorV)` | sieťka je pod modul='zasklenia' |
| `zasklenia` + `sietkaSamostatnaMulti` | `sietkaSamostatnaMultiVypocet(cfg, detail.kusy)` | |
| `pergola`/`fix` s `detail.cad` | `parseCad(detail.cad).rows` (surový CAD text) | žiadny drift-tag (rezy = zadané dĺžky) |
| `clip` (single/`multiClip`) | `computeClip`/`computeClipMulti` → `.riadky` | pure |

**NEREKONŠTRUOVATEĽNÉ (skip + počet v sumári):** pergola **rezervačná** cesta (`detail.rezervacia===true`,
`/pergola/narez`) — `detail` drží len podmnožinu `PergolaNarezVstup`, `spocitajNarez` sa z nej nedá
spustiť. `bazen` je mimo záberu (Money počty, žiadne dĺžky rezov).

**Drift („spätne dopočítané <dátum>"):** počítané moduly (zasklenia/sietka/clip) — porovnaj
znovu-dopočítanú Money metráž `{kod→qty}` proti uloženej `odpis_polozky` (`driftVsStored`, ekvivalent
`contentHash` na profilových kódoch; kovanie navyše ignorované). Nezhoda → `poznamka`. CAD moduly
nikdy nedriftnú (rezy = surový CAD).

## GRAFICKÝ nárezák PDF pripnutý k backfill uploadu (#529)

Backfill teraz pripne k tomu istému `montalu_narezak_upload` aj **grafický nárezák PDF** (tyče
kreslené s rezmi/uhlami/odpadom/obrázkami — `narezak-pdf.ts`), aby odpisové zákazky videli na kiosku
to isté čo výtlačok appky (nie len textové `lines`).

- `mapOdpisToLines` vracia navyše `material: MaterialRow[]` s tyčami. **Zasklenia** (recompute)
  posiela svoj plný `MaterialRow[]` (tyče/uhly/kódy/obrázky priamo). **Sietka/clip/CAD** nemajú
  vlastné tyče → synthesizujú sa cez `materialRowsFromRozpis` (FFD `ffdPack`, `barLen=BAR` 7500,
  `sikmyRez=false` — rezy presné, dĺžka tyče orientačná; `kod` sa zachová pre sietku → obrázok).
- `runBackfill` skombinuje `material` VŠETKÝCH modulov OP → JEDEN PDF, pošle `pdf_base64` + `filename`
  (`Narezak-<zak>-<stamp>.pdf`). **Best-effort:** keď generovanie PDF zlyhá, pošlú sa len `lines`
  (endpoint PDF nevyžaduje, #6517). PDF sa generuje LEN v `--live` behu (nie dry-run).
- Idempotencia PDF: doc_id `backfill-narezak-<op>` verziuje tú istú prílohu (nová verzia, neduplikuje).
- v2 payload (`narezak_v2`) sa pri backfille pridá za flagom `ODOO_NAREZ_LINES_V2=1` (default OFF) —
  viď `plan-rezov-kiosk.md` „v2 payload groundwork".

## Idempotencia + bezpečnosť

- **Grupuje sa PER OP**, nie per modul: Odoo `lines` upload NAHRADÍ VŠETKY `montalu.rozpis.line` na
  objednávke (doc_id verziuje len PDF). Lines všetkých modulov OP sa preto skombinujú do JEDNÉHO
  uploadu. doc_id = `backfill-narezak-<opSlug>`.
- **Additive:** OP, ktorý už MÁ riadky (`search_read montalu.rozpis.line`), sa PRESKOČÍ — chráni živé
  #522 plán-rezov riadky, opätovný beh je no-op. OP bez objednávky v Odoo (`sale.order.name`) → skip.
- **Money-neutrálne:** iba READ (`odpis_log`/`odpis_polozky`) + Odoo `lines` upload. Žiadny `writeOdpis`,
  žiadny `odpis_log` zápis (guard `backfill-narezaky-money-safety.test.ts`).
- **BEZPEČNÝ default = DRY-RUN.** Ostrý zápis IBA s `--live` (endpoint `dryRun:false`).

## ROUND 2 — tolerantná pre-check pri Odoo read 403 (#524 R2)

PROD dry-run (16.9.) skončil **48/48 chýb: Odoo HTTP 403 `AccessError` na `sale.order`** — kľúč uid 524
(`appka-vyroba@montalu.local`) je len v narezak-**upload** skupine, nemá **read** na `sale.order` (ani
`montalu.rozpis.line`). Upload endpoint funguje, len existenčná pre-check padala a rátala sa ako chyba.

`runBackfill` preto číta existenciu/has-lines **tolerantne** (`backfill-narezaky.ts`):

- **Read zlyhá (403/AccessError, alebo akékoľvek zlyhanie čítania)** → existencia je NEZNÁMA, **NEráta sa
  ako chyba**. Dôvod sa zaloguje **RAZ za beh** (`warn` „Odoo čítanie zamietnuté — existencia neoverená").
  Keď existencia nie je overená, `has-lines` read sa **NEskúša** (to isté právo by 403-lo znova).
- **`--dry-run`:** takú OP započíta pod novým počítadlom **`Existencia neover.(403): N`** a ukáže ako
  would-send (per-OP akcia `dry-run-neoverena`, rátaná do „Poslal by").
- **`--live`:** pokračuje na upload a nechá rozhodnúť endpoint — upload prejde → `uploaded` (existenciu
  potvrdil); upload zamietne neznámu OP → **`Skip — bez objednávky`** (nie chyba), pričom chybová správa
  ide na `warn` log AJ do CLI riadku OP (`⚠`), takže genuine transport 5xx na reálne existujúcej OP
  NEostane skrytá pod „Chýb: 0" (review 🟡 #1).
- **Presná cesta ostáva**, keď read prejde: `!exists` → `skip-no-order`, `hasLines` → `skip-has-lines`.

**AKCEPTOVANÉ RIZIKO (review 🟡 #2 — owner decision):** keď existencia nie je overená, additive-ochrana
`has-lines` je nedostupná, takže `--live` beh môže **PREPÍSAŤ existujúce #522 `montalu.rozpis.line`** na
objednávke (upload nahrádza VŠETKY riadky). Prijateľné, lebo backfill reprodukuje riadky tým istým enginom
z toho istého `detail` (drift je tagovaný „spätne dopočítané"), ALE drift-nezhodné rekomputy nie sú
garantovane byte-identické. Kým read grant nepridelia, spúšťaj `--live` uvážene (radšej `--zak` na
konkrétne zákazky). Presnú additive-ochranu obnoví read grant.

**Read grant** na `sale.order` (+ `montalu.rozpis.line`) pre uid 524 je vyžiadaný paralelne v
**odoo-erp #6949** (skupina „MCP konektor/MCP — read-only (predaj + výroba)"). Po pridelení sa tolerantná
vetva prestane spúšťať sama (reads prejdú → presná cesta) — netreba nič meniť v kóde.

## Spustenie na VPS (supervisor, po nasadení)

Predpoklad na VPS `.env` (`/opt/automatizacie-montalu/.env`) + reštart:
`ODOO_NAREZ_UPLOAD_ENABLED=1`, `ODOO_JSON2_URL`, `ODOO_JSON2_API_KEY`, a **`BACKFILL_TOKEN=<náhodný>`**
(server aj wrapper ho čítajú z env kontajnera; po behu ODSTRÁŇ token z `.env` + reštart).

```bash
# 1) DRY-RUN (nič neposiela; vypíše zoznam OP × modul × počet riadkov + skip počty)
docker exec automatizacie-montalu npm run backfill:narezaky -- --days 30 --dry-run

# 2) owner pozrie počty (koľko objednávok, koľko riadkov, koľko no-order / už-má-riadky /
#    pergola-rezervacia skip). Ak sedí:

# 3) OSTRÝ beh (reálny PROD zápis lines do Odoo)
docker exec automatizacie-montalu npm run backfill:narezaky -- --days 30 --live

# voliteľne obmedziť na konkrétne zákazky:
docker exec automatizacie-montalu npm run backfill:narezaky -- --days 30 --live --zak ZAK1 ZAK2
```

Dry-run výstup čítaj takto: `Poslal by: N (riadkov spolu: M)` = koľko OP by dostalo riadky (vrátane
neoverených 403 OP); `Existencia neover.(403): N` = koľko z nich má NEOVERENÚ existenciu kvôli read 403
(pozri „ROUND 2" vyššie — v live sa buď nahrajú, alebo mapujú na „bez objednávky"); `Skip — pergola
rezerv:` = koľko pergola-rezervačných odpisov sa nedá rekonštruovať (ak vysoké → follow-up: ukladať plný
`PergolaNarezVstup` do `detail`); `Spätne dopočítané OP:` = koľko OP má aspoň jeden drift-tag riadok.

## Overenie na PROD (po ostrom behu)

Per OP: `GET /json/2/montalu.rozpis.line/search_read [["order_id.name","=","<OP>"]]` (bearer uid 524)
vráti vytvorené riadky (kod prázdny, nazov/mnozstvo/mj/dlzka/rozpis_version). Na tablete „Čo rezať" sa
karta zákazky prepne z „materiál z objednávky" na riadky z appky. Dôkaz (počet OP, počet riadkov,
jeden `search_read` sample) sa odovzdá do odoo-erp #6949.

**Pozn. (R1 UNVERIFIED → R2 VYRIEŠENÉ):** R1 nechal otvorené, či `orderExists`/`orderHasLines`
(`callJson2` POST `search_read`) na PROD fungujú. Dry-run na PROD (16.9.) ukázal, že **nefungujú — uid
524 nemá read na `sale.order`** (403 AccessError). R2 to rieši tolerantne (pozri „ROUND 2" vyššie): read
403 už NEzhodí beh, existencia sa berie ako neoverená a endpoint rozhodne pri uploade. Read metódu v
`makeOdooBackfillDeps` NETREBA meniť — po pridelení read grantu (odoo-erp #6949) sa presná cesta obnoví
sama.
