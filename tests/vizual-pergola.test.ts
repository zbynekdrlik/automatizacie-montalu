// Zákaznícky 3D vizuál pergoly (#276) — unit testy geometrickej vrstvy
// `geo/pergola.ts`. THREE-free (žiadny DOM/canvas), overuje počty dielov/rolí,
// bbox, sklon (rot.x), plochú strechu, RAL logiku, mm-jednotkovú hranicu a
// názov PNG. Rovnaká disciplína ako `tests/vizual-zasklenia.test.ts`.
import { describe, expect, it } from 'vitest';
import { pergolaSpec, pergolaPngNazov, type PergolaVizVstup } from '../src/lib/vizual/geo/pergola';
import {
	defaultPanelSirka,
	vypocitajSklon,
	NOSNIK_HRUBKA_MM,
	STLP_HRUBKA_VIZ_MM
} from '../src/lib/pergola-navrh';
import { farbaKonstrukcie, RAL_FALLBACK_HEX, RAL_INY_KOD, RAL_PALETA } from '../src/lib/vykres/ral';

const zaklad = (over: Partial<PergolaVizVstup> = {}): PergolaVizVstup => ({
	sirkaMm: 4000,
	hlbkaMm: 3500,
	vyskaVpreduMm: 2500,
	vyskaPriSteneMm: 2800,
	pocetPoli: 1,
	panelPocet: 6,
	ralKod: '',
	...over
});

function poRolach(diely: ReturnType<typeof pergolaSpec>['diely']) {
	const out: Record<string, number> = {};
	for (const d of diely) out[d.rola] = (out[d.rola] ?? 0) + 1;
	return out;
}

describe('pergolaSpec — bbox (proporcie nesmú lhať)', () => {
	it('bbox.w===šírka, bbox.h===výška pri stene (SV), bbox.d===hĺbka', () => {
		for (const [s, h, fv, sv] of [
			[4000, 3500, 2500, 2800],
			[6000, 4000, 2200, 3000],
			[2500, 2500, 2000, 2000]
		]) {
			const r = pergolaSpec(
				zaklad({ sirkaMm: s, hlbkaMm: h, vyskaVpreduMm: fv, vyskaPriSteneMm: sv })
			);
			expect(r.bbox.w).toBe(s);
			expect(r.bbox.h).toBe(sv);
			expect(r.bbox.d).toBe(h);
		}
	});
});

describe('pergolaSpec — počty dielov per rola', () => {
	it('pocetPoli=1, panelPocet=6 → 4 stĺpy + 2 nosníky + 7 krokiev = 13 ram, 6 sklo', () => {
		const r = pergolaSpec(zaklad({ pocetPoli: 1, panelPocet: 6 }));
		const poc = poRolach(r.diely);
		expect(poc.ram).toBe(2 * (1 + 1) + 2 + (6 + 1)); // 4 + 2 + 7 = 13
		expect(poc.sklo).toBe(6);
	});

	it('počet stĺpov rastie s pocetPoli (stĺpov v rade = pocetPoli+1, dva rady)', () => {
		for (let pp = 1; pp <= 4; pp++) {
			const r = pergolaSpec(zaklad({ pocetPoli: pp, panelPocet: 3 }));
			const poc = poRolach(r.diely);
			// ram = 2*(pp+1) stĺpy + 2 nosníky + (3+1) krokvy
			expect(poc.ram).toBe(2 * (pp + 1) + 2 + 4);
			expect(poc.sklo).toBe(3);
		}
	});

	it('panelPocet riadi počet sklenených panelov (a krokiev = panelPocet+1)', () => {
		for (const pn of [1, 3, 8]) {
			const r = pergolaSpec(zaklad({ pocetPoli: 1, panelPocet: pn }));
			const poc = poRolach(r.diely);
			expect(poc.sklo).toBe(pn);
			expect(poc.ram).toBe(4 + 2 + (pn + 1));
		}
	});

	it('default panelPocet sa dopočíta zo šírky (~700 mm na panel) keď nie je zadaný', () => {
		const r = pergolaSpec(zaklad({ sirkaMm: 4200, panelPocet: undefined }));
		// round(4200/700) = 6
		expect(poRolach(r.diely).sklo).toBe(6);
	});

	it('žiadna iná rola než ram/sklo (žiadne kolajnica/klucka/sietka/klin)', () => {
		const poc = poRolach(pergolaSpec(zaklad()).diely);
		expect(Object.keys(poc).sort()).toEqual(['ram', 'sklo']);
	});
});

describe('pergolaSpec — stĺpy (predný rad FV, rad pri stene SV)', () => {
	it('predné stĺpy majú výšku FV a z>0, zadné výšku SV a z<0', () => {
		const r = pergolaSpec(
			zaklad({ pocetPoli: 2, panelPocet: 3, vyskaVpreduMm: 2500, vyskaPriSteneMm: 2800 })
		);
		const stlpy = r.diely.filter(
			(d) =>
				d.tvar.kind === 'box' && d.tvar.w === STLP_HRUBKA_VIZ_MM && d.tvar.d === STLP_HRUBKA_VIZ_MM
		);
		expect(stlpy.length).toBe(2 * (2 + 1)); // 6
		const predne = stlpy.filter((d) => d.pos.z > 0);
		const zadne = stlpy.filter((d) => d.pos.z < 0);
		expect(predne.length).toBe(3);
		expect(zadne.length).toBe(3);
		for (const d of predne) if (d.tvar.kind === 'box') expect(d.tvar.h).toBe(2500);
		for (const d of zadne) if (d.tvar.kind === 'box') expect(d.tvar.h).toBe(2800);
	});
});

