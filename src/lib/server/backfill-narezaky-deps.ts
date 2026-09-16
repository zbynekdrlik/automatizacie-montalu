// #524: reálne závislosti backfillu (`BackfillDeps`) — DB READ (`odpis_log` SELECT +
// `odpis_polozky`) + Odoo READ/UPLOAD cez `callJson2`. Oddelené od čistého jadra
// (`backfill-narezaky.ts`), aby jadro ostalo testovateľné bez native DB / bez PROD Odoo.
//
// Money-NEUTRÁLNE: SELECT je READ-ONLY (`odpis_log`/`odpis_polozky`); jediný zápis je Odoo
// `montalu_narezak_upload` (`lines`), rovnaká cesta ako #522. Žiadny `writeOdpis`, žiadny DB zápis.
import { timingSafeEqual } from 'node:crypto';
import { db } from './db';
import { listOdpisPolozky, normOp } from './money';
import { callJson2, uploadNarezak, type OdooJson2Config } from './odoo-json2';
import type { RozpisLine } from './odoo-rozpis-lines';
import type { CutPlan } from './narezak-cut-plan';
import type { Cfg } from './compute';
import type { OdpisBackfillRow, BackfillDeps } from './backfill-narezaky';

/**
 * Autorizácia backfill endpointu bez session (CLI wrapper): timing-safe zhoda s
 * `BACKFILL_TOKEN`. VYPNUTÉ (false) keď env chýba — bezpečný default: endpoint bez tokenu
 * (a bez internej session) nič nespustí. Internú admin session gate-uje endpoint samostatne.
 */
export function backfillTokenValid(provided: string | null | undefined): boolean {
	const expected = process.env.BACKFILL_TOKEN;
	if (!expected || !provided) return false;
	const a = Buffer.from(provided);
	const b = Buffer.from(expected);
	return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * READ-ONLY SELECT `odpis_log` pre backfill: `live=1`, `created_at >= now − daysBack dní`
 * (UTC, rovnako ako `datetime('now')` zápis). Vracia surové riadky vrátane `content_hash` a
 * `detail` (JSON string) — `listOdpisy` `content_hash` nevracia. `daysBack` je clampnutý.
 */
export function listOdpisyForBackfill(daysBack: number): OdpisBackfillRow[] {
	const d = Math.max(1, Math.min(3650, Math.floor(daysBack)));
	return db
		.prepare(
			`SELECT id, modul, zak, op, zakaznik, live, content_hash, detail, created_at
			 FROM odpis_log
			 WHERE live = 1 AND created_at >= datetime('now', ?)
			 ORDER BY id`
		)
		.all(`-${d} days`) as OdpisBackfillRow[];
}

/**
 * Postaví reálne `BackfillDeps` s Odoo READ/UPLOAD cez `callJson2` (/json/2, bearer). `orderExists`
 * / `orderHasLines` sú READ-ONLY (`search_read`), `uploadLines` posiela `lines` cez to isté
 * `montalu_narezak_upload` volanie ako #522. `op` prichádza už normalizovaný (`runBackfill` grupuje
 * cez `normOp`); `normOp` znova je idempotentné.
 *
 * #524 R2: `orderExists`/`orderHasLines` HODIA `OdooJson2Error` pri 403/AccessError (uid 524 je len
 * v narezak-upload skupine, nemá read na `sale.order`). Tu sa to úmyselne NECHYTÁ — `runBackfill`
 * throw toleruje (existencia NEZNÁMA, nie chyba; endpoint rozhodne pri uploade). Read grant na
 * `sale.order` (+ `montalu.rozpis.line`) je vyžiadaný paralelne v odoo-erp #6949.
 */
export function makeOdooBackfillDeps(
	cfg: Cfg,
	odooCfg: OdooJson2Config,
	log: BackfillDeps['log']
): BackfillDeps {
	const arrLen = (res: unknown): number => (Array.isArray(res) ? res.length : 0);
	return {
		cfg,
		loadPolozky: (id) => listOdpisPolozky(id),
		orderExists: async (op) => {
			const res = await callJson2(odooCfg, 'sale.order', 'search_read', {
				domain: [['name', '=', normOp(op)]],
				fields: ['id'],
				limit: 1
			});
			return arrLen(res) > 0;
		},
		orderHasLines: async (op) => {
			const res = await callJson2(odooCfg, 'montalu.rozpis.line', 'search_read', {
				domain: [['order_id.name', '=', normOp(op)]],
				fields: ['id'],
				limit: 1
			});
			return arrLen(res) > 0;
		},
		uploadLines: async (
			op: string,
			docId: string,
			lines: RozpisLine[],
			pdfBase64?: string,
			filename?: string,
			cutPlan?: CutPlan
		) => {
			// #532 R2: cez `uploadNarezak` — reaktívny cut_plan 422 fallback (PROD Odoo bez #7431
			// odmieta neznámy kľúč `cut_plan`) + kill switch `ODOO_NAREZ_CUT_PLAN`. Vráť `cutPlanRejected`,
			// aby `runBackfill` vedel odlíšiť „cut_plan odmietnutý (422)" od chyby / no-order.
			const res = await uploadNarezak(odooCfg, {
				order_number: normOp(op),
				doc_id: docId,
				kind: 'narezak',
				// #529: pripni GRAFICKÝ nárezák PDF keď sa vygeneroval (endpoint PDF nevyžaduje —
				// `has_pdf` je voliteľné pri `lines`, #6517). Idempotentne verziuje cez doc_id.
				...(pdfBase64 ? { pdf_base64: pdfBase64, filename } : {}),
				// #532: `cut_plan` (kontrakt #7431) — plán tyčí (bars/pieces/uhly/render_svg). Ide keď
				// nárezák má tyče s Money kódom; `uploadNarezak` ho na PROD 422 sám odstráni (lines+PDF ostanú).
				...(cutPlan ? { cut_plan: cutPlan } : {}),
				lines
			});
			return { cutPlanRejected: res.cutPlanRejected };
		},
		log
	};
}
