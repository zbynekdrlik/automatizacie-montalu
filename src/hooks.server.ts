// Globálny auth guard: všetko okrem /login a /health vyžaduje prihlásenie.
// Formuláre zapisujú do Money importu — verejný prístup bol nález auditu n8n verzie.
import { redirect, type Handle, type HandleServerError } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import { getSessionUser, isB2B, pruneSessions, SESSION_COOKIE } from '$lib/server/auth';
import { b2bRedirectTarget } from '$lib/server/b2b-access';
import { logger } from '$lib/server/log';
import { moneyConfig } from '$lib/server/money';
import { cenySnapshotPath } from '$lib/server/ceny';
import { DB_PATH } from '$lib/server/db';

const log = logger('http');

const PUBLIC_PATHS = ['/login', '/health'];

let pruneCounter = 0;

// #245: jeden štartovací config riadok (verzia, DB, MONEY_LIVE, cieľové adresáre,
// snapshot ceny). Tu (nie v db.ts), aby nevznikol cyklický import db.ts ↔ money/ceny
// — viď large-file-split rule (param-injection / žiadny cyklus). Beží raz pri
// naštartovaní servera (modul hooks.server.ts je leaf, nič ho neimportuje).
{
	const mc = moneyConfig();
	logger('startup').info('štart', {
		version:
			typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : process.env.APP_VERSION || 'dev',
		databasePath: DB_PATH,
		moneyLive: mc.live,
		liveDir: mc.liveDir,
		naOdpisDir: mc.naOdpisDir,
		testDir: mc.testDir,
		cenySnapshotPath: cenySnapshotPath()
	});
}

export const handle: Handle = async ({ event, resolve }) => {
	if (++pruneCounter % 100 === 1) pruneSessions();

	event.locals.user = getSessionUser(event.cookies.get(SESSION_COOKIE));

	const isPublic = PUBLIC_PATHS.some(
		(p) => event.url.pathname === p || event.url.pathname.startsWith(p + '/')
	);
	if (!isPublic && !event.locals.user) {
		log.debug('neprihlásený redirect na login', { path: event.url.pathname });
		// pathname + search — deep link s parametrami (napr. ?sysStyl=…) sa po
		// prihlásení nesmie stratiť, inak editor otvorí iný štýl než užívateľ čakal
		redirect(303, '/login?next=' + encodeURIComponent(event.url.pathname + event.url.search));
	}

	// B2B smie len /zasklenia — presmeruj z ostatných stránok (denylist, assety prejdú).
	if (isB2B(event.locals.user)) {
		const target = b2bRedirectTarget(event.url.pathname);
		if (target && event.url.pathname !== target) {
			log.debug('b2b denylist redirect', {
				username: event.locals.user?.username,
				from: event.url.pathname,
				to: target
			});
			redirect(303, target);
		}
	}

	return resolve(event);
};

// #245: neočakávané serverové chyby (500) — zaloguj plný kontext + stack pod
// dohľadateľným `errorId`, používateľovi vráť bezpečnú SK správu + to isté ID.
// (Očakávané chyby cez `error()` — napr. 404 — sem NEidú; ich správu ukáže
// +error.svelte priamo.)
export const handleError: HandleServerError = ({ error, event, status, message }) => {
	const errorId = randomBytes(6).toString('hex');
	logger('error').error('neošetrená serverová chyba', {
		errorId,
		status,
		message,
		pathname: event.url.pathname,
		method: event.request.method,
		username: event.locals.user?.username,
		error
	});
	return { message: 'Nastala neočakávaná chyba. Skús to prosím znova.', errorId };
};
