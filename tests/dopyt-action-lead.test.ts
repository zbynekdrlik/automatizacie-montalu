// #278 — wiring: `dopyt-action` volá tvorbu Odoo leadu FIRE-AND-FORGET. Dôkaz kľúčového
// kontraktu: aj keď je Odoo DOLE (transport hodí), zákazník DOSTANE PDF a dopyt sa NESTRATÍ
// (lead sa len zaznamená ako neúspešný pokus na retry). XML-RPC transport je mockovaný.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { dopytAction } from '../src/lib/server/dopyt-action';
import { countDopyty, getDopytForLead } from '../src/lib/server/dopyt-store';
import { _resetDopytThrottle } from '../src/lib/server/dopyt-throttle';
import { _setLeadTransport, type LeadTransport } from '../src/lib/server/odoo-lead';

const ENV_KEYS = ['ODOO_LEAD_URL', 'ODOO_LEAD_DB', 'ODOO_LEAD_LOGIN', 'ODOO_LEAD_API_KEY'] as const;

function makeEvent(fields: Record<string, string>): RequestEvent {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.set(k, v);
	return {
		request: { formData: () => Promise.resolve(fd), headers: new Headers() },
		getClientAddress: () => '203.0.113.77'
	} as unknown as RequestEvent;
}

const OK_FIELDS = {
	konfiguracia: JSON.stringify({ system: 'Robust', sirka: 3000, hlbka: 4000 }),
	meno: 'Ján Novák',
	email: 'jan@example.com',
	telefon: '+421 900 111 222',
	miesto: 'Bratislava',
	poznamka: 'ozvite sa'
};

// Odoo je "dole" — každé XML-RPC volanie hodí. Zákazníkovo PDF to nesmie ovplyvniť.
const downTransport: LeadTransport = () => Promise.reject(new Error('ECONNREFUSED odoo-down'));

const tick = (ms = 200) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
	_resetDopytThrottle();
	process.env.ODOO_LEAD_URL = 'https://erp.example.test';
	process.env.ODOO_LEAD_DB = 'odoo';
	process.env.ODOO_LEAD_LOGIN = 'bot@montalu.test';
	process.env.ODOO_LEAD_API_KEY = 'secret-key-xyz';
	_setLeadTransport(downTransport);
});
afterEach(() => {
	for (const k of ENV_KEYS) delete process.env[k];
	_setLeadTransport(null);
});

describe('dopyt-action → Odoo lead wiring (#278)', () => {
	it('Odoo dole: zákazník DOSTANE PDF a dopyt sa NESTRATÍ', async () => {
		const before = countDopyty();
		const res = (await dopytAction(makeEvent(OK_FIELDS))) as {
			success: boolean;
			pdfBase64: string;
			filename: string;
		};
		// zákazníkove PDF sa vrátilo NEZÁVISLE od Odoo výpadku (fire-and-forget)
		expect(res.success).toBe(true);
		expect(Buffer.from(res.pdfBase64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
		expect(countDopyty()).toBe(before + 1); // dopyt uložený, nestratený

		// nechaj fire-and-forget lead pokus dobehnúť → dopyt je zaznamenaný na retry, nie stratený
		await tick();
		const id = countDopyty(); // čerstvá izolovaná DB, sekvenčné PK → posledný = počet
		const row = getDopytForLead(id)!;
		expect(row.odoo_lead_id).toBeNull(); // lead sa (zatiaľ) nevytvoril — Odoo dole
		// PRÁVE JEDEN pokus: pri neúspechu sa už NEspustí sweep (#278 review #2) — inak by
		// jeden príchod dopytu zožral 2 pokusy a poison-pill riadok by rýchlo dosiahol MAX.
		expect(row.odoo_attempts).toBe(1);
	});
});
