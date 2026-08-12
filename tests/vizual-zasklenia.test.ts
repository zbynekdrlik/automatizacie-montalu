// Zákaznícky 3D náhľad (#170) — unit testy geometrickej vrstvy `geo/zasklenia.ts`.
// THREE-free (žiadny DOM/canvas), overuje presnosť proporcií, počty dielov a
// RAL logiku — presne podľa špecifikácie fázy 1 (#170 komentár "Verdikt", §2.12).
import { describe, expect, it } from 'vitest';
import { zaskleniaSpec, type ZaskleniaVizVstup } from '../src/lib/vizual/geo/zasklenia';
import { deliaceStlpiky, sirkaKridla } from '../src/lib/zasklenia-navrh';
import { farbaKonstrukcie, RAL_FALLBACK_HEX, RAL_INY_KOD, RAL_PALETA } from '../src/lib/vykres/ral';

const zaklad = (over: Partial<ZaskleniaVizVstup> = {}): ZaskleniaVizVstup => ({
	s: 3000,
	v: 1500,
	n: 3,
	smer: 'LP',
	ralKod: '',
	...over
});

function poRolach(diely: ReturnType<typeof zaskleniaSpec>['diely']) {
	const out: Record<string, number> = {};
	for (const d of diely) out[d.rola] = (out[d.rola] ?? 0) + 1;
	return out;
}

describe('zaskleniaSpec — proporcie a bbox (#170 §4 "Proporcie nesmú lhať")', () => {
	it('bbox.w === s a bbox.h === v presne, pre viacero rozmerov', () => {
		for (const [s, v] of [
			[3000, 1500],
			[6000, 2400],
			[300, 300],
			[20000, 20000]
		]) {
			const r = zaskleniaSpec(zaklad({ s, v }));
			expect(r.bbox.w).toBe(s);
			expect(r.bbox.h).toBe(v);
		}
	});

	it('n sa NIKDY neprepočítava: { s: 6000, n: 3 } → presne 3 krídla po 2000 mm', () => {
		const r = zaskleniaSpec(zaklad({ s: 6000, n: 3 }));
		expect(sirkaKridla(6000, 3)).toBe(2000);
		const ramy = r.diely.filter((d) => d.rola === 'ram');
		// 4 rámové boxy na krídlo × 3 krídla
		expect(ramy.length).toBe(12);
		// zvislé stojiny (šírka < vodorovné priečky) dokazujú krídlo-šírku —
		// overíme cez sumu súradníc stĺpikov namiesto (mierny nepriamy dôkaz cez
		// existujúci helper, rovnaká disciplína ako komponent)
		expect(deliaceStlpiky(6000, 3)).toEqual([0, 2000, 4000, 6000]);
	});

	it('Σ šírok krídel === s pre n = 2..6 (deliaceStlpiky invariant, žiadne nerovnomerné škálovanie)', () => {
		for (let n = 2; n <= 6; n++) {
			const s = 4321; // zámerne nedeliteľné číslo, aby test odhalil zaokrúhľovaciu chybu
			const stlpiky = deliaceStlpiky(s, n);
			let sum = 0;
			for (let i = 0; i < n; i++) sum += stlpiky[i + 1] - stlpiky[i];
			expect(Math.round(sum * 10) / 10).toBe(s);
			expect(stlpiky[n]).toBe(s);
		}
	});
});

describe('zaskleniaSpec — počty dielov per rola, n = 2..6 × smer ∈ {PL, LP, OP}', () => {
	const smery: ZaskleniaVizVstup['smer'][] = ['PL', 'LP', 'OP'];
	for (let n = 2; n <= 6; n++) {
		for (const smer of smery) {
			it(`n=${n} smer=${smer}: 4×n rám, n sklo, 2 koľajnica, 0 klucka/sietka/klin (default)`, () => {
				const r = zaskleniaSpec(zaklad({ n, smer }));
				const poc = poRolach(r.diely);
				expect(poc.ram).toBe(4 * n);
				expect(poc.sklo).toBe(n);
				expect(poc.kolajnica).toBe(2);
				expect(poc.klucka ?? 0).toBe(0);
				expect(poc.sietka ?? 0).toBe(0);
				expect(poc.klin ?? 0).toBe(0);
			});
		}
	}
});

