// Starší systém „Štandard" (bez plus) — Patrik 2026-07-27: „a ešte máme štandard bez +".
//
// Vzorce sú odvodené z firemných nárezákov `ŠTANDARD/štandardná koľajnica/V2 + 2mm/
// Štandard starý/` (majstrovské zošity „Nárezový plán 2016[ IZO | – opona | IZO– opona]")
// a všetkých 12 štýlov má tu EXAKTNÝ odpisový vektor. Money kódy overené naživo
// read-only v ostrom Money (2026-07-27) — všetky existujú.
//
// Geometria (S = šírka balkóna, V = výška, n = počet krídel jednej strany):
//   šírka prírezu G = (W − 13 − X)/n, kde W = S (basic/IZO) alebo S/2 (opona);
//   X = 103/130/157 (basic aj IZO 2K/3K/4K), 100/124/151 (opona), 103/130/151 (IZO opona)
//   výška prírezu = V − 33 ; dorazová lišta = V − d (d = 7/9/11)
//   sklo basic/opona: G+14 × V−115 ; IZO: G−9 × V−135
// IZO pridáva rozširujúci „U" profil ZASP202439 (šírka G−4, výška V−161) a posúva
// SPODNÚ koľajnicu o veľkosť vyššie. Rozdiel oproti Štandard +: rám ZASP00018 a
// dorazový ZASP00021 (namiesto ZASP20244 / ZASP202419) a bez +2 mm reznej rezervy.
//
// Kusy „šírka U spodok" (kalkulačkový kód 11016) a opona „stredová dorazová lišta"
// (K-M08039) sa REŽÚ, ale v odpisovom hárku NIE SÚ → appka ich rovnako nezapisuje
// (rovnako to má Štandard +). Odpis sedí 1:1 s tým, čo dielňa posiela do Money.
import { describe, it, expect } from 'vitest';
import { buildCFG, computeFlat, type SysRow, type RezRow } from '../src/lib/server/compute';
import seed from '../src/lib/server/cfg_seed.json';

const cfg = buildCFG(seed.sys as SysRow[], seed.rez as RezRow[]);
const odpisByKod = (sysStyl: string, S: number, V: number) => {
	const r = computeFlat(cfg, sysStyl, S, V, false)!;
	const o: Record<string, number> = {};
	r.odpis.forEach((x) => (o[x.kod] = x.metre));
	return o;
};
const sklo = (sysStyl: string, S: number, V: number) => {
	const r = computeFlat(cfg, sysStyl, S, V, false)!;
	return { sirka: r.sklo.sirka, vyska: r.sklo.vyska, pocet: r.sklo.pocet };
};

