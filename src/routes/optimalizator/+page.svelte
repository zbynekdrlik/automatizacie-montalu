<script lang="ts">
	// Nárezový optimalizátor (#212) — samostatná kalkulačka nárezu tyčí. Znovupoužíva
	// bin-packing engine `ffdPack` (server) + vizuál `RozpisRezov`. Display-only:
	// žiadny Money odpis, žiadne katalógové kódy, žiadna väzba na zákazku.
	//
	// Používame `use:enhance` (jadro SvelteKit) — pre živú kalkulačku bez plného
	// reloadu: vstupné polia ostanú tak, ako ich používateľ zadal (žiadne value={}
	// resetovanie z pasce nova-stranka #4, žiadny reštart-effect z pasce #3).
	import { enhance } from '$app/forms';
	import RozpisRezov from '$lib/components/RozpisRezov.svelte';
	import type { OptimalizatorVysledok } from '$lib/server/optimalizator';

	// vstupné polia = $state + bind: (typované ako number, bind na <input type="number">)
	let dlzkaTyce = $state<number | null>(6000);
	let pocetTyci = $state<number | null>(10);
	let reznaMedzera = $state<number | null>(10);

	// dynamické riadky kusov — stabilný `id` kľúč (nie index), aby sa binding
	// nepomiešal pri odobratí riadku z prostriedku
	let idSeq = 0;
	let kusy = $state<{ id: number; dlzka: number | null; pocet: number | null }[]>([
		{ id: idSeq++, dlzka: null, pocet: 1 }
	]);

	// výsledok napĺňa use:enhance callback (živá kalkulačka, appka je JS-first ako
	// zvyšok Svelte UI); žiadne value={} echo z pasce nova-stranka #4
	let vysledok = $state<OptimalizatorVysledok | null>(null);
	let chyba = $state<string>('');
	let spracuva = $state(false);

	function pridajKus() {
		kusy = [...kusy, { id: idSeq++, dlzka: null, pocet: 1 }];
	}
	function odoberKus(id: number) {
		kusy = kusy.filter((k) => k.id !== id);
		if (kusy.length === 0) kusy = [{ id: idSeq++, dlzka: null, pocet: 1 }];
	}

	const fmt = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');
</script>

<svelte:head><title>Nárezový optimalizátor</title></svelte:head>

<h1>Nárezový optimalizátor</h1>
<p class="lead">
	Kalkulačka nárezu tyčí — zadaj dĺžku a počet tyčí a zoznam kusov; nástroj rozloží kusy na tyče a
	ukáže odpad. Bez väzby na zákazku, bez Money odpisu.
</p>

<form
	method="POST"
	class="opt-form"
	use:enhance={() => {
		spracuva = true;
		return async ({ result }) => {
			spracuva = false;
			if (result.type === 'success') {
				vysledok = (result.data?.vysledok as OptimalizatorVysledok | null) ?? null;
				chyba = '';
			} else if (result.type === 'failure') {
				vysledok = null;
				chyba = (result.data?.error as string | undefined) ?? 'Neplatný vstup.';
			} else if (result.type === 'error') {
				vysledok = null;
				chyba = 'Nastala chyba pri výpočte.';
			}
			// zámerne NEvoláme update() — vstupné polia necháme tak, ako ich zadal používateľ
		};
	}}
