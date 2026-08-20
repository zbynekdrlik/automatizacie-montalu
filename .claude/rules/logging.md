---
paths:
  - "src/lib/server/log.ts"
  - "src/hooks.server.ts"
  - "src/routes/+error.svelte"
  - "tests/log.test.ts"
  - "tests/*-log.test.ts"
---

# Logging & error handling (#245)

## Štruktúrovaný logger — `src/lib/server/log.ts`

Bez-závislostný (žiadny pino/winston — ich bundling v adapter-node je integračné riziko
neoveriteľné v Tier-0 worktree, pridaná hodnota tu nulová; viď design komentár #245). API:

- `logger('modul')` → `{ debug, info, warn, error }(msg, fields?)` + `.child('sub')`
  (modul sa vnorí na `modul:sub`). `log` = base logger `'app'`.
- Jeden JSON riadok na udalosť na `process.stdout` (Docker json-file ho zbiera; rotácia = iný ticket).
- Level z `LOG_LEVEL` (`debug`/`info`/`warn`/`error`/`silent`), číta sa PER volanie.
  **Default: pod testom (`VITEST`/`NODE_ENV=test`) je `silent`** — nech 700+ testov
  nezaplaví stdout; mimo testu `debug` (MVP, comprehensive-logging).
- `Error` hodnoty sa serializujú na `{name,message,stack}`. Kľúče
  `password|pass|pass_hash|token|secret|authorization|cookie` sa redigujú (`[redacted]`).
- **NIKDY neposielaj do loggera heslo / SEED_USERS hodnotu / session token** — redakcia je
  defense-in-depth, nie povolenie. Nový server modul loguje cez `const log = logger('<modul>')`.
- **Klientsky (`.svelte` browser) kód logger POUŽIŤ NEVIE** (`$lib/server` je server-only,
  import do browser kódu 500-uje) — tam ostáva `console.*` (2 výskyty: Vizual3D,
  zasklenia/navrh/zakaznicky). Logger rieši SERVER console.*, nie klientske.

## Testovanie logov — gotcha (vzor: `tests/*-log.test.ts`)

Aby test videl log riadok:
1. Importuj server moduly PRV (kým `LOG_LEVEL` nie je nastavený → migrácie pri importe
   ticho, žiadny šum), AŽ POTOM `process.env.LOG_LEVEL = 'info'` (alebo `'warn'`/`'error'`).
   Ak štartový/migračný log beží PRI importe (`startup-log.test.ts`), musíš level nastaviť
   PRED importom a spy nasadiť tiež pred importom (inak riadok zmeškáš).
2. Spy na `process.stdout.write` (`mockImplementation` zbiera riadky, nič sa nevypíše),
   potom parsuj JSON riadky.
3. `afterAll(() => delete process.env.LOG_LEVEL)` — inak level LEAKNE do ďalších test
   súborov toho istého vitest workera a začnú tlačiť logy.

## Štartový config riadok žije v `hooks.server.ts`, NIE `db.ts`

Ticket #245 ho pýtal do `db.ts`, ale `db.ts → money/ceny` import by vyrobil cyklus
(`money.ts`/`ceny.ts` už importujú `db`). Preto `logger('startup').info('štart', {...})`
(verzia, `DB_PATH`, `MONEY_LIVE`, live/test/naOdpis adresáre, `CENY_SNAPSHOT_PATH`) je
v `hooks.server.ts` (leaf modul) a číta `moneyConfig()` (money.ts) / `cenySnapshotPath()`
(ceny.ts) / exportovaný `DB_PATH` (db.ts) — bez cyklu (large-file-split rule: radšej žiadny
cyklus než ESM-hoisting cyklus). Verzia sa berie cez `typeof __APP_VERSION__ !== 'undefined'
? __APP_VERSION__ : …` (guard, nech nespadne mimo Vite define).

## handleError + chybová stránka

- `handleError` (hooks.server.ts) sa volá LEN pre NEOČAKÁVANÉ chyby (500) — očakávané
  `error(404,…)` sem NEidú (ich správu ukáže +error.svelte priamo). Vygeneruje `errorId`
  (`randomBytes(6).toString('hex')` = 12 hex), zaloguje error+stack+pathname+method+username+
  status, vráti bezpečnú SK správu + `errorId`. Typ `App.Error` (v `app.d.ts`) má `errorId?`.
- `+error.svelte` číta `page.error.errorId` cez `$app/state` (nie deprecated `$app/stores`),
  linky cez `resolve()` (svelte/no-navigation-without-resolve). `data-testid`: `error-message`,
  `error-id`.
- E2E chybovej stránky: gated test route `src/routes/__test-error/` hodí neočakávanú 500 LEN
  keď `ENABLE_TEST_ERROR_ROUTE=1` (inak `error(404)`); je v `B2B_FORBIDDEN_PREFIXES` (inak by
  `b2b-route-coverage` drift guard padol); playwright `webServer.env` ju zapne, VPS nikdy.
  Spec skipne na `BASE_URL`. Vzor: `e2e/error-stranka.spec.ts`.