// Vektory pri S = 3000, V = 2400 — metre = počet tyčí × dĺžka tyče (7500 / 3600 mm).
const VEKTORY: [string, Record<string, number>][] = [
	[
		'Štandard|2K',
		{
			ZASP00107: 7.5,
			ZASP00104: 7.5,
			ZASP202415: 7.2,
			ZASP00018: 7.5,
			ZASP00024: 7.5,
			ZASP00021: 7.5
		}
	],
	[
		'Štandard|3K',
		{
			ZASP00027: 7.5,
			ZASP00030: 7.5,
			ZASP202415: 7.2,
			ZASP00018: 7.5,
			ZASP00024: 15,
			ZASP00021: 7.5
		}
	],
	[
		'Štandard|4K',
		{
			ZASP00036: 7.5,
			ZASP00033: 7.5,
			ZASP202415: 7.2,
			ZASP00018: 7.5,
			ZASP00024: 15,
			ZASP00021: 7.5
		}
	],
	[
		'Štandard|2K IZO',
		{
			ZASP00107: 7.5,
			ZASP00030: 7.5,
			ZASP202415: 7.2,
			ZASP00018: 7.5,
			ZASP00024: 7.5,
			ZASP00021: 7.5,
			ZASP202439: 21.6
		}
	],
	[
		'Štandard|3K IZO',
		{
			ZASP00027: 7.5,
			ZASP00033: 7.5,
			ZASP202415: 7.2,
			ZASP00018: 7.5,
			ZASP00024: 15,
			ZASP00021: 7.5,
			ZASP202439: 21.6
		}
	],
	[
		'Štandard|4K IZO',
		{
			ZASP00036: 7.5,
			ZASP202432: 7.5,
			ZASP202415: 7.2,
			ZASP00018: 7.5,
			ZASP00024: 15,
			ZASP00021: 7.5,
			ZASP202439: 28.8
		}
	],
	[
		'Štandard|2x2K',
		{
			ZASP00107: 7.5,
			ZASP00104: 7.5,
			ZASP202415: 7.2,
			ZASP00018: 15,
			ZASP00024: 15,
			ZASP00021: 7.5
		}
	],
	[
		'Štandard|2x3K',
		{
			ZASP00027: 7.5,
			ZASP00030: 7.5,
			ZASP202415: 7.2,
			ZASP00018: 15,
			ZASP00024: 22.5,
			ZASP00021: 7.5
		}
	],
	[
		'Štandard|2x4K',
		{
			ZASP00036: 7.5,
			ZASP00033: 7.5,
			ZASP202415: 7.2,
			ZASP00018: 15,
			ZASP00024: 30,
			ZASP00021: 7.5
		}
	],
	[
		'Štandard|2x2K IZO',
		{
			ZASP00107: 7.5,
			ZASP00030: 7.5,
			ZASP202415: 7.2,
			ZASP00018: 15,
			ZASP00024: 15,
			ZASP00021: 7.5,
			ZASP202439: 28.8
		}
	],
	[
		'Štandard|2x3K IZO',
		{
			ZASP00027: 7.5,
			ZASP00033: 7.5,
			ZASP202415: 7.2,
			ZASP00018: 15,
			ZASP00024: 22.5,
			ZASP00021: 7.5,
			ZASP202439: 43.2
		}
	],
	[
		'Štandard|2x4K IZO',
		{
			ZASP00036: 7.5,
			ZASP202432: 7.5,
			ZASP202415: 7.2,
			ZASP00018: 15,
			ZASP00024: 30,
			ZASP00021: 7.5,
			ZASP202439: 57.6
		}
	]
];

describe('Štandard (bez +) — odpis 1:1 s nárezákom, všetkých 12 štýlov', () => {
	it.each(VEKTORY)('%s @ 3000×2400 dá presne očakávané metre', (sysStyl, ocakavane) => {
		expect(odpisByKod(sysStyl, 3000, 2400)).toEqual(ocakavane);
	});

	it('iné rozmery: dlhší balkón zdvojnásobí kladkové tyče', () => {
		// G = (4500−116)/2 = 2192 → na 3600 tyč sa zmestí 1 kus → 4 ks = 4 tyče
		expect(odpisByKod('Štandard|2K', 4500, 2100).ZASP202415).toBe(14.4);
		// 4K: G = (6000−170)/4 = 1457.5 → 2 kusy na tyč → 8 ks = 4 tyče
		expect(odpisByKod('Štandard|4K', 6000, 2600).ZASP202415).toBe(14.4);
		expect(odpisByKod('Štandard|4K', 6000, 2600).ZASP00024).toBe(22.5);
	});

	it('sklo: basic G+14 × V−115, IZO o 23×20 mm menšie, počet = počet krídel', () => {
		expect(sklo('Štandard|2K', 3000, 2400)).toEqual({ sirka: 1456, vyska: 2285, pocet: 2 });
		expect(sklo('Štandard|2K IZO', 3000, 2400)).toEqual({ sirka: 1433, vyska: 2265, pocet: 2 });
		expect(sklo('Štandard|4K', 3000, 2400)).toMatchObject({ vyska: 2285, pocet: 4 });
		// opona: dve polovice → G sa počíta z S/2 a skiel je 2n
		// (rozmer skla appka zaokrúhľuje na celé mm — 707,5 → 708)
		expect(sklo('Štandard|2x2K', 3000, 2400)).toEqual({ sirka: 708, vyska: 2285, pocet: 4 });
		expect(sklo('Štandard|2x3K IZO', 3000, 2400)).toMatchObject({ vyska: 2265, pocet: 6 });
	});
});