>
	<div class="tyc-vstup">
		<label>
			<span>Dĺžka tyče (mm)</span>
			<input name="dlzkaTyce" type="number" min="1" step="1" bind:value={dlzkaTyce} required />
		</label>
		<label>
			<span>Počet tyčí</span>
			<input name="pocetTyci" type="number" min="1" step="1" bind:value={pocetTyci} required />
		</label>
		<label>
			<span>Rezná medzera (mm)</span>
			<input name="reznaMedzera" type="number" min="0" step="1" bind:value={reznaMedzera} />
		</label>
	</div>

	<table class="kusy">
		<thead>
			<tr><th>Dĺžka kusa (mm)</th><th>Počet</th><th></th></tr>
		</thead>
		<tbody>
			{#each kusy as k (k.id)}
				<tr>
					<td>
						<input
							name="dlzka"
							type="number"
							min="1"
							step="1"
							bind:value={k.dlzka}
							data-testid="kus-dlzka"
							aria-label="Dĺžka kusa"
						/>
					</td>
					<td>
						<input
							name="pocet"
							type="number"
							min="1"
							step="1"
							bind:value={k.pocet}
							data-testid="kus-pocet"
							aria-label="Počet kusov"
						/>
					</td>
					<td>
						<button
							type="button"
							class="x"
							onclick={() => odoberKus(k.id)}
							aria-label="Odobrať riadok">✕</button
						>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>

	<div class="akcie">
		<button type="button" class="pridaj" onclick={pridajKus}>+ Pridať kus</button>
		<button type="submit" class="spocitaj" data-testid="spocitaj" disabled={spracuva}>
			Optimalizovať nárez
		</button>
	</div>
</form>

{#if chyba}
	<p class="chyba" data-testid="chyba">⚠ {chyba}</p>
{/if}

{#if vysledok}
	{@const v = vysledok}
	<section class="vysledok" data-testid="vysledok">
		<div class="sumar" class:nevojde={!v.vojdeSa}>
			<span>Použitých tyčí: <b data-testid="tyce-pouzite">{v.tyceUsed}</b> / {v.pocetTyci}</span>
			<span>Celkový odpad (konce tyčí): <b>{fmt(v.odpadMm)} mm</b> ({fmt(v.odpadPct)} %)</span>
			<span>Rezná medzera: {fmt(v.reznaMedzera)} mm</span>
		</div>

		{#each v.varovania as w (w)}
			<p class="varovanie" data-testid="varovanie">⚠ {w}</p>
		{/each}

		{#if v.material.length > 0}
			<RozpisRezov material={v.material} bar={v.dlzkaTyce} kerf={v.reznaMedzera} />
		{/if}
	</section>
{/if}

<style>
	.lead {
		color: #64748b;
		font-size: 14px;
		max-width: 640px;
		margin: 4px 0 18px;
	}
	.opt-form {
		background: #fff;
		border: 1px solid #e2e8f0;
		border-radius: 12px;
		padding: 16px;
		margin-bottom: 20px;
	}
	.tyc-vstup {
		display: flex;
		flex-wrap: wrap;
		gap: 14px;
		margin-bottom: 14px;
	}
	.tyc-vstup label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 13px;
		color: #475569;
	}
	.tyc-vstup input {
		width: 140px;
	}
	input[type='number'] {
		padding: 6px 8px;
		border: 1px solid #cbd5e1;
		border-radius: 8px;
		font-size: 14px;
	}
	.kusy {
		border-collapse: collapse;
		margin-bottom: 10px;
	}
	.kusy th {
		text-align: left;
		font-size: 11px;
		text-transform: uppercase;
		color: #64748b;
		padding: 3px 12px 3px 0;
	}
	.kusy td {
		padding: 3px 12px 3px 0;
	}
	.kusy input {
		width: 120px;
	}
	.x {
		background: #fef2f2;
		color: #b91c1c;
		border: 1px solid #fecaca;
		border-radius: 8px;
		width: 30px;
		height: 30px;
		cursor: pointer;
		font-size: 13px;
	}
	.x:hover {
		background: #fee2e2;
	}
	.akcie {
		display: flex;
		gap: 10px;
		align-items: center;
	}
	.pridaj {
		background: #f1f5f9;
		color: #334155;
		border: 1px solid #cbd5e1;
		border-radius: 8px;
		padding: 8px 14px;
		cursor: pointer;
		font-size: 13.5px;
	}
	.pridaj:hover {
		background: #e2e8f0;
	}
	.spocitaj {
		background: #2563eb;
		color: #fff;
		border: 0;
		border-radius: 8px;
		padding: 9px 18px;
		cursor: pointer;
		font-size: 14px;
		font-weight: 600;
	}
	.spocitaj:hover {
		background: #1d4ed8;
	}
	.spocitaj:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.chyba {
		color: #b91c1c;
		background: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: 8px;
		padding: 10px 14px;
		font-size: 14px;
	}
	.sumar {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 22px;
		font-size: 14px;
		color: #334155;
		margin-bottom: 12px;
	}
	.sumar.nevojde {
		color: #b45309;
	}
	.varovanie {
		color: #b45309;
		background: #fffbeb;
		border: 1px solid #fde68a;
		border-radius: 8px;
		padding: 10px 14px;
		font-size: 14px;
		margin: 6px 0;
	}
</style>
