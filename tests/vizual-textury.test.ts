// Zákaznícky 3D náhľad (#170) — unit testy `textury.ts`'s procedurálne CanvasTexture
// generátory (obloha/dlažba/stena/kontaktný tieň), doteraz NETESTOVANÉ (#177, nájdené
// v #174 review — `tests/vizual-scena.test.ts` medzičasom pokryla `scena.ts`'s
// `vytvorZem`/`vytvorStenu`/`vytvorKontaktnyTien` POZÍCIU/TVAR, ale `textury.ts`
// zostal úplne bez testov, viď STEP 0 komentár na tikete).
//
// Node vitest beží v 'node' prostredí (žiadny jsdom v repe) — `textury.ts`'s
// `canvas2d()` volá `document.createElement('canvas').getContext('2d')`, čo bez
// polyfillu neexistuje. Na rozdiel od `tests/vizual-scena.test.ts`'s NO-OP stubu
// (ten testuje len POZÍCIU/GEOMETRIU meshov postavených NA textúre, obsah canvasu
// mu je jedno), TENTO stub NAHRÁVA volania (gradient stops, fillRect argumenty,
// putImageData dáta) — presne "aké farby/rozmery/tvar generátor vyprodukoval" je
// vec, ktorú #177 žiada otestovať.
//
// `vytvorDlazbuTexturu`/`vytvorStenuTexturu` používajú `Math.random()` (jitter/šum)
// — pre DETERMINISTICKÝ test sa `Math.random` dočasne zmockuje (`vi.spyOn` +
// `mockRestore()` v `finally`), aby "deterministický výstup pre fixný vstup" platilo
// aj pre generátory so zabudovanou náhodnosťou. `vytvorOblohuTexturu`/
// `vytvorKontaktnyTienTexturu` sú čisto deterministické už samy osebe (žiadny
// `Math.random`).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
	vytvorDlazbuTexturu,
	vytvorKontaktnyTienTexturu,
	vytvorOblohuTexturu,
	vytvorStenuTexturu
} from '../src/lib/vizual/textury';

class FakeGradient {
	stops: Array<{ offset: number; color: string }> = [];
	addColorStop(offset: number, color: string): void {
		this.stops.push({ offset, color });
	}
}

interface FillRectCall {
	x: number;
	y: number;
	w: number;
	h: number;
	fillStyle: unknown;
}

interface FakeImageData {
	data: Uint8ClampedArray;
	width: number;
	height: number;
}

class FakeCtx {
	fillStyle: unknown = '#000';
	fillRectCalls: FillRectCall[] = [];
	linearGradients: Array<{ x0: number; y0: number; x1: number; y1: number; grad: FakeGradient }> =
		[];
	radialGradients: Array<{
		x0: number;
		y0: number;
		r0: number;
		x1: number;
		y1: number;
		r1: number;
		grad: FakeGradient;
	}> = [];
	lastImageData: FakeImageData | null = null;

	createLinearGradient(x0: number, y0: number, x1: number, y1: number): FakeGradient {
		const grad = new FakeGradient();
		this.linearGradients.push({ x0, y0, x1, y1, grad });
		return grad;
	}
	createRadialGradient(
		x0: number,
		y0: number,
		r0: number,
		x1: number,
		y1: number,
		r1: number
	): FakeGradient {
		const grad = new FakeGradient();
		this.radialGradients.push({ x0, y0, r0, x1, y1, r1, grad });
		return grad;
	}
	fillRect(x: number, y: number, w: number, h: number): void {
		this.fillRectCalls.push({ x, y, w, h, fillStyle: this.fillStyle });
	}
	createImageData(w: number, h: number): FakeImageData {
		return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
	}
	putImageData(imageData: FakeImageData): void {
		this.lastImageData = imageData;
	}
}

class FakeCanvas {
	width = 0;
	height = 0;
	private ctx = new FakeCtx();
	getContext(kind: string): FakeCtx | null {
		return kind === '2d' ? this.ctx : null;
	}
}

beforeAll(() => {
	(globalThis as unknown as { document: unknown }).document = {
		createElement: (tag: string) => (tag === 'canvas' ? new FakeCanvas() : null)
	};
});

/** `THREE.CanvasTexture`'s `.image` drží presne ten canvas, ktorý dostala do
 *  konštruktora (three/src/textures/CanvasTexture.js → Texture.js: `this.image =
 *  image`) — takto sa dá z vrátenej textúry vytiahnuť náš FakeCanvas a jeho
 *  nahratý FakeCtx. */
