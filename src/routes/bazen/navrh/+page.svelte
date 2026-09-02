<script lang="ts">
	// Bazén — zákaznícky NÁVRHOVÝ výkres, FÁZA 1 (#139) — rozmerový formulár →
	// SVG výkres (vzory OP260027 rev.3 / OP260055) → tlač. Do Money NIČ
	// neposiela (existujúci `/bazen` Money odpis sa touto stránkou nedotýka).
	// Rovnaký vzor ako `/pergola/navrh`/`/zasklenia/navrh`: formulár → výkres →
	// tlač, žiadny zápisový krok.
	import BazenNavrhVykres from '$lib/components/BazenNavrhVykres.svelte';
	import OdpisNavrhNav from '$lib/components/OdpisNavrhNav.svelte';
	import { formatDatumCasSk } from '$lib/datum';
	import { resolve } from '$app/paths';
	import {
		ZATVORENA_DLZKA_MIN,
		ZATVORENA_DLZKA_MAX,
		HLBKA_MIN,
		HLBKA_MAX,
		VYSKA_MIN,
		VYSKA_MAX,
		DLZKA_KOLAJISKA_MIN,
		DLZKA_KOLAJISKA_MAX,
		VYSKA_CELA_MIN,
		VYSKA_CELA_MAX,
		POCET_SEKCII_MIN,
		POCET_SEKCII_MAX,
		BAZEN_NAVRH_REZIM_DEFAULT,
		RAL_PALETA,
		RAL_INY_KOD,
		RAL_FALLBACK_HEX,
		variantaZSekcii,
		predvyplnenyNazov,
		type Kolaj,
		type Smer,
		type DvereSmer,
		type BazenNavrhVstup,
		type BazenNavrhVykresRezim
	} from '$lib/bazen-navrh';

	let { data, form } = $props();

	const cislo = (x: number | string) => (typeof x === 'number' ? x : parseFloat(String(x)) || 0);

	let step = $derived(form?.step ?? 'form');

	let vstup = $derived({
		zatvorenaDlzka: form?.vstup?.zatvorenaDlzka ?? 8570,
		hlbka: form?.vstup?.hlbka ?? 4250,
		vyskaMax: form?.vstup?.vyskaMax ?? 750,
		vyskaMin: form?.vstup?.vyskaMin ?? 480,
		pocetSekcii: form?.vstup?.pocetSekcii ?? 4,
		dlzkaKolajiska: form?.vstup?.dlzkaKolajiska ?? 11100,
		sirkaSekcieOverride: form?.vstup?.sirkaSekcieOverride,
		dverovaSekcia: form?.vstup?.dverovaSekcia ?? 1,
		kolaj: (form?.vstup?.kolaj ?? 'jednokolaj') as Kolaj,
		smer: (form?.vstup?.smer ?? 'vpravo') as Smer,
		dvereSmer: (form?.vstup?.dvereSmer ?? 'vlavo') as DvereSmer,
		model: form?.vstup?.model ?? '',
		vyplna: form?.vstup?.vyplna ?? 'PC 3 mm číry',
		aretacia: form?.vstup?.aretacia ?? '',
		vyskaCela: form?.vstup?.vyskaCela ?? 96.2,
		op: form?.vstup?.op ?? '',
		nazov: form?.vstup?.nazov ?? '',
		revizia: form?.vstup?.revizia ?? '',
		vypracoval: form?.vstup?.vypracoval ?? data.user?.username ?? '',
		rezimVykresu: (form?.vstup?.rezimVykresu ?? BAZEN_NAVRH_REZIM_DEFAULT) as BazenNavrhVykresRezim,
		ral: form?.vstup?.ral ?? '',
		ralKod: form?.vstup?.ralKod ?? ''
	} satisfies BazenNavrhVstup);

	// editovateľné polia sú $state (bind) — jednosmerné value={} by sa pri
	// re-renderi vymazali (nova-stranka §4, pasca, ktorá už vynulovala
	// formuláre v pergole aj bazéne)
	let zatvorenaDlzkaS = $state<number | string>(8570);
	let hlbkaS = $state<number | string>(4250);
	let vyskaMaxS = $state<number | string>(750);
	let vyskaMinS = $state<number | string>(480);
	let pocetSekciiS = $state<number | string>(4);
	let dlzkaKolajiskaS = $state<number | string>(11100);
	let sirkaSekcieOverrideS = $state<number | string>('');
	let dverovaSekciaS = $state<number | string>(1);
	let kolajS = $state<Kolaj>('jednokolaj');
	let smerS = $state<Smer>('vpravo');
	let dvereSmerS = $state<DvereSmer>('vlavo');
	let modelS = $state('');
	let vyplnaS = $state('PC 3 mm číry');
	let aretaciaS = $state('');
	let vyskaCelaS = $state<number | string>(96.2);
	let opS = $state('');
	let nazovS = $state('');
	let reviziaS = $state('');
	let vypracovalS = $state('');
	let rezimVykresuS = $state<BazenNavrhVykresRezim>(BAZEN_NAVRH_REZIM_DEFAULT);
	let ralS = $state('');
	let ralKodS = $state('');

	// reštart-effect: NIKDY nesmie čítať vlastný zápis (nova-stranka §3, #162
	// live nález — self-loop by tichým prepisom zmazal používateľovu voľbu).
	// Číta LEN `form?.vstup`, nikdy ktorúkoľvek `*S` premennú.
	$effect(() => {
		const v = form?.vstup ?? null;
		zatvorenaDlzkaS = v?.zatvorenaDlzka || 8570;
		hlbkaS = v?.hlbka || 4250;
		vyskaMaxS = v?.vyskaMax || 750;
		vyskaMinS = v?.vyskaMin || 480;
		pocetSekciiS = v?.pocetSekcii || 4;
		dlzkaKolajiskaS = v?.dlzkaKolajiska || 11100;
		sirkaSekcieOverrideS = v?.sirkaSekcieOverride || '';
		dverovaSekciaS = v?.dverovaSekcia || 1;
		kolajS = v?.kolaj ?? 'jednokolaj';
		smerS = v?.smer ?? 'vpravo';
		dvereSmerS = v?.dvereSmer ?? 'vlavo';
		modelS = v?.model ?? '';
		vyplnaS = v?.vyplna ?? 'PC 3 mm číry';
		aretaciaS = v?.aretacia ?? '';
		vyskaCelaS = v?.vyskaCela || 96.2;
		opS = v?.op ?? '';
		nazovS = v?.nazov ?? '';
		reviziaS = v?.revizia ?? '';
		vypracovalS = v?.vypracoval ?? data.user?.username ?? '';
		rezimVykresuS = v?.rezimVykresu === 'farebny' ? 'farebny' : BAZEN_NAVRH_REZIM_DEFAULT;
		ralS = v?.ral ?? '';
		ralKodS = v?.ralKod ?? '';
	});

	let nazovPredvyplneny = $derived(
		predvyplnenyNazov(cislo(zatvorenaDlzkaS), cislo(hlbkaS), cislo(vyskaMaxS))
	);
	let variantaZobrazena = $derived(variantaZSekcii(cislo(pocetSekciiS)));
