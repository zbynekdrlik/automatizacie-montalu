// #583 ROZHODNUTÉ (28.9., Patrik v Odoo úlohe 1191, msg 1865361: „nechal by som tam obe
// klučky na výber zo stietkou"): pri sieťke sa kovanie NEZAHADZUJE na žiadnej strane — server
// zachová ľavú aj pravú kľučku (aj stredovú pri opone), nech je otváranie L - P, P - L alebo
// opona. Ruší pravidlo „kovanie len na strane bez sieťky" z 0.25.50. Kovanie je display-only
// (plán/náhľad), Money-neutrálne.
import { describe, it, expect } from 'vitest';
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

describe('parseVstup — sieťka nezahodí kovanie na žiadnej strane (#583 ROZHODNUTÉ)', () => {
	for (const otvaranie of ['L - P', 'P - L']) {
		it(`Robust ${otvaranie} + sieťka: ľavá AJ pravá kľučka ostávajú`, () => {
			const { vstup, error } = parseVstup(fd({ ...zaklad, otvaranie, ...sietkaFd }));
			expect(error).toBeNull();
			expect(vstup.sietka).not.toBeNull();
			expect(vstup.sietka?.uchyt).toBe('madloVelke');
			expect(vstup.kovanieL).toBe(KL);
			expect(vstup.kovanieP).toBe(KP);
		});
	}

	it('opona (2x) + sieťka: obe strany aj stredové kovanie ostávajú', () => {
		const { vstup, error } = parseVstup(
			fd({ ...zaklad, styl: '2x3', otvaranie: 'Opona', kovanieStred: KS, ...sietkaFd })
		);
		expect(error).toBeNull();
		expect(vstup.kovanieL).toBe(KL);
		expect(vstup.kovanieP).toBe(KP);
		expect(vstup.kovanieStred).toBe(KS);
	});
});

describe('parseMultiVstup — každý posuv so sieťkou zachová obe kľučky (#583 ROZHODNUTÉ)', () => {
	it('posuvy L - P a P - L so sieťkou aj posuv bez sieťky: obe strany všade', () => {
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
		const posuvy = [
			posuv,
			{ ...posuv, sietka: true, sietkaUchyt: 'madloVelke' },
			{ ...posuv, otvaranie: 'P - L', sietka: true, sietkaUchyt: 'madloVelke' }
		];
		const { vstup, error } = parseMultiVstup(
			fd({ zak: 'ZAK1', op: 'OP1', zakaznik: 'X', posuvy: JSON.stringify(posuvy) })
		);
		expect(error).toBeNull();
		expect(vstup.posuvy.map((p) => [p.kovanieL, p.kovanieP])).toEqual([
			[KL, KP],
			[KL, KP],
			[KL, KP]
		]);
		expect(vstup.posuvy[1]!.sietka).not.toBeNull();
		expect(vstup.posuvy[2]!.sietka).not.toBeNull();
	});
});
