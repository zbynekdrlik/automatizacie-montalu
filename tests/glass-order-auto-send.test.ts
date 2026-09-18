// #540: glass_order sa pošle AUTOMATICKY pri uložení plánu rezov (nárezáku) so sklom + op override.
// Reálna DB (per-file izolátor) + reálne moduly; Odoo transport mocknutý (`setJson2Transport`) →
// žiadny PROD Odoo. Money-NEUTRÁLNE (objednávka u dodávateľa skla, žiadny writeOdpis/odpis_log zápis).
//
// Overuje: (a) uloženie plánu so sklom → po nárezák uploade sa pošle glass_order (kind='sklo') na
// TÚ ISTÚ OP, items[].glass_type = Odoo code na riadku; (b) plán BEZ skla → glass_order sa NEPOŠLE;
// (c) zlyhanie glass_order NIKDY nezhodí nárezák upload (best-effort); (d) explicitný op override
// na uploadGlassOrderToOdoo(zak, op) použije daný op (nie najnovší odpis).
import { describe, it, expect, afterEach } from 'vitest';
import { db } from '../src/lib/server/db';
import { setJson2Transport } from '../src/lib/server/odoo-json2';
import { pridajSklo, nastavTypSkla } from '../src/lib/server/objednavka-skla';
import { uploadGlassOrderToOdoo } from '../src/lib/server/odoo-glass-order-upload';
import { uploadPlanRezovToOdoo } from '../src/lib/server/odoo-plan-rezov-upload';

const CAD = 'STABILIZAČNÝ PROFIL 100X50\t3\t2000\nLAT 80x19\t4\t1865';

function seedOdpis(zak: string, op: string) {
	db.prepare(
		`INSERT INTO odpis_log (modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by, zak_norm, op_norm)
		 VALUES ('zasklenia', ?, ?, 'Test', 0, 1, 't', 'f', 'h', '{}', 'test', ?, ?)`
	).run(zak, op, zak.toUpperCase().replace(/\s/g, ''), op);
}

function seedGlass(zak: string, typSkla: string) {
	const id = pridajSklo({
		zak,
		modul: 'zasklenia',
		popis: 'Posuv 1',
		sirkaMm: 1200,
		vyskaMm: 800,
		pocet: 2,
		typSkla,
		createdBy: 'test'
	});
	return id;
}

function enableEnv() {
	process.env.ODOO_NAREZ_UPLOAD_ENABLED = '1';
	process.env.ODOO_JSON2_URL = 'https://erp.test';
	process.env.ODOO_JSON2_API_KEY = 'key';
}

/** Zachytí telá VŠETKÝCH montalu_narezak_upload volaní podľa `kind`. `skloStatus` = HTTP status
 *  pre kind='sklo' volanie (na test best-effort zlyhania). */
function captureTransport(bodies: Record<string, unknown>[], skloStatus = 200) {
	setJson2Transport(async (_url, init) => {
		const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
		bodies.push(body);
		const status = body.kind === 'sklo' ? skloStatus : 200;
		return new Response(JSON.stringify({}), { status });
	});
}

afterEach(() => {
	setJson2Transport(null);
	delete process.env.ODOO_NAREZ_UPLOAD_ENABLED;
	delete process.env.ODOO_JSON2_URL;
	delete process.env.ODOO_JSON2_API_KEY;
});

describe('glass_order auto-send pri uložení plánu rezov (#540)', () => {
	it('plán so sklom → glass_order (kind sklo) na tú istú OP, items[].glass_type = Odoo code', async () => {
		const zak = 'ZAK-540-A';
		seedOdpis(zak, 'OP540A');
		const id = seedGlass(zak, 'pôvodné');
		nastavTypSkla(id, '4/16/4'); // Odoo code zvolený v pickeri
		enableEnv();
		const bodies: Record<string, unknown>[] = [];
		captureTransport(bodies);

		const r = await uploadPlanRezovToOdoo({ zak, cadText: CAD, dlzkaTyce: 6000, reznaMedzera: 4 });
		expect(r.result).toBe('uploaded');

		const narezak = bodies.find((b) => b.kind === 'narezak');
		const sklo = bodies.find((b) => b.kind === 'sklo');
		expect(narezak).toBeTruthy();
		expect(sklo).toBeTruthy();
		expect(sklo!.order_number).toBe(narezak!.order_number);
		const glassOrder = sklo!.glass_order as { items: { glass_type: string }[] };
		expect(glassOrder.items[0]!.glass_type).toBe('4/16/4');
	});

	it('plán BEZ skla → glass_order sa NEPOŠLE (žiadne kind sklo volanie)', async () => {
		const zak = 'ZAK-540-B';
		seedOdpis(zak, 'OP540B');
		enableEnv();
		const bodies: Record<string, unknown>[] = [];
		captureTransport(bodies);

		const r = await uploadPlanRezovToOdoo({ zak, cadText: CAD, dlzkaTyce: 6000, reznaMedzera: 4 });
		expect(r.result).toBe('uploaded');
		expect(bodies.some((b) => b.kind === 'narezak')).toBe(true);
		expect(bodies.some((b) => b.kind === 'sklo')).toBe(false);
	});

	it('zlyhanie glass_order NIKDY nezhodí nárezák upload (best-effort)', async () => {
		const zak = 'ZAK-540-C';
		seedOdpis(zak, 'OP540C');
		seedGlass(zak, '6-6-4');
		enableEnv();
		const bodies: Record<string, unknown>[] = [];
		captureTransport(bodies, 500); // kind sklo → 500

		const r = await uploadPlanRezovToOdoo({ zak, cadText: CAD, dlzkaTyce: 6000, reznaMedzera: 4 });
		expect(r.result).toBe('uploaded'); // nárezák OK aj keď glass_order zlyhal
		expect(bodies.some((b) => b.kind === 'sklo')).toBe(true); // pokus prebehol
	});

	it('uploadGlassOrderToOdoo(zak, op) explicitný op override použije daný op', async () => {
		const zak = 'ZAK-540-D';
		seedOdpis(zak, 'OP540NAJNOVSI');
		seedGlass(zak, '3.3.1');
		enableEnv();
		const bodies: Record<string, unknown>[] = [];
		captureTransport(bodies);

		const out = await uploadGlassOrderToOdoo(zak, 'OP540EXPLICIT');
		expect(out.result).toBe('uploaded');
		const sklo = bodies.find((b) => b.kind === 'sklo')!;
		expect(String(sklo.order_number)).toContain('OP540EXPLICIT');
		expect(String(sklo.doc_id)).toContain('op540explicit'.slice(0, 12));
	});

	it('uploadGlassOrderToOdoo(zak) bez op stále funguje (najnovší odpis)', async () => {
		const zak = 'ZAK-540-E';
		seedOdpis(zak, 'OP540E');
		seedGlass(zak, '6mm');
		enableEnv();
		const bodies: Record<string, unknown>[] = [];
		captureTransport(bodies);

		const out = await uploadGlassOrderToOdoo(zak);
		expect(out.result).toBe('uploaded');
		expect(String(bodies.find((b) => b.kind === 'sklo')!.order_number)).toContain('OP540E');
	});
});
