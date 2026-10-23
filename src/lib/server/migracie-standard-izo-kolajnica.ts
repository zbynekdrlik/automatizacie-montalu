// Migrácia v60 (#618, Odoo úloha 1459 — Patrik 22.10.2026: „Aj keď nemám koľajnicu navyše aj tak
// mi ju tam dáva") — vo VLASTNOM súbore (vzor v50–v59): `migracie-seed.ts` aj `migracie.ts` sú na
// 1000-riadkovom strope. Parameter injection `(db, bump)`, guard `>= N return`, celé v transakcii.
// LEN dátová migrácia (súbory `migracie-*.ts` sú mimo mutačného scope — správanie stráži
// `migration-v60.test.ts`).
import type Database from 'better-sqlite3';
import { rolaKolajnice } from '../kolajnica';
import { logger } from './log';

const log = logger('migrate');

/** Kto zapísal riadok `cfg_audit` (editor zapisuje meno používateľa, migrácia systémové meno). */
const AUDIT_USER = 'system-migracia';
/** `pole` v `cfg_audit.zmeny` — rovnaký tvar `{pole, stara, nova}` ako editor vzorcov (história
 *  editora ich ukazuje obsluhe, preto bez mien a interných odkazov). */
const AUDIT_POLE_KOD =
	'Koľajnica spodná · kód (prídavná koľajnica len cez voľbu „Prídavná koľajnica")';
const AUDIT_POLE_NAZOV = 'Koľajnica spodná · názov';

/**
 * Spodná koľajnica starého „Štandard" IZO — ZMRAZENÝ literál (migrácia sa po nasadení nemení;
 * čerstvá DB dostane nové hodnoty priamo zo seedu `cfg_seed.json`, paritu stráži
 * `migration-v60.test.ts`). `staryKod` = natvrdo zväčšená spodná (PROD 23.10., read-only
 * `cfg_rez`), `novyKod`/`novyNazov` = PRESNE spodná koľajnica basic štýlu toho istého systému
 * (`Štandard|2K` …) — `railUpsize` (`RAIL_UPSIZE`) z nej pri zaškrtnutej prídavnej urobí
 * doterajší `staryKod` aj s jeho názvom (bit-identický Money odpis).
 */
export const STANDARD_IZO_SPODNA_KOLAJNICA: readonly {
	sysStyl: string;
	staryKod: string;
	novyKod: string;
	novyNazov: string;
}[] = [
	{
		sysStyl: 'Štandard|2K IZO',
		staryKod: 'ZASP00030',
		novyKod: 'ZASP00104',
		novyNazov: 'Koľajnica spodná 2K  Surový 7500 mm'
	},
	{
		sysStyl: 'Štandard|3K IZO',
		staryKod: 'ZASP00033',
		novyKod: 'ZASP00030',
		novyNazov: 'Koľajnica spodná 3K Surový 7500 mm'
	},
	{
		sysStyl: 'Štandard|4K IZO',
		staryKod: 'ZASP202432',
		novyKod: 'ZASP00033',
		novyNazov: 'Koľajnica spodná 4K Surový 7500 mm'
	},
	{
		sysStyl: 'Štandard|2x2K IZO',
		staryKod: 'ZASP00030',
		novyKod: 'ZASP00104',
		novyNazov: 'Koľajnica spodná 2K  Surový 7500 mm'
	},
	{
		sysStyl: 'Štandard|2x3K IZO',
		staryKod: 'ZASP00033',
		novyKod: 'ZASP00030',
		novyNazov: 'Koľajnica spodná 3K Surový 7500 mm'
	},
	{
		sysStyl: 'Štandard|2x4K IZO',
		staryKod: 'ZASP202432',
		novyKod: 'ZASP00033',
		novyNazov: 'Koľajnica spodná 4K Surový 7500 mm'
	}
];

