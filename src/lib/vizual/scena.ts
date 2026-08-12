// Zákaznícky 3D náhľad (#170) — scéna: renderer, environment, svetlá, obloha,
// zem, stena, kontaktný tieň, dispose registry (§2.6). Súbor exportuje čisté
// FACTORY funkcie (vstup → THREE objekt) — životný cyklus (mount/resize/
// render-on-demand/dispose) drží `Vizual3D.svelte`, ktoré tieto funkcie volá
// z `onMount` PO dynamickom `import('three')`.
import { mm } from './jednotky';
import {
	vytvorDlazbuTexturu,
	vytvorKontaktnyTienTexturu,
	vytvorOblohuTexturu,
	vytvorStenuTexturu
} from './textury';
import type { TierNastavenia } from './kvalita';

type ThreeNS = typeof import('three');

/** Prostredie (IBL) — `RoomEnvironment` + `PMREMGenerator`, procedurálne,
 *  0 bajtov zo siete. `RoomEnvironmentCtor` sa berie ako parameter (dynamický
 *  import z `three/examples/jsm/environments/RoomEnvironment.js`). */
export function vytvorEnvironment(
	THREE: ThreeNS,
	RoomEnvironmentCtor: new () => InstanceType<ThreeNS['Scene']>,
	renderer: InstanceType<ThreeNS['WebGLRenderer']>,
	nastavenia: TierNastavenia
): InstanceType<ThreeNS['Texture']> {
	const env = new RoomEnvironmentCtor();
	const pmrem = new THREE.PMREMGenerator(renderer);
	const cieloveRT = pmrem.fromScene(env, 0.04, 0.1, 100, { size: nastavenia.pmrem });
	const texture = cieloveRT.texture;
	pmrem.dispose();
	(env as unknown as { dispose?: () => void }).dispose?.();
	return texture;
}

export function vytvorRenderer(
	THREE: ThreeNS,
	canvas: HTMLCanvasElement,
	nastavenia: TierNastavenia
): InstanceType<ThreeNS['WebGLRenderer']> {
	const renderer = new THREE.WebGLRenderer({
		canvas,
		antialias: nastavenia.antialias,
		alpha: false,
		powerPreference: 'high-performance'
	});
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.08;
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, nastavenia.dpr));
	renderer.shadowMap.enabled = false;
	return renderer;
}

export interface Svetla {
	key: InstanceType<ThreeNS['DirectionalLight']>;
	fill: InstanceType<ThreeNS['HemisphereLight']>;
}

/** Kľúčové svetlo je FIXNÉ NAVŽDY (§2.6) — nemení sa ani podľa dark mode
 *  stránky, ani podľa presetu kamery. Azimut 135°, elevácia 42°, 12 m od
 *  stredu produktu. */
export function vytvorSvetla(THREE: ThreeNS): Svetla {
	const azimut = (135 * Math.PI) / 180;
	const elevacia = (42 * Math.PI) / 180;
	const vzdialenost = 12;
	const key = new THREE.DirectionalLight(0xfff4ea, 2.4);
	key.position.set(
		vzdialenost * Math.cos(elevacia) * Math.sin(azimut),
		vzdialenost * Math.sin(elevacia),
		vzdialenost * Math.cos(elevacia) * Math.cos(azimut)
	);
	const fill = new THREE.HemisphereLight(0xcfe3f2, 0xb9ae9d, 0.3);
	return { key, fill };
}

/** Azimut kľúčového svetla v radiánoch — použité aj na orientáciu kontaktného
 *  tieňa (posunutý presne v smere svetla, §2.6). */
export const KEY_SVETLO_AZIMUT_RAD = (135 * Math.PI) / 180;

export function vytvorOblohu(THREE: ThreeNS): InstanceType<ThreeNS['Mesh']> {
	const geo = new THREE.SphereGeometry(60, 32, 16);
	const mat = new THREE.MeshBasicMaterial({
		map: vytvorOblohuTexturu(THREE),
		side: THREE.BackSide,
		toneMapped: false
	});
	return new THREE.Mesh(geo, mat);
}

/** Dlažba — rovina 40×40 m, `repeat` nastavený tak, aby 1 dlaždica = 600×600 mm
 *  (hlavný mierkový kľúč scény, §2.6). `low` tier nahradí mapu plochým
 *  gradientom (§2.9). */
export function vytvorZem(
	THREE: ThreeNS,
	nastavenia: TierNastavenia
): InstanceType<ThreeNS['Mesh']> {
	const ROZMER_M = 40;
	const geo = new THREE.PlaneGeometry(ROZMER_M, ROZMER_M);
	geo.rotateX(-Math.PI / 2);
	let mat: InstanceType<ThreeNS['MeshStandardMaterial']>;
	if (nastavenia.plochyGradientMiestoMap) {
		// #174: zladené s vytvorDlazbuTexturu's novou tmavšou/chladnejšou farbou
		mat = new THREE.MeshStandardMaterial({ color: 0xa7a199, roughness: 0.85, metalness: 0 });
	} else {
		const tex = vytvorDlazbuTexturu(THREE, nastavenia.dlazba);
		tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
		const opakovani = ROZMER_M / 0.6; // 1 dlaždica = 600 mm
		tex.repeat.set(opakovani, opakovani);
		mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0 });
	}
	return new THREE.Mesh(geo, mat);
}

