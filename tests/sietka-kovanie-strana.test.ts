// #583 (Patrik, Odoo úloha 1191 „Robust + sieťka"): zapnutie sieťky zrušilo kľučky na
// OBOCH stranách posuvu (aj stredovú pri opone), hoci sieťka beží len na JEDNEJ strane
// (`sietkaStrana(otvaranie)`) a jej úchyt nahrádza kľučku len tam. ROZHODNUTÉ: pri sieťke
// sa skryje/zahodí LEN kovanie na strane sieťky; druhá strana a stredové kovanie ostávajú.
// Strana neurčená (`null`) → obe strany ostávajú. Kovanie je display-only (Money-neutrálne).
import { describe, it, expect } from 'vitest';
import { kovanieSkryte } from '../src/lib/sietka';
import { parseVstup, parseMultiVstup } from '../src/lib/server/vstup';

const KL = 'Obojstranná kľučka s FAB';
const KP = 'Jednostranná kľučka z vnútra bez FAB';
const KS = 'Obojstranná kľučka bez FAB';

const fd = (o: Record<string, string>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(o)) f.append(k, v);
	return f;
};
const zaklad = {
	zak: 'ZAK1',
	op: 'OP1',
	zakaznik: 'X',
	system: 'Robust',
	styl: '3K',
	s: '3267',
	v: '2160',
	sklo: 'Izolačné sklo 4/16/4 číre',
	kovanieL: KL,
	kovanieP: KP
};
const sietkaFd = { sietka: '1', sietkaUchyt: 'madloVelke' };

describe('kovanieSkryte — jedno pravidlo pre formulár aj server (#583)', () => {
	it('bez sieťky sa neskrýva nič (na žiadnej strane)', () => {
		for (const strana of ['ľavá', 'pravá', null] as const)
			expect(kovanieSkryte(false, strana)).toEqual({ l: false, p: false });
	});

	it('sieťka vľavo (L - P) skryje LEN ľavé kovanie', () => {
		expect(kovanieSkryte(true, 'ľavá')).toEqual({ l: true, p: false });
	});

	it('sieťka vpravo (P - L) skryje LEN pravé kovanie', () => {
		expect(kovanieSkryte(true, 'pravá')).toEqual({ l: false, p: true });
	});

	it('strana sieťky neurčená (opona) → obe strany ostávajú', () => {
		expect(kovanieSkryte(true, null)).toEqual({ l: false, p: false });
	});
});

describe('parseVstup — kovanie pri sieťke zahodí len stranu sieťky (#583)', () => {
	it('Robust L - P + sieťka (att 39256): ľavé kovanie preč, PRAVÉ ostáva', () => {
		const { vstup, error } = parseVstup(fd({ ...zaklad, otvaranie: 'L - P', ...sietkaFd }));
		expect(error).toBeNull();
		expect(vstup.sietka).not.toBeNull();
		expect(vstup.kovanieL).toBe('');
		expect(vstup.kovanieP).toBe(KP);
	});

	it('Robust P - L + sieťka: pravé kovanie preč, ĽAVÉ ostáva', () => {
		const { vstup, error } = parseVstup(fd({ ...zaklad, otvaranie: 'P - L', ...sietkaFd }));
		expect(error).toBeNull();
		expect(vstup.kovanieL).toBe(KL);
		expect(vstup.kovanieP).toBe('');
	});

	it('bez sieťky ostávajú obe strany', () => {
		const { vstup } = parseVstup(fd({ ...zaklad, otvaranie: 'L - P' }));
		expect(vstup.kovanieL).toBe(KL);
		expect(vstup.kovanieP).toBe(KP);
	});

	it('opona (2x) + sieťka: strana neurčená → obe strany AJ stredové kovanie ostávajú', () => {
		const { vstup, error } = parseVstup(
			fd({ ...zaklad, styl: '2x3', otvaranie: 'Opona', kovanieStred: KS, ...sietkaFd })
		);
		expect(error).toBeNull();
		expect(vstup.otvaranie).toBe('Opona');
		expect(vstup.kovanieL).toBe(KL);
		expect(vstup.kovanieP).toBe(KP);
		expect(vstup.kovanieStred).toBe(KS);
	});
});

describe('parseMultiVstup — rovnaké pravidlo per posuv (#583)', () => {
	it('posuv L - P so sieťkou: ľavé preč, pravé ostáva; posuv bez sieťky nedotknutý', () => {
		const posuv = {
			system: 'Robust',
			styl: '3K',
			s: '3267',
			v: '2160',
			sklo: 'Izolačné sklo 4/16/4 číre',
			otvaranie: 'L - P',
			kovanieL: KL,
			kovanieP: KP
		};
		const posuvy = [posuv, { ...posuv, sietka: true, sietkaUchyt: 'madloVelke' }];
		const { vstup, error } = parseMultiVstup(
			fd({ zak: 'ZAK1', op: 'OP1', zakaznik: 'X', posuvy: JSON.stringify(posuvy) })
		);
		expect(error).toBeNull();
		expect(vstup.posuvy.map((p) => [p.kovanieL, p.kovanieP])).toEqual([
			[KL, KP],
			['', KP]
		]);
		expect(vstup.posuvy[1]!.sietka).not.toBeNull();
	});
});
