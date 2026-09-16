// #521: odoslanie objednávky skla → Odoo `montalu_narezak_upload` (glass_order, kind='sklo').
// DB per-file izolátor; Odoo transport mocknutý (`setJson2Transport`) → žiadny PROD Odoo.
// Overuje: doc_id tvar, disabled path (vráti payload, nevolá Odoo), enabled path (payload so spec
// dorazí do montalu_narezak_upload). Money-NEUTRÁLNE.
import { describe, it, expect, afterEach } from 'vitest';
import { db } from '../src/lib/server/db';
import { setJson2Transport } from '../src/lib/server/odoo-json2';
import { pridajSklo, nastavSpec, GLASS_SPEC_OFF } from '../src/lib/server/objednavka-skla';
import {
	uploadGlassOrderToOdoo,
	buildGlassOrderDocId,
	buildGlassOrderForZak
} from '../src/lib/server/odoo-glass-order-upload';

function seedOdpis(zak: string, op: string) {
	db.prepare(
		`INSERT INTO odpis_log (modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by, zak_norm, op_norm)
		 VALUES ('zasklenia', ?, ?, 'Test', 0, 1, 't', 'f', 'h', '{}', 'test', ?, ?)`
	).run(zak, op, zak.toUpperCase().replace(/\s/g, ''), op);
}

function seedGlass(zak: string) {
	const id = pridajSklo({
		zak,
		modul: 'zasklenia',
		popis: 'Posuv 1',
		sirkaMm: 1200,
		vyskaMm: 800,
		pocet: 2,
		typSkla: 'Izolačné sklo 4/16/4 číre',
		createdBy: 'test'
	});
	nastavSpec(id, { ...GLASS_SPEC_OFF, warmEdge: true, holesQty: 2, holeSize: 'd50' });
}

afterEach(() => {
	setJson2Transport(null);
	delete process.env.ODOO_NAREZ_UPLOAD_ENABLED;
	delete process.env.ODOO_JSON2_URL;
	delete process.env.ODOO_JSON2_API_KEY;
});

describe('uploadGlassOrderToOdoo (#521)', () => {
	it('doc_id je stabilný glass-order-<zak>-<op> slug', () => {
		expect(buildGlassOrderDocId('ZAK 26/0501', 'OP260501')).toMatch(
			/^glass-order-[a-z0-9]+-[a-z0-9]+$/
		);
	});

	it('žiadne sklá → no-items, payload null', async () => {
		const out = await uploadGlassOrderToOdoo('ZAK-NEEXISTUJE-GLASS');
		expect(out.result).toBe('no-items');
		expect(out.payload).toBeNull();
	});

	it('disabled (bez ODOO env) → vráti payload, NEVOLÁ Odoo', async () => {
		const zak = 'ZAK-GU-DISABLED';
		seedGlass(zak);
		let called = false;
		setJson2Transport(async () => {
			called = true;
			return new Response('{}', { status: 200 });
		});
		const out = await uploadGlassOrderToOdoo(zak);
		expect(out.result).toBe('disabled');
		expect(called).toBe(false);
		expect(out.payload!.items[0]!.composition).toBe('4-16-4');
		expect(out.payload!.items[0]!.warm_edge).toBe(true);
	});

	it('enabled → payload so spec dorazí do montalu_narezak_upload (kind=sklo, glass_order)', async () => {
		const zak = 'ZAK-GU-ENABLED';
		const op = 'OP260888';
		seedOdpis(zak, op);
		seedGlass(zak);
		process.env.ODOO_NAREZ_UPLOAD_ENABLED = '1';
		process.env.ODOO_JSON2_URL = 'https://erp.example.test';
		process.env.ODOO_JSON2_API_KEY = 'k';

		let captured: Record<string, unknown> | null = null;
		let capturedUrl = '';
		setJson2Transport(async (input, init) => {
			capturedUrl = String(input);
			captured = init?.body ? JSON.parse(String(init.body)) : null;
			return new Response(JSON.stringify({ glass_order_id: 9, glass_version: 1 }), { status: 200 });
		});

		const out = await uploadGlassOrderToOdoo(zak);
		expect(out.result).toBe('uploaded');
		expect(capturedUrl).toContain('/sale.order/montalu_narezak_upload');
		expect(captured).not.toBeNull();
		const body = captured as unknown as {
			kind: string;
			doc_id: string;
			order_number: string;
			glass_order: { items: Record<string, unknown>[] };
		};
		expect(body.kind).toBe('sklo');
		expect(body.order_number).toBe(op);
		expect(body.doc_id).toContain('glass-order-');
		const item = body.glass_order.items[0]!;
		expect(item.composition).toBe('4-16-4');
		expect(item.spacer_mm).toBe(16);
		expect(item.warm_edge).toBe(true);
		expect(item.holes_qty).toBe(2);
		expect(item.hole_size).toBe('d50');
	});

	it('buildGlassOrderForZak → null keď niet položiek', () => {
		expect(buildGlassOrderForZak('ZAK-PRAZDNA-GLASS')).toBeNull();
	});

	it('prázdny zak → no-zak, payload null', async () => {
		const out = await uploadGlassOrderToOdoo('   ');
		expect(out.result).toBe('no-zak');
		expect(out.payload).toBeNull();
	});

	it('enabled flag ale bez config (URL/KEY) → disabled (payload postavený)', async () => {
		const zak = 'ZAK-GU-NOCFG';
		seedGlass(zak);
		process.env.ODOO_NAREZ_UPLOAD_ENABLED = '1';
		// ODOO_JSON2_URL/API_KEY zámerne NEnastavené
		const out = await uploadGlassOrderToOdoo(zak);
		expect(out.result).toBe('disabled');
		expect(out.payload!.items).toHaveLength(1);
	});

	it('enabled + config, ale zákazka bez odpisu/OP → missing (payload postavený)', async () => {
		const zak = 'ZAK-GU-NOODPIS';
		seedGlass(zak); // sklo áno, odpis NIE
		process.env.ODOO_NAREZ_UPLOAD_ENABLED = '1';
		process.env.ODOO_JSON2_URL = 'https://erp.example.test';
		process.env.ODOO_JSON2_API_KEY = 'k';
		let called = false;
		setJson2Transport(async () => {
			called = true;
			return new Response('{}', { status: 200 });
		});
		const out = await uploadGlassOrderToOdoo(zak);
		expect(out.result).toBe('missing');
		expect(called).toBe(false); // bez OP sa Odoo NEVOLÁ
		expect(out.payload!.items).toHaveLength(1);
	});

	it('enabled + config, Odoo hodí → failed (nikdy nehádže, payload postavený)', async () => {
		const zak = 'ZAK-GU-FAIL';
		const op = 'OP260999';
		seedOdpis(zak, op);
		seedGlass(zak);
		process.env.ODOO_NAREZ_UPLOAD_ENABLED = '1';
		process.env.ODOO_JSON2_URL = 'https://erp.example.test';
		process.env.ODOO_JSON2_API_KEY = 'k';
		setJson2Transport(async () => new Response('boom', { status: 500 }));
		const out = await uploadGlassOrderToOdoo(zak);
		expect(out.result).toBe('failed');
		expect(out.error).toBeTruthy();
		expect(out.payload!.items).toHaveLength(1);
	});

	it('doc_id fallback na "x" pri nealfanumerických vstupoch', () => {
		expect(buildGlassOrderDocId('///', '...')).toBe('glass-order-x-x');
	});
});
