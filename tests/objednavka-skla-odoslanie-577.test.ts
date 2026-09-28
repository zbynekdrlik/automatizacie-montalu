// #577 (Marek D., Odoo úloha 1181): po „Odoslať do Odoo" na podklade objednávky skla ukázať PRIAMY
// odkaz na vytvorenú objednávku skla v Odoo (`montalu.glass.order`, `/odoo/action-1008/<id>`), aby ju
// výroba nemusela hľadať — a TRVALO (aj po obnovení stránky). DB per-file izolátor; Odoo transport
// mocknutý (nikdy reálne Odoo). Money-NEUTRÁLNE (objednávka u dodávateľa skla).
import { describe, it, expect, afterEach } from 'vitest';
import { setJson2Transport } from '../src/lib/server/odoo-json2';
import { pridajSklo, nastavOpZakazky } from '../src/lib/server/objednavka-skla';
import {
	odooObjednavkaSklaUrl,
	ulozOdoslanieOdoo,
	posledneOdoslanieOdoo
} from '../src/lib/server/objednavka-skla-odoslanie';
import { actions, load } from '../src/routes/objednavka-skla/[zak]/+page.server';

afterEach(() => {
	setJson2Transport(null);
	delete process.env.ODOO_NAREZ_UPLOAD_ENABLED;
	delete process.env.ODOO_JSON2_URL;
	delete process.env.ODOO_JSON2_API_KEY;
});

function seedRiadok(zak: string) {
	pridajSklo({
		zak,
		modul: 'manual',
		popis: 'V.O.',
		sirkaMm: 1000,
		vyskaMm: 500,
		pocet: 1,
		typSkla: '4.4.2 číre',
		createdBy: 'test'
	});
	nastavOpZakazky(zak, 'OP-577');
}

function zapniUpload(odpoved: Record<string, unknown>) {
	process.env.ODOO_NAREZ_UPLOAD_ENABLED = '1';
	process.env.ODOO_JSON2_URL = 'https://erp.example.test/';
	process.env.ODOO_JSON2_API_KEY = 'k';
	setJson2Transport(async () => new Response(JSON.stringify(odpoved), { status: 200 }));
}

type Odoslane = {
	result: string;
	odkaz: string | null;
};

async function odoslat(zak: string): Promise<{ odoslane: Odoslane }> {
	const fn = actions.odoslatDoOdoo as unknown as (e: unknown) => Promise<{ odoslane: Odoslane }>;
	return fn({ params: { zak }, locals: { user: { id: 1, username: 'marek', role: 'internal' } } });
}

function callLoad(zak: string) {
	return load({
		params: { zak },
		url: new URL(`http://x/objednavka-skla/${encodeURIComponent(zak)}`),
		locals: { user: { id: 1, username: 'marek', role: 'internal' } }
	} as unknown as Parameters<typeof load>[0]) as Promise<Record<string, unknown>>;
}

describe('#577 odooObjednavkaSklaUrl — odkaz na montalu.glass.order', () => {
	it('bez Odoo konfigurácie → Montalu Odoo inštancia', () => {
		expect(odooObjednavkaSklaUrl(42)).toBe('https://erp.montalu.cloud/odoo/action-1008/42');
	});

	it('base URL z existujúcej Odoo konfigurácie appky (ODOO_JSON2_URL), bez dvojitej lomky', () => {
		process.env.ODOO_JSON2_URL = 'https://erp.example.test/';
		process.env.ODOO_JSON2_API_KEY = 'k';
		expect(odooObjednavkaSklaUrl(7)).toBe('https://erp.example.test/odoo/action-1008/7');
	});

	it('neplatné id → null (žiadny mŕtvy odkaz)', () => {
		expect(odooObjednavkaSklaUrl(0)).toBeNull();
		expect(odooObjednavkaSklaUrl(-3)).toBeNull();
		expect(odooObjednavkaSklaUrl(1.5)).toBeNull();
	});
});

