// Migrácia v56 (Odoo úloha 1218 — Patrik 29.9., msg 1872179: „Štandardy — 4, 6, 16 mm") — vo
// VLASTNOM súbore (vzor v50–v55): `migracie-seed.ts` aj `migracie.ts` sú na 1000-riadkovom strope.
// Parameter injection `(db, bump)`, guard `>= N return`, celé v transakcii. LEN DDL/seed (súbory
// `migracie-*.ts` sú mimo mutačného scope — logika ponuky žije v `sklo-hrubky.ts`).
import type Database from 'better-sqlite3';
import { logger } from './log';

const log = logger('migrate');

/** Odobraté riadky — ZMRAZENÝ literál (migrácia sa po nasadení nemení; čerstvá DB ich zo seedu v52
 *  `ODOO_HRUBKY_SEED` už nedostane, parita stráži `migration-v56.test.ts` + `sklo-hrubky-579`). */
const ODOBRAT: readonly { system: string; mm: number; druh: 'izolacne' }[] = [
	{ system: 'Štandard +', mm: 24, druh: 'izolacne' },
	{ system: 'Štandard', mm: 24, druh: 'izolacne' }
];

/**
 * v55 → v56: bez 24 mm izolačného pre Štandard + a starý Štandard v `cfg_sklo_hrubka` (Drevostavby
 * bez zmeny) — rovnaký stav, aký výroba 29.9. nastavila v PROD editore hrúbok (cfg_audit 76/77), aby
 * čerstvá DB / CI / obnovená záloha zodpovedala špecifikácii klienta. Maže LEN presný riadok
 * (systém, 24, izolačné) — 24 mm iného druhu (vedomá voľba výroby) ostáva; na PROD no-op. Beží raz
 * (guard), neskoršie opätovné povolenie 24 mm v editore teda nič neprepíše. Money-NEUTRÁLNE: mení
 * sa len ponuka Odoo skiel nárezáka, výpočtové sklá ostatných volieb sú bez zmeny.
 */
export function migrateStandardyBez24mm(db: Database.Database, bump: (v: number) => void): void {
	if ((db.pragma('user_version', { simple: true }) as number) >= 56) return;
	db.transaction(() => {
		const del = db.prepare('DELETE FROM cfg_sklo_hrubka WHERE system = ? AND mm = ? AND druh = ?');
		let n = 0;
		for (const r of ODOBRAT) n += del.run(r.system, r.mm, r.druh).changes;
		log.info('migrateStandardyBez24mm: Štandardy bez 24 mm izolačného (úloha 1218)', {
			odobrate: n
		});
		bump(56);
	})();
}
