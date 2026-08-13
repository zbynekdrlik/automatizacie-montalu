// Zákaznícky 3D náhľad (#170, vizuálna iterácia #174 — ZNOVUOTVORENÉ) — unit
// testy `scena.ts`'s mesh-building funkcie (`vytvorZem`/`vytvorStenu`/
// `vytvorKontaktnyTien`), doteraz NETESTOVANÉ priamo (#177 follow-up bol o
// `textury.ts`/`scena.ts` chýbajúcich testoch všeobecne — TENTO súbor je
// konkrétne #174's vlastný regression test pre "jednotka sa vznáša").
//
// `vytvorKontaktnyTien`/`vytvorZem`(high tier)/`vytvorStenu`(high tier) volajú
// `textury.ts`'s `document.createElement('canvas').getContext('2d')` — Node
// vitest beží v 'node' prostredí (žiadny jsdom v repe), takže bez polyfillu by
// `document` neexistoval. Nižšie je MINIMÁLNY no-op canvas 2D stub (obsah
// pixelov je appke jedno pre tento test — testuje sa POZÍCIA/GEOMETRIA
// meshov, nie vykreslený obraz) — pokrýva presne tú podmnožinu Canvas 2D API,
// ktorú `textury.ts` skutočne volá (`createLinearGradient`/
// `createRadialGradient`/`addColorStop`/`fillRect`/`fillStyle`/
// `createImageData`/`putImageData`).
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { postavGeometrie } from '../src/lib/vizual/builder';
import { zaskleniaSpec } from '../src/lib/vizual/geo/zasklenia';
import { vytvorKontaktnyTien, vytvorStenu, vytvorZem } from '../src/lib/vizual/scena';
import { nastaveniaPreTier } from '../src/lib/vizual/kvalita';
import { mm } from '../src/lib/vizual/jednotky';

