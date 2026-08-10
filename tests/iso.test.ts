// Izometrická projekcia (#138) — čistá matematika, priamy výpočet (rovnaká disciplína
// ako `arcCenterFromEndpoints` v kota.test.ts: over VZORCOM, nehádaj podľa oka).
import { describe, it, expect } from 'vitest';
import { projekcia3D, projekciaUsecky, hraniceProjekcie } from '../src/lib/vykres/iso';

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = Math.sin(Math.PI / 6);

describe('projekcia3D — 4 kardinálne smery (priamy výpočet, nie odhad)', () => {
	it('počiatok (0,0,0) sa projektuje na (0,0)', () => {
		expect(projekcia3D({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0 });
	});

	it('čistá +x (šírka) os ide dole-vpravo pod 30°', () => {
		const p = projekcia3D({ x: 1, y: 0, z: 0 });
		expect(p.x).toBeCloseTo(COS30, 10);
		expect(p.y).toBeCloseTo(SIN30, 10); // SVG y-dole = kladné = "dole"
	});

	it('čistá +z (hĺbka) os ide dole-vľavo pod 30° (zrkadlovo k +x)', () => {
		const p = projekcia3D({ x: 0, y: 0, z: 1 });
		expect(p.x).toBeCloseTo(-COS30, 10);
		expect(p.y).toBeCloseTo(SIN30, 10);
	});

	it('čistá +y (výška) ide PRESNE zvisle nahor (SVG y záporné)', () => {
		const p = projekcia3D({ x: 0, y: 1, z: 0 });
		expect(p.x).toBeCloseTo(0, 10);
		expect(p.y).toBeCloseTo(-1, 10);
	});

	it('+x a +z sa v X súradnici navzájom rušia pri x=z (bod "priamo za sebou")', () => {
		const p = projekcia3D({ x: 5, y: 0, z: 5 });
		expect(p.x).toBeCloseTo(0, 10);
		expect(p.y).toBeCloseTo(10 * SIN30, 10);
	});

	it('mierka škáluje lineárne', () => {
		const p1 = projekcia3D({ x: 3, y: 2, z: 1 }, 1);
		const p10 = projekcia3D({ x: 3, y: 2, z: 1 }, 10);
		expect(p10.x).toBeCloseTo(p1.x * 10, 8);
		expect(p10.y).toBeCloseTo(p1.y * 10, 8);
	});

	it('výška je NEZÁVISLÁ od x/z (posun len vo y)', () => {
		const nizky = projekcia3D({ x: 4, y: 0, z: 2 });
		const vysoky = projekcia3D({ x: 4, y: 100, z: 2 });
		expect(vysoky.x).toBeCloseTo(nizky.x, 10);
		expect(vysoky.y).toBeCloseTo(nizky.y - 100, 10);
	});
});

describe('projekciaUsecky — projekcia oboch koncov úsečky', () => {
	it('zodpovedá dvom samostatným projekcia3D volaniam', () => {
		const a = { x: 0, y: 0, z: 0 };
		const b = { x: 10, y: 5, z: 0 };
		const seg = projekciaUsecky(a, b, 2);
		const pa = projekcia3D(a, 2);
		const pb = projekcia3D(b, 2);
		expect(seg).toEqual({ x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y });
	});
});

describe('hraniceProjekcie — bounding box projektovaných bodov', () => {
	it('prázdne pole vráti null (obranný fallback)', () => {
		expect(hraniceProjekcie([])).toBeNull();
	});

	it('jeden bod má nulovú šírku aj výšku bounding boxu', () => {
		const h = hraniceProjekcie([{ x: 3, y: 3, z: 3 }])!;
		expect(h.maxX - h.minX).toBeCloseTo(0, 10);
		expect(h.maxY - h.minY).toBeCloseTo(0, 10);
	});

	it('viac bodov obalí presne min/max z ich projekcií', () => {
		const body = [
			{ x: 0, y: 0, z: 0 },
			{ x: 10, y: 0, z: 0 },
			{ x: 0, y: 10, z: 0 },
			{ x: 0, y: 0, z: 10 }
		];
		const h = hraniceProjekcie(body)!;
		const projekcie = body.map((b) => projekcia3D(b));
		expect(h.minX).toBeCloseTo(Math.min(...projekcie.map((p) => p.x)), 10);
		expect(h.maxX).toBeCloseTo(Math.max(...projekcie.map((p) => p.x)), 10);
		expect(h.minY).toBeCloseTo(Math.min(...projekcie.map((p) => p.y)), 10);
		expect(h.maxY).toBeCloseTo(Math.max(...projekcie.map((p) => p.y)), 10);
	});
});
