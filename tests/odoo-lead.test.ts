// #278 — zrkadlenie dopytu do Odoo CRM leadu. XML-RPC transport je MOCKOVANÝ (externá služba,
// mock povolený); žiadna reálna sieť. Izolovaná per-file DB (setup) — migrácia v26 pridá Odoo
// stĺpce. Overuje: payload correctness (reálne config hodnoty), Money-neutralitu (payload aj
// zdroj), missing-env disable path, Odoo pád ⇒ dopyt uložený + attempts++, retry sweep (vrátane
// regenerácie PDF), attachment best-effort, XML-RPC tvar požiadaviek.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { insertDopyt, getDopytForLead, countDopyty } from '../src/lib/server/dopyt-store';
import {
	buildLeadPayload,
	submitDopytLead,
	retryPendingLeads,
	leadConfig,
	MAX_ATTEMPTS,
	_setLeadTransport,
	type LeadTransport
} from '../src/lib/server/odoo-lead';

const ENV_KEYS = ['ODOO_LEAD_URL', 'ODOO_LEAD_DB', 'ODOO_LEAD_LOGIN', 'ODOO_LEAD_API_KEY'] as const;

function setEnv() {
	process.env.ODOO_LEAD_URL = 'https://erp.example.test';
	process.env.ODOO_LEAD_DB = 'odoo';
	process.env.ODOO_LEAD_LOGIN = 'bot@montalu.test';
	process.env.ODOO_LEAD_API_KEY = 'secret-key-xyz';
}
function clearEnv() {
	for (const k of ENV_KEYS) delete process.env[k];
}

function xmlResp(valueXml: string): string {
	return `<?xml version="1.0"?><methodResponse><params><param>${valueXml}</param></params></methodResponse>`;
}

interface MockOpts {
	failAll?: boolean; // celý transport hodí (Odoo dole)
	authUid?: number | false; // výsledok authenticate
	leadId?: number; // výsledok crm.lead create
	attachThrows?: boolean; // ir.attachment create hodí
}

function makeMock(opts: MockOpts = {}) {
	const calls: { url: string; body: string }[] = [];
	const uid = opts.authUid ?? 7;
	const leadId = opts.leadId ?? 42;
	const transport: LeadTransport = (url, body) => {
		calls.push({ url, body });
		if (opts.failAll) return Promise.reject(new Error('ECONNREFUSED erp.example.test'));
		if (body.includes('<methodName>authenticate</methodName>')) {
			return Promise.resolve(
				uid === false
					? xmlResp('<value><boolean>0</boolean></value>')
					: xmlResp(`<value><int>${uid}</int></value>`)
			);
		}
		if (body.includes('ir.attachment')) {
			if (opts.attachThrows) return Promise.reject(new Error('attachment blocked'));
			return Promise.resolve(xmlResp('<value><int>999</int></value>'));
		}
		return Promise.resolve(xmlResp(`<value><int>${leadId}</int></value>`)); // crm.lead create
	};
	return { transport, calls };
}

// malé, ale reálne 1×1 PDF base64 nie je potrebné — pre attachment stačí ľubovoľný base64 string
const FAKE_PDF_B64 = Buffer.from('%PDF-1.4 fake').toString('base64');

const CFG = {
	system: 'Robust',
	typStrechy: 'Bioclimatická',
	sirka: 4000,
	hlbka: 3000,
	pocetPoli: 3,
	farba: 'antracit',
	sklo: 'Číre kalené'
};

function vlozDopyt(over: Partial<Record<string, string>> = {}): number {
	return insertDopyt({
		konfiguracia: JSON.stringify(CFG),
		meno: over.meno ?? 'Ján Novák',
		email: over.email ?? 'jan@example.com',
		telefon: over.telefon ?? '+421 900 111 222',
		miesto: over.miesto ?? 'Bratislava',
		poznamka: over.poznamka ?? 'ozvite sa poobede'
	});
}

beforeEach(() => setEnv());
afterEach(() => {
	clearEnv();
	_setLeadTransport(null);
});

describe('buildLeadPayload — payload correctness + Money-neutralita', () => {
	it('mapuje kontakt + konfiguráciu do crm.lead payloadu (reálne hodnoty)', () => {
		const id = vlozDopyt();
		const row = getDopytForLead(id)!;
		const p = buildLeadPayload(row);
		expect(p.contact_name).toBe('Ján Novák');
		expect(p.email_from).toBe('jan@example.com');
		expect(p.phone).toBe('+421 900 111 222');
		expect(p.type).toBe('lead');
		expect(p.name).toContain('Ján Novák');
		expect(p.name).toContain('Bratislava');
		// popis nesie miesto stavby, poznámku aj súhrn konfigurácie
		expect(p.description).toContain('Bratislava');
		expect(p.description).toContain('ozvite sa poobede');
		expect(p.description).toContain('Robust');
		expect(p.description).toContain('4000');
		expect(p.description).toContain('3000');
		expect(p.description).toContain('antracit');
	});

	it('payload je BEZ CIEN (Money-neutrálny)', () => {
		const id = vlozDopyt({ poznamka: 'chcem to lacno ale bez slova c-e-n-a' });
		const p = buildLeadPayload(getDopytForLead(id)!);
		const cely = JSON.stringify(p);
		expect(cely).not.toMatch(/€|\bEUR\b|\bcena\b|\bprice\b/i);
	});
});

