---
paths:
  - "src/lib/fix.ts"
  - "src/lib/server/fix-vstup.ts"
  - "src/lib/server/fix-cad.ts"
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

## `n=2` is a SPECIAL CASE that does NOT follow the general "posuv" pattern — verify low-n edge cases with the source, don't extrapolate

PR #112 shipped `rozpocitajPodlaPosuvu`'s `n===2` branch as an educated GUESS
(`[KRAJNY, S−KRAJNY]`, asymmetric offset from the left edge only) because the
drawing only showed the `n=3` case and an offset from BOTH edges can't work in
general (`2×KRAJNY === S` only holds for the one example width). Patrik later
corrected it (#85 follow-up, Odoo 207 msg #1618564): **at n=2 the split is
ALWAYS exactly 50/50, independent of system, independent of whether a posuv
even sits above the fix** — `KRAJNY`/`PRIECKA` do not apply at all at n=2. The
general "mullion center = field boundary" pattern that holds for n=3 and n≥4
does NOT extrapolate down to n=2 (there's no meaningful "mullion" for a single
dividing line splitting a fix in half). **Lesson: when a physical/geometric
rule is confirmed for one arity (n=3) and extrapolated to a DIFFERENT arity
(n=2, n≥4) without an explicit worked example, treat every extrapolated case as
an OPEN ASSUMPTION until the domain expert confirms it with a concrete number —
never assume the general pattern holds at the boundary.** n≥4 turned out to
match the general pattern (verified: Štandard S=3000 n=6 → `[59, 720.5, 720.5,
720.5, 720.5, 59]`); n=2 did not. Both had to be checked independently — one
confirmed as-is, the other required a real code fix.

## FIX má DVA režimy (#380) — „Fix z appky" (výkres, Money-clean) + „Fix z cadu" (Money odpis)

Od #380 má FIX modul prepínač `FixModeNav.svelte` (vzor `PergolaModeNav`, ale 2 karty):

- **„Fix z appky" = `/fix`** (`+page.svelte`/`+page.server.ts` + `fix-vstup.ts` + `$lib/fix.ts`) —
  dnešný formulár rozmery → výkres konštrukcie. **Do Money NEJDE nič** (kresliaci režim). Ostáva
  Money-clean — guard `tests/fix-money-safety.test.ts` (fix.ts + FixVykres2D nesmú importovať
  `server/fix-cad`/`server/money`/`server/pergola`).
- **„Fix z cadu" = `/fix/cad`** (`+page.server.ts` + `src/lib/server/fix-cad.ts`) — NOVÝ režim:
  CAD nárez → Money odpis. **Od #393 je Money-write tok ZDIEĽANÝ v `src/lib/server/cad-odpis.ts`**
  (spolu s pergola CAD /pergola) — reuse pergola CAD2DLV enginu (`$lib/server/pergola`:
  `transform`/`CATALOG`/`validatePergola`/`applyCombos`/`buildCopyBack`), NIE vlastný engine/katalóg.
  `fix-cad.ts` je už len TENKÝ FIX **adaptér**: drží `FIX_CAD_OPTS` (`modul='fix'`, `cakaSubdir='Fix'`,
  popis prefix „FIX ") + `buildFixCadJob` wrapper pre unit test; route naň deleguje cez
  `cadSpocitat`/`cadUpravit`/`cadOdoslat`. Detaily zdieľaného toku → `.claude/rules/odpis-detail.md`.
  Nenamapovaný CAD kód = TVRDÁ chyba (nikdy tichý odpis).

**OTVORENÁ OTÁZKA (gated na vzorku):** FIX formulár používa Cortizo COR-60 CE profily BEZ Money
kariet (overené 2026-07-27). Či reálny FIX CAD zo Solid Edge používa tie isté kódy alebo zdieľa
pergola artikle, sa BEZ reálnej FIX CAD vzorky od Dominika nedá potvrdiť. Mechanizmus je honest
(nenamapovaný kód → chyba). Doplnenie FIX-špecifického katalógu/CODE_MAP = follow-up so vzorkou;
NEHÁDAŤ kódy (Money-safety).

## Cross-modul identický-obsah dedup guard (#380) — POVINNÝ pri reuse cudzieho katalógu

`writeOdpis` dedup aj #294 ledger sú kľúčované na `(modul, zak, op, live)`. Keď JEDEN modul REUSUJE
katalóg INÉHO (FIX reusuje pergola PRP katalóg), identický CAD nárez dá IDENTICKÝ `content_hash` (a
teda aj názov súboru) pod OBOMA modulmi → operátor by obišiel dvojitý-import poistku presunom
identického nárezu z /pergola (Duplikát) do /fix/cad → dvojitý odpis rovnakého materiálu + prepis
súboru v `dlv-import`. Preto `writeOdpis` má **cross-modul precheck** `WHERE live=? AND zak_norm=?
AND op_norm=? AND content_hash=? AND modul != ?` → identický obsah pod iným modulom = `duplicate`.
Blokuje LEN identický obsah; RÔZNY obsah (pergola konštrukcia + fix zasklenie „do boku" na tej
istej ZAK+OP) má rôzny hash → legitímne koexistuje (paralela `money-readback.md`: viac modulov na
jednej zákazke je normálne). Reálne moduly majú rôzne katalógy → guard fíruje len fix↔pergola.
**Ak pridáš ďalší modul reusujúci cudzí katalóg, tento guard ho už pokrýva — nespoliehaj sa na
per-modul dedup samotný.**

## `$lib/modul-nazov.ts` — /odpisy label MUSÍ pokrývať KAŽDÝ `Modul` (#380)

`/odpisy` (história/detail/zákazka) predtým zobrazovali modul cez ternár `… : 'Pergola'` (fallback),
takže fix AJ clip sa tvárili ako „Pergola". Od #380 je jeden client-safe `modulNazov` (`$lib/modul-nazov.ts`,
`Record<string,string>`). Pri pridaní nového modulu do `Modul` únie (`money.ts`) DOPLŇ ho aj sem
(neznámy → surový kód `?? m`, čestný fallback).
