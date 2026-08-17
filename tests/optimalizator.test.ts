import { describe, it, expect } from 'vitest';
import { optimalizuj } from '../src/lib/server/optimalizator';
import { ffdPack } from '../src/lib/server/compute';

// Vzorový vstup 1:1 zo screenshotu externej appky, ktorú #212 nahrádza:
// tyč 6000 mm, rezná medzera 10 mm, 8 kusov. Očakávané zoskupenie tyčí je
// IDENTICKÉ so screenshotom; odpad na tyč je o jeden kotúč (10 mm) menší, lebo
// engine účtuje reznú medzeru per kus (konzervatívne) — viď dizajn na #212.
const SCREENSHOT = {
	dlzkaTyce: 6000,
	pocetTyci: 10,
	reznaMedzera: 10,
	kusy: [
		{ dlzka: 2280, pocet: 1 },
		{ dlzka: 1390, pocet: 1 },
		{ dlzka: 988, pocet: 1 },
		{ dlzka: 1280, pocet: 1 },
		{ dlzka: 3780, pocet: 1 },
		{ dlzka: 2831, pocet: 1 },
		{ dlzka: 2834, pocet: 2 }
	]
};

describe('ffdPack — spätná kompatibilita + parameter reznej medzery', () => {
	it('default kerf ostáva KOTUC (4 mm) — existujúci volajúci sa nemenia', () => {
		const bary = ffdPack([{ rozmer: 100, dlzka: 100 }], 7500);
		expect(bary).toHaveLength(1);
		expect(bary[0].zvysok).toBe(7500 - 104); // 100 + 4 mm kotúč
	});

	it('tretí parameter kerf sa použije namiesto KOTUC', () => {
		const bary = ffdPack([{ rozmer: 100, dlzka: 100 }], 6000, 10);
		expect(bary[0].zvysok).toBe(6000 - 110); // 100 + 10 mm rezná medzera
	});
});

describe('optimalizuj — nárezový optimalizátor (#212)', () => {
	it('reprodukuje zoskupenie zo screenshotu (4 tyče, správny odpad)', () => {
		const r = optimalizuj(SCREENSHOT);
		expect(r.tyceUsed).toBe(4);
		expect(r.vojdeSa).toBe(true);
		expect(r.tooLong).toEqual([]);
		expect(r.material).toHaveLength(1);
		const m = r.material[0];
		expect(m.tyce).toBe(4);
		expect(m.bary).toHaveLength(4);
		// množina odpadov na tyčiach (nezávisle od poradia)
		const zvysky = m.bary.map((b) => b.zvysok).sort((a, b) => a - b);
		expect(zvysky).toEqual([312, 810, 869, 3712]);
		// zoskupenie kusov na tyče (nezávisle od poradia tyčí)
		const skupiny = m.bary.map((b) => b.kusy.map((k) => k.dlzka).sort((a, b) => b - a));
		expect(skupiny).toContainEqual([3780, 1390]);
		expect(skupiny).toContainEqual([2834, 2834]);
		expect(skupiny).toContainEqual([2831, 2280]);
		expect(skupiny).toContainEqual([1280, 988]);
		expect(m.odpadMm).toBe(5703);
		expect(m.odpadPct).toBe(23.8);
		expect(m.barLen).toBe(6000);
		expect(m.sikmyRez).toBe(false);
		// agregovaná tabuľka rezov: 2834 sa vyskytuje 2×
		const r2834 = m.rezy.find((x) => x.rozmer === 2834);
		expect(r2834?.ks).toBe(2);
	});

	it('varuje, keď sa kusy nezmestia do zadaného počtu tyčí', () => {
		const r = optimalizuj({ ...SCREENSHOT, pocetTyci: 3 });
		expect(r.tyceUsed).toBe(4);
		expect(r.vojdeSa).toBe(false);
		expect(r.varovania.join(' ')).toMatch(/nezmest|tyč/i);
	});

	it('rezná medzera 0 zmenší odpad oproti medzere 10', () => {
		const s0 = optimalizuj({ ...SCREENSHOT, reznaMedzera: 0 });
		const s10 = optimalizuj(SCREENSHOT);
		expect(s0.material[0].odpadMm).toBeLessThan(s10.material[0].odpadMm);
	});

	it('kus dlhší ako tyč (aj s reznou medzerou) sa nebalí a ohlási sa', () => {
		const r = optimalizuj({
			dlzkaTyce: 6000,
			pocetTyci: 5,
			reznaMedzera: 10,
			kusy: [
				{ dlzka: 6000, pocet: 1 }, // 6000 + 10 > 6000 → nezmestí sa
				{ dlzka: 2000, pocet: 1 }
			]
		});
		expect(r.tooLong).toContain(6000);
		expect(r.tyceUsed).toBe(1); // len 2000 sa zabalí
		expect(r.varovania.join(' ')).toMatch(/dlh|nezmest/i);
	});

	it('prázdny zoznam kusov dá prázdny výsledok bez pádu', () => {
		const r = optimalizuj({ dlzkaTyce: 6000, pocetTyci: 5, reznaMedzera: 10, kusy: [] });
		expect(r.tyceUsed).toBe(0);
		expect(r.material.every((m) => m.tyce === 0)).toBe(true);
	});
});
