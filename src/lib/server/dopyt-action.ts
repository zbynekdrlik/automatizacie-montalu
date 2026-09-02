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
import { clientIp } from './client-ip';
import { allowDopyt } from './dopyt-throttle';
import { insertDopyt, insertObjednavka } from './dopyt-store';
import { opeciatkujCenuPreProdukt } from './dopyt-cena-stamp';
import { cenovaHladina } from './konfigurator-hladina';
import { queueLeadCreation } from './odoo-lead';
import { generatePonukaPdf } from './ponuka-pdf';
import { sanitizePonukaConfig } from '$lib/ponuka';
import type { KonfProduktKod } from '$lib/konfigurator-produkty';
import {
	HONEYPOT_FIELD,
	jeSpam,
	normalizeDopyt,
	validateDopyt,
	normalizeObjednavka,
	validateObjednavka,
	type DopytVstup
} from '$lib/dopyt';
import { logger } from './log';

const log = logger('dopyt-action');

/** Strop veľkosti 3D renderu (dekódované bajty) — obrana proti nafúknutému POST. Zladené s
 *  deploy `BODY_SIZE_LIMIT: 1M` (adapter 413-ne väčšie telo skôr, než sa sem dostane; base64
 *  render ~1 MB tela ≈ 750 KB dekódovaných). Pri #276 (reálne rendery) prehodnotiť oba stropy. */
const MAX_RENDER_BYTES = 768 * 1024;

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

/** Názov PDF na stiahnutie — dátumový (nie sekvenčné `dopyt.id`, nech neúniká lead-count).
 *  `prefix` odlíši objednávkovú špecifikáciu od dopytovej ponuky (`ponuka` / `objednavka`). */
function filename(prefix = 'ponuka'): string {
	return `Montalu-${prefix}-${new Date().toISOString().slice(0, 10)}.pdf`;
}