describe('Štandard vs Štandard + — sú to naozaj RÔZNE systémy', () => {
	it('starší Štandard používa rám ZASP00018 + dorazový ZASP00021, nie PLUS profily', () => {
		const stary = odpisByKod('Štandard|2K', 3000, 2400);
		expect(Object.keys(stary)).toContain('ZASP00018');
		expect(Object.keys(stary)).toContain('ZASP00021');
		expect(Object.keys(stary)).not.toContain('ZASP20244');
		expect(Object.keys(stary)).not.toContain('ZASP202419');
	});

	it('Štandard + zostal NEDOTKNUTÝ (rovnaké kódy aj metre ako pred pridaním)', () => {
		expect(odpisByKod('Štandard +|2K', 3000, 2400)).toEqual({
			ZASP00107: 7.5,
			ZASP00104: 7.5,
			ZASP202415: 7.2,
			ZASP20244: 7.5,
			ZASP00024: 7.5,
			ZASP202419: 7.5
		});
	});

	it('rovnaká šírka dá INÉ sklo (Štandard + má +2 mm reznú rezervu a inú medzeru)', () => {
		expect(sklo('Štandard|2K', 3000, 2400).sirka).not.toBe(sklo('Štandard +|2K', 3000, 2400).sirka);
	});

	it('IZO posúva SPODNÚ koľajnicu o veľkosť vyššie, horná ostáva', () => {
		for (const [n, horna, spodnaBasic, spodnaIzo] of [
			['2K', 'ZASP00107', 'ZASP00104', 'ZASP00030'],
			['3K', 'ZASP00027', 'ZASP00030', 'ZASP00033'],
			['4K', 'ZASP00036', 'ZASP00033', 'ZASP202432']
		] as const) {
			const b = Object.keys(odpisByKod(`Štandard|${n}`, 3000, 2400));
			const i = Object.keys(odpisByKod(`Štandard|${n} IZO`, 3000, 2400));
			expect(b).toContain(horna);
			expect(b).toContain(spodnaBasic);
			expect(i).toContain(horna);
			expect(i).toContain(spodnaIzo);
			// basic spodná koľajnica sa v IZO variante už nevyskytuje (posunula sa vyššie)
			expect(i as string[]).not.toContain(spodnaBasic as string);
		}
	});
});

describe('konfigurácia je konzistentná (rovnaké invarianty ako ostatné systémy)', () => {
	const styly = (seed.sys as SysRow[])
		.map((s) => s.sysStyl)
		.filter((s) => s.startsWith('Štandard|'));

	it('12 štýlov: basic 2K/3K/4K, IZO, opona a IZO opona', () => {
		expect(styly.sort()).toEqual(
			[
				'Štandard|2K',
				'Štandard|2K IZO',
				'Štandard|2x2K',
				'Štandard|2x2K IZO',
				'Štandard|2x3K',
				'Štandard|2x3K IZO',
				'Štandard|2x4K',
				'Štandard|2x4K IZO',
				'Štandard|3K',
				'Štandard|3K IZO',
				'Štandard|4K',
				'Štandard|4K IZO'
			].sort()
		);
	});

	it('každý štýl má presne 2 riadky typu sklo (inak by validSys vrátil null)', () => {
		for (const s of styly) {
			const sk = (seed.rez as RezRow[]).filter((r) => r.sysStyl === s && r.typ === 'sklo');
			expect(sk.length, s).toBe(2);
			expect(cfg[s], s).toBeDefined();
		}
	});

	it('kladkový a rozširujúci profil sa počítajú na 3600 mm tyč, zvyšok na 7500', () => {
		for (const r of (seed.rez as RezRow[]).filter((x) => x.sysStyl.startsWith('Štandard|'))) {
			const bar = (r as { dlzkaTyce?: number }).dlzkaTyce ?? 7500;
			expect(bar, `${r.sysStyl} ${r.kod}`).toBe(
				r.kod === 'ZASP202415' || r.kod === 'ZASP202439' ? 3600 : 7500
			);
		}
	});

	it('žiadny štýl nemá sklozávislý riadok (redukciu má len Slide)', () => {
		for (const r of (seed.rez as RezRow[]).filter((x) => x.sysStyl.startsWith('Štandard|')))
			expect(r.sklozavisle, r.sysStyl).toBe(0);
	});
});
