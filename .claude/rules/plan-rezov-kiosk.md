---
paths:
  - "src/lib/server/odoo-plan-rezov-upload.ts"
  - "src/lib/server/plan-rezov-pdf.ts"
  - "src/lib/server/pdf-common.ts"
  - "src/routes/plan-rezov/**"
  - "tests/plan-rezov-pdf.test.ts"
  - "tests/odoo-plan-rezov-upload.test.ts"
  - "tests/narezak-rozpis-removed.test.ts"
---

# Plán rezov → Odoo kiosk „Rezanie" (#511)

Po ULOŽENÍ plánu rezov (`/plan-rezov` `ulozit`, #505) sa na `sale.order` pripne PDF
**skutočného plánu rezov (BEZ cien)** cez `montalu_narezak_upload` (`kind='narezak'`).
Kiosk „VÝROBA / Rezanie" (odoo-erp `workstation_kiosk_podklady`) ukáže každú narezak
prílohu. Toto NAHRADILO starý odpis→rozpis narezak upload (rozpis s cenami leakol
cutterovi) — rozpis+ceny odteraz žijú LEN v internej `mt_note` (viď `odoo-zakazka.md`).

## Kde je čo

- `src/lib/server/plan-rezov-pdf.ts` — generátor PDF z `PlanRezovVysledok` (pdf-lib cez
  `pdf-common.ts`, BEZ cien). Vzor `zakazka-pdf.ts`.
- `src/lib/server/odoo-plan-rezov-upload.ts` — `queuePlanRezovUpload` (fire-and-forget
  vstup z `ulozit`), `uploadPlanRezovToOdoo`, `buildPlanRezovDocId`.
- `src/hooks.server.ts` — odpis hook volá UŽ LEN `queueZakazkaPush` (interná note), NIE
  narezak upload.

## OP + zákazník sa ODVODZUJÚ z odpisu (uložený plán ich nedrží)

`plan_rezov_ulozene` drží len `zak` (voľné pole), NIE `op` ani zákazníka. Kiosk-order sa
matchuje cez `sale.order.name === normOp(op)`, takže OP je nutný. Odvodí sa z
`zakazkaPrehlad(zak)`:
- `op = (prehlad.odpisy.find(o => o.live === 1) ?? prehlad.odpisy[0])?.op` — **preferuj
  najnovší LIVE odpis**, inak posledný TEST odpis (`live=0`) nasmeruje kioskovú prílohu na
  test OP (rovnaká live-first logika ako `zakazkaPrehlad.scope`).
- `zakaznik = prehlad.zakaznik`.
Ak `zak` prázdny → `no-zak` (skip). Ak zákazka nemá odpis / OP → `missing` (skip). Plán teda
ide na kiosk LEN keď zákazka už bola odpísaná/objednaná (kiosk-order vtedy existuje).

## doc_id namespace: `plan-rezov-<zak>-<op>` (NIE `rozpis-<zak>`)

`buildPlanRezovDocId` = `plan-rezov-<zakSlug≤12>-<opSlug≤12>`, orezané na 40, charset
`[a-z0-9-]` → vždy matchuje Odoo `[a-z0-9_-]{1,40}` a nekoliduje so starým `rozpis-*`.
xmlid-idempotentný: re-save prepíše tú istú prílohu.

## Fire-and-forget MUSÍ deferovať mimo request tick

`queuePlanRezovUpload` obaľuje CELÚ prácu (SQLite read, `parsePlanRezov`, FFD
`spocitajPlanRezov`, PDF, upload) do `setImmediate` — inak synchrónna časť pred prvým
`await` beží v request tick a zdrží odpoveď na uloženie. `ulozit` navyše obaľuje volanie
do try/catch (plán je durable, upload best-effort). BEZ durable-retry (rovnako ako pôvodná
narezak cesta) — BEZ migrácie.

## App NEPOSIELA žiadny `lines` payload

`montalu_narezak_upload` volanie nesie LEN `order_number, doc_id, kind, filename,
pdf_base64`. odoo-erp #6517 (`lines` ako riadky) konzumuje `lines` z INÉHO zdroja — appka
ho neposiela, takže zmena PDF prílohy `lines` kontrakt nedotýka (a cez `lines` neuniká cena).

## PDF obsah sa testuje cez METADÁTA, nie telo (custom-font glyfy sa nečítajú)

Hodnoty (zak/op/zákazník/profily/tyče/odpad) sa vykreslia AJ zapíšu do
Title/Subject/Keywords — TAM ich testuj (`doc.getSubject()`/`getKeywords()`/`getTitle()`).
Vzor `zakazka-pdf.test.ts`. Emoji do tela NIKDY (DejaVu subset nemá U+26A0/U+23F3 → tofu);
v komentári píš U+ názvy, nie literálne ⚠/⏳ (inak source-guard trafí vlastný komentár).

## Test gotchy (stáli ma čas)

- **Source-text „no price" guard NESMIE hľadať `/cen/i` ani `/cena/i` v CELOM zdroji** —
  matchne slovenskú prózu v komentároch (`cenami` obsahuje `cena`; `preskocenych` obsahuje
  `cen`). Namiesto toho cieľ na LEAK VEKTORY: `not.toMatch(/from ['"]\.\/(ceny|money|
  odoo-zakazka|zakazka-ceny)['"]/)` (import) + `not.toMatch(/fmtEur|predajVo|cenaSpolu|€/)`
  (identifikátory) + DATA-FLOW guard (`Object.keys` výstupného typu nemá `/cena|nakup|
  predaj|eur|price/i`). Data-flow guard je najsilnejší — generátor môže vykresliť len to,
  čo je v dátach.
- **`toHaveBeenCalledWith` na `cadText` z multipart FormData padá neviditeľne** — `new
  Request({body: fd})` + `request.formData()` normalizuje `\n` → `\r\n` v textovom poli, takže
  presná zhoda stringu padne s VIZUÁLNE identickým diffom. Porovnaj
  `arg.cadText.replace(/\r/g,'')` alebo assertuj ostatné polia cez `toMatchObject` a cadText
  cez `toContain`.
- Upload unit test: mockuj `money` (normOp/normZak) + `zakazka-ceny` (zakazkaPrehlad) —
  obchádza native better-sqlite3; transport zachyť cez `setJson2Transport` (seam v
  `odoo-json2.ts`). Server-side fetch sa cez Playwright nezachytáva → transport-kontrakt patrí
  do unit/integračného testu, E2E overuje browser save-flow.
