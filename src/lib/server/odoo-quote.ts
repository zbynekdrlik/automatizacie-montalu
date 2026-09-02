// #5960: „Uložiť ponuku" — credential-resolution + payload mapping pre `sale.order.create_quote_from_app`.
// PER-USER (owner ROZHODNUTÉ #5808 Prístup 1): objednávka vzniká AKO prihlásený Odoo používateľ cez
// preposlanú same-origin `session_id` cookie (`odoo-call-kw.ts`). ZDIEĽANÝ `ODOO_API_KEY` (#5824/#5825)
// sa pre user-akciu NIKDY nepoužije — tento modul ho ani neimportuje.
//
// Credential gate (Fable dizajn-konzult #5960): vyžaduje SSO ON (`ssoEnabled()`) ∧ `user.source==='odoo'`
// ∧ platné `sid`; inak `QuoteAuthError` → 401 do UI, NULA Odoo callov. Payload sa staví SERVER-side z
// normalizovaného `SaveQuoteInput` (ceny počíta server — invariant „klientom dodaná cena sa NEDÔVERuje").
//
// `quote_id` = server-odvodený DETERMINISTICKÝ hash nad `(username, modul, kanonický obsah)` — bez
// `now()`, stabilné poradie, fixné zaokrúhlenie. Vlastnosti: (1) idempotentný na re-klik/timeout-retry
// (rovnaký obsah → rovnaké quote_id → Odoo vráti `created:false`); (2) USER-SCOPED (username v hashi) →
// dvaja používatelia nikdy nekolidujú na `(modul, quote_id)`, takže Odoo víťaza (čítaný z RIADKU,
// ACL-slepo) NIKDY neodovzdá cudziu objednávku. Appka nemá trvalý per-user quote store keyovaný
// quote_id (kalkulačky sú bezstavové), takže „resolve payload from DB by quote_id owned by user" nie je
// dostupné — username-scoped odvodené quote_id je ekvivalentná poistka.
import { createHash } from 'node:crypto';
import { ssoEnabled } from './odoo-sso';
import type { SessionUser } from './auth';
import {
	createQuoteAsUser,
	QuoteAuthError,
	type OdooJson,
	type OdooQuoteResult
} from './odoo-call-kw';

// ---- Verejné vstupné typy --------------------------------------------------------------

/** Cenový riadok ponuky (predajná cena BEZ DPH — počíta ju server, nie klient). */
export interface QuoteLine {
	/** Money predajný kód (`default_code`); prázdny/neznámy → Odoo spraví poznámkový riadok. */
	kod: string;
	nazov: string;
	qty: number;
	mj?: string;
	priceUnit: number;
	discount?: number;
}

/** Príloha (ponuka PDF / výkres / nárez) — surové bajty, mimetype určuje volajúci. */
export interface QuoteAttachment {
	name: string;
	mimetype: string;
	bytes: Uint8Array;
}

export interface QuoteCustomer {
	meno?: string;
	email?: string;
	telefon?: string;
	ico?: string;
	vat?: string;
	dic?: string;
	adresa?: string;
	miesto?: string;
	poznamka?: string;
}

/** Normalizovaný vstup — ruta (server-side) ho postaví z modulového configu (ceny počíta server). */
export interface SaveQuoteInput {
	modul: string;
	url?: string;
	cenaHladina?: string;
	/** Overený existujúci partner (Odoo ho NEVYtvorí); inak sa použije `zakaznik`. */
	partnerId?: number;
	zakaznik?: QuoteCustomer;
	lines: QuoteLine[];
	attachments?: QuoteAttachment[];
}

/** Chyba validácie vstupu (bezpečné ukázať používateľovi). */
export class QuoteInputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'QuoteInputError';
	}
}

// ---- Prílohy: limity presne podľa zmergnutého kontraktu #5818 --------------------------

const ATT_MAX_BYTES = 15 * 1024 * 1024; // 15 MB / kus (horný strop podľa kontraktu #5818)
const ATT_MAX_COUNT = 12;
/** App-side agregátny SANITY cap. POZOR (#5960 review): produkčný `adapter-node BODY_SIZE_LIMIT` je
 *  `1M` (`deploy/docker-compose.yml`) — a public `/konfigurator` sa naň spolieha ako na DoS strop
 *  (`dopyt-action.ts`) — takže telo > ~750 kB raw dnes padne 413 v adaptéri EŠTE PRED touto validáciou.
 *  Preto tento cap NIE JE zosúladený s adaptérom; skutočnú stratégiu príloh (server-side build ponuky
 *  vs zdvihnutie BODY_SIZE_LIMIT + per-route Content-Length gate) rieši go-live #5820. */
