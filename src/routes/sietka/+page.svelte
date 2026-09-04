<script lang="ts">
	// Dodatočná sieťka BEZ posuvu (#89 — Patrik: „90% si kúpi posuv a sieťku chce
	// až potom"). Zadám parametre otvoru → appka vypočíta rám 2 ks + 2 ks + nos 1 ks
	// (pri 2K aj 3K koľajnicu 2 ks + 2 ks) a rozmer sieťoviny (na objednávku u iného
	// dodávateľa). Interní používatelia môžu odpis odoslať do Money (KOREKCIA
	// 2026-08-02); b2b vidí len výpočet/tabuľku (existujúce pravidlo — bez zápisu).
	import { SIETKA_UCHYTY, uchytLabel, type SietkaUchyt } from '$lib/sietka';
	import OdpisBlok from '$lib/components/OdpisBlok.svelte';
	import SkladVarovania from '$lib/components/SkladVarovania.svelte';
	import { resolve } from '$app/paths';

	let { data, form } = $props();

	const isB2B = $derived(data.user?.role === 'b2b');
	const fmtM = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

	let step = $derived(form?.step ?? 'form');
	let vstup = $derived({
		zak: form?.vstup?.zak ?? '',
		op: form?.vstup?.op ?? '',
		zakaznik: form?.vstup?.zakaznik ?? '',
		system: form?.vstup?.system ?? 'Robust',
		styl: form?.vstup?.styl ?? '2K',
		otvorS: form?.vstup?.otvorS ?? 0,
		otvorV: form?.vstup?.otvorV ?? 0,
		sietka: form?.vstup?.sietka ?? { uchyt: 'ziadny' as SietkaUchyt },
		poznamka: form?.vstup?.poznamka ?? ''
	});
	let r = $derived(form && 'r' in form ? form.r : null);
	// #448 predodpisové skladové varovanie — LEN interní (server pre b2b vráti [])
	let skladVarovania = $derived(form && 'skladVarovania' in form ? form.skladVarovania : null);
	let potrebuje3K = $derived(form && 'potrebuje3K' in form ? form.potrebuje3K : false);
	let planHash = $derived(form && 'planHash' in form ? form.planHash : '');
	let cielInfo = $derived(form && 'cielInfo' in form ? form.cielInfo : null);
	let outcome = $derived(form && 'outcome' in form ? form.outcome : null);

	// všetky editovateľné polia sú $state (bind) — jednosmerné value={} by sa pri
	// re-renderi vymazali (rovnaká pasca ako v ostatných moduloch appky)
	let zakS = $state('');
	let opS = $state('');
	let zakaznikS = $state('');
	let systemS = $state('Robust');
	let stylS = $state('2K');
	let otvorSS = $state<number | string>('');
	let otvorVS = $state<number | string>('');
	let sietkaUchytS = $state<SietkaUchyt>('ziadny');
	let poznamkaS = $state('');
	$effect(() => {
		const v = form?.vstup ?? null;
		zakS = v?.zak ?? '';
		opS = v?.op ?? '';
		zakaznikS = v?.zakaznik ?? '';
		systemS = v?.system ?? 'Robust';
		stylS = v?.styl ?? '2K';
		otvorSS = v?.otvorS || '';
		otvorVS = v?.otvorV || '';
		sietkaUchytS = v?.sietka?.uchyt ?? 'ziadny';
		poznamkaS = v?.poznamka ?? '';
	});

	let systemy = $derived([...new Set(data.styly.map((s) => s.system))]);
	let styly = $derived(data.styly.filter((s) => s.system === systemS).map((s) => s.styl));
	$effect(() => {
		if (!styly.includes(stylS)) stylS = styly[0] ?? '2K';
	});
</script>

<svelte:head><title>Sieťka — dodatočná objednávka</title></svelte:head>

