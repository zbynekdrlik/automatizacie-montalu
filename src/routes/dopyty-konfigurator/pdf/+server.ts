// Interné znovu-stiahnutie PDF ponuky pre uložený dopyt (#282): GET /dopyty-konfigurator/pdf?id=N.
// AUTH je zabezpečená GLOBÁLNE v `hooks.server.ts` (neprihlásený → /login, b2b → /zasklenia cez
// denylist) — tu je NAVYŠE belt-and-suspenders kontrola roly (defense-in-depth, netreba sa
// spoliehať len na bránu). PDF sa regeneruje deterministicky z uloženej konfigurácie, nič sa
// nezapisuje. MONEY-NEUTRÁLNE (ponuka = ŠPECIFIKÁCIA bez cien).
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isInternal } from '$lib/server/auth';
import { regeneratePonukaPdf } from '$lib/server/dopyt-pdf';

export const GET: RequestHandler = async ({ url, locals }) => {
	// defense-in-depth (brána už redirectuje anon/b2b skôr, než sem príde)
	if (!locals.user) error(401, 'Vyžaduje sa prihlásenie.');
	if (!isInternal(locals.user)) error(403, 'Prístup len pre interných používateľov.');

	const id = Number(url.searchParams.get('id'));
	if (!Number.isInteger(id) || id <= 0) error(400, 'Neplatný dopyt.');

	const pdf = await regeneratePonukaPdf(id);
	if (!pdf) error(404, 'Dopyt sa nenašiel.');

	// Kópia do čerstvého Uint8Array<ArrayBuffer>: `generatePonukaPdf` vracia generický
	// `Uint8Array<ArrayBufferLike>`, ktorý aktuálny TS lib neprijme priamo ako BodyInit
	// (buffer môže byť SharedArrayBuffer). Kópia dáva konkrétny ArrayBuffer backing.
	return new Response(new Uint8Array(pdf.bytes), {
		headers: {
			'content-type': 'application/pdf',
			'content-disposition': `attachment; filename="${pdf.filename}"`,
			'cache-control': 'no-store'
		}
	});
};
