// Uloženie verejného zákazníckeho dopytu (#277) — audit trail konfigurácie + kontaktu.
// MONEY-NEUTRÁLNE: tabuľka `dopyt` nemá žiadny FK na odpis/Money, tento modul NEimportuje
// `money`/`pergola` a NEZAPISUJE nič do `/data` (Money import). Strážené statickým guardom
// `tests/dopyt-money-safety.test.ts`. Import `./db` je len pripojenie k SQLite (rovnaká DB
// ako zvyšok appky) — nie odpisová/zápisová cesta.
import { db } from './db';
import { stampNaStlpce, type CenaStamp, type DopytCenaStlpce } from './dopyt-cena-stamp';

export interface DopytZaznam {
	/** kanonický JSON konfigurácie (už sanitizovaný `sanitizePonukaConfig` volajúcim) */
	konfiguracia: string;
	meno: string;
	email: string;
	telefon: string;
	miesto: string;
	poznamka: string;
	/** #384/v35 — produktový rad (kód katalógu `KONF_PRODUKTY`); NULL = starý pergolový dopyt. */
	produkt?: string;
}

/** Uložený dopyt riadok + opečiatkovaná cena (#309, migrácia v30 — NULL = neopečiatkovaný). */
export interface DopytRiadok extends DopytZaznam, DopytCenaStlpce {
	id: number;
	created_at: string;
}

// #309: cenové stĺpce (v30) sa vždy zapíšu — NULL keď dopyt neprišiel s pečiatkou (starý caller).
const insertStmt = db.prepare(
	`INSERT INTO dopyt (konfiguracia, meno, email, telefon, miesto, poznamka, produkt,
	                    cena_druh, cena_bez_dph, cena_s_dph, cena_hlbka_grid_m,
	                    cena_sirka_grid_m, cena_model, cennik_verzia, cena_hladina)
	 VALUES (@konfiguracia, @meno, @email, @telefon, @miesto, @poznamka, @produkt,
	         @cena_druh, @cena_bez_dph, @cena_s_dph, @cena_hlbka_grid_m,
	         @cena_sirka_grid_m, @cena_model, @cennik_verzia, @cena_hladina)`
);

/** Vloží dopyt, vráti nové `id`. Voliteľná pečiatka ceny (#309) sa uloží do `cena_*`/`cennik_verzia`
 *  (bez nej → NULL = neopečiatkovaný riadok). Nikdy sa nedotýka Money/odpis cesty. */
export function insertDopyt(z: DopytZaznam, stamp?: CenaStamp): number {
	const info = insertStmt.run({
		konfiguracia: z.konfiguracia,
		meno: z.meno,
		email: z.email,
		telefon: z.telefon,
		miesto: z.miesto,
		poznamka: z.poznamka,
		produkt: z.produkt ?? null,
		...stampNaStlpce(stamp)
	});
	return Number(info.lastInsertRowid);
}

// --- Záväzná objednávka (#319/v33) — dopyt riadok s je_objednavka=1 + fakturačné údaje + súhlas. ---
// STÁLE MONEY-NEUTRÁLNE: CRM/objednávková evidencia, žiadny odpis ani zápis do /data. Objednaná
// cena je ZAPEČATENÁ rovnakou pečiatkou (`stamp`) ako dopyt (#309/#318 — vrátane MO/VO hladiny).

/** Objednávkový záznam na uloženie — kontakt + konfigurácia (`DopytZaznam`) + fakturačné údaje. */
export interface ObjednavkaZaznam extends DopytZaznam {
	faktMeno: string;
	faktAdresa: string;
	faktIco: string;
	faktDic: string;
}

