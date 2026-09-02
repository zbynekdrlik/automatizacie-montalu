---
paths:
  - 'src/lib/server/odoo-sso.ts'
  - 'src/hooks.server.ts'
  - 'src/lib/server/auth.ts'
  - 'src/routes/logout/+server.ts'
  - 'tests/odoo-sso.test.ts'
  - 'tests/hooks-sso.test.ts'
---

# SSO cez Odoo session (#5823 — appka pod `/automatizacie/` v Odoo iframe)

Interní zamestnanci sa do appky prihlásia svojou **Odoo session** (cookie `session_id`), nie druhým
lokálnym heslom. B2B a verejný konfigurátor ostávajú na lokálnom logine — SSO je iba PREDRADENÉ
lokálnej identite v `hooks.server.ts`, nikdy ju nenahrádza:

```
const sid = ssoEnabled() ? cookies.get(ODOO_SESSION_COOKIE) : undefined;
locals.user = (sid ? await resolveOdooSso(sid) : null) ?? getSessionUser(cookies.get(SESSION_COOKIE));
```

## Gotchy (stáli ma čas — nasledujúci integračný ticket nech ich nerieši znova)

- **undici `fetch` STRIPUJE ručne nastavený `Host` header** (empiricky overené). SSO transport volá
  interné Odoo (`ODOO_INTERNAL_URL`) s `Host: <ODOO_SSO_HOST>` override (aby Odoo trafilo správny
  db/website). Preto default transport NIE JE `fetch`, ale **`node:http` / `node:https`** — jediná
  cesta ako kontrolovať `Host`. Transport je injektovateľný (`setSsoTransport`) pre testy.
- **Transport MUSÍ vždy settlovať, aj pri truncated/aborted response** — inak per-user hang (jeden
  užívateľ zablokuje request navždy). Povinné: hoisted `finish(err,val)` guard (raz), tvrdý
  `setTimeout` deadline, a `res` handlery na `'aborted'`/`'close'`/`'error'`. (Toto našiel až
  adversariálny review, self-review to prehliadol.)
- **Akceptačná brána je PRÍSNA:** identita platí LEN keď HTTP 200 ∧ `uid > 0` ∧
  `is_internal_user === true` ∧ neprázdny `username`. Portálový/share user (nie internal) = padá na
  lokálny login, nie na Odoo identitu.
- **Identita je EFEMÉRNA** — `SessionUser.source === 'odoo'`, neukladá sa do lokálnej DB; logout
  formulár je pre ňu skrytý (Odoo session sa odhlasuje v Odoo). Cache `sha256(sid)` (LRU ~500) +
  in-flight Promise dedup; `evictSsoCache(sid)` na logout.
- **Celé je env-gated** — `ODOO_SSO_ENABLED` + `ODOO_INTERNAL_URL` + `ODOO_SSO_HOST`; keď vypnuté,
  `ssoEnabled()` je false a appka beží čisto na lokálnom logine (žiadny sieťový hop).
