<script lang="ts">
	// Zjednodušená SVG reprodukcia značky MONT-ALU (#137) — tri stupňovité
	// trojuholníky ako na referenčných CAD výkresoch + slovná značka "MontAlu".
	// ŽIADNY externý fetch/asset (issue to explicitne vyžaduje) — čisto inline SVG.
	//
	// Kresli sa relatívne k lokálnemu počiatku (0,0) = ľavý horný roh vlastného
	// „bounding boxu" (výška `size`) — volajúci umiestni cez obalový
	// `<g transform="translate(x,y)">`.
	let { size = 20, color = '#0f172a' }: { size?: number; color?: string } = $props();
</script>

<g data-testid="montalu-logo">
	<svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="MontAlu">
		<polygon points="1,22 7,22 7,15" fill={color} />
		<polygon points="9,22 15,22 15,8" fill={color} />
		<polygon points="17,22 23,22 23,1" fill={color} />
	</svg>
	<text x={size + 4} y={size * 0.66} font-size={size * 0.6} font-weight="500" fill={color}
		>Mont<tspan font-weight="800">Alu</tspan></text
	>
</g>
