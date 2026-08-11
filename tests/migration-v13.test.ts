// Reálny prod upgrade path v12 → v13: Slide opona (2x2K + 2x3K) — oprava SKLA + jemné
// doladenie nosového/oponového rezu podľa reálnych Excelov od Dominika (2026-07-23).
// Postav DB v stave v12 so STARÝMI (z Robustu odvodenými) offsetmi, potom import db.ts
// spustí SKUTOČNÝ v13 blok → over že tie offsety Slide opony vráti na hodnoty z cfg_seed
// a rámový (Money-relevantný, zatiaľ neopravený) NEDOTKNE. KÓDY sa nemenia; Money odpis
// (počty tyčí + metre) sa nemení (viď compute.test „Money-neutrálne").
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import seed from '../src/lib/server/cfg_seed.json';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v13-test-'));
const dbPath = path.join(tmpRoot, 'v12.db');

// STARÉ offsety (pred opravou) pre OPRAVOVANÉ Slide opona riadky, kľúč `sysStyl|poradie`.
// Rámový (poradie 20) tu ZÁMERNE nie je — v tejto migrácii sa nemení (Money-relevantný).
const OLD_OFF: Record<string, number> = {
	'Slide|2x3K|25': -65, // oponový V → −67
	'Slide|2x3K|30': -65, // nosový V → −67
	'Slide|2x3K|90': 127.47, // sklo šírka → 142,5
	'Slide|2x3K|91': -65, // sklo výška → −67
	'Slide|2x2K|25': -65,
	'Slide|2x2K|30': -65,
	'Slide|2x2K|90': 21, // sklo šírka → 40,6
	'Slide|2x2K|91': -65
};

{
	const v12 = new Database(dbPath);
	v12.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL UNIQUE, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0);
	`);
	const insSys = v12.prepare('INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES (?, ?, ?)');
	const insRez = v12.prepare(
		`INSERT INTO cfg_rez (sys_styl, poradie, typ, kod, nazov, dim, koef, offset, delit_n, kerf, pocet_ks, sklozavisle, dlzka_tyce, sklo_hrubka)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);
	for (const s of seed.sys) insSys.run(s.sysStyl, s.N, s.skloOffset);
	for (const r of seed.rez) {
		// simuluj STARÝ stav: Slide opona mala z-Robustu-odvodené offsety
		const oldOff = OLD_OFF[`${r.sysStyl}|${r.poradie}`];
		insRez.run(
			r.sysStyl,
			r.poradie,
			r.typ,
			r.kod,
			r.nazov,
			r.dim,
			r.koef,
			oldOff ?? r.offset,
			r.delitN,
			r.kerf,
			r.pocetKs,
			r.sklozavisle,
			(r as { dlzkaTyce?: number }).dlzkaTyce ?? 7500,
			(r as { skloHrubka?: number }).skloHrubka ?? 0
		);
	}
	v12.exec(
		"INSERT INTO glass_types (nazov, redukcia_zero, poradie, system) VALUES ('X', 0, 1, 'ALL')"
	);
	v12.pragma('user_version = 12');
	v12.close();
}

process.env.DATABASE_PATH = dbPath;
const { db } = await import('../src/lib/server/db');

const off = (sysStyl: string, poradie: number) =>
	(
		db
			.prepare('SELECT offset FROM cfg_rez WHERE sys_styl = ? AND poradie = ?')
			.get(sysStyl, poradie) as { offset: number } | undefined
	)?.offset;

describe('reálny v12 → v13: Slide opona geometria podľa Excelu', () => {
	it('user_version = 13', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(20);
	});

	it('KAŽDÝ opravený Slide opona offset sedí s cfg_seed', () => {
		for (const key of Object.keys(OLD_OFF)) {
			const [sysStyl, por] = [
				key.slice(0, key.lastIndexOf('|')),
				Number(key.slice(key.lastIndexOf('|') + 1))
			];
			const seedRow = seed.rez.find((r) => r.sysStyl === sysStyl && r.poradie === por)!;
			expect(off(sysStyl, por), key).toBe(seedRow.offset);
		}
	});

	it('konkrétne opravené hodnoty (sklo + nosový/oponový)', () => {
		expect(off('Slide|2x3K', 90)).toBe(142.5); // sklo šírka
		expect(off('Slide|2x3K', 91)).toBe(-67); // sklo výška
		expect(off('Slide|2x3K', 30)).toBe(-67); // nosový V
		expect(off('Slide|2x3K', 25)).toBe(-67); // oponový V
		expect(off('Slide|2x2K', 90)).toBe(40.6); // sklo šírka
		expect(off('Slide|2x2K', 25)).toBe(-67);
	});

	it('rámový je Excelov „rozmer" (v15) + ostatné nemenené riadky', () => {
		// rámový: v14 ho dala na −12 (Excel stĺpec „dĺžka rezu"), v15 opravila na
		// stĺpec „rozmer" = (S+142,5)/6 resp. (S+40,6)/4, V−67 (viď migration-v15.test.ts)
		expect(off('Slide|2x3K', 20)).toBe(142.5);
		expect(off('Slide|2x2K', 20)).toBe(40.6);
		expect(off('Slide|2x3K', 21)).toBe(-67);
		// koľajnica offset 0 — nemenené žiadnou migráciou
		expect(off('Slide|2x3K', 10)).toBe(0);
		expect(off('Slide|2x2K', 11)).toBe(0);
	});
});
