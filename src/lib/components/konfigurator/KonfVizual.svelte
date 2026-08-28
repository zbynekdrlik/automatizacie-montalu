<script lang="ts">
	// #325: ĽAVÝ (sticky) stĺpec split-screen konfigurátora — ŽIVÝ 3D náhľad pergoly,
	// viditeľný HNEĎ pri načítaní (defaultná pergola), driven z aktuálneho stavu
	// formulára (nie až po submite). Komponent `VizualPergolaZakaznik` sa načíta LAZY
	// (dynamic import v `onMount`) → three.js ostáva samostatný chunk (chunk-size guard
	// ≤220KB), len sa spustí pri mounte namiesto pri submite.
	//
	// Živý update (viď +page.svelte): FARBA (RAL) + typ SKLA prúdia LIVE → okamžitý
	// in-place update materiálu (`prekresliRAL`/`prekresliSklo` vo Vizual3D). ROZMERY
	// prúdia cez DEBOUNCED snapshot do `{#key vizKluc}` → čistý teardown+mount, ktorý
	// REFITNE celý scénický rig (kamera/tiene/dekal/stena). Money-neutrálne: berie len
	// rozmery + `PergolaTypSkla` (odtieň) + RAL kód, žiadny Money kód/katalóg.
	import { onMount } from 'svelte';
	import type { PergolaTypSkla } from '$lib/vizual/pergola-sklo';

	type KonfViz = {
		sirkaMm: number;
		hlbkaMm: number;
		vyskaVpreduMm: number;
		vyskaPriSteneMm: number;
		typSkla: PergolaTypSkla;
		ralKod: string;
	};

	let {
		viz,
		vizKluc
	}: {
		/** aktuálny 3D vstup — rozmery sú DEBOUNCED snapshot, sklo/RAL sú LIVE */
		viz: KonfViz;
		/** `{#key}` podpis rozmerov (debounced) — jeho zmena remountne (refit rigu) */
		vizKluc: string;
	} = $props();

	type VizualKompTyp =
		(typeof import('$lib/components/vizual/VizualPergolaZakaznik.svelte'))['default'];
	let VizualKomp = $state<VizualKompTyp | null>(null);

	onMount(() => {
		void import('$lib/components/vizual/VizualPergolaZakaznik.svelte').then(
			(m) => (VizualKomp = m.default)
		);
	});
</script>

<section class="konf-vizual" data-testid="konf-viz" aria-label="3D náhľad pergoly">
	{#if VizualKomp}
		{@const Komp = VizualKomp}
		{#key vizKluc}
			<Komp
				sirkaMm={viz.sirkaMm}
				hlbkaMm={viz.hlbkaMm}
				vyskaVpreduMm={viz.vyskaVpreduMm}
				vyskaPriSteneMm={viz.vyskaPriSteneMm}
				typSkla={viz.typSkla}
				ralKod={viz.ralKod}
				zobrazOvladanie={false}
			/>
		{/key}
	{:else}
		<div class="viz-loading" data-testid="konf-viz-loading">Načítavam 3D náhľad…</div>
	{/if}
</section>

<style>
	.konf-vizual {
		background: #fff;
		border: 1px solid #e2e8f0;
		border-radius: 14px;
		padding: 12px;
		box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
	}
	.viz-loading {
		width: 100%;
		aspect-ratio: 16 / 10;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #dfe7ee;
		border-radius: 10px;
		color: #64748b;
		font-size: 14px;
	}
</style>