describe('#577 trvalé uloženie posledného odoslania k podkladu', () => {
	it('uloží a prečíta (kľúč = normalizovaná zákazka), opakované odoslanie prepíše', () => {
		expect(posledneOdoslanieOdoo('zak-577-p1')).toBeNull();
		ulozOdoslanieOdoo('zak-577-p1', { glassOrderId: 5, name: 'OSK00005' }, 'marek');
		const a = posledneOdoslanieOdoo('ZAK-577-P1');
		expect(a).toMatchObject({ glassOrderId: 5, name: 'OSK00005', odoslal: 'marek' });
		expect(a?.url).toBe('https://erp.montalu.cloud/odoo/action-1008/5');
		expect(a?.odoslaneKedy).toMatch(/^\d{1,2}\.\d{1,2}\.\d{4} \d{1,2}:\d{2}$/);

		ulozOdoslanieOdoo('ZAK-577-P1', { glassOrderId: 9 }, 'patrik');
		expect(posledneOdoslanieOdoo('zak-577-p1')).toMatchObject({
			glassOrderId: 9,
			name: '',
			odoslal: 'patrik'
		});
	});
});

describe('#577 ulozOdoslanieOdoo — neplatné id', () => {
	it('id <= 0 / necelé → throw, nič sa neuloží', () => {
		expect(() => ulozOdoslanieOdoo('ZAK-577-BAD', { glassOrderId: 0 }, 'x')).toThrow(/Neplatné id/);
		expect(() => ulozOdoslanieOdoo('ZAK-577-BAD', { glassOrderId: 2.5 }, 'x')).toThrow();
		expect(posledneOdoslanieOdoo('ZAK-577-BAD')).toBeNull();
	});
});

describe('#577 akcia odoslatDoOdoo → odkaz + trvalosť po obnovení (load)', () => {
	it('úspešný upload s glass_order_id → akcia vráti odkaz, load ho vráti aj po obnovení', async () => {
		const zak = 'ZAK-577-A1';
		seedRiadok(zak);
		zapniUpload({ glass_order_id: 11, name: 'OSK00011' });
		const r = await odoslat(zak);
		expect(r.odoslane.result).toBe('uploaded');
		expect(r.odoslane.odkaz).toBe('https://erp.example.test/odoo/action-1008/11');

		// „obnovenie stránky": nový load (Odoo transport vypnutý — typy skla idú z lokálneho zoznamu)
		setJson2Transport(null);
		delete process.env.ODOO_NAREZ_UPLOAD_ENABLED;
		delete process.env.ODOO_JSON2_URL;
		delete process.env.ODOO_JSON2_API_KEY;
		const d = await callLoad(zak);
		expect(d.odoslanieOdoo).toMatchObject({
			glassOrderId: 11,
			name: 'OSK00011',
			url: 'https://erp.montalu.cloud/odoo/action-1008/11'
		});
	});

	it('upload vypnutý (náhľad) → žiadny odkaz, nič sa neuloží', async () => {
		const zak = 'ZAK-577-A2';
		seedRiadok(zak);
		const r = await odoslat(zak);
		expect(r.odoslane.result).toBe('disabled');
		expect(r.odoslane.odkaz).toBeNull();
		expect(posledneOdoslanieOdoo(zak)).toBeNull();
		const d = await callLoad(zak);
		expect(d.odoslanieOdoo).toBeNull();
	});

	it('v1 intake bez glass_order_id → žiadny odkaz (nevymýšľa id)', async () => {
		const zak = 'ZAK-577-A3';
		seedRiadok(zak);
		zapniUpload({ ok: true });
		const r = await odoslat(zak);
		expect(r.odoslane.result).toBe('uploaded');
		expect(r.odoslane.odkaz).toBeNull();
		expect(posledneOdoslanieOdoo(zak)).toBeNull();
	});
});
