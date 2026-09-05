// CLIP multi (#468 fáza 2) — unit testy pre computeClipMulti a parseClipMultiVstup.
// Kontrakt: per-kus ROUNDUP vzorec zachovaný (1:1 parita s Patrikovým Excelom),
// multi = súčet per-kus výstupov per Money kód. Žiadny bin-packing.
import { describe, it, expect } from 'vitest';
import { computeClip, computeClipMulti, type ClipVstup } from '../src/lib/clip';

function vstup(over: Partial<ClipVstup> = {}): ClipVstup {
	return {
		zak: 'Z1',
		op: 'OP1',
		zakaznik: 'Test',
		caka: false,
		typ: 'izo',
		variant: 1,
		sirka: 3000,
		vyska: 1000,
		ral: '',
		...over
	};
}

const R = 'ZASP00116';
const P = 'ZASP00125';
const ZI = 'ZASP00119'; // izo zasklievací
const ZK = 'ZASP202413'; // klasika zasklievací

describe('computeClipMulti — parita: 2× identický kus = presne 2× tyče', () => {
	it('2× izo B0 3000×1000 = 2× single', () => {
		const single = computeClip(vstup());
		const multi = computeClipMulti([vstup(), vstup()]);

		expect(multi.kusy).toHaveLength(2);
		// každý kus je identický so single
		for (const kus of multi.kusy) {
			expect(kus.polozky).toEqual(single.polozky);
			expect(kus.riadky).toEqual(single.riadky);
		}
		// spoločný odpis = 2× single per kód
		for (const p of multi.polozky) {
			const singleQty = single.polozky.find((s) => s.kod === p.kod)!.qty;
			expect(p.qty).toBe(singleQty * 2);
		}
	});

	it('3× klasika B2 3000×1000 = 3× single', () => {
		const v = vstup({ typ: 'klasika', variant: 3 });
		const single = computeClip(v);
		const multi = computeClipMulti([v, v, v]);

		expect(multi.kusy).toHaveLength(3);
		for (const p of multi.polozky) {
			const singleQty = single.polozky.find((s) => s.kod === p.kod)!.qty;
			expect(p.qty).toBe(singleQty * 3);
		}
	});
});

describe('computeClipMulti — rôzne kusy (izo + klasika, rôzne rozmery)', () => {
	it('izo B0 3000×1000 + klasika B1 3800×2000 — merged polozky', () => {
		const v1 = vstup({ typ: 'izo', variant: 1, sirka: 3000, vyska: 1000 });
		const v2 = vstup({ typ: 'klasika', variant: 2, sirka: 3800, vyska: 2000 });
		const s1 = computeClip(v1);
		const s2 = computeClip(v2);
		const multi = computeClipMulti([v1, v2]);

		expect(multi.kusy).toHaveLength(2);
		// kus 0 = s1, kus 1 = s2
		expect(multi.kusy[0]!.polozky).toEqual(s1.polozky);
		expect(multi.kusy[1]!.polozky).toEqual(s2.polozky);

		// rám (ZASP00116) — oba kusy ho majú
		const ramQty =
			s1.polozky.find((p) => p.kod === R)!.qty + s2.polozky.find((p) => p.kod === R)!.qty;
		expect(multi.polozky.find((p) => p.kod === R)!.qty).toBe(ramQty);

		// priečka (ZASP00125) — len v2 (B1) má priečku
		const s1Priecka = s1.polozky.find((p) => p.kod === P);
		const s2Priecka = s2.polozky.find((p) => p.kod === P);
		const expectedPriecka = (s1Priecka?.qty ?? 0) + (s2Priecka?.qty ?? 0);
		const multiPriecka = multi.polozky.find((p) => p.kod === P);
		if (expectedPriecka > 0) {
			expect(multiPriecka!.qty).toBe(expectedPriecka);
		}

		// izo zasklievací (ZASP00119) — len v1
		expect(multi.polozky.find((p) => p.kod === ZI)!.qty).toBe(
			s1.polozky.find((p) => p.kod === ZI)!.qty
		);

		// klasika zasklievací (ZASP202413) — len v2
		expect(multi.polozky.find((p) => p.kod === ZK)!.qty).toBe(
			s2.polozky.find((p) => p.kod === ZK)!.qty
		);
	});
});

describe('computeClipMulti — jeden kus = identický s computeClip', () => {
	it('single item multi = single', () => {
		const v = vstup({ typ: 'klasika', variant: 4, sirka: 3000, vyska: 2600 });
		const single = computeClip(v);
		const multi = computeClipMulti([v]);

		expect(multi.kusy).toHaveLength(1);
		expect(multi.kusy[0]!.polozky).toEqual(single.polozky);
		expect(multi.polozky).toEqual(single.polozky);
	});
});

describe('computeClipMulti — honest-null (drobné položky NEVSTUPUJÚ do odpisu)', () => {
	it('multi odpis neobsahuje null kódy (drobné položky)', () => {
		const multi = computeClipMulti([vstup(), vstup({ typ: 'klasika', variant: 2 })]);
		// všetky merged polozky sú ZASP kódy, žiadny null
		expect(multi.polozky.every((p) => p.kod.startsWith('ZASP'))).toBe(true);
		expect(multi.polozky.every((p) => p.mj === 'ks')).toBe(true);
	});
});

describe('computeClipMulti — poradie kódov (prvý výskyt)', () => {
	it('poradie zachované: rám → priečka → zasklievací', () => {
		const multi = computeClipMulti([
			vstup({ variant: 2 }), // izo B1 — rám, priečka, zasklievací izo
			vstup({ typ: 'klasika', variant: 1 }) // klasika B0 — rám, zasklievací klasika
		]);
		const kody = multi.polozky.map((p) => p.kod);
		// rám je vždy prvý (z prvého kusu)
		expect(kody[0]).toBe(R);
		// priečka je druhá (z prvého kusu, B1 má priečku)
		expect(kody[1]).toBe(P);
		// izo zasklievací je tretí
		expect(kody[2]).toBe(ZI);
		// klasika zasklievací je štvrtý (z druhého kusu)
		expect(kody[3]).toBe(ZK);
	});
});
