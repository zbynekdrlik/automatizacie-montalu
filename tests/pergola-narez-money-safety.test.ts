// #155 (pergola materiál/nárez z rozmerov) je DISPLAY-ONLY — táto route sa nesmie
// dostať k Money zápisu ani k existujúcemu pergolovému odpisu (`$lib/server/pergola.ts`,
// `$lib/server/money.ts`) ani na character. Rovnaká disciplína ako
// tests/bazen-navrh-money-safety.test.ts (#139) — statická kontrola zdrojového kódu,
// plus behaviorálny test, že route nemá žiadnu zápisovú akciu.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

function zdroj(relPath: string): string {
	return fs.readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8');
}

// server/money = Money zápisovač, server/pergola = pergolová Money odpisová cesta
// (writeOdpis/dlv-import). Statické aj dynamické importy so zhodným zakázaným segmentom.
const ZAKAZANE_VZORY = [
	/from ['"].*server\/money['"]/,
	/from ['"].*server\/pergola['"]/,
	/import\(\s*['"`].*server\/money['"`]/,
	/import\(\s*['"`].*server\/pergola['"`]/,
	/writeOdpis|MONEY_LIVE/
];

const SUBORY = [
	'src/lib/pergola-narez.ts',
	'src/lib/server/pergola-narez-vstup.ts',
	'src/routes/pergola/narez/+page.server.ts',
	'src/routes/pergola/narez/+page.svelte'
];

describe('Money safety (#155) — pergola nárez z rozmerov neimportuje server/money ani server/pergola', () => {
	for (const subor of SUBORY) {
		it(`${subor} neimportuje nič z Money zapisovača ani z pergolovej odpisovej cesty`, () => {
			const src = zdroj(subor);
			for (const vzor of ZAKAZANE_VZORY) expect(src).not.toMatch(vzor);
		});
	}

	it('existujúci $lib/server/pergola.ts (Money odpis) ostáva NEDOTKNUTÝ — sanity, stále existuje', () => {
		// touto route sa nedotýkame pôvodnej pergolovej odpisovej cesty
		expect(zdroj('src/lib/server/pergola.ts').length).toBeGreaterThan(0);
	});
});

describe('/pergola/narez — žiadna cesta k Money odpisu (#155)', () => {
	it('akcie routy sú presne spocitat/upravit — žiadna odpisová/zápisová akcia', async () => {
		const { actions } = await import('../src/routes/pergola/narez/+page.server');
		expect(Object.keys(actions).sort()).toEqual(['spocitat', 'upravit']);
	});
});
