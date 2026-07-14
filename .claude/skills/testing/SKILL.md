# Testing (unit + E2E) — local run gotchas

## Running the full gate locally

```bash
npm run check          # svelte-check (tsc) — cheap, always fine locally
npx vitest run          # unit tests (or npm test for coverage)
npx playwright test     # E2E — see the build gotcha below
```

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

**Money-safe verification rule:** on the live target NEVER click "Odoslať odpis do Money"
(real Money write — irreversible, `MONEY_LIVE=1`). Compute-only (`Spočítať`/`Späť`) and
the `/pouzivatelia` create+delete of a clearly-named throwaway B2B account are the
sanctioned live checks — the users table is not Money. Always delete the throwaway after.
