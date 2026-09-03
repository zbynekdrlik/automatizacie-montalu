// Zákaznícky 3D náhľad (#170) — unit testy `builder.ts`, jediné miesto mm→m
// prepočtu. `BufferGeometry` sa dá stavať v čistom Node (Vitest) bez canvas/
// WebGL — ten treba až pri `renderer.render()`, nie pri stavbe geometrie.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { postavGeometrie } from '../src/lib/vizual/builder';
import type { DielSpec } from '../src/lib/vizual/spec';

describe('postavGeometrie — mm → m hranica a merge per rola', () => {
	it('box 1000×2000×500 mm → bounding box presne 1×2×0.5 m (jediné delenie v celom module)', () => {
		const diely: DielSpec[] = [
			{ rola: 'ram', tvar: { kind: 'box', w: 1000, h: 2000, d: 500 }, pos: { x: 0, y: 0, z: 0 } }
		];
		const out = postavGeometrie(diely, THREE, mergeGeometries);
		expect(out.ram).toBeDefined();
		out.ram!.computeBoundingBox();
		const bb = out.ram!.boundingBox!;
		expect(bb.max.x - bb.min.x).toBeCloseTo(1, 6);
		expect(bb.max.y - bb.min.y).toBeCloseTo(2, 6);
		expect(bb.max.z - bb.min.z).toBeCloseTo(0.5, 6);
	});

	it('pos je STRED — box posunutý na pos={x:1000,y:0,z:0} má stred bbox v x=1m', () => {
		const diely: DielSpec[] = [
			{ rola: 'sklo', tvar: { kind: 'box', w: 200, h: 200, d: 8 }, pos: { x: 1000, y: 0, z: 0 } }
		];
		const out = postavGeometrie(diely, THREE, mergeGeometries);
		out.sklo!.computeBoundingBox();
		const bb = out.sklo!.boundingBox!;
		expect((bb.max.x + bb.min.x) / 2).toBeCloseTo(1, 6);
	});

	it('viacero dielov TEJ ISTEJ roly sa zlúčia do JEDNEJ BufferGeometry (1 draw call na rolu)', () => {
		const diely: DielSpec[] = [
			{ rola: 'sklo', tvar: { kind: 'box', w: 100, h: 100, d: 8 }, pos: { x: 0, y: 0, z: 0 } },
			{ rola: 'sklo', tvar: { kind: 'box', w: 100, h: 100, d: 8 }, pos: { x: 500, y: 0, z: 0 } }
		];
		const out = postavGeometrie(diely, THREE, mergeGeometries);
		expect(Object.keys(out)).toEqual(['sklo']);
		out.sklo!.computeBoundingBox();
		const bb = out.sklo!.boundingBox!;
		// dva boxy 0.1m široké, stredy v x=0 a x=0.5 -> spolu od -0.05 po 0.55
		expect(bb.min.x).toBeCloseTo(-0.05, 6);
		expect(bb.max.x).toBeCloseTo(0.55, 6);
	});

	it('rola s 0 dielmi sa do výsledku vôbec nevloží (žiadny prázdny kľúč)', () => {
		const diely: DielSpec[] = [
			{ rola: 'ram', tvar: { kind: 'box', w: 10, h: 10, d: 10 }, pos: { x: 0, y: 0, z: 0 } }
		];
		const out = postavGeometrie(diely, THREE, mergeGeometries);
		expect(out.klucka).toBeUndefined();
		expect(out.sietka).toBeUndefined();
		expect(out.klin).toBeUndefined();
	});

	it('extrude (klin) — obrys v mm sa prepočíta na m, hĺbka extrúzie tiež', () => {
		const diely: DielSpec[] = [
			{
				rola: 'klin',
				tvar: {
					kind: 'extrude',
					obrys: [
						[0, 0],
						[0, 100],
						[800, 60],
						[800, 0]
					],
					dlzka: 200
				},
				pos: { x: 0, y: 0, z: 0 }
			}
		];
		const out = postavGeometrie(diely, THREE, mergeGeometries);
		expect(out.klin).toBeDefined();
		out.klin!.computeBoundingBox();
		const bb = out.klin!.boundingBox!;
		expect(bb.max.x - bb.min.x).toBeCloseTo(0.8, 3);
		expect(bb.max.z - bb.min.z).toBeCloseTo(0.2, 3);
	});
});

describe('postavGeometrie — #356 box UV v METROCH (svetová hustota textúr)', () => {
	it('BoxGeometry UV nie sú 0..1 na plochu, ale škálované na fyzickú veľkosť plochy (m)', () => {
		const diely: DielSpec[] = [
			{ rola: 'ram', tvar: { kind: 'box', w: 2000, h: 2000, d: 60 }, pos: { x: 0, y: 0, z: 0 } }
		];
		const out = postavGeometrie(diely, THREE, mergeGeometries);
		const uv = out.ram!.attributes.uv!;
		let maxU = 0;
		let maxV = 0;
		for (let i = 0; i < uv.count; i++) {
			maxU = Math.max(maxU, uv.getX(i));
			maxV = Math.max(maxV, uv.getY(i));
		}
		// najväčšia plocha (pz/py: w=2 m) → U/V dosiahne ~2.0 m, nie default 1.0
		expect(maxU).toBeCloseTo(2.0, 5);
		expect(maxV).toBeCloseTo(2.0, 5);
	});

	it('tenký profil: úzka os plochy má malú UV šírku (žiadne 70:1 natiahnutie mapy)', () => {
		// 4200×50×60 mm profil: px/nx plocha U=d=0.06 m, V=h=0.05 m (obe malé) — mapa
		// s repeat=dlaždice/m tiluje rovnomerne, nie natiahnuto pozdĺž dĺžky.
		const diely: DielSpec[] = [
			{ rola: 'ram', tvar: { kind: 'box', w: 4200, h: 50, d: 60 }, pos: { x: 0, y: 0, z: 0 } }
		];
		const out = postavGeometrie(diely, THREE, mergeGeometries);
		const uv = out.ram!.attributes.uv!;
		let maxU = 0;
		for (let i = 0; i < uv.count; i++) maxU = Math.max(maxU, uv.getX(i));
		// najdlhšia os (w=4.2 m) je na py/ny/pz/nz ploche U; pri per-face 0..1 by tu bola 1,
		// pri metroch je to 4.2 → mapa nie je zlisovaná do 1 plochy
		expect(maxU).toBeCloseTo(4.2, 4);
	});
});
