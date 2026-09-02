<script lang="ts">
	// Tenký Svelte wrapper nad `$lib/vykres/kota.ts` — dokazuje, že zdieľaný helper je
	// priamo použiteľný z komponenty (#137, bod "malé Svelte komponenty ak sú užitočné").
	// Kreslí JEDNU čiarovú kótu (kótová čiara + 2 ťaháky + popisok) ako <g>/<text>
	// fragment do existujúceho rodičovského <svg> — nemá vlastný <svg>/viewBox.
	import { lineDimension, verticalDimension, fmtMm, type DimensionOpts } from '$lib/vykres/kota';

	let {
		x0,
		y0,
		x1,
		y1,
		perpOffset = 0,
		text,
		// #376 stage 4: bronz default (predtým modrá #1d4ed8) — --m-accent-ink,
		// text-safe 5.9:1; reálne volania farbu aj tak prebíjajú (BRONZ konštanta)
		color = '#8a5a2b',
		fontSize = 11,
		opts = {}
	}: {
		x0: number;
		y0: number;
		x1: number;
		y1: number;
		/** kolmý posun kótovej čiary od geometrie (px/mm podľa mierky rodiča) */
		perpOffset?: number;
		/** vlastný text popisku; keď chýba, dopočíta sa dĺžka geometrie (fmtMm + „mm") */
		text?: string;
		color?: string;
		fontSize?: number;
		opts?: DimensionOpts;
	} = $props();

	// presne zvislá kóta (x0≈x1, dĺžka > 0) číta sa VŽDY zdola nahor (-90°) — deleguje
	// priamo na `verticalDimension` (kanonická konvencia zdieľaná s existujúcimi
	// FixVykres2D/Nahlad2D kótami); vodorovné aj šikmé kóty idú cez všeobecný
	// `lineDimension`, ktorý uhol dopočíta sám.
	let zvisla = $derived(Math.abs(x1 - x0) < 1e-6 && Math.abs(y1 - y0) > 1e-6);
	let geom = $derived(
		zvisla
			? verticalDimension(y0, y1, x0, perpOffset, opts)
			: lineDimension(x0, y0, x1, y1, perpOffset, opts)
	);
	let label = $derived(text ?? fmtMm(Math.hypot(x1 - x0, y1 - y0)) + ' mm');
</script>

{#if geom.witnesses.length > 0}
	<!-- odkazové (witness) čiary — od geometrie po odsadenú kótovú čiaru, tenšie než
	     kótová čiara samotná (CAD konvencia, issue #137 bod "s odkazovými čiarami").
	     #146 bod 3: hierarchia hrúbok čiar — odkazové čiary sú NAJTENŠIE z kótovej
	     skupiny (0.4), kótová čiara samotná o niečo hrubšia (0.7 nižšie), obe pod
	     konštrukčnými obrysmi (~1.6-2, kreslené priamo v PergolaNavrhVykres.svelte). -->
	<g stroke={color} stroke-width="0.4" fill="none" data-testid="kota-witness">
		{#each geom.witnesses as w (w.x1 + ':' + w.y1 + ':' + w.x2 + ':' + w.y2)}
			<line x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} />
		{/each}
	</g>
{/if}
<g stroke={color} stroke-width="0.7" fill="none" data-testid="kota">
	<line x1={geom.lines[0].x1} y1={geom.lines[0].y1} x2={geom.lines[0].x2} y2={geom.lines[0].y2} />
	<line x1={geom.lines[1].x1} y1={geom.lines[1].y1} x2={geom.lines[1].x2} y2={geom.lines[1].y2} />
	<line x1={geom.lines[2].x1} y1={geom.lines[2].y1} x2={geom.lines[2].x2} y2={geom.lines[2].y2} />
</g>
<text
	x={geom.label.x}
	y={geom.label.y}
	text-anchor="middle"
	font-size={fontSize}
	fill={color}
	font-weight="600"
	stroke="#fff"
	stroke-width="3"
	paint-order="stroke"
	transform={geom.label.rotate
		? `rotate(${geom.label.rotate} ${geom.label.x} ${geom.label.y})`
		: undefined}
	data-testid="kota-label">{label}</text
>
