// Viac kusov jedného viac-variantového profilu (žľab / kotviaci / 200x140 / 250x110)
// sa MUSÍ ukladať do spoločných tyčí. Predtým dostal každý kus vlastnú tyč, takže
// 6400 + 1030 mm dalo 7,5 m + 4,5 m namiesto jednej 7,5 m tyče — MONEY nadodpis.
// Hlásené zo živej zákazky ZAK2026337 (2026-07-29).
import { describe, it, expect } from 'vitest';
import { transform, fmtBars } from '../src/lib/server/pergola';

const bars = (text: string) => fmtBars(transform(text).trace[0].bars);
const qty = (text: string) => {
	const g: Record<string, number> = {};
	transform(text).out.forEach((o) => {
		if (o.qty) g[o.prp] = o.qty;
	});
	return g;
};

describe('viac-variantový profil: kusy zdieľajú tyč', () => {
	it('kotviaci 6400 + 1030 sa zmestí do JEDNEJ 7,5 m tyče (ZAK2026337)', () => {
		const t = '18019 KOTVIACI PROFIL HORNY V2\t1\t6400\n18019 KOTVIACI PROFIL HORNY V2\t1\t1030';
		expect(bars(t)).toBe('1(7,5m)');
		expect(qty(t)).toEqual({ PRP20258: 7.5 });
	});

	it('tyč sa zmenší na najkratšiu, ktorá stačí (2× 2000 → 4,5 m, nie 7,5 m)', () => {
		const t = '18021 ZLABOVY PROFIL 110 V2\t2\t2000';
		expect(bars(t)).toBe('1(4,5m)');
	});

	it('4× 2000 → dve 4,5 m tyče (9 m), nie 6+4,5 ani 4× 4,5', () => {
		expect(bars('18021 ZLABOVY PROFIL 110 V2\t4\t2000')).toBe('2(4,5m)');
	});

	it('kusy, ktoré sa nezmestia spolu, dostanú vlastné tyče', () => {
		// 5930 + 5930 = 11860 > 7500 → dve tyče, každá zmenšená na 6 m
		expect(bars('18019 KOTVIACI PROFIL HORNY V2\t2\t5930')).toBe('2(6m)');
	});

	it('jeden kus sa správa ako doteraz (5930 → 6 m)', () => {
		expect(bars('18019 KOTVIACI PROFIL HORNY V2\t1\t5930')).toBe('1(6m)');
	});
});
