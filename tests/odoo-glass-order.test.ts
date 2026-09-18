// #521: payload builder `glass_order.items[]` + derivácia zloženia z názvu skla.
// Kontrakt: odoo-erp .claude/rules/montalu-narezak-upload.md (spec kľúče PLOCHÉ na item).
// Money-NEUTRÁLNE — čistý payload shaping, žiadny writeOdpis / money.ts / DB.
import { describe, it, expect } from 'vitest';
import {
	derivGlassComposition,
	buildGlassOrderItem,
	buildGlassOrder,
	type GlassOrderItemInput,
	type GlassSpec
} from '../src/lib/server/odoo-rozpis-lines';

const specOff: GlassSpec = {
	warmEdge: false,
	coloredFrame: false,
	muntinCrossQty: 0,
	holesQty: 0,
	holeSize: '',
	cutoutSmallQty: 0,
	cutoutLargeQty: 0,
	edgeFinish: 'none',
	hst: false,
	temperingOwnGlass: false
};

function pane(over: Partial<GlassOrderItemInput> = {}): GlassOrderItemInput {
	return {
		sirkaMm: 1200,
		vyskaMm: 800,
		vLavoMm: null,
		vPravoMm: null,
		sikmy: false,
		pocet: 2,
		typSkla: 'Nezaradené sklo',
		popis: '',
		...over
	};
}

describe('derivGlassComposition — zloženie z názvu skla (konzervatívne)', () => {
	it('IZO dvojsklo A/B/C → A-B-C + spacer=B (stred)', () => {
		expect(derivGlassComposition('Izolačné sklo 4/16/4 číre')).toEqual({
			composition: '4-16-4',
			spacer_mm: 16
		});
		expect(derivGlassComposition('Izolačné sklo 4/8/4 mliečne')).toEqual({
			composition: '4-8-4',
			spacer_mm: 8
		});
	});

	it('IZO s bodkovým oddeľovačom A.B.C', () => {
		expect(derivGlassComposition('Izolačné sklo 4.8.4')).toEqual({
			composition: '4-8-4',
			spacer_mm: 8
		});
	});

	it('IZO ESG (vlastná skladba 5esg/14/5esg) → 5-14-5 ESG + spacer=14', () => {
		expect(derivGlassComposition('5esg/14/5esg')).toEqual({
			composition: '5-14-5 ESG',
			spacer_mm: 14
		});
	});

	it('jednosklo N mm bez kalenia → N (bez spacer)', () => {
		expect(derivGlassComposition('Float sklo 6 mm')).toEqual({ composition: '6' });
		expect(derivGlassComposition('6mm číre')).toEqual({ composition: '6' });
		expect(derivGlassComposition('Float sklo 10 mm')).toEqual({ composition: '10' });
	});

	it('jednosklo kalené/ESG → "N ESG"', () => {
		expect(derivGlassComposition('ESG kalené 6 mm')).toEqual({ composition: '6 ESG' });
		expect(derivGlassComposition('Float kalené 10 mm')).toEqual({ composition: '10 ESG' });
	});

	it('VSG kód (44.2 / 3.3.1 / 4.4.2) → ten kód, žiadny spacer; guard B<6 nie je IZO', () => {
		expect(derivGlassComposition('44.2')).toEqual({ composition: '44.2' });
		expect(derivGlassComposition('3.3.1')).toEqual({ composition: '3.3.1' });
		expect(derivGlassComposition('3.3.2 mliečne')).toEqual({ composition: '3.3.2' });
		expect(derivGlassComposition('4.4.2 číre')).toEqual({ composition: '4.4.2' });
	});

	it('polykarbonát → nič (nie sklo, nech Odoo neoceňuje ako IZOS)', () => {
		expect(derivGlassComposition('polykarbonát 16 mm číry')).toEqual({});
	});

	it('nerozpoznateľné / prázdne → nič (Odoo default z glass_type)', () => {
		expect(derivGlassComposition('Nezaradené sklo')).toEqual({});
		expect(derivGlassComposition('')).toEqual({});
	});
});

