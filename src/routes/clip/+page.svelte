<script lang="ts">
	import ProfilObrazok from '$lib/components/ProfilObrazok.svelte';
	import OdpisBlok from '$lib/components/OdpisBlok.svelte';
	import SkladVarovania from '$lib/components/SkladVarovania.svelte';
	import { resolve } from '$app/paths';
	import {
		popisTyp,
		CLIP_MIN_SIRKA,
		CLIP_MAX_SIRKA,
		CLIP_MIN_VYSKA,
		CLIP_MAX_VYSKA,
		type ClipVstup
	} from '$lib/clip';

	let { data, form } = $props();

	const fmt = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

	// Plný POST + echo vzor (nova-stranka #4/#7 — wizard s krokmi): žiadny $state
	// pre polia formulára, žiadny reštart-effect. Server vždy vráti `vstup`, ktorý
	// value={} echuje späť; typed hodnoty tečú cez FormData, nie cez Svelte state.
	let vstup = $derived(
		(form?.vstup as ClipVstup) ?? {
			zak: '',
			op: '',
			zakaznik: '',
			caka: false,
			typ: 'izo',
			variant: 1,
			sirka: '' as unknown as number,
			vyska: '' as unknown as number,
			ral: ''
		}
	);

	let step = $derived(form?.step ?? 'form');
	// #448/#451 predodpisové skladové varovanie + odobrať (clip — b2b sa na túto route nedostane)
	let skladVarovania = $derived(form && 'skladVarovania' in form ? form.skladVarovania : null);
	let snapshotDatum = $derived(form && 'snapshotDatum' in form ? form.snapshotDatum : null);

	// #461: vylúčené kódy z SkladVarovania — bindable, ide do hidden inputu vo formulári
	let vyluceneKody = $state('');

	// --- Multi režim (#468 fáza 2) ---
	type KusRow = {
		typ: 'izo' | 'klasika';
		variant: number;
		sirka: number | '';
		vyska: number | '';
		ral: string;
	};

	// multi vstup z echovaného servera (po POST), alebo default
	let multiVstup = $derived(
		form && 'multiVstup' in form && form.multiVstup
			? (form.multiVstup as {
					zak: string;
					op: string;
					zakaznik: string;
					caka: boolean;
					kusy: ClipVstup[];
				})
			: null
	);

	// mode toggle — single vs multi
	let multiMode = $state(false);

	// reactive: keď server vráti multiVstup, prepni do multi režimu a inicializuj stav
	let kusy = $state<KusRow[]>([
		{ typ: 'izo', variant: 1, sirka: '' as number | '', vyska: '' as number | '', ral: '' }
	]);
	let multiZak = $state('');
	let multiOp = $state('');
	let multiZakaznik = $state('');
	let multiCaka = $state(false);

	$effect(() => {
		const mv = multiVstup;
		if (mv) {
			multiMode = true;
			multiZak = mv.zak;
			multiOp = mv.op;
			multiZakaznik = mv.zakaznik;
			multiCaka = mv.caka;
			kusy = mv.kusy.map((k) => ({
				typ: k.typ,
				variant: k.variant,
				sirka: k.sirka,
				vyska: k.vyska,
				ral: k.ral
			}));
		}
	});

	function addKus() {
		kusy.push({
			typ: 'izo',
			variant: 1,
			sirka: '' as number | '',
			vyska: '' as number | '',
			ral: ''
		});
	}

	function removeKus(i: number) {
		if (kusy.length > 1) kusy.splice(i, 1);
	}

	// JSON serializácia kusov pre hidden input
	let kusyJSON = $derived(
		JSON.stringify(
			kusy.map((k) => ({
				typ: k.typ,
				variant: k.variant,
				sirka: k.sirka,
				vyska: k.vyska,
				ral: k.ral
			}))
		)
	);
</script>

<svelte:head><title>CLIP zábradlie — odpis materiálu</title></svelte:head>

