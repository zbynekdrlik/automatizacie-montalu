<script lang="ts">
	// Verejný zákaznícky konfigurátor hliníkového oplotenia a brán (#388, etapa 5 jednotného rámu #384;
	// #410 orientačná cena). JEDNODUCHÁ jednostĺpcová stránka (zámerne bez 3D — dispatch: 3D NErob, tier B).
	// Konfigurácia (typ/model/výška/šírka/počet/farba) sa počíta ČISTO klientsky (`$derived`); ORIENTAČNÚ
	// cenu (#410) počíta SERVER na klik (`vypocet` akcia, enhance submit — cenový modul je server-only, do
	// klienta sa nedostane) a všetko tečie do zdieľaného DopytForm (#277) → PDF špecifikácia s orientačnou
	// cenou + Odoo lead. Zdieľané `--k-*` tokeny z `konfigurator/+layout.svelte`. Money-neutralita:
	// importuje LEN client-safe `konfigurator-oplotenie` + DopytForm + LEN TYPY ceny (guard:
	// konfigurator-money-safety). Žiadne `console.*`.
	import { untrack } from 'svelte';
	import KonfProduktStranka from '$lib/components/konfigurator/KonfProduktStranka.svelte';
	import { enhance } from '$app/forms';
	import DopytForm from '$lib/components/DopytForm.svelte';
	import RozmerStepper from '$lib/components/konfigurator/RozmerStepper.svelte';
	import { mmNaMetreText } from '$lib/konfigurator-jednotky';
	import {
		oplotenieTyp,
		oplotenieModel,
		oplotenieTypNazov,
		oplotenieVstupPlatny,
		konfigurujOplotenie,
		oploteniePonukaConfig,
		type OplotenieVstup
	} from '$lib/konfigurator-oplotenie';
	import type { PonukaConfig } from '$lib/ponuka';
	// #410: typy orientačnej ceny (server-počítanej `vypocet` akciou). LEN typy → žiadny import
	// cenového/Money modulu do klientskeho bundle (leak-guard A ostáva zelený).
	import type { VerejnaCena, CenaModelu } from '$lib/konfigurator';

	let { data } = $props();

	const r = $derived(data.rozmedzia);

	// východiskové voľby zo servera + rozumné stredové rozmery (v platných rozmedziach → súhrn hneď).
	// `untrack` v $state initializeri (rovnaký vzor ako bazén/pergola +page.svelte) — inak Svelte varuje
	// „state_referenced_locally" pri čítaní `data` mimo derived.
	let typ = $state<string>(untrack(() => data.defaulty.typ));
	let model = $state<string>(untrack(() => data.defaulty.model));
	let farba = $state<string>(untrack(() => data.farby[0]?.kod ?? ''));
	// rozmery = RozmerStepper (metre, #333 vzor) — clamp na [min,max], NIKDY null (súhrn/dopyt tak pri
	// editovaní rozmerov nezmizne); počet ks = <select> (1..40, tiež nikdy null).
	let vyska = $state<number | null>(1500);
	let sirka = $state<number | null>(2000);
	let pocet = $state<number>(1);
	// možnosti počtu kusov (1..40) — select nikdy nevráti mimo-rozmedzia/null hodnotu
	const pocetOpts = $derived(
		Array.from(
			{ length: data.rozmedzia.pocet.max - data.rozmedzia.pocet.min + 1 },
			(_, i) => data.rozmedzia.pocet.min + i
		)
	);

	// display label farby („RAL 7016 ANTRACIT") — do dopytu/PDF ide label, nie holý kód (vzor bazén)
	const farbaLabel = $derived.by(() => {
		const f = data.farby.find((x) => x.kod === farba);
		return f ? `RAL ${f.kod} ${f.nazov}` : farba;
	});

	const vstup = $derived<OplotenieVstup>({
		typ: oplotenieTyp(typ),
		model: oplotenieModel(model),
		vyska: vyska ?? 0,
		sirka: sirka ?? 0,
		pocet,
		farba: farbaLabel
	});

	const platny = $derived(oplotenieVstupPlatny(vstup));
	const suhrn = $derived(platny ? konfigurujOplotenie(vstup) : null);
	const ponukaCfg = $derived<PonukaConfig>(suhrn ? oploteniePonukaConfig(suhrn) : {});

	// #427: cenníková rozmerová obálka zvoleného TYPU (per-typ; server ju posiela v `data.obalky` — LEN
	// rozmery, žiadna cena). Zákazník tak vidí PLATNÝ katalógový rozsah namiesto „nemej steny", a keď je
	// zadaný rozmer mimo obálky, čestne to povieme (cena na vyžiadanie). ATYP = výplň na mieru (bez obálky).
	const typNazov = $derived(oplotenieTypNazov(oplotenieTyp(typ)));
	const jeAtyp = $derived(oplotenieModel(model) === 'ATYP');
	const obalka = $derived(data.obalky[oplotenieTyp(typ)]);
	// „mimo obálky" = rozmer prekročí max o VIAC než pol katalógovej mriežky (r.krok), teda by sa
	// zaokrúhlil ZA obálku a cena by bola na vyžiadanie. Pod-flagujeme (bezpečný smer): pri hraničnom
	// rozmere radšej hlášku nezobrazíme, než by sme falošne tvrdili „mimo" pri rozmere, čo cenu ešte dostane.
	const mimoObalky = $derived(
		!jeAtyp &&
			((sirka ?? 0) > obalka.sirka.maxMm + r.sirka.krok / 2 ||
				(vyska ?? 0) > obalka.vyska.maxMm + r.vyska.krok / 2)
	);

	// #410: orientačná cena — server-počítaná (`vypocet` akcia, enhance submit, žiadny reload). Zobrazí
	// sa až po kliku „Zobraziť orientačnú cenu" (vzor bazénovej `vypocet`); pri zmene ktoréhokoľvek
	// cenotvorného vstupu sa výsledok považuje za neaktuálny (`cenaAktualna`), takže sa NIKDY neukáže
	// cena pre iný typ/model/rozmer/počet.
	let cenaVysledok = $state<{ cena: VerejnaCena; cenyModely: CenaModelu[] } | null>(null);
	let cenaError = $state<string | null>(null);
	let cenaNacitava = $state(false);
	let poslednyKluc = $state<string | null>(null);
	const cenaKluc = $derived(`${vstup.typ}|${vstup.model}|${vyska ?? 0}|${sirka ?? 0}|${pocet}`);
	const cenaAktualna = $derived(cenaVysledok !== null && poslednyKluc === cenaKluc);

	const eur = (n: number) =>
		n.toLocaleString('sk-SK', {
			style: 'currency',
			currency: 'EUR',
			minimumFractionDigits: 2,
			maximumFractionDigits: 2
		});

	function scrollNa(id: string) {
		document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
</script>

<KonfProduktStranka
	titul="Navrhni si hliníkové oplotenie a brány — Montalu"
	popis="Zostav si hliníkové oplotenie na mieru — vyber typ (plotový diel, krídlová, posuvná či samonosná brána, vchodová bránka), model výplne, rozmery a farbu, zobraz si orientačnú cenu a pošli nezáväzný dopyt so špecifikáciou v PDF."
	foto="oplotenie.webp"
	alt="Dizajnové hliníkové oplotenie Montalu"
	label="Konfigurátor oplotenia a brán"
	nadpis="Navrhni si hliníkové oplotenie"
	lead="Vyber typ prvku, dizajn výplne, rozmery a farbu — zobraz si orientačnú cenu a pošli nezáväzný dopyt so špecifikáciou (PDF). Presnú, záväznú cenu pripravíme po obhliadke. Bez registrácie."
>
	{#snippet ovladacie()}
		<!-- TYP PRVKU -->
		<fieldset class="kp-blok">
			<legend>Typ prvku</legend>
			<div class="kp-karty">
				{#each data.typy as t (t.kod)}
					<button
						type="button"
						class="kp-karta"
						class:vybrana={typ === t.kod}
						aria-pressed={typ === t.kod}
						data-testid="oplotenie-typ-{t.kod}"
						onclick={() => (typ = t.kod)}
					>
						<span class="kp-karta-nazov">{t.nazov}</span>
						<span class="kp-karta-popis">{t.popis}</span>
					</button>
				{/each}
			</div>
		</fieldset>

		<!-- MODEL / DIZAJN VÝPLNE -->
		<fieldset class="kp-blok">
			<legend>Dizajn výplne</legend>
			<div class="kp-karty">
				{#each data.modely as m (m.kod)}
					<button
						type="button"
						class="kp-karta"
						class:vybrana={model === m.kod}
						aria-pressed={model === m.kod}
						data-testid="oplotenie-model-{m.kod}"
						onclick={() => (model = m.kod)}
					>
						<span class="kp-karta-nazov">{m.kod}</span>
						<span class="kp-karta-popis">{m.popis}</span>
					</button>
				{/each}
			</div>
		</fieldset>

		<!-- ROZMERY — metrové steppery (#333 RozmerStepper) + počet ks -->
		<fieldset class="kp-blok">
			<legend>Rozmery</legend>
			<div class="kp-steppery">
				<RozmerStepper
					bind:hodnotaMm={vyska}
					min={r.vyska.min}
					max={r.vyska.max}
					krokMm={r.vyska.krok}
					popis="Výška (A)"
					akuzativ="výšku"
					id="opl-vyska"
					testid="oplotenie-vyska"
					name="vyska"
				/>
				<RozmerStepper
					bind:hodnotaMm={sirka}
					min={r.sirka.min}
					max={r.sirka.max}
					krokMm={r.sirka.krok}
					popis="Šírka (B)"
					akuzativ="šírku"
					id="opl-sirka"
					testid="oplotenie-sirka"
					name="sirka"
				/>
				<label class="kp-pole kp-pocet">
					<span>Počet kusov</span>
					<select bind:value={pocet} data-testid="oplotenie-pocet">
						{#each pocetOpts as n (n)}
							<option value={n}>{n}</option>
						{/each}
					</select>
				</label>
			</div>

			<!-- #427: cenníkový rozmerový rozsah zvoleného typu (namiesto „nemej steny" individuálnej ponuky) -->
			{#if jeAtyp}
				<p class="kp-obalka" data-testid="oplotenie-obalka">
					Výplň na mieru (ATYP) — presnú cenu pripravíme individuálne po zameraní.
				</p>
			{:else}
				<p class="kp-obalka" class:mimo={mimoObalky} data-testid="oplotenie-obalka">
					Cenníkový rozsah pre {typNazov.toLowerCase()}: výška {mmNaMetreText(
						obalka.vyska.minMm
					)}–{mmNaMetreText(obalka.vyska.maxMm)} m, šírka {mmNaMetreText(
						obalka.sirka.minMm
					)}–{mmNaMetreText(obalka.sirka.maxMm)} m.
					{#if mimoObalky}
						<span class="kp-obalka-mimo" data-testid="oplotenie-obalka-mimo"
							>Zadané rozmery presahujú cenníkový rozsah — cenu pripravíme na vyžiadanie.</span
						>
					{:else}
						<span class="kp-obalka-info">Väčšie rozmery pripravíme ako cenu na vyžiadanie.</span>
					{/if}
				</p>
			{/if}
		</fieldset>

		<!-- FARBA -->
		<fieldset class="kp-blok">
			<legend>Vyhotovenie</legend>
			<div class="kp-rozmery">
				<label class="kp-pole">
					<span>Farba konštrukcie</span>
					<select bind:value={farba} data-testid="oplotenie-farba">
						{#each data.farby as f (f.kod)}
							<option value={f.kod}>RAL {f.kod} — {f.nazov}</option>
						{/each}
					</select>
				</label>
			</div>
		</fieldset>
	{/snippet}

	{#snippet panel()}
		{#if suhrn}
			{@const s = suhrn}
			<section class="kp-suhrn" data-testid="oplotenie-suhrn">
				<h2>Tvoja konfigurácia</h2>
				<dl>
					<div>
						<dt>Typ prvku</dt>
						<dd>{s.typNazov}</dd>
					</div>
					<div>
						<dt>Dizajn výplne</dt>
						<dd>{s.model}</dd>
					</div>
					<div>
						<dt>Rozmery (v × š)</dt>
						<dd data-testid="oplotenie-suhrn-rozmery" class="mono">{s.vyska} × {s.sirka} mm</dd>
					</div>
					<div>
						<dt>Počet kusov</dt>
						<dd class="mono">{s.pocet}</dd>
					</div>
					<div>
						<dt>Farba</dt>
						<dd>{s.farba}</dd>
					</div>
				</dl>
			</section>

			<!-- ORIENTAČNÁ CENA (#410) — server-počítaná oplotenie maticou montalu.sk (enhance submit) -->
			<section class="kp-cena" data-testid="oplotenie-cena-sekcia">
				{#if cenaAktualna && cenaVysledok}
					{@const c = cenaVysledok.cena}
					<div class="kp-cena-blok" data-testid="oplotenie-cena">
						{#if c.druh === 'cena'}
							<span class="kp-cena-label">Orientačná cena — model {c.model} · {s.pocet} ks</span>
							{#if c.hladinaLabel}
								<span class="kp-cena-vo" data-testid="oplotenie-cena-hladina">{c.hladinaLabel}</span
								>
							{/if}
							<div class="kp-cena-hlavne">
								<span class="kp-cena-sdph mono" data-testid="oplotenie-cena-sdph"
									>{eur(c.sDph)}</span
								>
								<span class="kp-cena-mena">s DPH</span>
							</div>
							<div class="kp-cena-bezdph" data-testid="oplotenie-cena-bezdph">
								<span class="mono">{eur(c.bezDph)}</span> bez DPH
							</div>
							<!-- #410 review 🟡: šírka sa zaokrúhľuje na katalógovú mriežku (0,5 m); keď sa líši
								     od zadanej, čestne to doplň (cena platí pre najbližší katalógový rozmer). -->
							{#if Math.round(c.sirkaGridM * 1000) !== (sirka ?? 0)}
								<p class="kp-cena-grid" data-testid="oplotenie-cena-grid">
									Cena platí pre najbližší katalógový rozmer šírky {String(c.sirkaGridM).replace(
										'.',
										','
									)} m.
								</p>
							{/if}
						{:else}
							<span class="kp-cena-label">Cena na vyžiadanie — model {c.model}</span>
							{#if c.hladinaLabel}
								<span class="kp-cena-vo" data-testid="oplotenie-cena-hladina">{c.hladinaLabel}</span
								>
							{/if}
							<p class="kp-cena-dovod" data-testid="oplotenie-cena-individualna">
								{c.dovod} Pripravíme ti individuálnu ponuku.
							</p>
						{/if}
						<p class="kp-cena-pozn">
							Orientačná cena vychádza z aktuálneho cenníka pre zvolený typ, model a rozmery.
							Presnú, záväznú cenu pripravíme po obhliadke miesta.
						</p>
					</div>

					{#if cenaVysledok.cenyModely}
						<div class="kp-porovnanie" data-testid="oplotenie-porovnanie">
							<h3>Porovnanie modelov (orientačne, s DPH)</h3>
							<ul>
								{#each cenaVysledok.cenyModely as cm (cm.model)}
									<li
										class:vybrany={cm.model === c.model}
										data-testid="oplotenie-porovnanie-{cm.model}"
									>
										<span class="p-model">{cm.model}</span>
										<span class="p-cena mono">
											{cm.cena.druh === 'cena' ? eur(cm.cena.sDph) : 'na vyžiadanie'}
										</span>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
				{:else}
					<form
						method="POST"
						action="?/vypocet"
						class="kp-cena-form"
						use:enhance={() => {
							const submitted = cenaKluc;
							cenaNacitava = true;
							cenaError = null;
							return ({ result }) => {
								cenaNacitava = false;
								if (result.type === 'success') {
									const d = result.data as
										{ cena: VerejnaCena; cenyModely: CenaModelu[] } | undefined;
									if (d?.cena) {
										cenaVysledok = { cena: d.cena, cenyModely: d.cenyModely };
										poslednyKluc = submitted;
									}
								} else if (result.type === 'failure') {
									const d = result.data as { error?: string } | undefined;
									cenaError = d?.error ?? 'Cenu sa nepodarilo spočítať.';
								} else if (result.type === 'error') {
									// sieťová/serverová výnimka — nenechaj tlačidlo „visieť" bez odozvy
									cenaError = 'Cenu sa nepodarilo spočítať, skús to prosím o chvíľu znova.';
								}
							};
						}}
					>
						<input type="hidden" name="typ" value={vstup.typ} />
						<input type="hidden" name="model" value={vstup.model} />
						<input type="hidden" name="vyska" value={vyska ?? 0} />
						<input type="hidden" name="sirka" value={sirka ?? 0} />
						<input type="hidden" name="pocet" value={pocet} />
						<strong>Orientačná cena</strong>
						<p>
							Zobraz si orientačnú cenu zvoleného typu a modelu a porovnanie modelov. Presnú,
							záväznú cenu pripravíme po obhliadke miesta.
						</p>
						{#if cenaError}
							<p class="kp-cena-chyba" data-testid="oplotenie-cena-chyba">{cenaError}</p>
						{/if}
						<button
							type="submit"
							class="kp-btn primar"
							data-testid="oplotenie-cena-zobrazit"
							disabled={cenaNacitava}
						>
							{cenaNacitava
								? 'Počítam…'
								: cenaVysledok
									? 'Prepočítať orientačnú cenu →'
									: 'Zobraziť orientačnú cenu →'}
						</button>
					</form>
				{/if}
				<button type="button" class="kp-btn druhotny" onclick={() => scrollNa('dopyt')}>
					Nezáväzný dopyt →
				</button>
			</section>

			<section class="kp-blok-kontakt" id="dopyt" data-testid="dopyt">
				<h2>Máš záujem o toto oplotenie?</h2>
				<p class="kp-uvod">
					Nechaj nám kontakt a pripravíme ti nezáväznú špecifikáciu (PDF) s orientačnou cenou na
					stiahnutie. Presnú, záväznú cenu pripravíme po obhliadke miesta.
				</p>
				<DopytForm konfiguracia={ponukaCfg} />
			</section>
		{:else}
			<p class="kp-chyba" data-testid="oplotenie-chyba">
				⚠ Skontroluj zadané rozmery — musia byť v uvedených rozmedziach.
			</p>
		{/if}
	{/snippet}
</KonfProduktStranka>

<style>
	.kp-karty {
		--kp-karta-min: 160px;
	}
	.kp-pocet {
		max-width: 220px;
	}
	/* #427: cenníkový rozmerový rozsah zvoleného typu (pod steppermi) */
	.kp-obalka {
		margin: 14px 0 0;
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--k-muted, #6b7078);
	}
	.kp-obalka-info {
		color: var(--k-faint, #9a9ea6);
	}
	.kp-obalka-mimo {
		display: block;
		margin-top: 4px;
		color: #a3261c;
		font-weight: 600;
	}
	/* Porovnanie modelov (oplotenie-špecifické; bazén má vlastné `.baz-porovnanie`) */
	.kp-porovnanie {
		border: 1px solid var(--k-line);
		border-radius: var(--k-radius);
		background: var(--k-surface);
		padding: 16px 20px;
	}
	.kp-porovnanie h3 {
		font-size: 11.5px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		font-weight: 600;
		margin: 0 0 12px;
		color: var(--k-faint, #9a9ea6);
	}
	.kp-porovnanie ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 2px;
	}
	.kp-porovnanie li {
		display: flex;
		justify-content: space-between;
		gap: 14px;
		padding: 9px 10px;
		border-radius: 9px;
		font-size: 15px;
	}
	.kp-porovnanie li.vybrany {
		background: var(--k-accent-soft, #f5ede2);
		font-weight: 700;
	}
	.kp-porovnanie .p-model {
		color: var(--k-muted, #6b7078);
	}
	.kp-porovnanie .p-cena {
		color: var(--k-text, #16181c);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
</style>
