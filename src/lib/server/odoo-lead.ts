// Zrkadlenie verejného zákazníckeho dopytu (#277) do Odoo CRM leadu (#278). Každý dopyt z
// verejného konfigurátora pergoly vznikne ako `crm.lead` v Montalu Odoo (`erp.montalu.cloud`,
// db `odoo`) cez XML-RPC, s pripojenou PDF ponukou (`ir.attachment`, best-effort).
//
// KĽÚČOVÝ KONTRAKT (#278): dopyt sa NIKDY nestratí a zákazníkovo PDF sa NIKDY neoneskorí ani
// nezhodí kvôli Odoo. Preto:
//   • `dopyt-action` volá `queueLeadCreation()` FIRE-AND-FORGET až po pripravení PDF odpovede
//     — tvorba leadu beží async mimo request/response cesty (synchrónny `void` wrapper).
//   • Odoo nedostupné/chyba ⇒ `odoo_attempts++` + `odoo_last_error` (migrácia v26), dopyt
//     ostáva pending → `retryPendingLeads()` sweep ho neskôr spracuje (bounded MAX pokusmi).
//   • chýbajúci env (feature disabled) ⇒ dopyt ostáva pending, žiadny pokus sa neminie.
//
// XML-RPC klient je MINIMALISTICKÝ hand-rolled cez `fetch` (žiadna npm závislosť) — Node nemá
// builtin XML-RPC a bundling hotového balíka pod Vite SSR + adapter-node + `npm prune` je
// integračné riziko neoveriteľné v Tier-0 worktree (rovnaká disciplína ako `log.ts`/`dejavu.ts`;
// viď dizajn komentár #278). Encoder pokrýva int/string/bool/struct/array; decoder skalár
// (int uid/id) + fault — presne to, čo reálne konzumujeme (authenticate → uid, create → id).
//
// CREDENTIALS: LEN runtime env (`ODOO_LEAD_URL`/`ODOO_LEAD_DB`/`ODOO_LEAD_LOGIN`/
// `ODOO_LEAD_API_KEY`), NIKDY v gite, žiadny default s tajomstvom — chýba ktorákoľvek ⇒ vypnuté.
//
// MONEY-NEUTRÁLNE: payload staviam len z `zhrnutieRiadky()`/kontaktu (bez cien); tento modul
// neimportuje money/pergola a nezapisuje do /data (guard `tests/odoo-lead.test.ts`).
import { logger } from './log';
import {
	getDopytForLead,
	getPendingLeadDopyty,
	markLeadCreated,
	markLeadFailed
} from './dopyt-store';
import type { DopytLeadRiadok } from './dopyt-store';
import { generatePonukaPdf } from './ponuka-pdf';
import { sanitizePonukaConfig, zhrnutieRiadky, type PonukaConfig } from '$lib/ponuka';

const log = logger('odoo-lead');

/** Max pokusov o vytvorenie leadu na jeden dopyt — po vyčerpaní zostáva `odoo_last_error`
 *  (dopyt NIE je stratený, len sa naň už netlačí donekonečna). */
export const MAX_ATTEMPTS = 5;
/** Koľko pending dopytov spracuje jeden retry sweep (ohraničenie záťaže na Odoo). */
const RETRY_BATCH = 20;
/** Timeout jedného XML-RPC volania — fire-and-forget nesmie visieť, keď je Odoo nedostupné. */
const DEFAULT_TIMEOUT_MS = 10_000;

// ---- Minimalistický XML-RPC (encoder + skalár/fault decoder) -------------------------

type XmlRpcValue = string | number | boolean | XmlRpcValue[] | { [k: string]: XmlRpcValue };

class OdooRpcError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'OdooRpcError';
	}
}

function xmlEscape(s: string): string {
	return (
		s
			// XML 1.0 nepovoľuje C0 riadiace znaky okrem \t \n \r — odstráň ich, inak crafted
			// zákaznícky vstup (napr. \x0B v poznámke) rozbije celý XML dokument → Odoo fault →
			// poison-pill do retry-until-give-up (#278 review). Ostatné znaky sa nižšie escapujú.
			// eslint-disable-next-line no-control-regex
			.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&apos;')
	);
}

