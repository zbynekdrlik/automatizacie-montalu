// Zákaznícky 3D náhľad (#170) — JEDINÉ miesto v `src/lib/vizual/**`, kde sa volá
// `mm()` (prepočet mm → three.js metre). Berie THREE-free `DielSpec[]` a stavia
// zlúčenú `BufferGeometry` PER ROLA (jeden mesh na rolu = jeden material draw
// call, dôležité najmä pre sklo — §2.6 "všetky tabule zliate do jednej
// geometrie a jednej inštancie materiálu").
//
// `THREE` aj `mergeGeometries` (z `three/examples/jsm/utils/BufferGeometryUtils.js`,
// samostatný modul mimo jadra `three`) sa berú ako PARAMETRE, nie top-level
// import — volajúci (`scena.ts`) ich už drží z vlastného `onMount` dynamic
// importu (SSR-bezpečnosť, §2.2). Vďaka tomu je tento súbor navyše priamo
// unit-testovateľný v Node (Vitest) — samotná stavba `BufferGeometry` v three.js
// nepotrebuje canvas/WebGL kontext, ten treba až pri `renderer.render()`.
import type { BufferGeometry } from 'three';
import type { DielSpec, Rola, Tvar } from './spec';
import { mm } from './jednotky';

type ThreeNS = typeof import('three');
// `BufferGeometry` sa importuje ako TYP priamo z `'three'` (nie odvodený cez
// `InstanceType<ThreeNS['BufferGeometry']>`) — tie dve cesty vedú k INÝM
// generickým defaultom (`NormalBufferAttributes` vs. `NormalOrGLBufferAttributes`)
// a `BufferGeometryUtils.d.ts`'s `mergeGeometries` používa práve ten priamy typ.
export type MergeGeometriesFn = (
	geometries: BufferGeometry[],
	useGroups?: boolean
) => BufferGeometry;

/** #356 — prepíše `BoxGeometry` UV z default 0..1 per plocha na METRE (fyzická veľkosť
 *  plochy), aby textúrové mapy (#356 hliník/sklo mikro-reliéf) tilovali rovnomerne cez
 *  VŠETKY plochy pri `RepeatWrapping` + `repeat = dlaždice/meter` — bez toho by tenký
 *  profil (napr. 4200×50 mm) natiahol mapu ~70:1 a reliéf by sa buď mip-oval na plocho,
 *  alebo ukázal ako smerové pruhy (review 🟡). BoxGeometry poradie plôch (three r0.185):
 *  px,nx,py,ny,pz,nz; U/V každej plochy = (`buildPlane` width, height):
 *  px/nx → (d,h), py/ny → (w,d), pz/nz → (w,h). Neškodné pre materiály bez mapy
 *  (sietka/plné farby UV nečítajú), viditeľné len pre #356 mapy. */
function metreUvBox(geo: BufferGeometry, wM: number, hM: number, dM: number): void {
	const uv = geo.attributes.uv;
	if (!uv) return;
	const spanU = [dM, dM, wM, wM, wM, wM]; // px,nx,py,ny,pz,nz
	const spanV = [hM, hM, dM, dM, hM, hM];
	for (let f = 0; f < 6; f++) {
		for (let k = 0; k < 4; k++) {
			// 4 vrcholy na plochu (1 segment) — poradie zhodné s addGroup poradím
			const idx = f * 4 + k;
			uv.setXY(idx, uv.getX(idx) * spanU[f]!, uv.getY(idx) * spanV[f]!);
		}
	}
	uv.needsUpdate = true;
}

/** Postaví lokálnu geometriu jedného dielu (bez posunu) — box priamo THREE-ovým
 *  `BoxGeometry` (centrovaný v strede, presne sedí s `DielSpec.pos` = stred),
 *  extrude cez `Shape` + `ExtrudeGeometry` centrovanú pozdĺž extrúznej osi (Z),
 *  takže `pos` má rovnaký význam ("stred") pre oba druhy tvaru. */
function lokalnaGeometria(tvar: Tvar, THREE: ThreeNS): BufferGeometry {
	if (tvar.kind === 'box') {
		const wM = mm(tvar.w);
		const hM = mm(tvar.h);
		const dM = mm(tvar.d);
		const geo = new THREE.BoxGeometry(wM, hM, dM);
		// #356: UV na METRE → textúrové mapy tilujú svetovo-rovnomerne (viď metreUvBox).
		// Zjednocuje s ExtrudeGeometry (tá už má svetové UV zo shape súradníc v mm→m).
		metreUvBox(geo, wM, hM, dM);
		return geo;
	}
	const shape = new THREE.Shape();
	const [prvy, ...ostatne] = tvar.obrys; // extrude tvar má vždy neprázdny obrys
	shape.moveTo(mm(prvy![0]), mm(prvy![1]));
	for (const [x, y] of ostatne) shape.lineTo(mm(x), mm(y));
	shape.closePath();
	const hlbka = mm(tvar.dlzka);
	const geo = new THREE.ExtrudeGeometry(shape, { depth: hlbka, bevelEnabled: false, steps: 1 });
	// ExtrudeGeometry extruduje lokálne od z=0 po z=hĺbka — posunieme o
	// polovicu späť, aby `pos.z` reprezentoval STRED extrúzie rovnako ako pri
	// boxe, nie jej prednú stenu.
	geo.translate(0, 0, -hlbka / 2);
	return geo;
}

/** `DielSpec[] -> merged BufferGeometry per rola`, jednotky = metre. Prázdna
 *  rola (0 dielov danej roly, napr. žiadna kľučka) sa do výsledku VÔBEC
 *  nevloží — konzument (`scena.ts`) tak vie priamo z prítomnosti kľúča, či má
 *  daný mesh vytvoriť. */
export function postavGeometrie(
	diely: DielSpec[],
	THREE: ThreeNS,
	mergeGeometries: MergeGeometriesFn
): Partial<Record<Rola, BufferGeometry>> {
	const poRolach = new Map<Rola, BufferGeometry[]>();

	for (const diel of diely) {
		const geo = lokalnaGeometria(diel.tvar, THREE);
		if (diel.rot) {
			geo.rotateX(diel.rot.x);
			geo.rotateY(diel.rot.y);
			geo.rotateZ(diel.rot.z);
		}
		geo.translate(mm(diel.pos.x), mm(diel.pos.y), mm(diel.pos.z));
		const zoznam = poRolach.get(diel.rola) ?? [];
		zoznam.push(geo);
		poRolach.set(diel.rola, zoznam);
	}

	const out: Partial<Record<Rola, BufferGeometry>> = {};
	for (const [rola, geometrie] of poRolach) {
		out[rola] = geometrie.length === 1 ? geometrie[0] : mergeGeometries(geometrie, false);
	}
	return out;
}
