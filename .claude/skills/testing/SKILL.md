# Testing (unit + E2E) — local run gotchas

## Testing a form action directly (forged-POST security tests) — `fail()` returns `{status, data}`

Per `access-control` skill §2: prove a security boundary with a scripted POST
straight to the SvelteKit `actions.<name>` function, not just "button hidden in
UI". `fail(status, body)` (`@sveltejs/kit`) constructs an `ActionFailure` —
inspect it as `{ status: number, data: T }` (`node_modules/@sveltejs/kit/src/exports/internal/index.js`,
`class ActionFailure { constructor(status, data) { this.status = status; this.data = data; } }`).
So a forged-POST test asserts `expect(r).toMatchObject({ status: 403 })` and
reads the message via `(r as { data?: { error?: string } }).data?.error` — NOT
`.error` directly (that's the shape of a plain `return { error }` success-path
object, which `fail()` does not produce). See `tests/pouzivatelia-actions.test.ts`
(#142) and `tests/b2b-money-reject.test.ts` for the pattern.

## Running the full gate locally

```bash
npm run check          # svelte-check (tsc) — cheap, always fine locally
npx vitest run          # unit tests (or npm test for coverage)
npx playwright test     # E2E — see the build gotcha below
```

**NEPÚŠŤAJ `npx prettier --write`.** Repo nemá prettier ani ako dev-dependenciu, ani
`.prettierrc` — `npx` stiahne čerstvý prettier s DEFAULTMI (2 medzery, dvojité úvodzovky)
a prepíše celý súbor mimo štýlu repa (taby + jednoduché úvodzovky). Formátovanie nie je
v CI gate, tak píš rovno v štýle okolitého kódu; ak sa to už stalo, súbor prepíš späť
(nový súbor sa nedá `git checkout`-núť).

## E2E without `BASE_URL` needs a FRESH `npm run build` first — stale preview = false failures

`playwright.config.ts`'s `webServer` (when `BASE_URL` is unset) runs `npm run preview`
(`vite preview`), which serves whatever is already in `build/` — it does **not** rebuild.
If you added/changed a route or server logic and only ran `npm run check` + `vitest`,
the preview server still serves the OLD build. Symptom: a brand-new route 404s
(`[WebServer] [404] GET /pouzivatelia`) and/or unrelated-looking tests time out on
`selectOption`/`getByLabel` waits that make no sense given the source — because the
served HTML/JS is stale, not because the test or the source is wrong.

**Fix:** run `npm run build` once before `npx playwright test` whenever you've changed
routes/server code and are verifying E2E locally without `BASE_URL`. This is a
deliberate, one-off LOCAL build for test verification — it does not contradict the
"build/vite build is CI-only" policy above (that policy is about *shipping* a
production bundle, not about producing the artifact `vite preview` needs to serve
during local E2E verification). Re-run `npm run build` again after any further route/
server change before re-running E2E; a stale build silently keeps serving the old code.

When `BASE_URL` IS set (post-deploy E2E against a live target), this doesn't apply —
there's no local preview server, no build needed.

## Post-deploy prod verification via the Playwright MCP — drive forms with `browser_evaluate`

When verifying the LIVE deploy hands-on through the Playwright MCP (not a `playwright
test` file), `browser_click` / `browser_select_option` intermittently fail with
`Invalid arguments … expected string, received undefined → at target`. Don't fight it —
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
zrkadlenie výkresu „nefungovalo", pritom bežala stará zmutovaná verzia).
