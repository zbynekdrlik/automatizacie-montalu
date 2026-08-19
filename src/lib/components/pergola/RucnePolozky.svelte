<script lang="ts">
	// #234 — ručné („pometrané") položky do rezervačného odpisu. Vyčlenené z
	// pergola/narez/+page.svelte (#239): karta + rozpracovaný vstup + validácia žijú tu.
	// `rucneRiadky` je zdroj pravdy — `$bindable` (round-trip vzor PR #81 v rodičovi:
	// serializuje sa do hidden JSON inputu, server ho prepočíta znova, nedôveruje klientu).
	import { rucnaValidacia, type RucnaPolozka } from '$lib/pergola-rucne';
	import type { MJ } from '$lib/komponenty';

	let {
		rucneRiadky = $bindable([]),
		catalog = []
	}: {
		rucneRiadky?: RucnaPolozka[];
		catalog?: { kod: string; nazov: string }[];
	} = $props();

	const fmtM = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

	// rozpracovaný nový riadok
	let rucneKodS = $state('');
	let rucneNazovS = $state('');
	let rucneMnozstvoS = $state<number | string>('');
	let rucneMjS = $state<MJ>('m');
	let rucneChyba = $state('');
	// katalóg z load — kód → názov (na varovanie/predvyplnenie mena pri známom kóde)
	let katByKod = $derived(new Map(catalog.map((c) => [c.kod, c.nazov])));
	let katKody = $derived(new Set(catalog.map((c) => c.kod)));
	// živé varovanie pri rozpísanom kóde (neznámy = upozornenie, nie blok)
	let rucneVarovanie = $derived(rucnaValidacia(rucneKodS, katKody).warning);

	function pridajRucny() {
		rucneChyba = '';
		const kod = rucneKodS.trim();
		const mnoz = parseFloat(String(rucneMnozstvoS).replace(',', '.'));
		if (!kod) {
			rucneChyba = 'Zadaj Money kód položky.';
			return;
		}
		if (!Number.isFinite(mnoz) || mnoz <= 0) {
			rucneChyba = 'Zadaj množstvo väčšie ako 0.';
			return;
		}
		const nazov = rucneNazovS.trim() || katByKod.get(kod) || kod;
		rucneRiadky = [
			...rucneRiadky,
			{ kod, nazov, mnozstvo: Math.round(mnoz * 1000) / 1000, mj: rucneMjS }
		];
		rucneKodS = '';
		rucneNazovS = '';
		rucneMnozstvoS = '';
		rucneMjS = 'm';
	}

	function odoberRucny(i: number) {
		rucneRiadky = rucneRiadky.filter((_, idx) => idx !== i);
	}
</script>

<!-- #234 — ručné („pometrané") položky: Money kód + názov + množstvo v MJ položky.
     Idú do odpisu SPOLU so spočítanými, po tom istom potvrdení. Neznámy kód = varovanie. -->
<div class="card noprint" data-testid="rucne-karta">
	<div class="sec">
		Ručné položky (pometrané)
		{#if rucneRiadky.length}<span class="badge rucne" data-testid="rucne-pocet"
				>✍️ {rucneRiadky.length} ručne pridané</span
			>{/if}
	</div>
	<p class="sub">
		Pridaj položku, ktorú počítaš ručne (napr. <b>kotviace profily</b> „pometrané", alebo položka bez
		vzorca): Money kód + názov + množstvo v jednotke položky (m alebo ks). Pridané riadky idú do odpisu
		spolu so spočítanými, po tom istom potvrdení.
	</p>

	{#if rucneRiadky.length}
		<table class="narez" data-testid="rucne-tabulka">
			<thead>
				<tr><th>Money kód</th><th>Názov</th><th>Množstvo</th><th></th></tr>
			</thead>
			<tbody>
				{#each rucneRiadky as r, i (r.kod + '·' + i)}
					<tr data-testid="rucne-riadok">
						<td>{r.kod} <span class="badge rucne">✍️ ručne pridané</span></td>
						<td>{r.nazov}</td>
						<td><b>{fmtM(r.mnozstvo)} {r.mj}</b></td>
						<td
							><button
								type="button"
								class="btn-link"
								data-testid="rucne-odober"
								onclick={() => odoberRucny(i)}>✕ odobrať</button
							></td
						>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}

	<div class="grid4 rucne-vstup">
		<div class="field">
			<label for="rucneKod">Money kód</label>
			<input
				id="rucneKod"
				data-testid="rucne-kod"
				bind:value={rucneKodS}
				placeholder="napr. PRP20259"
			/>
		</div>
		<div class="field">
			<label for="rucneNazov">Názov</label>
			<input
				id="rucneNazov"
				data-testid="rucne-nazov"
				bind:value={rucneNazovS}
				placeholder={rucneKodS && katByKod.get(rucneKodS.trim())
					? katByKod.get(rucneKodS.trim())
					: 'názov položky'}
			/>
		</div>
		<div class="field">
			<label for="rucneMnozstvo">Množstvo</label>
			<input
				id="rucneMnozstvo"
				data-testid="rucne-mnozstvo"
				type="text"
				inputmode="decimal"
				bind:value={rucneMnozstvoS}
				placeholder="napr. 12,5"
			/>
		</div>
		<div class="field">
			<label for="rucneMj">MJ</label>
			<select id="rucneMj" data-testid="rucne-mj" bind:value={rucneMjS}>
				<option value="m">m (metre)</option>
				<option value="ks">ks (kusy)</option>
			</select>
		</div>
	</div>
	{#if rucneVarovanie}
		<p class="sub" data-testid="rucne-varovanie" style="color:#b45309">⚠️ {rucneVarovanie}</p>
	{:else if rucneKodS.trim() && katByKod.get(rucneKodS.trim())}
		<p class="sub" data-testid="rucne-znamy" style="color:#15803d">
			✅ Kód v katalógu: {katByKod.get(rucneKodS.trim())}
		</p>
	{/if}
	{#if rucneChyba}
		<p class="sub" data-testid="rucne-chyba" style="color:#dc2626">⚠️ {rucneChyba}</p>
	{/if}
	<button type="button" class="btn secondary" data-testid="rucne-pridat" onclick={pridajRucny}
		>➕ Pridať ručnú položku</button
	>
</div>

<style>
	/* #234 — ručné položky: vstupný grid + odobrať link (scoped v komponente #239).
	   `.badge.rucne` a `table.narez` sú zdieľané → v app.css (global). */
	/* odznak „✍️ N ručne pridané" v .sec hlavičke — .sec je uppercase, badge nechať tak
	   (page-scoped override z pôvodného +page.svelte; scoped, nie global — .sec+.badge na
	   iných routách sa nesmie meniť). */
	.sec .badge {
		text-transform: none;
		letter-spacing: 0;
		vertical-align: middle;
		margin-left: 6px;
		font-size: 12px;
		font-weight: 700;
	}
	.grid4 {
		display: grid;
		grid-template-columns: 1fr 1.4fr 0.8fr 0.8fr;
		gap: 12px;
		align-items: end;
	}
	@media (max-width: 640px) {
		.grid4 {
			grid-template-columns: 1fr 1fr;
		}
	}
	.rucne-vstup {
		margin-top: 8px;
	}
	.btn-link {
		background: none;
		border: none;
		color: #dc2626;
		cursor: pointer;
		font-size: 13px;
		padding: 0;
	}
</style>
