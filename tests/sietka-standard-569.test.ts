// #569 (Patrik, Odoo úloha 1070; owner ROZHODNUTÉ 25.9.2026 „ano tak aby sedela") — sieťka
// Štandard/Štandard + z GEOMETRICKÉHO modelu rámu posuvu, nie zo skla:
//   kladkový sieťky  = kladkový posuvu + Δkríž  (Δkríž = +K Š+ posuv + stará sieťka,
//                                                 −K starý posuv + sieťka plus, 0 rovnaká rodina)
//   sieťovina šírka  = kladkový sieťky + R
//   sieťovina výška  = základné (ne-IZO) sklo V + H
// Seed K = 16,5, R = 17, H = 3. IZO sklo sieťku NEovplyvní (rozširovací profil do sieťky nejde).
// Tabuľka 8 buniek (3K 3000 × 1850, seed cfg) — komentáre 5828348318 / 5828418908 na #569.
// C/D = 976 (nie 977 z návrhu): 942,5 + 16,5 = 959 (rez) + 17 = 976 — jedno zaokrúhlenie.
import { describe, it, expect } from 'vitest';
import seed from '../src/lib/server/cfg_seed.json';
import odpisPred from './fixtures/sietka-standard-odpis-569.json';
import {
	buildCFG,
	safeCompute,
	computeMulti,
	type SysRow,
	type RezRow,
	type OdpisRow
} from '../src/lib/server/compute';

const cfg = buildCFG(seed.sys as SysRow[], seed.rez as RezRow[]);
const sietka = (posuv: string, sie: string) => ({
	uchyt: 'ziadny' as const,
	...(sie !== posuv ? { system: sie } : {})
});

type Bunka = [string, string, string, boolean, { sirka: number; vyska: number }, string];
const TABULKA: Bunka[] = [
	['A', 'Štandard +', 'Štandard +', false, { sirka: 960, vyska: 1738 }, '8×943'],
	['B', 'Štandard +', 'Štandard +', true, { sirka: 960, vyska: 1738 }, '8×943'],
	['C', 'Štandard +', 'Štandard', false, { sirka: 976, vyska: 1738 }, '6×943+2×959'],
	['D', 'Štandard +', 'Štandard', true, { sirka: 976, vyska: 1738 }, '6×943+2×959'],
	['E', 'Štandard', 'Štandard', false, { sirka: 969, vyska: 1738 }, '8×952'],
	['F', 'Štandard', 'Štandard', true, { sirka: 969, vyska: 1738 }, '8×952'],
	['G', 'Štandard', 'Štandard +', false, { sirka: 953, vyska: 1738 }, '6×952+2×936'],
	['H', 'Štandard', 'Štandard +', true, { sirka: 953, vyska: 1738 }, '6×952+2×936']
];

