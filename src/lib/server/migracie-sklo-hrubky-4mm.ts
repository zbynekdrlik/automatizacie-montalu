// Migrácia v54 (#579, Patrik — Odoo úloha 1193, msg 1865357, 28.9.: „pri štandardoch tam môže byť
// aj 4mm sklo") — vo VLASTNOM súbore (vzor v50–v53): `migracie-seed.ts` aj `migracie.ts` sú na
// 1000-riadkovom strope. Parameter injection `(db, bump)`, guard `>= N return`, celé v transakcii.
// LEN DDL/seed (súbory `migracie-*.ts` sú mimo mutačného scope — logika žije v `sklo-hrubky.ts`).
import type Database from 'better-sqlite3';
import { logger } from './log';

const log = logger('migrate');

/** Doplnené riadky — ZMRAZENÝ literál (migrácia sa po nasadení nemení; čerstvá DB ich dostane už
 *  zo seedu v52 `ODOO_HRUBKY_SEED`, parita stráži `migration-v54.test.ts` + `sklo-hrubky-579`). */
const DOPLNIT: readonly { system: string; mm: number; druh: 'jednoduche' }[] = [
	{ system: 'Štandard +', mm: 4, druh: 'jednoduche' },
	{ system: 'Štandard', mm: 4, druh: 'jednoduche' }
];

/**
 * v53 → v54: povolená hrúbka 4 mm jednoduché pre Štandard + a starý Štandard v `cfg_sklo_hrubka`
 * (Drevostavby bez zmeny). `INSERT OR IGNORE` na `UNIQUE(system, mm)` → riadok (systém, 4 mm), ktorý
 * už existuje (napr. výroba ho nastavila v `/zasklenia/nastavenia` ako „len kalené"), sa NEprepíše
 * ani nezdvojí. Money-NEUTRÁLNE: 4 mm sa počíta ako katalógové „Float sklo 4 mm" (vlastné Money kódy).
 */
export function migrateSkloHrubky4mm(db: Database.Database, bump: (v: number) => void): void {
	if ((db.pragma('user_version', { simple: true }) as number) >= 54) return;
	db.transaction(() => {
		const ins = db.prepare(
			'INSERT OR IGNORE INTO cfg_sklo_hrubka (system, mm, druh) VALUES (?, ?, ?)'
		);
		let n = 0;
		for (const r of DOPLNIT) n += ins.run(r.system, r.mm, r.druh).changes;
		log.info('migrateSkloHrubky4mm: 4 mm jednoduché pre Štandardy (#579)', { doplnene: n });
		bump(54);
	})();
}