describe('pergolaSpec — sklon strechy (rot.x na krokvách a skle)', () => {
	it('pultová (SV>FV): krokvy aj sklo majú rot.x === sklon v radiánoch (>0)', () => {
		const r = pergolaSpec(zaklad({ vyskaVpreduMm: 2500, vyskaPriSteneMm: 2800, hlbkaMm: 3500 }));
		const alfa = (vypocitajSklon(2500, 2800, 3500) * Math.PI) / 180;
		expect(alfa).toBeGreaterThan(0);
		const sklonene = r.diely.filter((d) => d.rot);
		// krokvy (panelPocet+1) + sklo (panelPocet) = 7 + 6 = 13
		expect(sklonene.length).toBe(6 + 1 + 6);
		for (const d of sklonene) expect(d.rot!.x).toBeCloseTo(alfa, 9);
	});

	it("rovná strecha ('rovna'): sklon 0, žiadny náklon, bbox.h === FV", () => {
		const r = pergolaSpec(
			zaklad({ typStrechy: 'rovna', vyskaVpreduMm: 2500, vyskaPriSteneMm: 2800 })
		);
		for (const d of r.diely) if (d.rot) expect(d.rot.x).toBe(0);
		expect(r.bbox.h).toBe(2500); // SV zrovnané s FV
	});

	it('vyskaPriStene < vyskaVpredu sa neguje (SV nikdy pod FV) — sklon nezáporný', () => {
		const r = pergolaSpec(zaklad({ vyskaVpreduMm: 2800, vyskaPriSteneMm: 2400 }));
		for (const d of r.diely) if (d.rot) expect(d.rot.x).toBe(0);
		expect(r.bbox.h).toBe(2800);
	});
});

describe('pergolaSpec — strešné sklo (šírka panelu z appkového helperu)', () => {
	it('šírka sklenených panelov === defaultPanelSirka(šírka, panelPocet)', () => {
		const r = pergolaSpec(zaklad({ sirkaMm: 4000, panelPocet: 6 }));
		const ocakSirka = defaultPanelSirka(4000, 6);
		const skla = r.diely.filter((d) => d.rola === 'sklo');
		for (const d of skla) if (d.tvar.kind === 'box') expect(d.tvar.w).toBeCloseTo(ocakSirka, 6);
	});
});

describe('pergolaSpec — RAL (paleta vs. voľný label)', () => {
	for (const vzorka of RAL_PALETA) {
		it(`ralKod=${vzorka.kod} (${vzorka.nazov}) → presný hex, ŽIADNA ilustračná poznámka`, () => {
			expect(farbaKonstrukcie(vzorka.kod).hex).toBe(vzorka.hex);
			const r = pergolaSpec(zaklad({ ralKod: vzorka.kod, ral: `${vzorka.kod} ${vzorka.nazov}` }));
			expect(r.poznamky.some((p) => p.includes('ilustračná'))).toBe(false);
		});
	}

	it('ralKod=RAL_INY_KOD (voľný label) → RAL_FALLBACK_HEX A povinná ilustračná poznámka', () => {
		expect(farbaKonstrukcie(RAL_INY_KOD).hex).toBe(RAL_FALLBACK_HEX);
		const r = pergolaSpec(zaklad({ ralKod: RAL_INY_KOD, ral: 'RAL 7021 matná' }));
		expect(r.poznamky.some((p) => p.includes('ilustračná'))).toBe(true);
		expect(r.poznamky.some((p) => p.includes('RAL 7021 matná'))).toBe(true);
	});

	it('prázdny/neznámy kód (mimo RAL_INY_KOD) nedostane ilustračnú poznámku', () => {
		expect(pergolaSpec(zaklad({ ralKod: '' })).poznamky.some((p) => p.includes('ilustračná'))).toBe(
			false
		);
	});
});

describe('pergolaSpec — jednotková hranica (mm, nie m — prepočet je LEN v builderi)', () => {
	it('žiadny box rozmer (w/h/d) nie je < 1 pre škálu vstupov', () => {
		const r = pergolaSpec(
			zaklad({ sirkaMm: 6000, hlbkaMm: 4000, pocetPoli: 3, panelPocet: 8, vyskaPriSteneMm: 3200 })
		);
		for (const d of r.diely) {
			if (d.tvar.kind === 'box') {
				expect(d.tvar.w).toBeGreaterThanOrEqual(1);
				expect(d.tvar.h).toBeGreaterThanOrEqual(1);
				expect(d.tvar.d).toBeGreaterThanOrEqual(1);
			}
		}
		// nosníky sú po celej šírke, hrúbky z pergola-navrh konštánt (dôkaz reuse)
		const nosniky = r.diely.filter((d) => d.tvar.kind === 'box' && d.tvar.w === 6000);
		expect(nosniky.length).toBe(2);
		for (const d of nosniky) if (d.tvar.kind === 'box') expect(d.tvar.h).toBe(NOSNIK_HRUBKA_MM);
	});

	it('presnost === "vykresova" (presné rozmery zo vstupu)', () => {
		expect(pergolaSpec(zaklad()).presnost).toBe('vykresova');
	});
});

describe('pergolaPngNazov — názov súboru z rozmerov (bez ceny/kódu)', () => {
	it('pergola-{šírka}x{hĺbka}mm.png', () => {
		expect(pergolaPngNazov(zaklad({ sirkaMm: 4000, hlbkaMm: 3500 }))).toBe(
			'pergola-4000x3500mm.png'
		);
	});

	it('nezaokrúhlené vstupy sa zaokrúhlia', () => {
		expect(pergolaPngNazov(zaklad({ sirkaMm: 3999.6, hlbkaMm: 3000.2 }))).toBe(
			'pergola-4000x3000mm.png'
		);
	});
});
