// #356 — integračný test `postavProduktMeshe`: mikro-reliéf mapy (normal/roughness)
// sa vytvoria a napoja na hliník/sklo LEN na mid/high tieri, a `zlikvidujProduktMeshe`
// ich uvoľní (Material.dispose() sám textúry NEuvoľní → inak leak per remount).
//
// SKUTOČNÝ `three` + `mergeGeometries` v Node (materiály/geometria sú čisté JS objekty),
// ale generátory textúr volajú `document.createElement('canvas').getContext('2d')` →
// minimálny recording-schopný stub (createImageData/putImageData; normal generátory
// gradient nepoužívajú). Vzor stubu: `tests/vizual-scena.test.ts`.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { postavProduktMeshe, zlikvidujProduktMeshe } from '../src/lib/vizual/produkt-meshe';
import { nastaveniaPreTier } from '../src/lib/vizual/kvalita';
import type { VizVysledok } from '../src/lib/vizual/spec';

class FakeCtx {
	fillStyle: unknown = '#000';
	fillRect(): void {}
	createImageData(
		w: number,
		h: number
	): { data: Uint8ClampedArray; width: number; height: number } {
		return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
	}
	putImageData(): void {}
}
class FakeCanvas {
	width = 0;
	height = 0;
	getContext(kind: string): FakeCtx | null {
		return kind === '2d' ? new FakeCtx() : null;
	}
}

beforeAll(() => {
	(globalThis as unknown as { document: unknown }).document = {
		createElement: (tag: string) => (tag === 'canvas' ? new FakeCanvas() : null)
	};
});

/** Minimálny model: jeden hliníkový `ram` diel + jedno `sklo` — stačí na overenie
 *  materiálov (rozmery sú nepodstatné, len aby postavGeometrie niečo vyprodukovalo). */
function model(): VizVysledok {
	return {
		diely: [
			{ rola: 'ram', tvar: { kind: 'box', w: 2000, h: 2000, d: 60 }, pos: { x: 0, y: 1000, z: 0 } },
			{ rola: 'sklo', tvar: { kind: 'box', w: 1800, h: 1800, d: 8 }, pos: { x: 0, y: 1000, z: 0 } }
		],
		bbox: { w: 2000, h: 2000, d: 60 },
		presnost: 'vykresova',
		poznamky: []
	};
}

describe('postavProduktMeshe — #356 mikro-reliéf mapy podľa tieru', () => {
	it('high tier → hliník má normalMap+roughnessMap (repeat nastavený), sklo má clearcoatNormalMap', () => {
		const scene = new THREE.Scene();
		const { materialy, skloMaterial } = postavProduktMeshe(
			THREE,
			mergeGeometries,
			scene,
			model(),
			'7016',
			nastaveniaPreTier('high'),
			undefined
		);
		const hlinik = materialy.ram!;
		expect(hlinik.normalMap).not.toBeNull();
		expect(hlinik.roughnessMap).not.toBeNull();
		expect(hlinik.normalMap!.repeat.x).toBeGreaterThan(1); // HLINIK_MAP_REPEAT
		expect(skloMaterial).not.toBeNull();
		expect(skloMaterial!.clearcoatNormalMap).not.toBeNull();
	});

	it('low tier → hliník aj sklo ostávajú PLOCHÉ (žiadne mapy) — perf + spätná kompatibilita', () => {
		const scene = new THREE.Scene();
		const { materialy, skloMaterial } = postavProduktMeshe(
			THREE,
			mergeGeometries,
			scene,
			model(),
			'7016',
			nastaveniaPreTier('low'),
			undefined
		);
		expect(materialy.ram!.normalMap).toBeNull();
		expect(materialy.ram!.roughnessMap).toBeNull();
		expect(skloMaterial!.clearcoatNormalMap).toBeNull();
	});

	it('zlikvidujProduktMeshe UVOĽNÍ VŠETKY mikro-reliéf mapy vrátane clearcoatNormalMap (inak leak per prestav/remount)', () => {
		const scene = new THREE.Scene();
		const { materialy, skloMaterial, produktMeshe } = postavProduktMeshe(
			THREE,
			mergeGeometries,
			scene,
			model(),
			'7016',
			nastaveniaPreTier('high'),
			undefined
		);
		const normalSpy = vi.spyOn(materialy.ram!.normalMap!, 'dispose');
		const roughSpy = vi.spyOn(materialy.ram!.roughnessMap!, 'dispose');
		const clearcoatSpy = vi.spyOn(skloMaterial!.clearcoatNormalMap!, 'dispose');
		zlikvidujProduktMeshe(produktMeshe);
		expect(normalSpy).toHaveBeenCalled();
		expect(roughSpy).toHaveBeenCalled();
		expect(clearcoatSpy).toHaveBeenCalled();
	});
});
