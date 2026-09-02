// #5825: DURABLE APPEND-ONLY log pushov odpisu do Odoo modelu `montalu.material.odpis`
// (`/json/2 create_from_app`, epic #5808 „aj-aj" cutover). Tabuľka `odoo_odpis_push` (migrácia v36).
//
// NA ROZDIEL od `odoo-zakazka-store.ts` (upsert per (zak,op), re-derivuje telo) je toto APPEND-ONLY
// log so SNAPSHOTOM payloadu: každý import/release/reimport toho istého odpisu = NOVÝ riadok
// (`id AUTOINCREMENT`), replay STRIKTNE v poradí `id` per hash. Dôvod: `povolitReimport` robí
// import→release→import legitímnym; upsert+re-arm by APP-SIDE zbalil históriu a rozišiel Odoo stav s
// Money (Fable dizajn-konzult #5825). POZNÁMKA (#5825 review 🟡): append-only drží APP-SIDE poradie
// akcií správne, ale CELKOVÁ zhoda (Odoo=Money po reimporte) navyše závisí od modelu #5817 — ten je
// MONOTÓNNY (`released` sa už nevracia na `imported`; `import` na `released` zázname vráti
// `created=false` bez zmeny), takže po `povolitReimport` + re-send by Odoo ostal „Uvoľnené", kým
// Money re-importoval → flagnuté na #5817 (import na released má re-aktivovať / partial UNIQUE
// `WHERE state != 'released'`). Odpis sa NIKDY nezahodí — žiaden poison-pill drop, žiaden časový
// strop; retry cez `next_attempt_at` (exponenciálny backoff), `pending=0` len pri úspechu alebo
// PAYLOAD-permanentnej chybe (riadok ostáva pre audit + surface na `/odpisy`).
//
// MONEY-NEUTRÁLNE: importuje LEN `db` (SQLite singleton), žiadna odpisová/`/data`/`MONEY_LIVE` cesta.
import { db } from './db';

export type OdpisPushAction = 'import' | 'release';

/** Riadok pending pushu pre retry sweep. `payload` je uložený JSON create_from_app body. */
export interface OdpisPushRow {
	id: number;
	content_hash: string;
	action: OdpisPushAction;
	payload: string;
	attempts: number;
}

const insertStmt = db.prepare(`
	INSERT INTO odoo_odpis_push (content_hash, action, payload, payload_version, pending, attempts)
	VALUES (@content_hash, @action, @payload, @payload_version, 1, 0)
`);

/**
 * Zapíše NOVÝ pending riadok (append-only) a vráti jeho `id`. SYNCHRÓNNE — durable riadok existuje v
 * momente keď `writeOdpis`/release vráti (sieťový push je až potom, fire-and-forget). `payload` =
 * serializovateľný create_from_app body.
 */
export function enqueueOdpisPush(
	contentHash: string,
	action: OdpisPushAction,
	payload: Record<string, unknown>,
	payloadVersion = 1
): number {
	const info = insertStmt.run({
		content_hash: contentHash,
		action,
		payload: JSON.stringify(payload),
		payload_version: payloadVersion
	});
	return Number(info.lastInsertRowid);
}

const postedStmt = db.prepare(`
	UPDATE odoo_odpis_push
	SET pending = 0, odoo_id = @odoo_id, sale_order_id = @sale_order_id,
		posted_at = datetime('now'), last_error = '', next_attempt_at = NULL, updated_at = datetime('now')
	WHERE id = @id
`);
export function markOdpisPushPosted(
	id: number,
	odooId: number | null,
	saleOrderId: number | null
): void {
	postedStmt.run({ id, odoo_id: odooId, sale_order_id: saleOrderId });
}

// TRANSIENT chyba (sieť/5xx/timeout/401-403/model-not-found): ostáva pending, attempts++, backoff.
// `offsetModifier` = SQLite datetime modifikátor (napr. '+30 seconds') — `next_attempt_at` sa počíta
// cez `datetime('now', @offset)`, aby bol formát ZHODNÝ s porovnaním `<= datetime('now')` v sweepe.
const failedStmt = db.prepare(`
	UPDATE odoo_odpis_push
	SET pending = 1, attempts = attempts + 1, last_error = @err,
		next_attempt_at = datetime('now', @offset), updated_at = datetime('now')
	WHERE id = @id
`);
export function markOdpisPushFailed(id: number, err: string, offsetModifier: string): void {
	failedStmt.run({ id, err: err.slice(0, 1000), offset: offsetModifier });
}