{#snippet hiddenVstup()}
	<input type="hidden" name="zak" value={vstup.zak} />
	<input type="hidden" name="op" value={vstup.op} />
	<input type="hidden" name="zakaznik" value={vstup.zakaznik} />
	<input type="hidden" name="typ" value={vstup.typ} />
	<input type="hidden" name="variant" value={vstup.variant} />
	<input type="hidden" name="sirka" value={vstup.sirka} />
	<input type="hidden" name="vyska" value={vstup.vyska} />
	<input type="hidden" name="ral" value={vstup.ral} />
	{#if vstup.caka}<input type="hidden" name="caka" value="1" />{/if}
{/snippet}

{#snippet hiddenMulti()}
	<input type="hidden" name="zak" value={multiVstup?.zak ?? multiZak} />
	<input type="hidden" name="op" value={multiVstup?.op ?? multiOp} />
	<input type="hidden" name="zakaznik" value={multiVstup?.zakaznik ?? multiZakaznik} />
	<input type="hidden" name="clipKusy" value={kusyJSON} />
	{#if multiVstup?.caka ?? multiCaka}<input type="hidden" name="caka" value="1" />{/if}
{/snippet}

{#if step === 'form'}
	<div class="card">
		<h1>CLIP zábradlie — odpis materiálu do Money</h1>
		<p class="sub">
			Zadaj rozmer zábradlia a počet výplní, rozpis si skontroluješ a upravíš pred odoslaním.
			{#if !data.live}<b>Bežíme v 🧪 TEST režime — do Money nejde nič.</b>{/if}
		</p>
		<!-- #468: prepínač single / multi -->
		<div style="margin-top:8px">
			<label class="opt opt-grid">
				<input type="checkbox" bind:checked={multiMode} data-testid="clip-multi-toggle" />
				Viac kusov naraz (spoločný odpis)
			</label>
		</div>
	</div>

	{#if form?.error}
		<div class="err" data-testid="form-error">⚠️ {form.error}</div>
	{/if}

	{#if !multiMode}
		<!-- === SINGLE režim (pôvodný formulár) === -->
		<div class="card">
			<form method="POST" action="?/spocitat">
				<div class="grid3">
					<div class="field">
						<label for="zak">Číslo objednávky (ZAK) *</label>
						<input id="zak" name="zak" value={vstup.zak} required />
					</div>
					<div class="field">
						<label for="op">OP/OPDL číslo *</label>
						<input id="op" name="op" value={vstup.op} required />
					</div>
					<div class="field">
						<label for="zakaznik">Zákazník *</label>
						<input id="zakaznik" name="zakaznik" value={vstup.zakaznik} required />
					</div>
				</div>
				<div class="grid3">
					<div class="field">
						<label for="typ">Výplň</label>
						<select id="typ" name="typ" value={vstup.typ} data-testid="typ">
							<option value="izo">IZO (4-8-4)</option>
							<option value="klasika">klasika (3.3.1 číre)</option>
						</select>
					</div>
					<div class="field">
						<label for="variant">Počet výplní</label>
						<select id="variant" name="variant" value={String(vstup.variant)} data-testid="variant">
							<option value="1">B0 — 1 výplň</option>
							<option value="2">B1 — 2 výplne</option>
							<option value="3">B2 — 3 výplne</option>
							<option value="4">B3 — 4 výplne</option>
						</select>
					</div>
					<div class="field">
						<label for="ral">RAL farba (informačná)</label>
						<input
							id="ral"
							name="ral"
							value={vstup.ral}
							maxlength="40"
							placeholder="napr. RAL 7016"
						/>
					</div>
				</div>
				<div class="grid3">
					<div class="field">
						<label for="sirka">Šírka zábradlia (mm) *</label>
						<input
							id="sirka"
							name="sirka"
							type="number"
							min={CLIP_MIN_SIRKA}
							max={CLIP_MAX_SIRKA}
							step="any"
							value={vstup.sirka}
							required
						/>
					</div>
					<div class="field">
						<label for="vyska">Výška zábradlia (mm) *</label>
						<input
							id="vyska"
							name="vyska"
							type="number"
							min={CLIP_MIN_VYSKA}
							max={CLIP_MAX_VYSKA}
							step="any"
							value={vstup.vyska}
							required
						/>
					</div>
					<div class="field">
						<label class="opt opt-grid">
							<input type="checkbox" name="caka" value="1" checked={vstup.caka} />
							Čaká na materiál (odloží do NA ODPIS/Clip)
						</label>
					</div>
				</div>
				<button class="btn" type="submit">Spočítať rozpis</button>
			</form>
		</div>
	{:else}
		<!-- === MULTI režim (#468) === -->
		<div class="card">
			<form method="POST" action="?/spocitatMulti">
				<div class="grid3">
					<div class="field">
						<label for="m-zak">Číslo objednávky (ZAK) *</label>
						<input id="m-zak" name="zak" bind:value={multiZak} required />
					</div>
					<div class="field">
						<label for="m-op">OP/OPDL číslo *</label>
						<input id="m-op" name="op" bind:value={multiOp} required />
					</div>
					<div class="field">
						<label for="m-zakaznik">Zákazník *</label>
						<input id="m-zakaznik" name="zakaznik" bind:value={multiZakaznik} required />
					</div>
				</div>
				<div class="field" style="margin-bottom:8px">
					<label class="opt opt-grid">
						<input type="checkbox" bind:checked={multiCaka} />
						Čaká na materiál (odloží do NA ODPIS/Clip)
					</label>
				</div>
				{#if multiCaka}<input type="hidden" name="caka" value="1" />{/if}
				<input type="hidden" name="clipKusy" value={kusyJSON} />

				{#each kusy as kus, i (i)}
					<div
						class="card"
						style="margin:8px 0;padding:12px;border-left:3px solid var(--m-primary)"
					>
						<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
							<b>Zasklenie {i + 1}</b>
							{#if kusy.length > 1}
								<button
									type="button"
									class="btn secondary"
									style="padding:2px 8px;font-size:12px"
									onclick={() => removeKus(i)}>✕ Odstrániť</button
								>
							{/if}
						</div>
						<div class="grid3">
							<div class="field">
								<label for="k{i}-typ">Výplň</label>
								<select id="k{i}-typ" bind:value={kus.typ} data-testid="k{i}-typ">
									<option value="izo">IZO (4-8-4)</option>
									<option value="klasika">klasika (3.3.1 číre)</option>
								</select>
							</div>
							<div class="field">
								<label for="k{i}-variant">Počet výplní</label>
								<select id="k{i}-variant" bind:value={kus.variant} data-testid="k{i}-variant">
									<option value={1}>B0 — 1 výplň</option>
									<option value={2}>B1 — 2 výplne</option>
									<option value={3}>B2 — 3 výplne</option>
									<option value={4}>B3 — 4 výplne</option>
								</select>
							</div>
							<div class="field">
								<label for="k{i}-ral">RAL farba</label>
								<input
									id="k{i}-ral"
									bind:value={kus.ral}
									maxlength="40"
									placeholder="napr. RAL 7016"
								/>
							</div>
						</div>
						<div class="grid3">
							<div class="field">
								<label for="k{i}-sirka">Šírka (mm) *</label>
								<input
									id="k{i}-sirka"
									type="number"
									min={CLIP_MIN_SIRKA}
									max={CLIP_MAX_SIRKA}
									step="any"
									bind:value={kus.sirka}
									required
								/>
							</div>
							<div class="field">
								<label for="k{i}-vyska">Výška (mm) *</label>
								<input
									id="k{i}-vyska"
									type="number"
									min={CLIP_MIN_VYSKA}
									max={CLIP_MAX_VYSKA}
									step="any"
									bind:value={kus.vyska}
									required
								/>
							</div>
						</div>
					</div>
				{/each}

				<button type="button" class="btn secondary" onclick={addKus} data-testid="clip-add-kus"
					>➕ Pridať zasklenie</button
				>
				<button class="btn" type="submit" style="margin-left:8px">Spočítať rozpis</button>
			</form>
		</div>
	{/if}
{:else if step === 'kontrola' && form && 'vypocet' in form && form.vypocet}
	{@const v = form.vypocet}
	<div class="card">
		<h1>Kontrola rozpisu — {vstup.zak} · {vstup.zakaznik}</h1>
		<p class="sub">
			<span class="badge"
				>CLIP · {popisTyp(vstup.typ)} · B{vstup.variant - 1} ({vstup.variant} výplní) · {vstup.sirka}×{vstup.vyska}
				mm</span
			>
			{#if vstup.ral}<span class="badge">RAL: {vstup.ral}</span>{/if}
			{#if !data.live}<span class="badge test">🧪 TEST — do Money NEJDE</span>{/if}
		</p>
		<p class="sub">
			Šírka výplne {fmt(v.sirkaVyplne)} mm · výška výplne {fmt(v.vyskaVyplne)} mm · {fmt(v.m2)} m²
			{#if v.poziciePriecok.length}
				· priečky od kraja: {v.poziciePriecok.map((p) => fmt(p)).join(', ')} mm
			{/if}
		</p>
		<p class="sub">
			Množstvá (počet tyčí) môžeš upraviť — prázdne pole = automatická hodnota. Záporné a nečíselné
			sa odmietnu.
		</p>
	</div>

	{#if form?.error}
		<div class="err" data-testid="kontrola-error">⚠️ {form.error}</div>
	{/if}

	<!-- #448/#451: predodpisové skladové varovanie + odobrať pri odpise -->
	<SkladVarovania varovania={skladVarovania ?? undefined} {snapshotDatum} bind:vyluceneKody />

	<div class="card">
		<form method="POST" action="?/odoslat">
			{@render hiddenVstup()}
			<input type="hidden" name="vylucene_kody" value={vyluceneKody} />
			<div class="sec">Odpis do Money (počet tyčí 7500 mm)</div>
			<table data-testid="kontrola-tabulka">
				<thead
					><tr
						><th></th><th>Kód</th><th>Položka</th><th class="c" style="width:150px">Počet tyčí</th
						></tr
					></thead
				>
				<tbody>
					{#each v.polozky as o (o.kod)}
						<tr>
							<td style="width:52px"><ProfilObrazok kod={o.kod} nazov={o.nazov} /></td>
							<td class="c mono">{o.kod}</td>
							<td>{o.nazov}</td>
							<td class="c">
								<!-- bez min/max — rozsahy stráži server (applyEdits) -->
								<input
									name="qty_{o.kod}"
									type="number"
									step="1"
									value={(form && 'editVals' in form && form.editVals?.[o.kod]) || o.qty}
									aria-label="Počet tyčí {o.kod}"
									style="padding:6px 8px;font-size:14px;text-align:center;width:90px"
								/>
								<span style="margin-left:6px;color:var(--m-muted-ink);font-size:13px">ks</span>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>

			<div class="sec" style="margin-top:18px">Nárez (per profil) — informačný</div>
			<table data-testid="narez-tabulka">
				<thead
					><tr
						><th>Označenie</th><th>Kód</th><th class="c">Rozmer</th><th class="c">Ks</th><th
							class="c">Tyče</th
						><th class="c">Množstvo</th></tr
					></thead
				>
				<tbody>
					{#each v.riadky as r, i (i)}
						<tr class:drobna={r.kod === null}>
							<td>{r.oznacenie}</td>
							<td class="c mono">{r.kod ?? '—'}</td>
							<td class="c mono">{r.rozmer === null ? '—' : `${fmt(r.rozmer)} mm`}</td>
							<td class="c mono">{r.rozmer === null ? '—' : r.pocetKs}</td>
							<td class="c mono">{r.pocetTyci ?? '—'}</td>
							<td class="c">
								<span class="mono">{fmt(r.mnozstvo)} {r.mj}</span>
								{#if r.poznamka}<span class="hint" title={r.poznamka}>· neodpisuje sa</span>{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>

			<div style="height:12px" class="noprint"></div>
			<button class="btn noprint" type="submit" data-testid="odoslat">
				{data.live
					? vstup.caka
						? '⏳ Odoslať odpis (odloží sa do NA ODPIS/Clip)'
						: '✅ Odoslať odpis do Money'
					: '🧪 Odoslať odpis (TEST priečinok)'}
			</button>
		</form>
		<button class="btn secondary noprint" onclick={() => window.print()}
			>🖨 Tlačiť / uložiť PDF</button
		>
		<form method="POST" action="?/upravit" style="display:inline">
			{@render hiddenVstup()}
			<button class="btn secondary noprint" type="submit">← Späť a upraviť zadanie</button>
		</form>
	</div>
{:else if step === 'kontrolaMulti' && form && 'multi' in form && form.multi}
	{@const multi = form.multi}
	<div class="card">
		<h1>
			Kontrola rozpisu — {(form.multiVstup as { zak: string }).zak} · {(
				form.multiVstup as { zakaznik: string }
			).zakaznik}
		</h1>
		<p class="sub">
			<span class="badge">CLIP multi · {multi.kusy.length} kusov</span>
			{#if !data.live}<span class="badge test">🧪 TEST — do Money NEJDE</span>{/if}
		</p>
	</div>

	{#if form?.error}
		<div class="err" data-testid="kontrola-error">⚠️ {form.error}</div>
	{/if}
	{#if form && 'warn' in form && form.warn}
		<div class="err" data-testid="kontrola-warn">⚠️ {form.warn}</div>
	{/if}

	<SkladVarovania varovania={skladVarovania ?? undefined} {snapshotDatum} bind:vyluceneKody />

	<!-- per-kus detail (nárez) -->
	{#each multi.kusy as kus, ki (ki)}
		{@const mv = (form.multiVstup as { kusy: ClipVstup[] }).kusy[ki]}
		<div class="card" data-testid="kus-detail-{ki}">
			<div class="sec">
				Zasklenie {ki + 1}: {popisTyp(mv?.typ ?? 'izo')} · B{(mv?.variant ?? 1) - 1} · {mv?.sirka ??
					0}×{mv?.vyska ?? 0} mm
				{#if mv?.ral}
					· RAL: {mv.ral}{/if}
			</div>
			<p class="sub">
				Šírka výplne {fmt(kus.sirkaVyplne)} mm · výška {fmt(kus.vyskaVyplne)} mm · {fmt(kus.m2)} m²
			</p>
			<table>
				<thead
					><tr
						><th>Označenie</th><th>Kód</th><th class="c">Rozmer</th><th class="c">Ks</th><th
							class="c">Tyče</th
						><th class="c">Množstvo</th></tr
					></thead
				>
				<tbody>
					{#each kus.riadky as r, ri (ri)}
						<tr class:drobna={r.kod === null}>
							<td>{r.oznacenie}</td>
							<td class="c mono">{r.kod ?? '—'}</td>
							<td class="c mono">{r.rozmer === null ? '—' : `${fmt(r.rozmer)} mm`}</td>
							<td class="c mono">{r.rozmer === null ? '—' : r.pocetKs}</td>
							<td class="c mono">{r.pocetTyci ?? '—'}</td>
							<td class="c">
								<span class="mono">{fmt(r.mnozstvo)} {r.mj}</span>
								{#if r.poznamka}<span class="hint" title={r.poznamka}>· neodpisuje sa</span>{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/each}

	<!-- spoločný odpis -->
	<div class="card">
		<form method="POST" action="?/odoslatMulti">
			{@render hiddenMulti()}
			<input type="hidden" name="vylucene_kody" value={vyluceneKody} />
			{#if form && 'planHash' in form}<input
					type="hidden"
					name="planHash"
					value={form.planHash}
				/>{/if}
			<div class="sec">Odpis do Money — spoločný (počet tyčí 7500 mm)</div>
			<table data-testid="kontrola-tabulka">
				<thead
					><tr
						><th></th><th>Kód</th><th>Položka</th><th class="c" style="width:150px">Počet tyčí</th
						></tr
					></thead
				>
				<tbody>
					{#each multi.polozky as o (o.kod)}
						<tr>
							<td style="width:52px"><ProfilObrazok kod={o.kod} nazov={o.nazov} /></td>
							<td class="c mono">{o.kod}</td>
							<td>{o.nazov}</td>
							<td class="c">
								<input
									name="qty_{o.kod}"
									type="number"
									step="1"
									value={(form && 'editVals' in form && form.editVals?.[o.kod]) || o.qty}
									aria-label="Počet tyčí {o.kod}"
									style="padding:6px 8px;font-size:14px;text-align:center;width:90px"
								/>
								<span style="margin-left:6px;color:var(--m-muted-ink);font-size:13px">ks</span>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<div style="height:12px" class="noprint"></div>
			<button class="btn noprint" type="submit" data-testid="odoslat-multi">
				{data.live
					? (form.multiVstup as { caka: boolean }).caka
						? '⏳ Odoslať odpis (odloží sa do NA ODPIS/Clip)'
						: '✅ Odoslať odpis do Money'
					: '🧪 Odoslať odpis (TEST priečinok)'}
			</button>
		</form>
		<button class="btn secondary noprint" onclick={() => window.print()}
			>🖨 Tlačiť / uložiť PDF</button
		>
		<form method="POST" action="?/upravitMulti" style="display:inline">
			{@render hiddenMulti()}
			<button class="btn secondary noprint" type="submit">← Späť a upraviť zadanie</button>
		</form>
	</div>
{:else if step === 'hotovo' && form && 'finalOut' in form && form.finalOut && form.outcome}
	<div class="card">
		<h1>Hotovo — {vstup.zak} · {vstup.zakaznik}</h1>
		<p class="sub">
			<span class="badge">CLIP · {popisTyp(vstup.typ)} · B{vstup.variant - 1}</span>
		</p>
	</div>

	<div class="okmsg" data-testid="vysledok">
		{#if !form.outcome.live}
			🧪 TEST — do Money NEJDE (testovací priečinok): <b>{form.outcome.filename}</b>
		{:else if vstup.caka}
			⏳ Odložené — čaká na materiál. Súbor <b>{form.outcome.filename}</b> je v NA ODPIS/Clip, presuň
			do dlv keď máš materiál.
		{:else}
			✅ Odoslané do Money na import: <b>{form.outcome.filename}</b>
		{/if}
	</div>

	<div class="card">
		<div class="sec">Money rozpis — {form.finalOut.filter((o) => o.qty > 0).length} položiek</div>
		{#each form.finalOut.filter((o) => o.qty > 0) as o (o.kod)}
			<div class="row" style="align-items:center;gap:12px">
				<ProfilObrazok kod={o.kod} nazov={o.nazov} />
				<span style="flex:1"
					><span class="mono">{o.kod}</span> · {o.nazov}{form.zmenene.includes(o.kod)
						? ' ✏️'
						: ''}</span
				>
				<b>{fmt(o.qty)} ks</b>
			</div>
		{/each}
	</div>

	<div class="card noprint">
		<button class="btn" onclick={() => window.print()}>🖨 Tlačiť / uložiť PDF</button>
		<a class="btn secondary" href={resolve('/clip')}>➕ Nový rozpis</a>
	</div>
{:else if step === 'hotovoMulti' && form && 'multi' in form && form.multi && form.outcome}
	{@const mv = form.multiVstup as { zak: string; zakaznik: string; caka: boolean }}
	<div class="card">
		<h1>Hotovo — {mv.zak} · {mv.zakaznik}</h1>
		<p class="sub">
			<span class="badge">CLIP multi · {form.multi.kusy.length} kusov</span>
		</p>
	</div>

	<div class="okmsg" data-testid="vysledok-multi">
		{#if !form.outcome.live}
			🧪 TEST — do Money NEJDE (testovací priečinok): <b>{form.outcome.filename}</b>
		{:else if mv.caka}
			⏳ Odložené — čaká na materiál. Súbor <b>{form.outcome.filename}</b> je v NA ODPIS/Clip, presuň
			do dlv keď máš materiál.
		{:else}
			✅ Odoslané do Money na import: <b>{form.outcome.filename}</b>
		{/if}
	</div>

	<div class="card">
		<div class="sec">
			Money rozpis — {form.multi.polozky.filter((o) => o.qty > 0).length} položiek (spolu)
		</div>
		{#each form.multi.polozky.filter((o) => o.qty > 0) as o (o.kod)}
			<div class="row" style="align-items:center;gap:12px">
				<ProfilObrazok kod={o.kod} nazov={o.nazov} />
				<span style="flex:1"
					><span class="mono">{o.kod}</span> · {o.nazov}{form.zmenene?.includes(o.kod)
						? ' ✏️'
						: ''}</span
				>
				<b>{fmt(o.qty)} ks</b>
			</div>
		{/each}
	</div>

	<div class="card noprint">
		<button class="btn" onclick={() => window.print()}>🖨 Tlačiť / uložiť PDF</button>
		<a class="btn secondary" href={resolve('/clip')}>➕ Nový rozpis</a>
	</div>
{:else if step === 'blocked' && form && 'rawEntries' in form && form.rawEntries}
	<OdpisBlok
		rawEntries={form.rawEntries}
		blokReason={form.blokReason}
		blokAction={form.blokAction}
		error={form.error ?? ''}
	/>
{:else if step === 'duplikat'}
	<div class="card">
		<h1>⛔ Duplikát</h1>
	</div>
	<div class="err" data-testid="duplikat">{form?.error}</div>
	<div class="card noprint">
		<a class="btn secondary" href={resolve('/clip')}>← Späť na formulár</a>
		<a class="btn secondary" href={resolve('/odpisy')}>📋 História odpisov</a>
	</div>
{/if}

<style>
	.hint {
		display: block;
		margin-top: 4px;
		/* #376 stage 3: WCAG-safe muted na zebra/hover riadkoch (viď app.css .hint) */
		color: var(--m-muted-ink);
		font-size: 12.5px;
	}
	tr.drobna td {
		color: var(--m-muted-ink);
	}
</style>
