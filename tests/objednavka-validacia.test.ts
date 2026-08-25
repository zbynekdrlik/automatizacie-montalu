// #319 — pure validácia záväznej objednávky (kontakt + fakturačné údaje + súhlas). Bez servera,
// bez DB — čistá funkcia. Objednávka je escalácia dopytu: povinný kontakt (ako dopyt) + fakturačné
// meno + fakturačná adresa + POVINNÝ súhlas s obchodnými podmienkami.
import { describe, it, expect } from 'vitest';
import {
	normalizeObjednavka,
	validateObjednavka,
	jeSuhlas,
	OBJ_LIMITY,
	type ObjednavkaVstup
} from '../src/lib/dopyt';

const platna = (over: Partial<ObjednavkaVstup> = {}): ObjednavkaVstup => ({
	meno: 'Ján Novák',
	email: 'jan@example.com',
	telefon: '+421 900 111 222',
	miesto: '010 01 Žilina',
	poznamka: '',
	faktMeno: 'Ján Novák',
	faktAdresa: 'Hlavná 1, 010 01 Žilina',
	faktIco: '',
	faktDic: '',
	suhlas: true,
	...over
});

describe('validateObjednavka — kontakt + fakturačné + súhlas', () => {
	it('platná objednávka prejde', () => {
		const { ok, errors } = validateObjednavka(platna());
		expect(ok).toBe(true);
		expect(errors).toEqual({});
	});

	it('bez súhlasu s podmienkami → chyba (objednávka nie je záväzná)', () => {
		const { ok, errors } = validateObjednavka(platna({ suhlas: false }));
		expect(ok).toBe(false);
		expect(errors.suhlas).toMatch(/súhlas/i);
	});

	it('chýbajúce fakturačné meno → chyba', () => {
		const { ok, errors } = validateObjednavka(platna({ faktMeno: '' }));
		expect(ok).toBe(false);
		expect(errors.faktMeno).toBeTruthy();
	});

	it('chýbajúca fakturačná adresa → chyba', () => {
		const { ok, errors } = validateObjednavka(platna({ faktAdresa: '' }));
		expect(ok).toBe(false);
		expect(errors.faktAdresa).toBeTruthy();
	});

	it('znovupoužíva dopyt validáciu kontaktu — zlý e-mail → chyba email', () => {
		const { ok, errors } = validateObjednavka(platna({ email: 'nieemail' }));
		expect(ok).toBe(false);
		expect(errors.email).toBeTruthy();
	});

	it('IČO/DIČ sú voliteľné — bez nich objednávka prejde', () => {
		const { ok } = validateObjednavka(platna({ faktIco: '', faktDic: '' }));
		expect(ok).toBe(true);
	});
});

describe('normalizeObjednavka — orezanie + cap + checkbox', () => {
	it('oreže a capne fakturačné polia; súhlas z checkboxu', () => {
		const v = normalizeObjednavka({
			meno: '  Ján  ',
			email: 'JAN@x.sk ',
			faktMeno: '  Firma s.r.o.  ',
			faktAdresa: 'Ulica 1',
			faktIco: '12345678',
			faktDic: 'SK1234567890',
			suhlas: 'on'
		});
		expect(v.meno).toBe('Ján');
		expect(v.faktMeno).toBe('Firma s.r.o.');
		expect(v.faktIco).toBe('12345678');
		expect(v.suhlas).toBe(true);
	});

	it('dlhé fakturačné meno sa capne na OBJ_LIMITY.faktMeno', () => {
		const dlhe = 'x'.repeat(500);
		const v = normalizeObjednavka({ faktMeno: dlhe, suhlas: 'on' });
		expect(v.faktMeno.length).toBe(OBJ_LIMITY.faktMeno);
	});

	it('nezaškrtnutý checkbox (chýba/„off"/prázdny) → suhlas false', () => {
		expect(normalizeObjednavka({ suhlas: undefined }).suhlas).toBe(false);
		expect(normalizeObjednavka({ suhlas: '' }).suhlas).toBe(false);
		expect(normalizeObjednavka({ suhlas: 'off' }).suhlas).toBe(false);
		expect(normalizeObjednavka({ suhlas: '0' }).suhlas).toBe(false);
	});
});

describe('jeSuhlas — checkbox truthiness', () => {
	it('„on"/„1"/„true"/„yes" → true', () => {
		for (const v of ['on', '1', 'true', 'yes', 'áno']) expect(jeSuhlas(v)).toBe(true);
	});
	it('prázdne/„0"/„false"/„off"/„no"/undefined → false', () => {
		for (const v of ['', '0', 'false', 'off', 'no', undefined, null]) expect(jeSuhlas(v)).toBe(false);
	});
});
