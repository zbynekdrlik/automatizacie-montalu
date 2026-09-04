<script lang="ts">
	// #448 — predodpisové SKLADOVÉ VAROVANIE (honest signál, NIE blok). Zdieľané pri tlačidle odpisu
	// naprieč modulmi (zasklenia/pergola/bazén/FIX/clip/sietka). Zobrazí sa LEN keď denný Money
	// snapshot hlási nižší sklad než požadované množstvo — appka sklad NEVLASTNÍ, takže nikdy
	// neblokuje odoslanie, len upozorní, že Money môže odpis ticho neodpísať (chýbajúci materiál).
	// `import type` zo server modulu (vzor `ReadbackBadge`/`CenyTabulka` — typ sa pri kompilácii zmaže).
	import type { SkladVarovanie } from '$lib/server/ceny';

	let {
		varovania,
		testid = 'sklad-varovania'
	}: { varovania: SkladVarovanie[] | undefined; testid?: string } = $props();
</script>

{#if varovania && varovania.length}
	<div class="err noprint" data-testid={testid} role="alert">
		⚠️ <b>Nízky sklad podľa denného Money snapshotu</b> — Money môže CELÝ odpis ticho neodpísať (pri
		chýbajúcom materiáli neodpíše nič). Over sklad priamo v Money pred odoslaním; denný snapshot
		nemusí sedieť s realitou (a záporný sklad je v Money legitímny).
		<ul>
			{#each varovania as v (v.kod)}
				<li data-testid={`${testid}-${v.kod}`}>
					<b class="mono">{v.kod}</b>: sklad {v.sklad}, požadované {v.mnozstvo}
				</li>
			{/each}
		</ul>
	</div>
{/if}
