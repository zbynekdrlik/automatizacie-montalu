// #532: `cut_plan` payload (`narezak-cut-plan.ts`) — kontrakt appka↔Odoo #7431 (nahrádza #529 v2
// groundwork). Overuje presný tvar (jeden bars[] = jedna fyzická tyč: profile_kod/name/stock,
// pieces[] v poradí rezu s length/angles/label/qty, waste, render_svg), pravidlo „bez Money kódu →
// tyč vynechaná", omit-keď-žiadne-tyče (undefined) a SVG render (base64 → `<svg` + N segmentov).
// Money-NEUTRÁLNE (žiadna cena; `profile_kod` je profilový článkový kód).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
	buildCutPlan,
	pocetVynechanychBezKodu,
	type CutPlan,
	type CutPlanBar
} from '../src/lib/server/narezak-cut-plan';
import type { MaterialRow } from '../src/lib/server/compute';

/** dekóduj base64 SVG na text. */
const decodeSvg = (b64: string): string => Buffer.from(b64, 'base64').toString('utf8');
/** bar bez render_svg (na presné porovnanie dátových polí). */
const stripSvg = (b: CutPlanBar): Omit<CutPlanBar, 'render_svg'> => {
	const { render_svg, ...rest } = b;
	void render_svg;
	return rest;
};

const material: MaterialRow[] = [
	{
		// zahrnutý — šikmý (45/45), 2 tyče, posuvy (zimná záhrada)
		kod: 'ZASP00002',
		nazov: 'RÁMOVÝ',
		rezy: [
			{ rozmer: 2500, ks: 3 },
			{ rozmer: 1800, ks: 1 }
		],
		tyce: 2,
		bary: [
			{
				kusy: [
					{ rozmer: 2500, dlzka: 2504, posuv: 1 },
					{ rozmer: 2500, dlzka: 2504, posuv: 1 }
				],
				zvysok: 2492
			}, // uniform posuv 1
			{
				kusy: [
					{ rozmer: 1800, dlzka: 1804, posuv: 1 },
					{ rozmer: 2500, dlzka: 2504, posuv: 2 }
				],
				zvysok: 3192
			} // zmiešaný posuv
		],
		odpadMm: 5684,
		odpadPct: 37.9,
		barLen: 7500,
		sikmyRez: true
	},
	{
		// zahrnutý — rovný (90/90), 1 tyč, bez posuvu, iná dĺžka tyče
		kod: 'BPP00054',
		nazov: 'ROVNÝ',
		rezy: [{ rozmer: 2000, ks: 1 }],
		tyce: 1,
		bary: [{ kusy: [{ rozmer: 2000, dlzka: 2004 }], zvysok: 3996 }],
		odpadMm: 3996,
		odpadPct: 66.6,
		barLen: 6000,
		sikmyRez: false
	},
	{
		// VYNECHANÝ — žiadny Money kód (profile_kod nikdy prázdny)
		kod: '',
		nazov: 'BEZ KÓDU',
		rezy: [{ rozmer: 1000, ks: 1 }],
		tyce: 1,
		bary: [{ kusy: [{ rozmer: 1000, dlzka: 1004 }], zvysok: 6496 }],
		odpadMm: 6496,
		odpadPct: 86.6,
		barLen: 7500,
		sikmyRez: false
	},
	{
		// VYNECHANÝ — tyce=0
		kod: 'ZASP99999',
		nazov: 'PRÁZDNY',
		rezy: [],
		tyce: 0,
		bary: [],
		odpadMm: 0,
		odpadPct: 0,
		barLen: 7500,
		sikmyRez: false
	}
];

