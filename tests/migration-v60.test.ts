// Odoo úloha 1459 (#618): migrácia v59 → v60 — starý „Štandard" IZO má vo vzorci ZÁKLADNÚ spodnú
// koľajnicu (rovnaký riadok ako basic štýl), prídavnú pridá checkbox „Prídavná koľajnica"
// (`railUpsize`, pri IZO predvolene zaškrtnutý) → pri zaškrtnutí rovnaký kód ako doteraz.
// Kontrakt (vzor v58):
//  - zapíše LEN keď je aktuálny kód ten natvrdo zväčšený; iný (ručne zmenený) sa NEPREPÍŠE, len
//    zaloguje (warn); 0 alebo viac spodných koľajníc v štýle → warn, nič,
//  - každý zápis má riadok `cfg_audit` (system-migracia, kód + názov stará → nová),
//  - idempotentná (druhý beh nič nezmení ani neauditne; guard >= 60),
//  - horná koľajnica, ostatné riadky, Štandard + a basic štýly nedotknuté.
import { describe, it, expect, afterAll, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import seed from '../src/lib/server/cfg_seed.json';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v60-test-'));
const dbPath = path.join(tmpRoot, 'v59.db');

const POLE_KOD = 'Koľajnica spodná · kód (prídavná koľajnica len cez voľbu „Prídavná koľajnica")';
const POLE_NAZOV = 'Koľajnica spodná · názov';
const N2K = 'Koľajnica spodná 2K  Surový 7500 mm';
const N3K = 'Koľajnica spodná 3K Surový 7500 mm';
const N4K = 'Koľajnica spodná 4K Surový 7500 mm';
const N5K = 'Koľajnica spodná 5K Surový 7500 mm';

{
	const v59 = new Database(dbPath);
	v59.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL DEFAULT '', dim TEXT NOT NULL DEFAULT 'S', koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks INTEGER NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0, money_kod TEXT, sklo_korekcia INTEGER, hrubka_trieda INTEGER, UNIQUE(nazov, system));
		CREATE TABLE cfg_sklo_trieda (system TEXT NOT NULL, trieda INTEGER NOT NULL, korekcia INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (system, trieda));
		CREATE TABLE cfg_audit (id INTEGER PRIMARY KEY, ts TEXT NOT NULL DEFAULT (datetime('now')), username TEXT NOT NULL, sys_styl TEXT NOT NULL, zmeny TEXT NOT NULL);
		CREATE TABLE odpis_log (id INTEGER PRIMARY KEY, modul TEXT NOT NULL, zak TEXT NOT NULL, op TEXT NOT NULL, zakaznik TEXT NOT NULL, caka INTEGER NOT NULL DEFAULT 0, live INTEGER NOT NULL, target TEXT NOT NULL, filename TEXT NOT NULL, content_hash TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), zak_norm TEXT NOT NULL DEFAULT '', op_norm TEXT NOT NULL DEFAULT '', presunute_at TEXT, poradie INTEGER NOT NULL DEFAULT 1 CHECK (poradie >= 1), UNIQUE (modul, zak, op, live, poradie));
		CREATE TABLE user_audit (id INTEGER PRIMARY KEY, ts TEXT NOT NULL DEFAULT (datetime('now')), actor TEXT NOT NULL, action TEXT NOT NULL CHECK (action IN ('create','role_change','delete','seed','password_reset')), target_username TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '');
		CREATE TABLE cfg_sietka_standard (kluc TEXT PRIMARY KEY CHECK (kluc IN ('k', 'r', 'h')), hodnota REAL NOT NULL);
		INSERT INTO cfg_sietka_standard (kluc, hodnota) VALUES ('k', 16.5), ('r', 17), ('h', 3);
		CREATE TABLE cfg_sklo_hrubka (id INTEGER PRIMARY KEY, system TEXT NOT NULL, mm REAL NOT NULL CHECK (mm > 0), druh TEXT NOT NULL CHECK (druh IN ('izolacne', 'jednoduche', 'esg')), UNIQUE (system, mm));
		INSERT INTO cfg_sklo_hrubka (system, mm, druh) VALUES ('Štandard', 16, 'izolacne');
		INSERT INTO glass_types (nazov, system, hrubka_trieda) VALUES ('Izolačné sklo 4/8/4 číre', 'Štandard +', 16);

		INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES
			('Štandard|2K', 2, 0), ('Štandard|2K IZO', 2, 0), ('Štandard|3K IZO', 3, 0),
			('Štandard|4K IZO', 4, 0), ('Štandard|2x2K IZO', 4, 0), ('Štandard|2x3K IZO', 6, 0),
			('Štandard +|3K IZO', 3, 0);
		-- PROD-tvar 23.10.: spodná natvrdo zväčšená; 4K IZO RUČNE zmenená (simulácia zásahu výroby)
		-- → migrácia ju NESMIE prepísať; 2x3K IZO už má základnú (napr. obnovená novšia záloha)
		INSERT INTO cfg_rez (sys_styl, poradie, typ, kod, nazov, dim, offset, pocet_ks, dlzka_tyce) VALUES
			('Štandard|2K', 15, 'profil', 'ZASP00104', '${N2K}', 'S', 0, 1, 7500),
			('Štandard|2K IZO', 10, 'profil', 'ZASP00107', 'Koľajnica horná 2K Surový 7500 mm', 'S', 0, 1, 7500),
			('Štandard|2K IZO', 15, 'profil', 'ZASP00030', '${N3K}', 'S', 0, 1, 7500),
			('Štandard|2K IZO', 20, 'profil', 'ZASP202415', 'Kladkový profil Surový 3600mm', 'S', -116, 4, 3600),
			('Štandard|3K IZO', 10, 'profil', 'ZASP00027', 'Koľajnica horná 3K Surový 7500 mm', 'S', 0, 1, 7500),
			('Štandard|3K IZO', 15, 'profil', 'ZASP00033', '${N4K}', 'S', 0, 1, 7500),
			('Štandard|4K IZO', 15, 'profil', 'ZASP202437', 'Koľajnica spodná 6K Surový 7500 mm', 'S', 0, 1, 7500),
			('Štandard|2x2K IZO', 15, 'profil', 'ZASP00030', '${N3K}', 'S', 0, 1, 7500),
			('Štandard|2x3K IZO', 15, 'profil', 'ZASP00030', '${N3K}', 'S', 0, 1, 7500),
			('Štandard +|3K IZO', 15, 'profil', 'ZASP00030', '${N3K}', 'S', 0, 1, 7500);
		INSERT INTO cfg_audit (username, sys_styl, zmeny) VALUES
			('vyroba', 'Štandard|3K IZO', '[{"pole":"Kladkový profil Surový 3600mm · šírka","stara":-143,"nova":-145}]');
		PRAGMA user_version = 59;
	`);
	v59.close();
}

process.env.DATABASE_PATH = dbPath;
await import('../src/lib/server/db');
const { migrateStandardIzoSpodnaKolajnica, STANDARD_IZO_SPODNA_KOLAJNICA } =
	await import('../src/lib/server/migracie-standard-izo-kolajnica');
const { migrate } = await import('../src/lib/server/migracie');

const spodna = (d: Database.Database, ss: string) =>
	d
		.prepare(
			`SELECT kod, nazov, offset, dlzka_tyce FROM cfg_rez WHERE sys_styl = ? AND nazov LIKE 'Koľajnica spodná%' ORDER BY id`
		)
		.all(ss) as { kod: string; nazov: string; offset: number; dlzka_tyce: number }[];
const migAudit = (d: Database.Database) =>
	d
		.prepare(`SELECT sys_styl, zmeny FROM cfg_audit WHERE username = 'system-migracia' ORDER BY id`)
		.all() as { sys_styl: string; zmeny: string }[];
const auditZmeny = (staryKod: string, staryNazov: string, novyKod: string, novyNazov: string) =>
	JSON.stringify([
		{ pole: POLE_KOD, stara: staryKod, nova: novyKod },
		{ pole: POLE_NAZOV, stara: staryNazov, nova: novyNazov }
	]);

const CFG_TABULKY = `
	CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL DEFAULT '', dim TEXT NOT NULL DEFAULT 'S', koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks INTEGER NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
	CREATE TABLE cfg_audit (id INTEGER PRIMARY KEY, ts TEXT NOT NULL DEFAULT (datetime('now')), username TEXT NOT NULL, sys_styl TEXT NOT NULL, zmeny TEXT NOT NULL);
