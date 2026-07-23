import { describe, it, expect } from 'vitest';
import { parseVstup, parseMultiVstup } from '../src/lib/server/vstup';

function fd(obj: Record<string, string>): FormData {
	const f = new FormData();
	for (const [k, v] of Object.entries(obj)) f.set(k, v);
	return f;
}
const base: Record<string, string> = {
	zak: 'Z1',
	op: '01',
	zakaznik: 'X',
	system: 'Robust',
	styl: '2K',
	s: '2000',
	v: '2200',
	sklo: 'Izolačné 4/16/4 číre',
	otvaranie: 'P - L'
};
const POSUV = { system: 'Slide', styl: '3K', s: 2617, v: 2468, sklo: 'Izolačné 4/8/4 číre', otvaranie: 'L - P' };
const multiBase: Record<string, string> = { zak: 'Z1', op: '01', zakaznik: 'X' };

describe('parseVstup: RAL (nové pole, display-only)', () => {
	it('načíta zadaný RAL', () => {
		const { vstup, error } = parseVstup(fd({ ...base, ral: '7016' }));
		expect(error).toBeNull();
		expect(vstup.ral).toBe('7016');
	});
	it('prázdny RAL keď pole chýba', () => {
		expect(parseVstup(fd(base)).vstup.ral).toBe('');
	});
	it('RAL sa oreže na 40 znakov', () => {
		expect(parseVstup(fd({ ...base, ral: 'R'.repeat(60) })).vstup.ral.length).toBe(40);
	});
	it('RAL sa trimuje', () => {
		expect(parseVstup(fd({ ...base, ral: '  RAL 9005  ' })).vstup.ral).toBe('RAL 9005');
	});
});

describe('parseVstup: viacriadková poznámka (píše sa pod seba)', () => {
	it('zachová vnútorné nové riadky', () => {
		const txt = 'Riadok 1\nRiadok 2\nRiadok 3';
		const { vstup } = parseVstup(fd({ ...base, poznamka: txt }));
		expect(vstup.poznamka).toBe(txt);
		expect(vstup.poznamka.split('\n').length).toBe(3);
	});
	it('CRLF (\\r\\n) sa normalizuje na \\n — maxlength(300) sedí so serverovým slice', () => {
		const { vstup } = parseVstup(fd({ ...base, poznamka: 'A\r\nB\r\nC' }));
		expect(vstup.poznamka).toBe('A\nB\nC');
		expect(vstup.poznamka).not.toContain('\r');
	});
});

describe('parseMultiVstup: RAL + viacriadková poznámka', () => {
	it('načíta RAL na úrovni zákazky', () => {
		const { vstup, error } = parseMultiVstup(
			fd({ ...multiBase, ral: '7016', posuvy: JSON.stringify([POSUV]) })
		);
		expect(error).toBeNull();
		expect(vstup.ral).toBe('7016');
	});
	it('prázdny RAL keď chýba', () => {
		expect(parseMultiVstup(fd({ ...multiBase, posuvy: JSON.stringify([POSUV]) })).vstup.ral).toBe('');
	});
	it('RAL sa oreže na 40 znakov', () => {
		const { vstup } = parseMultiVstup(
			fd({ ...multiBase, ral: 'R'.repeat(60), posuvy: JSON.stringify([POSUV]) })
		);
		expect(vstup.ral.length).toBe(40);
	});
	it('viacriadková poznámka zachová nové riadky', () => {
		const txt = 'Pozor na ľavé krídlo\nDodať do piatku';
		const { vstup } = parseMultiVstup(
			fd({ ...multiBase, poznamka: txt, posuvy: JSON.stringify([POSUV]) })
		);
		expect(vstup.poznamka).toBe(txt);
	});
});
