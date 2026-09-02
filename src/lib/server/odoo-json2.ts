// #5824: Odoo 19 External JSON-2 API klient (`POST <host>/json/2/<model>/<method>`,
// hlavička `Authorization: bearer <api-key>`). Nahrádza legacy XML-RPC (`odoo-rpc.ts`),
// ktoré je v odoo-erp zakázané (#3693, Odoo ho v 22 odstráni). Kľúč SÁM identifikuje
// volajúceho → žiadny `authenticate`/uid, žiadne DB/LOGIN (single-DB host `erp.montalu.cloud`
// nepotrebuje `X-Odoo-Database`). Zrkadlo referencie odoo-erp `services/mcp/.../odoo_client.py`
// (`_post_json2`): úspech 200 = priamo JSON return value (bez `{result}` obálky); chyba 4xx/5xx
// = JSON `{name,message,arguments,context,debug}`.
//
// CREDENTIALS: LEN runtime env (`ODOO_URL`/`ODOO_API_KEY`), NIKDY v gite; chýba ktorákoľvek ⇒
// `null` (json2 sa neaktivuje → selektor spadne na XML-RPC fallback, `odoo-backend.ts`).
//
// Transport je injektovateľný (test mock na HTTP hranici, rovnaká disciplína ako
// `setOdooTransport` v odoo-rpc.ts). Timeout 10 s (integrácia nesmie visieť).

/** JSON hodnota idúca do tela / vracajúca sa z Odoo (rekurzívna). */
export type Json2Value =
	string | number | boolean | null | Json2Value[] | { [k: string]: Json2Value };

export class OdooJson2Error extends Error {
	/** Plne kvalifikovaná Odoo výnimka (napr. `odoo.exceptions.AccessError`), ak ju server vrátil. */
	readonly odooName: string;
	constructor(message: string, odooName = 'OdooJson2Error') {
		super(message);
		this.name = 'OdooJson2Error';
		this.odooName = odooName;
	}
}

const DEFAULT_TIMEOUT_MS = 10_000;

export interface Json2Config {
	url: string;
	apiKey: string;
}

/** Prečíta `ODOO_URL` + `ODOO_API_KEY`; chýba ktorákoľvek ⇒ `null` (json2 vypnuté). */
export function json2Config(): Json2Config | null {
	const url = process.env.ODOO_URL;
	const apiKey = process.env.ODOO_API_KEY;
	if (!url || !apiKey) return null;
	return { url, apiKey };
}

const trimSlash = (u: string) => u.replace(/\/+$/, '');

// ---- Transport (fetch; injektovateľný pre testy) -----------------------------------

export interface Json2Response {
	status: number;
	text: string;
}
export type Json2Transport = (
	url: string,
	bodyJson: string,
	apiKey: string
) => Promise<Json2Response>;

async function defaultTransport(
	url: string,
	bodyJson: string,
	apiKey: string
): Promise<Json2Response> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: {
				Authorization: `bearer ${apiKey}`,
				'Content-Type': 'application/json; charset=utf-8',
				'User-Agent': 'automatizacie-montalu/5824'
			},
			body: bodyJson,
			signal: ctrl.signal
		});
		return { status: res.status, text: await res.text() };
	} finally {
		clearTimeout(timer);
	}
}

let transport: Json2Transport = defaultTransport;

/** TEST hook: nahraď HTTP transport (mock); `null` = späť na `fetch`. */
export function setJson2Transport(t: Json2Transport | null): void {
	transport = t ?? defaultTransport;
}

// ---- Volanie -----------------------------------------------------------------------

/**
 * `POST /json/2/<model>/<method>` s telom pomenovaných argumentov (`body`). Vráti priamo
 * parsnutú JSON návratovú hodnotu metódy (bez `{result}` obálky). Chyba 4xx/5xx → `OdooJson2Error`
 * s Odoo `name`/`message` z JSON error objektu (fallback na surový text). Prázdna 200 odpoveď → `null`.
 */
// #5824 review W1 (#278 parita): XML-RPC path strippuje C0 control znaky z KAŽDÉHO stringu na
// drôte (xmlEscape v encodeValue) — poison-pill obrana. json2 `JSON.stringify` prepustí `\u0000`
// → psycopg2 „string literal cannot contain NUL" → 500 → lead sa nikdy nezrkadlí. Vyčisti string
// listy tela (okrem \t\n\r) PRED serializáciou, byte-zhodne s xmlEscape C0 strip.
function scrubControlChars(v: Json2Value): Json2Value {
	if (typeof v === 'string')
		// eslint-disable-next-line no-control-regex
		return v.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
	if (Array.isArray(v)) return v.map(scrubControlChars);
	if (v && typeof v === 'object') {
		const out: { [k: string]: Json2Value } = {};
		for (const [k, val] of Object.entries(v)) out[k] = scrubControlChars(val);
		return out;
	}
	return v;
}

export async function odooJson2(
	cfg: Json2Config,
	model: string,
	method: string,
	body: Record<string, Json2Value>
): Promise<Json2Value> {
	const url = `${trimSlash(cfg.url)}/json/2/${model}/${method}`;
	const scrubbed = scrubControlChars(body) as Record<string, Json2Value>;
	const { status, text } = await transport(url, JSON.stringify(scrubbed), cfg.apiKey);
	if (status >= 400) {
		let name = 'OdooJson2Error';
		let msg = text.slice(0, 400);
		try {
			const err = JSON.parse(text) as {
				name?: string;
				message?: string;
				debug?: string;
				arguments?: unknown;
			};
			if (err && typeof err === 'object') {
				name = err.name || name;
				// #5824 review S1: Odoo `message` BÝVA PRÁZDNE (skutočný text je v `debug`) → fallback,
				// inak `odoo_last_error` = „Odoo crm.lead.create 500: " bez info.
				msg =
					err.message || err.debug || (err.arguments ? JSON.stringify(err.arguments) : '') || msg;
			}
		} catch {
			// nie JSON — nechaj surový text ako správu
		}
		throw new OdooJson2Error(`Odoo ${model}.${method} ${status}: ${msg}`, name);
	}
	if (!text) return null;
	try {
		return JSON.parse(text) as Json2Value;
	} catch {
		// #5824 review S1: 200 s ne-JSON telom (napr. proxy HTML) → obal ako OdooJson2Error,
		// nie holý SyntaxError (retry vrstva očakáva OdooJson2Error).
		throw new OdooJson2Error(
			`Odoo ${model}.${method} 200: neplatný JSON v odpovedi: ${text.slice(0, 200)}`
		);
	}
}
