// Fresh-install path (user_version 0 → 9) pre Štandard +. Na PRÁZDNEJ DB migrate()
// spustí celý reťazec: v<5 seed (Štandard + dostane default dĺžku tyče 7500) → v6
// updBar (opraví dlzka_tyce z cfg_seed → 3600 pre prírez/U) → v7 sklo_hrubka (0) →
// v9 je no-op (hasSys guard, lebo Štandard + je už zoseedovaný v<5). Over že fresh
// DB KONVERGUJE presne s cfg_seed.json — hlavne že viacstupňová migrácia dá správnu
// dlzka_tyce (3600, nie default 7500) a sklo_hrubka=0. Doplnok k migration-v9.test.ts,
// ktorý testuje len prod upgrade path v8→v9.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import seed from '../src/lib/server/cfg_seed.json';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-fresh-test-'));
// prázdna (neexistujúca) cesta → better-sqlite3 vytvorí novú DB, migrate() beží od 0
process.env.DATABASE_PATH = path.join(tmpRoot, 'fresh.db');
const { db } = await import('../src/lib/server/db');

const stdRez = seed.rez.filter((r) => r.sysStyl.startsWith('Štandard +'));

describe('fresh-install (user_version 0 → 9): Štandard + konverguje s cfg_seed', () => {
	it('user_version=9 po plnej migrácii od nuly', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(11);
	});

	it('všetkých 13 Štandard + štýlov je zoseedovaných (bez duplicít z v9)', () => {
		const rows = db
			.prepare("SELECT sys_styl FROM cfg_sys WHERE sys_styl LIKE 'Štandard +|%'")
			.all() as { sys_styl: string }[];
		expect(rows.length).toBe(13);
		// každý štýl práve raz (v9 hasSys guard nesmie zduplikovať v<5 seed)
		expect(new Set(rows.map((r) => r.sys_styl)).size).toBe(13);
	});

	it('KĽÚČOVÉ: dlzka_tyce KAŽDÉHO Štandard + riadku sedí s cfg_seed (v6 updBar prebehol)', () => {
		const dbRows = db
			.prepare(
				"SELECT sys_styl, poradie, kod, dlzka_tyce, sklo_hrubka FROM cfg_rez WHERE sys_styl LIKE 'Štandard +|%'"
			)
			.all() as { sys_styl: string; poradie: number; kod: string; dlzka_tyce: number; sklo_hrubka: number }[];
		expect(dbRows.length).toBe(stdRez.length);
		for (const r of stdRez) {
			const dbRow = dbRows.find((x) => x.sys_styl === r.sysStyl && x.poradie === r.poradie);
			expect(dbRow, `chýba riadok ${r.sysStyl} poradie ${r.poradie}`).toBeDefined();
			expect(dbRow!.dlzka_tyce).toBe((r as { dlzkaTyce?: number }).dlzkaTyce ?? 7500);
			expect(dbRow!.sklo_hrubka).toBe((r as { skloHrubka?: number }).skloHrubka ?? 0);
		}
	});

	it('prírez ZASP202415 aj U profil ZASP202439 majú 3600 (nie default 7500)', () => {
		const bars = db
			.prepare(
				"SELECT DISTINCT dlzka_tyce FROM cfg_rez WHERE sys_styl LIKE 'Štandard +|%' AND kod IN ('ZASP202415','ZASP202439')"
			)
			.all() as { dlzka_tyce: number }[];
		expect(bars).toEqual([{ dlzka_tyce: 3600 }]);
	});

	it('fresh DB má VŠETKY systémy (Robust/Slide/Deluxe/Štandard +) — plná konvergencia s cfg_seed', () => {
		const dbSys = (
			db.prepare('SELECT COUNT(*) c FROM cfg_sys').get() as { c: number }
		).c;
		expect(dbSys).toBe(seed.sys.length);
		const systems = new Set(
			(db.prepare('SELECT sys_styl FROM cfg_sys').all() as { sys_styl: string }[]).map(
				(r) => r.sys_styl.split('|')[0]
			)
		);
		expect(systems.has('Štandard +')).toBe(true);
		expect(systems.has('Deluxe')).toBe(true);
	});

	it('4 Štandard + glass_types (sklo_hrubka=0 — hrúbka neriadi profil)', () => {
		const rows = db
			.prepare("SELECT nazov, hrubka FROM glass_types WHERE system = 'Štandard +'")
			.all() as { nazov: string; hrubka: number }[];
		expect(rows.length).toBe(4);
		expect(rows.every((r) => r.hrubka === 0)).toBe(true);
	});
});
