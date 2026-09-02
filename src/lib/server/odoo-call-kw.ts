// #5960: PER-USER Odoo transport pre „Uložiť ponuku" — dosiahne `sale.order.create_quote_from_app`
// AKO prihlásený Odoo používateľ tak, že preposiela TO ISTÉ same-origin `session_id` cookie z
// requestu do Odoo `/web/dataset/call_kw` (bare JSON-RPC, `type='jsonrpc'` — NIE zakázané legacy
// XML-RPC, #3693). Endpoint tvorí objednávku/zákazníka podľa `self.env.user` → `create_uid`/`user_id`
// sadnú na reálnu osobu, Odoo ACL + record rules ostanú hranicou izolácie dát (owner ROZHODNUTÉ
// #5808 Prístup 1, #1962 „security cornerstone"). Zdieľaný servisný `ODOO_API_KEY` (#5824/#5825) sa
// pre TÚTO user-akciu NIKDY nepoužije.
//
// BEZPEČNOSŤ (zrkadlo `odoo-sso.ts`, Fable dizajn-konzult #5960):
//  - `node:http` (NIE `fetch`/undici, ktoré `Host` PREPÍŠE) s EXPLICITNÝM `Host` z `ssoConfig()` —
//    host-based `dbfilter` by inak probe odmietol a Odoo by SPUSTIL `session.logout()` na REÁLNEJ
//    session (deštruktívne pri chybe: nie 401, ale odhlásenie používateľa).
//  - ŽIADNY `X-Forwarded-Host` — Odoo ProxyFix beží s `x_host=1`, tá hlavička by ticho prebila `Host`.
//  - FIXED-FUNCTION: allowlist PRESNE `(sale.order, create_quote_from_app)`; žiadny generický
//    `callKw(model, method, …)` (bránil by drift/zneužitiu transportu).
//  - `req.on('error')` + tvrdý deadline: nepokrytý `node:http` `error` event zhodí Node proces a
//    `node:http` nemá default timeout; promise VŽDY settlne (inak per-user hang).
//  - `Cookie: session_id=<sid>` — nikdy surová prichodzia Cookie hlavička; `sid` sa NIKDY neloguje.
//  - Návrat je JSON-RPC 2.0 obálka (`{result}` / `{error}`) — na rozdiel od `/json/2` (holý návrat).
//    `error.code==100` / `SessionExpiredException` → re-login; `UserError`/`ValidationError`/
//    `AccessError` → doslovná hláška z `error.data.message`; `error.data.debug` (traceback/cesty)
//    sa používateľovi NIKDY neukáže.
import http from 'node:http';
import https from 'node:https';
import { ssoConfig, type SsoConfig } from './odoo-sso';
import { logger } from './log';

const log = logger('odoo-call-kw');

/** Attachments môžu byť veľké (≤ agregát ~90 MB) → veľkorysý no visieť. */
const CALL_KW_TIMEOUT_MS = 30_000;

/** FIXED-FUNCTION allowlist — presne jedna (model, method). Žiadny generický call_kw. */
const QUOTE_MODEL = 'sale.order';
const QUOTE_METHOD = 'create_quote_from_app';
const CALL_KW_PATH = `/web/dataset/call_kw/${QUOTE_MODEL}/${QUOTE_METHOD}`;

/** JSON hodnota v tele / návrate (rekurzívna). */
export type OdooJson = string | number | boolean | null | OdooJson[] | { [k: string]: OdooJson };

/** Výsledok `create_quote_from_app` — návrat `{id, name, created, url}`.  `url` staviame VŽDY
 *  app-side zo známeho public base (nie z Odoo-echa), takže tu je informatívny. */
export interface OdooQuoteResult {
	id: number;
	name: string;
	created: boolean;
	/** Odoo-echoed url (informatívne; endpoint používa app-side deep-link). */
	odooUrl?: string;
	/** Rotované `session_id` z Odoo `Set-Cookie` (endpoint ho propaguje do browsera). */
	rotatedSid?: string;
	/** `Max-Age` (s) rotovaného cookie — aby si endpoint zachoval Odoo persistenciu (nie session-only). */
	rotatedMaxAge?: number;
}

// ---- Typované chyby ---------------------------------------------------------------------

/** Chýbajúci / expirovaný per-user kredenciál → UI má poslať používateľa na (re)login. */
export class QuoteAuthError extends Error {
	/** true = ŽIVÁ Odoo session vypršala (HTTP 200 + code-100) → endpoint má evict-núť SSO cache a UI
	 *  má povedať „obnov stránku"; false = SSO vypnuté / nie je Odoo používateľ (žiaden reload nepomôže). */
	readonly sessionExpired: boolean;
	constructor(message: string, sessionExpired = false) {
		super(message);
		this.name = 'QuoteAuthError';
		this.sessionExpired = sessionExpired;
	}
}

