// #610 (Odoo úloha 1416): migrácia v57 → v58 opraví šírku skla Štandard + opona IZO na pravidlo
// výroby „sklo = kladkový − 10 mm" (offset_sklo = offset_kladkový − 10·N): 2×2K −271 → −313,
// 2×3K −339 → −380, 2×4K −407 → −460. Riadok skla editor vzorcov NEUKAZUJE (výroba ho nevie
// opraviť sama), preto je to dátová migrácia. Kontrakt:
//  - zapíše LEN keď aktuálna hodnota = doterajšia (zo seedu / PROD 17.10.); iná (ručne zmenená)
//    hodnota sa NEPREPÍŠE, len zaloguje (warn),
//  - každý zápis má riadok `cfg_audit` (system-migracia, pole „Sklo šírka (S) offset — …"),
//  - idempotentná (druhý beh tela nič nezmení ani neauditne; guard >= 58),
//  - profily, výška skla, starý „Štandard" a ostatné riadky nedotknuté.
import { describe, it, expect, afterAll, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import seed from '../src/lib/server/cfg_seed.json';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v58-test-'));
const dbPath = path.join(tmpRoot, 'v57.db');

const SKLO_POLE = 'Sklo šírka (S) offset — Odoo úloha 1416 (#610)';

{
	const v57 = new Database(dbPath);
	v57.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL DEFAULT '', dim TEXT NOT NULL DEFAULT 'S', koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks INTEGER NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0, money_kod TEXT, sklo_korekcia INTEGER, hrubka_trieda INTEGER, UNIQUE(nazov, system));
		CREATE TABLE cfg_sklo_trieda (system TEXT NOT NULL, trieda INTEGER NOT NULL, korekcia INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (system, trieda));
		CREATE TABLE cfg_audit (id INTEGER PRIMARY KEY, ts TEXT NOT NULL DEFAULT (datetime('now')), username TEXT NOT NULL, sys_styl TEXT NOT NULL, zmeny TEXT NOT NULL);
		CREATE TABLE odpis_log (id INTEGER PRIMARY KEY, modul TEXT NOT NULL, zak TEXT NOT NULL, op TEXT NOT NULL, zakaznik TEXT NOT NULL, caka INTEGER NOT NULL DEFAULT 0, live INTEGER NOT NULL, target TEXT NOT NULL, filename TEXT NOT NULL, content_hash TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), zak_norm TEXT NOT NULL DEFAULT '', op_norm TEXT NOT NULL DEFAULT '', presunute_at TEXT, poradie INTEGER NOT NULL DEFAULT 1 CHECK (poradie >= 1), UNIQUE (modul, zak, op, live, poradie));
		CREATE TABLE user_audit (id INTEGER PRIMARY KEY, ts TEXT NOT NULL DEFAULT (datetime('now')), actor TEXT NOT NULL, action TEXT NOT NULL CHECK (action IN ('create','role_change','delete','seed')), target_username TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '');
		CREATE TABLE cfg_sietka_standard (kluc TEXT PRIMARY KEY CHECK (kluc IN ('k', 'r', 'h')), hodnota REAL NOT NULL);
		INSERT INTO cfg_sietka_standard (kluc, hodnota) VALUES ('k', 16.5), ('r', 17), ('h', 3);
		CREATE TABLE cfg_sklo_hrubka (id INTEGER PRIMARY KEY, system TEXT NOT NULL, mm REAL NOT NULL CHECK (mm > 0), druh TEXT NOT NULL CHECK (druh IN ('izolacne', 'jednoduche', 'esg')), UNIQUE (system, mm));
		INSERT INTO cfg_sklo_hrubka (system, mm, druh) VALUES ('Štandard +', 16, 'izolacne');
		INSERT INTO glass_types (nazov, system, hrubka_trieda) VALUES ('Izolačné sklo 4/8/4 číre', 'Štandard +', 16);

		INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES
			('Štandard +|2x2K IZO', 4, 0), ('Štandard +|2x3K IZO', 6, 0), ('Štandard +|2x4K IZO', 8, 0),
			('Štandard|2x3K IZO', 6, 0);
		-- PROD-tvar 17.10.: profily doladené výrobou (14.9.), sklo šírka −271/−339; 2×4K má
		-- RUČNE zmenenú hodnotu −404 (simulácia zásahu) → migrácia ju NESMIE prepísať
		INSERT INTO cfg_rez (sys_styl, poradie, typ, kod, nazov, dim, offset, delit_n, pocet_ks, dlzka_tyce) VALUES
			('Štandard +|2x2K IZO', 20, 'profil', 'ZASP202415', 'Kladkový profil Surový 3600mm', 'S', -273, 1, 8, 3600),
			('Štandard +|2x2K IZO', 45, 'profil', 'ZASP202439', 'Rozširujúci profil Surový 3600 mm', 'S', -290, 1, 8, 3600),
			('Štandard +|2x2K IZO', 90, 'sklo', '', 'Sklo šírka', 'S', -271, 1, 0, 7500),
			('Štandard +|2x2K IZO', 91, 'sklo', '', 'Sklo výška', 'V', -135, 0, 0, 7500),
			('Štandard +|2x3K IZO', 20, 'profil', 'ZASP202415', 'Kladkový profil Surový 3600mm', 'S', -320, 1, 12, 3600),
			('Štandard +|2x3K IZO', 45, 'profil', 'ZASP202439', 'Rozširujúci profil Surový 3600 mm', 'S', -342, 1, 12, 3600),
			('Štandard +|2x3K IZO', 90, 'sklo', '', 'Sklo šírka', 'S', -339, 1, 0, 7500),
			('Štandard +|2x3K IZO', 91, 'sklo', '', 'Sklo výška', 'V', -135, 0, 0, 7500),
			('Štandard +|2x4K IZO', 20, 'profil', 'ZASP202415', 'Kladkový profil Surový 3600mm', 'S', -380, 1, 16, 3600),
			('Štandard +|2x4K IZO', 45, 'profil', 'ZASP202439', 'Rozširujúci profil Surový 3600 mm', 'S', -410, 1, 16, 3600),
			('Štandard +|2x4K IZO', 90, 'sklo', '', 'Sklo šírka', 'S', -404, 1, 0, 7500),
			('Štandard +|2x4K IZO', 91, 'sklo', '', 'Sklo výška', 'V', -135, 0, 0, 7500),
			('Štandard|2x3K IZO', 90, 'sklo', '', 'Sklo šírka', 'S', -340, 1, 0, 7500);
		INSERT INTO cfg_audit (username, sys_styl, zmeny) VALUES
			('vyroba', 'Štandard +|2x3K IZO', '[{"pole":"Korekcia skla — trieda 16 mm","stara":null,"nova":7}]');
		PRAGMA user_version = 57;
	`);
	v57.close();
}

process.env.DATABASE_PATH = dbPath;
await import('../src/lib/server/db');
const { migrateOponaIzoSkloSirka, OPONA_IZO_SKLO_SIRKA_610 } =
	await import('../src/lib/server/migracie-opona-izo-sklo');

const skloS = (d: Database.Database, ss: string) =>
	(
		d
			.prepare(`SELECT offset FROM cfg_rez WHERE sys_styl = ? AND typ = 'sklo' AND dim = 'S'`)
			.get(ss) as { offset: number }
	).offset;
const migAudit = (d: Database.Database) =>
	d
		.prepare(`SELECT sys_styl, zmeny FROM cfg_audit WHERE username = 'system-migracia' ORDER BY id`)
		.all() as { sys_styl: string; zmeny: string }[];

afterAll(() => {
	delete process.env.LOG_LEVEL;
});

describe('migration → v58 (#610 Štandard + opona IZO sklo = kladkový − 10, Odoo úloha 1416)', () => {
	it('bumpne na v58', () => {
		const d = new Database(dbPath);
		expect(d.pragma('user_version', { simple: true })).toBe(58);
		d.close();
	});

	it('zmrazený literál = presne ROZHODNUTÉ #610 (stará → nová = kladkový PROD − 10·N)', () => {
		expect(OPONA_IZO_SKLO_SIRKA_610).toEqual([
			{ sysStyl: 'Štandard +|2x2K IZO', stara: -271, nova: -313 },
			{ sysStyl: 'Štandard +|2x3K IZO', stara: -339, nova: -380 },
			{ sysStyl: 'Štandard +|2x4K IZO', stara: -407, nova: -460 }
		]);
	});

	it('seed (čerstvá DB) nesie tie isté nové hodnoty ako migrácia', () => {
		for (const o of OPONA_IZO_SKLO_SIRKA_610) {
			const r = seed.rez.find((x) => x.sysStyl === o.sysStyl && x.typ === 'sklo' && x.dim === 'S');
			expect(r?.offset, o.sysStyl).toBe(o.nova);
		}
	});

	it('očakávaná hodnota prepísaná (2×2K −313, 2×3K −380), ručne zmenená 2×4K −404 NEDOTKNUTÁ', () => {
		const d = new Database(dbPath);
		expect(skloS(d, 'Štandard +|2x2K IZO')).toBe(-313);
		expect(skloS(d, 'Štandard +|2x3K IZO')).toBe(-380);
		expect(skloS(d, 'Štandard +|2x4K IZO')).toBe(-404);
		d.close();
	});

	it('profily, výška skla a starý „Štandard" nedotknuté', () => {
		const d = new Database(dbPath);
		const rows = d
			.prepare(
				`SELECT sys_styl, kod, dim, offset FROM cfg_rez WHERE NOT (typ = 'sklo' AND dim = 'S' AND sys_styl LIKE 'Štandard +|%') ORDER BY id`
			)
			.all();
		expect(rows).toEqual([
			{ sys_styl: 'Štandard +|2x2K IZO', kod: 'ZASP202415', dim: 'S', offset: -273 },
			{ sys_styl: 'Štandard +|2x2K IZO', kod: 'ZASP202439', dim: 'S', offset: -290 },
			{ sys_styl: 'Štandard +|2x2K IZO', kod: '', dim: 'V', offset: -135 },
			{ sys_styl: 'Štandard +|2x3K IZO', kod: 'ZASP202415', dim: 'S', offset: -320 },
			{ sys_styl: 'Štandard +|2x3K IZO', kod: 'ZASP202439', dim: 'S', offset: -342 },
			{ sys_styl: 'Štandard +|2x3K IZO', kod: '', dim: 'V', offset: -135 },
			{ sys_styl: 'Štandard +|2x4K IZO', kod: 'ZASP202415', dim: 'S', offset: -380 },
			{ sys_styl: 'Štandard +|2x4K IZO', kod: 'ZASP202439', dim: 'S', offset: -410 },
			{ sys_styl: 'Štandard +|2x4K IZO', kod: '', dim: 'V', offset: -135 },
			{ sys_styl: 'Štandard|2x3K IZO', kod: '', dim: 'S', offset: -340 }
		]);
		d.close();
	});

	it('každý zápis má cfg_audit riadok (system-migracia, stará → nová); ručne zmenený nie', () => {
		const d = new Database(dbPath);
		expect(migAudit(d)).toEqual([
			{
				sys_styl: 'Štandard +|2x2K IZO',
				zmeny: JSON.stringify([{ pole: SKLO_POLE, stara: -271, nova: -313 }])
			},
			{
				sys_styl: 'Štandard +|2x3K IZO',
				zmeny: JSON.stringify([{ pole: SKLO_POLE, stara: -339, nova: -380 }])
			}
		]);
		// pôvodný audit výroby ostal
		expect(
			(
				d.prepare(`SELECT COUNT(*) c FROM cfg_audit WHERE username = 'vyroba'`).get() as {
					c: number;
				}
			).c
		).toBe(1);
		d.close();
	});

	it('neočakávaná (ručne zmenená) hodnota sa ZALOGUJE (warn) a neprepíše', () => {
		const d = new Database(':memory:');
		d.exec(`
			CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL DEFAULT '', dim TEXT NOT NULL DEFAULT 'S', koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks INTEGER NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
			CREATE TABLE cfg_audit (id INTEGER PRIMARY KEY, ts TEXT NOT NULL DEFAULT (datetime('now')), username TEXT NOT NULL, sys_styl TEXT NOT NULL, zmeny TEXT NOT NULL);
			INSERT INTO cfg_rez (sys_styl, poradie, typ, nazov, dim, offset, delit_n) VALUES
				('Štandard +|2x3K IZO', 90, 'sklo', 'Sklo šírka', 'S', -350, 1);
			PRAGMA user_version = 57;
		`);
		process.env.LOG_LEVEL = 'warn';
		const out: string[] = [];
		const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
			out.push(String(chunk));
			return true;
		});
		try {
			migrateOponaIzoSkloSirka(d, (v) => d.pragma(`user_version = ${v}`));
		} finally {
			spy.mockRestore();
			delete process.env.LOG_LEVEL;
		}
		expect(skloS(d, 'Štandard +|2x3K IZO')).toBe(-350);
		expect(migAudit(d)).toEqual([]);
		expect(d.pragma('user_version', { simple: true })).toBe(58);
		const warn = out
			.flatMap((chunk) => chunk.split('\n'))
			.filter((l) => l.startsWith('{'))
			.map((l) => JSON.parse(l) as Record<string, unknown>)
			.find((l) => l.level === 'warn' && l.sysStyl === 'Štandard +|2x3K IZO');
		expect(warn, out.join('')).toMatchObject({ aktualna: -350, ocakavana: -339, nova: -380 });
		d.close();
	});

	it('idempotentná: druhý beh tela nič nezmení ani neauditne; guard >= 58 nebumpne', () => {
		const d = new Database(dbPath);
		// PROD-tvar: 2×4K s pôvodnou hodnotou −407 → prepíše sa; 2×2K/2×3K už nové → bez auditu
		d.prepare(
			`UPDATE cfg_rez SET offset = -407 WHERE sys_styl = 'Štandard +|2x4K IZO' AND typ = 'sklo' AND dim = 'S'`
		).run();
		d.pragma('user_version = 57');
		const bump = (v: number) => d.pragma(`user_version = ${v}`);
		migrateOponaIzoSkloSirka(d, bump);
		expect(skloS(d, 'Štandard +|2x4K IZO')).toBe(-460);
		expect(migAudit(d).map((a) => a.sys_styl)).toEqual([
			'Štandard +|2x2K IZO',
			'Štandard +|2x3K IZO',
			'Štandard +|2x4K IZO'
		]);
		// druhý beh tela (verzia vrátená) — hodnoty sú už nové → žiadny zápis, žiadny audit
		d.pragma('user_version = 57');
		migrateOponaIzoSkloSirka(d, bump);
		expect(migAudit(d)).toHaveLength(3);
		expect(['2x2K', '2x3K', '2x4K'].map((s) => skloS(d, `Štandard +|${s} IZO`))).toEqual([
			-313, -380, -460
		]);
		// guard: na v58 je migrácia no-op
		migrateOponaIzoSkloSirka(d, () => {
			throw new Error('nemal bumpnúť');
		});
		expect(d.pragma('user_version', { simple: true })).toBe(58);
		d.close();
	});

	it('čerstvá DB (v0 → hlava): sklo šírka nová zo seedu, migrácia nič neauditne', async () => {
		const { migrate } = await import('../src/lib/server/migracie');
		const fresh = new Database(':memory:');
		migrate(fresh, (p) => `x:${p}`);
		expect(fresh.pragma('user_version', { simple: true })).toBe(58);
		expect(['2x2K', '2x3K', '2x4K'].map((s) => skloS(fresh, `Štandard +|${s} IZO`))).toEqual([
			-313, -380, -460
		]);
		expect(migAudit(fresh)).toEqual([]);
		fresh.close();
	});
});
