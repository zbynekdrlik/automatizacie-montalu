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

/** Dvojvrstvový kontaktný tieň — alpha decal na rovine `y = +2 mm`, CENTROVANÝ
 *  presne na pôdoryse produktu (x=0, z=0 — rovnaká konvencia ako spodná
 *  koľajnica, zem aj základňa steny, všetky `y=0`) a TVAROVANÝ podľa
 *  pôdorysu (šírka × hĺbka, NIE jednotný štvorec podľa väčšieho rozmeru).
 *
 *  #174 druhé kolo (ZNOVUOTVORENÉ) — DVE nezávislé príčiny "vznášania sa",
 *  obe numericky overené (`tests/vizual-scena.test.ts`, naživo cez
 *  `window.__VIZDEBUG` scene-introspekciu — SVETOVÉ Y spodku jednotky/zeme/
 *  základne steny/roviny tieňa sú VŠETKY zhodné, 0 resp. tieň 2 mm nad
 *  zámerne kvôli z-fighting — "vznášanie" teda NIE JE výškový/Y posun):
 *
 *  1. **X/Z posun celej roviny.** Predchádzajúci diel (pôvodných `12 %`, aj
 *     toto kolo skúšaných `5 %`) POSÚVAL celú rovinu tieňa v azimute
 *     kľúčového svetla — fyzikálne správne pre VRHNUTÝ (cast) tieň, ale
 *     TENTO dekal je KONTAKTNÝ tieň (dokazuje, že objekt sa DOTÝKA zeme
 *     PRESNE tu). Posunutá plocha (vrátane tvrdého jadra) sa odchýlila od
 *     skutočnej päty koľajnice — OPRAVA: žiadny X/Z posun, vždy centrovaný.
 *  2. **Kruhový gradient na PODLHOVASTOM pôdoryse** (dominantná príčina —
 *     samotné odstránenie posunu z bodu 1 zmenilo render len minimálne,
 *     merateľné cez pixel-diff, ale vizuálne stále "vznášajúce"). Predošlý
 *     kód bral JEDEN rozmer (`Math.max(w,d)`) a staval Z NEHO štvorcovú
 *     rovinu s KRUHOVÝM radiálnym gradientom (`vytvorKontaktnyTienTexturu` —
 *     `createRadialGradient`, symetrický). Pri typickej jednotke (napr.
 *     4200×150 mm, pomer strán 28:1) kruh vpísaný do štvorca so stranou
 *     podľa ŠÍRKY má tvrdé jadro s POLOMEROM len `0.24×2835 mm ≈ 680 mm` —
 *     pokrýva stred rámu, ale VÔBEC nedosiahne ku koncom koľajnice
 *     (`x=±2100 mm`), kde ostáva len slabý mäkký okraj (opacity ~0.3 pri
 *     r=1,56 m, 0 pri r=2,835 m). Krajné ~75 % dĺžky koľajnice tak vizuálne
 *     "nemá" kontaktný tieň → presne nahlásené "pravý spodný roh visí vo
 *     vzduchu" (`troStvrte`). OPRAVA: rovina NIE JE štvorec — šírka (X) sa
 *     škáluje podľa `bbox.w`, hĺbka (Z) podľa `max(bbox.d, 0.45×bbox.h)`
 *     (posledné zabraňuje neviditeľne tenkému tieňu pri "papierovo" plytkých
 *     jednotkách — hĺbka posuvu ~90-300 mm by inak dala tieň tenší než
 *     jeho vlastný mäkký polomer). Rovnaká KRUHOVÁ textúra namapovaná na
 *     NEROVNOMERNE škálovanú rovinu vykreslí PRIRODZENE PODLHOVASTÚ elipsu
 *     (tvrdé jadro naťahuje pozdĺž X spolu s celou rovinou), ktorá sleduje
 *     tvar koľajnice namiesto kruhu v strede pod ňou — žiadna zmena
 *     textúry potrebná. */
export function vytvorKontaktnyTien(
	THREE: ThreeNS,
	bboxSirkaMm: number,
	bboxHlbkaMm: number,
	bboxVyskaMm: number
): InstanceType<ThreeNS['Mesh']> {
	const sirkaM = mm(bboxSirkaMm) * 1.35;
	const hlbkaM = Math.max(mm(bboxHlbkaMm) * 1.35, mm(bboxVyskaMm) * 0.45);
	const geo = new THREE.PlaneGeometry(sirkaM, hlbkaM);
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
