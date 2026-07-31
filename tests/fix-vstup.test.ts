// Šikmý FIX — parsovanie formulára. Server je jediný strážca rozsahov (HTML5
// min/max obíde skriptovaný POST) a modul nesmie nikdy nič poslať do Money, takže
// tu strážime hlavne to, čo prejde do výpočtu.
import { describe, it, expect } from 'vitest';
import { parseFixVstup } from '../src/lib/server/fix-vstup';

const fd = (o: Record<string, string>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(o)) f.append(k, v);
	return f;
};
const zaklad = { zak: 'ZAK1', op: 'OP260264', zakaznik: 'X', s: '2795', v1: '524', v2: '64.6' };

describe('parseFixVstup', () => {
	it('bez zoznamu polí = jedno pole cez celú šírku', () => {
		const { vstup, error } = parseFixVstup(fd(zaklad));
		expect(error).toBeNull();
		expect(vstup.polia).toEqual([2795]);
		expect(vstup.zrkadlo).toBe(false);
	});

	it('polia z JSON-u prejdú aj s desatinnou čiarkou', () => {
		const { vstup, error } = parseFixVstup(
			fd({ ...zaklad, polia: JSON.stringify(['936,2', 923.6, '935.2']) })
		);
		expect(error).toBeNull();
		expect(vstup.polia).toEqual([936.2, 923.6, 935.2]);
	});

	it('pokazený JSON polí nezhodí parser (spadne na kontrolu súčtu)', () => {
		const { error } = parseFixVstup(fd({ ...zaklad, polia: '{nie json' }));
		expect(error).toBeNull(); // prázdny zoznam → doplní sa jedno pole cez šírku
	});

	it('hlavička je povinná', () => {
		expect(parseFixVstup(fd({ ...zaklad, zak: '' })).error).toMatch(/ZAK/);
		expect(parseFixVstup(fd({ ...zaklad, op: '' })).error).toMatch(/OP/);
		expect(parseFixVstup(fd({ ...zaklad, zakaznik: '' })).error).toMatch(/[Zz]ákazník/);
	});

	it('rozmerové chyby prejdú z chybaFixVstupu (obídená HTML5 validácia)', () => {
		expect(parseFixVstup(fd({ ...zaklad, v2: '524' })).error).toMatch(/rovnaké/);
		expect(parseFixVstup(fd({ ...zaklad, s: '10' })).error).toMatch(/Šírka/);
		expect(parseFixVstup(fd({ ...zaklad, polia: JSON.stringify([1000, 1000]) })).error).toMatch(
			/nerovná/
		);
	});

	it('texty sa orežú na maximálnu dĺžku a zrkadlo je prepínač', () => {
		const { vstup } = parseFixVstup(
			fd({
				...zaklad,
				zrkadlo: '1',
				nazov: 'N'.repeat(100),
				ral: 'R'.repeat(80),
				sklo: 'S'.repeat(200),
				poznamka: 'P'.repeat(500)
			})
		);
		expect(vstup.zrkadlo).toBe(true);
		expect(vstup.nazov.length).toBe(60);
		expect(vstup.ral.length).toBe(40);
		expect(vstup.sklo.length).toBe(120);
		expect(vstup.poznamka.length).toBe(300);
	});

	it('viac polí ako povoľuje maximum sa odmietne (nie potichu oreže)', () => {
		const { error } = parseFixVstup(
			fd({ ...zaklad, polia: JSON.stringify(Array.from({ length: 9 }, () => 310.6)) })
		);
		expect(error).toMatch(/Počet polí/);
	});
});
