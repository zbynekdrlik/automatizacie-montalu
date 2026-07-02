<script lang="ts">
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

{#snippet tyceKarta(withCopy: boolean)}
	{#if v}
		<div class="card">
			<div class="sec">Výstup pre Solid Edge — počet tyčí</div>
			{#each v.copyLines as l (l.code)}
				<div class="row"><span>{l.code} {l.name}</span><b>{l.barsStr}</b></div>
			{/each}
			{#if withCopy}
				<div style="height:12px"></div>
				<button class="btn" type="button" onclick={kopiruj} data-testid="kopiruj-tyce">{copyBtnText}</button>
			{/if}
		</div>
	{/if}
{/snippet}

{#if step === 'form'}
	<div class="card">
		<h1>Pergola — CAD nárez → Money</h1>
		<p class="sub">
			Vlož CAD nárez (riadky: KÓD NÁZOV KS REZ), ukážem Money rozpis a počty tyčí pre Solid
			Edge. Odpis sa odošle až po tvojom potvrdení.
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
			<div class="field">
				<label for="cad">Materiál (CAD nárez) *</label>
				<textarea
					id="cad"
					name="cad"
					rows="10"
					required
					placeholder="18004 PRIECKOVY PROFIL 105&#9;9&#9;3871"
					style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;font-size:13px;font-family:ui-monospace,monospace">{vstup.cad}</textarea>
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
			<b>⚠ Dlhé profily (rez &gt; 7500 mm)</b> — riešené kombináciou tyčí. Pri <b>žľabe</b> over,
			že spoj vyjde nad nohu pergoly.
		</div>
	{/if}

	<div class="card">
		<form method="POST" action="?/odoslat">
			{@render hiddenVstup()}

			{#if v.kombinacie.length}
				<div class="sec">Výber kombinácií tyčí (podľa polohy nohy)</div>
				{#each v.kombinacie as k (k.idx)}
					<div class="field">
						<label for="combo_{k.idx}">{k.fieldLabel}</label>
						{#each k.options as opt (opt)}
							<label style="display:flex;align-items:center;gap:8px;font-weight:400;margin:4px 0">
								<input type="radio" name="combo_{k.idx}" value={opt} checked={opt === k.selected} style="width:auto" />
								{opt}
							</label>
						{/each}
					</div>
				{/each}
				<p class="sub" style="margin-bottom:14px">Zmena voľby prepočíta Money rozpis aj počty tyčí pri odoslaní.</p>
			{/if}

			<div class="sec">Money rozpis — {v.nonzero.length} položiek</div>
			{#each v.nonzero as o (o.kod)}
				<div class="row"><span>{o.kod} · {o.nazov}</span><b>{fmtM(o.qty)} m</b></div>
			{/each}

			<div style="height:14px"></div>
			<button class="btn" type="submit" data-testid="odoslat">
				{data.live
					? (vstup.caka ? '⏳ Odoslať odpis (odloží sa do NA ODPIS/Pergola)' : '✅ Odoslať odpis do Money')
					: '🧪 Odoslať odpis (TEST priečinok)'}
			</button>
		</form>
		<a class="btn secondary" href="/pergola">← Späť a upraviť zadanie</a>
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
			⏳ Odložené — čaká na materiál. Súbor <b>{form.outcome.filename}</b> je v NA ODPIS/Pergola,
			presuň do dlv keď máš materiál.
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
			<div class="row"><span>{o.kod} · {o.nazov}</span><b>{fmtM(o.qty)} m</b></div>
		{/each}
	</div>

	<div class="card noprint">
		<button class="btn secondary" onclick={() => window.print()}>🖨 Tlačiť / uložiť PDF</button>
		<a class="btn secondary" href="/pergola">➕ Nový rozpis</a>
	</div>
{:else if step === 'duplikat'}
	<div class="card">
		<h1>⛔ Duplikát</h1>
	</div>
	<div class="err" data-testid="duplikat">{form?.error}</div>
	<div class="card noprint">
		<a class="btn secondary" href="/pergola">← Späť na formulár</a>
		<a class="btn secondary" href="/odpisy">📋 História odpisov</a>
	</div>
{/if}
