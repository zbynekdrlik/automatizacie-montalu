// Showroom kvalita 3D vizuálu (#285) — unit testy nových čistých vetiev bez
// WebGL: kvalitatívne tiery (hdri/tiene/shadowMapa), HDRI URL + graceful loader,
// a konfigurácia reálneho cast-shadow kľúčového svetla. `DirectionalLight`/
// `Color`/`OrthographicCamera` sú čisté JS objekty (žiadny canvas/WebGL kontext
// potrebný na ich VYTVORENIE), rovnaký precedens ako `tests/vizual-materialy.test.ts`
// a `tests/vizual-scena-svetla.test.ts`.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { nastaveniaPreTier } from '../src/lib/vizual/kvalita';
import {
	hdriUrl,
	nacitajHDRI,
	nastavKluceoveSvetloTien,
	vytvorSvetla
} from '../src/lib/vizual/scena';
import { mm } from '../src/lib/vizual/jednotky';

describe('kvalita — #285 tier polia (hdri / tiene / shadowMapa)', () => {
	it('low: bez HDRI, bez reálnych tieňov (slabé GPU: RoomEnvironment + kontaktný dekal)', () => {
		const n = nastaveniaPreTier('low');
		expect(n.hdri).toBe(false);
		expect(n.tiene).toBe(false);
		expect(n.shadowMapa).toBe(0);
	});

	it('mid: HDRI + reálne tiene, shadow mapa 1024', () => {
		const n = nastaveniaPreTier('mid');
		expect(n.hdri).toBe(true);
		expect(n.tiene).toBe(true);
		expect(n.shadowMapa).toBe(1024);
	});

	it('high: HDRI + reálne tiene, shadow mapa 2048 (ostrejšie než mid)', () => {
		const n = nastaveniaPreTier('high');
		expect(n.hdri).toBe(true);
		expect(n.tiene).toBe(true);
		expect(n.shadowMapa).toBe(2048);
		expect(n.shadowMapa).toBeGreaterThan(nastaveniaPreTier('mid').shadowMapa);
	});
});

describe('hdriUrl — asset z VLASTNÉHO originu (žiaden externý runtime fetch, #285)', () => {
	it('bez base path → /hdri/…', () => {
		expect(hdriUrl('')).toBe('/hdri/kloofendal_puresky_1k.hdr');
	});
	it('s base path → <base>/hdri/…', () => {
		expect(hdriUrl('/app')).toBe('/app/hdri/kloofendal_puresky_1k.hdr');
	});
	it('URL nikdy nie je absolútna (žiaden dl.polyhaven.org ani http) — čisto same-origin cesta', () => {
		expect(hdriUrl('')).not.toMatch(/^https?:\/\//);
		expect(hdriUrl('')).not.toContain('polyhaven');
	});
});

describe('nacitajHDRI — graceful (nikdy nerejektuje, #285)', () => {
	it('úspešný load → vráti textúru', async () => {
		const marker = { __hdr: true };
		class FakeOK {
			load(_url: string, onLoad: (t: unknown) => void) {
				onLoad(marker);
			}
		}
		const t = await nacitajHDRI(FakeOK as never, 'x');
		expect(t).toBe(marker);
	});

	it('chyba loadu (napr. 404) → vráti null (fallback na RoomEnvironment)', async () => {
		class FakeErr {
			load(_u: string, _l: (t: unknown) => void, _p: undefined, onErr: (e: unknown) => void) {
				onErr(new Error('404'));
			}
		}
		const t = await nacitajHDRI(FakeErr as never, 'x');
		expect(t).toBeNull();
	});

	it('výnimka v konštruktore loadera → vráti null (nikdy nezhodí scénu)', async () => {
		class FakeThrow {
			constructor() {
				throw new Error('boom');
			}
			load() {
				/* nedosiahnuteľné */
			}
		}
		const t = await nacitajHDRI(FakeThrow as never, 'x');
		expect(t).toBeNull();
	});
});

describe('nastavKluceoveSvetloTien — reálny cast shadow kľúčového svetla (#285)', () => {
	const bbox = { w: 5000, h: 3000, d: 4000 }; // mm

	it('zapne castShadow, nastaví shadow mapu a cieľ na STRED produktu (y = h/2)', () => {
		const { key } = vytvorSvetla(THREE);
		expect(key.castShadow).toBe(false); // default pred konfiguráciou
		nastavKluceoveSvetloTien(THREE, key, bbox.w, bbox.h, bbox.d, 2048);
		expect(key.castShadow).toBe(true);
		expect(key.shadow.mapSize.x).toBe(2048);
		expect(key.shadow.mapSize.y).toBe(2048);
		// cieľ = stred produktu v METROCH (rovnaká svetová konvencia ako zvyšok scény)
		expect(key.target.position.x).toBe(0);
		expect(key.target.position.y).toBeCloseTo(mm(bbox.h) / 2, 10);
		expect(key.target.position.z).toBe(0);
	});

	it('ortho frustum je symetrický a nadimenzovaný podľa polovice priestorovej uhlopriečky bboxu', () => {
		const { key } = vytvorSvetla(THREE);
		nastavKluceoveSvetloTien(THREE, key, bbox.w, bbox.h, bbox.d, 1024);
		const cam = key.shadow.camera;
		const w = mm(bbox.w);
		const h = mm(bbox.h);
		const d = mm(bbox.d);
		const polDiag = 0.5 * Math.sqrt(w * w + h * h + d * d);
		const rozsah = polDiag * 1.15 + 0.5;
		expect(cam.right).toBeCloseTo(rozsah, 10);
		expect(cam.left).toBeCloseTo(-rozsah, 10);
		expect(cam.top).toBeCloseTo(rozsah, 10);
		expect(cam.bottom).toBeCloseTo(-rozsah, 10);
		// near/far obopnú produkt okolo fixnej 12 m vzdialenosti svetla
		expect(cam.near).toBeCloseTo(Math.max(0.1, 12 - polDiag - 1), 10);
		expect(cam.far).toBeCloseTo(12 + polDiag + 2, 10);
		expect(cam.near).toBeGreaterThan(0);
		expect(cam.near).toBeLessThan(cam.far);
	});

	it('nastaví bias/normalBias proti shadow acne (nenulové, záporný bias)', () => {
		const { key } = vytvorSvetla(THREE);
		nastavKluceoveSvetloTien(THREE, key, bbox.w, bbox.h, bbox.d, 1024);
		expect(key.shadow.bias).toBeLessThan(0);
		expect(key.shadow.normalBias).toBeGreaterThan(0);
	});

	it('väčší bbox → väčší frustum (rozsah rastie s produktom)', () => {
		const maly = vytvorSvetla(THREE).key;
		const velky = vytvorSvetla(THREE).key;
		nastavKluceoveSvetloTien(THREE, maly, 2000, 2000, 2000, 1024);
		nastavKluceoveSvetloTien(THREE, velky, 8000, 3000, 6000, 1024);
		expect(velky.shadow.camera.right).toBeGreaterThan(maly.shadow.camera.right);
	});
});
