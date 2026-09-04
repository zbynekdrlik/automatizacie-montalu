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
	// #448 predodpisové skladové varovanie (clip — b2b sa na túto route nedostane)
	let skladVarovania = $derived(form && 'skladVarovania' in form ? form.skladVarovania : null);
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

{#if step === 'form'}
	<div class="card">
		<h1>CLIP zábradlie — odpis materiálu do Money</h1>
		<p class="sub">
			Zadaj rozmer zábradlia a počet výplní, rozpis si skontroluješ a upravíš pred odoslaním.
			{#if !data.live}<b>Bežíme v 🧪 TEST režime — do Money nejde nič.</b>{/if}
		</p>
	</div>

	{#if form?.error}
		<div class="err" data-testid="form-error">⚠️ {form.error}</div>
	{/if}

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

	<!-- #448: predodpisové skladové varovanie pri odpise -->
	<SkladVarovania varovania={skladVarovania ?? undefined} />

	<div class="card">
		<form method="POST" action="?/odoslat">
			{@render hiddenVstup()}
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
								<!-- #376 stage 3: číslo+mj v .mono (konzistentne so susednými kódovými/číselnými
								     bunkami), poznámka .hint ostáva mimo mono (body font). -->
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
