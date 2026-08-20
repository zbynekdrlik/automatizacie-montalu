---
paths:
  - ".github/workflows/*.yml"
---

# CI workflow gotchas

## A run can get stuck as a "zombie" — GitHub sometimes never allocates a runner

Symptom seen on `main` after PR #117 (0.14.4, #118): `test` completed
successfully, but `deploy` waited 15 min with `runner_name` empty, then GitHub
auto-cancelled it. The run's TOP-LEVEL status then stayed inconsistent —
`status: queued`, `conclusion: null` — even though every individual job shows
`completed`:

```bash
gh run view <id> --json status,conclusion,jobs
# status: "queued", conclusion: null, jobs: []  ← API/CLI see nothing, even
# though the run genuinely executed and finished
```

Both the standard recovery commands refuse it:

```bash
gh run cancel <id>   # → "Cannot cancel a workflow run that is completed"
gh run rerun  <id>   # → "run <id> cannot be rerun; its workflow file may be broken"
```

The workflow file is fine — it's not corrupt, this is a GitHub-side
run-bookkeeping glitch, not something in our config. Don't waste time
diagnosing the workflow YAML when you see this shape; it isn't the cause.

## The fix already shipped: `workflow_dispatch`

`ci.yml`'s `on:` block includes `workflow_dispatch:` (added by #118, PR #119)
specifically so a stuck/zombie run never blocks a deploy again. To retry CI on
an existing branch WITHOUT an artificial commit:

```bash
gh workflow run ci.yml --ref main   # or --ref dev
# poll:
gh run list -R zbynekdrlik/automatizacie-montalu --branch main --limit 1 \
  --json databaseId,status,conclusion
```

`github.ref` resolves identically for `workflow_dispatch` as for `push` — the
existing job `if:` guards (`version-check` only on `dev`, `deploy` only on
`main`, `needs: test`) behave exactly the same, no gate is weakened by this
trigger.

## Variant: a single CHECK-RUN gets stuck, even though the WORKFLOW RUN itself completed fine

