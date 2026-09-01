<script lang="ts">
	// Krok „form" — zadanie rozmerov objednávky. Vyčlenené z pergola/narez/+page.svelte
	// (#239). Editovateľné polia sú `$bindable` (rodič ostáva zdrojom stavu + serializácie
	// — vzor `KlinPolia.svelte`): rodičov `$effect` echo + `hidden()`/`hiddenIdent()`
	// snippety sa nedotýkajú, tak round-trip disciplína (pergola-narez.md) zostáva.
	// Viditeľné vstupy majú `name=` → submitnú sa priamo; `hiddenIdent` (snippet z rodiča) +
	// inline `rucnePolozky` JSON prežijú `form→vysledok` (round-trip vzor PR #81).
	import type { Snippet } from 'svelte';
	import {
		PREDNA_SVETLOST_STD,
		ZVOD_SH_MAX,
		POCET_KROVOV_MIN,
		POCET_KROVOV_MAX,
		svetlostMedziKrovmi,
		type PergolaSystem,
		type Uchytenie,
		type HornyProfil,
		type VystuhaProfil
	} from '$lib/pergola-narez';
	// #223 — katalóg typov strešného skla (výber pre vzorec šírky + cenu)
	import { SKLO_STRECHA_TYPY } from '$lib/sklo-strecha';
	import type { RucnaPolozka } from '$lib/pergola-rucne';
	// #378 — FIX (bočné pevné zasklenie): tvar + limity polí/rozmeru
	import { FIX_MAX_POLI, FIX_MAX, type FixTvar } from '$lib/fix';

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
		strechaSkloTypS = $bindable(''),
		strechaSkloS = $bindable(''),
		obvodoveZasklenieS = $bindable(''),
		// #378 — „pergola s FIXom": bočné pevné zasklenie (auto-odvodenie rozmerov z
		// pergoly s override); DISPLAY-ONLY + Money-neutrálne
		fixPoliaJSON = '[]',
		pergolaSFixomS = $bindable(false),
		fixAutoS = $bindable(true),
		fixSirkaS = $bindable(''),
		fixV1S = $bindable(''),
		fixV2S = $bindable(''),
		fixTvarS = $bindable('sikmy'),
		fixPocetPoliS = $bindable(1),
		fixZrkadloS = $bindable(false),
		fixSkloS = $bindable(''),
		fixPoznamkaS = $bindable('')
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
		strechaSkloTypS?: string;
		strechaSkloS?: string;
		obvodoveZasklenieS?: string;
		fixPoliaJSON?: string;
		pergolaSFixomS?: boolean;
		fixAutoS?: boolean;
		fixSirkaS?: number | string;
		fixV1S?: number | string;
		fixV2S?: number | string;
		fixTvarS?: FixTvar;
		fixPocetPoliS?: number;
		fixZrkadloS?: boolean;
		fixSkloS?: string;
		fixPoznamkaS?: string;
	} = $props();

	// #161 — živý náhľad svetlosti medzi krovmi pre zadaný počet (Dominik podľa nej pridá/uberie
	// krov). Zrkadlí serverovú validáciu: celé číslo v rozsahu (žiadne tiché zaokrúhlenie, aby
	// hint neukázal svetlosť pre 2,4, ktoré server odmietne). svetlostMedziKrovmi vráti null aj
	// pri zápornej/nulovej svetlosti (počet sa do šírky nezmestí).
	const pocetKrovovN = $derived(
		Number.isInteger(Number(pocetKrovovS)) &&
			Number(pocetKrovovS) >= POCET_KROVOV_MIN &&
			Number(pocetKrovovS) <= POCET_KROVOV_MAX
			? Number(pocetKrovovS)
			: null
	);
	const svetlostHint = $derived(svetlostMedziKrovmi(Number(sirkaS) || 0, pocetKrovovN));
</script>

