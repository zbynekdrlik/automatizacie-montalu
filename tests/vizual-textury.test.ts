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
	vytvorStenuTexturu,
	vytvorTerasaAlphaTexturu,
	vytvorDreveneDrevoTexturu,
	vytvorOmietkaTexturu,
	vytvorHlinikNormalMapu,
	vytvorHlinikRoughMapu,
	vytvorDlazbuNormalMapu,
	vytvorSkloOdrazMapu
} from '../src/lib/vizual/textury';
import { vytvorStenu, vytvorZem } from '../src/lib/vizual/scena';
import { nastaveniaPreTier } from '../src/lib/vizual/kvalita';

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
		expect(ctx.linearGradients[0]!.grad.stops).toEqual([
			{ offset: 0, color: '#eef6fb' },
			{ offset: 1, color: '#4f80ad' }
		]);
		expect(ctx.fillRectCalls).toEqual([
			{ x: 0, y: 0, w: 256, h: 256, fillStyle: ctx.linearGradients[0]!.grad }
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
		expect(mekka!.grad.stops).toEqual([
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
		expect(jadro!.r1).toBe(240);
		expect(jadro).toMatchObject({ x0: 500, y0: 500, r0: 0, x1: 500, y1: 500 });
		expect(jadro!.grad.stops).toEqual([
			{ offset: 0, color: 'rgba(15,23,42,0.38)' },
			{ offset: 0.85, color: 'rgba(15,23,42,0.3)' },
			{ offset: 1, color: 'rgba(15,23,42,0)' }
		]);
	});

	it('obe vrstvy pokrývajú celý canvas (2 fillRect volania cez celú plochu, v poradí mäkká→jadro)', () => {
		const tex = vytvorKontaktnyTienTexturu(THREE, 300);
		const ctx = fakeCanvasOf(tex).getContext('2d')!;
		expect(ctx.fillRectCalls).toEqual([
			{ x: 0, y: 0, w: 300, h: 300, fillStyle: ctx.radialGradients[0]!.grad },
			{ x: 0, y: 0, w: 300, h: 300, fillStyle: ctx.radialGradients[1]!.grad }
		]);
	});
});

describe('nízky-tier flat-color fallback (scena.ts) sa ZHODUJE so ZÁKLADNOU farbou procedurálnej textúry (textury.ts) — regresná ochrana proti "zmenil som jednu, zabudol na druhú" (#177 vlastný text — presne toto #174 review predtým manuálne overoval)', () => {
	it('vytvorZem (low tier fallback) vs vytvorDlazbuTexturu základná farba (Math.random=>0.5 dáva jitter=0 => čistá báza)', () => {
		const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
		let dlazbaZaklad: string;
		try {
			const tex = vytvorDlazbuTexturu(THREE, 128, 4);
			const ctx = fakeCanvasOf(tex).getContext('2d')!;
			// 1. dlaždica (fillRectCalls[0] je základný fillRect špár) — jitter=(0.5*2-1)*0.06=0
			dlazbaZaklad = ctx.fillRectCalls[1]!.fillStyle as string;
		} finally {
			spy.mockRestore();
		}
		expect(dlazbaZaklad).toBe('rgb(167, 161, 153)'); // hexNaRgb('#a7a199')

		const zem = vytvorZem(THREE, nastaveniaPreTier('low'));
		const mat = zem.material as InstanceType<typeof THREE.MeshStandardMaterial>;
		// getHexString(SRGBColorSpace) — rovnaká sRGB reprezentácia, priamo porovnateľná
		// s vyššie odvodenou hex bázou (167,161,153 = a7a199)
		expect(mat.color.getHexString(THREE.SRGBColorSpace)).toBe('a7a199');
	});

	it('vytvorStenu (low tier fallback) vs vytvorStenuTexturu základná farba (Math.random=>0 dáva v=0 => čistý zaklad)', () => {
		const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
		let stenaZaklad: number[];
		try {
			const { map } = vytvorStenuTexturu(THREE, 2);
			const ctx = fakeCanvasOf(map).getContext('2d')!;
			const data = ctx.lastImageData!.data;
			stenaZaklad = [data[0]!, data[1]!, data[2]!];
		} finally {
			spy.mockRestore();
		}
		expect(stenaZaklad).toEqual([194, 171, 132]); // hexNaRgb('#c2ab84')

		const stena = vytvorStenu(THREE, nastaveniaPreTier('low'), 4200);
		const mat = stena.material as InstanceType<typeof THREE.MeshStandardMaterial>;
		expect(mat.color.getHexString(THREE.SRGBColorSpace)).toBe('c2ab84');
	});
});

