// Migrácia v58 (#610, Odoo úloha 1416 — Patrik 17.10.2026: „Rozširujúci profil má byť o 6 mm
// väčší od skla. Kladkový profil má byť väčší o 10 mm. Meniť šírku skla, nie profilov!") — vo
// VLASTNOM súbore (vzor v50–v57): `migracie-seed.ts` aj `migracie.ts` sú na 1000-riadkovom strope.
// Parameter injection `(db, bump)`, guard `>= N return`, celé v transakcii. LEN dátová migrácia
// (súbory `migracie-*.ts` sú mimo mutačného scope — správanie stráži `migration-v58.test.ts`).
import type Database from 'better-sqlite3';
import { logger } from './log';

const log = logger('migrate');

/** Kto zapísal riadok `cfg_audit` (editor zapisuje meno používateľa, migrácia systémové meno). */
const AUDIT_USER = 'system-migracia';
/** `pole` v `cfg_audit.zmeny` — rovnaký tvar `{pole, stara, nova}` ako editor vzorcov. */
const AUDIT_POLE = 'Sklo šírka (S) offset — Odoo úloha 1416 (#610)';

/**
 * Šírka skla Štandard + opona IZO — ZMRAZENÝ literál (migrácia sa po nasadení nemení; čerstvá DB
 * dostane nové hodnoty priamo zo seedu `cfg_seed.json`, paritu stráži `migration-v58.test.ts`).
 * `nova = offset_kladkový(PROD 17.10.) − 10·N` (kladkový −273/−320/−380, N = 4/6/8) → na krídlo
 * presne kladkový − 10 mm, rozširujúci (−290/−342/−410) − sklo = 5,75 / 6,33 / 6,25 mm.
 * `stara` = hodnota zo seedu = PROD 17.10. (odvodenie #504 `prírez_off − 9N`).
 */
export const OPONA_IZO_SKLO_SIRKA_610: readonly { sysStyl: string; stara: number; nova: number }[] =
	[
		{ sysStyl: 'Štandard +|2x2K IZO', stara: -271, nova: -313 },
		{ sysStyl: 'Štandard +|2x3K IZO', stara: -339, nova: -380 },
		{ sysStyl: 'Štandard +|2x4K IZO', stara: -407, nova: -460 }
	];

/**
 * v57 → v58: šírka skla Štandard + opona IZO = kladkový − 10 mm (#610). Riadok `Sklo šírka`
 * (typ sklo, dim S) editor vzorcov NEUKAZUJE (zrkadlí sa len z rámového profilu tej istej dim a
 * tieto štýly rámový S nemajú) — výroba ho opraviť nevie, preto dátová migrácia.
 *
 * Zapíše LEN keď je aktuálna hodnota presne doterajšia (`stara`); hodnotu, ktorú niekto medzitým
 * zmenil, NEPREPÍŠE (warn log, nech je zásah vidno), nová hodnota = bez zmeny (čerstvá DB zo
 * seedu, druhý beh). Každý zápis má riadok `cfg_audit` v tej istej transakcii — Money-neutrálne
 * (sklo ide do plánu / objednávky skla / výkresu, profily ani Money odpis sa nemenia).
 * Feature-detect `cfg_rez` (vzor v47 `migrateOponaIzo` — minimálne migračné fixtúry ju nemajú);
 * `cfg_audit` sa pripraví až pri prvom zápise (reálna DB ju má od v1; bez nej zápis zlyhá a
 * transakcia sa vráti — zmena skla bez auditu nikdy nevznikne).
 */
export function migrateOponaIzoSkloSirka(db: Database.Database, bump: (v: number) => void): void {
	if ((db.pragma('user_version', { simple: true }) as number) >= 58) return;
	const maCfgRez = db
		.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cfg_rez'")
		.get();
	db.transaction(() => {
		if (maCfgRez) {
			const sel = db.prepare(
				`SELECT id, offset FROM cfg_rez WHERE sys_styl = ? AND typ = 'sklo' AND dim = 'S'`
			);
			const upd = db.prepare('UPDATE cfg_rez SET offset = ? WHERE id = ?');
			let insAudit: Database.Statement | null = null;
			let opravene = 0;
			for (const o of OPONA_IZO_SKLO_SIRKA_610) {
				const riadky = sel.all(o.sysStyl) as { id: number; offset: number }[];
				const r = riadky[0];
				if (!r || riadky.length > 1) {
					log.warn('migrateOponaIzoSkloSirka: riadok Sklo šírka chýba/nejednoznačný — preskočené', {
						sysStyl: o.sysStyl,
						pocet: riadky.length
					});
					continue;
				}
				if (r.offset === o.nova) {
					log.info('migrateOponaIzoSkloSirka: už nová hodnota — bez zmeny', {
						sysStyl: o.sysStyl,
						offset: r.offset
					});
					continue;
				}
				if (r.offset !== o.stara) {
					log.warn(
						'migrateOponaIzoSkloSirka: neočakávaná hodnota (zmenená mimo seedu) — NEprepísané',
						{ sysStyl: o.sysStyl, aktualna: r.offset, ocakavana: o.stara, nova: o.nova }
					);
					continue;
				}
				upd.run(o.nova, r.id);
				insAudit ??= db.prepare(
					'INSERT INTO cfg_audit (username, sys_styl, zmeny) VALUES (?, ?, ?)'
				);
				insAudit.run(
					AUDIT_USER,
					o.sysStyl,
					JSON.stringify([{ pole: AUDIT_POLE, stara: o.stara, nova: o.nova }])
				);
				opravene++;
				log.info('migrateOponaIzoSkloSirka: sklo šírka opravená (kladkový − 10 mm)', {
					sysStyl: o.sysStyl,
					stara: o.stara,
					nova: o.nova
				});
			}
			log.info('migrateOponaIzoSkloSirka: hotovo (Odoo úloha 1416)', { opravene });
		}
		bump(58);
	})();
}
