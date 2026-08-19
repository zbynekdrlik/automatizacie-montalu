<script lang="ts">
	// Krok „rez-hotovo" — potvrdenie odoslanej rezervácie + prehľad Money rozpisu.
	// Vyčlenené z pergola/narez/+page.svelte (#239). Čistá prezentácia (props in).
	import { resolve } from '$app/paths';
	import type { RezervaciaIdent, RezervaciaRozpis } from '$lib/server/pergola-rezervacia';

	let {
		ident,
		outcome,
		rozpis
	}: {
		ident: RezervaciaIdent;
		outcome: { live: boolean; filename: string };
		rozpis: RezervaciaRozpis | null;
	} = $props();

	const fmtM = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');
</script>

<div class="card">
	<h1 data-testid="rez-hotovo-nadpis">Rezervácia hotová — {ident.zak} · {ident.zakaznik}</h1>
</div>

<div class="okmsg" data-testid="rez-vysledok">
	{#if !outcome.live}
		🧪 TEST — do Money NEJDE (testovací priečinok): <b>{outcome.filename}</b>
	{:else}
		✅ Rezervácia odoslaná do Money na import: <b>{outcome.filename}</b>
	{/if}
</div>

{#if rozpis}
	<div class="card">
		<div class="sec">Rezervované — Money rozpis ({rozpis.nonzero.length} položiek)</div>
		<table class="narez">
			<thead><tr><th>Money kód</th><th>Názov</th><th>Množstvo</th></tr></thead>
			<tbody>
				{#each rozpis.nonzero as o, i (o.kod + '·' + i)}
					<tr
						><td
							>{o.kod}{#if o.rucne}
								<span class="badge rucne">✍️ ručne pridané</span>{/if}</td
						><td>{o.nazov}</td><td><b>{fmtM(o.qty)} {o.mj ?? 'm'}</b></td></tr
					>
				{/each}
			</tbody>
		</table>
		{#if rozpis.vylucene.length}
			<p class="sub">
				Nezahrnuté (zatiaľ nepočítané): {rozpis.vylucene.map((v) => v.kod).join(', ')}
			</p>
		{/if}
	</div>
{/if}

<div class="card noprint">
	<a class="btn secondary" href={resolve('/pergola/narez')}>➕ Nová rezervácia</a>
	<a class="btn secondary" href={resolve('/odpisy')}>📋 História odpisov</a>
</div>
