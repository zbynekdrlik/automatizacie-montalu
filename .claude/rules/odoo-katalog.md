---
paths:
  - 'src/lib/server/odoo-katalog.ts'
  - 'src/lib/server/odoo-nazov-skla.ts'
  - 'src/lib/server/ceny.ts'
  - 'tests/odoo-katalog*.test.ts'
  - 'tests/odoo-kody-validacia*.test.ts'
  - 'tests/odoo-nazov-skla*.test.ts'
  - 'tests/odoo-sklad*.test.ts'
  - 'src/lib/components/SkladVarovania.svelte'
---

# Odoo katalóg artiklov (`odoo-katalog.ts`) — prechod Money → Odoo (#599)

## Čo to je

`src/lib/server/odoo-katalog.ts` `odooProduktyPreKody(kody)` = JEDINÝ zdieľaný modul na čítanie
Odoo `product.product` podľa `default_code` (= Money kód; Odoo katalóg je syncovaný z Money, rovnaké
kódy). Vracia `{ zdroj: 'odoo', produkty: Map<kod, {kod, nazov, mj, skladovy}> }` (LEN aktívne kódy,
ktoré Odoo pozná) alebo `{ zdroj: 'nedostupne', dovod: 'config' | 'chyba' }`. NIKDY nehádže.

Konzumenti: `ceny.ts` `validateOdpisKody` (kontrola kódov odpisu pred zápisom do Money, live=1),
`ceny.ts` `skladoveVarovania` (sklad cez `odooSkladPreKody`, krok 3), `odoo-nazov-skla.ts` (názov
skla na podklade objednávky). Ďalší krok #599 (ceny, rozvin) **rozšír TENTO modul** (pole do
`FIELDS` + do `OdooProdukt`, alebo nová `KodCache` inštancia), nepíš ďalší vlastný Odoo read s
vlastnou cache.

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
celý request → katalóg by bol stále „nedostupný". Preto `FIELDS` `qty_available` NEMÁ; sklad ide cez
`stock.quant` (sekcia nižšie). Čitateľné: `default_code, name, uom_id, active, type, is_storable`
(200) a `stock.quant` (`product_id`, `quantity`, `location_id`). Pred pridaním ĎALŠIEHO poľa ho over
read-only sondou v PROD kontajneri (vzor nižšie).

## Stav skladu zo `stock.quant` (`odooSkladPreKody`, #599 krok 3)

- **Jeden cache mechanizmus pre oba ready:** `KodCache<T>` v `odoo-katalog.ts` (per-kód platnosť,
  výpadok 60 s bez volania, single-flight, warn raz za výpadok s názvom modelu). Katalóg 5 min, sklad
  **60 s** (hýbe sa). Nový Odoo read podľa kódu = ďalšia inštancia `KodCache`, nie kópia logiky.
- `odooSkladPreKody(kody)`: najprv katalóg (id + `is_storable`), potom JEDEN `stock.quant/search_read`
  s doménou `[['product_id','in',ids],['location_id.usage','=','internal']]`, polia `product_id,
  quantity` → súčet per kód, zaokr. na 3 desatinné. Sledovaný produkt bez kvantov = **0**; produkt
  nesledovaný skladom (`is_storable=false`, nemá kvanty) alebo neznámy = **v mape nie je** (neznámy
  stav). Mapovanie cez `product_id` id (doména cez `product_id.default_code` tiež funguje, ale
  `product_id` vracia len `[id, "[KÓD] názov"]` — kód z display name neparsuj).
- PROD sonda 30.9.: 168 produktov → 160 kvantov za 98 ms, jediná interná lokácia `PKO/Zásoby`.
- **PASCA: Odoo sklad NIE JE zrkadlo Money** (sonda 30.9., 168 kódov): zhoda 49/168; väčšina
  rozdielov je zaokrúhlenie (Odoo drží 2 desatinné), ~35 materiálnych — Odoo takmer vždy VYŠŠIE o
  nedávnu spotrebu (ZASP00024 Money 440.35 / Odoo 470.35), výnimočne nižšie (ZASP00033 2982.5 /
  982.5). Preto `ceny.ts` `skladoveVarovania` kým je snapshot čerstvý (≤ 7 dní) berie NIŽŠIU z
  hodnôt (Money pri nedostatku ticho zahodí celý doklad — čisté Odoo by varovanie stratilo); po cute
  (snapshot zastará) ostane čisté Odoo. **Sledovaný produkt BEZ interných kvantov** (`bezKvantov`)
  sa pri známej Money hodnote berie ako NEZNÁMY, nie 0 (review #599: inak falošné varovanie →
  „Odobrať z odpisu" reálneho materiálu); bez Money hodnoty ostáva Odoo 0. Pri zhode hodnôt vyhráva
  `zdroj: 'odoo'`. Odoo nedostupné → snapshot ako pred #599. Varovanie nesie
  `zdroj: 'odoo' | 'snapshot'`, `SkladVarovania` ho ukáže (`sklad-varovania-zdroj`, per položka
  `sklad-varovania-<kod>-zdroj`).
- `skladoveVarovania` je **async** — volajúci (zasklenia, cad-odpis = pergola + fix/cad, bazén, clip,
  sietka) ho `await`-ujú; pomocné náhľadové funkcie (`stavNahlad*`, `stavKontrola*`, `nahladCien`,
  `kontrola`) sú preto async. Nulové množstvá sa do Odoo ani nepýtajú.

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
