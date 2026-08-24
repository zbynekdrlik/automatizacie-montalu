// #214 — sklo „3.3.1" (lepené, connex 33.1) pre Štandard plus a starý Štandard.
//
// Patrik (Odoo 207, #1703260, 18.8.): „štandard plus a starý štandard poprosím
// doplniť sklo 3.3.1 je to ako obyčajná 6mm nič sa nemení". „3.3.1" už existuje pre
// Slide (v17); `glass_types.nazov` bol GLOBÁLNE UNIQUE, takže Štandardu nešlo pridať
// sklo rovnakého názvu. Migrácia v22 uvoľní UNIQUE na (nazov, system) a doseeduje
// „3.3.1" pod `system='Štandard +'` (zdieľané so starým Štandardom cez GLASS_SYSTEM_ALIAS).
//
// Dva druhy dôkazu:
//   1) DB migračný test v21 → v22 — reálny prod upgrade path: „3.3.1" ponúknuté pre oba
//      Štandardy, Slide „3.3.1" nedotknuté, a nová UNIQUE(nazov, system) vynútená.
//   2) Money-neutralita (pure, vzor sklo-default): „3.3.1" sa v Štandardoch správa
//      BIT-IDENTICKY ako „Float sklo 6 mm" — nie je izolačné, takže ťahá ten istý basic
//      nárezák, a odpis je rovnaký.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { jeIzoSklo, sysStylPre, pridavnaKolajnicaDefault } from '../src/lib/styl';
import { buildCFG, computeFlat, type SysRow, type RezRow } from '../src/lib/server/compute';
import seed from '../src/lib/server/cfg_seed.json';

// ── DB migračný test (postav v21, import db.ts spustí SKUTOČNÝ v22 blok) ──
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v22-test-'));
const dbPath = path.join(tmpRoot, 'v21.db');

// katalóg skiel presne ako na ostrej DB pred v22 (13 riadkov)
const GLASS_V21: [string, number, number, string, number][] = [
	['Izolačné sklo 4/16/4 mliečne', 0, 10, 'Robust', 0],
	['Izolačné sklo 4/16/4 číre', 0, 20, 'Robust', 0],
	['Izolačné sklo 4/8/4 mliečne', 1, 10, 'Slide', 0],
	['Izolačné sklo 4/8/4 číre', 1, 20, 'Slide', 0],
	['6mm číre', 0, 30, 'Slide', 0],
	['6mm mliečne', 0, 40, 'Slide', 0],
	['3.3.1', 0, 50, 'Slide', 0],
	['Float sklo 4 mm', 0, 10, 'Štandard +', 0],
	['Float sklo 6 mm', 0, 20, 'Štandard +', 0],
	['Float sklo 10 mm', 0, 30, 'Štandard +', 0],
	['Izolačné sklo 4.8.4', 0, 40, 'Štandard +', 0],
	['Float kalené 6 mm', 0, 10, 'Deluxe', 6],
	['Float kalené 10 mm', 0, 20, 'Deluxe', 10]
];

