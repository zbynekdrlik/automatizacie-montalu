// Zdieľaný minimalistický XML-RPC klient pre Montalu Odoo (`erp.montalu.cloud`).
//
// Extrahované z `odoo-lead.ts` (#340), aby ho zdieľali OBE Odoo integrácie:
//   • `odoo-lead.ts`  — verejný dopyt → `crm.lead` (#278)
//   • `odoo-zakazka.ts` — interný zoznam materiálu zákazky → `sale.order` log-note (#340)
//
// Prečo hand-rolled (žiadna npm závislosť): Node nemá builtin XML-RPC klienta a bundling
// hotového balíka pod Vite SSR + adapter-node + `npm prune` je integračné riziko
// neoveriteľné v Tier-0 worktree (rovnaká disciplína ako `log.ts`/`dejavu.ts`). Encoder
// pokrýva int/string/bool/double/struct/array (struct kvôli `create` values AJ `message_post`
// kwargs; array kvôli `search` výsledkom a prázdnemu `partner_ids`). Decoder pokrýva skalár
// (int/bool/string/double/nil), ARRAY skalárov (`search` → id-čka) a `<fault>` — presne to,
// čo reálne konzumujeme (authenticate → uid, create → id, search → int[], message_post → ok).
//
// CREDENTIALS: LEN runtime env (`ODOO_LEAD_URL`/`ODOO_LEAD_DB`/`ODOO_LEAD_LOGIN`/
// `ODOO_LEAD_API_KEY`), NIKDY v gite, žiadny default s tajomstvom — chýba ktorákoľvek ⇒ `null`
// (integrácia sa TICHO vypne). Ten istý účet (uid „WEB", Sales/User) obsluhuje obe integrácie.

export type XmlRpcValue = string | number | boolean | XmlRpcValue[] | { [k: string]: XmlRpcValue };

/** Skalár alebo pole skalárov, ktoré decoder vráti z Odoo odpovede. */
export type OdooResult = number | string | boolean | null | (number | string | boolean)[];

export class OdooRpcError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'OdooRpcError';
	}
}

/** Timeout jedného XML-RPC volania — integrácia nesmie visieť, keď je Odoo nedostupné. */
const DEFAULT_TIMEOUT_MS = 10_000;

// ---- Escapovanie -------------------------------------------------------------------

/**
 * XML-escape pre hodnotu idúcu na drôt. XML 1.0 nepovoľuje C0 riadiace znaky okrem \t \n \r —
 * odstráň ich, inak crafted vstup (napr. \x0B) rozbije celý XML dokument → Odoo fault →
 * poison-pill (#278 review). Toto je escapovanie na ÚROVNI XML PRENOSU; HTML-escapovanie
 * obsahu Html poľa (napr. `crm.lead.description`) je SAMOSTATNÁ vrstva u volajúceho.
 */
export function xmlEscape(s: string): string {
	return (
		s
			// eslint-disable-next-line no-control-regex
			.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&apos;')
	);
}

export function xmlUnescape(s: string): string {
	return s
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, '&');
}

// ---- Encoder -----------------------------------------------------------------------

