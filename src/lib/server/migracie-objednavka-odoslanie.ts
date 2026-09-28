// Migrácia v51 (#577) — vo VLASTNOM súbore (vzor v50 `migracie-sietka.ts`): `migracie-seed.ts` je
// na 1000-riadkovom strope a `migracie.ts` tiež (large-file-split / migrations.md). Parameter
// injection `(db, bump)`, guard `>= N return`, celé v transakcii, žiadny cyklický import.
// LEN DDL (súbory `migracie-*.ts` sú mimo mutačného scope — logika žije v `objednavka-skla-odoslanie.ts`).
import type Database from 'better-sqlite3';
import { logger } from './log';

const log = logger('migrate');

/**
 * v50 → v51: posledné odoslanie objednávky skla do Odoo per podklad (#577, Marek D. Odoo úloha
 * 1181) — `objednavka_skla_odoslanie(zak_norm PK, glass_order_id, name, odoslane_at, odoslal)`.
 * Podklad nemá hlavičkovú tabuľku (len riadky `objednavka_skla`), preto jedna tabuľka kľúčovaná
 * normalizovanou zákazkou; opakované odoslanie prepíše riadok (Odoo `doc_id` je idempotentný —
 * tá istá objednávka). Aditívne (CREATE TABLE IF NOT EXISTS), Money-NEUTRÁLNE.
 */
export function migrateObjednavkaSklaOdoslanie(
	db: Database.Database,
	bump: (v: number) => void
): void {
	if ((db.pragma('user_version', { simple: true }) as number) >= 51) return;
	db.transaction(() => {
		db.exec(`
			CREATE TABLE IF NOT EXISTS objednavka_skla_odoslanie (
				zak_norm TEXT PRIMARY KEY,
				glass_order_id INTEGER NOT NULL CHECK (glass_order_id > 0),
				name TEXT NOT NULL DEFAULT '',
				odoslane_at TEXT NOT NULL DEFAULT (datetime('now')),
				odoslal TEXT NOT NULL DEFAULT ''
			);
		`);
		log.info('migrateObjednavkaSklaOdoslanie: objednavka_skla_odoslanie vytvorená (#577)');
		bump(51);
	})();
}
