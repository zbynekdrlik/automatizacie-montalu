---
paths:
  - 'tests/**'
  - 'e2e/**'
  - 'playwright.config.ts'
  - 'vite.config.ts'
---

# Testing (unit + E2E) — local run gotchas

## E2E: ALWAYS use `goto(page, '/path')` from `e2e/helpers.ts`, NEVER bare `page.goto('/path')` (#482)

Every `page.goto()` in an E2E spec MUST go through the `goto(page, path)` helper from
`e2e/helpers.ts` — it calls `waitHydrated()` after navigation. Bare `page.goto()` skips
the hydration wait. In CI (local preview build, fast loopback) this never matters — JS
loads instantly. Over a slow SSH tunnel (post-deploy E2E against `BASE_URL`), the JS
bundle arrives late, and without `waitHydrated()`:
- `use:enhance` is NOT yet attached → form submits do a full POST → full-page reload
  resets local `$state` → `vysledok`/`chyba` testids never appear.
- Svelte `bind:value` wipes filled inputs back to their initial `$state` default.

This caused 3 of 4 plan-rezov E2E tests to fail ONLY against live prod (CI run
34124362550). The fix was importing `goto` from helpers and replacing all bare
`page.goto()` calls. The pattern is `loginAs(page)` (which already uses the helper
internally) followed by `goto(page, '/target-route')` — never `page.goto('/...')`.

## User-facing label rename MUST update `e2e/` in the SAME commit — local gates never catch it (#468)

A rename of user-facing text (button/badge/error-message labels) that only touches
`src/` + `tests/*.test.ts` compiles clean and passes `npm run check`/`npm test` locally
— `e2e/**/*.spec.ts` locators/assertions on the OLD label are invisible to every local
gate, because E2E runs ONLY in CI (`npm run lint`/`npm run check`/vitest never touch
`e2e/`). Incident: #468's "posuv" → "zasklenie" rename shipped two dev commits (label
rename + a review-found follow-up) with zero `e2e/` changes → dev CI failed 22 E2E
tests (button/text locators timing out on the old label). Grep `e2e/**/*.spec.ts` for
every old label BEFORE pushing any rename, and update matched button-name/text
locators in the SAME commit as the rename.

## Money-safety guard tests: NEGATÍVNY `.not.toMatch()` na NEPRÍTOMNÝ vzor je Stryker-safe — split vzory treba LEN pri POZITÍVNOM matchi na existujúci literál (#380 vs #396)

`fix-cad-money-safety.test.ts`'s split-pattern fix (`/modul:/` + `/'fix'/` namiesto
`/modul: 'fix'/`, PR 399) je o inom probléme, než na prvý pohľad vyzerá — `ZAKAZANE_VZORY`
guard vzor v `pergola-narez-money-safety.test.ts`/`pergola-navrh-money-safety.test.ts`
(`.not.toMatch(/from ['"].*server\/money['"]/)` a pod.) TENTO problém NEMÁ a split
nepotrebuje:

- **POZITÍVNY match na existujúci literál** (fix-cad prípad): Stryker inštrumentuje
  `.ts` súbory v `mutate` scope (`stryker.config.json`) tak, že KAŽDÝ mutovateľný
  string literál obalí mutant-switch kódom — v INŠTRUMENTOVANOM súbore (ten, ktorý
  `fs.readFileSync` v dry-rune reálne číta) sa tak roztrhne susedstvo dvoch predtým
  susediacich tokenov (`modul:` a `'fix'`). Toto POTREBUJE split vzory.
