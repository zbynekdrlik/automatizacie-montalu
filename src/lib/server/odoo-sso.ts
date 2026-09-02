// #5823: SSO cez Odoo session. Appka beží ako same-origin sidecar pod `/automatizacie/` v Odoo
// webclient iframe (epic odoo-erp#5808) → dostáva Odoo `session_id` cookie s každou požiadavkou.
// Tu ju overíme voči Odoo (`POST /web/session/get_session_info`, forwardneme LEN tú cookie) a
// namapujeme na EFEMÉRNU internú identitu (`SessionUser`, `source:'odoo'`) — bez zápisu do SQLite
// `users` (per design komentár #5823 + `access-control.md §4`; `user.id` sa v routách nekonzumuje).
//
// ENV-GATED (live-safe): aktívne LEN keď `ODOO_SSO_ENABLED === '1'` A `ODOO_INTERNAL_URL` nastavené.
// Chýba ktorékoľvek ⇒ `ssoConfig() === null` ⇒ SSO vetva sa v `hooks.server.ts` NIKDY nevykoná ⇒
// dnešné (lokálny login) správanie byte-identické.
//
// BEZPEČNOSŤ (Fable dizajn-konzult #5823):
//  - IBA cookie je klientom riadený vstup — NIKDY nečítaj klientsku hlavičku ako claim; forwardni
//    LEN `Cookie: session_id=<sid>` (nikdy surovú prichodziu Cookie hlavičku — nesie `am_session`).
//  - `sid` gatuj regexom PRED forwardom (ohraničí cache kľúč, bráni header-injection, odmietne junk).
//  - Akceptuj ako prihláseného interného Odoo používateľa LEN keď HTTP 200 ∧ JSON-RPC `result` ∧
//    `uid` kladné celé ∧ `is_internal_user === true` ∧ neprázdny string `username`. Expirovaná
//    session ide ako HTTP 200 + `error` (SessionExpiredException) — NORMÁLNA cesta → `null`.
//  - dbfilter-logout míľa: pošli konfigurovateľnú `Host` hlavičku (`ODOO_SSO_HOST`) na internej
//    adrese — host-based `dbfilter` by inak probe odmietol a Odoo by SPUSTIL `session.logout()` na
//    reálnej session. Node `fetch` (undici) `Host` hlavičku PREPÍŠE, preto default transport používa
//    `node:http`/`node:https` (plná kontrola nad `Host`).
//  - Cache: kľúč = `sha256(sid)` (nie surové tajomstvo), LRU-ohraničená, in-flight dedup, pozitívny
//    TTL ~5 min, negatívny TTL ~45 s (Odoo dole ⇒ appka inak fakticky dole; bezpečné, lebo Odoo
//    rotuje `sid` pri logine/logoute).
//  - Exception-proof: akýkoľvek throv v `handle` = 500 pre celú appku → `resolveOdooSso` obalený,
//    pri chybe `null`. `session_id` ani `session_info` výsledok sa NIKDY nelogujú.
//
// Transport je injektovateľný (test mock na HTTP hranici — vzor `setJson2Transport`/`setOdooTransport`).
import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { logger } from './log';
import type { SessionUser } from './auth';

const log = logger('odoo-sso');

/** Odoo session cookie — same-origin (`/automatizacie/*` dostáva `session_id` z `erp.montalu.cloud`). */
export const ODOO_SESSION_COOKIE = 'session_id';

const SSO_TIMEOUT_MS = 3_000; // request hot-path — nesmie visieť
const POS_TTL_MS = 5 * 60 * 1000; // platná identita
const NEG_TTL_MS = 45 * 1000; // pád/expirácia/non-internal — bráni hameraniu Odoo pri výpadku
const CACHE_MAX = 500; // LRU strop — bez neho je striekanie náhodných session_id memory-DoS
/** `session_id` (Odoo) je URL-safe base64-ish token; ohraničí cache kľúč + bráni header-injection. */
const SID_RE = /^[A-Za-z0-9_-]{16,128}$/;
const DEFAULT_SSO_HOST = 'erp.montalu.cloud';

