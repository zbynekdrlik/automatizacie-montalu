// CLIP zábradlie — KONTRAKTNÉ vektory (#372), à la tests/compute.test.ts.
//
// Zdroj: nárezové šablóny „FIX - klasika.xlsx" / „FIX - IZO.xlsx" (ir.attachment
// 14753/14752, kanál 207) — extrahované vzorce v
// `~/.claude/work-products/ch207-att-2026-09-01/clip-vektory.md`. Šablóny majú
// vstupy prázdne (cache=0), takže vektory = vzorce vyhodnotené na zvolených
// vstupoch. Tieto čísla sú ZMLUVA s Money — NIKDY ich nemeniť bez re-verifikácie
// proti xlsx (rovnaká disciplína ako Money odpis vektory v compute.test.ts).
import { describe, it, expect } from 'vitest';
import {
	computeClip,
	chybaClipVstupu,
	dostupneVarianty,
	jeClipTyp,
	CLIP_MIN_VYPLNE,
	CLIP_MAX_SIRKA,
	CLIP_DLZKA_TYCE,
	type ClipVstup,
	type ClipTyp
} from '../src/lib/clip';

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

const riadok = (r: ReturnType<typeof computeClip>, oznacenie: string) =>
	r.riadky.find((x) => x.oznacenie === oznacenie)!;

const odpisByKod = (r: ReturnType<typeof computeClip>) => {
	const o: Record<string, number> = {};
	r.polozky.forEach((p) => (o[p.kod] = p.qty));
	return o;
};

// [názov, typ, N, sirka, vyska,
//   sirkaVyplne, vyskaVyplne, m2,
//   riadky: [oznacenie, kod, rozmer, ks, zaokr, tyce][],
//   odpis: {kod: tyce}, tesnenieBm, spojovnik, kolik, poz[]]
type Vec = {
	nazov: string;
	typ: ClipTyp;
	N: number;
	sirka: number;
	vyska: number;
	B10: number;
	C10: number;
	m2: number;
	riadky: [string, string, number, number, number, number][];
	odpis: Record<string, number>;
	tes: number;
	spoj: number;
	kolik: number;
	poz: number[];
};

const R = 'ZASP00116';
const P = 'ZASP00125';
const ZI = 'ZASP00119'; // izo zasklievací
const ZK = 'ZASP202413'; // klasika zasklievací