// PAYLOAD-PERMANENT chyba (Odoo ValidationError/UserError/TypeError na payloade): retry by vždy zlyhal
// → pending=0 (prestaň skúšať), ale riadok OSTÁVA (nie posted) pre audit + surface na `/odpisy`.
const permanentStmt = db.prepare(`
	UPDATE odoo_odpis_push
	SET pending = 0, attempts = attempts + 1, last_error = @err, next_attempt_at = NULL,
		updated_at = datetime('now')
	WHERE id = @id
`);
export function markOdpisPushPermanent(id: number, err: string): void {
	permanentStmt.run({ id, err: err.slice(0, 1000) });
}

// Pending riadky splatné TERAZ (next_attempt_at NULL alebo v minulosti), v poradí `id` ASC (global id
// poradie zachováva aj per-hash poradie). Sweep ich spracúva per-hash FIFO + stop-on-first-failure.
const pendingDueStmt = db.prepare(`
	SELECT id, content_hash, action, payload, attempts FROM odoo_odpis_push
	WHERE pending = 1 AND (next_attempt_at IS NULL OR next_attempt_at <= datetime('now'))
	ORDER BY id ASC LIMIT ?
`);
export function pendingDueOdpisPushes(limit: number): OdpisPushRow[] {
	return pendingDueStmt.all(limit) as OdpisPushRow[];
}

// Je pending riadkov (bez ohľadu na next_attempt_at) aspoň jeden? Timer sweep beží len keď áno.
const anyPendingStmt = db.prepare('SELECT 1 FROM odoo_odpis_push WHERE pending = 1 LIMIT 1');
export function anyOdpisPushPending(): boolean {
	return anyPendingStmt.get() !== undefined;
}

// Je KONKRÉTNY riadok stále pending? Sweep to re-checkne v serializovanom tasku (živý push ho mohol
// medzitým posted-núť) — rovnaký vzor ako `isPendingZakazkaPush`.
const isPendingStmt = db.prepare('SELECT pending FROM odoo_odpis_push WHERE id = ?');
export function isOdpisPushPending(id: number): boolean {
	const r = isPendingStmt.get(id) as { pending: number } | undefined;
	return r?.pending === 1;
}

// Existuje SKORŠÍ (menšie id) PENDING riadok toho istého content_hash? Sweep NESMIE spracovať riadok,
// kým jeho skorší súrodenec nie je hotový — inak by release predbehol ešte-pending import (aj naprieč
// sweepmi: import v backoffe NIE JE v pendingDue, ale release s NULL next_attempt_at áno). Bez tejto
// kontroly by arrival sweep počas import-backoffu poslal release skôr → Odoo stub → stratené polozky.
const earlierPendingStmt = db.prepare(
	'SELECT 1 FROM odoo_odpis_push WHERE content_hash = ? AND pending = 1 AND id < ? LIMIT 1'
);
export function hasEarlierPendingOdpisPush(id: number, contentHash: string): boolean {
	return earlierPendingStmt.get(contentHash, id) !== undefined;
}

/** Backlog počty pre `/odpisy` indikátor: `pending` = čaká na (re)push, `failed` = payload-permanent. */
const backlogStmt = db.prepare(`
	SELECT
		SUM(CASE WHEN pending = 1 THEN 1 ELSE 0 END) AS pending,
		SUM(CASE WHEN pending = 0 AND posted_at IS NULL THEN 1 ELSE 0 END) AS failed
	FROM odoo_odpis_push
`);
export function odpisBacklogCounts(): { pending: number; failed: number } {
	const r = backlogStmt.get() as { pending: number | null; failed: number | null };
	return { pending: r.pending ?? 0, failed: r.failed ?? 0 };
}

// #5825 review 🟡: operátorský re-arm PAYLOAD-permanentných zlyhaní (pending=0, neposlané) — po
// oprave/nasadení modelu ich operátor z `/odpisy` znova zaradí do fronty (pending=1, splatné hneď).
const rearmStmt = db.prepare(`
	UPDATE odoo_odpis_push
	SET pending = 1, next_attempt_at = NULL, last_error = '', updated_at = datetime('now')
	WHERE pending = 0 AND posted_at IS NULL
`);
export function rearmFailedOdpisPushes(): number {
	return rearmStmt.run().changes;
}
