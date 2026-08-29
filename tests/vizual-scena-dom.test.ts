// #333 — unit testy `scena-dom.ts` (profi dom + okolie ako SalesQueze). Testujú POZÍCIU/
// GEOMETRIU meshov + disposal (nie pixely) → Node vitest s no-op canvas stubom (vzor
// `vizual-scena.test.ts`; standing-seam/trávnik/dlažba textúry volajú canvas 2D). Kľúčové:
// dvere centrované na x=0, 2-podlažná fasáda, strecha vysoko nad fasádou, VŠETKY
// geometrie/materiály/textúry v `disposables` (inak leak celého domu per remount).
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { vytvorDom, vytvorOkolie } from '../src/lib/vizual/scena-dom';
import { nastaveniaPreTier } from '../src/lib/vizual/kvalita';
import { mm } from '../src/lib/vizual/jednotky';

beforeAll(() => {
	class FakeGradient {
		addColorStop(): void {}
	}
	class FakeCtx {
		fillStyle: unknown = '#000';
		createLinearGradient(): FakeGradient {
			return new FakeGradient();
		}
		createRadialGradient(): FakeGradient {
			return new FakeGradient();
		}
		fillRect(): void {}
		createImageData(w: number, h: number) {
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
	(globalThis as unknown as { document: unknown }).document = {
		createElement: (tag: string) => (tag === 'canvas' ? new FakeCanvas() : null)
	};
});

type Mesh = InstanceType<typeof THREE.Mesh>;

function svetoveBboxDeti(skupina: InstanceType<typeof THREE.Group>) {
	return skupina.children.map((c) => {
		const m = c as Mesh;
		m.geometry.computeBoundingBox();
		const bb = m.geometry.boundingBox!;
		return {
			x: m.position.x,
			y: m.position.y,
			hornaY: m.position.y + bb.max.y,
			spodnaY: m.position.y + bb.min.y,
			h: bb.max.y - bb.min.y,
			w: bb.max.x - bb.min.x
		};
	});
}

describe('vytvorDom (#333) — profi 2-podlažný dom so strechou', () => {
	const nast = nastaveniaPreTier('high');

	it('vráti Group s deťmi + disposables; KAŽDÝ disposable má .dispose (žiadny leak)', () => {
		const dom = vytvorDom(THREE, nast, 4000, 2500);
		expect(dom.skupina.children.length).toBeGreaterThanOrEqual(10);
		expect(dom.disposables.length).toBeGreaterThan(dom.skupina.children.length);
		for (const d of dom.disposables) expect(typeof d.dispose).toBe('function');
	});

	it('dvere sú CENTROVANÉ na x=0 (priechodné medzi nohami pergoly)', () => {
		const prvky = svetoveBboxDeti(vytvorDom(THREE, nast, 4000, 2500).skupina);
		// drevené krídlo dverí: mesh pri x≈0 s výškou ~2,1 m stojaci na zemi
		const dvere = prvky.filter(
			(p) => Math.abs(p.x) < mm(1) && p.h > mm(1900) && p.h < mm(2300) && p.spodnaY < mm(1)
		);
		expect(dvere.length).toBeGreaterThanOrEqual(1);
	});

	it('fasáda pokrýva 2 podlažia (výška = max(2800,SV+600) + 2600)', () => {
		const prvky = svetoveBboxDeti(vytvorDom(THREE, nast, 4000, 2500).skupina);
		const najvyssia = prvky.reduce((a, b) => (b.h > a.h ? b : a)); // fasádny blok
		// SV=2500 → prízemie max(2800,3100)=3100; +2600 poschodie = 5700 mm
		expect(najvyssia.h).toBeCloseTo(mm(5700), 5);
	});

	it('strecha je VYSOKO nad fasádou (nezasahuje do pergoly pod ňou)', () => {
		const prvky = svetoveBboxDeti(vytvorDom(THREE, nast, 4000, 2500).skupina);
		const najvyssiVrch = Math.max(...prvky.map((p) => p.hornaY));
		expect(najvyssiVrch).toBeGreaterThan(mm(5700)); // hrebeň strechy nad fasádou
	});

	it('fasáda škáluje šírkou pergoly (S+600 presah)', () => {
		const male = svetoveBboxDeti(vytvorDom(THREE, nast, 3000, 2500).skupina);
		const velke = svetoveBboxDeti(vytvorDom(THREE, nast, 6000, 2500).skupina);
		const sirkaFasady = (p: ReturnType<typeof svetoveBboxDeti>) => Math.max(...p.map((x) => x.w));
		expect(sirkaFasady(velke)).toBeGreaterThan(sirkaFasady(male));
	});

	it('low tier (bez textúr) — dom sa postaví bez chyby a s deťmi', () => {
		const dom = vytvorDom(THREE, nastaveniaPreTier('low'), 4000, 2500);
		expect(dom.skupina.children.length).toBeGreaterThanOrEqual(10);
		for (const d of dom.disposables) expect(typeof d.dispose).toBe('function');
	});
});

describe('vytvorOkolie (#333) — trávnik + dlažbová terasa + stromy', () => {
	const nast = nastaveniaPreTier('high');

	it('vráti Group (trávnik + terasa + stromy) + disposables s .dispose', () => {
		const ok = vytvorOkolie(THREE, nast, 4000, 3500);
		// trávnik(1) + terasa(1) + 3 stromy × (kmeň+koruna) = 8 meshov
		expect(ok.skupina.children.length).toBeGreaterThanOrEqual(8);
		for (const d of ok.disposables) expect(typeof d.dispose).toBe('function');
	});

	it('trávnik je na y=0, terasa mierne nad ním (y≈+1 mm)', () => {
		const ok = vytvorOkolie(THREE, nast, 4000, 3500);
		const yPozicie = ok.skupina.children.map((c) => (c as Mesh).position.y).sort((a, b) => a - b);
		expect(yPozicie[0]).toBeCloseTo(0, 6); // trávnik (najnižší)
		// terasa je nad trávnikom (žiadny z-fight), ale pod korunami stromov
		expect(yPozicie.some((y) => y > 0 && y < mm(5))).toBe(true);
	});

	it('terasa škáluje pôdorysom pergoly (väčšia pergola → väčšia terasa)', () => {
		const terasaSirka = (S: number, D: number) => {
			const ok = vytvorOkolie(THREE, nast, S, D);
			// terasa = PlaneGeometry (bbox X) menšia než trávnik (40 m); nájdi ju
			const sirky = ok.skupina.children.map((c) => {
				const m = c as Mesh;
				m.geometry.computeBoundingBox();
				const bb = m.geometry.boundingBox!;
				return bb.max.x - bb.min.x;
			});
			// terasa: najväčšia rovina POD trávnikom (40 m) — druhá najväčšia šírka
			return sirky.filter((w) => w < 39).sort((a, b) => b - a)[0] ?? 0;
		};
		expect(terasaSirka(6000, 4000)).toBeGreaterThan(terasaSirka(3000, 2000));
	});
});
