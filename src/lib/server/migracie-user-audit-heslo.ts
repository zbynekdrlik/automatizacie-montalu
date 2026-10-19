// Migrácia v59 (#613 druhá časť — trvalý audit zmeny hesla administrátorom) — vo VLASTNOM súbore
// (vzor v50–v58): `migracie-seed.ts` aj `migracie.ts` sú na 1000-riadkovom strope. Parameter
// injection `(db, bump)`, guard `>= N return`. LEN DDL (súbory `migracie-*.ts` sú mimo mutačného
// scope — zápis auditu žije v `setPassword`, auth.ts; správanie stráži `migration-v59.test.ts`).
import type Database from 'better-sqlite3';
import { logger } from './log';

const log = logger('migrate');

/** Stĺpce `user_audit` (v20, nezmenené v24) — prestavba ich kopíruje 1:1 v tomto poradí. */
const STLPCE = ['id', 'ts', 'actor', 'action', 'target_username', 'detail'] as const;

/**
 * v58 → v59: `user_audit.action` CHECK rozšírený o `password_reset` — `setPassword` (#613) zapisuje
 * zmenu hesla administrátorom do trvalého auditu (dovtedy len `auth` stdout log, ktorý každý
 * redeploy zahodí). SQLite nevie ALTER-núť CHECK → PRESTAVBA tabuľky (vzor v24 + v57): nová tabuľka
 * → kópia všetkých riadkov AJ s `id` (história ostáva chronologická podľa id) → DROP → RENAME →
 * indexy/triggery späť.
 *
 * - Na `user_audit` dnes nevisí žiadny FK, aj tak sa drží vzor v57: `foreign_keys = OFF` PRED
 *   transakciou (pragma vnútri transakcie je no-op), `foreign_key_check` pred commitom, pôvodný
 *   stav vo `finally` — budúce FK dieťa by inak DROP-om prišlo o riadky (CASCADE).
 * - Tvar starej tabuľky sa OVERÍ: iná množina stĺpcov (napr. ručne pridaný stĺpec) = throw →
 *   rollback, nič sa nestratí (kópia pevného zoznamu by ten stĺpec ticho zahodila).
 * - Počet riadkov pred/po sa porovná (throw → rollback pri nesúlade).
 * - Minimálne migračné fixtúry bez `user_audit` → len bump.
 * Atomické: pád → rollback, blok sa čisto prehrá pri ďalšom štarte (verzia ostane 58).
 */
export function migrateUserAuditHeslo(db: Database.Database, bump: (v: number) => void): void {
	if ((db.pragma('user_version', { simple: true }) as number) >= 59) return;
	const maTabulku =
		db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='user_audit'").get() !==
		undefined;
	if (!maTabulku) {
		db.transaction(() => bump(59))();
		return;
	}
	const fkPred = db.pragma('foreign_keys', { simple: true }) as number;
	db.pragma('foreign_keys = OFF');
	try {
		db.transaction(() => {
			const stare = (db.prepare('PRAGMA table_info(user_audit)').all() as { name: string }[])
				.map((c) => c.name)
				.sort();
			const ocakavane = [...STLPCE].sort();
			if (stare.join(',') !== ocakavane.join(','))
				throw new Error(
					`v59: nečakané stĺpce user_audit [${stare.join(', ')}] (čakané [${ocakavane.join(', ')}]) — prestavba by ich stratila`
				);
			const doplnky = db
				.prepare(
					"SELECT sql FROM sqlite_master WHERE type IN ('index','trigger') AND tbl_name='user_audit' AND sql IS NOT NULL"
				)
				.all() as { sql: string }[];
			const pocet = (tab: string) =>
				(db.prepare(`SELECT COUNT(*) AS n FROM ${tab}`).get() as { n: number }).n;
			const pocetPred = pocet('user_audit');
			const stlpce = STLPCE.join(', ');
			db.exec(`
				DROP TABLE IF EXISTS user_audit_v59;
				CREATE TABLE user_audit_v59 (
					id INTEGER PRIMARY KEY,
					ts TEXT NOT NULL DEFAULT (datetime('now')),
					actor TEXT NOT NULL,
					action TEXT NOT NULL CHECK (action IN ('create','role_change','delete','seed','password_reset')),
					target_username TEXT NOT NULL,
					detail TEXT NOT NULL DEFAULT ''
				);
				INSERT INTO user_audit_v59 (${stlpce}) SELECT ${stlpce} FROM user_audit;
			`);
			const pocetPo = pocet('user_audit_v59');
			if (pocetPo !== pocetPred)
				throw new Error(`v59: prestavba user_audit stratila riadky (${pocetPred} → ${pocetPo})`);
			db.exec('DROP TABLE user_audit');
			db.exec('ALTER TABLE user_audit_v59 RENAME TO user_audit');
			for (const d of doplnky) db.exec(d.sql);
			const fk = db.prepare('PRAGMA foreign_key_check').all();
			if (fk.length > 0)
				throw new Error(`v59: foreign_key_check po prestavbe user_audit: ${JSON.stringify(fk)}`);
			log.info('migrateUserAuditHeslo: user_audit pozná password_reset (#613)', {
				riadkov: pocetPo,
				doplnkov: doplnky.length
			});
			bump(59);
		})();
	} finally {
		db.pragma(`foreign_keys = ${fkPred ? 'ON' : 'OFF'}`);
	}
}
