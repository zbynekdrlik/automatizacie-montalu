<script lang="ts">
	// Zákaznícky 3D náhľad (#170) — <canvas> + onMount + dynamický import('three').
	// SSR-bezpečné: žiadny dotyk window/document na module top-level, `three` sa
	// importuje LEN vnútri onMount za `browser` guardom (§2.2). Render-on-demand
	// (žiadny trvalý requestAnimationFrame — §2.6): render sa spustí pri zmene
	// parametra (RAL/preset/otvorené) a pri interakcii (krátkodobá rAF slučka,
	// ktorá sa SAMA ukončí, keď `controls.update()` vráti `false` — damping dobehol).
	import { onDestroy, onMount } from 'svelte';
	import { browser } from '$app/environment';
	import type { Rola, VizVysledok } from '$lib/vizual/spec';
	import { mm } from '$lib/vizual/jednotky';
	import { postavGeometrie, type MergeGeometriesFn } from '$lib/vizual/builder';
	import { nastavRAL, vytvorHlinikMaterial, vytvorSkloMaterial } from '$lib/vizual/materialy';
	import {
		disposeVsetko,
		vytvorEnvironment,
		vytvorKontaktnyTien,
		vytvorOblohu,
		vytvorRenderer,
		vytvorStenu,
		vytvorSvetla,
		vytvorZem,
		type Disposable
	} from '$lib/vizual/scena';
	import {
		autoFitVzdialenost,
		fitCiel,
		orbitLimity,
		poziciaKamery,
		PRESET_DEFAULT,
		PRESETY,
		type PresetKluc,
		vzdialenostPrePreset
	} from '$lib/vizual/kamera';
	import { detekujTier, nastaveniaPreTier, type Tier } from '$lib/vizual/kvalita';
	import { snimka as zachytSnimku } from '$lib/vizual/snimka';

	let {
		vysledok,
		ralKod,
		preset = $bindable<PresetKluc>(PRESET_DEFAULT),
		vynutenyTier,
		posterZaznam
	}: {
		vysledok: VizVysledok;
		ralKod: string;
		preset?: PresetKluc;
		/** testovací hook (`?viz=low`/`?viz=none` v URL) — vynúti tier bez ohľadu
		 *  na skutočné HW, pre e2e determinizmus (§2.12) */
		vynutenyTier?: Tier;
		/** T0 poster content — vykreslí sa namiesto/nad canvasom pri tier==='none' */
		posterZaznam?: import('svelte').Snippet;
	} = $props();

	let canvasEl = $state<HTMLCanvasElement | undefined>();
	let containerEl = $state<HTMLDivElement | undefined>();
	let tier = $state<Tier>('high');
	let pripravene = $state(false);
	let dotykOverlayViditelny = $state(true);
	let camAzimutDeg = $state(PRESETY[PRESET_DEFAULT].azimut);
	let camElevaciaDeg = $state(PRESETY[PRESET_DEFAULT].elevacia);

	type ThreeNS = typeof import('three');
	type OrbitControlsCtor =
		typeof import('three/examples/jsm/controls/OrbitControls.js').OrbitControls;
	type OrbitControlsInst = InstanceType<OrbitControlsCtor>;

	interface ZivaScena {
		THREE: ThreeNS;
		renderer: InstanceType<ThreeNS['WebGLRenderer']>;
		scene: InstanceType<ThreeNS['Scene']>;
		camera: InstanceType<ThreeNS['PerspectiveCamera']>;
		controls: OrbitControlsInst;
		materialy: Partial<Record<Rola, InstanceType<ThreeNS['MeshPhysicalMaterial']>>>;
		disposables: Disposable[];
		contextLostCount: number;
		fitVzdialenost: number;
	}

	let ziva: ZivaScena | null = null;
	let zruseneVOnMounte = false;

	function render() {
		if (!ziva) return;
		ziva.renderer.render(ziva.scene, ziva.camera);
	}

	/** Krátkodobá rAF slučka — SAMA sa ukončí, keď `controls.update()` vráti
	 *  `false` (damping dobehol). Toto NIE JE trvalý render loop. */
	function tikaj() {
		if (!ziva) return;
		const zmenene = ziva.controls.update();
		render();
		if (zmenene) requestAnimationFrame(tikaj);
	}

	function aktualizujCamDataAtributy() {
		const p = PRESETY[preset];
		camAzimutDeg = p.azimut;
		camElevaciaDeg = p.elevacia;
	}

	function nastavPreset(novy: PresetKluc, znovaFit = false) {
		if (!ziva) return;
		preset = novy;
		const p = PRESETY[novy];
		if (znovaFit && containerEl) {
			ziva.fitVzdialenost = autoFitVzdialenost(
				vysledok.bbox,
				containerEl.clientWidth / Math.max(1, containerEl.clientHeight)
			);
		}
		const vzd = vzdialenostPrePreset(novy, ziva.fitVzdialenost);
		const ciel = fitCiel(vysledok.bbox);
		const poz = poziciaKamery(ciel, p.azimut, p.elevacia, vzd);
		ziva.camera.position.set(poz.x, poz.y, poz.z);
		ziva.controls.target.set(ciel.x, ciel.y, ciel.z);
		const lim = orbitLimity(p, ziva.fitVzdialenost);
		ziva.controls.minAzimuthAngle = lim.minAzimuthAngle;
		ziva.controls.maxAzimuthAngle = lim.maxAzimuthAngle;
		ziva.controls.minPolarAngle = lim.minPolarAngle;
		ziva.controls.maxPolarAngle = lim.maxPolarAngle;
		ziva.controls.minDistance = lim.minDistance;
		ziva.controls.maxDistance = lim.maxDistance;
		ziva.controls.update();
		aktualizujCamDataAtributy();
		render();
	}

	function reset() {
		if (!ziva) return;
		ziva.controls.reset();
		nastavPreset(PRESET_DEFAULT);
	}

	function prekresliRAL() {
		if (!ziva) return;
		const nastavenia = nastaveniaPreTier(tier === 'none' ? 'low' : tier);
		for (const rola of ['ram', 'kolajnica', 'klucka', 'klin'] as const) {
			const mat = ziva.materialy[rola];
			if (mat) nastavRAL(ziva.THREE, mat, ralKod, nastavenia.clearcoat);
		}
		render();
	}

	function pripravDataZAtributov(el: HTMLElement | undefined) {
		if (!el) return;
		el.dataset.vizReady = pripravene ? 'true' : 'false';
		el.dataset.vizPreset = preset;
		el.dataset.vizCam = `${camAzimutDeg.toFixed(1)},${camElevaciaDeg.toFixed(1)}`;
		el.dataset.vizRal = ralKod;
	}

	$effect(() => {
		pripravDataZAtributov(containerEl);
	});

	async function nacitajTHREE() {
		const [THREE, { OrbitControls }, { RoomEnvironment }, { mergeGeometries }] = await Promise.all([
			import('three'),
			import('three/examples/jsm/controls/OrbitControls.js'),
			import('three/examples/jsm/environments/RoomEnvironment.js'),
			import('three/examples/jsm/utils/BufferGeometryUtils.js')
		]);
		return { THREE, OrbitControls, RoomEnvironment, mergeGeometries };
	}

	function zistiTierVstup(
		gl: WebGL2RenderingContext | null,
		initMs: number,
		contextLostCount: number
	) {
		if (vynutenyTier) return vynutenyTier;
		if (!gl) return detekujTier({ webgl2Dostupny: false });
		let unmaskedRenderer = '';
		try {
			const ext = gl.getExtension('WEBGL_debug_renderer_info');
			if (ext) unmaskedRenderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
		} catch {
			// bez debug info sa jednoducho nevie odhadnúť GPU — zostane prázdne
		}
		return detekujTier({
			webgl2Dostupny: true,
			hardwareConcurrency: navigator.hardwareConcurrency,
			deviceMemory: (navigator as unknown as { deviceMemory?: number }).deviceMemory,
			unmaskedRenderer,
			devicePixelRatio: window.devicePixelRatio,
			initMs,
			contextLostCount
		});
	}

	function postavScenu(
		THREE: ThreeNS,
		OrbitControls: OrbitControlsCtor,
		RoomEnvironment: new () => InstanceType<ThreeNS['Scene']>,
		mergeGeometries: MergeGeometriesFn,
		canvas: HTMLCanvasElement,
		aktualnyTier: Exclude<Tier, 'none'>
	): ZivaScena {
		const nastavenia = nastaveniaPreTier(aktualnyTier);
		const disposables: Disposable[] = [];

		const renderer = vytvorRenderer(THREE, canvas, nastavenia);
		const scene = new THREE.Scene();
		scene.environment = vytvorEnvironment(THREE, RoomEnvironment, renderer, nastavenia);

		const { key, fill } = vytvorSvetla(THREE);
		scene.add(key, fill);

		const obloha = vytvorOblohu(THREE);
		scene.add(obloha);
		disposables.push(obloha.geometry, obloha.material as Disposable);

		const zem = vytvorZem(THREE, nastavenia);
		scene.add(zem);
		disposables.push(zem.geometry, zem.material as Disposable);
		const zemMat = zem.material as InstanceType<ThreeNS['MeshStandardMaterial']>;
		if (zemMat.map) disposables.push(zemMat.map);

		const stena = vytvorStenu(THREE, nastavenia, vysledok.bbox.w);
		stena.position.z = -(mm(vysledok.bbox.d) / 2 + 0.05);
		scene.add(stena);
		disposables.push(stena.geometry, stena.material as Disposable);
		const stenaMat = stena.material as InstanceType<ThreeNS['MeshStandardMaterial']>;
		if (stenaMat.map) disposables.push(stenaMat.map);
		if (stenaMat.roughnessMap && stenaMat.roughnessMap !== stenaMat.map)
			disposables.push(stenaMat.roughnessMap);

		const tien = vytvorKontaktnyTien(THREE, Math.max(vysledok.bbox.w, vysledok.bbox.d));
		scene.add(tien);
		disposables.push(tien.geometry, tien.material as Disposable);
		const tienMat = tien.material as InstanceType<ThreeNS['MeshBasicMaterial']>;
		if (tienMat.map) disposables.push(tienMat.map);

		// geometria produktu
		const geometrie = postavGeometrie(vysledok.diely, THREE, mergeGeometries);
		const materialy: ZivaScena['materialy'] = {};
		const hlinik = vytvorHlinikMaterial(THREE, ralKod, nastavenia.clearcoat);
		disposables.push(hlinik);
		for (const rola of ['ram', 'kolajnica', 'klucka', 'klin'] as const) {
			const geo = geometrie[rola];
			if (!geo) continue;
			materialy[rola] = hlinik;
			const mesh = new THREE.Mesh(geo, hlinik);
			scene.add(mesh);
			disposables.push(geo);
		}
		if (geometrie.sklo) {
			const skloMat = vytvorSkloMaterial(THREE, 8, nastavenia.sklo);
			scene.add(new THREE.Mesh(geometrie.sklo, skloMat));
			disposables.push(geometrie.sklo, skloMat);
		}
		if (geometrie.sietka) {
			// sieťkový panel — vizuál, nie katalóg (appka dnes nezbiera samostatné
			// rozmery sieťky, len boolean prítomnosť — §2.5)
			const sietkaMat = new THREE.MeshStandardMaterial({
				color: 0x1e293b,
				transparent: true,
				opacity: 0.28,
				side: THREE.DoubleSide,
				roughness: 0.7,
				metalness: 0
			});
			scene.add(new THREE.Mesh(geometrie.sietka, sietkaMat));
			disposables.push(geometrie.sietka, sietkaMat);
		}

		const aspect = (containerEl?.clientWidth ?? 16) / Math.max(1, containerEl?.clientHeight ?? 9);
		const camera = new THREE.PerspectiveCamera(35, aspect, 0.05, 400);
		const fitVzdialenost = autoFitVzdialenost(vysledok.bbox, aspect);
		const ciel = fitCiel(vysledok.bbox);
		const p = PRESETY[preset];
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
		controls.addEventListener('start', tikaj);
		controls.addEventListener('change', render);

		return {
			THREE,
			renderer,
			scene,
			camera,
			controls,
			materialy,
			disposables,
			contextLostCount: 0,
			fitVzdialenost
		};
	}

	function uvolniScenu() {
		if (!ziva) return;
		ziva.controls.dispose();
		disposeVsetko(ziva.disposables);
		ziva.renderer.forceContextLoss();
		ziva.renderer.dispose();
		ziva = null;
		(globalThis as unknown as { __VIZ_CONTEXTS?: number }).__VIZ_CONTEXTS =
			((globalThis as unknown as { __VIZ_CONTEXTS?: number }).__VIZ_CONTEXTS ?? 1) - 1;
	}

	async function inicializuj() {
		if (!browser || !canvasEl) return;
		// dôkaz WebGL2 dostupnosti + GPU string sa zisťuje na ODDELENOM, nikdy
		// pripojenom "scratch" canvase — `getContext()` zamkne kontextové
		// atribúty PRI PRVOM volaní na danom canvase; keby sme sondovali priamo
		// na `canvasEl`, neskorší `THREE.WebGLRenderer({canvas: canvasEl, ...})`
		// by dostal TENTO (default-atribútový) kontext namiesto svojho vlastného
		// tier-špecifického (antialias/alpha/powerPreference), a antialias by sa
		// nikdy nedal vypnúť pre low/mid tier.
		const scratch = document.createElement('canvas');
		const gl = scratch.getContext('webgl2') as WebGL2RenderingContext | null;
		const t0 = performance.now();

		if (!gl && !vynutenyTier) {
			tier = 'none';
			pripravene = true;
			return;
		}

		const zistenyTier = zistiTierVstup(gl, 0, 0);
		if (zistenyTier === 'none') {
			tier = 'none';
			pripravene = true;
			return;
		}

		try {
			const { THREE, OrbitControls, RoomEnvironment, mergeGeometries } = await nacitajTHREE();
			if (zruseneVOnMounte || !canvasEl) return;
			const initMs = performance.now() - t0;
			const konecnyTier = zistiTierVstup(gl, initMs, 0);
			if (konecnyTier === 'none') {
				tier = 'none';
				pripravene = true;
				return;
			}
			tier = konecnyTier;
			ziva = postavScenu(THREE, OrbitControls, RoomEnvironment, mergeGeometries, canvasEl, tier);
			(globalThis as unknown as { __VIZ_CONTEXTS?: number }).__VIZ_CONTEXTS =
				((globalThis as unknown as { __VIZ_CONTEXTS?: number }).__VIZ_CONTEXTS ?? 0) + 1;

			canvasEl.addEventListener(
				'webglcontextlost',
				(e) => {
					e.preventDefault();
					if (!ziva) return;
					ziva.contextLostCount += 1;
					if (ziva.contextLostCount >= 2) {
						uvolniScenu();
						tier = 'none';
					}
				},
				{ passive: false }
			);
			canvasEl.addEventListener('webglcontextrestored', () => {
				if (tier === 'none') return;
				uvolniScenu();
				inicializuj();
			});
			canvasEl.addEventListener(
				'pointerdown',
				() => {
					dotykOverlayViditelny = false;
				},
				{ once: true }
			);

			aktualizujCamDataAtributy();
			render();
			pripravene = true;
		} catch {
			tier = 'none';
			pripravene = true;
		}
	}

	function pripravVelkost() {
		if (!ziva || !containerEl) return;
		const w = containerEl.clientWidth;
		const h = containerEl.clientHeight;
		if (w <= 0 || h <= 0) return;
		ziva.camera.aspect = w / Math.max(1, h);
		ziva.fitVzdialenost = autoFitVzdialenost(vysledok.bbox, ziva.camera.aspect);
		ziva.camera.updateProjectionMatrix();
		ziva.renderer.setSize(w, h, false);
		render();
	}

	onMount(() => {
		void inicializuj();
		let ro: ResizeObserver | undefined;
		if (containerEl && 'ResizeObserver' in window) {
			ro = new ResizeObserver(() => pripravVelkost());
			ro.observe(containerEl);
		}
		return () => {
			zruseneVOnMounte = true;
			ro?.disconnect();
			uvolniScenu();
		};
	});

	onDestroy(() => {
		zruseneVOnMounte = true;
		uvolniScenu();
	});

	// RAL/otvorenie zmeny prekreslia BEZ rebuild geometrie (RAL) / s prekresľom
	// (otvorenie mení `vysledok.diely`, ktoré rodič prepočíta a pošle znova —
	// tento efekt len zavolá render, samotná geometria sa nanovo postaví, keď sa
	// `vysledok` referenčne zmení, viď nižšie). `prekresliRAL()` číta `ralKod`
	// priamo (`$effect` automaticky sleduje reaktívne čítania AJ vo volaných
	// funkciách), preto tu netreba samostatný `ralKod;` riadok len na závislosť.
	$effect(() => {
		prekresliRAL();
	});

	let poslednyVysledok: VizVysledok | undefined;
	$effect(() => {
		if (!ziva || poslednyVysledok === vysledok) return;
		poslednyVysledok = vysledok;
		if (poslednyVysledok) {
			// otvorenie/zatvorenie zmenilo pozície dielov — geometria produktu sa
			// musí prestavať; zvyšok scény (svetlá/zem/stena/tieň) ostáva
			uvolniScenu();
			void inicializuj();
		}
	});

	export async function zachytObrazok(sirkaPx?: number, vyskaPx?: number) {
		if (!ziva) throw new Error('Vizual3D: scéna nie je pripravená');
		dotykOverlayViditelny = false;
		return zachytSnimku(ziva.THREE, {
			renderer: ziva.renderer,
			scene: ziva.scene,
			camera: ziva.camera,
			sirkaPx,
			vyskaPx
		});
	}

	export function nastavPresetVerejne(kluc: PresetKluc) {
		nastavPreset(kluc);
	}

	export function resetVerejne() {
		reset();
	}
