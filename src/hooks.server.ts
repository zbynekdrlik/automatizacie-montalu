// Globálny auth guard: všetko okrem /login a /health vyžaduje prihlásenie.
// Formuláre zapisujú do Money importu — verejný prístup bol nález auditu n8n verzie.
import { redirect, type Handle, type HandleServerError } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import { getSessionUser, isB2B, pruneSessions, SESSION_COOKIE } from '$lib/server/auth';
import { b2bRedirectTarget } from '$lib/server/b2b-access';
import { logger } from '$lib/server/log';
import { moneyConfig, setOdpisWrittenHook } from '$lib/server/money';
import { cenySnapshotPath } from '$lib/server/ceny';
import { dlvReadbackPath } from '$lib/server/money-readback';
import { DB_PATH } from '$lib/server/db';
import { runStartupLeadSweep } from '$lib/server/odoo-lead';
import { queueZakazkaPush, runStartupZakazkaSweep } from '$lib/server/odoo-zakazka';
import { base } from '$app/paths';
import { stripBase, frameGuardHeaders } from '$lib/base-path';

const log = logger('http');

// #5822: `base` je bakovaná konštanta (`APP_BASE_PATH`), ale v runtime je to `let`, ktorý
// SvelteKit počas renderu prepíše na relatívnu hodnotu a po ňom resetuje. Render je
// default synchrónny, takže `handle`/loads/actions vidia bakovanú hodnotu — zachytíme ju
// na module-scope, nech je to imúnne voči budúcemu `experimental.async` opt-inu.
const APP_BASE = base;

// #275: /konfigurator je VEREJNÝ zákaznícky konfigurátor pergoly (fáza 1) — EXPLICITNÁ
// allowlist výnimka z auth brány (brána ostáva bránou, pridáva sa jeden verejný prefix,
// nie oslabenie gate). Display-only, BEZ CIEN/Money kódov/nárezu, žiadny zápis do Money
// (guard: tests/konfigurator-money-safety.test.ts). b2b drift guard: je to top-level
// route (nie pod Money-denylist prefixom) → dostupná pre všetkých vrátane prihláseného
// b2b (tests/b2b-route-coverage.test.ts).
const PUBLIC_PATHS = ['/login', '/health', '/konfigurator'];

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
		cenySnapshotPath: cenySnapshotPath(),
		dlvReadbackPath: dlvReadbackPath()
	});
	// #278: pri štarte zotav dopyty čakajúce na Odoo CRM lead (napr. po deploy/restarte po
	// výpadku Odoo alebo po doplnení ODOO_LEAD_* env). Fire-and-forget, no-op keď chýba env.
	runStartupLeadSweep();
	// #340: po každom úspešnom odpise pushni interný zoznam materiálu zákazky do Odoo
	// (interná log-note na sale.order, zákazník ju nikdy nevidí). Money-neutrálny observer.
	setOdpisWrittenHook(queueZakazkaPush);
	// #349: pri štarte (po migráciách — db.ts modul-load prebehol vyššie cez importy) dopostni
	// zaostalé zákazka-pushe z minulých výpadkov Odoo. Fire-and-forget, no-op keď chýba ODOO_LEAD_*.
	runStartupZakazkaSweep();
}

export const handle: Handle = async ({ event, resolve }) => {
	if (++pruneCounter % 100 === 1) pruneSessions();

	event.locals.user = getSessionUser(event.cookies.get(SESSION_COOKIE));

	// #5822: `event.url.pathname` NESIE base (napr. `/automatizacie/zasklenia`). Auth brána
	// (PUBLIC_PATHS) aj b2b denylist porovnávajú s base-LESS cestami, preto najprv odrežem
	// base — konštanty (PUBLIC_PATHS, B2B_*) ostávajú base-LESS a nezmenené; base sa pridá
	// späť až pri tvorbe redirect Location. Pri base='' je appPath === pathname (dnešné).
	const appPath = stripBase(event.url.pathname, APP_BASE);

	const isPublic = PUBLIC_PATHS.some((p) => appPath === p || appPath.startsWith(p + '/'));
	if (!isPublic && !event.locals.user) {
		log.debug('neprihlásený redirect na login', { path: appPath });
		// pathname + search — deep link s parametrami (napr. ?sysStyl=…) sa po
		// prihlásení nesmie stratiť, inak editor otvorí iný štýl než užívateľ čakal.
		// `next` je base-LESS (appPath); base pridá login handler pri redirecte.
		redirect(303, APP_BASE + '/login?next=' + encodeURIComponent(appPath + event.url.search));
	}

	// B2B smie len /zasklenia — presmeruj z ostatných stránok (denylist, assety prejdú).
	if (isB2B(event.locals.user)) {
		const target = b2bRedirectTarget(appPath);
		// guard MUSÍ porovnávať appPath (base-LESS) s targetom (base-LESS) — inak by pod base
		// `/automatizacie/zasklenia !== '/zasklenia'` bolo vždy true → nekonečný 303 loop.
		if (target && appPath !== target) {
			log.debug('b2b denylist redirect', {
				username: event.locals.user?.username,
				from: appPath,
				to: target
			});
			redirect(303, APP_BASE + target);
		}
	}

	const response = await resolve(event);

	// #251 SEC-3: obranné bezpečnostné hlavičky priamo z appky (reverzný proxy
	// Caddy je mimo repa → defense-in-depth, appka sa nespolieha na infra config).
	// Aplikované na každú vyrenderovanú odpoveď (vrátane /login, /zasklenia); 3xx
	// redirecty (throw z redirect()) sem neprídu — nemajú framovateľný obsah.
	// Permissions-Policy je ZÁMERNE minimálny — vypína len nepoužívané invazívne
	// funkcie (kamera/mikrofón/poloha); WebGL/three.js Permissions-Policy neriadi.
	// #5822: iframe povolenie env-gated (`APP_FRAME_ANCESTORS`, runtime). Unset ⇒ dnešné
	// `X-Frame-Options: DENY` (byte-identicky); nastavené ⇒ `Content-Security-Policy:
	// frame-ancestors <hodnota>` (same-origin Odoo iframe) a ŽIADNE X-Frame-Options (práve
	// jedna z hlavičiek naraz, aby nekonfliktovali). Stále BEZ ostatných CSP direktív
	// (script/style) — three.js/inline štýly Svelte = riziko rozbitia (#251); `frame-ancestors`
	// sám nič z toho neriadi.
	const frame = frameGuardHeaders(process.env.APP_FRAME_ANCESTORS);
	// `set` (nie `append`): appka nemá `kit.csp` nakonfigurované, takže odpoveď žiadne CSP
	// nenesie — toto je JEDINÝ zdroj CSP. `append` by pri budúcom `kit.csp` pridal DRUHÚ CSP
	// hlavičku a prehliadač aplikuje ich PRIENIK (najprísnejšie `frame-ancestors`), čo by mohlo
	// iframe naopak zablokovať; `set` drží práve jednu `frame-ancestors` direktívu.
	if (frame.csp) response.headers.set('Content-Security-Policy', frame.csp);
	if (frame.xFrameOptions) response.headers.set('X-Frame-Options', frame.xFrameOptions);
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
	return response;
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