`;

/** Spustí `fn` s `LOG_LEVEL=warn` a vráti zachytené warn záznamy loggera (JSON riadky stdout). */
function warnLogy(fn: () => void): Record<string, unknown>[] {
	process.env.LOG_LEVEL = 'warn';
	const out: string[] = [];
	const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
		out.push(String(chunk));
		return true;
	});
	try {
		fn();
	} finally {
		spy.mockRestore();
		delete process.env.LOG_LEVEL;
	}
	return out
		.flatMap((chunk) => chunk.split('\n'))
		.filter((l) => l.startsWith('{'))
		.map((l) => JSON.parse(l) as Record<string, unknown>)
		.filter((l) => l.level === 'warn');
}

afterAll(() => {
	delete process.env.LOG_LEVEL;
});

describe('migration → v60 (úloha 1459: starý Štandard IZO — základná spodná koľajnica)', () => {
	it('bumpne na v60', () => {
		const d = new Database(dbPath);
		expect(d.pragma('user_version', { simple: true })).toBe(60);
		d.close();
	});

	it('zmrazený literál: natvrdo zväčšená → základná (= riadok basic štýlu)', () => {
		expect(STANDARD_IZO_SPODNA_KOLAJNICA).toEqual([
			{ sysStyl: 'Štandard|2K IZO', staryKod: 'ZASP00030', novyKod: 'ZASP00104', novyNazov: N2K },
			{ sysStyl: 'Štandard|3K IZO', staryKod: 'ZASP00033', novyKod: 'ZASP00030', novyNazov: N3K },
			{ sysStyl: 'Štandard|4K IZO', staryKod: 'ZASP202432', novyKod: 'ZASP00033', novyNazov: N4K },
			{
				sysStyl: 'Štandard|2x2K IZO',
				staryKod: 'ZASP00030',
				novyKod: 'ZASP00104',
				novyNazov: N2K
			},
			{
				sysStyl: 'Štandard|2x3K IZO',
				staryKod: 'ZASP00033',
				novyKod: 'ZASP00030',
				novyNazov: N3K
			},
			{
				sysStyl: 'Štandard|2x4K IZO',
				staryKod: 'ZASP202432',
				novyKod: 'ZASP00033',
				novyNazov: N4K
			}
		]);
	});

	it('seed (čerstvá DB) nesie tie isté nové kódy a názvy ako migrácia', () => {
		for (const o of STANDARD_IZO_SPODNA_KOLAJNICA) {
			const r = seed.rez.filter(
				(x) => x.sysStyl === o.sysStyl && /^Koľajnica\s+spodná/.test(x.nazov)
			);
			expect(r, o.sysStyl).toHaveLength(1);
			expect({ kod: r[0]!.kod, nazov: r[0]!.nazov }, o.sysStyl).toEqual({
				kod: o.novyKod,
				nazov: o.novyNazov
			});
		}
	});

	it('zväčšená spodná prepísaná na základnú (kód + názov), vzorec a tyč nezmenené', () => {
		const d = new Database(dbPath);
		expect(spodna(d, 'Štandard|2K IZO')).toEqual([
			{ kod: 'ZASP00104', nazov: N2K, offset: 0, dlzka_tyce: 7500 }
		]);
		expect(spodna(d, 'Štandard|3K IZO')).toEqual([
			{ kod: 'ZASP00030', nazov: N3K, offset: 0, dlzka_tyce: 7500 }
		]);
		expect(spodna(d, 'Štandard|2x2K IZO')).toEqual([
			{ kod: 'ZASP00104', nazov: N2K, offset: 0, dlzka_tyce: 7500 }
		]);
		d.close();
	});

	it('ručne zmenený kód (4K IZO), už základný (2x3K IZO), Štandard + a horná NEDOTKNUTÉ', () => {
		const d = new Database(dbPath);
		expect(spodna(d, 'Štandard|4K IZO').map((r) => r.kod)).toEqual(['ZASP202437']);
		expect(spodna(d, 'Štandard|2x3K IZO').map((r) => r.kod)).toEqual(['ZASP00030']);
		expect(spodna(d, 'Štandard +|3K IZO').map((r) => r.kod)).toEqual(['ZASP00030']);
		expect(spodna(d, 'Štandard|2K')).toEqual([
			{ kod: 'ZASP00104', nazov: N2K, offset: 0, dlzka_tyce: 7500 }
		]);
		const ine = d
			.prepare(
				`SELECT sys_styl, kod FROM cfg_rez WHERE nazov NOT LIKE 'Koľajnica spodná%' ORDER BY id`
			)
			.all();
		expect(ine).toEqual([
			{ sys_styl: 'Štandard|2K IZO', kod: 'ZASP00107' },
			{ sys_styl: 'Štandard|2K IZO', kod: 'ZASP202415' },
			{ sys_styl: 'Štandard|3K IZO', kod: 'ZASP00027' }
		]);
		d.close();
	});

	it('každý zápis má cfg_audit riadok (kód + názov); nezapísané nie, audit výroby ostal', () => {
		const d = new Database(dbPath);
		expect(migAudit(d)).toEqual([
			{ sys_styl: 'Štandard|2K IZO', zmeny: auditZmeny('ZASP00030', N3K, 'ZASP00104', N2K) },
			{ sys_styl: 'Štandard|3K IZO', zmeny: auditZmeny('ZASP00033', N4K, 'ZASP00030', N3K) },
			{ sys_styl: 'Štandard|2x2K IZO', zmeny: auditZmeny('ZASP00030', N3K, 'ZASP00104', N2K) }
		]);
		expect(
			(
				d.prepare(`SELECT COUNT(*) c FROM cfg_audit WHERE username = 'vyroba'`).get() as {
					c: number;
				}
			).c
		).toBe(1);
		d.close();
	});

	it('neočakávaný kód sa ZALOGUJE (warn) a neprepíše', () => {
		const d = new Database(':memory:');
		d.exec(`
			${CFG_TABULKY}
			INSERT INTO cfg_rez (sys_styl, poradie, typ, kod, nazov, dim) VALUES
				('Štandard|3K IZO', 15, 'profil', 'ZASP202437', 'Koľajnica spodná 6K Surový 7500 mm', 'S');
			PRAGMA user_version = 59;
		`);
		const warny = warnLogy(() =>
			migrateStandardIzoSpodnaKolajnica(d, (v) => d.pragma(`user_version = ${v}`))
		);
		expect(spodna(d, 'Štandard|3K IZO').map((r) => r.kod)).toEqual(['ZASP202437']);
		expect(migAudit(d)).toEqual([]);
		expect(d.pragma('user_version', { simple: true })).toBe(60);
		expect(warny.find((l) => l.sysStyl === 'Štandard|3K IZO')).toMatchObject({
			aktualny: 'ZASP202437',
			ocakavany: 'ZASP00033',
			novy: 'ZASP00030'
		});
		d.close();
	});

	it('chýbajúca alebo nejednoznačná spodná koľajnica → warn, nič; ostatné sa opravia', () => {
		const d = new Database(':memory:');
		d.exec(`
			${CFG_TABULKY}
			INSERT INTO cfg_rez (sys_styl, poradie, typ, kod, nazov, dim) VALUES
				('Štandard|2K IZO', 15, 'profil', 'ZASP00030', '${N3K}', 'S'),
				('Štandard|2K IZO', 16, 'profil', 'ZASP00030', '${N3K}', 'S'),
				('Štandard|4K IZO', 15, 'profil', 'ZASP202432', '${N5K}', 'S'),
				('Štandard|3K IZO', 90, 'sklo', '', 'Sklo šírka', 'S');
			PRAGMA user_version = 59;
		`);
		const warny = warnLogy(() =>
			migrateStandardIzoSpodnaKolajnica(d, (v) => d.pragma(`user_version = ${v}`))
		);
		expect(spodna(d, 'Štandard|2K IZO').map((r) => r.kod)).toEqual(['ZASP00030', 'ZASP00030']);
		expect(warny.find((l) => l.sysStyl === 'Štandard|2K IZO')).toMatchObject({ pocet: 2 });
		expect(warny.find((l) => l.sysStyl === 'Štandard|3K IZO')).toMatchObject({ pocet: 0 });
		expect(spodna(d, 'Štandard|4K IZO')).toEqual([
			{ kod: 'ZASP00033', nazov: N4K, offset: 0, dlzka_tyce: 7500 }
		]);
		expect(migAudit(d).map((a) => a.sys_styl)).toEqual(['Štandard|4K IZO']);
		expect(d.pragma('user_version', { simple: true })).toBe(60);
		d.close();
	});

	it('idempotentná: druhý beh nič nezmení ani neauditne; guard >= 60 nebumpne', () => {
		const d = new Database(dbPath);
		d.pragma('user_version = 59');
		const bump = (v: number) => d.pragma(`user_version = ${v}`);
		migrateStandardIzoSpodnaKolajnica(d, bump);
		expect(migAudit(d)).toHaveLength(3);
		expect(spodna(d, 'Štandard|3K IZO').map((r) => r.kod)).toEqual(['ZASP00030']);
		migrateStandardIzoSpodnaKolajnica(d, () => {
			throw new Error('nemal bumpnúť');
		});
		expect(d.pragma('user_version', { simple: true })).toBe(60);
		d.close();
	});

	it('čerstvá DB (v0 → hlava): spodná IZO = základná zo seedu, migrácia nič neauditne', () => {
		const fresh = new Database(':memory:');
		migrate(fresh, (p) => `x:${p}`);
		expect(fresh.pragma('user_version', { simple: true })).toBe(60);
		for (const o of STANDARD_IZO_SPODNA_KOLAJNICA)
			expect(
				spodna(fresh, o.sysStyl).map((r) => r.kod),
				o.sysStyl
			).toEqual([o.novyKod]);
		expect(migAudit(fresh)).toEqual([]);
		fresh.close();
	});
});
