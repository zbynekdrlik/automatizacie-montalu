---
paths:
  - "src/lib/fix.ts"
  - "src/lib/server/fix-vstup.ts"
  - "src/routes/fix/**"
---

# FIX (pevné zasklenie) — gotchas z #85 (rozpočítanie podľa posuvu)

## Computed/auto-filled field value < hardcoded HTML `min` = SILENT no-op submit

When a form field's value is **computed** (not typed by the operator) and the
computed value can legitimately be *smaller* than an existing `min="…"` on the
`<input>`, the browser's native constraint validation blocks submission with **zero
signal**: no console error, no network request, no `form-error` banner — the page
just re-renders the same form step, looking exactly like a hang. Playwright's own
`.click()` call succeeds (the click event fires), so the failure only surfaces later,
at whatever assertion checks for the NEXT page.

Hit this in #85: `rozpocitajPodlaPosuvu()` computes a Štandard edge field of 59 mm,
but the "Šírka poľa" `<input>` had a hardcoded `min="100"` — 41 mm below the
computed value. Diagnosed by listening for `page.on('request'/'response')` around
the submit click: a normal submit shows a `POST …?/vykres`; a silently-blocked one
shows **no POST at all**.

**Fix + standing rule:** never hardcode an HTML `min`/`max` literal that duplicates
a validation constant (`FIX_MIN`, `FIX_MAX`, …) — bind the attribute to the
constant (`min={FIX_MIN}`) so the two can never drift apart, and when adding a new
COMPUTED source for a field, sanity-check its extremes against the existing bound
BEFORE wiring up the UI, not after an e2e test times out.

## CAD/engineering sketches sent by the shop floor are often NOT to scale

Patrik's `Rozpočítanie.JPG` (#85) reused the identical pixel layout for Robust /
Slide / Štandard despite completely different real dimensions (106.6 / 82.5 / 59
mm) — same template, different numbers typed in. Pixel-measuring dimension-line
endpoints on this kind of image is unreliable (extension lines get shortened for
layout, text is authoritative, geometry drawn is not). Trust the **dimension text**
and the **plain-language description** ("pretiahnem stred priečky do fixu") over
pixel geometry; use pixel zoom only to confirm the drawing's *topology* (how many
mullions, where relative to each other), never absolute mm-per-pixel scale.

## Field-boundary-as-mullion-CENTER keeps the existing `sum(polia) === S` invariant

`rozpocitajPodlaPosuvu` places each field boundary at the posuv mullion's
**centerline** (not its edge) — so field widths still sum EXACTLY to `S`, same as
`rovnomernePolia`. The mullion's own physical width (`PRIECKA`) is informational
only (shown in the UI/print), never subtracted from any field — subtracting it
would have broken the invariant every other part of the FIX module (validation,
`pocitajFix`, the 2D drawing) already relies on. If a future "delenie" mode is
added, keep this invariant unless there is a genuine, confirmed reason to break it.
