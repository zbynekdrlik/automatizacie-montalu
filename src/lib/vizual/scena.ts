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
type RGBELoaderCtor = typeof import('three/examples/jsm/loaders/RGBELoader.js').RGBELoader;

/** URL commitnutého HDRI assetu (Poly Haven CC0, `static/hdri/`). Servuje sa z
 *  VLASTNÉHO originu appky (žiaden externý runtime fetch — #285); `base` (SvelteKit)
 *  rieši prípadný base-path. */
export function hdriUrl(base: string): string {
	return `${base}/hdri/kloofendal_puresky_1k.hdr`;
}

/** Načíta HDRI equirect textúru (`RGBELoader`) z vlastného originu. Vráti
 *  `null` pri AKEJKOĽVEK chybe (chýbajúci súbor, sieťová chyba) — konzument
 *  potom graceful padne na procedurálny `RoomEnvironment` (#285). NIKDY
 *  nerejektuje (aby jedna chyba assetu nezhodila celú scénu). */
export function nacitajHDRI(
	RGBELoaderCtor: RGBELoaderCtor,
	url: string
): Promise<InstanceType<ThreeNS['DataTexture']> | null> {
	return new Promise((resolve) => {
		try {
			new RGBELoaderCtor().load(
				url,
				(tex) => resolve(tex),
				undefined,
				() => resolve(null)
			);
		} catch {
			resolve(null);
		}
	});
}

/** Prostredie (IBL). #285: ak je zadaná `hdrTexture` (reálne Poly Haven CC0
 *  HDRI, mid/high tier), použije sa cez `PMREMGenerator.fromEquirectangular` →
 *  vonkajšia obloha so slnkom = reálne odlesky na hliníku/skle. Bez nej (alebo
 *  keď HDR load zlyhal / low tier) sa graceful použije pôvodné procedurálne
 *  `RoomEnvironment` (0 bajtov zo siete). Vstupná `hdrTexture` sa po PMREM
 *  prevode zlikviduje (`.dispose()`) — už nie je potrebná. */
export function vytvorEnvironment(
	THREE: ThreeNS,
	RoomEnvironmentCtor: new () => InstanceType<ThreeNS['Scene']>,
	renderer: InstanceType<ThreeNS['WebGLRenderer']>,
	nastavenia: TierNastavenia,
	hdrTexture?: InstanceType<ThreeNS['DataTexture']> | null
): InstanceType<ThreeNS['Texture']> {
	const pmrem = new THREE.PMREMGenerator(renderer);
	let texture: InstanceType<ThreeNS['Texture']>;
	if (nastavenia.hdri && hdrTexture) {
		hdrTexture.mapping = THREE.EquirectangularReflectionMapping;
		texture = pmrem.fromEquirectangular(hdrTexture).texture;
		hdrTexture.dispose();
	} else {
		const env = new RoomEnvironmentCtor();
		texture = pmrem.fromScene(env, 0.04, 0.1, 100, { size: nastavenia.pmrem }).texture;
		(env as unknown as { dispose?: () => void }).dispose?.();
	}
	pmrem.dispose();
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
	// #285 tone mapping A/B (AgX vs Neutral) — ZVOLENÝ `NeutralToneMapping`:
	// kritérium tiketu je VERNOSŤ RAL FARIEB (predajný konfigurátor — zobrazená
	// farba MUSÍ sedieť s objednanou). Khronos PBR Neutral je NAVRHNUTÝ presne
	// na toto: v nejasovom rozsahu necháva base farbu materiálu NEZMENENÚ
	// (blízko identity) a desaturuje LEN smerom k bielej pri jasoch, ktoré by
	// inak vypálili — bez posunu odtieňa. AgX naopak aplikuje filmický
	// per-kanálový sigmoid, ktorý desaturuje CELÝ rozsah (krásne pre film,
	// nevhodné pre presnú vzorkovnicu farieb — RAL patch by sa posunul).
	// Rozhodnutie stojí na DIZAJNE tone mapperov (Khronos PBR Neutral špec:
	// „leaves the color of non-bright objects unchanged"), nie na screenshote —
	// tento build-only lane nerenderuje živo; finálne vizuálne A/B potvrdenie
	// beží v CI E2E + post-deploy (`toneMapping` je jednoriadková zmena, keby
	// review po živom renderi preferoval AgX). Predchádzajúci `ACESFilmicToneMapping`
	// (exposure 1.08) tiež mierne desaturoval — Neutral je vernejší pre RAL.
	renderer.toneMapping = THREE.NeutralToneMapping;
	renderer.toneMappingExposure = 1.0;
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, nastavenia.dpr));
	// #285: reálny cast-shadow map na mid/high tieri (PCFSoft = mäkké okraje);
	// low tier ostáva bez shadow mapy (len kontaktný dekal — perf na slabom GPU).
	renderer.shadowMap.enabled = nastavenia.tiene;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

