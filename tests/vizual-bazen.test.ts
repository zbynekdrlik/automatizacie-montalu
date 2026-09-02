// #405 — bazénové zastrešenie 3D geometria (`geo/bazen.ts`). Pure funkcia →
// jednotkovo testovateľná bez WebGL/DOM (rovnako ako `vizual-pergola`/`vizual-zasklenia`).
import { describe, expect, it } from 'vitest';
import { bazenSpec, bazenPngNazov, type BazenVizVstup } from '$lib/vizual/geo/bazen';
import { sekcieVysky } from '$lib/bazen-navrh';
import type { DielSpec } from '$lib/vizual/spec';

const ZAKLAD: BazenVizVstup = {
	sirkaMm: 4000,
	dlzkaMm: 6000,
	vyskaMm: 1200,
	segmenty: 4,
	ralKod: '7016'
};

/** max Y (mm) prierezu extrudovaného oblúkového pásu = vrchol oblúka (≈ ry). */
function vrcholY(diel: DielSpec): number {
	if (diel.tvar.kind !== 'extrude') throw new Error('očakávaný extrude tvar');
	return Math.max(...diel.tvar.obrys.map(([, y]) => y));
}
/** max |X| (mm) prierezu = rozpon (≈ rx = šírka/2). */
function rozponX(diel: DielSpec): number {
	if (diel.tvar.kind !== 'extrude') throw new Error('očakávaný extrude tvar');
	return Math.max(...diel.tvar.obrys.map(([x]) => Math.abs(x)));
}