{
	const v21 = new Database(dbPath);
	v21.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL UNIQUE, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE cfg_audit (id INTEGER PRIMARY KEY, ts TEXT NOT NULL DEFAULT (datetime('now')), username TEXT NOT NULL, sys_styl TEXT NOT NULL, zmeny TEXT NOT NULL);
		CREATE TABLE odpis_log (id INTEGER PRIMARY KEY, modul TEXT NOT NULL, zak TEXT NOT NULL, op TEXT NOT NULL, zakaznik TEXT NOT NULL, caka INTEGER NOT NULL DEFAULT 0, live INTEGER NOT NULL, target TEXT NOT NULL, filename TEXT NOT NULL, content_hash TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (modul, zak, op, live));
		CREATE TABLE problem_reports (id INTEGER PRIMARY KEY, ts TEXT NOT NULL DEFAULT (datetime('now')), username TEXT NOT NULL DEFAULT '', oblast TEXT NOT NULL DEFAULT '', popis TEXT NOT NULL);
		CREATE TABLE user_audit (id INTEGER PRIMARY KEY, ts TEXT NOT NULL DEFAULT (datetime('now')), actor TEXT NOT NULL, action TEXT NOT NULL CHECK (action IN ('create','role_change')), target_username TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '');
		CREATE TABLE material_prices (kod TEXT PRIMARY KEY, nakup_cennik REAL, nakup_posledna_faktura REAL, predaj_vo REAL, mena TEXT NOT NULL DEFAULT 'EUR', sklad REAL, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
		CREATE TABLE material_prices_meta (id INTEGER PRIMARY KEY CHECK (id = 1), snapshot_generated_at TEXT, snapshot_file_mtime_ms REAL, imported_at TEXT, row_count INTEGER NOT NULL DEFAULT 0, rejected_count INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE odpis_polozky (id INTEGER PRIMARY KEY, odpis_log_id INTEGER NOT NULL REFERENCES odpis_log(id) ON DELETE CASCADE, kod TEXT NOT NULL, nazov TEXT NOT NULL, qty REAL NOT NULL, mj TEXT NOT NULL DEFAULT 'm');
	`);
	// jeden cfg_sys riadok — nech seedData po migrácii nezačne dopĺňať celý cfg_seed
	v21
		.prepare('INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES (?, ?, ?)')
		.run('Štandard +|2K', 2, 0);
	v21.prepare('INSERT INTO users (username, pass_hash) VALUES (?, ?)').run('palo', 'x:y');
	const insG = v21.prepare(
		'INSERT INTO glass_types (nazov, redukcia_zero, poradie, system, hrubka) VALUES (?, ?, ?, ?, ?)'
	);
	for (const g of GLASS_V21) insG.run(...g);
	v21.pragma('user_version = 21');
	v21.close();
}

process.env.DATABASE_PATH = dbPath;
const { db, glassTypesForSystem, listGlassTypes } = await import('../src/lib/server/db');
const nazvy = (sys: string) => glassTypesForSystem(sys).map((g) => g.nazov);

describe('migrácia v21 → v22: sklo „3.3.1" pre Štandard plus a starý Štandard (#214)', () => {
	it('user_version = 22 po migrácii', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(29);
	});

	it('„3.3.1" je ponúknuté pre Štandard plus (system=„Štandard +")', () => {
		expect(nazvy('Štandard +')).toContain('3.3.1');
		const g = glassTypesForSystem('Štandard +').find((x) => x.nazov === '3.3.1')!;
		// správa sa ako „Float sklo 6 mm": žiadna redukcia, žiadna hrúbko-závislosť
		expect(g).toMatchObject({ redukciaZero: false, hrubka: 0, system: 'Štandard +' });
	});

	it('„3.3.1" je ponúknuté aj pre starý Štandard (zdieľa katalóg cez alias)', () => {
		expect(nazvy('Štandard')).toContain('3.3.1');
	});

	it('„3.3.1" je hneď za „Float sklo 6 mm" v poradí (poradie 25)', () => {
		const zoznam = nazvy('Štandard +');
		expect(zoznam.indexOf('3.3.1')).toBe(zoznam.indexOf('Float sklo 6 mm') + 1);
	});

	it('Slide „3.3.1" ostáva nedotknuté a je to SAMOSTATNÝ riadok (system=„Slide")', () => {
		expect(nazvy('Slide')).toContain('3.3.1');
		const rows = listGlassTypes().filter((g) => g.nazov === '3.3.1');
		expect(rows.map((r) => r.system).sort()).toEqual(['Slide', 'Štandard +']);
	});

	it('presne jeden nový riadok skla (13 → 14)', () => {
		expect(listGlassTypes().length).toBe(14);
	});

	it('nová UNIQUE(nazov, system): to isté sklo v dvoch systémoch je OK, ten istý pár nie', () => {
		const ins = db.prepare(
			'INSERT INTO glass_types (nazov, redukcia_zero, poradie, system, hrubka) VALUES (?, ?, ?, ?, ?)'
		);
		// ten istý (nazov, system) pár musí padnúť
		expect(() => ins.run('3.3.1', 0, 99, 'Štandard +', 0)).toThrow();
		// rovnaký NÁZOV v dvoch RÔZNYCH systémoch musí prejsť (to bolo predtým blokované)
		expect(() => ins.run('__T_GLASS__', 0, 99, 'Slide', 0)).not.toThrow();
		expect(() => ins.run('__T_GLASS__', 0, 99, 'Robust', 0)).not.toThrow();
		db.prepare('DELETE FROM glass_types WHERE nazov = ?').run('__T_GLASS__');
	});
});

// ── Money-neutralita (pure, vzor sklo-default) ──
describe('Money-neutralita: „3.3.1" == „Float sklo 6 mm" v Štandardoch (#214)', () => {
	const cfg = buildCFG(seed.sys as SysRow[], seed.rez as RezRow[]);
	const existuje = (s: string) => !!cfg[s];
	// vlastnosti skla NEHARDKÓDUJEME — čítame ich z MIGROVANEJ DB (glassTypesForSystem),
	// takže odpisový test je load-bearing: zle naseedovaný „3.3.1" (redukciaZero/hrubka !=
	// „Float sklo 6 mm") ho zhodí priamo, nie je to tautológia.
	const std = glassTypesForSystem('Štandard +');
	const g331Row = std.find((g) => g.nazov === '3.3.1')!;
	const g6Row = std.find((g) => g.nazov === 'Float sklo 6 mm')!;
	const G331 = { nazov: '3.3.1', redukciaZero: g331Row.redukciaZero, hrubka: g331Row.hrubka };
	const G6 = { nazov: 'Float sklo 6 mm', redukciaZero: g6Row.redukciaZero, hrubka: g6Row.hrubka };
	const rozmery: [number, number][] = [
		[3000, 2000],
		[5000, 2200],
		[4645, 2320]
	];

	// štýly oboch Štandard systémov z cfg_seed
	const stdSysStyly = Object.keys(cfg).filter(
		(k) => k.startsWith('Štandard +|') || k.startsWith('Štandard|')
	);

	it('„3.3.1" nie je izolačné — rovnako ako „Float sklo 6 mm"; oba Štandardy majú štýly', () => {
		expect(jeIzoSklo(G331.nazov)).toBe(false);
		expect(jeIzoSklo(G331.nazov)).toBe(jeIzoSklo(G6.nazov));
		expect(stdSysStyly.length).toBeGreaterThan(0);
	});

	for (const sysStyl of stdSysStyly) {
		const [system, styl] = sysStyl.split('|');

		it(`${sysStyl}: „3.3.1" ťahá ten istý nárezák ako „Float sklo 6 mm"`, () => {
			expect(sysStylPre(system!, styl!, G331.nazov, existuje)).toBe(
				sysStylPre(system!, styl!, G6.nazov, existuje)
			);
		});

		it(`${sysStyl}: prídavná koľajnica sa nemení voľbou „3.3.1" vs „6 mm"`, () => {
			expect(pridavnaKolajnicaDefault(system!, styl!, G331.nazov)).toBe(
				pridavnaKolajnicaDefault(system!, styl!, G6.nazov)
			);
		});

		it(`${sysStyl}: odpis pri „3.3.1" == odpis pri „Float sklo 6 mm"`, () => {
			// CELÁ cesta zvlášť pre každé sklo (nárezák z názvu + vlastnosti z migrovanej DB)
			// — keby „3.3.1" ťahalo iný nárezák alebo malo iné redukciaZero/hrubka, odpis by
			// sa líšil a test padne. Nie je to tautológia (identické literály).
			const rA = sysStylPre(system!, styl!, G331.nazov, existuje);
			const rB = sysStylPre(system!, styl!, G6.nazov, existuje);
			for (const [S, V] of rozmery) {
				const a = computeFlat(cfg, rA, S, V, G331.redukciaZero, G331.hrubka);
				const b = computeFlat(cfg, rB, S, V, G6.redukciaZero, G6.hrubka);
				expect(a === null).toBe(b === null);
				if (!a || !b) continue;
				expect(a.odpis, `${sysStyl} ${S}×${V}`).toEqual(b.odpis);
			}
		});
	}
});
