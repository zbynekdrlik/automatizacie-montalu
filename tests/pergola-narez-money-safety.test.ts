// Pergola nárez z rozmerov — Money-safety guard.
//
// #155 postavil túto route ako DISPLAY-ONLY. #221 to ZÁMERNE mení: route
// `/pergola/narez` (Rezervačný odpis) TERAZ posiela do Money — rezervačný odpis pri
// zadaní objednávky, cez EXISTUJÚCI potvrdzovací tok (nahlad → explicitné potvrdenie
// → zápis), bez +20 %. Guard sa preto zúžil na REÁLNY invariant: samotný VZORCOVÝ
// ENGINE (počíta materiál z rozmerov) ostáva čistý — nesmie sa viazať na Money
// odpisovú/zápisovú cestu; napojenie na Money žije oddelene v moste
// `$lib/server/pergola-rezervacia.ts` (ten Money importovať SMIE). Route súbory z
// pure-guardu vypadli, lebo teraz legitímne posielajú odpis.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

function zdroj(relPath: string): string {
	return fs.readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8');
}

// server/money = Money zápisovač, server/pergola = pergolová Money odpisová cesta
// (writeOdpis/dlv-import), server/db = odpis_log DB (dedup/claim). Vzorcový engine sa
// nesmie dotknúť ani jedného — inak by sa display výpočet ticho zviazal na Money.
const ZAKAZANE_VZORY = [
	/from ['"].*server\/money['"]/,
	/from ['"].*server\/pergola['"]/,
	/from ['"].*server\/db['"]/,
	/import\(\s*['"`].*server\/money['"`]/,
	/import\(\s*['"`].*server\/pergola['"`]/,
	/import\(\s*['"`].*server\/db['"`]/,
	/writeOdpis|MONEY_LIVE/
];

// LEN vzorcový engine + jeho čisté vstupy/kresba ostávajú Money-clean. Route súbory
// (`+page.server.ts` / `+page.svelte`) v tomto zozname ZÁMERNE NIE SÚ — #221 im dovolil
// posielať rezervačný odpis (cez most `pergola-rezervacia.ts`).
const CISTY_ENGINE = [
	'src/lib/pergola-narez.ts',
	// #161 — krov uloženie engine je tiež LEN potvrdené vzorce, display-only
	'src/lib/pergola-krov.ts',
	'src/lib/server/pergola-narez-vstup.ts',
	// #194 — technický výkres z rozmerov je tiež LEN display-only kresba
	'src/lib/components/PergolaNarezVykres.svelte',
	// #234 — ručné položky modul je pure + client-imported (+page.svelte); Money-priľahlý
	// (validuje Money kódy, emituje množstvá), MUSÍ ostať čistý, aby sa server kód
	// nezaviezol do klientského bundlu (validácia dostáva katalóg ako parameter).
	'src/lib/pergola-rucne.ts'
];

describe('Money safety — vzorcový engine nárezu z rozmerov ostáva čistý (#155/#221)', () => {
	for (const subor of CISTY_ENGINE) {
		it(`${subor} sa neviaže na Money zapisovač ani na odpisovú cestu`, () => {
			const src = zdroj(subor);
			for (const vzor of ZAKAZANE_VZORY) expect(src).not.toMatch(vzor);
		});
	}

	it('existujúca CAD Money cesta $lib/server/pergola.ts ostáva NEDOTKNUTÁ (sanity)', () => {
		expect(zdroj('src/lib/server/pergola.ts').length).toBeGreaterThan(0);
	});
});

describe('/pergola/narez — rezervačný odpis (#221) IDE cez potvrdzovací tok', () => {
	it('akcie routy = form (spocitat/upravit) + rezervácia (rezervovat/odoslat), nič viac', async () => {
		const { actions } = await import('../src/routes/pergola/narez/+page.server');
		expect(Object.keys(actions).sort()).toEqual(['odoslat', 'rezervovat', 'spocitat', 'upravit']);
	});

	it('most pergola-rezervacia napája engine na Money zámerne (opak čistoty enginu)', () => {
		// Kontrast k pure-guardu vyššie: TENTO súbor Money importovať MÁ (je to most).
		const src = zdroj('src/lib/server/pergola-rezervacia.ts');
		expect(src).toMatch(/server\/money/);
		expect(src).toMatch(/server\/pergola/);
	});
});
