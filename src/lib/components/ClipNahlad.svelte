<script lang="ts">
	// CLIP vizualizácia zábradlia (#554) — SVG náhľad výplní s priečkami. 1 výplň =
	// jeden obdĺžnik; N výplní = N polí oddelených priečkami na pozíciách zo šablóny
	// (Excel 37649). Čisto z propov (žiadne browser API) — geometria z clip-nahlad.ts.
	import { clipNahladGeom } from '$lib/clip-nahlad';

	let { sirka, vyska, poziciePriecok }: { sirka: number; vyska: number; poziciePriecok: number[] } =
		$props();

	const geom = $derived(clipNahladGeom(sirka, vyska, poziciePriecok));
	const fmt = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

	// viewBox v mm (mierka); minimum aby degenerované rozmery nepadli
	const W = $derived(Math.max(geom.sirka, 1));
	const H = $derived(Math.max(geom.vyska, 1));
</script>

<div class="nahlad" data-testid="clip-nahlad">
	<svg
		class="ram-svg"
		viewBox="0 0 {W} {H}"
		preserveAspectRatio="xMidYMid meet"
		role="img"
		aria-label="Náhľad zábradlia — {geom.poleCount} {geom.poleCount === 1 ? 'výplň' : 'výplne'}"
	>
		<!-- vonkajší rám -->
		<rect
			x="0"
			y="0"
			width={W}
			height={H}
			fill="#f8fafc"
			stroke="#334155"
			stroke-width="6"
			vector-effect="non-scaling-stroke"
		/>
		<!-- pole (výplň) — jedno na každú výplň (pre počítanie/čitateľnosť) -->
		{#each geom.poles as pole, i (i)}
			<rect
				class="pole"
				data-testid="clip-pole"
				x={pole.x}
				y="0"
				width={pole.width}
				height={H}
				fill="transparent"
			/>
		{/each}
		<!-- priečky (deliace zvislé profily) -->
		{#each geom.priecky as p (p.cislo)}
			<line
				class="priecka"
				data-testid="clip-priecka"
				x1={p.mm}
				y1="0"
				x2={p.mm}
				y2={H}
				stroke="#334155"
				stroke-width="6"
				vector-effect="non-scaling-stroke"
			/>
		{/each}
	</svg>

	{#if geom.priecky.length}
		<div class="pozicie" data-testid="clip-priecka-pozicie">
			{#each geom.priecky as p (p.cislo)}
				<span class="poz"><b>priečka č.{p.cislo}</b> {fmt(p.mm)} mm</span>
			{/each}
		</div>
	{/if}
</div>

<style>
	.nahlad {
		max-width: 520px;
		page-break-inside: avoid;
		break-inside: avoid;
	}
	.ram-svg {
		display: block;
		width: 100%;
		height: auto;
		max-height: 220px;
	}
	.pozicie {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 18px;
		margin-top: 8px;
		color: var(--m-muted-ink);
		font-size: 13px;
	}
	.poz b {
		color: var(--m-ink);
	}
</style>
