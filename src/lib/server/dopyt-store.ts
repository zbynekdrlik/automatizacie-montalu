// Uloženie verejného zákazníckeho dopytu (#277) — audit trail konfigurácie + kontaktu.
// MONEY-NEUTRÁLNE: tabuľka `dopyt` nemá žiadny FK na odpis/Money, tento modul NEimportuje
// `money`/`pergola` a NEZAPISUJE nič do `/data` (Money import). Strážené statickým guardom
// `tests/dopyt-money-safety.test.ts`. Import `./db` je len pripojenie k SQLite (rovnaká DB
// ako zvyšok appky) — nie odpisová/zápisová cesta.
import { db } from './db';

export interface DopytZaznam {
	/** kanonický JSON konfigurácie (už sanitizovaný `sanitizePonukaConfig` volajúcim) */
	konfiguracia: string;
	meno: string;
	email: string;
	telefon: string;
	miesto: string;
	poznamka: string;
}

export interface DopytRiadok extends DopytZaznam {
	id: number;
	created_at: string;
}

const insertStmt = db.prepare(
	`INSERT INTO dopyt (konfiguracia, meno, email, telefon, miesto, poznamka)
	 VALUES (@konfiguracia, @meno, @email, @telefon, @miesto, @poznamka)`
);

/** Vloží dopyt, vráti nové `id`. Nikdy sa nedotýka Money/odpis cesty. */
export function insertDopyt(z: DopytZaznam): number {
	const info = insertStmt.run({
		konfiguracia: z.konfiguracia,
		meno: z.meno,
		email: z.email,
		telefon: z.telefon,
		miesto: z.miesto,
		poznamka: z.poznamka
	});
	return Number(info.lastInsertRowid);
}

/** Načíta jeden dopyt (audit/diagnostika). */
export function getDopyt(id: number): DopytRiadok | undefined {
	return db
		.prepare(
			'SELECT id, konfiguracia, meno, email, telefon, miesto, poznamka, created_at FROM dopyt WHERE id = ?'
		)
		.get(id) as DopytRiadok | undefined;
}

/** Počet uložených dopytov (audit/diagnostika, napr. admin prehľad). */
export function countDopyty(): number {
	return (db.prepare('SELECT COUNT(*) c FROM dopyt').get() as { c: number }).c;
}
