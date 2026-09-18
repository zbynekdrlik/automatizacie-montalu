<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { modulNazov } from '$lib/modul-nazov';
	import QrZakazka from '$lib/components/QrZakazka.svelte';

	let { data, form } = $props();

	const zak = $derived(data.zak);

	// #521: stavový text výsledku odoslania objednávky skla do Odoo
	const odoslaneStav: Record<string, string> = {
		uploaded: 'Odoslané do Odoo ✓',
		disabled: 'Náhľad payloadu (odoslanie do Odoo je vypnuté v tomto prostredí)',
		'no-items': 'Žiadne sklá na odoslanie',
		'no-zak': 'Zákazka nie je zadaná',
		missing: 'Zákazka nemá odpis / OP — nedá sa priradiť objednávka',
		failed: 'Odoslanie zlyhalo'
	};
	const polozky = $derived(data.polozky);
	const suboryMap = $derived(data.suboryMap);
	// #540: zoznam typov skla pre picker (Odoo `montalu.glass.type` alebo lokálny fallback)
	const glassTypes = $derived(data.glassTypes);
	const glassTypesSource = $derived(data.glassTypesSource);
	// #545: OP objednávky — odpisové OP má prednosť (read-only); inak ručné pole.
	const maOp = $derived(!!data.effektivneOp);
	// Odoslať sa zapne LEN keď má podklad ≥ 1 riadok A neprázdne efektívne OP — celý invariant na
	// jednom mieste (#545 review 🔵), nespoliehaj sa len na to, že tlačidlo je vnútri guardu položiek.
	const mozeOdoslat = $derived(maOp && polozky.length > 0);

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

<QrZakazka op={data.op} />
<h1>Objednávka skla — {zak}</h1>

<!-- #545: „Pridať riadok" — ručný riadok (ATYP / V.O. / priobjednané / servis). Viditeľný VŽDY,
	aj na prázdnom podklade (formulár mimo guardu položiek). Typ skla je povinný. -->
