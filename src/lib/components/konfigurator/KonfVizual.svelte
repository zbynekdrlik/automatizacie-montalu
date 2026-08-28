<script lang="ts">
	// #325 ĽAVÝ 3D stĺpec split-screen konfigurátora + #327 EDGE-TO-EDGE prémiové rámovanie
	// (Tesla showroom): žiadna karta/rámik/radius — 3D scéna vypĺňa celý ľavý stĺpec na plnú
	// výšku; caption (rozmer + sklo) je malý overlay v rohu scény. Scéna (obloha/zem/
	// tiene/dom) sa renderuje v ZDIEĽANOM `Vizual3D` — tu meníme LEN rámovanie cez scoped
	// `:global` override (`.konf-vizual …`), takže sa NIČ neprenesie do iných stránok.
	//
	// Živý update (viď +page.svelte): FARBA (RAL) + typ SKLA prúdia LIVE → in-place update;
	// ROZMERY cez DEBOUNCED snapshot do `{#key vizKluc}` → refit rigu. Komponent
	// `VizualPergolaZakaznik` sa načíta LAZY (dynamic import v onMount) → three.js ostáva
	// samostatný chunk, len sa spustí pri mounte. Money-neutrálne: rozmery + odtieň + RAL kód.
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
		position: relative;
		height: 100%;
		/* #327 review 🟡: žiadny `min-height: 46vh` — grid riadok/stĺpec (44dvh / 1fr) už dáva
		   definitívnu výšku, a 46vh vs 44dvh sa bili → orezanie scény + caption na mobile */
		overflow: hidden;
		/* jemný vertikálny gradient (svetlá obloha → hmla pri zemi) — fallback počas loadu
		   aj letterbox okolo scény */
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

	/* ── EDGE-TO-EDGE rámovanie zdieľaného Vizual3D — SCOPED na .konf-vizual, žiadny únik ── */
	.konf-vizual :global(.pergola-zak) {
		height: 100%;
		gap: 0;
	}
	.konf-vizual :global(.vizual3d) {
		flex: 1;
		height: auto;
		min-height: 0;
		aspect-ratio: auto;
		border-radius: 0;
		background: transparent;
	}

	/* caption ako malý overlay v ľavom dolnom rohu scény */
	.konf-vizual :global(.pergola-zak > .caption) {
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
	/* skryjeme len poznámky (v konfigurátore mŕtva vetva) + <br>; ilustračný disclaimer
	   `.drobne` (#276 „proporcie nesmú lhať") ostáva viditeľný ako vlastný riadok v pille */
	.konf-vizual :global(.pergola-zak > .caption .poznamka),
	.konf-vizual :global(.pergola-zak > .caption br) {
		display: none;
	}
	.konf-vizual :global(.pergola-zak > .caption .drobne) {
		display: block;
		margin-top: 3px;
		font-size: 10.5px;
		color: var(--k-muted, #6b7078);
	}
</style>
