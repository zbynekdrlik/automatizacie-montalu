// Globálny auth guard: všetko okrem /login a /health vyžaduje prihlásenie.
// Formuláre zapisujú do Money importu — verejný prístup bol nález auditu n8n verzie.
import { redirect, type Handle } from '@sveltejs/kit';
import { getSessionUser, isB2B, pruneSessions, SESSION_COOKIE } from '$lib/server/auth';
import { b2bRedirectTarget } from '$lib/server/b2b-access';

const PUBLIC_PATHS = ['/login', '/health'];

let pruneCounter = 0;

export const handle: Handle = async ({ event, resolve }) => {
	if (++pruneCounter % 100 === 1) pruneSessions();

	event.locals.user = getSessionUser(event.cookies.get(SESSION_COOKIE));

	const isPublic = PUBLIC_PATHS.some(
		(p) => event.url.pathname === p || event.url.pathname.startsWith(p + '/')
	);
	if (!isPublic && !event.locals.user) {
		// pathname + search — deep link s parametrami (napr. ?sysStyl=…) sa po
		// prihlásení nesmie stratiť, inak editor otvorí iný štýl než užívateľ čakal
		redirect(303, '/login?next=' + encodeURIComponent(event.url.pathname + event.url.search));
	}

	// B2B smie len /zasklenia — presmeruj z ostatných stránok (denylist, assety prejdú).
	if (isB2B(event.locals.user)) {
		const target = b2bRedirectTarget(event.url.pathname);
		if (target && event.url.pathname !== target) redirect(303, target);
	}

	return resolve(event);
};
