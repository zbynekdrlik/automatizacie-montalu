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
	CLIP_MIN_SIRKA,
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
	// Patrik (3.9.2026, msg 1789480, issue #372): B2/B3 klasika používa TIE ISTÉ ZASP
	// kódy ako B0/B1 (KM12* zo šablóny sa nepoužijú) — vektory zrkadlia izo B2/B3
	// vyššie (formula je zdieľaná, líši sa len zasklievací kód ZK namiesto ZI).
	{
		nazov: 'klasika B2 (N=3) 3000×1000',
		typ: 'klasika',
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
			['zasklievací profil – čelo', ZK, 964.7, 6, 7, 1],
			['zasklievací profil – výška', ZK, 920, 6, 8, 1]
		],
		odpis: { [R]: 2, [P]: 1, [ZK]: 2 },
		tes: 11.404,
		spoj: 8,
		kolik: 12,
		poz: [1003, 1997]
	},
	{
		nazov: 'klasika B3 (N=4) 3000×1000',
		typ: 'klasika',
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
			['zasklievací profil – čelo', ZK, 716.3, 8, 10, 1],
			['zasklievací profil – výška', ZK, 920, 8, 8, 1]
		],
		odpis: { [R]: 2, [P]: 1, [ZK]: 2 },
		tes: 13.218,
		spoj: 10,
		kolik: 16,
		poz: [755.3, 1500.5, 2245.8]
	},
	// T16 pasca (issue #372, Patrik: „Bude chyba") — šablóna mala v klasika B2/B3
	// T16 (počet ks vstupujúci do delenia priečkovej tyče) NAPEVNO =1 namiesto
	// správneho =F16 (počet priečok = N-1, ako v IZO). Tento vstup má priečkový
	// rozmer, kde sa BROKEN (T16=1 → ROUNDUP(1/2)=1 tyč) a SPRÁVNE (T16=N-1=3 →
	// ROUNDUP(3/2)=2 tyče) správanie reálne rozchádzajú — pin proti znovu-zavedeniu
	// hardcodovaného T16=1.
	{
		nazov: 'klasika B3 (N=4) 3000×2600 — T16 pasca (priečka delenie = N-1, nie napevno 1)',
		typ: 'klasika',
		N: 4,
		sirka: 3000,
		vyska: 2600,
		B10: 708.3,
		C10: 2544,
		m2: 7.8,
		riadky: [
			['hlavný profil – čelo', R, 3000, 2, 2, 1],
			['hlavný profil – výška', R, 2552, 2, 2, 1],
			['priečka', P, 2552, 3, 2, 2],
			['zasklievací profil – čelo', ZK, 716.3, 8, 10, 1],
			['zasklievací profil – výška', ZK, 2520, 8, 2, 4]
		],
		odpis: { [R]: 2, [P]: 2, [ZK]: 5 },
		tes: 26.018,
		spoj: 10,
		kolik: 16,
		poz: [755.3, 1500.5, 2245.8]
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

describe('dostupneVarianty — izo aj klasika → 1..4 (Patrik #372: B2/B3 klasika = rovnaké ZASP kódy)', () => {
	it('izo → 1..4', () => {
		expect(dostupneVarianty('izo')).toEqual([1, 2, 3, 4]);
	});
	it('klasika → 1..4 (KM12 kódy zo šablóny sa nepoužívajú, platia ZASP)', () => {
		expect(dostupneVarianty('klasika')).toEqual([1, 2, 3, 4]);
	});
});

describe('chybaClipVstupu — validácia', () => {
	it('neplatný typ', () => {
		expect(chybaClipVstupu(vstup({ typ: 'xxx' as ClipTyp }))).toMatch(/typ/i);
	});
	it('neplatný počet výplní je odmietnutý (mimo whitelistu)', () => {
		expect(chybaClipVstupu(vstup({ typ: 'klasika', variant: 5 }))).toMatch(/počet výplní/i);
		expect(chybaClipVstupu(vstup({ typ: 'izo', variant: 0 }))).toMatch(/počet výplní/i);
	});
	it('izo aj klasika B2/B3 sú povolené', () => {
		expect(chybaClipVstupu(vstup({ typ: 'izo', variant: 3 }))).toBeNull();
		expect(chybaClipVstupu(vstup({ typ: 'izo', variant: 4 }))).toBeNull();
		expect(chybaClipVstupu(vstup({ typ: 'klasika', variant: 3 }))).toBeNull();
		expect(chybaClipVstupu(vstup({ typ: 'klasika', variant: 4 }))).toBeNull();
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
		// izo N=4, sirka=200: (200-135)/4-8 = 8.25 < CLIP_MIN_VYPLNE (20)
		const e = chybaClipVstupu(vstup({ typ: 'izo', variant: 4, sirka: 200 }));
		expect(e).toMatch(/šírka jednej výplne/i);
	});
});

describe('(#467) CLIP B0 (N=1) min šírka 80 mm — Patrik 5.9.', () => {
	it('CLIP_MIN_SIRKA je 80 (nie 200)', () => {
		expect(CLIP_MIN_SIRKA).toBe(80);
	});

	it('CLIP_MIN_VYPLNE je 20 (nie 50)', () => {
		expect(CLIP_MIN_VYPLNE).toBe(20);
	});

	it('B0 (N=1) sirka=80 mm prechádza validáciou', () => {
		expect(chybaClipVstupu(vstup({ typ: 'izo', variant: 1, sirka: 80 }))).toBeNull();
		expect(chybaClipVstupu(vstup({ typ: 'klasika', variant: 1, sirka: 80 }))).toBeNull();
	});

	it('B0 (N=1) sirka=80 mm — compute dáva kladné rozmery', () => {
		const r = computeClip(vstup({ typ: 'izo', variant: 1, sirka: 80, vyska: 500 }));
		// B10 = (80 - 48) / 1 - 8 = 24 mm
		expect(r.sirkaVyplne).toBe(24);
		expect(r.vyskaVyplne).toBe(444);
		// všetky rozmerové riadky kladné
		for (const row of r.riadky) {
			if (row.rozmer !== null) expect(row.rozmer).toBeGreaterThan(0);
		}
		// odpis dáva nenulové tyče
		expect(r.polozky.length).toBeGreaterThan(0);
		for (const p of r.polozky) {
			expect(p.qty).toBeGreaterThan(0);
		}
	});

	it('B1 (N=2) sirka=80 mm je ODMIETNUTÉ (záporná šírka výplne)', () => {
		const e = chybaClipVstupu(vstup({ typ: 'izo', variant: 2, sirka: 80 }));
		expect(e).toMatch(/šírka jednej výplne/i);
	});

	it('N=2 prechádza od sirka=133+ (výplň=20 mm = MIN_VYPLNE)', () => {
		// (133 - 77) / 2 - 8 = 28 - 8 = 20 mm >= CLIP_MIN_VYPLNE(20)
		expect(chybaClipVstupu(vstup({ typ: 'izo', variant: 2, sirka: 133 }))).toBeNull();
		// 132 → (132-77)/2 - 8 = 27.5 - 8 = 19.5 < 20 → odmietne
		expect(chybaClipVstupu(vstup({ typ: 'izo', variant: 2, sirka: 132 }))).toMatch(
			/šírka jednej výplne/i
		);
	});

	it('B0 (N=1) sirka=100..199 mm prechádza (predtým blokované plošným min 200)', () => {
		for (const s of [100, 150, 199]) {
			expect(chybaClipVstupu(vstup({ typ: 'izo', variant: 1, sirka: s }))).toBeNull();
		}
	});

	it('sirka pod 80 je stále odmietnutá', () => {
		expect(chybaClipVstupu(vstup({ typ: 'izo', variant: 1, sirka: 79 }))).toMatch(/Šírka/);
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
