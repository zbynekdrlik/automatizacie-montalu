---
paths:
  - 'package.json'
  - '.github/workflows/ci.yml'
---

# Version bumping — tab-preserving edit + the `-dev`-on-`main` recovery (#161/#98/#174)

The 3-line every-ticket rule (bump to the next `-dev.N` first; clean `X.Y.Z` before the
PR; `Read` `package.json` before opening the PR) lives in `CLAUDE.md`. This rule carries
the bump MECHANICS and the recovery narrative, and auto-loads whenever you touch
`package.json` or the CI workflow.

## Bump via a TARGETED edit of the `"version"` line

**Bump via a TARGETED edit of the `"version"` line (preserve the file's TABS) — never
`node -e 'JSON.stringify(p,null,2)'`.** `JSON.stringify` re-indents `package.json` to
2 SPACES, which fails `prettier --check` (this repo's `.prettierrc` = tabs) and costs a
lint round (#161, 2026-08-14). If you did reformat it, run `prettier --write package.json`
before committing.

## The convention, and why `sort -V` compares correctly

**Convention: `dev` carries `X.Y.Z-dev.N`, `main` carries the clean `X.Y.Z`.** The
FIRST commit on `dev` after a merge bumps to the next `-dev.1`; right before opening the
PR to `main`, bump again to the clean released version (no `-dev` suffix). A `-dev`
string ending up on `main` is a real bug, not cosmetic — it happened three times
(#1/#101/#174) and was fixed in #98 (which also taught `sort -V` to rank `X-dev.N`
above the clean `X`, so the CI version-check compares correctly either way).

## Recovery — a `-dev.N` already landed on `main`

**If this IS missed and a `-dev.N` string lands on `main`: the recovery is a NEW patch
bump, never retrying the SAME clean version number.** The `sort -V` "rank `X-dev.N`
above bare `X`" fix (#98) only holds when the clean bump happens BEFORE the merge — it
assumes `main` never itself carries an `X-dev.N` string. Once it does (the mistake
above), bumping `dev` to the SAME clean `X.Y.Z` FAILS `version-check`: `sort -V` now
compares `dev="X.Y.Z"` against `main="X.Y.Z-dev.N"` at the SAME patch number, and ranks
main's dev-suffixed string higher — the exact #98 rule working against you. Bump to
`X.Y.(Z+1)` instead (a real patch increment always wins regardless of any suffix); this
happened live in #174 (`0.16.5-dev.1` on `main` → retrying `0.16.5` on `dev` failed CI →
`0.16.6` fixed it, verified against `sort -V` directly before pushing).
