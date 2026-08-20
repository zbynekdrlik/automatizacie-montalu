<script lang="ts">
	// Poznámka (viacriadková, vľavo) + RAL (veľkým, vpravo) na nárezovom pláne aj v tlači.
	// Zdieľané pre jedno- aj viac-posuvový plán (PlanKarty / PlanKartyMulti). Display-only —
	// do Money odpisu (.xlsx) NEJDE ani poznámka, ani RAL. Vyčlenené z +page snippetu
	// `poznamkaRal` (#250). Všetky triedy sú globálne v app.css → žiadny scoped `<style>`.
	let { poznamka, ral }: { poznamka: string; ral: string } = $props();
</script>

{#if poznamka || ral}
	<div class="card poznamka-ral" data-testid="poznamka-ral">
		{#if poznamka}
			<div class="pr-note">
				<div class="sec">Poznámka</div>
				<div class="poznamka-plan">{poznamka}</div>
			</div>
		{/if}
		{#if ral}
			<div class="pr-ral">
				<div class="sec">RAL</div>
				<div class="ral-val" data-testid="ral-val">{ral}</div>
			</div>
		{/if}
	</div>
{/if}
