<script lang="ts">
	import Nahlad2D from '$lib/components/Nahlad2D.svelte';
	import ProfilObrazok from '$lib/components/ProfilObrazok.svelte';

	let { data, form } = $props();

	const fmtM = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

	// predvyplnenie: po chybe/náhľade sa vraciame k odoslaným hodnotám
	let vstup = $derived(
		form?.vstup ?? {
			zak: '',
			op: '',
			zakaznik: '',
			system: 'Robust',
			styl: '2K',
			s: '' as unknown as number,
			v: '' as unknown as number,
			sklo: data.skla[0] ?? '',
			otvaranie: 'P - L',
			caka: false
		}
	);

	let system = $state('Robust');
	let styl = $state('2K');
	$effect(() => {
		system = form?.vstup?.system ?? 'Robust';
		styl = form?.vstup?.styl ?? '2K';
	});
	let stylyPre = $derived(data.styly.filter((x) => x.system === system).map((x) => x.styl));
	$effect(() => {
		if (!stylyPre.includes(styl)) styl = stylyPre[0];
	});

	let step = $derived(form?.step ?? 'form');
	let plan = $derived(form && 'plan' in form ? form.plan : null);
</script>

<svelte:head><title>Zasklenia — nárezový plán</title></svelte:head>

{#snippet hiddenVstup()}
	<input type="hidden" name="zak" value={vstup.zak} />
	<input type="hidden" name="op" value={vstup.op} />
	<input type="hidden" name="zakaznik" value={vstup.zakaznik} />
	<input type="hidden" name="system" value={vstup.system} />
	<input type="hidden" name="styl" value={vstup.styl} />
	<input type="hidden" name="s" value={vstup.s} />
	<input type="hidden" name="v" value={vstup.v} />
	<input type="hidden" name="sklo" value={vstup.sklo} />
	<input type="hidden" name="otvaranie" value={vstup.otvaranie} />
	{#if vstup.caka}<input type="hidden" name="caka" value="1" />{/if}
{/snippet}

{#snippet planKarty(p: NonNullable<typeof plan>)}
	<div class="card">
		<div class="sec">Rozmery</div>
		<div class="g">
			<div><span>Šírka</span><b>{p.S} mm</b></div>
			<div><span>Výška</span><b>{p.V} mm</b></div>
			<div><span>Plocha</span><b>{fmtM(p.m2)} m²</b></div>
		</div>
	</div>

	<div class="card">
		<div class="sec">Náhľad</div>
		<Nahlad2D S={p.S} V={p.V} N={p.N} skloS={p.sklo.sirka} skloV={p.sklo.vyska} otvaranie={vstup.otvaranie} />
	</div>

	<div class="card">
		<div class="sec">Sklo (mm)</div>
		<div class="g">
			<div><span>Šírka</span><b data-testid="sklo-sirka">{fmtM(p.sklo.sirka)}</b></div>
			<div><span>Výška</span><b data-testid="sklo-vyska">{fmtM(p.sklo.vyska)}</b></div>
			<div><span>Počet</span><b>{p.sklo.pocet} ks</b></div>
			<div><span>Typ</span><b style="font-size:13px">{vstup.sklo}</b></div>
		</div>
	</div>

	<div class="card">
		<div class="sec">Zoznam materiálu — profily</div>
		<table>
			<thead><tr><th></th><th>Profil</th><th>Kód</th><th>Rezy</th><th class="c">Tyče</th></tr></thead>
			<tbody>
				{#each p.material as m (m.kod)}
					<tr>
						<td style="width:52px"><ProfilObrazok kod={m.kod} nazov={m.nazov} /></td>
						<td>{m.nazov}</td>
						<td class="c">{m.kod}</td>
						<td>{m.rezy.filter((x) => x.ks > 0).map((x) => `${x.ks}×${x.rozmer} mm`).join(' + ') || '—'}</td>
						<td class="c"><b>{m.tyce}</b></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<div class="card">
		<div class="sec">Odpis (do Money)</div>
		{#each p.odpis.filter((o) => o.metre > 0) as o (o.kod)}
			<div class="row"><span>{o.kod} · {o.nazov}</span><b>{fmtM(o.metre)} m</b></div>
		{/each}
	</div>
{/snippet}

{#if step === 'form'}
	<div class="card">
		<h1>Zasklenia — nárezový plán</h1>
		<p class="sub">
			Zadaj rozmery, ukážem nárezový plán s náhľadom. Odpis sa do Money odošle až po tvojom
			potvrdení.
			{#if !data.live}<b>Bežíme v 🧪 TEST režime — do Money nejde nič.</b>{/if}
		</p>
	</div>

	{#if form?.error}
		<div class="err" data-testid="form-error">⚠️ {form.error}</div>
	{/if}

	<div class="card">
		<form method="POST" action="?/nahlad">
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
			<div class="grid2">
				<div class="field">
					<label for="system">Systém</label>
					<select id="system" name="system" bind:value={system}>
						{#each data.systemy as sys (sys)}<option>{sys}</option>{/each}
					</select>
				</div>
				<div class="field">
					<label for="styl">Štýl</label>
					<select id="styl" name="styl" bind:value={styl}>
						{#each stylyPre as st (st)}<option>{st}</option>{/each}
					</select>
				</div>
			</div>
			<div class="grid2">
				<div class="field">
					<label for="s">Šírka (mm) *</label>
					<input id="s" name="s" type="number" min="300" max="20000" step="any" value={vstup.s} required />
				</div>
				<div class="field">
					<label for="v">Výška (mm) *</label>
					<input id="v" name="v" type="number" min="300" max="20000" step="any" value={vstup.v} required />
				</div>
			</div>
			<div class="grid2">
				<div class="field">
					<label for="sklo">Sklo</label>
					<select id="sklo" name="sklo" value={vstup.sklo}>
						{#each data.skla as g (g)}<option>{g}</option>{/each}
					</select>
				</div>
				<div class="field">
					<label for="otvaranie">Otváranie</label>
					<select id="otvaranie" name="otvaranie" value={vstup.otvaranie}>
						{#each data.otvarania as o (o)}<option>{o}</option>{/each}
					</select>
				</div>
			</div>
			<div class="field">
				<label style="display:flex;align-items:center;gap:8px;font-weight:400">
					<input type="checkbox" name="caka" value="1" checked={vstup.caka} style="width:auto" />
					⏳ Čaká na materiál (odloží import do priečinka NA ODPIS)
				</label>
			</div>
			<button class="btn" type="submit">Spočítať nárezový plán</button>
		</form>
	</div>
{:else if step === 'nahlad' && plan}
	<div class="card">
		<h1>Nárezový plán — {vstup.zak} · {vstup.zakaznik}</h1>
		<p class="sub">
			<span class="badge">Zasklenia · {plan.system} {plan.styl} · {vstup.otvaranie}</span>
			{#if !data.live}<span class="badge test">🧪 TEST — do Money NEJDE</span>{/if}
		</p>
	</div>

	{#if form?.warn}
		<div class="warn" data-testid="plan-warn">⚠️ {form.warn}</div>
	{/if}

	{@render planKarty(plan)}

	<div class="card noprint">
		<form method="POST" action="?/odoslat">
			{@render hiddenVstup()}
			<input type="hidden" name="planHash" value={form?.planHash ?? ''} />
			<button class="btn" type="submit" data-testid="odoslat">
				{data.live
					? (vstup.caka ? '⏳ Odoslať odpis (odloží sa do NA ODPIS)' : '✅ Odoslať odpis do Money')
					: '🧪 Odoslať odpis (TEST priečinok)'}
			</button>
		</form>
		<a class="btn secondary" href="/zasklenia">← Späť a upraviť</a>
	</div>
{:else if step === 'hotovo' && plan && form?.outcome}
	<div class="card">
		<h1>Nárezový plán — {vstup.zak} · {vstup.zakaznik}</h1>
		<p class="sub">
			<span class="badge">Zasklenia · {plan.system} {plan.styl} · {vstup.otvaranie}</span>
		</p>
	</div>

	<div class="okmsg" data-testid="vysledok">
		{#if !form.outcome.live}
			🧪 TEST — do Money NEJDE (testovací priečinok): <b>{form.outcome.filename}</b>
		{:else if vstup.caka}
			⏳ Odložené — čaká na materiál. Súbor <b>{form.outcome.filename}</b> je v NA ODPIS, presuň do
			dlv keď máš materiál.
		{:else}
			✅ Odoslané do Money na import: <b>{form.outcome.filename}</b>
		{/if}
	</div>

	{@render planKarty(plan)}

	<div class="card noprint">
		<button class="btn" onclick={() => window.print()}>🖨 Tlačiť / uložiť PDF</button>
		<a class="btn secondary" href="/zasklenia">➕ Nový nárezový plán</a>
	</div>
{:else if step === 'duplikat'}
	<div class="card">
		<h1>⛔ Duplikát</h1>
	</div>
	<div class="err" data-testid="duplikat">{form?.error}</div>
	<div class="card noprint">
		<a class="btn secondary" href="/zasklenia">← Späť na formulár</a>
		<a class="btn secondary" href="/odpisy">📋 História odpisov</a>
	</div>
{/if}
