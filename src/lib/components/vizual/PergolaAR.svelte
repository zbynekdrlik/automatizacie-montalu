<script lang="ts">
	// AR náhľad pergoly (#286) — „Pozri v AR". Mobil-first: AR má zmysel na telefóne.
	//
	// DVA režimy:
	//  - 'auto' (inline na /konfigurator): NEnačíta model-viewer. Mobil → tlačidlo-odkaz na
	//    samostatnú AR stránku `/konfigurator/ar`; desktop → QR na tú istú stránku. Dôvod:
	//    /konfigurator už má 3D náhľad (#276) na PROJEKTOVOM three@0.185; model-viewer nesie
	//    VLASTNÝ (bundlený) three → dve inštancie three na jednej stránke = `THREE.WARNING:
	//    Multiple instances` (poruší zero-console E2E) + zbytočný ~1 MB bundle na súhrne.
	//    Preto AR viewer žije na samostatnej stránke, kde je len model-viewer (jedna three).
	//  - 'viewer' (stránka /konfigurator/ar): načíta model-viewer a ukáže model + AR tlačidlo.
	//
	// Zdroj modelu je SERVEROVÝ GLB endpoint (`/konfigurator/model.glb?…`) — reálna http URL,
	// aby fungovali VŠETKY AR režimy (WebXR / Scene Viewer / Quick Look; klientsky blob by pre
	// Scene Viewer nefungoval, viď dizajn #286). iOS: Quick Look generuje USDZ za behu (auto,
	// bez `ios-src`) — pergola je statický model (bez animácií), auto-USDZ postačuje.
	//
	// Money-neutrálne: len rozmery + typ skla (kľúč) + RAL kód poskladá do URL GLB endpointu.
	import { onMount } from 'svelte';
	import { base, resolve } from '$app/paths';

	let {
		sirkaMm,
		hlbkaMm,
		vyskaVpreduMm,
		vyskaPriSteneMm,
		typSkla,
		ralKod,
		rezim = 'auto'
	}: {
		sirkaMm: number;
		hlbkaMm: number;
		vyskaVpreduMm: number;
		vyskaPriSteneMm: number;
		/** vizuálny kľúč skla (cire/dymove/bronzove/matne) */
		typSkla: string;
		/** RAL kód konštrukcie */
		ralKod: string;
		/** 'auto' = inline (mobil tlačidlo-odkaz, desktop QR); 'viewer' = model-viewer (AR stránka) */
		rezim?: 'auto' | 'viewer';
	} = $props();

	// Parametre konfigurácie do query stringu (zdieľané GLB endpointom aj AR stránkou).
	const params = $derived(
		new URLSearchParams({
			sirka: String(Math.round(sirkaMm)),
			hlbka: String(Math.round(hlbkaMm)),
			vyskaVpredu: String(Math.round(vyskaVpreduMm)),
			vyskaPriStene: String(Math.round(vyskaPriSteneMm)),
			sklo: typSkla,
			farba: ralKod
		}).toString()
	);
	const glbUrl = $derived(`${base}/konfigurator/model.glb?${params}`);
	const arHref = $derived(`${resolve('/konfigurator/ar')}?${params}`);

	let mvReady = $state(false);
	let mvChyba = $state(false);
	let jeMobil = $state(false);
	let qrDataUrl = $state<string>('');

	onMount(() => {
		if (rezim === 'viewer') {
			// AR stránka — načítaj bundlený model-viewer dist (vlastný three, decoupled od
			// projektového three@0.185). `dist/model-viewer.js` (nie .min) nesie typy (.d.ts);
			// Vite ho pri builde minifikuje sám. Na tejto stránke NIE JE projektový three →
			// žiadny multi-instance warning.
			import('@google/model-viewer/dist/model-viewer.js')
				.then(() => (mvReady = true))
				.catch(() => (mvChyba = true));
			return;
		}
		// inline 'auto' režim — detekcia mobilu; desktop dostane QR na AR stránku
		jeMobil = window.matchMedia?.('(pointer: coarse)').matches === true || window.innerWidth <= 768;
		if (!jeMobil) {
			const arUrl = `${window.location.origin}${arHref}`;
			import('qrcode')
				.then((m) => m.toDataURL(arUrl, { width: 220, margin: 1 }))
				.then((u) => (qrDataUrl = u))
				.catch(() => (mvChyba = true));
		}
	});
