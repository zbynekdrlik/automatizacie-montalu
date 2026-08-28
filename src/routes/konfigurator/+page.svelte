<script lang="ts">
	// Verejný zákaznícky konfigurátor pergoly (#275/#280) — #325 SPLIT-SCREEN redizajn
	// (Tesla/Apple konfigurátor): ĽAVÝ sticky stĺpec = ŽIVÝ 3D náhľad viditeľný HNEĎ pri
	// načítaní (defaultná pergola), PRAVÝ scrollovací panel = formulár + cena/súhrn/dopyt/
	// objednávka/AR. Mobil-first: vizuál hore (sticky, zmenšený), panel pod ním.
	//
	// Živý update 3D (owner #325): FARBA (RAL) + typ SKLA prúdia LIVE → okamžitý in-place
	// update materiálu vo Vizual3D. ROZMERY prúdia cez DEBOUNCED snapshot (~320 ms) do
	// `{#key}` remountu 3D → čistý refit scénického rigu (kamera/tiene/dekal/stena) po
	// ustálení (žiadny fight s obmedzením #170/#174; žiadna zmena Vizual3D). Cena/súhrn
	// ostávajú SERVER-side na submite (owner to dovolil). Money-neutralita nezmenená: 3D
	// berie len rozmery + `typSkla3D(nazov)` + RAL kód (client-safe, žiadny Money kód).
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { browser } from '$app/environment';
	import {
		typSkla3D,
		vyskaPriStene,
		KONF_VYSKA_STENA_MAX,
		type KonfiguratorSuhrn,
		type VerejnaCena,
		type CenaModelu
	} from '$lib/konfigurator';
	import type { PergolaTypSkla } from '$lib/vizual/pergola-sklo';
	import type { PonukaConfig } from '$lib/ponuka';
	import DopytForm from '$lib/components/DopytForm.svelte';
	import ObjednavkaForm from '$lib/components/ObjednavkaForm.svelte';
	import KonfVizual from '$lib/components/konfigurator/KonfVizual.svelte';
	import KonfCena from '$lib/components/konfigurator/KonfCena.svelte';
	import KonfSuhrn from '$lib/components/konfigurator/KonfSuhrn.svelte';

	let { data } = $props();

	// rozmedzia z data (min/max hinty pre inputy)
	const r = $derived(data.rozmedzia);

	// vstupné polia = $state + bind: (rozumné východiskové hodnoty — hneď platná pergola)
	let sirka = $state<number | null>(4000);
	let hlbka = $state<number | null>(3500);
	let vyskaVpredu = $state<number | null>(2500);
	let sklonDeg = $state<number | null>(6);
	let sklo = $state<string>(untrack(() => data.sklaTypy[0] ?? ''));
	let farba = $state<string>(untrack(() => data.farby[0]?.kod ?? ''));
	let model = $state<string>(untrack(() => data.modely[0]?.kod ?? 'LIGHT'));

	// výsledok napĺňa use:enhance callback (súhrn + cena server-side na submite)
	let suhrn = $state<KonfiguratorSuhrn | null>(null);
	let cena = $state<VerejnaCena | null>(null);
	let cenyModely = $state<CenaModelu[] | null>(null);
	let chyba = $state<string>('');
	let spracuva = $state(false);

	// ---- ŽIVÝ 3D náhľad (#325) ----
	type Viz3D = {
		sirkaMm: number;
		hlbkaMm: number;
		vyskaVpreduMm: number;
		vyskaPriSteneMm: number;
		typSkla: PergolaTypSkla;
		ralKod: string;
	};

	function platnyRozmer(v: number | null, lo: number, hi: number): v is number {
		return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
	}

	// DEBOUNCED snapshot rozmerov pre 3D — inicializovaný na východiskové (platné) hodnoty,
	// takže defaultná pergola sa vykreslí HNEĎ. Mení sa až ~320 ms po ustálení vstupu
	// (aby sa `{#key}` remount/refit rigu nespúšťal na každú klávesu).
	let rozmeryStabilne = $state({
		sirkaMm: 4000,
		hlbkaMm: 3500,
		vyskaVpreduMm: 2500,
		vyskaPriSteneMm: vyskaPriStene(2500, 6, 3500)
	});

	$effect(() => {
		const s = sirka;
		const h = hlbka;
		const vv = vyskaVpredu;
		const sk = sklonDeg;
		// len PLATNÝ vstup posúva 3D (mid-typing/nevalidný stav → drž posledný platný náhľad)
		if (!platnyRozmer(s, r.sirka.min, r.sirka.max)) return;
		if (!platnyRozmer(h, r.hlbka.min, r.hlbka.max)) return;
		if (!platnyRozmer(vv, r.vyskaVpredu.min, r.vyskaVpredu.max)) return;
		if (!platnyRozmer(sk, r.sklon.min, r.sklon.max)) return;
		const stena = vyskaPriStene(vv, sk, h);
		if (stena > KONF_VYSKA_STENA_MAX) return; // dopočítaná výška nad max konštrukcie
		const next = { sirkaMm: s, hlbkaMm: h, vyskaVpreduMm: vv, vyskaPriSteneMm: stena };
		if (!browser) {
			rozmeryStabilne = next;
			return;
		}
		const t = setTimeout(() => (rozmeryStabilne = next), 320);
		return () => clearTimeout(t);
	});

	// 3D vstup = DEBOUNCED rozmery + LIVE sklo/RAL (RAL/sklo = okamžitý in-place update)
	const viz3d = $derived<Viz3D>({
		...rozmeryStabilne,
		typSkla: typSkla3D(sklo),
		ralKod: farba
	});
	// `{#key}` podpis = len rozmery (debounced) → remount/refit rigu iba pri zmene rozmeru
	const vizKluc = $derived(
		`${rozmeryStabilne.sirkaMm}|${rozmeryStabilne.hlbkaMm}|${rozmeryStabilne.vyskaVpreduMm}|${rozmeryStabilne.vyskaPriSteneMm}`
	);

	// ---- AR náhľad (#286) — ostáva POST-SUBMIT (model-viewer bundle sa nenačíta pri
	//      loade); `arViz` je snapshot vstupov PRI submite (rozmery/sklo/RAL). ----
	let arViz = $state<Viz3D | null>(null);
	type ARKompTyp = (typeof import('$lib/components/vizual/PergolaAR.svelte'))['default'];
	let ARKomp = $state<ARKompTyp | null>(null);
	let arNacitava = false;

	const fmt = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

	// Konfigurácia pre PDF ponuku — mapovanie súhrnu na PonukaConfig (bez cien/Money kódov).
	const ponukaCfg = $derived<PonukaConfig>(
		suhrn
			? {
					system: 'Pergola',
					model: suhrn.model,
					sirka: suhrn.sirka,
					hlbka: suhrn.hlbka,
					vyskaVpredu: suhrn.vyskaVpredu,
					vyskaPriStene: suhrn.vyskaPriStene,
					farba: suhrn.farba,
					sklo: suhrn.sklo,
					popis: `Sklon strechy ${fmt(suhrn.sklonDeg)}°, svetlá výška vpredu ${fmt(
						suhrn.svetlaVyska
					)} mm, zastrešená plocha ${fmt(suhrn.zastresenaPlochaM2)} m².`
				}
			: {}
	);
