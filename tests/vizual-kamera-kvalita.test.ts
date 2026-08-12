// Zákaznícky 3D náhľad (#170) — unit testy `kamera.ts` (auto-fit/presety/clamp)
// a `kvalita.ts` (mobilný fallback rebrík, §2.9). Obe pure-logic, bez THREE/DOM.
import { describe, expect, it } from 'vitest';
import {
	autoFitVzdialenost,
	fitCiel,
	FOV_DEG,
	orbitLimity,
	poziciaKamery,
	PRESET_DEFAULT,
	PRESETY,
	vzdialenostPrePreset
} from '../src/lib/vizual/kamera';
import { detekujTier, nastaveniaPreTier } from '../src/lib/vizual/kvalita';

describe('kamera — autoFitVzdialenost', () => {
	it('väčší bbox → väčšia vzdialenosť (monotónnosť)', () => {
		const maly = autoFitVzdialenost({ w: 1000, h: 1000, d: 100 }, 16 / 9);
		const velky = autoFitVzdialenost({ w: 5000, h: 3000, d: 300 }, 16 / 9);
		expect(velky).toBeGreaterThan(maly);
	});

	it('vráti vzdialenosť v METROCH (bbox v mm, výsledok rádovo jednotky metrov, nie tisíce)', () => {
		const d = autoFitVzdialenost({ w: 3000, h: 1500, d: 200 }, 16 / 9);
		expect(d).toBeGreaterThan(0.5);
		expect(d).toBeLessThan(50);
	});

	it('užší aspect (portrait) pri rovnakom bboxe vyžaduje aspoň takú vzdialenosť ako široký (šírka sa ťažšie zmestí)', () => {
		const siroky = autoFitVzdialenost({ w: 4000, h: 1500, d: 200 }, 21 / 9);
		const uzky = autoFitVzdialenost({ w: 4000, h: 1500, d: 200 }, 9 / 21);
		expect(uzky).toBeGreaterThanOrEqual(siroky);
	});

	it('FOV je zamknuté na 35°', () => {
		expect(FOV_DEG).toBe(35);
	});
});

describe('kamera — presety a fixné "Zvnútra"', () => {
	it('PRESET_DEFAULT je "troStvrte" (3/4 exteriér, default aj tlačový záber)', () => {
		expect(PRESET_DEFAULT).toBe('troStvrte');
		expect(PRESETY.troStvrte.nazov).toBe('3/4 exteriér');
	});

	it('"zvnutra" preset používa FIXNÚ vzdialenosť 1,6 m, nikdy auto-fit', () => {
		const fit = autoFitVzdialenost({ w: 4000, h: 2000, d: 300 }, 16 / 9);
		expect(vzdialenostPrePreset('zvnutra', fit)).toBe(1.6);
		expect(vzdialenostPrePreset('troStvrte', fit)).toBe(fit);
		expect(vzdialenostPrePreset('celny', fit)).toBe(fit);
	});
});

describe('kamera — cieľ a orbit clamp (voľný orbit zakázaný)', () => {
	it('fitCiel stiahne stred bboxu o 8% k zemi (y < h/2)', () => {
		const c = fitCiel({ w: 3000, h: 2000, d: 200 });
		expect(c.y).toBeLessThan(1); // h/2 v metroch = 1
		expect(c.y).toBeCloseTo(1 * 0.92, 6);
		expect(c.x).toBe(0);
		expect(c.z).toBe(0);
	});

	it('orbitLimity: azimut je uzamknutý na preset ± 50° (nikdy voľný 360° orbit)', () => {
		const lim = orbitLimity(PRESETY.celny, 5);
		const rozsahDeg = ((lim.maxAzimuthAngle - lim.minAzimuthAngle) * 180) / Math.PI;
		expect(rozsahDeg).toBeCloseTo(100, 6); // ±50°
	});

	it('minDistance/maxDistance sú násobky fit vzdialenosti (0.65x .. 2.0x)', () => {
		const lim = orbitLimity(PRESETY.troStvrte, 10);
		expect(lim.minDistance).toBeCloseTo(6.5, 6);
		expect(lim.maxDistance).toBeCloseTo(20, 6);
	});

	it('poziciaKamery pri elevácii 0° a azimute 0° sedí presne na +Z vo vzdialenosti d', () => {
		const p = poziciaKamery({ x: 0, y: 0, z: 0 }, 0, 0, 5);
		expect(p.x).toBeCloseTo(0, 6);
		expect(p.y).toBeCloseTo(0, 6);
		expect(p.z).toBeCloseTo(5, 6);
	});
});

