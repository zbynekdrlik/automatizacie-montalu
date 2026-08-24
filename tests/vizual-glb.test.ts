// AR náhľad pergoly (#286) — GLB export modul (`src/lib/vizual/glb.ts`). Testuje
// stavbu product-only scény v Node (three beží v Node bez WebGL — rovnako ako
// vizual-builder/vizual-scena testy) + skutočný binárny GLTFExporter výstup (validná
// glTF magic hlavička) s `FileReader` polyfillom (server-side vetva GLTFExporter-a).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { postavGlbScenu, exportGlb, uvolniGlbScenu } from '../src/lib/vizual/glb';
import { pergolaSpec } from '../src/lib/vizual/geo/pergola';
import { pergolaSkloVzhlad } from '../src/lib/vizual/pergola-sklo';
import { farbaKonstrukcie } from '../src/lib/vykres/ral';
import { ensureFileReaderPolyfill } from '../src/lib/server/filereader-polyfill';

const VSTUP = {
	sirkaMm: 5000,
	hlbkaMm: 4000,
	vyskaVpreduMm: 2500,
	vyskaPriSteneMm: 2900,
	typStrechy: 'pultova' as const,
	ralKod: '7016'
};

function meshPodlaMena(scena: THREE.Scene, meno: string): THREE.Mesh | null {
	let out: THREE.Mesh | null = null;
	scena.traverse((o) => {
		if ((o as THREE.Mesh).isMesh && o.name === meno) out = o as THREE.Mesh;
	});
	return out;
}