const insertObjStmt = db.prepare(
	`INSERT INTO dopyt (konfiguracia, meno, email, telefon, miesto, poznamka, produkt,
	                    je_objednavka, fakt_meno, fakt_adresa, fakt_ico, fakt_dic, suhlas_podmienky,
	                    cena_druh, cena_bez_dph, cena_s_dph, cena_hlbka_grid_m,
	                    cena_sirka_grid_m, cena_model, cennik_verzia, cena_hladina)
	 VALUES (@konfiguracia, @meno, @email, @telefon, @miesto, @poznamka, @produkt,
	         1, @fakt_meno, @fakt_adresa, @fakt_ico, @fakt_dic, 1,
	         @cena_druh, @cena_bez_dph, @cena_s_dph, @cena_hlbka_grid_m,
	         @cena_sirka_grid_m, @cena_model, @cennik_verzia, @cena_hladina)`
);

/** Vloží záväznú objednávku (`je_objednavka=1`, súhlas zaznamenaný, fakturačné údaje), vráti `id`.
 *  Cena sa zapečatí rovnakou pečiatkou ako dopyt (`stamp` — MO/VO hladina zapečatená, #319 bod 5).
 *  Odoo lead sa z tohto riadka vytvorí ako objednávka (opportunity) — vetva v `odoo-lead.ts`. */
export function insertObjednavka(z: ObjednavkaZaznam, stamp?: CenaStamp): number {
	const info = insertObjStmt.run({
		konfiguracia: z.konfiguracia,
		meno: z.meno,
		email: z.email,
		telefon: z.telefon,
		miesto: z.miesto,
		poznamka: z.poznamka,
		produkt: z.produkt ?? null,
		fakt_meno: z.faktMeno,
		fakt_adresa: z.faktAdresa,
		fakt_ico: z.faktIco,
		fakt_dic: z.faktDic,
		...stampNaStlpce(stamp)
	});
	return Number(info.lastInsertRowid);
}

/** Cenové stĺpce (#309/v30, #318/v32 `cena_hladina`) — súčasť SELECTu v `getDopyt`/`listDopyty`
 *  (opečiatkovaná cena + typ hladiny MO/VO). */
const cenaStlpce =
	'cena_druh, cena_bez_dph, cena_s_dph, cena_hlbka_grid_m, cena_sirka_grid_m, cena_model, cennik_verzia, cena_hladina';