describe('vytvorTerasaAlphaTexturu (#333) — obdĺžniková okrajová alpha (jadro opaque, okraj fade)', () => {
	it('jadro nepriehľadné (alpha 255), rohy priehľadné (alpha 0), biele RGB, NoColorSpace', () => {
		const R = 256;
		const tex = vytvorTerasaAlphaTexturu(THREE, R);
		expect(tex.colorSpace).toBe(THREE.NoColorSpace);
		const data = fakeCanvasOf(tex).getContext('2d')!.lastImageData!.data;
		const at = (x: number, y: number) => (y * R + x) * 4;
		// stred = footprint pergoly → PLNE nepriehľadný (dlažba pod stĺpmi ostáva)
		const c = at(R / 2, R / 2);
		expect(data[c + 3]).toBe(255);
		expect([data[c]!, data[c + 1]!, data[c + 2]!]).toEqual([255, 255, 255]);
		// rohy/hrany = vonkajší okraj → priehľadné (mäkký prechod do trávnika)
		expect(data[at(0, 0) + 3]).toBe(0);
		expect(data[at(R - 1, R / 2) + 3]).toBe(0);
		// bod tesne vnútri od hrany (d≈0,05 < pás 0,1) je čiastočne priehľadný, nie 0/255
		const okrajX = Math.round(0.05 * (R - 1));
		const a = data[at(okrajX, R / 2) + 3]!;
		expect(a).toBeGreaterThan(0);
		expect(a).toBeLessThan(255);
	});
});

