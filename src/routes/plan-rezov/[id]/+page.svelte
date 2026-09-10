<script lang="ts">
	// #505: Detail uloženého plánu rezov — rekomputovaný výsledok + tlač.
	import { resolve } from '$app/paths';
	import RozpisRezov from '$lib/components/RozpisRezov.svelte';
	import type { PlanRezovVysledok } from '$lib/server/plan-rezov';

	let { data } = $props();
	const plan = $derived(data.plan);
	const vysledok = $derived(data.vysledok as PlanRezovVysledok);

	const fmt = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');
</script>

<svelte:head><title>Plán rezov — {plan.nazov}</title></svelte:head>

<div class="noprint nav-bar">
	<a href={resolve('/plan-rezov')}>&larr; Späť na plán rezov</a>
</div>

<h1>Plán rezov — {plan.nazov}</h1>

{#if plan.zak}
	<p class="meta">Zákazka: <b>{plan.zak}</b></p>
{/if}
<p class="meta">
	Uložené: {plan.createdAt.slice(0, 16).replace('T', ' ')}
	{#if plan.createdBy}
		· {plan.createdBy}{/if}
</p>

<section class="vysledok" data-testid="vysledok-detail">
	<div class="sumar">
		<span>Profilov: <b>{vysledok.profily.length}</b></span>
		<span>Tyčí spolu: <b>{vysledok.tyceSpolu}</b></span>
		<span>Celkový odpad: <b>{fmt(vysledok.odpadMm)} mm</b> ({fmt(vysledok.odpadPct)} %)</span>
		<span>Dĺžka tyče: {fmt(vysledok.dlzkaTyce)} mm</span>
		<span>Rezná medzera: {fmt(vysledok.reznaMedzera)} mm</span>
	</div>

	{#each vysledok.varovania as w (w)}
		<p class="varovanie">⚠ {w}</p>
	{/each}

	{#if vysledok.material.length > 0}
		<RozpisRezov
			material={vysledok.material}
			bar={vysledok.dlzkaTyce}
			kerf={vysledok.reznaMedzera}
		/>
	{/if}
</section>

<div class="noprint plan-akcie">
	<button class="btn secondary" onclick={() => window.print()} data-testid="tlacit-detail">
		🖨 Tlačiť / uložiť PDF
	</button>
	<a href={resolve('/plan-rezov')} class="btn secondary">Nový plán</a>
</div>

<style>
	.nav-bar {
		margin-bottom: 12px;
		font-size: 14px;
	}
	.nav-bar a {
		color: var(--m-ink-2, #475569);
		text-decoration: none;
	}
	.nav-bar a:hover {
		text-decoration: underline;
	}
	h1 {
		margin-bottom: 6px;
	}
	.meta {
		font-size: 14px;
		color: var(--m-ink-3, #64748b);
		margin: 2px 0;
	}
	.sumar {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 22px;
		font-size: 14px;
		color: var(--m-ink-1, #334155);
		margin: 16px 0 12px;
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
	.plan-akcie {
		margin: 20px 0;
		display: flex;
		gap: 10px;
	}
	.btn.secondary {
		background: var(--m-surface, #fff);
		color: var(--m-ink-1, #334155);
		border: 1px solid var(--m-border, #cbd5e1);
		border-radius: 8px;
		padding: 8px 16px;
		cursor: pointer;
		font-size: 14px;
		text-decoration: none;
		display: inline-block;
	}
	.btn.secondary:hover {
		background: var(--m-surface-2, #f8fafc);
	}

	@media print {
		.noprint {
			display: none !important;
		}
		@page {
			size: A4 portrait;
			margin: 10mm;
		}
	}
</style>