export interface SsoConfig {
	internalUrl: string;
	host: string;
}

/** Prečíta SSO env; vypnuté (`ODOO_SSO_ENABLED!=='1'` alebo chýba `ODOO_INTERNAL_URL`) ⇒ `null`. */
export function ssoConfig(): SsoConfig | null {
	if (process.env.ODOO_SSO_ENABLED !== '1') return null;
	const internalUrl = process.env.ODOO_INTERNAL_URL;
	if (!internalUrl) return null;
	return { internalUrl, host: process.env.ODOO_SSO_HOST || DEFAULT_SSO_HOST };
}

/** `true` keď je SSO zapnuté — pre lacnú gate v `hooks.server.ts` pred čítaním cookie. */
export function ssoEnabled(): boolean {
	return ssoConfig() !== null;
}

// ---- Transport (node:http; injektovateľný pre testy) --------------------------------

export interface SsoResponse {
	status: number;
	text: string;
}
export type SsoTransport = (
	url: string,
	host: string,
	sid: string,
	timeoutMs: number
) => Promise<SsoResponse>;

const trimSlash = (u: string) => u.replace(/\/+$/, '');

function defaultTransport(
	url: string,
	host: string,
	sid: string,
	timeoutMs: number
): Promise<SsoResponse> {
	const u = new URL(url);
	const lib = u.protocol === 'https:' ? https : http;
	const body = JSON.stringify({ jsonrpc: '2.0', method: 'call', params: {} });
	return new Promise<SsoResponse>((resolve, reject) => {
		const req = lib.request(
			{
				protocol: u.protocol,
				hostname: u.hostname,
				port: u.port,
				path: u.pathname + u.search,
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(body),
					// PLNÁ kontrola `Host` (undici fetch ju prepisuje) — dbfilter-logout míľa.
					Host: host,
					// LEN session_id — nikdy surová prichodzia Cookie (nesie am_session).
					Cookie: `${ODOO_SESSION_COOKIE}=${sid}`,
					'User-Agent': 'automatizacie-montalu/5823-sso'
				},
				timeout: timeoutMs
			},
			(res) => {
				let data = '';
				res.setEncoding('utf8');
				res.on('data', (c) => (data += c));
				res.on('end', () => resolve({ status: res.statusCode ?? 0, text: data }));
			}
		);
		req.on('timeout', () => req.destroy(new Error('sso get_session_info timeout')));
		req.on('error', reject);
		req.write(body);
		req.end();
	});
}

let transport: SsoTransport = defaultTransport;

/** TEST hook: nahraď HTTP transport (mock); `null` = späť na `node:http`. */
export function setSsoTransport(t: SsoTransport | null): void {
	transport = t ?? defaultTransport;
}

// ---- LRU cache (sha256(sid) → verdikt) ----------------------------------------------

interface CacheEntry {
	user: SessionUser | null;
	exp: number;
}
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<SessionUser | null>>();

const hashSid = (sid: string) => createHash('sha256').update(sid).digest('hex');

function cacheStore(key: string, user: SessionUser | null, ttlMs: number): void {
	cache.delete(key); // re-insert na koniec (Map drží poradie vloženia = LRU)
	cache.set(key, { user, exp: Date.now() + ttlMs });
	// evikuj najstaršie kým sme nad stropom (prvý kľúč = najdlhšie nepoužitý)
	while (cache.size > CACHE_MAX) {
		const oldest = cache.keys().next().value;
		if (oldest === undefined) break;
		cache.delete(oldest);
	}
}

// ---- Resolver -----------------------------------------------------------------------

/**
 * Overí Odoo `session_id` a vráti efemérnu `SessionUser` (`source:'odoo'`, `id=-uid`) alebo `null`
 * (SSO vypnuté / chýbajúca-alebo-junk cookie / expirovaná-neinterná session / Odoo pád). NIKDY nehádže
 * (exception-proof — throv v `handle` = 500 pre celú appku). Volajúci (`hooks.server.ts`) berie `null`
 * ako „prejdi na lokálny login".
 */