</script>

<div bind:this={containerEl} class="vizual3d" data-testid="vizual3d">
	<canvas bind:this={canvasEl} data-testid="vizual3d-canvas" aria-label="3D náhľad zasklenia"
	></canvas>

	{#if tier === 'none' && pripravene}
		<div class="poster-overlay" data-testid="vizual3d-poster-overlay">
			{@render posterZaznam?.()}
		</div>
	{/if}

	{#if dotykOverlayViditelny && tier !== 'none' && pripravene}
		<button
			type="button"
			class="dotyk-overlay"
			data-testid="vizual3d-dotyk-overlay"
			onclick={() => (dotykOverlayViditelny = false)}
		>
			Ťuknite pre otáčanie
		</button>
	{/if}
</div>

<style>
	.vizual3d {
		position: relative;
		width: 100%;
		aspect-ratio: 16 / 10;
		background: #dfe7ee;
		border-radius: 10px;
		overflow: hidden;
	}

	canvas {
		display: block;
		width: 100%;
		height: 100%;
		touch-action: none;
	}

	.poster-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #fff;
	}

	.dotyk-overlay {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		border: none;
		background: rgba(15, 23, 42, 0.28);
		color: #fff;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
	}

	@media (hover: hover) {
		.dotyk-overlay {
			display: none;
		}
	}
</style>
