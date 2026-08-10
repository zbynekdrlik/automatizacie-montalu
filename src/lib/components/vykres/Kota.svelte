<script lang="ts">
	// Tenký Svelte wrapper nad `$lib/vykres/kota.ts` — dokazuje, že zdieľaný helper je
	// priamo použiteľný z komponenty (#137, bod "malé Svelte komponenty ak sú užitočné").
	// Kreslí JEDNU čiarovú kótu (kótová čiara + 2 ťaháky + popisok) ako <g>/<text>
	// fragment do existujúceho rodičovského <svg> — nemá vlastný <svg>/viewBox.
	import { lineDimension, fmtMm, type DimensionOpts } from '$lib/vykres/kota';

	let {
		x0,
		y0,
		x1,
		y1,
		perpOffset = 0,
		text,
		color = '#1d4ed8',
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

	// presne zvislá kóta (x0≈x1, dĺžka > 0) číta sa VŽDY zdola nahor (-90°) — kanonická
	// konvencia zdieľaná s existujúcimi FixVykres2D/Nahlad2D kótami (viď kota.ts
	// `verticalDimension`); vodorovné aj šikmé kóty dostanú uhol priamo z `lineDimension`.
	let zvisla = $derived(Math.abs(x1 - x0) < 1e-6 && Math.abs(y1 - y0) > 1e-6);
	let geom = $derived.by(() => {
		const g = lineDimension(x0, y0, x1, y1, perpOffset, opts);
		return zvisla ? { ...g, label: { ...g.label, rotate: -90 } } : g;
	});
	let label = $derived(text ?? fmtMm(Math.hypot(x1 - x0, y1 - y0)) + ' mm');
</script>

<g stroke={color} stroke-width="1" fill="none" data-testid="kota">
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
