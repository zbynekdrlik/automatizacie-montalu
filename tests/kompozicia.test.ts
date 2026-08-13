// Zdieľaná kompozičná logika technických hárkov (#168) — mierka + centrovanie.
import { describe, it, expect } from 'vitest';
import {
	fitCentered,
	centerAt,
	sharedFitScale,
	DEFAULT_TARGET_FILL,
	MIN_TITLE_FONT,
	MIN_SUBTITLE_FONT,
	MIN_DIM_FONT,
	MIN_SPEC_FONT,
	type AreaBox
} from '../src/lib/vykres/kompozicia';

const AREA: AreaBox = { x: 10, y: 20, w: 200, h: 100 };

describe('centerAt', () => {
	it('vycentruje obsah v oblasti pri danej mierke — rovnaké okraje na oboch stranách', () => {
		const fit = centerAt(50, 20, AREA, 2); // contentW=100, contentH=40
		expect(fit.contentW).toBe(100);
		expect(fit.contentH).toBe(40);
		// vodorovné okraje: (200-100)/2 = 50 na oboch stranách
		expect(fit.x0 - AREA.x).toBeCloseTo(50, 6);
		expect(AREA.x + AREA.w - fit.x1).toBeCloseTo(50, 6);
		// zvislé okraje: (100-40)/2 = 30 na oboch stranách
		expect(fit.y0 - AREA.y).toBeCloseTo(30, 6);
		expect(AREA.y + AREA.h - fit.y1).toBeCloseTo(30, 6);
	});

	it('mierka sa len prevezme, nepočíta — 0 dá nulový obsah, nie chybu', () => {
		const fit = centerAt(100, 100, AREA, 0);
		expect(fit.scale).toBe(0);
		expect(fit.contentW).toBe(0);
		expect(fit.contentH).toBe(0);
		// stred oblasti (nulový obsah vycentrovaný na bod)
		expect(fit.x0).toBeCloseTo(AREA.x + AREA.w / 2, 6);
		expect(fit.y0).toBeCloseTo(AREA.y + AREA.h / 2, 6);
	});
});

describe('fitCentered', () => {
	it('limitujúci rozmer (šírka) zaberie PRESNE targetFill dostupnej plochy', () => {
		// obsah 4200×2100 (pomer 2:1) do oblasti 200×100 (pomer 2:1, ZHODNÝ) —
		// oba rozmery sú rovnako limitujúce, obsah zaberie targetFill v OBOCH.
		const fit = fitCentered(4200, 2100, AREA, 0.7);
		expect(fit.contentW / AREA.w).toBeCloseTo(0.7, 6);
		expect(fit.contentH / AREA.h).toBeCloseTo(0.7, 6);
	});

	it('nesediaci pomer strán — limitujúci rozmer PRESNE targetFill, druhý MENEJ (nikdy viac)', () => {
		// obsah 4200×2100 (pomer strán 2:1, ŠIROKÝ) do VYSOKEJ oblasti (200×300,
		// pomer 0,66:1) — obsah je pomerovo ŠIRŠÍ než oblasť, takže limituje
		// ŠÍRKA; výška musí vyjsť MENEJ než targetFill (presne prípad #168
		// nálezu 1 — width-limited scale v pomerovo "vysokej" oblasti).
		const vysokaOblast: AreaBox = { x: 0, y: 0, w: 200, h: 300 };
		const fit = fitCentered(4200, 2100, vysokaOblast, 0.7);
		expect(fit.contentW / vysokaOblast.w).toBeCloseTo(0.7, 6);
		expect(fit.contentH / vysokaOblast.h).toBeLessThan(0.7);
	});

	it('vycentrované — HORNÝ aj DOLNÝ okraj sú rovnaké (#168 — opravuje "horná tretina prázdna")', () => {
		// presne ten prípad z nálezu #1: široký/nízky obsah (2:1) vo vysokej
		// oblasti — predtým fixný baseY nechal celý ušetrený priestor HORE.
		const vysokaOblast: AreaBox = { x: 0, y: 0, w: 200, h: 300 };
		const fit = fitCentered(4200, 2100, vysokaOblast, 0.7);
		const hornyOkraj = fit.y0 - vysokaOblast.y;
		const dolnyOkraj = vysokaOblast.y + vysokaOblast.h - fit.y1;
		expect(hornyOkraj).toBeCloseTo(dolnyOkraj, 6);
		expect(hornyOkraj).toBeGreaterThan(0);
	});

	it('default targetFill je v pásme 60-75 % (#168 zadanie)', () => {
		expect(DEFAULT_TARGET_FILL).toBeGreaterThanOrEqual(0.6);
		expect(DEFAULT_TARGET_FILL).toBeLessThanOrEqual(0.75);
	});

	it('neplatný vstup (fitScale fallback=1) sa prejaví, nikdy nespadne', () => {
		const fit = fitCentered(0, 100, AREA);
		expect(fit.scale).toBe(1);
	});
});

describe('sharedFitScale', () => {
	it('vráti najMENŠIU mierku spomedzi viacerých položiek', () => {
		const bok: AreaBox = { x: 0, y: 0, w: 200, h: 60 };
		const pod: AreaBox = { x: 0, y: 70, w: 200, h: 60 };
		const scale = sharedFitScale([
			{ mmW: 8570, mmH: 750, area: bok },
			{ mmW: 8570, mmH: 4250, area: pod } // oveľa vyšší obsah pri rovnakej oblasti → limituje TOTO
		]);
		// mierka musí zmestiť OBE položky do ich targetFill — over priamym prepočtom
		const scaleBok = (bok.w * DEFAULT_TARGET_FILL) / 8570;
		const scalePod = (pod.h * DEFAULT_TARGET_FILL) / 4250;
		expect(scale).toBeCloseTo(Math.min(scaleBok, scalePod), 6);
	});

	it('jedna položka sa správa rovnako ako fitCentered/fitScale', () => {
		const area: AreaBox = { x: 0, y: 0, w: 200, h: 100 };
		const scale = sharedFitScale([{ mmW: 4200, mmH: 2100, area }]);
		const fit = fitCentered(4200, 2100, area);
		expect(scale).toBeCloseTo(fit.scale, 6);
	});

	it('prázdny zoznam → 1 (obranný fallback, rovnaká disciplína ako fitScale)', () => {
		expect(sharedFitScale([])).toBe(1);
	});
});

describe('MIN_* font konštanty (#168 bod 2 — spoločná podlaha čitateľnosti)', () => {
	it('nadpis hárku je väčší než podnadpis, ktorý je aspoň na úrovni kót/spec textu', () => {
		expect(MIN_TITLE_FONT).toBeGreaterThan(MIN_SUBTITLE_FONT);
		expect(MIN_SUBTITLE_FONT).toBeGreaterThanOrEqual(MIN_DIM_FONT);
		expect(MIN_DIM_FONT).toBe(MIN_SPEC_FONT);
	});

	it('hlavný nadpis je VÄČŠÍ než pečiatkový tb-nazov (4mm) — jediné miesto s menom zákazky na hárku bez pečiatky', () => {
		expect(MIN_TITLE_FONT).toBeGreaterThan(4);
	});

	it('všetky floors sú kladné, rozumné SVG mm hodnoty (nie omylom 0 alebo záporné)', () => {
		for (const v of [MIN_TITLE_FONT, MIN_SUBTITLE_FONT, MIN_DIM_FONT, MIN_SPEC_FONT]) {
			expect(v).toBeGreaterThan(0);
			expect(v).toBeLessThan(20);
		}
	});
});
