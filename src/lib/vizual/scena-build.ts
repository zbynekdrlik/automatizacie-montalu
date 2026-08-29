// #333 large-file-split: `postavScenu` (kompletná stavba scény + `ZivaScena` typ) extrahované
// z `Vizual3D.svelte` (prekročil 1000-r. strop pridaním intro glide + kóty + výzvy otáčať).
// Čistá FACTORY funkcia — berie THREE/loader ctory + `SceneCtx` (reaktívne vstupy komponentu
// + `onStart`/`onChange` callbacky pre OrbitControls) a VRACIA živú scénu; životný cyklus
// (render/tikaj/dispose) ostáva vo `Vizual3D.svelte`. Žiadna zmena SPRÁVANIA oproti pôvodnej
// in-line verzii — len presun (parameter injection, žiadny cirkulárny import).
import { mm } from './jednotky';
import {
	nastavKluceoveSvetloTien,
	vytvorEnvironment,
	vytvorKontaktnyTien,
	vytvorOblohu,
	vytvorRenderer,
	vytvorStenu,
	vytvorSvetla,
	vytvorZem,
	type Disposable
} from './scena';
import { vytvorDom, vytvorOkolie } from './scena-dom';
import { postavProduktMeshe } from './produkt-meshe';
import {
	autoFitVzdialenost,
	fitCiel,
	orbitLimity,
	poziciaKamery,
	type Preset,
	type PresetKluc,
	vzdialenostPrePreset
} from './kamera';
import { nastaveniaPreTier, postprocKonfig, type Tier } from './kvalita';
import { vytvorComposer, type PostprocModuly, type ZivyComposer } from './postproc';
import type { Rola, VizVysledok } from './spec';
import type { MergeGeometriesFn } from './builder';
import type { SkloVzhlad } from './materialy';

type ThreeNS = typeof import('three');
type OrbitControlsCtor =
	typeof import('three/examples/jsm/controls/OrbitControls.js').OrbitControls;
type OrbitControlsInst = InstanceType<OrbitControlsCtor>;

export interface ZivaScena {
	THREE: ThreeNS;
	mergeGeometries: MergeGeometriesFn;
	renderer: InstanceType<ThreeNS['WebGLRenderer']>;
	scene: InstanceType<ThreeNS['Scene']>;
	camera: InstanceType<ThreeNS['PerspectiveCamera']>;
	controls: OrbitControlsInst;
	materialy: Partial<Record<Rola, InstanceType<ThreeNS['MeshPhysicalMaterial']>>>;
	/** LEN meshe produktu — oddelené od `disposables`, aby `prestavGeometriuProduktu()`
	 *  vedela prestavať IBA produkt (renderer/kamera/svetlá/scéna ostávajú). */
	produktMeshe: InstanceType<ThreeNS['Mesh']>[];
	/** referencia na sklo materiál (živá zmena vzhľadu skla bez rebuildu geometrie #276). */
	skloMaterial: InstanceType<ThreeNS['MeshPhysicalMaterial']> | null;
	/** #288: post-processing composer (GTAO/SMAA/bloom) — `null` na low/none/softvér. */
	postproc: ZivyComposer | null;
	disposables: Disposable[];
	contextLostCount: number;
	fitVzdialenost: number;
}

/** Reaktívne vstupy komponentu + OrbitControls callbacky, odovzdané do `postavScenu`
 *  (tá je mimo komponentu, takže ich nemôže čítať zo scope). */
export interface SceneCtx {
	vysledok: VizVysledok;
	ralKod: string;
	skloVzhlad?: SkloVzhlad;
	preset: PresetKluc;
	/** preset tabuľka (pergola `PRESETY_DOM` „z hora" vs zasklenia `PRESETY`) */
	presety: Record<PresetKluc, Preset>;
	/** #325: pergola scéna (dom + okolie); zasklenia = false */
	zobrazDom: boolean;
	containerEl: HTMLDivElement | undefined;
	/** OrbitControls `'start'` (krátkodobá rAF slučka komponentu) */
	onStart: () => void;
	/** OrbitControls `'change'` (render) */
	onChange: () => void;
}

