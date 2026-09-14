// #518: editor vzorcov (`/zasklenia/nastavenia`) musí ponúkať ROVNAKÝ dvojkrokový výber
// ako nárezák (`/zasklenia`): Systém → Štýl. Zdroj pravdy pre zoznam systémov (poradie +
// labely) je JEDEN — `systemyZoStylov(listSysStyly())` (poradie) + `nazovSystemu` (label),
// znovupoužitý oboma routami. Tieto testy strážia PARITU + DRIFT: keby niekto pridal systém
// alebo rozbil poradie/labely, padnú. Patrik (Odoo 922) upravil starý „Štandard" v domnení,
// že je v „Štandard +" — plochý jeden-select ich miešal; dvojkrok + názov systému to rozliší.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-nastavenia-systemy-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'r.db');
const dbMod = await import('../src/lib/server/db');
const { nazovSystemu } = await import('../src/lib/system-nazvy');
const { load } = await import('../src/routes/zasklenia/nastavenia/+page.server');

function loadEvent(sysStyl: string) {
	return {
		url: new URL(`http://x/zasklenia/nastavenia?sysStyl=${encodeURIComponent(sysStyl)}`)
	} as Parameters<typeof load>[0];
}

// Očakávané poradie KĽÚČOV systémov = poradie prvého výskytu v `listSysStyly()`
// (ORDER BY sys_styl). Toto pole je DRIFT GUARD — pridanie/odobratie systému ho zmení a
// test musí byť vedome upravený (nie ticho zlyhať v UI).
const OCAKAVANE_KLUCE = ['Deluxe', 'Robust', 'Slide', 'Štandard +', 'Štandard Drevo', 'Štandard'];
// Labely, ktoré z nich vidí obsluha (zhodné s nárezákovým `#system` selectom).
const OCAKAVANE_LABELY = [
	'Deluxe',
	'Robust',
	'Slide',
	'Štandard plus',
	'Drevostavby',
	'Starý štandard'
];

describe('#518 zoznam systémov — jediný zdroj pravdy + parita labelov', () => {
	it('systemyZoStylov(listSysStyly()) dáva presné poradie kľúčov (drift guard)', () => {
		expect(dbMod.systemyZoStylov(dbMod.listSysStyly())).toEqual(OCAKAVANE_KLUCE);
	});

	it('labely cez nazovSystemu zodpovedajú nárezákovým (Štandard plus / Starý štandard)', () => {
		const labely = dbMod.systemyZoStylov(dbMod.listSysStyly()).map(nazovSystemu);
		expect(labely).toEqual(OCAKAVANE_LABELY);
		// dve rodiny Štandardu MUSIA byť rozlíšiteľné (jadro Patrikovho omylu)
		expect(nazovSystemu('Štandard +')).toBe('Štandard plus');
		expect(nazovSystemu('Štandard')).toBe('Starý štandard');
		expect(nazovSystemu('Štandard +')).not.toBe(nazovSystemu('Štandard'));
	});

	it('systemyZoStylov ignoruje duplicity a zachová poradie prvého výskytu', () => {
		expect(
			dbMod.systemyZoStylov([
				{ system: 'Robust' },
				{ system: 'Robust' },
				{ system: 'Slide' },
				{ system: 'Robust' }
			])
		).toEqual(['Robust', 'Slide']);
	});
});

describe('#518 editor load() — systemy z jediného zdroja + system pre nadpis', () => {
	it('load vracia systemy zhodné so systemyZoStylov (nie druhá kópia)', async () => {
		const data = (await load(loadEvent('Robust|2K'))) as { systemy: string[] };
		expect(data.systemy).toEqual(dbMod.systemyZoStylov(dbMod.listSysStyly()));
	});

	it('Štandard + a starý Štandard sa v nadpise NEzamenia (data.system rozlišuje)', async () => {
		const plus = (await load(loadEvent('Štandard +|2K'))) as { system: string; sysStyl: string };
		const stary = (await load(loadEvent('Štandard|2K'))) as { system: string; sysStyl: string };
		expect(plus.system).toBe('Štandard +');
		expect(stary.system).toBe('Štandard');
		expect(nazovSystemu(plus.system)).toBe('Štandard plus');
		expect(nazovSystemu(stary.system)).toBe('Starý štandard');
		// nadpisové labely sa nesmú zhodovať — inak by editor opäť miešal dve rodiny
		expect(nazovSystemu(plus.system)).not.toBe(nazovSystemu(stary.system));
	});

	it('styly editora obsahujú SUROVÉ cfg kľúče (vrátane IZO variantov) daného systému', async () => {
		const data = (await load(loadEvent('Štandard +|2x4K IZO'))) as {
			styly: { sysStyl: string; system: string; styl: string }[];
			sysStyl: string;
		};
		const stylyStandardPlus = data.styly
			.filter((s) => s.system === 'Štandard +')
			.map((s) => s.styl);
		// editor edituje SUROVÉ vzorce — IZO varianty MUSIA byť dosiahnuteľné (Patrik ich upravoval)
		expect(stylyStandardPlus).toContain('2x4K IZO');
		expect(data.sysStyl).toBe('Štandard +|2x4K IZO');
	});
});
