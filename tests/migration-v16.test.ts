// Reálny prod upgrade path v15 → v16: Slide opona — redukcia 6 mm (ZASP00091) prejde
// z z-Robustu odvodenej geometrie (2x3K 127,47 / 2x2K 21, V−65) na „prírez mínus 72,4"
// v OBOCH dimenziách (Dominik 2026-07-27, potvrdené aj pre výšku).
//
// Postav DB v stave v15 (rámový + oponový už opravené, redukcia stará), import db.ts
// spustí SKUTOČNÝ v16 blok → over redukciu a že sa NIČ INÉ nepohlo.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import seed from '../src/lib/server/cfg_seed.json';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v16-test-'));
const dbPath = path.join(tmpRoot, 'v15.db');

// stav po v15: redukcia ešte na starých (z-Robustu) offsetoch
const V15_RED: Record<string, number> = {
	'Slide|2x3K|40': 127.47,
	'Slide|2x2K|40': 21,
	'Slide|2x3K|41': -65,
	'Slide|2x2K|41': -65
};

{
	const v15 = new Database(dbPath);
	v15.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL UNIQUE, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0);
	`);
	const insSys = v15.prepare('INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES (?, ?, ?)');
	const insRez = v15.prepare(
		`INSERT INTO cfg_rez (sys_styl, poradie, typ, kod, nazov, dim, koef, offset, delit_n, kerf, pocet_ks, sklozavisle, dlzka_tyce, sklo_hrubka)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);
	for (const s of seed.sys) insSys.run(s.sysStyl, s.N, s.skloOffset);
	for (const r of seed.rez) {
		const old = V15_RED[`${r.sysStyl}|${r.poradie}`];
		insRez.run(
			r.sysStyl,
			r.poradie,
			r.typ,
			r.kod,
			r.nazov,
			r.dim,
			r.koef,
			old ?? r.offset,
			r.delitN,
			r.kerf,
			r.pocetKs,
			r.sklozavisle,
			(r as { dlzkaTyce?: number }).dlzkaTyce ?? 7500,
			(r as { skloHrubka?: number }).skloHrubka ?? 0
		);
	}
	v15.exec("INSERT INTO glass_types (nazov, redukcia_zero, poradie, system) VALUES ('X', 0, 1, 'ALL')");
	v15.pragma('user_version = 15');
	v15.close();
}

process.env.DATABASE_PATH = dbPath;
const { db } = await import('../src/lib/server/db');

const row = (sysStyl: string, poradie: number) =>
	db
		.prepare('SELECT kod, offset, pocet_ks FROM cfg_rez WHERE sys_styl = ? AND poradie = ?')
		.get(sysStyl, poradie) as { kod: string; offset: number; pocet_ks: number } | undefined;
const off = (sysStyl: string, poradie: number) => row(sysStyl, poradie)?.offset;

describe('reálny v15 → v16: Slide opona redukcia 6 mm = prírez − 72,4', () => {
	it('user_version = 17', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(17);
	});

	it('redukcia šírka: offset = rámový − 72,4·N (2x3K −291,9 ; 2x2K −249,0)', () => {
		expect(off('Slide|2x3K', 40)).toBe(-291.9); // bolo 127,47
		expect(off('Slide|2x2K', 40)).toBe(-249); // bolo 21
	});

	it('redukcia výška: offset = −139,4 (rámový −67 mínus 72,4) pre oba štýly', () => {
		expect(off('Slide|2x3K', 41)).toBe(-139.4); // bolo −65
		expect(off('Slide|2x2K', 41)).toBe(-139.4);
	});

	it('offsety sedia s aritmetikou rámového profilu (nie s ručne prepísaným číslom)', () => {
		for (const [ss, N] of [
			['Slide|2x3K', 6],
			['Slide|2x2K', 4]
		] as [string, number][]) {
			expect(off(ss, 40)!).toBeCloseTo(off(ss, 20)! - 72.4 * N, 6);
			expect(off(ss, 41)!).toBeCloseTo(off(ss, 21)! - 72.4, 6);
		}
	});

	it('kód a POČTY kusov redukcie sa nemenia (reže sa s rámovým, rovnaké množstvo)', () => {
		for (const ss of ['Slide|2x2K', 'Slide|2x3K']) {
			for (const p of [40, 41]) {
				const r = row(ss, p)!;
				expect(r.kod, `${ss}|${p}`).toBe('ZASP00091');
				expect(r.pocet_ks, `${ss}|${p}`).toBe(row(ss, p - 20)!.pocet_ks);
			}
		}
	});

	it('KAŽDÝ Slide opona riadok sedí s cfg_seed (žiadny drift)', () => {
		for (const s of seed.rez) {
			if (s.sysStyl !== 'Slide|2x2K' && s.sysStyl !== 'Slide|2x3K') continue;
			const r = row(s.sysStyl, s.poradie)!;
			const key = `${s.sysStyl}|${s.poradie}`;
			expect(r.offset, key).toBe(s.offset);
			expect(r.kod, key).toBe(s.kod);
		}
	});

	it('NEDOTKNE rámový, oponový, nosový, koľajnicu ani sklo (v13/v15 hodnoty držia)', () => {
		expect(off('Slide|2x3K', 20)).toBe(142.5); // rámový šírka (v15)
		expect(off('Slide|2x3K', 21)).toBe(-67); // rámový výška (v15)
		expect(row('Slide|2x3K', 25)?.kod).toBe('ZASP20249'); // oponový článok (v15)
		expect(off('Slide|2x3K', 30)).toBe(-67); // nosový (v13)
		expect(off('Slide|2x3K', 10)).toBe(0); // koľajnica
		expect(off('Slide|2x3K', 90)).toBe(142.5); // sklo šírka (v13)
		expect(off('Slide|2x3K', 91)).toBe(-67); // sklo výška (v13)
	});

	it('iné systémy s redukciou/rovnakým poradím sa nemenia (Robust opona)', () => {
		for (const ss of ['Robust|2x2K', 'Robust|2x3K']) {
			const seedRows = seed.rez.filter((r) => r.sysStyl === ss);
			for (const s of seedRows) expect(off(ss, s.poradie), `${ss}|${s.poradie}`).toBe(s.offset);
		}
	});
});
