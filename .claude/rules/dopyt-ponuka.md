---
paths:
  - "src/lib/ponuka.ts"
  - "src/lib/dopyt.ts"
  - "src/lib/server/ponuka-pdf.ts"
  - "src/lib/server/dopyt-action.ts"
  - "src/lib/server/dopyt-store.ts"
  - "src/lib/server/dopyt-throttle.ts"
  - "src/lib/server/dopyt-pdf.ts"
  - "src/lib/server/fonts/**"
  - "src/lib/components/DopytForm.svelte"
  - "src/routes/dopyty-konfigurator/**"
  - "tests/dopyt-*.test.ts"
  - "tests/ponuka*.test.ts"
---

# Verejný dopyt + PDF ponuka bez cien (#277)

Verejný zákaznícky lead tok: konfigurátor pergoly → kontaktný formulár → PDF
**špecifikácia BEZ CIEN** + uloženie dopytu. Marketingovo-lead vec, **NIKDY** sa
nedotýka Money/odpis cesty (guard `tests/dopyt-money-safety.test.ts`).

## Slovenský text v PDF — pdf-lib StandardFonts NEvie mäkčene

pdf-lib `StandardFonts` (Helvetica…) používa WinAnsi/CP1252, ktoré **nezakóduje**
č/š/ž/ď/ť/ň/ľ/ô — `drawText` na nich hádže. Preto embedujeme **vendorovaný Unicode
TTF** cez `@pdf-lib/fontkit`:

- Font = **DejaVu Sans** subset (`pyftsubset --unicodes="U+0020-007E,U+00A0-00FF,U+0100-017F,…,U+20AC" --no-hinting --desubroutinize`), base64 v `src/lib/server/fonts/dejavu.ts` (~32/27 KB → jeden `.ts` const string). Base64 v `.ts` = vždy zbundlované pod Vite SSR + adapter-node, žiadna runtime fs/asset závislosť (rovnaká disciplína ako client-ip.ts). Regeneračný príkaz je v hlavičke `dejavu.ts`.
- `doc.registerFontkit(fontkit)` PRED `doc.embedFont(Buffer.from(B64,'base64'), { subset: true })`.
- **Base64 font blob spustí `block-sensitive-staging.sh`** (40+ char blob = „possible key"). False positive — commituj s `# airuleset:secret-ok <dôvod>` na PRÍKAZE (logované). A **body/commit súbor píš vo VLASTNOM Bash volaní**, nie zreťazený s `git commit -F` — ak hook blokne compound príkaz, `cat > file` sa nevykoná.

## PDF sa testuje cez METADÁTA, nie cez text

Custom-font glyfy sa z PDF obsahu **nedajú spoľahlivo prečítať** (CID/glyph indexy).
Preto `generatePonukaPdf` zapisuje súhrn hodnôt SÚČASNE do metadát (`setTitle`/
`setSubject`/`setKeywords`) — a test číta späť cez `PDFDocument.load(bytes).getSubject()`
atď. **`setProducer` NEFUNGUJE** — pdf-lib ho pri `save()` prepíše svojím podpisom;
marker („bez cien") daj do Keywords/Title/Subject. Invariant NULA cien = scan metadát
regexom na `€|EUR|cena|price`.

## Integračný kontrakt pre verejnú route (#275 ju napojí)

Táto lane route **needituje** — verejná route ju iba naimportuje:

```ts
// src/routes/<verejná>/+page.server.ts
import { dopytAction } from '$lib/server/dopyt-action';
export const actions = { dopyt: dopytAction };
```

- `DopytForm.svelte` props: `konfiguracia: PonukaConfig` (povinné), `renderPngBase64?` (voliteľné, 3D render dodá neskôr samostatný tiket), `action?` (default `?/dopyt`). Formulár submitne skryté `konfiguracia` JSON + `renderPng` + honeypot pole `firma_web`.
- Akcia vráti `{ success, pdfBase64, filename }` (download-first) alebo `fail(400/429/500)`. Komponent dekóduje base64 → Blob → stiahnutie.
- Anti-spam: honeypot (`jeSpam`) → ticho úspech bez uloženia; per-IP `allowDopyt` (in-memory Map, vzor login-throttle); klientska IP cez `resolveClientIp` (CF-aware, reuse `client-ip.ts`).

## Rozdelenie súborov

`ponuka.ts`/`dopyt.ts` sú **pure** (typy + validácia + súhrn, žiadny server import — ani
`server/db`); server logika je v `ponuka-pdf.ts`/`dopyt-store.ts`/`dopyt-throttle.ts`/
`dopyt-action.ts`. `dopyt-store.ts` SMIE importovať `./db` (len pripojenie), ale nič z
Money. E-mailové doručenie = neskôr cez Odoo (samostatný tiket); teraz iba download-first.

## Interný prehľad dopytov `/dopyty-konfigurator` (#282)

Interná AUTH-gated read-only route (zoznam najnovšie hore + stránkovanie 50/str. +
re-download PDF). Tri veci, ktoré sa oplatí vedieť pri ďalšej práci:

- **PDF z GET endpointu — `Uint8Array` sa v aktuálnom TS lib NEPRIJME priamo ako `BodyInit`.**
  `generatePonukaPdf`/`regeneratePonukaPdf` vracajú `Uint8Array<ArrayBufferLike>` (buffer môže
  byť `SharedArrayBuffer`), takže `new Response(bytes)` aj `new Blob([bytes])` padnú na
  `svelte-check` (`not assignable to BodyInit`/`BlobPart`). Fix: **kópia do čerstvého
  `new Uint8Array(pdf.bytes)`** (konkrétny `ArrayBuffer` backing) — `new Response(new
  Uint8Array(pdf.bytes), { headers: { 'content-type':'application/pdf', 'content-disposition':
  'attachment; filename="…"' } })`. Rovnaké platí pre akýkoľvek budúci binárny download endpoint.
- **Re-download PDF = deterministická regenerácia z uloženej konfigurácie** (`dopyt-pdf.ts`
  `regeneratePonukaPdf(id)`: `getDopyt` → `sanitizePonukaConfig` → `generatePonukaPdf`;
  `null` = neexistujúce id → volajúci `error(404)`). Pätička nesie PÔVODNÝ dátum vzniku dopytu
  (`sqliteUtcToIso(created_at)` — UTC pasca, viď `timestamps.md`), nie „dnes". `dopyt-pdf.ts`
  matchuje `/dopyt/`, takže je auto-krytý `dopyt-money-safety` guardom (žiadny Money import).
- **Stĺpec „Odoo lead" = feature-detect na SCHÉME, nie na kľúčoch dát.** `hasOdooLeadColumn()`
  (`PRAGMA table_info(dopyt)`) — `odoo_lead_id` pridá až #278 (migrácia v26); tu ho NEPRIDÁVAJ.
  `listDopyty` podľa toho zloží SELECT (stĺpec sa nesie na riadku len keď existuje). Detekcia na
  schéme funguje aj pri prázdnom zozname (na `Object.keys(row)` by pri 0 riadkoch zmizol).
  AUTH: route je mimo `PUBLIC_PATHS` (anon → login) + v `B2B_FORBIDDEN_PREFIXES` (prefix kryje
  aj `/dopyty-konfigurator/pdf`); GET endpoint má NAVYŠE `isInternal(locals.user)` guard.