/** #285: nakonfiguruje kľúčové svetlo ako vrhač reálneho tieňa (PCFSoft).
 *  Ortho shadow kamera sa nadimenzuje podľa bboxu produktu (v METROCH), cieľ
 *  svetla sa nastaví na STRED produktu (x=0, y=h/2, z=0) — rovnaká svetová
 *  konvencia ako zvyšok scény — aby frustum pokryl celú siluetu. `near`/`far`
 *  obopnú produkt okolo fixnej 12 m vzdialenosti svetla. `bias`/`normalBias`
 *  proti shadow acne (samotienenie tenkých profilov) a peter-panningu.
 *
 *  Volajúci MUSÍ pridať `key.target` do scény (`scene.add(key.target)`) — bez
 *  toho three.js `target` ignoruje a tieň mieri na (0,0,0). */
export function nastavKluceoveSvetloTien(
	THREE: ThreeNS,
	key: InstanceType<ThreeNS['DirectionalLight']>,
	bboxSirkaMm: number,
	bboxVyskaMm: number,
	bboxHlbkaMm: number,
	mapaSize: number
): void {
	const w = mm(bboxSirkaMm);
	const h = mm(bboxVyskaMm);
	const d = mm(bboxHlbkaMm);
	// polovica priestorovej uhlopriečky + rezerva — bezpečná horná hranica
	// siluety pri ľubovoľnom uhle svetla
	const polDiag = 0.5 * Math.sqrt(w * w + h * h + d * d);
	const rozsah = polDiag * 1.15 + 0.5;

	key.castShadow = true;
	key.shadow.mapSize.set(mapaSize, mapaSize);
	key.target.position.set(0, h / 2, 0);

	const cam = key.shadow.camera;
	cam.left = -rozsah;
	cam.right = rozsah;
	cam.top = rozsah;
	cam.bottom = -rozsah;
	// kľúčové svetlo je fixné 12 m od stredu (§2.6); cieľ je stred produktu →
	// vzdialenosť svetlo↔cieľ ≈ 12 m, produkt siaha ±polDiag okolo neho
	cam.near = Math.max(0.1, 12 - polDiag - 1);
	cam.far = 12 + polDiag + 2;
	cam.updateProjectionMatrix();

	key.shadow.bias = -0.0004;
	key.shadow.normalBias = 0.02;
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
 *     4200×150 mm, pomer strán 28:1, štvorcová rovina strany
 *     `4200×1,35=5670 mm`) je tvrdé jadro `jadroR = rozlisenie×0,24`
 *     PIXELOV z `rozlisenie×rozlisenie` canvasu — teda `0,24` FRAKCIA CELEJ
 *     šírky canvasu (nie polovice!), čo sa pri UV mapovaní 0..1 na CELÚ
 *     rovinu premieta na svetový polomer `0,24×5670 mm ≈ 1361 mm` (review
 *     #181 opravil pôvodnú chybu v tomto komentári — počítal `0,24×2835`,
 *     teda z POLOVIČNEJ strany, rovnaká trieda chyby ako sRGB/lineárny
 *     gotcha v `.claude/rules/vizual3d.md`: zlá základňa pre násobenie).
 *     Pri polovičnej šírke koľajnice `2100 mm` tak jadro pokryje len
 *     `1361/2100 ≈ 65 %` od stredu — krajných `~739 mm` (`~35 %`) z KAŽDEJ
 *     strany má len slabý mäkký okraj (opacity ~0.3 pri r=1,56 m, 0 pri
 *     r=2,835 m — TENTO výpočet, mekka vrstva s `radius=stred`, teda
 *     PRESNE polovica šírky, bol v pôvodnom komentári správne). Krajné
 *     konce koľajnice tak vizuálne "nemajú" kontaktný tieň → presne
 *     nahlásené "pravý spodný roh visí vo vzduchu" (`troStvrte`). OPRAVA:
 *     rovina NIE JE štvorec — šírka (X) sa škáluje podľa `bbox.w`, hĺbka
 *     (Z) podľa `max(bbox.d, 0.45×bbox.h)`, VŽDY orezaná zhora na `sirkaM`
 *     (`Math.min`) — druhý (výškový) člen zabraňuje neviditeľne tenkému
 *     tieňu pri "papierovo" plytkých jednotkách (hĺbka posuvu ~90-300 mm by
 *     inak dala tieň tenší než jeho vlastný mäkký polomer), no BEZ orezania
 *     zhora by pri úzkej-vysokej jednotke (napr. `s=300 mm` pri `S_MIN`,
 *     `h` blízko `V_MAX`) prevážil a otočil elipsu o 90° (hlbšia než
 *     širšia — review #181 nález, žiadna z pôvodných testovacích bbox
 *     kombinácií to nezachytila, doplnené nižšie). Rovnaká KRUHOVÁ textúra
 *     namapovaná na NEROVNOMERNE škálovanú rovinu vykreslí PRIRODZENE
 *     PODLHOVASTÚ elipsu (tvrdé jadro naťahuje pozdĺž X spolu s celou
 *     rovinou), ktorá sleduje tvar koľajnice namiesto kruhu v strede pod
 *     ňou — žiadna zmena textúry potrebná. */
export function vytvorKontaktnyTien(
	THREE: ThreeNS,
	bboxSirkaMm: number,
	bboxHlbkaMm: number,
	bboxVyskaMm: number
): InstanceType<ThreeNS['Mesh']> {
	const sirkaM = mm(bboxSirkaMm) * 1.35;
	const hlbkaM = Math.min(sirkaM, Math.max(mm(bboxHlbkaMm) * 1.35, mm(bboxVyskaMm) * 0.45));
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
