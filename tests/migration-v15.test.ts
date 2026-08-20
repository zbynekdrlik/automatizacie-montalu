// Reálny prod upgrade path v14 → v15: Slide opona — oprava v14 (zlý stĺpec Excelu) +
// oponový kód. Excel od Dominika má na ten istý profil DVA stĺpce: `E` „rozmer" = čo sa
// reálne reže, `Q` „dĺžka rezu" = zastaraný leftover v odpisových stĺpcoch. v14 vzala `Q`,
// dielňa reže podľa `E` (pracovník 2026-07-27: 2x3K 5000×2000 → 857 a 1933, nie 831/1935).
// Zároveň oponový profil: ZASP00006 je podľa Money katalógu Model „Zasklenie Robust",
// Slide má vlastný ZASP20249 — pozostatok po odvodení Slide opony z Robustu.
//
// Postav DB v stave v14 (sklo už opravené v13, rámový na `Q` offsetoch, oponový ZASP00006),
// import db.ts spustí SKUTOČNÝ v15 blok → over rámový offsety + oponový kód, a že ostatné
// riadky (sklo, nosový, koľajnica, redukcia) zostali nedotknuté.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import seed from '../src/lib/server/cfg_seed.json';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v15-test-'));
const dbPath = path.join(tmpRoot, 'v14.db');

// Stav po v14, kľúč `sysStyl|poradie` → offset z Excelového stĺpca „dĺžka rezu".
const V14_RAM: Record<string, number> = {
	'Slide|2x3K|20': -12, // rámový S = (S−12)/6
	'Slide|2x2K|20': -12, // rámový S = (S−12)/4
	'Slide|2x3K|21': -65, // rámový V = V−65
	'Slide|2x2K|21': -65
};
// Oponový kód pred v15 (Robustový článok).
const V14_OPONA_KOD = 'ZASP00006';
const V14_OPONA_NAZOV = 'Oponový profil Surový 7500 mm';

{
	const v14 = new Database(dbPath);
	v14.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL UNIQUE, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0);
	`);
	const insSys = v14.prepare('INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES (?, ?, ?)');
	const insRez = v14.prepare(
		`INSERT INTO cfg_rez (sys_styl, poradie, typ, kod, nazov, dim, koef, offset, delit_n, kerf, pocet_ks, sklozavisle, dlzka_tyce, sklo_hrubka)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);
	for (const s of seed.sys) insSys.run(s.sysStyl, s.N, s.skloOffset);
	for (const r of seed.rez) {
		const jeSlideOpona = r.sysStyl === 'Slide|2x2K' || r.sysStyl === 'Slide|2x3K';
		const v14ram = V14_RAM[`${r.sysStyl}|${r.poradie}`];
		const jeOpona = jeSlideOpona && r.poradie === 25;
		insRez.run(
			r.sysStyl,
			r.poradie,
			r.typ,
			jeOpona ? V14_OPONA_KOD : r.kod,
			jeOpona ? V14_OPONA_NAZOV : r.nazov,
			r.dim,
			r.koef,
			v14ram ?? r.offset,
			r.delitN,
			r.kerf,
			r.pocetKs,
			r.sklozavisle,
			(r as { dlzkaTyce?: number }).dlzkaTyce ?? 7500,
			(r as { skloHrubka?: number }).skloHrubka ?? 0
		);
	}
	v14.exec(
		"INSERT INTO glass_types (nazov, redukcia_zero, poradie, system) VALUES ('X', 0, 1, 'ALL')"
	);
	v14.pragma('user_version = 14');
	v14.close();
}

process.env.DATABASE_PATH = dbPath;
const { db } = await import('../src/lib/server/db');

const row = (sysStyl: string, poradie: number) =>
	db
		.prepare('SELECT kod, nazov, offset FROM cfg_rez WHERE sys_styl = ? AND poradie = ?')
		.get(sysStyl, poradie) as { kod: string; nazov: string; offset: number } | undefined;
const off = (sysStyl: string, poradie: number) => row(sysStyl, poradie)?.offset;

describe('reálny v14 → v15: Slide opona rámový „rozmer" + oponový kód', () => {
	it('user_version = 17', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(24);
	});

	it('rámový opravený na Excelov stĺpec „rozmer" (obe štýly, obe dimenzie)', () => {
		expect(off('Slide|2x3K', 20)).toBe(142.5); // bolo −12 → (S+142,5)/6, pri 5000 → 857
		expect(off('Slide|2x2K', 20)).toBe(40.6); // bolo −12 → (S+40,6)/4
		expect(off('Slide|2x3K', 21)).toBe(-67); // bolo −65 → pri 2000 → 1933
		expect(off('Slide|2x2K', 21)).toBe(-67);
	});

	it('oponový profil je Slide článok ZASP20249, nie Robustový ZASP00006', () => {
		for (const ss of ['Slide|2x2K', 'Slide|2x3K']) {
			const r = row(ss, 25)!;
			expect(r.kod, ss).toBe('ZASP20249');
			expect(r.nazov, ss).toContain('Slide');
		}
	});

	it('KAŽDÝ Slide opona riadok sedí s cfg_seed (kód + názov + offset)', () => {
		for (const s of seed.rez) {
			if (s.sysStyl !== 'Slide|2x2K' && s.sysStyl !== 'Slide|2x3K') continue;
			const r = row(s.sysStyl, s.poradie)!;
			const key = `${s.sysStyl}|${s.poradie}`;
			expect(r.offset, key).toBe(s.offset);
			expect(r.kod, key).toBe(s.kod);
		}
	});

	it('NEDOTKNE sklo, nosový, koľajnicu ani redukciu', () => {
		expect(off('Slide|2x3K', 90)).toBe(142.5); // sklo šírka (v13)
		expect(off('Slide|2x3K', 91)).toBe(-67); // sklo výška (v13)
		expect(off('Slide|2x3K', 30)).toBe(-67); // nosový (v13)
		expect(off('Slide|2x3K', 10)).toBe(0); // koľajnica
		// redukcia 6mm: v15 sa jej NEDOTKLA — opravuje ju až v16 („prírez − 72,4“), a keďže
		// import db.ts prejde celý rad migrácií, tu už vidíme v16 výsledok
		expect(off('Slide|2x3K', 40)).toBe(-291.9);
		expect(off('Slide|2x2K', 40)).toBe(-249);
	});

	it('Robust opona si ponecháva ZASP00006 (je to Robustový článok)', () => {
		expect(row('Robust|2x3K', 25)?.kod ?? row('Robust|2x2K', 25)?.kod).toBe('ZASP00006');
	});
});
