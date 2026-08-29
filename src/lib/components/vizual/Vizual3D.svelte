<script module lang="ts">
	// #333: intro kamery (glide „z hora" pri načítaní) sa spustí RAZ za načítanie stránky —
	// NIE pri každom `{#key vizKluc}` remounte (debounced zmena rozmeru remountuje Vizual3D).
	// Module-scoped (nie inštančný `$state`) → prežije remount, takže glide nebliká pri každej
	// úprave rozmeru; badge kóty naopak MÁ nabehnúť pri každom remounte (per-inštančný nižšie).
	let introUzBezal = false;
</script>

<script lang="ts">
	// Zákaznícky 3D náhľad (#170) — <canvas> + onMount + dynamický import('three').
	// SSR-bezpečné: žiadny dotyk window/document na module top-level, `three` sa
	// importuje LEN vnútri onMount za `browser` guardom (§2.2). Render-on-demand
	// (žiadny trvalý requestAnimationFrame — §2.6): render sa spustí pri zmene
	// parametra (RAL/preset/otvorené) a pri interakcii (krátkodobá rAF slučka,
	// ktorá sa SAMA ukončí, keď `controls.update()` vráti `false` — damping dobehol).
	import { onDestroy, onMount, untrack } from 'svelte';
	import { browser } from '$app/environment';
	import { base } from '$app/paths';
	import type { VizVysledok } from '$lib/vizual/spec';
	// #329 large-file-split: meshe produktu extrahované do samostatného modulu (Vizual3D prekročil
	// 1000-r. strop). Čisté funkcie (všetky vstupy ako argumenty), volané tu aj v prestavbe geometrie.
	import { postavProduktMeshe, zlikvidujProduktMeshe } from '$lib/vizual/produkt-meshe';
	import { nastavRAL, nastavSkloVzhlad, type SkloVzhlad } from '$lib/vizual/materialy';
	import { disposeVsetko, hdriUrl, nacitajHDRI } from '$lib/vizual/scena';
	// #333 large-file-split: stavba scény (postavScenu) + ZivaScena typ v scena-build.ts.
	import { postavScenu, type ZivaScena } from '$lib/vizual/scena-build';
	import {
		autoFitVzdialenost,
		fitCiel,
		orbitLimity,
		poziciaKamery,
		PRESET_DEFAULT,
		PRESETY,
		PRESETY_DOM,
		type PresetKluc,
		vzdialenostPrePreset
	} from '$lib/vizual/kamera';
	import { detekujTier, nastaveniaPreTier, postprocPovoleny, type Tier } from '$lib/vizual/kvalita';
	import { snimka as zachytSnimku } from '$lib/vizual/snimka';
	import type { PostprocModuly } from '$lib/vizual/postproc';

	let {
		vysledok,
		ralKod,
		skloVzhlad,
		preset = $bindable<PresetKluc>(PRESET_DEFAULT),
		vynutenyTier,
		zobrazDom = false,
		pripravene = $bindable(false),
		aktualnyTier = $bindable<Tier>('high'),
		posterZaznam
	}: {
		vysledok: VizVysledok;
		ralKod: string;
		/** voliteľné prepísanie vzhľadu skla (#276 — priehľadnosť podľa typu skla).
		 *  `undefined` = pôvodné zasklenia sklo (spätne kompatibilné). */
		skloVzhlad?: SkloVzhlad;
		preset?: PresetKluc;
		/** testovací hook (`?viz=low`/`?viz=none` v URL) — vynúti tier bez ohľadu
		 *  na skutočné HW, pre e2e determinizmus (§2.12) */
		vynutenyTier?: Tier;
		/** #325: zobraziť dekoratívny „dom" (solídna fasáda + dvere + okno) pred stenou —
		 *  LEN pergola konfigurátor (VizualPergolaZakaznik). Zasklenia scény ostávajú s
		 *  pôvodnou stenou (dverný otvor, fixná výška) a bez domu (default false). */
		zobrazDom?: boolean;
		/** scéna je postavená a prvý render prebehol (alebo T0 poster je aktívny) —
		 *  rodič (napr. zákaznícky tlačový list) na toto čaká pred `zachytObrazok()` */
		pripravene?: boolean;
		/** zistený kvalitatívny tier (pre rodiča, napr. na zobrazenie diagnostiky) */
		aktualnyTier?: Tier;
		/** T0 poster content — vykreslí sa namiesto/nad canvasom pri tier==='none' */
		posterZaznam?: import('svelte').Snippet;
	} = $props();

	// #333: pergola (`zobrazDom`) načíta model „z hora" — vlastná preset tabuľka
	// (`PRESETY_DOM`, troStvrte elev 28° → dominantne vidno strešné sklo). Zasklenia scéna
	// ostáva na `PRESETY` (elev 7°, výška oka 1,5–1,7 m — `vizual-kamera-kvalita.test.ts`).
	// `zobrazDom` je fixné počas života komponentu → `untrack` jednorazové čítanie (inak
	// `state_referenced_locally` warning, ako pri `data`-default v konfigurátore §3).
	const presety = untrack(() => (zobrazDom ? PRESETY_DOM : PRESETY));

	let canvasEl = $state<HTMLCanvasElement | undefined>();
	let containerEl = $state<HTMLDivElement | undefined>();
	// seedne sa z bindable `aktualnyTier` (default 'high') — inak by ESLint
	// správne varoval, že jeho default sa nikde nečíta pred prepísaním nižšie
	let tier = $state<Tier>(aktualnyTier);
	let dotykOverlayViditelny = $state(true);
	let camAzimutDeg = $state(presety[PRESET_DEFAULT].azimut);
	let camElevaciaDeg = $state(presety[PRESET_DEFAULT].elevacia);

	// #333 intro glide + in-scene kóta (LEN pergola/`zobrazDom`)
	let introBezi = false;
	let introRafId = 0;
	let kotaText = $state('');
	let kotaViditelna = $state(false);
	let kotaTimeout: ReturnType<typeof setTimeout> | undefined;

	// `tier` (interný) sa zrkadlí do bindable `aktualnyTier` (verejný) — rodič
	// (napr. zákaznícky tlačový list) ho môže čítať bez potreby vlastnej kópie
	// detekčnej logiky.
	$effect(() => {
		aktualnyTier = tier;
	});

	// #333: `ZivaScena` + `postavScenu` (stavba scény) presunuté do `scena-build.ts`
	// (Vizual3D prekročil 1000-r. strop pridaním intro/kóty/výzvy); životný cyklus tu ostáva.
	let ziva: ZivaScena | null = null;
	let zruseneVOnMounte = false;

	function render() {
		if (!ziva) return;
		// #288: keď existuje post-processing composer (mid/high + hardvér), renderuje
		// cezeň (GTAO/SMAA/bloom); inak priamy jednoprechodový render (low/none/softvér).
		if (ziva.postproc) ziva.postproc.render();
		else ziva.renderer.render(ziva.scene, ziva.camera);
	}

	/** Krátkodobá rAF slučka — SAMA sa ukončí, keď `controls.update()` vráti
	 *  `false` (damping dobehol). Toto NIE JE trvalý render loop. */
	function tikaj() {
		if (!ziva) return;
		// #333: akákoľvek interakcia (OrbitControls `'start'` → táto slučka) ukončí intro
		// glide, aby dve rAF slučky nefightovali kameru.
		if (introBezi) zrusIntro();
		const zmenene = ziva.controls.update();
		render();
		if (zmenene) requestAnimationFrame(tikaj);
	}

	/** #333 — zruší prebiehajúci intro glide (užívateľ začal interakciu / export / preset). */
	function zrusIntro() {
		introBezi = false;
		if (introRafId) {
			cancelAnimationFrame(introRafId);
			introRafId = 0;
		}
	}

	/** #333 — jemný ~1,7 s ease-out glide kamery z mierne odlišného uhla do defaultného
	 *  presetu (LEN pergola). Naznačí, že scéna je živá/otáčateľná; ŽIADNY nekonečný
	 *  auto-rotate. Per-frame nastavuje `camera.position` + `controls.update()` (ako
	 *  `aplikujPreset`), na konci jeden finálny `controls.update()` (sync interného
	 *  spherical → prvý drag „neskočí"). */
	function introKamery() {
		if (!ziva || !containerEl) return;
		const p = presety[preset];
		const ciel = fitCiel(vysledok.bbox);
		const vzd = vzdialenostPrePreset(preset, ziva.fitVzdialenost);
		const az0 = p.azimut + 22; // štart mierne frontálnejšie
		const el0 = Math.max(6, p.elevacia - 12); // štart mierne nižšie
		const trvanie = 1700;
		const t0 = performance.now();
		introBezi = true;
		const krok = (now: number) => {
			if (!ziva || !introBezi) {
				introRafId = 0;
				return;
			}
			const u = Math.min(1, (now - t0) / trvanie);
			const e = 1 - Math.pow(1 - u, 3); // ease-out cubic
			const az = az0 + (p.azimut - az0) * e;
			const el = el0 + (p.elevacia - el0) * e;
			const poz = poziciaKamery(ciel, az, el, vzd);
			ziva.camera.position.set(poz.x, poz.y, poz.z);
			ziva.controls.target.set(ciel.x, ciel.y, ciel.z);
			ziva.controls.update();
			render();
			if (u < 1) {
				introRafId = requestAnimationFrame(krok);
			} else {
				introBezi = false;
				introRafId = 0;
				ziva.controls.update();
			}
		};
		introRafId = requestAnimationFrame(krok);
	}

	/** #333 — decentná in-scene kóta „Š × H m" pri (re)monte scény = pri zmene rozmeru
	 *  (rodič remountuje `{#key vizKluc}` na debounced rozmery). Zmizne po ~2 s. */
	function zobrazKotu() {
		// mm → „4,0" (čiarka, 1 desatinné) — inline, aby zdieľaný Vizual3D neimportoval
		// konfigurator modul (money-guard allowlist §2.13); rovnaký tvar ako konfigurator-jednotky.
		const m = (xMm: number) => (xMm / 1000).toFixed(1).replace('.', ',');
		kotaText = `${m(vysledok.bbox.w)} × ${m(vysledok.bbox.d)} m`;
		kotaViditelna = true;
		if (kotaTimeout) clearTimeout(kotaTimeout);
		kotaTimeout = setTimeout(() => {
			kotaViditelna = false;
		}, 2000);
	}

	function aktualizujCamDataAtributy() {
		const p = presety[preset];
		camAzimutDeg = p.azimut;
		camElevaciaDeg = p.elevacia;
	}

	/** Aplikuje kameru pre daný preset — NIKDY nezapisuje do `preset` (na rozdiel
	 *  od pôvodnej `nastavPreset`, ktorá to robila a preto sa nedala bezpečne
	 *  volať z efektu sledujúceho `preset`). Volá sa (a) z `$effect` nižšie —
	 *  JEDINÝ trigger pre zmenu presetu, vrátane zmeny cez `bind:preset` z
	 *  rodiča (klik na tlačidlo presetu v paneli) — predtým sa taký externý
	 *  zápis do bindable `preset` NIKDY neaplikoval na kameru, lebo nič naň
	 *  nereagovalo; (b) priamo z `reset()` pre istotu, aj keď sa `preset`
	 *  nezmenil (Svelte efekt sa pri zápise ROVNAKEJ hodnoty znova nespustí). */
	function aplikujPreset(kluc: PresetKluc, znovaFit = false) {
		if (!ziva) return;
		zrusIntro(); // #333: klik na preset / reset preruší intro glide
		const p = presety[kluc];
		if (znovaFit && containerEl) {
			ziva.fitVzdialenost = autoFitVzdialenost(
				vysledok.bbox,
				containerEl.clientWidth / Math.max(1, containerEl.clientHeight)
			);
		}
		const vzd = vzdialenostPrePreset(kluc, ziva.fitVzdialenost);
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
		camAzimutDeg = p.azimut;
		camElevaciaDeg = p.elevacia;
		render();
	}

	// JEDINÝ miesto, kde sa preset naozaj aplikuje na kameru — reaguje na
	// AKÚKOĽVEK zmenu `preset` (interný `reset()`/`nastavPresetVerejne()`, AJ
	// externý zápis cez `bind:preset` z Vizual3DPanel.svelte).
	$effect(() => {
		aplikujPreset(preset);
	});

	function reset() {
		if (!ziva) return;
		ziva.controls.reset();
		preset = PRESET_DEFAULT;
		aplikujPreset(PRESET_DEFAULT, true);
	}

	// #329 ČESTNÝ signál skutočného prekreslenia (NIE prop-pass): applied atribúty sa zapisujú
	// LEN v miestach, kde sa materiál naozaj mutuje (prekresliRAL/prekresliSklo/prestavGeometriu-
	// Produktu/stavba scény). `data-viz-ral` (v `pripravDataZAtributov`) je oproti tomu prop-pass
	// (mení sa pri každej zmene propu bez ohľadu na prekreslenie). E2E asertuje applied atribúty →
	// dokáže, že zmena RAL/skla sa naozaj premietla do 3D (regression-test-first pre #329 bug).
	// review 🔵: podpis nesie viac než len farbaHex — dve vizuálne rodiny by mohli zdieľať hex a
	// líšiť sa opacity/roughness; tak signál (a e2e) nezmešká reálne prekreslenie ani do budúcna.
	function skloPodpis(vz: SkloVzhlad): string {
		return `${vz.farbaHex}|${vz.opacity}|${vz.roughness}`;
	}
	function oznacRalApplied() {
		if (containerEl) containerEl.dataset.vizRalApplied = ralKod;
	}
	function oznacSkloApplied(vz: SkloVzhlad | undefined) {
		if (containerEl && vz) containerEl.dataset.vizSkloApplied = skloPodpis(vz);
	}

	function prekresliRAL() {
		// #329 root-cause fix: reaktívne vstupy (`ralKod`, `tier`) čítame do lokálov PRED `!ziva`
		// gate-om. `ziva` je obyčajný `let` (nie `$state`), plnený až async `inicializuj()`; prvý
		// beh efektu `$effect(() => prekresliRAL())` prebehne kým `ziva===null`. Keby sme gateovali
		// pred čítaním propu, efekt by v tom behu nezaregistroval žiadnu závislosť a bol by navždy
		// mŕtvy (zmena farby po monte by 3D neprekreslila). Čítaním PRED gate-om efekt zaregistruje
		// `ralKod`/`tier` už pri prvom behu → pri každej ďalšej zmene sa spustí a materiál sa zmutuje.
		const kod = ralKod;
		const t = tier;
		if (!ziva) return;
		const nastavenia = nastaveniaPreTier(t === 'none' ? 'low' : t);
		for (const rola of ['ram', 'kolajnica', 'klucka', 'klin'] as const) {
			const mat = ziva.materialy[rola];
			if (mat) nastavRAL(ziva.THREE, mat, kod, nastavenia.clearcoat);
		}
		oznacRalApplied();
		render();
	}

	/** Živá zmena vzhľadu skla (typ skla) BEZ rebuildu geometrie (#276) — mutuje
	 *  existujúci sklo materiál (analógia `prekresliRAL`). Robí niečo LEN keď
	 *  `skloVzhlad` je zadané (pergola zákaznícky režim); pri zasklení
	 *  (`skloVzhlad === undefined`) je no-op a sklo ostáva pôvodné. */
	function prekresliSklo() {
		// #329 root-cause fix (rovnako ako prekresliRAL): reaktívne vstupy (`skloVzhlad`, `tier`)
		// čítame do lokálov PRED `!ziva` gate-om, aby efekt `$effect(() => prekresliSklo())`
		// zaregistroval závislosť aj pri prvom behu (ziva===null) a spustil sa pri každej zmene skla.
		const vz = skloVzhlad;
		const t = tier;
		if (!ziva || !ziva.skloMaterial || !vz) return;
		const nastavenia = nastaveniaPreTier(t === 'none' ? 'low' : t);
		nastavSkloVzhlad(ziva.THREE, ziva.skloMaterial, nastavenia.sklo, vz);
		oznacSkloApplied(vz);
		render();
	}

	function pripravDataZAtributov(el: HTMLElement | undefined) {
		if (!el) return;
		el.dataset.vizReady = pripravene ? 'true' : 'false';
		el.dataset.vizPreset = preset;
		el.dataset.vizCam = `${camAzimutDeg.toFixed(1)},${camElevaciaDeg.toFixed(1)}`;
		el.dataset.vizRal = ralKod;
		// #288: či je aktívny post-processing composer (mid/high + hardvér). Diagnostika
		// paralelná k `data-viz-ready` — E2E ňou overí, že na SOFTVÉROVOM CI rendereri je
		// gate správne VYPNUTÝ (`false` → priamy render, žiadna #290 regresia), a naživo na
		// hardvéri ZAPNUTÝ (`true`). `ziva` nie je `$state`, ale efekt sa už spúšťa cez
		// `pripravene` (flipne až po postavení scény), takže `ziva.postproc` je vtedy known.
		el.dataset.vizPostproc = ziva?.postproc ? 'true' : 'false';
	}

	$effect(() => {
		pripravDataZAtributov(containerEl);
	});

	async function nacitajTHREE() {
		const [THREE, { OrbitControls }, { RoomEnvironment }, { mergeGeometries }, { HDRLoader }] =
			await Promise.all([
				import('three'),
				import('three/examples/jsm/controls/OrbitControls.js'),
				import('three/examples/jsm/environments/RoomEnvironment.js'),
				import('three/examples/jsm/utils/BufferGeometryUtils.js'),
				// r0.185: HDRLoader (RGBELoader je deprecovaný alias — waroval by)
				import('three/examples/jsm/loaders/HDRLoader.js')
			]);
		return { THREE, OrbitControls, RoomEnvironment, mergeGeometries, HDRLoader };
	}

	/** #288: lazy-import post-processing pass modulov — LEN keď je gate ON (mid/high +
	 *  hardvér). Oddelené od `nacitajTHREE()`, aby sa ~30–40 KB pass kódu nedostalo do
	 *  low-tier/mobil kritickej cesty (bundle disciplína pre verejnú mobil-first route). */
	async function nacitajPostproc(): Promise<PostprocModuly> {
		const [
			{ EffectComposer },
			{ RenderPass },
			{ GTAOPass },
			{ UnrealBloomPass },
			{ OutputPass },
			{ SMAAPass }
		] = await Promise.all([
			import('three/examples/jsm/postprocessing/EffectComposer.js'),
			import('three/examples/jsm/postprocessing/RenderPass.js'),
			import('three/examples/jsm/postprocessing/GTAOPass.js'),
			import('three/examples/jsm/postprocessing/UnrealBloomPass.js'),
			import('three/examples/jsm/postprocessing/OutputPass.js'),
			import('three/examples/jsm/postprocessing/SMAAPass.js')
		]);
		return { EffectComposer, RenderPass, GTAOPass, UnrealBloomPass, OutputPass, SMAAPass };
	}

	/** UNMASKED_RENDERER_WEBGL reťazec (na rozhodnutie post-processing gate —
	 *  softvérový SwiftShader/CI vs hardvér). Prázdny keď `WEBGL_debug_renderer_info`
	 *  nedostupné (privacy) → `jeSoftverovyRenderer` to berie ako softvér (fail-safe). */
	function citajUnmaskedRenderer(gl: WebGL2RenderingContext | null): string {
		if (!gl) return '';
		try {
			const ext = gl.getExtension('WEBGL_debug_renderer_info');
			if (ext) return String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
		} catch {
			// bez debug info → prázdny reťazec (fail-safe: softvér → composer OFF)
		}
		return '';
	}

	function zistiTierVstup(
		gl: WebGL2RenderingContext | null,
		initMs: number,
		contextLostCount: number
	) {
		if (vynutenyTier) return vynutenyTier;
		if (!gl) return detekujTier({ webgl2Dostupny: false });
		return detekujTier({
			webgl2Dostupny: true,
			hardwareConcurrency: navigator.hardwareConcurrency,
			deviceMemory: (navigator as unknown as { deviceMemory?: number }).deviceMemory,
			unmaskedRenderer: citajUnmaskedRenderer(gl), // #288 review 🔵: zdieľaný helper (bez duplicity)
			devicePixelRatio: window.devicePixelRatio,
			initMs,
			contextLostCount
		});
	}

	/** V-mieste prestavba LEN geometrie produktu (napr. "Otvoriť"/rozmer) —
	 *  renderer/kamera/controls/svetlá/zem/stena/obloha/tieň ZOSTÁVAJÚ. NIKDY
	 *  nevolá `renderer.forceContextLoss()` (na rozdiel od `uvolniScenu()`) —
	 *  tá je NEVRATNÁ (webgl kontext sa na tom istom canvase už nikdy nedá
	 *  znova vytvoriť bez skutočného prehliadačového `webglcontextrestored`),
	 *  takže volanie plného `uvolniScenu()+inicializuj()` pri KAŽDEJ zmene
	 *  geometrie spôsobovalo pád na druhý pokus (nájdené pri live vizuálnej
	 *  kontrole — klik na "Otvoriť" spadol na T0 poster s
	 *  `WebGLCapabilities`/`getMaxPrecision` TypeError). */
	function prestavGeometriuProduktu(novyVysledok: VizVysledok) {
		if (!ziva) return;
		for (const mesh of ziva.produktMeshe) ziva.scene.remove(mesh);
		zlikvidujProduktMeshe(ziva.produktMeshe);

		const nastavenia = nastaveniaPreTier(tier === 'none' ? 'low' : tier);
		const { materialy, produktMeshe, skloMaterial } = postavProduktMeshe(
			ziva.THREE,
			ziva.mergeGeometries,
			ziva.scene,
			novyVysledok,
			ralKod,
			nastavenia,
			skloVzhlad
		);
		ziva.materialy = materialy;
		ziva.produktMeshe = produktMeshe;
		ziva.skloMaterial = skloMaterial;
		oznacRalApplied();
		oznacSkloApplied(skloVzhlad);
		render();
	}

	// #333: `postavScenu` je v `$lib/vizual/scena-build.ts` (parameter injection cez `SceneCtx`).

	function uvolniScenu() {
		if (!ziva) return;
		// #288: composer targety (GTAO/bloom/SMAA) žijú na GL kontexte rendereru —
		// dispose PRED `forceContextLoss()`, inak GPU pamäť unikne pri každom
		// unmount/context-lost cykle.
		ziva.postproc?.dispose();
		ziva.controls.dispose();
		zlikvidujProduktMeshe(ziva.produktMeshe);
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
			const { THREE, OrbitControls, RoomEnvironment, mergeGeometries, HDRLoader } =
				await nacitajTHREE();
			if (zruseneVOnMounte || !canvasEl) return;
			const initMs = performance.now() - t0;
			const konecnyTier = zistiTierVstup(gl, initMs, 0);
			if (konecnyTier === 'none') {
				tier = 'none';
				pripravene = true;
				return;
			}
			tier = konecnyTier;
			// #285: reálne HDRI/IBL (mid/high tier) — načíta sa z vlastného
			// originu (`static/hdri/`), NIKDY externý fetch. `nacitajHDRI` vráti
			// `null` pri akejkoľvek chybe → `vytvorEnvironment` graceful padne na
			// procedurálny `RoomEnvironment` (scéna sa nikdy nezhodí kvôli assetu).
			const hdrTexture = nastaveniaPreTier(tier).hdri
				? await nacitajHDRI(HDRLoader, hdriUrl(base))
				: null;
			// #288: post-processing gate — LEN mid/high tier (`postproc` flag) A LEN
			// HARDVÉROVÝ renderer (softvérový SwiftShader/CI má malý alokačný rozpočet,
			// #290). Moduly sa lazy-importujú len keď gate prejde (mimo low/mobil kritickej
			// cesty). `citajUnmaskedRenderer(gl)` číta GPU string zo scratch kontextu — tá
			// istá GPU ako reálny renderer, takže softvér/hardvér verdikt je rovnaký.
			// #288 review 🟡: postproc pass moduly sú OPTIONAL (samostatný lazy chunk) —
			// zlyhanie ich fetchu (flaky mobilná sieť na verejnej route) NESMIE zhodiť
			// scénu na T0 poster (rovnaká graceful disciplína ako `nacitajHDRI` → null).
			// `.catch(()=>null)` → composer sa nepostaví, ide priamy render, náhľad žije.
			const postprocModuly = postprocPovoleny(nastaveniaPreTier(tier), citajUnmaskedRenderer(gl))
				? await nacitajPostproc().catch(() => null)
				: null;
			if (zruseneVOnMounte || !canvasEl) {
				hdrTexture?.dispose();
				return;
			}
			ziva = postavScenu(
				THREE,
				OrbitControls,
				RoomEnvironment,
				mergeGeometries,
				canvasEl,
				tier,
				hdrTexture,
				postprocModuly,
				{
					vysledok,
					ralKod,
					skloVzhlad,
					preset,
					presety,
					zobrazDom,
					containerEl,
					onStart: tikaj,
					onChange: render
				}
			);
			(globalThis as unknown as { __VIZ_CONTEXTS?: number }).__VIZ_CONTEXTS =
				((globalThis as unknown as { __VIZ_CONTEXTS?: number }).__VIZ_CONTEXTS ?? 0) + 1;
			// KRITICKÉ: `THREE.WebGLRenderer({canvas, ...})` NEmení canvas
			// atribúty width/height (zostávajú na HTML default 300×150), kým sa
			// explicitne nezavolá `renderer.setSize()` — spoliehať sa len na
			// `ResizeObserver`'s prvý (asynchrónny) callback pretekalo s týmto
			// async blokom a niekedy prehralo (žiadna ĎALŠIA zmena veľkosti
			// kontajnera už nikdy nenastala, takže canvas ostal navždy na
			// 300×150 roztiahnutý cez CSS na celú šírku — extrémna pixelácia +
			// zdeformovaný aspect pomer, ktorý pôsobil ako orezanie obsahu).
			pripravVelkost();

			// POZOR: `webglcontextlost`/`webglcontextrestored`/`pointerdown`
			// listenery sa registrujú RAZ v `onMount` (nižšie), NIE tu — táto
			// funkcia (`inicializuj`) sa môže zavolať OPAKOVANE na TOM ISTOM
			// `canvasEl` (napr. `webglcontextrestored` handler ju volá znova po
			// obnove kontextu); keby sa listenery pridávali tu, každý ďalší
			// stratený/obnovený cyklus by nahromadil ĎALŠIU kópiu tých istých
			// listenerov na tom istom canvase.
			aktualizujCamDataAtributy();
			// #329 baseline applied-atribútov po postavení scény (postavScenu aplikuje aktuálny
			// ralKod/skloVzhlad na materiály) — čestný počiatočný stav pre E2E prekreslenia.
			oznacRalApplied();
			oznacSkloApplied(skloVzhlad);
			render();
			pripravene = true;
			// #288 review 🔵: `pripravene` mení efekt `pripravDataZAtributov` LEN pri
			// prvom flipe false→true; pri `webglcontextrestored` re-inite ostáva `true`,
			// takže efekt sa znova nespustí a `data-viz-postproc` by ostal stale, ak sa
			// gate rozhodol inak (napr. context restore na prepnutom GPU). Zavoláme ho
			// explicitne (na prvom mounte redundantné, pri re-inite nutné).
			pripravDataZAtributov(containerEl);
			// #288 review 🔵: SMAA area/search textúry sa dekódujú async (Image.onload z
			// data-URI); prvý composer render môže bežať pred ich pripravením → hero frame
			// bez AA na hrany až do prvej interakcie (on-demand engine sám neprekresľuje).
			// Jeden odložený re-render po dobehnutí textúr zachytí AA na počiatočnom zábere.
			if (ziva?.postproc && typeof requestAnimationFrame === 'function') {
				requestAnimationFrame(() => render());
			}
			// #333: LEN pergola. Intro glide „z hora" RAZ za načítanie (module-scoped guard →
			// nebliká pri každom {#key} remounte rozmerov); in-scene kóta „Š × H m" pri KAŽDOM
			// (re)monte = pri každej zmene rozmeru (zmizne po ~2 s).
			if (zobrazDom && typeof requestAnimationFrame === 'function') {
				zobrazKotu();
				if (!introUzBezal) {
					introUzBezal = true;
					introKamery();
				}
			}
		} catch (e) {
			// Nikdy nesmie zostať tichá — chyba počas stavby scény (napr.
			// programátorská chyba, nie skutočná nedostupnosť WebGL) by sa
			// inak nerozoznateľne maskovala ako "zariadenie WebGL nepodporuje",
			// čo klame používateľa AJ znemožňuje debugovanie (§2.9 T0 fallback
			// je pre GENUINE WebGL zlyhanie, nie pre bug v našom kóde).
			console.error('Vizual3D: chyba pri stavbe scény, prepínam na T0 poster', e);
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
		ziva.postproc?.setSize(w, h); // #288: composer targety musia držať krok s canvasom
		render();
	}

	onMount(() => {
		// `webglcontextlost`/`webglcontextrestored`/`pointerdown` sa registrujú
		// RAZ TU (na `canvasEl`, ktorý žije pre celý mount) — NIE vnútri
		// `inicializuj()`, ktorá sa môže na tom istom canvase zavolať opakovane
		// (viď jej vlastný komentár) a inak by pri každom stratenom/obnovenom
		// kontexte nahromadila ďalšiu kópiu tých istých listenerov.
		const naStrataKontextu = (e: Event) => {
			e.preventDefault();
			if (!ziva) return;
			ziva.contextLostCount += 1;
			if (ziva.contextLostCount >= 2) {
				uvolniScenu();
				tier = 'none';
			}
		};
		const naObnovuKontextu = () => {
			if (tier === 'none') return;
			uvolniScenu();
			void inicializuj();
		};
		const naPrvyDotyk = () => {
			dotykOverlayViditelny = false;
			zrusIntro(); // #333: prvá interakcia ukončí intro glide aj skryje výzvu otáčať
		};
		canvasEl?.addEventListener('webglcontextlost', naStrataKontextu, { passive: false });
		canvasEl?.addEventListener('webglcontextrestored', naObnovuKontextu);
		canvasEl?.addEventListener('pointerdown', naPrvyDotyk, { once: true });

		void inicializuj();
		let ro: ResizeObserver | undefined;
		if (containerEl && 'ResizeObserver' in window) {
			ro = new ResizeObserver(() => pripravVelkost());
			ro.observe(containerEl);
		}
		return () => {
			zruseneVOnMounte = true;
			ro?.disconnect();
			canvasEl?.removeEventListener('webglcontextlost', naStrataKontextu);
			canvasEl?.removeEventListener('webglcontextrestored', naObnovuKontextu);
			canvasEl?.removeEventListener('pointerdown', naPrvyDotyk);
			zrusIntro(); // #333: zruš intro rAF pri unmount/remount
			if (kotaTimeout) clearTimeout(kotaTimeout);
			uvolniScenu();
		};
	});

	onDestroy(() => {
		zruseneVOnMounte = true;
		zrusIntro();
		if (kotaTimeout) clearTimeout(kotaTimeout);
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

	// #276: živá zmena typu skla (`skloVzhlad`) prekreslí sklo BEZ rebuildu
	// geometrie (mutácia materiálu, analógia RAL efektu vyššie). `prekresliSklo`
	// číta `skloVzhlad` priamo, takže `$effect` naň automaticky reaguje; pri
	// zasklení (`skloVzhlad === undefined`) je no-op.
	$effect(() => {
		prekresliSklo();
	});

	// KRITICKÉ: `zaskleniaSpec()` (volaná v rodičovi, Vizual3DPanel.svelte)
	// vracia VŽDY nový objekt/pole — aj keď sa zmenil LEN `ralKod` (RAL
	// ovplyvňuje `poznamky`, teda `$derived(zaskleniaSpec(...))` sa v rodičovi
	// prepočíta pri KAŽDEJ zmene RAL). Porovnávanie čistou REFERENCIOU by preto
	// spustilo PLNÝ rebuild geometrie pri každom kliku na RAL čip — presne to,
	// čo §2.7 zakazuje ("RAL čipy menia iba material.color, ŽIADNA rebuild
	// geometrie"), a pretekalo by to s ľahkým `prekresliRAL()` efektom vyššie.
	// Namiesto referencie sa porovnáva ĽAHKÝ ŠTRUKTÚRNY podpis (diely + bbox) —
	// rebuild nastane LEN keď sa naozaj zmenila geometria (rozmery/otvorenie/
	// kliny…). Baseline sa počíta HNEĎ (nie až v efekte) — inak by prvá zmena
	// po mounte (aj čisto RAL) omylom vyzerala ako "zmena", lebo by nemala s
	// čím sa porovnať.
	function geometrickyPodpis(v: VizVysledok): string {
		return JSON.stringify({ bbox: v.bbox, diely: v.diely });
	}

	// `untrack()` — čítanie počiatočnej hodnoty `vysledok` je TU zámerne
	// jednorazové (baseline), nie reaktívna závislosť tohto riadku.
	let posledniPodpis = untrack(() => geometrickyPodpis(vysledok));
	$effect(() => {
		const podpis = geometrickyPodpis(vysledok);
		if (podpis === posledniPodpis) return; // žiadna geometrická zmena (napr. len RAL)
		posledniPodpis = podpis;
		if (!ziva) return; // scéna ešte nie je postavená (napr. tier 'none') — niet čo prestavať
		// otvorenie/zatvorenie alebo zmena rozmerov zmenili pozície dielov —
		// LEN geometria produktu sa prestavia (`prestavGeometriuProduktu`,
		// NIKDY plný `uvolniScenu()+inicializuj()` — ten volá nevratný
		// `renderer.forceContextLoss()`, viď jeho vlastný komentár).
		prestavGeometriuProduktu(vysledok);
	});

	export async function zachytObrazok(sirkaPx?: number, vyskaPx?: number) {
		if (!ziva) throw new Error('Vizual3D: scéna nie je pripravená');
		dotykOverlayViditelny = false;
		// #333: ak intro glide práve beží, zachyť čistý FINÁLNY záber (nie prechodný uhol);
		// inak zachyť aktuálnu kameru (nezmenené správanie pre zasklenia tlačový list).
		if (introBezi) {
			zrusIntro();
			aplikujPreset(preset);
		}
		const blob = await zachytSnimku(ziva.THREE, {
			renderer: ziva.renderer,
			scene: ziva.scene,
			camera: ziva.camera,
			sirkaPx,
			vyskaPx
		});
		// #288 review 🟡: `snimka.ts`'s `finally` obnoví obrazovku PRIAMYM
		// `renderer.render()` (bez composera). Na hardvéri (mid/high) by tak obrazovka
		// po exporte PNG stratila GTAO/SMAA/bloom až do ďalšej interakcie (on-demand
		// engine sám neprekresľuje). Composer-aware `render()` obnoví post-processovaný
		// stav (na softvéri/low je `render()` beztak priamy — no-op rozdiel).
		render();
		return blob;
	}

	export function nastavPresetVerejne(kluc: PresetKluc) {
		preset = kluc;
		aplikujPreset(kluc);
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

	<!-- #333: výzva OTÁČAŤ — malý pill (ikona + text), desktop AJ mobil, jemný pulz,
	     `pointer-events:none` (nikdy neblokuje orbit — pointerdown ide na canvas → skryje ho).
	     Mizne pri prvej interakcii (`naPrvyDotyk`). -->
	{#if dotykOverlayViditelny && tier !== 'none' && pripravene}
		<div class="rotacia-hint" data-testid="vizual3d-dotyk-overlay" aria-hidden="true">
			<svg class="rotacia-ikona" viewBox="0 0 24 24" fill="none" aria-hidden="true">
				<path
					d="M4.5 9a8 8 0 0 1 14-2.5M19.5 15a8 8 0 0 1-14 2.5"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
				/>
				<path
					d="M18.5 3.5v3h-3M5.5 20.5v-3h3"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
			<span>Potiahnite a otáčajte</span>
		</div>
	{/if}

	<!-- #333: decentná in-scene kóta rozmerov, zmizne po ~2 s (LEN pergola/`zobrazDom`). -->
	{#if kotaViditelna && zobrazDom && tier !== 'none' && pripravene}
		<div class="kota-badge" data-testid="vizual3d-kota" aria-hidden="true">{kotaText}</div>
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

	/* #333: výzva otáčať — pill dole v strede, NIKDY neblokuje orbit (pointer-events:none). */
	.rotacia-hint {
		position: absolute;
		left: 50%;
		bottom: 14px;
		transform: translateX(-50%);
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 8px 14px;
		border-radius: 999px;
		background: rgba(15, 23, 42, 0.55);
		color: #fff;
		font-size: 13px;
		font-weight: 600;
		white-space: nowrap;
		pointer-events: none;
		animation: rotacia-pulz 2s ease-in-out infinite;
	}
	.rotacia-ikona {
		width: 18px;
		height: 18px;
		flex-shrink: 0;
	}
	@keyframes rotacia-pulz {
		0%,
		100% {
			opacity: 0.78;
			transform: translateX(-50%) translateY(0);
		}
		50% {
			opacity: 1;
			transform: translateX(-50%) translateY(-2px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.rotacia-hint {
			animation: none;
		}
	}

	/* #333: in-scene kóta rozmerov — decentný badge vpravo hore, fade in/out. */
	.kota-badge {
		position: absolute;
		top: 12px;
		right: 12px;
		padding: 5px 11px;
		border-radius: 8px;
		background: rgba(15, 23, 42, 0.5);
		color: #fff;
		font-size: 12.5px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.02em;
		pointer-events: none;
		animation: kota-fade 0.35s ease-out;
	}
	@keyframes kota-fade {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
