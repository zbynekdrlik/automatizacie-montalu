import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { logout, SESSION_COOKIE } from '$lib/server/auth';
import { evictSsoCache, ODOO_SESSION_COOKIE } from '$lib/server/odoo-sso';
import { base } from '$app/paths';

export const POST: RequestHandler = async ({ cookies }) => {
	const token = cookies.get(SESSION_COOKIE);
	if (token) logout(token);
	// #5822: delete path MUSÍ sedieť s set path (`base || '/'`), inak sa cookie nezmaže.
	cookies.delete(SESSION_COOKIE, { path: base || '/' });
	// #5823: pre SSO používateľa je app logout INERTNÝ (ambientná Odoo `session_id` re-autentikuje
	// ďalší request) — app NIKDY nevolá Odoo `/web/session/destroy`; len evikuje SSO cache vstup, nech
	// ďalší request re-overí Odoo. Best-effort; no-op keď cookie chýba (bežný lokálny logout).
	evictSsoCache(cookies.get(ODOO_SESSION_COOKIE));
	redirect(303, base + '/login');
};