{#snippet hidden()}
	<input type="hidden" name="zak" value={vstup.zak} />
	<input type="hidden" name="op" value={vstup.op} />
	<input type="hidden" name="zakaznik" value={vstup.zakaznik} />
	<input type="hidden" name="system" value={vstup.system} />
	<input type="hidden" name="styl" value={vstup.styl} />
	<input type="hidden" name="otvorS" value={vstup.otvorS} />
	<input type="hidden" name="otvorV" value={vstup.otvorV} />
	<input type="hidden" name="sietkaUchyt" value={vstup.sietka.uchyt} />
	<input type="hidden" name="poznamka" value={vstup.poznamka} />
{/snippet}

{#if step === 'form'}
	<div class="card">
		<h1>Sieťka — dodatočná objednávka</h1>
		<p class="sub">
			Pre zákazku, ktorá <b>už má posuv namontovaný</b> a sieťku chce dodatočne (Patrik: „90% si
			kúpi posuv a sieťku chce až potom"). Zadaj rozmery otvoru a systém posuvu — appka vypočíta
			rámový profil, nosový profil (a pri 2K aj 3K koľajnicu) a rozmer sieťoviny na objednávku.
			{#if isB2B}
				<b>Do Money sa neposiela nič</b> — len výpočet/tlač.
			{:else}
				Interne sa dá výsledok aj <b>odoslať do Money</b>.
			{/if}
		</p>
	</div>

	{#if form?.error}
		<div class="err" data-testid="form-error">⚠️ {form.error}</div>
	{/if}

	<div class="card">
		<form method="POST" action="?/vypocitat">
			<div class="grid3">
				<div class="field">
					<label for="zak">Číslo objednávky (ZAK) *</label>
					<input id="zak" name="zak" bind:value={zakS} required />
				</div>
				<div class="field">
					<label for="op">OP/OPDL číslo *</label>
					<input id="op" name="op" bind:value={opS} required />
				</div>
				<div class="field">
					<label for="zakaznik">Zákazník *</label>
					<input id="zakaznik" name="zakaznik" bind:value={zakaznikS} required />
				</div>
			</div>
			<div class="grid2">
				<div class="field">
					<label for="system">Systém posuvu</label>
					<select id="system" name="system" bind:value={systemS}>
						{#each systemy as sys (sys)}<option value={sys}>{sys}</option>{/each}
					</select>
				</div>
				<div class="field">
					<label for="styl">Štýl (počet krídel posuvu)</label>
					<select id="styl" name="styl" bind:value={stylS}>
						{#each styly as st (st)}<option value={st}>{st}</option>{/each}
					</select>
				</div>
			</div>
			<div class="grid2">
				<div class="field">
					<label for="otvorS">Šírka otvoru (mm) *</label>
					<input
						id="otvorS"
						name="otvorS"
						type="number"
						min="300"
						max="20000"
						step="any"
						bind:value={otvorSS}
						required
					/>
				</div>
				<div class="field">
					<label for="otvorV">Výška otvoru (mm) *</label>
					<input
						id="otvorV"
						name="otvorV"
						type="number"
						min="300"
						max="20000"
						step="any"
						bind:value={otvorVS}
						required
					/>
				</div>
			</div>
			<div class="field">
				<label for="sietkaUchyt">Úchyt (sieťka nemá kľučku)</label>
				<select id="sietkaUchyt" name="sietkaUchyt" bind:value={sietkaUchytS}>
					{#each SIETKA_UCHYTY as u (u.value)}<option value={u.value}>{u.label}</option>{/each}
				</select>
			</div>
			<div class="field">
				<label for="poznamka">Poznámka (viacriadková — ide aj do tlače)</label>
				<textarea
					id="poznamka"
					name="poznamka"
					rows="3"
					bind:value={poznamkaS}
					maxlength="300"
					style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;font-size:15px;font-family:inherit;resize:vertical"
				></textarea>
			</div>
			<button class="btn" type="submit" data-testid="spocitat-sietku">Spočítať</button>
		</form>
	</div>
{:else if (step === 'vysledok' || step === 'duplikat') && r}
	<div class="card">
		<h1>{vstup.op} · {vstup.zakaznik}</h1>
		<p class="sub">
			<span class="badge" data-testid="sietka-samostatna-badge"
				>Sieťka · {vstup.system} {vstup.styl}</span
			>
			<span class="badge">ZAK {vstup.zak}</span>
		</p>
	</div>

	{#if form && 'warn' in form && form.warn}
		<div class="err" data-testid="sietka-samostatna-warn">⚠️ {form.warn}</div>
	{/if}
	{#if step === 'duplikat' && form?.error}
		<div class="err" data-testid="sietka-samostatna-duplikat">⚠️ {form.error}</div>
	{/if}

	<div class="card">
		<div class="sec">Otvor</div>
		<div class="g">
			<div><span>Šírka</span><b class="mono">{fmtM(vstup.otvorS)} mm</b></div>
			<div><span>Výška</span><b class="mono">{fmtM(vstup.otvorV)} mm</b></div>
			<div><span>Počet krídel posuvu</span><b class="mono">{r.N}</b></div>
		</div>
	</div>

	<div class="card" data-testid="sietka-samostatna-vysledok">
		<div class="sec">
			Sieťka — {isB2B ? 'do nárezáka, do Money odpisu nejde' : 'do Money odpisu'}
		</div>
		<div class="g">
			<div><span>Rámový profil</span><b class="mono" data-testid="ram-profil">2 ks + 2 ks</b></div>
			<div><span>Nosový profil</span><b class="mono" data-testid="nos-profil">1 ks</b></div>
			<div>
				<span>Rozmer sieťoviny (objednávka u dodávateľa)</span><b
					class="mono"
					data-testid="sietka-samostatna-rozmer"
					>{fmtM(r.rozmerSietoviny.sirka)} × {fmtM(r.rozmerSietoviny.vyska)} mm</b
				>
			</div>
			<div><span>Úchyt</span><b>{uchytLabel(vstup.sietka.uchyt)}</b></div>
		</div>
	</div>

	{#if !isB2B}
		<div class="card">
			<div class="sec">Odpis (do Money)</div>
			<table>
				<thead
					><tr><th>Kód</th><th>Názov</th><th class="c">Rezy</th><th class="c">Metre</th></tr></thead
				>
				<tbody>
					{#each r.material as m (m.kod)}
						<tr>
							<td class="c mono">{m.kod}</td>
							<td>{m.nazov}</td>
							<td class="mono">{m.rezy.map((x) => `${x.ks}×${x.rozmer} mm`).join(' + ')}</td>
							<td class="c mono"
								><b>{fmtM(r.odpis.find((o) => o.kod === m.kod)?.metre ?? 0)} m</b></td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	{#if potrebuje3K}
		<div class="card warn-zaruka" data-testid="sietka-2k-tabulka">
			<div class="sec">⚠ Pozor — 2K systém</div>
			<p class="sub" style="margin:0">
				Pri 2K systéme je potrebné <b>dokúpiť koľajnicu 3K</b> — appka
				{isB2B ? 'by odpísala' : 'odpíše'}
				<b>3K koľajnicu 2 ks + 2 ks</b> namiesto pôvodnej 2K.
			</p>
		</div>
	{/if}

	{#if step === 'vysledok' && !isB2B && cielInfo}
		<div class="card">
			<div class="sec">Cieľ zápisu</div>
			<div class="g">
				<div><span>Režim</span><b>{cielInfo.live ? 'LIVE — ostrý Money import' : 'TEST'}</b></div>
				<div><span>Súbor</span><b style="font-size:12px">{cielInfo.filename}</b></div>
			</div>
		</div>
	{/if}

	{#if step === 'vysledok' && !isB2B}
		<!-- #448: predodpisové skladové varovanie pri odpise (LEN interní) -->
		<SkladVarovania varovania={skladVarovania ?? undefined} />
	{/if}

	<div class="card noprint">
		{#if step === 'vysledok'}
			<button class="btn" onclick={() => window.print()}>🖨 Tlačiť / uložiť PDF</button>
			{#if !isB2B}
				<form method="POST" action="?/odoslat" style="display:inline">
					{@render hidden()}
					<input type="hidden" name="planHash" value={planHash} />
					<button class="btn" type="submit" data-testid="odoslat-sietku"
						>✅ Odoslať odpis do Money</button
					>
				</form>
			{/if}
		{/if}
		<form method="POST" action="?/upravit" style="display:inline">
			{@render hidden()}
			<button class="btn secondary" type="submit">← Späť a upraviť</button>
		</form>
		<a class="btn secondary" href={resolve('/sietka')}>➕ Nová sieťka</a>
	</div>
{:else if step === 'hotovo' && r}
	<div class="card">
		<h1>✅ Odpis odoslaný</h1>
		<p class="sub">
			{vstup.op} · {vstup.zakaznik} · ZAK {vstup.zak} — sieťka {vstup.system}
			{vstup.styl}
		</p>
		{#if outcome}
			<div class="g">
				<div><span>Cieľ</span><b style="font-size:12px">{outcome.target}</b></div>
				<div><span>Režim</span><b>{outcome.live ? 'LIVE' : 'TEST'}</b></div>
			</div>
		{/if}
	</div>
	<div class="card noprint">
		<a class="btn secondary" href={resolve('/sietka')}>➕ Nová sieťka</a>
	</div>
{:else if step === 'blocked' && form && 'rawEntries' in form && form.rawEntries}
	<OdpisBlok
		rawEntries={form.rawEntries}
		blokReason={form.blokReason}
		blokAction={form.blokAction}
		error={form.error ?? ''}
	/>
{/if}
