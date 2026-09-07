<script lang="ts">
	// Plán rezov — univerzálny optimalizátor rezov z CAD tabuľky (#482).
	// Dominik vloží tabuľku z CAD (brány, voľné profily), appka zoskupí rovnaké
	// profily, spustí FFD optimalizáciu na 6000/7500 mm tyčiach, ukáže počet
	// tyčí na objednanie + rozpis rezov + odpad. Money-NEUTRÁLNE.
	//
	// Používame use:enhance (nova-stranka #7, vzor /optimalizator) — živá
	// kalkulačka bez plného reloadu, vstupy ostanú tak, ako ich zadal používateľ.
	import { enhance } from '$app/forms';
	import RozpisRezov from '$lib/components/RozpisRezov.svelte';
	import type { PlanRezovVysledok } from '$lib/server/plan-rezov';

	let dlzkaTyce = $state<number>(6000);
	let reznaMedzera = $state<number>(4);
	let cadText = $state<string>('');

	let vysledok = $state<PlanRezovVysledok | null>(null);
	let chyba = $state<string>('');
	let spracuva = $state(false);

	const fmt = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

	const placeholderText =
		'Príklad:\n10001 STABILIZAČNÝ PROFIL 100X50\t1\t5330\n' +
		'10001 STABILIZAČNÝ PROFIL 100X50\t2\t1550\n' +
		'18013 PROFIL 110x110 V2\t2\t1700\n' +
		'AL_50x30x2\t4\t1865\nlat 80x19\t22\t1252';
</script>

<svelte:head><title>Plán rezov</title></svelte:head>

<h1>Plán rezov</h1>
<p class="lead">
	Vlož tabuľku rezov z CAD — appka zoskupí rovnaké profily a pre každý spočíta optimálne rozloženie
	na tyče ({dlzkaTyce} mm). Bez väzby na zákazku, bez Money odpisu.
</p>

<form
	method="POST"
	class="plan-form"
	use:enhance={() => {
		spracuva = true;
		return async ({ result }) => {
			spracuva = false;
			if (result.type === 'success') {
				vysledok = (result.data?.vysledok as PlanRezovVysledok | null) ?? null;
				chyba = '';
			} else if (result.type === 'failure') {
				vysledok = null;
				chyba = (result.data?.error as string | undefined) ?? 'Neplatný vstup.';
			} else if (result.type === 'error') {
				vysledok = null;
				chyba = 'Nastala chyba pri výpočte.';
			}
		};
	}}
>
	<div class="nastavenia">
		<label>
			<span>Dĺžka tyče (mm)</span>
			<select name="dlzkaTyce" bind:value={dlzkaTyce} data-testid="dlzka-tyce">
				<option value={6000}>6 000 mm</option>
				<option value={7500}>7 500 mm</option>
			</select>
		</label>
		<label>
			<span>Rezná medzera (mm)</span>
			<input
				name="reznaMedzera"
				type="number"
				min="0"
				step="1"
				bind:value={reznaMedzera}
				data-testid="rezna-medzera"
			/>
		</label>
	</div>

	<label class="cad-label">
		<span>CAD tabuľka (vlož / paste plán rezov)</span>
		<textarea
			name="cad"
			bind:value={cadText}
			rows="12"
			placeholder={placeholderText}
			data-testid="cad-input"></textarea>
	</label>

	<div class="akcie">
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
		<div class="sumar">
			<span>Profilov: <b data-testid="pocet-profilov">{v.profily.length}</b></span>
			<span>Tyčí spolu: <b data-testid="tyce-spolu">{v.tyceSpolu}</b></span>
			<span>Celkový odpad: <b>{fmt(v.odpadMm)} mm</b> ({fmt(v.odpadPct)} %)</span>
			<span>Dĺžka tyče: {fmt(v.dlzkaTyce)} mm</span>
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
		color: var(--m-ink-3, #64748b);
		font-size: 14px;
		max-width: 640px;
		margin: 4px 0 18px;
	}
	.plan-form {
		background: var(--m-surface, #fff);
		border: 1px solid var(--m-border, #e2e8f0);
		border-radius: 12px;
		padding: 16px;
		margin-bottom: 20px;
	}
	.nastavenia {
		display: flex;
		flex-wrap: wrap;
		gap: 14px;
		margin-bottom: 14px;
	}
	.nastavenia label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 13px;
		color: var(--m-ink-3, #475569);
	}
	.nastavenia select,
	.nastavenia input[type='number'] {
		padding: 6px 8px;
		border: 1px solid var(--m-border, #cbd5e1);
		border-radius: 8px;
		font-size: 14px;
		width: 160px;
	}
	.cad-label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 13px;
		color: var(--m-ink-3, #475569);
		margin-bottom: 14px;
	}
	textarea {
		width: 100%;
		min-height: 180px;
		padding: 10px;
		border: 1px solid var(--m-border, #cbd5e1);
		border-radius: 8px;
		font-family: monospace;
		font-size: 13px;
		resize: vertical;
		box-sizing: border-box;
	}
	.akcie {
		display: flex;
		gap: 10px;
		align-items: center;
	}
	.spocitaj {
		background: var(--m-ink-2);
		color: #fff;
		border: 0;
		border-radius: 8px;
		padding: 9px 18px;
		cursor: pointer;
		font-size: 14px;
		font-weight: 600;
	}
	.spocitaj:hover {
		background: var(--m-ink-2-hover);
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
		color: var(--m-ink-1, #334155);
		margin-bottom: 12px;
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
