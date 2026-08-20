---
paths:
  - "src/lib/server/login-throttle.ts"
  - "src/lib/server/auth.ts"
  - "src/routes/login/**"
  - "src/hooks.server.ts"
  - "deploy/docker-compose.yml"
  - "tests/login-*.test.ts"
  - "tests/security-headers.test.ts"
  - "e2e/login-headers.spec.ts"
---

# Login hardening — brute-force throttle, timing, hlavičky (#251)

## `getClientAddress()` za Caddy vracia IP KONTAJNERA, nie klienta — bez `ADDRESS_HEADER`

`src/lib/server/login-throttle.ts` kľúčuje lockout na `(username, ip)`, aby útočník z
cudzej IP NEuzamkol reálneho usera. Ale adapter-node `getClientAddress()` **bez
`ADDRESS_HEADER`** vracia `req.socket.remoteAddress` = TCP peer = **IP Caddy kontajnera
(konštantná pre všetkých)**. Kľúč potom degeneruje na globálny-per-meno a ktokoľvek vie
5 zlými heslami natrvalo zamknúť marka (permanent-lockout DoS). Preto `deploy/docker-compose.yml`
MUSÍ mať:

```yaml
ADDRESS_HEADER: x-forwarded-for
XFF_DEPTH: '1'
```

`XFF_DEPTH=1` číta **posledný** prvok XFF (`addresses[len-1]`) — ten, ktorý Caddy
(`reverse_proxy`) pridá ako reálnu klientsku IP; klientom podstrčený XFF prefix sa
ignoruje → spoof-safe. `getClientAddress()` **hádže**, keď hlavička chýba (priamy hit na
`/health` healthcheck ju nevolá; login akcia ju volá v `try/catch` → bucket `'-'`). Toto
je jediné miesto v appke, ktoré `getClientAddress()` používa (throttle kľúč + log) — nie

## ⚠️ Tento predpoklad NEPLATÍ za Cloudflare — #264 (ešte neopravené)

Vyššie uvedený dizajn predpokladá, že **Caddy je JEDINÝ reverse proxy hop** medzi
klientom a appkou. `app.montalu.cloud` je ale za Cloudflare (`server: cloudflare` +
`cf-ray` hlavičky, DNS na Cloudflare anycast IP) — reťazec je klient → Cloudflare edge
→ Caddy → app. Posledný prvok XFF, ktorý Caddy pridáva, je vtedy IP **Cloudflare edge
node**, nie prehliadača klienta (potvrdené post-deploy verifikáciou #251 na v0.24.11:
zalogovaná `ip` bola `172.70.225.170`, v rozsahu Cloudflare `172.64.0.0/13`, nie reálna
IP testujúceho). `(username, ip)` throttle kľúč sa tak môže zdieľať naprieč viacerými
reálnymi userami cez rovnaký Cloudflare PoP. Fix (buď `Cf-Connecting-Ip` hlavička,
alebo `XFF_DEPTH` prepočítaný o Cloudflare hop) je otvorený v #264 — kým nie je
zavretý, NEDÔVERUJ `ip` v throttle logoch ako reálnej klientskej IP.
je to auth/access rozhodnutie, takže ani teoretický XFF spoof nie je bypass loginu.

## SvelteKit akcia: kontrola PRED `await` sa musí RE-CHECKnúť PO `await`

Admission control (lockout check) VOLANÝ pred `await applyLoginBackoff(...)` a už nikdy
potom = **concurrency bypass**: N súbežných požiadaviek prejde počiatočnú kontrolu (všetky
vidia `failures < 5`) a vyhodnotí N scryptov. Fix v `login/+page.server.ts`: **re-check
`lockoutRemainingMs` HNEĎ po awaite**, pred `login()`. `scryptSync` + `recordFailure` sú
synchrónne (žiadny `await` medzi re-checkom a záznamom) → Node event loop ich spraví
atomicky → admission sa efektívne serializuje → max `MAX_FAILURES` scryptov. Regres test:
`Promise.all` N=40 → `evaluated <= MAX_FAILURES` (RED bez re-checku = 40).

## Timing-oracle test porovnáva MINIMUM, nie medián — inak flaky pod plným behom

`tests/login-timing.test.ts` dokazuje, že neznáme meno aj zlé heslo spustia jeden scrypt
(cez `DUMMY_HASH` v `auth.ts`). Pod PLNÝM `npm test` (1500+ testov) + v8 coverage
inštrumentáciou je CPU kontencia veľká a **mediány driftujú > 20 % → flaky**. Kontencia
čas iba PRIDÁVA, takže **minimum** každej cesty = čistá, nerušená cena scryptu = presne
ten časový signál, ktorý útočník odčíta. Minimá sú deterministické → porovnávaj
`Math.min(...unknown)` vs `Math.min(...wrong)`, nie mediány. (V izolácii prejdú oba;
flakiness sa prejaví len pod záťažou — over cez `npm test`, nie `vitest run <file>`.)

## Zložený Map kľúč: `JSON.stringify([a, b])`, NIE znakový oddeľovač

Oddeľovací znak vpísaný cez editačný nástroj sa môže stať literálnym **NUL bajtom** →
git označí `.ts` súbor ako **binárny** (žiadne riadkové diffy, horší review), hoci
lint/check/testy prejdú. Pre zložený kľúč používaj `JSON.stringify([x, y])` — jednoznačné,
bez kolízie, plne textové.

## Bezpečnostné hlavičky v `hooks.server.ts` `handle` — po `resolve()`, BEZ CSP

`response.headers.set(...)` po `await resolve(event)` pokrýva všetky vyrenderované
odpovede (200 rendery incl. `/login`, `/zasklenia`, aj 404/500). 3xx redirecty z
`redirect()` throw ich nenesú (bezobsahové — OK). **BEZ Content-Security-Policy** (#251):
three.js/inline štýly Svelte = riziko rozbitia; CSP samostatne ak sa ukáže bezpečné.
`Permissions-Policy` je minimálny (`camera=(), microphone=(), geolocation=()`) — WebGL
Permissions-Policy neriadi. E2E číta hlavičky cez `res.headers()` (malé písmená).
