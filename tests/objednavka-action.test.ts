// #319 — objednavkaAction: forged-POST test celej akcie. Honeypot → ticho úspech; chýbajúci
// súhlas / fakturačné meno → fail(400); úspech → objednávka uložená (je_objednavka=1) + PDF; Odoo
// dole → PDF sa aj tak vráti a objednávka sa nestratí. Money-neutrálne (žiadny odpis, žiadna platba).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { objednavkaAction } from '../src/lib/server/dopyt-action';
import { countDopyty, getDopytForLead } from '../src/lib/server/dopyt-store';
import { _resetDopytThrottle } from '../src/lib/server/dopyt-throttle';
import { _setLeadTransport, type LeadTransport } from '../src/lib/server/odoo-lead';

const ENV_KEYS = ['ODOO_LEAD_URL', 'ODOO_LEAD_DB', 'ODOO_LEAD_LOGIN', 'ODOO_LEAD_API_KEY'] as const;

function makeEvent(fields: Record<string, string>): RequestEvent {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.set(k, v);
	return {
		request: { formData: () => Promise.resolve(fd), headers: new Headers() },
		getClientAddress: () => '203.0.113.88'
	} as unknown as RequestEvent;
}

const OK_FIELDS = {
	konfiguracia: JSON.stringify({ model: 'LIGHT', sirka: 4000, hlbka: 3000 }),
	meno: 'Ján Objednávateľ',
	email: 'jan@objednavka.sk',
	telefon: '+421 900 111 222',
	miesto: '010 01 Žilina',
	poznamka: 'ozvite sa poobede',
	faktMeno: 'Firma ABC s.r.o.',
	faktAdresa: 'Priemyselná 5, 010 01 Žilina',
	faktIco: '12345678',
	faktDic: 'SK1234567890',
	suhlas: 'on'
};

const tick = (ms = 200) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
	_resetDopytThrottle();
	for (const k of ENV_KEYS) delete process.env[k]; // Odoo vypnutá (disabled) — žiadna sieť
	_setLeadTransport(null);
});
afterEach(() => {
	for (const k of ENV_KEYS) delete process.env[k];
	_setLeadTransport(null);
});

describe('objednavkaAction — validácia + uloženie (#319)', () => {
	it('úspech: objednávka uložená (je_objednavka=1) + PDF vrátený', async () => {
		const before = countDopyty();
		const res = (await objednavkaAction(makeEvent(OK_FIELDS))) as {
			success: boolean;
			pdfBase64: string;
			filename: string;
		};
		expect(res.success).toBe(true);
		expect(Buffer.from(res.pdfBase64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
		expect(res.filename).toMatch(/^Montalu-objednavka-\d{4}-\d{2}-\d{2}\.pdf$/);
		expect(countDopyty()).toBe(before + 1);
		const lead = getDopytForLead(countDopyty())!;
		expect(lead.je_objednavka).toBe(1);
		expect(lead.fakt_meno).toBe('Firma ABC s.r.o.');
	});

	it('chýbajúci súhlas → fail(400), objednávka sa NEuloží', async () => {
		const before = countDopyty();
		const res = (await objednavkaAction(makeEvent({ ...OK_FIELDS, suhlas: '' }))) as {
			status: number;
			data: { errors?: Record<string, string> };
		};
		expect(res.status).toBe(400);
		expect(res.data.errors?.suhlas).toBeTruthy();
		expect(countDopyty()).toBe(before); // nič sa neuložilo
	});

	it('chýbajúce fakturačné meno → fail(400)', async () => {
		const res = (await objednavkaAction(makeEvent({ ...OK_FIELDS, faktMeno: '' }))) as {
			status: number;
			data: { errors?: Record<string, string> };
		};
		expect(res.status).toBe(400);
		expect(res.data.errors?.faktMeno).toBeTruthy();
	});

	it('honeypot vyplnený → ticho úspech, objednávka sa NEuloží', async () => {
		const before = countDopyty();
		const res = (await objednavkaAction(makeEvent({ ...OK_FIELDS, firma_web: 'bot vyplnil' }))) as {
			success: boolean;
		};
		expect(res.success).toBe(true);
		expect(countDopyty()).toBe(before); // bot nič neuložil
	});
});

describe('objednavkaAction — odolnosť voči výpadku Odoo (#319/#278)', () => {
	it('Odoo dole: zákazník DOSTANE PDF a objednávka sa NESTRATÍ', async () => {
		process.env.ODOO_LEAD_URL = 'https://erp.example.test';
		process.env.ODOO_LEAD_DB = 'odoo';
		process.env.ODOO_LEAD_LOGIN = 'bot@montalu.test';
		process.env.ODOO_LEAD_API_KEY = 'secret-key-xyz';
		const down: LeadTransport = () => Promise.reject(new Error('ECONNREFUSED odoo-down'));
		_setLeadTransport(down);

		const before = countDopyty();
		const res = (await objednavkaAction(makeEvent(OK_FIELDS))) as { success: boolean };
		expect(res.success).toBe(true);
		expect(countDopyty()).toBe(before + 1);
		await tick();
		const lead = getDopytForLead(countDopyty())!;
		expect(lead.odoo_lead_id).toBeNull(); // lead sa (zatiaľ) nevytvoril — Odoo dole
		expect(lead.odoo_attempts).toBe(1); // jeden pokus, objednávka na retry (nestratená)
		expect(lead.je_objednavka).toBe(1);
	});
});
