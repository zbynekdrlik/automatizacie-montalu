// Migrácia v57 (#608, Odoo úloha 1380 — DOROBENIE: druhý odpis tej istej zákazky/OP po vedomom
// potvrdení) — vo VLASTNOM súbore (vzor v50–v56): `migracie-seed.ts` aj `migracie.ts` sú na
// 1000-riadkovom strope. Parameter injection `(db, bump)`, guard `>= N return`. LEN DDL (súbory
// `migracie-*.ts` sú mimo mutačného scope — logika dorobenia žije vo `writeOdpis`, money.ts).
import type Database from 'better-sqlite3';
import { logger } from './log';

const log = logger('migrate');

/** Stĺpce `odpis_log` po v57 v poradí novej tabuľky (v1/v2 základ + v27 norm + v31 presun + v57). */
const STLPCE = [
	'id',
	'modul',
	'zak',
	'op',
	'zakaznik',
	'caka',
	'live',
	'target',
	'filename',
	'content_hash',
	'detail',
	'created_by',
	'created_at',
	'zak_norm',
	'op_norm',
	'presunute_at',
	'poradie'
] as const;

/**
 * v56 → v57: `odpis_log.poradie INTEGER NOT NULL DEFAULT 1` a dedup kľúč
 * `UNIQUE (modul, zak, op, live, poradie)` — dorobenie je samostatný riadok s poradím > 1, prvý odpis
 * ostáva nezmenený. UNIQUE je inline v CREATE TABLE (SQLite ho nevie ALTER-núť) → PRESTAVBA tabuľky
 * (SQLite „12 krokov"): nová tabuľka → kópia (aj `id`) → DROP → RENAME → indexy späť.
 *
 * PASCA: na `odpis_log(id)` visia FK `ON DELETE CASCADE` z `odpis_polozky` (v19) AJ `odpis_odpad`
 * (v39) a `db.ts` má `foreign_keys = ON` → `DROP TABLE odpis_log` by CASCADE-om zmazal všetky položky
 * aj odpad. Preto `foreign_keys = OFF` PRED transakciou (pragma vnútri transakcie je no-op),
 * `foreign_key_check` pred commitom a pôvodný stav FK späť vo `finally`. RENAME novej tabuľky na
 * `odpis_log` nemení FK deti (odkazujú na meno `odpis_log`, ktoré po RENAME opäť existuje).
 * Kopírujú sa len stĺpce, ktoré stará tabuľka má (minimálne migračné fixtúry nemusia mať v27/v31
 * stĺpce) — na reálnej DB sú to všetky. Atomické: pád → rollback, blok sa prehrá pri ďalšom štarte.
 */
export function migrateOdpisPoradie(db: Database.Database, bump: (v: number) => void): void {
	if ((db.pragma('user_version', { simple: true }) as number) >= 57) return;
	const maOdpisLog =
		db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='odpis_log'").get() !==
		undefined;
	if (!maOdpisLog) {
		db.transaction(() => bump(57))();
		return;
	}
	const fkPred = db.pragma('foreign_keys', { simple: true }) as number;
	db.pragma('foreign_keys = OFF');
	try {
		db.transaction(() => {
			const stare = new Set(
				(db.prepare('PRAGMA table_info(odpis_log)').all() as { name: string }[]).map((c) => c.name)
			);
			const indexy = db
				.prepare(
					"SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='odpis_log' AND sql IS NOT NULL"
				)
				.all() as { sql: string }[];
			const pocetPred = (db.prepare('SELECT COUNT(*) AS n FROM odpis_log').get() as { n: number })
				.n;
			db.exec(`
				DROP TABLE IF EXISTS odpis_log_v57;
				CREATE TABLE odpis_log_v57 (
					id INTEGER PRIMARY KEY,
					modul TEXT NOT NULL,
					zak TEXT NOT NULL,
					op TEXT NOT NULL,
					zakaznik TEXT NOT NULL,
					caka INTEGER NOT NULL DEFAULT 0,
					live INTEGER NOT NULL,
					target TEXT NOT NULL,
					filename TEXT NOT NULL,
					content_hash TEXT NOT NULL DEFAULT '',
					detail TEXT NOT NULL DEFAULT '{}',
					created_by TEXT NOT NULL DEFAULT '',
					created_at TEXT NOT NULL DEFAULT (datetime('now')),
					zak_norm TEXT NOT NULL DEFAULT '',
					op_norm TEXT NOT NULL DEFAULT '',
					presunute_at TEXT,
					poradie INTEGER NOT NULL DEFAULT 1 CHECK (poradie >= 1),
					UNIQUE (modul, zak, op, live, poradie)
				);
			`);
			const spolocne = STLPCE.filter((c) => stare.has(c)).join(', ');
			db.exec(`INSERT INTO odpis_log_v57 (${spolocne}) SELECT ${spolocne} FROM odpis_log`);
			const pocetPo = (db.prepare('SELECT COUNT(*) AS n FROM odpis_log_v57').get() as { n: number })
				.n;
			if (pocetPo !== pocetPred)
				throw new Error(`v57: prestavba odpis_log stratila riadky (${pocetPred} → ${pocetPo})`);
			db.exec('DROP TABLE odpis_log');
			db.exec('ALTER TABLE odpis_log_v57 RENAME TO odpis_log');
			for (const i of indexy) db.exec(i.sql);
			const fk = db.prepare('PRAGMA foreign_key_check').all();
			if (fk.length > 0)
				throw new Error(`v57: foreign_key_check po prestavbe odpis_log: ${JSON.stringify(fk)}`);
			log.info('migrateOdpisPoradie: odpis_log s poradím (dorobenie, #608)', {
				riadkov: pocetPo,
				indexov: indexy.length
			});
			bump(57);
		})();
	} finally {
		db.pragma(`foreign_keys = ${fkPred ? 'ON' : 'OFF'}`);
	}
}