function fakeCanvasOf(tex: { image: unknown }): FakeCanvas {
	return tex.image as FakeCanvas;
}

describe('vytvorOblohuTexturu — vertikálny gradient, 256×256, sRGB', () => {
	it('canvas 256×256, colorSpace sRGB, needsUpdate bol nastavený (version > 0 — `needsUpdate` je len setter, three.js nemá gettter)', () => {
		const tex = vytvorOblohuTexturu(THREE);
		const canvas = fakeCanvasOf(tex);
		expect(canvas.width).toBe(256);
		expect(canvas.height).toBe(256);
		expect(tex.colorSpace).toBe(THREE.SRGBColorSpace);
		expect(tex.version).toBeGreaterThan(0);
	});

	it('deterministický vertikálny gradient — presne 2 farebné zastávky, celý canvas vyplnený', () => {
		const tex = vytvorOblohuTexturu(THREE);
		const ctx = fakeCanvasOf(tex).getContext('2d')!;
		expect(ctx.linearGradients).toHaveLength(1);
		expect(ctx.linearGradients[0]).toMatchObject({ x0: 0, y0: 0, x1: 0, y1: 256 });
		expect(ctx.linearGradients[0].grad.stops).toEqual([
			{ offset: 0, color: '#eef6fb' },
			{ offset: 1, color: '#4f80ad' }
		]);
		expect(ctx.fillRectCalls).toEqual([
			{ x: 0, y: 0, w: 256, h: 256, fillStyle: ctx.linearGradients[0].grad }
		]);
	});
});

describe('vytvorDlazbuTexturu — mriežka dlaždíc, deterministická štruktúra (Math.random zmockovaný)', () => {
	it('canvas rozlisenie×rozlisenie podľa parametra', () => {
		const tex = vytvorDlazbuTexturu(THREE, 128, 4);
		const canvas = fakeCanvasOf(tex);
		expect(canvas.width).toBe(128);
		expect(canvas.height).toBe(128);
	});

	it('deterministický výstup pri fixnom Math.random — presný počet dlaždíc + špára + farba', () => {
		const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
		try {
			const tex = vytvorDlazbuTexturu(THREE, 512, 4);
			const ctx = fakeCanvasOf(tex).getContext('2d')!;
			// 1 základný fillRect (špáry, celý canvas) + 4×4=16 dlaždicových fillRect;
			// šumová vrstva s Math.random()=>0 vždy "continue" (0 < 0.5 je vždy true),
			// takže 0 extra volaní z nej.
			expect(ctx.fillRectCalls).toHaveLength(17);
			expect(ctx.fillRectCalls[0]).toEqual({ x: 0, y: 0, w: 512, h: 512, fillStyle: '#655f57' });
			// bunka = 512/4 = 128; spara = round((12/600)*128) = round(2.56) = 3
			// jitter = (0*2-1)*0.06 = -0.06 konštantne → farba = báza(#a7a199=167,161,153)×0.94
			expect(ctx.fillRectCalls[1]).toEqual({
				x: 3,
				y: 3,
				w: 122,
				h: 122,
				fillStyle: 'rgb(156, 151, 143)'
			});
			// posledná dlaždica (pravý dolný roh, gx=gy=3): x=y=3*128+3=387
			expect(ctx.fillRectCalls[16]).toMatchObject({ x: 387, y: 387, w: 122, h: 122 });
		} finally {
			spy.mockRestore();
		}
	});

	it('menšia mriežka → menej dlaždicových fillRect volaní (2×2 → 4 dlaždice)', () => {
		const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
		try {
			const tex = vytvorDlazbuTexturu(THREE, 256, 2);
			const ctx = fakeCanvasOf(tex).getContext('2d')!;
			expect(ctx.fillRectCalls).toHaveLength(1 + 4); // 1 základ + 2×2 dlaždice
		} finally {
			spy.mockRestore();
		}
	});
});

