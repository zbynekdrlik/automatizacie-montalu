# B2B Wholesale Role + Dimension Limits — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `b2b` wholesale user role restricted to Zasklenia (nárezák + PDF only, no Money odpis), enforce per-system width/height limits for b2b users, and add an internal-only user-admin page.

**Architecture:** Additive SQLite migration v8 adds a `role` column to `users` (default `internal`). Role flows through `SessionUser` → `locals.user`. A denylist in `hooks.server.ts` restricts b2b to `/zasklenia`. A pure `b2b-limits.ts` module computes per-panel width (`S/N`) and validates against per-system limits, suggesting the correct style. The feature is **inert until a b2b account exists** — the app is in live production use, so every change is additive and leaves the internal flow bit-identical.

**Tech Stack:** SvelteKit (Svelte 5 runes), better-sqlite3, TypeScript, Vitest (unit), Playwright (e2e), adapter-node.

## Global Constraints

- Version already bumped to **0.5.20** (plain semver, no `-dev` suffix — matches convention).
- **App is in live use.** Migration v8 MUST be additive + idempotent; existing users default to `internal`; internal flow must stay bit-identical.
- **Money safety:** b2b never writes to Money (UI hides + server rejects). All tests run with `MONEY_LIVE` unset/off. Never write to real Money.
- All limit logic enforced **server-side**; client mirrors are UX only.
- User-facing copy in **Slovak**.
- TDD: failing test first, then implementation, frequent commits.
- N (panel count) per style lives on `cfg_sys.n`; access via `loadCfg()` → `cfg[sysStyl].N`.
- Systems/styles/N: Robust {2K:2,3K:3,4K:4,2x2K:4,2x3K:6,2x4K:8}; Slide {2K:2,3K:3,2x2K:4,2x3K:6}; Deluxe {2K:2,3K:3,4K:4,2x2K:4,2x3K:6,2x4K:8,5K:5,6K:6}.
- Limits: Deluxe minPanel 800 / maxPanel 1000 / maxHeight 2500; Slide 800/1300/2500; Robust 800/1500/**2600**.

---

### Task 1: Migration v8 — `role` column + role in session

**Files:**
- Modify: `src/lib/server/db.ts` (add v8 migration block after the v7 block, ~line 310; extend `seedUsers` to carry role)
- Modify: `src/lib/server/auth.ts` (extend `SessionUser`, `getSessionUser`; add `isB2B`/`isInternal`)
- Test: `tests/migration-v8.test.ts` (new), `tests/auth-role.test.ts` (new)

**Interfaces:**
- Produces: `SessionUser` now has `role: UserRole`; `type UserRole = 'internal' | 'b2b'`; `isB2B(u: SessionUser | null): boolean`; `isInternal(u: SessionUser | null): boolean`. DB `users.role` column (default `'internal'`).

- [ ] **Step 1: Write the failing migration test**

Create `tests/migration-v8.test.ts` — builds a v7-state DB (users table WITHOUT role), imports the real `db.ts`, asserts v8 added `role` default `internal` and existing users untouched:

```ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v8-test-'));
const dbPath = path.join(tmpRoot, 'v7.db');

// Build a DB in v7 state: users table with NO role column, one existing user.
{
	const v7 = new Database(dbPath);
	v7.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
		CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL UNIQUE, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0);
	`);
	v7.prepare('INSERT INTO users (username, pass_hash) VALUES (?, ?)').run('palo', 'x:y');
	v7.pragma('user_version = 7');
	v7.close();
}

process.env.DATABASE_PATH = dbPath;
const { db } = await import('../src/lib/server/db');

describe('migrácia v7 → v8: role stĺpec', () => {
	it('pridá role default internal, existujúci user nedotknutý, user_version=8', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(8);
		const cols = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name);
		expect(cols).toContain('role');
		expect(db.prepare("SELECT role FROM users WHERE username='palo'").get()).toEqual({ role: 'internal' });
	});
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/migration-v8.test.ts`
Expected: FAIL (`user_version` is 7, no `role` column).

- [ ] **Step 3: Add the v8 migration block**

In `src/lib/server/db.ts`, immediately after the v7 block closes (`})();` at ~line 310, before `seedData();`), insert:

```ts
	if ((db.pragma('user_version', { simple: true }) as number) < 8) {
		// v7 → v8: B2B veľkoobchodná rola. Aditívne — appka je v ostrom používaní,
		// existujúci users → 'internal' (default), interný tok sa nemení. Feature je
		// neaktívny, kým nevznikne prvý 'b2b' účet. Idempotentné cez PRAGMA + column check.
		const userCols = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map(
			(c) => c.name
		);
		if (!userCols.includes('role'))
			db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'internal'");
		db.pragma('user_version = 8');
	}
```

- [ ] **Step 4: Run migration test, verify pass**

Run: `npx vitest run tests/migration-v8.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing auth-role test**

Create `tests/auth-role.test.ts` — verifies `getSessionUser` returns `role`, and `isB2B`/`isInternal`. Uses a fresh temp DB seeded via db helpers:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-authrole-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'a.db');

const db = await import('../src/lib/server/db');
const auth = await import('../src/lib/server/auth');

describe('rola v session + helpery', () => {
	it('isB2B/isInternal', () => {
		expect(auth.isB2B({ id: 1, username: 'x', role: 'b2b' })).toBe(true);
		expect(auth.isB2B({ id: 1, username: 'x', role: 'internal' })).toBe(false);
		expect(auth.isB2B(null)).toBe(false);
		expect(auth.isInternal({ id: 1, username: 'x', role: 'internal' })).toBe(true);
		expect(auth.isInternal(null)).toBe(false);
	});

	it('getSessionUser vracia role', () => {
		db.db.prepare("INSERT INTO users (username, pass_hash, role) VALUES ('b2buser', 'x:y', 'b2b')").run();
		const uid = (db.db.prepare("SELECT id FROM users WHERE username='b2buser'").get() as { id: number }).id;
		db.db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)').run('tok1', uid, Date.now() + 100000);
		const u = auth.getSessionUser('tok1');
		expect(u).toEqual({ id: uid, username: 'b2buser', role: 'b2b' });
	});
});
```

- [ ] **Step 6: Run it, verify it fails**

Run: `npx vitest run tests/auth-role.test.ts`
Expected: FAIL (`isB2B` undefined; `getSessionUser` returns no `role`).

- [ ] **Step 7: Extend `auth.ts`**

In `src/lib/server/auth.ts`:
- Replace the `SessionUser` interface:

```ts
export type UserRole = 'internal' | 'b2b';

export interface SessionUser {
	id: number;
	username: string;
	role: UserRole;
}
```

- In `getSessionUser`, add `u.role` to the SELECT and the return:

```ts
	const row = db
		.prepare(
			`SELECT u.id, u.username, u.role, s.expires_at FROM sessions s
			 JOIN users u ON u.id = s.user_id WHERE s.token = ?`
		)
		.get(token) as { id: number; username: string; role: UserRole; expires_at: number } | undefined;
	if (!row) return null;
	if (row.expires_at < Date.now()) {
		logout(token);
		return null;
	}
	return { id: row.id, username: row.username, role: row.role };
```

- Add helpers at the end of the file:

```ts
export function isB2B(user: SessionUser | null): boolean {
	return user?.role === 'b2b';
}

export function isInternal(user: SessionUser | null): boolean {
	return !!user && user.role !== 'b2b';
}
```

- [ ] **Step 8: Run both tests, verify pass**

Run: `npx vitest run tests/migration-v8.test.ts tests/auth-role.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/server/db.ts src/lib/server/auth.ts tests/migration-v8.test.ts tests/auth-role.test.ts
git commit -m "feat: add b2b role — migration v8 + SessionUser.role + isB2B/isInternal"
```

---

### Task 2: User-admin DB helpers

**Files:**
- Modify: `src/lib/server/db.ts` (add `listUsers`, `addUser`, `deleteB2BUser` near other exports)
- Test: `tests/users-admin.test.ts` (new)

**Interfaces:**
- Consumes: `hashPassword` (db.ts), `UserRole` (auth.ts).
- Produces: `listUsers(): { id: number; username: string; role: string; created_at: string }[]`; `addUser(username: string, password: string, role: 'internal' | 'b2b'): { error: string | null }`; `deleteB2BUser(id: number): { error: string | null }` (refuses non-b2b accounts).

- [ ] **Step 1: Write the failing test**

Create `tests/users-admin.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-usersadmin-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'u.db');
const db = await import('../src/lib/server/db');

describe('user-admin helpery', () => {
	it('addUser vytvorí b2b, listUsers ho vráti, duplicitný meno chyba', () => {
		expect(db.addUser('velkoobchod1', 'tajneheslo', 'b2b')).toEqual({ error: null });
		const users = db.listUsers();
		const u = users.find((x) => x.username === 'velkoobchod1');
		expect(u?.role).toBe('b2b');
		expect(db.addUser('velkoobchod1', 'ine', 'b2b').error).toBeTruthy(); // duplicitný
		expect(db.addUser('  ', 'heslo', 'b2b').error).toBeTruthy(); // prázdny username
		expect(db.addUser('kratke', '123', 'b2b').error).toBeTruthy(); // heslo < 6
	});

	it('deleteB2BUser zmaže b2b, odmietne internal', () => {
		db.addUser('vo2', 'tajneheslo', 'b2b');
		const vo2 = db.listUsers().find((x) => x.username === 'vo2')!;
		expect(db.deleteB2BUser(vo2.id)).toEqual({ error: null });
		expect(db.listUsers().find((x) => x.username === 'vo2')).toBeUndefined();

		db.db.prepare("INSERT INTO users (username, pass_hash, role) VALUES ('interny', 'x:y', 'internal')").run();
		const interny = db.listUsers().find((x) => x.username === 'interny')!;
		expect(db.deleteB2BUser(interny.id).error).toBeTruthy(); // nezmaže internal
		expect(db.listUsers().find((x) => x.username === 'interny')).toBeDefined();
	});
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/users-admin.test.ts`
Expected: FAIL (`addUser` undefined).

- [ ] **Step 3: Add the helpers to `db.ts`**

Append near the end of `src/lib/server/db.ts` (after `verifyPassword`, module-level exports section):

```ts
export function listUsers() {
	return db
		.prepare('SELECT id, username, role, created_at FROM users ORDER BY role, username')
		.all() as { id: number; username: string; role: string; created_at: string }[];
}

export function addUser(
	username: string,
	password: string,
	role: 'internal' | 'b2b'
): { error: string | null } {
	const u = username.trim();
	if (!u) return { error: 'Meno účtu je povinné.' };
	if (password.length < 6) return { error: 'Heslo musí mať aspoň 6 znakov.' };
	const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(u);
	if (exists) return { error: `Účet „${u}" už existuje.` };
	db.prepare('INSERT INTO users (username, pass_hash, role) VALUES (?, ?, ?)').run(
		u,
		hashPassword(password),
		role
	);
	return { error: null };
}

/** Zmaže LEN b2b účet (interné účty nie — ochrana proti lockoutu). Sessions padnú cez CASCADE. */
export function deleteB2BUser(id: number): { error: string | null } {
	const row = db.prepare('SELECT role FROM users WHERE id = ?').get(id) as { role: string } | undefined;
	if (!row) return { error: 'Účet neexistuje.' };
	if (row.role !== 'b2b') return { error: 'Zmazať sa dajú len B2B účty.' };
	db.prepare('DELETE FROM users WHERE id = ?').run(id);
	return { error: null };
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/users-admin.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/db.ts tests/users-admin.test.ts
git commit -m "feat: user-admin db helpers (listUsers, addUser, deleteB2BUser)"
```

---

### Task 3: `b2b-limits.ts` — width/height validation + style suggestion

**Files:**
- Create: `src/lib/server/b2b-limits.ts`
- Test: `tests/b2b-limits.test.ts` (new)

**Interfaces:**
- Consumes: `Cfg` type + `loadCfg()` shape from `compute.ts` (each `cfg[sysStyl]` has `.N`). Reads system from `sysStyl.split('|')[0]`, styl from `split('|')[1]`.
- Produces:
  - `B2B_LIMITS: Record<string, { minPanel: number; maxPanel: number; maxHeight: number }>`
  - `checkB2BWidth(cfg: Cfg, sysStyl: string, S: number): string | null` — returns Slovak error (with suggestion) or `null` if OK.
  - `checkB2BHeight(sysStyl: string, V: number): string | null` — returns Slovak warning if over max height, else `null` (does NOT block).

- [ ] **Step 1: Write the failing test**

Create `tests/b2b-limits.test.ts`. Build a minimal `cfg` via `loadCfg()` after seeding (import db to trigger seed), then assert:

```ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-b2blim-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'l.db');
await import('../src/lib/server/db'); // triggers migrate + seed (all systems/styles)
const { loadCfg } = await import('../src/lib/server/db');
const { checkB2BWidth, checkB2BHeight, B2B_LIMITS } = await import('../src/lib/server/b2b-limits');
const cfg = loadCfg();

