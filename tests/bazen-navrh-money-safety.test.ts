// #139 (bazén návrhový výkres) je DISPLAY-ONLY — táto route sa nesmie dostať k
// Money zápisu ani k existujúcemu bazénovému odpisu (`$lib/server/bazen.ts`,
// `$lib/server/money.ts`) ani na character. Rovnaká disciplína ako
// `tests/fix-money-safety.test.ts` (#85) — statická kontrola zdrojového kódu,
// nie len behaviorálny test cez actions (ten je v tests/b2b-route-coverage.test.ts).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

function zdroj(relPath: string): string {
	return fs.readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8');
}

const ZAKAZANE_VZORY = [
	/from ['"].*server\/money['"]/,
	/from ['"].*server\/bazen['"]/,
	/writeOdpis|MONEY_LIVE/
];

describe('Money safety (#139) — bazén návrhový výkres neimportuje server/money ani server/bazen', () => {
	it('src/lib/bazen-navrh.ts neimportuje nič z Money zapisovača ani z odpisového modulu', () => {
		const src = zdroj('src/lib/bazen-navrh.ts');
		for (const vzor of ZAKAZANE_VZORY) expect(src).not.toMatch(vzor);
	});

	it('src/lib/server/bazen-navrh-vstup.ts neimportuje nič z Money zapisovača ani z odpisového modulu', () => {
		const src = zdroj('src/lib/server/bazen-navrh-vstup.ts');
		for (const vzor of ZAKAZANE_VZORY) expect(src).not.toMatch(vzor);
	});

	it('src/lib/components/BazenNavrhVykres.svelte neimportuje nič z Money zapisovača ani z odpisového modulu', () => {
		const src = zdroj('src/lib/components/BazenNavrhVykres.svelte');
		for (const vzor of ZAKAZANE_VZORY) expect(src).not.toMatch(vzor);
	});

	it('src/routes/bazen/navrh/+page.server.ts neimportuje nič z Money zapisovača ani z odpisového modulu', () => {
		const src = zdroj('src/routes/bazen/navrh/+page.server.ts');
		for (const vzor of ZAKAZANE_VZORY) expect(src).not.toMatch(vzor);
	});

	it('src/routes/bazen/navrh/+page.svelte neimportuje nič z Money zapisovača ani z odpisového modulu', () => {
		const src = zdroj('src/routes/bazen/navrh/+page.svelte');
		for (const vzor of ZAKAZANE_VZORY) expect(src).not.toMatch(vzor);
	});

	it('existujúci $lib/server/bazen.ts (Money odpis) ostáva NEDOTKNUTÝ touto route — sanity, súbor stále existuje a exportuje computeBazen', () => {
		const src = zdroj('src/lib/server/bazen.ts');
		expect(src).toMatch(/export function computeBazen/);
	});
});
