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
	it('fitCiel stiahne stred bboxu o 10% k zemi (y < h/2, #174 z pôvodných 8%)', () => {
		const c = fitCiel({ w: 3000, h: 2000, d: 200 });
		expect(c.y).toBeLessThan(1); // h/2 v metroch = 1
		expect(c.y).toBeCloseTo(1 * 0.9, 6);
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

// #174 — vizuálna iterácia: kamera bola príliš nízko/blízko (orezaný vrch,
// príliš málo okraja), preto sa `REZERVA` zväčšila (0.15 → 0.35) a elevácie
// `troStvrte`/`celny` znížili (16°/8° → 7°/6°), aby výška oka padla do
// pásma ~1,5–1,7 m. Tieto testy overujú OBIDVA ciele skutočnou 3D
// projekciou (nie len trigonometrickým odhadom v komentári): (1) celý bbox
// produktu leží vo vnútri kamerového frustumu pri KAŽDOM exteriérovom
// presete — "nič orezané" zo zadania, a (2) svetová výška kamery padne do
// cieľového pásma.
type Vec3 = { x: number; y: number; z: number };
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
	x: a.y * b.z - a.z * b.y,
	y: a.z * b.x - a.x * b.z,
	z: a.x * b.y - a.y * b.x
});
const norm = (a: Vec3): Vec3 => {
	const l = Math.sqrt(dot(a, a));
	return { x: a.x / l, y: a.y / l, z: a.z / l };
};

/** Premietne všetkých 8 rohov bboxu (stred x/z=0, päta y=0 — rovnaká
 *  konvencia ako `builder.ts`/`fitCiel`) do kamerového priestoru pre daný
 *  preset a vráti NAJHORŠÍ pomer (roh/polovica FOV) v horizontálnom aj
 *  vertikálnom smere — < 1 znamená "celý bbox vo frustume", hodnota
 *  blízko 1 znamená "tesne orezané". */
function najhorsiFrustumPomer(
	bbox: { w: number; h: number; d: number },
	presetKluc: PresetKlucLocal,
	aspect: number
): { maxHRatio: number; maxVRatio: number; minForward: number } {
	const mmv = (v: number) => v / 1000;
	const fit = autoFitVzdialenost(bbox, aspect);
	const ciel = fitCiel(bbox);
	const preset = PRESETY[presetKluc];
	const vzd = vzdialenostPrePreset(presetKluc, fit);
	const pos = poziciaKamery(ciel, preset.azimut, preset.elevacia, vzd);
	const forward = norm(sub(ciel, pos));
	const right = norm(cross(forward, { x: 0, y: 1, z: 0 }));
	const up = cross(right, forward);
	const vFov = (FOV_DEG * Math.PI) / 180;
	const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);

	let maxHRatio = 0;
	let maxVRatio = 0;
	let minForward = Infinity;
	const w2 = mmv(bbox.w) / 2;
	const d2 = mmv(bbox.d) / 2;
	const h = mmv(bbox.h);
	for (const x of [-w2, w2]) {
		for (const y of [0, h]) {
			for (const z of [-d2, d2]) {
				const v = sub({ x, y, z }, pos);
				const f = dot(v, forward);
				const r = dot(v, right);
				const u = dot(v, up);
				minForward = Math.min(minForward, f);
				maxHRatio = Math.max(maxHRatio, Math.atan2(Math.abs(r), f) / (hFov / 2));
				maxVRatio = Math.max(maxVRatio, Math.atan2(Math.abs(u), f) / (vFov / 2));
			}
		}
	}
	return { maxHRatio, maxVRatio, minForward };
}

type PresetKlucLocal = 'troStvrte' | 'celny';
const ASPECT_16_10 = 16 / 10;
const BBOXY: { nazov: string; bbox: { w: number; h: number; d: number } }[] = [
	{ nazov: '4200×2100 (issue #174 repro)', bbox: { w: 4200, h: 2100, d: 150 } },
	{ nazov: '1500×1500 (malé, štvorcové)', bbox: { w: 1500, h: 1500, d: 100 } },
	{ nazov: '6000×2200 (veľmi široké)', bbox: { w: 6000, h: 2200, d: 150 } },
	{ nazov: '1500×2400 (úzke, vysoké)', bbox: { w: 1500, h: 2400, d: 150 } }
];

describe('kamera — #174 celý bbox v kamerovom frustume (nič orezané)', () => {
	for (const { nazov, bbox } of BBOXY) {
		for (const presetKluc of ['troStvrte', 'celny'] as const) {
			it(`${nazov} — ${presetKluc}: všetkých 8 rohov bboxu vo frustume s okrajom`, () => {
				const r = najhorsiFrustumPomer(bbox, presetKluc, ASPECT_16_10);
				// < 1 = vo frustume; ponechaná rezerva (< 0.95) dokazuje SKUTOČNÝ
				// okraj, nie tesné dotýkanie hrany snímky.
				expect(r.maxHRatio).toBeLessThan(0.95);
				expect(r.maxVRatio).toBeLessThan(0.95);
				// každý roh je PRED kamerou (kladná vzdialenosť v smere pohľadu) —
				// inak by frustum-uhol test dával falošne priaznivý výsledok pre
				// roh za chrbtom kamery.
				expect(r.minForward).toBeGreaterThan(0);
			});
		}
	}
});

describe('kamera — #174 výška oka v prirodzenom pásme ~1,5–1,7 m', () => {
	it('troStvrte aj celny: svetová Y-výška kamery pre typickú jednotku (4200×2100) padne do <1.3, 1.9> m', () => {
		const bbox = { w: 4200, h: 2100, d: 150 };
		const fit = autoFitVzdialenost(bbox, ASPECT_16_10);
		const ciel = fitCiel(bbox);
		for (const presetKluc of ['troStvrte', 'celny'] as const) {
			const preset = PRESETY[presetKluc];
			const pos = poziciaKamery(ciel, preset.azimut, preset.elevacia, fit);
			// mäkšie pásmo než zadania "cieľových" 1,5–1,7 m — dovoľuje budúce
			// jemné doladenie bez toho, aby test padal na centimetre, no stále
			// jasne odlíši "prirodzená výška oka" od pôvodných ~2,3 m (#174 repro).
			expect(pos.y).toBeGreaterThan(1.3);
			expect(pos.y).toBeLessThan(1.9);
		}
	});

	it('IZOLOVANÁ premenná: pôvodná elevácia troStvrte (16°) by SAMA OSEBE (pri dnešnej rezerve/pull-down) dala výšku mimo pásma', () => {
		// Toto NIE JE reprodukcia skutočného pred-#174 stavu (ten mal
		// rezerva=0.15 + pull-down=0.92, nie dnešných 0.35/0.90 — kombinácia
		// oboch dala pôvodne ~2.3m, viď `kamera.ts`'s vlastný komentár) —
		// zámerne izoluje LEN elevačný uhol ako premennú (rezerva/fitCiel sú
		// dnešné), aby dokázal, že bez zníženia elevácie by výška bola mimo
		// pásma AJ pri dnešnej väčšej marži, nie len v pôvodnej kombinácii
		// (#174 adversariálny review — objasnené, aby test netvrdil, že
		// reprodukuje presne pred-#174 stav).
		const bbox = { w: 4200, h: 2100, d: 150 };
		const fit = autoFitVzdialenost(bbox, ASPECT_16_10);
		const ciel = fitCiel(bbox);
		const povodnaTroStvrte = poziciaKamery(ciel, -32, 16, fit);
		expect(povodnaTroStvrte.y).toBeGreaterThan(1.9); // presne preto sa elevácia znížila
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