function xmlUnescape(s: string): string {
	return s
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, '&');
}

function encodeValue(v: XmlRpcValue): string {
	if (typeof v === 'string') return `<value><string>${xmlEscape(v)}</string></value>`;
	if (typeof v === 'boolean') return `<value><boolean>${v ? 1 : 0}</boolean></value>`;
	if (typeof v === 'number')
		return Number.isInteger(v)
			? `<value><int>${v}</int></value>`
			: `<value><double>${v}</double></value>`;
	if (Array.isArray(v))
		return `<value><array><data>${v.map(encodeValue).join('')}</data></array></value>`;
	const members = Object.entries(v)
		.map(([k, val]) => `<member><name>${xmlEscape(k)}</name>${encodeValue(val)}</member>`)
		.join('');
	return `<value><struct>${members}</struct></value>`;
}

function methodCall(method: string, params: XmlRpcValue[]): string {
	const ps = params.map((p) => `<param>${encodeValue(p)}</param>`).join('');
	return `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params>${ps}</params></methodCall>`;
}

/**
 * Vytiahne skalár (int/bool/string/double/nil) z XML-RPC odpovede, alebo hodí `OdooRpcError`
 * pri `<fault>`. Zámerne minimálny — Odoo authenticate/create vracajú JEDEN skalár (uid/id)
 * alebo fault; nezostavený `<value>text</value>` (implicitný string) sa nerieši (nekonzumujeme).
 */
function parseScalarResponse(xml: string): number | string | boolean | null {
	const fault = /<fault>([\s\S]*?)<\/fault>/.exec(xml);
	if (fault) {
		const body = fault[1] ?? '';
		const msg = /<name>faultString<\/name>\s*<value>\s*<string>([\s\S]*?)<\/string>/.exec(body);
		const code = /<name>faultCode<\/name>\s*<value>\s*<(?:int|i4)>(-?\d+)<\/(?:int|i4)>/.exec(body);
		throw new OdooRpcError(
			`Odoo fault ${code?.[1] ?? '?'}: ${msg ? xmlUnescape(msg[1] ?? '') : 'neznáma chyba'}`
		);
	}
	const scope = /<params>([\s\S]*?)<\/params>/.exec(xml);
	const region = scope?.[1] ?? xml;
	const iv = /<(?:int|i4)>(-?\d+)<\/(?:int|i4)>/.exec(region);
	if (iv) return parseInt(iv[1] ?? '0', 10);
	const bv = /<boolean>([01])<\/boolean>/.exec(region);
	if (bv) return bv[1] === '1';
	const sv = /<string>([\s\S]*?)<\/string>/.exec(region);
	if (sv) return xmlUnescape(sv[1] ?? '');
	const dv = /<double>(-?[\d.eE+]+)<\/double>/.exec(region);
	if (dv) return parseFloat(dv[1] ?? '0');
	if (/<nil\s*\/>/.test(region)) return null;
	throw new OdooRpcError('Odoo XML-RPC: nečitateľná odpoveď (žiadny skalár ani fault)');
}

// ---- Transport (fetch; injektovateľný pre testy) -------------------------------------

export type LeadTransport = (url: string, xmlBody: string) => Promise<string>;