<div class="card">
	<h1>Pergola z appky</h1>
	<p class="sub">
		Zadaj rozmery objednávky — z <b>potvrdených</b> vzorcov spočítam materiál a rezervujem ho v
		Money už pri zadaní objednávky (aby ti materiál neušiel). Do rezervácie idú LEN spočítané
		položky, bez +20 % rezervy; odpis až po tvojom potvrdení.
		{#if !live}<b>Bežíme v 🧪 TEST režime — do Money nejde nič.</b>{/if}
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
						<option value="200x140">200×140</option>
					{:else}
						<option value="110x110">110×110</option>
						<option value="110x250">110×250</option>
					{/if}
				</select>
				<p class="sub" style="margin:4px 0 0">
					Výstuha je skovaná 15 mm v žľabe a zvyšok trčí do svetlosti (noha = svetlosť + zvislý
					rozmer výstuhy); Robust varianty dĺžky zatiaľ nepodporované
				</p>
			</div>
		</div>

		<!-- Výška zadná (ZV): pri samostatne (zadné nohy) alebo stena+zasklená (bočný 110×43
		     pod kotviacim = ZV − 190, #206 b). Pri „jednoduchej bez zasklenia" na stene sa ZV
		     nepoužíva → pole skryté. -->
		<!-- ZV je potrebná aj pre bočný FIX (jeho výška pri stene = ZV), preto ju zobraz aj
		     keď je „Pergola s FIXom" zapnutá (#378) — inak by sa server (0) a klient (2900)
		     rozišli v konfigurácii stena+jednoduchá+FIX -->
		{#if uchytenieS === 'samostatne' || (uchytenieS === 'stena' && !jednoduchaBezZaskleniaS) || pergolaSFixomS}
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
							? 'zadná noha = ZV − horný profil zadnej konštrukcie (110/140)'
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
							určuje kód aj dĺžku celej zadnej konštrukcie (noha = ZV − profil, jednotná 110/140) a
							kaskádu bočného profilu 110×43 „pod fixom"
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

		<div class="field">
			<label for="strechaSkloTyp">Strešné sklo — typ (výpočet + cena)</label>
			<select id="strechaSkloTyp" name="strechaSkloTyp" bind:value={strechaSkloTypS}>
				<option value="">— nevybrané —</option>
				{#each SKLO_STRECHA_TYPY as t (t.nazov)}
					<option value={t.nazov}>{t.nazov}</option>
				{/each}
			</select>
			<p class="sub" style="margin:4px 0 0">
				šírka tabule = svetlosť medzi krovmi + 30 (sklo/STADUR) / + 34 (polykarbonát); dĺžka zatiaľ
				čaká na vzorec
			</p>
		</div>

		<div class="grid2">
			<div class="field">
				<label for="strechaSklo">Strecha — sklo (poznámka na výkres)</label>
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

		<!-- #378 — Pergola s FIXom: bočné pevné zasklenie, rozmery odvodené z pergoly
		     (auto) s možnosťou override. DISPLAY-ONLY + Money-neutrálne. -->
		<div class="field">
			<label style="display:flex;align-items:center;gap:8px;font-weight:400">
				<input
					id="pergolaSFixom"
					type="checkbox"
					name="pergolaSFixom"
					value="1"
					bind:checked={pergolaSFixomS}
					style="width:auto"
				/>
				🪟 Pergola s FIXom (bočné pevné zasklenie)
			</label>
		</div>

		{#if pergolaSFixomS}
			<div class="fix-box" data-testid="fix-sekcia">
				<!-- fixAuto ako hidden (checkbox by pri override neposlal nič → server by videl
				     default auto); fixPolia = JSON z rodiča (počet × šírka) -->
				<input type="hidden" name="fixAuto" value={fixAutoS ? '1' : '0'} />
				<input type="hidden" name="fixPolia" value={fixPoliaJSON} />
				<p class="sub" style="margin:0 0 10px" data-testid="fix-money-note">
					FIX sa spočíta a nakreslí ako súčasť tejto zákazky.
					<b>Do Money odpisu zatiaľ nejde</b> — FIX materiály (profily + sklo) nemajú v Money karty, doplní
					sa, keď ich Dominik založí (rovnako ako tesnenia a strešné sklo).
				</p>
				<div class="field">
					<label style="display:flex;align-items:center;gap:8px;font-weight:400">
						<input
							type="checkbox"
							data-testid="fix-auto"
							bind:checked={fixAutoS}
							style="width:auto"
						/>
						Rozmery odvodiť automaticky z pergoly (hĺbka + výšky)
					</label>
					<p class="sub" style="margin:4px 0 0" data-testid="fix-auto-hint">
						{fixAutoS
							? 'šírka = hĺbka, výška vpredu = predná svetlosť, výška vzadu = zadná výška (ZV); odškrtni pre ručný override'
							: 'ručný override — rozmery zadávaš sám'}
					</p>
				</div>
				<div class="field">
					<label for="fixTvar">Tvar FIXu</label>
					<select id="fixTvar" name="fixTvar" bind:value={fixTvarS} disabled={fixAutoS}>
						<option value="sikmy">Šikmý (šikmá horná hrana)</option>
						<option value="rovny">Rovný (pravouhlý)</option>
					</select>
				</div>
				<div class="grid3">
					<div class="field">
						<label for="fixSirka">Šírka FIXu (mm)</label>
						<input
							id="fixSirka"
							name="fixSirka"
							type="number"
							step="any"
							max={FIX_MAX}
							bind:value={fixSirkaS}
							readonly={fixAutoS}
						/>
					</div>
					<div class="field">
						<label for="fixV1">Výška vpredu (mm)</label>
						<input
							id="fixV1"
							name="fixV1"
							type="number"
							step="any"
							max={FIX_MAX}
							bind:value={fixV1S}
							readonly={fixAutoS}
						/>
					</div>
					{#if fixTvarS !== 'rovny'}
						<div class="field">
							<label for="fixV2">Výška vzadu / ZV (mm)</label>
							<input
								id="fixV2"
								name="fixV2"
								type="number"
								step="any"
								max={FIX_MAX}
								bind:value={fixV2S}
								readonly={fixAutoS}
							/>
						</div>
					{/if}
				</div>
				<div class="grid3">
					<div class="field">
						<label for="fixPocetPoli">Počet polí FIXu</label>
						<select id="fixPocetPoli" bind:value={fixPocetPoliS}>
							{#each Array(FIX_MAX_POLI) as _, i (i)}<option value={i + 1}>{i + 1}</option>{/each}
						</select>
					</div>
					<div class="field">
						<label style="display:flex;align-items:center;gap:8px;font-weight:400;margin-top:26px">
							<input
								id="fixZrkadlo"
								type="checkbox"
								name="fixZrkadlo"
								value="1"
								bind:checked={fixZrkadloS}
								style="width:auto"
							/>
							🔁 Zrkadlový kus (druhá strana)
						</label>
					</div>
				</div>
				<div class="grid2">
					<div class="field">
						<label for="fixSklo">FIX — sklo (na výkres)</label>
						<input
							id="fixSklo"
							name="fixSklo"
							type="text"
							maxlength="120"
							placeholder="napr. 4-8-4 IZO číre"
							bind:value={fixSkloS}
						/>
					</div>
					<div class="field">
						<label for="fixPoznamka">FIX — poznámka (na výkres)</label>
						<input
							id="fixPoznamka"
							name="fixPoznamka"
							type="text"
							maxlength="300"
							bind:value={fixPoznamkaS}
						/>
					</div>
				</div>
			</div>
		{/if}

		<button class="btn" type="submit" data-testid="spocitat">Spočítať materiál</button>
	</form>
</div>

<style>
	.fix-box {
		border: 1px solid #bfdbfe;
		background: #f8fbff;
		border-radius: 10px;
		padding: 12px 14px 4px;
		margin-bottom: 12px;
	}
</style>
