<script lang="ts">
	// Podpisová lišta pre dielňu (#139, oba bazénové vzory OP260027/OP260055 —
	// malá 4-stĺpcová tabuľka "Rezal / Opracoval / Kompletoval / Balil/Gumoval:"
	// nad hlavným rámom výkresu). Opt-in cez `VykresovyHarok`'s `podpisovaLista`
	// prop (default false) — pergolový aj zaskleniový hárok ju nikdy nevykresľujú.
	//
	// Kreslí sa relatívne k lokálnemu počiatku (0,0) = ľavý horný roh — volajúci
	// umiestni cez obalový `<g transform="translate(x,y)">`, rovnaká konvencia
	// ako TitleBlock/Kota. Štyri prázdne bunky sú len na RUČNÉ vypísanie menom/
	// dátumom dielňou pri tlači — appka do nich nič nevpisuje.

	let {
		width = 90,
		height = 12
	}: {
		width?: number;
		height?: number;
	} = $props();

	const STLPCE = ['Rezal', 'Opracoval', 'Kompletoval', 'Balil/Gumoval'] as const;
	const colW = $derived(width / STLPCE.length);

	const LBL = '#64748b';
</script>

<g data-testid="podpisova-lista" font-family="inherit">
	<!-- vonkajší rám -->
	<rect x="0" y="0" {width} {height} fill="#fff" stroke="#0f172a" stroke-width="0.4" />
	<!-- vodorovná deliaca čiara: hlavička | prázdna bunka na ručný podpis -->
	<line
		x1="0"
		y1={height * 0.42}
		x2={width}
		y2={height * 0.42}
		stroke="#0f172a"
		stroke-width="0.3"
	/>
	{#each STLPCE as nazov, i (nazov)}
		{@const x = i * colW}
		{#if i > 0}
			<line x1={x} y1="0" x2={x} y2={height} stroke="#0f172a" stroke-width="0.3" />
		{/if}
		<text
			x={x + colW / 2}
			y={height * 0.3}
			text-anchor="middle"
			font-size="2.6"
			fill={LBL}
			data-testid={`pl-${nazov.toLowerCase().replace('/', '-')}`}>{nazov}</text
		>
	{/each}
</g>