describe('buildCutPlan', () => {
	const plan = buildCutPlan(material) as CutPlan;

	it('version=1 a JEDEN bars[] = JEDNA fyzická tyč (len profily s kódom + tyce>0)', () => {
		expect(plan).toBeDefined();
		expect(plan.version).toBe(1);
		// 2 tyče ZASP00002 + 1 tyč BPP00054 = 3; BEZ KÓDU + PRÁZDNY vypadli
		expect(plan.bars).toHaveLength(3);
		expect(plan.bars.map((b) => b.bar_id)).toEqual(['B1', 'B2', 'B3']);
		// žiadna vydaná tyč nemá prázdny profile_kod
		expect(plan.bars.every((b) => b.profile_kod !== '')).toBe(true);
	});

	it('B1 (ZASP00002 tyč 1): presný tvar — seq/length/angles/label/qty/waste/stock', () => {
		expect(stripSvg(plan.bars[0]!)).toEqual({
			bar_id: 'B1',
			profile_kod: 'ZASP00002',
			profile_name: 'RÁMOVÝ',
			stock_length_mm: 7500,
			pieces: [
				{
					seq: 1,
					length_mm: 2500,
					angle_left_deg: 45,
					angle_right_deg: 45,
					label: 'Z1 2500',
					qty: 1
				},
				{
					seq: 2,
					length_mm: 2500,
					angle_left_deg: 45,
					angle_right_deg: 45,
					label: 'Z1 2500',
					qty: 1
				}
			],
			waste_mm: 2492,
			note: ''
		});
	});

	it('B2 (zmiešaný posuv): label nesie Z1 aj Z2, seq v poradí rezu', () => {
		expect(stripSvg(plan.bars[1]!)).toEqual({
			bar_id: 'B2',
			profile_kod: 'ZASP00002',
			profile_name: 'RÁMOVÝ',
			stock_length_mm: 7500,
			pieces: [
				{
					seq: 1,
					length_mm: 1800,
					angle_left_deg: 45,
					angle_right_deg: 45,
					label: 'Z1 1800',
					qty: 1
				},
				{
					seq: 2,
					length_mm: 2500,
					angle_left_deg: 45,
					angle_right_deg: 45,
					label: 'Z2 2500',
					qty: 1
				}
			],
			waste_mm: 3192,
			note: ''
		});
	});

	it('B3 (rovný profil, bez posuvu): uhly 90/90, label = len dĺžka, vlastná dĺžka tyče', () => {
		expect(stripSvg(plan.bars[2]!)).toEqual({
			bar_id: 'B3',
			profile_kod: 'BPP00054',
			profile_name: 'ROVNÝ',
			stock_length_mm: 6000,
			pieces: [
				{ seq: 1, length_mm: 2000, angle_left_deg: 90, angle_right_deg: 90, label: '2000', qty: 1 }
			],
			waste_mm: 3996,
			note: ''
		});
	});

	it('render_svg per tyč: base64 → `<svg`, N segmentov `class="rez"` = počet kusov, odpad segment keď zvyšok', () => {
		const svg1 = decodeSvg(plan.bars[0]!.render_svg);
		expect(svg1.startsWith('<svg')).toBe(true);
		expect((svg1.match(/class="rez"/g) ?? []).length).toBe(2); // 2 kusy
		expect(svg1).toContain('class="odpad"'); // zvysok 2492 > 1
		const svg3 = decodeSvg(plan.bars[2]!.render_svg);
		expect(svg3.startsWith('<svg')).toBe(true);
		expect((svg3.match(/class="rez"/g) ?? []).length).toBe(1); // 1 kus
	});

	it('render_svg NEOBSAHUJE ceny (Money-neutrálny)', () => {
		for (const b of plan.bars) {
			const svg = decodeSvg(b.render_svg);
			expect(svg).not.toMatch(/€|eur|cena|price/i);
		}
	});

	it('žiadny coded bar → undefined (kľúč sa vynechá úplne)', () => {
		expect(buildCutPlan([])).toBeUndefined();
		// len profil bez kódu → tiež undefined
		expect(buildCutPlan([material[2]!])).toBeUndefined();
		// len profil tyce=0 → undefined
		expect(buildCutPlan([material[3]!])).toBeUndefined();
	});

	it('bez kódu VYNECHÁ tyč, ale nezastaví ostatné (bar_id ostáva súvislý)', () => {
		// [BEZ KÓDU, BPP00054] → len BPP00054 vyjde ako B1 (bez-kódu tyč nedostane bar_id)
		const p = buildCutPlan([material[2]!, material[1]!]) as CutPlan;
		expect(p.bars).toHaveLength(1);
		expect(p.bars[0]!.bar_id).toBe('B1');
		expect(p.bars[0]!.profile_kod).toBe('BPP00054');
	});

	it('obranný default: chýbajúci sikmyRez → 45/45 (ako RozpisRezov `?? true`)', () => {
		const stary: MaterialRow = { ...material[1]!, kod: 'ZASP12345' };
		delete (stary as { sikmyRez?: boolean }).sikmyRez;
		const p = buildCutPlan([stary]) as CutPlan;
		expect(p.bars[0]!.pieces[0]!.angle_left_deg).toBe(45);
		expect(p.bars[0]!.pieces[0]!.angle_right_deg).toBe(45);
	});
});

