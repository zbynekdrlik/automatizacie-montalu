// Rovný (pravouhlý) fix — Patrik 2026-07-31: „ako je kolónka šikmé fixe, zmenil by som
// to na FIXE prípadne pevné zasklenie, tam by som ďalej išiel rozbaľovacie menu na šikmé
// a rovné (pravouhlé)".
//
// Doteraz stránka rovný tvar VÝSLOVNE odmietala („výšky sú rovnaké — to nie je šikmý
// fix"). Testy tu strážia oba smery: rovný tvar musí prejsť, šikmý si musí kontrolu
// nechať, a geometria obdĺžnika musí sedieť (α = 0, hrana = šírka, uhly 90°/90°).
//
// Modul do Money nezapisuje nič — karty Cortizo COR-60 CE v katalógu neexistujú.
import { describe, it, expect } from 'vitest';
import { pocitajFix, chybaFixVstupu, jeFixTvar, popisTvaru, rovnomernePolia } from '../src/lib/fix';
import { parseFixVstup } from '../src/lib/server/fix-vstup';

describe('chybaFixVstupu — tvar rozhoduje, či sú rovnaké výšky chyba', () => {
	it('ROVNÝ: rovnaké výšky sú v poriadku (predtým to bola chyba)', () => {
		expect(chybaFixVstupu(2000, 800, 800, [2000], 'rovny')).toBeNull();
	});

	it('ŠIKMÝ: rovnaké výšky ostávajú chybou a hláška navedie na nový tvar', () => {
		const e = chybaFixVstupu(2000, 800, 800, [2000], 'sikmy');
		expect(e).toMatch(/rovnaké/);
		expect(e).toMatch(/rovný/);
	});

	it('ROVNÝ: nulová výška je chyba (obdĺžnik s nulovou výškou neexistuje)', () => {
		expect(chybaFixVstupu(2000, 0, 0, [2000], 'rovny')).toMatch(/Zadaj výšku/);
	});

	it('ROVNÝ: rôzne výšky sú chyba (poistka pre POST mimo formulára)', () => {
		expect(chybaFixVstupu(2000, 800, 900, [2000], 'rovny')).toMatch(/obe výšky rovnaké/);
	});

	it('ŠIKMÝ: pôvodné správanie sa nezmenilo — jedna výška smie byť 0 (špička)', () => {
		expect(chybaFixVstupu(2000, 1200, 0, [2000], 'sikmy')).toBeNull();
		expect(chybaFixVstupu(2000, 0, 0, [2000], 'sikmy')).toMatch(/aspoň jednu výšku/);
	});

	it('bez uvedeného tvaru sa správa ako šikmý (spätná kompatibilita)', () => {
		expect(chybaFixVstupu(2000, 800, 800, [2000])).toMatch(/rovnaké/);
		expect(chybaFixVstupu(2000, 1200, 900, [2000])).toBeNull();
	});

	it('kontroly šírky a polí platia rovnako pre oba tvary', () => {
		expect(chybaFixVstupu(100, 800, 800, [100], 'rovny')).toMatch(/Šírka/);
		expect(chybaFixVstupu(2000, 800, 800, [900, 900], 'rovny')).toMatch(/nerovná/);
	});
});

describe('jeFixTvar / popisTvaru', () => {
	it('pozná len dva tvary', () => {
		expect(jeFixTvar('sikmy')).toBe(true);
		expect(jeFixTvar('rovny')).toBe(true);
		expect(jeFixTvar('kruhovy')).toBe(false);
		expect(jeFixTvar(null)).toBe(false);
	});

	it('popis je po slovensky a hovorí to isté, čo je v ponuke', () => {
		expect(popisTvaru('rovny')).toBe('rovný (pravouhlý)');
		expect(popisTvaru('sikmy')).toBe('šikmý');
	});
});

describe('pocitajFix — geometria obdĺžnika (α = 0)', () => {
	it('2000 × 1500 na 1 pole: sklon 0°, hrana = šírka, uhly 90°/90°', () => {
		const r = pocitajFix(2000, 1500, 1500, [2000]);
		expect(r.alfa).toBe(0);
		expect(r.sikmaCelkom).toBe(2000);
		expect(r.uholOstry).toBe(90);
		expect(r.uholTupy).toBe(90);
		expect(r.m2).toBeCloseTo(3, 3);
	});

	it('3 rovnaké polia: každé má obe výšky rovnaké a hranu = svojej šírke', () => {
		const polia = rovnomernePolia(3000, 3);
		const r = pocitajFix(3000, 2000, 2000, polia);
		expect(r.polia).toHaveLength(3);
		for (const p of r.polia) {
			expect(p.vLavo).toBe(2000);
			expect(p.vPravo).toBe(2000);
			expect(p.sikma).toBe(p.sirka);
		}
		expect(r.vyskyStlpikov).toEqual([2000, 2000]);
	});
});

describe('parseFixVstup — rovný fix posiela JEDNU výšku', () => {
	const fd = (o: Record<string, string>) => {
		const f = new FormData();
		for (const [k, v] of Object.entries(o)) f.append(k, v);
		return f;
	};
	const zaklad = { zak: 'ZAK1', op: '01', zakaznik: 'X', s: '2000', polia: '[2000]' };

	it('v2 sa dopočíta z v1, aj keď vo formulári nie je', () => {
		const { vstup, error } = parseFixVstup(fd({ ...zaklad, tvar: 'rovny', v1: '1500' }));
		expect(error).toBeNull();
		expect(vstup.tvar).toBe('rovny');
		expect(vstup.v1).toBe(1500);
		expect(vstup.v2).toBe(1500);
	});

	it('poslaná v2 sa pri rovnom tvare IGNORUJE (nedá sa ňou obísť obdĺžnik)', () => {
		const { vstup, error } = parseFixVstup(
			fd({ ...zaklad, tvar: 'rovny', v1: '1500', v2: '900' })
		);
		expect(error).toBeNull();
		expect(vstup.v2).toBe(1500);
	});

	it('neznámy tvar spadne na šikmý — starý POST/bookmark ostáva platný', () => {
		const { vstup } = parseFixVstup(fd({ ...zaklad, tvar: 'kruhovy', v1: '1200', v2: '900' }));
		expect(vstup.tvar).toBe('sikmy');
		const bezTvaru = parseFixVstup(fd({ ...zaklad, v1: '1200', v2: '900' }));
		expect(bezTvaru.vstup.tvar).toBe('sikmy');
		expect(bezTvaru.error).toBeNull();
	});

	it('šikmý s rovnakými výškami stále padne', () => {
		expect(parseFixVstup(fd({ ...zaklad, tvar: 'sikmy', v1: '800', v2: '800' })).error).toMatch(
			/rovnaké/
		);
	});
});