<section class="card noprint pridat-card" data-testid="pridat-riadok">
	<h2 class="sec">Pridať riadok</h2>
	<form method="POST" action="?/pridatRiadok" use:enhance class="pridat-form">
		<label class="wide"
			>Popis
			<input
				type="text"
				name="popis"
				placeholder="napr. ATYP podľa výkresu, V.O., priobjednané sklo"
				data-testid="manual-popis"
			/></label
		>
		<label
			>Typ skla *
			<select name="typ_skla" required data-testid="manual-typ">
				<option value="">— vyberte typ —</option>
				{#each glassTypes as t (t.value)}
					<option value={t.value}>{t.label}</option>
				{/each}
			</select></label
		>
		<label
			>Šírka (mm) *
			<input
				type="number"
				name="sirka_mm"
				min="1"
				step="1"
				required
				data-testid="manual-sirka"
			/></label
		>
		<label
			>Výška (mm) *
			<input
				type="number"
				name="vyska_mm"
				min="1"
				step="1"
				required
				data-testid="manual-vyska"
			/></label
		>
		<label
			>Počet ks *
			<input
				type="number"
				name="pocet"
				min="1"
				step="1"
				value="1"
				required
				data-testid="manual-pocet"
			/></label
		>
		<label
			>Režim
			<select name="rezim" data-testid="manual-rezim">
				<option value="rozmery">rozmery</option>
				<option value="atyp">atyp</option>
			</select></label
		>
		<button type="submit" class="btn" data-testid="manual-pridat">Pridať riadok</button>
	</form>
	{#if form?.pridatChyba}
		<p class="err" data-testid="manual-chyba">{form.pridatChyba}</p>
	{/if}
</section>

{#if polozky.length === 0}
	<p class="hint">
		Žiadne sklá pre túto zákazku. Pridajte riadok vyššie, alebo ich pridajte z výpočtu v module
		(Zasklenia, Fixy, Pergola).
	</p>
{:else}
	<p class="sub noprint">
		<span class="mono"><b>{polozky.length}</b></span> položiek celkom
		{#if polozky.some((p) => p.rezim === 'atyp')}
			· <span class="mono"><b>{polozky.filter((p) => p.rezim === 'atyp').length}</b></span> atyp
		{/if}
	</p>

	<!-- #540: pôvod zoznamu typov skla v pickeri (Odoo samoobslužný katalóg vs lokálny fallback) -->
	<p class="sub noprint typ-zdroj" data-testid="glass-types-source">
		{#if glassTypesSource === 'odoo'}
			Zoznam typov skla: <b>Odoo</b> ({glassTypes.length})
		{:else}
			Zoznam typov skla: <b>lokálny zoznam</b> — Odoo nedostupné
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
							<td>
								<!-- #540: výber typu skla z Odoo katalógu (`code` → glass_order type); vytlačí sa hodnota -->
								<span class="print-only">{p.typSkla}</span>
								<form method="POST" action="?/nastavTyp" use:enhance class="noprint typ-form">
									<input type="hidden" name="id" value={p.id} />
									<select
										name="typ_skla"
										class="typ-select"
										data-testid={`typ-skla-${p.id}`}
										onchange={(e) => (e.target as HTMLSelectElement).form?.requestSubmit()}
									>
										{#if !glassTypes.some((t) => t.value === p.typSkla)}
											<option value={p.typSkla} selected>{p.typSkla || '— vyberte typ —'}</option>
										{/if}
										{#each glassTypes as t (t.value)}
											<option value={t.value} selected={t.value === p.typSkla}>{t.label}</option>
										{/each}
									</select>
								</form>
							</td>
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
											accept=".pdf,.dxf,.dwg,.step,.stp,.igs,.iges,.xlsx"
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
						<!-- #521: voliteľná špecifikácia tabule (spec kľúče, ktoré appka nevie z katalógu) -->
						<tr class="noprint spec-row">
							<td colspan="8">
								<details>
									<summary>Hrana skla (opracovanie) — pre IZOS oceňovanie</summary>
									<form method="POST" action="?/ulozitSpec" use:enhance class="spec-form">
										<input type="hidden" name="id" value={p.id} />
										<!-- #546: výroba chce z IZOS špecifikácie LEN „Hrana"; ostatných 8 príplatkov (teplá
											hrana, farebný rámik, priečky, otvory, priemer, výrezy 35×60/60×120, HST, kalenie) je
											z UI skryté. Stĺpce/DB/payload builder sa NEmenia — pre STARÉ riadky s nastavenou
											hodnotou ju echujeme hidden inputom, aby ju re-save (Hrana) nezmazal a
											`buildGlassOrderItem` ju ďalej poslal. Default (vypnuté) → hidden sa nerenderuje →
											payload byte-identický. -->
										{#if p.spec.warmEdge}<input
												type="hidden"
												name="spec_warm_edge"
												value="1"
											/>{/if}
										{#if p.spec.coloredFrame}<input
												type="hidden"
												name="spec_colored_frame"
												value="1"
											/>{/if}
										{#if p.spec.muntinCrossQty > 0}<input
												type="hidden"
												name="spec_muntin_cross_qty"
												value={p.spec.muntinCrossQty}
											/>{/if}
										{#if p.spec.holesQty > 0}<input
												type="hidden"
												name="spec_holes_qty"
												value={p.spec.holesQty}
											/>{/if}
										{#if p.spec.holeSize}<input
												type="hidden"
												name="spec_hole_size"
												value={p.spec.holeSize}
											/>{/if}
										{#if p.spec.cutoutSmallQty > 0}<input
												type="hidden"
												name="spec_cutout_small_qty"
												value={p.spec.cutoutSmallQty}
											/>{/if}
										{#if p.spec.cutoutLargeQty > 0}<input
												type="hidden"
												name="spec_cutout_large_qty"
												value={p.spec.cutoutLargeQty}
											/>{/if}
										{#if p.spec.hst}<input type="hidden" name="spec_hst" value="1" />{/if}
										{#if p.spec.temperingOwnGlass}<input
												type="hidden"
												name="spec_tempering_own_glass"
												value="1"
											/>{/if}
										<label
											>Hrana
											<select name="spec_edge_finish" data-testid={`spec-edge-${p.id}`}>
												<option value="none" selected={p.spec.edgeFinish === 'none'}>žiadna</option>
												<option value="ksr" selected={p.spec.edgeFinish === 'ksr'}
													>KSR zrazená</option
												>
												<option
													value="trapez_brusena"
													selected={p.spec.edgeFinish === 'trapez_brusena'}>trapéz brúsená</option
												>
												<option
													value="trapez_lestena"
													selected={p.spec.edgeFinish === 'trapez_lestena'}>trapéz leštená</option
												>
											</select></label
										>
										<button
											type="submit"
											class="btn sm secondary"
											data-testid={`ulozit-spec-${p.id}`}>Uložiť špecifikáciu</button
										>
									</form>
								</details>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>
	{/each}

	<!-- #545: OP objednávky — jedno OP na celý podklad. Z odpisu (read-only, prednosť) alebo ručné
		pole pre servisnú zákazku bez nárezáku. Odoslať sa zapne až keď je OP nastavené. -->
	<section class="card noprint op-card" data-testid="op-card">
		{#if data.op}
			<p class="op-info">
				OP objednávky: <b class="mono" data-testid="op-hodnota">{data.op}</b>
				<span class="sub">(z odpisu zákazky)</span>
			</p>
		{:else}
			<form method="POST" action="?/nastavOp" use:enhance class="op-form">
				<label
					>OP objednávky
					<input
						type="text"
						name="op"
						value={data.podkladOp || data.prefillOp}
						placeholder="napr. OP260545"
						data-testid="op-input"
					/></label
				>
				<button type="submit" class="btn secondary" data-testid="nastav-op">Uložiť OP</button>
				{#if data.podkladOp}<span class="mono op-set" data-testid="op-hodnota"
						>{data.podkladOp}</span
					>{/if}
			</form>
			{#if form?.opChyba}<p class="err" data-testid="op-chyba">{form.opChyba}</p>{/if}
		{/if}
	</section>

	<div class="noprint tbl-akcie">
		<button class="btn secondary" onclick={() => window.print()}>🖨 Tlačiť / uložiť PDF</button>
		<!-- #521: odoslať objednávku skla do Odoo (glass_order → IZOS oceňovanie).
			#545: zapnuté len keď má podklad ≥ 1 riadok a OP (inak nemá kam priradiť objednávku). -->
		{#if mozeOdoslat}
			<form method="POST" action="?/odoslatDoOdoo" use:enhance style="display:inline">
				<button type="submit" class="btn" data-testid="odoslat-odoo"
					>Odoslať objednávku skla do Odoo</button
				>
			</form>
		{:else}
			<button
				type="button"
				class="btn"
				data-testid="odoslat-odoo"
				disabled
				title="Najprv nastavte OP objednávky">Odoslať objednávku skla do Odoo</button
			>
		{/if}
	</div>

	{#if form?.odoslane}
		<section class="noprint odoslane">
			<p class="stav" data-testid="odoslane-stav">
				{odoslaneStav[form.odoslane.result] ?? form.odoslane.result}{#if form.odoslane.error}
					— {form.odoslane.error}{/if}
			</p>
			{#if form.odoslane.payload}
				<details open>
					<summary>Náhľad payloadu (to, čo ide do Odoo)</summary>
					<pre data-testid="glass-order-payload">{JSON.stringify(
							form.odoslane.payload,
							null,
							2
						)}</pre>
				</details>
			{/if}
		</section>
	{/if}
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
		display: flex;
		gap: 10px;
		align-items: center;
	}
	.spec-row td {
		border-bottom: 1px solid var(--m-line);
		background: var(--m-surface-2);
	}
	.spec-row summary {
		cursor: pointer;
		font-size: 0.85rem;
		color: var(--m-muted-ink);
	}
	.spec-form {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 16px;
		align-items: center;
		margin-top: 8px;
		font-size: 0.85rem;
	}
	.spec-form label {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.odoslane {
		margin-top: 16px;
	}
	.odoslane .stav {
		font-weight: 600;
		color: var(--m-ink-2);
	}
	.odoslane pre {
		background: var(--m-surface-2);
		border: 1px solid var(--m-line);
		border-radius: var(--m-radius-sm);
		padding: 10px;
		overflow-x: auto;
		font-size: 0.8rem;
		max-height: 400px;
	}

	.typ-form {
		margin: 0;
	}
	.typ-select {
		max-width: 220px;
	}
	.typ-zdroj {
		font-size: 0.85rem;
	}
	.print-only {
		display: none;
	}

	/* #545: „Pridať riadok" formulár + OP pole */
	.pridat-form,
	.op-form {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 16px;
		align-items: flex-end;
		font-size: 0.85rem;
	}
	.pridat-form label,
	.op-form label {
		display: inline-flex;
		flex-direction: column;
		gap: 2px;
	}
	.pridat-form label.wide {
		flex: 1 1 220px;
	}
	.pridat-form input[type='number'] {
		width: 90px;
	}
	.op-card {
		margin-top: 16px;
	}
	.op-info {
		font-size: 0.9rem;
		color: var(--m-ink-2);
	}
	.op-set {
		align-self: center;
		color: var(--m-ink-2);
	}
	.err {
		color: var(--m-danger);
		font-size: 0.85rem;
		margin-top: 6px;
	}
	.btn[disabled] {
		opacity: 0.5;
		cursor: not-allowed;
	}

	@media print {
		.print-only {
			display: inline;
		}
		.noprint {
			display: none !important;
		}
		@page {
			size: A4 landscape;
			margin: 10mm;
		}
	}
</style>
