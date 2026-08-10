<script lang="ts">
	// Interná demo/preview stránka pre základ návrhových výkresov (#137). Nie je v
	// navigácii (zámerne „skrytá" — skutočný produkčný konzument je #138+); slúži na
	// e2e a manuálne overenie: rám + mriežka (1-16/A-L), rohová pečiatka s dátumom zo
	// servera, vzorové kóty (vodorovná/zvislá/uhlová) cez zdieľaný `Kota.svelte`
	// helper, farebná konvencia (čierna geometria / modré kóty / červené poznámky) a
	// tlač A4 na šírku.
	import VykresovyHarok from '$lib/components/vykres/VykresovyHarok.svelte';
	import Kota from '$lib/components/vykres/Kota.svelte';
	import { formatDatumCasSk } from '$lib/datum';
	import { vypocitajMierku } from '$lib/vykres/mierka';
	import { angleDimension, fitScale, fmtDeg } from '$lib/vykres/kota';

	let { data } = $props();

	// Vzorová geometria (demo obdĺžnik reálneho rozmeru 6000×2500 mm, sklon 4,3° ako
	// na referenčnom OP260032) — dokazuje kóta helper, NIE je to skutočný produkt.
	const REAL_W = 6000;
	const REAL_H = 2500;
	const REAL_SKLON = 4.3;

	// zhodné s defaultmi VykresovyHarok (pageW/pageH/margin/gridBand) — MIERKA sa
	// počíta z TEJ ISTEJ kresliacej plochy, ktorú komponenta reálne používa (#137
	// bod 4: čestná vypočítaná mierka, nikdy natvrdo "1:20").
	const PAGE_W = 297;
	const PAGE_H = 210;
	const MARGIN = 6;
	const GRID_BAND = 5;
	const OBLAST_W = PAGE_W - 2 * MARGIN - 2 * GRID_BAND;
	const OBLAST_H = PAGE_H - 2 * MARGIN - 2 * GRID_BAND;
	const mierkaText = vypocitajMierku(REAL_W, REAL_H, OBLAST_W, OBLAST_H);

	let datum = $derived(formatDatumCasSk(data.datumIso));
	let titleBlockData = $derived({
		nazov: 'DEMO — vzorový hárok',
		projekt: 'automatizacie-montalu',
		cisloVykresu: 'OP000000',
		mierka: mierkaText,
		revizia: '0',
		varianta: 'DEMO',
		vypracoval: 'demo',
		datum
	});
</script>

<svelte:head><title>Návrhový výkres — demo (#137)</title></svelte:head>

<div class="card noprint">
	<div class="sec">Návrhový výkres — interné demo (#137)</div>
	<p class="sub">
		Vzorový hárok: vonkajší rám s mriežkou (stĺpce 1-16, riadky A-L), rohová pečiatka a kóty cez
		zdieľaný <code>kota.ts</code> helper. Skutočný produkčný výkres (pergola/bazén) príde v #138+ — táto
		stránka je len overenie základu, nikam do appky nevedie odkaz.
	</p>
</div>

<div class="card" style="overflow:auto;padding:10px">
	<VykresovyHarok
		pageW={PAGE_W}
		pageH={PAGE_H}
		margin={MARGIN}
		gridBand={GRID_BAND}
		titleBlock={titleBlockData}
	>
		{#snippet content(oblast)}
			{@const padX = oblast.w * 0.06}
			{@const padY = oblast.h * 0.24}
			{@const x0 = oblast.x + padX}
			{@const y0 = oblast.y + padY}
			{@const scale = fitScale(REAL_W, REAL_H, oblast.w * 0.5, oblast.h * 0.4)}
			{@const x1 = x0 + REAL_W * scale}
			{@const y1 = y0 + REAL_H * scale}
			<!-- uhlová kóta pri PRAVOM hornom rohu (mimo poznámky, ktorá sedí vľavo hore) -->
			{@const arc = angleDimension(x1, y0, 16, 90, 90 + REAL_SKLON)}
			<!-- červená poznámka — vlastný riadok nad kresbou, nekoliduje s kótami -->
			<text
				x={oblast.x + 2}
				y={oblast.y + 5}
				font-size="3.2"
				fill="#dc2626"
				font-weight="600"
				data-testid="demo-poznamka">POZNÁMKA: vzorový hárok — základ pre #138</text
			>
			<!-- čierna geometria (konvencia z ROZHODNUTÉ komentára #137) -->
			<rect
				x={x0}
				y={y0}
				width={x1 - x0}
				height={y1 - y0}
				fill="#eff6ff"
				stroke="#0f172a"
				stroke-width="0.5"
				data-testid="demo-geometria"
			/>
			<!-- modré kóty (vodorovná, zvislá, uhlová) cez zdieľaný Kota.svelte — perpOffset
			     posúva kótovú čiaru MIMO geometrie a zapína aj odkazové (witness) čiary -->
			<Kota {x0} y0={y1} {x1} {y1} perpOffset={9} text={`${REAL_W} mm`} />
			<Kota {x0} {y0} x1={x0} {y1} perpOffset={9} text={`${REAL_H} mm`} />
			<path
				d={arc.arcPath}
				stroke="#1d4ed8"
				stroke-width="0.4"
				fill="none"
				data-testid="demo-uhol-oblúk"
			/>
			<text
				x={arc.label.x}
				y={arc.label.y}
				text-anchor="middle"
				font-size="3"
				fill="#1d4ed8"
				font-weight="600"
				data-testid="demo-uhol-popis">{fmtDeg(REAL_SKLON)}</text
			>
		{/snippet}
	</VykresovyHarok>
</div>

<div class="card noprint">
	<button class="btn" onclick={() => window.print()}>🖨 Tlačiť / uložiť PDF</button>
</div>

<style>
	/* Landscape tlač LEN pre túto route — @page je SvelteKit route-CSS-splitovaný
	   (tento <style> blok sa nahrá len na /vykresy/preview), takže sa nedotkne
	   portrait tlače nárezáku/fixu, ktorá zostáva v zdieľanom app.css (#137, bod 3). */
	@media print {
		@page {
			size: A4 landscape;
			margin: 6mm;
		}
	}
</style>
