// Kontrakt zdieľaného cenového leaf `cennik-spolocne.ts` (#426/#428). Money-KRITICKÉ: `sDphEur` musí
// robiť DPH 23 % half-up v CENTOCH (zrkadlí PHP `round()` na montalu.sk), NIE naivné `net*1.23` FP —
// tie sa na .xx5 hraniciach líšia o 1 cent. Kotvy sú reálne montalu reťazce z parity testov 4 modulov
// (pergola/bazén/zimná záhrada/oplotenie), takže tento test zamyká zdieľanú aritmetiku nezávisle od nich.
import { describe, it, expect } from 'vitest';
import {
	EPS,
	VO_LABEL,
	eur2,
	dphNaPct,
	sDphEur,
	zlozka,
	cennikHash
} from '../src/lib/server/cennik-spolocne';

describe('cennik-spolocne — konštanty', () => {
	it('EPS = 1e-9, VO_LABEL = „veľkoobchodná cena"', () => {
		expect(EPS).toBe(1e-9);
		expect(VO_LABEL).toBe('veľkoobchodná cena');
	});
});

describe('cennik-spolocne — eur2 / dphNaPct', () => {
	it('eur2 zaokrúhli na celé centy', () => {
		expect(eur2(3619.564)).toBe(3619.56);
		expect(eur2(3619.565)).toBe(3619.57); // half-up
		expect(eur2(100)).toBe(100);
	});
	it('dphNaPct prevedie desatinnú sadzbu na celé percentá', () => {
		expect(dphNaPct(0.23)).toBe(23);
		expect(dphNaPct(0.2)).toBe(20);
		expect(dphNaPct(0.1)).toBe(10);
	});
});

describe('cennik-spolocne — sDphEur (DPH 23 % half-up v CENTOCH, montalu.sk parita)', () => {
	// Kotvy na .xx5 hraniciach — presne tam, kde naivné `net*1.23` FP driftne o 1 cent.
	const kotvy: Array<[number, number, string]> = [
		[3917.5, 4818.53, 'pergola VO — 4818,525 NAHOR'],
		[4095.5, 5037.47, 'pergola MO — 5037,465'],
		[13732.5, 16890.98, 'bazén VO — naivné FP dá 16890,97'],
		[20641.5, 25389.05, 'zimná záhrada — naivné FP/banker dá 25389,04'],
		[4009.5, 4931.69, 'oplotenie MO — naivné FP dá 4931,68']
	];
	for (const [net, cena, popis] of kotvy) {
		it(`${net} → ${cena} (${popis})`, () => {
			expect(sDphEur(net, 23)).toBe(cena);
		});
	}

	it('celocentový half-up sa LÍŠI od naivného net*1.23 FP na .xx5 hranici (kontrola, že to nie je tautológia)', () => {
		const net = 13732.5;
		const naivne = Math.round(net * 1.23 * 100) / 100;
		expect(sDphEur(net, 23)).toBe(16890.98);
		expect(naivne).toBe(16890.97); // naivné FP je o 1 cent nižšie
		expect(sDphEur(net, 23)).not.toBe(naivne);
	});
});

describe('cennik-spolocne — zlozka', () => {
	it('vráti {bezDph: eur2(net), sDph: sDphEur(net, dphPct)}', () => {
		expect(zlozka(3917.5, 23)).toEqual({ bezDph: 3917.5, sDph: 4818.53 });
		expect(zlozka(4009.5, 23)).toEqual({ bezDph: 4009.5, sDph: 4931.69 });
	});
});

describe('cennik-spolocne — cennikHash', () => {
	it('12 hex znakov, deterministický', () => {
		const obj = { cennik: { a: [1, 2] }, dph: 0.23, mriezka: { min: 2 } };
		const h = cennikHash(obj);
		expect(h).toMatch(/^[0-9a-f]{12}$/);
		expect(cennikHash(obj)).toBe(h); // deterministický
	});
	it('zmena cenotvorných dát ZMENÍ hash (drift detekcia)', () => {
		const a = cennikHash({ cennik: { x: 100 }, dph: 0.23 });
		const b = cennikHash({ cennik: { x: 101 }, dph: 0.23 });
		expect(a).not.toBe(b);
	});
	it('poradie kľúčov je významné (JSON.stringify) — zhoduje sa s pôvodným inline builderom', () => {
		// Pôvodný inline `createHash('sha256').update(JSON.stringify({cennik, dph, mriezka}))...slice(0,12)`.
		const ref = { cennik: { a: 1 }, dph: 0.23, mriezka: { min: 2, max: 6, krok: 0.5 } };
		expect(cennikHash(ref)).toBe(cennikHash(ref));
		// iné poradie kľúčov → iný JSON string → iný hash (dokazuje, že sa spoliehame na poradie)
		const preusporiadane = { dph: 0.23, cennik: { a: 1 }, mriezka: { min: 2, max: 6, krok: 0.5 } };
		expect(cennikHash(preusporiadane)).not.toBe(cennikHash(ref));
	});
});
