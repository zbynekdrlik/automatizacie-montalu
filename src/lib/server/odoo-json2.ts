// #5808 noha 3: minimalistický Odoo External JSON-2 API klient.
//
// `POST /json/2/<model>/<method>` s `Authorization: bearer <api-key>`.
// Env: `ODOO_JSON2_URL` (base URL, napr. `https://erp.montalu.cloud`),
//      `ODOO_JSON2_API_KEY` (per-user bearer token).
//
// Reusable pre VŠETKY budúce json/2 volania (get_prices, budúca XML-RPC
// migrácia zákazka/expedícia/lead). Transport je injektovateľný pre testy
// (rovnaký vzor ako `odoo-rpc.ts::setOdooTransport`).
import { logger } from './log';

const log = logger('odoo-json2');

/** Timeout jedného json/2 volania — integrácia nesmie visieť. */
const DEFAULT_TIMEOUT_MS = 15_000;

export class OdooJson2Error extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'OdooJson2Error';
	}
}

export interface Json2Config {
	url: string;
	apiKey: string;
}

/** Prečíta `ODOO_JSON2_*` env; chýba ktorákoľvek → `null` (integrácia vypnutá). */
export function json2Config(): Json2Config | null {
	const url = process.env.ODOO_JSON2_URL;
	const apiKey = process.env.ODOO_JSON2_API_KEY;
	if (!url || !apiKey) return null;
	return { url, apiKey };
}

// ---- Transport (injektovateľný pre testy) ------------------------------------

export type Json2Transport = (url: string, body: string, headers: Record<string, string>) => Promise<{
	status: number;
	text: string;
}>;

async function defaultTransport(
	url: string,
	body: string,
	headers: Record<string, string>
): Promise<{ status: number; text: string }> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...headers },
			body,
			signal: ctrl.signal
		});
		const text = await res.text();
		return { status: res.status, text };
	} finally {
		clearTimeout(timer);
	}
}

let transport: Json2Transport = defaultTransport;

/** TEST hook: nahraď HTTP transport (mock); `null` = späť na `fetch`. */
export function setJson2Transport(t: Json2Transport | null): void {
	transport = t ?? defaultTransport;
}

// ---- Volanie -----------------------------------------------------------------

/**
 * Zavolá Odoo External JSON-2 API: `POST <baseUrl>/json/2/<model>/<method>`.
 *
 * Request body (named args): `{"kwargs": {...}}`.
 * Response: `{"result": <data>}` na úspech, `{"error": {...}}` na chybu.
 *
 * @returns Rozparsovaný `result` z odpovede.
 * @throws OdooJson2Error na HTTP chybu, Odoo error response, alebo parse error.
 */
export async function callJson2<T = unknown>(
	cfg: Json2Config,
	model: string,
	method: string,
	kwargs: Record<string, unknown> = {}
): Promise<T> {
	const endpoint = `${cfg.url.replace(/\/+$/, '')}/json/2/${model}/${method}`;
	const payload = JSON.stringify({ kwargs });
	const headers = { Authorization: `bearer ${cfg.apiKey}` };

	let res: { status: number; text: string };
	try {
		res = await transport(endpoint, payload, headers);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		throw new OdooJson2Error(`json/2 ${model}.${method}: sieťová chyba — ${msg}`);
	}

	if (res.status !== 200) {
		throw new OdooJson2Error(
			`json/2 ${model}.${method}: HTTP ${res.status} — ${res.text.slice(0, 300)}`
		);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(res.text);
	} catch {
		throw new OdooJson2Error(
			`json/2 ${model}.${method}: neplatný JSON — ${res.text.slice(0, 200)}`
		);
	}

	const obj = parsed as Record<string, unknown>;

	// Odoo error response shape: {"error": {"message": "...", "data": {...}}}
	if (obj.error) {
		const err = obj.error as Record<string, unknown>;
		const data = (err.data ?? {}) as Record<string, unknown>;
		const msg = typeof err.message === 'string' ? err.message : JSON.stringify(err);
		const name = typeof data.name === 'string' ? data.name : '';
		throw new OdooJson2Error(
			`json/2 ${model}.${method}: Odoo error${name ? ` (${name})` : ''} — ${msg}`
		);
	}

	if (!('result' in obj)) {
		throw new OdooJson2Error(
			`json/2 ${model}.${method}: odpoveď nemá "result" kľúč — ${res.text.slice(0, 200)}`
		);
	}

	log.debug('json/2 volanie OK', { model, method });
	return obj.result as T;
}
