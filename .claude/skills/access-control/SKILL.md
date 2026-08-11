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
3. `deleteB2BUser` refuses non-b2b rows in the DB helper itself.
Test the boundary with a **forged POST** (call the action directly with a b2b
`locals.user`), not just "button hidden" — see `tests/b2b-money-reject.test.ts`.

**`/pouzivatelia` `pridat` reads `role` from the form (#142)** — this stopped being a
trust boundary the moment `pridat` started gating `isB2B(locals.user)` as its FIRST
statement (before the form is even parsed): a b2b actor never reaches the `role` field
at all, so a forged `role=internal` in the POST body cannot escalate — only an actor
ALREADY internal can choose a role, and an internal actor choosing 'internal' is not an
escalation (same trust level as the old direct-DB-write path). `changeUserRole` (role
switch on an EXISTING account) is gated the identical way, plus two extra guards: an
actor cannot change their OWN role (compares `id`, not `username` — see §5) and the
LAST `internal` account cannot be demoted to `b2b` (`countInternalUsers() <= 1`). Every
account create/role-change is written to `user_audit` (actor, action, target,
timestamp) — a dedicated table, not `cfg_audit` (that one is schema-bound to
`sys_styl`/formula edits). Forged-POST coverage: `tests/pouzivatelia-actions.test.ts`.

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
no-op for existing users. Provision/manage accounts via the internal-only `/pouzivatelia`
admin page (`addUser` with a chosen role, `changeUserRole` to promote/demote an existing
account, `deleteB2BUser` for b2b cleanup), not env re-seed (seed only runs on an empty
users table) and never a direct `docker exec`/SQL `UPDATE` — the #142 incident (an
internal account created via the app's only-B2B form, fixed by hand in prod) is exactly
what the UI-level role choice + role-switch now cover.

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

## 6. b2b immediate (client-side) width block — pure logic in `$lib/`, gate on field bounds

The b2b width limit blocks IMMEDIATELY on input (reactive `$derived` in
`zasklenia/+page.svelte`) — the "Spočítať" button is `disabled={b2bBlok}` while the
width is out of range, so a b2b user never reaches compute with an invalid width (v0.6.3).
Two gotchas learned building it:

- **Shared limit logic MUST live in `$lib/` (client-safe), not `$lib/server/`.** A
  value-import of a `$lib/server/*` module into a `.svelte` component 500s. So the pure
  checks live in `src/lib/b2b-limits.ts` (takes a plain `StyleN[]` = `{sysStyl,system,styl,N}[]`,
  fed from `data.styly`); `src/lib/server/b2b-limits.ts` is a thin adapter that maps the
  server `Cfg` → `StyleN[]` and re-exports, **preserving the original `checkB2BWidth(cfg,…)`
  signature** so `+page.server.ts` and its tests are untouched. `data.styly[].N` and the
  server's `cfg[sysStyl].N` are the SAME raw `cfg_sys.n` column → client and server block
  decisions provably match.
- **Gate the reactive check on the field's own `min`/`max`** (helper `dimOrNull` returns
  the value only within `[300, 20000]` mm). Without it, a user typing a valid width
  digit-by-digit (`3 → 30 → 300 → 3000`) sees a spurious ⛔ + disabled button flash on
  every sub-min intermediate value (review 🔵, fixed in v0.6.3). Native `min`/`max`
  validation + the server-side check still guard submit — the client block is UX only.
- **This is client-side UX, NOT the security boundary.** The Money-write lock (§2) and the
  server `checkB2BWidth` backstop in `nahlad`/`nahladMulti` remain authoritative: a b2b
  user editing the DOM to re-enable the button still hits the server check. b2b-only gating
  is airtight — every `$derived` early-returns `null` when `!isB2B`, and `b2bBlok = isB2B && …`,
  so internal users are never affected. Regression guards: the b2b lifecycle E2E asserts the
  immediate block + disabled button; an internal-negative E2E asserts internal users see no
  block at the same oversized width.
