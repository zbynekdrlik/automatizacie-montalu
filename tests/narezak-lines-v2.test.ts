// #529: v2 nárezák payload (`narezak-lines-v2.ts`) — GROUNDWORK za flagom ODOO_NAREZ_LINES_V2.
// Overuje presný tvar (jeden riadok = jedna tyč, sumár per profil), uhly, posuv (uniform vs mixed),
// absolútnu URL obrázka a flag gating. Money-NEUTRÁLNE (žiadna cena; `kod` je profilový kód).
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import { buildNarezakV2, type NarezakV2 } from '../src/lib/server/narezak-lines-v2';
import { isNarezLinesV2Enabled } from '../src/lib/server/odoo-json2';
import type { MaterialRow } from '../src/lib/server/compute';

const BASE = 'https://app.montalu.cloud';

const material: MaterialRow[] = [
	{
		kod: 'ZASP00002', // má obrázok
		nazov: 'RÁMOVÝ',
		rezy: [
			{ rozmer: 2500, ks: 2 },
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
		kod: 'NEEXISTUJE', // bez obrázka
		nazov: 'ROVNÝ',
		rezy: [{ rozmer: 2000, ks: 1 }],
		tyce: 1,
		bary: [{ kusy: [{ rozmer: 2000, dlzka: 2004 }], zvysok: 5496 }],
		odpadMm: 5496,
		odpadPct: 73.3,
		barLen: 7500,
		sikmyRez: false
	},
	// tyce=0 → vypadne
	{
		kod: '',
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

describe('buildNarezakV2', () => {
	const v2 = buildNarezakV2(material, BASE);

	it('presný tvar: JEDEN riadok = JEDNA tyč (profily s tyce>0), sumár per profil', () => {
		expect(v2.lines).toHaveLength(3); // 2 tyče ZASP00002 + 1 tyč NEEXISTUJE (PRÁZDNY vypadol)
		expect(v2.sumar).toHaveLength(2);
	});

	it('riadok 1 (ZASP00002, tyč 1): kod/index/počet/dĺžka/rezy/uhly/odpad/posuv/obrázok', () => {
		expect(v2.lines[0]).toEqual({
			kod: 'ZASP00002',
			nazov: 'RÁMOVÝ',
			tyc_index: 1,
			tyc_pocet: 2,
			tyc_dlzka_mm: 7500,
			rezy_mm: [2500, 2500],
			uhol_l: 45,
			uhol_r: 45,
			odpad_mm: 2492,
			posuv: 1,
			profil_obrazok: 'https://app.montalu.cloud/profil/ZASP00002.webp'
		});
	});

	it('riadok 2 (zmiešaný posuv) → posuv VYNECHANÉ; obrázok ostáva', () => {
		expect(v2.lines[1]).toMatchObject({
			tyc_index: 2,
			rezy_mm: [1800, 2500],
			odpad_mm: 3192,
			profil_obrazok: 'https://app.montalu.cloud/profil/ZASP00002.webp'
		});
		expect(v2.lines[1]).not.toHaveProperty('posuv');
	});

	it('riadok 3 (rovný, bez obrázka): uhly 90/90, žiadny posuv, žiadny profil_obrazok', () => {
		expect(v2.lines[2]).toEqual({
			kod: 'NEEXISTUJE',
			nazov: 'ROVNÝ',
			tyc_index: 1,
			tyc_pocet: 1,
			tyc_dlzka_mm: 7500,
			rezy_mm: [2000],
			uhol_l: 90,
			uhol_r: 90,
			odpad_mm: 5496
		});
	});

	it('sumár per profil: rezy=súčet kusov, tyče, odpad; obrázok len keď existuje', () => {
		expect(v2.sumar[0]).toEqual({
			kod: 'ZASP00002',
			nazov: 'RÁMOVÝ',
			rezy: 4, // 2 + 2
			tyce: 2,
			odpad_mm: 5684,
			profil_obrazok: 'https://app.montalu.cloud/profil/ZASP00002.webp'
		});
		expect(v2.sumar[1]).toEqual({
			kod: 'NEEXISTUJE',
			nazov: 'ROVNÝ',
			rezy: 1,
			tyce: 1,
			odpad_mm: 5496
		});
	});

	it('default base URL = https://app.montalu.cloud keď sa nepodá', () => {
		const d = buildNarezakV2([material[0]!]);
		expect(d.lines[0]!.profil_obrazok).toBe('https://app.montalu.cloud/profil/ZASP00002.webp');
	});

	it('prázdny materiál → prázdny payload', () => {
		expect(buildNarezakV2([])).toEqual({ lines: [], sumar: [] });
	});
});

describe('isNarezLinesV2Enabled (flag gating)', () => {
	const prev = process.env.ODOO_NAREZ_LINES_V2;
	afterAll(() => {
		if (prev === undefined) delete process.env.ODOO_NAREZ_LINES_V2;
		else process.env.ODOO_NAREZ_LINES_V2 = prev;
	});

	it('default (nenastavené) → OFF', () => {
		delete process.env.ODOO_NAREZ_LINES_V2;
		expect(isNarezLinesV2Enabled()).toBe(false);
	});
	it('=1 → ON; iná hodnota → OFF', () => {
		process.env.ODOO_NAREZ_LINES_V2 = '1';
		expect(isNarezLinesV2Enabled()).toBe(true);
		process.env.ODOO_NAREZ_LINES_V2 = 'true';
		expect(isNarezLinesV2Enabled()).toBe(false);
	});
});

describe('narezak-lines-v2 je Money-NEUTRÁLNY (žiadna cena)', () => {
	const src = fs.readFileSync(
		new URL('../src/lib/server/narezak-lines-v2.ts', import.meta.url),
		'utf8'
	);
	it('neimportuje cenové/Money moduly', () => {
		expect(src).not.toMatch(/from\s+['"]\.\/(ceny|money|odoo-zakazka|zakazka-ceny|kovanie)['"]/);
		expect(src).not.toMatch(/fmtEur|predajVo|cenaSpolu|cenaNakup|€/);
	});
	it('žiadny výstupný kľúč nenesie cenu (data-flow guard)', () => {
		const v2: NarezakV2 = buildNarezakV2(material, BASE);
		const keys = new Set<string>();
		for (const l of v2.lines) for (const k of Object.keys(l)) keys.add(k);
		for (const s of v2.sumar) for (const k of Object.keys(s)) keys.add(k);
		for (const k of keys) expect(k).not.toMatch(/cena|nakup|predaj|eur|price/i);
	});
});