/** Odoo `UserError`/`ValidationError`/`AccessError` — hláška je bezpečná ukázať používateľovi. */
export class QuoteUserError extends Error {
	readonly odooName: string;
	constructor(message: string, odooName: string) {
		super(message);
		this.name = 'QuoteUserError';
		this.odooName = odooName;
	}
}

/** Sieť / proxy / neočakávaná Odoo chyba — používateľovi generická hláška (detail len do logu). */
export class QuoteTransportError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'QuoteTransportError';
	}
}

// ---- Config ----------------------------------------------------------------------------

/** Config transportu = SSO config (internalUrl + host). SSO vypnuté ⇒ `null` ⇒ per-user cesta
 *  nedostupná (credential-resolution v `odoo-quote.ts` to zahlási ako `QuoteAuthError`). */
export function callKwConfig(): SsoConfig | null {
	return ssoConfig();
}

// ---- Transport (node:http; injektovateľný pre testy) -----------------------------------

export interface CallKwResponse {
	status: number;
	text: string;
	/** Odoo `Set-Cookie` hlavičky (session rotation). */
	setCookie: string[];
}
export type CallKwTransport = (
	url: string,
	host: string,
	sid: string,
	bodyJson: string,
	timeoutMs: number
) => Promise<CallKwResponse>;

const trimSlash = (u: string): string => u.replace(/\/+$/, '');

function defaultTransport(
	url: string,
	host: string,
	sid: string,
	bodyJson: string,
	timeoutMs: number
): Promise<CallKwResponse> {
	const u = new URL(url);
	const lib = u.protocol === 'https:' ? https : http;
	return new Promise<CallKwResponse>((resolve, reject) => {
		let settled = false;
		function finish(err: Error | null, val?: CallKwResponse): void {
			if (settled) return;
			settled = true;
			clearTimeout(deadline);
			if (err) reject(err);
			else resolve(val as CallKwResponse);
		}
		const req = lib.request(
			{
				protocol: u.protocol,
				hostname: u.hostname,
				port: u.port,
				path: u.pathname + u.search,
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(bodyJson),
					// PLNÁ kontrola `Host` (undici fetch ju prepisuje) — dbfilter-logout míľa.
					Host: host,
					// LEN session_id — nikdy surová prichodzia Cookie (nesie am_session).
					Cookie: `session_id=${sid}`,
					'User-Agent': 'automatizacie-montalu/5960-quote'
				}
			},
			(res) => {
				let data = '';
				res.setEncoding('utf8');
				res.on('data', (c) => (data += c));
				res.on('end', () => {
					const raw = res.headers['set-cookie'];
					finish(null, {
						status: res.statusCode ?? 0,
						text: data,
						setCookie: Array.isArray(raw) ? raw : raw ? [raw] : []
					});
				});
				// server zavrie socket po hlavičkách + čiastočnom tele (worker zabitý mid-write pri
				// deploy reštarte) — 'aborted'/'error'/'close' na `res`; promise MUSÍ settlnúť.
				res.on('aborted', () => finish(new Error('call_kw response aborted (truncated)')));
				res.on('error', (e) => finish(e));
				res.on('close', () => finish(new Error('call_kw response closed before end')));
			}
		);
		// nepokrytý req 'error' zhodí Node proces — MUSÍ byť ošetrený.
		req.on('error', (e) => finish(e));
		const deadline = setTimeout(() => {
			req.destroy(new Error('call_kw deadline'));
			finish(new Error('call_kw deadline'));
		}, timeoutMs);
		req.write(bodyJson);
		req.end();
	});
}

let transport: CallKwTransport = defaultTransport;

/** TEST hook: nahraď HTTP transport (mock); `null` = späť na `node:http`. */
export function setCallKwTransport(t: CallKwTransport | null): void {
	transport = t ?? defaultTransport;
}

// ---- Envelope parsovanie / klasifikácia chýb -------------------------------------------

interface JsonRpcError {
	code?: unknown;
	message?: unknown;
	data?: {
		name?: unknown;
		message?: unknown;
		debug?: unknown;
		arguments?: unknown;
	};
}

/** JSON-RPC 2.0 obálka z `/web/dataset/call_kw` (`{result}` alebo `{error}`). */
interface CallKwEnvelope {
	result?: OdooJson;
	error?: JsonRpcError;
}

const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');

/** HTTP 200 + JSON-RPC `error` obálka → typovaná chyba. Klasifikácia podľa `error.data.name`
 *  (top-level `error.message` je generické „Odoo Server Error"). */
