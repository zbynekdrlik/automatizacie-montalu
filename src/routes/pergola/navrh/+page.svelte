<script lang="ts">
	// Pergola — zákaznícky NÁVRHOVÝ výkres (#138) — rozmerový formulár → SVG výkres
	// (vzor OP260032) → tlač. Do Money NIČ nezapisuje (existujúci `/pergola` CAD→Money
	// odpis sa touto stránkou nedotýka). Rovnaký vzor ako `/fix`: formulár → výkres →
	// tlač, žiadny zápisový krok.
	import PergolaNavrhVykres from '$lib/components/PergolaNavrhVykres.svelte';
	import PergolaModeNav from '$lib/components/PergolaModeNav.svelte';
	import { formatDatumCasSk } from '$lib/datum';
	import { resolve } from '$app/paths';
	import {
		stlpyZPolí,
		ROZPATIE_MIN,
		ROZPATIE_MAX,
		HLBKA_MIN,
		HLBKA_MAX,
		VYSKA_MIN,
		VYSKA_MAX,
		NAVRH_SKLON_MAX,
		PANEL_POCET_MIN,
		PANEL_POCET_MAX,
		PERGOLA_MAX_POLI,
		PERGOLA_REZIM_DEFAULT,
		RAL_PALETA,
		RAL_INY_KOD,
		RAL_FALLBACK_HEX,
		type ZvodStrana,
		type PergolaNavrhVstup,
		type PergolaVykresRezim
	} from '$lib/pergola-navrh';

	let { data, form } = $props();

	const fmt = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');
	const cislo = (x: number | string) => (typeof x === 'number' ? x : parseFloat(String(x)) || 0);

	let step = $derived(form?.step ?? 'form');

	let vstup = $derived({
		polia: (form?.vstup?.polia ?? [3000, 3000]) as number[],
		hlbka: form?.vstup?.hlbka ?? 3500,
		vyskaVpredu: form?.vstup?.vyskaVpredu ?? 2500,
		vyskaPriStene: form?.vstup?.vyskaPriStene ?? 2800,
		// #382 — voliteľný manuálny sklon (rovnaký zdroj pravdy ako /narez)
		sklonStrechy: form?.vstup?.sklonStrechy,
		panelPocet: form?.vstup?.panelPocet ?? 8,
		panelSirkaOverride: form?.vstup?.panelSirkaOverride,
		panelDlzkaOverride: form?.vstup?.panelDlzkaOverride,
		zvody: (form?.vstup?.zvody ?? []) as { postIndex: number; strana: ZvodStrana }[],
		ral: form?.vstup?.ral ?? '',
		textVyplne: form?.vstup?.textVyplne ?? '',
		poznamkaIzometria: form?.vstup?.poznamkaIzometria ?? 'bez výplne',
		op: form?.vstup?.op ?? '',
		nazov: form?.vstup?.nazov ?? '',
		revizia: form?.vstup?.revizia ?? '',
		varianta: form?.vstup?.varianta ?? 'NAVRH',
		vypracoval: form?.vstup?.vypracoval ?? data.user?.username ?? '',
		rezimVykresu: (form?.vstup?.rezimVykresu ?? PERGOLA_REZIM_DEFAULT) as PergolaVykresRezim,
		ralKod: form?.vstup?.ralKod ?? ''
	} satisfies PergolaNavrhVstup);

	// editovateľné polia sú $state (bind) — jednosmerné value={} by sa pri re-renderi
	// vymazali (rovnaká pasca ako v ostatných moduloch appky)
	let poliaS = $state<(number | string)[]>([3000, 3000]);
	let hlbkaS = $state<number | string>(3500);
	let vyskaVpreduS = $state<number | string>(2500);
	let vyskaPriSteneS = $state<number | string>(2800);
	// #382 — prázdny reťazec = nezadané (rovnaký idiom ako panelSirkaOverrideS nižšie)
	let sklonStrechyS = $state<number | string>('');
	let panelPocetS = $state<number | string>(8);
	let panelSirkaOverrideS = $state<number | string>('');
	let panelDlzkaOverrideS = $state<number | string>('');
	let ralS = $state('');
	let textVyplneS = $state('');
	let poznamkaIzometriaS = $state('bez výplne');
	let opS = $state('');
	let nazovS = $state('');
	let reviziaS = $state('');
	let variantaS = $state('NAVRH');
	let vypracovalS = $state('');
	/** kľúč `${postIndex}-${strana}` → zaškrtnuté */
	let zvodyS = $state<Record<string, boolean>>({});
	// #150: farebný režim + RAL ako výber (nie voľný text)
	let rezimVykresuS = $state<PergolaVykresRezim>(PERGOLA_REZIM_DEFAULT);
	let ralKodS = $state('');

	$effect(() => {
		const v = form?.vstup ?? null;
		poliaS = (v?.polia?.length ? v.polia : [3000, 3000]).map((x: number) => x);
		hlbkaS = v?.hlbka || 3500;
		vyskaVpreduS = v?.vyskaVpredu || 2500;
		vyskaPriSteneS = v?.vyskaPriStene || 2800;
		sklonStrechyS = v?.sklonStrechy ?? '';
		panelPocetS = v?.panelPocet || 8;
		panelSirkaOverrideS = v?.panelSirkaOverride || '';
		panelDlzkaOverrideS = v?.panelDlzkaOverride || '';
		ralS = v?.ral ?? '';
		textVyplneS = v?.textVyplne ?? '';
		poznamkaIzometriaS = v?.poznamkaIzometria ?? 'bez výplne';
		opS = v?.op ?? '';
		nazovS = v?.nazov ?? '';
		reviziaS = v?.revizia ?? '';
		variantaS = v?.varianta ?? 'NAVRH';
		vypracovalS = v?.vypracoval ?? data.user?.username ?? '';
		const zv: Record<string, boolean> = {};
		for (const z of v?.zvody ?? []) zv[`${z.postIndex}-${z.strana}`] = true;
		zvodyS = zv;
		rezimVykresuS = v?.rezimVykresu === 'farebny' ? 'farebny' : PERGOLA_REZIM_DEFAULT;
		ralKodS = v?.ralKod ?? '';
	});

	let poliaNum = $derived(poliaS.map(cislo));
	let postX = $derived(stlpyZPolí(poliaNum));
	let celkovaSirka = $derived(postX[postX.length - 1] ?? 0);

	function nastavPocetPoli(n: number) {
		const k = Math.max(1, Math.min(PERGOLA_MAX_POLI, n));
		const noveDlzky = Array.from({ length: k }, (_, i) => poliaS[i] ?? 3000);
		poliaS = noveDlzky;
		// zníženie počtu polí zruší niektoré stĺpy — zaškrtnuté zvody na zaniknutých
		// stĺpoch by inak zostali v stave (checkbox už nie je v UI vidno, ale server
		// by ich pri odoslaní odmietol ako "Neplatná pozícia zvodu", bez zjavnej
		// príčiny pre operátora) — zahodíme ich hneď pri zmene počtu polí (#138 review)
		const novyPocetStlpov = k + 1;
		const orezane: Record<string, boolean> = {};
		for (const [key, checked] of Object.entries(zvodyS)) {
			const idx = Number(key.split('-')[0]);
			if (idx < novyPocetStlpov) orezane[key] = checked;
		}
		zvodyS = orezane;
	}

	function zvodyJSON(): string {
		const out: { postIndex: number; strana: ZvodStrana }[] = [];
		for (const [k, checked] of Object.entries(zvodyS)) {
			if (!checked) continue;
			const [idx, strana] = k.split('-');
			out.push({ postIndex: Number(idx), strana: strana as ZvodStrana });
		}
		return JSON.stringify(out);
	}
