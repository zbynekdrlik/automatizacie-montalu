---
paths:
  - "src/**"
---

# Splitting a `src/**` file approaching the 1000-line cap (#183)

The 1000-line cap governs **all of `src/**`** — server modules, `$lib/` helpers,
components AND routes (`+page.svelte`, `+page.server.ts`), not just
`src/lib/server/**`. Two split patterns below: **parameter injection** for a `.ts`
module, **step subcomponents** for a big `.svelte` page (#239).

`db.ts` was 986 lines (`migrate()` alone 679) — split into `db.ts` (connection +
query API, 209 lines) + a new `migracie.ts` (the migration/seed chain, ~790
lines). `compute.ts` was the next over the cap (1430 lines) and got the same
treatment in **#249** — see "Pure functions: a layered façade split" below for
that variant. A mechanical guard now enforces the cap: `tests/server-file-size-cap.test.ts`
walks every `src/lib/server/**/*.ts` and fails if any file exceeds 1000 lines
(the prose convention alone let `compute.ts` silently reach 1430). New server
modules are covered automatically by that walk — nothing to register per file.

## Watch-list — files at / over the cap (re-measure `wc -l` before acting)

| File | Lines | Status |
|---|---|---|
| `src/routes/zasklenia/+page.svelte` | ~1620 | over — split tracked #250 |
| `src/lib/server/compute.ts` | — | split DONE (#249 → 4 moduly + fasáda) |
| `src/lib/server/migracie.ts` | ~983 | AT CAP — každá nová migrácia extrahuj blok do migracie-seed (viď `migrations.md`) |
| `src/lib/pergola-narez.ts` | ~937 | approaching — split DONE raz (#155 fasáda), ďalší dotyk zváž ďalšiu extrakciu |
| `src/lib/components/vizual/Vizual3D.svelte` | ~722 | approaching |
| `src/lib/components/PergolaNarezVykres.svelte` | ~704 | approaching |
| `src/app.css` | ~869 | `@media print` split DONE (#376 stage 3 → `src/print.css`, import v `+layout.svelte` za app.css); ďalší rast (stage 4) → extrahuj `nav.*` do vlastného súboru importovaného v `+layout.svelte` |

No action until a ticket actually touches one; then reach for the matching pattern
below. Line counts drift — re-measure before deciding.

## Parameter injection, NOT a circular import (`.ts` modules)

The extracted module needs the ORIGINAL module's shared state (here: the
`db` instance + `hashPassword`). Two ways to give it that:

1. **(use this) Parameter injection.** The extracted function takes what it
   needs as ARGUMENTS: `migrate(db, hashPassword)`. The new module (`migracie.ts`)
   never imports from the original (`db.ts`) — zero circular dependency, in
   either direction. The original module still does the one-line call at
   module load (`migrate(db, hashPassword);`), at the EXACT SAME relative
   point in its own module-load sequence as before (after `db`/pragmas and
   `hashPassword`/`verifyPassword` are defined, before the query-API section).
2. **(don't use this) Circular import relying on ESM hoisting.** The extracted
   module imports `{ db }` from the original; the original imports the
   extracted function back. This technically WORKS in Node/Vite/Vitest (a
   function DECLARATION's export binding is live and available even mid-
   circular-import, due to hoisting), but it is non-obvious to a future
   reader and depends on evaluation-order guarantees that are easy to break
   with an innocent refactor (e.g. converting the shared value from a
   function declaration to a `const` arrow function silently breaks it).
   Parameter injection has none of this fragility — always prefer it.

## Verifying a pure move (zero behavior change)

The bar for a split like this is a BYTE-FOR-BYTE-EQUIVALENT-BEHAVIOR pure
move — no migration/business logic, SQL, or ordering may change. To prove
it (used successfully in #183's review):

```bash
git show <pre-refactor-sha>:src/lib/server/db.ts > /tmp/old.ts
# then normalize ONLY the mechanical parameter-injection renames
# (function migrate() -> function migrate(DB, HASHPW), etc.) in a copy,
# and diff against the new file — the diff should be EMPTY.
```

Also grep every consumer of the file you're splitting (`grep -rn "from
'.*server/db'" src/ tests/`) BEFORE moving anything, to confirm nothing
that's actually imported elsewhere is about to get silently dropped or
buried in the extracted module.

## Pure functions: a layered façade split (#249, `compute.ts` 1430 → 5 files)

`db.ts` needed **parameter injection** because the extracted code shared MODULE
STATE (the `db` instance). `compute.ts` was different: every function is **pure**
(cfg/rozmery as arguments, no module-level state), so there was nothing to inject —
the only job was to cut cohesive blocks and break cross-references so the import
graph stays **acyclic**. The result:

```
compute-model.ts   (LEAF: shared types + R/val/buildCFG/ffdPack/isFin/validSys/
                     inBounds/BOUNDS + sietkaExtraPocetKs + JE_RAMOVY/NOSOVY;
                     ZERO internal imports)
   ↑ compute-profily.ts → model      (profilCuts, oversize/undersize/missingHrubka, rail)
   ↑ compute-sietka.ts  → profily, model
   ↑ compute-odpis.ts   → sietka, profily, model   (computeFlat/Multi, safe*, PosuvSpec)
   ↑ compute.ts (FAÇADE) → explicit named re-export of the public API from all four
```

Key moves that made the DAG acyclic (the natural cycle is sieťka ↔ profily):
`profilCuts`/`undersizeCut` (profily) call `sietkaExtraPocetKs`, while
`sietkaSamostatnaVypocet` (sieťka) calls `oversizeCut`/`profilCuts` (profily). Pushing
the LEAF helpers `sietkaExtraPocetKs` + its regexes `JE_RAMOVY_PROFIL`/`JE_NOSOVY_PROFIL`
+ the validation core `validSys`/`inBounds`/`BOUNDS`/`isFin` DOWN into `compute-model.ts`
removes every back-edge — profily/sieťka then import only from model (and sieťka from profily,
one direction).

Two mechanical rules for THIS variant:

1. **Formerly-private helpers that siblings need must be `export`ed at module level**
   (`R`, `val`, `sietkaExtraPocetKs`, `ProfilCuts`, `profilCuts`, `mergeExtraCuts`, …) —
   exactly like #183 had to export `migrate()`. Keep them OUT of the façade's re-export
   list so `$lib/server/compute`'s public surface stays bit-identical (the façade re-exports
   only the originally-`export`ed symbols; consumers never import a submodule directly).
2. **The façade re-exports EXACTLY the original public API** via explicit
   `export { … } from './…'` / `export type { … } from './…'` (not `export *`, which would
   leak the helpers from rule 1 into the public surface). Adding `export ` to a signature can
   push it past prettier's 100-col width → `prettier --write` the new files (allowed: it's
   "reformatting prettier requires of moved text", not a logic change).

Verify identical to #183 (`git diff --color-moved=dimmed-zebra` = moves; a line-coverage
check that every original code line lands in exactly one module) PLUS the contractual proof:
`tests/compute.test.ts` (109 Money vectors) + the `zasklenia-posuvspec-golden` snapshot
unchanged and green.

## Splitting a large `.svelte` page — step subcomponents (#239)

A multi-step `.svelte` page splits by STEP, not by a shared-state extraction.
#239 split `src/routes/pergola/narez/+page.svelte` (1231 → 311 lines) into 5 step
components under `src/lib/components/pergola/` — `RezForm` (form step),
`RezVysledok` (result display), `RucnePolozky` (manual-items card, #234),
`RezNahlad` (cut preview), `RezHotovo` (done step) — a PURE structural move, zero
behavior change. The mechanics:

- **`+page.svelte` stays the state + compute HUB.** ALL `$state`, the `$effect`
  echo, and both serialization snippets stay in the parent — the round-trip
  serialization discipline is unchanged (see `pergola-narez.md`); each subcomponent
  just renders one step.
- **Pass parent state DOWN as `$bindable` props** (`RezForm` has 18× `$bindable`;
  `RucnePolozky` binds `rucneRiadky` and keeps its own local input state), and pass
  reusable `{#snippet}`s (`hidden` / `hiddenIdent`) as props rather than duplicating
  them per child.
- **Move shared component styles to the global stylesheet.** `table.narez` +
  `.badge.rucne` went to `app.css` (following the repo's `.badge.ok/.wait` pattern).
  A `.sec .badge` override copied into only ONE child silently dropped the badge on
  the others — put shared component CSS in `app.css`, not per-child (review 🟡, fixed
  in #239's own review, commit 2e6c285).