/**
 * v59 → v60: starý „Štandard" IZO — spodná koľajnica vo vzorci = ZÁKLADNÁ (#618). Doteraz bola
 * prídavná (o veľkosť väčšia) spodná natvrdo v `cfg_rez`, takže ju obsluha nevedela vypnúť; od
 * teraz ju pridáva checkbox „Prídavná koľajnica" (`railUpsize`, pri IZO predvolene zaškrtnutý —
 * `pridavnaKolajnicaDefault`), presne ako pri Štandard +.
 *
 * Riadok = jediný profil štýlu s rolou spodnej koľajnice (`rolaKolajnice`, ten istý zdroj ako
 * ručná dĺžka koľajnice). Zapíše kód + názov LEN keď je aktuálny kód presne natvrdo zväčšený
 * (`staryKod`); už nový kód = bez zmeny (čerstvá DB zo seedu, druhý beh); iný kód (zásah výroby
 * / supervisora) → warn log, NEPREPÍSAŤ; 0 alebo viac spodných koľajníc → warn, nič. Každý zápis
 * má riadok `cfg_audit` v tej istej transakcii. Vzorec (dim/offset/tyč) sa nemení — Money metre
 * ostávajú, mení sa len to, či zväčšenú pridá checkbox. Feature-detect `cfg_rez` (vzor v58);
 * `cfg_audit` sa pripraví až pri prvom zápise (minimálne fixtúry ju nemajú; bez nej zápis zlyhá
 * a transakcia sa vráti — zmena kódu bez auditu nikdy nevznikne).
 */
export function migrateStandardIzoSpodnaKolajnica(
	db: Database.Database,
	bump: (v: number) => void
): void {
	if ((db.pragma('user_version', { simple: true }) as number) >= 60) return;
	const maCfgRez = db
		.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cfg_rez'")
		.get();
	db.transaction(() => {
		if (maCfgRez) {
			const sel = db.prepare(
				`SELECT id, kod, nazov FROM cfg_rez WHERE sys_styl = ? AND typ = 'profil' ORDER BY id`
			);
			const upd = db.prepare('UPDATE cfg_rez SET kod = ?, nazov = ? WHERE id = ?');
			let insAudit: Database.Statement | null = null;
			let opravene = 0;
			for (const o of STANDARD_IZO_SPODNA_KOLAJNICA) {
				const riadky = (sel.all(o.sysStyl) as { id: number; kod: string; nazov: string }[]).filter(
					(r) => rolaKolajnice(r.nazov) === 'spodna'
				);
				const r = riadky[0];
				if (!r || riadky.length > 1) {
					log.warn(
						'migrateStandardIzoSpodnaKolajnica: spodná koľajnica chýba/nejednoznačná — preskočené',
						{ sysStyl: o.sysStyl, pocet: riadky.length }
					);
					continue;
				}
				if (r.kod === o.novyKod) {
					log.info('migrateStandardIzoSpodnaKolajnica: už základná — bez zmeny', {
						sysStyl: o.sysStyl,
						kod: r.kod
					});
					continue;
				}
				if (r.kod !== o.staryKod) {
					log.warn(
						'migrateStandardIzoSpodnaKolajnica: neočakávaný kód (zmenený mimo seedu) — NEprepísané',
						{ sysStyl: o.sysStyl, aktualny: r.kod, ocakavany: o.staryKod, novy: o.novyKod }
					);
					continue;
				}
				upd.run(o.novyKod, o.novyNazov, r.id);
				insAudit ??= db.prepare(
					'INSERT INTO cfg_audit (username, sys_styl, zmeny) VALUES (?, ?, ?)'
				);
				insAudit.run(
					AUDIT_USER,
					o.sysStyl,
					JSON.stringify([
						{ pole: AUDIT_POLE_KOD, stara: r.kod, nova: o.novyKod },
						{ pole: AUDIT_POLE_NAZOV, stara: r.nazov, nova: o.novyNazov }
					])
				);
				opravene++;
				log.info('migrateStandardIzoSpodnaKolajnica: spodná koľajnica = základná', {
					sysStyl: o.sysStyl,
					stary: r.kod,
					novy: o.novyKod
				});
			}
			log.info('migrateStandardIzoSpodnaKolajnica: hotovo (Odoo úloha 1459)', { opravene });
		}
		bump(60);
	})();
}