/** Načíta jeden dopyt (audit/diagnostika + opečiatkovaná cena pre re-download PDF). */
export function getDopyt(id: number): DopytRiadok | undefined {
	return db
		.prepare(
			`SELECT id, konfiguracia, meno, email, telefon, miesto, poznamka, produkt, created_at, ${cenaStlpce}
			 FROM dopyt WHERE id = ?`
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

/** Zdroj pre payload leadu — kontakt + kanonická konfigurácia (JSON) + Odoo stav (v26) +
 *  objednávkové stĺpce (#319/v33 — lead sa vetví: `je_objednavka=1` → opportunity + fakturačný blok). */
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
	// #319/v33 — objednávka: NULL/0 = dopyt, 1 = záväzná objednávka. Fakturačné údaje sa doplnia
	// do popisu leadu (BEZ ceny — Money-neutralita payloadu ostáva).
	je_objednavka: number | null;
	fakt_meno: string | null;
	fakt_adresa: string | null;
	fakt_ico: string | null;
	fakt_dic: string | null;
	// #384/v35 — produktový rad (kód katalógu); NULL = starý pergolový dopyt. Názov leadu je podľa
	// neho produkt-aware („Bazénové zastrešenie – dopyt: …" vs „Pergola – dopyt: …").
	produkt: string | null;
}

const leadSelectCols =
	'id, konfiguracia, meno, email, telefon, miesto, poznamka, created_at, odoo_lead_id, odoo_attempts, odoo_last_error, je_objednavka, fakt_meno, fakt_adresa, fakt_ico, fakt_dic, produkt';

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

// --- Interný prehľad dopytov (#282) — additívne k #277 store; stále len `./db`, nič z Money. ---

/** Riadok zoznamu — `DopytRiadok` + voliteľný `odoo_lead_id` (#278 ho pridá v migrácii v26).
 *  Kľúč je prítomný LEN keď tabuľka stĺpec reálne má (feature-detect nižšie) — obranná
 *  príprava miesta pre Odoo lead bez závislosti na #278 schéme. */
export interface DopytListRiadok extends DopytRiadok {
	odoo_lead_id?: number | null;
	/** #319/v33 — 1 = záväzná objednávka, NULL/0 = dopyt. Kľúč prítomný len keď schéma stĺpec má. */
	je_objednavka?: number | null;
}

/** Má tabuľka `dopyt` stĺpec `odoo_lead_id`? (#278 ho pridá v migrácii v26.) Feature-detect
 *  cez `PRAGMA table_info` — zoznam sa tak správne vykreslí nezávisle od toho, či #278 landol.
 *  Detekcia na SCHÉME (nie na kľúčoch dát), takže funguje aj pri prázdnom zozname. */
export function hasOdooLeadColumn(): boolean {
	const cols = db.prepare('PRAGMA table_info(dopyt)').all() as { name: string }[];
	return cols.some((c) => c.name === 'odoo_lead_id');
}

/** Má tabuľka `dopyt` stĺpec `je_objednavka`? (#319 ho pridá v migrácii v33.) Feature-detect na
 *  SCHÉME — interný zoznam tak vie odlíšiť objednávku od dopytu nezávisle od toho, či #319 landol. */
export function hasObjednavkaColumn(): boolean {
	const cols = db.prepare('PRAGMA table_info(dopyt)').all() as { name: string }[];
	return cols.some((c) => c.name === 'je_objednavka');
}

/** Má tabuľka `dopyt` stĺpec `produkt`? (#384 ho pridá v migrácii v35.) Feature-detect na SCHÉME —
 *  interný zoznam tak vie zobraziť produktový rad nezávisle od toho, či #384 landol. */
export function hasProduktColumn(): boolean {
	const cols = db.prepare('PRAGMA table_info(dopyt)').all() as { name: string }[];
	return cols.some((c) => c.name === 'produkt');
}

/** Stránka dopytov, NAJNOVŠIE HORE (`id DESC` = monotónne, bez `created_at` remíz). `offset`/
 *  `limit` sa clampujú (obrana proti nezmyselnému vstupu z query). Ak schéma má `odoo_lead_id`
 *  (#278/v26), SELECT ho zahrnie a riadok ho nesie; inak kľúč chýba (defenzívne). `hasOdoo`
 *  default = detekcia; volajúci (load), čo flag už zistil, ho podá, aby sa `PRAGMA` nebehala 2×. */
export function listDopyty(
	offset: number,
	limit: number,
	hasOdoo: boolean = hasOdooLeadColumn(),
	hasObj: boolean = hasObjednavkaColumn(),
	hasProd: boolean = hasProduktColumn()
): DopytListRiadok[] {
	const off = Math.max(0, Math.trunc(offset));
	const lim = Math.max(1, Math.trunc(limit));
	// #309: cenové stĺpce (v30) sú vždy súčasťou zoznamu (opečiatkovaná cena v admin prehľade);
	// `odoo_lead_id` (v26), `je_objednavka` (#319/v33) a `produkt` (#384/v35) sa pridajú len keď
	// schéma stĺpec má (feature-detect, defenzívne — nezávisle od toho, ktorá migrácia už landla).
	let cols = `id, konfiguracia, meno, email, telefon, miesto, poznamka, created_at, ${cenaStlpce}`;
	if (hasOdoo) cols += ', odoo_lead_id';
	if (hasObj) cols += ', je_objednavka';
	if (hasProd) cols += ', produkt';
	return db
		.prepare(`SELECT ${cols} FROM dopyt ORDER BY id DESC LIMIT ? OFFSET ?`)
		.all(lim, off) as DopytListRiadok[];
}
