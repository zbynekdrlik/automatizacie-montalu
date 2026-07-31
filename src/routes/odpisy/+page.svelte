<script lang="ts">
	import { nazovSystemu } from '$lib/system-nazvy';
	let { data, form } = $props();
</script>

<svelte:head><title>História odpisov — Montalu</title></svelte:head>

<div class="card">
	<h1>História odpisov — Zasklenia</h1>
	<p class="sub">
		Každý odoslaný odpis. Riadok = jeden xlsx súbor do Money importu (alebo TEST priečinka).
		„Uvoľniť" zmaže záznam a dovolí poslať tú istú ZAK+OP znova — použi LEN po zmazaní
		chybného importu v Money.
	</p>
</div>

{#if form?.uvolnene}
	<div class="okmsg" data-testid="uvolnene">✅ Záznam uvoľnený — zákazku je možné poslať znova.</div>
{:else if form?.error}
	<div class="err">⚠️ {form.error}</div>
{/if}

<div class="card">
	{#if data.odpisy.length === 0}
		<p class="sub">Zatiaľ žiadne odpisy.</p>
	{:else}
		<table data-testid="odpisy-tabulka">
			<thead>
				<tr>
					<th>Kedy</th>
					<th>Modul</th>
					<th>ZAK</th>
					<th>OP</th>
					<th>Zákazník</th>
					<th>Detail</th>
					<th class="c">Režim</th>
					<th>Kto</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				{#each data.odpisy as o (o.id)}
					{@const d = o.d}
					<tr>
						<td style="white-space:nowrap">{o.created_at}</td>
						<td>{o.modul === 'zasklenia' ? 'Zasklenia' : o.modul === 'bazen' ? 'Bazén' : 'Pergola'}</td>
						<td><b>{o.zak}</b></td>
						<td>{o.op}</td>
						<td>{o.zakaznik}</td>
						<td
							>{[d.system && `${nazovSystemu(String(d.system))} ${d.styl}`, d.s && `${d.s}×${d.v}`, d.model, d.riadkov && `${d.riadkov} pol.`]
								.filter(Boolean)
								.join(' · ')}{o.caka ? ' ⏳' : ''}</td
						>
						<td class="c">{o.live ? '● LIVE' : '🧪 TEST'}</td>
						<td>{o.created_by}</td>
						<td class="c">
							<form
								method="POST"
								action="?/uvolnit"
								onsubmit={(e) => {
									if (!confirm(`Uvoľniť ${o.zak} OP${o.op}? Zákazku bude možné poslať znova.`))
										e.preventDefault();
								}}
							>
								<input type="hidden" name="id" value={o.id} />
								<button
									type="submit"
									style="background:none;border:1px solid #cbd5e1;border-radius:8px;padding:4px 8px;cursor:pointer;font-size:12px;color:#64748b"
									title="Zmaže záznam — použi len po zmazaní chybného importu v Money"
									>Uvoľniť</button
								>
							</form>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>
