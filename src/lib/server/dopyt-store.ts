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

// --- Interný prehľad dopytov (#282) — additívne k #277 store; stále len `./db`, nič z Money. ---

/** Riadok zoznamu — `DopytRiadok` + voliteľný `odoo_lead_id` (#278 ho pridá v migrácii v26).
 *  Kľúč je prítomný LEN keď tabuľka stĺpec reálne má (feature-detect nižšie) — obranná
 *  príprava miesta pre Odoo lead bez závislosti na #278 schéme. */
export interface DopytListRiadok extends DopytRiadok {
	odoo_lead_id?: number | null;
}

/** Má tabuľka `dopyt` stĺpec `odoo_lead_id`? (#278 ho pridá v migrácii v26.) Feature-detect
 *  cez `PRAGMA table_info` — zoznam sa tak správne vykreslí nezávisle od toho, či #278 landol.
 *  Detekcia na SCHÉME (nie na kľúčoch dát), takže funguje aj pri prázdnom zozname. */
export function hasOdooLeadColumn(): boolean {
	const cols = db.prepare('PRAGMA table_info(dopyt)').all() as { name: string }[];
	return cols.some((c) => c.name === 'odoo_lead_id');
}

/** Stránka dopytov, NAJNOVŠIE HORE (`id DESC` = monotónne, bez `created_at` remíz). `offset`/
 *  `limit` sa clampujú (obrana proti nezmyselnému vstupu z query). Ak schéma má `odoo_lead_id`
 *  (#278/v26), SELECT ho zahrnie a riadok ho nesie; inak kľúč chýba (defenzívne). */
export function listDopyty(offset: number, limit: number): DopytListRiadok[] {
	const off = Math.max(0, Math.trunc(offset));
	const lim = Math.max(1, Math.trunc(limit));
	const cols = hasOdooLeadColumn()
		? 'id, konfiguracia, meno, email, telefon, miesto, poznamka, created_at, odoo_lead_id'
		: 'id, konfiguracia, meno, email, telefon, miesto, poznamka, created_at';
	return db
		.prepare(`SELECT ${cols} FROM dopyt ORDER BY id DESC LIMIT ? OFFSET ?`)
		.all(lim, off) as DopytListRiadok[];
}