const ATT_MAX_TOTAL_BYTES = 90 * 1024 * 1024;
const ATT_MIME_WHITELIST = new Set<string>([
	'application/pdf',
	'image/png',
	'image/jpeg',
	'image/vnd.dxf',
	'application/dxf',
	'text/csv'
]);

// ---- Číselná normalizácia (deterministický hash + čisté hodnoty do payloadu) -----------

/** round(x, 6) — zrkadlo Odoo `_automatizacie_num`; nečíselné → 0. */
function num6(v: unknown): number {
	const n = typeof v === 'number' ? v : Number(v);
	return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : 0;
}

const str = (v: unknown): string => (v == null ? '' : String(v).trim());

// ---- Kanonizácia + quote_id ------------------------------------------------------------

/** Kanonický (deterministický, bez príloh, bez `now()`) obraz obsahu ponuky pre quote_id + audit. */
function canonicalContent(input: SaveQuoteInput): OdooJson {
	const z = input.zakaznik ?? {};
	return {
		modul: str(input.modul),
		cena_hladina: str(input.cenaHladina).toUpperCase(),
		partner_id: typeof input.partnerId === 'number' ? input.partnerId : null,
		zakaznik: {
			meno: str(z.meno),
			email: str(z.email),
			telefon: str(z.telefon),
			ico: str(z.ico),
			vat: str(z.vat),
			dic: str(z.dic),
			adresa: str(z.adresa),
			miesto: str(z.miesto),
			poznamka: str(z.poznamka)
		},
		// poradie riadkov je súčasť identity (nemení sa) — NEsortujem, len normalizujem hodnoty.
		lines: input.lines.map((ln) => ({
			kod: str(ln.kod),
			nazov: str(ln.nazov),
			qty: num6(ln.qty),
			mj: str(ln.mj),
			price_unit: num6(ln.priceUnit),
			discount: num6(ln.discount)
		}))
	};
}

/**
 * Odvodí USER-SCOPED deterministické `quote_id` = sha256(username | modul | kanonický obsah).
 * Bez `now()`/náhodnosti → rovnaký vstup od toho istého používateľa dá VŽDY to isté quote_id
 * (idempotentný retry). Username v hashi → cross-user kolízia na `(modul, quote_id)` nemožná.
 */
export function deriveQuoteId(username: string, input: SaveQuoteInput): string {
	const sig = JSON.stringify({
		u: username,
		modul: str(input.modul),
		content: canonicalContent(input)
	});
	return createHash('sha256').update(sig).digest('hex');
}

// ---- Validácia -------------------------------------------------------------------------

function validateLines(lines: QuoteLine[]): void {
	if (!Array.isArray(lines) || lines.length === 0) {
		throw new QuoteInputError('Ponuka nemá žiadne položky.');
	}
	for (const ln of lines) {
		const meno = (): string => str(ln.nazov) || str(ln.kod);
		// #446 „0 €" trieda: NaN/nečíselné qty/cena/zľava sa NESMIE ticho scoercovať na 0 (num6 to robí)
		// — odmietni PRED coercion, inak by chýbajúca cena prešla ako `price_unit: 0` do Odoo.
		if (!Number.isFinite(ln.qty) || num6(ln.qty) <= 0) {
			throw new QuoteInputError(`Položka „${meno()}" má neplatné alebo nekladné množstvo.`);
		}
		if (!Number.isFinite(ln.priceUnit) || num6(ln.priceUnit) < 0) {
			throw new QuoteInputError(`Položka „${meno()}" má neplatnú alebo zápornú cenu.`);
		}
		if (ln.discount !== undefined && !Number.isFinite(ln.discount)) {
			throw new QuoteInputError(`Položka „${meno()}" má neplatnú zľavu.`);
		}
	}
}

function validateAttachments(atts: QuoteAttachment[]): void {
	if (atts.length > ATT_MAX_COUNT) {
		throw new QuoteInputError(
			`Priveľa príloh (${atts.length}); povolených je najviac ${ATT_MAX_COUNT}.`
		);
	}
	let total = 0;
	for (const a of atts) {
		const size = a.bytes?.byteLength ?? 0;
		if (!ATT_MIME_WHITELIST.has(a.mimetype)) {
			throw new QuoteInputError(`Príloha „${str(a.name)}" má nepovolený typ (${str(a.mimetype)}).`);
		}
		if (size <= 0) {
			throw new QuoteInputError(`Príloha „${str(a.name)}" je prázdna.`);
		}
		if (size > ATT_MAX_BYTES) {
			throw new QuoteInputError(`Príloha „${str(a.name)}" je príliš veľká (max 15 MB).`);
		}
		total += size;
	}
	if (total > ATT_MAX_TOTAL_BYTES) {
		throw new QuoteInputError('Prílohy spolu presahujú limit (max 90 MB) — zmenši ich.');
	}
}

