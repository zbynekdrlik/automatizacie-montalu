// Zákaznícky 3D náhľad (#170) — vysoké rozlíšenie pre tlač (§2.10). `preserveDrawingBuffer`
// sa NIKDY nezapína (kradlo by výkon celý čas kvôli jednému screenshotu) —
// `gl.readPixels` beží HNEĎ v tom istom synchrónnom bloku po `renderer.render()`,
// kým je kresliaci buffer ešte platný (WebGL to garantuje presne do najbližšieho
// swapu). Volajúci (komponent) je zodpovedný za skrytie overlay/mierkovej
// figúry a dočasné vynútenie tieru `high` PRED zavolaním a obnovenie PO ňom —
// tento modul rieši len samotný capture + downscale + blob.
//
// #288: `jeSoftverovyRenderer` (softvérové WebGL — SwiftShader na CI, llvmpipe,
// Basic Render — má malý CELKOVÝ alokačný rozpočet napriek veľkým per-dimension
// limitom, #290) sa presunul do `kvalita.ts` (jediný zdroj pravdy klasifikácie
// renderer-stringu: GPU-tier detekcia AJ post-processing gate ho zdieľajú). Re-exportuje
// sa nižšie, aby `supersampleFaktor` volajúci + existujúce importy ostali funkčné.
import { jeSoftverovyRenderer } from './kvalita';
export { jeSoftverovyRenderer };

type ThreeNS = typeof import('three');
type Renderer = InstanceType<ThreeNS['WebGLRenderer']>;
type Scene = InstanceType<ThreeNS['Scene']>;
type Camera = InstanceType<ThreeNS['PerspectiveCamera']>;

export interface SnimkaVstup {
	renderer: Renderer;
	scene: Scene;
	camera: Camera;
	/** px, default 2400 (tlačový pomer 200×135 mm ≈ 1,481) */
	sirkaPx?: number;
	/** px, default 1600 */
	vyskaPx?: number;
}

// #290: `jeSoftverovyRenderer` (softvérové WebGL — SwiftShader na CI, llvmpipe,
// Microsoft Basic Render — má malý CELKOVÝ alokačný rozpočet napriek veľkým
// per-dimension limitom) sa v #288 presunul do `kvalita.ts` (jediný zdroj pravdy
// klasifikácie renderer-stringu — používa ho aj GPU-tier detekcia AJ post-processing
// gate). Re-exportuje sa TU, aby `supersampleFaktor` volajúci + existujúce importy
// (`tests/vizual-snimka.test.ts`) ostali funkčné (viď re-export hore).

/** Rozhodne o supersample faktore podľa GPU limitov — čisto na základe WebGL
 *  limitov, žiadny DOM. Exportované samostatne kvôli jednotkovej testovateľnosti
 *  (mockovateľný `gl.getParameter`).
 *
 *  #285: pridaný **3×** (tlačovo ostrejší PNG do PDF ponuky). Základ 2400 px
 *  šírky → 3× = 7200 px, 2× = 4800 px; rozhoduje MENŠÍ z `MAX_RENDERBUFFER_SIZE`
 *  / `MAX_TEXTURE_SIZE` (renderer.setSize aj readRenderTargetPixels potrebujú
 *  oba). Väčšina desktopov (limit 16384) dá 3×, mobil so 4096 limitom padne na
 *  1× (žiadny risk out-of-memory readbacku na slabom GPU).
 *
 *  #290: per-dimension limity NIE SÚ spoľahlivým proxy pre CELKOVÝ alokačný
 *  rozpočet SOFTVÉROVÉHO WebGL — SwiftShader (CI) hlási 16384, ale 3× buffer
 *  (7200×4860 MSAA) prekročí jeho „Texture total allocation size is too large"
 *  → incomplete framebuffer → kaskáda GL warningov → E2E `toEqual([])` padne.
 *  2× (4800×3240) je DOKÁZANE bezpečné (rovnaká CI SwiftShader ho servuje na
 *  `main`). `softverovyRenderer` (viď `jeSoftverovyRenderer`, fail-safe default
 *  `false`) preto stropuje ss na 2× — 3× len na POTVRDENOM hardvéri (#285 zámer
 *  pre reálne desktopy zostáva). */
