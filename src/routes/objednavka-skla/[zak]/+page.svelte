<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { modulNazov } from '$lib/modul-nazov';

	let { data } = $props();

	const zak = $derived(data.zak);
	const polozky = $derived(data.polozky);
	const suboryMap = $derived(data.suboryMap);

	// Zoskupenie položiek podľa modulu (plain array, bez Map — svelte/prefer-svelte-reactivity)
	const skupiny = $derived.by(() => {
		const groups: { modul: string; items: typeof polozky }[] = [];
		for (const p of polozky) {
			let g = groups.find((x) => x.modul === p.modul);
			if (!g) {
				g = { modul: p.modul, items: [] };
				groups.push(g);
			}
			g.items.push(p);
		}
		return groups;
	});

	function fmtRozmer(p: (typeof polozky)[number]): string {
		if (p.sikmy) {
			return `${Math.round(p.sirkaMm)} × ${Math.round(p.vLavoMm ?? 0)}/${Math.round(p.vPravoMm ?? 0)} mm (šikmé)`;
		}
		return `${Math.round(p.sirkaMm)} × ${Math.round(p.vyskaMm ?? 0)} mm`;
	}

	function fmtM2(m2: number | null): string {
		return m2 != null ? `${(Math.round(m2 * 1000) / 1000).toFixed(3)} m²` : '';
	}
</script>

<svelte:head><title>Objednávka skla {zak} — Montalu</title></svelte:head>

<h1>Objednávka skla — {zak}</h1>

{#if polozky.length === 0}
	<p class="hint">
		Žiadne sklá pre túto zákazku. Pridajte ich z výpočtu v module (Zasklenia, Fixy, Pergola).
	</p>
{:else}
	<p class="sub noprint">
		<span class="mono"><b>{polozky.length}</b></span> položiek celkom
		{#if polozky.some((p) => p.rezim === 'atyp')}
			· <span class="mono"><b>{polozky.filter((p) => p.rezim === 'atyp').length}</b></span> atyp
		{/if}
	</p>

	{#each skupiny as { modul, items } (modul)}
		<section class="card">
			<h2 class="sec">{modulNazov(modul)}</h2>
			<table>
				<thead>
					<tr>
						<th>Popis</th>
						<th>Rozmery</th>
						<th>Typ skla</th>
						<th class="r">Počet</th>
						<th class="r">m<sup>2</sup></th>
						<th>Režim</th>
						<th class="noprint">Prílohy</th>
						<th class="noprint"></th>
					</tr>
				</thead>
				<tbody>
					{#each items as p (p.id)}
						<tr class:atyp={p.rezim === 'atyp'}>
							<td>{p.popis}</td>
							<td class="mono">{fmtRozmer(p)}</td>
							<td>{p.typSkla}</td>
							<td class="r mono"><b>{p.pocet}</b></td>
							<td class="r mono">{fmtM2(p.m2)}</td>
							<td>
								<form method="POST" action="?/nastavRezim" use:enhance>
									<input type="hidden" name="id" value={p.id} />
									<select
										name="rezim"
										onchange={(e) => (e.target as HTMLSelectElement).form?.requestSubmit()}
									>
										<option value="rozmery" selected={p.rezim === 'rozmery'}>rozmery</option>
										<option value="atyp" selected={p.rezim === 'atyp'}>atyp</option>
									</select>
								</form>
							</td>
							<td class="noprint">
								{#if suboryMap[p.id]}
									{#each suboryMap[p.id]! as f (f.id)}
										<span class="subor-tag">
											<a href={resolve(`/objednavka-skla/subor/${f.id}`)}>{f.nazov}</a>
											<form method="POST" action="?/zmazatSubor" use:enhance style="display:inline">
												<input type="hidden" name="id" value={f.id} />
												<button type="submit" class="btn-remove" title="Zmazať súbor"
													>&times;</button
												>
											</form>
										</span>
									{/each}
								{/if}
								{#if p.rezim === 'atyp'}
									<form
										method="POST"
										action="?/nahratSubor"
										enctype="multipart/form-data"
										use:enhance
									>
										<input type="hidden" name="polozkaId" value={p.id} />
										<input
											type="file"
											name="subor"
											accept=".pdf,.dxf,.dwg,.step,.stp,.igs,.iges"
											required
										/>
										<button type="submit" class="btn sm secondary">Nahrať</button>
									</form>
								{/if}
							</td>
							<td class="noprint">
								<form method="POST" action="?/zmazat" use:enhance>
									<input type="hidden" name="id" value={p.id} />
									<button type="submit" class="btn sm danger outline" title="Odstrániť položku"
										>&times;</button
									>
								</form>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>
	{/each}

	<div class="noprint tbl-akcie">
		<button class="btn secondary" onclick={() => window.print()}>🖨 Tlačiť / uložiť PDF</button>
	</div>
{/if}

<style>
	h1 {
		margin-bottom: 8px;
	}
	.sub {
		margin-bottom: 16px;
		color: var(--m-muted-ink);
	}
	.hint {
		color: var(--m-muted-ink);
		font-style: italic;
	}
	section.card {
		margin-bottom: 24px;
	}
	.sec {
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--m-ink-2);
		margin-bottom: 8px;
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	th,
	td {
		padding: 6px 10px;
		text-align: left;
		border-bottom: 1px solid var(--m-line);
	}
	th {
		font-size: 0.8rem;
		color: var(--m-muted-ink);
		font-weight: 500;
	}
	.r {
		text-align: right;
	}
	tr.atyp {
		background: var(--m-accent-soft);
	}
	select {
		padding: 2px 4px;
		font-size: 0.85rem;
	}
	.subor-tag {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		margin-right: 6px;
		font-size: 0.85rem;
		background: var(--m-surface-2);
		border-radius: var(--m-radius-sm);
		padding: 2px 6px;
	}
	.subor-tag a {
		color: var(--m-ink);
	}
	.btn-remove {
		background: none;
		border: none;
		color: var(--m-danger);
		cursor: pointer;
		font-size: 1rem;
		line-height: 1;
		padding: 0 2px;
	}
	input[type='file'] {
		font-size: 0.8rem;
		width: auto;
		max-width: 200px;
	}
	.tbl-akcie {
		margin-top: 16px;
	}

	@media print {
		.noprint {
			display: none !important;
		}
		@page {
			size: A4 landscape;
			margin: 10mm;
		}
	}
</style>