/** Stena domu — rovina za produktom, 300 mm presahu po stranách nad šírku
 *  bboxu, s reálnym dverným otvorom 900×2000 mm ako GEOMETRIOU (nie textúrou —
 *  §2.6). `low` tier nahradí štukovú mapu plochým gradientom. */
export function vytvorStenu(
	THREE: ThreeNS,
	nastavenia: TierNastavenia,
	bboxSirkaMm: number
): InstanceType<ThreeNS['Mesh']> {
	const PRESAH_MM = 300;
	const VYSKA_MM = 2800;
	const DVERE_W_MM = 900;
	const DVERE_H_MM = 2000;

	const w = mm(bboxSirkaMm + 2 * PRESAH_MM);
	const h = mm(VYSKA_MM);
	const dw = mm(DVERE_W_MM);
	const dh = mm(DVERE_H_MM);

	const shape = new THREE.Shape();
	shape.moveTo(-w / 2, 0);
	shape.lineTo(w / 2, 0);
	shape.lineTo(w / 2, h);
	shape.lineTo(-w / 2, h);
	shape.closePath();

	// dverný otvor — pri ľavom okraji steny, základňa na zemi (y=0)
	const dvereX0 = -w / 2 + mm(200);
	const otvor = new THREE.Path();
	otvor.moveTo(dvereX0, 0);
	otvor.lineTo(dvereX0 + dw, 0);
	otvor.lineTo(dvereX0 + dw, dh);
	otvor.lineTo(dvereX0, dh);
	otvor.closePath();
	shape.holes.push(otvor);

	const geo = new THREE.ShapeGeometry(shape);

	let mat: InstanceType<ThreeNS['MeshStandardMaterial']>;
	if (nastavenia.plochyGradientMiestoMap) {
		// #174: zladené s vytvorStenuTexturu's novým sýtejším/teplejším odtieňom
		mat = new THREE.MeshStandardMaterial({
			color: 0xc2ab84,
			roughness: 0.92,
			metalness: 0,
			side: THREE.DoubleSide
		});
	} else {
		const { map, roughnessMap } = vytvorStenuTexturu(THREE, nastavenia.stena);
		mat = new THREE.MeshStandardMaterial({
			map,
			roughnessMap,
			roughness: 0.92,
			metalness: 0,
			side: THREE.DoubleSide
		});
	}
	return new THREE.Mesh(geo, mat);
}

/** Dvojvrstvový kontaktný tieň — alpha decal na rovine `y = +2 mm`, posunutý
 *  v azimute kľúčového svetla (§2.6). `rozmerBboxMm` je väčší z (w, d), tieň
 *  je `× 1.35` tohto rozmeru.
 *
 *  #174: veľkosť zmenšená z `×1.6` na `×1.35` a posun z `12 %` na `5 %` —
 *  pôvodná kombinácia (veľký tieň + veľký posun) pôsobila na 3/4 zábere ako
 *  nesúvisiaca škvrna vedľa pätky konštrukcie namiesto pevného odtlačku
 *  priamo pod ňou ("jednotka sa vznáša"). Spolu so zosilnenou nepriehľadnosťou
 *  (`vytvorKontaktnyTienTexturu`) drží tvrdé jadro tesne pod koľajnicou. */
export function vytvorKontaktnyTien(
	THREE: ThreeNS,
	rozmerBboxMm: number
): InstanceType<ThreeNS['Mesh']> {
	const velkost = mm(rozmerBboxMm) * 1.35;
	const geo = new THREE.PlaneGeometry(velkost, velkost);
	geo.rotateX(-Math.PI / 2);
	const tex = vytvorKontaktnyTienTexturu(THREE);
	const mat = new THREE.MeshBasicMaterial({
		map: tex,
		transparent: true,
		depthWrite: false,
		toneMapped: false
	});
	const mesh = new THREE.Mesh(geo, mat);
	mesh.position.y = mm(2);
	// posun v smere kľúčového svetla — tieň padá OPAČNÝM smerom od svetla
	const posunM = mm(rozmerBboxMm) * 0.05;
	mesh.position.x += Math.sin(KEY_SVETLO_AZIMUT_RAD + Math.PI) * posunM;
	mesh.position.z += Math.cos(KEY_SVETLO_AZIMUT_RAD + Math.PI) * posunM;
	return mesh;
}

/** Zoznam vecí s `.dispose()` — geometrie, materiály, textúry — nazbieraných
 *  počas stavby scény, aby ich `onDestroy` (Vizual3D.svelte, §2.9) mohol pri
 *  KAŽDEJ SPA navigácii jednotne zlikvidovať (traverse-dispose). */
export type Disposable = { dispose: () => void };

export function disposeVsetko(zoznam: Disposable[]): void {
	for (const d of zoznam) {
		try {
			d.dispose();
		} catch {
			// dispose nikdy nesmie zhodiť onDestroy — chyba jedného objektu
			// nesmie zabrániť uvoľneniu zvyšku
		}
	}
}
