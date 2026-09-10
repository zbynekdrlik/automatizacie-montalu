// Migrácia v43 → v44: vyčistenie orphaned glass_types pre Štandard+ (#504, Patrik 10.9.).
// v43 (migrateGlassCatalogExpansion) pridala plnú škálu skiel cez INSERT OR IGNORE ale
// nevyčistila staré v9 seed záznamy:
//  - "Float sklo 10 mm" (poradie 30) — v43 namiesto neho pridáva "ESG kalené 10 mm"
//  - "Izolačné sklo 4.8.4" (poradie 40) — nahradená v43 variantmi "4/8/4 číre/mliečne/stopsol"
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v44-test-'));
const dbPath = path.join(tmpRoot, 'v43.db');

{
	const v43 = new Database(dbPath);
	// Minimálne base tabuľky — stav po v43 (vrátane orphaned entries)
	v43.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0, money_kod TEXT, sklo_korekcia INTEGER, hrubka_trieda INTEGER, UNIQUE(nazov, system));
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
	`);
	v43.prepare("INSERT INTO users (username, pass_hash) VALUES ('t', 'x:y')").run();
	v43.prepare("INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES ('X', 1, 0)").run();
	// Štandard+ sklá — stav po v43 (5 pôvodných + 12 nových = 17), vrátane orphaned
	const ins = v43.prepare(
		'INSERT INTO glass_types (nazov, redukcia_zero, poradie, system, hrubka, hrubka_trieda) VALUES (?, ?, ?, ?, 0, ?)'
	);
	// Pôvodné (v9 seed) — vrátane dvoch orphaned:
	ins.run('Float sklo 4 mm', 0, 10, 'Štandard +', 6);
	ins.run('Float sklo 6 mm', 0, 20, 'Štandard +', 6);
	ins.run('3.3.1', 0, 25, 'Štandard +', 6);
	ins.run('Float sklo 10 mm', 0, 30, 'Štandard +', 6); // ORPHANED — v43 ho nechcela
	ins.run('Izolačné sklo 4.8.4', 0, 40, 'Štandard +', 16); // ORPHANED — nahradená 4/8/4
	// v43 nové:
	ins.run('3.3.1 mliečne', 0, 45, 'Štandard +', 6);
	ins.run('3.3.2', 0, 47, 'Štandard +', 6);
	ins.run('3.3.2 mliečne', 0, 49, 'Štandard +', 6);
	ins.run('Izolačné sklo 4/8/4 číre', 0, 50, 'Štandard +', 16);
	ins.run('Izolačné sklo 4/8/4 mliečne', 0, 52, 'Štandard +', 16);
	ins.run('Izolačné sklo 4/8/4 stopsol', 0, 54, 'Štandard +', 16);
	ins.run('Izolačné sklo 4/16/4 číre', 0, 56, 'Štandard +', 16);
	ins.run('Izolačné sklo 4/16/4 mliečne', 0, 58, 'Štandard +', 16);
	ins.run('Izolačné sklo 4/16/4 stopsol', 0, 60, 'Štandard +', 16);
	ins.run('ESG kalené 4 mm', 0, 70, 'Štandard +', 6);
	ins.run('ESG kalené 6 mm', 0, 72, 'Štandard +', 6);
	ins.run('ESG kalené 10 mm', 0, 74, 'Štandard +', 6);
	// Iné systémy (Robust "Float sklo 10 mm" MUSÍ prežiť)
	ins.run('Float sklo 10 mm', 0, 44, 'Robust', null);
	ins.run('Float sklo 4 mm', 0, 40, 'Robust', null);
	v43.pragma('user_version = 43');
	v43.close();
}

process.env.DATABASE_PATH = dbPath;
const { db, glassTypesForSystem } = await import('../src/lib/server/db');

describe('migrácia v43 → v44: vyčistenie orphaned Štandard+ skiel (#504)', () => {
	it('user_version === 44', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(44);
	});

	it('Štandard+: NEMÁ "Float sklo 10 mm" (orphaned v9 seed)', () => {
		const names = glassTypesForSystem('Štandard +').map((g) => g.nazov);
		expect(names).not.toContain('Float sklo 10 mm');
	});

	it('Štandard+: NEMÁ "Izolačné sklo 4.8.4" (orphaned bodková notácia)', () => {
		const names = glassTypesForSystem('Štandard +').map((g) => g.nazov);
		expect(names).not.toContain('Izolačné sklo 4.8.4');
	});

	it('Štandard+: 15 skiel (17 - 2 orphaned)', () => {
		expect(glassTypesForSystem('Štandard +').length).toBe(15);
	});

	it('Štandard+: MÁ IZO 4/16/4 číre (Patrikova požiadavka)', () => {
		const names = glassTypesForSystem('Štandard +').map((g) => g.nazov);
		expect(names).toContain('Izolačné sklo 4/16/4 číre');
	});

	it('Štandard+: MÁ ESG kalené 10 mm (korektná 10mm náhrada)', () => {
		const names = glassTypesForSystem('Štandard +').map((g) => g.nazov);
		expect(names).toContain('ESG kalené 10 mm');
	});

	it('Robust: "Float sklo 10 mm" PREŽIJE (delete je scoped na Štandard+)', () => {
		const names = glassTypesForSystem('Robust').map((g) => g.nazov);
		expect(names).toContain('Float sklo 10 mm');
	});
});
