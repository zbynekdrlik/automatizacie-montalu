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
import {
	listSklaPreZakazku,
	opPodkladu,
	listSubory,
	getSuborData,
	type SkloPolozka
} from './objednavka-skla';
import { popisPozicie } from '../objednavka-skla-pozicia';
import { popisPolohyOtvoru } from '../sklo-otvory';
import {
	generateVykresOtvoruPdf,
	vykresOtvoruFilename,
	vykresOtvoruZPolozky
} from './sklo-otvor-pdf';
import {
	buildGlassOrder,
	mimetypeZNazvu,
	type GlassOrder,
	type GlassOrderItemInput,
	type GlassAttachment,
	type DroppedAttachment
} from './odoo-rozpis-lines';

const log = logger('glass-order-upload');

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export type GlassOrderUploadResult =
	'uploaded' | 'disabled' | 'no-items' | 'no-zak' | 'missing' | 'failed';

/** #548: rozparsovaná odpoveď Odoo intake (tolerantná — v1 intake ju nevracia). */
export interface GlassOrderOdooOutcome {
	glassOrderId?: number;
	name?: string;
	lines?: unknown[];
	dq?: unknown[];
}

export interface GlassOrderUploadOutcome {
	result: GlassOrderUploadResult;
	/** postavený payload (aj keď sa neodoslal) — pre náhľad na podklade. `null` keď niet položiek. */
	payload: GlassOrder | null;
	/** #548: prílohy zahodené stropom veľkosti (25 MB base64/objednávka). */
	droppedAttachments?: DroppedAttachment[];
	/** #548: odpoveď Odoo (`glass_order_id`, `name` OSK…, `lines`, `dq`) — chýba pri v1 intake / vypnutom uploade. */
	odoo?: GlassOrderOdooOutcome;
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

/**
 * #548: načíta prílohy jedného riadka (BLOB → base64), mimetype podľa prípony. LEN pre riadky, ktoré
 * majú súbory (bez súborov sa žiadny BLOB nenačíta). Money-neutrálne (len SQLite read).
 */
function nacitajPrilohy(polozkaId: number): GlassAttachment[] {
	const subory = listSubory(polozkaId);
	if (subory.length === 0) return [];
	const out: GlassAttachment[] = [];
	for (const f of subory) {
		const data = getSuborData(f.id);
		if (!data) continue;
		out.push({
			name: f.nazov,
			mimetype: mimetypeZNazvu(f.nazov),
			data_base64: data.toString('base64')
		});
	}
	return out;
}

/**
 * #587: vygenerovaný PDF výkres tabule s otvorom (poloha uložená k riadku „— s otvorom ⌀46") ako
 * príloha riadku — IZOS tak vie, KDE vŕtať. Riadok bez otvoru / bez uloženej polohy → `[]`
 * (honest-null; podklad upozorní). Zlyhanie generovania sa zaloguje a objednávka ide ďalej bez
 * výkresu (ako pri PDF prílohe plánu rezov) — nikdy nezhodí odoslanie.
 */
async function vykresOtvoruPrilohy(p: SkloPolozka): Promise<GlassAttachment[]> {
	const vstup = vykresOtvoruZPolozky(p);
	if (!vstup) return [];
	try {
		const pdf = await generateVykresOtvoruPdf(vstup);
		return [
			{
				name: vykresOtvoruFilename(vstup),
				mimetype: 'application/pdf',
				data_base64: Buffer.from(pdf).toString('base64')
			}
		];
	} catch (e) {
		log.error('výkres otvoru: generovanie PDF zlyhalo — riadok ide bez výkresu', {
			id: p.id,
			zak: p.zak,
			err: errMsg(e)
		});
		return [];
	}
}

/** #587: poloha otvoru slovom — LEN pri riadku, ku ktorému ide aj výkres (tá istá brána). */
function poznamkaOtvoru(p: SkloPolozka): string | undefined {
	const vstup = vykresOtvoruZPolozky(p);
	return vstup ? popisPolohyOtvoru(vstup.otvor) : undefined;
}

/**
 * Postaví `glass_order` v2 payload zákazky z uložených sklových položiek + ich príloh
 * (Money-neutrálne, IO len SQLite read + base64). Vracia payload + zoznam zahodených príloh
 * (strop veľkosti). `null` keď niet položiek. #587: riadok s otvorom dostane aj vygenerovaný PDF
 * výkres tabule (popri ručných prílohách) — preto async (pdf-lib `save()`).
 */
export async function buildGlassOrderForZak(
	zak: string
): Promise<{ order: GlassOrder; droppedAttachments: DroppedAttachment[] } | null> {
	const polozky = listSklaPreZakazku(zak);
	if (polozky.length === 0) return null;
	const vykresy = await Promise.all(polozky.map(vykresOtvoruPrilohy));
	const inputs: GlassOrderItemInput[] = polozky.map((p, i) => ({
		sirkaMm: p.sirkaMm,
		vyskaMm: p.vyskaMm,
		vLavoMm: p.vLavoMm,
		vPravoMm: p.vPravoMm,
		sikmy: p.sikmy,
		pocet: p.pocet,
		typSkla: p.typSkla,
		// #563: pozícia „Zasklenie N" aj pre riadky spred zmeny producenta (zhoda s tlačou podkladu)
		popis: popisPozicie(p.popis, p.modul),
		mode: p.rezim,
		typSklaManual: p.typSklaManual,
		cenaM2Manual: p.cenaM2Manual,
		attachments: [...nacitajPrilohy(p.id), ...vykresy[i]!],
		// #587: poloha otvoru aj do poznámky — Odoo porovnáva pri re-odoslaní polia riadku, nie prílohy
		poznamkaOtvoru: poznamkaOtvoru(p),
		spec: p.spec
	}));
	return buildGlassOrder(inputs);
}

/**
 * #548: tolerantne rozparsuje odpoveď Odoo intake. v2 intake (#7586) vracia
 * `{ glass_order_id, name, lines, dq }`; v1 intake nevracia nič z toho → vráti `undefined`.
 * NIKDY nehádže — neznáma/prázdna odpoveď = `undefined` (outcome ostane bez `odoo`).
 */
export function parseOdooOutcome(res: unknown): GlassOrderOdooOutcome | undefined {
	if (!res || typeof res !== 'object' || Array.isArray(res)) return undefined;
	const r = res as Record<string, unknown>;
	const out: GlassOrderOdooOutcome = {};
	if (typeof r.glass_order_id === 'number') out.glassOrderId = r.glass_order_id;
	if (typeof r.name === 'string' && r.name.trim()) out.name = r.name;
	if (Array.isArray(r.lines)) out.lines = r.lines;
	if (Array.isArray(r.dq)) out.dq = r.dq;
	return Object.keys(out).length > 0 ? out : undefined;
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

	const built = await buildGlassOrderForZak(trimmed);
	if (!built) return { result: 'no-items', payload: null };
	const payload = built.order;
	const droppedAttachments = built.droppedAttachments;

	if (!isNarezUploadEnabled()) return { result: 'disabled', payload, droppedAttachments };
	const cfg = odooJson2Config();
	if (!cfg) return { result: 'disabled', payload, droppedAttachments };

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
					droppedAttachments,
					error: 'Riadky podkladu majú rôzne OP — nastavte jedno OP objednávky.'
				};
			}
			op = pod;
		}
		if (!op) {
			log.info('glass-order upload: zákazka nemá odpis/OP — nič neposielam', { zak: trimmed });
			// #577: podklad sa dá otvoriť len so ZAK (bez OP) → povedz obsluhe, čo doplniť
			return {
				result: 'missing',
				payload,
				droppedAttachments,
				error:
					'Chýba OP objednávky — zadajte ho v poli „OP objednávky“ na podklade a odošlite znova.'
			};
		}

		const orderNumber = normOp(op);
		const docId = buildGlassOrderDocId(trimmed, op);
		// #548: `require_order: false` — Odoo vytvorí objednávku skla aj bez sale.order (servis bez
		// zákazky); `order_number` = zak ostáva (Odoo ho spáruje, keď existuje). #540: kľúč patrí
		// VNORENE do `glass_order` — Odoo číta len `glass_order.require_order`, hornú úroveň zámerne
		// ignoruje (odoo-erp `sale_order_narezak_glass.py`; „neznámy kľúč" v chate zákazky). Pridáva
		// sa len do odosielaného volania — náhľad (`payload`) ostáva čistý v2 payload.
		const uploadResult = await callJson2(cfg, 'sale.order', 'montalu_narezak_upload', {
			order_number: orderNumber,
			doc_id: docId,
			kind: 'sklo',
			glass_order: { ...payload, require_order: false }
		});
		const odoo = parseOdooOutcome(uploadResult);
		log.info('glass-order upload: úspešne nahraný', {
			zak: trimmed,
			op,
			orderNumber,
			docId,
			items: payload.items.length,
			dropped: droppedAttachments.length,
			odoo
		});
		return { result: 'uploaded', payload, droppedAttachments, odoo };
	} catch (e) {
		const msg = errMsg(e);
		log.error('glass-order upload zlyhal', { zak: trimmed, err: msg });
		return { result: 'failed', payload, droppedAttachments, error: msg };
	}
}
