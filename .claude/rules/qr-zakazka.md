---
paths:
  - 'src/lib/qr-zakazka.ts'
  - 'src/lib/components/QrZakazka.svelte'
  - 'src/lib/server/pdf-common.ts'
  - 'src/lib/server/plan-rezov-pdf.ts'
  - 'src/lib/server/expedicia-pdf.ts'
  - 'tests/qr-zakazka.test.ts'
  - 'tests/pdf-qr.test.ts'
---

# QR zákazky v tlačených výstupoch (#528)

QR kód v hlavičke tlačených výstupov appky (nárezák zasklení, plán rezov PDF, pergola nárez/výkres,
expedičný zoznam PDF, interný výtlačok podkladu objednávky skla). Pracovník ho naskenuje kamerou
tabletu na Odoo kiosku → otvorí sa daná objednávka.

## KONTRAKT PAYLOADU — holé `sale.order.name`, NIE URL/token (zdroj pravdy: odoo-erp)

Odoo A6 „štítok zákazky" (`zbynekdrlik/odoo-erp` addon `company_montalu_install_config`,
`report/montalu_order_label.xml` → `models/sale_order.py::_montalu_order_label_qr_src`) kóduje QR
cez `/report/barcode?barcode_type=QR&value=%s` s HOLÝM `sale.order.name` (`OP260397`/`OPDL260222`).
Kiosk matcher `controllers/workstation_kiosk_base.py::_order_by_scan` robí `strip().casefold()` +
**substring** proti `sale.order.name`. Appka už má tento invariant: `sale.order.name === normOp(op)`
(`odoo-zakazka.ts:17,235` — používa ho pri XML-RPC hľadaní `sale.order`, aj glass-order/plan-rezov
upload). Preto **payload QR = `normOp(op)`**. Ak by Odoo strana zmenila obsah QR na URL/token, appka
ho nevie odvodiť — vtedy STOP + otázka, nie dohad.

## Kde je čo

- `src/lib/qr-zakazka.ts` — **client+server safe** (žiaden `$lib/server` import; print komponenty
  renderujú na klientovi): `qrZakazkaPayload(op)` (payload builder), `buildQrMatrix(payload)`,
  `renderQrSvg(payload)`, `QR_ZAKAZKA_TESTID='qr-zakazka'`. Knižnica **`qrcode-generator`** (MIT, 0
  tranzitívnych závislostí, čistý JS, žiaden runtime network — vzor self-contained generátorov ako
  vendorované fonty v `pdf-common.ts`). NEPRIDÁVAJ ťažšie QR knižnice (`qrcode` ťahá pngjs/canvas).
- `src/lib/components/QrZakazka.svelte` — malý zdieľaný komponent (`float:right`, self-contained
  SVG s bielym pozadím + quiet zónou). Props `op?`/`payload?`/`sizeMm`. Použi ho vo VŠETKÝCH HTML
  print hlavičkách — near-cap route súbory (`zasklenia/+page.svelte`) tak nerastú o QR logiku.
- `src/lib/server/pdf-common.ts::drawQrZakazkaPdf(page, payload, x, y, size)` — pre pdf-lib PDF
  (vektorové obdĺžniky z `buildQrMatrix`, biele pozadie + 4-modulová quiet zóna, riadok 0 HORE →
  pdf-lib má počiatok vľavo-dole). Volajú `plan-rezov-pdf.ts` + `expedicia-pdf.ts`.
- `src/lib/server/zakazka-ceny.ts::zakazkaOp(zak)` — OP najnovšieho odpisu, live-first (extrahované
  z `odoo-glass-order-upload.ts`). Reuse pri objednávke skla (`[zak]/+page.server.ts` load), aby QR
  na podklade viedol na TÚ ISTÚ `sale.order` ako nahraná `glass_order`.

## Invarianty

- **Kreslí sa LEN keď je OP zadané** (`qrZakazkaPayload(op)` neprázdne). Bez OP je výstup
  BYTE-IDENTICKÝ s dneškom (PDF: `drawQrZakazkaPdf` vráti `false` a nekreslí nič; HTML: `{#if svg}`
  nič nevykreslí). Testuj oba stavy.
- **Money-neutrálne** — QR je čisto prezentačný v hlavičke, žiadny Money kód / kontraktový vektor.
- **Client-safe DVOJNÍK `normOp`:** `qrZakazkaPayload` je kópia `normOp` (`$lib/server/money.ts` je
  server-only, do print komponentov ho SvelteKit nepustí). Drift stráži **cross-check unit test**
  `qrZakazkaPayload(x) === normOp(x)` na batérii (`tests/qr-zakazka.test.ts`). Keď meníš normalizáciu
  OP, zmeň OBE a nechaj cross-check zelený.

## Testovanie

- **PDF QR sa v tele PDF nedá prečítať** (vektor, žiaden font — ako custom-font glyfy, viď
  `plan-rezov-kiosk.md`). Testuj: (1) `drawQrZakazkaPdf` cez FAKE `PDFPage` so zaznamenaným
  `drawRectangle` (počet = 1 biele pozadie + N tmavých modulov; prázdny payload → 0), (2) integračne
  cez **rozdiel veľkosti PDF** (s OP > bez OP o stovky obdĺžnikov QR).
- E2E (`e2e/qr-zakazka.spec.ts`, zero-console): zasklenia print view s OP → `data-testid="qr-zakazka"`
  s `data-payload`; overuje aj normalizáciu v prehliadači (holé číslo → `OP` prefix).
- Coverage `include` je `src/lib/**/*.ts` — nová funkcia v `src/lib/**` (aj `src/lib/server/**`) MUSÍ
  mať priame unit testy pre všetky vetvy, inak zhodí globálny branch prah (viď `large-file-split.md`).
