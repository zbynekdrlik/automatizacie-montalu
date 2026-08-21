<script lang="ts">
	// Krok „form" — zadanie rozmerov objednávky. Vyčlenené z pergola/narez/+page.svelte
	// (#239). Editovateľné polia sú `$bindable` (rodič ostáva zdrojom stavu + serializácie
	// — vzor `KlinPolia.svelte`): rodičov `$effect` echo + `hidden()`/`hiddenIdent()`
	// snippety sa nedotýkajú, tak round-trip disciplína (pergola-narez.md) zostáva.
	// Viditeľné vstupy majú `name=` → submitnú sa priamo; `hiddenIdent` (snippet z rodiča) +
	// inline `rucnePolozky` JSON prežijú `form→vysledok` (round-trip vzor PR #81).
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import {
		PREDNA_SVETLOST_STD,
		ZVOD_SH_MAX,
		svetlostMedziKrovmi,
		type PergolaSystem,
		type Uchytenie,
		type HornyProfil,
		type VystuhaProfil
	} from '$lib/pergola-narez';
	import type { RucnaPolozka } from '$lib/pergola-rucne';

	let {
		live,
		error,
		hiddenIdent,
		rucneRiadky = [],
		systemS = $bindable('Robust'),
		sirkaS = $bindable(5000),
		hlbkaS = $bindable(3500),
		prednaSvetlostS = $bindable(PREDNA_SVETLOST_STD),
		vyskaZadnaS = $bindable(2900),
		pocetPrednychNohS = $bindable(4),
		uchytenieS = $bindable('stena'),
		pocetZadnychNohS = $bindable(4),
		hornyProfilZadnejS = $bindable(140),
		prieckaLightS = $bindable(false),
		zosilnenyNosnikS = $bindable(false),
		sklonStrechyS = $bindable(''),
		pocetKrovovS = $bindable(''),
		jednoduchaBezZaskleniaS = $bindable(false),
		vystuhaProfilS = $bindable(''),
		zvodFrezovatS = $bindable(false),
		zvodFrezovanieSHmmS = $bindable(''),
		strechaSkloS = $bindable(''),
		obvodoveZasklenieS = $bindable('')
	}: {
		live: boolean;
		error?: string | null;
		hiddenIdent: Snippet;
		rucneRiadky?: RucnaPolozka[];
		systemS?: PergolaSystem;
		sirkaS?: number | string;
		hlbkaS?: number | string;
		prednaSvetlostS?: number | string;
		vyskaZadnaS?: number | string;
		pocetPrednychNohS?: number | string;
		uchytenieS?: Uchytenie;
		pocetZadnychNohS?: number | string;
		hornyProfilZadnejS?: HornyProfil;
		prieckaLightS?: boolean;
		zosilnenyNosnikS?: boolean;
		sklonStrechyS?: number | string;
		pocetKrovovS?: number | string;
		jednoduchaBezZaskleniaS?: boolean;
		vystuhaProfilS?: VystuhaProfil | '';
		zvodFrezovatS?: boolean;
		zvodFrezovanieSHmmS?: number | string;
		strechaSkloS?: string;
		obvodoveZasklenieS?: string;
	} = $props();

	// #161 — živý náhľad svetlosti medzi krovmi pre zadaný počet (Dominik podľa nej pridá/uberie
	// krov). null keď počet < 2 alebo neplatné — nikdy NaN.
	const pocetKrovovN = $derived(
		Number(pocetKrovovS) >= 2 ? Math.round(Number(pocetKrovovS)) : null
	);
	const svetlostHint = $derived(svetlostMedziKrovmi(Number(sirkaS) || 0, pocetKrovovN));
</script>

<div class="card">
	<h1>Rezervačný odpis — pergola</h1>
	<p class="sub">
		Zadaj rozmery objednávky — z <b>potvrdených</b> vzorcov spočítam materiál a rezervujem ho v
		Money už pri zadaní objednávky (aby ti materiál neušiel). Do rezervácie idú LEN spočítané
		položky, bez +20 % rezervy; odpis až po tvojom potvrdení.
		{#if !live}<b>Bežíme v 🧪 TEST režime — do Money nejde nič.</b>{/if}
	</p>
	<p class="sub">
		Klasický Money odpis z CAD nárezu je na
		<a href={resolve('/pergola')} data-testid="link-pergola">pôvodnej stránke Pergola</a>;
		zákaznícky výkres kreslí
		<a href={resolve('/pergola/navrh')} data-testid="link-navrh">Pergola návrh</a>.
	</p>
</div>

{#if error}
	<div class="err" data-testid="form-error">⚠️ {error}</div>
{/if}

<div class="card">
	<form method="POST" action="?/spocitat">
		{@render hiddenIdent()}
		<!-- #234 — ručné riadky prežijú aj cez formulárový krok (round-trip, PR #81) -->
		<input type="hidden" name="rucnePolozky" value={JSON.stringify(rucneRiadky)} />
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
							: 'bočný profil 110×43 pod kotviacim = ZV − 190'}
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
						<select id="hornyProfilZadnej" name="hornyProfilZadnej" bind:value={hornyProfilZadnejS}>
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
					Zosilnený nosník (profil zatiaľ čaká na vzorec od Dominika)
				</label>
			</div>
		</div>

		<div class="grid3">
			<div class="field">
				<label for="sklonStrechy">Sklon strechy (°) — uloženie krovu</label>
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
					voliteľné · ≥ 7° = <b>potvrdené</b> uloženie (prah 7°); pod 7° zatiaľ nepodporované. Frézovanie
					drážok ostáva na konštruktérovi.
				</p>
			</div>
			<div class="field">
				<label for="pocetKrovov">Počet krovov</label>
				<input
					id="pocetKrovov"
					name="pocetKrovov"
					type="number"
					min="2"
					max="50"
					step="1"
					placeholder="voliteľné"
					bind:value={pocetKrovovS}
				/>
				<p class="sub" style="margin:4px 0 0" data-testid="svetlost-hint">
					{#if svetlostHint != null}
						Svetlosť medzi krovmi: <b>{String(svetlostHint).replace('.', ',')} mm</b> — podľa nej pridaj/uber
						krov
					{:else}
						voliteľné · zadaj počet, ukážem svetlosť medzi krovmi
					{/if}
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
					<p class="sub" style="margin:4px 0 0">
						evidencia na výkrese; detail frézovania čaká na vzorec
					</p>
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