describe('buildGlassOrderItem — základ + deriváty + spec', () => {
	it('#548 v2: základ + description/mode; deriváty vynechané keď nič', () => {
		const it0 = buildGlassOrderItem(pane({ popis: 'Posuv 1' }));
		expect(it0).toEqual({
			width_mm: 1200,
			height_mm: 800,
			glass_type: 'Nezaradené sklo',
			qty: 2,
			description: 'Posuv 1',
			mode: 'rozmery',
			note: 'Posuv 1'
		});
		expect(Object.keys(it0).sort()).toEqual(
			['description', 'glass_type', 'height_mm', 'mode', 'note', 'qty', 'width_mm'].sort()
		);
	});

	it('#548 v2: bez popisu → description/note vynechané, mode ostáva', () => {
		const it0 = buildGlassOrderItem(pane({ popis: '' }));
		expect(Object.keys(it0).sort()).toEqual(
			['glass_type', 'height_mm', 'mode', 'qty', 'width_mm'].sort()
		);
	});

	it('katalógová tabuľa → composition/spacer derivované automaticky', () => {
		const it0 = buildGlassOrderItem(pane({ typSkla: 'Izolačné sklo 4/16/4 číre', popis: '' }));
		expect(it0.composition).toBe('4-16-4');
		expect(it0.spacer_mm).toBe(16);
		expect(it0.glass_type).toBe('Izolačné sklo 4/16/4 číre');
	});

	it('spec kľúče vynechané keď default (off)', () => {
		const it0 = buildGlassOrderItem(pane({ spec: specOff }));
		for (const k of [
			'warm_edge',
			'colored_frame',
			'muntin_cross_qty',
			'holes_qty',
			'hole_size',
			'cutout_small_qty',
			'cutout_large_qty',
			'edge_finish',
			'hst',
			'tempering_own_glass'
		]) {
			expect(it0).not.toHaveProperty(k);
		}
	});

	it('spec kľúče poslané keď nastavené (non-default)', () => {
		const it0 = buildGlassOrderItem(
			pane({
				spec: {
					...specOff,
					warmEdge: true,
					coloredFrame: true,
					muntinCrossQty: 1,
					cutoutSmallQty: 2,
					cutoutLargeQty: 1,
					edgeFinish: 'ksr',
					hst: true,
					temperingOwnGlass: true
				}
			})
		);
		expect(it0.warm_edge).toBe(true);
		expect(it0.colored_frame).toBe(true);
		expect(it0.muntin_cross_qty).toBe(1);
		expect(it0.cutout_small_qty).toBe(2);
		expect(it0.cutout_large_qty).toBe(1);
		expect(it0.edge_finish).toBe('ksr');
		expect(it0.hst).toBe(true);
		expect(it0.tempering_own_glass).toBe(true);
	});

	it('holes_qty>0 → hole_size posielaný VŽDY explicitne (default d30, nie Odoo d50)', () => {
		const d30 = buildGlassOrderItem(pane({ spec: { ...specOff, holesQty: 2, holeSize: '' } }));
		expect(d30.holes_qty).toBe(2);
		expect(d30.hole_size).toBe('d30');

		const d50 = buildGlassOrderItem(pane({ spec: { ...specOff, holesQty: 3, holeSize: 'd50' } }));
		expect(d50.holes_qty).toBe(3);
		expect(d50.hole_size).toBe('d50');
	});

	it('edge_finish "none" sa nevynecháva rovnako ako default (omit)', () => {
		const it0 = buildGlassOrderItem(pane({ spec: { ...specOff, edgeFinish: 'none' } }));
		expect(it0).not.toHaveProperty('edge_finish');
	});

	it('šikmý FIX → height_mm = max(vLavo,vPravo) + šikmá poznámka', () => {
		const it0 = buildGlassOrderItem(
			pane({
				sikmy: true,
				vyskaMm: null,
				vLavoMm: 900,
				vPravoMm: 1300,
				popis: 'Pole 1'
			})
		);
		expect(it0.height_mm).toBe(1300);
		expect(it0.note).toContain('šikmé');
		expect(it0.note).toContain('900');
		expect(it0.note).toContain('1300');
	});

	it('rozmery sa zaokrúhľujú na celé mm', () => {
		const it0 = buildGlassOrderItem(pane({ sirkaMm: 1200.4, vyskaMm: 799.6 }));
		expect(it0.width_mm).toBe(1200);
		expect(it0.height_mm).toBe(800);
	});

	it('nulové/chýbajúce rozmery → height_mm=0 (bez pádu na null)', () => {
		const rovny = buildGlassOrderItem(pane({ vyskaMm: null }));
		expect(rovny.height_mm).toBe(0);
		const sikmy = buildGlassOrderItem(
			pane({ sikmy: true, vyskaMm: null, vLavoMm: null, vPravoMm: 1000, popis: '' })
		);
		expect(sikmy.height_mm).toBe(1000);
		expect(sikmy.note).toContain('šikmé');
	});
});

describe('buildGlassOrder — celá objednávka', () => {
	it('mapuje N položiek 1:1 do items[]', () => {
		const { order } = buildGlassOrder([
			pane({ typSkla: 'Izolačné sklo 4/16/4 číre' }),
			pane({ typSkla: 'Float kalené 6 mm', pocet: 1 })
		]);
		expect(order.version).toBe(2);
		expect(order.items).toHaveLength(2);
		expect(order.items[0]!.composition).toBe('4-16-4');
		expect(order.items[1]!.composition).toBe('6 ESG');
		expect(order.items[1]!.qty).toBe(1);
	});

	it('prázdny vstup → prázdne items', () => {
		expect(buildGlassOrder([]).order).toEqual({ version: 2, items: [] });
	});
});
