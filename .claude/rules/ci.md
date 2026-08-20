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

## Mutation gate (`mutation.yml`, StrykerJS — #248)

Samostatný workflow **`.github/workflows/mutation.yml`** (ci.yml sa NEDOTÝKA), vlastný
`concurrency` group `mutation-${{ github.event_name }}-${{ github.ref }}`. Dvojvrstvový tvar
per airuleset `mutation-testing` (TypeScript = StrykerJS, config v `stryker.config.json`:
vitest-runner, `coverageAnalysis: perTest`, `mutate: src/lib/**/*.ts`, `thresholds.break: 50`,
`incremental`).

- **`mutation-diff`** — na KAŽDÝ `push` do `dev`. Diff-scoped: `git diff --name-only
  origin/main...HEAD` filtrovaný na `src/lib/**/*.ts` → `npx stryker run --incremental
  --mutate "<súbory>"`. **Tvrdý strop `timeout-minutes: 20`** — prekročenie je chyba SETUPU
  (zúž scope / sharduj), NIKDY nezvyšuj timeout (`no-timeout-band-aids`). **Prázdny diff =
  explicitný `exit 0`** (žiadne mutovateľné súbory nie je zlyhanie; kroky setup+stryker sú
  gated cez `steps.scope.outputs.changed != ''`, takže config-only push je rýchly no-op).
  Incremental report (`reports/stryker-incremental.json`) je cachovaný cez `actions/cache`.
- **`mutation-sweep`** — LEN `workflow_dispatch` (NIKDY cron — user vyvíja nonstop, cron by
  súperil o runnery). Full `npx stryker run --force || true`; job padne **len keď chýba
  `reports/mutation/mutation.json`** (zlyhal NÁSTROJ), NIE na nízkom skóre. Survivori
  (Survived + NoCoverage) → dávkový `test-quality` issue (idempotentne: hľadá otvorený issue
  s markerom `<!-- mutation-sweep-auto -->`, inak zakladá nový). Beží na GitHub-hosted
  runneri.

Gotchas:
- Diff base: `fetch-depth: 0` (dev história) + `git fetch origin
  +refs/heads/main:refs/remotes/origin/main` (main história) → `origin/main...HEAD` merge-base
  sa spočíta správne. Bez full fetchu main by three-dot diff nemal spoločného predka.
- `grep` bez zhody pod `bash -eo pipefail` vracia exit 1 → celý pipeline `... || true`, inak
  by prázdny diff KROK POKAZIL namiesto exit 0.
- StrykerJS beží NATÍVNE proti vitest suite; sandbox nie je git repo, takže
  `execSync('git rev-parse')` vo `vite.config.ts` padne do try/catch fallbacku `'dev'` — OK.
- `reports/` + `.stryker-tmp/` sú v `.gitignore` / `.prettierignore` / eslint-ignore.
- `--incremental false` NEEXISTUJE ako CLI flag (Stryker ho číta ako config-file argument);
  incremental sa vypína len v configu. Proof-run bez cache: vynechaj `--incremental`.
- **`allowEmpty: true` je POVINNÉ** (v `stryker.config.json`). Diff, ktorý zmení LEN súbor
  bez mutovateľného kódu (barrel `src/lib/index.ts`, čisto type-only súbor, len komentáre)
  → Stryker inak padne `ConfigError: No tests were executed` (exit 1) = falošné zlyhanie
  gate-u. `allowEmpty` to spraví exit 0 iba pre prázdny prípad; reálny netestovaný KÓD
  (mutanty bez pokrytia) stále padne cez `break 50`, takže gate nič nezakrýva.
- Vitest-runner default `vitest.related: true` nájde testy aj cez tranzitívny import
  (napr. `src/lib/b2b-limits.ts` testovaný cez server re-export) — netreba vypínať. WARN
  „Vitest failed to find test files related to mutated files" je OK pri 0-mutantovom súbore.
- Sweep dedup je cez presný `--label test-quality` + lokálny `jq` match na fixný titul
  (`startswith("Mutačný sweep")`), NIE cez GitHub free-text search pomlčkovaného markera
  (ten sa tokenizuje a môže minúť → duplicitný issue).
## Deploy rollback + post-deploy E2E (#254)

Deploy job už nerobí surové `docker compose up -d --build` bez návratu. Shell
logika je vyextrahovaná do `deploy/deploy-remote.sh` (beží NA VPS, volaná cez SSH),
aby bola testovateľná — pokrýva ju `tests/deploy-remote.test.ts` (vitest, mock
`docker`/`curl` na PATH, žiadna nová dep, padne keď sa rollback pokazí).

