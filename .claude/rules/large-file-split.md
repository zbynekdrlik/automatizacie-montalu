---
paths:
  - "src/lib/server/**"
---

# Splitting a `src/lib/server/**` file that's approaching the 1000-line cap (#183)

`db.ts` was 986 lines (`migrate()` alone 679) — split into `db.ts` (connection +
query API, 209 lines) + a new `migracie.ts` (the migration/seed chain, ~790
lines). `compute.ts` is currently the next candidate over the cap (1346 lines,
found during #183's own review) — not split yet, no action needed until a
ticket actually touches it, but the pattern below is the one to reach for.

## Parameter injection, NOT a circular import

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
