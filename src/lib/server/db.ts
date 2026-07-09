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
				sklozavisle INTEGER NOT NULL DEFAULT 0,
				dlzka_tyce REAL NOT NULL DEFAULT 7500
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
				modul TEXT NOT NULL,
				zak TEXT NOT NULL,
				op TEXT NOT NULL,
				zakaznik TEXT NOT NULL,
				caka INTEGER NOT NULL DEFAULT 0,
				live INTEGER NOT NULL,
				target TEXT NOT NULL,
				filename TEXT NOT NULL,
				content_hash TEXT NOT NULL DEFAULT '',
				detail TEXT NOT NULL DEFAULT '{}',
				created_by TEXT NOT NULL DEFAULT '',
				created_at TEXT NOT NULL DEFAULT (datetime('now')),
				UNIQUE (modul, zak, op, live)
			);
			CREATE TABLE problem_reports (
				id INTEGER PRIMARY KEY,
				ts TEXT NOT NULL DEFAULT (datetime('now')),
				username TEXT NOT NULL DEFAULT '',
				oblast TEXT NOT NULL DEFAULT '',
				popis TEXT NOT NULL
			);
		`);
		db.pragma('user_version = 2');
	}

	if ((db.pragma('user_version', { simple: true }) as number) < 2) {
		// v1 → v2: odpis_log zovšeobecnený pre všetky moduly — dedup kľúč obsahuje
		// modul (jedna ZAK môže mať legitímne pergolu AJ bazén AJ zasklenia).
		// ATOMICKY (BEGIN/COMMIT) + idempotentne (DROP IF EXISTS) — prerušená
		// migrácia na produkčnej DB nesmie zanechať polovičný stav ani crash-loop.
		db.exec(`
			BEGIN;
			DROP TABLE IF EXISTS odpis_log2;
			CREATE TABLE odpis_log2 (
				id INTEGER PRIMARY KEY,
				modul TEXT NOT NULL,
				zak TEXT NOT NULL,
				op TEXT NOT NULL,
				zakaznik TEXT NOT NULL,
				caka INTEGER NOT NULL DEFAULT 0,
				live INTEGER NOT NULL,
				target TEXT NOT NULL,
				filename TEXT NOT NULL,
				content_hash TEXT NOT NULL DEFAULT '',
				detail TEXT NOT NULL DEFAULT '{}',
				created_by TEXT NOT NULL DEFAULT '',
				created_at TEXT NOT NULL DEFAULT (datetime('now')),
				UNIQUE (modul, zak, op, live)
			);
			INSERT INTO odpis_log2 (id, modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by, created_at)
				SELECT id, 'zasklenia', zak, op, zakaznik, caka, live, target, filename, content_hash,
					json_object('system', system, 'styl', styl, 's', s, 'v', v, 'sklo', sklo, 'otvaranie', otvaranie),
					created_by, created_at
				FROM odpis_log;
			DROP TABLE odpis_log;
			ALTER TABLE odpis_log2 RENAME TO odpis_log;
			PRAGMA user_version = 2;
			COMMIT;
		`);
	}

	if ((db.pragma('user_version', { simple: true }) as number) < 3) {
		// v2 → v3: sklá majú systém (Robust = 4/16/4, Slide = 4/8/4) + Slide
		// „4/8/4 číre" nuluje Redukciu 6mm. Sklá sú konfigurácia (nie user dáta),
		// bezpečne ich preseedujeme na nový systémovo-rozlíšený set.
		db.exec(`
			BEGIN;
			ALTER TABLE glass_types ADD COLUMN system TEXT NOT NULL DEFAULT 'ALL';
			DELETE FROM glass_types;
			PRAGMA user_version = 3;
			COMMIT;
		`);
		seedGlass();
	}

	if ((db.pragma('user_version', { simple: true }) as number) < 5) {
		// v3 → v5: pridaj systémy/štýly z cfg_seed, ktoré v DB ešte nie sú (v4: Robust
		// 4K + 2x4K; v5: Slide opona 2x2K + 2x3K). Existujúce štýly sa NEDOTÝKAJÚ (mohli
		// byť ručne upravené v editore vzorcov). Idempotentné — pridá len chýbajúce
		// sysStyl aj ich rez riadky (bezpečne re-spustiteľné pri každom novom štýle).
		const hasSys = db.prepare('SELECT 1 FROM cfg_sys WHERE sys_styl = ?');
		const insSys = db.prepare('INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES (?, ?, ?)');
		const insRez = db.prepare(
			`INSERT INTO cfg_rez (sys_styl, poradie, typ, kod, nazov, dim, koef, offset, delit_n, kerf, pocet_ks, sklozavisle)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		);
		db.transaction(() => {
			for (const s of seed.sys) {
				// Deluxe sa seeduje až v <6 (potrebuje stĺpec dlzka_tyce, ktorý tu ešte nemusí existovať)
				if (s.sysStyl.startsWith('Deluxe')) continue;
				if (hasSys.get(s.sysStyl)) continue;
				insSys.run(s.sysStyl, s.N, s.skloOffset);
				for (const r of seed.rez.filter((x) => x.sysStyl === s.sysStyl))
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
			}
			db.pragma('user_version = 5');
		})();
	}

	if ((db.pragma('user_version', { simple: true }) as number) < 6) {
		// v5 → v6: Deluxe zasklenie (posuvná sklenená stena) — 10 štýlov + per-profil
		// dĺžka tyče (kladka/klzný 3600, 5K horná koľajnica 6000; Money-kritické, lebo
		// odpis = tyče × dĺžka tyče). Pridá stĺpec dlzka_tyce (existujúce Robust/Slide
		// riadky → default 7500, nezmenené) a naseeduje Deluxe štýly aj ich sklá.
		// Idempotentné: ALTER len ak stĺpec chýba, štýl/sklo len ak ešte nie sú.
		const hasCol = (
			db.prepare('PRAGMA table_info(cfg_rez)').all() as { name: string }[]
		).some((c) => c.name === 'dlzka_tyce');
		// ALTER PRED prepare(insRez) — prepare validuje SQL proti aktuálnej schéme,
		// takže stĺpec musí existovať skôr. Idempotentné cez hasCol; ak by seed
		// transakcia nižšie zlyhala, re-run preskočí ALTER (hasCol) a doseeduje.
		if (!hasCol) db.exec('ALTER TABLE cfg_rez ADD COLUMN dlzka_tyce REAL NOT NULL DEFAULT 7500');
		const hasSys = db.prepare('SELECT 1 FROM cfg_sys WHERE sys_styl = ?');
		const insSys = db.prepare('INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES (?, ?, ?)');
		const insRez = db.prepare(
			`INSERT INTO cfg_rez (sys_styl, poradie, typ, kod, nazov, dim, koef, offset, delit_n, kerf, pocet_ks, sklozavisle, dlzka_tyce)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		);
		const hasGlass = db.prepare('SELECT 1 FROM glass_types WHERE nazov = ?');
		const insGlass = db.prepare(
			'INSERT INTO glass_types (nazov, redukcia_zero, poradie, system) VALUES (?, ?, ?, ?)'
		);
		db.transaction(() => {
			for (const s of seed.sys) {
				if (!s.sysStyl.startsWith('Deluxe')) continue;
				if (hasSys.get(s.sysStyl)) continue;
				insSys.run(s.sysStyl, s.N, s.skloOffset);
				for (const r of seed.rez.filter((x) => x.sysStyl === s.sysStyl))
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
						r.sklozavisle,
						(r as { dlzkaTyce?: number }).dlzkaTyce ?? 7500
					);
			}
			for (const g of DELUXE_GLASS) if (!hasGlass.get(g.nazov)) insGlass.run(g.nazov, 0, g.poradie, 'Deluxe');
			db.pragma('user_version = 6');
		})();
	}

	seedData();
	seedUsers();
}

// Deluxe sklá (Float kalené) — len na plán/objednávku, NIE v Money odpise; žiadna
// redukcia (redukcia_zero = 0). 6/10 mm zodpovedá priemeru kladky štýlu.
const DELUXE_GLASS = [
	{ nazov: 'Float kalené 6 mm', poradie: 10 },
	{ nazov: 'Float kalené 10 mm', poradie: 20 }
];

// Sklá podľa systému: Robust = izolačné 4/16/4, Slide = izolačné 4/8/4
// (Slide „4/8/4 číre" nuluje Redukciu 6mm — sklozavislé profily sa nepočítajú),
// kalené sklá platia pre oba systémy (system = 'ALL').
function seedGlass() {
	const ins = db.prepare(
		'INSERT INTO glass_types (nazov, redukcia_zero, poradie, system) VALUES (?, ?, ?, ?)'
	);
	db.transaction(() => {
		ins.run('Izolačné sklo 4/16/4 mliečne', 0, 10, 'Robust');
		ins.run('Izolačné sklo 4/16/4 číre', 0, 20, 'Robust');
		ins.run('Izolačné sklo 4/8/4 mliečne', 0, 10, 'Slide');
		ins.run('Izolačné sklo 4/8/4 číre', 1, 20, 'Slide');
		ins.run('Kalené 8mm', 0, 30, 'ALL');
		ins.run('Kalené 10mm', 0, 40, 'ALL');
	})();
}

function seedData() {
	const sysCount = (db.prepare('SELECT COUNT(*) c FROM cfg_sys').get() as { c: number }).c;
	if (sysCount === 0) {
		const insSys = db.prepare('INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES (?, ?, ?)');
		const insRez = db.prepare(
			`INSERT INTO cfg_rez (sys_styl, poradie, typ, kod, nazov, dim, koef, offset, delit_n, kerf, pocet_ks, sklozavisle, dlzka_tyce)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
					r.sklozavisle,
					(r as { dlzkaTyce?: number }).dlzkaTyce ?? 7500
				);
		})();
	}
	const glassCount = (db.prepare('SELECT COUNT(*) c FROM glass_types').get() as { c: number }).c;
	if (glassCount === 0) seedGlass();
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
			'SELECT sys_styl, poradie, typ, kod, nazov, dim, koef, offset, delit_n, kerf, pocet_ks, sklozavisle, dlzka_tyce FROM cfg_rez ORDER BY sys_styl, poradie'
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
		sklozavisle: r.sklozavisle as 0 | 1,
		dlzkaTyce: r.dlzka_tyce as number
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

export interface GlassType {
	nazov: string;
	redukciaZero: boolean;
	system: string;
}

export function listGlassTypes(): GlassType[] {
	return (db
		.prepare('SELECT nazov, redukcia_zero, system FROM glass_types ORDER BY poradie')
		.all() as { nazov: string; redukcia_zero: number; system: string }[]).map((r) => ({
		nazov: r.nazov,
		redukciaZero: !!r.redukcia_zero,
		system: r.system
	}));
}

/** Sklá platné pre daný systém (jeho vlastné + spoločné 'ALL'). */
export function glassTypesForSystem(system: string): GlassType[] {
	return listGlassTypes().filter((g) => g.system === system || g.system === 'ALL');
}