Seen on `dev` (#146, `perpOffset` fix commit): `gh run view <id>` reported
`status: completed, conclusion: success` and `gh run view --job=<id>` showed
every step of `version-check` with a ✓ (including "Complete job") — yet `gh
pr checks` and the raw Checks API kept reporting that SAME job as
`IN_PROGRESS` with `completed_at: null` for 10+ minutes, keeping the PR's
`mergeStateStatus` stuck at `UNSTABLE`:

```bash
gh api repos/<owner>/<repo>/commits/<sha>/check-runs \
  --jq '.check_runs[] | {name, status, conclusion, completed_at}'
# {"name":"version-check","status":"in_progress","conclusion":null,"completed_at":null}
# ← genuinely stuck, not a `gh` CLI cache artifact (confirmed via the raw API)
```

This is the SAME class of GitHub-side bookkeeping glitch as the whole-run
zombie above, just on one check-run's object instead of the run's own
top-level status. Same fix, same command: `gh workflow run ci.yml --ref dev`
(or `--ref main`) gets a fresh run whose check-runs all report `completed`
cleanly — confirmed via the check-runs API, not just `gh run view`, since
that's the endpoint branch-protection actually reads for mergeability.

## Always verify the deploy actually landed — don't trust "CI green" alone

`main` CI green does not by itself prove the live app updated (the zombie run
above WAS `test: success` with `deploy` never running). After any `main`
merge, confirm the live version matches the merge SHA:

```bash
curl -s https://app.montalu.cloud/health   # {"ok":true,"version":"<X.Y.Z> (<sha7>)"}
```

If it doesn't match the merge commit's short SHA within a few minutes, use
`gh workflow run ci.yml --ref main` above instead of guessing or force-pushing
a dummy commit.

## If a `-dev.N` string EVER lands on `main` (skipped clean-version bump before merge), do NOT bump dev back to the same clean digits — bump the NEXT number instead

`version-check`'s comparison is `sort -V`, which is **not semver-aware**: it
does not know a `-dev.N` suffix means "pre-release, lower than the release" —
empirically it ranks the SUFFIXED string as the "greater" one whenever the
numeric prefix is otherwise equal:

```bash
printf '%s\n%s\n' "0.14.32-dev.1" "0.14.32" | sort -V
# 0.14.32
# 0.14.32-dev.1        ← ranked LAST = "highest" by sort -V
```

This is fine in the NORMAL flow (dev's numeric prefix is always one bump
AHEAD of main's, so the suffix never has to arbitrate). But if `main` ever
accidentally receives a `-dev.N` string (the clean-bump-before-PR step in
`CLAUDE.md`'s `## Version` got skipped — #153 incident: PR merged with dev
still at `0.14.32-dev.1`), the natural-looking fix — bump dev back to the
SAME clean `X.Y.Z` main already has the `-dev.N` form of — **fails
`version-check`**, because `sort -V` still ranks main's `-dev.N` string above
dev's now-identical-prefix clean one. The fix is to bump dev to the **NEXT**
number (`0.14.33`, not `0.14.32`) — treat the digits main accidentally
carries as "spent", exactly like any other released version, even though
that release never actually shipped cleanly.

## `playwright install --with-deps` can HANG for tens of minutes on a degraded apt mirror

Seen 2026-08-18 (#155): the `test` job's `npx playwright install --with-deps chromium`
step hung on `apt-get` (the `--with-deps` system-library install) for 30–48 min across
multiple runs, while a run ~1 h earlier did it in minutes. The `updatedAt` freezes at the
step start (no heartbeat) — that's the tell it is genuinely stuck, not slow. Browser
caching (`~/.cache/ms-playwright`) does NOT help — the hang is the apt step, not the
browser download. Fixes now IN `ci.yml`:

- **`timeout-minutes: 25` on the `test` job** — a job without it hangs the GitHub default
  6 h and blocks merge; this fails-fast instead.
- **Resilient install:** `timeout 360 npx playwright install --with-deps chromium || npx
  playwright install chromium` — bounds the `--with-deps` apt attempt to 6 min, then falls
  back to the browser-only install (system libs are preinstalled on `ubuntu-latest`), so a
  hung apt mirror never blocks the run.
- **Browser cache** (`actions/cache` on `~/.cache/ms-playwright`, keyed on `package-lock.json`)
  — speeds the download on cache-hits (does not fix the apt hang, but reduces total time).

Recovery when a run is hung on this: `gh run cancel <id>`, then push a fresh commit (a
cancelled run's rerun keeps landing on the same degraded condition; a NEW commit gets a
fresh runner). The `timeout-minutes` net means you no longer have to babysit a 6 h zombie.

## Hardening (#244): SHA-pinned actions, blocking prod-audit gate, structural guard test

**Every `uses:` action is pinned to a 40-char commit SHA** (not a floating `@v4`) with a
`# vX.Y.Z` comment. To BUMP an action, don't revert to a tag — resolve the new SHA:

```bash
gh api repos/actions/checkout/git/ref/tags/v4 --jq '.object.sha'   # the commit @v4 points at
gh api "repos/actions/checkout/tags?per_page=100" --jq '.[] | select(.commit.sha=="<sha>") | .name'  # its semver
```

then update BOTH the SHA and the `# vX.Y.Z` comment. NOTE: the airuleset secret-scan hook
flags a 40-hex blob as a "possible secret" — a public action SHA is not one, bypass the
`git add`/`git commit` with an inline `# airuleset:secret-ok <reason>` shell comment.

**Blocking prod-dependency audit** in the `test` job: `npm audit --omit=dev --audit-level=high`
(after `npm ci`, before lint). `--omit=dev` ignores dev-only advisories (they never enter the
image). Prod advisories are patched via **`overrides` in `package.json`**, NOT `npm audit fix
--force` — the `--force` path DOWNGRADES `exceljs` to 3.4.0 (breaking = behavioral change to
the odpis Excel output). On a NEW high advisory: find the patched version, add a minimal
`overrides` entry (version-selective key like `brace-expansion@1` keeps majors aligned; forcing
`uuid@11` onto exceljs is safe — exceljs calls only `v4()`), then verify `npm ci` + `npm audit
--omit=dev` = 0 + `npm test`.

**Structural guard** `tests/ci-docker-hardening.test.ts` (vitest, no yaml dep — simple parse)
FAILS if any job loses `timeout-minutes`, an action un-pins, `continue-on-error` appears, or
`deploy/docker-compose.yml` loses its `logging`/`healthcheck`. Keep it green when editing the
pipeline; it's the regression net for all of the above.

**Compose healthcheck has NO curl** — runtime image `node:24-*-slim` lacks curl, so the
healthcheck is `node -e "fetch('http://127.0.0.1:3000/health')..."` on the IN-CONTAINER port
3000 (host 8090→3000 is only the VPS deploy poll). `/health` returns `{ok: sysCount>0}`.