const VEKTORY: Vec[] = [
	{
		nazov: 'izo B0 (N=1) 3000×1000',
		typ: 'izo',
		N: 1,
		sirka: 3000,
		vyska: 1000,
		B10: 2944,
		C10: 944,
		m2: 3,
		riadky: [
			['hlavný profil – čelo', R, 3000, 2, 2, 1],
			['hlavný profil – výška', R, 952, 2, 7, 1],
			['zasklievací profil – čelo', ZI, 2952, 2, 2, 1],
			['zasklievací profil – výška', ZI, 920, 2, 8, 1]
		],
		odpis: { [R]: 2, [ZI]: 2 },
		tes: 7.776,
		spoj: 4,
		kolik: 4,
		poz: []
	},
	{
		nazov: 'izo B1 (N=2) 3000×1000',
		typ: 'izo',
		N: 2,
		sirka: 3000,
		vyska: 1000,
		B10: 1453.5,
		C10: 944,
		m2: 3,
		riadky: [
			['hlavný profil – čelo', R, 3000, 2, 2, 1],
			['hlavný profil – výška', R, 952, 2, 7, 1],
			['priečka', P, 952, 1, 7, 1],
			['zasklievací profil – čelo', ZI, 1461.5, 4, 5, 1],
			['zasklievací profil – výška', ZI, 920, 4, 8, 1]
		],
		odpis: { [R]: 2, [P]: 1, [ZI]: 2 },
		tes: 9.59,
		spoj: 6,
		kolik: 8,
		poz: [1500]
	},
	{
		nazov: 'izo B2 (N=3) 3000×1000',
		typ: 'izo',
		N: 3,
		sirka: 3000,
		vyska: 1000,
		B10: 956.7,
		C10: 944,
		m2: 3,
		riadky: [
			['hlavný profil – čelo', R, 3000, 2, 2, 1],
			['hlavný profil – výška', R, 952, 2, 7, 1],
			['priečka', P, 952, 2, 7, 1],
			['zasklievací profil – čelo', ZI, 964.7, 6, 7, 1],
			['zasklievací profil – výška', ZI, 920, 6, 8, 1]
		],
		odpis: { [R]: 2, [P]: 1, [ZI]: 2 },
		tes: 11.404,
		spoj: 8,
		kolik: 12,
		poz: [1003, 1997]
	},
	{
		nazov: 'izo B3 (N=4) 3000×1000',
		typ: 'izo',
		N: 4,
		sirka: 3000,
		vyska: 1000,
		B10: 708.3,
		C10: 944,
		m2: 3,
		riadky: [
			['hlavný profil – čelo', R, 3000, 2, 2, 1],
			['hlavný profil – výška', R, 952, 2, 7, 1],
			['priečka', P, 952, 3, 7, 1],
			['zasklievací profil – čelo', ZI, 716.3, 8, 10, 1],
			['zasklievací profil – výška', ZI, 920, 8, 8, 1]
		],
		odpis: { [R]: 2, [P]: 1, [ZI]: 2 },
		tes: 13.218,
		spoj: 10,
		kolik: 16,
		poz: [755.3, 1500.5, 2245.8]
	},
	{
		nazov: 'klasika B0 (N=1) 3000×1000',
		typ: 'klasika',
		N: 1,
		sirka: 3000,
		vyska: 1000,
		B10: 2944,
		C10: 944,
		m2: 3,
		riadky: [
			['hlavný profil – čelo', R, 3000, 2, 2, 1],
			['hlavný profil – výška', R, 952, 2, 7, 1],
			['zasklievací profil – čelo', ZK, 2952, 2, 2, 1],
			['zasklievací profil – výška', ZK, 920, 2, 8, 1]
		],
		odpis: { [R]: 2, [ZK]: 2 },
		tes: 7.776,
		spoj: 4,
		kolik: 4,
		poz: []
	},
	{
		nazov: 'klasika B1 (N=2) 3000×1000',
		typ: 'klasika',
		N: 2,
		sirka: 3000,
		vyska: 1000,
		B10: 1453.5,
		C10: 944,
		m2: 3,
		riadky: [
			['hlavný profil – čelo', R, 3000, 2, 2, 1],
			['hlavný profil – výška', R, 952, 2, 7, 1],
			['priečka', P, 952, 1, 7, 1],
			['zasklievací profil – čelo', ZK, 1461.5, 4, 5, 1],
			['zasklievací profil – výška', ZK, 920, 4, 8, 1]
		],
		odpis: { [R]: 2, [P]: 1, [ZK]: 2 },
		tes: 9.59,
		spoj: 6,
		kolik: 8,
		poz: [1500]
	},
	// hraničný prípad — ROUNDDOWN/ROUNDUP reálne láme (rozmer > 7500/2 → 1 rez/tyč,
	// 2 kusy → 2 tyče; zasklievací výška 1920 → 3 rezy, 4 kusy → 2 tyče)
	{
		nazov: 'izo B1 (N=2) 3800×2000 — hraničné delenie tyče',
		typ: 'izo',
		N: 2,
		sirka: 3800,
		vyska: 2000,
		B10: 1853.5,
		C10: 1944,
		m2: 7.6,
		riadky: [
			['hlavný profil – čelo', R, 3800, 2, 1, 2],
			['hlavný profil – výška', R, 1952, 2, 3, 1],
			['priečka', P, 1952, 1, 3, 1],
			['zasklievací profil – čelo', ZI, 1861.5, 4, 4, 1],
			['zasklievací profil – výška', ZI, 1920, 4, 3, 2]
		],
		odpis: { [R]: 3, [P]: 1, [ZI]: 3 },
		tes: 15.19,
		spoj: 6,
		kolik: 8,
		poz: [1900]
	},
	{
		nazov: 'izo B3 (N=4) 6000×2200 — hraničné delenie tyče',
		typ: 'izo',
		N: 4,
		sirka: 6000,
		vyska: 2200,
		B10: 1458.3,
		C10: 2144,
		m2: 13.2,
		riadky: [
			['hlavný profil – čelo', R, 6000, 2, 1, 2],
			['hlavný profil – výška', R, 2152, 2, 3, 1],
			['priečka', P, 2152, 3, 3, 1],
			['zasklievací profil – čelo', ZI, 1466.3, 8, 5, 2],
			['zasklievací profil – výška', ZI, 2120, 8, 3, 3]
		],
		odpis: { [R]: 3, [P]: 1, [ZI]: 5 },
		tes: 28.818,
		spoj: 10,
		kolik: 16,
		poz: [1505.3, 3000.5, 4495.8]
	}
];