</script>

<svelte:head><title>Bazén — návrhový výkres</title></svelte:head>

{#snippet hidden()}
	<input type="hidden" name="zatvorenaDlzka" value={cislo(zatvorenaDlzkaS)} />
	<input type="hidden" name="hlbka" value={cislo(hlbkaS)} />
	<input type="hidden" name="vyskaMax" value={cislo(vyskaMaxS)} />
	<input type="hidden" name="vyskaMin" value={cislo(vyskaMinS)} />
	<input type="hidden" name="pocetSekcii" value={cislo(pocetSekciiS)} />
	<input type="hidden" name="dlzkaKolajiska" value={cislo(dlzkaKolajiskaS)} />
	{#if sirkaSekcieOverrideS !== ''}<input
			type="hidden"
			name="sirkaSekcieOverride"
			value={cislo(sirkaSekcieOverrideS)}
		/>{/if}
	<input type="hidden" name="dverovaSekcia" value={cislo(dverovaSekciaS)} />
	<input type="hidden" name="kolaj" value={kolajS} />
	<input type="hidden" name="smer" value={smerS} />
	<input type="hidden" name="dvereSmer" value={dvereSmerS} />
	<input type="hidden" name="model" value={modelS} />
	<input type="hidden" name="vyplna" value={vyplnaS} />
	<input type="hidden" name="aretacia" value={aretaciaS} />
	<input type="hidden" name="vyskaCela" value={cislo(vyskaCelaS)} />
	<input type="hidden" name="op" value={opS} />
	<input type="hidden" name="nazov" value={nazovS} />
	<input type="hidden" name="revizia" value={reviziaS} />
	<input type="hidden" name="vypracoval" value={vypracovalS} />
	<input type="hidden" name="rezimVykresu" value={rezimVykresuS} />
	<input type="hidden" name="ral" value={ralS} />
	<input type="hidden" name="ralKod" value={ralKodS} />
{/snippet}

{#if step === 'form'}
	<div class="card">
		<OdpisNavrhNav modul="bazen" active="navrh" />
	</div>
	<div class="card">
		<h1>Bazén — návrhový výkres</h1>
		<p class="sub">
			Zadaj rozmery — vykreslím zákaznícky návrhový výkres (bokorys, pôdorys, textový popis,
			pečiatka). Priečny rez sekciou (VIEW A) appka zámerne nekreslí — tvar oblúka sa nedá odvodiť z
			kót bez ďalších dát od konštruktéra (#163).
			<b>Do Money sa neposiela nič</b> — tento modul len kreslí; na zápis do Money prepni kachličku „Zápis
			do Money" hore.
		</p>
	</div>

	{#if form?.error}
		<div class="err" data-testid="form-error">⚠️ {form.error}</div>
	{/if}

	<div class="card">
		<form method="POST" action="?/vykres">
			<div class="grid3">
				<div class="field">
					<label for="op">OP číslo</label>
					<input id="op" name="op" bind:value={opS} maxlength="40" placeholder="napr. OP260055" />
				</div>
				<div class="field">
					<label for="nazov">Názov výkresu (voliteľné)</label>
					<input
						id="nazov"
						name="nazov"
						bind:value={nazovS}
						maxlength="80"
						placeholder={nazovPredvyplneny || 'napr. 8570x4250x750'}
					/>
				</div>
				<div class="field">
					<label for="revizia">Revízia</label>
					<input id="revizia" name="revizia" bind:value={reviziaS} maxlength="20" placeholder="1" />
				</div>
			</div>
			<div class="grid3">
				<div class="field">
					<label for="vypracoval">Vypracoval</label>
					<input id="vypracoval" name="vypracoval" bind:value={vypracovalS} maxlength="60" />
				</div>
				<div class="field">
					<span style="font-weight:600;font-size:14px">Varianta (počet sekcií)</span>
					<p class="sub" style="margin:6px 0 0" data-testid="varianta-nahlad">
						{variantaZobrazena}
					</p>
				</div>
				<div class="field">
					<label for="pocetSekcii">Počet sekcií *</label>
					<input
						id="pocetSekcii"
						name="pocetSekcii"
						type="number"
						min={POCET_SEKCII_MIN}
						max={POCET_SEKCII_MAX}
						step="1"
						bind:value={pocetSekciiS}
						required
					/>
				</div>
			</div>

			<div class="grid3">
				<div class="field">
					<label for="zatvorenaDlzka">Zatvorená dĺžka (mm) *</label>
					<input
						id="zatvorenaDlzka"
						name="zatvorenaDlzka"
						type="number"
						min={ZATVORENA_DLZKA_MIN}
						max={ZATVORENA_DLZKA_MAX}
						step="any"
						bind:value={zatvorenaDlzkaS}
						required
					/>
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
				<div class="field">
					<label for="dlzkaKolajiska">Dĺžka koľajiska (mm) *</label>
					<input
						id="dlzkaKolajiska"
						name="dlzkaKolajiska"
						type="number"
						min={DLZKA_KOLAJISKA_MIN}
						max={DLZKA_KOLAJISKA_MAX}
						step="any"
						bind:value={dlzkaKolajiskaS}
						required
					/>
				</div>
			</div>

			<div class="grid3">
				<div class="field">
					<label for="vyskaMax">Výška najvyššej sekcie (mm) *</label>
					<input
						id="vyskaMax"
						name="vyskaMax"
						type="number"
						min={VYSKA_MIN}
						max={VYSKA_MAX}
						step="any"
						bind:value={vyskaMaxS}
						required
					/>
				</div>
				<div class="field">
					<label for="vyskaMin">Výška najnižšej sekcie (mm) *</label>
					<input
						id="vyskaMin"
						name="vyskaMin"
						type="number"
						min={VYSKA_MIN}
						max={VYSKA_MAX}
						step="any"
						bind:value={vyskaMinS}
						required
					/>
				</div>
				<div class="field">
					<label for="sirkaSekcieOverride">Šírka prvej sekcie (mm) — ručný prepis</label>
					<input
						id="sirkaSekcieOverride"
						type="number"
						step="any"
						bind:value={sirkaSekcieOverrideS}
						placeholder="vytlačí sa LEN keď je zadaná"
					/>
				</div>
			</div>

			<div class="grid3">
				<div class="field">
					<label for="kolaj">Koľaj</label>
					<select id="kolaj" name="kolaj" bind:value={kolajS}>
						<option value="jednokolaj">Jednokoľaj</option>
						<option value="dvojkolaj">Dvojkoľaj (obojsmerný)</option>
					</select>
				</div>
				{#if kolajS === 'jednokolaj'}
					<div class="field">
						<label for="smer">Smer posuvu</label>
						<select id="smer" name="smer" bind:value={smerS}>
							<option value="vpravo">Vpravo</option>
							<option value="vlavo">Vľavo</option>
						</select>
					</div>
				{/if}
				<div class="field">
					<label for="dverovaSekcia">Dverová sekcia (poradie) *</label>
					<input
						id="dverovaSekcia"
						name="dverovaSekcia"
						type="number"
						min="1"
						max={cislo(pocetSekciiS) || POCET_SEKCII_MAX}
						step="1"
						bind:value={dverovaSekciaS}
						required
					/>
				</div>
			</div>

			<div class="grid3">
				<div class="field">
					<label for="dvereSmer">Smer dverí</label>
					<select id="dvereSmer" name="dvereSmer" bind:value={dvereSmerS}>
						<option value="vlavo">Vľavo</option>
						<option value="vpravo">Vpravo</option>
					</select>
				</div>
				<div class="field">
					<label for="vyskaCela">Výška čela (mm) *</label>
					<input
						id="vyskaCela"
						name="vyskaCela"
						type="number"
						min={VYSKA_CELA_MIN}
						max={VYSKA_CELA_MAX}
						step="any"
						bind:value={vyskaCelaS}
						required
					/>
				</div>
				<div class="field">
					<label for="model">Model (voliteľné)</label>
					<input
						id="model"
						name="model"
						bind:value={modelS}
						maxlength="60"
						placeholder="napr. PREMIER"
					/>
				</div>
			</div>

			<div class="grid3">
				<div class="field">
					<label for="vyplna">Výplň</label>
					<input
						id="vyplna"
						name="vyplna"
						bind:value={vyplnaS}
						maxlength="60"
						placeholder="napr. PC 3 mm číry"
					/>
				</div>
				<div class="field">
					<label for="aretacia">Aretácia (voliteľné)</label>
					<input id="aretacia" name="aretacia" bind:value={aretaciaS} maxlength="60" />
				</div>
			</div>

			<!-- #150 disciplína znovupoužitá 1:1 (pergola/zasklenia navrh): režim
			     výkresu (technický/farebný) + RAL ako riadený výber -->
			<div class="grid2">
				<div class="field">
					<span style="font-weight:600;font-size:14px">Režim výkresu</span>
					<div class="row" style="gap:18px;margin-top:4px">
						<label style="display:flex;align-items:center;gap:6px;font-weight:400">
							<input
								type="radio"
								name="bn-rezim"
								checked={rezimVykresuS === 'technicky'}
								onchange={() => (rezimVykresuS = 'technicky')}
								style="width:auto"
							/>
							Technický (čiernobiely)
						</label>
						<label style="display:flex;align-items:center;gap:6px;font-weight:400">
							<input
								type="radio"
								name="bn-rezim"
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
							placeholder="napr. RAL 9006 vlastný"
							data-testid="ral-iny-text"
						/>
						<p class="sub" data-testid="ral-iny-hint">
							Vlastný RAL — farebný výkres použije neutrálnu tmavosivú (presný odtieň appka
							nepozná).
						</p>
					{/if}
				</div>
			</div>

			{@render hidden()}
			<button class="btn" type="submit" data-testid="nakreslit">Vykresliť</button>
		</form>
	</div>
{:else if step === 'vykres'}
	<div class="card">
		<h1>{vstup.op || '—'}{vstup.nazov ? ` · ${vstup.nazov}` : ''}</h1>
		<p class="sub">
			<span class="badge">Bazén — návrhový výkres · {variantaZSekcii(vstup.pocetSekcii)}</span>
			<span class="badge">{vstup.zatvorenaDlzka} × {vstup.hlbka} × {vstup.vyskaMax} mm</span>
		</p>
	</div>

	<div class="card" style="overflow:auto;padding:10px">
		<BazenNavrhVykres {vstup} datum={formatDatumCasSk(data.datumIso)} />
	</div>

	<div class="card noprint">
		<button class="btn" onclick={() => window.print()}>🖨 Tlačiť / uložiť PDF</button>
		<form method="POST" action="?/upravit" style="display:inline">
			{@render hidden()}
			<button class="btn secondary" type="submit">← Späť a upraviť</button>
		</form>
		<a class="btn secondary" href={resolve('/bazen/navrh')}>➕ Nový výkres</a>
	</div>
{/if}

<style>
	/* Landscape tlač LEN pre túto route (route-CSS-splitting, #137 bod 3) —
	   nedotýka sa portrait tlače pôvodného /bazen odpisu. */
	@media print {
		@page {
			size: A4 landscape;
			margin: 6mm;
		}
	}
</style>
