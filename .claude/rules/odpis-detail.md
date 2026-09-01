---
paths:
  - "src/routes/pergola/+page.server.ts"
  - "src/routes/fix/cad/+page.server.ts"
  - "src/routes/zasklenia/+page.server.ts"
  - "src/routes/bazen/+page.server.ts"
  - "src/lib/server/cad-odpis.ts"
  - "src/lib/server/fix-cad.ts"
  - "src/lib/server/vstup.ts"
  - "tests/odpis-detail-vstup-raw.test.ts"
---

# `odpis_log.detail` — bound every new field, and the FormData `\r\n` test gotcha

## Bound every new field going into `detail`

`detail` is a schema-less JSON TEXT column (`src/lib/server/db.ts`) — nothing stops a
new field from growing without limit. Existing text fields are already bounded:
`poznamka` 300 chars, `skloPresne` 120, `ral` 40 (`src/lib/server/vstup.ts`), the CAD
`cad` (raw CAD paste) 20 000 chars (`CAD_DETAIL_MAX` in `src/lib/server/cad-odpis.ts`
since #393 — bolo v `src/routes/pergola/+page.server.ts`, #156 review nález). When adding a new text field
to any module's `detail` — do NOT assume "it's just logging so no cap is needed". Slice
it, matching the existing pattern, even if realistic input is far smaller (the cap is
against a pathological paste, not normal usage).

## Test gotcha: `FormData`/`Request` round-trip normalizes `\n` → `\r\n`

Node's `undici` `FormData`/`Request` (used by every `actions.odoslat*` test in this
repo, e.g. `zasklenia-detail-sklo.test.ts`, `odpis-detail-vstup-raw.test.ts`) serializes
a text field's value as multipart/form-data on `new Request(..., {body: someFormData})`
— and that serialization turns bare `\n` into `\r\n`, exactly like a real browser
`<textarea>` multipart POST. `request.formData()` on the receiving end does NOT
normalize it back.

**Consequence for tests:** if you build a large multi-line string fixture in JS with
`.join('\n')` and then compare it byte-for-byte against what the server action actually
received/stored, the comparison silently drifts by one character per line (`\n` vs
`\r\n`) — the diff looks like every line differs even though the content is identical.
Build the fixture with `.join('\r\n')` from the start so it matches what really flows
through the test harness (and matches production browser behavior).

**Consequence for production code:** none — `parseCad()` (`src/lib/server/pergola.ts`)
already strips `\r` per line while parsing (`raw.replace('\r', '')`), and `parseVstup`'s
`poznamka` field already does `.replace(/\r\n/g, '\n')` for the same reason. Any NEW
multi-line text field parsed from a form should do the same normalization if it will be
split/compared line-by-line.

## CAD→Money odpis tok je ZDIEĽANÝ v `cad-odpis.ts` (#393) — pergola CAD aj FIX z cadu

Pergola CAD (`/pergola`) aj FIX z cadu (`/fix/cad`) používajú JEDEN module-agnostic tok
`src/lib/server/cad-odpis.ts`: `cadOdpisView(vstup, form)` (náhľad, reuse pergola enginu),
`buildCadJob(vstup, v, createdBy, opts)`, a zdieľané akčné telá `cadSpocitat`/`cadUpravit`/
`cadOdoslat(form, user, opts)`. Obe routy sú TENKÉ — 3-riadkový `actions` delegujúci naň +
`satisfies Actions` (typ ostáva per-route → nulové type-riziko). Modulovo-špecifické sa
vstrekuje cez `opts` = presne 4 veci: `modul` / `cakaSubdir` / `popisPrefix` / `logName`.
Pergola drží svoje `PERGOLA_OPTS` inline v route; FIX identitu (`FIX_CAD_OPTS`: modul='fix',
popis „FIX ") drží tenký adaptér `src/lib/server/fix-cad.ts` (má tam `buildFixCadJob`
wrapper pre unit test). **Pri pridaní ĎALŠIEHO CAD→Money modulu:** neduplikuj route glue —
pridaj `<MODUL>_OPTS: CadActionOpts` a deleguj na `cadSpocitat`/`cadUpravit`/`cadOdoslat`.

**Identitu odpisu (`modul`/`cakaSubdir`/`popisPrefix`) STRÁŽ testom — inak sa copy-paste
slip v OPTS neodhalí:**
- `modul` — cez `listOdpisy(...).find(...).modul` (row má stĺpec `modul`).
- `popis` — NIE je v `listOdpisy` výstupe; žije LEN v xlsx. Čítaj späť cez ExcelJS z
  `outcome.target`: `ws.getRow(2).values.slice(1)[5]` (6. stĺpec „Popis dokladu",
  worksheet `'Hárok2'`) — vzor `tests/fix-cad.test.ts` (pergola popis guard) + `money.test.ts`.
- `cakaSubdir` — **NIE je v TEST režime pozorovateľný**: `targetDirFor(cakaSubdir, caka)`
  (`money.ts`) vracia flat `testDir()` keď `!isLive()`, takže podpriečinok sa v teste
  neuplatní. Testuj ho cez JOB objekt (`buildXCadJob(...).cakaSubdir`), nie cez cestu súboru.

**Source-text money-safety guardy pri presune kódu (#380/#393):** keď zdieľaný Money-most
vznikne/presunie sa, guard musí strážiť NOVÉ miesto — `cad-odpis.ts` stráži money+pergola
import, `fix-cad.ts` FIX identitu (`modul:` + `'fix'` SAMOSTATNÉ matche kvôli Stryker, viď
`testing.md`), a pure vzorcové enginy (pergola-narez `CISTY_ENGINE`) dostanú `server/cad-odpis`
do `ZAKAZANE_VZORY` (nový Money most = zakázaný import pre display engine).