export async function dopytAction(event: RequestEvent, produkt: KonfProduktKod = 'pergola') {
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
	// #384: produktový rad je SERVER-AUTORITATÍVNY — príde ako argument z routy (`/konfigurator/
	// <produkt>` vie svoj produkt), NIE z klientom dodaného poľa (to by sa dalo sfalšovať a
	// mislabelovať lead). Robí PDF titul + názov Odoo leadu produkt-aware.
	const renderPng = decodeRenderPng(form.get('renderPng'));
	// #309/#318: opečiatkuj cenu + verziu cenníka PRI PODANÍ — uloží sa do dopytu a PDF ju použije,
	// takže re-download reprodukuje cenu platnú TERAZ (nie prepočet z neskoršej matice). Hladina sa
	// určí SERVER-SIDE z prihláseného používateľa: veľkoobchodný (b2b) → VO cena + typ hladiny,
	// inak MO (verejný dopyt). `locals` je pri reálnom requeste vždy prítomné (`?.` obranné).
	// #385/#404: cena sa opečiatkuje produkt-aware IBA pre produkt s cenovým zdrojom (pergola + bazén).
	// Rad bez matice → honest-null (žiadna cena) — inak by dostal nesprávnu cenu iného radu z rozmerov.
	const stamp = opeciatkujCenuPreProdukt(cfg, produkt, cenovaHladina(event.locals?.user ?? null));

	// audit trail (Money-neutrálne) — ukladáme kanonický JSON konfigurácie + opečiatkovanú cenu
	const id = insertDopyt(
		{
			konfiguracia: JSON.stringify(cfg),
			meno: values.meno,
			email: values.email,
			telefon: values.telefon,
			miesto: values.miesto,
			poznamka: values.poznamka,
			produkt
		},
		stamp
	);
	log.info('dopyt uložený', { id, ip, produkt, maKonfiguraciu: Object.keys(cfg).length > 0 });

	let pdfBase64: string;
	try {
		// PDF nesie OPEČIATKOVANÚ cenu (identickú s uloženou) → submit PDF == budúci re-download.
		const bytes = await generatePonukaPdf(cfg, {
			renderPng,
			cena: stamp.cena ?? undefined,
			produkt
		});
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

/**
 * Verejná akcia pre ZÁVÄZNÚ OBJEDNÁVKU z konfigurátora (#319). Escalácia dopytu: rovnaký tok
 * (honeypot → rate-limit → sanitize → opečiatkuj cenu → uloženie → PDF → Odoo lead FIRE-AND-FORGET),
 * ale navyše fakturačné údaje + POVINNÝ súhlas s podmienkami, a uloží sa ako objednávka
 * (`insertObjednavka`, `je_objednavka=1`). Zapečatí cenu VRÁTANE MO/VO hladiny (bod 5). Odoo lead
 * sa vytvorí ako OBJEDNÁVKA (opportunity) — vetva podľa `je_objednavka` v `odoo-lead.ts`.
 * MONEY-NEUTRÁLNE: žiadny odpis, žiadny zápis do /data; ŽIADNA platobná brána (objednávka je
 * záväzná v zmysle „odoslaná firme", nie zaplatená).
 */
export async function objednavkaAction(event: RequestEvent, produkt: KonfProduktKod = 'pergola') {
	const form = await event.request.formData();
	const ip = clientIp(event);

	// honeypot — reálny človek pole nevyplní → ticho „úspech" bez uloženia (bot nič nezíska)
	if (jeSpam(form.get(HONEYPOT_FIELD))) {
		log.warn('objednávka honeypot zachytený', { ip });
		return { success: true };
	}

	const rl = allowDopyt(ip);
	if (!rl.allowed) {
		return fail(429, {
			chyba: 'Priveľa pokusov o odoslanie. Skúste to, prosím, o chvíľu znova.',
			retryAfterMs: rl.retryAfterMs
		});
	}

	const values = normalizeObjednavka({
		meno: form.get('meno'),
		email: form.get('email'),
		telefon: form.get('telefon'),
		miesto: form.get('miesto'),
		poznamka: form.get('poznamka'),
		faktMeno: form.get('faktMeno'),
		faktAdresa: form.get('faktAdresa'),
		faktIco: form.get('faktIco'),
		faktDic: form.get('faktDic'),
		suhlas: form.get('suhlas')
	});
	const { ok, errors } = validateObjednavka(values);
	if (!ok) {
		return fail(400, { errors, values });
	}

	const cfg = sanitizePonukaConfig(form.get('konfiguracia'));
	// #384: produkt je server-autoritatívny argument z routy (viď dopytAction), nie klientske pole.
	const renderPng = decodeRenderPng(form.get('renderPng'));
	// #309/#318: opečiatkuj cenu + MO/VO hladinu PRI PODANÍ — objednaná cena je zapečatená (bod 5).
	// #385/#404: produkt-aware — pergola + bazén dostanú cenu (z vlastnej matice); ostatné honest-null.
	const stamp = opeciatkujCenuPreProdukt(cfg, produkt, cenovaHladina(event.locals?.user ?? null));

	const id = insertObjednavka(
		{
			konfiguracia: JSON.stringify(cfg),
			meno: values.meno,
			email: values.email,
			telefon: values.telefon,
			miesto: values.miesto,
			poznamka: values.poznamka,
			produkt,
			faktMeno: values.faktMeno,
			faktAdresa: values.faktAdresa,
			faktIco: values.faktIco,
			faktDic: values.faktDic
		},
		stamp
	);
	log.info('objednávka uložená', { id, ip, produkt, maKonfiguraciu: Object.keys(cfg).length > 0 });

	let pdfBase64: string;
	try {
		const bytes = await generatePonukaPdf(cfg, {
			renderPng,
			cena: stamp.cena ?? undefined,
			produkt
		});
		pdfBase64 = Buffer.from(bytes).toString('base64');
	} catch (e) {
		log.error('PDF objednávky zlyhalo', { id, err: e instanceof Error ? e.message : String(e) });
		return fail(500, {
			chyba: 'Objednávku sme prijali, ale PDF sa nepodarilo vytvoriť. Ozveme sa vám.',
			ulozene: true
		});
	}

	// #278/#319: objednávka do Odoo CRM ako OPPORTUNITY (vetva v `odoo-lead.ts` podľa je_objednavka).
	// FIRE-AND-FORGET, chyby sa logujú, objednávka sa neminie (retry cez `odoo_attempts`).
	queueLeadCreation(id, pdfBase64);

	return { success: true, pdfBase64, filename: filename('objednavka') };
}
