<script lang="ts">
	// Pergola — REZERVAČNÝ ODPIS z rozmerov (#221, pôvodne „Materiál z rozmerov" #155).
	// Formulár(rozmery) → výsledok(materiál + výkres #194) → [ZAK/OP/zákazník] → Money
	// rozpis(nahlad) → explicitné potvrdenie → zápis (rez-hotovo). Rezervuje materiál v
	// Money už pri zadaní objednávky, bez +20 %; do odpisu idú LEN potvrdené položky,
	// honest-null ostáva „zatiaľ nepočítané". Vzorcový engine (spocitajNarez) je čistý;
	// Money most žije v $lib/server/pergola-rezervacia. Vzor UX = /bazen/navrh + /pergola
	// (nova-stranka §3/§4/§6). Výkres kreslí PergolaNarezVykres z potvrdených vzorcov (#194).
	import { resolve } from '$app/paths';
	import PergolaNarezVykres from '$lib/components/PergolaNarezVykres.svelte';
	import { formatDatumCasSk } from '$lib/datum';
	import {
		spocitajNarez,
		komponentyPergoly,
		PREDNA_SVETLOST_STD,
		MAX_ROZOSTUP_PRIECOK,
		ZVOD_SH_MAX,
		type PergolaNarezVstup,
		type PergolaSystem,
		type Uchytenie,
		type HornyProfil,
		type VystuhaProfil
	} from '$lib/pergola-narez';
	import { krovUlozenie } from '$lib/pergola-krov';

	let { data, form } = $props();

	let step = $derived(form?.step ?? 'form');

	// #221 — rezervačný odpis: metre s čiarkou (ako /pergola), echo ident + Money rozpis + výsledok
	const fmtM = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');
	let ident = $derived(
		(form && 'ident' in form ? form.ident : null) ?? { zak: '', op: '', zakaznik: '' }
	);
	let rozpis = $derived(form && 'rozpis' in form ? form.rozpis : null);
	let outcome = $derived(form && 'outcome' in form ? form.outcome : null);
	let rezError = $derived(form && 'rezError' in form ? form.rezError : null);

	// vstup na PREFILL + na výpočet výsledku (display-only). Merge form?.vstup s
	// predvolenými hodnotami — rovnaká disciplína ako /bazen/navrh.
	let vstup = $derived({
		system: (form?.vstup?.system ?? 'Robust') as PergolaSystem,
		sirka: form?.vstup?.sirka ?? 5000,
		hlbka: form?.vstup?.hlbka ?? 3500,
		prednaSvetlost: form?.vstup?.prednaSvetlost ?? PREDNA_SVETLOST_STD,
		vyskaZadna: form?.vstup?.vyskaZadna ?? 2900,
		pocetPrednychNoh: form?.vstup?.pocetPrednychNoh ?? 4,
		uchytenie: (form?.vstup?.uchytenie ?? 'stena') as Uchytenie,
		pocetZadnychNoh: form?.vstup?.pocetZadnychNoh ?? 4,
		hornyProfilZadnej: (form?.vstup?.hornyProfilZadnej ?? 140) as HornyProfil,
		prieckaLight: form?.vstup?.prieckaLight ?? false,
		zosilnenyNosnik: form?.vstup?.zosilnenyNosnik ?? false,
		sklonStrechy: form?.vstup?.sklonStrechy ?? null,
		// #206 nové polia
		jednoduchaBezZasklenia: form?.vstup?.jednoduchaBezZasklenia ?? false,
		vystuhaProfil: (form?.vstup?.vystuhaProfil ?? null) as VystuhaProfil | null,
		zvodFrezovat: form?.vstup?.zvodFrezovat ?? false,
		zvodFrezovanieSHmm: form?.vstup?.zvodFrezovanieSHmm ?? null,
		strechaSklo: form?.vstup?.strechaSklo ?? '',
		obvodoveZasklenie: form?.vstup?.obvodoveZasklenie ?? ''
	} satisfies PergolaNarezVstup);

	// editovateľné polia — $state + bind (nova-stranka §4: jednosmerné value={} sa pri
	// re-renderi vymaže)
	let systemS = $state<PergolaSystem>('Robust');
	let sirkaS = $state<number | string>(5000);
	let hlbkaS = $state<number | string>(3500);
	let prednaSvetlostS = $state<number | string>(PREDNA_SVETLOST_STD);
	let vyskaZadnaS = $state<number | string>(2900);
	let pocetPrednychNohS = $state<number | string>(4);
	let uchytenieS = $state<Uchytenie>('stena');
	let pocetZadnychNohS = $state<number | string>(4);
	let hornyProfilZadnejS = $state<HornyProfil>(140);
	let prieckaLightS = $state(false);
	let zosilnenyNosnikS = $state(false);
	// #161 — voliteľný sklon strechy pre krov uloženie; prázdne = nezadané
	let sklonStrechyS = $state<number | string>('');
	// #206 — nové voľby z výkresu OP260282
	let jednoduchaBezZaskleniaS = $state(false);
	let vystuhaProfilS = $state<VystuhaProfil | ''>('');
	let zvodFrezovatS = $state(false);
	let zvodFrezovanieSHmmS = $state<number | string>('');
	let strechaSkloS = $state('');
	let obvodoveZasklenieS = $state('');
	// #221 — ident rezervácie (ZAK/OP/zákazník): bind + $state, aby prežili re-render
	let zakS = $state('');
	let opS = $state('');
	let zakaznikS = $state('');

	// reštart-effect: číta LEN form?.vstup, NIKDY vlastný *S zápis (nova-stranka §3 —
	// self-loop by ticho prepísal používateľovu voľbu systému späť na default).
	$effect(() => {
		const v = form?.vstup ?? null;
		systemS = (v?.system as PergolaSystem) ?? 'Robust';
		sirkaS = v?.sirka || 5000;
		hlbkaS = v?.hlbka || 3500;
		prednaSvetlostS = v?.prednaSvetlost || PREDNA_SVETLOST_STD;
		vyskaZadnaS = v?.vyskaZadna || 2900;
		pocetPrednychNohS = v?.pocetPrednychNoh || 4;
		uchytenieS = (v?.uchytenie as Uchytenie) ?? 'stena';
		pocetZadnychNohS = v?.pocetZadnychNoh || 4;
		hornyProfilZadnejS = (v?.hornyProfilZadnej as HornyProfil) ?? 140;
		prieckaLightS = v?.prieckaLight ?? false;
		zosilnenyNosnikS = v?.zosilnenyNosnik ?? false;
		sklonStrechyS = v?.sklonStrechy ?? '';
		// #206
		jednoduchaBezZaskleniaS = v?.jednoduchaBezZasklenia ?? false;
		vystuhaProfilS = (v?.vystuhaProfil as VystuhaProfil | null) ?? '';
		zvodFrezovatS = v?.zvodFrezovat ?? false;
		zvodFrezovanieSHmmS = v?.zvodFrezovanieSHmm ?? '';
		strechaSkloS = v?.strechaSklo ?? '';
		obvodoveZasklenieS = v?.obvodoveZasklenie ?? '';
		// #221 — echo ident z form (rovnaká disciplína: číta LEN form, nie vlastné *S)
		const id = form && 'ident' in form ? form.ident : null;
		zakS = id?.zak ?? '';
		opS = id?.op ?? '';
		zakaznikS = id?.zakaznik ?? '';
	});

	let vysledok = $derived(step === 'vysledok' ? spocitajNarez(vstup) : null);
	// #195 — kusové komponenty (spojky, krytky) relevantné pre zvolený systém (display-only)
	let komponenty = $derived(step === 'vysledok' && vysledok ? komponentyPergoly(vstup) : []);
	// #161 — krov uloženie z potvrdených vzorcov, len keď je sklon zadaný
	let krov = $derived(
		step === 'vysledok' && vstup.sklonStrechy != null ? krovUlozenie(vstup.sklonStrechy) : null
	);

	const mm = (n: number | null) => (n === null ? '— (čaká na výkres)' : `${n} mm`);
