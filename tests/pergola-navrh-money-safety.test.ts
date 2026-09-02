// Pergola — zákaznícky NÁVRHOVÝ výkres (#138). Money-safety guard.
//
// #396: `/pergola/navrh` (`pergola-navrh.ts`, `pergola-navrh-vstup.ts`,
// `PergolaNavrhVykres.svelte`) je — na rozdiel od `/pergola/narez` (#221, Rezervačný
// odpis, viď `pergola-narez-money-safety.test.ts`) — CELÝ display-only: rozmerový
// formulár → SVG výkres → tlač, žiadny potvrdzovací tok, žiadny most na Money (route
// `src/routes/pergola/navrh/+page.server.ts` má len akcie `vykres`/`upravit`, žiadnu
// odpisovú). Toto tvrdenie doteraz stálo len na ručnej inšpekcii importov (review
// #382) — tento test ho robí MECHANICKÝM, presne ten istý vzor ako sesterský
// `bazen-navrh-money-safety.test.ts` (#139) a `ZAKAZANE_VZORY` z
// `pergola-narez-money-safety.test.ts`'s `CISTY_ENGINE`.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

function zdroj(relPath: string): string {
	return fs.readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8');
}

// server/money = Money zápisovač, server/pergola = pergolová Money odpisová cesta
// (writeOdpis/dlv-import), server/db = odpis_log DB (dedup/claim). Návrhový výkres sa
// nesmie dotknúť ani jedného — inak by sa display výpočet ticho zviazal na Money.
// Čistý NEGATÍVNY match na vzory, ktoré sa v tomto module vôbec nevyskytujú — Stryker
// je bezpečný (#380/PR #399): pasca sa týka POZITÍVNYCH matchov na susediace literály,
// ktoré Stryker inštrumentáciou reálne existujúceho reťazca rozdelí, nie neprítomných
// zakázaných vzorov (rovnaká disciplína ako `pergola-fix` guard v
// `pergola-narez-money-safety.test.ts`).
const ZAKAZANE_VZORY = [
	/from ['"].*server\/money['"]/,
	/from ['"].*server\/pergola['"]/,
	/from ['"].*server\/db['"]/,
	/import\(\s*['"`].*server\/money['"`]/,
	/import\(\s*['"`].*server\/pergola['"`]/,
	/import\(\s*['"`].*server\/db['"`]/,
	/writeOdpis|MONEY_LIVE/
];

const CISTY_ENGINE = [
	'src/lib/pergola-navrh.ts',
	'src/lib/server/pergola-navrh-vstup.ts',
	'src/lib/components/PergolaNavrhVykres.svelte'
];

describe('Money safety — pergola návrhový výkres ostáva čistý (#138/#396)', () => {
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
