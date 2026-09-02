<script lang="ts">
	import { nazovSystemu } from '$lib/system-nazvy';
	import { modulNazov } from '$lib/modul-nazov';
	import { resolve } from '$app/paths';
	import CenyTabulka from '$lib/components/CenyTabulka.svelte';
	// #313: created_at je SQLite `datetime('now')` (UTC) — cez `sqliteUtcToIso` + `formatDatumCasSk`
	// na bratislavský lokálny čas (DST-safe, `.claude/rules/timestamps.md`), rovnako ako v histórii.
	import { formatDatumCasSk, sqliteUtcToIso } from '$lib/datum';

	let { data } = $props();
	const o = $derived(data.odpis);
	const d = $derived(data.detail);
</script>

<svelte:head><title>Odpis {o.zak} — Montalu</title></svelte:head>

<div class="card noprint">
	<a class="btn secondary" href={resolve('/odpisy')}>← Späť na históriu</a>
	<!-- cenový zoznam K ZÁKAZKE (#154, časti 1+2) — agregát všetkých odpisov tejto ZAK -->
	<a
		class="btn secondary"
		href={resolve(`/odpisy/zakazka/${encodeURIComponent(o.zak)}`)}
		data-testid="cela-zakazka">📋 Celá zákazka</a
	>
</div>

<div class="card">
	<h1>Odpis {o.zak} <span class="sub">OP {o.op}</span></h1>
	<div class="g">
		<div><span>Zákazník</span><b>{o.zakaznik}</b></div>
		<div>
			<span>Modul</span><b>{modulNazov(o.modul)}</b>
		</div>
		{#if d.system}
			<div><span>Systém</span><b>{nazovSystemu(String(d.system))} {d.styl}</b></div>
		{/if}
		{#if d.s}
			<div><span>Rozmer</span><b class="mono">{d.s}×{d.v} mm</b></div>
		{/if}
		<div><span>Kedy</span><b class="mono">{formatDatumCasSk(sqliteUtcToIso(o.created_at))}</b></div>
		<div><span>Kto</span><b>{o.created_by || '—'}</b></div>
		<div><span>Režim</span><b>{o.live ? '● LIVE' : '🧪 TEST'}</b></div>
		<div><span>Súbor</span><b style="font-size:13px">{o.filename}</b></div>
	</div>
</div>

{#if data.ceny}
	<CenyTabulka ceny={data.ceny} />
{:else}
	<div class="card">
		<div class="sec">Ceny materiálu</div>
		<p class="sub">
			Tento odpis vznikol pred zavedením cenového zoznamu (#154) — presné položky sa preň spätne
			nedajú zrekonštruovať.
		</p>
	</div>
{/if}

<div class="card noprint">
	<button class="btn" onclick={() => window.print()} data-testid="odpis-detail-tlac">
		🖨 Tlačiť / uložiť PDF
	</button>
</div>

<style>
	h1 {
		display: flex;
		align-items: baseline;
		gap: 10px;
	}
	h1 .sub {
		font-size: 16px;
	}

	@media print {
		@page {
			size: A4 landscape;
			margin: 10mm;
		}
	}
</style>
