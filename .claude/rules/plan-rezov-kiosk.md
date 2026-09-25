---
paths:
  - "src/lib/server/odoo-plan-rezov-upload.ts"
  - "src/lib/server/odoo-narezak-odpis.ts"
  - "src/hooks.server.ts"
  - "tests/odpis-narezak-upload.test.ts"
  - "src/lib/server/odoo-rozpis-lines.ts"
  - "src/lib/server/narezak-pdf.ts"
  - "src/lib/server/narezak-cut-plan.ts"
  - "src/lib/server/profil-png.ts"
  - "src/lib/server/pdf-common.ts"
  - "scripts/gen-profil-png.mjs"
  - "src/routes/plan-rezov/**"
  - "tests/narezak-pdf.test.ts"
  - "tests/narezak-cut-plan.test.ts"
  - "tests/odoo-plan-rezov-upload.test.ts"
  - "tests/odoo-rozpis-lines.test.ts"
  - "tests/odoo-rozpis-lines-money-safety.test.ts"
  - "tests/narezak-rozpis-removed.test.ts"
  - "e2e/plan-rezov-lines-kiosk.spec.ts"
  - "e2e/narezak-print-view.spec.ts"
---

# Plán rezov → Odoo kiosk „Rezanie" (#511)

Po ULOŽENÍ plánu rezov (`/plan-rezov` `ulozit`, #505) sa na `sale.order` pripne PDF
**skutočného plánu rezov (BEZ cien)** cez `montalu_narezak_upload` (`kind='narezak'`).
Kiosk „VÝROBA / Rezanie" (odoo-erp `workstation_kiosk_podklady`) ukáže každú narezak
prílohu. Toto NAHRADILO starý odpis→rozpis narezak upload (rozpis s cenami leakol
cutterovi) — rozpis+ceny odteraz žijú LEN v internej `mt_note` (viď `odoo-zakazka.md`).

## Kde je čo

- `src/lib/server/narezak-pdf.ts` (#529) — **GRAFICKÝ** generátor PDF z `MaterialRow[]`
  (pdf-lib cez `pdf-common.ts`, BEZ cien). Nahradil textový `plan-rezov-pdf.ts` (zmazaný).
  Kreslí tyče proporčne s rezmi/uhlami/odpadom/obrázkami — zrkadlí `RozpisRezov.svelte`.
- `src/lib/server/narezak-cut-plan.ts` (#532) — `cut_plan` payload builder (`buildCutPlan` +
  `renderBarSvg`); nahradil #529 v2 (`narezak-lines-v2.ts`, zmazaný). Ide VŽDY (bez flagu).
- `src/lib/server/profil-png.ts` (#529) — server-only base64 PNG obrázky profilov (generované
  `scripts/gen-profil-png.mjs` cez `dwebp`; pdf-lib nevie webp).
- `src/lib/server/odoo-plan-rezov-upload.ts` — `queuePlanRezovUpload` (fire-and-forget
  vstup z `ulozit`), `uploadPlanRezovToOdoo`, `buildPlanRezovDocId`.
- `src/hooks.server.ts` — odpis hook volá `queueZakazkaPush` (interná note S CENAMI) **a od #570
  aj `queueNarezakUploadZOdpisu`** (`odoo-narezak-odpis.ts`) — nárezák BEZ cien zo zdieľaného jadra
  backfillu. Viď sekcia „REGRESIA #570" nižšie.

## REGRESIA #570 — kiosk „Čo rezať" MUSÍ dostať riadky z ODPISU, nie len z /plan-rezov

**Lekcia:** #511 odstránil `queueNarezakUpload` z odpis hooku (dôvod: posielal rozpis S CENAMI) a
jediným automatickým triggerom nárezáku ostalo **uloženie plánu na `/plan-rezov`** — lenže výroba
plán NIKDY neukladá (PROD `plan_rezov_ulozene` = 1 E2E riadok). Tablety „Čo rezať" boli od 20.9.
prázdne; regresiu 5 dní maskovali ručné backfill behy (16.–19.9.). Guard
`narezak-rozpis-removed.test.ts` (`not.toMatch(/queueNarezakUpload/)`) ju dokonca betónoval —
zakazoval AKÝKOĽVEK nárezák z odpisu, hoci zámer bol len „žiadne ceny na kiosk". **Pri odstraňovaní
triggera vždy over, ČO ho v produkcii nahrádza (reálne dáta, nie existencia cesty v kóde).**

**Oprava (#570):** `setOdpisWrittenHook` → `queueNarezakUploadZOdpisu(zak, op)`:
- **LEN `live=1`** — `isLive()` sa číta SYNCHRÓNNE v hooku (ten istý proces-flag, ktorým `writeOdpis`
  zapísal `odpis_log.live`); test odpis nič neposiela. Brána `ODOO_NAREZ_UPLOAD_ENABLED=1` + JSON-2 env.
- **Telo = ZDIEĽANÉ JADRO backfillu** (`backfill-narezaky.ts`): `groupOdpisyPerOp` →
  `linesPreOp` → `odoslatNarezakPreOp` (PDF + `cut_plan` v1–v3 + `uploadNarezak` 422 fallback +
  klasifikácia `montalu_order_not_found`). Žiadna kópia — `runBackfill` volá to isté.
- **Riadky VŠETKÝCH modulov OP** (`listLiveOdpisyForOp` — match `normOp(r.op)`, lebo v27 `op_norm`
  je pre staré riadky RAW kópia) — lines upload nahrádza VŠETKY riadky objednávky, takže upload len
  práve zapísaného modulu by zmazal riadky ostatných modulov tej istej OP.
- doc_id `backfill-narezak-<op>` (rovnaký ako backfill → neskorší prepíše PDF). `/plan-rezov` save
  ostáva (doc_id `plan-rezov-<zak>-<op>` — INÁ príloha, ale `lines` sa nahrádzajú bez ohľadu na
  doc_id, takže riadky sa NEduplikujú; neskorší zápis vyhrá).
- **SÉRIOVO per OP so zlúčeným dobehom** (`bezi` Map v `odoo-narezak-odpis.ts`, review #570): lines
  nahrádzajú všetky riadky objednávky, takže dva súbežné uploady tej istej OP by mohli doraziť v
  opačnom poradí a starší snapshot (len modul A) by prepísal novší (A+B). Per OP beží najviac 1
  upload; odpisy počas behu len nastavia `dobeh` → po skončení JEDEN ďalší upload s čerstvým stavom z
  DB. Test: `súbeh dvoch odpisov tej istej OP` (max súbežnosť 1, posledný payload = všetky moduly).
- Fire-and-forget (`setImmediate`, sync+async catch), log modul `narezak-upload`
  (`nárezák z odpisu: štart` / `ok` s `linesCount` / chyba). Pergola rezervačný odpis → `no-lines` skip s logom.
- **Test** `tests/odpis-narezak-upload.test.ts` ide cez REÁLNY `hooks.server` composition root +
  `writeOdpis` nad temp DB, mockuje LEN `setJson2Transport`; `vi.waitFor` na odložený upload
  (timeout < test timeout, inak dostaneš `Test timed out` namiesto assertion diffu).

## GRAFICKÝ nárezák PDF (#529) — zrkadlí `RozpisRezov`, kontrakt + pdf-lib pasce

Owner ROZHODNUTÉ (16.9.): rezač na kiosku má vidieť TO ISTÉ čo výtlačok appky —
tyče kreslené s rezmi (obrázok), obrázky/rezy profilov, uhly rezov, odpad per tyč, súčty
za profil, kód profilu. `narezak-pdf.ts` (`generateNarezakPdf(header, MaterialRow[], opts,
now)`) to kreslí; obe upload cesty (plán-rezov save + backfill) ho kŕmia `MaterialRow[]`.

- **pdf-lib 1.17 NEMÁ `drawPolygon`** — lichobežníkové segmenty rezov (45° zošikmenie ako v
  `RozpisRezov.segmenty`) kresli cez `drawSvgPath`. Origin `{x:0, y:A4_H}` a SVG y ide DOLE, takže
  PDF bod (px,py) → svg token `px, ${A4_H − py}` (helper `fillPoly`). `drawRectangle`/`drawLine`
  existujú.
- **pdf-lib NEVIE embednúť webp** — `static/profil/*.webp` (VP8) sa prekonvertujú `dwebp`om na
  zmenšené base64 PNG do `profil-png.ts` (server-only, vzor `fonts/dejavu.ts`), embed `embedPng`.
  Generátor `scripts/gen-profil-png.mjs` PRESKOČÍ nedekódovateľný zdroj (napr. `ZASP00113.webp` je
  31 B poškodený placeholder) → ten profil nemá PDF náhľad (graceful, ako UI `maObrazok`).
- **Base64 PNG blob v `.ts` spustí `block-sensitive-staging.sh`** — commituj s
  `# airuleset:secret-ok <dôvod>` NA `git add` AJ NA `git commit` príkaze (skenuje sa oboje).
- **Hodnoty (tyče/rezy/uhol/odpad) sa testujú cez METADÁTA** (Title/Subject/Keywords: `Tyčí: N`,
  `Rezov: N`, `Uhol: 45°/rovný/45°+rovný`, `Odpad: NN mm`, per-profil digest) — custom-font glyfy
  sa z PDF tela nečítajú. Guard „žiadne ceny" skenuje metadáta (`narezak-pdf.test.ts`).
- **Vizuálne overenie PDF:** `pdftoppm -png -r 90 x.pdf out` (na dev boxe) → screenshot, potom
  posúď nákres tyčí očami. `MaterialRow` už NESIE všetko (`bary`/`sikmyRez`/`kod`/`barLen`/odpad).

## `cut_plan` payload (#532) — kontrakt appka↔odoo-erp 7431 (tablet pri píle)

**POZOR — intake NIE JE lenient (opravené #532 R2):** `montalu_narezak_upload` (odoo-erp
`sale_order_narezak.py`) **ODMIETA neznáme top-level kľúče** — `ValidationError("Neznámy parameter:
%s")` raise **PRED** vyhľadaním objednávky. R1 predpokladal „intake `**extra` ignoruje" — NEplatí (to
platí len pre extra polia vnútri `lines[]`, #529). PROD bez odoo-erp#7431 → `cut_plan` = **HTTP 422**
a padne celý upload. **PRAVIDLO pri pridaní NOVÉHO top-level kľúča do tohto uploadu: Odoo strana MUSÍ
byť nasadená PRV, a appka potrebuje klient-side fallback** (viď nižšie).

**Doručenie cez `uploadNarezak` (`odoo-json2.ts`, #532 R2):** oba call-sites (`odoo-plan-rezov-upload.ts`,
`backfill-narezaky-deps.ts`) posielajú `montalu_narezak_upload` cez `uploadNarezak`, ktorý na 422
„Neznámy parameter: cut_plan" zopakuje upload **BEZ `cut_plan`** (lines+PDF vždy doručené, warn raz za
proces, `cutPlanRejected` signál). Kill switch `ODOO_NAREZ_CUT_PLAN=0/false` vypne `cut_plan` úplne
(default ON). Po nasadení #7431 sa fallback prestane spúšťať sám (auto-heal) — detaily + re-run:
`.claude/rules/backfill-narezaky.md` sekcia „cut_plan 422 fallback".

`cut_plan` NAHRADIL #529 v2 (`narezak_v2` za flagom) — ide **VŽDY** (bez flagu), keď nárezák má tyče
s Money kódom.

`buildCutPlan(MaterialRow[])` → `{ version:1, bars:[…], summary }` (v2 kľúče #535 nižšie) alebo
**`undefined`** keď žiadna tyč nemá
kód (kľúč sa vynechá úplne — žiadne prázdne polia). JEDEN `bars[]` = JEDNA fyzická tyč
(`Tyc = MaterialRow.bary[i]`), v poradí profilov ako grafický PDF (JEDEN zdroj pravdy s
`narezak-pdf.ts drawBar`):

- `bar_id` = `B1`/`B2`… 1-based **len cez vydané tyče** (bez-kódu tyče `bar_id` nedostanú).
- `profile_kod` = `MaterialRow.kod` (Money kód) — **NIKDY prázdny**; tyč bez kódu sa VYNECHÁ +
  zaloguje (`pocetVynechanychBezKodu`, log fire-uje vždy keď `bezKodu>0`, aj v mixovanej OP kde je
  `cutPlan` pravdivý — `planSent` flag).
- `pieces[]` = `Tyc.kusy[]` v poradí rezu: `seq` 1-based, `length_mm = Kus.rozmer` (finálna dĺžka
  s prerezom, ako popisok na kresbe), `angle_left/right_deg` = per-profil `(sikmyRez ?? true)?45:90`
  (oba konce rovnaké — per-kus uhly štruktúra `Kus` nemá, NEVYMÝŠĽAJ; pergola krov #161 sem
  nepríde), `label` = `(posuv?"Z{posuv} ":"") + fmt(rozmer)`, `qty` vždy 1 (1 záznam = 1 rez).
- `waste_mm = round(Tyc.zvysok)`, `stock_length_mm = round(MaterialRow.barLen)`, `note = ""`.
- `render_svg` = base64 kompaktného samostatného SVG per tyč (`renderBarSvg`), ROVNAKÁ geometria
  ako `drawBar` (proporčné segmenty ∝ `Kus.dlzka`, 45° lichobežník `s=250·scale` klampovaný
  `segW/2-0.5`, koncový odpad; SVG y DOLE vs PDF y HORE). Money-neutrálne (žiadne ceny).

### v2 aditívne kľúče (#535) — VNÚTRI `cut_plan`, verzia ostáva `1`, žiadny nový top-level kľúč

„nech neklesá úroveň, aj uhly, aj všetky detaily na tablete" (owner 17.9.). Papierový nárezák nesie
kotúč, typ rezu, ikonu prierezu a sumár; v1 dáta ich nemali. v2 ich pridáva ADITÍVNE (tolerované,
DQ-and-continue #7436) — všetko VNÚTRI `cut_plan` (nový top-level kľúč = 422 na PROD pred Odoo
deployom, viď #532 R2):

- `bars[].kerf_mm` = **rezná medzera, ktorou volajúci ZBALIL tyče** (`buildCutPlan(material, kerfMm)`,
  default `KOTUC`=4) — TÁ ISTÁ, ktorou generuje PDF (`reznaMedzera ?? KOTUC`), takže papier a dáta
  sedia. Backfill + dnešné cesty ju nemenia (KOTUC); `/plan-rezov` upload posiela
  `input.reznaMedzera` (user-editovateľná) → kerf ostáva 1:1 s PDF aj keby tá cesta raz niesla Money
  kódy (dnes píše `kod:''` → cut_plan sa aj tak vynechá). **NEhardcoduj `KOTUC` v builderi** — inak
  by user-zmenený kotúč šiel na pílu zle. Number.
- `pieces[].cut_type` = `cutTypeFor(angle_left, angle_right)` → `"uhol"` keď ktorýkoľvek koniec ≠ 90°,
  inak `"rovny"` (1:1 s papierom „rez rovný"). Per-kus; uhly sú per-profil (oba konce rovnaké), ale
  helper je pure a testovaný aj pre zmiešané uhly (pripravené na per-kus uhly, keby raz prišli).
- `bars[].profile_icon_svg` = **base64 PNG** prierezu profilu (`profilPngB64(kod)`,
  `static/profil/<kod>.webp` → PNG cez `profil-png.ts`). **POZOR: meno kľúča je kontraktové
  (`profile_icon_svg`), OBSAH je PNG base64** (Odoo #7489 sanitizer to vie). Posiela sa **RAZ per
  `profile_kod`** — na PRVEJ tyči s tým kódom (`seenKody` Set), ďalšie tyče kľúč vynechajú (Odoo
  cachuje podľa kódu, payload ostáva malý). **Bez obrázka pre kód → kľúč sa VYNECHÁ** (nikdy prázdny
  reťazec — preto voliteľný v type).
- `cut_plan.summary` = `{profiles_count, bars_total, waste_total_mm, waste_total_pct}` cez zdieľaný
  pure helper `narezakSummary(material)` (`$lib/odpad`) — **ten istý helper plní aj PDF hlavičku**
  (`narezak-pdf.ts`: `profilov`/`tyceSpolu` idú z neho), takže papier = dáta bez duplicity.
  `waste_total_pct = waste_total_mm / Σ(tyce×barLen) × 100`, 1 desatinné miesto, 0 keď žiadne tyče.
  **ZÁMER:** sumár je **nárezák-široký** (počíta VŠETKY profily s tyčami, aj bez Money kódu, ako
  papier) — preto `summary.bars_total`/`profiles_count` môžu byť **VYŠŠIE** než `bars[].length`
  v OP s nekódovanými profilmi (pergola/fix/clip), ktoré `buildCutPlan` z `bars[]` vynecháva.

**Odoo consumption status (17.9.):** `kerf_mm` + `cut_type` číta odoo-erp **PR 7478**
(`sale_order_narezak_cutplan.py`, `montalu.rozpis.bar.kerf_mm` / `montalu.rozpis.piece.cut_type`,
kiosk odvodí cut_type z uhlov keď prázdne). `profile_icon_svg` sa renderuje až po **#7489** (SVG/PNG
sanitizer) — kľúč posielame HNEĎ (tolerovaný), aby fáza C mala z čoho čítať. `summary` intake zatiaľ
**NEČÍTA** (počíta si vlastný) — posiela sa pre 1:1 zhodu s papierom.

### v3 aditívny kľúč (#542, owner 18.9., odoo-erp 7431 fáza C) — `cut_plan.render_html`

Owner 18.9. (po fáze B v Odoo): „prerobil si to nanovo, vyzerá to hnusne — mal si to skopírovať
z appky". ROZHODNUTIE (voľba A): **appka je zdroj CELÉHO vzhľadu nárezáku, Odoo nič nekreslí.** Appka
NEMÁ HTML šablónu za PDF — `narezak-pdf.ts` kreslí vektorovo cez pdf-lib. Preto NOVÝ serverový HTML
renderer `src/lib/server/narezak-html.ts`, ktorý **PDF ostáva REFERENCIA, HTML ho ZRKADLÍ** cez
zdieľané helpery (`renderBarSvg`, `profilPngB64`, `narezakSummary`, `renderQrSvg`) — dva renderery,
jeden zdroj geometrie. `narezak-pdf.ts` sa NEMENÍ.

- `cut_plan.render_html` = self-contained fragment `<div class="narezak">…</div>` s JEDNÝM inline
  `<style>` (systémové fonty, **bez `url()`/`@import`/`expression()`**). Sekcie v poradí PDF: hlavička
  (zákazka/OP/zákazník/dátum + inline QR `<svg>`), blok per profil, pásy tyčí, tabuľka rezov, súhrn.
  **ADITÍVNE, `version` ostáva `1`, VNÚTRI `cut_plan`** (žiadny nový top-level kľúč → 422 fallback
  #532 platí). Voliteľný (nad stropom sa vynechá).
- **Odškrtávacie značky (Odoo Shadow DOM):** `data-profile-kod="<kod>"` na bloku profilu, `data-bar-id="<bar_id>"`
  na páse tyče, `data-piece-id="<bar_id>:<seq>"` na segmente kusu — **id sú 1:1 s `cut_plan.bars[]`/
  `pieces[]`** (guard test `narezak-html.test.ts`: presne `bars.length` × `data-bar-id`, Σ pieces ×
  `data-piece-id`, hodnoty zhodné). `renderBarSvg` dostal voliteľný `opts.barId` → per-piece
  `data-piece-id`; **BEZ neho je výstup byte-identický** (kontrakt `render_svg` per bar do
  `montalu.rozpis.bar` ostáva 1:1).
- **Ikona:** `<img src="data:image/png;base64,…">` z `profilPngB64(kod)` **RAZ per kód** (prvý blok
  kódu s obrázkom); bez obrázka sa vynechá.
- **Allow-list sanitizer-safe** (odoo-erp `kiosk_html_sanitize.py`): **žiadny `<script>`/`on*`/
  `javascript:`/externé URL v `src`/`href`, žiadny `url(`/`@import`**; obrázky VÝHRADNE `data:image/png`
  a inline `<svg>`. Jediné `http(s)` je SVG `xmlns` namespace (nie `src`/`href`). Dynamický text ide cez
  `escapeHtml`. QR je inline `<svg>` (nie `data:`), prítomné len keď je OP.
- **Size-guard** (`renderNarezakHtmlCapped`, strop `NAREZAK_HTML_MAX_BYTES = 1 400 000` B, rezerva pod
  1,5 MB): > strop → render BEZ ikon (len kódy) + warn; stále nad → `render_html` sa **vynechá** (Odoo
  fallback na fázu B) + warn. `capBytes` param je testovací override.
- **Obaja volajúci** (`odoo-plan-rezov-upload.ts` + `backfill-narezaky.ts`) posielajú `meta`
  (zak/op/zákazník/dátum) do `buildCutPlan(material, kerf, meta)` → `render_html` sa naplní automaticky
  (typický fragment pre pár profilov ~12–20 KB; ikony sú raz per kód, takže reálny nárezák ostáva malý).

**KRITICKÁ PASCA (stálo ma to čas — runtime sonda):** `cut_plan` sa naplní **LEN pri zaskleniach**
(recompute nesie Money kódy ZASP…/BPP…). `spocitajPlanRezov` (CAD planner `/plan-rezov`) píše
`kod:''` (`plan-rezov.ts` „display-only") a backfill CAD moduly (pergola/fix/clip cez
`materialRowsFromRozpis`) tiež `kod:''` → tam sa `cut_plan` VŽDY vynechá (len `lines`+PDF idú). Preto
je overovacia cesta read-backom `montalu.rozpis.bar` **backfill zasklení**, nie /plan-rezov save.

**Overenie (montalu1 watcher):** po deploy backfill (`--days 30 --live`) → Odoo PROD read-back
`montalu.rozpis.bar` > 0 pre nahratú (zaskliavaciu) zákazku; tablet „Rezanie" ukáže tyč graficky.

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

## App POSIELA `lines` (rozpis rezov) spolu s PDF (#522, bolo #511 „neposiela")

Od #522 nesie to isté `montalu_narezak_upload` volanie AJ `lines` — z nich Odoo vytvorí
`montalu.rozpis.line` a tablet „Čo rezať" ich odškrtáva. Riadky sa odvodzujú z TOHO
ISTÉHO `PlanRezovVysledok` ako PDF (`buildRozpisLines`, `odoo-rozpis-lines.ts`) → jeden
zdroj pravdy, PDF a riadky sa nemôžu rozísť. Volanie teraz nesie
`order_number, doc_id, kind, filename, pdf_base64, lines`.

**Element `lines[]` (kontrakt odoo-erp #6517, model `montalu.rozpis.line`):**
`{ kod, nazov, mnozstvo, mj, dlzka, poznamka }`. Mapovanie z plánu rezov (jeden riadok =
jedna kombinácia profil × dĺžka rezu):
- `kod = ''` — plán rezov je Money-neutrálny (žiadne článkové kódy); identitu profilu nesie `nazov`.
- `nazov = profil.material.nazov` (presný názov profilu z CAD).
- `mnozstvo = rez.ks` (celý počet kusov danej dĺžky), `mj = 'ks'`.
- `dlzka = rez.rozmer / 1000` — **mm → m** (4500 mm → 4.5), 0.1 mm presnosť (`Math.round(mm*10)/10000`).
- `poznamka = ''` — plán rezov nedrží posuv/sekciu (plochá CAD tabuľka).
- Rezy dlhšie ako tyč (`tooLong`) sa do `lines` nedostanú — `spocitajPlanRezov` ich nezaradí
  do `material.rezy`, takže sa nemieša nerealizovateľný rez do „čo rezať".

**Money-neutralita (LEAK invariant preserved by CONTENT, nie omission):** `lines` nesú
LEN kód/názov/počet/dĺžku — ŽIADNU cenu. `buildRozpisLines` neimportuje `money`/`ceny`/
`zakazka-ceny` a nemá žiadny `€`/`fmtEur`/`cena` identifikátor — stráži to source-guard
`tests/odoo-rozpis-lines-money-safety.test.ts` (vzor `narezak-pdf` guardu nižšie).
Rozpis+ceny žijú ďalej LEN v internej `mt_note` (`odoo-zakazka.md`).

**Idempotencia:** `lines` sa posielajú pod tým istým `buildPlanRezovDocId(zak, op)` ako
PDF. Odoo pri každom uploade NAHRADÍ VŠETKY predchádzajúce `montalu.rozpis.line` na
objednávke (`rozpis_version` sa auto-inkrementuje) — re-export teda riadky prepíše,
nezduplikuje.

**Overenie na PROD (po deployi + prvom zápise):**
`GET /json/2/montalu.rozpis.line/search_read` s filtrom `[["order_id.name","=","<OP>"]]`
(bearer uid 524) → vráti vytvorené riadky (kod/nazov/mnozstvo/mj/dlzka/rozpis_version).
Na tablete Rezanie sa karta zákazky prepne z „materiál z objednávky" na riadky z appky.
Jeden úspešný zápis = uzavretie odoo-erp #6949. `lines` idú len keď je upload zapnutý
(`ODOO_NAREZ_UPLOAD_ENABLED=1` + `ODOO_JSON2_URL`/`_API_KEY`) a zákazka má LIVE OP z odpisu.

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