// ---- Payload mapping -------------------------------------------------------------------

function mapZakaznik(z: QuoteCustomer): Record<string, OdooJson> {
	const out: Record<string, OdooJson> = {};
	const put = (k: string, v: string): void => {
		if (v) out[k] = v;
	};
	put('meno', str(z.meno));
	put('email', str(z.email));
	put('telefon', str(z.telefon));
	put('ico', str(z.ico));
	put('vat', str(z.vat));
	put('dic', str(z.dic));
	put('adresa', str(z.adresa));
	put('miesto', str(z.miesto));
	put('poznamka', str(z.poznamka));
	return out;
}

/** base64 z bajtov (Buffer je v Node/SSR dostupný). VIEW nad ArrayBuffer (bez zbytočnej kópie). */
function toBase64(bytes: Uint8Array): string {
	return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

/** Postaví `create_quote_from_app` kwargs zo `SaveQuoteInput` (validované) + identity. */
export function buildQuotePayload(
	input: SaveQuoteInput,
	user: SessionUser,
	quoteId: string
): Record<string, OdooJson> {
	const lines = input.lines.map((ln) => {
		const line: Record<string, OdooJson> = {
			kod: str(ln.kod),
			nazov: str(ln.nazov),
			qty: num6(ln.qty),
			price_unit: num6(ln.priceUnit)
		};
		if (str(ln.mj)) line.mj = str(ln.mj);
		if (num6(ln.discount) > 0) line.discount = num6(ln.discount);
		return line;
	});
	const payload: Record<string, OdooJson> = {
		modul: str(input.modul),
		quote_id: quoteId,
		app_user: user.username,
		lines
	};
	if (str(input.url)) payload.url = str(input.url);
	if (str(input.cenaHladina)) payload.cena_hladina = str(input.cenaHladina).toUpperCase();
	if (
		typeof input.partnerId === 'number' &&
		Number.isInteger(input.partnerId) &&
		input.partnerId > 0
	) {
		payload.partner_id = input.partnerId;
	} else if (input.zakaznik) {
		const z = mapZakaznik(input.zakaznik);
		if (Object.keys(z).length > 0) payload.zakaznik = z;
	}
	const atts = input.attachments ?? [];
	if (atts.length > 0) {
		payload.attachments = atts.map((a) => ({
			name: str(a.name),
			mimetype: str(a.mimetype),
			datas: toBase64(a.bytes)
		}));
	}
	return payload;
}

// ---- Hlavný vstup ----------------------------------------------------------------------

/** Výsledok pre rutu/UI (deep-link `url` staví ruta zo známeho public base, nie z Odoo-echa). */
export interface SaveQuoteResult {
	id: number;
	name: string;
	created: boolean;
	quoteId: string;
	rotatedSid?: string;
	rotatedMaxAge?: number;
}

/**
 * Uloží ponuku do Odoo AKO prihlásený používateľ. Credential-resolution: SSO ON ∧
 * `user.source==='odoo'` ∧ `sid` — inak `QuoteAuthError` (401 do UI), NIKDY zdieľaný kľúč, NULA
 * Odoo callov. Vstup sa validuje (riadky/prílohy) PRED akýmkoľvek Odoo callom. Hádže `QuoteAuthError`
 * / `QuoteInputError` / `QuoteUserError` / `QuoteTransportError`.
 */
export async function saveQuoteToOdoo(
	input: SaveQuoteInput,
	sid: string | undefined,
	user: SessionUser | null
): Promise<SaveQuoteResult> {
	// --- Credential gate (per-user only; nikdy fallback na zdieľaný ODOO_API_KEY) ---
	if (!ssoEnabled()) {
		throw new QuoteAuthError('Ukladanie ponúk do Odoo je vypnuté (SSO nie je nakonfigurované).');
	}
	if (!user || user.source !== 'odoo') {
		throw new QuoteAuthError('Uloženie ponuky do Odoo vyžaduje prihlásenie cez Odoo.');
	}
	if (!sid) {
		throw new QuoteAuthError('Chýba Odoo session — prihlás sa znova a skús to ešte raz.');
	}
	// --- Validácia vstupu PRED Odoo callom ---
	if (!str(input.modul)) throw new QuoteInputError('Chýba modul kalkulácie.');
	validateLines(input.lines);
	validateAttachments(input.attachments ?? []);

	const quoteId = deriveQuoteId(user.username, input);
	const payload = buildQuotePayload(input, user, quoteId);
	const res: OdooQuoteResult = await createQuoteAsUser(payload, sid);
	return {
		id: res.id,
		name: res.name,
		created: res.created,
		quoteId,
		rotatedSid: res.rotatedSid,
		rotatedMaxAge: res.rotatedMaxAge
	};
}
