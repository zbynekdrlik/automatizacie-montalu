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

// #532: `narezak_v2` groundwork (za flagom `ODOO_NAREZ_LINES_V2`) je ODSTRÁNENÝ — nahradený
// `cut_plan` (`narezak-cut-plan.ts`), ktorý ide VŽDY (bez flagu), keď nárezák má tyče s Money kódom.

/**
 * #532 R2 KILL SWITCH: `ODOO_NAREZ_CUT_PLAN` — `0`/`false` (case-insensitive, orezané medzery) úplne
 * VYPNE posielanie `cut_plan` v `montalu_narezak_upload` (fallback na `lines`+PDF). Default ON (env
 * neset alebo čokoľvek iné). Použi keď PROD Odoo `cut_plan` odmieta a chceš vypnúť aj reaktívny
 * 422-retry (napr. znížiť latenciu), kým odoo-erp#7431 nepristane. Bezpečný default: ZAPNUTÉ.
 */
export function isCutPlanEnabled(): boolean {
	const v = (process.env.ODOO_NAREZ_CUT_PLAN ?? '').trim().toLowerCase();
	return v !== '0' && v !== 'false';
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
	kwargs: Record<string, unknown> = {},
	opts: { timeoutMs?: number } = {}
): Promise<unknown> {
	const url = `${cfg.url.replace(/\/+$/, '')}/json/2/${model}/${method}`;
	// /json/2 (Odoo 19 External JSON-2 API): the request body IS the kwargs object —
	// NO JSON-RPC 2.0 envelope. Wrapping in {jsonrpc, method, params} made Odoo receive
	// the keys jsonrpc/method/id/params as kwargs and every named arg as missing
	// (PROD 7.9.: 422 "Chýba order_number"). Refs odoo-erp #6385.
	const body = JSON.stringify(kwargs);

	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
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
		// /json/2 success body = the method's return value DIRECTLY (no {result} wrapper);
		// errors arrive as HTTP 4xx/5xx (handled above). Keep the legacy {result}/{error}
		// shape tolerated for any JSON-RPC-style proxy in front of Odoo.
		if (
			parsed &&
			typeof parsed === 'object' &&
			!Array.isArray(parsed) &&
			'error' in parsed &&
			parsed.error
		) {
			const errData = parsed.error;
			throw new OdooJson2Error(
				`Odoo JSON-2 error ${errData.code}: ${errData.message}`,
				errData.code
			);
		}
		log.debug('json/2 volanie OK', { model, method });
		if (
			parsed &&
			typeof parsed === 'object' &&
			!Array.isArray(parsed) &&
			'result' in parsed &&
			('jsonrpc' in parsed || Object.keys(parsed).length === 1)
		) {
			return parsed.result;
		}
		return parsed;
	} finally {
		clearTimeout(timer);
	}
}

/** Voliteľné parametre `search_read` (#540). */
export interface SearchReadOpts {
	order?: string;
	limit?: number;
	offset?: number;
	context?: Record<string, unknown>;
	/** Per-volanie timeout (ms) pre callJson2; nezaraďuje sa do kwargs. Default 15 s (DEFAULT_TIMEOUT_MS). */
	timeoutMs?: number;
}

/**
 * Generický READ cez Odoo External JSON-2 `search_read` (#540). Tenká vrstva nad `callJson2` s
 * rovnakou auth/env ako uploady (bearer kľúč sám identifikuje volajúceho). Vracia pole záznamov
 * (prázdne, keď odpoveď nie je pole). Hodí `OdooJson2Error` pri HTTP/JSON-RPC chybe — volajúci
 * rieši fallback (napr. `fetchGlassTypes`). Money-neutrálne: read-only.
 */
export async function searchReadJson2(
	cfg: OdooJson2Config,
	model: string,
	domain: unknown[],
	fields: string[],
	opts: SearchReadOpts = {}
): Promise<Record<string, unknown>[]> {
	const kwargs: Record<string, unknown> = { domain, fields };
	if (opts.order != null) kwargs.order = opts.order;
	if (opts.limit != null) kwargs.limit = opts.limit;
	if (opts.offset != null) kwargs.offset = opts.offset;
	if (opts.context != null) kwargs.context = opts.context;
	const res = await callJson2(cfg, model, 'search_read', kwargs, { timeoutMs: opts.timeoutMs });
	return Array.isArray(res) ? (res as Record<string, unknown>[]) : [];
}

