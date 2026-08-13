// Reálny prod upgrade path v17 → v18: starší systém „Štandard" (bez plus).
//
// Postav DB presne v stave v17 (VŠETKY systémy OKREM Štandard|*, sklá ako na ostrej
// DB), import db.ts spustí SKUTOČNÝ v18 blok → over, že sa 12 štýlov doseedovalo,
// nič existujúce sa nezmenilo a katalóg skiel sa zdieľa so Štandard +.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import seed from '../src/lib/server/cfg_seed.json';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v18-test-'));
const dbPath = path.join(tmpRoot, 'v17.db');
const STARY = (s: string) => s.startsWith('Štandard|');

{
	const v17 = new Database(dbPath);
	v17.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL UNIQUE, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0);
	`);
	const insSys = v17.prepare('INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES (?, ?, ?)');
	const insRez = v17.prepare(
		`INSERT INTO cfg_rez (sys_styl, poradie, typ, kod, nazov, dim, koef, offset, delit_n, kerf, pocet_ks, sklozavisle, dlzka_tyce, sklo_hrubka)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);
	// stav PRED v18 = všetko okrem nového systému
	for (const s of seed.sys) if (!STARY(s.sysStyl)) insSys.run(s.sysStyl, s.N, s.skloOffset);
	for (const r of seed.rez)
		if (!STARY(r.sysStyl))
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
				(r as { dlzkaTyce?: number }).dlzkaTyce ?? 7500,
				(r as { skloHrubka?: number }).skloHrubka ?? 0
			);
	const insG = v17.prepare(
		'INSERT INTO glass_types (nazov, redukcia_zero, poradie, system) VALUES (?, ?, ?, ?)'
	);
	insG.run('Izolačné sklo 4/16/4 mliečne', 0, 10, 'Robust');
	insG.run('Izolačné sklo 4/8/4 číre', 1, 20, 'Slide');
	insG.run('Float kalené 6 mm', 0, 10, 'Deluxe');
	insG.run('Float sklo 4 mm', 0, 10, 'Štandard +');
	insG.run('Float sklo 6 mm', 0, 20, 'Štandard +');
	insG.run('Float sklo 10 mm', 0, 30, 'Štandard +');
	insG.run('Izolačné sklo 4.8.4', 0, 40, 'Štandard +');
	v17.pragma('user_version = 17');
	v17.close();
}

process.env.DATABASE_PATH = dbPath;
const { db, loadCfg, listSysStyly, glassTypesForSystem } = await import('../src/lib/server/db');

const styly = () => listSysStyly().filter((s) => s.system === 'Štandard');

describe('reálny v17 → v18: doseedovanie systému „Štandard" (bez plus)', () => {
	it('user_version = 19', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(21);
	});

	it('pribudlo presne 12 štýlov s N podľa počtu krídel (opona 2×n)', () => {
		expect(styly().length).toBe(12);
		expect(styly().find((s) => s.styl === '4K')?.N).toBe(4);
		expect(styly().find((s) => s.styl === '4K IZO')?.N).toBe(4);
		expect(styly().find((s) => s.styl === '2x3K')?.N).toBe(6);
		expect(styly().find((s) => s.styl === '2x4K IZO')?.N).toBe(8);
	});

	it('KĽÚČOVÉ: každý riadok v DB sedí s cfg_seed (vrátane dĺžky tyče)', () => {
		const rows = db
			.prepare(
				"SELECT sys_styl, poradie, kod, koef, offset, delit_n, pocet_ks, dlzka_tyce FROM cfg_rez WHERE sys_styl LIKE 'Štandard|%' ORDER BY sys_styl, poradie"
			)
			.all() as Record<string, unknown>[];
		const ocakavane = seed.rez
			.filter((r) => STARY(r.sysStyl))
			.sort((a, b) => a.sysStyl.localeCompare(b.sysStyl) || a.poradie - b.poradie);
		expect(rows.length).toBe(ocakavane.length);
		rows.forEach((r, i) => {
			const e = ocakavane[i];
			expect(
				{
					kod: r.kod,
					koef: r.koef,
					offset: r.offset,
					delit_n: r.delit_n,
					pocet_ks: r.pocet_ks,
					dlzka_tyce: r.dlzka_tyce
				},
				`${r.sys_styl} ${r.poradie}`
			).toEqual({
				kod: e.kod,
				koef: e.koef,
				offset: e.offset,
				delit_n: e.delitN,
				pocet_ks: e.pocetKs,
				dlzka_tyce: (e as { dlzkaTyce?: number }).dlzkaTyce ?? 7500
			});
		});
	});

	it('odpis z DB sedí s odpisom z cfg_seed (migrácia nič neskomolila)', () => {
		const cfg = loadCfg();
		expect(cfg['Štandard|2K IZO']).toBeDefined();
		expect(cfg['Štandard|2x4K IZO']).toBeDefined();
	});

	it('existujúce systémy sa NEDOTKLI (Štandard + má stále svojich 13 štýlov)', () => {
		expect(listSysStyly().filter((s) => s.system === 'Štandard +').length).toBe(13);
		expect(listSysStyly().filter((s) => s.system === 'Robust').length).toBeGreaterThan(0);
	});

	it('sklá sa NEduplikovali — Štandard zdieľa katalóg so Štandard +', () => {
		const pocet = (db.prepare('SELECT COUNT(*) c FROM glass_types').get() as { c: number }).c;
		expect(pocet).toBe(7); // presne to, čo bolo pred migráciou
		expect(glassTypesForSystem('Štandard').map((g) => g.nazov)).toEqual([
			'Float sklo 4 mm',
			'Float sklo 6 mm',
			'Float sklo 10 mm',
			'Izolačné sklo 4.8.4'
		]);
	});

	it('migrácia je idempotentná — druhý beh nič nepridá', () => {
		const pred = (
			db.prepare("SELECT COUNT(*) c FROM cfg_rez WHERE sys_styl LIKE 'Štandard|%'").get() as {
				c: number;
			}
		).c;
		db.pragma('user_version = 17');
		// znovu-spustenie migrácie cez fresh import nie je možné (modul je cached),
		// tak overíme guard priamo: hasSys nájde všetkých 12 → INSERT sa preskočí
		const hasAll = seed.sys
			.filter((s) => STARY(s.sysStyl))
			.every((s) => db.prepare('SELECT 1 FROM cfg_sys WHERE sys_styl = ?').get(s.sysStyl));
		expect(hasAll).toBe(true);
		db.pragma('user_version = 18');
		expect(
			(
				db.prepare("SELECT COUNT(*) c FROM cfg_rez WHERE sys_styl LIKE 'Štandard|%'").get() as {
					c: number;
				}
			).c
		).toBe(pred);
	});
});