describe('odoo-lead.ts zdroj — Money-safety (nekrytý auto-guardom dopyt|ponuka)', () => {
	it('neimportuje money/pergola a nezapisuje do /data', () => {
		const src = fs.readFileSync(new URL('../src/lib/server/odoo-lead.ts', import.meta.url), 'utf8');
		expect(/from ['"].*server\/money['"]/.test(src)).toBe(false);
		expect(/from ['"].*server\/pergola['"]/.test(src)).toBe(false);
		expect(/writeOdpis|MONEY_LIVE|dlv-import|odpis_log/.test(src)).toBe(false);
		expect(/['"`]\/data\//.test(src)).toBe(false);
	});
});

describe('submitDopytLead — disable / success / failure', () => {
	it('chýba env → disabled, žiadny transport, dopyt ostáva pending', async () => {
		clearEnv();
		expect(leadConfig()).toBeNull();
		const id = vlozDopyt();
		const mock = makeMock();
		_setLeadTransport(mock.transport);
		const r = await submitDopytLead(id, FAKE_PDF_B64);
		expect(r).toBe('disabled');
		expect(mock.calls.length).toBe(0); // žiadne XML-RPC volanie
		const row = getDopytForLead(id)!;
		expect(row.odoo_lead_id).toBeNull();
		expect(row.odoo_attempts).toBe(0); // pokus sa neminul
	});

	it('úspech → lead vytvorený, lead_id uložený, attempts nezmenené', async () => {
		const id = vlozDopyt();
		const mock = makeMock({ authUid: 7, leadId: 42 });
		_setLeadTransport(mock.transport);
		const r = await submitDopytLead(id, FAKE_PDF_B64);
		expect(r).toBe('created');
		const row = getDopytForLead(id)!;
		expect(row.odoo_lead_id).toBe(42);
		expect(row.odoo_attempts).toBe(0);
		expect(row.odoo_last_error).toBe('');
	});

	it('XML-RPC tvar: authenticate na /common, execute_kw create crm.lead na /object, príloha na crm.lead', async () => {
		const id = vlozDopyt();
		const mock = makeMock({ authUid: 7, leadId: 42 });
		_setLeadTransport(mock.transport);
		await submitDopytLead(id, FAKE_PDF_B64);
		// authenticate
		const auth = mock.calls.find((c) => c.body.includes('<methodName>authenticate</methodName>'))!;
		expect(auth.url).toBe('https://erp.example.test/xmlrpc/2/common');
		expect(auth.body).toContain('<string>odoo</string>'); // db
		// crm.lead create
		const lead = mock.calls.find(
			(c) =>
				c.body.includes('execute_kw') &&
				c.body.includes('crm.lead') &&
				c.body.includes('<string>create</string>')
		)!;
		expect(lead.url).toBe('https://erp.example.test/xmlrpc/2/object');
		expect(lead.body).toContain('<name>contact_name</name>');
		expect(lead.body).toContain('Ján Novák');
		expect(lead.body).toContain('<name>email_from</name>');
		expect(lead.body).toContain('jan@example.com');
		// ir.attachment linknutý na lead (res_id 42, binary PDF)
		const att = mock.calls.find((c) => c.body.includes('ir.attachment'))!;
		expect(att.body).toContain('<name>res_id</name>');
		expect(att.body).toContain('<int>42</int>');
		expect(att.body).toContain('<name>res_model</name>');
		expect(att.body).toContain('crm.lead');
	});

	it('Odoo dole → failed, dopyt NIE JE stratený, attempts++ a last_error uložený', async () => {
		const before = countDopyty();
		const id = vlozDopyt();
		const mock = makeMock({ failAll: true });
		_setLeadTransport(mock.transport);
		const r = await submitDopytLead(id, FAKE_PDF_B64);
		expect(r).toBe('failed');
		expect(countDopyty()).toBe(before + 1); // dopyt sa nestratil
		const row = getDopytForLead(id)!;
		expect(row.odoo_lead_id).toBeNull();
		expect(row.odoo_attempts).toBe(1);
		expect(row.odoo_last_error).toContain('ECONNREFUSED');
	});

	it('zlá autentifikácia (uid=false) → failed, attempts++', async () => {
		const id = vlozDopyt();
		_setLeadTransport(makeMock({ authUid: false }).transport);
		const r = await submitDopytLead(id, FAKE_PDF_B64);
		expect(r).toBe('failed');
		const row = getDopytForLead(id)!;
		expect(row.odoo_attempts).toBe(1);
		expect(row.odoo_last_error).toMatch(/authentik/i);
	});

	it('príloha zlyhá (best-effort) → lead PREDSA vytvorený', async () => {
		const id = vlozDopyt();
		_setLeadTransport(makeMock({ leadId: 55, attachThrows: true }).transport);
		const r = await submitDopytLead(id, FAKE_PDF_B64);
		expect(r).toBe('created'); // pád prílohy NEZHODÍ lead
		const row = getDopytForLead(id)!;
		expect(row.odoo_lead_id).toBe(55);
	});

	it('už zrkadlený dopyt sa preskočí (skipped)', async () => {
		const id = vlozDopyt();
		_setLeadTransport(makeMock({ leadId: 42 }).transport);
		await submitDopytLead(id, FAKE_PDF_B64); // created
		const r2 = await submitDopytLead(id, FAKE_PDF_B64); // druhýkrát
		expect(r2).toBe('skipped');
	});

	it('po MAX pokusoch sa dopyt už neskúša (skipped)', async () => {
		const id = vlozDopyt();
		_setLeadTransport(makeMock({ failAll: true }).transport);
		for (let i = 0; i < MAX_ATTEMPTS; i++) await submitDopytLead(id);
		expect(getDopytForLead(id)!.odoo_attempts).toBe(MAX_ATTEMPTS);
		const r = await submitDopytLead(id); // vyčerpané
		expect(r).toBe('skipped');
	});
});

function xmlFault(code: number, msg: string): string {
	return `<?xml version="1.0"?><methodResponse><fault><value><struct><member><name>faultCode</name><value><int>${code}</int></value></member><member><name>faultString</name><value><string>${msg}</string></value></member></struct></value></fault></methodResponse>`;
}

describe('XML-RPC fault + hraničné vetvy', () => {
	it('Odoo vráti FAULT na create → failed, fault kód aj text v last_error', async () => {
		const id = vlozDopyt();
		const transport: LeadTransport = (_url, body) => {
			if (body.includes('<methodName>authenticate</methodName>'))
				return Promise.resolve(xmlResp('<value><int>7</int></value>'));
			return Promise.resolve(xmlFault(2, 'AccessError: pole X neexistuje'));
		};
		_setLeadTransport(transport);
		const r = await submitDopytLead(id, FAKE_PDF_B64);
		expect(r).toBe('failed');
		const row = getDopytForLead(id)!;
		expect(row.odoo_lead_id).toBeNull();
		expect(row.odoo_last_error).toContain('fault 2');
		expect(row.odoo_last_error).toContain('AccessError');
	});

	it('create vráti NE-int (nil) → failed (nevrátil id)', async () => {
		const id = vlozDopyt();
		const transport: LeadTransport = (_url, body) => {
			if (body.includes('<methodName>authenticate</methodName>'))
				return Promise.resolve(xmlResp('<value><int>7</int></value>'));
			return Promise.resolve(xmlResp('<value><nil/></value>'));
		};
		_setLeadTransport(transport);
		expect(await submitDopytLead(id, FAKE_PDF_B64)).toBe('failed');
		expect(getDopytForLead(id)!.odoo_last_error).toMatch(/nevrátil id/i);
	});

	it('neexistujúci dopyt → missing', async () => {
		_setLeadTransport(makeMock().transport);
		expect(await submitDopytLead(999999, FAKE_PDF_B64)).toBe('missing');
	});

	it('prázdna konfigurácia + bez miesta → fallback meno-titulok a "bez detailov"', () => {
		const id = insertDopyt({
			konfiguracia: '{}',
			meno: '',
			email: 'x@y.sk',
			telefon: '',
			miesto: '',
			poznamka: ''
		});
		const p = buildLeadPayload(getDopytForLead(id)!);
		expect(p.name).toContain('neznámy záujemca');
		expect(p.name).not.toContain('(');
		expect(p.description).toContain('bez detailov konfigurácie');
	});
});

describe('retryPendingLeads — sweep zotaví dopyt po výpadku (vrátane regenerácie PDF)', () => {
	it('failnutý dopyt sa v ďalšom sweepe vytvorí (retry regeneruje PDF)', async () => {
		const id = vlozDopyt();
		// 1. kolo: Odoo dole → failed
		_setLeadTransport(makeMock({ failAll: true }).transport);
		expect(await submitDopytLead(id, FAKE_PDF_B64)).toBe('failed');
		expect(getDopytForLead(id)!.odoo_lead_id).toBeNull();
		// 2. kolo: Odoo hore → sweep ho spracuje (bez pdfBase64 → regeneruje z uloženej konfigurácie)
		const mock2 = makeMock({ authUid: 7, leadId: 77 });
		_setLeadTransport(mock2.transport);
		await retryPendingLeads();
		const row = getDopytForLead(id)!;
		expect(row.odoo_lead_id).toBe(77);
		expect(row.odoo_last_error).toBe('');
		// sweep vytvoril aj prílohu (regenerované PDF) → ir.attachment volanie existuje
		expect(mock2.calls.some((c) => c.body.includes('ir.attachment'))).toBe(true);
	});

	it('vypnuté (chýba env) → sweep je no-op (žiadny DB dotaz ani transport)', async () => {
		clearEnv();
		const mock = makeMock();
		_setLeadTransport(mock.transport);
		await retryPendingLeads();
		expect(mock.calls.length).toBe(0);
	});
});
