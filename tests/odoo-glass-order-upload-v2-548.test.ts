// #548: glass_order v2 upload — prílohy per riadok (BLOB → base64), require_order:false, outcome
// parsing (glass_order_id/name/lines/dq). DB per-file izolátor; Odoo transport mocknutý. Money-NEUTRÁLNE.
import { describe, it, expect, afterEach } from 'vitest';
import { db } from '../src/lib/server/db';
import { setJson2Transport } from '../src/lib/server/odoo-json2';
import { pridajSklo, pridajSubor, nastavOpZakazky } from '../src/lib/server/objednavka-skla';
import {
	uploadGlassOrderToOdoo,
	buildGlassOrderForZak,
	parseOdooOutcome
} from '../src/lib/server/odoo-glass-order-upload';

function seedOdpis(zak: string, op: string) {
	db.prepare(
		`INSERT INTO odpis_log (modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by, zak_norm, op_norm)
		 VALUES ('zasklenia', ?, ?, 'Test', 0, 1, 't', 'f', 'h', '{}', 'test', ?, ?)`
	).run(zak, op, zak.toUpperCase().replace(/\s/g, ''), op);
}

afterEach(() => {
	setJson2Transport(null);
	delete process.env.ODOO_NAREZ_UPLOAD_ENABLED;
	delete process.env.ODOO_JSON2_URL;
	delete process.env.ODOO_JSON2_API_KEY;
});

describe('#548 parseOdooOutcome', () => {
	it('rozparsuje plnú v2 odpoveď', () => {
		expect(
			parseOdooOutcome({ glass_order_id: 7, name: 'OSK00042', lines: [{ index: 0 }], dq: ['x'] })
		).toEqual({ glassOrderId: 7, name: 'OSK00042', lines: [{ index: 0 }], dq: ['x'] });
	});
	it('tolerantná — chýbajúce polia sa vynechajú', () => {
		expect(parseOdooOutcome({ glass_order_id: 3 })).toEqual({ glassOrderId: 3 });
	});
	it('v1 odpoveď (žiadne v2 polia) → undefined', () => {
		expect(parseOdooOutcome({ some_other: 1 })).toBeUndefined();
		expect(parseOdooOutcome(null)).toBeUndefined();
		expect(parseOdooOutcome([1, 2])).toBeUndefined();
		expect(parseOdooOutcome('OK')).toBeUndefined();
	});
});

describe('#548 buildGlassOrderForZak — prílohy per riadok', () => {
	it('načíta prílohu riadka do items[].attachments (base64 + mimetype)', () => {
		const zak = 'ZAK-548-UP-ATT';
		const id = pridajSklo({
			zak,
			modul: 'manual',
			popis: 'ATYP',
			sirkaMm: 1000,
			vyskaMm: 500,
			pocet: 1,
			typSkla: '4.4.2 číre',
			createdBy: 'test'
		});
		pridajSubor(id, 'vykres.pdf', 'application/octet-stream', Buffer.from('PDFDATA'));
		const built = buildGlassOrderForZak(zak)!;
		expect(built.order.version).toBe(2);
		const item = built.order.items[0]!;
		expect(item.attachments).toHaveLength(1);
		expect(item.attachments![0]!.name).toBe('vykres.pdf');
		expect(item.attachments![0]!.mimetype).toBe('application/pdf');
		expect(item.attachments![0]!.data_base64).toBe(Buffer.from('PDFDATA').toString('base64'));
	});

	it('riadok bez prílohy → žiadny attachments kľúč', () => {
		const zak = 'ZAK-548-UP-NOATT';
		pridajSklo({
			zak,
			modul: 'manual',
			popis: 'x',
			sirkaMm: 1000,
			vyskaMm: 500,
			pocet: 1,
			typSkla: '4.4.2 číre',
			createdBy: 'test'
		});
		const item = buildGlassOrderForZak(zak)!.order.items[0]!;
		expect(item).not.toHaveProperty('attachments');
	});

	it('prázdna zákazka → null', () => {
		expect(buildGlassOrderForZak('ZAK-548-UP-PRAZDNA')).toBeNull();
	});
});

describe('#548 uploadGlassOrderToOdoo — require_order + outcome', () => {
	it('posiela require_order:false a rozparsuje OSK odpoveď do outcome.odoo', async () => {
		const zak = 'ZAK-548-UP-SEND';
		const op = 'OP260548';
		seedOdpis(zak, op);
		pridajSklo({
			zak,
			modul: 'manual',
			popis: 'x',
			sirkaMm: 1000,
			vyskaMm: 500,
			pocet: 1,
			typSkla: '4.4.2 číre',
			createdBy: 'test'
		});
		process.env.ODOO_NAREZ_UPLOAD_ENABLED = '1';
		process.env.ODOO_JSON2_URL = 'https://erp.example.test';
		process.env.ODOO_JSON2_API_KEY = 'k';
		let captured: Record<string, unknown> | null = null;
		setJson2Transport(async (_input, init) => {
			captured = init?.body ? JSON.parse(String(init.body)) : null;
			return new Response(
				JSON.stringify({ glass_order_id: 11, name: 'OSK00011', dq: ['upozornenie'] }),
				{
					status: 200
				}
			);
		});
		const out = await uploadGlassOrderToOdoo(zak);
		expect(out.result).toBe('uploaded');
		const body = captured as unknown as {
			require_order: boolean;
			glass_order: { version: number };
		};
		expect(body.require_order).toBe(false);
		expect(body.glass_order.version).toBe(2);
		expect(out.odoo).toEqual({ glassOrderId: 11, name: 'OSK00011', dq: ['upozornenie'] });
	});

	it('servisná objednávka bez odpisu (OP z podkladu) → odošle s require_order:false', async () => {
		const zak = 'ZAK-548-UP-SERVIS';
		pridajSklo({
			zak,
			modul: 'manual',
			popis: 'rozbité sklo',
			sirkaMm: 800,
			vyskaMm: 600,
			pocet: 1,
			typSkla: '4.4.2 číre',
			createdBy: 'test'
		});
		nastavOpZakazky(zak, 'OP260777');
		process.env.ODOO_NAREZ_UPLOAD_ENABLED = '1';
		process.env.ODOO_JSON2_URL = 'https://erp.example.test';
		process.env.ODOO_JSON2_API_KEY = 'k';
		let called = false;
		setJson2Transport(async (_input, init) => {
			called = true;
			const b = init?.body ? JSON.parse(String(init.body)) : {};
			expect(b.require_order).toBe(false);
			return new Response('{}', { status: 200 });
		});
		const out = await uploadGlassOrderToOdoo(zak);
		expect(called).toBe(true);
		expect(out.result).toBe('uploaded');
		// v1-štýl prázdna odpoveď → žiadne odoo pole
		expect(out.odoo).toBeUndefined();
	});
});
