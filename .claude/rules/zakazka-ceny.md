---
paths:
  - 'src/lib/server/zakazka-ceny.ts'
  - 'src/routes/odpisy/zakazka/**'
  - 'src/lib/components/ReadbackBadge.svelte'
  - 'tests/zakazka-ceny.test.ts'
  - 'e2e/zakazka-ceny.spec.ts'
---

# Cenový zoznam k zákazke — /odpisy/zakazka/[zak] (#154 časti 1+2)

- **Odvodená agregácia, ŽIADNY materializovaný „zákazka" objekt.** `zakazkaPrehlad`
  (`zakazka-ceny.ts`) číta `odpis_log`+`odpis_polozky` on-the-fly (vzor `readbackStav` —
  čistá funkcia, žiadna reconcile state). Ceny napája volajúci cez existujúci
  `enrichPolozky`; UI reuse `CenyTabulka`. Nikdy nezakladaj tabuľku „zakazky".

- **`zak_norm` LEGACY PASCA (v27): priama rovnosť NESTAČÍ na read-path.** v27 backfill
  skopíroval `zak_norm = zak` RAW (`UPDATE odpis_log SET zak_norm = zak`) — kanonický
  `normZak` tvar majú LEN post-v27 `writeOdpis` riadky. KAŽDÝ nový per-zákazka read
  preto matchuje `WHERE zak_norm = ? OR upper(replace(zak_norm,' ','')) = ?`
  (SQLite `upper` je ASCII-only → priama rovnosť ostáva pre už-kanonické vrátane
  ne-ASCII; index `idx_odpis_log_norm` druhú podmienku neobslúži — tabuľka je malá,
  full scan OK). Dedup/ledger WRITE sémantika `zak_norm` sa NIKDY nemení.

- **Scope súčtov: LIVE-preferred, NIKDY mix live+test.** Ten istý obsah poslaný test aj
  live by sa v mixe započítal dvakrát. TEST fallback len keď zákazka nemá žiadny LIVE
  odpis (explicitne 🧪 označený). Parkované `caka=1` LIVE sú v súčtoch, ale priznané
  (`parkovanych` → „Vrátane N parkovaných ⏳"); odpisy spred fázy 1 (bez
  `odpis_polozky`) = `bezPoloziek` čestná hláška — nikdy „kompletná" prázdna tabuľka.

- **`ReadbackBadge.svelte` je JEDINÁ implementácia readback verdiktov** (✅/⛔ chýba/
  ⛔ viac/⛔ len/⏳) — /odpisy aj zákazková stránka ju zdieľajú. Nikdy inline kópia:
  divergentná kópia pri #154 zlúčila „viac"/„len" vetvu do zavádzajúceho title.
  Každý load, ktorý zobrazuje presun/readback stav, volá `detectManualStagingMoves()`
  PRED čítaním (try/catch, degrade-never-500 — deep-link inak vidí zastaraný stav).

- **Route kolízia:** statický segment `zakazka` vyhráva nad `[id]`;
  `/odpisy/zakazka` (1 segment) padne v `[id]` na `Number()`→404 — je to OK stav.
  b2b pokrýva `/odpisy` prefix denylistu automaticky. ZAK v href vždy cez
  `encodeURIComponent`; SvelteKit param sa auto-dekóduje a `normZak` ho zladí.

- **Časť 3 (sledovanie cez pracoviská/podpisy) ŽIJE V ODOO** (etapy zákaziek vo
  výrobe — supervisor rescope 25.8. na #154). Appka ju nestavia; tlačený zoznam
  z tejto stránky je vstup pre pracoviská.
