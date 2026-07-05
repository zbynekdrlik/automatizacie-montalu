// 1:1 vektory z n8n verzie (bazen_test.js) + nové validácie úprav množstiev.
import { describe, it, expect } from 'vitest';
import { computeBazen, applyEdits, decompose, minCover } from '../src/lib/server/bazen';
import type { BazenVstup } from '../src/lib/server/bazen';

function vstup(over: Partial<BazenVstup> = {}): BazenVstup {
	return {
		zak: 'Z1',
		op: 'O1',
		zakaznik: 'Test',
		model: 'Premier / Exclusive',
		kolaj: 'Jednokolaj',
		pocetSekcii: 3,
		pocetPriecok: 3,
		dvere: false,
		vs4500: 0,
		vs6000: 0,
		ss4500: 0,
		ss6000: 0,
		ms4500: 0,
		ms6000: 0,
		dlzkaKolajnic: 10000,
		prieckovy4300: 0,
		prieckovy6000: 0,
		vyklopneCelo: 0,
		caka: false,
		...over
	};
}

const byKod = (arr: { kod: string; qty: number }[]) => {
	const o: Record<string, number> = {};
	arr.forEach((x) => (o[x.kod] = x.qty));
	return o;
};

describe('computeBazen — 1:1 s n8n verziou (Excel ground truth)', () => {
	it('3 sekcie, jednokolaj, dĺžka 10000: 20 položiek, auto 3-koľaj 4600=4.6 + 6700=6.7', () => {
		const { out, error } = computeBazen(vstup());
		expect(error).toBeNull();
		expect(out.length).toBe(20);
		const g = byKod(out);
		expect(g['BPP00094']).toBe(4.6);
		expect(g['BPP00097']).toBe(6.7);
		// priečna výstuha = priečky × sekcie × 4.2 (zaokrúhlené na 3 des.)
		expect(g['BPP20245']).toBe(37.8);
		// kladkový jednokolaj = sekcie × 2.2
		expect(g['BPP00050']).toBeCloseTo(3 * 2.2, 9);
	});

	it('dvojkolaj zdvojnásobí koľajnice a vynuluje jednokolaj kladkový', () => {
		const { out } = computeBazen(vstup({ kolaj: 'Dvojkolaj' }));
		const g = byKod(out);
		expect(g['BPP00094']).toBe(9.2); // 2×4.6
		expect(g['BPP00050']).toBe(0);
		// kladkový (oba kolaje) = BPP202414 (nový kód, BPP00046 je 0 na sklade)
		expect(g['BPP202414']).toBeCloseTo(2 * 3 * 2.2, 9);
	});

	it('kladkový profil = nový BPP202414, NIE starý 0-skladový BPP00046 (Money odpis nesmie zlyhať)', () => {
		const { out } = computeBazen(vstup());
		const kody = out.map((o) => o.kod);
		expect(kody).toContain('BPP202414');
		expect(kody).not.toContain('BPP00046');
		// presný Money názov (import matchuje podľa kódu, názov musí sedieť s katalógom)
		expect(out.find((o) => o.kod === 'BPP202414')!.nazov).toBe('Kladkový profil V2 Surový 4400 mm');
	});

	it('Star model premapuje čelné/krajné profily na STAR kódy', () => {
		const { out } = computeBazen(vstup({ model: 'Star', ss4500: 1 }));
		const g = byKod(out);
		expect(g['BPP20249']).toBe(4.5); // namiesto BPP00054
		expect(g['BPP00054']).toBeUndefined();
		expect(out.find((o) => o.kod === 'BPP20249')!.nazov).toContain('STAR');
	});

	it('dvere pridávajú dverové profily a krajný pri VS=1', () => {
		const { out } = computeBazen(vstup({ dvere: true, vs4500: 1 }));
		const g = byKod(out);
		expect(g['BPP20254']).toBe(4.4);
		expect(g['BPP20255']).toBe(6);
		expect(g['BPP20256']).toBe(4.4);
		expect(g['BPP00061']).toBe(4.5); // (0+0+1)×4.5 vďaka dvere&&vs4500
	});

	it('validácia: prázdny ZAK / nulové sekcie / prázdny výstup', () => {
		expect(computeBazen(vstup({ zak: '' })).error).toContain('ZAK');
		expect(computeBazen(vstup({ pocetSekcii: 0 })).error).toContain('sekcií');
	});

	it('decompose + minCover (auto-koľajnice)', () => {
		expect(decompose(3)).toEqual({ k2: 0, k3: 1 });
		expect(decompose(4)).toEqual({ k2: 2, k3: 0 });
		expect(decompose(5)).toEqual({ k2: 1, k3: 1 });
		expect(minCover(10000)).toEqual([1, 1]); // 4600+6700=11300 najmenší presah
		expect(minCover(0)).toEqual([0, 0]);
	});
});

describe('applyEdits — kontrola množstiev (opravy nálezov auditu)', () => {
	const { out } = computeBazen(vstup());

	it('bez úprav = auto hodnoty, 20 riadkov', () => {
		const { finalOut, zmenene, error } = applyEdits(out, new Map());
		expect(error).toBeNull();
		expect(zmenene).toEqual([]);
		expect(finalOut.length).toBe(20);
		expect(byKod(finalOut)['BPP00094']).toBe(4.6);
	});

	it('ručná úprava s čiarkou (9,2) sa aplikuje, neupravené ostáva', () => {
		const { finalOut, zmenene, error } = applyEdits(
			out,
			new Map([
				['BPP00094', '9,2'],
				['BPP00068', '5']
			])
		);
		expect(error).toBeNull();
		const g = byKod(finalOut);
		expect(g['BPP00094']).toBe(9.2);
		expect(g['BPP00068']).toBe(5);
		expect(g['BPP00097']).toBe(6.7);
		expect(zmenene).toContain('BPP00094');
	});

	it('záporná hodnota sa ODMIETNE (v n8n išla ticho do Money)', () => {
		const { error } = applyEdits(out, new Map([['BPP00094', '-9,2']]));
		expect(error).toContain('Záporné');
	});

	it('nečíselná hodnota sa ODMIETNE (v n8n sa ticho stala nulou)', () => {
		const { error } = applyEdits(out, new Map([['BPP00094', 'abc']]));
		expect(error).toContain('Neplatné');
	});

	it('podozrivo veľká hodnota sa odmietne', () => {
		const { error } = applyEdits(out, new Map([['BPP00094', '999999']]));
		expect(error).toContain('veľké');
	});

	it('úprava na 0 je legitímna a hlási sa ako zmenená', () => {
		const { finalOut, zmenene, error } = applyEdits(out, new Map([['BPP00094', '0']]));
		expect(error).toBeNull();
		expect(byKod(finalOut)['BPP00094']).toBe(0);
		expect(zmenene).toContain('BPP00094');
	});

	it('všetky množstvá vynulované → finalOut samé nuly (odoslať to odmietne)', () => {
		const { out } = computeBazen(vstup());
		const edits = new Map(out.map((o) => [o.kod, '0']));
		const { finalOut, error } = applyEdits(out, edits);
		expect(error).toBeFalsy();
		// action `odoslat` na tomto stave vráti chybu „neostala žiadna položka"
		expect(finalOut.every((o) => o.qty <= 0)).toBe(true);
	});
});