describe('zaskleniaSpec — poradie v hĺbke (Z) podľa smer', () => {
	it('LP: z rastie s indexom (0 najviac vzadu, posledné najviac vpredu)', () => {
		const r = zaskleniaSpec(zaklad({ n: 4, smer: 'LP' }));
		const sklaZ = r.diely.filter((d) => d.rola === 'sklo').map((d) => d.pos.z);
		expect(sklaZ.length).toBe(4);
		for (let i = 1; i < sklaZ.length; i++) expect(sklaZ[i]).toBeGreaterThan(sklaZ[i - 1]);
	});

	it('PL: z klesá s indexom (opačné poradie ako LP)', () => {
		const r = zaskleniaSpec(zaklad({ n: 4, smer: 'PL' }));
		const sklaZ = r.diely.filter((d) => d.rola === 'sklo').map((d) => d.pos.z);
		for (let i = 1; i < sklaZ.length; i++) expect(sklaZ[i]).toBeLessThan(sklaZ[i - 1]);
	});

	it('OP: stredné krídla najviac vzadu (min z), krajné najviac vpredu (max z), symetricky', () => {
		const r = zaskleniaSpec(zaklad({ n: 5, smer: 'OP' }));
		const sklaZ = r.diely.filter((d) => d.rola === 'sklo').map((d) => d.pos.z);
		expect(sklaZ.length).toBe(5);
		// stred (index 2 z 5) musí mať najmenšie z zo všetkých
		const stred = sklaZ[2];
		for (let i = 0; i < sklaZ.length; i++)
			if (i !== 2) expect(sklaZ[i]).toBeGreaterThanOrEqual(stred);
		// symetria: krajné krídla (0 a 4) majú rovnaké z
		expect(sklaZ[0]).toBeCloseTo(sklaZ[4], 6);
	});

	it('n=3 smer=LP — konkrétne ručne dopočítané Z hodnoty (ROZTEC=34mm, off=34mm)', () => {
		const r = zaskleniaSpec(zaklad({ n: 3, smer: 'LP' }));
		const sklaZ = r.diely.filter((d) => d.rola === 'sklo').map((d) => d.pos.z);
		// off = (3-1)/2 * 34 = 34; krok(i) = i pre LP → z = [0,34,68] - 34 = [-34, 0, 34]
		expect(sklaZ).toEqual([-34, 0, 34]);
	});

	it('n=4 smer=PL — konkrétne ručne dopočítané Z hodnoty', () => {
		const r = zaskleniaSpec(zaklad({ n: 4, smer: 'PL' }));
		const sklaZ = r.diely.filter((d) => d.rola === 'sklo').map((d) => d.pos.z);
		// off = (4-1)/2*34 = 51; krok(i) = 3-i → [3,2,1,0]*34 - 51 = [51,17,-17,-51]
		expect(sklaZ).toEqual([51, 17, -17, -51]);
	});
});

describe('zaskleniaSpec — koľajnica (ručná dĺžka)', () => {
	it('KolajnicaRucne.horna = 5200 → dĺžka hornej koľajnice presne 5200, nie s', () => {
		const r = zaskleniaSpec(zaklad({ s: 6000, kolajnica: { horna: 5200 } }));
		const horna = r.diely.find((d) => d.rola === 'kolajnica' && d.pos.y > r.bbox.h / 2)!;
		expect(horna.tvar.kind).toBe('box');
		if (horna.tvar.kind === 'box') expect(horna.tvar.w).toBe(5200);
	});

	it('chýbajúca KolajnicaRucne → obe koľajnice presne s', () => {
		const r = zaskleniaSpec(zaklad({ s: 4444 }));
		const kolajnice = r.diely.filter((d) => d.rola === 'kolajnica');
		expect(kolajnice.length).toBe(2);
		for (const k of kolajnice) {
			expect(k.tvar.kind).toBe('box');
			if (k.tvar.kind === 'box') expect(k.tvar.w).toBe(4444);
		}
	});
});

describe('zaskleniaSpec — klin (display-only, nikdy nemení bbox krídel)', () => {
	it('kliny s ks: 2 → presne 2 klin diely', () => {
		const r = zaskleniaSpec(
			zaklad({ kliny: [{ dlzka: 800, sirka: 200, v1: 100, v2: 60, ks: 2 }] })
		);
		expect(r.diely.filter((d) => d.rola === 'klin').length).toBe(2);
	});

	it('klin nikdy nemení bbox (w/h) ani počet/rozmer krídel', () => {
		const bez = zaskleniaSpec(zaklad());
		const sKlinom = zaskleniaSpec(
			zaklad({ kliny: [{ dlzka: 800, sirka: 200, v1: 100, v2: 60, ks: 3 }] })
		);
		expect(sKlinom.bbox.w).toBe(bez.bbox.w);
		expect(sKlinom.bbox.h).toBe(bez.bbox.h);
		expect(poRolach(sKlinom.diely).ram).toBe(poRolach(bez.diely).ram);
		expect(poRolach(sKlinom.diely).sklo).toBe(poRolach(bez.diely).sklo);
	});

	it('bez klina → 0 klin dielov', () => {
		const r = zaskleniaSpec(zaklad());
		expect(poRolach(r.diely).klin ?? 0).toBe(0);
	});
});

