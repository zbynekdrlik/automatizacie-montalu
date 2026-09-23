<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { modulNazov } from '$lib/modul-nazov';
	import QrZakazka from '$lib/components/QrZakazka.svelte';
	import { bezRozmerov, fmtRozmerTabule, popisPozicie } from '$lib/objednavka-skla-pozicia';

	let { data, form } = $props();

	// #563: nadpis = OP + zákazník (bez OP → ZAK) — počíta server (`nadpisObjednavky`)
	const nadpis = $derived(data.nadpis);
	// #563: zobrazovací typ skla = reálny Money názov (fallback uložený typ) — len display
	const nazovTypu = (typSkla: string): string => data.nazvySkiel[typSkla] ?? typSkla;

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

	function fmtM2(m2: number | null): string {
		return m2 != null ? `${(Math.round(m2 * 1000) / 1000).toFixed(3)} m²` : '';
	}

	// #548: „iné sklo" — sentinel voľby v pickeri typu (odkryje vlastný typ + cenu €/m²).
	const MANUAL_SENTINEL = '__ine__';
	function fmtCena(c: number | null): string {
		return c != null ? `${c.toFixed(2)} €/m²` : '';
	}
	// „Pridať riadok" — sledovanie voľby typu (odkrytie vlastných polí)
	let novyTyp = $state('');
	const novyIne = $derived(novyTyp === MANUAL_SENTINEL);
	// #553: sledovanie režimu vo formulári — pri atyp zvýrazniť pole na výkres (required-hint)
	let novyRezim = $state('rozmery');
	const novyAtyp = $derived(novyRezim === 'atyp');
	// per-riadok odkrytie „iné sklo" editora (kľúč = id položky)
	let ineRiadok = $state<Record<number, boolean>>({});
	function onTypSelect(e: Event, id: number) {
		const sel = e.currentTarget as HTMLSelectElement;
		if (sel.value === MANUAL_SENTINEL) {
			ineRiadok = { ...ineRiadok, [id]: true };
		} else {
			sel.form?.requestSubmit();
		}
	}
</script>

<svelte:head><title>Objednávka skla {nadpis} — Montalu</title></svelte:head>

<QrZakazka op={data.op} />
<h1 data-testid="objednavka-nadpis">Objednávka skla — {nadpis}</h1>

<!-- #545: „Pridať riadok" — ručný riadok (ATYP / V.O. / priobjednané / servis). Viditeľný VŽDY,
	aj na prázdnom podklade (formulár mimo guardu položiek). Typ skla je povinný. -->
