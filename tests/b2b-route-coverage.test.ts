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
// - /zasklenia — zápisová stránka pre b2b, chránená na úrovni action (odoslat/
//   odoslatMulti odmietnu b2b, viď b2b-money-reject.test.ts)
// - /login, /logout, /health — nutné pre autentifikáciu / liveness, nemajú b2b-citlivý zápis
// - /sietka — dodatočná sieťka bez posuvu (#89): Patrik „hlavne pre externých". Od
//   korekcie 2026-08-02 MÁ akciu `odoslat` (Money zápis pre interných), ale rovnakou
//   vrstvou ako /zasklenia — b2b je odmietnutý AKO PRVÝ krok v akcii samotnej
//   (`isB2B(locals.user)` guard v +page.server.ts), nie len skrytým tlačidlom.
// - /pergola/navrh — zákaznícky NÁVRHOVÝ výkres (#138), sprístupnený b2b v #144.
//   Display-only: žiadny import `$lib/server/money`, žiadna zápisová akcia (viď
//   popisný test nižšie) — na rozdiel od /sietka tu NIET ČO chrániť extra guardom,
//   lebo sa nezapisuje vôbec nič. Samotné /pergola (Money odpis z CAD nárezu) OSTÁVA
//   v denylist-e — výnimka v `b2b-access.ts` je úzka, len na `/navrh` pod-cestu.
// - /zasklenia/navrh — zákaznícky NÁVRHOVÝ výkres pre zasklenia (#162), rovnaká
//   architektúra ako /pergola/navrh. Na rozdiel od pergoly nepotrebuje výnimku v
//   `B2B_ALLOWED_EXCEPTIONS` — `/zasklenia/*` NIE JE v `B2B_FORBIDDEN_PREFIXES`
//   (len `/zasklenia/nastavenia` je), takže je pre b2b dostupná AUTOMATICKY. Tu v
//   ALLOWED je len VEDOMÉ potvrdenie (drift guard by inak zlyhal), nie obídenie.
//   Display-only rovnako ako /pergola/navrh — viď popisný test nižšie.
//
// #139: /bazen/navrh (zákaznícky NÁVRHOVÝ výkres pre bazén) NIE JE v ALLOWED —
// zadanie #139 explicitne hovorí "pre b2b stránka prístupná nebude", na rozdiel
// od pergoly/zaskleniam. Žije pod existujúcim /bazen prefixom v
// B2B_FORBIDDEN_PREFIXES, takže ju denylist blokuje AUTOMATICKY bez akejkoľvek
// zmeny b2b-access.ts — ostáva mimo ALLOWED zámerne, aby ju `it.each` nižšie
// pokryl generickým "presmerovaná preč" testom (plus explicitný popisný test
// nižšie pre čitateľnosť).
//
// - /zasklenia/navrh/zakaznicky — zákaznícky TLAČOVÝ list pre 3D náhľad (#170),
//   child routa pod /zasklenia/navrh. Rovnaká disciplína ako /zasklenia/navrh
//   samotná (a /pergola/navrh): display-only (žiadny import server/money,
//   žiadna zápisová akcia — `src/lib/server/zasklenia-navrh-vstup.ts` sa
//   znovupoužíva 1:1, viď `tests/vizual-money-guard.test.ts` pre samotnú 3D
//   vrstvu). `/zasklenia/*` nie je v B2B_FORBIDDEN_PREFIXES, takže je
//   dostupná AUTOMATICKY — tu v ALLOWED je len vedomé potvrdenie.
const ALLOWED = new Set([
	'/zasklenia',
	'/sietka',
	'/pergola/navrh',
	'/zasklenia/navrh',
	'/zasklenia/navrh/zakaznicky',
	'/login',
	'/logout',
	'/health'
]);

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
				'/bazen/navrh',
				'/odpisy',
				'/pergola',
				'/pergola/navrh',
				'/pouzivatelia',
				'/problem',
				'/zasklenia',
				'/zasklenia/nastavenia',
				'/zasklenia/navrh',
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

	it('#144: /pergola/navrh (návrhový výkres) nie je presmerovaná', () => {
		expect(b2bRedirectTarget('/pergola/navrh')).toBeNull();
	});

	it('#162: /zasklenia/navrh (návrhový výkres pre zasklenia) nie je presmerovaná', () => {
		expect(b2bRedirectTarget('/zasklenia/navrh')).toBeNull();
	});

	it('#170: /zasklenia/navrh/zakaznicky (zákaznícky tlačový list, 3D náhľad) nie je presmerovaná', () => {
		expect(b2bRedirectTarget('/zasklenia/navrh/zakaznicky')).toBeNull();
	});

	// #139: opačný prípad ako riadok vyššie — /bazen/navrh je NÁVRHOVÝ výkres, ale
	// zadanie #139 ho explicitne vylučuje z b2b ("pre b2b stránka prístupná
	// nebude"). Generický it.each vyššie to už pokrýva (nie je v ALLOWED), tento
	// test je len čitateľné explicitné potvrdenie — presne zrkadlový vzor k
	// riadkom vyššie pre /pergola/navrh a /zasklenia/navrh.
	it('#139: /bazen/navrh (návrhový výkres pre bazén, NEPRÍSTUPNÝ pre b2b) JE presmerovaná preč', () => {
		expect(b2bRedirectTarget('/bazen/navrh')).toBe('/zasklenia');
	});

	// #212: nárezový optimalizátor — kalkulačka pre dielňu (interní), žiadny Money
	// odpis; b2b nemá požiadavku → vedome zakázaná (v B2B_FORBIDDEN_PREFIXES).
	// Generický it.each vyššie to už pokrýva (nie je v ALLOWED), toto je len
	// čitateľné explicitné potvrdenie vedomého rozhodnutia.
	it('#212: /optimalizator (nárezový optimalizátor, interné-only) JE presmerovaný preč', () => {
		expect(b2bRedirectTarget('/optimalizator')).toBe('/zasklenia');
	});
});

