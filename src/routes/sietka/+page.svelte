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
	import type { SietkaMultiVstup } from '$lib/server/sietka-samostatna';
	import type { SietkaSamostatnaMultiOdpis } from '$lib/server/compute';

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
	// #448/#451 predodpisové skladové varovanie + odobrať — LEN interní (server pre b2b vráti [])
	let skladVarovania = $derived(form && 'skladVarovania' in form ? form.skladVarovania : null);
	let snapshotDatum = $derived(form && 'snapshotDatum' in form ? form.snapshotDatum : null);
	let potrebuje3K = $derived(form && 'potrebuje3K' in form ? form.potrebuje3K : false);
	let planHash = $derived(form && 'planHash' in form ? form.planHash : '');
	let cielInfo = $derived(form && 'cielInfo' in form ? form.cielInfo : null);
	// #461: vylúčené kódy z SkladVarovania — bindable, ide do hidden inputu vo formulári
	let vyluceneKody = $state('');
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

	// --- Multi režim (#473) — viac sieťok naraz v jednom odpise ---
	type KusRow = {
		system: string;
		styl: string;
		otvorS: number | '';
		otvorV: number | '';
		uchyt: SietkaUchyt;
	};

	function stylyPre(system: string): string[] {
		return data.styly.filter((s) => s.system === system).map((s) => s.styl);
	}

	// mode toggle — single vs multi
	let multiMode = $state(false);

	let mZak = $state('');
	let mOp = $state('');
	let mZakaznik = $state('');
	let mPoznamka = $state('');
	let kusy = $state<KusRow[]>([
		{ system: 'Robust', styl: '2K', otvorS: '', otvorV: '', uchyt: 'ziadny' }
	]);

	// multi vstup echovaný zo servera (po POST), alebo null pri prvom vstupe
	let multiVstup = $derived(
		form && 'multiVstup' in form && form.multiVstup ? (form.multiVstup as SietkaMultiVstup) : null
	);
	// výsledok multi výpočtu (kroky vysledokMulti/duplikatMulti/hotovoMulti)
	let multi = $derived(
		form && 'multi' in form && form.multi ? (form.multi as SietkaSamostatnaMultiOdpis) : null
	);

	// reactive: keď server vráti multiVstup, prepni do multi režimu a inicializuj stav
	$effect(() => {
		const mv = multiVstup;
		if (mv) {
			multiMode = true;
			mZak = mv.zak;
			mOp = mv.op;
			mZakaznik = mv.zakaznik;
			mPoznamka = mv.poznamka;
			kusy = mv.kusy.map((k) => ({
				system: k.system,
				styl: k.styl,
				otvorS: k.otvorS,
				otvorV: k.otvorV,
				uchyt: k.sietka.uchyt
			}));
		}
	});

	function addKus() {
		kusy.push({ system: 'Robust', styl: '2K', otvorS: '', otvorV: '', uchyt: 'ziadny' });
	}

	function removeKus(i: number) {
		if (kusy.length > 1) kusy.splice(i, 1);
	}

	// system sa zmenil pod rukami — ak aktuálny štýl riadku už nie je platný pre
	// nový systém, prepni na prvý dostupný (žiadny $effect nad celým poľom, len
	// jednorazová oprava priamo v onchange — nova-stranka #3 restart-effect pasca)
	function onSystemChange(kus: KusRow) {
		const opts = stylyPre(kus.system);
		if (!opts.includes(kus.styl)) kus.styl = opts[0] ?? '2K';
	}

	// JSON serializácia kusov pre hidden input
	let kusyJSON = $derived(
		JSON.stringify(
			kusy.map((k) => ({
				system: k.system,
				styl: k.styl,
				otvorS: k.otvorS,
				otvorV: k.otvorV,
				sietkaUchyt: k.uchyt
			}))
		)
	);

	// server-echo JSON pre výsledkovú (vysledokMulti) stránku — SSR HTML sa vykreslí
	// PRED tým, než klientský $effect (vyššie) stihne kusy naplníť z multiVstup, takže
	// kusyJSON by v tom okne niesol default jednoriadkový stav. hiddenMulti() preto
	// preferuje TENTO derived (priamo z form-echa), nikdy kusyJSON — inak by
	// pred-hydratačný klik na „Odoslať“/„Späť a upraviť“ poslal zlé/prázdne kusy
	// (review nález issue 473).
	let multiVstupKusyJSON = $derived(
		multiVstup
			? JSON.stringify(
					multiVstup.kusy.map((k) => ({
						system: k.system,
						styl: k.styl,
						otvorS: k.otvorS,
						otvorV: k.otvorV,
						sietkaUchyt: k.sietka.uchyt
					}))
				)
			: ''
	);
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

