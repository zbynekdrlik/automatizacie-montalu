---
paths:
  - 'src/lib/server/odoo-odpis.ts'
  - 'src/lib/server/odoo-odpis-store.ts'
  - 'src/lib/server/odpis-write-hooks.ts'
  - 'src/lib/server/money.ts'
  - 'src/routes/odpisy/**'
  - 'tests/odoo-odpis*.test.ts'
  - 'tests/odpis-written-hook.test.ts'
  - 'tests/migration-v36.test.ts'
---

# Odpis materiálu → Odoo `montalu.material.odpis` paralelne s Money (#5825, aj-aj)

Každý úspešný `writeOdpis` (Money xlsx) NAVYŠE fire-and-forget pushne odpis do Odoo modelu
(`/json/2 create_from_app`, model #5817) — dual-path „aj-aj" počas cutoveru z Money na Odoo.

## Neporušiteľné invarianty (a gotchy, čo stáli čas)

- **Money je PRVOTNÝ; Odoo zlyhanie ho NIKDY neblokuje/nezhodí.** Enqueue do durable logu je
  synchrónny (riadok existuje v momente keď `writeOdpis` vráti), samotný sieťový push je až potom,
  async. Hooky (`odpis-write-hooks.ts`) sú try/catch-guarded — throw v hooku nezhodí Money zápis.
- **Durable log je APPEND-ONLY** (`odoo_odpis_push`, migrácia v36), NIE upsert. `povolitReimport`
  robí `import → release → import` legitímnym; upsert+re-arm by app-side zbalil históriu a rozišiel
  Odoo stav s Money. Každá akcia = nový riadok (`id AUTOINCREMENT`), replay STRIKTNE v poradí `id`
  per `content_hash`.
- **Per-hash FIFO musí platiť AJ NAPRIEČ sweepmi, nielen v jednom passe.** `import` v backoffe NIE
  JE v `pendingDue`, ale jeho neskorší `release` (s `next_attempt_at=NULL`) áno → arrival sweep by
  poslal `release` PRED `import` → Odoo stub → stratené polozky. Poistka:
  `hasEarlierPendingOdpisPush(id, content_hash)` — sweep preskočí riadok, kým má skorší pending
  súrodenec toho istého hashu.
- **Idempotency key: pošli SILNÝ `sha256(modul|normZak|normOp|live|ledgerHash)` ako Odoo
  `content_hash`, NIE appkin `ledgerHash`.** Appkin `ledgerHash` je 32-bit DJB2 nad OBSAHOM (bez
  op/modul/live), ale Odoo model má na `content_hash` GLOBÁLNY `UniqueIndex` + global `sudo().search`
  dedup → dva rôzne odpisy s rovnakým obsahom no iným OP by skolabovali do jedného Odoo záznamu
  (data loss). Appkin `ledgerHash` = Money dedup ostáva NEDOTKNUTÝ. (Vzor: keď downstream robí z
  tvojho hashu globálny unique kľúč, tvoj obsahovo-slabý hash na to nestačí — pošli per-record silný.)
- **Klasifikácia chýb:** PAYLOAD-permanent (prestaň skúšať) LEN pre `ValidationError|UserError`.
  `TypeError`/`ValueError`/sieť/5xx/timeout/401-403/model-not-found = TRANSIENT (deploy/schema skew,
  nie payload defekt) → retry cez `next_attempt_at` (exp. backoff). Operátorský re-arm permanentných
  na `/odpisy` (`rearmFailedOdpisPushes`). Odpis sa NIKDY nezahodí (žiaden poison-pill drop).
- **Mód `ODOO_ODPIS_MODE=note|model|both`** (default `note` = žiaden push, len note-log; `both`
  počas cutoveru). Sweep + `/odpisy` indikátor drainujú/zobrazujú backlog BEZ ohľadu na mód (leftover
  po flipe `model→note` nesmie strandnúť).
- **Reimport end-state závisí od MONOTÓNNOSTI modelu #5817** — ak `import` na `released` zázname vráti
  `created=false` bez zmeny, tak po `povolitReimport`+re-send Odoo ostane „Uvoľnené" kým Money
  re-importoval → flagnuté na #5817 (import-on-released má re-aktivovať). App-side to nevie fixnúť.

## Gate poznámka

App repo gaty (`npm run check|lint|test|build`) potrebujú **node 24** (system node v20 padá na
`EBADENGINE`) — spusti cez `~/.local/nodejs/node-v24.20.0-linux-x64/bin` na PATH.