export function postavScenu(
	THREE: ThreeNS,
	OrbitControls: OrbitControlsCtor,
	RoomEnvironment: new () => InstanceType<ThreeNS['Scene']>,
	mergeGeometries: MergeGeometriesFn,
	canvas: HTMLCanvasElement,
	aktualnyTier: Exclude<Tier, 'none'>,
	hdrTexture: InstanceType<ThreeNS['DataTexture']> | null,
	postprocModuly: PostprocModuly | null,
	ctx: SceneCtx
): ZivaScena {
	const { vysledok, ralKod, skloVzhlad, preset, presety, zobrazDom, containerEl } = ctx;
	const nastavenia = nastaveniaPreTier(aktualnyTier);
	const disposables: Disposable[] = [];

	const renderer = vytvorRenderer(THREE, canvas, nastavenia);
	const scene = new THREE.Scene();
	const environmentTex = vytvorEnvironment(
		THREE,
		RoomEnvironment,
		renderer,
		nastavenia,
		hdrTexture
	);
	scene.environment = environmentTex;
	// PMREM environment textúra sa inak NIKDY nezlikviduje — únik GPU pamäte pri každom
	// opätovnom mount/unmount alebo context-lost/restored cykle.
	disposables.push(environmentTex);

	const { key, fill } = vytvorSvetla(THREE);
	// #285: kľúčové svetlo vrhá reálny tieň (mid/high). `key.target` MUSÍ byť v scéne, inak
	// tieň mieri na (0,0,0). Shadow frustum sa dimenzuje RAZ pri mounte podľa bboxu (ako dekal/
	// stena/auto-fit); `prestavGeometriuProduktu` mení len pozície dielov, nie obálku.
	if (nastavenia.tiene) {
		nastavKluceoveSvetloTien(
			THREE,
			key,
			vysledok.bbox.w,
			vysledok.bbox.h,
			vysledok.bbox.d,
			nastavenia.shadowMapa
		);
		scene.add(key.target);
	}
	scene.add(key, fill);

	const obloha = vytvorOblohu(THREE);
	scene.add(obloha);
	disposables.push(obloha.geometry, obloha.material as Disposable);
	const oblohaMat = obloha.material as InstanceType<ThreeNS['MeshBasicMaterial']>;
	if (oblohaMat.map) disposables.push(oblohaMat.map);

	// #333: pergola (`zobrazDom`) dostane SalesQueze okolie — trávnik + dlažbová terasa pod
	// pergolou + stromy (namiesto jednej dlažby); zasklenia scéna ostáva na `vytvorZem`.
	if (zobrazDom) {
		const okolie = vytvorOkolie(THREE, nastavenia, vysledok.bbox.w, vysledok.bbox.d);
		scene.add(okolie.skupina);
		for (const d of okolie.disposables) disposables.push(d);
	} else {
		const zem = vytvorZem(THREE, nastavenia);
		zem.receiveShadow = nastavenia.tiene; // #285: zem prijíma vrhnutý tieň konštrukcie
		scene.add(zem);
		disposables.push(zem.geometry, zem.material as Disposable);
		const zemMat = zem.material as InstanceType<ThreeNS['MeshStandardMaterial']>;
		if (zemMat.map) disposables.push(zemMat.map);
	}

	// #325: pergola (`zobrazDom`) dostane SOLÍDNU fasádu škálovanú výškou; zasklenia scény
	// ostávajú s PÔVODNOU stenou (dverný otvor, fixná výška) → žiadna zmena zasklenia náhľadu.
	const stena = zobrazDom
		? vytvorStenu(THREE, nastavenia, vysledok.bbox.w, vysledok.bbox.h, false)
		: vytvorStenu(THREE, nastavenia, vysledok.bbox.w);
	stena.position.z = -(mm(vysledok.bbox.d) / 2 + 0.05);
	stena.receiveShadow = nastavenia.tiene; // #285: stena prijíma vrhnutý tieň
	scene.add(stena);
	disposables.push(stena.geometry, stena.material as Disposable);
	const stenaMat = stena.material as InstanceType<ThreeNS['MeshStandardMaterial']>;
	if (stenaMat.map) disposables.push(stenaMat.map);
	if (stenaMat.roughnessMap && stenaMat.roughnessMap !== stenaMat.map)
		disposables.push(stenaMat.roughnessMap);

	if (zobrazDom) {
		// #333: profi 2-podlažný dom (svetlá fasáda + sedlová plechová strecha so štítmi + raster
		// okien + drevené dvere + sokel) PRED fasádou. Dvere centrované na x=0 → vždy medzi krajnými
		// stĺpmi (nikdy za nohou); strecha vysoko nad pergolou, presah mimo strešného skla pergoly.
		const dom = vytvorDom(THREE, nastavenia, vysledok.bbox.w, vysledok.bbox.h);
		dom.skupina.position.z = stena.position.z;
		scene.add(dom.skupina);
		for (const d of dom.disposables) disposables.push(d);
	}

	const tien = vytvorKontaktnyTien(
		THREE,
		vysledok.bbox.w,
		vysledok.bbox.d,
		vysledok.bbox.h,
		// #333 polish: pergola má ĽAHŠÍ + MENŠÍ kontaktný tieň (nie tmavá machuľa); zasklenia default.
		zobrazDom ? { footprintScale: 1.1, intenzita: 0.4 } : undefined
	);
	// #333 review 🔵: tieň NAD terasou v transparentnom priechode (terasa.renderOrder=0) — nezávisí
	// od implicitného zoradenia podľa svetových pozícií (terasa y=1 mm, tieň y=2 mm).
	tien.renderOrder = 1;
	scene.add(tien);
	disposables.push(tien.geometry, tien.material as Disposable);
	const tienMat = tien.material as InstanceType<ThreeNS['MeshBasicMaterial']>;
	if (tienMat.map) disposables.push(tienMat.map);

	// geometria produktu (zdieľaná funkcia — volá ju aj `prestavGeometriuProduktu()`). POZOR:
	// `produktMeshe` sa NEDÁVAJÚ do `disposables` (idú cez `ziva.produktMeshe` +
	// `zlikvidujProduktMeshe()`, lebo `prestavGeometriuProduktu()` ich priebežne NAHRÁDZA).
	const { materialy, produktMeshe, skloMaterial } = postavProduktMeshe(
		THREE,
		mergeGeometries,
		scene,
		vysledok,
		ralKod,
		nastavenia,
		skloVzhlad
	);

	const aspect = (containerEl?.clientWidth ?? 16) / Math.max(1, containerEl?.clientHeight ?? 9);
	const camera = new THREE.PerspectiveCamera(35, aspect, 0.05, 400);
	const fitVzdialenost = autoFitVzdialenost(vysledok.bbox, aspect);
	const ciel = fitCiel(vysledok.bbox);
	const p = presety[preset];
	const poz = poziciaKamery(
		ciel,
		p.azimut,
		p.elevacia,
		vzdialenostPrePreset(preset, fitVzdialenost)
	);
	camera.position.set(poz.x, poz.y, poz.z);

	const controls = new OrbitControls(camera, canvas);
	controls.target.set(ciel.x, ciel.y, ciel.z);
	controls.enableDamping = true;
	controls.dampingFactor = 0.08;
	controls.enablePan = false;
	controls.rotateSpeed = 0.6;
	controls.zoomSpeed = 0.7;
	const lim = orbitLimity(p, fitVzdialenost);
	controls.minAzimuthAngle = lim.minAzimuthAngle;
	controls.maxAzimuthAngle = lim.maxAzimuthAngle;
	controls.minPolarAngle = lim.minPolarAngle;
	controls.maxPolarAngle = lim.maxPolarAngle;
	controls.minDistance = lim.minDistance;
	controls.maxDistance = lim.maxDistance;
	controls.update();
	controls.addEventListener('start', ctx.onStart);
	controls.addEventListener('change', ctx.onChange);

	// #288: post-processing composer (GTAO/SMAA/bloom). LEN keď volajúci prešiel gate
	// (`postprocPovoleny` = mid/high + hardvér) a dodal moduly. try/catch s TICHÝM graceful
	// fallbackom na priamy render (vzor #285 HDRI — scéna sa nikdy nezhodí kvôli composeru).
	let postproc: ZivyComposer | null = null;
	const ppKonfig = postprocModuly ? postprocKonfig(aktualnyTier) : null;
	if (postprocModuly && ppKonfig) {
		try {
			const wCss = containerEl?.clientWidth ?? 16;
			const hCss = Math.max(1, containerEl?.clientHeight ?? 9);
			postproc = vytvorComposer(
				THREE,
				postprocModuly,
				renderer,
				scene,
				camera,
				ppKonfig,
				wCss,
				hCss
			);
		} catch {
			// composer sa nepodarilo postaviť (neočakávaný GPU quirk) → priamy render
			postproc = null;
		}
	}

	return {
		THREE,
		mergeGeometries,
		renderer,
		scene,
		camera,
		controls,
		materialy,
		produktMeshe,
		skloMaterial,
		postproc,
		disposables,
		contextLostCount: 0,
		fitVzdialenost
	};
}
