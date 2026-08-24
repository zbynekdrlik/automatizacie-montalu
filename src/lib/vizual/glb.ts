// AR náhľad pergoly (#286) — GLB export z vizuál scény pre `<model-viewer>` AR.
// JEDINÝ modul, ktorý zostaví binárny glTF (GLB) z konfigurácie zákazníka. Vlastný
// modul čítajúci zo scene grafu (reuse `builder.postavGeometrie`) — NULA zmien v
// `snimka.ts` / `scena.ts` render pipeline / supersample (build-only lane #286).
//
// DI-based (rovnaká disciplína ako `builder.ts`): `THREE`, `mergeGeometries` aj
// `GLTFExporter` sa berú ako PARAMETRE, nie top-level import — modul tak zostáva
// SSR-safe (bez top-level `three`) a priamo Node-testovateľný (stavba scény
// nepotrebuje WebGL kontext; GLTFExporter v Node potrebuje len `FileReader`
// polyfill — viď `$lib/server/filereader-polyfill.ts`, aplikuje ho VOLAJÚCI).
//
// PREČO product-only clean scéna (nie export živého render grafu):
//   - AR prekladá model na REÁLNU podlahu zákazníka → GLB nesmie obsahovať
//     syntetickú zem/stenu/oblohu/kontaktný tieň/svetlá (tie dodá AR viewer).
//   - `sklo` sa ZJEDNODUŠUJE na alpha (MeshStandardMaterial transparent+opacity),
//     NIE transmission — `KHR_materials_transmission` je v AR vieweroch (Scene
//     Viewer / Quick Look) nespoľahlivé (tiket #286).
//   - `ram` (práškovaný hliník) = DIELEKTRIKUM (metalness 0, roughness 0.35, #285)
//     na glTF core metallic-roughness; ŽIADNY clearcoat/transmission (KHR ext.).
//   - Mierka 1:1 (metre) — `builder.postavGeometrie` už prepočíta mm → metre.
//   - GLB obsahuje LEN geometriu + materiály — žiadny text/kód/cena/nárez (verejná
//     route, Money-neutrálne). Materiály sú pomenované neutrálne.
import type { BufferGeometry } from 'three';
import type { VizVysledok } from './spec';
import { postavGeometrie, type MergeGeometriesFn } from './builder';
import { farbaKonstrukcie } from '$lib/vykres/ral';
import type { SkloVzhlad } from './materialy';

type ThreeNS = typeof import('three');
type GLTFExporterCtor = typeof import('three/examples/jsm/exporters/GLTFExporter.js').GLTFExporter;

/** AR sklo je priehľadné (alpha), ale musí ostať VIDITEĽNÉ na streche — vzhľady
 *  skla (`pergola-sklo.ts`) sú ladené na transmission render, kde je opacity nízka
 *  (číre 0.16). V alpha režime by tak strecha bola takmer neviditeľná; opacitu
 *  preto zovrieme do rozsahu, kde sklo číta ako sklo, ale panely sú zreteľné. */
const AR_SKLO_OPACITY_MIN = 0.35;
const AR_SKLO_OPACITY_MAX = 0.72;
const AR_SKLO_FARBA_DEF = 0xeef3f1;
const AR_SKLO_ROUGHNESS_DEF = 0.12;

export interface GlbScena {
	scene: InstanceType<ThreeNS['Scene']>;
	/** geometrie + materiály na uvoľnenie po exporte (`uvolniGlbScenu`). */
	disposables: { dispose: () => void }[];
}

/** Zabezpečí, že geometria má normály — bez nich GLTFExporter vyexportuje model,
 *  ktorý sa v Scene Vieweri / Quick Look vykreslí PRÁZDNY (známa pasca #286). Box
 *  geometrie ich už majú; toto je poistka pre budúce (napr. extrude) tvary. */
function zabezpecNormaly(geo: BufferGeometry): void {
	if (!geo.getAttribute('normal')) geo.computeVertexNormals();
}

/** Zostaví čistú product-only THREE scénu (len role `ram` + `sklo`) v metroch,
 *  s AR-vhodnými materiálmi. Testovateľné v Node (žiadny WebGL kontext). */
export function postavGlbScenu(
	vysledok: VizVysledok,
	ralKod: string,
	skloVzhlad: SkloVzhlad,
	THREE: ThreeNS,
	mergeGeometries: MergeGeometriesFn
): GlbScena {
	const scene = new THREE.Scene();
	scene.name = 'pergola';
	const disposables: { dispose: () => void }[] = [];
	const poRolach = postavGeometrie(vysledok.diely, THREE, mergeGeometries);

	// --- konštrukcia (hliník) ---
	const ramGeo = poRolach.ram;
	if (ramGeo) {
		zabezpecNormaly(ramGeo);
		const farba = farbaKonstrukcie(ralKod);
		const ramMat = new THREE.MeshStandardMaterial({
			color: new THREE.Color(farba.hex),
			// #285: práškovaný hliník je dielektrikum (pigmentovaný lak), nie holý kov
			metalness: 0,
			roughness: 0.35
		});
		ramMat.name = 'konstrukcia';
		const mesh = new THREE.Mesh(ramGeo, ramMat);
		mesh.name = 'konstrukcia';
		scene.add(mesh);
		disposables.push(ramGeo, ramMat);
	}

	// --- strešné sklo (zjednodušené na alpha) ---
	const skloGeo = poRolach.sklo;
	if (skloGeo) {
		zabezpecNormaly(skloGeo);
		const opacity = Math.min(
			AR_SKLO_OPACITY_MAX,
			Math.max(AR_SKLO_OPACITY_MIN, skloVzhlad.opacity ?? 0.4)
		);
		const skloMat = new THREE.MeshStandardMaterial({
			color: new THREE.Color(skloVzhlad.farbaHex ?? AR_SKLO_FARBA_DEF),
			metalness: 0,
			roughness: skloVzhlad.roughness ?? AR_SKLO_ROUGHNESS_DEF,
			// alpha (nie transmission) — GLTFExporter zapíše alphaMode BLEND
			transparent: true,
			opacity
		});
		skloMat.name = 'sklo';
		const mesh = new THREE.Mesh(skloGeo, skloMat);
		mesh.name = 'sklo';
		scene.add(mesh);
		disposables.push(skloGeo, skloMat);
	}

	return { scene, disposables };
}

/** Vyexportuje scénu do binárneho GLB (`ArrayBuffer`). Volajúci na SERVERI musí
 *  PRED volaním aplikovať `ensureFileReaderPolyfill()` (GLTFExporter binárna
 *  vetva používa `FileReader`, ktorý v Node chýba); v prehliadači je natívny. */
export async function exportGlb(
	scene: InstanceType<ThreeNS['Scene']>,
	GLTFExporterCtor: GLTFExporterCtor
): Promise<ArrayBuffer> {
	const exporter = new GLTFExporterCtor();
	const out = await exporter.parseAsync(scene, {
		binary: true,
		onlyVisible: true
	});
	// s `binary: true` je návrat vždy ArrayBuffer (glТF JSON len pri binary:false)
	return out as ArrayBuffer;
}

/** Uvoľní geometrie/materiály scény (po exporte). V Node bez WebGL je to lacné,
 *  no držíme disciplínu explicitného dispose (rovnako ako `scena.disposeVsetko`). */
export function uvolniGlbScenu(glbScena: GlbScena): void {
	for (const d of glbScena.disposables) {
		try {
			d.dispose();
		} catch {
			// dispose nesmie zhodiť export cleanup
		}
	}
}