export async function resolveOdooSso(sid: string | undefined): Promise<SessionUser | null> {
	try {
		const cfg = ssoConfig();
		if (!cfg || !sid || !SID_RE.test(sid)) return null; // junk/malformed → žiadny Odoo call, žiadna cache
		const key = hashSid(sid);
		const now = Date.now();
		const hit = cache.get(key);
		if (hit && hit.exp > now) {
			cache.delete(key); // LRU touch
			cache.set(key, hit);
			return hit.user;
		}
		const existing = inflight.get(key);
		if (existing) return existing; // in-flight dedup (thundering herd pri prvom painte iframe)
		const p = doResolve(cfg, sid, key).finally(() => inflight.delete(key));
		inflight.set(key, p);
		return p;
	} catch (e) {
		log.error('sso resolve neočakávane hodil (ignorované — prejde na lokálny login)', {
			err: e instanceof Error ? e.message : String(e)
		});
		return null;
	}
}

interface SessionInfo {
	uid?: unknown;
	is_internal_user?: unknown;
	username?: unknown;
}

async function doResolve(cfg: SsoConfig, sid: string, key: string): Promise<SessionUser | null> {
	const url = `${trimSlash(cfg.internalUrl)}/web/session/get_session_info`;
	try {
		const { status, text } = await transport(url, cfg.host, sid, SSO_TIMEOUT_MS);
		if (status !== 200) {
			log.debug('sso: non-200', { status });
			cacheStore(key, null, NEG_TTL_MS);
			return null;
		}
		let parsed: { error?: unknown; result?: SessionInfo } | null = null;
		try {
			parsed = text ? (JSON.parse(text) as { error?: unknown; result?: SessionInfo }) : null;
		} catch {
			log.debug('sso: neplatný JSON v odpovedi');
			cacheStore(key, null, NEG_TTL_MS);
			return null;
		}
		if (!parsed || parsed.error) {
			// HTTP 200 + JSON-RPC error = expirovaná/neplatná session (SessionExpiredException) — NORMÁLNE
			log.debug('sso: session expirovaná / error (prejde na lokálny login)');
			cacheStore(key, null, NEG_TTL_MS);
			return null;
		}
		const r = parsed.result ?? {};
		const uid = r.uid;
		if (typeof uid !== 'number' || !Number.isInteger(uid) || uid <= 0) {
			cacheStore(key, null, NEG_TTL_MS);
			return null;
		}
		if (r.is_internal_user !== true) {
			// platná session, ale portál/verejný Odoo používateľ — appka mu interný prístup nedá
			log.debug('sso: session platná ale nie internal user — odmietam', { uid });
			cacheStore(key, null, NEG_TTL_MS);
			return null;
		}
		const username = r.username;
		if (typeof username !== 'string' || username.length === 0) {
			cacheStore(key, null, NEG_TTL_MS);
			return null;
		}
		const user: SessionUser = { id: -uid, username, role: 'internal', source: 'odoo' };
		cacheStore(key, user, POS_TTL_MS);
		log.info('sso ok', { uid, login: username });
		return user;
	} catch (e) {
		// timeout / sieťový pád → negatívna cache (bráni per-request 3 s visení pri Odoo výpadku)
		log.debug('sso: transport chyba (prejde na lokálny login)', {
			err: e instanceof Error ? e.message : String(e)
		});
		cacheStore(key, null, NEG_TTL_MS);
		return null;
	}
}

/**
 * Evikuje cache vstup pre daný `sid` (volá app logout — pre SSO používateľa je inak inertný, ambientná
 * Odoo cookie re-autentikuje ďalší request; app NIKDY nevolá Odoo `/web/session/destroy`).
 */
export function evictSsoCache(sid: string | undefined): void {
	if (!sid || !SID_RE.test(sid)) return;
	cache.delete(hashSid(sid));
}

/** TEST-only: vyprázdni cache medzi testami (izolácia). */
export function _clearSsoCacheForTests(): void {
	cache.clear();
	inflight.clear();
}