{#snippet hiddenMulti()}
	<input type="hidden" name="zak" value={multiVstup?.zak ?? mZak} />
	<input type="hidden" name="op" value={multiVstup?.op ?? mOp} />
	<input type="hidden" name="zakaznik" value={multiVstup?.zakaznik ?? mZakaznik} />
	<input type="hidden" name="poznamka" value={multiVstup?.poznamka ?? mPoznamka} />
	<input type="hidden" name="sietkaKusy" value={multiVstup ? multiVstupKusyJSON : kusyJSON} />
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
		<!-- #473: prepínač single / multi -->
		<div style="margin-top:8px">
			<label class="opt opt-grid">
				<input type="checkbox" bind:checked={multiMode} data-testid="sietka-multi-toggle" />
				Viac sieťok naraz (spoločný odpis)
			</label>
		</div>
	</div>

	{#if form?.error}
		<div class="err" data-testid="form-error">⚠️ {form.error}</div>
	{/if}

	{#if !multiMode}
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
	{:else}
		<!-- === MULTI režim (#473) === -->
		<div class="card">
			<form method="POST" action="?/vypocitatMulti">
				<div class="grid3">
					<div class="field">
						<label for="m-zak">Číslo objednávky (ZAK) *</label>
						<input id="m-zak" name="zak" bind:value={mZak} required />
					</div>
					<div class="field">
						<label for="m-op">OP/OPDL číslo *</label>
						<input id="m-op" name="op" bind:value={mOp} required />
					</div>
					<div class="field">
						<label for="m-zakaznik">Zákazník *</label>
						<input id="m-zakaznik" name="zakaznik" bind:value={mZakaznik} required />
					</div>
				</div>
				<div class="field">
					<label for="m-poznamka">Poznámka (viacriadková — ide aj do tlače)</label>
					<textarea
						id="m-poznamka"
						name="poznamka"
						rows="3"
						bind:value={mPoznamka}
						maxlength="300"
						style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;font-size:15px;font-family:inherit;resize:vertical"
					></textarea>
				</div>
				<input type="hidden" name="sietkaKusy" value={kusyJSON} />

				{#each kusy as kus, i (i)}
					<div
						class="card"
						style="margin:8px 0;padding:12px;border-left:3px solid var(--m-primary)"
					>
						<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
							<b>Sieťka {i + 1}</b>
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
								<label for="k{i}-system">Systém posuvu</label>
								<select
									id="k{i}-system"
									bind:value={kus.system}
									data-testid="k{i}-system"
									onchange={() => onSystemChange(kus)}
								>
									{#each systemy as sys (sys)}<option value={sys}>{sys}</option>{/each}
								</select>
							</div>
							<div class="field">
								<label for="k{i}-styl">Štýl (počet krídel posuvu)</label>
								<select id="k{i}-styl" bind:value={kus.styl} data-testid="k{i}-styl">
									{#each stylyPre(kus.system) as st (st)}<option value={st}>{st}</option>{/each}
								</select>
							</div>
							<div class="field">
								<label for="k{i}-uchyt">Úchyt (sieťka nemá kľučku)</label>
								<select id="k{i}-uchyt" bind:value={kus.uchyt} data-testid="k{i}-uchyt">
									{#each SIETKA_UCHYTY as u (u.value)}<option value={u.value}>{u.label}</option
										>{/each}
								</select>
							</div>
						</div>
						<div class="grid2">
							<div class="field">
								<label for="k{i}-otvorS">Šírka otvoru (mm) *</label>
								<input
									id="k{i}-otvorS"
									type="number"
									min="300"
									max="20000"
									step="any"
									bind:value={kus.otvorS}
									required
								/>
							</div>
							<div class="field">
								<label for="k{i}-otvorV">Výška otvoru (mm) *</label>
								<input
									id="k{i}-otvorV"
									type="number"
									min="300"
									max="20000"
									step="any"
									bind:value={kus.otvorV}
									required
								/>
							</div>
						</div>
					</div>
				{/each}

				<button type="button" class="btn secondary" onclick={addKus} data-testid="sietka-add-kus"
					>➕ Pridať sieťku</button
				>
				<button class="btn" type="submit" style="margin-left:8px">Spočítať</button>
			</form>
		</div>
	{/if}
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
		<!-- #448/#451: predodpisové skladové varovanie + odobrať (LEN interní) -->
		<SkladVarovania varovania={skladVarovania ?? undefined} {snapshotDatum} bind:vyluceneKody />
	{/if}

	<div class="card noprint">
		{#if step === 'vysledok'}
			<button class="btn" onclick={() => window.print()}>🖨 Tlačiť / uložiť PDF</button>
			{#if !isB2B}
				<form method="POST" action="?/odoslat" style="display:inline">
					{@render hidden()}
					<input type="hidden" name="planHash" value={planHash} />
					<input type="hidden" name="vylucene_kody" value={vyluceneKody} />
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
{:else if (step === 'vysledokMulti' || step === 'duplikatMulti') && multi && multiVstup}
	<div class="card">
		<h1>{multiVstup.op} · {multiVstup.zakaznik}</h1>
		<p class="sub">
			<span class="badge" data-testid="sietka-multi-badge"
				>Sieťka multi · {multi.kusy.length} kusov</span
			>
			<span class="badge">ZAK {multiVstup.zak}</span>
		</p>
	</div>

	{#if form && 'warn' in form && form.warn}
		<div class="err" data-testid="sietka-multi-warn">⚠️ {form.warn}</div>
	{/if}
	{#if step === 'duplikatMulti' && form?.error}
		<div class="err" data-testid="sietka-multi-duplikat">⚠️ {form.error}</div>
	{/if}

	{#each multi.kusy as kus, ki (ki)}
		{@const mv = multiVstup.kusy[ki]}
		<div class="card" data-testid="sietka-multi-kus-{ki}">
			<div class="sec">
				Sieťka {ki + 1}: {kus.system}
				{kus.styl}
			</div>
			<div class="g">
				<div><span>Šírka otvoru</span><b class="mono">{fmtM(mv?.otvorS ?? 0)} mm</b></div>
				<div><span>Výška otvoru</span><b class="mono">{fmtM(mv?.otvorV ?? 0)} mm</b></div>
				<div><span>Rámový profil</span><b class="mono">2 ks + 2 ks</b></div>
				<div><span>Nosový profil</span><b class="mono">1 ks</b></div>
				<div>
					<span>Rozmer sieťoviny (objednávka u dodávateľa)</span><b class="mono"
						>{fmtM(kus.rozmerSietoviny.sirka)} × {fmtM(kus.rozmerSietoviny.vyska)} mm</b
					>
				</div>
				<div><span>Úchyt</span><b>{uchytLabel(mv?.sietka.uchyt ?? 'ziadny')}</b></div>
			</div>
			{#if kus.potrebuje3K}
				<p class="sub warn-zaruka" data-testid="sietka-multi-2k-{ki}" style="margin:8px 0 0">
					⚠ 2K systém — appka {isB2B ? 'by odpísala' : 'odpíše'}
					<b>3K koľajnicu 2 ks + 2 ks</b> namiesto pôvodnej 2K.
				</p>
			{/if}
		</div>
	{/each}

	{#if !isB2B}
		<div class="card">
			<div class="sec">Spoločný odpis (do Money)</div>
			<table>
				<thead><tr><th>Kód</th><th>Názov</th><th class="c">Metre</th></tr></thead>
				<tbody>
					{#each multi.odpis as o (o.kod)}
						<tr>
							<td class="c mono">{o.kod}</td>
							<td>{o.nazov}</td>
							<td class="c mono"><b>{fmtM(o.metre)} m</b></td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	{#if step === 'vysledokMulti' && !isB2B && cielInfo}
		<div class="card">
			<div class="sec">Cieľ zápisu</div>
			<div class="g">
				<div><span>Režim</span><b>{cielInfo.live ? 'LIVE — ostrý Money import' : 'TEST'}</b></div>
				<div><span>Súbor</span><b style="font-size:12px">{cielInfo.filename}</b></div>
			</div>
		</div>
	{/if}

	{#if step === 'vysledokMulti' && !isB2B}
		<!-- #448/#451: predodpisové skladové varovanie + odobrať (LEN interní) -->
		<SkladVarovania varovania={skladVarovania ?? undefined} {snapshotDatum} bind:vyluceneKody />
	{/if}

	<div class="card noprint">
		{#if step === 'vysledokMulti'}
			<button class="btn" onclick={() => window.print()}>🖨 Tlačiť / uložiť PDF</button>
			{#if !isB2B}
				<form method="POST" action="?/odoslatMulti" style="display:inline">
					{@render hiddenMulti()}
					<input type="hidden" name="planHash" value={planHash} />
					<input type="hidden" name="vylucene_kody" value={vyluceneKody} />
					<button class="btn" type="submit" data-testid="odoslat-sietku-multi"
						>✅ Odoslať odpis do Money</button
					>
				</form>
			{/if}
		{/if}
		<form method="POST" action="?/upravitMulti" style="display:inline">
			{@render hiddenMulti()}
			<button class="btn secondary" type="submit">← Späť a upraviť</button>
		</form>
		<a class="btn secondary" href={resolve('/sietka')}>➕ Nová sieťka</a>
	</div>
{:else if step === 'hotovoMulti' && multi && multiVstup}
	<div class="card">
		<h1>✅ Odpis odoslaný</h1>
		<p class="sub">
			{multiVstup.op} · {multiVstup.zakaznik} · ZAK {multiVstup.zak} — sieťka multi ({multi.kusy
				.length} kusov)
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
