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

/** Postaví lokálnu geometriu jedného dielu (bez posunu) — box priamo THREE-ovým
 *  `BoxGeometry` (centrovaný v strede, presne sedí s `DielSpec.pos` = stred),
 *  extrude cez `Shape` + `ExtrudeGeometry` centrovanú pozdĺž extrúznej osi (Z),
 *  takže `pos` má rovnaký význam ("stred") pre oba druhy tvaru. */
function lokalnaGeometria(tvar: Tvar, THREE: ThreeNS): BufferGeometry {
	if (tvar.kind === 'box') {
		return new THREE.BoxGeometry(mm(tvar.w), mm(tvar.h), mm(tvar.d));
	}
	const shape = new THREE.Shape();
	const [prvy, ...ostatne] = tvar.obrys;
	shape.moveTo(mm(prvy[0]), mm(prvy[1]));
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