describe('vizual/glb — postavGlbScenu (product-only AR scéna)', () => {
	it('scéna obsahuje LEN role ram (konštrukcia) + sklo — žiadna zem/stena/obloha/svetlá', () => {
		const vysledok = pergolaSpec(VSTUP);
		const glb = postavGlbScenu(
			vysledok,
			VSTUP.ralKod,
			pergolaSkloVzhlad('cire'),
			THREE,
			mergeGeometries
		);
		const meshe: THREE.Mesh[] = [];
		const svetla: THREE.Light[] = [];
		glb.scene.traverse((o) => {
			if ((o as THREE.Mesh).isMesh) meshe.push(o as THREE.Mesh);
			if ((o as THREE.Light).isLight) svetla.push(o as THREE.Light);
		});
		expect(meshe.length).toBe(2); // konštrukcia + sklo, každá zliata do 1 meshu
		expect(new Set(meshe.map((m) => m.name))).toEqual(new Set(['konstrukcia', 'sklo']));
		expect(svetla.length).toBe(0); // svetlá dodá AR viewer, nie GLB
		uvolniGlbScenu(glb);
	});

	it('konštrukcia = dielektrický hliník (metalness 0), farba z RAL kódu', () => {
		const vysledok = pergolaSpec(VSTUP);
		const glb = postavGlbScenu(
			vysledok,
			VSTUP.ralKod,
			pergolaSkloVzhlad('cire'),
			THREE,
			mergeGeometries
		);
		const ram = meshPodlaMena(glb.scene, 'konstrukcia');
		expect(ram).not.toBeNull();
		const mat = ram!.material as THREE.MeshStandardMaterial;
		expect(mat.metalness).toBe(0);
		expect(mat.roughness).toBeCloseTo(0.35, 5);
		// farba zodpovedá RAL 7016 (cez farbaKonstrukcie, sRGB→linear cez THREE.Color)
		const ocakavana = new THREE.Color(farbaKonstrukcie('7016').hex);
		expect(mat.color.getHexString()).toBe(ocakavana.getHexString());
		uvolniGlbScenu(glb);
	});

	it('sklo = alpha (transparent, NIE transmission); opacita zovretá do AR rozsahu', () => {
		const vysledok = pergolaSpec(VSTUP);
		// číre sklo má vzhľad.opacity 0.16 → pod AR minimom 0.35 → zovrie sa NAHOR na 0.35
		const cire = postavGlbScenu(
			vysledok,
			VSTUP.ralKod,
			pergolaSkloVzhlad('cire'),
			THREE,
			mergeGeometries
		);
		const skloCire = meshPodlaMena(cire.scene, 'sklo')!.material as THREE.MeshStandardMaterial;
		expect(skloCire.transparent).toBe(true);
		// MeshStandardMaterial (NIE MeshPhysicalMaterial) → žiadny transmission pass v GLB
		expect(skloCire.type).toBe('MeshStandardMaterial');
		expect((skloCire as unknown as { transmission?: number }).transmission).toBeUndefined();
		expect(skloCire.opacity).toBeCloseTo(0.35, 5);
		uvolniGlbScenu(cire);

		// matné sklo má vzhľad.opacity 0.62 → v rozsahu [0.35, 0.72] → ostáva 0.62
		const matne = postavGlbScenu(
			vysledok,
			VSTUP.ralKod,
			pergolaSkloVzhlad('matne'),
			THREE,
			mergeGeometries
		);
		const skloMatne = meshPodlaMena(matne.scene, 'sklo')!.material as THREE.MeshStandardMaterial;
		expect(skloMatne.opacity).toBeCloseTo(0.62, 5);
		uvolniGlbScenu(matne);
	});

	it('všetky geometrie majú normály (inak prázdny render v Scene Viewer)', () => {
		const vysledok = pergolaSpec(VSTUP);
		const glb = postavGlbScenu(
			vysledok,
			VSTUP.ralKod,
			pergolaSkloVzhlad('cire'),
			THREE,
			mergeGeometries
		);
		glb.scene.traverse((o) => {
			const m = o as THREE.Mesh;
			if (m.isMesh) expect(m.geometry.getAttribute('normal')).toBeTruthy();
		});
		uvolniGlbScenu(glb);
	});

	it('prázdny SkloVzhlad {} → sklo materiál použije AR defaulty (farba/opacita/drsnosť)', () => {
		const vysledok = pergolaSpec(VSTUP);
		// prázdny vzhľad → všetky `?? default` vetvy: opacity 0.4 (v rozsahu), farba 0xeef3f1,
		// roughness 0.12
		const glb = postavGlbScenu(vysledok, VSTUP.ralKod, {}, THREE, mergeGeometries);
		const sklo = meshPodlaMena(glb.scene, 'sklo')!.material as THREE.MeshStandardMaterial;
		expect(sklo.opacity).toBeCloseTo(0.4, 5);
		expect(sklo.roughness).toBeCloseTo(0.12, 5);
		expect(sklo.color.getHexString()).toBe(new THREE.Color(0xeef3f1).getHexString());
		uvolniGlbScenu(glb);
	});

	it('scéna je v METROCH (mierka 1:1) — šírka konštrukcie ≈ sirka/1000', () => {
		const vysledok = pergolaSpec(VSTUP);
		const glb = postavGlbScenu(
			vysledok,
			VSTUP.ralKod,
			pergolaSkloVzhlad('cire'),
			THREE,
			mergeGeometries
		);
		const ram = meshPodlaMena(glb.scene, 'konstrukcia')!;
		ram.geometry.computeBoundingBox();
		const bb = ram.geometry.boundingBox!;
		// nosníky idú po celej šírke (5000 mm), krajné stĺpy pridajú ~100 mm → rozpätie X
		// je ~5,1 m — jednoznačne METRE (nie 5000 = mm). Presné rozmery drží builder test.
		const rozpatieX = bb.max.x - bb.min.x;
		expect(rozpatieX).toBeGreaterThan(4.9);
		expect(rozpatieX).toBeLessThan(5.3);
		// päta konštrukcie je na y≈0 (sadne na AR podlahu)
		expect(bb.min.y).toBeCloseTo(0, 1);
		uvolniGlbScenu(glb);
	});
});

describe('vizual/glb — exportGlb (binárny glTF)', () => {
	it('vyprodukuje validný GLB: magic "glTF", verzia 2, deklarovaná dĺžka == bajty', async () => {
		ensureFileReaderPolyfill();
		const vysledok = pergolaSpec(VSTUP);
		const glb = postavGlbScenu(
			vysledok,
			VSTUP.ralKod,
			pergolaSkloVzhlad('cire'),
			THREE,
			mergeGeometries
		);
		const buf = await exportGlb(glb.scene, GLTFExporter);
		uvolniGlbScenu(glb);

		expect(buf.byteLength).toBeGreaterThan(500); // netriviálny model
		const dv = new DataView(buf);
		// GLB header: magic (0x46546C67 = "glTF" LE), version, total length
		const magic = new TextDecoder().decode(new Uint8Array(buf, 0, 4));
		expect(magic).toBe('glTF');
		expect(dv.getUint32(4, true)).toBe(2); // glTF verzia 2
		expect(dv.getUint32(8, true)).toBe(buf.byteLength); // deklarovaná dĺžka == skutočná
	});
});
