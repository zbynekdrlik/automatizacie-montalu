---
paths:
  - 'src/lib/server/odoo-katalog.ts'
  - 'src/lib/server/odoo-nazov-skla.ts'
  - 'src/lib/server/ceny.ts'
  - 'tests/odoo-katalog*.test.ts'
  - 'tests/odoo-kody-validacia*.test.ts'
  - 'tests/odoo-nazov-skla*.test.ts'
---

# Odoo katalóg artiklov (`odoo-katalog.ts`) — prechod Money → Odoo (#599)

## Čo to je

`src/lib/server/odoo-katalog.ts` `odooProduktyPreKody(kody)` = JEDINÝ zdieľaný modul na čítanie
Odoo `product.product` podľa `default_code` (= Money kód; Odoo katalóg je syncovaný z Money, rovnaké
kódy). Vracia `{ zdroj: 'odoo', produkty: Map<kod, {kod, nazov, mj, skladovy}> }` (LEN aktívne kódy,
ktoré Odoo pozná) alebo `{ zdroj: 'nedostupne', dovod: 'config' | 'chyba' }`. NIKDY nehádže.

Konzumenti: `ceny.ts` `validateOdpisKody` (kontrola kódov odpisu pred zápisom do Money, live=1),
`odoo-nazov-skla.ts` (názov skla na podklade objednávky). Ďalší krok #599 (ceny, rozvin, sklad)
**rozšír TENTO modul** (pole do `FIELDS` + do `OdooProdukt`), nepíš ďalší vlastný `product.product`
read s vlastnou cache.

## Vzor (z `glass-catalog.md` „NIKDY neblokuj page load na Odoo")

- 3 s per-volanie timeout, cache per kód 5 min (aj „Odoo kód nepozná" sa cachuje), pri chybe
  globálna nedostupnosť 60 s (`_nedostupneDo` — počas nej sa Odoo NEvolá, žiadny fan-out),
  single-flight (`while (_inflight) await _inflight`), warn raz za proces.
- `false` z JSON-2 pre prázdne polia: char → `s()`, many2one (`uom_id`) → `m2oNazov()`; nikdy
  `String(x ?? '')` (pasca #551).
- Nenakonfigurované (`ODOO_JSON2_URL`/`ODOO_JSON2_API_KEY` chýba — dev/test/CI) = `config`, bez
  volania, bez warnu. CI teda VŽDY ide fallback cestou; Odoo cesta je krytá unit testami s
  `setJson2Transport` mockom.

## PASCA: `qty_available` technický účet NEČÍTA → zhodí CELÝ read (PROD sonda 30.9.2026)

`product.product/search_read` s poľom `qty_available` → **HTTP 403 AccessError na `mrp.bom`**
(výpočet qty pri nainštalovanom MRP siaha na kusovníky kvôli kitom). Jedno zakázané pole = 403 na
celý request → katalóg by bol stále „nedostupný". Preto `FIELDS` `qty_available` NEMÁ a stav skladu
(`SkladVarovania`) ostáva na Money snapshote. Čitateľné: `default_code, name, uom_id, active, type,
is_storable` (200) a `stock.quant` (`quantity`, `location_id`) — alternatíva pre sklad = súčet
`quantity` na interných lokáciách (rozhodnutie na #599, nie implementované). Pred pridaním
ĎALŠIEHO poľa ho over read-only sondou v PROD kontajneri (vzor nižšie).

## Kontrola kódov odpisu z Odoo (`validateOdpisKody`, async od #599)

- Kód platný ⇔ aktívny `product.product` s týmto `default_code`. Validujú sa VŠETKY rodiny (Odoo
  má celý katalóg), nie len prefixy snapshotu. Presná zhoda (case-sensitive, bez trimu) — pokazený
  kód = neznámy (konzervatívne ako snapshot). Hláška aj `dovod: 'neznamy'` sú ROVNAKÉ ako pri
  snapshote (`neznamyKod()`); výsledok nesie `zdroj: 'odoo' | 'snapshot'`.
- **Aj pri Odoo zdroji ostáva `bez-skladovej-karty` zo snapshotu** (keď je snapshot použiteľný): kód
  v Odoo existuje, ale Money snapshot ho má so `sklad === null` → blok. Je to vlastnosť MONEY importu
  (do cutu odoo-erp 1122 je Money cieľ odpisu). Odoo `is_storable` NIE JE náhrada — PROD sonda 30.9.:
  4 kódy so skladom v Money (BPP00013/16/18, PRP00050) majú `is_storable=false` (falošný blok).
  Dnes má snapshot 0 kódov so `sklad=null`, poistka je preventívna. Po cute sa preklápa na Odoo.
- Odoo nedostupné → `validateOdpisKodySnapshot` (pôvodná #295 logika) + WARN `validácia kódov: Odoo
  katalóg nedostupný — fallback na Money snapshot`. Výpadok Odoo odpis NIKDY neblokuje navyše.
- Výpadok (60 s) sa týka len kódov MIMO platnej cache — požiadavka celá pokrytá cache (5 min) ide zo
  zdroja `odoo` aj počas výpadku. Warn raz za výpadok (po zotavení info + reset).
- Test, ktorý mockuje CELÉ Odoo (`setJson2Transport`) a zapisuje live odpis, musí na
  `product.product/search_read` vrátiť pole produktov (echo kódov) — inak sú všetky kódy „neznáme"
  a odpis sa zablokuje (vzor `tests/odpis-narezak-upload.test.ts` `captureTransport`).
- `writeOdpis` ju `await`-uje PRED synchrónnym blokom dedup precheck→claim — nikdy nepresúvaj
  volanie medzi precheck a INSERT (cross-spelling double-import okno, `money.ts` komentár #294).
- PROD dáta (30.9.): 164/164 kódov odpísaných od 1.9. je v Odoo aktívnych; z 904 kódov Money
  snapshotu je v Odoo aktívnych len 588 (zvyšok archivované/chýbajúce — appka ich negeneruje).
  Nový kód v katalógu appky (cfg_seed, pergola CATALOG, bazén, kovanie) MUSÍ byť v Odoo aktívny,
  inak sa odpis zablokuje (override je auditovaný).

## Read-only sonda na PROD (Odoo cez env appky)

Malý `.cjs` (POST `${ODOO_JSON2_URL}/json/2/<model>/<method>`, `Authorization: bearer
${ODOO_JSON2_API_KEY}`, tlač len status + pár kódov/hodnôt, NIKDY ceny ani kľúč) → `scp` na VPS →
`docker cp` do kontajnera `automatizacie-montalu` → `docker exec … node` → zmazať v kontajneri
(`docker exec -u 0 … rm -f`) aj na VPS. Na čítanie SQLite z kontajnera daj skript do `/app`
(`require('better-sqlite3')` sa rezolvuje z `/app/node_modules`), DB otvor `{ readonly: true }`.
