// #511: upload SKUTOČNÉHO plánu rezov na kiosk „VÝROBA / Rezanie" po ULOŽENÍ plánu (#505).
// Nahrádza starý odpis→rozpis narezak upload (`odoo-narezak-upload.ts`, zmazaný): rezač na kiosku
// má vidieť plán rezov, NIE interné ceny. Interná mt_note s rozpisom+cenami (#340/#418) beží ďalej.
//
// Fire-and-forget — zlyhanie NIKDY neblokuje uloženie plánu. Transport: /json/2 + bearer (odoo-json2.ts),
// `sale.order.montalu_narezak_upload`, kind='narezak', xmlid-idempotentný doc_id (opätovné uloženie
// prepíše prílohu, nezduplikuje). BEZ durable-retry — rovnako ako pôvodná narezak cesta bola čistý
// fire-and-forget; zlyhaný upload sa zotaví ďalším uložením plánu.
//
// OP + zákazníka odvodzujem z odpisu zákazky (`zakazkaPrehlad(zak)` → `odpisy[0].op` / `zakaznik`) —
// rovnaký vzor ako interná note. Uložený plán drží len `zak`; `sale.order` sa matchuje cez
// `sale.order.name === normOp(op)`. Ak zákazka nemá odpis (alebo `zak` prázdny) → skip (plán nie je
// viazaný na objednávku).
import { logger } from './log';
import { callJson2, odooJson2Config, isNarezUploadEnabled } from './odoo-json2';
import { normOp, normZak } from './money';
import { zakazkaPrehlad } from './zakazka-ceny';
import { parsePlanRezov } from './plan-rezov-vstup';
import { spocitajPlanRezov } from './plan-rezov';
import {
	generatePlanRezovPdfBase64,
	planRezovPdfFilename,
	type PlanRezovPdfHeader
} from './plan-rezov-pdf';

const log = logger('plan-rezov-upload');

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface PlanRezovUploadInput {
	/** číslo zákazky z uloženého plánu (voľné pole „Zákazka (voliteľné)") — môže byť prázdne. */
	zak: string;
	cadText: string;
	dlzkaTyce: number;
	reznaMedzera: number;
	/** názov uloženého plánu (#505) — do hlavičky PDF, aby rezač rozlíšil viac plánov tej istej
	 *  zákazky (re-save prepíše ten istý doc_id, takže názov je jediný odlišovač v prílohe). */
	nazov?: string;
	/** injektovateľný čas (testy / zhoda pečiatky s uložením). */
	now?: Date;
}

export type PlanRezovUploadResult =
	'uploaded' | 'disabled' | 'no-zak' | 'missing' | 'no-pdf' | 'failed';

export interface PlanRezovUploadOutcome {
	result: PlanRezovUploadResult;
	error?: string;
}

/**
 * Stabilný doc_id pre plán rezov zákazky: `plan-rezov-<zakSlug>-<opSlug>` (xmlid-idempotentný,
 * opätovné uloženie prepíše). Slug: normalizuj (upper+strip), lowercase, len [a-z0-9], per časť
 * max 12 znakov; celok orezaný na 40 (Odoo doc_id limit, regex `[a-z0-9_-]{1,40}`).
 */
export function buildPlanRezovDocId(zak: string, op: string): string {
	const slug = (s: string) =>
		normZak(s)
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '')
			.slice(0, 12) || 'x';
	const z = slug(zak);
	const o =
		normOp(op)
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '')
			.slice(0, 12) || 'x';
	return `plan-rezov-${z}-${o}`.slice(0, 40);
}

/**
 * Nahrá PDF plánu rezov zákazky na kiosk cez montalu_narezak_upload. Fire-and-forget — NIKDY
 * nehádže. Vracia výsledok operácie.
 */