</script>

<svelte:head>
	<title>Navrhni si pergolu — Montalu</title>
	<meta
		name="description"
		content="Zostav si pergolu na mieru — meň rozmery, sklon strechy, typ strešného skla a farbu a rovno naživo vidíš svoju pergolu v 3D."
	/>
</svelte:head>

<div class="konf">
	<header class="hero">
		<h1>Navrhni si svoju pergolu</h1>
		<p class="lead">
			Meň rozmery, model a vzhľad — pergolu vidíš naživo v 3D hneď vedľa. Cenu a súhrn zobrazíš
			tlačidlom. Nezáväzné, bez registrácie.
		</p>
	</header>

	<div class="konf-layout">
		<!-- ĽAVÝ stĺpec: ŽIVÝ 3D náhľad (sticky na desktope, sticky-zmenšený na mobile) -->
		<div class="konf-vizual-col">
			<KonfVizual viz={viz3d} {vizKluc} />
		</div>

		<!-- PRAVÝ stĺpec: formulár + (po submite) cena/súhrn/dopyt/objednávka/AR (scrolluje) -->
		<div class="konf-panel">
			<!-- kalkulačka POSTuje na pomenovanú akciu ?/vypocet (nie default — SvelteKit
			     nedovolí default + pomenované naraz) -->
			<form
				method="POST"
				action="?/vypocet"
				class="karta"
				use:enhance={() => {
					spracuva = true;
					// zachyť odoslaný RAL kód PRI submite (pre AR snapshot)
					const odoslanaFarba = farba;
					return async ({ result }) => {
						spracuva = false;
						if (result.type === 'success') {
							suhrn = (result.data?.vysledok as KonfiguratorSuhrn | null) ?? null;
							cena = (result.data?.cena as VerejnaCena | null) ?? null;
							cenyModely = (result.data?.cenyModely as CenaModelu[] | null) ?? null;
							chyba = '';
							if (suhrn) {
								arViz = {
									sirkaMm: suhrn.sirka,
									hlbkaMm: suhrn.hlbka,
									vyskaVpreduMm: suhrn.vyskaVpredu,
									vyskaPriSteneMm: suhrn.vyskaPriStene,
									typSkla: typSkla3D(suhrn.sklo),
									ralKod: odoslanaFarba
								};
								// lazy AR komponent (model-viewer bundle) až pri prvom súhrne
								if (!ARKomp && !arNacitava) {
									arNacitava = true;
									void import('$lib/components/vizual/PergolaAR.svelte')
										.then((m) => (ARKomp = m.default))
										.finally(() => (arNacitava = false));
								}
							} else {
								arViz = null;
							}
						} else if (result.type === 'failure') {
							suhrn = null;
							cena = null;
							cenyModely = null;
							arViz = null;
							chyba = (result.data?.error as string | undefined) ?? 'Neplatný vstup.';
						} else if (result.type === 'error') {
							suhrn = null;
							cena = null;
							cenyModely = null;
							arViz = null;
							chyba = 'Nastala chyba pri výpočte. Skús to prosím znova.';
						}
						// zámerne NEvoláme update() — vstupy necháme tak, ako ich zákazník zadal
					};
				}}
			>
				<div class="pole-mriezka">
					<label>
						<span>Šírka (mm)</span>
						<input
							name="sirka"
							type="number"
							inputmode="numeric"
							min={r.sirka.min}
							max={r.sirka.max}
							step="10"
							bind:value={sirka}
							data-testid="sirka"
							required
						/>
					</label>
					<label>
						<span>Hĺbka (mm)</span>
						<input
							name="hlbka"
							type="number"
							inputmode="numeric"
							min={r.hlbka.min}
							max={r.hlbka.max}
							step="10"
							bind:value={hlbka}
							data-testid="hlbka"
							required
						/>
					</label>
					<label>
						<span>Výška vpredu (mm)</span>
						<input
							name="vyskaVpredu"
							type="number"
							inputmode="numeric"
							min={r.vyskaVpredu.min}
							max={r.vyskaVpredu.max}
							step="10"
							bind:value={vyskaVpredu}
							data-testid="vyskaVpredu"
							required
						/>
					</label>
					<label>
						<span>Sklon strechy (°)</span>
						<input
							name="sklonDeg"
							type="number"
							inputmode="numeric"
							min={r.sklon.min}
							max={r.sklon.max}
							step="1"
							bind:value={sklonDeg}
							data-testid="sklonDeg"
							required
						/>
					</label>
					<label>
						<span>Strešné sklo</span>
						<select name="sklo" bind:value={sklo} data-testid="sklo">
							{#each data.sklaTypy as t (t)}
								<option value={t}>{t}</option>
							{/each}
						</select>
					</label>
					<label>
						<span>Farba konštrukcie</span>
						<select name="farba" bind:value={farba} data-testid="farba">
							{#each data.farby as f (f.kod)}
								<option value={f.kod}>RAL {f.kod} {f.nazov}</option>
							{/each}
						</select>
					</label>
				</div>

				<!-- výber modelu konštrukcie (LIGHT/ROBUST/MASSIVE) — cenotvorný vstup;
				     cena sa zobrazí po submite (súhrn + porovnanie modelov) -->
				<fieldset class="modely" data-testid="modely">
					<legend>Model konštrukcie</legend>
					<div class="modely-mriezka">
						{#each data.modely as m (m.kod)}
							<label class="model-karta" class:vybrana={model === m.kod}>
								<input
									type="radio"
									name="model"
									value={m.kod}
									bind:group={model}
									data-testid="model-{m.kod}"
								/>
								<span class="model-nazov">{m.kod}</span>
								<span class="model-popis">{m.popis}</span>
							</label>
						{/each}
					</div>
				</fieldset>

				<button type="submit" class="zobrazit" data-testid="zobrazit" disabled={spracuva}>
					{spracuva ? 'Počítam…' : 'Zobraziť cenu a súhrn'}
				</button>
			</form>

			{#if chyba}
				<p class="chyba" data-testid="chyba">⚠ {chyba}</p>
			{/if}

			{#if suhrn}
				{@const s = suhrn}

				<!-- ORIENTAČNÁ CENA (MO) + porovnanie modelov — server-autoritatívne na submite -->
				{#if cena}
					<KonfCena {cena} {cenyModely} sirka={s.sirka} hlbka={s.hlbka} />
				{/if}

				<KonfSuhrn suhrn={s} />

				<!-- AR náhľad — „pergola u teba na záhrade" cez telefón (mobil = odkaz, desktop = QR) -->
				{#if arViz}
					{@const a = arViz}
					<section class="ar-sekcia" data-testid="konf-ar" aria-label="AR náhľad pergoly">
						{#if ARKomp}
							{@const A = ARKomp}
							<A
								sirkaMm={a.sirkaMm}
								hlbkaMm={a.hlbkaMm}
								vyskaVpreduMm={a.vyskaVpreduMm}
								vyskaPriSteneMm={a.vyskaPriSteneMm}
								typSkla={a.typSkla}
								ralKod={a.ralKod}
							/>
						{:else}
							<div class="ar-loading" data-testid="konf-ar-loading">Načítavam AR náhľad…</div>
						{/if}
					</section>
				{/if}

				<!-- kontaktný formulár → PDF ponuka s orientačnou cenou (download-first) -->
				<section class="kontakt" data-testid="dopyt">
					<h2>Máš záujem o túto pergolu?</h2>
					<p class="kontakt-uvod">
						Nechaj nám kontakt a pripravíme ti nezáväznú špecifikáciu (PDF) s orientačnou cenou na
						stiahnutie. Presnú cenu pripravíme po obhliadke.
					</p>
					<DopytForm konfiguracia={ponukaCfg} />
				</section>

				<!-- voliteľný krok — ZÁVÄZNÁ OBJEDNÁVKA (Money-neutrálne, bez platobnej brány) -->
				<section class="objednavka" data-testid="objednavka">
					<h2>Chceš si túto pergolu záväzne objednať?</h2>
					<p class="kontakt-uvod">
						Vyplň kontakt a fakturačné údaje a odošli firme <strong>záväznú objednávku</strong>. Bez
						online platby — ozveme sa ti, dohodneme obhliadku a presné podmienky. Orientačná cena z
						konfigurátora sa stane súčasťou objednávky.
					</p>
					<ObjednavkaForm konfiguracia={ponukaCfg} />
				</section>
			{/if}
		</div>
	</div>
</div>

<style>
	.konf {
		max-width: 1180px;
		margin: 0 auto;
	}
	.hero {
		text-align: center;
		margin: 8px 0 20px;
	}
	.hero h1 {
		font-size: clamp(22px, 5vw, 30px);
		margin: 0 0 8px;
		color: #0f172a;
	}
	.lead {
		color: #64748b;
		font-size: 15px;
		margin: 0 auto;
		max-width: 560px;
	}

	/* split-screen layout — mobil-first: jeden stĺpec, vizuál hore */
	.konf-layout {
		display: grid;
		grid-template-columns: 1fr;
		gap: 16px;
		align-items: start;
	}

	/* mobil: vizuál je STICKY hore a zmenšený (panel scrolluje pod ním) */
	@media (max-width: 899px) {
		.konf-vizual-col {
			position: sticky;
			top: 0;
			z-index: 5;
			padding-bottom: 6px;
			background: #f8fafc;
		}
		.konf-vizual-col :global(.vizual3d) {
			aspect-ratio: 3 / 2;
			max-height: 42vh;
		}
	}

	/* desktop: split-screen — vľavo sticky 3D, vpravo scrollovací panel */
	@media (min-width: 900px) {
		.konf-layout {
			grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
		}
		.konf-vizual-col {
			position: sticky;
			top: 16px;
			align-self: start;
		}
	}

	.karta {
		background: #fff;
		border: 1px solid #e2e8f0;
		border-radius: 14px;
		padding: 18px;
		box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
	}
	.pole-mriezka {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 14px;
		margin-bottom: 18px;
	}
	.pole-mriezka label {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 13.5px;
		color: #475569;
		font-weight: 500;
	}
	.pole-mriezka input,
	.pole-mriezka select {
		width: 100%;
		box-sizing: border-box;
		padding: 11px 12px;
		border: 1px solid #cbd5e1;
		border-radius: 10px;
		font-size: 16px; /* 16px = žiadny auto-zoom na iOS pri fokuse */
		background: #fff;
		color: #0f172a;
	}
	.pole-mriezka input:focus,
	.pole-mriezka select:focus {
		outline: 2px solid #2563eb;
		outline-offset: 1px;
		border-color: #2563eb;
	}
	.zobrazit {
		width: 100%;
		background: #2563eb;
		color: #fff;
		border: 0;
		border-radius: 10px;
		padding: 14px 18px;
		cursor: pointer;
		font-size: 16px;
		font-weight: 600;
	}
	.zobrazit:hover {
		background: #1d4ed8;
	}
	.zobrazit:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.chyba {
		color: #b91c1c;
		background: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: 10px;
		padding: 12px 14px;
		font-size: 14.5px;
		margin-top: 16px;
	}
	.ar-sekcia {
		background: #fff;
		border: 1px solid #e2e8f0;
		border-radius: 14px;
		padding: 12px;
		margin-top: 18px;
	}
	.ar-loading {
		width: 100%;
		min-height: 120px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #dfe7ee;
		border-radius: 10px;
		color: #64748b;
		font-size: 14px;
	}
	.kontakt {
		background: #fff;
		border: 1px solid #e2e8f0;
		border-radius: 14px;
		padding: 18px;
		margin-top: 18px;
	}
	.kontakt h2 {
		font-size: 18px;
		margin: 0 0 8px;
		color: #0f172a;
	}
	.kontakt-uvod {
		color: #64748b;
		font-size: 14px;
		margin: 0 0 14px;
	}
	/* záväzná objednávka — rovnaká karta ako kontakt, zelený akcent (predajná akcia) */
	.objednavka {
		background: #fff;
		border: 1px solid #bbf7d0;
		border-radius: 14px;
		padding: 18px;
		margin-top: 18px;
	}
	.objednavka h2 {
		font-size: 18px;
		margin: 0 0 8px;
		color: #14532d;
	}
	/* výber modelu (radio-karty) */
	.modely {
		border: 1px solid #e2e8f0;
		border-radius: 12px;
		padding: 12px 14px 14px;
		margin: 0 0 18px;
	}
	.modely legend {
		font-size: 13.5px;
		font-weight: 600;
		color: #475569;
		padding: 0 6px;
	}
	.modely-mriezka {
		display: grid;
		grid-template-columns: 1fr;
		gap: 10px;
	}
	.model-karta {
		display: grid;
		grid-template-columns: auto 1fr;
		column-gap: 10px;
		align-items: center;
		border: 1px solid #cbd5e1;
		border-radius: 10px;
		padding: 10px 12px;
		cursor: pointer;
	}
	.model-karta.vybrana {
		border-color: #2563eb;
		background: #eff6ff;
	}
	.model-karta input {
		grid-row: 1 / span 2;
		width: 18px;
		height: 18px;
		accent-color: #2563eb;
	}
	.model-nazov {
		font-weight: 700;
		color: #0f172a;
		font-size: 15px;
	}
	.model-popis {
		grid-column: 2;
		color: #64748b;
		font-size: 13px;
	}
	@media (min-width: 640px) {
		.pole-mriezka {
			grid-template-columns: repeat(2, 1fr);
		}
		.modely-mriezka {
			grid-template-columns: repeat(3, 1fr);
		}
	}
</style>