describe('checkB2BWidth', () => {
	it('Deluxe 2K@3000 → blok, poradí 3K', () => {
		const err = checkB2BWidth(cfg, 'Deluxe|2K', 3000);
		expect(err).toBeTruthy();
		expect(err).toContain('3K');
	});
	it('Deluxe 3K@3000 → OK (1000 = max)', () => {
		expect(checkB2BWidth(cfg, 'Deluxe|3K', 3000)).toBeNull();
	});
	it('Deluxe 2K@1800 → OK (900 v rozsahu)', () => {
		expect(checkB2BWidth(cfg, 'Deluxe|2K', 1800)).toBeNull();
	});
	it('dvojité: 2x2K@6000 Deluxe → blok, poradí 2x3K (rovnaká rodina)', () => {
		const err = checkB2BWidth(cfg, 'Deluxe|2x2K', 6000);
		expect(err).toBeTruthy();
		expect(err).toContain('2x3K');
	});
	it('mŕtva zóna: Deluxe 2K@3100 → blok bez fungujúceho štýlu (3K=1033>max, 4K=775<min)', () => {
		const err = checkB2BWidth(cfg, 'Deluxe|2K', 3100);
		expect(err).toBeTruthy();
		expect(err).toContain('Uprav šírku');
	});
	it('Robust širší limit: 2K@2800 → OK (1400 ≤ 1500)', () => {
		expect(checkB2BWidth(cfg, 'Robust|2K', 2800)).toBeNull();
	});
	it('príliš úzke: Deluxe 3K@2000 → blok, poradí menej polí (2K = 1000 OK)', () => {
		const err = checkB2BWidth(cfg, 'Deluxe|3K', 2000);
		expect(err).toBeTruthy();
		expect(err).toContain('2K');
	});
});

