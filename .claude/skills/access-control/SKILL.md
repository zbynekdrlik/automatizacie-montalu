# Access control — roles, route gating, Money-write boundary

App auth: `users(username, pass_hash, role)` + `sessions`, cookie `am_session`,
`locals.user = {id, username, role}` set in `hooks.server.ts` via `getSessionUser`.
Roles: `internal` (full) vs `b2b` (veľkoobchod — len `/zasklenia`, nárezák + PDF,
ŽIADNY odpis do Money). Helpers `isB2B(user)` / `isInternal(user)` in `auth.ts`
(both null-safe: `isB2B(null)===false`).

## 1. Route gating = DENYLIST, never allowlist

`hooks.server.ts` restricts `b2b` via `b2bRedirectTarget(pathname)` (`b2b-access.ts`)
= a denylist of forbidden PAGE prefixes + exact `/`. **Never an allowlist** — an
allowlist on `/zasklenia` would block SvelteKit's `/_app/*` JS/CSS assets → blank
page. Assets/`/favicon`/`/logout`/`/health` must always pass; a denylist lets them
through by construction. Form-action POSTs (`POST /pergola?/odoslat`) hit the hook
with `pathname === '/pergola'` (the `?/action` is in `search`), so the denylist
redirects them BEFORE the action body runs — that is why denied pages need no extra
per-action guard.

## 2. Enforce the Money-write boundary SERVER-SIDE, layered — never UI-only

Hiding a button is not security. The b2b Money-write lock is 3 layers:
1. `hooks.server.ts` denylist redirects b2b off every write page except `/zasklenia`.
2. `/zasklenia` is the one write-page b2b may open, so its `odoslat`/`odoslatMulti`
   actions reject b2b as the **first statement** (before parse/compute/write):
   `if (isB2B(locals.user)) return { step: 'form', error: '…' }`.
3. `deleteB2BUser` refuses non-b2b rows in the DB helper itself; `/pouzivatelia`
   `pridat` hardcodes `role='b2b'` (never from form input) — a forged field can't
   escalate.
Test the boundary with a **forged POST** (call the action directly with a b2b
`locals.user`), not just "button hidden" — see `tests/b2b-money-reject.test.ts`.

## 3. Fail-OPEN drift guards (CI tests) — the denylist's weak spot

A denylist + a per-system limits map both fail OPEN for anything not listed: a NEW
write-route someone forgets to deny, or a NEW glazing system with no `B2B_LIMITS`
entry, becomes b2b-reachable / unlimited by default. Two guard tests catch the drift
in CI (`tests/b2b-route-coverage.test.ts`, `tests/b2b-limits.test.ts`):
- enumerate `src/routes/*/+page.server.ts|+server.ts` dirs; assert every one except
  `/zasklenia` + public (`/login`,`/logout`,`/health`) is redirected by
  `b2bRedirectTarget` → a new mutating route FAILS CI until denied.
- assert `Object.keys(B2B_LIMITS)` ⊇ seeded systems (`loadCfg` keys) → a new system
  without limits FAILS CI.
When you add a denylist or a config-keyed policy, add its coverage guard too.

## 4. Adding a role / column to a LIVE, in-use DB

App is in active use → migrations are **additive + idempotent**. `role` shipped as
`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'internal'` (v8), guarded by
`PRAGMA user_version < N` + a `PRAGMA table_info` column check. `migrate()` runs at
module load (adapter-node imports `db.ts`) BEFORE the HTTP listener binds, and
better-sqlite3 is synchronous → no request ever sees a half-migrated schema. ADD
COLUMN with a constant default is O(1) (no row rewrite). Existing sessions survive
(sessions table untouched; existing users resolve to the default). A role/permission
feature stays INERT until the first privileged account exists — so the deploy is a
no-op for existing users. Provision new restricted accounts via the internal-only
`/pouzivatelia` admin page (`addUser`/`deleteB2BUser`), not env re-seed (seed only
runs on an empty users table).

## 5. Usernames match CASE-INSENSITIVELY (login + dup-check)

Usernames are often **e-mails** (first B2B account: `obchod@phsplus.cz`). Phone/tablet
keyboards auto-capitalize the first letter, so a user types `Obchod@…` for a stored
`obchod@…`. SQLite's default BINARY collation made that a non-match → the account
"couldn't log in" with the correct password (live bug, v0.5.22). Both the `login()`
lookup and `addUser()` duplicate-check use `WHERE username = ? COLLATE NOCASE` so case
never blocks a login and two case-only-different accounts can't coexist. `COLLATE
NOCASE` is ASCII-only — fine for e-mail/ASCII handles; a non-ASCII (accented) username
would not be case-folded. `login()` also `.trim()`s the username. Regression test:
`tests/login-case-insensitive.test.ts` (RED→GREEN). Passwords stay case-SENSITIVE and
untrimmed (only the name is normalized).
