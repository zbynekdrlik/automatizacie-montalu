// #319 — objednávka: store (insertObjednavka + zapečatená cena/hladina) + Odoo lead vetva
// (opportunity + „OBJEDNÁVKA" názov + fakturačný blok, BEZ ceny). Izolovaná per-file DB (setup),
// migrácia v33 pridá objednávkové stĺpce. Money-neutralita payloadu = objednaná cena je zapečatená
// v DB, do leadu NEJDE.
import { describe, it, expect } from 'vitest';
import {
	insertDopyt,
	insertObjednavka,
	getDopyt,
	getDopytForLead
} from '../src/lib/server/dopyt-store';
import { opeciatkujCenu } from '../src/lib/server/dopyt-cena-stamp';
import { buildLeadPayload } from '../src/lib/server/odoo-lead';
import type { PonukaConfig } from '../src/lib/ponuka';

// cfg s rozmermi v katalógu (LIGHT, 4×3 m) → cena sa opečiatkuje (obe hladiny sú číslo)
const CFG: PonukaConfig = {
	model: 'LIGHT',
	sirka: 4000,
	hlbka: 3000,
	farba: 'RAL 7016',
	sklo: 'Číre'
};

const zaznam = () => ({
	konfiguracia: JSON.stringify(CFG),
	meno: 'Ján Objednávateľ',
	email: 'jan@objednavka.sk',
	telefon: '+421 900 111 222',
	miesto: '010 01 Žilina',
	poznamka: 'ozvite sa poobede'
});

const faktUdaje = {
	faktMeno: 'Firma ABC s.r.o.',
	faktAdresa: 'Priemyselná 5, 010 01 Žilina',
	faktIco: '12345678',
	faktDic: 'SK1234567890'
};

describe('insertObjednavka — uloženie + zapečatená cena/hladina (#319 bod 5)', () => {
	it('uloží objednávku s je_objednavka=1 a fakturačnými údajmi', () => {
		// je_objednavka + fakturačné údaje sú súčasťou lead-select (getDopytForLead)
		const id = insertObjednavka({ ...zaznam(), ...faktUdaje }, opeciatkujCenu(CFG, 'MO'));
		const lead = getDopytForLead(id)!;
		expect(lead.meno).toBe('Ján Objednávateľ');
		expect(lead.je_objednavka).toBe(1);
		expect(lead.fakt_meno).toBe('Firma ABC s.r.o.');
		expect(lead.fakt_adresa).toBe('Priemyselná 5, 010 01 Žilina');
		expect(lead.fakt_ico).toBe('12345678');
		expect(lead.fakt_dic).toBe('SK1234567890');
	});

	it('MO objednávka: zapečatená cena je MO (cena_hladina NULL), sumy uložené', () => {
		const id = insertObjednavka({ ...zaznam(), ...faktUdaje }, opeciatkujCenu(CFG, 'MO'));
		const row = getDopyt(id)!;
		expect(row.cena_druh).toBe('cena');
		expect(row.cena_s_dph).toBeGreaterThan(0);
		expect(row.cena_hladina).toBeNull(); // MO nemá hladina marker
	});

	it('VO objednávka: zapečatená hladina je VO (cena_hladina=VO), sumy uložené', () => {
		const id = insertObjednavka({ ...zaznam(), ...faktUdaje }, opeciatkujCenu(CFG, 'VO'));
		const row = getDopyt(id)!;
		expect(row.cena_druh).toBe('cena');
		expect(row.cena_hladina).toBe('VO'); // veľkoobchodná objednávka — hladina zapečatená
	});
});

describe('buildLeadPayload — objednávka sa vetví na opportunity (#319 bod 2)', () => {
	it('objednávka → type=opportunity, názov „OBJEDNÁVKA", fakturačný blok v popise', () => {
		const id = insertObjednavka({ ...zaznam(), ...faktUdaje }, opeciatkujCenu(CFG, 'MO'));
		const p = buildLeadPayload(getDopytForLead(id)!);
		expect(p.type).toBe('opportunity'); // vyšší stupeň než lead
		expect(p.name).toContain('OBJEDNÁVKA');
		expect(p.name).toContain('Ján Objednávateľ');
		expect(p.contact_name).toBe('Ján Objednávateľ');
		// fakturačný blok v popise
		expect(p.description).toMatch(/ZÁVÄZNÁ OBJEDNÁVKA/);
		expect(p.description).toContain('Firma ABC s.r.o.');
		expect(p.description).toContain('Priemyselná 5');
		expect(p.description).toContain('12345678'); // IČO
		expect(p.description).toContain('SK1234567890'); // DIČ
		// konfigurácia stále v popise
		expect(p.description).toContain('4000');
	});

	it('objednávkový lead je BEZ CIEN (Money-neutralita — cena zapečatená v DB, nie v leade)', () => {
		const id = insertObjednavka({ ...zaznam(), ...faktUdaje }, opeciatkujCenu(CFG, 'VO'));
		const p = buildLeadPayload(getDopytForLead(id)!);
		const cely = JSON.stringify(p);
		expect(cely).not.toMatch(/€|\bEUR\b|\bcena\b|\bprice\b/i);
	});

	it('obyčajný dopyt (insertDopyt) ostáva type=lead, názov „dopyt" (nezmenené správanie)', () => {
		const id = insertDopyt(zaznam(), opeciatkujCenu(CFG, 'MO'));
		const p = buildLeadPayload(getDopytForLead(id)!);
		expect(p.type).toBe('lead');
		expect(p.name).toContain('dopyt');
		expect(p.name).not.toContain('OBJEDNÁVKA');
		expect(p.description).not.toMatch(/ZÁVÄZNÁ OBJEDNÁVKA/);
	});
});