- **Rollback = natívny Docker image re-tag.** Compose služba `app` má stabilný
  `image: automatizacie-montalu:current`. Skript pred `up` odchytí ID bežiaceho
  image (`docker inspect --format '{{.Image}}' automatizacie-montalu`), `docker
  compose build` (otaguje `:current`) + durable `:<sha7>`, `up -d`, forward health
  poll (ok:true AND SHA7 vo verzii). Pri zlyhaní → re-tag odchyteného prev ID späť
  na `:current` + `up -d` + rollback poll (LEN liveness — starý build má iný SHA) →
  `exit 1` s `docker logs`. Prvý deploy (žiadny prev kontajner) sa nerollbackuje.

- **Rollback SA robí LEN pri zlyhaní HEALTH polla** (deploy reálne nenabehol).
  Zlyhanie post-deploy E2E po úspešnom health rollback NEVYVOLÁ — nová verzia je
  live a zdravá; E2E červená = ALARM (červený job), nie dôvod vrátiť zdravý build
  (rollback zdravého kvôli flaky tunelu by bol horší).

- **Post-deploy E2E = krok v deploy jobe** (NIE nový job — `tests/ci-docker-
  hardening.test.ts` tvrdí presne 3 joby). Po health OK: SSH tunel
  `-L 18091:127.0.0.1:8090`, `DEPLOY_SHA7=<sha7> BASE_URL=http://localhost:18091
  npx playwright test post-deploy.spec.ts` (`E2E_USER`/`E2E_PASS` zo secrets env
  `production`). `e2e/post-deploy.spec.ts` je BY CONSTRUCTION read-only (login +
  `[data-testid=version]`==SHA7 + navigácia, žiadny odpis) — nikdy sa nedotkne
  Money. Beží aj lokálne v `test` jobe proti preview (SHA kontrola sa preskočí,
  keď `DEPLOY_SHA7` nie je).

- **E2E secrets:** `E2E_USER`+`E2E_PASS` treba pridať do GitHub environment
  `production` (užívateľ/supervisor — agent secrets nepridáva). Kým chýbajú, krok
  ich zisťuje (`steps.e2e_secrets`) a preskočí sa s hlasným `::warning::` (NIE
  potlačenie chyby, NIE ticho zelený) — deploy tak nezlyhá na chýbajúcom secrete;
  health poll (ok+SHA7) je backstop verzie. Po pridaní secrets beží naostro.

### Gotchas pri úprave `deploy` jobu / pridaní post-deploy overenia (#254)

Tri mechanické guardy tvarujú, ako sa deploy job smie meniť — nezistíš ich, kým
ťa nezablokujú pri integrácii:

- **`tests/ci-docker-hardening.test.ts` tvrdí PRESNE 3 joby** (`deploy/test/
  version-check`). Post-deploy overenie preto MUSÍ byť KROK v `deploy` jobe, nie
  nový job (4. job rozbije `parser vidí všetky tri joby`). Guard tiež žiada
  `timeout-minutes` na KAŽDOM jobe a SHA-pin na KAŽDEJ `uses:` akcii.
- **`not.toMatch(/continue-on-error/)` matchne aj v KOMENTÁRI.** Nepíš doslovný
  reťazec „continue-on-error" ani do vysvetľujúceho YAML komentára — guard padne.
- **GitHub Actions: vlastný step-level `if:` dostane IMPLICITNE `success() &&`.**
  `if: steps.X.outcome == 'failure'` sa preto pri zlyhaní NIKDY nespustí (job je
  vo `failure` stave → `success()` false). Pre „nahraj artefakt keď krok zlyhal"
  píš `if: always() && steps.X.outcome == 'failure'`. Pre „spusti len po úspešnom
  predošlom kroku" naopak `success() && <podmienka>` (bez `success()` by vlastný
  `if:` bežal aj po zlyhanom deployi).

Pri pridávaní NOVÉHO deployment-gated E2E spec-u: `block-test-skips.sh` blokuje
doslovný `test.skip(` v PRIDANOM riadku test súboru pri push. Nový post-deploy
spec preto negatuj cez `test.skip(` — nechaj ho bežať vždy a SHA-kontrolu (verzia
z DOM == nasadený SHA) daj podmienenú na `process.env.DEPLOY_SHA7` (`if (SHA7) { … }`).
Lokálne (bez DEPLOY_SHA7) beží ako login+navigácia smoke proti preview.

Testovateľnosť deploy shellu: vyextrahuj logiku do `deploy/deploy-remote.sh`
(env-riadený) a pokry ju vitest-om cez `node:child_process` + mock `docker`/`curl`
na `PATH` (`tests/deploy-remote.test.ts`) — žiadna nová dep, padne keď sa rollback
pokazí.
