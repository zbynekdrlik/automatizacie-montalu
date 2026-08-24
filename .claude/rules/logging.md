---
paths:
  - "src/lib/server/log.ts"
  - "src/lib/server/money-audit.ts"
  - "src/hooks.server.ts"
  - "src/routes/+error.svelte"
  - "tests/log.test.ts"
  - "tests/*-log.test.ts"
  - "tests/money-audit.test.ts"
---

# Logging & error handling (#245)

## Štruktúrovaný logger — `src/lib/server/log.ts`

Bez-závislostný (žiadny pino/winston — ich bundling v adapter-node je integračné riziko
neoveriteľné v Tier-0 worktree, pridaná hodnota tu nulová; viď design komentár #245). API:

- `logger('modul')` → `{ debug, info, warn, error }(msg, fields?)` + `.child('sub')`
  (modul sa vnorí na `modul:sub`). `log` = base logger `'app'`.
- Jeden JSON riadok na udalosť na `process.stdout` (Docker json-file ho zbiera, rotácia
  `max-size 10m`/`max-file 5`). POZOR: stdout json-file je **container-scoped** — pri
  redeployi (recreate) zmizne. Preto money udalosti majú AJ perzistentný súborový sink
  (#297, nižšie).
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

## Money-audit forenzný súbor — perzistencia mimo kontajnera (#297)

`src/lib/server/money-audit.ts` je DRUHÝ sink loggera. `emit` (log.ts) píše ROVNAKÝ
redigovaný JSON riadok na stdout AJ (keď je `MONEY_AUDIT_LOG` nastavené) do súboru cez
`appendMoneyAudit`, ale LEN pre:

- modul `money` alebo `money:*` (`isMoneyModule` — presná zhoda, nie `moneybags`), A
- level **info+** (konštanta `AUDIT_MIN`) — money `debug` sa do súboru NEpíše.

Kľúčové: audit sink je **NEZÁVISLÝ od stdout `LOG_LEVEL`** — `log.info('odpis zapísaný'/
'uvoľnený'/'claim')` sú forenzne najdôležitejšie a sú `info`, takže by ich zvýšenie
`LOG_LEVEL` na `warn`/`error` umlčalo na stdoute; do súboru idú vždy. Modul má vlastnú
size-based rotáciu nad `node:fs` (`MONEY_AUDIT_MAX_BYTES` default 5 MB, `MONEY_AUDIT_KEEP`
default 5 archívov `.1..N`) — ŽIADNY pino/pino-roll/winston (to isté #245 bundling-riziko).
Zápis je **best-effort**: každé zlyhanie sa prehltne (forenzný audit NIKDY nezhodí
požiadavku, rovnaký kontrakt ako stdout).

Perzistencia: env `MONEY_AUDIT_LOG=/data/money-log/money.jsonl` (compose) → dedikovaný
**named volume `moneylog`** (nie bind mount — named volume je preflight-safe, deploy-remote
kontroluje len bind-mounty). Prežije redeploy (recreate). Čerstvý volume zdedí owner
node:node z image (`Dockerfile mkdir -p /data/money-log && chown node:node`); obranný
`chown -R 1000:1000 /data/money-log` je aj v `deploy-remote.sh migrate_ownership`.
Feature je vypnutá keď `MONEY_AUDIT_LOG` nie je nastavené (napr. v testoch/lokálne) —
`auditPath()` vráti null a sink je no-op. Testy: `tests/money-audit.test.ts` (nastav env
na temp súbor + `afterEach delete` — inak LEAKNE do ďalších money testov toho istého workera).

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
