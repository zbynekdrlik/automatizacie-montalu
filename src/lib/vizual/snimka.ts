// Zákaznícky 3D náhľad (#170) — vysoké rozlíšenie pre tlač (§2.10). `preserveDrawingBuffer`
// sa NIKDY nezapína (kradlo by výkon celý čas kvôli jednému screenshotu) —
// `gl.readPixels` beží HNEĎ v tom istom synchrónnom bloku po `renderer.render()`,
// kým je kresliaci buffer ešte platný (WebGL to garantuje presne do najbližšieho
// swapu). Volajúci (komponent) je zodpovedný za skrytie overlay/mierkovej
// figúry a dočasné vynútenie tieru `high` PRED zavolaním a obnovenie PO ňom —
// tento modul rieši len samotný capture + downscale + blob.
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

/** Rozhodne o supersample faktore podľa GPU limitov — čisto na základe WebGL
 *  limitov, žiadny DOM. Exportované samostatne kvôli jednotkovej testovateľnosti
 *  (mockovateľný `gl.getParameter`).
 *
 *  #285: pridaný **3×** (tlačovo ostrejší PNG do PDF ponuky). Základ 2400 px
 *  šírky → 3× = 7200 px, 2× = 4800 px; rozhoduje MENŠÍ z `MAX_RENDERBUFFER_SIZE`
 *  / `MAX_TEXTURE_SIZE` (renderer.setSize aj readRenderTargetPixels potrebujú
 *  oba). Väčšina desktopov (limit 16384) dá 3×, mobil so 4096 limitom padne na
 *  1× (žiadny risk out-of-memory readbacku na slabom GPU). */
export function supersampleFaktor(maxRenderbuffer: number, maxTextura: number): 1 | 2 | 3 {
	const limit = Math.min(maxRenderbuffer, maxTextura);
	if (limit >= 7200) return 3;
	if (limit >= 4800) return 2;
	return 1;
}

export async function snimka(THREE: ThreeNS, vst: SnimkaVstup): Promise<Blob> {
	const w = vst.sirkaPx ?? 2400;
	const h = vst.vyskaPx ?? 1600;
	const { renderer, scene, camera } = vst;
	const gl = renderer.getContext() as WebGL2RenderingContext;

	const ss = supersampleFaktor(
		gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
		gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
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
