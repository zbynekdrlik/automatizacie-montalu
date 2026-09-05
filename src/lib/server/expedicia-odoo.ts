// #419 extended scope: push expedičného PDF zoznamu do Odoo sale.order log-note.
// Vzor: `odoo-zakazka.ts` (#340), ale JEDNODUCHŠÍ — bez durable retry (one-shot z
// button click). Poznámka je INTERNÁ (mt_note, partner_ids=[]) — zákazník ju NIKDY
// nevidí. PDF príloha na internej note dedí neúnikovú garanciu (#340).
//
// Money-NEUTRÁLNE: nepíše do `/data`, nemení dedup, nedotýka sa `MONEY_LIVE`. Z
// money.ts používa LEN čistý `normOp`. XML-RPC zdieľaný z `odoo-rpc.ts`.
import { logger } from './log';
import {
	authenticate,
	executeKw,
	createRecord,
	odooConfig,
	xmlEscape,
	type OdooConfig,
	type XmlRpcValue
} from './odoo-rpc';
import { generateExpediciaPdfBase64, expediciaPdfFilename } from './expedicia-pdf';
import { normOp } from './money';
import type { ExpedicnyZoznam } from '$lib/pergola-expedicia';

const log = logger('expedicia-odoo');

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export type ExpediciaOdooResult = 'posted' | 'no-order' | 'disabled' | 'failed';

export interface ExpediciaOdooOutcome {
	result: ExpediciaOdooResult;
	error?: string;
}

/**
 * Postne expedičný zoznam (PDF príloha + interná log-note) na sale.order objednávky
 * `ident.op`. One-shot — žiaden durable retry, volaný z button click. NIKDY nehádže.
 */
export async function pushExpediciaToOdoo(
	zoznam: ExpedicnyZoznam,
	ident: { zak: string; op: string; zakaznik: string }
): Promise<ExpediciaOdooOutcome> {
	const cfg = odooConfig();
	if (!cfg) {
		log.debug('expedicia push vypnuty (chyba ODOO_LEAD_* env)', {
			zak: ident.zak,
			op: ident.op
		});
		return { result: 'disabled' };
	}
	try {
		const uid = await authenticate(cfg);
		const name = normOp(ident.op);
		const ids = await findSaleOrderIds(cfg, uid, name);
		if (ids.length === 0) {
			log.info('expedicia push: sale.order sa nenasiel — preskakujem', {
				zak: ident.zak,
				op: ident.op,
				name
			});
			return { result: 'no-order' };
		}

		const now = new Date();
		const pdfBase64 = await generateExpediciaPdfBase64(zoznam, ident, now);
		const filename = expediciaPdfFilename(ident.zak, now);
		const htmlBody = buildNoteHtml(zoznam, ident, now);

		if (ids.length > 1) {
			log.warn('expedicia push: viac sale.order s rovnakym name — postnem na vsetky', {
				name,
				ids
			});
		}

		for (const orderId of ids) {
			// Vytvor prílohu
			let attIds: number[] = [];
			try {
				const attId = await createRecord(cfg, uid, 'ir.attachment', {
					name: filename,
					datas: pdfBase64,
					res_model: 'sale.order',
					res_id: orderId,
					mimetype: 'application/pdf',
					type: 'binary'
				});
				attIds = [attId];
			} catch (e) {
				log.warn('expedicia push: pripojenie PDF prilohy zlyhalo (note ide bez prilohy)', {
					zak: ident.zak,
					op: ident.op,
					saleOrderId: orderId,
					err: errMsg(e)
				});
			}
			// Postni internú log-note (s prílohou ak sa podarila, inak bez)
			try {
				const kwargs: Record<string, XmlRpcValue> = {
					body: htmlBody,
					subtype_xmlid: 'mail.mt_note',
					message_type: 'comment',
					partner_ids: []
				};
				if (attIds.length > 0) kwargs.attachment_ids = attIds;
				await executeKw(cfg, uid, 'sale.order', 'message_post', [[orderId]], kwargs);
			} catch (e) {
				// message_post zlyhal PO vytvorení prílohy → best-effort odviazanie osirelej
				// prílohy (vzor #418 review, odoo-zakazka.ts unlinkAttachments)
				if (attIds.length > 0) {
					try {
						await executeKw(cfg, uid, 'ir.attachment', 'unlink', [attIds]);
					} catch (unlinkErr) {
						log.warn('expedicia push: odviazanie osirelej prilohy zlyhalo', {
							zak: ident.zak,
							op: ident.op,
							attIds,
							err: errMsg(unlinkErr)
						});
					}
				}
				throw e; // prepadne do vonkajšieho catch → 'failed'
			}
			log.info('expedicia push: interna poznamka zapisana na sale.order', {
				zak: ident.zak,
				op: ident.op,
				name,
				saleOrderId: orderId
			});
		}

		return { result: 'posted' };
	} catch (e) {
		const msg = errMsg(e);
		log.error('expedicia push zlyhal', {
			zak: ident.zak,
			op: ident.op,
			err: msg
		});
		return { result: 'failed', error: msg };
	}
}

// ---- Interné helpery -------------------------------------------------------

/** Nájde sale.order id-čka podľa name === normOp(op). */
async function findSaleOrderIds(cfg: OdooConfig, uid: number, name: string): Promise<number[]> {
	const res = await executeKw(cfg, uid, 'sale.order', 'search', [[['name', '=', name]]], {
		limit: 10
	});
	return Array.isArray(res) ? res.filter((x): x is number => typeof x === 'number') : [];
}

/** HTML telo internej log-note. Dynamické hodnoty sú `xmlEscape`-nuté. */
function buildNoteHtml(
	zoznam: ExpedicnyZoznam,
	ident: { zak: string; op: string; zakaznik: string },
	now: Date
): string {
	const e = xmlEscape;
	const stav = now.toLocaleString('sk-SK', {
		timeZone: 'Europe/Bratislava'
	});
	const out: string[] = [];
	out.push('<div>');
	out.push('<p><strong>Expedičný zoznam</strong></p>');
	out.push(
		`<p>Zákazka: <strong>${e(ident.zak)}</strong> &middot; ` +
			`Objednávka: ${e(ident.op)} &middot; ` +
			`Zákazník: ${e(ident.zakaznik)}</p>`
	);
	out.push(`<p><em>Stav k ${e(stav)} &middot; ` + `zdroj: automatizácie Montalu.</em></p>`);
	out.push('<p>PDF expedičný zoznam je pripojený ako príloha.</p>');
	out.push('</div>');
	return out.join('');
}
