// Reálny prod upgrade path v35 → v36: stĺpec `sklo_korekcia` na tabuľke `glass_types` (#440,
// per-sklo korekcia rozmeru skla). Postav DB v stave v35 (base tabuľky s ≥1 riadkom → seedData/
// seedUsers no-opnú; `glass_types` BEZ `sklo_korekcia` + 1 existujúci riadok), import db.ts spustí
// SKUTOČNÝ v36 blok (staršie sa preskočia). Overuje: user_version=36, pribudol nullable stĺpec
// `sklo_korekcia`, existujúci riadok prežil s `sklo_korekcia IS NULL` (žiadny override = systémový
// skloOffset), nový riadok sa dá zapísať s konkrétnou korekciou.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v36-test-'));
const dbPath = path.join(tmpRoot, 'v35.db');

{
	const v35 = new Database(dbPath);
	// Minimálne base tabuľky, aby seedData/seedUsers po migrácii no-opli (≥1 riadok v každej).
	// `glass_types` ZÁMERNE bez `sklo_korekcia` — v36 ho pridá.
	v35.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0, UNIQUE(nazov, system));
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
	`);
	v35
		.prepare("INSERT INTO users (username, pass_hash, role) VALUES ('palo', 'x:y', 'internal')")
		.run();
	v35.prepare("INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES ('X', 1, 83)").run();
	// existujúce sklo bez korekcie — musí migráciu prežiť s NULL
	v35.prepare("INSERT INTO glass_types (nazov, system) VALUES ('IZO 4/8/4', 'Slide')").run();
	v35.pragma('user_version = 35');
	v35.close();
}

process.env.DATABASE_PATH = dbPath;
const { db } = await import('../src/lib/server/db');

describe('migrácia v35 → v36: stĺpec sklo_korekcia na glass_types (#440)', () => {
	it('user_version === 36 po migrácii', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(36);
	});

	it('tabuľka glass_types má nový stĺpec sklo_korekcia', () => {
		const cols = (db.prepare('PRAGMA table_info(glass_types)').all() as { name: string }[]).map(
			(c) => c.name
		);
		expect(cols).toContain('sklo_korekcia');
	});

	it('existujúce sklo prežilo migráciu s sklo_korekcia IS NULL (žiadny override = systémový offset)', () => {
		const row = db
			.prepare("SELECT nazov, sklo_korekcia FROM glass_types WHERE nazov = 'IZO 4/8/4'")
			.get() as { nazov: string; sklo_korekcia: number | null };
		expect(row.nazov).toBe('IZO 4/8/4');
		expect(row.sklo_korekcia).toBeNull();
	});

	it('nové sklo sa dá zapísať s konkrétnou korekciou', () => {
		db.prepare(
			"INSERT INTO glass_types (nazov, system, sklo_korekcia) VALUES ('6mm', 'Slide', 40)"
		).run();
		const row = db.prepare("SELECT sklo_korekcia FROM glass_types WHERE nazov = '6mm'").get() as {
			sklo_korekcia: number | null;
		};
		expect(row.sklo_korekcia).toBe(40);
	});
});
