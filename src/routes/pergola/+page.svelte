<script lang="ts">
	import ProfilObrazok from '$lib/components/ProfilObrazok.svelte';
	import { resolve } from '$app/paths';

	let { data, form } = $props();

	const fmtM = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

	let vstup = $derived(form?.vstup ?? { zak: '', op: '', zakaznik: '', cad: '', caka: false });
	let step = $derived(form?.step ?? 'form');
	let v = $derived(form && 'v' in form ? form.v : null);

	let copyBtnText = $state('📋 Kopírovať počet tyčí');
	async function kopiruj() {
		const t = v?.cadLastCol ?? '';
		try {
			await navigator.clipboard.writeText(t);
			copyBtnText = '✓ Skopírované — vlož do Solid Edge';
		} catch {
			copyBtnText = 'Označ hodnoty a skopíruj ručne';
		}
	}
</script>

<svelte:head><title>Pergola — CAD → Money</title></svelte:head>

{#snippet hiddenVstup()}
	<input type="hidden" name="zak" value={vstup.zak} />
	<input type="hidden" name="op" value={vstup.op} />
	<input type="hidden" name="zakaznik" value={vstup.zakaznik} />
	<textarea name="cad" style="display:none">{vstup.cad}</textarea>
	{#if vstup.caka}<input type="hidden" name="caka" value="1" />{/if}
{/snippet}

{#snippet qtyRiadok(o: { kod: string; nazov: string; qty: number })}
	<div class="row" style="align-items:center;gap:12px">
		<ProfilObrazok kod={o.kod} nazov={o.nazov} />
		<span style="flex:1">{o.kod} · {o.nazov}</span>
		<!-- bez min/max — rozsahy stráži server (applyEdits), nech typo dostane
		     zrozumiteľnú chybu namiesto tichého browser tooltipu -->
		<input
			name="qty_{o.kod}"
			type="number"
			step="any"
			value={v?.editVals?.[o.kod] ?? (o.qty || '')}
			aria-label="Množstvo {o.kod}"
			style="width:110px;padding:6px 8px;font-size:14px;text-align:center"
		/>
		<span style="color:#64748b;font-size:13px">m</span>
	</div>
{/snippet}

{#snippet tyceKarta(withCopy: boolean)}
	{#if v}
		<div class="card">
			<div class="sec">Výstup pre Solid Edge — počet tyčí</div>
			{#each v.copyLines as l (l.code)}
				<div class="row"><span>{l.code} {l.name}</span><b>{l.barsStr}</b></div>
			{/each}
			{#if withCopy}
				<div style="height:12px"></div>
				<button class="btn" type="button" onclick={kopiruj} data-testid="kopiruj-tyce"
					>{copyBtnText}</button
				>
			{/if}
		</div>
	{/if}
{/snippet}

{#if step === 'form'}
	<div class="card">
		<h1>Pergola — CAD nárez → Money</h1>
		<p class="sub">
			Vlož CAD nárez (riadky: KÓD NÁZOV KS REZ), ukážem Money rozpis a počty tyčí pre Solid Edge.
			Odpis sa odošle až po tvojom potvrdení.
			{#if !data.live}<b>Bežíme v 🧪 TEST režime — do Money nejde nič.</b>{/if}
		</p>
		<p class="sub">
			📐 Potrebuješ zákaznícky návrhový výkres namiesto Money odpisu?
			<a href={resolve('/pergola/navrh')} data-testid="link-navrh">→ Návrhový výkres</a>
		</p>
		<p class="sub">
			🧮 Rezervačný odpis: rezervuj materiál v Money z rozmerov (bez CAD-u) už pri zadaní objednávky
			— len potvrdené vzorce, odpis až po potvrdení
			<a href={resolve('/pergola/narez')} data-testid="link-narez">→ Rezervačný odpis</a>
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
			<div class="field">
				<label for="cad">Materiál (CAD nárez) *</label>
				<textarea
					id="cad"
					name="cad"
					rows="10"
					required
					placeholder="18004 PRIECKOVY PROFIL 105&#9;9&#9;3871"
					style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;font-size:13px;font-family:ui-monospace,monospace"
					>{vstup.cad}</textarea
				>
			</div>
			<div class="field">
				<label style="display:flex;align-items:center;gap:8px;font-weight:400">
					<input type="checkbox" name="caka" value="1" checked={vstup.caka} style="width:auto" />
					⏳ Čaká na materiál (odloží import do priečinka NA ODPIS/Pergola)
				</label>
			</div>
			<button class="btn" type="submit">Spočítať rozpis</button>
		</form>
	</div>
{:else if step === 'nahlad' && v}
	<div class="card">
		<h1>Náhľad — {vstup.zak} · {vstup.zakaznik}</h1>
		<p class="sub">
			<span class="badge">Pergola · {v.totalBars} tyčí</span>
			{#if !data.live}<span class="badge test">🧪 TEST — do Money NEJDE</span>{/if}
		</p>
	</div>

	{#if form?.error}
		<div class="err" data-testid="nahlad-error">⚠️ {form.error}</div>
	{/if}

	{#if v.longNotes.length}
		<div class="warn">
			<b>⚠ Dlhé profily (rez &gt; 7500 mm)</b> — riešené kombináciou tyčí. Pri <b>žľabe</b> over, že spoj
			vyjde nad nohu pergoly.
		</div>
	{/if}

	<div class="card">
		<form method="POST" action="?/odoslat">
			{@render hiddenVstup()}

			{#if v.kombinacie.length}
				<div class="sec noprint">Výber kombinácií tyčí (podľa polohy nohy)</div>
				{#each v.kombinacie as k (k.idx)}
					<div class="field noprint">
						<label for="combo_{k.idx}">{k.fieldLabel}</label>
						{#each k.options as opt (opt)}
							<label style="display:flex;align-items:center;gap:8px;font-weight:400;margin:4px 0">
								<input
									type="radio"
									name="combo_{k.idx}"
									value={opt}
									checked={opt === k.selected}
									style="width:auto"
								/>
								{opt}
							</label>
						{/each}
					</div>
				{/each}
				<p class="sub noprint" style="margin-bottom:14px">
					Zmena voľby prepočíta Money rozpis aj počty tyčí pri odoslaní.
				</p>
			{/if}

			<div class="sec">Money rozpis — {v.nonzero.length} položiek</div>
			<p class="sub noprint">
				Množstvá môžeš pred odoslaním upraviť — prázdne pole = spočítaná hodnota. Záporné a
				nečíselné sa odmietnu.
			</p>
			{#each v.nonzero as o (o.kod)}
				{@render qtyRiadok(o)}
			{/each}

			<details class="noprint" style="margin-top:10px">
				<summary style="cursor:pointer;font-size:13px;color:#475569">
					➕ Pridať položku, ktorá v náreze nebola ({v.nulove.length} nulových)
				</summary>
				<div style="margin-top:8px">
					{#each v.nulove as o (o.kod)}
						{@render qtyRiadok(o)}
					{/each}
				</div>
			</details>

			<div style="height:14px" class="noprint"></div>
			<button class="btn noprint" type="submit" data-testid="odoslat">
				{data.live
					? vstup.caka
						? '⏳ Odoslať odpis (odloží sa do NA ODPIS/Pergola)'
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

	{@render tyceKarta(false)}
{:else if step === 'hotovo' && v && form?.outcome}
	<div class="card">
		<h1>Hotovo — {vstup.zak} · {vstup.zakaznik}</h1>
		<p class="sub"><span class="badge">Pergola · {v.totalBars} tyčí</span></p>
	</div>

	<div class="okmsg" data-testid="vysledok">
		{#if !form.outcome.live}
			🧪 TEST — do Money NEJDE (testovací priečinok): <b>{form.outcome.filename}</b>
		{:else if vstup.caka}
			⏳ Odložené — čaká na materiál. Súbor <b>{form.outcome.filename}</b> je v NA ODPIS/Pergola, presuň
			do dlv keď máš materiál.
		{:else}
			✅ Odoslané do Money na import: <b>{form.outcome.filename}</b>
		{/if}
	</div>

	{#if v.longNotes.length}
		<div class="warn">
			<b>⚠ Dlhé profily</b> — pri žľabe over, že spoj vyjde nad nohu pergoly.
		</div>
	{/if}

	{@render tyceKarta(true)}

	<div class="card">
		<div class="sec">Money rozpis — {v.nonzero.length} položiek</div>
		{#each v.nonzero as o (o.kod)}
			<div class="row" style="align-items:center;gap:12px">
				<ProfilObrazok kod={o.kod} nazov={o.nazov} />
				<span style="flex:1">{o.kod} · {o.nazov}{v.zmenene.includes(o.kod) ? ' ✏️' : ''}</span>
				<b>{fmtM(o.qty)} m</b>
			</div>
		{/each}
		{#if v.zmenene.length}
			<p class="sub">✏️ = množstvo si upravil ručne pred odoslaním.</p>
		{/if}
		{#if v.nulove.some((o) => v.zmenene.includes(o.kod))}
			<p class="sub">
				Vynulované úpravou (v odpise nie sú):
				{v.nulove
					.filter((o) => v.zmenene.includes(o.kod))
					.map((o) => o.kod)
					.join(', ')}
			</p>
		{/if}
	</div>

	<div class="card noprint">
		<button class="btn secondary" onclick={() => window.print()}>🖨 Tlačiť / uložiť PDF</button>
		<a class="btn secondary" href={resolve('/pergola')}>➕ Nový rozpis</a>
	</div>
{:else if step === 'duplikat'}
	<div class="card">
		<h1>⛔ Duplikát</h1>
	</div>
	<div class="err" data-testid="duplikat">{form?.error}</div>
	<div class="card noprint">
		<a class="btn secondary" href={resolve('/pergola')}>← Späť na formulár</a>
		<a class="btn secondary" href={resolve('/odpisy')}>📋 História odpisov</a>
	</div>
{/if}
