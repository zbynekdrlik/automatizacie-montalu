// #613 (druhá časť): migrácia v58 → v59 pridá do `user_audit.action` hodnotu `password_reset`, aby
// zmena hesla administrátorom (`setPassword`) mala TRVALÝ audit riadok — dovtedy bol jediný záznam
// `auth` stdout log, ktorý každý redeploy (docker compose recreate) zahodí. SQLite nevie ALTER-núť
// CHECK → PRESTAVBA tabuľky (vzor v24 + v57). Kontrakt:
//  - všetky existujúce riadky zachované BIT-PRESNE (aj ne-sekvenčné `id`, `ts`, prázdny actor seedu),
//  - nový CHECK prijme `password_reset` a ďalej odmietne nezmysel,
//  - FK sú po migrácii znova ZAPNUTÉ (prestavba ich vypína len na čas transakcie),
//  - nečakaný tvar starej tabuľky = abort (rollback, verzia ostane 58, nič sa nestratí),
//  - idempotentná (druhý beh tela zachová riadky; guard >= 59 nebumpne),
//  - minimálna fixtúra bez `user_audit` → len bump; čerstvá DB končí na hlave s novým CHECK.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v59-test-'));
const dbPath = path.join(tmpRoot, 'v58.db');

/** PROD-tvar `user_audit` pred v59 (v24): ne-sekvenčné id, všetky 4 akcie, seed s prázdnym actorom. */
const POVODNE_RIADKY = [
	{
		id: 1,
		ts: '2026-08-13 08:00:00',
		actor: '',
		action: 'seed',
		target_username: 'marek',
		detail: ''
	},
	{
		id: 2,
		ts: '2026-08-13 09:15:00',
		actor: 'marek',
		action: 'create',
		target_username: 'predaj',
		detail: 'role=internal'
	},
	{
		id: 4,
		ts: '2026-08-20 10:00:00',
		actor: 'marek',
		action: 'role_change',
		target_username: 'predaj',
		detail: 'b2b→internal'
	},
	{
		id: 7,
		ts: '2026-09-01 12:00:00',
		actor: 'marek',
		action: 'create',
		target_username: 'vo@firma.sk',
		detail: 'role=b2b'
	},
	{
		id: 9,
		ts: '2026-09-02 13:00:00',
		actor: 'marek',
		action: 'delete',
		target_username: 'vo@firma.sk',
		detail: 'role=b2b'
	}
];