- **NEGATÍVNY match na vzor, ktorý sa v súbore VÔBEC nevyskytuje** (money-safety
  guardy nad "čistými" enginmi — `pergola-narez`/`pergola-navrh`/`bazen-navrh`/`pergola-fix`):
  Stryker mutuje LEN existujúce výrazy/literály, nikdy nevkladá NOVÝ text (import
  deklarácie navyše nie sú mutovateľný cieľ). Keďže hľadaný string (`server/money`,
  `writeOdpis`, `pergola-fix`, ...) sa v pôvodnom súbore vôbec nenachádza, žiadna
  inštrumentácia ho nemôže náhodou "poskladať" — `.not.toMatch()` guard prežije
  Stryker bez rozdelenia (presne to isté zdôvodňuje `pergola-fix`'s vlastný komentár
  v `pergola-narez-money-safety.test.ts`: "Stryker-safe #380: reťazec sa v týchto
  súboroch nevyskytuje ani po inštrumentácii").

Pri pridávaní ĎALŠIEHO money-safety guard súboru (nový modul, sesterský vzor) split
vzory NIE SÚ potrebné, pokiaľ guard ostáva čisto negatívny nad neprítomnými vzormi —
split je len pre POZITÍVNE assercie na existujúci susediaci literál v mutovanom `.ts`
súbore (a `.svelte` súbory nie sú v `stryker.config.json`'s `mutate` scope vôbec, takže
inštrumentácia sa ich netýka).

## Commit message citujúci HISTORICKÝ ticket/PR číslom (`#N`) môže neúmyselne spustiť `block-commit-without-design.sh` guard PRE TEN ticket

`block-commit-without-design.sh` skenuje CELÝ text `git commit` príkazu (nielen
`Closes #N`) na `#N` referencie a vyžaduje design komentár pre KAŽDÚ nájdenú. Ak commit
message v prozaickom vysvetlení cituje starší (už zlúčený/uzavretý) PR/issue ako
`#399` (bežné v tomto repe — money-safety guardy vzájomne odkazujú na predchádzajúce
PR-y, ktoré fixli podobný problém), hook to interpretuje ako "commit sa týka aj #399" a
blokuje, kým commit message obsahuje literálne `#399`. Vyhni sa tomu tak, že historické
referencie v prose píšeš BEZ `#` (`"PR 399"`, `"issue 380"`) — číslo ostáva čitateľné
pre človeka, ale nezhoduje sa s `design_gate.issue_refs` regexom. Rovnaká pasca platí pre
`Closes #N` na cudzí ticket — `block-worker-close-trigger.sh` navyše blokuje AJ
close-keyword tesne pred vlastným `#N` z worktree workera (worker nikdy sám nezatvára
ticket — supervisor to robí po integrácii); vlastnú referenciu píš do zátvoriek
(`"(#396)"`) alebo bez close slova (`"Ref #396"`).

## Manually starting `npm run preview` for a live MCP screenshot needs the SAME env vars as `playwright.config.ts`'s `webServer`

A bare `npm run preview` (no env) serves the build fine (`/health` returns
200) but has NO seeded login user — `loginAs()`-style credentials
(`e2e`/`e2e-heslo-123`) silently fail (login form just re-renders). Pass the
exact same env block `playwright.config.ts`'s `webServer.env` uses:
`DATABASE_PATH=./data/<scratch>.db SEED_USERS='e2e:e2e-heslo-123'
MONEY_LIVE=0 MONEY_TEST_DIR=./data/e2e-odpis-export npm run preview -- --port
4173` — use a SCRATCH `DATABASE_PATH` (not the real dev DB), and delete it
after (`rm -f ./data/<scratch>.db*`). Also start it via **Bash
`run_in_background: true`**, not a `(cmd &)` background-subshell trick inside
a normal foreground Bash call — the subshell gets killed when that tool call
returns, so the server never actually stays up for the MCP browser to reach.

## Testing a form action directly (forged-POST security tests) — `fail()` returns `{status, data}`

Per the `access-control` rule §2: prove a security boundary with a scripted POST
straight to the SvelteKit `actions.<name>` function, not just "button hidden in
UI". `fail(status, body)` (`@sveltejs/kit`) constructs an `ActionFailure` —
inspect it as `{ status: number, data: T }` (`node_modules/@sveltejs/kit/src/exports/internal/index.js`,
`class ActionFailure { constructor(status, data) { this.status = status; this.data = data; } }`).
So a forged-POST test asserts `expect(r).toMatchObject({ status: 403 })` and
reads the message via `(r as { data?: { error?: string } }).data?.error` — NOT
`.error` directly (that's the shape of a plain `return { error }` success-path
object, which `fail()` does not produce). See `tests/pouzivatelia-actions.test.ts`
(#142) and `tests/b2b-money-reject.test.ts` for the pattern.

## Ad-hoc vitest sonda: `console.log` z PREŠLÉHO testu sa nevypíše — píš na `process.stderr` (#604)

Pri dočasnej sonde (`tests/zz-tmp-*.test.ts`, po behu zmazať) vitest 4 `console.log` výstup
prešlého testu nezobrazí ani s `--silent=false`. `process.stderr.write(riadok + '\n')` prejde
vždy (`npx vitest run tests/zz-tmp-x.test.ts 2>&1 | grep …`). Užitočné na zachytenie golden
výstupu PRED opravou (napr. `kovanieDoOdpisu` ostatných systémov) do `toEqual` testu.

## Running the full gate locally

```bash
npm run check          # svelte-check (tsc) — cheap, always fine locally
npx vitest run          # unit tests (or npm test for coverage)
npx playwright test     # E2E — see the build gotcha below
```

**Paralelný `npm test` môže padnúť na zdieľanej DB (#261 race) — serial beh je
`npx vitest run --no-file-parallelism`, NIE `--poolOptions.forks.singleFork=true`.**
Symptóm: 1-2 náhodné testy padnú s `SqliteError: table material_prices already exists`
(dvaja workeri bežia migráciu nad tým istým DB súborom naraz) — pritom ten súbor prejde
sám (`npx vitest run <file>`). Je to len race, nie regresia. Serializuj cez
`--no-file-parallelism` (vitest 4.x spustí test súbory sekvenčne). CLI tvar
`--poolOptions.forks.singleFork=true` NEfunguje — vitest 4.x ho odmietne
`CACError: Unknown option --poolOptions` (poolOptions sa dá nastaviť len v configu, nie
z CLI). `--coverage` pridaj k obom (prahy sú v `vite.config.ts`).

**Formátuj cez repo prettier (`npm run format`), NIE cez bare `npx prettier`.** Repo MÁ
prettier (`^3.9.6` dev-dependency) + `.prettierrc.json` (taby + jednoduché úvodzovky), a
`lint` = `eslint . && prettier --check .` je CI gate — takže formátovanie SA kontroluje.
`npm run format` použije repo `.prettierrc.json`; bare `npx prettier --write` by stiahol
čerstvý prettier s DEFAULTMI (2 medzery, dvojité úvodzovky) a prepísal súbor mimo štýlu
repa — preto vždy `npm run format`, nie `npx`. `.md` a `.claude/` sú v `.prettierignore`
(#98), takže playbook/README úpravy `prettier --check` nekontroluje; nové/upravené
`.ts`/`.svelte` súbory musia byť prettier-clean (viď `lint-formatting.md`).

## E2E without `BASE_URL` — the `webServer` now AUTO-BUILDS (guarded); no manual `npm run build` first

`playwright.config.ts`'s `webServer` (when `BASE_URL` is unset) BUILDS, then runs
`npm run preview`. Its `command` is:

```
if [ "$E2E_PREBUILT" = 1 ]; then true; else npm run build; fi && node e2e/reset-e2e-db.mjs && npm run preview
```

So `npx playwright test` locally always serves a FRESH `build/` — you no longer have to
remember to run `npm run build` first (the round-5 gap, #298: the old command only reset
the DB + previewed, never rebuilt, so a stale/missing `build/` silently served OLD code —
a brand-new route 404'd `[WebServer] [404] GET /pouzivatelia`, and unrelated tests timed
out on `selectOption`/`getByLabel` waits that made no sense given the source).

- **CI does NOT double-build.** The CI `test` job already runs `npm run build` before the
  E2E step, so that step sets `E2E_PREBUILT=1` → the `webServer` skips the rebuild (no
  double build, CI is not slowed).
- **A build failure fails LOUDLY** — the `&&` chain stops, the preview never starts, the
  webServer errors; it never silently serves the old `build/`.
- This local build produces exactly the artifact `vite preview` needs to serve — it does
  NOT contradict the "build/vite build is CI-only" *shipping* policy above (that policy is
  about shipping a production bundle, not about the E2E preview artifact).

When `BASE_URL` IS set (post-deploy E2E against a live target), the `webServer` is
`undefined` — no local preview server, no build — so this doesn't apply.

## Paralelní worktree workeri sa bijú o port 4173 — spusti E2E na inom porte cez TEMP config

`playwright.config.ts`'s `webServer` má `reuseExistingServer: false` a HARDCODED
`http://localhost:4173` (aj `url`, aj `baseURL` default). Worktree-izolovaní workeri
(fleet dispatch, viac branchov naraz) zdieľajú JEDEN host, takže dvaja, čo naraz púšťajú
lokálne E2E, kolidujú: druhý padne na `Error: http://localhost:4173/health is already
used`. NEZABÍJAJ cudzí preview (friendly-fire so súrodencom). Namiesto toho over voľný port
(`ss -tlnp | grep -E ':4173|:4273'`) a spusti na inom cez DOČASNÝ override config (untracked,
zmaž po behu — nikdy `git add`):

```ts
// playwright.tmp4273.config.ts  (v koreni worktree — testDir 'e2e' sa rezolvuje odtiaľ)
import base from './playwright.config';
const PORT = 4273;
const ws = (base as { webServer?: Record<string, unknown> }).webServer;
export default {
	...base,
	use: { ...(base as { use?: Record<string, unknown> }).use, baseURL: `http://localhost:${PORT}` },
	webServer: {
		...ws,
		command:
			'if [ "$E2E_PREBUILT" = 1 ]; then true; else npm run build; fi && node e2e/reset-e2e-db.mjs && npm run preview -- --port ' + PORT,
		url: `http://localhost:${PORT}/health`
	}
};
```

`npx playwright test --config=playwright.tmp4273.config.ts e2e/<spec>.ts …`, potom
`rm -f playwright.tmp4273.config.ts`. `npm run preview -- --port N` prepošle port do
`vite preview` (default 4173). Musíš prepísať OBOJE — `webServer.url` (readiness check) aj
`use.baseURL` — inak testy mieria na 4173, kým server beží na N.

## A LONG-LIVED manual `npm run preview` (for ad-hoc Playwright MCP visual iteration) must be RESTARTED after every rebuild — a fresh build alone is not enough

The section above covers `npx playwright test`'s OWN `webServer` (short-lived, one
process per test run — it now auto-builds `build/` itself before preview). A
DIFFERENT case: when iterating on SVG/layout changes visually (screenshot → judge →
tweak → repeat) you typically start `npm run preview` yourself via `run_in_background`
and drive it with the Playwright MCP across several rounds. That server is a
LONG-LIVED Node process — `vite preview`/adapter-node loads the SSR module graph into
memory ONCE at startup. Running `npm run build` again REGENERATES the files on disk,
but the already-running process keeps serving the OLD in-memory modules (#168, live:
a bazén layout rebalance produced byte-identical screenshots across two `npm run
build` cycles until the preview process itself was killed and relaunched — no error,
no stale-404 symptom, just silently wrong output that looks like "my source change
had no effect"). **Fix: `TaskStop` the background preview task and relaunch `npm run
preview` fresh after EVERY rebuild during this kind of iterative session** — not just
after the first one. Symptom to watch for: a `git diff`-verified source change
produces a screenshot pixel-identical to the previous round.

## Post-deploy prod verification via the Playwright MCP — drive forms with `browser_evaluate`

**`Invalid arguments … expected string, received undefined → at target` is just the
wrong PARAMETER NAME, not a flaky tool (#150).** The `mcp__plugin_playwright_playwright__*`
tools are deferred — until you call `ToolSearch({query: "select:browser_click,browser_type,browser_select_option"})`
their schemas aren't loaded, and guessing `element`/`ref` (the human-readable label +
the snapshot ref look like the obvious pair) throws this exact error because the real
required param is `target` (the snapshot ref goes there; `element` is only the
human-readable description string). Once you `ToolSearch` the real schema and pass
`target: <ref-from-snapshot>`, `browser_click` / `browser_type` / `browser_select_option`
work directly and reliably — no `browser_evaluate` workaround needed for this specific
error. `browser_evaluate` is still the right tool for the genuinely separate problems
below (driving `use:enhance` forms around a `confirm()` dialog, the Svelte reactive
`<select>` race) — don't reach for it just to dodge a parameter-name typo.

When verifying the LIVE deploy hands-on through the Playwright MCP (not a `playwright
test` file) and you DO need to bypass a `confirm()` dialog or a reactive-select race,
drive the SvelteKit `use:enhance` forms directly with `browser_evaluate`:

```js
// set an input (native setter so Svelte's bindings see it), then submit the enclosing form
const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
setter.call(el, val);
el.dispatchEvent(new Event('input',  { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
el.closest('form').requestSubmit();          // triggers the enhance submit handler
```

For a delete guarded by `confirm()`, override it before submitting: `window.confirm =
() => true;` then `form.requestSubmit()`. Target inputs by `#id` / `input[name=…]` — the
a11y snapshot's "textbox" name often comes from a `<label>`, so `[placeholder="…"]`
selectors miss (the inputs have empty `placeholder`).

**Svelte reactive `<select>` race when driving via `browser_evaluate`:** a select whose
options depend on another field (e.g. `#sklo` options are filtered by `#system` /
`sklaForSystem`) will NOT accept a value you set in the SAME evaluate call right after
changing its dependency — Svelte re-renders the options on the next microtask, so your
native `value` setter runs against stale options and silently resolves to `''`. Fix: set
the dependency (`#system`) in one `browser_evaluate` call, let the MCP round-trip settle
the DOM, THEN set the dependent select (`#sklo`) in a SEPARATE call. Also read the ACTUAL
option values first (`[...sel.options].map(o=>o.value)`) — the Deluxe glasses are `Float
kalené 6 mm` / `Float kalené 10 mm`, not what a transient first read may show.

**Money-safe verification rule:** on the live target NEVER click "Odoslať odpis do Money"
(real Money write — irreversible, `MONEY_LIVE=1`). Compute-only (`Spočítať`/`Späť`) and
the `/pouzivatelia` create+delete of a clearly-named throwaway B2B account are the
sanctioned live checks — the users table is not Money. Always delete the throwaway after.

**Svelte prehltne medzeru okolo `{#if}` v texte — oddeľovač píš do VÝRAZU.** Zápis
`{fmtSkloRozmer(s, v)}{#if nazov} · {nazov}{/if}` sa skompiluje bez medzery pred bodkou
(naživo vyšlo `2115mm· Izolačné sklo …`). Reťazenie textu s podmienenou časťou rob
výrazom: `{fmt(s, v) + (nazov ? ` · ${nazov}` : '')}`. Chytilo to len e2e s presným
regexom na celý text bunky (`/^\d+mm × \d+mm · /`) — `toContainText` by to prepustilo,
takže formátovacie požiadavky dielne testuj na CELÝ string, nie na podreťazec.

**`skipAkLive` je v `e2e/helpers.ts`** — každý ZÁPISOVÝ e2e test ho volá ako prvé
(`import { skipAkLive } from './helpers'`). Nekopíruj si lokálnu verziu do spec súboru;
kópie sa rozídu a jedna zabudnutá znamená testovací odpis v ostrom Money importe.

**`getByLabel('Koľaj')` je NEJEDNOZNAČNÉ v bazéne** — matchne aj `Celková dĺžka
koľajníc (mm)` (strict mode violation). Pri krátkych slovenských labeloch, ktoré sú
podreťazcom iného labelu, píš `{ exact: true }`. To isté platí pre `Šírka (mm)` /
`Výška (mm)` v editore vzorcov (kontrolné rozmery) a pre `Dvere`.

**Mutačná kontrola: VŽDY over, že sa mutácia naozaj aplikovala.** Keď dokazuješ, že
nový test dokáže padnúť (vyhodíš skrytý input a čakáš ✘), skript musí `assert` na
existenciu nahradzovaného reťazca — jedna nesprávna tabulátorová úroveň znamená
NULOVÚ zmenu súboru, testy prejdú a vyzerá to, akoby test nič nechytil (alebo horšie:
akoby bol tautologický). Zelený beh po neaplikovanej mutácii nedokazuje nič.

**Text v SVG náhľade sa NEZALAMUJE sám.** Kovanie/popisky v `Nahlad2D.svelte` si lámu
riadky vlastnou funkciou (`wrapKov`) podľa šírky poľa, takže jedna logická veta môže byť
vo viacerých `<text>` prvkoch. Dôsledok pre e2e: `toContainText('bez FAB')` je krehké
(fráza môže byť rozdelená na dva riadky) — testuj jednotlivé slová (`'bez'`, `'FAB'`),
prípadne `not.toContainText('bez')` na odlíšenie variant „s FAB" / „bez FAB".

**`Nahlad2D` má `M.top` DERIVED, nie konštantu.** Klín (keď je zadaný) vyhradí nad okno pás
`KLIN_PAS` px a celý čelný pohľad sa posunie nižšie — `M` je preto `$derived({ ...M0, top: … })`,
takže kóty, kovanie, zámky D46 aj kaskáda idú s ním automaticky. Keď pridávaš ďalší prvok nad
okno, počítaj y od `M0.top` (pás) alebo od `M.top` (okno) — NIE od zmixovaných oboch, a over
očami (screenshot `nahlad-2d`), či ti kóta šírky okna na `M.top-24` nekoliduje s novým pásom.

**Po REVERTE mutácie prebuilduj.** Mutačná kontrola bez `BASE_URL` beží proti `build/`,
takže po vrátení zdroja (`mv …bak`) treba `npm run build` — inak preview stále servíruje
zmutovaný bundle a ďalší beh testuje niečo iné, než si myslíš (živý zásah 2026-07-27:
zrkadlenie výkresu „nefungovalo", pritom bežala stará zmutovaná verzia). **Rovnaká
pasca platí pre RED-state overenie regresného testu cez `git stash`** — ak potvrdzuješ,
že nový e2e test padá BEZ opravy (napr. odstášuješ fix, necháš test), musíš tiež
`npm run build` PRED spustením testu — inak `vite preview` stále servíruje starý build
S fixom a test prejde, hoci zdroj fix nemá (#150 review nález — RED sa dosiahol až po
rebuilde bez fixu, prvý pokus bez rebuildu ukázal falošné GREEN).

**Playwright MCP `browser_take_screenshot` píše LEN do allowed roots AKTUÁLNEJ session
(nie cieľového repa).** Keď túto appku pracuješ zo session-u whose `cwd` je INÝ projekt
(napr. `montalu/n8n` namiesto `automatizacie-montalu` — bežné pri autopilot dispatchi
naprieč projektmi), MCP screenshot s absolútnou cestou mimo tej session zlyhá `File
access denied … Allowed roots: <cwd>/.playwright-mcp, <cwd>`. Fix: `filename` bez cesty
(relatívne, uloží sa do session-ovho `cwd`), potom `cp` na požadované miesto cez Bash.

## Test DB izolácia je AUTOMATICKÁ — nový db-dotýkajúci test súbor NENASTAVUJ default cestu (#261)

`src/lib/server/db.ts` je modulový singleton: pri IMPORTE otvorí + migruje SQLite na
`process.env.DATABASE_PATH || './data/app.db'`. Preto keď test súbor (aj tranzitívne, cez
route `+page.server.ts` alebo server modul) importuje `db.ts` a cestu nenastaví, mieri na
zdieľaný `./data/app.db`. Pri paralelnom `npx vitest run` (default pool=forks + file
parallelism) sa dvaja workeri pretekajú na PRVOTNEJ migrácii toho istého súboru →
`SqliteError: table ... already exists` (obeť je náhodný db-dotýkajúci súbor).

Rieši to **centrálny setup** `tests/setup/db-isolation.ts` (wired cez `test.setupFiles` v
`vite.config.ts`): PRED (hoisted) importmi každého test súboru bezpodmienečne priradí
unikátnu per-file `DATABASE_PATH` pod `os.tmpdir()` (`pid`+`randomUUID`) + `afterAll`
cleanup. Dôsledky pre písanie testov:

- **Nový test súbor, čo importuje db (aj tranzitívne), NENASTAVUJ `DATABASE_PATH`** — setup
  ho izoluje sám (čerstvá migrovaná+seednutá DB per súbor). Guard: `tests/db-isolation.test.ts`.
- Súbor, čo POTREBUJE vlastnú cestu (vlastný snapshot, kontrola cesty), si ju nastaví po
  starom: `process.env.DATABASE_PATH = ...` na top-leveli + `await import('../src/lib/server/db')`
  (dynamický import, NIE hoisted static — inak by `db.ts` prečítalo env priskoro). To len
  prepíše setup hodnotu — žiaden konflikt (vzor: `tests/sklo-cena.test.ts`, `tests/ceny.test.ts`).
- **NIKDY sa nespoliehaj na cross-file zdieľaný stav v DB** — každý súbor má odteraz vlastnú
  izolovanú DB; test, čo číta dáta zapísané INÝM súborom, je odteraz nesprávny.
- **CPU-ťažký wall-clock test** (napr. `login-timing.test.ts`, ~98 scryptov) potrebuje
  EXPLICITNÝ per-test timeout (`it(..., fn, 30_000)`) — pravý paralelný beh pridá CPU
  kontenciu a default 5 s strop sa prekročí (`Test timed out`, nie assertion fail). Timeout
  rieši len trpezlivosť harnessu; TVRDENIE testu sa tým nemení.

## E2E: `img.naturalWidth` čítaný hneď po hydratácii je RACE — assertuj cez bounded `expect.poll` (issue 466, run 33969675716)

`naturalWidth > 0` cez `evaluateAll` HNEĎ po `waitHydrated()` preteká s fetchmi
obrázkov — DOM je hotový, ale obrázky sa ešte sťahujú. Lokálny preview to nikdy
netrafí (obrázky prídu okamžite); cez pomalý SSH tunel (post-deploy E2E) padne
náhodná podmnožina riadkov ako „bez rezu", hoci súbory sú na prode 200 a
byte-zhodné. Fix NIE JE `waitForTimeout` (guard-banned) — je to bounded poll na
celú podmienku:

```ts
await expect.poll(() => bezRezu(page), { timeout: 20_000, message: 'bez rezu' }).toEqual([]);
```

kde `bezRezu()` vráti zoznam riadkov s nenačítaným obrázkom (prázdne pole = OK).
Reálne rozbitý obrázok stále padne (naturalWidth ostane 0 aj po timeoute) — fixuje
sa len race. Vzor: `e2e/profil-obrazky.spec.ts` (merge 09f51a2). Každý nový E2E
assert na `naturalWidth`/`complete`/iný async-load stav píš rovno ako `expect.poll`.

## E2E: globalSetup beží AŽ PO boote webServera — NIKDY nemaž v ňom DB, ktorú si server drží otvorenú (#291)

Playwright spúšťa `globalSetup` **až po tom**, čo je `webServer` hotový (readiness
splnená). Empiricky overené build-free sondou: `SERVER_BOOT` predchádzal `GLOBALSETUP`
o ~270 ms. A tento server si otvorí + **zmigruje** `./data/e2e.db` už pri BOOTE — nie
až pri prvom requeste — lebo `src/hooks.server.ts` importuje `$lib/server/db`, ktoré pri
module-load volá `migrate(db)` (module singleton, SvelteKit načíta hooks pri štarte).

Dôsledok: starý `global-setup.ts`, ktorý `fs.rmSync('./data/e2e.db*')`, mazal už
zmigrovanú DB **spod bežiaceho servera**. Na Linuxe server ďalej obsluhoval z osirotelého
inode (fd ostal platný), ale CESTA na disku zmizla → keď test proces (`seedDopyt` v
`dopyty-konfigurator.spec.ts`) urobil `new Database('./data/e2e.db')`, better-sqlite3
vytvoril ČERSTVÝ prázdny súbor → `SqliteError: no such table: dopyt`. Symptóm bol
zákerný: 244 testov PRED ním prešlo (bežali proti serverovmu inode), padol až prvý test,
čo sa dotkol DB **priamo cez súbor**. `webServer.url:/health` readiness to NErieši —
mazanie sa deje po boote tak či tak.

**Pravidlo:** akýkoľvek e2e stav, ktorý si server pri boote otvorí a drží (SQLite DB),
resetuj v **`webServer.command` PRED `npm run preview`** (`node e2e/reset-e2e-db.mjs &&
npm run preview`), NIKDY v `globalSetup`. Tak čistá DB existuje skôr, než ju server
otvorí, server aj test proces zdieľajú JEDEN migrovaný súbor (server cez WAL vidí riadok
naseedovaný test procesom — to je presne to, čo spec renderuje) a nič sa nemaže spod
bežiaceho procesu. Stav, ktorý server vytvára on-demand (odpis-export dir), je na
timingu nezávislý, ale drž ho tiež v tom istom pre-boot resete kvôli jednote. Voči
NASADENÉMU cieľu (`BASE_URL`) sa reset nespúšťa — `webServer` je vtedy `undefined`.

## Mutácia: Stryker + vitest `ENOTEMPTY` rename race na zdieľanom `.vite` cache → izoluj cacheDir per proces (#291)

`mutation-diff` môže spadnúť v ÚVODNOM dry-rune na `StrykerError: ENOTEMPTY: directory
not empty, rename '.../node_modules/.vite/vitest/<hash>/deps___vitest___temp_* ->
.../deps___vitest__'` — to NIE je prežívajúci mutant ani timeout. Stryker vytvára N
paralelných vitest test-runner procesov, každý v sandboxe so **symlinknutým**
`node_modules` → všetky zdieľajú ten istý reálny `node_modules/.vite` optimize cache a
pretekajú na atomickom rename optimize temp adresára. Je to FLAKY (závisí od toho, ktoré
súbory dostane shard a od timingu) — preto raz „prejde" a inokedy nie na tom istom kóde.

**Fix (`vite.config.ts`):** izoluj vite `cacheDir` PER PROCES
(`node_modules/.vite-stryker-${process.pid}`) LEN keď beží pod Strykerom (CWD obsahuje
`.stryker-tmp`). Zdieľaný rename target zaniká → race zaniká. Normálny
`test`/`dev`/`build`/`preview` beh (CWD = koreň repa) ostáva na defaulte
`node_modules/.vite`, nedotknutý — zelený `test` job sa nemôže rozbiť. NIKDY namiesto
toho neznižuj `break` threshold ani nezvyšuj `timeout-minutes` (no-timeout-band-aids) a
neznižuj Stryker `concurrency` (strata paralelizmu → riziko 20-min stropu).

## Mutácia: source-text regex guard test NESMIE matchovať SUSEDSTVO literálov — Stryker inštrumentácia ho rozbije (#380/PR #399)

Guard test, ktorý číta zdroják cez `fs.readFileSync` a assertuje regexom (vzor
`pergola-narez-money-safety.test.ts`), padne v mutation-diff DRY RUNE (nie na
prežívajúcich mutantoch!), keď regex vyžaduje SUSEDSTVO kľúča a string literálu —
napr. `/modul: 'fix'/`. Stryker mutovaný súbor inštrumentuje: prependne
`// @ts-nocheck` a KAŽDÝ string literál obalí mutant-switchom, takže `modul:` a
`'fix'` už nie sú vedľa seba a guard padne na KAŽDOM mutante toho súboru → dry
run FAIL, celý mutation-diff job červený. **Fix: rozdeľ na samostatné matche** —
`/modul:/` + `/'fix'/` (pôvodný literál prežíva vo false-vetve switchu). Symptóm:
mutation-diff padá hneď v dry rune s failnutým guard testom, pričom
`npx vitest run <guard>` lokálne prechádza.

## Mutácia: negatívny guard na ČÍSELNÝ literál (`not.toMatch(/\b50\b/)`) padne — Stryker vkladá číselné id mutantov (#587)

Výnimka z pravidla „negatívny `.not.toMatch()` na neprítomný vzor je Stryker-safe" vyššie: Stryker
do inštrumentovaného `.ts` súboru VKLADÁ nový text — `stryMutAct_9fa48("50")` / `stryCov_9fa48("46",
"47")` — a ID mutantov sú ČÍSLA. Guard „súbor nemá vlastnú konštantu 50/46/1050" preto padne v
mutation-diff dry rune (`ConfigError: There were failed tests in the initial test run`, 0.25.53 PR
#589 shard 5), hoci `npx vitest run` lokálne prejde. **Fix:** pred kontrolou odstráň Stryker volania
`.replace(/stry(?:MutAct|Cov)_\w+\((?:"\d+"(?:,\s*)?)+\)/g, '')` — pôvodné literály kódu ostávajú,
guard ďalej chytí skutočnú konštantu. Platí pre každý guard nad číslami v súbore z `mutate` scope.

## In-memory per-IP throttle nazbiera naprieč CELOU E2E suite (jeden proces, jedna IP) → posledný spec padne (#390)

`dopyt-throttle` (`allowDopyt`) je in-memory `Map` v SERVEROVOM procese a inkrementuje
sa pri KAŽDOM odoslaní (nie len pri neúspechu — na rozdiel od `login-throttle`, ktorý
`recordSuccess` počítadlo VYNULUJE, preto sa `loginAs` naprieč spec-mi nehromadí). E2E
preview je JEDEN dlho-žijúci proces a všetky spec-y POSTujú z JEDNEJ IP (`127.0.0.1`),
takže per-IP okno zbiera naprieč NESÚVISIACIMI spec-mi. Okno je 10 min > ~8 min beh
suite → NIKDY sa neresetuje. `MAX_PER_WINDOW=8`, a abecedne je 9. `allowDopyt` POST
posledný konfigurátorový dopyt (zimná záhrada; poradie: bazén, oplotenie, pergola
`dopyt`+2×`objednávka`, prístrešok, tienenie, zasklenie = 8) → `fail(429)` bez
`pdfBase64` → `DopytForm` nespustí download → `waitForEvent('download')` 30 s timeout.
Zákerné: 299 ostatných zelených, padne LEN posledný; pridanie ďalšej dopyt/objednávka
lane posunie prah.

- **Diagnóza:** server LOGuje `dopyt-throttle: dopyt rate-limit count=8` (pipe
  `webServer` stdout/stderr v temp configu). `expect(response.ok()).toBe(true)` PREJDE aj
  pri 429 — SvelteKit `use:enhance` akcia vráti HTTP 200 a `{type:'failure',status}` je v
  JSON tele, nie v HTTP statuse; preto padá až download-wait, nie `response.ok()`.
- **Reprodukcia:** spusti VŠETKY dopyt/objednávka spec-y v abecednom poradí `--workers=1`
  v JEDNOM procese (nie dvojicu — tá prah nedosiahne). `--shard` ich rozdelí do rôznych
  procesov → prah sa RESETUJE → bug zmizne (falošné GREEN); faithful RED je celá dávka
  v jednom procese.
- **Fix (NIE band-aid):** limit je env-konfigurovateľný (`Number(process.env.DOPYT_MAX_PER_WINDOW) || 8`,
  pure `resolveMaxPerWindow`), `playwright.config.ts` `webServer.env` ho zvýši
  (`DOPYT_MAX_PER_WINDOW: '1000'`) — rovnaký test-env vzor ako `ENABLE_TEST_ERROR_ROUTE`/
  `MONEY_LIVE=0`. PROD/VPS env NIKDY nenastavuje → default 8, prod NEZMENENÝ; throttle je
  ďalej pokrytý `tests/dopyt-throttle.test.ts`. NIKDY nezvyšuj test timeout ani `test.skip`.

## E2E: rozmer prírezu (mm) čítaj z NÁREZ riadka `Rez profilu <KOD>`, NIE z odpis karty (#416)

Keď e2e overuje konkrétny ROZMER rezu (napr. sieťková cross-delta 959/969 mm), tá
hodnota je v NÁREZ tabuľke ako bunka `6×952 mm + 2×969 mm`, NIE v karte „Odpis (do
Money)" — tá ukazuje len Money kód + CELKOVÉ metre (`ZASP202415 · … 10,8 m`) + ks, bez
jednotlivých rozmerov. `odpisRiadky(page)` (číta `.card` „Odpis (do Money)") teda na
rozmer nikdy nesadne — assertuj na nárez riadok:

```ts
await expect(page.getByRole('row', { name: /Rez profilu ZASP202415/ })).toContainText('969');
```

PASCA: `getByRole('row', { name: /ZASP202415/ })` (bez `Rez profilu` prefixu) padne na
strict-mode violation — ten istý kód má DVA riadky: nárez riadok (name začína `Rez
profilu <KOD>`, z alt textu tlačidla v prvej bunke) AJ riadok v `ceny-tabulka`
(`getByTestId('ceny-tabulka')`, name `<KOD> Kladkový profil`). Prefix `Rez profilu <KOD>`
identifikuje nárez riadok jednoznačne. Kódy (nie rozmery) v odpis karte overuj ďalej cez
`odpisRiadky(...).join(' | ')` + `toContain('ZASP00018')` — tam sú.

### DRUHÝ tvar tej istej kolízie — bazén ROZPIS riadok vs `ceny-tabulka` riadok (#454)

Odkedy `#454` pridal `enrichPolozky` + `CenyTabulka` náhľad ceny AJ na bazén Kontrola
obrazovku (viď `ceny-snapshot.md`), ten istý článkový kód žije v DVOCH `<tr>` na TEJ
ISTEJ obrazovke: v **kontrolnom rozpise** (má `<input name="qty_<KOD>">`) AJ v
`ceny-tabulka` (`<td class="mono">{r.kod}</td>`, BEZ inputu). `page.locator('tr', {
hasText: '<KOD>' })` je substring + strict-mode → matchne OBA → violation (živý pád
`bazen-komponenty.spec.ts:82` na `BPK00074`). Scopuj na rozpis riadok cez qty input,
ktorý má LEN on:

```ts
const kompRow = page.locator('tr', { has: page.locator('input[name="qty_BPK00074"]') });
```

(alebo naopak z ceny-tabulka riadku cez `getByTestId('ceny-tabulka').locator('tr', …)`).
Je to tá istá „kód sa objaví aj v ceny-tabulka riadku" pasca ako `#416` vyššie — platí
na KAŽDEJ odpisovej Kontrola obrazovke, ktorá renderuje `CenyTabulka` (pergola/zasklenia/
bazén). Pred `hasText: '<KOD>'` na Kontrola obrazovke vždy over, či cieľový riadok
nekoliduje s ceny-tabulka riadkom.

## Unit test na DOM-event logiku BEZ jsdom (repo ho zámerne nemá) — duck-type, netestuj cez `instanceof`

Repo beží vitest v `'node'` prostredí (žiadny jsdom v `package.json`) — `document`/
`HTMLElement`/`Event` globals V RUNTIME NEEXISTUJÚ mimo skutočného prehliadača/E2E.
Keď píšeš čistú funkciu, ktorá spracúva DOM event (`event.target`, klávesnica, wheel,
...), NEPÍŠ ju cez `target instanceof HTMLElement` ani nečítaj `document.activeElement`
priamo v tej istej funkcii — v `node` teste by to hodilo `ReferenceError` (identifikátor
neexistuje vôbec, nielenže vráti `false`).

Namiesto toho použi **duck-typed kontrolu** cez vlastnosti (`tagName`/`type`/`typeof
x.blur === 'function'`, …) — funkcia je čistá, testovateľná s obyčajným mock objektom
(`{ tagName: 'INPUT', type: 'number', blur: vi.fn() }`), bez `globalThis` stubovania.
Skutočný DOM element v prehliadači tento tvar prirodzene spĺňa, takže produkčné
správanie je identické. Príklad: `src/lib/wheel-guard.ts` (#453 — wheel-nad-number-inputom
guard) + `tests/wheel-guard.test.ts`. Keď funkcia GENUINELY potrebuje niečo zložitejšie
z `document`/canvas (napr. `document.createElement('canvas').getContext('2d')`), NIE
duck-typing — pozri `tests/vizual-textury.test.ts`'s ručný `(globalThis as unknown as
{ document: unknown }).document = { ... }` stub namiesto inštalácie jsdom.

## OdpisBlok `confirm()` dialog v E2E — `page.on('dialog')` PRED klikom (#462)

OdpisBlok (`odoslat-aj-tak` testid) spustí natívny `window.confirm()` pri kliku.
V Playwright E2E MUSÍŠ nastaviť `page.on('dialog', (d) => d.accept())` **PRED**
klikom na `odoslat-aj-tak` — inak dialog blokuje a test timeoutne. Vzor:

```ts
page.on('dialog', (d) => d.accept());
await page.getByTestId('odoslat-aj-tak').click();
```

Rovnaký vzor aj pre sietka duplikát (`sietka.spec.ts`) a konfigurátor dopyt delete.

## `{@render hidden()}` v DVOCH formách na výsledkovej stránke → `.first()` (#462)

Na mnohých výsledkových stránkach (sietka, zasklenia, clip...) sa snippet `hidden()`
renderuje v dvoch `<form>` elementoch (`?/odoslat` + `?/upravit`), takže
`page.locator('input[name="X"]')` matchne DVA hidden inputy a Playwright strict-mode
ho odmietne. Scopuj cez `.first()` alebo cez parent form:
`page.locator('form[action*="odoslat"] input[name="X"]')`.

## combo_ rádiá (>7500mm tyče) sú PERGOLA-only v praxi (#462)

`comboCases` logika žije v zdieľanom `server/pergola.ts` (`transform`), ale /fix/cad
profily sa mapujú cez CODE_MAP na „surový 7500mm" tyče — tie absorbujú aj >7500mm rezy
bez combo voľby. Combo test preto píš na /pergola (`parita.spec.ts`), nie na /fix/cad.

## E2E per-page form gotchy (#464 census)

- **Fix page šikmý tvar (default) vyžaduje `v1 !== v2`** — rovnaké výšky spustia
  varovanie „Výšky sú rovnaké — vyber rovný" a formulár sa neodošle. E2E test pre
  šikmý musí zadať rôzne v1/v2 (napr. 800/600).
- **Bazén navrh `Počet sekcií` je `<input type="number">`, NIE `<select>`** — použij
  `.fill('4')`, nie `.selectOption('4')`. Koľaj/Smer posuvu/Smer dverí SÚ selecty
  (hodnoty: `jednokolaj`/`dvojkolaj`, `vpravo`/`vlavo`).
- **Zasklenia navrh radio `zn-rezim` nemá `value` atribút** — Svelte radios používajú
  `checked` + `onchange` bez HTML `value`. Selektor
  `input[name="zn-rezim"][value="technicky"]` NEFUNGUJE. Použi
  `page.getByLabel('Technický (čiernobiely)')` (viditeľný text labelu). Farebný
  radio má testid `rezim-farebny-radio`.
- **`window.print()` stub pre E2E:** helper `stubWindowPrint(page)` v
  `e2e/helpers.ts` — volaj PRED `loginAs`/`goto` (injektuje cez `addInitScript`).
  Vracia `{ assertPrintCalled() }`. Vzor: `app.spec.ts` print test.
- **`addInitScript` WebGL blok ovplyvní CELÚ session** — ak zablokuješ
  `getContext('webgl2')`, ovplyvní to aj stránky PRED cieľovou (napr. navrh page
  s 3D náhľadom). Preto sa zakaznícky „Skúsiť znova" retry path nedá spoľahlivo
  testovať cez session-wide WebGL stub (navrh page sa nepostaví).

## E2E: `page.request` cez SSH tunel → stale keepAlive socket → "socket hang up" (#506)

Playwright globálny `httpHappyEyeballsAgent` (`keepAlive: true`, proces-wide singleton
v `coreBundle.js`) pooluje TCP spojenia naprieč VŠETKÝMI `page.request` volaniami vo
workeri. Na konkrétnom mieste (`konfigurator-zasklenie` test 2 → 3 browser-only testy →
`konfigurator-zimna-zahrada` test 3) znovupoužitie pooled socketu koinciduje so serverovým
`keepAliveTimeout` (5 s) close — cez SSH tunel sa FIN propaguje s oneskorením, takže agent
dispatchne na stale socket → `ECONNRESET` / "socket hang up". Deterministic na TEJTO
pozícii, nie každá medzera (iné `skipAkLive` volania s kratšími/dlhšími medzerami race
netrafili). Lokálne to nikdy nevidno (loopback je rýchlejší než tunnel FIN propagation).

**Fix:** `skipAkLive()` v `e2e/helpers.ts` používa Node.js `fetch()` (undici Pool,
`keepAliveTimeout: 4000` ms — proaktívne disposal PRED server timeout) namiesto
`page.request.get()`. `/health` je verejný JSON GET bez browser cookies a bez
`x-forwarded-*` hlavičiek (CSRF je len POST). Caller interface je nezmenený —
`await skipAkLive(page)` funguje rovnako, `page` parameter ostáva pre kompatibilitu.

**NEKOPÍRUJ vzor `page.request.get` na NOVÉ helpers** — keď treba HTTP request bez
browser kontextu (health check, metadata GET), použi `fetch()`. `page.request` je
správny len keď request POTREBUJE browser cookies (autentizovaný GET z kontextu
prihláseného testu).

## Post-deploy E2E beží proti ŽIVEJ PROD cfg — NIKDY pevný mm literál z výpočtu; odvoď z DOM / assertuj reláciu (#555 HOTFIX)

**Pravidlo:** akákoľvek E2E asercia na VYPOČÍTANÚ mm hodnotu (rozmer skla, sieťoviny, prírezu,
jokla…) NESMIE niesť pevný literál odvodený zo **seed** cfg. Post-deploy sada beží proti
`BASE_URL` = **ŽIVÁ PROD appka**, ktorej `cfg` tabuľka je upravovaná editorom vzorcov —
Robust/iné vzorce sa na PROD líšia od seedu → tá istá vstupná objednávka dá o pár mm INÝ
výsledok. Pevný seed literál je preto ENV-VIAZANÝ a padne LEN v deploy jobe (CI `test` job so
seed `e2e.db` prejde, deploy zlyhá — nekonzistentne vyzerajúca „flaky" regresia, ktorá je v
skutočnosti deterministická).

**Ako správne:** buď (a) **odvoď očakávanú hodnotu z DOM** — prečítaj príbuznú hodnotu, ktorú
tá istá stránka zobrazuje, a dopočítaj vzťah v helperi (jediné miesto delty v E2E, paritu drží
unit test), alebo (b) **assertuj RELÁCIU** (`> bez`, `!= referenčný`, „obsahuje 3K"), nikdy
konkrétne mm. Vzor: `jokleZoSietoviny(text)` v `e2e/helpers.ts` číta rozmer sieťoviny z testidu
(`sietka-rozmer` / `sietka-samostatna-rozmer`) a dopočíta jokel (`+10 / −22`, `ks 4`) — parita s
`JOKLE_DELTA`/`JOKLE_KS` v `src/lib/sietka.ts` cez `tests/sietka-jokle.test.ts`.

**Prečo NIE „zosúladiť seed s PROD":** seed je zdroj pre nové inštalácie a deterministické unit
vektory (`tests/compute.test.ts` — CONTRACTUAL 1:1 s Money odpisom); PROD cfg sa mení editorom
kedykoľvek, takže naviazať test na dnešnú PROD hodnotu by ho rozbilo pri ďalšej úprave. **Unit
vektory teda ostávajú pevné (seed = deterministický), E2E na vypočítané mm sú relačné/odvodené.**

Incident: PR #561 pridal na `sietka.spec.ts` pevné jokle literály zo seedu → main run 35588964456
deploy zlyhal 2/319 (`sietka-jokle` 1457/2094 vs PROD 1460/2097; `sietka-jokle-riadok` 4×1575 vs
4×1578). Fix (#555 HOTFIX): odvodenie zo sieťoviny cez `jokleZoSietoviny`. Pozri aj `sietka.md`.

**Rovnaká pasca pre PONUKU (#577, main run 36676300171):** živá PROD cfg nie sú len vzorce, ale aj
povolené hrúbky Odoo skiel (`cfg_sklo_hrubka`, editor `/zasklenia/nastavenia`). Výroba 29.9. odobrala
24 mm izolačné pri Štandardoch → 3 specy, ktoré žiadali výpočtové sklo „Izolačné sklo 4/16/4 číre" pri
Štandard +, padli LEN v deploy jobe (CI bez Odoo ponúka lokálny allow-list, kde 4/16/4 je). Pravidlo:
vyber sklo podľa toho, od čoho výpočet REÁLNE závisí (IZO nárezák = TRIEDA 16 → „4/8/4 číre" = Odoo
16 mm), nikdy konkrétnu skladbu, ktorú výroba môže vypnúť; netvrď prítomnosť voľby, ktorú editor vie
odobrať (tvrď podmnožinu / triedu).

## Paralelný post-deploy E2E (`E2E_WORKERS`) + lokálne meranie v LIVE režime (#577)

- **Default 1 worker** (lokálne aj CI `test` job proti preview — tam bežia ZÁPISOVÉ testy nad jednou
  e2e.db a zdieľanými fixture súbormi `e2e-ceny.json`, paralelne by sa bili). Post-deploy krok nastaví
  `E2E_WORKERS=3`: proti LIVE PROD je sada read-only. Pri > 1 sú dva Playwright projekty: `paralelne` +
  `seriove` (1 worker, `dependencies` → beží PO paralelnej časti, `testMatch` = `SERIOVE_VSETKY`).
  V `seriove` sú DVE kategórie, každá z iného dôvodu (`e2e/seriove.ts`, guard `tests/e2e-seriove.test.ts`):
  1. **`SERIOVE_SPECY` — menia zdieľanú konfiguráciu** (marker `MUTUJE_CFG` = `ulozit-vzorce` /
     `pridat-hrubku` / `odobrat-hrubku`): súbežný editor by menil čísla ostatným testom.
  2. **`SERIOVE_3D` — čakajú na three.js/WebGL scénu** (marker `RENDERUJE_3D` = ľubovoľný `data-viz-*` /
     `vizual3d-canvas` / `zakaznicky-obrazok`): GH runner (4 vCPU, bez GPU) renderuje swiftshaderom a
     pri 3 súbežných workeroch CPU vyhladovie → timeout, hoci appka je OK (#599: 0.25.60
     `zasklenia-zakaznicky` `waitForFunction` 60 s, 0.25.59 prešiel = závislé od záťaže). Oprava =
     izolácia záťaže, NIKDY retry ani vyšší timeout. Stránka, ktorá 3D panel len namountuje a test na
     scénu nečaká (`zasklenia-navrh` výkres), ostáva paralelne — na scéne timeoutnúť nemôže.
  Guard padne, keď spec s markerom nie je v zozname aj keď zoznam má súbor bez markera. Nový spec so
  zápisom do editora → `SERIOVE_SPECY`; nový spec čakajúci na 3D scénu → `SERIOVE_3D`.
  **Namerané #599** (lokálne LIVE režim, load ~2, `--project=seriove --no-deps`): 87 testov → 63 passed
  / 24 skipped za 3,5 min (3D 176 s, editor 17 s — editorové zápisy sú za `skipAkLive`). V CI 0.25.60
  bol `seriove` 1,8 min a 3D specy v paralelnej časti stáli ~7 min worker-času (pod záťažou) → čakaj
  `seriove` ~+3–5 min, `paralelne` o ~2–3 min kratšie; celok hlboko pod 30-min capom.
  Obsah projektu over bez servera: `E2E_WORKERS=3 BASE_URL=http://localhost:1 npx playwright test
  --list --project=seriove --no-deps` — BEZ `--no-deps` `--list` vypíše aj závislý `paralelne` (celú sadu).
  Pri JEDNOM volaní by padnutý test v `paralelne` preskočil `seriove` (dependency, „did not run") —
  post-deploy krok preto volá `--project=paralelne` a potom `--project=seriove --no-deps` (každý so
  svojím `PLAYWRIGHT_HTML_OUTPUT_DIR=playwright-report/<projekt>`), rc oboch, krok padne pri ktoromkoľvek.
- **Paralelne-bezpečný spec:** nečíta zoznam, do ktorého súbežné testy pridávajú (používatelia, história
  odpisov) cez PODREŤAZEC. Vzor zlyhania: `locator('tr', { hasText: E2E_USER })` chytil súbežne zakladaný
  `e2e-vo-…` účet (strict mode) → vlastný riadok hľadaj cez odznak „ja" / presnú bunku
  (`pouzivatelia-role.spec.ts`). Throwaway účty (`zalozB2bUcet`) majú unikátne mená — tie sú OK.
- **Lokálne meranie presne post-deploy množiny BEZ PROD:** dočasný config (necommitovať) so
  `webServer` preview a env `MONEY_LIVE=1` + `MONEY_LIVE_DIR=./data/<scratch>` (zápisy by išli do
  scratch adresára, nie `/data/dlv-import`) → `/health` hlási `live:true` → `skipAkLive` preskočí
  zápisové testy ako na PROD; `BASE_URL=http://localhost:4173` spustí BASE_URL skipy. Výsledok 30.9.:
  341 passed / 105 skipped = presne profil PROD behu. Chromium binárku ber dynamicky (cache
  `~/.cache/ms-playwright/chromium_headless_shell-*` sa mení pod rukami iných sessions — medzi dvoma
  behmi zmizla 1247).
- **Namerané (dev1 pretažený inými projektmi, load 18–30 na 8 jadrách — čísla sú orientačné):**
  4 workery 7,7 min, sériovo 25,5 min. Pri load ~30 padali pri 3–4 workeroch 3D specy
  (`vizual3d`, `vizual-showroom`, `konfigurator-pergola` 3D, `zasklenia-zakaznicky`) na timeoute —
  swiftshader render je CPU-ťažký. Preto CI 3 workery (runner 4 vCPU, server je vzdialený VPS); od #599
  bežia tieto 3D specy navyše v `seriove` (vyššie), 3 workery sú pre zvyšok sady. Keď
  post-deploy pomalý: NAJPRV počet testov / čas z logu behu (reporter `list` ich vypíše), nie limit.

## Svelte komponent vo vitest cez SSR `render` + lokálny E2E s inou verziou Chromia (#578)

- **Komponent sa dá testovať bez prehliadača:** `import { render } from 'svelte/server'` +
  `render(Komponent, { props }).body` → regex nad HTML (vzor `tests/sklo-otvory-578.test.ts`: počet
  `circle[stroke-dasharray]` z `Nahlad2D` = pravidlo `otvoryVSkle`). `$props.id()` aj `$lib` aliasy
  fungujú (sveltekit plugin vo `vite.config.ts`). Lacnejšie a presnejšie než E2E na „kreslí toľko X".
- **Lokálny E2E cez `vite dev` (Tier 0) keď chýba pinned Chromium** (`Executable doesn't exist …
  chromium_headless_shell-12xx`): v dočasnom configu `use.launchOptions.executablePath` na už
  nainštalovaný `~/.cache/ms-playwright/chromium_headless_shell-<iná>/chrome-headless-shell-linux64/
  chrome-headless-shell` (cez `os.homedir()`), nič nesťahovať. Config aj `test-results/` po behu
  zmaž — necommitovať. Prvý test na ešte neskompilovanú route môže v dev móde timeoutnúť (on-demand
  kompilácia) → rerun, nie bug. Pri #592 (zmena len nav/nadpisov) padli pod `vite dev`
  aj `app.spec.ts` „editor vzorcov…" (v celom súbore; samostatne prejde) a `fix-cad.spec.ts`
  „#462 … ✏️" — formulárové toky citlivé na dev-mode hydratáciu; rozhoduje CI preview beh.
- **Cesta k binárke sa líši podľa verzie Chromia a cache sa mení pod rukami** (#583: 1244 zmizlo
  počas behu, ostalo 1193): 12xx = `chromium_headless_shell-<v>/chrome-headless-shell-linux64/
  chrome-headless-shell`, 1193 = `chromium_headless_shell-1193/chrome-linux/headless_shell`. Pred
  behom `ls ~/.cache/ms-playwright/chromium_headless_shell-*/`.
- **Temp E2E config drž na porte 4173, ak je voľný** — `skipAkLive` (`e2e/helpers.ts`) číta
  `BASE_URL || http://localhost:4173`, takže na inom porte všetky zápisové testy padnú na `fetch
  failed` (artefakt harnessu, nie regresia). Iný port len keď je 4173 obsadený súrodencom.
- **`vite dev` vo WORKTREE → 403 na fonty = `server.fs.allow` artefakt (#577).** Worktree
  (`.claude/worktrees/agent-*`) rezolvuje `node_modules` z RODIČOVSKÉHO repa; vite dev servíruje len
  z allow listu worktree → `@fontsource-variable/*.woff2` padne 403 a KAŽDÝ zero-console assert zlyhá
  na `Failed to load resource: … 403` (v logu `is outside of Vite serving allow list`). Nie regresia:
  spusti dev cez dočasný `vite.tmpN.config.ts` = `mergeConfig(base, { server: { fs: { allow:
  ['<rodičovské repo>/node_modules'] } } })` (`npx vite dev --config vite.tmpN.config.ts --port 4173
  --strictPort` vo webServer.command dočasného playwright configu, s `executablePath` podľa bodu
  vyššie), obe dočasné súbory po behu zmaž. Jednoduchšia alternatíva (#592 karty): `npm ci` priamo
  vo worktree — `node_modules` je potom v allow liste worktree, stačí len dočasný playwright config
  (`npx vite dev --port N --strictPort`), fonty idú 200 a zero-console prejde.
  **PASCA `npm ci` vo worktree (#599):** npm `allow-scripts` NESPUSTÍ install skript
  `better-sqlite3` → chýba natívny `build/Release/better_sqlite3.node` a server padne. Skopíruj
  binárku z rodičovského repa (`mkdir -p node_modules/better-sqlite3/build/Release && cp
  <rodič>/node_modules/better-sqlite3/build/Release/better_sqlite3.node …`, over zhodu verzie
  balíka) — nekompiluj.
- **Podklad objednávky skla: každá položka = 2× `tbody tr`** (riadok + riadok volieb) → počítaj
  položky cez `span[data-testid^="popis-"]` (od #594 je popis `<span>` v bunke popisu vedľa
  `pridal-<id>` „pridal <autor> · <čas>"), nie `tbody tr`.

## E2E účet založený na cieli (aj PROD) = ZARUČENÉ upratanie cez fixture `e2eUcty`, nikdy „zmažem na konci testu" (#583)

Post-deploy E2E beží proti PROD — throwaway B2B účet s heslom natvrdo vo verejnom repe, ktorý test
zmaže až na SVOJOM konci, ostane na PROD pri AKOMKOĽVEK páde po vytvorení (0.25.50: `logout()` padol
v kroku upratania → `e2e-b2b-mul90ik9` ostal na PROD).

- Každý E2E, ktorý zakladá účet: `import { test, expect } from './ucty'` (rozšírený `test`, názov
  `test` ostáva kvôli zero-console guardu), fixture `e2eUcty` do signatúry a
  helper `const heslo = await zalozB2bUcet(page, e2eUcty, user)` — zaregistruje PRED „Pridať účet" a
  vráti NÁHODNÉ heslo (nikdy heslo natvrdo v repe — PROD účet žije počas behu). Teardown
  fixture beží aj po páde/timeoute a maže v SAMOSTATNOM admin kontexte (stav testovej stránky nehrá
  rolu). Vlastné mazanie na konci testu môže ostať (teardown je potom no-op).
- Meno MUSÍ mať tvar `E2E_UCET_VZOR` = `e2e-<popis>-<Date.now base36>` (fixture iné odmietne).
  Ručný `BASE_URL=… npx playwright test` proti PROD nepúšťaj súbežne s CI post-deploy (sweep by
  zmazal jeho rozbehnuté účty). `e2e/global-setup.ts` pred sadou zmaže zvyšky
  B2B `e2e-*` účtov (nikdy E2E admin, nikdy interný — interný UI nezmaže). Sweep log:
  `[e2e #583] sweep zvyškových e2e- účtov: …`.
- Interný účet (nezmazateľný z UI) zakladaj len za `skipAkLive` + vlastné `finally` (vzor
  `objednavka-skla.spec.ts` #571: najprv rola B2B, potom Zmazať).
- Dôkaz, že upratanie beží aj pri zlyhaní: `e2e/ucty-upratanie.spec.ts` (serial; prvý test
  `test.fail` padne po založení, druhý overí, že účet neostal).

## User menu / nav `<details>` — žiadny `bind:open` (#583)

Nav dropdowny v `+layout.svelte` vlastnia `open` natívne; zatváranie ide cez `bind:this` refs a
`afterNavigate` preskočí `type === 'enter'`. `bind:open` (aj zatváranie pri 'enter') pri hydratácii
prepíše klik spravený PRED ňou (plný POST „Spočítať" → nový dokument) a menu sa zavrie — presne
nestabilný `logout()` v post-deploy E2E. Regresný test `e2e/user-menu-hydratacia.spec.ts` zadrží JS
cez `page.route` (deterministicky pred hydratáciou). `logout()` čaká na hydratáciu + viditeľné
„Odhlásiť"; `openUserMenu()` otvára len zatvorené menu (summary klik PREPÍNA).
