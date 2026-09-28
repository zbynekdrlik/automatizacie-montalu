// Migrácia v52 (#579 časť 2) — vo VLASTNOM súbore (vzor v50/v51): `migracie-seed.ts` aj
// `migracie.ts` sú na 1000-riadkovom strope (large-file-split / migrations.md). Parameter injection
// `(db, bump)`, guard `>= N return`, celé v transakcii, žiadny cyklický import. LEN DDL + seed
// (súbory `migracie-*.ts` sú mimo mutačného scope — logika žije v `sklo-hrubky.ts`).
import type Database from 'better-sqlite3';
import { logger } from './log';
import { ODOO_DRUHY, ODOO_HRUBKY_SEED } from '../sklo-povolene';

const log = logger('migrate');

/**
 * v51 → v52: povolené hrúbky Odoo skiel per systém (#579 časť 2, Odoo úloha 1180: „Povolené hrúbky
 * pri systéme si nastaví výroba") — `cfg_sklo_hrubka(id, system, mm, druh)`, `UNIQUE(system, mm)`
 * (pri jednej hrúbke jeden druh; „len kalené" je podmnožina jednoduchých), CHECK na druh a mm > 0.
 * Seed = `ODOO_HRUBKY_SEED` (dnešné správanie, jeden zdroj s kódom), poradie = id. Aditívne
 * (CREATE TABLE IF NOT EXISTS + INSERT OR IGNORE → neprepíše riadky upravené editorom).
 * Money-NEUTRÁLNE: mení sa len ponuka Odoo skiel v nárezáku, výpočtové sklo sa odvodzuje.
 */
export function migrateSkloHrubky(db: Database.Database, bump: (v: number) => void): void {
	if ((db.pragma('user_version', { simple: true }) as number) >= 52) return;
	const druhy = ODOO_DRUHY.map((d) => `'${d}'`).join(', ');
	db.transaction(() => {
		db.exec(`
			CREATE TABLE IF NOT EXISTS cfg_sklo_hrubka (
				id INTEGER PRIMARY KEY,
				system TEXT NOT NULL,
				mm REAL NOT NULL CHECK (mm > 0),
				druh TEXT NOT NULL CHECK (druh IN (${druhy})),
				UNIQUE (system, mm)
			);
		`);
		const ins = db.prepare(
			'INSERT OR IGNORE INTO cfg_sklo_hrubka (system, mm, druh) VALUES (?, ?, ?)'
		);
		let n = 0;
		for (const [system, rows] of Object.entries(ODOO_HRUBKY_SEED))
			for (const r of rows) n += ins.run(system, r.mm, r.druh).changes;
		log.info('migrateSkloHrubky: cfg_sklo_hrubka naseedovaná (#579)', { riadkov: n });
		bump(52);
	})();
}
