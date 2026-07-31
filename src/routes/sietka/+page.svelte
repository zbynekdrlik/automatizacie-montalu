<script lang="ts">
	// Dodatočná sieťka BEZ posuvu (#89 — Patrik: „90% si kúpi posuv a sieťku chce
	// až potom"). Zadám parametre otvoru → appka vypľuje rámový profil 2 ks + 2 ks
	// a rozmer sieťky (na tlač). Do Money sa neposiela nič — modul len počíta/kreslí.
	import { SIETKA_UCHYTY, uchytLabel, type SietkaUchyt } from '$lib/sietka';
	import { resolve } from '$app/paths';

	let { data, form } = $props();

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
		sietka: form?.vstup?.sietka ?? { sirka: null, vyska: null, uchyt: 'ziadny' as SietkaUchyt },
		poznamka: form?.vstup?.poznamka ?? ''
	});
	let N = $derived(form && 'N' in form ? form.N : 0);
	let potrebuje3K = $derived(form && 'potrebuje3K' in form ? form.potrebuje3K : false);

	// všetky editovateľné polia sú $state (bind) — jednosmerné value={} by sa pri
	// re-renderi vymazali (rovnaká pasca ako v ostatných moduloch appky)
	let zakS = $state('');
	let opS = $state('');
	let zakaznikS = $state('');
	let systemS = $state('Robust');
	let stylS = $state('2K');
	let otvorSS = $state<number | string>('');
	let otvorVS = $state<number | string>('');
	let sietkaSirkaS = $state<number | string>('');
	let sietkaVyskaS = $state<number | string>('');
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
		sietkaSirkaS = v?.sietka?.sirka ?? '';
		sietkaVyskaS = v?.sietka?.vyska ?? '';
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
	{#if vstup.sietka.sirka}<input type="hidden" name="sietkaSirka" value={vstup.sietka.sirka} />{/if}
	{#if vstup.sietka.vyska}<input type="hidden" name="sietkaVyska" value={vstup.sietka.vyska} />{/if}
	<input type="hidden" name="sietkaUchyt" value={vstup.sietka.uchyt} />
	<input type="hidden" name="poznamka" value={vstup.poznamka} />
{/snippet}

{#if step === 'form'}
	<div class="card">
		<h1>Sieťka — dodatočná objednávka</h1>
		<p class="sub">
			Pre zákazku, ktorá <b>už má posuv namontovaný</b> a sieťku chce dodatočne (Patrik: „90% si
			kúpi posuv a sieťku chce až potom"). Zadaj rozmery otvoru a systém posuvu — appka vypíše
			rámový profil na nárezák a rozmer sieťky na tlač.
			<b>Do Money sa neposiela nič</b> — presné kódy/kusy sieťky ešte čakajú na potvrdenie.
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
			<p class="sub">
				Rozmer sieťky <b>nie je</b> rozmer otvoru — ak ho dielňa už pozná, zadaj ho; inak necháme na dielňu
				pri montáži.
			</p>
			<div class="grid2">
				<div class="field">
					<label for="sietkaSirka">Sieťka — šírka (mm)</label>
					<input
						id="sietkaSirka"
						name="sietkaSirka"
						type="number"
						min="1"
						max="20000"
						step="any"
						bind:value={sietkaSirkaS}
					/>
				</div>
				<div class="field">
					<label for="sietkaVyska">Sieťka — výška (mm)</label>
					<input
						id="sietkaVyska"
						name="sietkaVyska"
						type="number"
						min="1"
						max="20000"
						step="any"
						bind:value={sietkaVyskaS}
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
{:else if step === 'vysledok'}
	<div class="card">
		<h1>{vstup.op} · {vstup.zakaznik}</h1>
		<p class="sub">
			<span class="badge" data-testid="sietka-samostatna-badge"
				>Sieťka · {vstup.system} {vstup.styl}</span
			>
			<span class="badge">ZAK {vstup.zak}</span>
		</p>
	</div>

	<div class="card">
		<div class="sec">Otvor</div>
		<div class="g">
			<div><span>Šírka</span><b>{fmtM(vstup.otvorS)} mm</b></div>
			<div><span>Výška</span><b>{fmtM(vstup.otvorV)} mm</b></div>
			<div><span>Počet krídel posuvu</span><b>{N}</b></div>
		</div>
	</div>

	<div class="card" data-testid="sietka-samostatna-vysledok">
		<div class="sec">Sieťka — do nárezáka, do Money odpisu zatiaľ nejde</div>
		<div class="g">
			<div><span>Rámový profil</span><b data-testid="ram-profil">2 ks + 2 ks</b></div>
			<div>
				<span>Rozmer sieťky</span><b data-testid="sietka-samostatna-rozmer"
					>{vstup.sietka.sirka && vstup.sietka.vyska
						? `${fmtM(vstup.sietka.sirka)} × ${fmtM(vstup.sietka.vyska)} mm`
						: 'doplní dielňa'}</b
				>
			</div>
			<div><span>Úchyt</span><b>{uchytLabel(vstup.sietka.uchyt)}</b></div>
		</div>
	</div>

	{#if potrebuje3K}
		<div class="card warn-zaruka" data-testid="sietka-2k-tabulka">
			<div class="sec">⚠ Pozor — 2K systém</div>
			<p class="sub" style="margin:0">
				Pri 2K systéme je potrebné <b>dokúpiť koľajnicu 3K</b> — do nárezáka pridať koľaj
				<b>3K 2 ks + 2 ks</b> namiesto pôvodnej 2K. Toto je len upozornenie pre dielňu — Money odpis sa
				touto stránkou NEMENÍ (nič sa neodpisuje).
			</p>
		</div>
	{/if}

	{#if vstup.poznamka}
		<div class="card" data-testid="sietka-samostatna-poznamka">
			<div class="row">
				<span>Poznámka</span><b style="white-space:pre-wrap">{vstup.poznamka}</b>
			</div>
		</div>
	{/if}

	<div class="card noprint">
		<button class="btn" onclick={() => window.print()}>🖨 Tlačiť / uložiť PDF</button>
		<form method="POST" action="?/upravit" style="display:inline">
			{@render hidden()}
			<button class="btn secondary" type="submit">← Späť a upraviť</button>
		</form>
		<a class="btn secondary" href={resolve('/sietka')}>➕ Nová sieťka</a>
	</div>
{/if}
