// Reálny prod upgrade path v13 → v14: Slide opona rámový šírkový rez podľa reálneho
// Excelu od Dominika (potvrdené 2026-07-23): „dĺžka rezu" = (S−12)/N (offset −12),
// namiesto z-Robustu odvodeného (S+127,47)/6 resp. +21. Postav DB v stave v13 (sklo už
// opravené) so STARÝM rámovým offsetom, import db.ts spustí SKUTOČNÝ v14 blok → over že
// rámový opraví na −12 a NEDOTKNE koľajnicu/rámový-V/sklo. MENÍ Money billing ZASP00088
// (schválené Dominikom) — dôkaz zmeny je v compute.test.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import seed from '../src/lib/server/cfg_seed.json';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v14-test-'));
const dbPath = path.join(tmpRoot, 'v13.db');

// STARÝ rámový offset (pred v14), kľúč `sysStyl|poradie`.
const OLD_RAM: Record<string, number> = {
	'Slide|2x3K|20': 127.47, // rámový S (z-Robustu odvodený)
	'Slide|2x2K|20': 21
};

{
	const v13 = new Database(dbPath);
	v13.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL UNIQUE, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0);
	`);
	const insSys = v13.prepare('INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES (?, ?, ?)');
	const insRez = v13.prepare(
		`INSERT INTO cfg_rez (sys_styl, poradie, typ, kod, nazov, dim, koef, offset, delit_n, kerf, pocet_ks, sklozavisle, dlzka_tyce, sklo_hrubka)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);
	for (const s of seed.sys) insSys.run(s.sysStyl, s.N, s.skloOffset);
	for (const r of seed.rez) {
		// v13 stav: sklo/nosový/oponový už opravené (seed), rámový ešte STARÝ
		const oldRam = OLD_RAM[`${r.sysStyl}|${r.poradie}`];
		insRez.run(
			r.sysStyl,
			r.poradie,
			r.typ,
			r.kod,
			r.nazov,
			r.dim,
			r.koef,
			oldRam ?? r.offset,
			r.delitN,
			r.kerf,
			r.pocetKs,
			r.sklozavisle,
			(r as { dlzkaTyce?: number }).dlzkaTyce ?? 7500,
			(r as { skloHrubka?: number }).skloHrubka ?? 0
		);
	}
	v13.exec("INSERT INTO glass_types (nazov, redukcia_zero, poradie, system) VALUES ('X', 0, 1, 'ALL')");
	v13.pragma('user_version = 13');
	v13.close();
}

process.env.DATABASE_PATH = dbPath;
const { db } = await import('../src/lib/server/db');

const off = (sysStyl: string, poradie: number) =>
	(db.prepare('SELECT offset FROM cfg_rez WHERE sys_styl = ? AND poradie = ?').get(sysStyl, poradie) as
		| { offset: number }
		| undefined)?.offset;

describe('reálny v13 → v14 (+v15): Slide opona rámový podľa Excelu', () => {
	it('user_version = 17', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(18);
	});

	// v14 dala rámový na −12 (Excel stĺpec „dĺžka rezu"), v15 to opravila na stĺpec
	// „rozmer". Reťaz v14→v15 beží pri tomto importe naraz, takže koncový stav = v15.
	it('rámový opravený zo STARÉHO na Excelov „rozmer" (obe štýly)', () => {
		expect(off('Slide|2x3K', 20)).toBe(142.5); // 127.47 → (v14: −12) → 142.5
		expect(off('Slide|2x2K', 20)).toBe(40.6); // 21 → (v14: −12) → 40.6
	});

	it('NEDOTKNE sklo/nosový (v13) ani koľajnicu', () => {
		expect(off('Slide|2x3K', 90)).toBe(142.5); // sklo šírka (v13)
		expect(off('Slide|2x3K', 30)).toBe(-67); // nosový (v13)
		expect(off('Slide|2x3K', 10)).toBe(0); // koľajnica
	});
});
