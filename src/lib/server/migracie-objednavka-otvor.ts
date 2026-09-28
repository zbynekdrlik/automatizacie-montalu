// Migrácia v52 (#587) — vo VLASTNOM súbore (vzor v50/v51): `migracie-seed.ts` aj `migracie.ts` sú
// na 1000-riadkovom strope (large-file-split / migrations.md). Parameter injection `(db, bump)`,
// guard `>= N return`, feature-detect tabuľky + stĺpca, celé v transakcii, žiadny cyklický import.
// LEN DDL (súbory `migracie-*.ts` sú mimo mutačného scope — pravidlo polohy žije v `sklo-otvory.ts`).
import type Database from 'better-sqlite3';
import { logger } from './log';

const log = logger('migrate');

/** Stĺpce polohy vŕtaného otvoru na riadku objednávky skla (stred otvoru, mm). */
const STLPCE = ['otvor_od_hrany_mm', 'otvor_od_spodku_mm', 'otvor_priemer_mm'] as const;

/**
 * v51 → v52: poloha zámkového otvoru na riadku `objednavka_skla` „— s otvorom ⌀46" (#587, Odoo úloha
 * 1185 — výkres k sklu ide s objednávkou do IZOS). Tri nullable `REAL` stĺpce: stred otvoru od
 * zvislej hrany, od spodku skla a priemer. Aditívne `ADD COLUMN` (NULL default) — riadky spred
 * zmeny polohu nemajú (honest-null: výkres sa negeneruje, podklad upozorní). Money-NEUTRÁLNE.
 */
export function migrateObjednavkaSklaOtvor(db: Database.Database, bump: (v: number) => void): void {
	if ((db.pragma('user_version', { simple: true }) as number) >= 52) return;
	db.transaction(() => {
		const tabulka = db
			.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'objednavka_skla'")
			.get();
		if (tabulka) {
			const existujuce = new Set(
				(db.prepare('PRAGMA table_info(objednavka_skla)').all() as { name: string }[]).map(
					(c) => c.name
				)
			);
			for (const s of STLPCE)
				if (!existujuce.has(s)) db.exec(`ALTER TABLE objednavka_skla ADD COLUMN ${s} REAL`);
			log.info('migrateObjednavkaSklaOtvor: poloha otvoru na objednavka_skla (#587)');
		}
		bump(52);
	})();
}