describe('kvalita — detekujTier (§2.9 tabuľka)', () => {
	it('žiadny WebGL2 → none', () => {
		expect(detekujTier({ webgl2Dostupny: false })).toBe('none');
	});

	it('2. strata kontextu v session → none, bez ohľadu na ostatné signály', () => {
		expect(
			detekujTier({ webgl2Dostupny: true, contextLostCount: 2, hardwareConcurrency: 16 })
		).toBe('none');
	});

	it('init > 2500ms → none', () => {
		expect(detekujTier({ webgl2Dostupny: true, initMs: 2600 })).toBe('none');
	});

	it('hardwareConcurrency <= 4 → low', () => {
		expect(detekujTier({ webgl2Dostupny: true, hardwareConcurrency: 4 })).toBe('low');
	});

	it('deviceMemory <= 2 → low', () => {
		expect(detekujTier({ webgl2Dostupny: true, hardwareConcurrency: 16, deviceMemory: 2 })).toBe(
			'low'
		);
	});

	it('slabé GPU (Mali/Adreno 1-5/PowerVR) → low', () => {
		expect(
			detekujTier({ webgl2Dostupny: true, hardwareConcurrency: 16, unmaskedRenderer: 'Mali-G52' })
		).toBe('low');
		expect(
			detekujTier({ webgl2Dostupny: true, hardwareConcurrency: 16, unmaskedRenderer: 'Adreno 330' })
		).toBe('low');
		// Adreno 6xx+ NIE JE v zozname slabých -> nesmie spadnúť do low len kvôli GPU stringu
		expect(
			detekujTier({ webgl2Dostupny: true, hardwareConcurrency: 16, unmaskedRenderer: 'Adreno 660' })
		).not.toBe('low');
	});

	it('hardwareConcurrency <= 8 (a nie <=4) → mid', () => {
		expect(detekujTier({ webgl2Dostupny: true, hardwareConcurrency: 8 })).toBe('mid');
	});

	it('devicePixelRatio >= 2.5 → mid', () => {
		expect(
			detekujTier({ webgl2Dostupny: true, hardwareConcurrency: 16, devicePixelRatio: 3 })
		).toBe('mid');
	});

	it('silný desktop (žiadny trigger) → high', () => {
		expect(
			detekujTier({
				webgl2Dostupny: true,
				hardwareConcurrency: 16,
				deviceMemory: 16,
				devicePixelRatio: 1,
				unmaskedRenderer: 'NVIDIA GeForce RTX'
			})
		).toBe('high');
	});
});

describe('kvalita — nastaveniaPreTier (DPR cap, sklo, PMREM podľa tieru)', () => {
	it('low: DPR<=1.25, falošné sklo, bez clearcoatu, plochý gradient', () => {
		const n = nastaveniaPreTier('low');
		expect(n.dpr).toBeLessThanOrEqual(1.25);
		expect(n.sklo).toBe('falosne');
		expect(n.clearcoat).toBe(false);
		expect(n.plochyGradientMiestoMap).toBe(true);
	});

	it('mid: DPR<=1.5, antialias false, transmission zostáva, PMREM 128', () => {
		const n = nastaveniaPreTier('mid');
		expect(n.dpr).toBeLessThanOrEqual(1.5);
		expect(n.antialias).toBe(false);
		expect(n.sklo).toBe('transmission');
		expect(n.pmrem).toBe(128);
	});

	it('high: DPR<=2, antialias true, PMREM 256, stena 1024', () => {
		const n = nastaveniaPreTier('high');
		expect(n.dpr).toBeLessThanOrEqual(2);
		expect(n.antialias).toBe(true);
		expect(n.pmrem).toBe(256);
		expect(n.stena).toBe(1024);
	});
});