describe('checkB2BHeight', () => {
	it('Deluxe 2600 → warning (nad 2500)', () => {
		expect(checkB2BHeight('Deluxe|2K', 2600)).toContain('BEZ ZÁRUKY');
	});
	it('Deluxe 2500 → OK (hranica)', () => {
		expect(checkB2BHeight('Deluxe|2K', 2500)).toBeNull();
	});
	it('Robust 2600 → OK (Robust má 2600)', () => {
		expect(checkB2BHeight('Robust|2K', 2600)).toBeNull();
	});
	it('Robust 2700 → warning', () => {
		expect(checkB2BHeight('Robust|2K', 2700)).toContain('BEZ ZÁRUKY');
	});
});

describe('B2B_LIMITS', () => {
	it('má tri systémy so správnymi hodnotami', () => {
		expect(B2B_LIMITS.Robust.maxHeight).toBe(2600);
		expect(B2B_LIMITS.Deluxe.maxPanel).toBe(1000);
		expect(B2B_LIMITS.Slide.maxPanel).toBe(1300);
	});
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/b2b-limits.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `b2b-limits.ts`**

Create `src/lib/server/b2b-limits.ts`:

```ts
// B2B rozmerové limity (len pre veľkoobchodných používateľov). Šírka na pole = S/N
// (Dominik: „2K 3000 → sklo 1500, treba 3K po 1000") — počet polí (N) je na sys riadku.
// Interní users tieto kontroly OBCHÁDZAJÚ (volá sa len keď isB2B). Výška NEblokuje,
// len upozorní „bez záruky". Konštanta sa dá neskôr presunúť do editora Vzorce.
import type { Cfg } from './compute';

export const B2B_LIMITS: Record<string, { minPanel: number; maxPanel: number; maxHeight: number }> = {
	Deluxe: { minPanel: 800, maxPanel: 1000, maxHeight: 2500 },
	Slide: { minPanel: 800, maxPanel: 1300, maxHeight: 2500 },
	Robust: { minPanel: 800, maxPanel: 1500, maxHeight: 2600 }
};

// Rodina štýlu: dvojité (opona) začínajú „2x", ostatné sú jednoduché. Návrh štýlu
// ostáva v tej istej rodine (jednoduché ↔ jednoduché, 2x ↔ 2x) — inak by sa zmenil
// typ výrobku.
function family(styl: string): '2x' | 'single' {
	return styl.startsWith('2x') ? '2x' : 'single';
}

/** Štýly daného systému + rodiny, s N, zoradené vzostupne podľa N. */
function familyStyles(cfg: Cfg, system: string, fam: '2x' | 'single'): { styl: string; N: number }[] {
	return Object.keys(cfg)
		.filter((k) => k.startsWith(system + '|'))
		.map((k) => ({ styl: k.split('|')[1], N: cfg[k].N }))
		.filter((s) => family(s.styl) === fam)
		.sort((a, b) => a.N - b.N);
}

/**
 * Blok + poradí štýl. Vráti slovenskú chybu (nespočíta sa), alebo null keď S/N sedí
 * do [minPanel, maxPanel] pre zvolený systém.
 */
export function checkB2BWidth(cfg: Cfg, sysStyl: string, S: number): string | null {
	const [system, styl] = sysStyl.split('|');
	const lim = B2B_LIMITS[system];
	if (!lim) return null; // neznámy systém → nelimituj (fail-open na neznáme, biznis limity sú len pre 3 systémy)
	const g = cfg[sysStyl];
	if (!g) return null;
	const panel = S / g.N;
	if (panel >= lim.minPanel && panel <= lim.maxPanel) return null;

	// nájdi štýl v rovnakej rodine, kde S/N ∈ [min,max]; preferuj najmenšie N
	const fam = family(styl);
	const options = familyStyles(cfg, system, fam);
	const fit = options.find((o) => S / o.N >= lim.minPanel && S / o.N <= lim.maxPanel);
	const per = Math.round(panel);
	if (fit && fit.styl !== styl) {
		const smer = panel > lim.maxPanel ? `nad ${lim.maxPanel}` : `pod ${lim.minPanel}`;
		return `Pri šírke ${S} mm a štýle ${styl} by malo jedno sklo ${per} mm (${smer}). Zvoľ ${fit.styl}.`;
	}
	// žiadny štýl v rodine nesedí → mŕtva zóna medzi počtami polí
	const ranges = options
		.map((o) => `${o.styl} = ${Math.round(lim.minPanel * o.N)}–${Math.round(lim.maxPanel * o.N)} mm`)
		.join(', ');
	return `Šírka ${S} mm sa pri ${system} nedá rozdeliť na sklá v rozsahu ${lim.minPanel}–${lim.maxPanel} mm. Platné šírky: ${ranges}. Uprav šírku.`;
}

/** Výška NEblokuje — len warning „bez záruky" nad maxHeight. Vráti text alebo null. */
export function checkB2BHeight(sysStyl: string, V: number): string | null {
	const system = sysStyl.split('|')[0];
	const lim = B2B_LIMITS[system];
	if (!lim) return null;
	if (V > lim.maxHeight)
		return `⚠ Výška ${V} mm presahuje ${lim.maxHeight} mm — zasklenie BEZ ZÁRUKY.`;
	return null;
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/b2b-limits.test.ts`
Expected: PASS. If a boundary case (e.g. 3K@3000 rounding) is off, verify `cfg[...].N` and adjust nothing in the test — the formula `S/N` is exact (3000/3 = 1000 = max, inclusive).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/b2b-limits.ts tests/b2b-limits.test.ts
git commit -m "feat: b2b-limits module — per-panel width block+suggest, height warning"
```

---

### Task 4: Access control — hooks denylist + nav gating

**Files:**
- Modify: `src/hooks.server.ts` (add b2b denylist redirect)
- Create: `src/lib/server/b2b-access.ts` (pure `b2bRedirectTarget` helper — testable without HTTP)
- Modify: `src/routes/+layout.server.ts` (already passes `user` incl. role — verify), `src/routes/+layout.svelte` (nav gating)
- Test: `tests/b2b-access.test.ts` (new)

**Interfaces:**
- Consumes: `SessionUser` (auth.ts).
- Produces: `b2bRedirectTarget(pathname: string): string | null` — returns `'/zasklenia'` if a b2b user must be redirected off `pathname`, else `null`.

- [ ] **Step 1: Write the failing test**

Create `tests/b2b-access.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { b2bRedirectTarget } from '../src/lib/server/b2b-access';

describe('b2bRedirectTarget (denylist)', () => {
	it('blokuje ne-zasklenia stránky', () => {
		for (const p of ['/', '/pergola', '/bazen', '/odpisy', '/problem', '/pouzivatelia', '/zasklenia/nastavenia'])
			expect(b2bRedirectTarget(p)).toBe('/zasklenia');
	});
	it('povolí zasklenia + assety + logout', () => {
		for (const p of ['/zasklenia', '/zasklenia/', '/logout', '/_app/immutable/x.js', '/favicon.png', '/health'])
			expect(b2bRedirectTarget(p)).toBeNull();
	});
	it('nastavenia pod zasklenia je blokované, ale samotné zasklenia nie', () => {
		expect(b2bRedirectTarget('/zasklenia/nastavenia')).toBe('/zasklenia');
		expect(b2bRedirectTarget('/zasklenia')).toBeNull();
	});
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/b2b-access.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `b2b-access.ts`**

Create `src/lib/server/b2b-access.ts`:

```ts
// B2B smie LEN /zasklenia (nie /zasklenia/nastavenia). Denylist (nie allowlist) —
// allowlist by zablokoval SvelteKit assety /_app/* → prázdna stránka. Assety nikdy
// nesadnú na denylist, takže prejdú.
const B2B_FORBIDDEN_PREFIXES = [
	'/pergola',
	'/bazen',
	'/odpisy',
	'/problem',
	'/pouzivatelia',
	'/zasklenia/nastavenia'
];

/** Cieľ presmerovania pre b2b, alebo null keď cesta je povolená. */
export function b2bRedirectTarget(pathname: string): string | null {
	if (pathname === '/') return '/zasklenia';
	for (const p of B2B_FORBIDDEN_PREFIXES)
		if (pathname === p || pathname.startsWith(p + '/')) return '/zasklenia';
	return null;
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/b2b-access.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into `hooks.server.ts`**

In `src/hooks.server.ts`, after the existing login-guard block (after line 22, before `return resolve(event)`), add:

```ts
	// B2B smie len /zasklenia — presmeruj z ostatných stránok (denylist, assety prejdú).
	if (event.locals.user?.role === 'b2b') {
		const target = b2bRedirectTarget(event.url.pathname);
		if (target && event.url.pathname !== target) redirect(303, target);
	}
```

And add the import at top:

```ts
import { b2bRedirectTarget } from '$lib/server/b2b-access';
```

- [ ] **Step 6: Gate the nav in `+layout.svelte`**

First confirm `+layout.server.ts` passes the whole user (it returns `user: locals.user` which now includes `role` — no change needed; verify).

In `src/routes/+layout.svelte`, wrap the non-zasklenia nav links so b2b sees only Zasklenia. Around the nav links (lines ~14-21), change so that when `data.user?.role === 'b2b'` only the Zasklenia link renders; internal users additionally get a `/pouzivatelia` "Používatelia" link. Concretely, replace the link list with:

```svelte
{#if data.user}
	{@const b2b = data.user.role === 'b2b'}
	<a href="/zasklenia" class:active={page.url.pathname.startsWith('/zasklenia')}>Zasklenia</a>
	{#if !b2b}
		<a href="/pergola" class:active={page.url.pathname === '/pergola'}>Pergola</a>
		<a href="/bazen" class:active={page.url.pathname === '/bazen'}>Bazén</a>
		<a href="/zasklenia/nastavenia" class:active={page.url.pathname === '/zasklenia/nastavenia'}>⚙ Vzorce</a>
		<a href="/odpisy" class:active={page.url.pathname === '/odpisy'}>História</a>
		<a href="/problem" class:active={page.url.pathname === '/problem'}>⚠ Problém</a>
		<a href="/pouzivatelia" class:active={page.url.pathname === '/pouzivatelia'}>Používatelia</a>
	{/if}
{/if}
```

> NOTE for implementer: match the EXISTING markup/classes in `+layout.svelte:14-21` exactly (the snippet above shows intent — copy the real link/active-class pattern already in the file; do not invent new CSS). The `⚙ Vzorce` / `⚠ Problém` labels and the `page` store import already exist in the file. `/pouzivatelia` is a NEW link (internal-only).

- [ ] **Step 7: Type-check + run access test**

Run: `npm run check && npx vitest run tests/b2b-access.test.ts`
Expected: type-check clean, test PASS.

- [ ] **Step 8: Commit**

```bash
git add src/hooks.server.ts src/lib/server/b2b-access.ts src/routes/+layout.svelte tests/b2b-access.test.ts
git commit -m "feat: b2b access — hooks denylist redirect + nav gating"
```

---

### Task 5: Lock Money odpis for b2b

**Files:**
- Modify: `src/routes/zasklenia/+page.server.ts` (reject b2b in `odoslat` + `odoslatMulti`)
- Modify: `src/routes/zasklenia/+page.svelte` (hide `odoslat`/`odoslatMulti` buttons + Money copy for b2b)
- Test: covered by e2e in Task 7; add a focused server guard note here.

**Interfaces:**
- Consumes: `isB2B` (auth.ts), `locals.user`.

- [ ] **Step 1: Reject b2b server-side in the submit actions**

In `src/routes/zasklenia/+page.server.ts`, import `isB2B` from `$lib/server/auth`. At the very start of BOTH the `odoslat` and `odoslatMulti` actions (before any parsing/write), add:

```ts
		if (isB2B(locals.user)) return fail(403, { error: 'Veľkoobchodný účet nemôže odpisovať do Money.' });
```

(Use the action's existing `fail` import / return-shape — match how other errors in this file are returned; if it uses `{ step: 'form', error }`, mirror that instead of `fail`.)

- [ ] **Step 2: Hide the submit UI for b2b in `+page.svelte`**

In `src/routes/zasklenia/+page.svelte`, the `odoslat` form/button (line ~449-455) and `odoslatMulti` (line ~503-509), plus the "Odpis sa do Money odošle až po tvojom potvrdení" helper copy (line ~303-304): wrap each in `{#if !isB2B}` where `isB2B = $derived(data.user?.role === 'b2b')` (add this derived near the other `$derived` declarations at the top of the script). The `🖨 Tlačiť / uložiť PDF` button and the `Spočítať` / preview stay visible for everyone.

Add near the top `<script>` derived block:

```svelte
	const isB2B = $derived(data.user?.role === 'b2b');
```

Wrap (example for single-posuv submit form):

```svelte
	{#if !isB2B}
		<form method="POST" action="?/odoslat"> ... existing odoslat button ... </form>
	{/if}
```

- [ ] **Step 3: Type-check**

Run: `npm run check`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/routes/zasklenia/+page.server.ts src/routes/zasklenia/+page.svelte
git commit -m "feat: lock Money odpis for b2b (hide UI + reject server-side)"
```

---

### Task 6: Enforce width/height limits for b2b in the preview actions

**Files:**
- Modify: `src/routes/zasklenia/+page.server.ts` (`nahlad`, `nahladMulti` — call `checkB2BWidth`/`checkB2BHeight` for b2b)
- Modify: `src/routes/zasklenia/+page.svelte` (render height warning banner on preview + optional client hint)
- Test: covered by e2e in Task 7; unit coverage already in Task 3.

**Interfaces:**
- Consumes: `checkB2BWidth`, `checkB2BHeight` (b2b-limits.ts), `isB2B`, `loadCfg()`.

- [ ] **Step 1: Enforce in `nahlad`**

In `src/routes/zasklenia/+page.server.ts` `nahlad` action, after `parseVstup` succeeds and the `vstup` is known, but BEFORE returning the computed preview, add (only for b2b):

```ts
		if (isB2B(locals.user)) {
			const cfg = loadCfg();
			const sysStyl = `${vstup.system}|${vstup.styl}`;
			const wErr = checkB2BWidth(cfg, sysStyl, vstup.s);
			if (wErr) return { step: 'form', vstup, error: wErr };
			// výška NEblokuje — len warning, pripoj k výsledku
			var heightWarn = checkB2BHeight(sysStyl, vstup.v);
		}
```

Then include `heightWarn` (Slovak string or undefined) in the returned `nahlad` payload, e.g. `return { step: 'nahlad', ...plan, planHash, cielInfo, heightWarn }`. Match the exact field names the existing action returns (`vstup`, `styl`, etc.) — read the current `nahlad` return shape and add `heightWarn` alongside.

> Implementer note: use the exact variable names already in the action for the parsed input (the grounding shows `parseVstup` result and a `vstup` object with `.system/.styl/.s/.v`). If the action names them differently, adapt. Declare `heightWarn` with `let` in the action scope (not `var` inside the `if`) so it's in scope for the return — restructure as needed.

- [ ] **Step 2: Enforce in `nahladMulti` (per posuv)**

In the `nahladMulti` action, for b2b, loop over each posuv spec, run `checkB2BWidth` per posuv (block the whole preview on the first width error, returning `{ step: 'form', ... , error }`), and aggregate height warnings into one `heightWarn` string (join distinct). Include `heightWarn` in the returned multi payload.

```ts
		if (isB2B(locals.user)) {
			const cfg = loadCfg();
			const warns: string[] = [];
			for (const p of posuvy) {
				const sysStyl = `${p.system}|${p.styl}`;
				const wErr = checkB2BWidth(cfg, sysStyl, p.s);
				if (wErr) return { step: 'form', /* echo multi vstup */ error: wErr };
				const hW = checkB2BHeight(sysStyl, p.v);
				if (hW) warns.push(hW);
			}
			var heightWarnMulti = warns.length ? [...new Set(warns)].join(' ') : undefined;
		}
```

(Match the real per-posuv variable names from the existing `nahladMulti`/`computeMultiFrom` code; return `heightWarn: heightWarnMulti` in the multi payload.)

- [ ] **Step 3: Render the height warning banner in `+page.svelte`**

In the `nahlad` and `nahladMulti` steps (where the preview `planKarty` renders), add a warning banner when `form?.heightWarn` is set. It MUST be visible in print too (do NOT put it inside `.noprint`), so the PDF carries "BEZ ZÁRUKY":

```svelte
	{#if form?.heightWarn}
		<div class="warn-zaruka">{form.heightWarn}</div>
	{/if}
```

Add minimal CSS in the component or `app.css` (visible on screen AND print):

```css
.warn-zaruka {
	background: #fff3cd;
	border: 2px solid #e0a800;
	color: #7a5c00;
	padding: 8px 12px;
	border-radius: 6px;
	margin: 8px 0;
	font-weight: 700;
}
```

> Match how `form` data is accessed in this file (Svelte 5 `$props`/`form` from `ActionData`). Reference the height warning via the same channel the action returns it.

- [ ] **Step 4: Optional client hint (b2b only) — nice-to-have, keep minimal**

Below the width field, when `isB2B`, show a live hint of the valid range for the chosen system/style (`min×N`–`max×N`). Keep it a single derived line; skip if it complicates — server is the real guard. (If time-boxed, omit; e2e covers the server block.)

- [ ] **Step 5: Type-check**

Run: `npm run check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/routes/zasklenia/+page.server.ts src/routes/zasklenia/+page.svelte src/app.css
git commit -m "feat: enforce b2b width block + height warranty warning in preview"
```

---

### Task 7: Admin page `/pouzivatelia` + e2e coverage

**Files:**
- Create: `src/routes/pouzivatelia/+page.server.ts`, `src/routes/pouzivatelia/+page.svelte`
- Modify: `e2e/app.spec.ts` (add b2b + admin e2e block)
- Test: `e2e/app.spec.ts`

**Interfaces:**
- Consumes: `listUsers`, `addUser`, `deleteB2BUser` (db.ts), `isB2B` (auth.ts).

- [ ] **Step 1: Server route (internal-only, list + create + delete)**

Create `src/routes/pouzivatelia/+page.server.ts`:

```ts
import { redirect, fail } from '@sveltejs/kit';
import { isB2B } from '$lib/server/auth';
import { listUsers, addUser, deleteB2BUser } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (isB2B(locals.user)) redirect(303, '/zasklenia');
	return { users: listUsers(), me: locals.user?.username };
};

export const actions: Actions = {
	pridat: async ({ request, locals }) => {
		if (isB2B(locals.user)) return fail(403, { error: 'Nedostupné.' });
		const fd = await request.formData();
		const username = String(fd.get('username') ?? '');
		const password = String(fd.get('password') ?? '');
		const { error } = addUser(username, password, 'b2b');
		if (error) return fail(400, { error });
		return { ok: `B2B účet „${username.trim()}" vytvorený.` };
	},
	zmazat: async ({ request, locals }) => {
		if (isB2B(locals.user)) return fail(403, { error: 'Nedostupné.' });
		const fd = await request.formData();
		const id = Number(fd.get('id'));
		const { error } = deleteB2BUser(id);
		if (error) return fail(400, { error });
		return { ok: 'Účet zmazaný.' };
	}
};
```

- [ ] **Step 2: Svelte page**

Create `src/routes/pouzivatelia/+page.svelte` — a list of accounts (username, role, created) + "Pridať B2B účet" form (username + password) + a delete button per **b2b** account. Follow the styling patterns of an existing simple page (e.g. `/odpisy` or `/problem`). Minimal:

```svelte
<script lang="ts">
	let { data, form } = $props();
</script>

<h1>Používatelia</h1>

{#if form?.error}<p class="err">{form.error}</p>{/if}
{#if form?.ok}<p class="ok">{form.ok}</p>{/if}

<h2>Pridať B2B účet</h2>
<form method="POST" action="?/pridat">
	<input name="username" placeholder="prihlasovacie meno" required />
	<input name="password" type="password" placeholder="heslo (min 6 znakov)" required />
	<button type="submit">Pridať B2B účet</button>
</form>

<h2>Účty</h2>
<table>
	<thead><tr><th>Meno</th><th>Rola</th><th>Vytvorené</th><th></th></tr></thead>
	<tbody>
		{#each data.users as u (u.id)}
			<tr>
				<td>{u.username}</td>
				<td>{u.role}</td>
				<td>{u.created_at}</td>
				<td>
					{#if u.role === 'b2b'}
						<form method="POST" action="?/zmazat" onsubmit={(e) => { if (!confirm('Zmazať účet ' + u.username + '?')) e.preventDefault(); }}>
							<input type="hidden" name="id" value={u.id} />
							<button type="submit">Zmazať</button>
						</form>
					{/if}
				</td>
			</tr>
		{/each}
	</tbody>
</table>
```

(Match existing page CSS conventions; `.err`/`.ok` classes may already exist in `app.css` — reuse.)

- [ ] **Step 3: Read the existing e2e setup**

Read `e2e/app.spec.ts` and any `playwright.config.ts` / global-setup to learn how the internal user logs in (the seeded `SEED_USERS` credential + the login flow). The b2b e2e will: log in as internal → go to `/pouzivatelia` → create a b2b account → log out → log in as that b2b account.

- [ ] **Step 4: Add the b2b + admin e2e block to `e2e/app.spec.ts`**

Append tests (adapt selectors/login helper to the existing spec's patterns):

```ts
test('admin vytvorí b2b účet a ten je obmedzený', async ({ page }) => {
	// login ako interný (použi existujúci login helper/kredenciály zo spec-u)
	await loginAsInternal(page);
	await page.goto('/pouzivatelia');
	await page.fill('input[name=username]', 'e2e_b2b');
	await page.fill('input[name=password]', 'e2eheslo1');
	await page.click('button:has-text("Pridať B2B účet")');
	await expect(page.locator('text=vytvorený')).toBeVisible();

	// logout + login ako b2b
	await page.goto('/logout');
	await loginAs(page, 'e2e_b2b', 'e2eheslo1');

	// b2b: nav len Zasklenia, redirect z ne-zasklenia
	await page.goto('/pergola');
	await expect(page).toHaveURL(/\/zasklenia/);
	await page.goto('/pouzivatelia');
	await expect(page).toHaveURL(/\/zasklenia/);

	// b2b: žiadne tlačidlo Odoslať; šírkový blok + poradí štýl
	await page.goto('/zasklenia');
	// vyplň Deluxe 2K 3000×2000 (adapt na skutočné selektory formulára)
	// ... select system Deluxe, styl 2K, sirka 3000, vyska 2000, Spočítať ...
	await expect(page.locator('text=Zvoľ 3K')).toBeVisible();
	await expect(page.locator('[data-testid=odoslat]')).toHaveCount(0);

	// zmeň na 3K → náhľad OK, print button prítomný
	// ... styl 3K, Spočítať ...
	await expect(page.locator('text=Tlačiť')).toBeVisible();

	// výška 2700 → warning bez záruky (Deluxe)
	// ... vyska 2700, Spočítať ...
	await expect(page.locator('text=BEZ ZÁRUKY')).toBeVisible();
});
```

> The exact form-fill selectors must match `/zasklenia` (system/styl/sirka/vyska selects/inputs). Reuse the existing spec's helpers for login and form fill. If the current spec has no reusable `loginAs`, add a small helper mirroring its login steps.

- [ ] **Step 5: Add `/pouzivatelia` to nav for internal (done in Task 4) — verify link renders**

Confirm the `/pouzivatelia` nav link (added in Task 4 Step 6) is present for internal and absent for b2b.

- [ ] **Step 6: Run full unit + type-check + e2e**

Run: `npm run check && npx vitest run && npx playwright test`
Expected: all green. (E2e requires the dev/preview server per the existing config; follow the repo's e2e run convention.)

- [ ] **Step 7: Commit**

```bash
git add src/routes/pouzivatelia e2e/app.spec.ts
git commit -m "feat: internal-only user-admin page + b2b/admin e2e coverage"
```

---

## Final integration (after all tasks)

- [ ] Run the full gate locally: `npm run check && npx vitest run` (unit + coverage) and `npx playwright test` (e2e).
- [ ] Push `dev`, open PR `dev → main`, drive CI green (version-check + test + deploy), `/review` + `/requesting-code-review` clean.
- [ ] Merge, monitor main deploy to VPS, verify on **app.montalu.cloud** (Money-safe): internal flow unchanged (nav, Odoslať present, no limits); create a throwaway b2b test account and confirm restrictions (redirect, no Odoslať, width block + suggest, height warning) — **only Spočítať/Tlačiť, never Odoslať**. Delete the throwaway b2b account after.
- [ ] `📔 Playbook` review + completion report.

## Self-Review (plan vs spec)

- **Spec §1 role/migration** → Task 1. ✓
- **Spec §2 access denylist + nav** → Task 4. ✓ (denylist, asset-safe, exact-`/` handled)
- **Spec §3 Money lock** → Task 5 (UI hide + server reject). ✓
- **Spec §4 width block+suggest + height warn** → Task 3 (logic) + Task 6 (enforcement + banner). ✓
- **Spec §5 admin page** → Task 7. ✓
- **Spec §6 tests** → each task ships its unit tests; Task 7 adds e2e. ✓ (full coverage rule honored)
- **Money-safe / additive / live-use** → Global Constraints + Task 1 (additive migration) + Task 5 (server reject) + final integration (throwaway account, never Odoslať). ✓
- **Type consistency:** `checkB2BWidth(cfg, sysStyl, S)`, `checkB2BHeight(sysStyl, V)`, `b2bRedirectTarget(pathname)`, `isB2B(user)`, `addUser/deleteB2BUser/listUsers` — used consistently across tasks. ✓
