---
paths:
  - "src/lib/server/**"
---

# Splitting a `src/lib/server/**` file that's approaching the 1000-line cap (#183)

`db.ts` was 986 lines (`migrate()` alone 679) — split into `db.ts` (connection +
query API, 209 lines) + a new `migracie.ts` (the migration/seed chain, ~790
lines). `compute.ts` was the next over the cap (1430 lines) and got the same
treatment in **#249** — see "Pure functions: a layered façade split" below for
that variant. A mechanical guard now enforces the cap: `tests/server-file-size-cap.test.ts`
walks every `src/lib/server/**/*.ts` and fails if any file exceeds 1000 lines
(the prose convention alone let `compute.ts` silently reach 1430). New server
modules are covered automatically by that walk — nothing to register per file.

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