describe('bazenSpec — oblúkové segmenty (#405)', () => {
	it('bbox = šírka × výška × dĺžka, presnosť je ilustračná + ilustračná poznámka', () => {
		const r = bazenSpec(ZAKLAD);
		expect(r.bbox).toEqual({ w: 4000, h: 1200, d: 6000 });
		expect(r.presnost).toBe('ilustracna');
		expect(r.poznamky.some((p) => /ilustračný/i.test(p))).toBe(true);
	});

	it('počet dielov per rola: výplň = segmenty, rebrá = segmenty+1, koľajnice = 2 (jednokoľaj)', () => {
		const r = bazenSpec(ZAKLAD);
		const sklo = r.diely.filter((d) => d.rola === 'sklo');
		const ram = r.diely.filter((d) => d.rola === 'ram');
		const kolaj = r.diely.filter((d) => d.rola === 'kolajnica');
		expect(sklo).toHaveLength(4);
		expect(ram).toHaveLength(5);
		expect(kolaj).toHaveLength(2);
		// výplň + rebrá sú extrudované oblúky, koľajnica je box
		for (const d of [...sklo, ...ram]) expect(d.tvar.kind).toBe('extrude');
		for (const d of kolaj) expect(d.tvar.kind).toBe('box');
	});

	it('dvojkoľaj → 4 koľajnice (2 na stranu), jednokoľaj → 2', () => {
		expect(
			bazenSpec({ ...ZAKLAD, dvojkolaj: true }).diely.filter((d) => d.rola === 'kolajnica')
		).toHaveLength(4);
		expect(
			bazenSpec({ ...ZAKLAD, dvojkolaj: false }).diely.filter((d) => d.rola === 'kolajnica')
		).toHaveLength(2);
	});

	it('teleskopická kaskáda: výšky segmentov klesajú a KROKY sedia so `sekcieVysky` (reuse appkového helpera)', () => {
		const r = bazenSpec(ZAKLAD);
		const vysky = r.diely.filter((d) => d.rola === 'sklo').map(vrcholY);
		// prvý (najvyšší) segment je tesne pod zadanou výškou (radiálne odsadenie výplne do profilu)
		expect(vysky[0]!).toBeLessThan(1200);
		expect(vysky[0]!).toBeGreaterThan(1100);
		// striktne klesajúce
		for (let i = 1; i < vysky.length; i++) expect(vysky[i]!).toBeLessThan(vysky[i - 1]!);
		// KROKY kaskády sedia s appkovým `sekcieVysky` (odsadenie výplne je konštanta →
		// rozdiely medzi segmentmi sú invariantné). Krok = clamp(1200*0.06,60,150)=72 → min 984.
		const ocakavane = sekcieVysky(4, 1200, 984);
		for (let i = 1; i < vysky.length; i++) {
			expect(vysky[i - 1]! - vysky[i]!).toBeCloseTo(ocakavane[i - 1]! - ocakavane[i]!, 0);
		}
	});

	it('rebrá rozpäté cez celú šírku (rozpon = šírka/2); KAŽDÁ výplň je radiálne VNÚTRI svojho rebra (🟡 review — sklo sa nekreslí NA rebro)', () => {
		const r = bazenSpec(ZAKLAD);
		const sklo = r.diely.filter((d) => d.rola === 'sklo'); // segment i
		const ram = r.diely.filter((d) => d.rola === 'ram'); // hranica j (výška = koplanárne rebro)
		// rebrá = štrukturálny oblúk cez celú šírku
		for (const d of ram) expect(rozponX(d)).toBeCloseTo(2000, 0);
		// výplň segmentu i je radiálne (rozpon AJ vrchol) VNÚTRI koplanárneho rebra ram[i+1]
		// (rovnaká výška vysky[i]) → menšia elipsa je celá vnútri väčšej ⇒ žiadny koplanárny povrch.
		for (let i = 0; i < sklo.length; i++) {
			expect(rozponX(sklo[i]!)).toBeLessThan(rozponX(ram[i + 1]!));
			expect(vrcholY(sklo[i]!)).toBeLessThan(vrcholY(ram[i + 1]!));
		}
	});

	it('výplne aj rebrá majú bázu na y=0 (pos.y=0) a sú centrované na šírku (pos.x=0)', () => {
		const r = bazenSpec(ZAKLAD);
		for (const d of r.diely.filter((d) => d.rola === 'sklo' || d.rola === 'ram')) {
			expect(d.pos.x).toBe(0);
			expect(d.pos.y).toBe(0);
			// obrys nemá zápornú Y (oblúk stojí na zemi)
			if (d.tvar.kind === 'extrude') {
				expect(Math.min(...d.tvar.obrys.map(([, y]) => y))).toBeGreaterThanOrEqual(0);
			}
		}
	});

	it('koľajnice bežia po celej dĺžke pri oboch dlhých stranách', () => {
		const r = bazenSpec(ZAKLAD);
		const kolaj = r.diely.filter((d) => d.rola === 'kolajnica');
		for (const d of kolaj) {
			if (d.tvar.kind !== 'box') throw new Error('koľajnica musí byť box');
			expect(d.tvar.d).toBe(6000); // celá dĺžka
			expect(d.pos.z).toBe(0); // centrovaná
		}
		// jedna vľavo (x<0), jedna vpravo (x>0)
		expect(kolaj.some((d) => d.pos.x < 0)).toBe(true);
		expect(kolaj.some((d) => d.pos.x > 0)).toBe(true);
	});

	it('segmenty sa orežú na rozsah 2..8 (min aj max)', () => {
		expect(
			bazenSpec({ ...ZAKLAD, segmenty: 1 }).diely.filter((d) => d.rola === 'sklo')
		).toHaveLength(2);
		expect(
			bazenSpec({ ...ZAKLAD, segmenty: 50 }).diely.filter((d) => d.rola === 'sklo')
		).toHaveLength(8);
	});

	it('viac segmentov = viac výplní; každý oblúkový pás je uzavretý (2×(body+1) bodov)', () => {
		const r = bazenSpec({ ...ZAKLAD, segmenty: 8 });
		const sklo = r.diely.filter((d) => d.rola === 'sklo');
		expect(sklo).toHaveLength(8);
		// oblúkový pás = vonkajšia + vnútorná semi-elipsa → 2×(OBLUK_BODY+1) bodov
		for (const d of sklo) {
			if (d.tvar.kind !== 'extrude') throw new Error('extrude');
			expect(d.tvar.obrys.length).toBeGreaterThanOrEqual(2 * (22 + 1));
		}
	});

	it('bazenPngNazov = rozmery bez ceny/kódu', () => {
		expect(bazenPngNazov(ZAKLAD)).toBe('bazen-zastresenie-6000x4000mm.png');
	});
});
