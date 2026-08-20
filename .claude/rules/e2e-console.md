---
paths:
  - "e2e/**"
  - "tests/e2e-console-guard.test.ts"
---

# E2E zero-console + guard gotchas (#247)

Pravidlo `browser-console-zero-errors` je v e2e presadené MECHANICKY guardom
`tests/e2e-console-guard.test.ts` (Vitest, číta `e2e/*.spec.ts` cez `node:fs`).
KAŽDÝ test blok musí mať `const consoleMsgs = collectConsole(page)` prvý riadok tela
a `expect(consoleMsgs).toEqual([])` posledný assert (helper v `e2e/helpers.ts`).

## Počítaj `collectConsole(`, NIKDY `toEqual([])`

Guard invariant je „počet test blokov (`^\s*test\(`) == počet `collectConsole(` volaní"
per súbor. NEPOČÍTAJ `toEqual([])` — niektoré testy majú BIZNISOVÉ `toEqual([])`
(napr. `profil-obrazky` 2, `standard-narezak` 5, `standard-stary` 5 pri 1/3/4 testoch),
takže `count(test)==count(toEqual([]))` by falošne padal na už-správnych súboroch.
Ticketov `grep -c 'test('` tiež nadhodnocuje (matchne neblokové výskyty) — dôveruj
`^\s*test\(` a `collectConsole(`.

## Sankcionované `test.skip` = LEN `process.env.BASE_URL` guard (+ `skipAkLive`)

Legitímne sú deployment/data-safety guardy `test.skip(!!process.env.BASE_URL, …)`
(fixture sa nedá zapísať do vzdialeného kontajnera / nezmazateľný interný účet) a
`skipAkLive(page)` (volanie helpera — nie doslovný `test.skip(` v spec súbore).
ZAKÁZANÝ je capability/env-skip (secure-context, clipboard, feature-detect): namiesto
preskočenia asertuj predpoklad a nechaj test PADNÚŤ — napr. `expect(secure, '…').toBe(true)`
(localhost aj CI preview sú vždy bezpečný kontext). Guard toto stráži.

## PASCA: `block-test-skips.sh` false-block na META/guard testoch

Pre-push hook `block-test-skips.sh` matchne `\btest\.skip\(` v PRIDANÝCH riadkoch
test súborov. Guard/meta test, ktorý `test.skip(` len SPOMÍNA (v komentári, stringu,
`it(...)` popise), by tak bol pri integrácii FALOŠNE zablokovaný. Rieš:
- v próze píš `test.skip` BEZ zátvorky (`test.skip`, nie `test.skip(`),
- samotný detektor nechaj ako regex `/test\.skip\(/g` — zdrojový text `test\.skip\(`
  (s backslashmi) NEOBSAHUJE literál `test.skip(`, takže hook naň nereaguje.

## Stabilita bez sleepu (hodnota sa nesmie vrátiť po reaktívnom flushi)

Na overenie, že Svelte reaktívny flush NEPREPÍŠE hodnotu späť, NEPOUŽÍVAJ
`waitForTimeout` (guard ho zakazuje). Deterministicky prejdi render-flush a potom
ohraničene asertuj:

```ts
await expect(page.locator('#system')).toHaveValue(cielovy!);
await page.evaluate(
	() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
);
await expect(page.locator('#system')).toHaveValue(cielovy!, { timeout: 2000 });
```

Samotný `toHaveValue({ timeout })` bez čakania na flush NESTAČÍ — prvý poll zbehne
pri t≈0 PRED flushom (vidí ešte správnu hodnotu) a oneskorený revert prepustí.
2× `requestAnimationFrame` je spoľahlivo za mikroúlohami aj Svelte rAF flushom.