// --- #532 R2: montalu_narezak_upload s cut_plan 422 fallbackom ----------------------------------- //

/** Výsledok `uploadNarezak`. `cutPlanAccepted` = cut_plan bol poslaný a Odoo ho prijal (upload bez
 *  422). `cutPlanRejected` = cut_plan bol poslaný, Odoo ho odmietol 422 „Neznámy parameter" a upload
 *  sa zopakoval BEZ neho (lines+PDF doručené). Oba false = cut_plan sa neposlal (žiadny / kill switch). */
export interface NarezakUploadResult {
	result: unknown;
	cutPlanAccepted: boolean;
	cutPlanRejected: boolean;
}

/**
 * Tolerantný match na PROD 422 „Neznámy parameter: cut_plan" (odoo-erp `sale_order_narezak.py`
 * `ValidationError(_("Neznámy parameter: %s"))`, raise PRED lookupom objednávky). `nezn\S*my` znesie
 * literálnu aj `á`-escapovanú diakritiku; `[\s\S]*` znesie ďalšie neznáme kľúče pred `cut_plan`.
 */
const CUT_PLAN_UNKNOWN_RE = /nezn\S*my\s+parameter:[\s\S]*cut_plan/i;

/** „warn raz za proces" state — cut_plan odmietnutie 422 sa loguje LEN pri prvom výskyte za beh. */
let _cutPlanRejectWarned = false;

/** TEST hook: vynuluj „warn raz za proces" state (aby ďalší test videl warn znova). */
export function _resetCutPlanRejectWarn(): void {
	_cutPlanRejectWarned = false;
}

/**
 * Nahrá `montalu_narezak_upload` s reaktívnym `cut_plan` 422 fallbackom (#532 R2). PROD Odoo bez
 * odoo-erp#7431 odmieta neznámy top-level kľúč `cut_plan` HTTP 422 → zopakuj TEN ISTÝ upload BEZ
 * `cut_plan` (lines+PDF vždy doručené), warn RAZ za proces. Kill switch `ODOO_NAREZ_CUT_PLAN=0/false`
 * odstráni `cut_plan` ešte pred prvým pokusom (žiadny 422, žiadny retry).
 *
 * Iné chyby (iná 422, 4xx/5xx, timeout) sa NEretry-ujú — hodia sa volajúcemu nezmenené.
 */
export async function uploadNarezak(
	cfg: OdooJson2Config,
	kwargs: Record<string, unknown>
): Promise<NarezakUploadResult> {
	const wantsCutPlan = kwargs.cut_plan != null;

	// Kill switch: cut_plan sa vôbec nepošle (fallback na lines+PDF). Nič sa neposlalo → ani accepted
	// ani rejected.
	if (wantsCutPlan && !isCutPlanEnabled()) {
		const { cut_plan: _off, ...rest } = kwargs;
		const result = await callJson2(cfg, 'sale.order', 'montalu_narezak_upload', rest);
		return { result, cutPlanAccepted: false, cutPlanRejected: false };
	}

	try {
		const result = await callJson2(cfg, 'sale.order', 'montalu_narezak_upload', kwargs);
		return { result, cutPlanAccepted: wantsCutPlan, cutPlanRejected: false };
	} catch (e) {
		if (
			wantsCutPlan &&
			e instanceof OdooJson2Error &&
			e.status === 422 &&
			CUT_PLAN_UNKNOWN_RE.test(e.message)
		) {
			if (!_cutPlanRejectWarned) {
				log.warn(
					'montalu_narezak_upload: cut_plan zatiaľ nie je akceptovaný týmto Odoo (422 Neznámy ' +
						'parameter) — posielam bez cut_plan (lines+PDF); re-run po nasadení odoo-erp#7431'
				);
				_cutPlanRejectWarned = true;
			}
			const { cut_plan: _drop, ...rest } = kwargs;
			const result = await callJson2(cfg, 'sale.order', 'montalu_narezak_upload', rest);
			return { result, cutPlanAccepted: false, cutPlanRejected: true };
		}
		throw e;
	}
}