describe('vytvorDreveneDrevoTexturu (#336) — ZVISLÁ kresba dreva (per-stĺpec prúžky + čiary)', () => {
	it('canvas 512×512, sRGB, needsUpdate (version>0)', () => {
		const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
		try {
			const tex = vytvorDreveneDrevoTexturu(THREE);
			const canvas = fakeCanvasOf(tex);
			expect(canvas.width).toBe(512);
			expect(canvas.height).toBe(512);
			expect(tex.colorSpace).toBe(THREE.SRGBColorSpace);
			expect(tex.version).toBeGreaterThan(0);
		} finally {
			spy.mockRestore();
		}
	});

	it('kreslí 512 ZVISLÝCH stĺpcov (w=1, h=512) + 10 letokruhových čiar = 522 fillRectov', () => {
		const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
		try {
			const tex = vytvorDreveneDrevoTexturu(THREE);
			const ctx = fakeCanvasOf(tex).getContext('2d')!;
			expect(ctx.fillRectCalls).toHaveLength(512 + 10);
			// prvých 512 = zvislé stĺpce (celá výška, 1 px široké) s rgb() farbou z base 0x6e5844
			expect(ctx.fillRectCalls[0]).toMatchObject({ x: 0, y: 0, w: 1, h: 512 });
			expect(String(ctx.fillRectCalls[0]!.fillStyle)).toMatch(/^rgb\(/);
			// čiary sú polopriehľadné tmavé (rgba) — jemný náznak
			expect(String(ctx.fillRectCalls[512]!.fillStyle)).toMatch(/^rgba\(40,28,18/);
		} finally {
			spy.mockRestore();
		}
	});
});

describe('vytvorOmietkaTexturu (#336) — svetlá odsaturovaná omietka (jemný šum)', () => {
	it('canvas 512×512, sRGB, version>0, per-pixel šum cez putImageData', () => {
		const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
		try {
			const tex = vytvorOmietkaTexturu(THREE);
			const canvas = fakeCanvasOf(tex);
			const ctx = canvas.getContext('2d')!;
			expect(canvas.width).toBe(512);
			expect(canvas.height).toBe(512);
			expect(tex.colorSpace).toBe(THREE.SRGBColorSpace);
			expect(tex.version).toBeGreaterThan(0);
			expect(ctx.lastImageData).not.toBeNull();
			expect(ctx.lastImageData!.width).toBe(512);
			// base je SVETLÝ (near-white omietka) — prvý pixel R kanál vysoký
			expect(ctx.lastImageData!.data[0]).toBeGreaterThan(200);
		} finally {
			spy.mockRestore();
		}
	});
});

// ── #356: procedurálne PBR mikro-reliéf mapy ─────────────────────────────────
// Rovnaký recording-stub prístup (`fakeCanvasOf` + `lastImageData`) — overuje
// SKUTOČNÝ obsah (normal = tangent-space, plochá plocha ~RGB(128,128,255);
// roughness = lineárna grayscale centrovaná ~1.0). `colorSpace = NoColorSpace`
// je load-bearing: normal/roughness dáta sú LINEÁRNE, nie sRGB — sRGB by three
// interpretoval nesprávne a reliéf/lesk by „driftol".

/** Prečíta RGBA jedného pixelu z nahratého `lastImageData`. */
function pixel(
	ctx: { lastImageData: { data: Uint8ClampedArray; width: number } | null },
	x: number,
	y: number
): [number, number, number, number] {
	const im = ctx.lastImageData!;
	const i = (y * im.width + x) * 4;
	return [im.data[i]!, im.data[i + 1]!, im.data[i + 2]!, im.data[i + 3]!];
}

describe('vytvorHlinikNormalMapu (#356) — jemný práškovaný mikro-reliéf', () => {
	it('NoColorSpace, version>0, plochý povrch ~RGB(128,128,255), Z kanál dominantný', () => {
		const tex = vytvorHlinikNormalMapu(THREE);
		const ctx = fakeCanvasOf(tex).getContext('2d')!;
		expect(tex.colorSpace).toBe(THREE.NoColorSpace);
		expect(tex.version).toBeGreaterThan(0);
		expect(ctx.lastImageData).not.toBeNull();
		expect(ctx.lastImageData!.width).toBe(256);
		// zrno je nízkoamplitúdové → normály sú blízko (0,0,1) = RGB ~(128,128,255).
		// Preveríme, že MODRÝ (Z) kanál je jednoznačne dominantný (skoro-plochá normála)
		// a X/Y ostávajú okolo stredu 128 (jemný, nie hrboľatý reliéf).
		let maxOdchylkaXY = 0;
		let minB = 255;
		for (let y = 0; y < 256; y += 37) {
			for (let x = 0; x < 256; x += 37) {
				const [r, g, b] = pixel(ctx, x, y);
				maxOdchylkaXY = Math.max(maxOdchylkaXY, Math.abs(r - 128), Math.abs(g - 128));
				minB = Math.min(minB, b);
			}
		}
		expect(maxOdchylkaXY).toBeGreaterThan(0); // NIE je to plochá (128,128,255) mapa
		expect(maxOdchylkaXY).toBeLessThan(60); // ale jemná (nie hrboľatý plast)
		expect(minB).toBeGreaterThan(200); // Z kanál stále dominantný
	});
});

describe('vytvorHlinikRoughMapu (#356) — jemné rozbitie lesku, centrované ~1.0', () => {
	it('NoColorSpace, grayscale, hodnoty v [0.84,1.0]·255 ≈ [214,255]', () => {
		const tex = vytvorHlinikRoughMapu(THREE);
		const ctx = fakeCanvasOf(tex).getContext('2d')!;
		expect(tex.colorSpace).toBe(THREE.NoColorSpace);
		let minV = 255;
		let maxV = 0;
		for (let y = 0; y < 256; y += 29) {
			for (let x = 0; x < 256; x += 29) {
				const [r, g, b] = pixel(ctx, x, y);
				expect(r).toBe(g); // grayscale
				expect(g).toBe(b);
				minV = Math.min(minV, r);
				maxV = Math.max(maxV, r);
			}
		}
		// roughnessMap MULTIPLIKUJE base roughness → musí byť blízko 1.0 (nie 0.5),
		// inak by drasticky znížila drsnosť. Centrovaná 0.92, rozsah ~±0.08.
		expect(minV).toBeGreaterThan(200); // ~0.84·255 = 214 (istá rezerva na sampling)
		expect(maxV).toBeLessThanOrEqual(255);
		expect(maxV).toBeGreaterThan(minV); // je tam VARIÁCIA (nie plochá)
	});
});

describe('vytvorDlazbuNormalMapu (#356) — zapustené škáry, zladené s albedom', () => {
	it('NoColorSpace; škára sa reliéfne líši od stredu dlaždice', () => {
		const N = 512;
		const mriezka = 4;
		const bunka = N / mriezka; // 128
		const tex = vytvorDlazbuNormalMapu(THREE, N, mriezka);
		const ctx = fakeCanvasOf(tex).getContext('2d')!;
		expect(tex.colorSpace).toBe(THREE.NoColorSpace);
		// stred dlaždice (ďaleko od škár) — takmer plochý reliéf (Z dominantný)
		const stred = pixel(ctx, Math.round(bunka / 2), Math.round(bunka / 2));
		expect(stred[2]).toBeGreaterThan(220);
		// TESNE pri mriežkovej čiare (x≈bunka, kde je špára) — normála sa výrazne
		// nakloní (X kanál odbočí od 128, lebo výška padá do zapustenej škáry)
		const priSkare = pixel(ctx, bunka - 1, Math.round(bunka / 2));
		expect(Math.abs(priSkare[0] - 128)).toBeGreaterThan(Math.abs(stred[0] - 128));
	});
});

describe('vytvorSkloOdrazMapu (#356) — jemné rozbitie clearcoat odrazu', () => {
	it('NoColorSpace, version>0, veľmi jemná (Z takmer 255)', () => {
		const tex = vytvorSkloOdrazMapu(THREE);
		const ctx = fakeCanvasOf(tex).getContext('2d')!;
		expect(tex.colorSpace).toBe(THREE.NoColorSpace);
		expect(tex.version).toBeGreaterThan(0);
		let minB = 255;
		for (let y = 0; y < 256; y += 41) {
			for (let x = 0; x < 256; x += 41) minB = Math.min(minB, pixel(ctx, x, y)[2]);
		}
		expect(minB).toBeGreaterThan(230); // minimálna amplitúda → priehľad ostáva čistý
	});
});
