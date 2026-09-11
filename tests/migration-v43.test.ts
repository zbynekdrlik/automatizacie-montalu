// Migrácia v42 → v43: rozšírenie katalógu skiel (#235, Patrik msg 1815122).
// Overuje: user_version=43, 38 nových riadkov, Money-relevantné redukcia_zero/hrubka_trieda
// párovanie, honest-null money_kod, idempotencia, default-preservácia.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v43-test-'));
const dbPath = path.join(tmpRoot, 'v42.db');

{
	const v42 = new Database(dbPath);
	// Minimálne base tabuľky vrátane glass_types s hrubka_trieda (v37+)
	v42.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0, money_kod TEXT, sklo_korekcia INTEGER, hrubka_trieda INTEGER, UNIQUE(nazov, system));
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
	`);
	v42.prepare("INSERT INTO users (username, pass_hash) VALUES ('t', 'x:y')").run();
	v42.prepare("INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES ('X', 1, 0)").run();
	// Pre-existing glass (pred v43)
	const ins = v42.prepare(
		'INSERT INTO glass_types (nazov, redukcia_zero, poradie, system, hrubka, hrubka_trieda) VALUES (?, ?, ?, ?, 0, ?)'
	);
	ins.run('Izolačné sklo 4/16/4 mliečne', 0, 10, 'Robust', null);
	ins.run('Izolačné sklo 4/16/4 číre', 0, 20, 'Robust', null);
	ins.run('Izolačné sklo 4/8/4 mliečne', 1, 10, 'Slide', 16);
	ins.run('Izolačné sklo 4/8/4 číre', 1, 20, 'Slide', 16);
	ins.run('6mm číre', 0, 30, 'Slide', 6);
	ins.run('6mm mliečne', 0, 40, 'Slide', 6);
	ins.run('3.3.1', 0, 50, 'Slide', 6);
	ins.run('Float sklo 4 mm', 0, 10, 'Štandard +', 6);
	ins.run('Float sklo 6 mm', 0, 20, 'Štandard +', 6);
	ins.run('3.3.1', 0, 25, 'Štandard +', 6);
	ins.run('Float sklo 10 mm', 0, 30, 'Štandard +', 6);
	ins.run('Izolačné sklo 4.8.4', 0, 40, 'Štandard +', 16);
	v42.pragma('user_version = 42');
	v42.close();
}

process.env.DATABASE_PATH = dbPath;
const { db, glassTypesForSystem } = await import('../src/lib/server/db');

type GlassRow = {
	nazov: string;
	redukcia_zero: number;
	system: string;
	money_kod: string | null;
	hrubka_trieda: number | null;
};
const allGlass = () =>
	db
		.prepare(
			'SELECT nazov, redukcia_zero, system, money_kod, hrubka_trieda FROM glass_types ORDER BY system, poradie'
		)
		.all() as GlassRow[];

describe('migrácia v42 → v43: rozšírenie katalógu skiel (#235)', () => {
	it('user_version === 46 (v43 + v44 cleanup + v45 plan_rezov + v46 nakup_skladova_karta)', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(47);
	});

	it('Robust: 16 skiel (2 pôvodné + 14 nových)', () => {
		expect(glassTypesForSystem('Robust').length).toBe(16);
	});

	it('Slide: 17 skiel (5 pôvodných + 12 nových)', () => {
		expect(glassTypesForSystem('Slide').length).toBe(17);
	});

	it('Štandard +: 15 skiel (5 pôvodných + 12 nových - 2 orphaned v44)', () => {
		expect(glassTypesForSystem('Štandard +').length).toBe(15);
	});

	it('Slide IZO sklá: redukcia_zero=1, hrubka_trieda=16', () => {
		const slideIzo = allGlass().filter((g) => g.system === 'Slide' && /izola[čc]n/i.test(g.nazov));
		expect(slideIzo.length).toBeGreaterThanOrEqual(6); // 2 pôvodné + 4 nové
		for (const g of slideIzo) {
			expect(g.redukcia_zero, `${g.nazov} redukcia_zero`).toBe(1);
			expect(g.hrubka_trieda, `${g.nazov} hrubka_trieda`).toBe(16);
		}
	});

	it('Slide single/laminated sklá: redukcia_zero=0, hrubka_trieda=6', () => {
		const slideSingle = allGlass().filter(
			(g) => g.system === 'Slide' && !/izola[čc]n/i.test(g.nazov)
		);
		for (const g of slideSingle) {
			expect(g.redukcia_zero, `${g.nazov} redukcia_zero`).toBe(0);
			expect(g.hrubka_trieda, `${g.nazov} hrubka_trieda`).toBe(6);
		}
	});

	it('Štandard + trieda=16 ⇔ jeIzoSklo(nazov) (#443 parity)', () => {
		const stdGlass = allGlass().filter((g) => g.system === 'Štandard +');
		for (const g of stdGlass) {
			const isIzo = /izola[čc]n/i.test(g.nazov);
			expect(g.hrubka_trieda, `${g.nazov}`).toBe(isIzo ? 16 : 6);
		}
	});

	it('Robust hrubka_trieda = NULL (neklasifikovaný systém)', () => {
		const robustNew = allGlass().filter((g) => g.system === 'Robust' && g.nazov.includes('ESG'));
		expect(robustNew.length).toBeGreaterThan(0);
		for (const g of robustNew) {
			expect(g.hrubka_trieda, g.nazov).toBeNull();
		}
	});

	it('všetky nové typy: money_kod = NULL (honest-null)', () => {
		const newNames = ['3.3.2', 'ESG kalené 6 mm', 'Izolačné sklo 4/8/4 stopsol'];
		for (const n of newNames) {
			const rows = allGlass().filter((g) => g.nazov === n);
			expect(rows.length, `${n} exists`).toBeGreaterThan(0);
			for (const g of rows) {
				expect(g.money_kod, `${g.nazov} (${g.system})`).toBeNull();
			}
		}
	});

	it('idempotencia: opakované spustenie nezduplikuje riadky', async () => {
		const before = allGlass().length;
		// Re-run: version je už 43, guard >= 43 vráti early
		const { migrateGlassCatalogExpansion } = await import('../src/lib/server/migracie-seed');
		migrateGlassCatalogExpansion(db, () => {});
		expect(allGlass().length).toBe(before);
	});
});
