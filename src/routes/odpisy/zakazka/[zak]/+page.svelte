<script lang="ts">
	import { resolve } from '$app/paths';
	import CenyTabulka from '$lib/components/CenyTabulka.svelte';
	import ReadbackBadge from '$lib/components/ReadbackBadge.svelte';
	// #313: created_at je SQLite `datetime('now')` (UTC) — cez `sqliteUtcToIso` +
	// `formatDatumCasSk` na bratislavský lokálny čas (DST-safe, `.claude/rules/timestamps.md`).
	import { formatDatumCasSk, sqliteUtcToIso } from '$lib/datum';
	import { modulNazov } from '$lib/modul-nazov';

	let { data } = $props();
	const p = $derived(data.prehlad);
	const odpisSlovo = (n: number) => (n === 1 ? 'odpis' : n >= 2 && n <= 4 ? 'odpisy' : 'odpisov');
</script>

<svelte:head><title>Zákazka {p.zak} — ceny materiálu — Montalu</title></svelte:head>

<div class="card noprint">
	<a class="btn secondary" href={resolve('/odpisy')}>← Späť na históriu</a>
</div>

<div class="card" data-testid="zakazka-hlavicka">
	<h1>Zákazka {p.zak}</h1>
	<p class="sub">
		Cenový zoznam odpísaného materiálu — všetky odoslané odpisy tejto zákazky (nárezové plány →
		Money). Ceny sú z denného cenníkového snapshotu Money, appka do Money nič nezapisuje.
	</p>
	<div class="g">
		<div><span>Zákazník</span><b>{p.zakaznik}</b></div>
		<div><span>Odpisy</span><b>{p.odpisy.length} {odpisSlovo(p.odpisy.length)}</b></div>
	</div>
	<p class="sub" data-testid="zakazka-scope">
		{#if p.scope === 'live'}
			Do súčtov vstupujú len ostré (● LIVE) odpisy — {p.odpisovVScope} z {p.odpisy
				.length}.{#if p.parkovanych > 0}
				Vrátane {p.parkovanych} parkovaných ⏳ (ešte nepresunuté do Money importu).{/if}{#if p.odpisy.length > p.odpisovVScope}
				🧪 TEST odpisy sa do súčtov nepočítajú.{/if}
		{:else}
			Zákazka nemá žiadny ostrý (LIVE) odpis — zoznam je zo 🧪 TEST odpisov a slúži len na náhľad.
		{/if}
	</p>
	{#if p.bezPoloziek > 0}
		<p class="sub neuplne" data-testid="zakazka-bez-poloziek">
			⚠ {p.bezPoloziek}
			{odpisSlovo(p.bezPoloziek)} zákazky {p.bezPoloziek === 1
				? 'vznikol'
				: p.bezPoloziek <= 4
					? 'vznikli'
					: 'vzniklo'} pred zavedením cenového zoznamu (#154) — {p.bezPoloziek === 1
				? 'jeho'
				: 'ich'} materiál v zozname CHÝBA.
		</p>
	{/if}
</div>

<div class="card">
	<div class="sec">Odpisy zákazky</div>
	{#if data.readbackMeta?.generatedAt}
		<p class="sub" data-testid="zakazka-readback-stav">
			Overenie voči Money: readback z {formatDatumCasSk(
				sqliteUtcToIso(data.readbackMeta.generatedAt)
			)}.
		</p>
	{:else}
		<p class="sub" data-testid="zakazka-readback-stav">
			Overenie voči Money: readback zatiaľ NEBEŽÍ (nič sa neoverilo) — LIVE odpisy ostávajú
			„neoverené".
		</p>
	{/if}
	<table data-testid="odpisy-zakazky-tabulka">
		<thead>
			<tr>
				<th>Kedy</th>
				<th>Modul</th>
				<th>OP</th>
				<th class="c">Položky</th>
				<th class="c">Režim</th>
				<th class="c">Overenie</th>
				<th>Kto</th>
				<th class="noprint"></th>
			</tr>
		</thead>
		<tbody>
			{#each p.odpisy as o (o.id)}
				<tr>
					<td style="white-space:nowrap">{formatDatumCasSk(sqliteUtcToIso(o.created_at))}</td>
					<td>{modulNazov(o.modul)}</td>
					<td class="mono">{o.op}</td>
					<td class="c">{o.pocetPoloziek > 0 ? o.pocetPoloziek : '—'}</td>
					<td class="c">
						{o.live ? '● LIVE' : '🧪 TEST'}
						{#if o.presunute_at}
							<span
								class="badge presun"
								title={`Súbor bol ručne presunutý zo staging do Money importu (${formatDatumCasSk(sqliteUtcToIso(o.presunute_at))}).`}
								>📦</span
							>
						{:else if o.caka}
							<span title="Parkované v „NA ODPIS“ — čaká na ručný presun do Money importu">⏳</span>
						{/if}
					</td>
					<td class="c">
						<!-- #298 verdikty voči Money — zdieľaný ReadbackBadge, žiadna inline kópia -->
						<ReadbackBadge readback={o.readback} testid={`zak-readback-${o.id}`} />
					</td>
					<td>{o.created_by}</td>
					<td class="c noprint">
						<a class="btn secondary" href={resolve(`/odpisy/${o.id}`)} data-testid={`odpis-${o.id}`}
							>💶 Detail</a
						>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

{#if data.ceny}
	<CenyTabulka ceny={data.ceny} />
{:else}
	<div class="card">
		<div class="sec">Ceny materiálu</div>
		<p class="sub" data-testid="zakazka-bez-cien">
			Odpisy tejto zákazky vznikli pred zavedením cenového zoznamu (#154) — presné položky sa pre ne
			spätne nedajú zrekonštruovať.
		</p>
	</div>
{/if}

<div class="card noprint">
	<button class="btn" onclick={() => window.print()} data-testid="zakazka-tlac">
		🖨 Tlačiť / uložiť PDF
	</button>
</div>

<style>
	h1 {
		display: flex;
		align-items: baseline;
		gap: 10px;
	}
	.neuplne {
		color: #b45309;
		font-weight: 600;
	}

	@media print {
		@page {
			size: A4 landscape;
			margin: 10mm;
		}
	}
</style>
