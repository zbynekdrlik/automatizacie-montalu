// #521: objednávka skla → Odoo `montalu_narezak_upload` s `glass_order` (kind='sklo').
// Odoo z payloadu (spec kľúče) AUTOMATICKY spočíta nákupnú cenu skla podľa cenníka IZOS (odoo #7371).
//
// Money-NEUTRÁLNE: objednávka u DODÁVATEĽA skla — žiadny `writeOdpis`, žiadny `money.ts` import okrem
// `normOp`/`normZak` (čisté string helpery), žiadny Money kód/cena, žiadne kontraktové vektory.
//
// Rovnaká transportná cesta ako plán rezov (#511/#522): /json/2 + bearer (`odoo-json2.ts`),
// `sale.order.montalu_narezak_upload`, xmlid-idempotentný `doc_id` (opätovné odoslanie prepíše).
// Gated `isNarezUploadEnabled()` + config — keď je vypnuté (dev/test), NEVOLÁ Odoo a len vráti
// postavený payload (náhľad). Nikdy nehádže — vracia výsledok + payload.
import { logger } from './log';
import { callJson2, odooJson2Config, isNarezUploadEnabled } from './odoo-json2';
import { normOp, normZak } from './money';
import { zakazkaOp } from './zakazka-ceny';
import { listSklaPreZakazku, opPodkladu } from './objednavka-skla';
import { buildGlassOrder, type GlassOrder } from './odoo-rozpis-lines';

const log = logger('glass-order-upload');

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export type GlassOrderUploadResult =
	'uploaded' | 'disabled' | 'no-items' | 'no-zak' | 'missing' | 'failed';

export interface GlassOrderUploadOutcome {
	result: GlassOrderUploadResult;
	/** postavený payload (aj keď sa neodoslal) — pre náhľad na podklade. `null` keď niet položiek. */
	payload: GlassOrder | null;
	error?: string;
}

/**
 * Stabilný `doc_id` objednávky skla zákazky: `glass-order-<zakSlug>-<opSlug>` (xmlid-idempotentný,
 * opätovné odoslanie prepíše). Slug: normalizuj (upper+strip), lowercase, len [a-z0-9], per časť
 * max 12 znakov; celok orezaný na 40 (Odoo doc_id limit, regex `[a-z0-9_-]{1,40}`).
 */
export function buildGlassOrderDocId(zak: string, op: string): string {
	const slug = (s: string, norm: (x: string) => string) =>
		norm(s)
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '')
			.slice(0, 12) || 'x';
	const z = slug(zak, normZak);
	const o = slug(op, normOp);
	return `glass-order-${z}-${o}`.slice(0, 40);
}

/** Postaví `glass_order` payload zákazky z uložených sklových položiek (Money-neutrálne, žiadny IO okrem SQLite read). */
export function buildGlassOrderForZak(zak: string): GlassOrder | null {
	const polozky = listSklaPreZakazku(zak);
	if (polozky.length === 0) return null;
	return buildGlassOrder(polozky);
}

/**
 * Postaví payload objednávky skla a (keď je upload zapnutý + je config) ho odošle do Odoo cez
 * `montalu_narezak_upload`. VŽDY vráti postavený `payload` (pre náhľad na podklade), aj keď je
 * upload vypnutý alebo zlyhal. NIKDY nehádže.
 */
export async function uploadGlassOrderToOdoo(
	zak: string,
	opOverride?: string
): Promise<GlassOrderUploadOutcome> {
	const trimmed = (zak ?? '').trim();
	if (!trimmed) return { result: 'no-zak', payload: null };

	const payload = buildGlassOrderForZak(trimmed);
	if (!payload) return { result: 'no-items', payload: null };

	if (!isNarezUploadEnabled()) return { result: 'disabled', payload };
	const cfg = odooJson2Config();
	if (!cfg) return { result: 'disabled', payload };

	try {
		// OP precedencia (#540 + #545): opOverride ?? OP z odpisu ?? OP z podkladu.
		//  1) opOverride — auto-send z plán-rezov uloženia (#540) posiela op TEJ ISTEJ zákazky priamo
		//     (glass_order ide na tú istú OP ako nárezák).
		//  2) OP z NAJNOVŠIEHO odpisu, live-first (`zakazkaOp`) — aby posledný TEST odpis (live=0)
		//     nesmeroval objednávku skla na testovacie OP.
		//  3) OP z podkladu (#545) — servisná objednávka bez odpisu, OP zadané ručne (`nastavOp`).
		//     Rozdielne OP na riadkoch (mixed) → missing s hláškou (operátor nastaví jedno OP).
		let op = (opOverride ?? '').trim() || zakazkaOp(trimmed);
		if (!op) {
			const pod = opPodkladu(trimmed);
			if (pod === null) {
				log.info('glass-order upload: riadky podkladu majú rôzne OP', { zak: trimmed });
				return {
					result: 'missing',
					payload,
					error: 'Riadky podkladu majú rôzne OP — nastavte jedno OP objednávky.'
				};
			}
			op = pod;
		}
		if (!op) {
			log.info('glass-order upload: zákazka nemá odpis/OP — nič neposielam', { zak: trimmed });
			return { result: 'missing', payload };
		}

		const orderNumber = normOp(op);
		const docId = buildGlassOrderDocId(trimmed, op);
		const uploadResult = await callJson2(cfg, 'sale.order', 'montalu_narezak_upload', {
			order_number: orderNumber,
			doc_id: docId,
			kind: 'sklo',
			glass_order: payload
		});
		log.info('glass-order upload: úspešne nahraný', {
			zak: trimmed,
			op,
			orderNumber,
			docId,
			items: payload.items.length,
			result: uploadResult
		});
		return { result: 'uploaded', payload };
	} catch (e) {
		const msg = errMsg(e);
		log.error('glass-order upload zlyhal', { zak: trimmed, err: msg });
		return { result: 'failed', payload, error: msg };
	}
}