describe('vytvorStenuTexturu — farebná mapa + roughness mapa, deterministické pri fixnom šume', () => {
	it('obe mapy majú rozmer rozlisenie×rozlisenie a sú to samostatné textúry', () => {
		const { map, roughnessMap } = vytvorStenuTexturu(THREE, 8);
		const mapCanvas = fakeCanvasOf(map);
		const roughCanvas = fakeCanvasOf(roughnessMap);
		expect(mapCanvas.width).toBe(8);
		expect(mapCanvas.height).toBe(8);
		expect(roughCanvas.width).toBe(8);
		expect(roughCanvas.height).toBe(8);
		expect(mapCanvas).not.toBe(roughCanvas);
	});

	it('deterministický pixel pri fixnom Math.random — farebná mapa je presný stred medzi základnou a tmavou farbou, alpha vždy 255', () => {
		const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
		try {
			const { map, roughnessMap } = vytvorStenuTexturu(THREE, 2);
			const mapCtx = fakeCanvasOf(map).getContext('2d')!;
			const roughCtx = fakeCanvasOf(roughnessMap).getContext('2d')!;
			// v = 0.5 konštantne (3-oktávový vážený priemer konštantných vzoriek 0.5
			// zostáva 0.5 nezávisle od váh) → miesaj(#c2ab84=[194,171,132],
			// #9c8158=[156,129,88], 0.5) = [175,150,110]
			const data = mapCtx.lastImageData!.data;
			expect(data[0]).toBe(175);
			expect(data[1]).toBe(150);
			expect(data[2]).toBe(110);
			expect(data[3]).toBe(255);
			// 4. pixel (2×2 canvas, byte offset 12) rovnaký — deterministické pre KAŽDÝ pixel
			expect(data[12]).toBe(175);
			expect(data[15]).toBe(255);

			// roughness: g = round(200 + 0.5×55) = round(227.5) = 228, r=g=b, alpha=255
			const rdata = roughCtx.lastImageData!.data;
			expect(rdata[0]).toBe(228);
			expect(rdata[1]).toBe(228);
			expect(rdata[2]).toBe(228);
			expect(rdata[3]).toBe(255);
		} finally {
			spy.mockRestore();
		}
	});
});

describe('vytvorKontaktnyTienTexturu — dvojvrstvový radiálny gradient, plne deterministický (žiadny Math.random)', () => {
	it('canvas rozlisenie×rozlisenie (default 512)', () => {
		const tex = vytvorKontaktnyTienTexturu(THREE);
		const canvas = fakeCanvasOf(tex);
		expect(canvas.width).toBe(512);
		expect(canvas.height).toBe(512);
	});

	it('mäkká vrstva — radiálny gradient v strede canvasu, polomer = polovica strany', () => {
		const tex = vytvorKontaktnyTienTexturu(THREE, 512);
		const ctx = fakeCanvasOf(tex).getContext('2d')!;
		expect(ctx.radialGradients).toHaveLength(2);
		const [mekka] = ctx.radialGradients;
		expect(mekka).toMatchObject({ x0: 256, y0: 256, r0: 0, x1: 256, y1: 256, r1: 256 });
		expect(mekka.grad.stops).toEqual([
			{ offset: 0, color: 'rgba(15,23,42,0.68)' },
			{ offset: 0.55, color: 'rgba(15,23,42,0.34)' },
			{ offset: 1, color: 'rgba(15,23,42,0)' }
		]);
	});

	it('tvrdé jadro — polomer je PRESNE 0,24 FRAKCIA CELEJ šírky canvasu (regresný test proti #181 nálezu — nie 0,24 z polovice)', () => {
		const tex = vytvorKontaktnyTienTexturu(THREE, 1000);
		const ctx = fakeCanvasOf(tex).getContext('2d')!;
		const [, jadro] = ctx.radialGradients;
		// jadroR = rozlisenie × 0,24 = 240 (NIE polovica×0,24=120 — presne TENTO omyl
		// opravil review #181 v komentári; tento test ho zamyká v samotnom KÓDE)
		expect(jadro.r1).toBe(240);
		expect(jadro).toMatchObject({ x0: 500, y0: 500, r0: 0, x1: 500, y1: 500 });
		expect(jadro.grad.stops).toEqual([
			{ offset: 0, color: 'rgba(15,23,42,0.38)' },
			{ offset: 0.85, color: 'rgba(15,23,42,0.3)' },
			{ offset: 1, color: 'rgba(15,23,42,0)' }
		]);
	});

	it('obe vrstvy pokrývajú celý canvas (2 fillRect volania cez celú plochu, v poradí mäkká→jadro)', () => {
		const tex = vytvorKontaktnyTienTexturu(THREE, 300);
		const ctx = fakeCanvasOf(tex).getContext('2d')!;
		expect(ctx.fillRectCalls).toEqual([
			{ x: 0, y: 0, w: 300, h: 300, fillStyle: ctx.radialGradients[0].grad },
			{ x: 0, y: 0, w: 300, h: 300, fillStyle: ctx.radialGradients[1].grad }
		]);
	});
});
