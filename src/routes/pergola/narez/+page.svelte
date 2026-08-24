<script lang="ts">
	// Pergola — REZERVAČNÝ ODPIS z rozmerov (#221, pôvodne „Materiál z rozmerov" #155).
	// Formulár(rozmery) → výsledok(materiál + výkres #194) → [ZAK/OP/zákazník] → Money
	// rozpis(nahlad) → explicitné potvrdenie → zápis (rez-hotovo). Rezervuje materiál v
	// Money už pri zadaní objednávky, bez +20 %; do odpisu idú LEN potvrdené položky,
	// honest-null ostáva „zatiaľ nepočítané". Vzorcový engine (spocitajNarez) je čistý;
	// Money most žije v $lib/server/pergola-rezervacia. Vzor UX = /bazen/navrh + /pergola
	// (nova-stranka §3/§4/§6). Výkres kreslí PergolaNarezVykres z potvrdených vzorcov (#194).
	//
	// #239 — monolit (1231 r.) rozdelený na krokové subkomponenty (src/lib/components/
	// pergola/*). Tento súbor je ROZHRANIE: state + compute hub + serializačné snippety
	// (`hidden`/`hiddenIdent` = single source of truth serializácie). Deti sú prezentácia
	// (RezVysledok/RezNahlad/RezHotovo) alebo viditeľné vstupy bindujúce rodičov stav
	// (RezForm 18× $bindable, RucnePolozky bind:rucneRiadky). Round-trip disciplína
	// (.claude/rules/pergola-narez.md): `$effect` echo + oba snippety ostávajú TU nezmenené.
	import { resolve } from '$app/paths';
	import RezForm from '$lib/components/pergola/RezForm.svelte';
	import RezVysledok from '$lib/components/pergola/RezVysledok.svelte';
	import RucnePolozky from '$lib/components/pergola/RucnePolozky.svelte';
	import RezNahlad from '$lib/components/pergola/RezNahlad.svelte';
	import RezHotovo from '$lib/components/pergola/RezHotovo.svelte';
	import OdpisBlok from '$lib/components/OdpisBlok.svelte';
	import {
		spocitajNarez,
		komponentyPergoly,
		PREDNA_SVETLOST_STD,
		type PergolaNarezVstup,
		type PergolaSystem,
		type Uchytenie,
		type HornyProfil,
		type VystuhaProfil
	} from '$lib/pergola-narez';
	import { krovUlozenie } from '$lib/pergola-krov';
	import type { RucnaPolozka } from '$lib/pergola-rucne';

	let { data, form } = $props();

	let step = $derived(form?.step ?? 'form');

	// #221 — rezervačný odpis: echo ident + Money rozpis + výsledok
	let ident = $derived(
		(form && 'ident' in form ? form.ident : null) ?? { zak: '', op: '', zakaznik: '' }
	);
	let rozpis = $derived(form && 'rozpis' in form ? form.rozpis : null);
	let outcome = $derived(form && 'outcome' in form ? form.outcome : null);
	let rezError = $derived(form && 'rezError' in form ? form.rezError : null);
	// cenový blok (#232, display-only) — LEN interní; b2b nikdy nedostane `ceny`
	let ceny = $derived(form && 'ceny' in form ? form.ceny : null);

	// vstup na výpočet výsledku (display-only). Merge form?.vstup s predvolenými hodnotami
	// — rovnaká disciplína ako /bazen/navrh.
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
		pocetKrovov: form?.vstup?.pocetKrovov ?? null,
		// #206 nové polia
		jednoduchaBezZasklenia: form?.vstup?.jednoduchaBezZasklenia ?? false,
		vystuhaProfil: (form?.vstup?.vystuhaProfil ?? null) as VystuhaProfil | null,
		zvodFrezovat: form?.vstup?.zvodFrezovat ?? false,
		zvodFrezovanieSHmm: form?.vstup?.zvodFrezovanieSHmm ?? null,
		strechaSklo: form?.vstup?.strechaSklo ?? '',
		obvodoveZasklenie: form?.vstup?.obvodoveZasklenie ?? ''
	} satisfies PergolaNarezVstup);

	// editovateľné polia — $state + bind (nova-stranka §4: jednosmerné value={} sa pri
	// re-renderi vymaže). Bindujú sa do RezForm; rodič ostáva ich zdrojom, aby `hidden()`
	// snippet + `$effect` echo (round-trip) sedeli.
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
	// #161 — voliteľný MANUÁLNY počet krovov (Dominik 21.8.); prázdne = auto fallback
	let pocetKrovovS = $state<number | string>('');
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

	// #234 — ručné („pometrané") položky: zdroj pravdy v rodičovi (serializuje sa do hidden
	// JSON inputu, round-trip vzor PR #81; server ho prepočíta znova, nedôveruje klientovi).
	// RucnePolozky ho `bind`-uje; `$effect` nižšie ho echuje z form.
	let rucneRiadky = $state<RucnaPolozka[]>([]);

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
		pocetKrovovS = v?.pocetKrovov ?? '';
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
		// #234 — echo ručných riadkov z form (round-trip: prežijú „Späť a upraviť")
		const rc = form && 'rucne' in form ? form.rucne : null;
		rucneRiadky = Array.isArray(rc) ? (rc as RucnaPolozka[]) : [];
	});

	let vysledok = $derived(step === 'vysledok' ? spocitajNarez(vstup) : null);
	// #195 — kusové komponenty (spojky, krytky) relevantné pre zvolený systém (display-only)
	let komponenty = $derived(step === 'vysledok' && vysledok ? komponentyPergoly(vstup) : []);
	// #161 — krov uloženie z potvrdených vzorcov, len keď je sklon zadaný
	let krov = $derived(
		step === 'vysledok' && vstup.sklonStrechy != null ? krovUlozenie(vstup.sklonStrechy) : null
	);

	// #222 — stavové zhrnutie na prvý pohľad. Split je PRESNE ten, čo používa
	// pergola-rezervacia pre Money: položka s dĺžkou rezu (`dlzkaRezuMm != null`,
	// nenulový počet) ide do rezervácie = „spočítané"; `dlzkaRezuMm == null` = počet
	// istý, dĺžka čaká; `nepodporovane[]` = čaká na pravidlo. Nič nové sa nepočíta.
	let spocitaneCount = $derived(
		vysledok ? vysledok.vypocitane.filter((p) => p.dlzkaRezuMm != null && p.pocetKs > 0).length : 0
	);
	let cakaDlzkaCount = $derived(
		vysledok ? vysledok.vypocitane.filter((p) => p.dlzkaRezuMm == null).length : 0
	);
	let cakaPravidloCount = $derived(vysledok ? vysledok.nepodporovane.length : 0);
	let cakaCount = $derived(cakaDlzkaCount + cakaPravidloCount);
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
	{#if pocetKrovovS !== ''}<input type="hidden" name="pocetKrovov" value={pocetKrovovS} />{/if}
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
	<!-- #234 — ručné položky ako JSON (round-trip cez celý tok, vzor PR #81) -->
	<input type="hidden" name="rucnePolozky" value={JSON.stringify(rucneRiadky)} />
{/snippet}

{#snippet hiddenIdent()}
	<input type="hidden" name="zak" value={zakS} />
	<input type="hidden" name="op" value={opS} />
	<input type="hidden" name="zakaznik" value={zakaznikS} />
{/snippet}

{#if step === 'form'}
	<RezForm
		live={data.live}
		error={form && 'error' in form ? form.error : undefined}
		{hiddenIdent}
		{rucneRiadky}
		bind:systemS
		bind:sirkaS
		bind:hlbkaS
		bind:prednaSvetlostS
		bind:vyskaZadnaS
		bind:pocetPrednychNohS
		bind:uchytenieS
		bind:pocetZadnychNohS
		bind:hornyProfilZadnejS
		bind:prieckaLightS
		bind:zosilnenyNosnikS
		bind:sklonStrechyS
		bind:pocetKrovovS
		bind:jednoduchaBezZaskleniaS
		bind:vystuhaProfilS
		bind:zvodFrezovatS
		bind:zvodFrezovanieSHmmS
		bind:strechaSkloS
		bind:obvodoveZasklenieS
	/>
{:else if step === 'vysledok' && vysledok}
	<RezVysledok
		{vstup}
		{vysledok}
		{komponenty}
		{krov}
		{spocitaneCount}
		{cakaCount}
		{cakaDlzkaCount}
		{cakaPravidloCount}
		datumIso={data.datumIso}
		live={data.live}
	/>

	<RucnePolozky bind:rucneRiadky catalog={data.catalog ?? []} />

	<div class="card noprint">
		<div class="sec">Rezervačný odpis do Money</div>
		<p class="sub">
			Do odpisu idú LEN spočítané položky vyššie (bez +20 % rezervy). Odpis sa odošle až po tvojom
			potvrdení.
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
			{@render hiddenIdent()}
			<button class="btn secondary" type="submit" data-testid="upravit">← Späť a upraviť</button>
		</form>
		<a class="btn secondary" href={resolve('/pergola/narez')}>➕ Nový výpočet</a>
	</div>
{:else if step === 'rez-nahlad' && rozpis}
	<RezNahlad
		{rozpis}
		ceny={ceny ?? null}
		{ident}
		rezError={rezError ?? null}
		live={data.live}
		{hidden}
		{hiddenIdent}
	/>
{:else if step === 'rez-hotovo' && outcome}
	<RezHotovo {ident} {outcome} rozpis={rozpis ?? null} />
{:else if step === 'blocked' && form && 'rawEntries' in form && form.rawEntries}
	<OdpisBlok
		rawEntries={form.rawEntries}
		blokReason={form.blokReason}
		blokAction={form.blokAction}
		error={form.rezError ?? ''}
	/>
{/if}

<style>
	/* Landscape tlač LEN pre túto route (route-CSS-splitting, vykres.md) — výkres je
	   A4 na šírku; nedotýka sa portrait tlače iných stránok. Ostatné (page-lokálne)
	   CSS presunuté do príslušných komponentov (#239); zdieľané `table.narez`/
	   `.badge.rucne` do app.css. */
	@media print {
		@page {
			size: A4 landscape;
			margin: 6mm;
		}
	}
</style>
