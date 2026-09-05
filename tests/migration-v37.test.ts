// Reálny prod upgrade path v36 → v37 (#443): trieda skladby posuvu podľa HRÚBKY skla
// (6/16 mm) namiesto per-sklo korekcie. Postav DB v stave v36 (base tabuľky + KURÁTOROVANÉ
// dáta — redukcia_zero pre Slide, mená pre Štandard +, per-sklo `sklo_korekcia` v jednotnej
// AJ zmiešanej skupine), import db.ts spustí SKUTOČNÝ v37 blok. Overuje: user_version=37,
// pribudol stĺpec `hrubka_trieda` + tabuľka `cfg_sklo_trieda`, backfill mapping presný,
// promócia OBE vetvy (jednotná → povýšená + vynulovaná per-sklo; zmiešaná → nedotknutá),
// osamotená NULL korekcia sa nepromuje, idempotencia (druhé volanie migrácie nič nemení).
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { migrateHrubkaTrieda } from '../src/lib/server/migracie-seed';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v37-test-'));
const dbPath = path.join(tmpRoot, 'v36.db');

{
	const v36 = new Database(dbPath);
	// Minimálne base tabuľky (vzor migration-v36.test.ts) — `glass_types` UŽ MÁ
	// `sklo_korekcia` (v36 stav), `hrubka_trieda` ZÁMERNE chýba — v37 ho pridá.
	v36.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0, sklo_korekcia INTEGER, UNIQUE(nazov, system));
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
	`);
	v36
		.prepare("INSERT INTO users (username, pass_hash, role) VALUES ('palo', 'x:y', 'internal')")
		.run();
	v36.prepare("INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES ('X', 1, 83)").run();

	const ins = v36.prepare(
		'INSERT INTO glass_types (nazov, redukcia_zero, poradie, system, sklo_korekcia) VALUES (?, ?, ?, ?, ?)'
	);
	// Slide, trieda 6 (redukcia_zero=0) — JEDNOTNÁ korekcia 15 → očakávaná promócia.
	ins.run('Slide 6mm Jednotna A', 0, 10, 'Slide', 15);
	ins.run('Slide 6mm Jednotna B', 0, 20, 'Slide', 15);
	// Slide, trieda 16 (redukcia_zero=1) — ZMIEŠANÁ korekcia (40 vs NULL) → BEZ promócie.
	ins.run('Slide IZO Zmiesana A', 1, 30, 'Slide', 40);
	ins.run('Slide IZO Zmiesana B', 1, 40, 'Slide', null);
	// Štandard + — IZO-nosť z NÁZVU (jeIzoSklo), obe osamotené NULL korekcie.
	ins.run('Float sklo 4 mm', 0, 10, 'Štandard +', null);
	ins.run('Izolačné sklo 4.8.4', 0, 20, 'Štandard +', null);
	// Robust — honest-null (trieda sa nikdy nenastaví).
	ins.run('Izolačné 4/16/4 A', 0, 10, 'Robust', null);

	v36.pragma('user_version = 36');
	v36.close();
}

process.env.DATABASE_PATH = dbPath;
const { db } = await import('../src/lib/server/db');

const glass = (nazov: string, system: string) =>
	db.prepare('SELECT * FROM glass_types WHERE nazov = ? AND system = ?').get(nazov, system) as
		{ hrubka_trieda: number | null; sklo_korekcia: number | null } | undefined;

const trieda = (system: string, t: number) =>
	db
		.prepare('SELECT korekcia FROM cfg_sklo_trieda WHERE system = ? AND trieda = ?')
		.get(system, t) as { korekcia: number } | undefined;

describe('migrácia v36 → v37: trieda skladby posuvu podľa hrúbky skla (#443)', () => {
	it('user_version === 37 po migrácii', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(39);
	});

	it('tabuľka glass_types má nový stĺpec hrubka_trieda', () => {
		const cols = (db.prepare('PRAGMA table_info(glass_types)').all() as { name: string }[]).map(
			(c) => c.name
		);
		expect(cols).toContain('hrubka_trieda');
	});

	it('tabuľka cfg_sklo_trieda existuje', () => {
		const row = db
			.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cfg_sklo_trieda'")
			.get();
		expect(row).toBeTruthy();
	});

	it('Slide backfill z redukcia_zero: 1 → trieda 16, 0 → trieda 6', () => {
		expect(glass('Slide 6mm Jednotna A', 'Slide')?.hrubka_trieda).toBe(6);
		expect(glass('Slide 6mm Jednotna B', 'Slide')?.hrubka_trieda).toBe(6);
		expect(glass('Slide IZO Zmiesana A', 'Slide')?.hrubka_trieda).toBe(16);
		expect(glass('Slide IZO Zmiesana B', 'Slide')?.hrubka_trieda).toBe(16);
	});

	it('Štandard + backfill: jeIzoSklo(nazov) rozhoduje triedu', () => {
		expect(glass('Float sklo 4 mm', 'Štandard +')?.hrubka_trieda).toBe(6);
		expect(glass('Izolačné sklo 4.8.4', 'Štandard +')?.hrubka_trieda).toBe(16);
	});

	it('Robust: honest-null (trieda sa neuplatňuje, nedotknuté)', () => {
		expect(glass('Izolačné 4/16/4 A', 'Robust')?.hrubka_trieda).toBeNull();
	});

	it('promócia: jednotná per-sklo korekcia (Slide trieda 6, obe 15) → cfg_sklo_trieda + per-sklo vynulované', () => {
		expect(trieda('Slide', 6)?.korekcia).toBe(15);
		expect(glass('Slide 6mm Jednotna A', 'Slide')?.sklo_korekcia).toBeNull();
		expect(glass('Slide 6mm Jednotna B', 'Slide')?.sklo_korekcia).toBeNull();
	});

	it('žiadna promócia: zmiešaná per-sklo korekcia (Slide trieda 16) ostáva nedotknutá', () => {
		expect(trieda('Slide', 16)).toBeUndefined();
		expect(glass('Slide IZO Zmiesana A', 'Slide')?.sklo_korekcia).toBe(40);
		expect(glass('Slide IZO Zmiesana B', 'Slide')?.sklo_korekcia).toBeNull();
	});

	it('žiadna promócia pre osamotenú NULL korekciu (Štandard + obe triedy)', () => {
		expect(trieda('Štandard +', 6)).toBeUndefined();
		expect(trieda('Štandard +', 16)).toBeUndefined();
	});

	it('idempotencia: opätovné volanie migrácie (guard >= 37) nič nemení', () => {
		const before = db.prepare('SELECT * FROM cfg_sklo_trieda ORDER BY system, trieda').all();
		const beforeGlass = db.prepare('SELECT * FROM glass_types ORDER BY id').all();
		migrateHrubkaTrieda(db, () => {
			throw new Error('bump sa nesmie zavolať znova — guard >= 37 mal vrátiť skôr');
		});
		expect(db.prepare('SELECT * FROM cfg_sklo_trieda ORDER BY system, trieda').all()).toEqual(
			before
		);
		expect(db.prepare('SELECT * FROM glass_types ORDER BY id').all()).toEqual(beforeGlass);
		expect(db.pragma('user_version', { simple: true })).toBe(39);
	});
});