export function encodeValue(v: XmlRpcValue): string {
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

export function methodCall(method: string, params: XmlRpcValue[]): string {
	const ps = params.map((p) => `<param>${encodeValue(p)}</param>`).join('');
	return `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params>${ps}</params></methodCall>`;
}

// ---- Decoder (skalár + array skalárov + fault) -------------------------------------

/** Vytiahne JEDEN skalár z regiónu XML. `null`, keď žiadny skalár nie je (volajúci rozhodne). */
function scalarFrom(region: string): number | string | boolean | null | undefined {
	const iv = /<(?:int|i4)>(-?\d+)<\/(?:int|i4)>/.exec(region);
	if (iv) return parseInt(iv[1] ?? '0', 10);
	const bv = /<boolean>([01])<\/boolean>/.exec(region);
	if (bv) return bv[1] === '1';
	const sv = /<string>([\s\S]*?)<\/string>/.exec(region);
	if (sv) return xmlUnescape(sv[1] ?? '');
	const dv = /<double>(-?[\d.eE+]+)<\/double>/.exec(region);
	if (dv) return parseFloat(dv[1] ?? '0');
	if (/<nil\s*\/>/.test(region)) return null;
	return undefined;
}

/**
 * Rozparsuje XML-RPC odpoveď: `<fault>` → hodí `OdooRpcError`; `<array>` skalárov → pole
 * (napr. `search` → id-čka); inak jeden skalár. Zámerne minimálny — nekonzumujeme nested
 * struct/array-of-struct odpovede (na to je `search` + samostatný `read`, ktorý tu nepotrebujeme).
 */
export function parseResponse(xml: string): OdooResult {
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

	// ARRAY skalárov (search → int[]): vytiahni každý <value>…</value> z <data> a sparsuj skalár.
	const arr = /<array>\s*<data>([\s\S]*?)<\/data>\s*<\/array>/.exec(region);
	if (arr) {
		const data = arr[1] ?? '';
		const out: (number | string | boolean)[] = [];
		const re = /<value>([\s\S]*?)<\/value>/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(data)) !== null) {
			const s = scalarFrom(m[1] ?? '');
			if (s !== undefined && s !== null) out.push(s);
		}
		return out;
	}

	const s = scalarFrom(region);
	if (s === undefined)
		throw new OdooRpcError('Odoo XML-RPC: nečitateľná odpoveď (žiadny skalár, pole ani fault)');
	return s;
}

// ---- Transport (fetch; injektovateľný pre testy) -----------------------------------

export type OdooTransport = (url: string, xmlBody: string) => Promise<string>;

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

let transport: OdooTransport = defaultTransport;

/** TEST hook: nahraď XML-RPC transport (mock); `null` = späť na `fetch`. Zdieľané OBOMA
 *  integráciami — každý test si nastaví svoj mock (behy sú izolované). */
export function setOdooTransport(t: OdooTransport | null): void {
	transport = t ?? defaultTransport;
}

// ---- Konfigurácia z env (lazy — test vie env nastaviť za behu) ----------------------

export interface OdooConfig {
	url: string;
	db: string;
	login: string;
	apiKey: string;
}

/** Prečíta `ODOO_LEAD_*` env; chýba ktorákoľvek zo 4 hodnôt → `null` (integrácia vypnutá). */
export function odooConfig(): OdooConfig | null {
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

async function rpc(url: string, method: string, params: XmlRpcValue[]): Promise<OdooResult> {
	return parseResponse(await transport(url, methodCall(method, params)));
}

/** Prihlásenie → uid. False/0/fault ⇒ hodí (zlé creds alebo Odoo chyba). */
export async function authenticate(cfg: OdooConfig): Promise<number> {
	const uid = await rpc(commonUrl(cfg.url), 'authenticate', [cfg.db, cfg.login, cfg.apiKey, {}]);
	if (typeof uid !== 'number' || uid <= 0)
		throw new OdooRpcError(
			'Odoo authentikácia zlyhala (skontroluj ODOO_LEAD_LOGIN / ODOO_LEAD_API_KEY)'
		);
	return uid;
}

/**
 * Generické `execute_kw(model, method, args, kwargs)`. `args` je poziciová časť (napr.
 * `[[values]]` pre create, `[domain]` pre search, `[[ids]]` pre message_post), `kwargs`
 * pomenovaná (napr. `{limit}` pre search, `{body, subtype_xmlid, …}` pre message_post).
 */
export async function executeKw(
	cfg: OdooConfig,
	uid: number,
	model: string,
	method: string,
	args: XmlRpcValue[],
	kwargs: Record<string, XmlRpcValue> = {}
): Promise<OdooResult> {
	return rpc(objectUrl(cfg.url), 'execute_kw', [
		cfg.db,
		uid,
		cfg.apiKey,
		model,
		method,
		args,
		kwargs
	]);
}

/** `execute_kw(model, 'create', [values])` → nové id (int). Pohodlný wrapper (odoo-lead). */
export async function createRecord(
	cfg: OdooConfig,
	uid: number,
	model: string,
	values: Record<string, XmlRpcValue>
): Promise<number> {
	const res = await executeKw(cfg, uid, model, 'create', [values]);
	if (typeof res !== 'number' || res <= 0)
		throw new OdooRpcError(`Odoo create ${model} nevrátil id (dostal: ${JSON.stringify(res)})`);
	return res;
}