beforeAll(() => {
	class FakeGradient {
		addColorStop(): void {
			/* no-op — obsah pixelov appke pre tento test nezáleží */
		}
	}
	class FakeCtx {
		fillStyle: unknown = '#000';
		createLinearGradient(): FakeGradient {
			return new FakeGradient();
		}
		createRadialGradient(): FakeGradient {
			return new FakeGradient();
		}
		fillRect(): void {
			/* no-op */
		}
		createImageData(
			w: number,
			h: number
		): { data: Uint8ClampedArray; width: number; height: number } {
			return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
		}
		putImageData(): void {
			/* no-op */
		}
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

/** Typická repro konfigurácia z #174: Robust 3K, 4200×2100mm, PL. */
function repro() {
	return zaskleniaSpec({ s: 4200, v: 2100, n: 3, smer: 'PL', ralKod: '7016' });
}

describe('scena — #174 ZNOVUOTVORENÉ: svetové Y spodku jednotky/zeme/steny/tieňa sú ZHODNÉ', () => {
	it('spodok zlúčenej geometrie produktu (najnižší bod spomedzi všetkých rolí) == 0', () => {
		const vysledok = repro();
		const geometrie = postavGeometrie(vysledok.diely, THREE, mergeGeometries);
		let minY = Infinity;
		for (const rola of Object.keys(geometrie) as (keyof typeof geometrie)[]) {
			const g = geometrie[rola]!;
			g.computeBoundingBox();
			minY = Math.min(minY, g.boundingBox!.min.y);
		}
		// spodná koľajnica definuje "y=0 = spodok spodnej koľajnice" (viď
		// geo/zasklenia.ts hlavičkový komentár) — presnosť na float32 epsilon
		expect(minY).toBeCloseTo(0, 5);
	});

	it('zem (vytvorZem) — rovina je na y=0 (žiadny vertikálny posun)', () => {
		const nastavenia = nastaveniaPreTier('low'); // plochyGradientMiestoMap — vyhne sa canvasu, netýka sa Y
		const zem = vytvorZem(THREE, nastavenia);
		expect(zem.position.y).toBe(0);
		zem.geometry.computeBoundingBox();
		expect(zem.geometry.boundingBox!.min.y).toBeCloseTo(0, 10);
		expect(zem.geometry.boundingBox!.max.y).toBeCloseTo(0, 10);
	});

	it('stena (vytvorStenu) — základňa (spodná hrana) je na y=0, nezávisle od Z posunu', () => {
		const nastavenia = nastaveniaPreTier('high'); // reálna cesta cez canvas textúru (polyfillovaná vyššie)
		const stena = vytvorStenu(THREE, nastavenia, 4200);
		stena.position.z = -1; // simuluje Vizual3D.svelte's `stena.position.z = -(...)`
		expect(stena.position.y).toBe(0);
		stena.geometry.computeBoundingBox();
		const worldMinY = stena.geometry.boundingBox!.min.y + stena.position.y;
		expect(worldMinY).toBeCloseTo(0, 10);
	});

	it('kontaktný tieň (vytvorKontaktnyTien) — CENTROVANÝ na pôdoryse (x=0, z=0), Y len 2mm dekal-offset', () => {
		const tien = vytvorKontaktnyTien(THREE, 4200, 122, 2100);
		// #174 ZNOVUOTVORENÉ nález: predošlý kód posúval x/z v azimute svetla
		// (Math.sin/cos(KEY_SVETLO_AZIMUT_RAD + PI) * posunM) — presne TOTO by
		// tento test odhalil, keby sa niekto vrátil k tomu vzoru.
		expect(tien.position.x).toBe(0);
		expect(tien.position.z).toBe(0);
		// y = 2mm nad zemou JE zámerný (z-fighting), nie bug — overuje sa
		// PRESNE táto hodnota (nie 0), aby test odlíšil "žiadny X/Z posun" od
		// "žiadny posun vôbec"
		expect(tien.position.y).toBeCloseTo(mm(2), 10);
	});

	it('svetové Y spodku jednotky, zeme, základne steny A roviny tieňa sú si navzájom ZHODNÉ (do 3mm — tieň úmyselne 2mm nad kvôli z-fighting)', () => {
		const vysledok = repro();
		const geometrie = postavGeometrie(vysledok.diely, THREE, mergeGeometries);
		let jednotkaMinY = Infinity;
		for (const rola of Object.keys(geometrie) as (keyof typeof geometrie)[]) {
			const g = geometrie[rola]!;
			g.computeBoundingBox();
			jednotkaMinY = Math.min(jednotkaMinY, g.boundingBox!.min.y);
		}

		const zem = vytvorZem(THREE, nastaveniaPreTier('low'));
		const stena = vytvorStenu(THREE, nastaveniaPreTier('high'), vysledok.bbox.w);
		stena.position.z = -(mm(vysledok.bbox.d) / 2 + 0.05);
		stena.geometry.computeBoundingBox();
		const stenaMinY = stena.geometry.boundingBox!.min.y + stena.position.y;

		const tien = vytvorKontaktnyTien(THREE, vysledok.bbox.w, vysledok.bbox.d, vysledok.bbox.h);

		// zem a spodok jednotky/steny sú PRESNE zhodné (0)
		expect(jednotkaMinY).toBeCloseTo(zem.position.y, 5);
		expect(stenaMinY).toBeCloseTo(zem.position.y, 5);
		// tieň je do 3mm od zeme (2mm zámerný z-fighting offset, nie "vznášanie")
		expect(Math.abs(tien.position.y - zem.position.y)).toBeLessThan(0.003);
	});
});

describe('scena — #174 ZNOVUOTVORENÉ: kontaktný tieň sleduje PODLHOVASTÝ pôdorys (nie kruh v štvorci)', () => {
	it('rovina tieňa NIE JE štvorec pre širokú/plytkú jednotku — šírka (X) sa škáluje s bbox.w, hĺbka (Z) NEZÁVISLE', () => {
		// 4200×150mm pôdorys (pomer strán 28:1) — pôvodný bug: štvorcová rovina
		// podľa Math.max(w,d)=4200 dala KRUHOVÝ tvrdý gradient s polomerom len
		// ~680mm, ktorý zďaleka nedosiahol ku koncom 2100mm-polovičnej šírky
		// koľajnice ("pravý spodný roh visí vo vzduchu", troStvrte #174).
		const tien = vytvorKontaktnyTien(THREE, 4200, 150, 2100);
		tien.geometry.computeBoundingBox();
		const bb = tien.geometry.boundingBox!;
		const sirkaM = bb.max.x - bb.min.x;
		const hlbkaM = bb.max.z - bb.min.z;
		// šírka musí pokryť CELÚ dĺžku koľajnice s rezervou (>= bbox.w)
		expect(sirkaM).toBeGreaterThan(mm(4200));
		// hĺbka SMIE byť oveľa menšia než šírka — presne TOTO predtým nebola
		// pravda (štvorcová rovina mala hlbkaM === sirkaM)
		expect(hlbkaM).toBeLessThan(sirkaM * 0.5);
	});

	it('širšia jednotka → širšia (X) tieňová rovina (monotónnosť, škáluje sa s bbox.w)', () => {
		const maly = vytvorKontaktnyTien(THREE, 1500, 150, 1500);
		const velky = vytvorKontaktnyTien(THREE, 6000, 150, 2200);
		maly.geometry.computeBoundingBox();
		velky.geometry.computeBoundingBox();
		const sirkaMaly = maly.geometry.boundingBox!.max.x - maly.geometry.boundingBox!.min.x;
		const sirkaVelky = velky.geometry.boundingBox!.max.x - velky.geometry.boundingBox!.min.x;
		expect(sirkaVelky).toBeGreaterThan(sirkaMaly);
	});

	it('extrémne plytký pôdorys (malé bbox.d) NEDÁ neviditeľne tenký tieň — hĺbka má spodnú hranicu odvodenú z výšky', () => {
		// keby hlbkaM čerpala LEN z bbox.d (bez `Math.max(..., mm(h)*0.45)`
		// poistky), 90mm hlboký posuv by dal tieň hrubý len ~120mm (90*1.35) —
		// tenší než jeho vlastný mäkký polomer, prakticky neviditeľný pruh.
		const tien = vytvorKontaktnyTien(THREE, 4200, 90, 2100);
		tien.geometry.computeBoundingBox();
		const hlbkaM = tien.geometry.boundingBox!.max.z - tien.geometry.boundingBox!.min.z;
		expect(hlbkaM).toBeGreaterThan(0.3); // aspoň 300mm — čitateľná "mláka", nie vlas
	});
});
