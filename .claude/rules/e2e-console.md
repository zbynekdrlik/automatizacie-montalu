---
paths:
  - "e2e/**"
  - "tests/e2e-console-guard.test.ts"
---

# E2E zero-console + guard gotchas (#247)

Pravidlo `browser-console-zero-errors` je v e2e presadené MECHANICKY guardom
`tests/e2e-console-guard.test.ts` (Vitest, číta `e2e/*.spec.ts` cez `node:fs`).
Guard stráži PER TEST BLOK DVE veci: (1) počet — práve JEDEN `collectConsole(page)`
na blok, A (2) záverečný console assert — jeho sankcionovaný tvar (nižšie).
KAŽDÝ test blok musí mať `const consoleMsgs = collectConsole(page)` prvý riadok tela
a sankcionovaný záverečný console assert (helper v `e2e/helpers.ts`).

## Dva sankcionované tvary záverečného console assertu

Guard (`finalConsoleAssertOk`) prijme PRE KAŽDÝ blok práve tieto dva tvary — nič
voľnejšie:

- **(a) default zero-console:** `expect(consoleMsgs).toEqual([])` — žiadna console
  chyba/warning.
- **(b) exact stringMatching-allowlist** (od #245, `error-stranka.spec.ts`):
  `expect(consoleMsgs).toEqual([expect.stringMatching(/…/)[, expect.stringMatching(/…/)]])`
  — pre INHERENTNÝ console riadok testovaného správania (500 chybová stránka VŽDY
  zaloguje `[error] Failed to load resource: … 500` pre hlavný dokument, takže
  `toEqual([])` tam nemôže nikdy prejsť). `toEqual` je ÚPLNÁ rovnosť poľa → assert
  vynucuje PRESNE tie vymenované riadky a NIČ iné; každá ďalšia console chyba pole
  predĺži a padne. **Povolený je LEN `expect.stringMatching(...)` člen** — žiadny
  `toContain`, voľný string, spread ani iný matcher (guard po odstránení všetkých
  stringMatching členov kontroluje, že v poli neostalo nič iné). Tvar (b) použi len keď
  je console riadok NEVYHNUTNÝ artefakt testovaného správania, nie na obídenie iných chýb.

## Počítaj `collectConsole(`, NIKDY `toEqual([])`

Guard invariant je „počet test blokov (`^\s*test\(`) == počet `collectConsole(` volaní"
per súbor. NEPOČÍTAJ `toEqual([])` — niektoré testy majú BIZNISOVÉ `toEqual([])`
(napr. `profil-obrazky` 2, `standard-narezak` 5, `standard-stary` 5 pri 1/3/4 testoch),
takže `count(test)==count(toEqual([]))` by falošne padal na už-správnych súboroch.
Ticketov `grep -c 'test('` tiež nadhodnocuje (matchne neblokové výskyty) — dôveruj
`^\s*test\(` a `collectConsole(`. Per-block záverečný console assert (bod 2 vyššie) je
NEZÁVISLÁ kontrola — viaže sa na KONKRÉTNU console premennú `<v>`
(`expect(<v>).toEqual(…)`), takže biznisové `toEqual([])` na inej premennej ho nemýli.

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
