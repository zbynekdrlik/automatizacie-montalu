---
paths:
  - "src/routes/pergola/+page.server.ts"
  - "src/routes/zasklenia/+page.server.ts"
  - "src/routes/bazen/+page.server.ts"
  - "src/lib/server/vstup.ts"
  - "tests/odpis-detail-vstup-raw.test.ts"
---

# `odpis_log.detail` — bound every new field, and the FormData `\r\n` test gotcha

## Bound every new field going into `detail`

`detail` is a schema-less JSON TEXT column (`src/lib/server/db.ts`) — nothing stops a
new field from growing without limit. Existing text fields are already bounded:
`poznamka` 300 chars, `skloPresne` 120, `ral` 40 (`src/lib/server/vstup.ts`), pergola's
`cad` (raw CAD paste) 20 000 chars (`CAD_DETAIL_MAX` in
`src/routes/pergola/+page.server.ts`, #156 review nález). When adding a new text field
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