{
	const v58 = new Database(dbPath);
	v58.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL DEFAULT '', dim TEXT NOT NULL DEFAULT 'S', koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks INTEGER NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0, money_kod TEXT, sklo_korekcia INTEGER, hrubka_trieda INTEGER, UNIQUE(nazov, system));
		CREATE TABLE cfg_sklo_trieda (system TEXT NOT NULL, trieda INTEGER NOT NULL, korekcia INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (system, trieda));
		CREATE TABLE cfg_audit (id INTEGER PRIMARY KEY, ts TEXT NOT NULL DEFAULT (datetime('now')), username TEXT NOT NULL, sys_styl TEXT NOT NULL, zmeny TEXT NOT NULL);
		CREATE TABLE odpis_log (id INTEGER PRIMARY KEY, modul TEXT NOT NULL, zak TEXT NOT NULL, op TEXT NOT NULL, zakaznik TEXT NOT NULL, caka INTEGER NOT NULL DEFAULT 0, live INTEGER NOT NULL, target TEXT NOT NULL, filename TEXT NOT NULL, content_hash TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), zak_norm TEXT NOT NULL DEFAULT '', op_norm TEXT NOT NULL DEFAULT '', presunute_at TEXT, poradie INTEGER NOT NULL DEFAULT 1 CHECK (poradie >= 1), UNIQUE (modul, zak, op, live, poradie));
		CREATE TABLE user_audit (id INTEGER PRIMARY KEY, ts TEXT NOT NULL DEFAULT (datetime('now')), actor TEXT NOT NULL, action TEXT NOT NULL CHECK (action IN ('create','role_change','delete','seed')), target_username TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '');
		CREATE TABLE cfg_sietka_standard (kluc TEXT PRIMARY KEY CHECK (kluc IN ('k', 'r', 'h')), hodnota REAL NOT NULL);
		INSERT INTO cfg_sietka_standard (kluc, hodnota) VALUES ('k', 16.5), ('r', 17), ('h', 3);
		CREATE TABLE cfg_sklo_hrubka (id INTEGER PRIMARY KEY, system TEXT NOT NULL, mm REAL NOT NULL CHECK (mm > 0), druh TEXT NOT NULL CHECK (druh IN ('izolacne', 'jednoduche', 'esg')), UNIQUE (system, mm));
		INSERT INTO cfg_sklo_hrubka (system, mm, druh) VALUES ('Štandard +', 16, 'izolacne');
		INSERT INTO glass_types (nazov, system, hrubka_trieda) VALUES ('Izolačné sklo 4/8/4 číre', 'Štandard +', 16);
		INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES ('Štandard +|2x2K IZO', 4, 0);
		INSERT INTO cfg_rez (sys_styl, poradie, typ, nazov, dim, offset, delit_n) VALUES
			('Štandard +|2x2K IZO', 90, 'sklo', 'Sklo šírka', 'S', -313, 1);
		-- účty existujú → seedUsers nič nezaloží (audit fixtúry ostane presne taký, ako je)
		INSERT INTO users (id, username, pass_hash, role) VALUES (1, 'marek', 'x:y', 'internal'), (3, 'predaj', 'x:y', 'internal');
		INSERT INTO sessions (token, user_id, expires_at) VALUES ('relacia-fixtury-v59', 3, 9999999999999);
		PRAGMA user_version = 58;
	`);
	const ins = v58.prepare(
		'INSERT INTO user_audit (id, ts, actor, action, target_username, detail) VALUES (@id, @ts, @actor, @action, @target_username, @detail)'
	);
	for (const r of POVODNE_RIADKY) ins.run(r);
	v58.close();
}

process.env.DATABASE_PATH = dbPath;
const { db } = await import('../src/lib/server/db');
const { migrateUserAuditHeslo } = await import('../src/lib/server/migracie-user-audit-heslo');
const { migrate } = await import('../src/lib/server/migracie');

const vsetkyRiadky = (d: Database.Database) =>
	d
		.prepare('SELECT id, ts, actor, action, target_username, detail FROM user_audit ORDER BY id')
		.all();
const tabulkaSql = (d: Database.Database) =>
	(
		d.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='user_audit'").get() as {
			sql: string;
		}
	).sql;
/** Zápis do `user_audit` s danou akciou — `true` = CHECK prijal. */
function zapisAkcie(d: Database.Database, action: string): boolean {
	try {
		d.prepare(
			"INSERT INTO user_audit (actor, action, target_username) VALUES ('test-v59', ?, 'ciel')"
		).run(action);
		return true;
	} catch (e) {
		if ((e as { code?: string }).code === 'SQLITE_CONSTRAINT_CHECK') return false;
		throw e;
	}
}

describe('migration → v59 (#613 trvalý audit zmeny hesla — user_audit.action password_reset)', () => {
	it('bumpne na v59', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(59);
	});

	it('všetky pôvodné riadky user_audit zachované BIT-PRESNE (id, ts, actor, akcia, účet, detail)', () => {
		expect(vsetkyRiadky(db)).toEqual(POVODNE_RIADKY);
	});

	it('nový CHECK prijme password_reset aj doterajšie akcie, nezmysel ďalej odmietne', () => {
		const d = new Database(':memory:');
		d.exec(tabulkaSql(db));
		for (const a of ['create', 'role_change', 'delete', 'seed', 'password_reset'])
			expect(zapisAkcie(d, a), a).toBe(true);
		for (const a of ['garbage', 'PASSWORD_RESET', 'password-reset', ''])
			expect(zapisAkcie(d, a), a).toBe(false);
		d.close();
	});

	it('stĺpce, poradie a defaulty sa nezmenili (ts sa vyplní sám, detail default prázdny)', () => {
		const cols = (
			db.prepare('PRAGMA table_info(user_audit)').all() as {
				name: string;
				notnull: number;
				pk: number;
			}[]
		).map((c) => `${c.name}:${c.notnull}:${c.pk}`);
		expect(cols).toEqual([
			'id:0:1',
			'ts:1:0',
			'actor:1:0',
			'action:1:0',
			'target_username:1:0',
			'detail:1:0'
		]);
		const id = Number(
			db
				.prepare(
					"INSERT INTO user_audit (actor, action, target_username) VALUES ('marek', 'password_reset', 'predaj')"
				)
				.run().lastInsertRowid
		);
		const r = db.prepare('SELECT ts, detail FROM user_audit WHERE id = ?').get(id) as {
			ts: string;
			detail: string;
		};
		expect(r.ts).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
		expect(r.detail).toBe('');
		// nové id pokračuje ZA najvyšším zachovaným (9) — história ostáva chronologická podľa id
		expect(id).toBe(10);
		db.prepare('DELETE FROM user_audit WHERE id = ?').run(id);
	});

	it('FK sú po migrácii znova ZAPNUTÉ a ostatné tabuľky nedotknuté (relácia, účty)', () => {
		expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
		expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
		// relácia účtu `predaj` (id 3) z fixtúry prežila — prestavba user_audit sa sessions nedotkne
		expect(db.prepare('SELECT user_id, expires_at FROM sessions').all()).toEqual([
			{ user_id: 3, expires_at: 9999999999999 }
		]);
		expect(db.prepare('SELECT username FROM users ORDER BY id').all()).toEqual([
			{ username: 'marek' },
			{ username: 'predaj' }
		]);
	});

	it('žiadna pomocná tabuľka prestavby po migrácii neostala', () => {
		expect(
			db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'user_audit%' ORDER BY name").all()
		).toEqual([{ name: 'user_audit' }]);
	});

	it('idempotentná: druhý beh tela zachová riadky (aj password_reset); guard >= 59 nebumpne', () => {
		const d = new Database(dbPath);
		d.prepare(
			"INSERT INTO user_audit (id, ts, actor, action, target_username) VALUES (12, '2026-10-19 16:00:00', 'marek', 'password_reset', 'predaj')"
		).run();
		const pred = vsetkyRiadky(d);
		d.pragma('user_version = 58');
		migrateUserAuditHeslo(d, (v) => d.pragma(`user_version = ${v}`));
		expect(d.pragma('user_version', { simple: true })).toBe(59);
		expect(vsetkyRiadky(d)).toEqual(pred);
		expect(zapisAkcie(d, 'password_reset')).toBe(true);
		expect(zapisAkcie(d, 'garbage')).toBe(false);
		// guard: na v59 je migrácia no-op (ani bump, ani prestavba)
		migrateUserAuditHeslo(d, () => {
			throw new Error('nemal bumpnúť');
		});
		expect(d.pragma('user_version', { simple: true })).toBe(59);
		d.close();
	});

	it('minimálna fixtúra bez user_audit → len bump (žiadna tabuľka nevznikne)', () => {
		const d = new Database(':memory:');
		d.pragma('user_version = 58');
		migrateUserAuditHeslo(d, (v) => d.pragma(`user_version = ${v}`));
		expect(d.pragma('user_version', { simple: true })).toBe(59);
		expect(d.prepare("SELECT 1 FROM sqlite_master WHERE name = 'user_audit'").get()).toBe(
			undefined
		);
		d.close();
	});

	it('nečakaný tvar starej tabuľky (stĺpec navyše) = abort: rollback, verzia 58, riadky aj stĺpec ostanú', () => {
		const d = new Database(':memory:');
		d.exec(`
			CREATE TABLE user_audit (id INTEGER PRIMARY KEY, ts TEXT NOT NULL DEFAULT (datetime('now')), actor TEXT NOT NULL, action TEXT NOT NULL CHECK (action IN ('create','role_change','delete','seed')), target_username TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', poznamka TEXT);
			INSERT INTO user_audit (actor, action, target_username, poznamka) VALUES ('marek', 'create', 'predaj', 'nestratiť');
			PRAGMA user_version = 58;
		`);
		d.pragma('foreign_keys = ON');
		expect(() => migrateUserAuditHeslo(d, (v) => d.pragma(`user_version = ${v}`))).toThrow(
			/poznamka/
		);
		expect(d.pragma('user_version', { simple: true })).toBe(58);
		expect(d.prepare('SELECT poznamka FROM user_audit').all()).toEqual([{ poznamka: 'nestratiť' }]);
		expect(d.pragma('foreign_keys', { simple: true })).toBe(1);
		d.close();
	});

	it('čerstvá DB (v0 → hlava) má user_audit s password_reset v CHECK', () => {
		const fresh = new Database(':memory:');
		fresh.pragma('foreign_keys = ON');
		migrate(fresh, (p) => `x:${p}`);
		expect(fresh.pragma('user_version', { simple: true })).toBe(59);
		expect(zapisAkcie(fresh, 'password_reset')).toBe(true);
		expect(zapisAkcie(fresh, 'garbage')).toBe(false);
		expect(fresh.pragma('foreign_keys', { simple: true })).toBe(1);
		fresh.close();
	});
});