</script>

<svelte:head><title>Pergola — návrhový výkres</title></svelte:head>

{#snippet hidden()}
	<input type="hidden" name="polia" value={JSON.stringify(poliaS.map(cislo))} />
	<input type="hidden" name="hlbka" value={cislo(hlbkaS)} />
	<input type="hidden" name="vyskaVpredu" value={cislo(vyskaVpreduS)} />
	<input type="hidden" name="vyskaPriStene" value={cislo(vyskaPriSteneS)} />
	{#if sklonStrechyS !== ''}<input
			type="hidden"
			name="sklonStrechy"
			value={cislo(sklonStrechyS)}
		/>{/if}
	<input type="hidden" name="panelPocet" value={cislo(panelPocetS)} />
	{#if panelSirkaOverrideS !== ''}<input
			type="hidden"
			name="panelSirkaOverride"
			value={cislo(panelSirkaOverrideS)}
		/>{/if}
	{#if panelDlzkaOverrideS !== ''}<input
			type="hidden"
			name="panelDlzkaOverride"
			value={cislo(panelDlzkaOverrideS)}
		/>{/if}
	<input type="hidden" name="zvody" value={zvodyJSON()} />
	<input type="hidden" name="ral" value={ralS} />
	<input type="hidden" name="rezimVykresu" value={rezimVykresuS} />
	<input type="hidden" name="ralKod" value={ralKodS} />
	<input type="hidden" name="textVyplne" value={textVyplneS} />
	<input type="hidden" name="poznamkaIzometria" value={poznamkaIzometriaS} />
	<input type="hidden" name="op" value={opS} />
	<input type="hidden" name="nazov" value={nazovS} />
	<input type="hidden" name="revizia" value={reviziaS} />
	<input type="hidden" name="varianta" value={variantaS} />
	<input type="hidden" name="vypracoval" value={vypracovalS} />
{/snippet}

{#if step === 'form'}
	<div class="card">
		<PergolaModeNav active="navrh" />
	</div>
	<div class="card">
		<h1>Pergola — návrhový výkres</h1>
		<p class="sub" style="margin-top:6px">
			<span class="badge">bez Money</span>
		</p>
		<p class="sub">
			Zadaj rozmery — vykreslím zákaznícky výkres podľa vzoru OP260032 (predný pohľad, bočný rez,
			detail výplne, 3D izometria). Tento modul len kreslí, do Money nejde nič. Money odpis z CAD
			nárezu je na <a href={resolve('/pergola')}>pôvodnej stránke Pergola</a>.
		</p>
	</div>

	{#if form?.error}
		<div class="err" data-testid="form-error">⚠️ {form.error}</div>
	{/if}

	<div class="card">
		<form method="POST" action="?/vykres">
			<div class="grid3">
				<div class="field">
					<!-- #144: OP číslo je VOLITEĽNÉ — VO odberateľ (b2b) nemá Montalu OP číslo,
					     prázdne sa v pečiatke vykreslí ako „—" -->
					<label for="op">OP číslo</label>
					<input id="op" name="op" bind:value={opS} maxlength="40" placeholder="napr. OP260032" />
				</div>
				<div class="field">
					<label for="nazov">Názov výkresu</label>
					<input
						id="nazov"
						name="nazov"
						bind:value={nazovS}
						maxlength="80"
						placeholder="napr. PERGOLA — NÁVRH"
					/>
				</div>
				<div class="field">
					<label for="revizia">Revízia</label>
					<input id="revizia" name="revizia" bind:value={reviziaS} maxlength="20" placeholder="1" />
				</div>
			</div>
			<div class="grid3">
				<div class="field">
					<label for="varianta">Varianta</label>
					<input id="varianta" name="varianta" bind:value={variantaS} maxlength="20" />
				</div>
				<div class="field">
					<label for="vypracoval">Vypracoval</label>
					<input id="vypracoval" name="vypracoval" bind:value={vypracovalS} maxlength="60" />
				</div>
				<div class="field">
					<label for="hlbka">Hĺbka (mm) *</label>
					<input
						id="hlbka"
						name="hlbka"
						type="number"
						min={HLBKA_MIN}
						max={HLBKA_MAX}
						step="any"
						bind:value={hlbkaS}
						required
					/>
				</div>
			</div>

			<div class="grid3">
				<div class="field">
					<label for="vyskaVpredu">Výška vpredu (mm) *</label>
					<input
						id="vyskaVpredu"
						name="vyskaVpredu"
						type="number"
						min={VYSKA_MIN}
						max={VYSKA_MAX}
						step="any"
						bind:value={vyskaVpreduS}
						required
					/>
				</div>
				<div class="field">
					<label for="vyskaPriStene">Výška pri stene (mm) *</label>
					<input
						id="vyskaPriStene"
						name="vyskaPriStene"
						type="number"
						min={VYSKA_MIN}
						max={VYSKA_MAX}
						step="any"
						bind:value={vyskaPriSteneS}
						required
					/>
				</div>
				<div class="field">
					<label for="pocetPoli">Počet polí (rozpätí medzi stĺpmi)</label>
					<select
						id="pocetPoli"
						value={poliaS.length}
						onchange={(e) => nastavPocetPoli(Number((e.currentTarget as HTMLSelectElement).value))}
					>
						{#each Array(PERGOLA_MAX_POLI) as _, i (i)}<option value={i + 1}>{i + 1}</option>{/each}
					</select>
				</div>
			</div>

			<!-- #382 — voliteľný manuálny sklon (z CAD, rovnaký zdroj pravdy ako /narez): keď je
			     zadaný, REZ A ho použije namiesto dopočítaného sklonu z výšok (viď design komentár
			     na #382 pre root cause). -->
			<div class="field">
				<label for="sklonStrechy">Sklon strechy (°) — z CAD (voliteľné)</label>
				<input
					id="sklonStrechy"
					name="sklonStrechy"
					type="number"
					min="0.1"
					max={NAVRH_SKLON_MAX}
					step="any"
					bind:value={sklonStrechyS}
					placeholder="prázdne = dopočíta sa orientačne z výšok (REZ A)"
				/>
			</div>

			<div class="polia-box" data-testid="polia-box">
				<div class="grid3">
					{#each poliaS as _, i (i)}
						<div class="field">
							<label for={`pole${i}`}>Rozpätie {i + 1} (mm)</label>
							<input
								id={`pole${i}`}
								type="number"
								min={ROZPATIE_MIN}
								max={ROZPATIE_MAX}
								step="any"
								bind:value={poliaS[i]}
							/>
						</div>
					{/each}
				</div>
				<p class="sub">Celková šírka: <b data-testid="celkova-sirka">{fmt(celkovaSirka)} mm</b></p>
			</div>

			<div class="grid3">
				<div class="field">
					<label for="panelPocet">Počet panelov strešnej výplne *</label>
					<input
						id="panelPocet"
						name="panelPocet"
						type="number"
						min={PANEL_POCET_MIN}
						max={PANEL_POCET_MAX}
						step="1"
						bind:value={panelPocetS}
						required
					/>
				</div>
				<div class="field">
					<label for="panelSirkaOverride">Šírka panelu (mm) — ručný prepis</label>
					<input
						id="panelSirkaOverride"
						type="number"
						step="any"
						bind:value={panelSirkaOverrideS}
						placeholder="dopočíta sa zo šírky/počtu"
					/>
				</div>
				<div class="field">
					<label for="panelDlzkaOverride">Dĺžka panelu (mm) — ručný prepis</label>
					<input
						id="panelDlzkaOverride"
						type="number"
						step="any"
						bind:value={panelDlzkaOverrideS}
						placeholder="dopočíta sa z hĺbky"
					/>
				</div>
			</div>

			<div class="field">
				<span style="font-weight:600;font-size:14px">Pozície zvodov (ZVOD šípky na izometrii)</span>
				<div class="polia-box" data-testid="zvody-box">
					{#each postX as px, i (i)}
						<div class="row" style="gap:18px">
							<span>Stĺp {i + 1} ({fmt(px)} mm)</span>
							<label style="display:flex;align-items:center;gap:6px;font-weight:400">
								<input
									type="checkbox"
									checked={zvodyS[`${i}-predna`] ?? false}
									onchange={(e) =>
										(zvodyS = {
											...zvodyS,
											[`${i}-predna`]: (e.currentTarget as HTMLInputElement).checked
										})}
									style="width:auto"
								/>
								vpredu
							</label>
							<label style="display:flex;align-items:center;gap:6px;font-weight:400">
								<input
									type="checkbox"
									checked={zvodyS[`${i}-zadna`] ?? false}
									onchange={(e) =>
										(zvodyS = {
											...zvodyS,
											[`${i}-zadna`]: (e.currentTarget as HTMLInputElement).checked
										})}
									style="width:auto"
								/>
								vzadu (pri stene)
							</label>
						</div>
					{/each}
				</div>
			</div>

			<!-- #150: režim výkresu (technický/farebný) + RAL ako riadený výber (dropdown +
			     ukážka odtieňa), "iný…" odomkne voľný text a povie, že sa použije neutrálna
			     tmavosivá (žiadny presný odtieň nie je pre neho známy) -->
			<div class="grid2">
				<div class="field">
					<span style="font-weight:600;font-size:14px">Režim výkresu</span>
					<div class="row" style="gap:18px;margin-top:4px">
						<label style="display:flex;align-items:center;gap:6px;font-weight:400">
							<input
								type="radio"
								name="pn-rezim"
								checked={rezimVykresuS === 'technicky'}
								onchange={() => (rezimVykresuS = 'technicky')}
								style="width:auto"
							/>
							Technický (čiernobiely)
						</label>
						<label style="display:flex;align-items:center;gap:6px;font-weight:400">
							<input
								type="radio"
								name="pn-rezim"
								checked={rezimVykresuS === 'farebny'}
								onchange={() => (rezimVykresuS = 'farebny')}
								style="width:auto"
								data-testid="rezim-farebny-radio"
							/>
							Farebný (podľa RAL)
						</label>
					</div>
				</div>
				<div class="field">
					<label for="ralKod">RAL odtieň</label>
					<div class="row" style="gap:8px;align-items:center">
						<select
							id="ralKod"
							value={ralKodS}
							onchange={(e) => {
								const kod = (e.currentTarget as HTMLSelectElement).value;
								ralKodS = kod;
								if (kod === '') {
									// #150 review nález: „— nevybraté —" musí vynulovať aj `ralS`
									// (display text pre červenú poznámku) — inak poznámka ukazuje
									// STARÝ odtieň aj po tom, čo ho užívateľ v dropdowne zrušil.
									ralS = '';
									return;
								}
								const vzorka = RAL_PALETA.find((r) => r.kod === kod);
								if (vzorka) ralS = `${vzorka.kod} ${vzorka.nazov}`;
							}}
						>
							<option value="">— nevybraté —</option>
							{#each RAL_PALETA as r (r.kod)}
								<option value={r.kod} style="background:{r.hex}">{r.kod} {r.nazov} ({r.hex})</option
								>
							{/each}
							<option value={RAL_INY_KOD}>iný…</option>
						</select>
						{#if ralKodS}
							{@const vzorka = RAL_PALETA.find((r) => r.kod === ralKodS)}
							<span
								class="ral-swatch"
								style="display:inline-block;width:22px;height:22px;border-radius:4px;border:1px solid #94a3b8;background:{vzorka?.hex ??
									RAL_FALLBACK_HEX}"
								data-testid="ral-swatch"
							></span>
						{/if}
					</div>
					{#if ralKodS === RAL_INY_KOD}
						<label for="ralIny" style="margin-top:6px;display:block">RAL — vlastný text</label>
						<input
							id="ralIny"
							bind:value={ralS}
							maxlength="40"
							placeholder="napr. RAL 7021 matná"
							data-testid="ral-iny-text"
						/>
						<p class="sub" data-testid="ral-iny-hint">
							Vlastný RAL — farebný výkres použije neutrálnu tmavosivú (presný odtieň appka
							nepozná).
						</p>
					{/if}
				</div>
			</div>
			<div class="field">
				<label for="textVyplne">Text výplne / etapy (modrý text)</label>
				<input
					id="textVyplne"
					name="textVyplne"
					bind:value={textVyplneS}
					maxlength="120"
					placeholder="napr. FIX v 1. etape STADUR RAL 7016JŠ"
				/>
			</div>
			<div class="field">
				<label for="poznamkaIzometria">Poznámka na izometrii (odkazová čiara)</label>
				<input
					id="poznamkaIzometria"
					name="poznamkaIzometria"
					bind:value={poznamkaIzometriaS}
					maxlength="60"
					placeholder="napr. bez výplne"
				/>
			</div>

			{@render hidden()}
			<button class="btn" type="submit" data-testid="nakreslit">Vykresliť</button>
		</form>
	</div>
{:else if step === 'vykres'}
	<div class="card">
		<!-- #144 review nález: OP číslo je od tejto verzie voliteľné — bez fallbacku by
		     prázdne OP aj prázdny názov spolu dali VIZUÁLNE PRÁZDNY nadpis. Rovnaký „—"
		     idiom ako pečiatka (PergolaNavrhVykres.svelte), nikdy nič neposiela do Money. -->
		<h1>{vstup.op || '—'}{vstup.nazov ? ` · ${vstup.nazov}` : ''}</h1>
		<p class="sub">
			<span class="badge">Pergola — návrhový výkres</span>
			<span class="badge">{fmt(celkovaSirka)} × {fmt(vstup.hlbka)} mm</span>
		</p>
	</div>

	<div class="card" style="overflow:auto;padding:10px">
		<PergolaNavrhVykres {vstup} datum={formatDatumCasSk(data.datumIso)} />
	</div>

	<div class="card noprint">
		<button class="btn" onclick={() => window.print()}>🖨 Tlačiť / uložiť PDF</button>
		<form method="POST" action="?/upravit" style="display:inline">
			{@render hidden()}
			<button class="btn secondary" type="submit">← Späť a upraviť</button>
		</form>
		<a class="btn secondary" href={resolve('/pergola/navrh')}>➕ Nový výkres</a>
	</div>
{/if}

<style>
	.polia-box {
		border: 1px solid #bfdbfe;
		background: #f8fbff;
		border-radius: 10px;
		padding: 10px 12px 2px;
		margin-bottom: 12px;
	}

	/* Landscape tlač LEN pre túto route (route-CSS-splitting, #137 bod 3) — nedotýka
	   sa portrait tlače nárezáku/fixu/pôvodnej pergoly. */
	@media print {
		@page {
			size: A4 landscape;
			margin: 6mm;
		}
	}
</style>
