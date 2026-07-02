<script lang="ts">
	let { data } = $props();
</script>

<svelte:head><title>História odpisov — Montalu</title></svelte:head>

<div class="card">
	<h1>História odpisov — Zasklenia</h1>
	<p class="sub">Každý odoslaný odpis. Riadok = jeden xlsx súbor do Money importu (alebo TEST priečinka).</p>
</div>

<div class="card">
	{#if data.odpisy.length === 0}
		<p class="sub">Zatiaľ žiadne odpisy.</p>
	{:else}
		<table data-testid="odpisy-tabulka">
			<thead>
				<tr>
					<th>Kedy</th>
					<th>ZAK</th>
					<th>OP</th>
					<th>Zákazník</th>
					<th>Systém</th>
					<th class="c">Rozmer</th>
					<th class="c">Režim</th>
					<th>Kto</th>
				</tr>
			</thead>
			<tbody>
				{#each data.odpisy as o (`${o.zak}|${o.op}|${o.live}`)}
					<tr>
						<td style="white-space:nowrap">{o.created_at}</td>
						<td><b>{o.zak}</b></td>
						<td>{o.op}</td>
						<td>{o.zakaznik}</td>
						<td>{o.system} {o.styl}{o.caka ? ' ⏳' : ''}</td>
						<td class="c">{o.s}×{o.v}</td>
						<td class="c">{o.live ? '● LIVE' : '🧪 TEST'}</td>
						<td>{o.created_by}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>
