// #5960: POST seam pre „Uložiť ponuku" → Odoo `sale.order.create_quote_from_app` PER-USER kredenciálom.
// AUTH je globálne v `hooks.server.ts` (neprihlásený → /login); TU navyše belt-and-suspenders:
//  - explicitný SAME-ORIGIN check (`Origin` / `Sec-Fetch-Site`) — moja ruta je state-changing per-user
//    akcia z cookie kredenciálu, a SvelteKit built-in origin check kryje LEN form actions, nie
//    `+server.ts` (Fable dizajn-konzult #5960).
//  - `saveQuoteToOdoo` gatuje `user.source==='odoo'` ∧ platné `session_id` cookie a NIKDY nesiahne
//    na zdieľaný `ODOO_API_KEY`.
// Chyby sa mapujú na HTTP statusy; deep-link objednávky staviam APP-SIDE zo známeho public base
// (`ssoConfig().host`), nikdy z Odoo-echa. Rotované Odoo `session_id` (Set-Cookie) propagujem browseru,
// inak by sa session desynchronizovala a používateľa by to odhlásilo.
import { json, error, type RequestHandler } from '@sveltejs/kit';
import { ssoConfig } from '$lib/server/odoo-sso';
import {
	saveQuoteToOdoo,
	QuoteInputError,
	type SaveQuoteInput,
	type QuoteAttachment
} from '$lib/server/odoo-quote';
import { QuoteAuthError, QuoteUserError, QuoteTransportError } from '$lib/server/odoo-call-kw';
import { isInternal } from '$lib/server/auth';
import { logger } from '$lib/server/log';

const log = logger('ulozit-ponuku');

/** Same-origin poistka na `+server.ts` (SvelteKit ju robí len pre form actions). */
function assertSameOrigin(request: Request, expectedOrigin: string): void {
	const origin = request.headers.get('origin');
	const secFetchSite = request.headers.get('sec-fetch-site');
	// Sec-Fetch-Site: same-origin (moderné prehliadače) ALEBO Origin == naša origin. Chýbajúci Origin
	// pri POST je podozrivý (cross-site fetch ho posiela) → odmietni ak nie je aspoň same-origin signál.
	if (secFetchSite === 'same-origin') return;
	if (origin && origin === expectedOrigin) return;
	error(403, 'Neplatný pôvod požiadavky.');
}

/** Bezpečne dekóduje base64 prílohu z (nedôveryhodného) JSON tela na bajty. */
function parseAttachments(raw: unknown): QuoteAttachment[] {
	if (raw == null) return [];
	if (!Array.isArray(raw)) throw new QuoteInputError('Neplatný formát príloh.');
	return raw.map((a): QuoteAttachment => {
		const o = (a ?? {}) as { name?: unknown; mimetype?: unknown; datasBase64?: unknown };
		const b64 = typeof o.datasBase64 === 'string' ? o.datasBase64 : '';
		let bytes: Uint8Array;
		try {
			bytes = new Uint8Array(Buffer.from(b64, 'base64'));
		} catch {
			throw new QuoteInputError('Prílohu sa nepodarilo dekódovať.');
		}
		return {
			name: typeof o.name === 'string' ? o.name : '',
			mimetype: typeof o.mimetype === 'string' ? o.mimetype : '',
			bytes
		};
	});
}

/** Zloží normalizovaný `SaveQuoteInput` z (nedôveryhodného) JSON tela; ceny sú obchodníkove kvótové
 *  ceny (autentifikovaná per-user akcia — Odoo ich izoluje jeho identitou/ACL). */
function parseInput(body: unknown): SaveQuoteInput {
	if (!body || typeof body !== 'object') throw new QuoteInputError('Prázdne telo požiadavky.');
	const b = body as Record<string, unknown>;
	const linesRaw = Array.isArray(b.lines) ? b.lines : [];
	const lines = linesRaw.map((l) => {
		const o = (l ?? {}) as Record<string, unknown>;
		return {
			kod: typeof o.kod === 'string' ? o.kod : '',
			nazov: typeof o.nazov === 'string' ? o.nazov : '',
			qty: Number(o.qty),
			mj: typeof o.mj === 'string' ? o.mj : undefined,
			priceUnit: Number(o.priceUnit),
			discount: o.discount == null ? undefined : Number(o.discount)
		};
	});
	const zakaznik =
		b.zakaznik && typeof b.zakaznik === 'object'
			? (b.zakaznik as SaveQuoteInput['zakaznik'])
			: undefined;
	return {
		modul: typeof b.modul === 'string' ? b.modul : '',
		url: typeof b.url === 'string' ? b.url : undefined,
		cenaHladina: typeof b.cenaHladina === 'string' ? b.cenaHladina : undefined,
		partnerId: typeof b.partnerId === 'number' ? b.partnerId : undefined,
		zakaznik,
		lines,
		attachments: parseAttachments(b.attachments)
	};
}

export const POST: RequestHandler = async ({ request, url, locals, cookies }) => {
	assertSameOrigin(request, url.origin);
	// defense-in-depth (brána už redirectuje anon skôr)
	if (!locals.user) error(401, 'Vyžaduje sa prihlásenie.');
	if (!isInternal(locals.user)) error(403, 'Prístup len pre interných používateľov.');

	let input: SaveQuoteInput;
	try {
		input = parseInput(await request.json());
	} catch (e) {
		if (e instanceof QuoteInputError)
			return json({ ok: false, code: 'input', error: e.message }, { status: 400 });
		return json({ ok: false, code: 'input', error: 'Neplatné telo požiadavky.' }, { status: 400 });
	}

	const sid = cookies.get('session_id');
	try {
		const res = await saveQuoteToOdoo(input, sid, locals.user);
		// rotované session_id z Odoo → propaguj browseru (inak desync/logout).
		if (res.rotatedSid && res.rotatedSid !== sid) {
			cookies.set('session_id', res.rotatedSid, {
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				secure: url.protocol === 'https:'
			});
		}
		const host = ssoConfig()?.host ?? 'erp.montalu.cloud';
		return json({
			ok: true,
			created: res.created,
			name: res.name,
			// deep-link staviam app-side zo známeho public base, nie z Odoo-echa.
			url: `https://${host}/odoo/sale.order/${res.id}`
		});
	} catch (e) {
		if (e instanceof QuoteAuthError) {
			return json({ ok: false, code: 'auth', error: e.message }, { status: 401 });
		}
		if (e instanceof QuoteInputError) {
			return json({ ok: false, code: 'input', error: e.message }, { status: 400 });
		}
		if (e instanceof QuoteUserError) {
			// doslovná, bezpečná Odoo hláška (obsah sa zmenil / nie ste obchodník / …)
			return json({ ok: false, code: 'odoo', error: e.message }, { status: 409 });
		}
		if (e instanceof QuoteTransportError) {
			return json({ ok: false, code: 'transport', error: e.message }, { status: 502 });
		}
		// neočakávané — nič citlivé von, detail do logu
		log.error('ulozit-ponuku neočakávaná chyba', {
			err: e instanceof Error ? e.message : String(e)
		});
		return json(
			{ ok: false, code: 'unknown', error: 'Uloženie ponuky zlyhalo. Skús to znova.' },
			{ status: 500 }
		);
	}
};