<section class="card noprint pridat-card" data-testid="pridat-riadok">
	<h2 class="sec">Pridať riadok</h2>
	<form
		method="POST"
		action="?/pridatRiadok"
		enctype="multipart/form-data"
		use:enhance
		class="pridat-form"
	>
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
			<select name="typ_skla" required bind:value={novyTyp} data-testid="manual-typ">
				<option value="">— vyberte typ —</option>
				{#each glassTypes as t (t.value)}
					<option value={t.value}>{t.label}</option>
				{/each}
				<option value={MANUAL_SENTINEL}>iné sklo (vlastný typ + cena/m²)</option>
			</select></label
		>
		{#if novyIne}
			<label
				>Vlastný typ skla *
				<input
					type="text"
					name="typ_skla_manual"
					placeholder="napr. lepené 33.1 bronz"
					data-testid="manual-ine-typ"
				/></label
			>
			<label
				>Cena €/m² (bez DPH) *
				<input
					type="number"
					name="cena_m2_manual"
					min="0.01"
					step="0.01"
					data-testid="manual-ine-cena"
				/></label
			>
		{/if}
		<!-- #565: pri atype s výkresom sú rozmery NEPOVINNÉ (výkres má viac tvarov — Patrik, úloha
			1051); pri režime rozmery povinné ako doteraz. Server to re-validuje (atyp bez výkresu → 400). -->
		<label
			>Šírka (mm){novyAtyp ? '' : ' *'}
			<input
				type="number"
				name="sirka_mm"
				min="1"
				step="1"
				required={!novyAtyp}
				data-testid="manual-sirka"
			/></label
		>
		<label
			>Výška (mm){novyAtyp ? '' : ' *'}
			<input
				type="number"
				name="vyska_mm"
				min="1"
				step="1"
				required={!novyAtyp}
				data-testid="manual-vyska"
			/></label
		>
		{#if novyAtyp}
			<p class="hint wide" data-testid="manual-rozmery-hint">
				Pri atype nepovinné — rozmery sú vo výkrese (výkres priložte nižšie).
			</p>
		{/if}
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
			<select name="rezim" bind:value={novyRezim} data-testid="manual-rezim">
				<option value="rozmery">rozmery</option>
				<option value="atyp">atyp</option>
			</select></label
		>
		<!-- #553: výkres priamo vo formulári — vždy renderovaný (progressive enhancement, funguje aj
			bez JS); pri atyp vizuálne zvýraznený + hint (#565: s výkresom rozmery nepovinné). -->
		<label class="subor-vykres wide" class:atyp-zvyraznene={novyAtyp}
			>Výkres {novyAtyp ? '(pri atyp priložte)' : '(pri atyp)'}
			<input
				type="file"
				name="subor"
				accept=".pdf,.dxf,.dwg,.step,.stp,.igs,.iges,.xlsx"
				data-testid="manual-subor"
			/></label
		>
		<button type="submit" class="btn" data-testid="manual-pridat">Pridať riadok</button>
	</form>
	{#if form?.pridatChyba}
		<p class="err" data-testid="manual-chyba">{form.pridatChyba}</p>
	{/if}
	{#if form?.pridatUpozornenie}
		<p class="warn" data-testid="manual-upozornenie">{form.pridatUpozornenie}</p>
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
	<!-- #565: odmietnutá akcia riadka (napr. zmazanie posledného výkresu riadka bez rozmerov) -->
	{#if form?.error}
		<p class="err noprint" data-testid="podklad-chyba">{form.error}</p>
	{/if}

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
						{@const nav = data.naviazanie[p.id]}
						<tr class:atyp={p.rezim === 'atyp'}>
							<td data-testid={`popis-${p.id}`}>{popisPozicie(p.popis, p.modul)}</td>
							<td class="mono" data-testid={`rozmer-${p.id}`}>{fmtRozmerTabule(p)}</td>
							<td>
								<!-- #540: výber typu skla z Odoo katalógu (`code` → glass_order type); vytlačí sa hodnota -->
								<span class="print-only" data-testid={`typ-nazov-${p.id}`}
									>{p.typSklaManual
										? `${p.typSklaManual} · ${fmtCena(p.cenaM2Manual)}`
										: nazovTypu(p.typSkla)}</span
								>
								<form method="POST" action="?/nastavTyp" use:enhance class="noprint typ-form">
									<input type="hidden" name="id" value={p.id} />
									<select
										name="typ_skla"
										class="typ-select"
										data-testid={`typ-skla-${p.id}`}
										onchange={(e) => onTypSelect(e, p.id)}
									>
										{#if !glassTypes.some((t) => t.value === p.typSkla)}
											<option value={p.typSkla} selected
												>{p.typSkla ? nazovTypu(p.typSkla) : '— vyberte typ —'}</option
											>
										{/if}
										<!-- #556: kandidáti podľa zloženia (pri „viac") navrchu pickera -->
										{#if nav?.kandidati.length}
											<optgroup label="Kandidáti (podľa zloženia)">
												{#each nav.kandidati as k (k.value)}
													<option value={k.value}>{k.label}</option>
												{/each}
											</optgroup>
										{/if}
										{#each glassTypes as t (t.value)}
											<option value={t.value} selected={t.value === p.typSkla}>{t.label}</option>
										{/each}
										<option value={MANUAL_SENTINEL}>iné sklo (vlastný typ + cena/m²)</option>
									</select>
								</form>
								{#if nav?.nepriradene}
									<span class="nepriradene-badge noprint" data-testid={`nepriradene-${p.id}`}
										>nepriradené — vyber typ</span
									>
									{#if nav.kandidati.length}
										<span class="kandidati-hint noprint" data-testid={`kandidati-${p.id}`}
											>Kandidáti: {nav.kandidati.map((k) => k.label).join(' · ')}</span
										>
									{/if}
								{/if}
								{#if p.typSklaManual}
									<span class="ine-badge noprint" data-testid={`ine-typ-${p.id}`}
										>iné sklo: {p.typSklaManual} · {fmtCena(p.cenaM2Manual)}</span
									>
								{/if}
								{#if ineRiadok[p.id] || p.typSklaManual}
									<form
										method="POST"
										action="?/nastavTypManual"
										use:enhance
										class="noprint ine-form"
									>
										<input type="hidden" name="id" value={p.id} />
										<input
											type="text"
											name="typ_skla_manual"
											value={p.typSklaManual ?? ''}
											placeholder="vlastný typ"
											data-testid={`ine-typ-input-${p.id}`}
										/>
										<input
											type="number"
											name="cena_m2_manual"
											min="0.01"
											step="0.01"
											value={p.cenaM2Manual ?? ''}
											placeholder="€/m²"
											data-testid={`ine-cena-input-${p.id}`}
										/>
										<button
											type="submit"
											class="btn sm secondary"
											data-testid={`ine-ulozit-${p.id}`}>Uložiť iné sklo</button
										>
									</form>
								{/if}
							</td>
							<td class="r mono"><b>{p.pocet}</b></td>
							<td class="r mono" data-testid={`m2-${p.id}`}>{fmtM2(p.m2)}</td>
							<td>
								<form method="POST" action="?/nastavRezim" use:enhance>
									<input type="hidden" name="id" value={p.id} />
									<select
										name="rezim"
										onchange={(e) => (e.target as HTMLSelectElement).form?.requestSubmit()}
									>
										<!-- #565: riadok bez rozmerov (podľa výkresu) ostáva atyp — server to stráži tiež -->
										<option
											value="rozmery"
											selected={p.rezim === 'rozmery'}
											disabled={bezRozmerov(p)}>rozmery</option
										>
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
			{#if form.odoslane.odoo?.name}
				<p class="odoo-osk" data-testid="odoslane-osk">
					Odoslané do Odoo: <b>{form.odoslane.odoo.name}</b>
				</p>
			{/if}
			{#if form.odoslane.odoo?.dq && form.odoslane.odoo.dq.length > 0}
				<ul class="dq" data-testid="odoslane-dq">
					{#each form.odoslane.odoo.dq as d, i (i)}
						<li>{typeof d === 'string' ? d : JSON.stringify(d)}</li>
					{/each}
				</ul>
			{/if}
			{#if form.odoslane.droppedAttachments && form.odoslane.droppedAttachments.length > 0}
				<p class="dropped" data-testid="odoslane-dropped">
					Vynechané prílohy (limit veľkosti): {form.odoslane.droppedNames}
				</p>
			{/if}
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
	.ine-badge {
		display: inline-block;
		margin-top: 4px;
		font-size: 0.8rem;
		color: var(--m-ink-2);
	}
	/* #556: riadok z výpočtu bez jednoznačného Odoo typu — operátor musí vybrať */
	.nepriradene-badge {
		display: inline-block;
		margin-top: 4px;
		padding: 1px 6px;
		border-radius: 4px;
		background: var(--m-warn-bg, #fff3cd);
		color: var(--m-warn-ink, #8a6d3b);
		font-size: 0.78rem;
		font-weight: 600;
	}
	.kandidati-hint {
		display: block;
		margin-top: 2px;
		font-size: 0.78rem;
		color: var(--m-ink-2);
	}
	.ine-form {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 8px;
		align-items: center;
		margin-top: 4px;
	}
	.ine-form input[type='number'] {
		width: 90px;
	}
	.ine-form input[type='text'] {
		max-width: 180px;
	}
	.odoo-osk {
		margin-top: 6px;
		color: var(--m-ink-2);
	}
	.dq {
		margin: 4px 0 0 18px;
		font-size: 0.85rem;
		color: var(--m-muted-ink);
	}
	.dropped {
		margin-top: 6px;
		font-size: 0.85rem;
		color: var(--m-danger);
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
	.warn {
		color: var(--m-warn, #8a5a00);
		font-size: 0.85rem;
		margin-top: 6px;
	}
	/* #553: pole na výkres v „Pridať riadok" — pri atyp zvýraznené (required-hint) */
	.subor-vykres.atyp-zvyraznene {
		padding: 2px 6px;
		border-radius: 6px;
		background: var(--m-warn-bg, #fff6e6);
		outline: 1px solid var(--m-warn, #e0a54a);
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
