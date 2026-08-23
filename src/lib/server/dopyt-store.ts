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

// ---- Odoo CRM lead zrkadlenie (#278) ------------------------------------------------
// Stavové stĺpce `odoo_lead_id` / `odoo_attempts` / `odoo_last_error` pridala migrácia v26.
// Tvorba leadu (`odoo-lead.ts`) je fire-and-forget + retry — dopyt sa NIKDY nestratí ani
// keď je Odoo dole. STÁLE MONEY-NEUTRÁLNE: lead metadáta, žiadny odpis/Money/`/data`.

/** Zdroj pre payload leadu — kontakt + kanonická konfigurácia (JSON) + Odoo stav (v26). */
export interface DopytLeadRiadok {
	id: number;
	konfiguracia: string;
	meno: string;
	email: string;
	telefon: string;
	miesto: string;
	poznamka: string;
	created_at: string;
	odoo_lead_id: number | null;
	odoo_attempts: number;
	odoo_last_error: string;
}

const leadSelectCols =
	'id, konfiguracia, meno, email, telefon, miesto, poznamka, created_at, odoo_lead_id, odoo_attempts, odoo_last_error';

/** Načíta jeden dopyt na tvorbu Odoo leadu (kontakt + konfigurácia + počet pokusov). */
export function getDopytForLead(id: number): DopytLeadRiadok | undefined {
	return db.prepare(`SELECT ${leadSelectCols} FROM dopyt WHERE id = ?`).get(id) as
		DopytLeadRiadok | undefined;
}

/**
 * Dopyty čakajúce na vytvorenie Odoo leadu: ešte nemajú `odoo_lead_id` a nevyčerpali
 * `maxAttempts` pokusov. Najstaršie prvé (FIFO), ohraničené `limit`. Toto je fronta pre
 * `retryPendingLeads()` — riadok mimo nej je buď hotový (má lead_id) alebo vzdaný (max pokusov,
 * `odoo_last_error` drží dôvod na diagnostiku; dopyt stále NIE JE stratený).
 */
export function getPendingLeadDopyty(maxAttempts: number, limit: number): DopytLeadRiadok[] {
	return db
		.prepare(
			`SELECT ${leadSelectCols} FROM dopyt
			 WHERE odoo_lead_id IS NULL AND odoo_attempts < ?
			 ORDER BY id ASC LIMIT ?`
		)
		.all(maxAttempts, limit) as DopytLeadRiadok[];
}

/** Označí dopyt ako úspešne zrkadlený do Odoo (uloží `lead_id`, vyčistí chybu). */
export function markLeadCreated(id: number, leadId: number): void {
	db.prepare("UPDATE dopyt SET odoo_lead_id = ?, odoo_last_error = '' WHERE id = ?").run(
		leadId,
		id
	);
}

/** Zaznamená neúspešný pokus (inkrementuje `odoo_attempts`, uloží chybu) — dopyt zostáva. */
export function markLeadFailed(id: number, error: string): void {
	db.prepare(
		'UPDATE dopyt SET odoo_attempts = odoo_attempts + 1, odoo_last_error = ? WHERE id = ?'
	).run(error.slice(0, 500), id);
}
