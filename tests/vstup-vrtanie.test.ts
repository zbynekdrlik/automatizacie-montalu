import { describe, it, expect } from 'vitest';
import { parseVstup } from '../src/lib/server/vstup';

function fd(obj: Record<string, string>): FormData {
	const f = new FormData();
	for (const [k, v] of Object.entries(obj)) f.set(k, v);
	return f;
}
const base: Record<string, string> = {
	zak: 'Z1',
	op: '01',
	zakaznik: 'X',
	system: 'Deluxe',
	styl: '2K',
	s: '2000',
	v: '2200',
	sklo: 'Float kalené 6 mm',
	otvaranie: 'P - L'
};

describe('parseVstup: výška vŕtania zámku D46 (Deluxe)', () => {
	it('načíta zadanú výšku', () => {
		const { vstup, error } = parseVstup(fd({ ...base, vrtanieZamku: '1100' }));
		expect(error).toBeNull();
		expect(vstup.vrtanieZamku).toBe(1100);
	});
	it('default 1050 keď pole chýba', () => {
		expect(parseVstup(fd(base)).vstup.vrtanieZamku).toBe(1050);
	});
	it('default 1050 pri nezmyselnej hodnote (0 / záporné / text)', () => {
		expect(parseVstup(fd({ ...base, vrtanieZamku: '0' })).vstup.vrtanieZamku).toBe(1050);
		expect(parseVstup(fd({ ...base, vrtanieZamku: '-5' })).vstup.vrtanieZamku).toBe(1050);
		expect(parseVstup(fd({ ...base, vrtanieZamku: 'xx' })).vstup.vrtanieZamku).toBe(1050);
	});
	it('desatinná čiarka sa naparsuje (1200,5 → 1200.5)', () => {
		expect(parseVstup(fd({ ...base, vrtanieZamku: '1200,5' })).vstup.vrtanieZamku).toBe(1200.5);
	});
});
