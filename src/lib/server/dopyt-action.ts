// Verejná SvelteKit akcia pre odoslanie dopytu (#277). Route #275 ju IBA naimportuje a
// namountuje — táto lane #275 route needituje:
//
//   // src/routes/<verejná>/+page.server.ts
//   import { dopytAction } from '$lib/server/dopyt-action';
//   export const actions = { dopyt: dopytAction };
//
// Tok: honeypot → per-IP rate-limit → validácia → sanitizácia konfigurácie → uloženie
// (audit) → vygenerovanie PDF → návrat PDF ako base64 v ActionData (download-first; komponent
// spustí stiahnutie). MONEY-NEUTRÁLNE: žiadny import money/pergola, žiadny zápis do /data.
import { fail, type RequestEvent } from '@sveltejs/kit';
import { resolveClientIp } from './client-ip';
import { allowDopyt } from './dopyt-throttle';
import { insertDopyt } from './dopyt-store';
import { queueLeadCreation } from './odoo-lead';
import { generatePonukaPdf } from './ponuka-pdf';
import { sanitizePonukaConfig } from '$lib/ponuka';
import { HONEYPOT_FIELD, jeSpam, normalizeDopyt, validateDopyt, type DopytVstup } from '$lib/dopyt';
import { logger } from './log';

const log = logger('dopyt-action');

/** Strop veľkosti 3D renderu (dekódované bajty) — obrana proti nafúknutému POST. Zladené s
 *  deploy `BODY_SIZE_LIMIT: 1M` (adapter 413-ne väčšie telo skôr, než sa sem dostane; base64
 *  render ~1 MB tela ≈ 750 KB dekódovaných). Pri #276 (reálne rendery) prehodnotiť oba stropy. */
const MAX_RENDER_BYTES = 768 * 1024;

/** Klientska IP (CF-aware) pre rate-limit + log; `getClientAddress` hádže, keď chýba XFF. */
function clientIp(event: RequestEvent): string | undefined {
	let edge: string | undefined;
	try {
		edge = event.getClientAddress();
	} catch {
		edge = undefined;
	}
	return resolveClientIp(edge, event.request.headers.get('cf-connecting-ip'));
}

/** Voliteľný 3D render: raw base64 alebo data URL; nevalidný/priveľký → undefined (placeholder). */
function decodeRenderPng(v: FormDataEntryValue | null): Uint8Array | undefined {
	if (typeof v !== 'string' || !v) return undefined;
	const b64 = v.startsWith('data:') ? v.slice(v.indexOf(',') + 1) : v;
	try {
		const buf = Buffer.from(b64, 'base64');
		if (buf.length === 0 || buf.length > MAX_RENDER_BYTES) return undefined;
		return new Uint8Array(buf);
	} catch {
		return undefined;
	}
}

/** Názov PDF na stiahnutie — dátumový (nie sekvenčné `dopyt.id`, nech neúniká lead-count). */
function filename(): string {
	return `Montalu-ponuka-${new Date().toISOString().slice(0, 10)}.pdf`;
}

export async function dopytAction(event: RequestEvent) {
	const form = await event.request.formData();
	const ip = clientIp(event);

	// honeypot: reálny človek pole nevyplní → ticho „úspech" bez uloženia/PDF (bot nič nezíska).
	// Logujeme (ip) — keby autofill/heslový manažér omylom vyplnil skryté pole reálnemu
	// zákazníkovi, mis-fire je aspoň dohľadateľný v logu.
	if (jeSpam(form.get(HONEYPOT_FIELD))) {
		log.warn('dopyt honeypot zachytený', { ip });
		return { success: true };
	}

	const rl = allowDopyt(ip);
	if (!rl.allowed) {
		return fail(429, {
			chyba: 'Priveľa pokusov o odoslanie. Skúste to, prosím, o chvíľu znova.',
			retryAfterMs: rl.retryAfterMs
		});
	}

	const values: DopytVstup = normalizeDopyt({
		meno: form.get('meno'),
		email: form.get('email'),
		telefon: form.get('telefon'),
		miesto: form.get('miesto'),
		poznamka: form.get('poznamka')
	});
	const { ok, errors } = validateDopyt(values);
	if (!ok) {
		return fail(400, { errors, values });
	}

	const cfg = sanitizePonukaConfig(form.get('konfiguracia'));
	const renderPng = decodeRenderPng(form.get('renderPng'));

	// audit trail (Money-neutrálne) — ukladáme kanonický JSON konfigurácie
	const id = insertDopyt({
		konfiguracia: JSON.stringify(cfg),
		meno: values.meno,
		email: values.email,
		telefon: values.telefon,
		miesto: values.miesto,
		poznamka: values.poznamka
	});
	log.info('dopyt uložený', { id, ip, maKonfiguraciu: Object.keys(cfg).length > 0 });

	let pdfBase64: string;
	try {
		const bytes = await generatePonukaPdf(cfg, { renderPng });
		pdfBase64 = Buffer.from(bytes).toString('base64');
	} catch (e) {
		log.error('PDF generovanie zlyhalo', { id, err: e instanceof Error ? e.message : String(e) });
		return fail(500, {
			chyba: 'Dopyt sme prijali, ale PDF sa nepodarilo vytvoriť. Ozveme sa vám.',
			ulozene: true
		});
	}

	// #278: dopyt do Odoo CRM leadu — FIRE-AND-FORGET až po pripravení PDF odpovede. Beží
	// async MIMO tejto cesty (synchrónny `void` wrapper), takže NIKDY nezdrží ani nezhodí
	// zákazníkovo PDF; chyby sa logujú a dopyt sa neminie (retry cez `odoo_attempts`). Keď
	// chýba Odoo env, wrapper ticho no-opne.
	queueLeadCreation(id, pdfBase64);

	return { success: true, pdfBase64, filename: filename() };
}