export async function uploadPlanRezovToOdoo(
	input: PlanRezovUploadInput
): Promise<PlanRezovUploadOutcome> {
	if (!isNarezUploadEnabled()) {
		log.debug('plan-rezov upload vypnutý (ODOO_NAREZ_UPLOAD_ENABLED !== 1)', { zak: input.zak });
		return { result: 'disabled' };
	}
	const cfg = odooJson2Config();
	if (!cfg) {
		log.debug('plan-rezov upload vypnutý (chýba ODOO_JSON2_URL / ODOO_JSON2_API_KEY)', {
			zak: input.zak
		});
		return { result: 'disabled' };
	}

	const zak = (input.zak ?? '').trim();
	if (!zak) {
		log.debug('plan-rezov upload: plán bez zákazky — nič neposielam (nie je na čo pripnúť)');
		return { result: 'no-zak' };
	}

	try {
		const prehlad = zakazkaPrehlad(zak);
		if (!prehlad) {
			log.info('plan-rezov upload: zákazka nemá žiadny odpis — nič neposielam', { zak });
			return { result: 'missing' };
		}
		// OP z NAJNOVŠIEHO ODPISU — preferuj LIVE (rovnaká live-first logika ako `zakazkaPrehlad.scope`),
		// aby posledný TEST odpis (`live=0`) nesmeroval kioskovú prílohu na testovacie OP.
		const op = (prehlad.odpisy.find((o) => o.live === 1) ?? prehlad.odpisy[0])?.op ?? '';
		if (!op) {
			log.info('plan-rezov upload: zákazka nemá OP na najnovšom odpise — nič neposielam', { zak });
			return { result: 'missing' };
		}

		const now = input.now ?? new Date();

		// rekomputuj plán z uložených vstupov — ROVNAKÝ zdroj pravdy ako /plan-rezov/[id]
		const { riadky, preskocene } = parsePlanRezov(input.cadText);
		const vysledok = spocitajPlanRezov(
			{ dlzkaTyce: input.dlzkaTyce, reznaMedzera: input.reznaMedzera, riadky },
			preskocene
		);

		const header: PlanRezovPdfHeader = {
			zak: prehlad.zak || zak,
			op,
			zakaznik: prehlad.zakaznik,
			nazov: input.nazov
		};

		let pdfBase64: string;
		try {
			pdfBase64 = await generatePlanRezovPdfBase64(header, vysledok, now);
		} catch (e) {
			log.warn('plan-rezov upload: generovanie PDF zlyhalo', { zak, op, err: errMsg(e) });
			return { result: 'no-pdf', error: errMsg(e) };
		}

		const orderNumber = normOp(op);
		const docId = buildPlanRezovDocId(zak, op);
		const filename = planRezovPdfFilename(zak, now);

		const uploadResult = await callJson2(cfg, 'sale.order', 'montalu_narezak_upload', {
			order_number: orderNumber,
			doc_id: docId,
			kind: 'narezak',
			filename,
			pdf_base64: pdfBase64
		});

		log.info('plan-rezov upload: úspešne nahraný', {
			zak,
			op,
			orderNumber,
			docId,
			result: uploadResult
		});
		return { result: 'uploaded' };
	} catch (e) {
		const msg = errMsg(e);
		log.error('plan-rezov upload zlyhal', { zak: input.zak, err: msg });
		return { result: 'failed', error: msg };
	}
}

/**
 * FIRE-AND-FORGET vstupný bod — volá `/plan-rezov` `ulozit` akcia po `ulozPlan`. Celá práca
 * (SQLite read `zakazkaPrehlad`, `parsePlanRezov`, FFD `spocitajPlanRezov`, generovanie PDF, upload)
 * sa odloží cez `setImmediate` MIMO request tick — takže odpoveď na uloženie plánu sa NIKDY nezdrží
 * ani synchrónnou časťou pred prvým `await`. NIKDY nezhodí volajúceho (async chyby chytá `.catch`,
 * scheduling nehádže).
 */
export function queuePlanRezovUpload(input: PlanRezovUploadInput): void {
	setImmediate(() => {
		void uploadPlanRezovToOdoo(input).catch((e) =>
			log.error('plan-rezov upload queue: neočakávane hodil', { zak: input.zak, err: errMsg(e) })
		);
	});
}
