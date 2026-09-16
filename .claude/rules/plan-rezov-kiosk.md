---
paths:
  - "src/lib/server/odoo-plan-rezov-upload.ts"
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
- `src/hooks.server.ts` — odpis hook volá UŽ LEN `queueZakazkaPush` (interná note), NIE
  narezak upload.

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

Intake `montalu_narezak_upload` je **LENIENT** (`**extra` top-level IGNORUJE neznáme kľúče), takže
`cut_plan` sa posiela bezpečne popri `lines` + PDF (tie OSTÁVAJÚ nezmenené). `cut_plan` NAHRADIL
#529 v2 (`narezak_v2` za flagom) — ide **VŽDY** (bez flagu), keď nárezák má tyče s Money kódom.

`buildCutPlan(MaterialRow[])` → `{ version:1, bars:[…] }` alebo **`undefined`** keď žiadna tyč nemá
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
