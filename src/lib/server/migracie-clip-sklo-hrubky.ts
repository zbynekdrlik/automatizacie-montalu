// Migrácia v55 (#593, Odoo úloha 1214 — Marek 29.9.: „tu maju byt skla v clip 6mm a 16mm") — vo
// VLASTNOM súbore (vzor v50–v54): `migracie-seed.ts` aj `migracie.ts` sú na 1000-riadkovom strope.
// Parameter injection `(db, bump)`, guard `>= N return`, celé v transakcii. LEN DDL/seed (súbory
// `migracie-*.ts` sú mimo mutačného scope — logika ponuky žije v `clip-sklo.ts`).
import type Database from 'better-sqlite3';
import { logger } from './log';

const log = logger('migrate');

/** Doplnené riadky — ZMRAZENÝ literál (migrácia sa po nasadení nemení). CLIP nie je systém
 *  nárezáka zasklení, preto NIE je v `ODOO_HRUBKY_SEED` (tie kľúče testy iterujú ako systémy s
 *  lokálnym katalógom skiel); čerstvá DB dostane tieto riadky touto migráciou (na konci tabuľky =
 *  rovnaké poradie ako PROD). */
const DOPLNIT: readonly { system: string; mm: number; druh: 'jednoduche' | 'izolacne' }[] = [
	{ system: 'CLIP', mm: 6, druh: 'jednoduche' },
	{ system: 'CLIP', mm: 16, druh: 'izolacne' }
];

/**
 * v54 → v55: povolené hrúbky Odoo skiel pre CLIP zábradlie v `cfg_sklo_hrubka` — 6 mm jednoduché
 * (šablóna „klasika") a 16 mm izolačné (šablóna „IZO"). `INSERT OR IGNORE` na `UNIQUE(system, mm)`
 * → existujúci riadok (CLIP, mm) sa NEprepíše ani nezdvojí. Money-NEUTRÁLNE: mení sa len ponuka
 * výplne na /clip; Money odpis určuje šablóna (izo/klasika) ako doteraz.
 */
export function migrateClipSkloHrubky(db: Database.Database, bump: (v: number) => void): void {
	if ((db.pragma('user_version', { simple: true }) as number) >= 55) return;
	db.transaction(() => {
		const ins = db.prepare(
			'INSERT OR IGNORE INTO cfg_sklo_hrubka (system, mm, druh) VALUES (?, ?, ?)'
		);
		let n = 0;
		for (const r of DOPLNIT) n += ins.run(r.system, r.mm, r.druh).changes;
		log.info('migrateClipSkloHrubky: CLIP 6 mm jednoduché + 16 mm izolačné (#593)', {
			doplnene: n
		});
		bump(55);
	})();
}