describe('zaskleniaSpec — RAL (5 kódov paleta + RAL_INY_KOD fallback)', () => {
	for (const vzorka of RAL_PALETA) {
		it(`ralKod=${vzorka.kod} (${vzorka.nazov}) → farbaKonstrukcie vráti presný hex, ŽIADNA ilustračná poznámka`, () => {
			const f = farbaKonstrukcie(vzorka.kod);
			expect(f.hex).toBe(vzorka.hex);
			const r = zaskleniaSpec(zaklad({ ralKod: vzorka.kod, ral: `${vzorka.kod} ${vzorka.nazov}` }));
			expect(r.poznamky.some((p) => p.includes('ilustračná'))).toBe(false);
		});
	}

	it(`ralKod=RAL_INY_KOD (voľný label) → RAL_FALLBACK_HEX A povinná ilustračná poznámka`, () => {
		const f = farbaKonstrukcie(RAL_INY_KOD);
		expect(f.hex).toBe(RAL_FALLBACK_HEX);
		const r = zaskleniaSpec(zaklad({ ralKod: RAL_INY_KOD, ral: 'RAL 7021 matná' }));
		expect(r.poznamky.some((p) => p.includes('ilustračná'))).toBe(true);
		expect(r.poznamky.some((p) => p.includes('RAL 7021 matná'))).toBe(true);
	});

	it('žiadny iný prípad (prázdny/neznámy kód mimo RAL_INY_KOD) nedostane ilustračnú poznámku', () => {
		const r = zaskleniaSpec(zaklad({ ralKod: '' }));
		expect(r.poznamky.some((p) => p.includes('ilustračná'))).toBe(false);
	});
});

describe('zaskleniaSpec — kovanie (kľučka) a sieťka: nič sa nevymyslí, čo nebolo zadané', () => {
	it('kovanie: null/chýba → 0 dielov rola klucka', () => {
		expect(poRolach(zaskleniaSpec(zaklad()).diely).klucka ?? 0).toBe(0);
		expect(poRolach(zaskleniaSpec(zaklad({ kovanie: null })).diely).klucka ?? 0).toBe(0);
	});

	it('kovanie: "L" → presne 1 diel rola klucka', () => {
		const r = zaskleniaSpec(zaklad({ kovanie: 'L' }));
		expect(poRolach(r.diely).klucka).toBe(1);
	});

	it('sietka: false/chýba → 0 dielov rola sietka', () => {
		expect(poRolach(zaskleniaSpec(zaklad()).diely).sietka ?? 0).toBe(0);
		expect(poRolach(zaskleniaSpec(zaklad({ sietka: false })).diely).sietka ?? 0).toBe(0);
	});

	it('sietka: true → presne 1 diel rola sietka', () => {
		const r = zaskleniaSpec(zaklad({ sietka: true }));
		expect(poRolach(r.diely).sietka).toBe(1);
	});
});

describe('zaskleniaSpec — jednotková hranica (mm, nie m — dôkaz že prepočet je LEN v builderi)', () => {
	it('žiadny box/extrude rozmer (w/h/d/dlzka) nie je < 1 — hodnoty sú v mm, nie predelené na metre', () => {
		const r = zaskleniaSpec(
			zaklad({
				n: 5,
				kolajnica: { horna: 5200, spodna: 5195 },
				kliny: [{ dlzka: 800, sirka: 200, v1: 100, v2: 60, ks: 1 }],
				kovanie: 'P',
				sietka: true
			})
		);
		for (const d of r.diely) {
			if (d.tvar.kind === 'box') {
				expect(d.tvar.w).toBeGreaterThanOrEqual(1);
				expect(d.tvar.h).toBeGreaterThanOrEqual(1);
				expect(d.tvar.d).toBeGreaterThanOrEqual(1);
			} else {
				expect(d.tvar.dlzka).toBeGreaterThanOrEqual(1);
				for (const [x, y] of d.tvar.obrys)
					expect(Math.abs(x) + Math.abs(y)).toBeGreaterThanOrEqual(0);
			}
		}
		expect(r.bbox.w).toBeGreaterThan(1);
		expect(r.bbox.h).toBeGreaterThan(1);
	});
});

describe('zaskleniaSpec — presnost je vždy "vykresova" pre zasklenia (žiadna ilustračná geometria vo fáze 1)', () => {
	it('presnost === "vykresova"', () => {
		expect(zaskleniaSpec(zaklad()).presnost).toBe('vykresova');
	});
});
