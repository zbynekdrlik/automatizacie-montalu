// Drift guard: enumeruje SKUTOČNÉ route adresáre pod src/routes (+page.server.ts
// alebo +server.ts = potenciálny zápis) a overí, že b2bRedirectTarget() ich všetky
// presmerúva PREČ — okrem explicitne povolenej množiny. Nová route (napr. zabudnutá
// v B2B_FORBIDDEN_PREFIXES denylist v src/lib/server/b2b-access.ts) tento test
// ROZBIJE, kým sa nepridá do denylistu — to je zámer (fail-closed drift guard).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { b2bRedirectTarget } from '../src/lib/server/b2b-access';

const ROUTES_DIR = path.resolve(process.cwd(), 'src/routes');

// Cesty, kde b2b smie zostať (nepresmerúva sa preč):
// - /zasklenia — jediná zápisová stránka pre b2b, chránená na úrovni action (odoslat/
//   odoslatMulti odmietnu b2b, viď b2b-money-reject.test.ts)
// - /login, /logout, /health — nutné pre autentifikáciu / liveness, nemajú b2b-citlivý zápis
// - /sietka — dodatočná sieťka bez posuvu (#89): Patrik „hlavne pre externých" —
//   modul NEMÁ žiadny zápis do Money vôbec (rovnako ako /fix, ktoré je napriek tomu
//   v denylist-e — /fix je interné z iného dôvodu), takže tu je vedomé povolenie
const ALLOWED = new Set(['/zasklenia', '/sietka', '/login', '/logout', '/health']);

/** Prevedie adresár routy (relatívne k src/routes) na URL cestu. Ignoruje route groups (...). */
function toRoutePath(dirAbs: string): string {
	const rel = path.relative(ROUTES_DIR, dirAbs);
	if (!rel) return '/';
	const segments = rel.split(path.sep).filter((seg) => !(seg.startsWith('(') && seg.endsWith(')')));
	return '/' + segments.join('/');
}

/** Rekurzívne nájde všetky adresáre pod src/routes, ktoré obsahujú +page.server.ts alebo +server.ts. */
function findWriteBearingRouteDirs(dir: string, out: Set<string> = new Set()): Set<string> {
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	const hasServerFile = entries.some(
		(e) => e.isFile() && (e.name === '+page.server.ts' || e.name === '+server.ts')
	);
	if (hasServerFile) out.add(dir);
	for (const e of entries) {
		if (e.isDirectory()) findWriteBearingRouteDirs(path.join(dir, e.name), out);
	}
	return out;
}

const routeDirs = findWriteBearingRouteDirs(ROUTES_DIR);
const routePaths = [...routeDirs].map(toRoutePath).sort();

describe('b2b route coverage (denylist drift guard)', () => {
	it('src/routes obsahuje aspoň očakávané write-bearing routy (self-check, aby test nebol prázdny)', () => {
		// ak toto zlyhá, enumerácia súborového systému je rozbitá — nie je čo strážiť
		expect(routePaths).toEqual(
			expect.arrayContaining([
				'/',
				'/bazen',
				'/odpisy',
				'/pergola',
				'/pouzivatelia',
				'/problem',
				'/zasklenia',
				'/zasklenia/nastavenia',
				'/login',
				'/logout',
				'/health'
			])
		);
	});

	it.each(routePaths.filter((p) => !ALLOWED.has(p)))(
		'b2b je z %s presmerovaný preč (denylist ho pokrýva)',
		(routePath) => {
			expect(b2bRedirectTarget(routePath)).toBe('/zasklenia');
		}
	);

	it('povolená množina (%s) nie je náhodou prázdna — inak by test vyššie nič nekontroloval', () => {
		const covered = routePaths.filter((p) => !ALLOWED.has(p));
		expect(covered.length).toBeGreaterThan(0);
	});

	it('/zasklenia (povolená zápisová stránka pre b2b) nie je presmerovaná', () => {
		expect(b2bRedirectTarget('/zasklenia')).toBeNull();
	});

	it('/sietka (#89 — Patrik: „hlavne pre externých", žiadny Money zápis) nie je presmerovaná', () => {
		expect(b2bRedirectTarget('/sietka')).toBeNull();
	});
});
