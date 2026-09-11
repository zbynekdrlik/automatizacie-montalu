// Migrácia v46 → v47: Štandard + opona IZO nárezák — 3 nové sysStyl (#504 round 3,
// Patrik úloha 854, msg 1823604). 2×4K opona IZO je 1:1 z reálneho Money Excelu,
// 2×2K/2×3K odvodené. Aditívne (INSERT z cfg_seed cez hasSys guard), Money-neutrálne
// pre existujúce štýly (žiaden existujúci riadok sa nemení, žiaden nový profilový kód).
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { migrateOponaIzo, seedData } from '../src/lib/server/migracie-seed';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v47-test-'));
const dbPath = path.join(tmpRoot, 'v46.db');

{
	const v46 = new Database(dbPath);
	// Minimálne base tabuľky — stav po v46 (BEZ Štandard+ opona IZO). cfg_rez plná
	// schéma (v47 do nej insertuje), plus jedna cudzia sys/rez ako dôkaz aditívnosti.
	v46.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0, money_kod TEXT, sklo_korekcia INTEGER, hrubka_trieda INTEGER, UNIQUE(nazov, system));
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
	`);
	v46.prepare("INSERT INTO users (username, pass_hash) VALUES ('t', 'x:y')").run();
	// cudzí systém — MUSÍ prežiť (dôkaz, že migrácia je scoped na 3 opona IZO štýly)
	v46.prepare("INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES ('Robust|2K', 2, 135)").run();
	v46
		.prepare(
			"INSERT INTO cfg_rez (sys_styl, poradie, typ, kod, nazov, dim) VALUES ('Robust|2K', 10, 'profil', 'ZASP00014', 'Koľajnica 2K', 'S')"
		)
		.run();
	v46.pragma('user_version = 46');
	v46.close();
}

process.env.DATABASE_PATH = dbPath;
const { db } = await import('../src/lib/server/db');

describe('migrácia v46 → v47: Štandard + opona IZO (#504 round 3)', () => {
	it('user_version === 47 po migrácii', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(47);
	});

	it('pribudli PRESNE 3 opona IZO sysStyl s N=4/6/8', () => {
		const rows = db
			.prepare(
				"SELECT sys_styl, n FROM cfg_sys WHERE sys_styl LIKE 'Štandard +|2x%K IZO' ORDER BY n"
			)
			.all() as { sys_styl: string; n: number }[];
		expect(rows).toEqual([
			{ sys_styl: 'Štandard +|2x2K IZO', n: 4 },
			{ sys_styl: 'Štandard +|2x3K IZO', n: 6 },
			{ sys_styl: 'Štandard +|2x4K IZO', n: 8 }
		]);
	});

	it('2×4K opona IZO rez riadky: 10 riadkov, U-profil ZASP202439 dvakrát, kľúčové offsety', () => {
		const rows = db
			.prepare(
				"SELECT poradie, kod, offset, pocet_ks, dlzka_tyce FROM cfg_rez WHERE sys_styl = 'Štandard +|2x4K IZO' ORDER BY poradie"
			)
			.all() as {
			poradie: number;
			kod: string;
			offset: number;
			pocet_ks: number;
			dlzka_tyce: number;
		}[];
		expect(rows.length).toBe(10);
		expect(rows.filter((r) => r.kod === 'ZASP202439').length).toBe(2);
		// prírez ZASP202415 off -335 ×16 na 3600mm tyči (1:1 z Excelu)
		const prirez = rows.find((r) => r.poradie === 20)!;
		expect(prirez).toMatchObject({
			kod: 'ZASP202415',
			offset: -335,
			pocet_ks: 16,
			dlzka_tyce: 3600
		});
		// U-šírka off -367; dorazová ×3 (Excel: opona IZO má 3, basic 2)
		expect(rows.find((r) => r.poradie === 45)).toMatchObject({ offset: -367, pocet_ks: 16 });
		expect(rows.find((r) => r.poradie === 40)).toMatchObject({ kod: 'ZASP202419', pocet_ks: 3 });
		// spodná koľajnica v seede BASIC (ZASP00033) — upsize na 5K rieši railUpsize za behu
		expect(rows.find((r) => r.poradie === 15)).toMatchObject({ kod: 'ZASP00033' });
	});

	it('2×2K opona IZO používa 2K koľajnice (ZASP00107/00104)', () => {
		const kody = (
			db
				.prepare(
					"SELECT kod FROM cfg_rez WHERE sys_styl = 'Štandard +|2x2K IZO' AND poradie IN (10,15) ORDER BY poradie"
				)
				.all() as { kod: string }[]
		).map((r) => r.kod);
		expect(kody).toEqual(['ZASP00107', 'ZASP00104']);
	});

	it('aditívne: cudzí systém (Robust|2K) prežije nedotknutý', () => {
		const r = db.prepare("SELECT n FROM cfg_sys WHERE sys_styl = 'Robust|2K'").get() as {
			n: number;
		};
		expect(r.n).toBe(2);
		const rez = db.prepare("SELECT COUNT(*) c FROM cfg_rez WHERE sys_styl = 'Robust|2K'").get() as {
			c: number;
		};
		expect(rez.c).toBe(1);
	});

	it('idempotencia: opätovné volanie (guard >= 47) nič nemení', () => {
		migrateOponaIzo(db, () => {
			throw new Error('bump sa nesmie zavolať znova — guard >= 47 mal vrátiť skôr');
		});
		expect(db.pragma('user_version', { simple: true })).toBe(47);
		// stále presne 3 opona IZO štýly (žiadny duplicitný insert)
		const c = db
			.prepare("SELECT COUNT(*) c FROM cfg_sys WHERE sys_styl LIKE 'Štandard +|2x%K IZO'")
			.get() as { c: number };
		expect(c.c).toBe(3);
	});

	it('feature-detect: DB bez cfg_sys/cfg_rez → bump(47) bez insertu (minimálne fixtúry nepadnú)', () => {
		const mini = new Database(':memory:');
		mini.pragma('user_version = 46');
		let bumped: number | null = null;
		expect(() =>
			migrateOponaIzo(mini, (v) => {
				mini.pragma(`user_version = ${v}`);
				bumped = v;
			})
		).not.toThrow();
		expect(bumped).toBe(47);
		mini.close();
	});

	it('insert-idempotencia: opona IZO štýly už zoseedované (fresh cez v9) → hasSys guard nezduplikuje', () => {
		const mini = new Database(':memory:');
		mini.exec(
			'CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);' +
				"CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);"
		);
		// simuluj fresh DB: opona IZO štýly už sú (v9 ich zoseedoval z cfg_seed)
		mini
			.prepare('INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES (?, ?, ?)')
			.run('Štandard +|2x4K IZO', 8, 0);
		mini.pragma('user_version = 46');
		migrateOponaIzo(mini, (v) => mini.pragma(`user_version = ${v}`));
		expect(mini.pragma('user_version', { simple: true })).toBe(47);
		// 2x4K IZO sa NEzduplikoval (bol už tam) — presne 1 riadok; 2x2K/2x3K pribudli
		const c = mini
			.prepare("SELECT COUNT(*) c FROM cfg_sys WHERE sys_styl = 'Štandard +|2x4K IZO'")
			.get() as { c: number };
		expect(c.c).toBe(1);
		mini.close();
	});

	it('fresh-install seed (seedData) zoseeduje opona IZO štýly z cfg_seed', () => {
		const mini = new Database(':memory:');
		mini.exec(
			'CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);' +
				"CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500);" +
				"CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL');"
		);
		// prázdne cfg_sys → seedData vloží CELÝ cfg_seed (fresh-install vetva)
		seedData(mini);
		// opona IZO štýly (#504 round 3) sú v cfg_seed → fresh install ich má
		const opona = mini
			.prepare(
				"SELECT sys_styl, n FROM cfg_sys WHERE sys_styl LIKE 'Štandard +|2x%K IZO' ORDER BY n"
			)
			.all() as { sys_styl: string; n: number }[];
		expect(opona.map((r) => r.sys_styl)).toEqual([
			'Štandard +|2x2K IZO',
			'Štandard +|2x3K IZO',
			'Štandard +|2x4K IZO'
		]);
		// 2×4K IZO má U-profil ZASP202439 dvakrát (dôkaz, že rez riadky sa zoseedovali)
		const u = mini
			.prepare(
				"SELECT COUNT(*) c FROM cfg_rez WHERE sys_styl = 'Štandard +|2x4K IZO' AND kod = 'ZASP202439'"
			)
			.get() as { c: number };
		expect(u.c).toBe(2);
		mini.close();
	});
});
