<script lang="ts">
	// Interný read-only prehľad zákazníckych dopytov z konfigurátora (#282). Bez formulára,
	// bez $state/$effect (žiadna reštart-effect/value-reset pasca z nova-stranka) — len render
	// serverových dát + odkazy. AUTH rieši hooks.server.ts; b2b denylist rieši b2b-access.ts.
	import { resolve } from '$app/paths';
	let { data } = $props();
</script>

<svelte:head><title>Dopyty z konfigurátora — Montalu</title></svelte:head>

<div class="card">
	<h1>Dopyty z konfigurátora</h1>
	<p class="sub">
		Zákaznícke dopyty odoslané z verejného konfigurátora pergoly — najnovšie hore. Pre každý dopyt
		sa dá znova stiahnuť PDF špecifikácia (s orientačnou cenou). Spolu {data.total}
		{data.total === 1 ? 'dopyt' : data.total >= 2 && data.total <= 4 ? 'dopyty' : 'dopytov'}.
	</p>
</div>

<div class="card">
	{#if data.dopyty.length === 0}
		<p class="sub" data-testid="ziadne-dopyty">Zatiaľ žiadne dopyty.</p>
	{:else}
		<table data-testid="dopyty-tabulka">
			<thead>
				<tr>
					<th>Dátum/čas</th>
					<th>Meno</th>
					<th>E-mail</th>
					<th>Telefón</th>
					<th>Miesto stavby</th>
					<th>Súhrn konfigurácie</th>
					<th>Orientačná cena</th>
					<th>Poznámka</th>
					{#if data.hasOdooLead}<th>Odoo lead</th>{/if}
					<th></th>
				</tr>
			</thead>
			<tbody>
				{#each data.dopyty as d (d.id)}
					<tr data-testid="dopyt-{d.id}">
						<td style="white-space:nowrap">{d.datum}</td>
						<td>
							{#if d.jeObjednavka}<span class="obj-badge" data-testid="obj-badge-{d.id}"
									>OBJEDNÁVKA</span
								>{/if}
							{d.meno}
						</td>
						<td>{d.email}</td>
						<td>{d.telefon}</td>
						<td>{d.miesto}</td>
						<td class="suhrn">
							{#if d.suhrn.length === 0}
								<span class="muted">—</span>
							{:else}
								{#each d.suhrn as r (r.label)}
									<div><span class="lbl">{r.label}:</span> {r.value}</div>
								{/each}
							{/if}
						</td>
						<td class="cena" data-testid="cena-{d.id}">
							{#if d.cena === null}
								<span class="muted">—</span>
							{:else}
								<span title={d.cenaVerzia ? `cenník ${d.cenaVerzia}` : undefined}>{d.cena}</span>
							{/if}
						</td>
						<td>{d.poznamka}</td>
						{#if data.hasOdooLead}
							<td>{d.odooLeadId ?? '—'}</td>
						{/if}
						<td style="white-space:nowrap">
							<a
								class="pdf"
								data-testid="pdf-{d.id}"
								data-sveltekit-reload
								href={resolve(`/dopyty-konfigurator/pdf?id=${d.id}`)}>PDF ↓</a
							>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>

		{#if data.pageCount > 1}
			<div class="pager" data-testid="pager">
				{#if data.page > 1}
					<a href={resolve(`/dopyty-konfigurator?page=${data.page - 1}`)}>← Novšie</a>
				{:else}
					<span class="muted">← Novšie</span>
				{/if}
				<span class="pageinfo">Strana {data.page} z {data.pageCount}</span>
				{#if data.page < data.pageCount}
					<a href={resolve(`/dopyty-konfigurator?page=${data.page + 1}`)}>Staršie →</a>
				{:else}
					<span class="muted">Staršie →</span>
				{/if}
			</div>
		{/if}
	{/if}
</div>

<style>
	.suhrn {
		font-size: 13px;
		line-height: 1.45;
		max-width: 320px;
	}
	.suhrn .lbl {
		color: #64748b;
	}
	.cena {
		white-space: nowrap;
		font-size: 13.5px;
		font-weight: 600;
	}
	.muted {
		color: #94a3b8;
	}
	/* #319: odlíšenie záväznej objednávky od nezáväzného dopytu v internom zozname */
	.obj-badge {
		display: inline-block;
		margin-right: 6px;
		padding: 1px 6px;
		border-radius: 999px;
		background: #16a34a;
		color: #fff;
		font-size: 10.5px;
		font-weight: 700;
		letter-spacing: 0.02em;
		vertical-align: middle;
	}
	a.pdf {
		font-weight: 600;
		white-space: nowrap;
	}
	.pager {
		display: flex;
		align-items: center;
		gap: 16px;
		margin-top: 16px;
	}
	.pager .pageinfo {
		color: #64748b;
		font-size: 13.5px;
	}
</style>