export function supersampleFaktor(
	maxRenderbuffer: number,
	maxTextura: number,
	softverovyRenderer = false
): 1 | 2 | 3 {
	const limit = Math.min(maxRenderbuffer, maxTextura);
	if (limit >= 7200 && !softverovyRenderer) return 3;
	if (limit >= 4800) return 2;
	return 1;
}

export async function snimka(THREE: ThreeNS, vst: SnimkaVstup): Promise<Blob> {
	const w = vst.sirkaPx ?? 2400;
	const h = vst.vyskaPx ?? 1600;
	const { renderer, scene, camera } = vst;
	const gl = renderer.getContext() as WebGL2RenderingContext;

	// #290: softvérové WebGL (SwiftShader na CI) stropuje supersample na 2× (viď
	// jeSoftverovyRenderer / supersampleFaktor). UNMASKED_RENDERER cez
	// WEBGL_debug_renderer_info — rovnaký vzor ako tier detekcia vo Vizual3D.svelte.
	let unmaskedRenderer = '';
	try {
		const ext = gl.getExtension('WEBGL_debug_renderer_info');
		if (ext) unmaskedRenderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
	} catch {
		// bez debug info → prázdny reťazec → jeSoftverovyRenderer=true (fail-safe strop 2×)
	}

	const ss = supersampleFaktor(
		gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
		gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
		jeSoftverovyRenderer(unmaskedRenderer)
	);

	const povodnyAspect = camera.aspect;
	const povodnyDpr = renderer.getPixelRatio();
	const povodnaVelkost = new THREE.Vector2();
	renderer.getSize(povodnaVelkost);

	const sirkaPx = w * ss;
	const vyskaPx = h * ss;

	// review nález 🔵 #8: try/finally — bez neho by mid-sekvenčný throw
	// (napr. `getContext('2d')` zlyhá) nechal renderer natrvalo veľký
	// (tlačové rozlíšenie) namiesto pôvodnej veľkosti canvasu, takže
	// nasledujúce bežné render() volania by kreslili do zlej veľkosti.
	let vystupCanvas: HTMLCanvasElement;
	try {
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		renderer.setPixelRatio(1);
		renderer.setSize(sirkaPx, vyskaPx, false);
		renderer.render(scene, camera);

		// readPixels HNEĎ, synchrónne, kým je buffer platný — žiadny await
		// medzi render() a týmto riadkom
		const pixely = new Uint8Array(sirkaPx * vyskaPx * 4);
		gl.readPixels(0, 0, sirkaPx, vyskaPx, gl.RGBA, gl.UNSIGNED_BYTE, pixely);

		// WebGL vracia riadky ZDOLA NAHOR — canvas ich chce ZHORA NADOL
		const surovyCanvas = document.createElement('canvas');
		surovyCanvas.width = sirkaPx;
		surovyCanvas.height = vyskaPx;
		const surovyCtx = surovyCanvas.getContext('2d');
		if (!surovyCtx) throw new Error('vizual/snimka: 2D canvas kontext sa nepodarilo získať');
		const imgData = surovyCtx.createImageData(sirkaPx, vyskaPx);
		const riadokBajty = sirkaPx * 4;
		for (let y = 0; y < vyskaPx; y++) {
			const zdrojOd = (vyskaPx - y - 1) * riadokBajty;
			imgData.data.set(pixely.subarray(zdrojOd, zdrojOd + riadokBajty), y * riadokBajty);
		}
		surovyCtx.putImageData(imgData, 0, 0);

		// downscale na w×h (supersampled AA "zadarmo")
		vystupCanvas = document.createElement('canvas');
		vystupCanvas.width = w;
		vystupCanvas.height = h;
		const vystupCtx = vystupCanvas.getContext('2d');
		if (!vystupCtx) throw new Error('vizual/snimka: 2D canvas kontext sa nepodarilo získať');
		vystupCtx.drawImage(surovyCanvas, 0, 0, w, h);
	} finally {
		// obnov pôvodný stav rendera VŽDY, aj keď blok vyššie zlyhal
		camera.aspect = povodnyAspect;
		camera.updateProjectionMatrix();
		renderer.setPixelRatio(povodnyDpr);
		renderer.setSize(povodnaVelkost.x, povodnaVelkost.y, false);
		renderer.render(scene, camera);
	}

	return new Promise((resolve, reject) => {
		vystupCanvas.toBlob((blob) => {
			if (blob) resolve(blob);
			else reject(new Error('vizual/snimka: toBlob zlyhalo'));
		}, 'image/png');
	});
}
