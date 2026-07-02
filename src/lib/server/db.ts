// SQLite databáza — zdroj pravdy pre konfiguráciu vzorcov, dedup odpisov,
// užívateľov a audit trail. better-sqlite3 = synchrónne transakcie a UNIQUE
// constrainty (dedup je constraint v DB, nie kontrola v kóde).
import Database from 'better-sqlite3';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import seed from './cfg_seed.json';
import type { SysRow, RezRow, Cfg } from './compute';
import { buildCFG } from './compute';

const DB_PATH = process.env.DATABASE_PATH || './data/app.db';

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function hashPassword(password: string): string {
	const salt = randomBytes(16).toString('hex');
	const hash = scryptSync(password, salt, 64).toString('hex');
	return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
	const [salt, hash] = stored.split(':');
	if (!salt || !hash) return false;
	const check = scryptSync(password, salt, 64);
	const expected = Buffer.from(hash, 'hex');
	return check.length === expected.length && timingSafeEqual(check, expected);
}

function migrate() {
	const version = db.pragma('user_version', { simple: true }) as number;

	if (version < 1) {
		db.exec(`
			CREATE TABLE users (
				id INTEGER PRIMARY KEY,
				username TEXT NOT NULL UNIQUE,
				pass_hash TEXT NOT NULL,
				created_at TEXT NOT NULL DEFAULT (datetime('now'))
			);
			CREATE TABLE sessions (
				token TEXT PRIMARY KEY,
				user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				expires_at INTEGER NOT NULL
			);
			CREATE TABLE cfg_sys (
				id INTEGER PRIMARY KEY,
				sys_styl TEXT NOT NULL UNIQUE,
				n INTEGER NOT NULL,
				sklo_offset REAL NOT NULL
			);
			CREATE TABLE cfg_rez (
				id INTEGER PRIMARY KEY,
				sys_styl TEXT NOT NULL,
				poradie INTEGER NOT NULL,
				typ TEXT NOT NULL CHECK (typ IN ('profil','sklo')),
				kod TEXT NOT NULL DEFAULT '',
				nazov TEXT NOT NULL,
				dim TEXT NOT NULL CHECK (dim IN ('S','V')),
				koef REAL NOT NULL DEFAULT 1,
				offset REAL NOT NULL DEFAULT 0,
				delit_n INTEGER NOT NULL DEFAULT 0,
				kerf REAL NOT NULL DEFAULT 0,
				pocet_ks REAL NOT NULL DEFAULT 0,
				sklozavisle INTEGER NOT NULL DEFAULT 0
			);
			CREATE INDEX idx_cfg_rez_sys ON cfg_rez(sys_styl, poradie);
			CREATE TABLE glass_types (
				id INTEGER PRIMARY KEY,
				nazov TEXT NOT NULL UNIQUE,
				redukcia_zero INTEGER NOT NULL DEFAULT 0,
				poradie INTEGER NOT NULL DEFAULT 0
			);
			CREATE TABLE cfg_audit (
				id INTEGER PRIMARY KEY,
				ts TEXT NOT NULL DEFAULT (datetime('now')),
				username TEXT NOT NULL,
				sys_styl TEXT NOT NULL,
				zmeny TEXT NOT NULL
			);
			CREATE TABLE odpis_log (
				id INTEGER PRIMARY KEY,
				zak TEXT NOT NULL,
				op TEXT NOT NULL,
				zakaznik TEXT NOT NULL,
				system TEXT NOT NULL,
				styl TEXT NOT NULL,
				s REAL NOT NULL,
				v REAL NOT NULL,
				sklo TEXT NOT NULL DEFAULT '',
				otvaranie TEXT NOT NULL DEFAULT '',
				caka INTEGER NOT NULL DEFAULT 0,
				live INTEGER NOT NULL,
				target TEXT NOT NULL,
				filename TEXT NOT NULL,
				content_hash TEXT NOT NULL DEFAULT '',
				created_by TEXT NOT NULL DEFAULT '',
				created_at TEXT NOT NULL DEFAULT (datetime('now')),
				UNIQUE (zak, op, live)
			);
			CREATE TABLE problem_reports (
				id INTEGER PRIMARY KEY,
				ts TEXT NOT NULL DEFAULT (datetime('now')),
				username TEXT NOT NULL DEFAULT '',
				oblast TEXT NOT NULL DEFAULT '',
				popis TEXT NOT NULL
			);
		`);
		db.pragma('user_version = 1');
	}

	seedData();
	seedUsers();
}

