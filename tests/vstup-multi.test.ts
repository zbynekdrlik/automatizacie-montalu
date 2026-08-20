// Validácia viac-posuvového vstupu (zimná záhrada) — každá strážna vetva.
import { describe, it, expect } from 'vitest';
import { parseMultiVstup, parseVstup } from '../src/lib/server/vstup';

function fd(fields: Record<string, string>): FormData {
	const f = new FormData();
	for (const [k, v] of Object.entries(fields)) f.set(k, v);
	return f;
}

const POSUV = { system: 'Robust', styl: '2K', s: 5000, v: 2000, sklo: 'X', otvaranie: 'P - L' };
const base = { zak: 'Z1', op: 'O1', zakaznik: 'Test' };

describe('parseMultiVstup — strážne kontroly viac-posuvového vstupu', () => {
	it('platný vstup s 2 posuvmi prejde', () => {
		const { vstup, error } = parseMultiVstup(
			fd({
				...base,
				poznamka: 'pozn',
				posuvy: JSON.stringify([POSUV, { ...POSUV, s: 2509, v: 1930 }])
			})
		);
		expect(error).toBeNull();
		expect(vstup.posuvy).toHaveLength(2);
		expect(vstup.posuvy[0]!.s).toBe(5000);
		expect(vstup.poznamka).toBe('pozn');
	});

	it('desatinná čiarka v rozmere sa akceptuje', () => {
		const { vstup, error } = parseMultiVstup(
			fd({ ...base, posuvy: JSON.stringify([{ ...POSUV, s: '2509,5' as unknown as number }]) })
		);
		expect(error).toBeNull();
		expect(vstup.posuvy[0]!.s).toBeCloseTo(2509.5, 3);
	});

	it.each([
		['chýba zak', { ...base, zak: '' }, [POSUV], 'ZAK'],
		['chýba op', { ...base, op: '' }, [POSUV], 'OP'],
		['chýba zákazník', { ...base, zakaznik: '' }, [POSUV], 'zákazník'],
		['prázdne posuvy', base, [], 'aspoň jeden posuv'],
		['priveľa posuvov', base, Array(13).fill(POSUV), 'Priveľa'],
		['posuv bez systému', base, [{ ...POSUV, system: '' }], 'Posuv 1'],
		['posuv bez štýlu', base, [{ ...POSUV, styl: '' }], 'Posuv 1'],
		['šírka mimo rozsahu', base, [{ ...POSUV, s: 50 }], 'šírka'],
		['výška mimo rozsahu', base, [{ ...POSUV, v: 999999 }], 'výška'],
		['posuv bez skla', base, [{ ...POSUV, sklo: '' }], 'vyber sklo'],
		['neplatné otváranie', base, [{ ...POSUV, otvaranie: 'Hore' }], 'otváranie'],
		['chyba je pri 2. posuve', base, [POSUV, { ...POSUV, s: 10 }], 'Posuv 2']
	])('%s → chyba', (_n, flds, posuvy, sub) => {
		const { error } = parseMultiVstup(fd({ ...flds, posuvy: JSON.stringify(posuvy) }));
		expect(error).toContain(sub);
	});

	it('nevalidný JSON v posuvy → chyba (nie pád)', () => {
		const { error } = parseMultiVstup(fd({ ...base, posuvy: '{nie json' }));
		expect(error).toContain('aspoň jeden posuv');
	});

	it('chýbajúce pole posuvy → chyba', () => {
		const { error } = parseMultiVstup(fd({ ...base }));
		expect(error).toContain('aspoň jeden posuv');
	});

	it('poznámka sa oreže na 300 znakov', () => {
		const { vstup } = parseMultiVstup(
			fd({ ...base, poznamka: 'a'.repeat(400), posuvy: JSON.stringify([POSUV]) })
		);
		expect(vstup.poznamka.length).toBe(300);
	});

	// 2x štýl = opona: server vynúti Opona aj keď POST pošle iné otváranie
	it('2x posuv s otváraním „P - L" sa serverovo prepíše na Opona', () => {
		const { vstup, error } = parseMultiVstup(
			fd({ ...base, posuvy: JSON.stringify([{ ...POSUV, styl: '2x2K', otvaranie: 'P - L' }]) })
		);
		expect(error).toBeNull();
		expect(vstup.posuvy[0]!.otvaranie).toBe('Opona');
	});
});

describe('parseVstup — 2x štýl vynúti Opona serverovo (jeden posuv)', () => {
	it('Robust 2x3K + „L - P" → Opona', () => {
		const f = new FormData();
		for (const [k, v] of Object.entries({
			zak: 'Z',
			op: 'O',
			zakaznik: 'T',
			system: 'Robust',
			styl: '2x3K',
			s: '5000',
			v: '2200',
			sklo: 'X',
			otvaranie: 'L - P'
		}))
			f.set(k, v);
		const { vstup, error } = parseVstup(f);
		expect(error).toBeNull();
		expect(vstup.otvaranie).toBe('Opona');
	});
});
