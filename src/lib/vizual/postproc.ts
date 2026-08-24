// Zákaznícky 3D náhľad — post-processing leštiaci layer (#288, follow-up #285).
// Aditívny `EffectComposer` pipeline (three-native, 0 novej npm závislosti):
// `RenderPass` → `GTAOPass` (ground-truth AO — kontaktné stmavenie v záhyboch,
// ekvivalent N8AO) → `UnrealBloomPass` (jemný glow na HDRI odleskoch, high tier) →
// `OutputPass` (tone map + sRGB — číta `renderer.toneMapping`, teda `NeutralToneMapping`
// z #285 ostáva → vernosť RAL farieb) → `SMAAPass` (AA na finálnom LDR obraze).
//
// Product-agnostic + THREE-free na module top-level (len type importy, ako `scena.ts`) —
// životný cyklus (mount/resize/render/dispose) drží `Vizual3D.svelte`. Composer sa STAVIA
// LEN keď `postprocPovoleny(nastavenia, renderer)` (kvalita.ts) je true = mid/high tier A
// HARDVÉROVÝ renderer; softvérový SwiftShader/CI ide nezmenenou priamou cestou (#290 —
// malý alokačný rozpočet). Konštrukcia je u volajúceho v `try/catch` s tichým fallbackom
// na priamy render (vzor #285 HDRI) — scéna sa nikdy nezhodí kvôli composeru a E2E
// zero-console drží.
import type { PostprocKonfig } from './kvalita';

type ThreeNS = typeof import('three');
type EffectComposerCtor =
	typeof import('three/examples/jsm/postprocessing/EffectComposer.js').EffectComposer;
type RenderPassCtor = typeof import('three/examples/jsm/postprocessing/RenderPass.js').RenderPass;
type GTAOPassCtor = typeof import('three/examples/jsm/postprocessing/GTAOPass.js').GTAOPass;
type UnrealBloomPassCtor =
	typeof import('three/examples/jsm/postprocessing/UnrealBloomPass.js').UnrealBloomPass;
type OutputPassCtor = typeof import('three/examples/jsm/postprocessing/OutputPass.js').OutputPass;
type SMAAPassCtor = typeof import('three/examples/jsm/postprocessing/SMAAPass.js').SMAAPass;

/** Lazy-importované post-processing moduly (nacitajPostproc). Odovzdávajú sa do
 *  `vytvorComposer` — samotný modul nič z THREE za behu neimportuje (type-only). */
export interface PostprocModuly {
	EffectComposer: EffectComposerCtor;
	RenderPass: RenderPassCtor;
	GTAOPass: GTAOPassCtor;
	UnrealBloomPass: UnrealBloomPassCtor;
	OutputPass: OutputPassCtor;
	SMAAPass: SMAAPassCtor;
}

type Renderer = InstanceType<ThreeNS['WebGLRenderer']>;
type Scene = InstanceType<ThreeNS['Scene']>;
type Camera = InstanceType<ThreeNS['PerspectiveCamera']>;
type Pass = { setSize?: (w: number, h: number) => void; dispose?: () => void };

/** Živý composer + jeho životný cyklus. `render()` nahrádza `renderer.render()`,
 *  `setSize()` sa volá pri resize, `dispose()` pri unmount/context-lost. */
export interface ZivyComposer {
	render(): void;
	setSize(sirkaCss: number, vyskaCss: number): void;
	dispose(): void;
}

/** Postaví `EffectComposer` pipeline. `sirkaCss`/`vyskaCss` sú CSS pixely (canvas
 *  clientWidth/Height) — composer si sám prenásobí `renderer.getPixelRatio()` (zdedený
 *  z konštruktora), rovnako ako `renderer.setSize(w,h,false)`. */
export function vytvorComposer(
	THREE: ThreeNS,
	moduly: PostprocModuly,
	renderer: Renderer,
	scene: Scene,
	camera: Camera,
	konfig: PostprocKonfig,
	sirkaCss: number,
	vyskaCss: number
): ZivyComposer {
	const { EffectComposer, RenderPass, GTAOPass, UnrealBloomPass, OutputPass, SMAAPass } = moduly;

	const composer = new EffectComposer(renderer);
	const passe: Pass[] = [];

	const renderPass = new RenderPass(scene, camera);
	composer.addPass(renderPass);
	passe.push(renderPass);

	if (konfig.gtao) {
		// GTAO si sám renderuje depth+normal G-buffer scény (žiadne externé zapojenie
		// depth textúry). `output=0` (Default) = AO skomponované cez beauty.
		const gtao = new GTAOPass(scene, camera, sirkaCss, vyskaCss);
		gtao.output = GTAOPass.OUTPUT.Default;
		gtao.blendIntensity = konfig.gtaoBlend;
		gtao.updateGtaoMaterial({ radius: konfig.gtaoRadius, scale: konfig.gtaoScale });
		composer.addPass(gtao);
		passe.push(gtao);
	}

	if (konfig.bloom) {
		const bloom = new UnrealBloomPass(
			new THREE.Vector2(sirkaCss, vyskaCss),
			konfig.bloomStrength,
			konfig.bloomRadius,
			konfig.bloomThreshold
		);
		composer.addPass(bloom);
		passe.push(bloom);
	}

	// OutputPass = jediné miesto tone-mappingu (medzipassy sú offscreen linear, three
	// tam tone mapping NEaplikuje). Číta `renderer.toneMapping` (NeutralToneMapping) →
	// vernosť RAL. NIE je posledný pass keď je SMAA za ním (SMAA robí AA na LDR sRGB).
	const output = new OutputPass();
	composer.addPass(output);
	passe.push(output);

	if (konfig.smaa) {
		// SMAA ako POSLEDNÝ (renderToScreen) — AA na výslednom tone-mapnutom sRGB obraze
		// (na to je navrhnuté). Embedded base64 area/search textúry — žiaden externý fetch.
		const smaa = new SMAAPass();
		composer.addPass(smaa);
		passe.push(smaa);
	}

	composer.setSize(sirkaCss, vyskaCss);

	return {
		render() {
			composer.render();
		},
		setSize(sCss, vCss) {
			composer.setSize(sCss, vCss);
		},
		dispose() {
			// composer.dispose() zlikviduje LEN interné read/write targety + copyPass —
			// NIE render targety jednotlivých passov (GTAO/bloom/SMAA), tie treba
			// dispose-núť samostatne, inak GPU pamäť unikne pri každom unmount/context-lost.
			for (const p of passe) {
				try {
					p.dispose?.();
				} catch {
					// dispose jedného passu nesmie zabrániť uvoľneniu zvyšku
				}
			}
			composer.dispose();
		}
	};
}