function seedData() {
	const sysCount = (db.prepare('SELECT COUNT(*) c FROM cfg_sys').get() as { c: number }).c;
	if (sysCount === 0) {
		const insSys = db.prepare('INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES (?, ?, ?)');
		const insRez = db.prepare(
			`INSERT INTO cfg_rez (sys_styl, poradie, typ, kod, nazov, dim, koef, offset, delit_n, kerf, pocet_ks, sklozavisle)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		);
		db.transaction(() => {
			for (const s of seed.sys) insSys.run(s.sysStyl, s.N, s.skloOffset);
			for (const r of seed.rez)
				insRez.run(
					r.sysStyl,
					r.poradie,
					r.typ,
					r.kod,
					r.nazov,
					r.dim,
					r.koef,
					r.offset,
					r.delitN,
					r.kerf,
					r.pocetKs,
					r.sklozavisle
				);
		})();
	}
	const glassCount = (db.prepare('SELECT COUNT(*) c FROM glass_types').get() as { c: number }).c;
	if (glassCount === 0) {
		// redukcia_zero = 0 všade: zachováva správanie overené 1:1 (Redukcia 6mm sa
		// pri ponúkaných sklách nenuluje). Otvorená otázka pre Dominika/Mareka: má sa
		// nulovať pri izolačných sklách? Ak áno, prepne sa v editore vzorcov.
		const ins = db.prepare(
			'INSERT INTO glass_types (nazov, redukcia_zero, poradie) VALUES (?, ?, ?)'
		);
		db.transaction(() => {
			ins.run('Izolačné sklo 4/16/4 mliečne', 0, 10);
			ins.run('Izolačné sklo 4/16/4 číre', 0, 20);
			ins.run('Kalené 8mm', 0, 30);
			ins.run('Kalené 10mm', 0, 40);
		})();
	}
}

function seedUsers() {
	const userCount = (db.prepare('SELECT COUNT(*) c FROM users').get() as { c: number }).c;
	if (userCount === 0) {
		const spec = process.env.SEED_USERS || '';
		const ins = db.prepare('INSERT INTO users (username, pass_hash) VALUES (?, ?)');
		for (const pair of spec.split(',').filter(Boolean)) {
			const idx = pair.indexOf(':');
			if (idx < 1) continue;
			ins.run(pair.slice(0, idx).trim(), hashPassword(pair.slice(idx + 1)));
		}
	}
}

migrate();

// ---- konfigurácia vzorcov ----

export function loadCfg(): Cfg {
	const sys = (db.prepare('SELECT sys_styl, n, sklo_offset FROM cfg_sys').all() as {
		sys_styl: string;
		n: number;
		sklo_offset: number;
	}[]).map<SysRow>((r) => ({ sysStyl: r.sys_styl, N: r.n, skloOffset: r.sklo_offset }));
	const rez = (db
		.prepare(
			'SELECT sys_styl, poradie, typ, kod, nazov, dim, koef, offset, delit_n, kerf, pocet_ks, sklozavisle FROM cfg_rez ORDER BY sys_styl, poradie'
		)
		.all() as Record<string, unknown>[]).map<RezRow>((r) => ({
		sysStyl: r.sys_styl as string,
		poradie: r.poradie as number,
		typ: r.typ as 'profil' | 'sklo',
		kod: r.kod as string,
		nazov: r.nazov as string,
		dim: r.dim as 'S' | 'V',
		koef: r.koef as number,
		offset: r.offset as number,
		delitN: r.delit_n as 0 | 1,
		kerf: r.kerf as number,
		pocetKs: r.pocet_ks as number,
		sklozavisle: r.sklozavisle as 0 | 1
	}));
	return buildCFG(sys, rez);
}

export function listSysStyly(): { sysStyl: string; system: string; styl: string }[] {
	return (db.prepare('SELECT sys_styl FROM cfg_sys ORDER BY sys_styl').all() as {
		sys_styl: string;
	}[]).map((r) => ({
		sysStyl: r.sys_styl,
		system: r.sys_styl.split('|')[0],
		styl: r.sys_styl.split('|')[1]
	}));
}

export function listGlassTypes(): { nazov: string; redukciaZero: boolean }[] {
	return (db
		.prepare('SELECT nazov, redukcia_zero FROM glass_types ORDER BY poradie')
		.all() as { nazov: string; redukcia_zero: number }[]).map((r) => ({
		nazov: r.nazov,
		redukciaZero: !!r.redukcia_zero
	}));
}