describe('pocetVynechanychBezKodu', () => {
	it('spočíta profily s tyčami ale BEZ Money kódu (log na vynechané tyče)', () => {
		// material: ZASP00002 (kód), BPP00054 (kód), BEZ KÓDU (kod=''), PRÁZDNY (tyce=0)
		expect(pocetVynechanychBezKodu(material)).toBe(1); // len „BEZ KÓDU" (tyce>0, kod='')
		expect(pocetVynechanychBezKodu([])).toBe(0);
		expect(pocetVynechanychBezKodu([material[0]!])).toBe(0); // má kód
		expect(pocetVynechanychBezKodu([material[3]!])).toBe(0); // tyce=0 → nepočíta sa
	});
});

describe('renderBarSvg — hranné prípady (branch coverage)', () => {
	const branchMat: MaterialRow[] = [
		{
			kod: 'ZASP55555',
			nazov: 'BRANCH',
			rezy: [
				{ rozmer: 7000, ks: 1 },
				{ rozmer: 100, ks: 1 },
				{ rozmer: 7496, ks: 1 }
			],
			tyce: 2,
			bary: [
				// tyč 1: úzky kus (<5 % → popisok skrytý) + veľký kus; malý odpad (>1, <12 % → bez „odpad" textu)
				{
					kusy: [
						{ rozmer: 100, dlzka: 100 },
						{ rozmer: 7000, dlzka: 7000 }
					],
					zvysok: 400
				},
				// tyč 2: bez odpadu (zvyšok ≤ 1 → žiadny odpad segment)
				{ kusy: [{ rozmer: 7496, dlzka: 7496 }], zvysok: 0 }
			],
			odpadMm: 400,
			odpadPct: 2.7,
			barLen: 7500,
			sikmyRez: false
		}
	];
	const plan = buildCutPlan(branchMat) as CutPlan;

	it('úzky kus (<5 %) skryje mm popisok; malý odpad (<12 %) kreslí segment bez „odpad" textu', () => {
		const svg = decodeSvg(plan.bars[0]!.render_svg);
		expect((svg.match(/class="rez"/g) ?? []).length).toBe(2); // 2 kusy nakreslené
		expect(svg).toContain('class="odpad"'); // odpad 400 > 1 → segment je
		expect(svg).not.toContain('odpad 400'); // ale <12 % → bez textu
		// jediný mm popisok = veľký kus (7000); úzky 100 mm kus popisok nemá
		expect((svg.match(/<text /g) ?? []).length).toBe(1);
	});

	it('tyč bez odpadu (zvyšok ≤ 1) → žiadny odpad segment', () => {
		const svg = decodeSvg(plan.bars[1]!.render_svg);
		expect((svg.match(/class="rez"/g) ?? []).length).toBe(1);
		expect(svg).not.toContain('class="odpad"');
	});
});

describe('narezak-cut-plan je Money-NEUTRÁLNY (žiadna cena)', () => {
	const src = fs.readFileSync(
		new URL('../src/lib/server/narezak-cut-plan.ts', import.meta.url),
		'utf8'
	);
	it('neimportuje cenové/Money moduly', () => {
		expect(src).not.toMatch(/from\s+['"]\.\/(ceny|money|odoo-zakazka|zakazka-ceny|kovanie)['"]/);
		expect(src).not.toMatch(/fmtEur|predajVo|cenaSpolu|cenaNakup/);
	});
	it('žiadny výstupný kľúč nenesie cenu (data-flow guard)', () => {
		const plan = buildCutPlan(material) as CutPlan;
		const keys = new Set<string>();
		for (const b of plan.bars) {
			for (const k of Object.keys(b)) keys.add(k);
			for (const p of b.pieces) for (const k of Object.keys(p)) keys.add(k);
		}
		for (const k of keys) expect(k).not.toMatch(/cena|nakup|predaj|eur|price/i);
	});
});