</script>

<div class="ar" data-testid="pergola-ar">
	{#if rezim === 'viewer'}
		{#if mvChyba}
			<p class="ar-chyba" data-testid="pergola-ar-chyba">
				AR náhľad sa nepodarilo načítať. Skús to prosím znova.
			</p>
		{:else if mvReady}
			<model-viewer
				data-testid="pergola-ar-viewer"
				src={glbUrl}
				ar
				ar-modes="webxr scene-viewer quick-look"
				ar-scale="fixed"
				camera-controls
				touch-action="pan-y"
				shadow-intensity="1"
				exposure="1"
				alt="3D model pergoly v skutočnej mierke"
			>
				<button slot="ar-button" class="ar-btn" data-testid="pergola-ar-open" type="button">
					📱 Pozri v AR u seba
				</button>
			</model-viewer>
			<p class="ar-pozn" data-testid="pergola-ar-pozn">
				Na telefóne klikni „Pozri v AR" a umiestni pergolu v skutočnej veľkosti u seba na pozemku.
			</p>
		{:else}
			<div class="ar-nacitava" data-testid="pergola-ar-loading">Načítavam AR náhľad…</div>
		{/if}
	{:else if jeMobil}
		<!-- mobil: tlačidlo-odkaz na samostatnú AR stránku (tam sa načíta model-viewer).
		     `arHref` je `resolve('/konfigurator/ar')` + query string — pravidlo nevie
		     staticky prejsť cez $derived + template literal s query, hoci resolve() je použitý. -->
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a class="ar-cta" href={arHref} data-testid="pergola-ar-open">📱 Pozri v AR u seba</a>
		<p class="ar-pozn" data-testid="pergola-ar-pozn">
			Otvorí sa AR náhľad — pergolu umiestniš v skutočnej veľkosti u seba na pozemku.
		</p>
	{:else}
		<div class="ar-qr" data-testid="pergola-ar-qr">
			<h3>Pozri si pergolu v AR na telefóne</h3>
			<p>Naskenuj QR kód telefónom — otvorí sa AR náhľad, kde pergolu umiestniš u seba.</p>
			{#if qrDataUrl}
				<img
					src={qrDataUrl}
					alt="QR kód na otvorenie AR náhľadu na telefóne"
					width="220"
					height="220"
				/>
			{:else if mvChyba}
				<p class="ar-chyba">QR kód sa nepodarilo vygenerovať.</p>
			{:else}
				<div class="ar-nacitava">Generujem QR kód…</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.ar {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	model-viewer {
		width: 100%;
		height: 340px;
		background: #eef2f6;
		border-radius: 10px;
		--poster-color: #eef2f6;
	}

	.ar-btn {
		background: #2563eb;
		color: #fff;
		border: 0;
		border-radius: 999px;
		padding: 12px 20px;
		font-size: 15px;
		font-weight: 600;
		cursor: pointer;
		position: absolute;
		bottom: 16px;
		left: 50%;
		transform: translateX(-50%);
		box-shadow: 0 2px 8px rgba(15, 23, 42, 0.25);
	}

	.ar-cta {
		display: inline-block;
		text-align: center;
		background: #2563eb;
		color: #fff;
		border-radius: 10px;
		padding: 14px 18px;
		font-size: 16px;
		font-weight: 600;
		text-decoration: none;
	}

	.ar-pozn,
	.ar-qr p {
		color: #64748b;
		font-size: 13px;
		margin: 0;
	}

	.ar-nacitava,
	.ar-chyba {
		width: 100%;
		min-height: 120px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #eef2f6;
		border-radius: 10px;
		color: #64748b;
		font-size: 14px;
		text-align: center;
		padding: 12px;
	}

	.ar-chyba {
		color: #b45309;
		background: #fffbeb;
	}

	.ar-qr {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		text-align: center;
	}

	.ar-qr h3 {
		font-size: 16px;
		margin: 0;
		color: #0f172a;
	}

	.ar-qr img {
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		background: #fff;
		padding: 6px;
	}
</style>