describe('computeClip — 1:1 s Patrikovými šablónami (kontraktné vektory)', () => {
	for (const v of VEKTORY) {
		describe(v.nazov, () => {
			const r = computeClip(vstup({ typ: v.typ, variant: v.N, sirka: v.sirka, vyska: v.vyska }));

			it('vstup je platný (chybaClipVstupu = null)', () => {
				expect(
					chybaClipVstupu(vstup({ typ: v.typ, variant: v.N, sirka: v.sirka, vyska: v.vyska }))
				).toBeNull();
			});

			it('šírka/výška výplne + m²', () => {
				expect(r.sirkaVyplne).toBe(v.B10);
				expect(r.vyskaVyplne).toBe(v.C10);
				expect(r.m2).toBe(v.m2);
				expect(r.pocetVyplni).toBe(v.N);
			});

			it.each(v.riadky)(
				'riadok %s (%s): rozmer=%d ks=%d zaokr=%d tyče=%d',
				(oznacenie, kod, rozmer, ks, zaokr, tyce) => {
					const row = riadok(r, oznacenie as string);
					expect(row.kod).toBe(kod);
					expect(row.rozmer).toBe(rozmer);
					expect(row.pocetKs).toBe(ks);
					expect(row.zaokruhlene).toBe(zaokr);
					expect(row.pocetTyci).toBe(tyce);
				}
			);

			it('Money odpis = súčet tyčí per kód (mj ks)', () => {
				expect(odpisByKod(r)).toEqual(v.odpis);
				expect(r.polozky.every((p) => p.mj === 'ks')).toBe(true);
				// poradie: rám → (priečka) → zasklievací
				expect(r.polozky.map((p) => p.kod)).toEqual(Object.keys(v.odpis));
			});

			it('drobné položky: množstvá známe, kód null, do odpisu NEVSTUPUJÚ', () => {
				const vnut = riadok(r, 'vnútorné tesnenie');
				const vonk = riadok(r, 'vonkajšie tesnenie');
				const spoj = riadok(r, 'spojovník priečky');
				const kolik = riadok(r, 'kolík 6x12');
				expect(vnut.mnozstvo).toBe(v.tes);
				expect(vonk.mnozstvo).toBe(v.tes);
				expect(vnut.mj).toBe('m');
				expect(spoj.mnozstvo).toBe(v.spoj);
				expect(spoj.mj).toBe('ks');
				expect(kolik.mnozstvo).toBe(v.kolik);
				expect(kolik.mj).toBe('ks');
				for (const dr of [vnut, vonk, spoj, kolik]) {
					expect(dr.kod).toBeNull();
					expect(dr.poznamka).toMatch(/neodpisuje sa/);
				}
				// honest-null: Money odpis obsahuje LEN overené profilové kódy (ZASP*),
				// nikdy drobnú položku (runtime check — chytí aj budúci KM12/null leak)
				expect(r.polozky.every((p) => p.kod.startsWith('ZASP'))).toBe(true);
			});

			it('pozície priečok (replikované 1:1 zo šablóny)', () => {
				expect(r.poziciePriecok).toEqual(v.poz);
			});
		});
	}
});