describe('#569 — 8 kombinácií posuv × sieťka × sklo (3K 3000 × 1850, seed)', () => {
	it.each(TABULKA)(
		'%s: posuv %s / sieťka %s / IZO=%s → sieťovina %o, kladkový %s',
		(_id, posuv, sie, izo, sietovina, kladkovy) => {
			const { r, err } = safeCompute(
				cfg,
				`${posuv}|3K${izo ? ' IZO' : ''}`,
				3000,
				1850,
				false,
				0,
				false,
				undefined,
				sietka(posuv, sie)
			);
			expect(err).toBeNull();
			expect(r!.sietovina).toEqual(sietovina);
			const kl = r!.material
				.find((m) => m.kod === 'ZASP202415')!
				.rezy.map((z) => `${z.ks}×${z.rozmer}`)
				.join('+');
			expect(kl).toBe(kladkovy);
		}
	);

	it('IZO sklo sieťku NEovplyvní — B=A, D=C, F=E, H=G (sieťka sa neodvíja od skla)', () => {
		for (const [posuv, sie] of [
			['Štandard +', 'Štandard +'],
			['Štandard +', 'Štandard'],
			['Štandard', 'Štandard'],
			['Štandard', 'Štandard +']
		] as const) {
			const basic = safeCompute(cfg, `${posuv}|3K`, 3000, 1850, false, 0, false, undefined, {
				...sietka(posuv, sie)
			});
			const izo = safeCompute(cfg, `${posuv}|3K IZO`, 3000, 1850, false, 0, false, undefined, {
				...sietka(posuv, sie)
			});
			expect(izo.r!.sklo).not.toEqual(basic.r!.sklo); // IZO sklo JE iné…
			expect(izo.r!.sietovina).toEqual(basic.r!.sietovina); // …sieťka nie
		}
	});

	it('bez sieťky výsledok nenesie rozmer sieťoviny (null)', () => {
		const { r } = safeCompute(cfg, 'Štandard +|3K', 3000, 1850, false, 0, false, undefined, null);
		expect(r!.sietovina).toBeNull();
	});

	it('computeMulti nesie per posuv TEN ISTÝ rozmer sieťoviny ako computeFlat (G bunka)', () => {
		const flat = safeCompute(cfg, 'Štandard|3K', 3000, 1850, false, 0, false, undefined, {
			uchyt: 'ziadny',
			system: 'Štandard +'
		});
		const multi = computeMulti(cfg, [
			{
				sysStyl: 'Štandard|3K',
				S: 3000,
				V: 1850,
				redukciaZero: false,
				sietka: { uchyt: 'ziadny', system: 'Štandard +' }
			}
		])!;
		expect(multi.posuvy[0]!.sietovina).toEqual(flat.r!.sietovina);
		expect(multi.odpis).toEqual(flat.r!.odpis);
	});

	it('Robust/Slide: sieťovina ostáva sklo +2/+1 (#569 ich nemení)', () => {
		const { r } = safeCompute(cfg, 'Robust|3K', 4645, 2320, false, 0, false, undefined, {
			uchyt: 'ziadny'
		});
		expect(r!.sietovina).toEqual({ sirka: r!.sklo.sirka + 2, vyska: r!.sklo.vyska + 1 });
	});
});

describe('#569 — bunky, ktoré Patrik potvrdil ako OK (A/E), sedia pre VŠETKY štýly 2K–6K', () => {
	// Patrik: „štandard plus sieťka plus … bez rozširovacieho profilu je OK" aj „starý štandard
	// stará sieťka … OK" — dnešné sklo +3/+3. Model (kladkový + R) ich musí dať pre každé N,
	// nielen pre 3K (R = 17 je konštantné: sklo_basic.S − kladkový.S = 14 mm pre každý štýl).
	const styly = (seed.sys as SysRow[])
		.map((s) => s.sysStyl)
		.filter((ss) => /^Štandard \+?\|\dK$/.test(ss) || /^Štandard\|\dK$/.test(ss));
	it('nájde štýly (test nie je no-op)', () => {
		expect(styly.length).toBe(8); // Š+ 2K–6K + Š 2K–4K
	});
	it.each(styly.flatMap((ss) => [3000, 4321].map((S) => [ss, S] as const)))(
		'%s pri S=%i: rovnaká rodina → sieťovina = sklo +3/+3',
		(ss, S) => {
			const { r, err } = safeCompute(cfg, ss, S, 2100, false, 0, false, undefined, {
				uchyt: 'ziadny'
			});
			expect(err).toBeNull();
			expect(r!.sietovina).toEqual({ sirka: r!.sklo.sirka + 3, vyska: r!.sklo.vyska + 3 });
		}
	);
});

describe('#569 — Money guard: odpis sa mení LEN pre kladkový v bunkách starý posuv + sieťka plus', () => {
	const pred = odpisPred as Record<string, OdpisRow[]>;
	it('fixtúra obsahuje 16 buniek (2 rozmery × 8)', () => {
		expect(Object.keys(pred).length).toBe(16);
	});
	it.each(Object.keys(pred))('%s', (kluc) => {
		const [system, styl, rozmer, sieStr] = kluc.split('|') as [string, string, string, string];
		const [S, V] = rozmer.split('x').map(Number) as [number, number];
		const sie = sieStr.replace('sietka=', '');
		const { r, err } = safeCompute(
			cfg,
			`${system}|${styl}`,
			S,
			V,
			false,
			0,
			false,
			undefined,
			sietka(system, sie)
		);
		expect(err).toBeNull();
		const zmenaKladkoveho = system === 'Štandard' && sie === 'Štandard +';
		const bezKladk = (o: OdpisRow[]) => o.filter((x) => x.kod !== 'ZASP202415');
		if (zmenaKladkoveho) expect(bezKladk(r!.odpis)).toEqual(bezKladk(pred[kluc]!));
		else expect(r!.odpis).toEqual(pred[kluc]);
	});
});
