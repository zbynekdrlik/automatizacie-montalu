<script lang="ts">
	// Výpis kovania (kľučky/FAB) jedného posuvu — ľavá/pravá/(stredové okno) strana.
	// Zdieľané pre jedno- aj viac-posuvový plán (PlanKarty / PlanKartyMulti). Display-only.
	// Vyčlenené z +page snippetu `kovanieStrany` (#250). Triedy globálne v app.css.
	let {
		nadpis,
		lava,
		prava,
		stred = '',
		stredOkno = 'L'
	}: {
		nadpis: string;
		lava: string;
		prava: string;
		stred?: string;
		stredOkno?: 'L' | 'P';
	} = $props();
</script>

<div class="kov-posuv">
	<div class="kov-hd">{nadpis}</div>
	<div class="row"><span>ľavá strana</span><b>{lava || '—'}</b></div>
	<div class="row"><span>pravá strana</span><b>{prava || '—'}</b></div>
	{#if stred}
		<div class="row">
			<span>stredové okno ({stredOkno === 'P' ? 'pravé' : 'ľavé'})</span><b>{stred}</b>
		</div>
	{/if}
</div>
