// #521: CRUD perzistencia špecifikácie tabule (spec_* stĺpce) + validácia + tok do buildGlassOrder.
// Money-NEUTRÁLNE (objednavka_skla, žiadny Money odpis).
import { describe, it, expect } from 'vitest';
import { GLASS_SPEC_OFF, buildGlassOrder } from '../src/lib/server/odoo-rozpis-lines';

describe('objednavka-skla spec CRUD (#521)', () => {
	it('nový riadok má vypnutý spec (default)', async () => {
		const { pridajSklo, getSkloPolozka } = await import('../src/lib/server/objednavka-skla');
		const id = pridajSklo({
			zak: 'ZAK-SPEC-1',
			modul: 'zasklenia',
			popis: 'Posuv',
			sirkaMm: 1000,
			vyskaMm: 1000,
			pocet: 1,
			typSkla: 'Izolačné sklo 4/16/4 číre',
			createdBy: 'test'
		});
		const p = getSkloPolozka(id);
		expect(p!.spec).toEqual(GLASS_SPEC_OFF);
	});

	it('nastavSpec perzistuje a číta späť (round-trip)', async () => {
		const { pridajSklo, nastavSpec, getSkloPolozka } =
			await import('../src/lib/server/objednavka-skla');
		const id = pridajSklo({
			zak: 'ZAK-SPEC-2',
			modul: 'fix',
			popis: 'Pole',
			sirkaMm: 800,
			vyskaMm: 600,
			pocet: 3,
			typSkla: 'ESG kalené 6 mm',
			createdBy: 'test'
		});
		nastavSpec(id, {
			...GLASS_SPEC_OFF,
			warmEdge: true,
			holesQty: 2,
			holeSize: 'd50',
			edgeFinish: 'ksr',
			hst: true
		});
		const p = getSkloPolozka(id);
		expect(p!.spec.warmEdge).toBe(true);
		expect(p!.spec.holesQty).toBe(2);
		expect(p!.spec.holeSize).toBe('d50');
		expect(p!.spec.edgeFinish).toBe('ksr');
		expect(p!.spec.hst).toBe(true);
		// nezmenené ostávajú default
		expect(p!.spec.coloredFrame).toBe(false);
		expect(p!.spec.temperingOwnGlass).toBe(false);
	});

	it('otvory > 0 bez zvolenej triedy → default d30 (nie prázdne, nie d50)', async () => {
		const { pridajSklo, nastavSpec, getSkloPolozka } =
			await import('../src/lib/server/objednavka-skla');
		const id = pridajSklo({
			zak: 'ZAK-SPEC-3',
			modul: 'zasklenia',
			popis: 'P',
			sirkaMm: 500,
			vyskaMm: 500,
			pocet: 1,
			typSkla: 'Float sklo 6 mm',
			createdBy: 'test'
		});
		nastavSpec(id, { ...GLASS_SPEC_OFF, holesQty: 1, holeSize: '' });
		expect(getSkloPolozka(id)!.spec.holeSize).toBe('d30');
		// otvory = 0 → hole_size sa vynuluje aj keď je zvolené d50 (nemá zmysel bez otvorov)
		nastavSpec(id, { ...GLASS_SPEC_OFF, holesQty: 0, holeSize: 'd50' });
		expect(getSkloPolozka(id)!.spec.holeSize).toBe('');
	});

	it('validateSpec hodí na neplatné hodnoty', async () => {
		const { validateSpec } = await import('../src/lib/server/objednavka-skla');
		expect(() => validateSpec({ ...GLASS_SPEC_OFF, holesQty: -1 })).toThrow();
		expect(() => validateSpec({ ...GLASS_SPEC_OFF, muntinCrossQty: 1.5 })).toThrow();
		// @ts-expect-error — zámerne neplatná hodnota
		expect(() => validateSpec({ ...GLASS_SPEC_OFF, edgeFinish: 'nieco' })).toThrow();
		// @ts-expect-error — zámerne neplatná hodnota
		expect(() => validateSpec({ ...GLASS_SPEC_OFF, holeSize: 'd99' })).toThrow();
	});

	it('spec z DB položky tečie do buildGlassOrder payloadu', async () => {
		const { pridajSklo, nastavSpec, listSklaPreZakazku } =
			await import('../src/lib/server/objednavka-skla');
		const id = pridajSklo({
			zak: 'ZAK-SPEC-4',
			modul: 'zasklenia',
			popis: 'Posuv 1',
			sirkaMm: 1200,
			vyskaMm: 800,
			pocet: 2,
			typSkla: 'Izolačné sklo 4/16/4 číre',
			createdBy: 'test'
		});
		nastavSpec(id, { ...GLASS_SPEC_OFF, warmEdge: true, edgeFinish: 'trapez_lestena' });
		const polozky = listSklaPreZakazku('ZAK-SPEC-4');
		const order = buildGlassOrder(polozky);
		const item = order.items[0]!;
		expect(item.composition).toBe('4-16-4');
		expect(item.spacer_mm).toBe(16);
		expect(item.warm_edge).toBe(true);
		expect(item.edge_finish).toBe('trapez_lestena');
	});

	it('mapSpec: neplatné uložené texty (hole_size/edge_finish) → predvolené', async () => {
		const { db } = await import('../src/lib/server/db');
		const { pridajSklo, getSkloPolozka } = await import('../src/lib/server/objednavka-skla');
		const id = pridajSklo({
			zak: 'ZAK-SPEC-5',
			modul: 'zasklenia',
			popis: 'P',
			sirkaMm: 500,
			vyskaMm: 500,
			pocet: 1,
			typSkla: 'Float sklo 6 mm',
			createdBy: 'test'
		});
		// zapíš NEPLATNÉ hodnoty priamo (obídeme validáciu nastavSpec) — mapSpec ich má normalizovať
		db.prepare(
			`UPDATE objednavka_skla SET spec_hole_size = 'garbage', spec_edge_finish = 'garbage' WHERE id = ?`
		).run(id);
		const p = getSkloPolozka(id);
		expect(p!.spec.holeSize).toBe('');
		expect(p!.spec.edgeFinish).toBe('none');
	});
});
