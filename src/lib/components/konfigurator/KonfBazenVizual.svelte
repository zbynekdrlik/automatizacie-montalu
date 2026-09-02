<script lang="ts">
	// #405 ĽAVÝ 3D stĺpec split-screen bazénového konfigurátora (vzor `KonfVizual`
	// pergoly). EDGE-TO-EDGE rámovanie zdieľaného `Vizual3D` cez scoped `:global`
	// override (`.konf-baz-vizual …`) → nič sa neprenesie do iných stránok. Caption
	// (rozmer + segmenty + výplň) je malý overlay v rohu scény.
	//
	// Živý update (viď +page.svelte): FARBA (RAL) + kategória VÝPLNE prúdia LIVE →
	// in-place update materiálu; POČET SEGMENTOV prúdi LIVE → in-place prestavba
	// geometrie (bbox nezmenený → `geometrickyPodpis` effect vo Vizual3D); ROZMERY
	// cez DEBOUNCED snapshot do `{#key vizKluc}` → refit rigu. Komponent
	// `VizualBazenZakaznik` sa načíta LAZY (dynamic import v onMount) → three.js
	// ostáva samostatný chunk, spustí sa pri mounte. Money-neutrálne: rozmery +
	// segmenty + odtieň výplne + RAL kód.
	import { onMount } from 'svelte';

	type KonfBazViz = {
		sirkaMm: number;
		dlzkaMm: number;
		vyskaMm: number;
		segmenty: number;
		dvojkolaj: boolean;
		vyplnNazov: string;
		ralKod: string;
	};

	let {
		viz,
		vizKluc
	}: {
		/** aktuálny 3D vstup — rozmery sú DEBOUNCED snapshot, segmenty/výplň/RAL sú LIVE */
		viz: KonfBazViz;
		/** `{#key}` podpis rozmerov (debounced) — jeho zmena remountne (refit rigu) */
		vizKluc: string;
	} = $props();

	type VizualKompTyp =
		(typeof import('$lib/components/vizual/VizualBazenZakaznik.svelte'))['default'];
	let VizualKomp = $state<VizualKompTyp | null>(null);

	onMount(() => {
		void import('$lib/components/vizual/VizualBazenZakaznik.svelte').then(
			(m) => (VizualKomp = m.default)
		);
	});
</script>

<!-- #361 vzor: deterministický, od GL-frame ODPOJENÝ stavový signál pre E2E na
	 STABILNOM section uzle MIMO `{#key vizKluc}` bloku → patchne sa in-place bez
	 teardownu/detach-window, takže „form-state → 3D" sa dá overiť bez čakania na
	 softvérový GL rebuild (× = U+00D7, byte-identické so zákazníckym captionom). -->
<section
	class="konf-baz-vizual"
	data-testid="konf-baz-viz"
	data-viz-rozmer={`${viz.dlzkaMm}×${viz.sirkaMm}`}
	aria-label="3D náhľad bazénového zastrešenia"
>
	{#if VizualKomp}
		{@const Komp = VizualKomp}
		{#key vizKluc}
			<Komp
				sirkaMm={viz.sirkaMm}
				dlzkaMm={viz.dlzkaMm}
				vyskaMm={viz.vyskaMm}
				segmenty={viz.segmenty}
				dvojkolaj={viz.dvojkolaj}
				vyplnNazov={viz.vyplnNazov}
				ralKod={viz.ralKod}
				zobrazOvladanie={false}
			/>
		{/key}
	{:else}
		<div class="viz-loading" data-testid="konf-baz-viz-loading">Načítavam 3D náhľad…</div>
	{/if}
</section>

<style>
	.konf-baz-vizual {
		position: relative;
		height: 100%;
		overflow: hidden;
		/* jemný vertikálny gradient (svetlá obloha → hmla pri zemi) — fallback počas
		   loadu aj letterbox okolo scény */
		background: linear-gradient(180deg, #eef1f4 0%, #f5f3ef 58%, #eae8e2 100%);
	}

	.viz-loading {
		width: 100%;
		height: 100%;
		min-height: 200px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--k-muted, #6b7078);
		font-size: 14px;
	}

	/* ── EDGE-TO-EDGE rámovanie zdieľaného Vizual3D — SCOPED na .konf-baz-vizual ── */
	.konf-baz-vizual :global(.bazen-zak) {
		height: 100%;
		gap: 0;
	}
	.konf-baz-vizual :global(.vizual3d) {
		flex: 1;
		height: auto;
		min-height: 0;
		aspect-ratio: auto;
		border-radius: 0;
		background: transparent;
	}

	/* caption ako malý overlay v ľavom dolnom rohu scény */
	.konf-baz-vizual :global(.bazen-zak > .caption) {
		position: absolute;
		left: clamp(12px, 2vw, 20px);
		bottom: clamp(12px, 2vw, 20px);
		right: auto;
		max-width: calc(100% - 40px);
		margin: 0;
		padding: 8px 13px;
		background: rgba(255, 255, 255, 0.84);
		-webkit-backdrop-filter: saturate(1.2) blur(8px);
		backdrop-filter: saturate(1.2) blur(8px);
		border-radius: 11px;
		box-shadow: 0 2px 12px rgba(22, 24, 28, 0.1);
		font-size: 12px;
		line-height: 1.35;
		color: #16181c;
	}
	/* skryjeme len poznámky-<br>; ilustračný disclaimer `.drobne` ostáva viditeľný */
	.konf-baz-vizual :global(.bazen-zak > .caption br) {
		display: none;
	}
	.konf-baz-vizual :global(.bazen-zak > .caption .poznamka) {
		display: block;
		margin-top: 3px;
		color: #b45309;
	}
	.konf-baz-vizual :global(.bazen-zak > .caption .drobne) {
		display: block;
		margin-top: 3px;
		font-size: 10.5px;
		color: var(--k-muted, #6b7078);
	}
</style>
