// Migrácia v50 (#569) — vo VLASTNOM súbore, lebo `migracie-seed.ts` je na 1000-riadkovom strope
// (996 r.) a `migracie.ts` tiež (large-file-split / migrations.md). Rovnaký vzor ako funkcie v
// `migracie-seed.ts`: parameter injection `(db, bump)`, guard `>= N return`, celé v transakcii,
// žiadny cyklický import (súbor importuje len čistý `$lib`-level model).
import type Database from 'better-sqlite3';
import { logger } from './log';
import { SIETKA_STANDARD_KLUCE, SIETKA_STANDARD_SEED } from '../sietka-standard';

const log = logger('migrate');

/**
 * v49 → v50: konštanty geometrického modelu sieťky Štandard/Štandard + (#569, Patrik Odoo úloha
 * 1070) — K (rozdiel kladkového pri kombinácii starý/plus), R (šírka rámu sieťky nad kladkovým),
 * H (výška sieťky nad základným sklom). Nová tabuľka `cfg_sietka_standard(kluc, hodnota)`,
 * CHECK na povolené kľúče, seed = dnešné správanie (K 16,5 / R 17 / H 3 — `SIETKA_STANDARD_SEED`,
 * jeden zdroj s kódom). Aditívne (CREATE TABLE IF NOT EXISTS + INSERT OR IGNORE → neprepíše
 * hodnotu upravenú editorom). Editor vzorcov (`saveCfgChanges`) ich mení s auditom v `cfg_audit`.
 * Money-relevantné LEN cez K (kladkový ZASP202415 pri krížovej sieťke), seed = bit-identický
 * odpis pre všetky kombinácie okrem opravy starý posuv + sieťka plus (#569).
 */
export function migrateSietkaStandard(db: Database.Database, bump: (v: number) => void): void {
	if ((db.pragma('user_version', { simple: true }) as number) >= 50) return;
	db.transaction(() => {
		db.exec(`
			CREATE TABLE IF NOT EXISTS cfg_sietka_standard (
				kluc TEXT PRIMARY KEY CHECK (kluc IN ('k', 'r', 'h')),
				hodnota REAL NOT NULL
			);
		`);
		const ins = db.prepare(
			'INSERT OR IGNORE INTO cfg_sietka_standard (kluc, hodnota) VALUES (?, ?)'
		);
		for (const k of SIETKA_STANDARD_KLUCE) ins.run(k, SIETKA_STANDARD_SEED[k]);
		log.info('migrateSietkaStandard: cfg_sietka_standard K/R/H naseedované (#569)', {
			...SIETKA_STANDARD_SEED
		});
		bump(50);
	})();
}