</script>

<svelte:head><title>Rezervačný odpis — pergola</title></svelte:head>

{#snippet hidden()}
	<input type="hidden" name="system" value={systemS} />
	<input type="hidden" name="sirka" value={sirkaS} />
	<input type="hidden" name="hlbka" value={hlbkaS} />
	<input type="hidden" name="prednaSvetlost" value={prednaSvetlostS} />
	<input type="hidden" name="vyskaZadna" value={vyskaZadnaS} />
	<input type="hidden" name="pocetPrednychNoh" value={pocetPrednychNohS} />
	<input type="hidden" name="uchytenie" value={uchytenieS} />
	<input type="hidden" name="pocetZadnychNoh" value={pocetZadnychNohS} />
	<input type="hidden" name="hornyProfilZadnej" value={hornyProfilZadnejS} />
	{#if prieckaLightS}<input type="hidden" name="prieckaLight" value="1" />{/if}
	{#if zosilnenyNosnikS}<input type="hidden" name="zosilnenyNosnik" value="1" />{/if}
	{#if sklonStrechyS !== ''}<input type="hidden" name="sklonStrechy" value={sklonStrechyS} />{/if}
	{#if jednoduchaBezZaskleniaS}<input type="hidden" name="jednoduchaBezZasklenia" value="1" />{/if}
	{#if vystuhaProfilS !== ''}<input
			type="hidden"
			name="vystuhaProfil"
			value={vystuhaProfilS}
		/>{/if}
	{#if zvodFrezovatS}<input type="hidden" name="zvodFrezovat" value="1" />{/if}
	{#if zvodFrezovanieSHmmS !== ''}<input
			type="hidden"
			name="zvodFrezovanieSHmm"
			value={zvodFrezovanieSHmmS}
		/>{/if}
	{#if strechaSkloS !== ''}<input type="hidden" name="strechaSklo" value={strechaSkloS} />{/if}
	{#if obvodoveZasklenieS !== ''}<input
			type="hidden"
			name="obvodoveZasklenie"
			value={obvodoveZasklenieS}
		/>{/if}
{/snippet}

{#snippet hiddenIdent()}
	<input type="hidden" name="zak" value={zakS} />
	<input type="hidden" name="op" value={opS} />
	<input type="hidden" name="zakaznik" value={zakaznikS} />
{/snippet}

{#if step === 'form'}
	<div class="card">
		<h1>Rezervačný odpis — pergola</h1>
		<p class="sub">
			Zadaj rozmery objednávky — z <b>potvrdených</b> vzorcov spočítam materiál a môžeš ho
			<b>rezervovať v Money</b> už pri zadaní objednávky (odpis do Money hneď, aby ti materiál
			neušiel). Do rezervácie idú LEN potvrdené položky; čo ešte nemá pravidlo (krov, dĺžky
			líšt/žľabu, sklá) ostáva čestne <b>„zatiaľ nepočítané"</b> a NEzahrnie sa — bez +20 % rezervy.
			Odpis sa odošle až po tvojom potvrdení.
			{#if !data.live}<b>Bežíme v 🧪 TEST režime — do Money nejde nič.</b>{/if}
		</p>
		<p class="sub">
			Klasický Money odpis z CAD nárezu je na
			<a href={resolve('/pergola')} data-testid="link-pergola">pôvodnej stránke Pergola</a>;
			zákaznícky výkres kreslí
			<a href={resolve('/pergola/navrh')} data-testid="link-navrh">Pergola návrh</a>.
		</p>
	</div>

	{#if form?.error}
		<div class="err" data-testid="form-error">⚠️ {form.error}</div>
	{/if}

	<div class="card">
		<form method="POST" action="?/spocitat">
			<div class="grid3">
				<div class="field">
					<label for="system">Systém pergoly *</label>
					<select id="system" name="system" bind:value={systemS}>
						<option value="Robust">Robust (stĺp 110×110, žľab 110)</option>
						<option value="Massive">Massive (stĺp 140×140, žľab 140)</option>
					</select>
				</div>
				<div class="field">
					<label for="sirka">Šírka (mm) *</label>
					<input id="sirka" name="sirka" type="number" step="any" bind:value={sirkaS} required />
				</div>
				<div class="field">
					<label for="hlbka">Hĺbka (mm) *</label>
					<input id="hlbka" name="hlbka" type="number" step="any" bind:value={hlbkaS} required />
				</div>
			</div>

			<div class="grid3">
				<div class="field">
					<label for="prednaSvetlost">Predná svetlosť (mm) *</label>
					<input
						id="prednaSvetlost"
						name="prednaSvetlost"
						type="number"
						step="any"
						bind:value={prednaSvetlostS}
						required
					/>
					<p class="sub" style="margin:4px 0 0">štandard {PREDNA_SVETLOST_STD} mm</p>
				</div>
				<div class="field">
					<label for="pocetPrednychNoh">Počet predných nôh *</label>
					<input
						id="pocetPrednychNoh"
						name="pocetPrednychNoh"
						type="number"
						min="2"
						max="20"
						step="1"
						bind:value={pocetPrednychNohS}
						required
					/>
					<p class="sub" style="margin:4px 0 0">rozostupy sa dopočítajú zo šírky</p>
				</div>
				<div class="field">
					<label for="uchytenie">Uchytenie *</label>
					<select id="uchytenie" name="uchytenie" bind:value={uchytenieS}>
						<option value="stena">Na stenu (bez zadných nôh)</option>
						<option value="samostatne">Samostatne stojaca</option>
					</select>
				</div>
			</div>

			<!-- #206 (a) jednoduchá pergola bez zasklenia + (c) profil výstuhy -->
			<div class="grid2">
				<div class="field">
					<label style="display:flex;align-items:center;gap:8px;font-weight:400">
						<input
							id="jednoduchaBezZasklenia"
							type="checkbox"
							name="jednoduchaBezZasklenia"
							value="1"
							bind:checked={jednoduchaBezZaskleniaS}
							style="width:auto"
						/>
						Jednoduchá pergola bez zasklenia (vypne bočné profily 110×43)
					</label>
				</div>
				<div class="field">
					<label for="vystuhaProfil">Profil výstuhy (nosníka)</label>
					<select id="vystuhaProfil" name="vystuhaProfil" bind:value={vystuhaProfilS}>
						<option value="">— systémový štandard —</option>
						{#if systemS === 'Massive'}
							<option value="140x140">140×140 (štandard)</option>
							<option value="200x140">200×140 (svetlosť −60)</option>
						{:else}
							<option value="110x110">110×110</option>
							<option value="110x250">110×250</option>
						{/if}
					</select>
					<p class="sub" style="margin:4px 0 0">
						<b>200×140</b> zníži svetlosť o 60 mm; Robust varianty dĺžky zatiaľ nepodporované
					</p>
				</div>
			</div>

			<!-- Výška zadná (ZV): pri samostatne (zadné nohy) alebo stena+zasklená (bočný 110×43
			     pod kotviacim = ZV − 190, #206 b). Pri „jednoduchej bez zasklenia" na stene sa ZV
			     nepoužíva → pole skryté. -->
			{#if uchytenieS === 'samostatne' || (uchytenieS === 'stena' && !jednoduchaBezZaskleniaS)}
				<div class="grid3">
					<div class="field">
						<label for="vyskaZadna">Výška zadná ZV (mm) *</label>
						<input
							id="vyskaZadna"
							name="vyskaZadna"
							type="number"
							step="any"
							bind:value={vyskaZadnaS}
							required
						/>
						<p class="sub" style="margin:4px 0 0">
							{uchytenieS === 'samostatne'
								? 'zadná noha = plná ZV (výkres OP260282)'
								: 'bočný profil 110×43 pod kotviacim = ZV − 190 (#206)'}
						</p>
					</div>
					{#if uchytenieS === 'samostatne'}
						<div class="field" data-testid="zadne-nohy-box">
							<label for="pocetZadnychNoh">Počet zadných nôh *</label>
							<input
								id="pocetZadnychNoh"
								name="pocetZadnychNoh"
								type="number"
								min="2"
								max="20"
								step="1"
								bind:value={pocetZadnychNohS}
								required
							/>
						</div>
						<div class="field">
							<label for="hornyProfilZadnej">Horný profil zadnej konštrukcie *</label>
							<select
								id="hornyProfilZadnej"
								name="hornyProfilZadnej"
								bind:value={hornyProfilZadnejS}
							>
								<option value={110}>110</option>
								<option value={140}>140</option>
							</select>
							<p class="sub" style="margin:4px 0 0">
								určuje bočný profil 110×43 „pod fixom" (kaskáda); dĺžku zadnej nohy už nemení
							</p>
						</div>
					{/if}
				</div>
			{/if}

			<div class="grid2">
				<div class="field">
					<label style="display:flex;align-items:center;gap:8px;font-weight:400">
						<input
							type="checkbox"
							name="prieckaLight"
							value="1"
							bind:checked={prieckaLightS}
							style="width:auto"
						/>
						Priečka light (18102 namiesto 18004)
					</label>
				</div>
				<div class="field">
					<label style="display:flex;align-items:center;gap:8px;font-weight:400">
						<input
							id="zosilnenyNosnik"
							type="checkbox"
							name="zosilnenyNosnik"
							value="1"
							bind:checked={zosilnenyNosnikS}
							style="width:auto"
						/>
						Zosilnený nosník (profil čaká na pravidlo — O2/O3)
					</label>
				</div>
			</div>

			<div class="grid3">
				<div class="field">
					<label for="sklonStrechy">Sklon strechy (°) — krov uloženie (#161)</label>
					<input
						id="sklonStrechy"
						name="sklonStrechy"
						type="number"
						step="any"
						min="0"
						max="60"
						placeholder="voliteľné"
						bind:value={sklonStrechyS}
					/>
					<p class="sub" style="margin:4px 0 0">
						voliteľné · ≥ 7° = <b>potvrdené</b> uloženie (prah 7°, vzorce z callu 13.8.); pod 7° zatiaľ
						nepodporované (O5). Frézovanie drážok ostáva na konštruktérovi.
					</p>
				</div>
			</div>

			<!-- #206 (d) ZVOD frézovanie (evidencia/výkres) + (e) sklá zákazky -->
			<div class="grid3">
				<div class="field">
					<label style="display:flex;align-items:center;gap:8px;font-weight:400">
						<input
							id="zvodFrezovat"
							type="checkbox"
							name="zvodFrezovat"
							value="1"
							bind:checked={zvodFrezovatS}
							style="width:auto"
						/>
						Frézovať zvod (SH)
					</label>
				</div>
				{#if zvodFrezovatS}
					<div class="field">
						<label for="zvodFrezovanieSHmm">Výška SH frézovania zvodu (mm) *</label>
						<input
							id="zvodFrezovanieSHmm"
							name="zvodFrezovanieSHmm"
							type="number"
							step="any"
							min="0"
							max={ZVOD_SH_MAX}
							bind:value={zvodFrezovanieSHmmS}
							required
						/>
						<p class="sub" style="margin:4px 0 0">evidencia na výkrese; detail frézovania → #161</p>
					</div>
				{/if}
			</div>

			<div class="grid2">
				<div class="field">
					<label for="strechaSklo">Strecha — sklo</label>
					<input
						id="strechaSklo"
						name="strechaSklo"
						type="text"
						maxlength="200"
						placeholder="napr. 4-4-2číre-8-6stopsol classic grey"
						bind:value={strechaSkloS}
					/>
				</div>
				<div class="field">
					<label for="obvodoveZasklenie">Obvodové zasklenie</label>
					<input
						id="obvodoveZasklenie"
						name="obvodoveZasklenie"
						type="text"
						maxlength="200"
						placeholder="napr. RS STANDARD PLUS 4-8-4číre"
						bind:value={obvodoveZasklenieS}
					/>
					<p class="sub" style="margin:4px 0 0">
						informatívne — Zasklenia má vlastný odpis, tu žiadny Money výpočet
					</p>
				</div>
			</div>

			<button class="btn" type="submit" data-testid="spocitat">Spočítať materiál</button>
		</form>
	</div>
{:else if step === 'vysledok' && vysledok}
	<div class="card">
		<h1 data-testid="narez-nadpis">
			Materiál/nárez — {vstup.system}
			{vstup.sirka}×{vstup.hlbka} mm
		</h1>
		<p class="sub">
			<span class="badge">{vstup.system}</span>
			<span class="badge">{vstup.uchytenie === 'stena' ? 'na stenu' : 'samostatne stojaca'}</span>
			<span class="badge">{vstup.pocetPrednychNoh} predných nôh</span>
		</p>
	</div>

	<div class="card" style="overflow:auto;padding:10px">
		<div class="sec noprint">Technický výkres z rozmerov (#194)</div>
		<p class="sub noprint" style="margin:0 0 8px">
			Predný pohľad, bokorys a pôdorys z <b>potvrdených</b> vzorcov (nohy, rozostupy, priečky,
			žľab). Krov je zjednodušený obrys — jeho detail (sklon 7°, rozostup, frézovanie) doplní
			konštruktér (#161). <b>Do Money sa neposiela nič.</b>
		</p>
		<PergolaNarezVykres {vstup} datum={formatDatumCasSk(data.datumIso)} />
	</div>

	{#if krov}
		<div class="card">
			<div class="sec">Krov — uloženie (#161)</div>
			{#if krov.podporovane}
				<p class="sub">
					Potvrdené uloženie z prahu 7° (vzorce z callu 13.8., číselne overené). Frézovanie drážok
					(výrobný list) ostáva na konštruktérovi. <b>Do Money sa neposiela nič.</b>
				</p>
				<div data-testid="krov-ulozenie">
					<div class="row"><span>Sklon strechy</span><b>{krov.sklonStupne}°</b></div>
					<div class="row">
						<span>Rovina uloženia</span>
						<b
							>{krov.rezim === 'rovnobezne'
								? '= 7° — rovnobežne s hranou'
								: '> 7° — dva dotyky + previs'}</b
						>
					</div>
					<div class="row">
						<span>uhol2 / uhol3 (SE model)</span><b>{krov.uhol2} / {krov.uhol3}°</b>
					</div>
					<div class="row">
						<span>Odvesna c = 29 mm → ps = ls</span>
						<b data-testid="krov-ps">{krov.ps} mm</b>
					</div>
					<div class="row">
						<span>Odvesna cc = 37,28 mm → lv = pv</span>
						<b data-testid="krov-lv">{krov.lv} mm</b>
					</div>
				</div>
			{:else}
				<p class="sub" data-testid="krov-nepodporovane">
					Zadaný sklon <b>{krov.sklonStupne}°</b> je pod prahom 7° — bod dotyku sa „prehodí" (trojuholník
					sa otočí), táto vetva nie je potvrdeným vzorcom pokrytá (O5). Uloženie sa nepočíta — nič sa
					nehádže.
				</p>
			{/if}
			<ul style="margin:6px 0 0;padding-left:18px">
				{#each krov.poznamky as p (p)}
					<li style="margin:4px 0" class="sub">{p}</li>
				{/each}
			</ul>
		</div>
	{/if}

	<div class="card">
		<div class="sec">Materiál — vypočítané ({vysledok.vypocitane.length} položiek)</div>
		<p class="sub noprint">
			Len z potvrdených vzorcov. „—" pri dĺžke = počet je istý, dĺžku rezu ešte nemáme (čaká na
			kótovaný výkres, O1). <b>Nič sa neposiela do Money.</b>
		</p>
		<table class="narez" data-testid="narez-tabulka">
			<thead>
				<tr><th>Kód</th><th>Názov</th><th>Dĺžka rezu</th><th>Počet ks</th><th>Výdaj</th></tr>
			</thead>
			<tbody>
				<!-- POZOR: jeden kód môže mať VIAC riadkov (napr. 18016 pod fixom + pod kotviacim;
				     18017 predná + zadná noha pri SS), takže data-testid="polozka-{kód}" NIE JE
				     unikátny — v teste filtruj podľa textu riadku (`.filter({ hasText: '…' })`). -->
				{#each vysledok.vypocitane as p (p.kod + p.nazov)}
					<tr data-testid="polozka-{p.kod}">
						<td>{p.kod}</td>
						<td>{p.nazov}{p.poznamka ? ` · ${p.poznamka}` : ''}</td>
						<td>{mm(p.dlzkaRezuMm)}</td>
						<td><b>{p.pocetKs}</b></td>
						<td data-testid="vydaj-{p.kod}"
							>{p.vydajTyce
								? `${p.vydajTyce.pocet}×(${String(p.vydajTyce.tycMm / 1000).replace('.', ',')} m)`
								: '—'}</td
						>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<div class="card">
		<div class="sec">Komponenty (spojky, krytky) — {komponenty.length} typov</div>
		<p class="sub noprint">
			Kusové komponenty vyčítané z reálnych výkresov (spojky, krytky, rámové/zakladacie lišty).
			<b>Zatiaľ len TYPY</b> — počty a Money kódy čakajú na tabuľky od Dominika. „—" pri počte = bez
			potvrdeného pravidla, nič sa nehádže. CAD kód je informatívny (<b>NIE</b> Money odpisový kód).
			<b>Do Money sa neposiela nič.</b>
		</p>
		{#if komponenty.length === 0}
			<p class="sub" data-testid="komponenty-prazdne">
				Pre systém {vstup.system} zatiaľ nemáme vyčítané žiadne komponenty.
			</p>
		{:else}
			<table class="narez" data-testid="komponenty-tabulka">
				<thead>
					<tr><th>Typ</th><th>Kde sa používa</th><th>CAD kód</th><th>Počet ks</th></tr>
				</thead>
				<tbody>
					{#each komponenty as k (k.typ)}
						<tr>
							<td>{k.typ}{k.poznamka ? ` · ${k.poznamka}` : ''}</td>
							<td>{k.kdePouzity}</td>
							<td data-testid="komponent-kod">{k.kodCad ?? '—'}</td>
							<td data-testid="komponent-pocet"><b>{k.pocetKs ?? '—'}</b></td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>

	<div class="card">
		<div class="sec">Informatívne výpočty</div>
		<div data-testid="narez-informativne">
			<div class="row">
				<span>Predná svetlosť</span><b>{vysledok.informativne.prednaSvetlost} mm</b>
			</div>
			{#if vysledok.informativne.efektivnaSvetlost !== vysledok.informativne.prednaSvetlost}
				<div class="row" data-testid="info-efektivna-svetlost">
					<span>Efektívna svetlosť (výstuha 200×140: −60)</span>
					<b>{vysledok.informativne.efektivnaSvetlost} mm</b>
				</div>
			{/if}
			{#if vysledok.informativne.vystuhaProfil}
				<div class="row" data-testid="info-vystuha-profil">
					<span>Profil výstuhy</span><b>{vysledok.informativne.vystuhaProfil}</b>
				</div>
			{/if}
			<div class="row">
				<span>Predná noha (svetlosť + 15)</span><b>{vysledok.informativne.prednaNohaDlzka} mm</b>
			</div>
			<div class="row">
				<span>Zadná noha</span>
				<b
					>{vysledok.informativne.zadnaNohaDlzka === null
						? '— (na stenu)'
						: `${vysledok.informativne.zadnaNohaDlzka} mm`}</b
				>
			</div>
			<div class="row">
				<span>Rozostup predných nôh (dopočítaný)</span>
				<b
					>{vysledok.informativne.rozostupPrednychNoh === null
						? '—'
						: `${vysledok.informativne.rozostupPrednychNoh} mm`}</b
				>
			</div>
			<div class="row">
				<span>Počet priečok (max rozostup {MAX_ROZOSTUP_PRIECOK} mm)</span><b
					>{vysledok.informativne.pocetPriecok}</b
				>
			</div>
			<div class="row">
				<span>Výstuha medzi nohami (šírka − 280)</span>
				<b data-testid="vystuha-rez">{vysledok.informativne.vystuhaRezMm} mm</b>
			</div>
		</div>
		<p class="sub">
			Výstuha je informatívna — profil (Robust 250×110/230×110, Massive 200×140) a per-systém
			varianta (šírka − 2×noha) čakajú na potvrdenie (O2/O3).
		</p>
	</div>

	{#if vstup.strechaSklo || vstup.obvodoveZasklenie || vstup.zvodFrezovat}
		<div class="card">
			<div class="sec">Údaje zákazky (výkres) — informatívne</div>
			<div data-testid="narez-udaje-zakazky">
				{#if vstup.strechaSklo}
					<div class="row"><span>Strecha — sklo</span><b>{vstup.strechaSklo}</b></div>
				{/if}
				{#if vstup.obvodoveZasklenie}
					<div class="row"><span>Obvodové zasklenie</span><b>{vstup.obvodoveZasklenie}</b></div>
				{/if}
				<div class="row">
					<span>ZVOD — frézovanie SH</span>
					<b
						>{vstup.zvodFrezovat && vstup.zvodFrezovanieSHmm != null
							? `${vstup.zvodFrezovanieSHmm} mm`
							: 'nefrézovať'}</b
					>
				</div>
			</div>
			<p class="sub">
				Sklá sú informatívny údaj (Zasklenia má vlastný odpis). Frézovanie zvodu je evidencia na
				výkrese — výrobný detail dopĺňa konštruktér (#161). <b>Do Money sa neposiela nič.</b>
			</p>
		</div>
	{/if}

	<div class="card">
		<div class="sec">Zatiaľ nepodporované (čaká na pravidlá)</div>
		<ul data-testid="narez-nepodporovane" style="margin:6px 0 0;padding-left:18px">
			{#each vysledok.nepodporovane as n (n)}
				<li style="margin:4px 0">{n}</li>
			{/each}
		</ul>
	</div>

	<div class="card noprint">
		<div class="sec">Rezervačný odpis do Money</div>
		<p class="sub">
			Rezervuje materiál v Money už pri zadaní objednávky. Do odpisu idú LEN <b>potvrdené</b>
			položky vyššie; „zatiaľ nepočítané" (napr. priečka = HH krovu) sa NEZAHRNÚ. Bez +20 % rezervy. Odpis
			sa odošle až po tvojom potvrdení.
			{#if !data.live}<b>🧪 TEST režim — do Money nejde nič.</b>{/if}
		</p>
		{#if rezError}
			<div class="err" data-testid="rez-error">⚠️ {rezError}</div>
		{/if}
		<form method="POST" action="?/rezervovat">
			{@render hidden()}
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
			<button class="btn" type="submit" data-testid="pripravit-rezervaciu"
				>Pripraviť rezervačný odpis →</button
			>
		</form>
	</div>

	<div class="card noprint">
		<button class="btn secondary" onclick={() => window.print()}>🖨 Tlačiť / uložiť PDF</button>
		<form method="POST" action="?/upravit" style="display:inline">
			{@render hidden()}
			<button class="btn secondary" type="submit" data-testid="upravit">← Späť a upraviť</button>
		</form>
		<a class="btn secondary" href={resolve('/pergola/narez')}>➕ Nový výpočet</a>
	</div>
{:else if step === 'rez-nahlad' && rozpis}
	<div class="card">
		<h1 data-testid="rez-nadpis">Rezervačný odpis — {ident.zak} · {ident.zakaznik}</h1>
		<p class="sub">
			<span class="badge">Pergola · {rozpis.pocetPolozok} položiek</span>
			{#if !data.live}<span class="badge test">🧪 TEST — do Money NEJDE</span>{/if}
		</p>
	</div>

	{#if rezError}
		<div class="err" data-testid="rez-nahlad-error">⚠️ {rezError}</div>
	{/if}

	{#if rozpis.longNotes.length}
		<div class="warn">
			<b>⚠ Dlhé profily (rez &gt; tyč)</b> — riešené kombináciou tyčí. Pri <b>žľabe</b> over, že spoj
			vyjde nad nohu pergoly.
		</div>
	{/if}

	<div class="card">
		<div class="sec">Money rozpis — {rozpis.nonzero.length} položiek</div>
		<p class="sub noprint">
			Množstvá sú metre surových tyčí (bin-packing, presne ako klasický CAD odpis). Do Money sa po
			potvrdení pošle presne toto.
		</p>
		<table class="narez" data-testid="rez-rozpis">
			<thead><tr><th>Money kód</th><th>Názov</th><th>Množstvo</th></tr></thead>
			<tbody>
				{#each rozpis.nonzero as o (o.kod)}
					<tr>
						<td>{o.kod}</td>
						<td>{o.nazov}</td>
						<td><b>{fmtM(o.qty)} m</b></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	{#if rozpis.vylucene.length}
		<div class="card">
			<div class="sec">Zatiaľ nepočítané — NIE sú v odpise ({rozpis.vylucene.length})</div>
			<p class="sub">
				Počet je istý, dĺžku rezu ešte nemáme (napr. priečka = HH krovu #161). Do rezervácie sa
				<b>NEZAHŔŇAJÚ</b> — nikdy vymyslené číslo. Doplní ich neskôr aktualizácia na reálne čísla.
			</p>
			<ul data-testid="rez-vylucene" style="margin:6px 0 0;padding-left:18px">
				{#each rozpis.vylucene as v (v.kod + v.nazov)}
					<li style="margin:4px 0" class="sub">{v.kod} · {v.nazov} — {v.dovod}</li>
				{/each}
			</ul>
		</div>
	{/if}

	<div class="card noprint">
		<form method="POST" action="?/odoslat" style="display:inline">
			{@render hidden()}
			{@render hiddenIdent()}
			<button class="btn" type="submit" data-testid="odoslat-rezervaciu">
				{data.live
					? '✅ Odoslať rezervačný odpis do Money'
					: '🧪 Odoslať rezervačný odpis (TEST priečinok)'}
			</button>
		</form>
		<form method="POST" action="?/upravit" style="display:inline">
			{@render hidden()}
			<button class="btn secondary" type="submit">← Upraviť zadanie</button>
		</form>
	</div>
{:else if step === 'rez-hotovo' && outcome}
	<div class="card">
		<h1 data-testid="rez-hotovo-nadpis">Rezervácia hotová — {ident.zak} · {ident.zakaznik}</h1>
	</div>

	<div class="okmsg" data-testid="rez-vysledok">
		{#if !outcome.live}
			🧪 TEST — do Money NEJDE (testovací priečinok): <b>{outcome.filename}</b>
		{:else}
			✅ Rezervácia odoslaná do Money na import: <b>{outcome.filename}</b>
		{/if}
	</div>

	{#if rozpis}
		<div class="card">
			<div class="sec">Rezervované — Money rozpis ({rozpis.nonzero.length} položiek)</div>
			<table class="narez">
				<thead><tr><th>Money kód</th><th>Názov</th><th>Množstvo</th></tr></thead>
				<tbody>
					{#each rozpis.nonzero as o (o.kod)}
						<tr><td>{o.kod}</td><td>{o.nazov}</td><td><b>{fmtM(o.qty)} m</b></td></tr>
					{/each}
				</tbody>
			</table>
			{#if rozpis.vylucene.length}
				<p class="sub">
					Nezahrnuté (zatiaľ nepočítané): {rozpis.vylucene.map((v) => v.kod).join(', ')}
				</p>
			{/if}
		</div>
	{/if}

	<div class="card noprint">
		<a class="btn secondary" href={resolve('/pergola/narez')}>➕ Nová rezervácia</a>
		<a class="btn secondary" href={resolve('/odpisy')}>📋 História odpisov</a>
	</div>
{/if}

<style>
	table.narez {
		width: 100%;
		border-collapse: collapse;
		font-size: 14px;
	}
	table.narez th,
	table.narez td {
		text-align: left;
		padding: 7px 10px;
		border-bottom: 1px solid #e2e8f0;
	}
	table.narez th {
		color: #475569;
		font-weight: 600;
		font-size: 13px;
	}
	table.narez td:last-child,
	table.narez th:last-child {
		text-align: center;
		width: 90px;
	}

	/* Landscape tlač LEN pre túto route (route-CSS-splitting, vykres.md) — výkres je
	   A4 na šírku; nedotýka sa portrait tlače iných stránok. */
	@media print {
		@page {
			size: A4 landscape;
			margin: 6mm;
		}
	}
</style>
