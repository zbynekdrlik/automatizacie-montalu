// Odoo 19 External JSON-2 API klient (#6385 noha 2, #5808 noha 3).
//
// ODOO_JSON2_URL       — base URL Odoo inštancie (napr. https://erp.montalu.cloud)
// ODOO_JSON2_API_KEY   — bearer API kľúč (api-key z Odoo Settings → API Keys)
//
// Transport: POST /json/2/<model>/<method> s `Authorization: bearer <key>`.
// Kľúč sám identifikuje volajúceho — žiadny login/authenticate krok. Legacy XML-RPC
// je BANNED (#3693, CLAUDE.md), preto je tento klient ODDELENÝ od odoo-rpc.ts.
//
// BEZSTAVOVÝ: žiadny uid cache, žiadna session — každý request nesie bearer hlavičku.
// Timeout 15 s (rovnaký rad ako XML-RPC klient v odoo-rpc.ts).
//
// Reusable pre VŠETKY json/2 volania (get_prices, narezak_upload, budúca migrácia).
import { logger } from './log';

const log = logger('odoo-json2');

const DEFAULT_TIMEOUT_MS = 15_000;

export interface OdooJson2Config {
	url: string;
	apiKey: string;
}

/** Backward-compat alias pre #5808 (odoo-prices.ts). */
export type Json2Config = OdooJson2Config;

/** Prečíta JSON-2 env; chýba ktorákoľvek → `null` (integrácia vypnutá). */
export function odooJson2Config(): OdooJson2Config | null {
	const url = process.env.ODOO_JSON2_URL;
	const apiKey = process.env.ODOO_JSON2_API_KEY;
	if (!url || !apiKey) return null;
	return { url, apiKey };
}

/** Backward-compat alias pre #5808. */
export const json2Config = odooJson2Config;

/** Feature flag pre nárezák upload — default OFF kým sa na PROD neuvedie. */
export function isNarezUploadEnabled(): boolean {
	return process.env.ODOO_NAREZ_UPLOAD_ENABLED === '1';
}

export class OdooJson2Error extends Error {
	status: number;
	constructor(message: string, status: number = 0) {
		super(message);
		this.name = 'OdooJson2Error';
		this.status = status;
	}
}

export interface OdooJson2Result {
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}

/** Injektovateľný fetch pre testy. */
type FetchFn = typeof globalThis.fetch;
let _transport: FetchFn = globalThis.fetch;

/** TEST hook: nahraď fetch (mock); `null` = späť na globalný `fetch`. */
export function setJson2Transport(fn: FetchFn | null): void {
	_transport = fn ?? globalThis.fetch;
}

/**
 * Zavolá Odoo External JSON-2 API: POST /json/2/<model>/<method>.
 * Bearer auth (kľúč sám identifikuje usera). Vracia `result` z JSON-RPC odpovede.
 * Hodí `OdooJson2Error` pri HTTP chybe alebo JSON-RPC error.
 */
export async function callJson2(
	cfg: OdooJson2Config,
	model: string,
	method: string,
	kwargs: Record<string, unknown> = {}
): Promise<unknown> {
	const url = `${cfg.url.replace(/\/+$/, '')}/json/2/${model}/${method}`;
	const body = JSON.stringify({
		jsonrpc: '2.0',
		method: 'call',
		id: 1,
		params: kwargs
	});

	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
	try {
		const res = await _transport(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `bearer ${cfg.apiKey}`
			},
			body,
			signal: ctrl.signal
		});
		const text = await res.text();
		if (!res.ok) {
			throw new OdooJson2Error(
				`Odoo JSON-2 HTTP ${res.status} ${res.statusText}: ${text.slice(0, 500)}`,
				res.status
			);
		}
		let parsed: OdooJson2Result;
		try {
			parsed = JSON.parse(text) as OdooJson2Result;
		} catch {
			throw new OdooJson2Error(`Odoo JSON-2: nevalidný JSON v odpovedi: ${text.slice(0, 300)}`, 0);
		}
		if (parsed.error) {
			const errData = parsed.error;
			throw new OdooJson2Error(
				`Odoo JSON-2 error ${errData.code}: ${errData.message}`,
				errData.code
			);
		}
		log.debug('json/2 volanie OK', { model, method });
		return parsed.result;
	} finally {
		clearTimeout(timer);
	}
}