async function defaultTransport(url: string, xmlBody: string): Promise<string> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'text/xml' },
			body: xmlBody,
			signal: ctrl.signal
		});
		const text = await res.text();
		if (!res.ok)
			throw new OdooRpcError(`Odoo HTTP ${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
		return text;
	} finally {
		clearTimeout(timer);
	}
}

let transport: LeadTransport = defaultTransport;

/** TEST hook: nahraď XML-RPC transport (mock); `null` = späť na `fetch`. */
export function _setLeadTransport(t: LeadTransport | null): void {
	transport = t ?? defaultTransport;
}

// ---- Konfigurácia z env (lazy — test vie env nastaviť za behu) -----------------------

export interface LeadConfig {
	url: string;
	db: string;
	login: string;
	apiKey: string;
}

/** Prečíta env; ak CHÝBA ktorákoľvek zo 4 hodnôt → `null` (feature vypnutá, dopyt ostáva). */
export function leadConfig(): LeadConfig | null {
	const url = process.env.ODOO_LEAD_URL;
	const db = process.env.ODOO_LEAD_DB;
	const login = process.env.ODOO_LEAD_LOGIN;
	const apiKey = process.env.ODOO_LEAD_API_KEY;
	if (!url || !db || !login || !apiKey) return null;
	return { url, db, login, apiKey };
}

const trimSlash = (u: string) => u.replace(/\/+$/, '');
const commonUrl = (base: string) => `${trimSlash(base)}/xmlrpc/2/common`;
const objectUrl = (base: string) => `${trimSlash(base)}/xmlrpc/2/object`;

async function rpc(
	url: string,
	method: string,
	params: XmlRpcValue[]
): Promise<number | string | boolean | null> {
	const respText = await transport(url, methodCall(method, params));
	return parseScalarResponse(respText);
}

/** Prihlásenie → uid. False/0/fault ⇒ hodí (zlé creds alebo Odoo chyba). */
async function authenticate(cfg: LeadConfig): Promise<number> {
	const uid = await rpc(commonUrl(cfg.url), 'authenticate', [cfg.db, cfg.login, cfg.apiKey, {}]);
	if (typeof uid !== 'number' || uid <= 0)
		throw new OdooRpcError(
			'Odoo authentikácia zlyhala (skontroluj ODOO_LEAD_LOGIN / ODOO_LEAD_API_KEY)'
		);
	return uid;
}

/** `execute_kw(model, 'create', [values])` → nové id (int). */
async function createRecord(
	cfg: LeadConfig,
	uid: number,
	model: string,
	values: Record<string, XmlRpcValue>
): Promise<number> {
	const res = await rpc(objectUrl(cfg.url), 'execute_kw', [
		cfg.db,
		uid,
		cfg.apiKey,
		model,
		'create',
		[values]
	]);
	if (typeof res !== 'number' || res <= 0)
		throw new OdooRpcError(`Odoo create ${model} nevrátil id (dostal: ${JSON.stringify(res)})`);
	return res;
}

// ---- Payload leadu (čisté, testovateľné, BEZ CIEN) -----------------------------------

export interface LeadPayload extends Record<string, string> {
	name: string;
	contact_name: string;
	email_from: string;
	phone: string;
	description: string;
	type: string;
}

function leadName(meno: string, miesto: string): string {
	const kto = meno || 'neznámy záujemca';
	return miesto ? `Pergola – dopyt: ${kto} (${miesto})` : `Pergola – dopyt: ${kto}`;
}

/**
 * Popis leadu: miesto stavby + poznámka zákazníka + súhrn konfigurácie (`zhrnutieRiadky`).
 * Zákaznícke hodnoty HTML-escapujem (`crm.lead.description` je Html pole — obrana proti
 * vloženému markupu); riadky delím literálom `<br>`. ŽIADNA cena (zhrnutieRiadky je bez cien).
 */
function buildDescription(row: DopytLeadRiadok, cfg: PonukaConfig): string {
	const lines: string[] = [];
	if (row.miesto) lines.push(`Miesto stavby: ${xmlEscape(row.miesto)}`);
	if (row.poznamka) lines.push(`Poznámka zákazníka: ${xmlEscape(row.poznamka)}`);
	if (lines.length) lines.push('');
	lines.push('Konfigurácia z verejného konfigurátora:');
	const rows = zhrnutieRiadky(cfg);
	if (rows.length === 0) lines.push('(bez detailov konfigurácie)');
	else for (const r of rows) lines.push(`${xmlEscape(r.label)}: ${xmlEscape(r.value)}`);
	lines.push('');
	lines.push(
		'Zdroj: verejný konfigurátor pergoly (app.montalu.cloud). Nezáväzný dopyt, nie cenová ponuka.'
	);
	return lines.join('<br>\n');
}

/** Postaví `crm.lead` payload z uloženého dopytu (kontakt + konfigurácia). BEZ CIEN. */
export function buildLeadPayload(row: DopytLeadRiadok): LeadPayload {
	const cfg = sanitizePonukaConfig(row.konfiguracia);
	return {
		name: leadName(row.meno, row.miesto),
		contact_name: row.meno,
		email_from: row.email,
		phone: row.telefon,
		description: buildDescription(row, cfg),
		type: 'lead'
	};
}

function leadFilename(createdAt: string): string {
	const den = (createdAt || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
	return `Montalu-ponuka-${den}.pdf`;
}

// ---- Tvorba leadu + best-effort príloha ----------------------------------------------

/**
 * Vytvorí `crm.lead` a (best-effort) pripojí PDF ako `ir.attachment`. Pád PRÍLOHY NEZHODÍ
 * lead (lead už existuje) — len sa zaloguje. Vracia `leadId`.
 */
export async function createLeadViaXmlRpc(
	cfg: LeadConfig,
	payload: LeadPayload,
	pdfBase64?: string,
	filename = 'Montalu-ponuka.pdf'
): Promise<number> {
	const uid = await authenticate(cfg);
	const leadId = await createRecord(cfg, uid, 'crm.lead', payload);
	if (pdfBase64) {
		try {
			await createRecord(cfg, uid, 'ir.attachment', {
				name: filename,
				datas: pdfBase64,
				res_model: 'crm.lead',
				res_id: leadId,
				mimetype: 'application/pdf',
				type: 'binary'
			});
			log.info('lead: PDF príloha pripojená', { leadId });
		} catch (e) {
			log.warn('lead: PDF príloha zlyhala (best-effort, lead ostáva)', {
				leadId,
				err: e instanceof Error ? e.message : String(e)
			});
		}
	}
	return leadId;
}

/** Regeneruje PDF z uloženej konfigurácie (retry cesta — pôvodný render sa neukladá).
 *  Best-effort: pád regenerácie ⇒ `undefined` (lead vznikne bez prílohy). */
async function regeneratePdfBase64(konfiguraciaJson: string): Promise<string | undefined> {
	try {
		const cfg = sanitizePonukaConfig(konfiguraciaJson);
		const bytes = await generatePonukaPdf(cfg);
		return Buffer.from(bytes).toString('base64');
	} catch (e) {
		log.warn('lead retry: regenerácia PDF zlyhala (príloha sa vynechá)', {
			err: e instanceof Error ? e.message : String(e)
		});
		return undefined;
	}
}

export type LeadSubmitResult = 'created' | 'failed' | 'disabled' | 'missing' | 'skipped';

/** ID-čka dopytov, ktorých lead sa PRÁVE async vytvára. Kým beží tvorba, DB riadok má stále
 *  `odoo_lead_id IS NULL`, takže by ho súbežný sweep (z iného dopytu) vzal a vytvoril DRUHÝ
 *  lead. Beh je single-process (adapter-node), preto in-process Set spoľahlivo serializuje
 *  per-dopyt tvorbu (#278 review). */
const inFlight = new Set<number>();

/**
 * Zrkadlí jeden dopyt do Odoo leadu. `pdfBase64` = z pôvodného submitu (initial cesta);
 * bez neho (retry cesta) sa PDF regeneruje. Chyba ⇒ `markLeadFailed` (dopyt ostáva, retry).
 * NIKDY nehádže — všetko sa loguje a mapuje na výsledok.
 */
export async function submitDopytLead(
	dopytId: number,
	pdfBase64?: string
): Promise<LeadSubmitResult> {
	const cfg = leadConfig();
	if (!cfg) {
		log.debug('Odoo lead vypnutý (chýba env) — dopyt ostáva pending', { dopytId });
		return 'disabled';
	}
	const row = getDopytForLead(dopytId);
	if (!row) {
		log.warn('lead submit: dopyt neexistuje', { dopytId });
		return 'missing';
	}
	if (row.odoo_lead_id != null) return 'skipped'; // už zrkadlený
	if (row.odoo_attempts >= MAX_ATTEMPTS) return 'skipped'; // vzdané po MAX pokusoch
	if (inFlight.has(dopytId)) return 'skipped'; // práve sa vytvára (súbeh) — neduplikuj lead
	inFlight.add(dopytId);

	try {
		const payload = buildLeadPayload(row);
		const pdf = pdfBase64 ?? (await regeneratePdfBase64(row.konfiguracia));
		try {
			const leadId = await createLeadViaXmlRpc(cfg, payload, pdf, leadFilename(row.created_at));
			markLeadCreated(dopytId, leadId);
			log.info('dopyt zrkadlený do Odoo CRM leadu', {
				dopytId,
				leadId,
				pokus: row.odoo_attempts + 1
			});
			return 'created';
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			markLeadFailed(dopytId, msg);
			log.error('lead do Odoo zlyhal — dopyt ostáva, retry neskôr', {
				dopytId,
				pokus: row.odoo_attempts + 1,
				err: msg
			});
			return 'failed';
		}
	} finally {
		inFlight.delete(dopytId);
	}
}

/**
 * Sweep dopytov čakajúcich na Odoo lead (Odoo bola dole / env pribudol neskôr). Sekvenčne
 * (netlačíme na Odoo naraz), ohraničené `RETRY_BATCH`. Vypnuté (chýba env) ⇒ žiadny DB dotaz.
 */
export async function retryPendingLeads(): Promise<void> {
	if (!leadConfig()) return;
	const pending = getPendingLeadDopyty(MAX_ATTEMPTS, RETRY_BATCH);
	if (pending.length === 0) return;
	log.info('lead retry sweep štart', { pocet: pending.length });
	let created = 0;
	for (const row of pending) {
		const r = await submitDopytLead(row.id);
		if (r === 'created') created++;
	}
	log.info('lead retry sweep hotový', { spracovanych: pending.length, vytvorenych: created });
}

/**
 * FIRE-AND-FORGET vstupný bod pre `dopyt-action`: zrkadlí TENTO dopyt a potom prebehne retry
 * sweep pre staré pending. Synchrónny `void` wrapper (kvôli `no-floating-promises`) — NIKDY
 * neblokuje ani nezhodí volajúceho (zákazníkovo PDF). Všetky chyby sú vnútri zachytené.
 */
export function queueLeadCreation(dopytId: number, pdfBase64?: string): void {
	void (async () => {
		let result: LeadSubmitResult = 'failed';
		try {
			result = await submitDopytLead(dopytId, pdfBase64);
		} catch (e) {
			log.error('lead queue: submit neočakávane hodil', {
				dopytId,
				err: e instanceof Error ? e.message : String(e)
			});
		}
		// Sweep starých pending LEN keď TENTO submit uspel — úspech je dôkaz, že Odoo je hore.
		// Pri výpadku (failed/disabled) by sweep len zbytočne míňal pokusy na starých riadkoch
		// (a poison-pill riadok by zožral MAX_ATTEMPTS podľa frekvencie príchodov) — #278 review.
		if (result !== 'created') return;
		try {
			await retryPendingLeads();
		} catch (e) {
			log.error('lead queue: retry sweep neočakávane hodil', {
				err: e instanceof Error ? e.message : String(e)
			});
		}
	})();
}

/**
 * Jednorazový sweep pri ŠTARTE servera (volá `hooks.server.ts`). Zotaví dopyty, ktoré čakali
 * na Odoo lead (Odoo bola dole / env pribudol) a medzitým sa appka reštartovala — inak by sa
 * arrival-triggered retry rozbehol až pri ĎALŠOM dopyte (#278 review, finding #2). Deploy =
 * reštart, takže tento sweep pokryje bežný „Odoo/env opravené → nasadené" prípad.
 * Fire-and-forget, chyby zachytené; vypnuté (chýba env) ⇒ okamžite no-op.
 */
export function runStartupLeadSweep(): void {
	if (!leadConfig()) return;
	void retryPendingLeads().catch((e) =>
		log.error('lead štartový sweep hodil', {
			err: e instanceof Error ? e.message : String(e)
		})
	);
}