function throwFromRpcError(err: JsonRpcError): never {
	const data = err.data ?? {};
	const name = asStr(data.name);
	const code = err.code;
	// Expirovaná/neplatná session: HTTP 200 + code 100 + SessionExpiredException → sessionExpired=true.
	if (code === 100 || /SessionExpiredException/i.test(name)) {
		throw new QuoteAuthError('Odoo session vypršala — obnov stránku a skús to ešte raz.', true);
	}
	// Bezpečné-ukázať chyby: doslovná hláška z `error.data.message` (fallback arguments[0]).
	const args = Array.isArray(data.arguments) ? data.arguments : [];
	const userMsg = asStr(data.message) || (typeof args[0] === 'string' ? args[0] : '');
	if (/UserError|ValidationError|AccessError/i.test(name)) {
		throw new QuoteUserError(
			userMsg || 'Odoo odmietlo ponuku (bez detailu).',
			name || 'OdooUserError'
		);
	}
	// Ostatné: NIKDY neukáž `error.data.debug` (traceback/cesty) — generická hláška, detail do logu.
	log.error('call_kw neočakávaná Odoo chyba', {
		name: name || undefined,
		code: typeof code === 'number' ? code : undefined
	});
	throw new QuoteTransportError('Odoo vrátilo neočakávanú chybu pri ukladaní ponuky.');
}

function parseResult(res: CallKwResponse): OdooQuoteResult {
	if (res.status !== 200) {
		// nginx 502 HTML / 413 / iné — nie JSON-RPC obálka.
		log.warn('call_kw non-200 z Odoo', { status: res.status });
		if (res.status === 413) {
			throw new QuoteTransportError('Prílohy sú príliš veľké — zmenši ich a skús znova.');
		}
		throw new QuoteTransportError(`Odoo nedostupné pri ukladaní ponuky (HTTP ${res.status}).`);
	}
	let env: CallKwEnvelope | null;
	try {
		env = res.text ? (JSON.parse(res.text) as CallKwEnvelope) : null;
	} catch {
		throw new QuoteTransportError('Odoo vrátilo neplatnú odpoveď pri ukladaní ponuky.');
	}
	if (!env) throw new QuoteTransportError('Odoo vrátilo prázdnu odpoveď pri ukladaní ponuky.');
	if (env.error) throwFromRpcError(env.error);
	const r = env.result;
	if (!r || typeof r !== 'object' || Array.isArray(r)) {
		throw new QuoteTransportError('Odoo vrátilo neočakávaný výsledok pri ukladaní ponuky.');
	}
	const o = r as { id?: unknown; name?: unknown; created?: unknown; url?: unknown };
	const id = typeof o.id === 'number' && Number.isInteger(o.id) && o.id > 0 ? o.id : 0;
	const name = asStr(o.name);
	if (!id || !name) {
		throw new QuoteTransportError('Odoo nevrátilo id/číslo objednávky.');
	}
	const rot = extractRotatedSid(res.setCookie);
	return {
		id,
		name,
		created: o.created === true,
		odooUrl: asStr(o.url) || undefined,
		rotatedSid: rot?.sid,
		rotatedMaxAge: rot?.maxAge
	};
}

/** Z Odoo `Set-Cookie` vytiahni prípadné rotované `session_id` + jeho `Max-Age` (endpoint ho pošle
 *  browseru so zachovanou persistenciou). Iné cookie sa ignorujú. */
function extractRotatedSid(setCookie: string[]): { sid: string; maxAge?: number } | undefined {
	for (const c of setCookie) {
		const m = /^session_id=([^;]+)/.exec(c);
		if (m && m[1]) {
			const ma = /(?:^|;)\s*Max-Age=(\d+)/i.exec(c);
			return { sid: m[1], maxAge: ma ? Number(ma[1]) : undefined };
		}
	}
	return undefined;
}

// ---- Fixed-function call ---------------------------------------------------------------

/**
 * Zavolá `sale.order.create_quote_from_app(**payload)` AKO používateľ vlastniaci `sid` (session
 * cookie), cez `/web/dataset/call_kw`. `payload` je server-postavené kwargs (nikdy klientom
 * dodaný `context`/`args`). Hádže `QuoteAuthError` (SSO off / session expirovaná), `QuoteUserError`
 * (doslovná Odoo hláška) alebo `QuoteTransportError` (sieť/proxy/neočakávané).
 */
export async function createQuoteAsUser(
	payload: Record<string, OdooJson>,
	sid: string
): Promise<OdooQuoteResult> {
	const cfg = callKwConfig();
	if (!cfg) {
		throw new QuoteAuthError('Ukladanie do Odoo nie je nakonfigurované (SSO vypnuté).');
	}
	const url = `${trimSlash(cfg.internalUrl)}${CALL_KW_PATH}`;
	// JSON-RPC 2.0 obálka: model/method sú fixné (allowlist), args prázdne, kwargs = payload.
	const body = JSON.stringify({
		jsonrpc: '2.0',
		method: 'call',
		params: { model: QUOTE_MODEL, method: QUOTE_METHOD, args: [], kwargs: payload }
	});
	let res: CallKwResponse;
	try {
		res = await transport(url, cfg.host, sid, body, CALL_KW_TIMEOUT_MS);
	} catch (e) {
		// sieťová/timeout chyba — sid ani telo sa NELOGUJÚ.
		log.warn('call_kw transport chyba', { err: e instanceof Error ? e.message : String(e) });
		throw new QuoteTransportError('Odoo je momentálne nedostupné — skús ponuku uložiť o chvíľu.');
	}
	return parseResult(res);
}
