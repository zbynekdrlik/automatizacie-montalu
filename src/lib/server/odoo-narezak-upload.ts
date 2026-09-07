// #6385 noha 2: upload nárezového PDF na zákazku do Odoo cez montalu_narezak_upload.
//
// Fire-and-forget — zlyhanie NIKDY neblokuje odpis/save. PDF sa generuje z existujúcich
// generátorov (zakazka-pdf.ts pre rozpis materiálu). Odoo endpoint upsertuje prílohu
// (xmlid-idempotentný — opakovaný upload rovnakého doc_id prepíše, nie zduplikuje).
//
// Transport: /json/2 + bearer (odoo-json2.ts), NIE legacy XML-RPC.
// Zákazku matchuje cez sale.order.name === normOp(op) (rovnaký vzor ako odoo-zakazka.ts).
import { logger } from './log';
import { callJson2, odooJson2Config, isNarezUploadEnabled } from './odoo-json2';
import { generateZakazkaPdfBase64, zakazkaPdfFilename } from './zakazka-pdf';
import { normOp } from './money';
import { zakazkaPrehlad } from './zakazka-ceny';
import { enrichPolozky } from './ceny';
import { buildZakazkaNote } from './odoo-zakazka';

const log = logger('narezak-upload');

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export type NarezakUploadResult = 'uploaded' | 'disabled' | 'missing' | 'no-pdf' | 'failed';

export interface NarezakUploadOutcome {
	result: NarezakUploadResult;
	error?: string;
}

/**
 * Nahrá rozpis materiálu zákazky ako nárezák PDF do Odoo cez montalu_narezak_upload.
 * Fire-and-forget — NIKDY nehádže. Vracia výsledok operácie.
 *
 * `doc_id` je stabilný identifikátor: `rozpis-<normZak>` (jeden rozpis per zákazka,
 * opakovaný upload ho aktualizuje, nikdy nezduplikuje).
 */
export async function uploadNarezakToOdoo(
	zak: string,
	op: string
): Promise<NarezakUploadOutcome> {
	if (!isNarezUploadEnabled()) {
		log.debug('narezak upload vypnutý (ODOO_NAREZ_UPLOAD_ENABLED !== 1)', { zak, op });
		return { result: 'disabled' };
	}
	const cfg = odooJson2Config();
	if (!cfg) {
		log.debug('narezak upload vypnutý (chýba ODOO_JSON2_URL / ODOO_JSON2_API_KEY)', { zak, op });
		return { result: 'disabled' };
	}
	try {
		const prehlad = zakazkaPrehlad(zak);
		if (!prehlad) {
			log.info('narezak upload: zákazka nemá žiadny odpis — nič neposielam', { zak });
			return { result: 'missing' };
		}

		const ceny = prehlad.polozky.length > 0 ? enrichPolozky(prehlad.polozky) : null;
		const now = new Date();
		const note = buildZakazkaNote(prehlad, op, ceny);

		// Generuj PDF rozpisu materiálu
		let pdfBase64: string;
		try {
			pdfBase64 = await generateZakazkaPdfBase64(note, now);
		} catch (e) {
			log.warn('narezak upload: generovanie PDF zlyhalo', { zak, op, err: errMsg(e) });
			return { result: 'no-pdf', error: errMsg(e) };
		}

		const orderNumber = normOp(op);
		const docId = buildDocId(zak);
		const filename = zakazkaPdfFilename(note, now);

		const uploadResult = await callJson2(cfg, 'sale.order', 'montalu_narezak_upload', {
			order_number: orderNumber,
			doc_id: docId,
			kind: 'narezak',
			filename: filename,
			pdf_base64: pdfBase64
		});

		log.info('narezak upload: úspešne nahraný', {
			zak,
			op,
			orderNumber,
			docId,
			result: uploadResult
		});

		return { result: 'uploaded' };
	} catch (e) {
		const msg = errMsg(e);
		log.error('narezak upload zlyhal', { zak, op, err: msg });
		return { result: 'failed', error: msg };
	}
}

/**
 * Stabilný doc_id pre rozpis materiálu zákazky: `rozpis-<slug>`.
 * Slug: lowercase, non-alphanum → `_`, max 35 znakov (doc_id limit 40 - prefix 7 = 33).
 */
export function buildDocId(zak: string): string {
	const slug = zak
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_|_$/g, '')
		.slice(0, 33);
	return `rozpis-${slug || 'x'}`;
}

/**
 * Fire-and-forget vstupný bod — registruje sa v hooks.server.ts vedľa
 * existujúceho queueZakazkaPush. NIKDY neblokuje, NIKDY nehádže.
 */
export function queueNarezakUpload(zak: string, op: string): void {
	try {
		void uploadNarezakToOdoo(zak, op).catch((e) =>
			log.error('narezak upload queue: neočakávane hodil', { zak, op, err: errMsg(e) })
		);
	} catch (e) {
		log.error('narezak upload queue: synchrónne hodil', { zak, op, err: errMsg(e) });
	}
}