// #144, zadanie bod 3: „overiť testom, že b2b na /pergola/navrh nemá žiadnu cestu k
// odpisu" — na rozdiel od /sietka a /zasklenia (ktoré MAJÚ zápisovú akciu chránenú
// vrstvou isB2B guardu) /pergola/navrh nemá ŽIADNU zápisovú akciu vôbec, takže tu
// niet čo obchádzať. Tento test stráži, že to tak ZOSTANE — pridanie akejkoľvek
// budúcej zápisovej akcie (napr. omylom skopírovanej z /pergola) tento test rozbije.
describe('/pergola/navrh — žiadna cesta k Money odpisu (#144)', () => {
	it('akcie routy sú presne vykres/upravit — žiadna odpisová/zápisová akcia', async () => {
		const { actions } = await import('../src/routes/pergola/navrh/+page.server');
		expect(Object.keys(actions).sort()).toEqual(['upravit', 'vykres']);
	});
});

// #162, rovnaká disciplína ako #144 vyššie — /zasklenia/navrh nemá ŽIADNU zápisovú
// akciu vôbec (display-only), tento test stráži, že to tak ZOSTANE.
describe('/zasklenia/navrh — žiadna cesta k Money odpisu (#162)', () => {
	it('akcie routy sú presne vykres/upravit — žiadna odpisová/zápisová akcia', async () => {
		const { actions } = await import('../src/routes/zasklenia/navrh/+page.server');
		expect(Object.keys(actions).sort()).toEqual(['upravit', 'vykres']);
	});
});

// #139, rovnaká disciplína — /bazen/navrh nemá ŽIADNU zápisovú akciu vôbec
// (display-only), aj keď je pre b2b navyše ÚPLNE zablokovaná (viď test vyššie).
describe('/bazen/navrh — žiadna cesta k Money odpisu (#139)', () => {
	it('akcie routy sú presne vykres/upravit — žiadna odpisová/zápisová akcia', async () => {
		const { actions } = await import('../src/routes/bazen/navrh/+page.server');
		expect(Object.keys(actions).sort()).toEqual(['upravit', 'vykres']);
	});
});

// #170, rovnaká disciplína — zákaznícky tlačový list (3D náhľad) má LEN default
// akciu (parsuje ten istý vstup ako `?/vykres` na rodičovskej route), žiadnu
// odpisovú/zápisovú akciu vôbec.
describe('/zasklenia/navrh/zakaznicky — žiadna cesta k Money odpisu (#170)', () => {
	it('akcie routy sú presne default — žiadna odpisová/zápisová akcia', async () => {
		const { actions } = await import('../src/routes/zasklenia/navrh/zakaznicky/+page.server');
		expect(Object.keys(actions).sort()).toEqual(['default']);
	});
});
