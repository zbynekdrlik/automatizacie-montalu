// #277 — validácia + honeypot verejného dopytu. Pure.
import { describe, it, expect } from 'vitest';
import { normalizeDopyt, validateDopyt, jeSpam, HONEYPOT_FIELD, LIMITY } from '../src/lib/dopyt';

describe('normalizeDopyt', () => {
	it('trimuje a capuje polia na limity', () => {
		const v = normalizeDopyt({
			meno: '  Ján Novák  ',
			email: ' jan@example.com ',
			telefon: '  +421 900 111 222 ',
			miesto: '  Bratislava 81101 ',
			poznamka: 'x'.repeat(2000)
		});
		expect(v.meno).toBe('Ján Novák');
		expect(v.email).toBe('jan@example.com');
		expect(v.telefon).toBe('+421 900 111 222');
		expect(v.miesto).toBe('Bratislava 81101');
		expect(v.poznamka.length).toBe(LIMITY.poznamka);
	});

	it('chýbajúce polia → prázdne stringy', () => {
		expect(normalizeDopyt({})).toEqual({
			meno: '',
			email: '',
			telefon: '',
			miesto: '',
			poznamka: ''
		});
	});
});

describe('validateDopyt', () => {
	it('platný vstup (len meno+email povinné) → ok', () => {
		const { ok, errors } = validateDopyt(normalizeDopyt({ meno: 'Ján', email: 'jan@example.com' }));
		expect(ok).toBe(true);
		expect(errors).toEqual({});
	});

	it('krátke meno → chyba meno', () => {
		const { ok, errors } = validateDopyt(normalizeDopyt({ meno: 'J', email: 'j@x.sk' }));
		expect(ok).toBe(false);
		expect(errors.meno).toBeDefined();
	});

	it('chýbajúci e-mail → chyba email', () => {
		const { errors } = validateDopyt(normalizeDopyt({ meno: 'Ján' }));
		expect(errors.email).toMatch(/e-mail/i);
	});

	it('nesprávny tvar e-mailu → chyba email', () => {
		expect(
			validateDopyt(normalizeDopyt({ meno: 'Ján', email: 'nieemail' })).errors.email
		).toBeDefined();
		expect(validateDopyt(normalizeDopyt({ meno: 'Ján', email: 'a@b' })).errors.email).toBeDefined();
	});

	it('nesprávny telefón → chyba telefon (ak vyplnený)', () => {
		const { errors } = validateDopyt(
			normalizeDopyt({ meno: 'Ján', email: 'j@x.sk', telefon: 'abc' })
		);
		expect(errors.telefon).toBeDefined();
	});

	it('platný telefón prejde', () => {
		const { ok } = validateDopyt(
			normalizeDopyt({ meno: 'Ján', email: 'j@x.sk', telefon: '+421 900 111 222' })
		);
		expect(ok).toBe(true);
	});
});

describe('jeSpam (honeypot)', () => {
	it('prázdny honeypot → nie spam', () => {
		expect(jeSpam('')).toBe(false);
		expect(jeSpam('   ')).toBe(false);
		expect(jeSpam(null)).toBe(false);
		expect(jeSpam(undefined)).toBe(false);
	});
	it('vyplnený honeypot → spam', () => {
		expect(jeSpam('http://spam')).toBe(true);
	});
	it('má definované meno honeypot poľa', () => {
		expect(HONEYPOT_FIELD).toBe('firma_web');
	});
});
