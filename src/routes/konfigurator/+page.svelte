<script lang="ts">
	// Verejný zákaznícky konfigurátor pergoly (#275/#280) — #325 SPLIT-SCREEN +
	// #327 PRÉMIOVÝ SHOWROOM redizajn (Tesla/Apple štandard). ĽAVÝ stĺpec = ŽIVÝ 3D
	// náhľad EDGE-TO-EDGE viditeľný HNEĎ pri načítaní (defaultná pergola); PRAVÝ
	// scrollovací panel = veľkorysá typografia + prémiové ovládanie (KonfOvladace:
	// segmentové karty modelu, RAL swatche, sklo chips, rozmerové steppery, sklon slider)
	// + prilepený cenový/CTA panel na spodku. Vlastný minimal chrome (`+layout.svelte`) —
	// žiadna interná admin navigácia. Mobil-first: vizuál sticky hore, panel scrolluje pod ním.
	//
	// Živý update 3D (owner #325): FARBA (RAL) + typ SKLA prúdia LIVE → okamžitý in-place
	// update materiálu vo Vizual3D. ROZMERY prúdia cez DEBOUNCED snapshot (~320 ms) do
	// `{#key}` remountu 3D → čistý refit scénického rigu. Cena/súhrn ostávajú SERVER-side na
	// submite (owner to dovolil). Money-neutralita nezmenená: 3D berie len rozmery +
	// `typSkla3D(nazov)` + RAL kód (client-safe, žiadny Money kód). Ovládanie žije v
	// `KonfOvladace` (7× $bindable, renderované VNÚTRI formu → jeho name= inputy sú v POST-e).
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import {
		typSkla3D,
		vyskaPriStene,
		fmtMm1,
		KONF_VYSKA_STENA_MAX,
		type KonfiguratorSuhrn,
		type VerejnaCena,
		type CenaModelu,
		type ModelPergoly
	} from '$lib/konfigurator';
	import type { PergolaTypSkla } from '$lib/vizual/pergola-sklo';
	import type { PonukaConfig } from '$lib/ponuka';
	import DopytForm from '$lib/components/DopytForm.svelte';
	import ObjednavkaForm from '$lib/components/ObjednavkaForm.svelte';
	import KonfVizual from '$lib/components/konfigurator/KonfVizual.svelte';
	import KonfOvladace from '$lib/components/konfigurator/KonfOvladace.svelte';
	import KonfCena from '$lib/components/konfigurator/KonfCena.svelte';
	import KonfSuhrn from '$lib/components/konfigurator/KonfSuhrn.svelte';

	let { data } = $props();

	// rozmedzia z data (min/max hinty pre inputy)
	const r = $derived(data.rozmedzia);

	// spoločné východiskové rozmery — JEDEN zdroj pre $state inity AJ pre debounced 3D
	// snapshot (bez driftu → žiadny 320 ms „zlý náhľad" flash / spurný remount pri loade).
	const KONF_DEFAULT = { sirka: 4000, hlbka: 3500, vyskaVpredu: 2500, sklon: 6 };

	// vstupné polia = $state + bind: (hneď platná pergola)
	let sirka = $state<number | null>(KONF_DEFAULT.sirka);
	let hlbka = $state<number | null>(KONF_DEFAULT.hlbka);
	let vyskaVpredu = $state<number | null>(KONF_DEFAULT.vyskaVpredu);
	let sklonDeg = $state<number | null>(KONF_DEFAULT.sklon);
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
		model: ModelPergoly;
	};

	function platnyRozmer(v: number | null, lo: number, hi: number): v is number {
		return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
	}

	// podpis CELEJ konfigurácie (všetky voľby tvoriace súhrn/objednávku) — na detekciu,
	// či sa po submite zmenila (stale-clear effect nižšie).
	const konfigPodpis = () =>
		`${sirka}|${hlbka}|${vyskaVpredu}|${sklonDeg}|${model}|${sklo}|${farba}`;

	// DEBOUNCED snapshot rozmerov pre 3D — inicializovaný na východiskové (platné) hodnoty,
	// takže defaultná pergola sa vykreslí HNEĎ. Mení sa až ~320 ms po ustálení vstupu.
	let rozmeryStabilne = $state({
		sirkaMm: KONF_DEFAULT.sirka,
		hlbkaMm: KONF_DEFAULT.hlbka,
		vyskaVpreduMm: KONF_DEFAULT.vyskaVpredu,
		vyskaPriSteneMm: vyskaPriStene(KONF_DEFAULT.vyskaVpredu, KONF_DEFAULT.sklon, KONF_DEFAULT.hlbka)
	});

	// $effect beží LEN v prehliadači (Svelte 5) → žiadna SSR vetva; SSR render použije
	// hardcoded initializer `rozmeryStabilne` vyššie.
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
		const t = setTimeout(() => (rozmeryStabilne = next), 320);
		return () => clearTimeout(t);
	});

	// 3D vstup = DEBOUNCED rozmery + LIVE sklo/RAL/model. RAL/sklo = okamžitý in-place update
	// materiálu; MODEL mení hrúbky profilov (geometriu) → in-place prestavba produktu vo Vizual3D
	// (geometrickyPodpis sa zmení), nie remount (#329 časť 2).
	const viz3d = $derived<Viz3D>({
		...rozmeryStabilne,
		typSkla: typSkla3D(sklo),
		ralKod: farba,
		model: model as ModelPergoly
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

	// podpis konfigurácie, ktorá vyprodukovala aktuálny `suhrn`/`cena` (nastaví submit).
	let submitPodpis = $state<string | null>(null);

	// STALE-CLEAR (#325 review 🟡): cena/súhrn ostávajú server-side na submite, no 3D sa
	// mení živo. Keď zákazník po submite zmení konfiguráciu, cena/súhrn/PDF/OBJEDNÁVKA by
	// niesli STARÉ hodnoty (objednal by, čo už nevidí). Preto pri odchýlke živej
	// konfigurácie od submitnutej sa súhrn/cena/AR VYČISTIA → zákazník znova klikne
	// „Zobraziť cenu a súhrn" a objednávka je vždy konzistentná s tým, čo vidí v 3D.
	$effect(() => {
		if (suhrn && submitPodpis !== null && konfigPodpis() !== submitPodpis) {
			suhrn = null;
			cena = null;
			cenyModely = null;
			arViz = null;
			submitPodpis = null;
			chyba = '';
		}
	});

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
					popis: `Sklon strechy ${fmtMm1(suhrn.sklonDeg)}°, svetlá výška vpredu ${fmtMm1(
						suhrn.svetlaVyska
					)} mm, zastrešená plocha ${fmtMm1(suhrn.zastresenaPlochaM2)} m².`
				}
			: {}
	);

	// krátky € formát pre prilepený cenový panel (celé eurá — „od X €"). #327 review 🔵:
	// `Math.floor` (nie round) = čestný spodok pre „cena OD"; `minimumFractionDigits: 0`
	// bráni RangeError na Safari <15 (currency bez min throw-ne).
	const eurKratko = (n: number) =>
		Math.floor(n).toLocaleString('sk-SK', {
			style: 'currency',
			currency: 'EUR',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		});

	// plynulý scroll na sekciu (dopyt) v scrollovacom paneli (desktop) alebo stránke (mobil)
	function scrollNa(id: string) {
		document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
</script>

<svelte:head>
	<title>Navrhni si pergolu — Montalu</title>
	<meta
		name="description"
		content="Zostav si pergolu na mieru — meň rozmery, sklon strechy, typ strešného skla a farbu a rovno naživo vidíš svoju pergolu v 3D."
	/>
</svelte:head>

<div class="konf-split">
	<!-- ĽAVÝ stĺpec: ŽIVÝ 3D náhľad edge-to-edge (sticky) -->
	<div class="konf-vizual-col">
		<KonfVizual viz={viz3d} {vizKluc} />
	</div>

	<!-- PRAVÝ stĺpec: prémiový panel — scrolluje, prilepený cenový/CTA panel dole -->
	<div class="konf-panel">
		<div class="konf-panel-scroll">
			<header class="konf-hero">
				<span class="konf-hero-label">Konfigurátor pergoly</span>
				<h1 class="konf-hero-nadpis">Navrhni si svoju pergolu</h1>
				<p class="konf-hero-lead">
					Meň model, rozmery a vzhľad — pergolu vidíš naživo v 3D vedľa. Nezáväzné, bez registrácie.
				</p>
			</header>

			<!-- kalkulačka POSTuje na pomenovanú akciu ?/vypocet (nie default — SvelteKit
			     nedovolí default + pomenované naraz). Submit tlačidlo žije v prilepenom CTA
			     paneli nižšie a je s formom spojené cez `form="konf-form"` (mimo <form>). -->
			<form
				id="konf-form"
				method="POST"
				action="?/vypocet"
				use:enhance={() => {
					spracuva = true;
					// zachyť odoslaný RAL kód + PODPIS konfigurácie PRI submite (AR snapshot +
					// stale-clear — cena/súhrn platia presne pre TÚTO odoslanú konfiguráciu)
					const odoslanaFarba = farba;
					const odoslanyPodpis = konfigPodpis();
					return async ({ result }) => {
						spracuva = false;
						if (result.type === 'success') {
							suhrn = (result.data?.vysledok as KonfiguratorSuhrn | null) ?? null;
							cena = (result.data?.cena as VerejnaCena | null) ?? null;
							cenyModely = (result.data?.cenyModely as CenaModelu[] | null) ?? null;
							chyba = '';
							submitPodpis = suhrn ? odoslanyPodpis : null;
							if (suhrn) {
								arViz = {
									sirkaMm: suhrn.sirka,
									hlbkaMm: suhrn.hlbka,
									vyskaVpreduMm: suhrn.vyskaVpredu,
									vyskaPriSteneMm: suhrn.vyskaPriStene,
									typSkla: typSkla3D(suhrn.sklo),
									ralKod: odoslanaFarba,
									model: suhrn.model
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
							submitPodpis = null;
							chyba = (result.data?.error as string | undefined) ?? 'Neplatný vstup.';
						} else if (result.type === 'error') {
							suhrn = null;
							cena = null;
							cenyModely = null;
							arViz = null;
							submitPodpis = null;
							chyba = 'Nastala chyba pri výpočte. Skús to prosím znova.';
						}
						// zámerne NEvoláme update() — vstupy necháme tak, ako ich zákazník zadal
					};
				}}
			>
				<KonfOvladace
					bind:sirka
					bind:hlbka
					bind:vyskaVpredu
					bind:sklonDeg
					bind:sklo
					bind:farba
					bind:model
					{data}
					{spracuva}
				/>
			</form>

			{#if chyba}
				<p class="konf-chyba" data-testid="chyba">⚠ {chyba}</p>
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
					<section class="konf-blok ar-sekcia" data-testid="konf-ar" aria-label="AR náhľad pergoly">
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
				<section class="konf-blok kontakt" id="dopyt" data-testid="dopyt">
					<h2>Máš záujem o túto pergolu?</h2>
					<p class="konf-blok-uvod">
						Nechaj nám kontakt a pripravíme ti nezáväznú špecifikáciu (PDF) s orientačnou cenou na
						stiahnutie. Presnú cenu pripravíme po obhliadke.
					</p>
					<DopytForm konfiguracia={ponukaCfg} />
				</section>

				<!-- voliteľný krok — ZÁVÄZNÁ OBJEDNÁVKA (Money-neutrálne, bez platobnej brány) -->
				<section class="konf-blok objednavka" data-testid="objednavka">
					<h2>Chceš si túto pergolu záväzne objednať?</h2>
					<p class="konf-blok-uvod">
						Vyplň kontakt a fakturačné údaje a odošli firme <strong>záväznú objednávku</strong>. Bez
						online platby — ozveme sa ti, dohodneme obhliadku a presné podmienky. Orientačná cena z
						konfigurátora sa stane súčasťou objednávky.
					</p>
					<ObjednavkaForm konfiguracia={ponukaCfg} />
				</section>
			{/if}
		</div>

		<!-- PRILEPENÝ cenový/CTA panel na spodku pravého stĺpca -->
		<div class="konf-cta">
			{#if cena && cena.druh === 'cena'}
				<div class="konf-cta-cena" data-testid="cta-cena">
					<span class="konf-cta-cena-label">Orientačná cena od</span>
					<span class="konf-cta-cena-suma">{eurKratko(cena.sDph)}</span>
					<span class="konf-cta-cena-dph">s DPH</span>
				</div>
				<div class="konf-cta-akcie">
					<button type="button" class="konf-btn primar" onclick={() => scrollNa('dopyt')}
						>Nezáväzný dopyt</button
					>
					<button type="button" class="konf-btn sekundar" onclick={() => scrollNa('dopyt')}
						>PDF ponuka</button
					>
				</div>
			{:else if cena}
				<div class="konf-cta-cena">
					<span class="konf-cta-cena-label">Cena</span>
					<span class="konf-cta-cena-suma mala">na vyžiadanie</span>
				</div>
				<div class="konf-cta-akcie">
					<button type="button" class="konf-btn primar" onclick={() => scrollNa('dopyt')}
						>Nezáväzný dopyt</button
					>
				</div>
			{:else}
				<button
					type="submit"
					form="konf-form"
					class="konf-btn primar konf-btn-plny"
					data-testid="zobrazit"
					disabled={spracuva}
				>
					{spracuva ? 'Počítam…' : 'Zobraziť cenu a súhrn'}
				</button>
			{/if}
		</div>
	</div>
</div>

<style>
	/* ── Split-screen: mobil-first — 3D HORE (pevná výška), panel scrolluje POD ním vo
	   VLASTNEJ oblasti (žiadny sticky-overlay ⇒ žiadne prekrytie klikateľného obsahu).
	   Rovnaký čistý flex-column vzor (scroll + prilepené CTA ako flex dieťa) ako desktop,
	   len vertikálne. ── */
	.konf-split {
		display: grid;
		grid-template-columns: 1fr;
		grid-template-rows: 44dvh minmax(0, 1fr);
		height: calc(100dvh - var(--k-hlava-h));
	}

	.konf-vizual-col {
		background: var(--k-bg);
		min-height: 0;
		overflow: hidden;
	}

	.konf-panel {
		display: flex;
		flex-direction: column;
		background: var(--k-surface);
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}
	.konf-panel-scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: clamp(22px, 4vw, 44px) clamp(18px, 4vw, 40px) 28px;
	}

	/* obsah pravého panela má komfortnú max-šírku a veľkorysý whitespace */
	.konf-hero {
		max-width: 520px;
		margin: 0 0 30px;
	}
	.konf-hero-label {
		display: block;
		font-size: 11.5px;
		font-weight: 600;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--k-accent);
		margin-bottom: 12px;
	}
	.konf-hero-nadpis {
		margin: 0 0 12px;
		font-size: clamp(2rem, 4.4vw, 2.9rem);
		font-weight: 700;
		line-height: 1.05;
		letter-spacing: -0.022em;
		color: var(--k-text);
	}
	.konf-hero-lead {
		margin: 0;
		font-size: 15.5px;
		line-height: 1.55;
		color: var(--k-muted);
	}

	/* každý priamy blok pravého panela (hero, form, cena, súhrn, karty) má komfortnú
	   max-šírku a je zarovnaný vľavo (Tesla-style) */
	.konf-panel-scroll > :global(*) {
		max-width: 520px;
	}

	.konf-chyba {
		max-width: 520px;
		color: #a3261c;
		background: #fbeeec;
		border: 1px solid #f2cfc9;
		border-radius: var(--k-radius-sm);
		padding: 12px 14px;
		font-size: 14px;
		margin: 22px 0 0;
	}

	/* výsledkové bloky (AR/kontakt/objednávka) — prémiové karty */
	.konf-blok {
		max-width: 520px;
		background: var(--k-surface);
		border: 1px solid var(--k-line);
		border-radius: var(--k-radius);
		padding: 22px;
		margin-top: 20px;
	}
	.konf-blok h2 {
		font-size: 18px;
		font-weight: 650;
		letter-spacing: -0.01em;
		margin: 0 0 8px;
		color: var(--k-text);
	}
	.konf-blok-uvod {
		color: var(--k-muted);
		font-size: 14px;
		line-height: 1.5;
		margin: 0 0 16px;
	}
	.objednavka {
		border-color: var(--k-line-2);
		background: var(--k-surface-2);
	}
	.ar-sekcia {
		padding: 14px;
	}
	.ar-loading {
		width: 100%;
		min-height: 120px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--k-surface-2);
		border-radius: var(--k-radius-sm);
		color: var(--k-muted);
		font-size: 14px;
	}

	/* ── Prilepený cenový/CTA panel — flex dieťa na spodku panela (nie sticky-overlay),
	   takže NIKDY neprekrýva klikateľný obsah v scroll oblasti nad ním ── */
	.konf-cta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		flex-wrap: wrap;
		padding: 14px clamp(18px, 4vw, 40px);
		background: rgba(255, 255, 255, 0.9);
		-webkit-backdrop-filter: saturate(1.3) blur(10px);
		backdrop-filter: saturate(1.3) blur(10px);
		border-top: 1px solid var(--k-line);
	}
	.konf-cta-cena {
		display: flex;
		align-items: baseline;
		gap: 8px;
		flex-wrap: wrap;
	}
	.konf-cta-cena-label {
		font-size: 12.5px;
		color: var(--k-muted);
	}
	.konf-cta-cena-suma {
		font-size: clamp(22px, 4vw, 28px);
		font-weight: 700;
		letter-spacing: -0.02em;
		color: var(--k-text);
		font-variant-numeric: tabular-nums;
	}
	.konf-cta-cena-suma.mala {
		font-size: 18px;
		font-weight: 600;
	}
	.konf-cta-cena-dph {
		font-size: 12.5px;
		color: var(--k-muted);
	}
	.konf-cta-akcie {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
	}
	.konf-btn {
		font-family: inherit;
		font-size: 14px;
		font-weight: 600;
		border-radius: var(--k-radius-pill);
		padding: 12px 20px;
		cursor: pointer;
		border: 1px solid transparent;
		transition:
			background 0.15s ease,
			border-color 0.15s ease,
			color 0.15s ease;
	}
	.konf-btn.primar {
		background: var(--k-ink);
		color: #fff;
	}
	.konf-btn.primar:hover {
		background: var(--k-ink-hover);
	}
	.konf-btn.primar:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.konf-btn.sekundar {
		background: transparent;
		color: var(--k-text);
		border-color: var(--k-line-2);
	}
	.konf-btn.sekundar:hover {
		border-color: var(--k-ink);
	}
	.konf-btn-plny {
		flex: 1;
		text-align: center;
	}
	.konf-btn:focus-visible {
		outline: 2px solid var(--k-ink);
		outline-offset: 2px;
	}

	/* ── Desktop: split-screen — vľavo edge-to-edge 3D (plná výška), vpravo scroll panel
	   s prilepeným CTA (rovnaký flex-column vzor ako mobil, len horizontálne: 2 stĺpce,
	   1 riadok) ── */
	@media (min-width: 900px) {
		.konf-split {
			grid-template-columns: minmax(0, 1.18fr) minmax(0, 0.82fr);
			grid-template-rows: minmax(0, 1fr);
		}
		.konf-panel {
			border-left: 1px solid var(--k-line);
		}
	}
</style>