describe('dostupneVarianty — klasika B2/B3 vylúčené (KM12 kódy v Money neexistujú)', () => {
	it('izo → 1..4', () => {
		expect(dostupneVarianty('izo')).toEqual([1, 2, 3, 4]);
	});
	it('klasika → len 1..2', () => {
		expect(dostupneVarianty('klasika')).toEqual([1, 2]);
	});
});

describe('chybaClipVstupu — validácia', () => {
	it('neplatný typ', () => {
		expect(chybaClipVstupu(vstup({ typ: 'xxx' as ClipTyp }))).toMatch(/typ/i);
	});
	it('klasika B2 (N=3) je odmietnutá (mimo whitelistu)', () => {
		expect(chybaClipVstupu(vstup({ typ: 'klasika', variant: 3 }))).toMatch(/B0 a B1/);
	});
	it('klasika B3 (N=4) je odmietnutá', () => {
		expect(chybaClipVstupu(vstup({ typ: 'klasika', variant: 4 }))).toMatch(/B0 a B1/);
	});
	it('izo B2/B3 sú povolené', () => {
		expect(chybaClipVstupu(vstup({ typ: 'izo', variant: 3 }))).toBeNull();
		expect(chybaClipVstupu(vstup({ typ: 'izo', variant: 4 }))).toBeNull();
	});
	it('neceločíselný variant je odmietnutý', () => {
		expect(chybaClipVstupu(vstup({ variant: 2.5 }))).toMatch(/počet výplní/i);
	});
	it('šírka mimo rozsahu', () => {
		expect(chybaClipVstupu(vstup({ sirka: 50 }))).toMatch(/Šírka/);
		expect(chybaClipVstupu(vstup({ sirka: 9000 }))).toMatch(/Šírka/);
	});
	it('výška mimo rozsahu', () => {
		expect(chybaClipVstupu(vstup({ vyska: 50 }))).toMatch(/Výška/);
		expect(chybaClipVstupu(vstup({ vyska: 5000 }))).toMatch(/Výška/);
	});
	it('príliš úzke zábradlie pri veľkom N (šírka výplne < min)', () => {
		// izo N=4, sirka tesne nad min: (300-135)/4-8 = 33.25 < CLIP_MIN_VYPLNE (50)
		const e = chybaClipVstupu(vstup({ typ: 'izo', variant: 4, sirka: 300 }));
		expect(e).toMatch(/šírka jednej výplne/i);
		expect(CLIP_MIN_VYPLNE).toBe(50);
	});
});

describe('invariant — max šírka < dĺžka tyče (ochrana pred 0-tyčí)', () => {
	// ROUNDDOWN(7500/rozmer)=0 (rozmer > 7500) by dal šablónové IFERROR = 0 tyčí =
	// tichý podhodnotený odpis. Najväčší rozmer je šírka (hlavný profil čelo), takže
	// CLIP_MAX_SIRKA musí ostať < CLIP_DLZKA_TYCE aj pri budúcom rozšírení rozsahu.
	it('CLIP_MAX_SIRKA < CLIP_DLZKA_TYCE', () => {
		expect(CLIP_MAX_SIRKA).toBeLessThan(CLIP_DLZKA_TYCE);
	});
});

describe('jeClipTyp — type guard (skriptovaný POST)', () => {
	it('prijme klasika/izo, odmietne iné', () => {
		expect(jeClipTyp('klasika')).toBe(true);
		expect(jeClipTyp('izo')).toBe(true);
		expect(jeClipTyp('KM12')).toBe(false);
		expect(jeClipTyp(null)).toBe(false);
		expect(jeClipTyp(3)).toBe(false);
	});
});
