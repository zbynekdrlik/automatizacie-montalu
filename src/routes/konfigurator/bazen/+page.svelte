<script lang="ts">
	// Verejný zákaznícky konfigurátor bazénových zastrešení (#385, etapa 2 jednotného rámu #384).
	// JEDNODUCHÁ jednostĺpcová stránka (zámerne bez 3D split-screenu — bazénová 3D geometria zatiaľ
	// neexistuje, viď design komentár + follow-up) a BEZ ORIENTAČNEJ CENY (honest-null: bazén nemá
	// overený cenový zdroj — cena sa nevymýšľa). Konfigurácia (model/rozmery/segmenty/koľaj/farba/
	// výplň) sa počíta ČISTO klientsky (`$derived`, žiadny server round-trip — netreba, nie je cena)
	// a tečie do zdieľaného DopytForm (#277) → PDF špecifikácia (bez ceny) + Odoo lead. Zdieľané
	// `--k-*` tokeny z `konfigurator/+layout.svelte`. Money-neutralita: importuje LEN client-safe
	// `konfigurator-bazen` + DopytForm (guard: konfigurator-money-safety). Žiadne `console.*`.
	import { untrack } from 'svelte';
	import { base } from '$app/paths';
	import DopytForm from '$lib/components/DopytForm.svelte';
	import RozmerStepper from '$lib/components/konfigurator/RozmerStepper.svelte';
	import { cislaCiarka } from '$lib/konfigurator-jednotky';
	import {
		bazenModel,
		bazenKolaj,
		bazenVypln,
		bazenVstupPlatny,
		konfigurujBazen,
		bazenPonukaConfig,
		type BazenVstup
	} from '$lib/konfigurator-bazen';
	import type { PonukaConfig } from '$lib/ponuka';

	let { data } = $props();

	const r = $derived(data.rozmedzia);

	// východiskové voľby zo servera + rozumné stredové rozmery (v platných rozmedziach → súhrn hneď).
	// `untrack` v $state initializeri (rovnaký vzor ako pergola +page.svelte) — inak Svelte varuje
	// „state_referenced_locally" pri čítaní `data` mimo derived.
	let model = $state<string>(untrack(() => data.defaulty.model));
	let kolaj = $state<string>(untrack(() => data.defaulty.kolaj));
	let vypln = $state<string>(untrack(() => data.defaulty.vypln));
	let farba = $state<string>(untrack(() => data.farby[0]?.kod ?? ''));
	// rozmery = RozmerStepper (metre, #333 vzor) — clamp na [min,max], NIKDY null (súhrn/dopyt tak
	// pri editovaní rozmerov nezmizne, #385 review 🔵); segmenty = <select> (2..8, tiež nikdy null).
	let dlzka = $state<number | null>(6000);
	let sirka = $state<number | null>(4000);
	let vyska = $state<number | null>(1200);
	let segmenty = $state<number>(4);
	// možnosti počtu segmentov (2..8) — select nikdy nevráti mimo-rozmedzia/null hodnotu
	const segmentyOpts = $derived(
		Array.from(
			{ length: data.rozmedzia.segmenty.max - data.rozmedzia.segmenty.min + 1 },
			(_, i) => data.rozmedzia.segmenty.min + i
		)
	);

	// display label farby („RAL 7016 ANTRACIT") — do dopytu/PDF ide label, nie holý kód (vzor parseru)
	const farbaLabel = $derived.by(() => {
		const f = data.farby.find((x) => x.kod === farba);
		return f ? `RAL ${f.kod} ${f.nazov}` : farba;
	});

	const vstup = $derived<BazenVstup>({
		model: bazenModel(model),
		kolaj: bazenKolaj(kolaj),
		dlzka: dlzka ?? 0,
		sirka: sirka ?? 0,
		vyska: vyska ?? 0,
		segmenty,
		vypln: bazenVypln(vypln),
		farba: farbaLabel
	});

	const platny = $derived(bazenVstupPlatny(vstup));
	const suhrn = $derived(platny ? konfigurujBazen(vstup) : null);
	const ponukaCfg = $derived<PonukaConfig>(suhrn ? bazenPonukaConfig(suhrn) : {});

	function scrollNa(id: string) {
		document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
</script>

<svelte:head>
	<title>Navrhni si bazénové zastrešenie — Montalu</title>
	<meta
		name="description"
		content="Zostav si bazénové zastrešenie na mieru — vyber model, rozmery, koľajový systém, farbu a výplň a pošli nezáväzný dopyt so špecifikáciou v PDF."
	/>
</svelte:head>

<div class="baz">
	<!-- HERO -->
	<section class="baz-hero">
		<div class="baz-hero-foto">
			<img
				src="{base}/konfigurator/vyber/bazen.webp"
				alt="Bazénové zastrešenie Montalu"
				width="1000"
				height="600"
				loading="eager"
				fetchpriority="high"
			/>
		</div>
		<div class="baz-hero-text">
			<span class="baz-label">Konfigurátor bazénových zastrešení</span>
			<h1>Navrhni si bazénové zastrešenie</h1>
			<p>
				Vyber model, rozmery a vyhotovenie — pripravíme ti nezáväznú špecifikáciu (PDF) a ozveme sa
				s cenovou ponukou po obhliadke. Bez registrácie.
			</p>
		</div>
	</section>

	<div class="baz-grid">
		<!-- OVLÁDANIE -->
		<div class="baz-ovladanie">
			<!-- MODEL -->
			<fieldset class="baz-blok">
				<legend>Model</legend>
				<div class="baz-karty">
					{#each data.modely as m (m.kod)}
						<button
							type="button"
							class="baz-karta"
							class:vybrana={model === m.kod}
							aria-pressed={model === m.kod}
							data-testid="bazen-model-{m.kod}"
							onclick={() => (model = m.kod)}
						>
							<span class="baz-karta-nazov">{m.kod}</span>
							<span class="baz-karta-popis">{m.popis}</span>
						</button>
					{/each}
				</div>
			</fieldset>

			<!-- KOĽAJ -->
			<fieldset class="baz-blok">
				<legend>Koľajový systém</legend>
				<div class="baz-karty dvoj">
					{#each data.kolaje as k (k.kod)}
						<button
							type="button"
							class="baz-karta"
							class:vybrana={kolaj === k.kod}
							aria-pressed={kolaj === k.kod}
							data-testid="bazen-kolaj-{k.kod}"
							onclick={() => (kolaj = k.kod)}
						>
							<span class="baz-karta-nazov">{k.kod}</span>
							<span class="baz-karta-popis">{k.popis}</span>
						</button>
					{/each}
				</div>
			</fieldset>

			<!-- ROZMERY — metrové steppery (#333 RozmerStepper, zhodné so zákazníckou pergolou) -->
			<fieldset class="baz-blok">
				<legend>Rozmery</legend>
				<div class="baz-steppery">
					<RozmerStepper
						bind:hodnotaMm={dlzka}
						min={r.dlzka.min}
						max={r.dlzka.max}
						krokMm={r.dlzka.krok}
						popis="Dĺžka"
						akuzativ="dĺžku"
						id="baz-dlzka"
						testid="bazen-dlzka"
						name="dlzka"
					/>
					<RozmerStepper
						bind:hodnotaMm={sirka}
						min={r.sirka.min}
						max={r.sirka.max}
						krokMm={r.sirka.krok}
						popis="Šírka"
						akuzativ="šírku"
						id="baz-sirka"
						testid="bazen-sirka"
						name="sirka"
					/>
					<RozmerStepper
						bind:hodnotaMm={vyska}
						min={r.vyska.min}
						max={r.vyska.max}
						krokMm={r.vyska.krok}
						popis="Výška"
						akuzativ="výšku"
						id="baz-vyska"
						testid="bazen-vyska"
						name="vyska"
					/>
					<label class="baz-pole baz-segmenty">
						<span>Počet segmentov</span>
						<select bind:value={segmenty} data-testid="bazen-segmenty">
							{#each segmentyOpts as n (n)}
								<option value={n}>{n}</option>
							{/each}
						</select>
					</label>
				</div>
			</fieldset>

			<!-- FARBA + VÝPLŇ -->
			<fieldset class="baz-blok">
				<legend>Vyhotovenie</legend>
				<div class="baz-rozmery">
					<label class="baz-pole">
						<span>Farba konštrukcie</span>
						<select bind:value={farba} data-testid="bazen-farba">
							{#each data.farby as f (f.kod)}
								<option value={f.kod}>RAL {f.kod} — {f.nazov}</option>
							{/each}
						</select>
					</label>
					<label class="baz-pole">
						<span>Výplň</span>
						<select bind:value={vypln} data-testid="bazen-vypln">
							{#each data.vyplne as v (v.nazov)}
								<option value={v.nazov}>{v.nazov}</option>
							{/each}
						</select>
					</label>
				</div>
			</fieldset>
		</div>

		<!-- SÚHRN + CENA-INFO + DOPYT -->
		<div class="baz-panel">
			{#if suhrn}
				{@const s = suhrn}
				<section class="baz-suhrn" data-testid="bazen-suhrn">
					<h2>Tvoja konfigurácia</h2>
					<dl>
						<div>
							<dt>Model</dt>
							<dd>{s.model}</dd>
						</div>
						<div>
							<dt>Koľajový systém</dt>
							<dd>{s.kolaj}</dd>
						</div>
						<div>
							<dt>Rozmery (d × š)</dt>
							<dd data-testid="bazen-suhrn-rozmery">{s.dlzka} × {s.sirka} mm</dd>
						</div>
						<div>
							<dt>Výška</dt>
							<dd>{s.vyska} mm</dd>
						</div>
						<div>
							<dt>Počet segmentov</dt>
							<dd>{s.segmenty}</dd>
						</div>
						<div>
							<dt>Zastrešená plocha</dt>
							<dd>{cislaCiarka(s.plochaM2)} m²</dd>
						</div>
						<div>
							<dt>Farba</dt>
							<dd>{s.farba}</dd>
						</div>
						<div>
							<dt>Výplň</dt>
							<dd>{s.vypln}</dd>
						</div>
					</dl>
				</section>

				<!-- CENA je na DOPYT (honest-null: bazén nemá orientačný cenník) -->
				<section class="baz-cena-info" data-testid="bazen-cena-info">
					<strong>Cena na vyžiadanie</strong>
					<p>
						Bazénové zastrešenie ti naceníme individuálne — pošli nezáväzný dopyt a pripravíme
						cenovú ponuku po obhliadke miesta.
					</p>
					<button type="button" class="baz-btn primar" onclick={() => scrollNa('dopyt')}>
						Nezáväzný dopyt →
					</button>
				</section>

				<section class="baz-blok-kontakt" id="dopyt" data-testid="dopyt">
					<h2>Máš záujem o toto zastrešenie?</h2>
					<p class="baz-uvod">
						Nechaj nám kontakt a pripravíme ti nezáväznú špecifikáciu (PDF) na stiahnutie. Cenu
						pripravíme individuálne po obhliadke.
					</p>
					<DopytForm
						konfiguracia={ponukaCfg}
						disclaimer="Špecifikácia je nezáväzná. Cenu pripravíme individuálne po obhliadke miesta stavby."
					/>
				</section>
			{:else}
				<p class="baz-chyba" data-testid="bazen-chyba">
					⚠ Skontroluj zadané rozmery — musia byť v uvedených rozmedziach.
				</p>
			{/if}
		</div>
	</div>
</div>

<style>
	.baz {
		max-width: 1100px;
		margin: 0 auto;
		padding: clamp(20px, 4vw, 44px) clamp(16px, 4vw, 40px) clamp(40px, 6vw, 72px);
	}

	/* HERO */
	.baz-hero {
		display: grid;
		grid-template-columns: 1fr;
		gap: clamp(16px, 3vw, 28px);
		margin-bottom: clamp(24px, 4vw, 40px);
	}
	.baz-hero-foto {
		border-radius: var(--k-radius);
		overflow: hidden;
		aspect-ratio: 5 / 3;
		background: var(--k-surface-2);
		box-shadow: var(--k-shadow);
	}
	.baz-hero-foto img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.baz-label {
		display: block;
		font-size: 11.5px;
		font-weight: 600;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--k-accent);
		margin-bottom: 10px;
	}
	.baz-hero-text h1 {
		margin: 0 0 12px;
		font-size: clamp(1.8rem, 4vw, 2.7rem);
		font-weight: 700;
		line-height: 1.06;
		letter-spacing: -0.02em;
		color: var(--k-text);
	}
	.baz-hero-text p {
		margin: 0;
		font-size: 15.5px;
		line-height: 1.55;
		color: var(--k-muted);
		max-width: 560px;
	}

	/* LAYOUT: mobil 1 stĺpec, desktop ovládanie + panel */
	.baz-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: clamp(18px, 3vw, 32px);
		align-items: start;
	}

	.baz-blok {
		border: 1px solid var(--k-line);
		border-radius: var(--k-radius);
		background: var(--k-surface);
		padding: 18px 18px 20px;
		margin: 0 0 16px;
	}
	.baz-blok legend {
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--k-accent);
		padding: 0 6px;
	}

	.baz-karty {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 10px;
		margin-top: 6px;
	}
	.baz-karty.dvoj {
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
	}
	.baz-karta {
		display: flex;
		flex-direction: column;
		gap: 5px;
		text-align: left;
		padding: 12px 13px;
		border: 1.5px solid var(--k-line);
		border-radius: var(--k-radius-sm);
		background: var(--k-surface);
		cursor: pointer;
		font-family: inherit;
		transition:
			border-color 0.15s ease,
			background 0.15s ease;
	}
	.baz-karta:hover {
		border-color: var(--k-line-2);
	}
	.baz-karta.vybrana {
		border-color: var(--k-ink);
		background: var(--k-accent-soft);
	}
	.baz-karta:focus-visible {
		outline: 2px solid var(--k-ink);
		outline-offset: 2px;
	}
	.baz-karta-nazov {
		font-size: 15px;
		font-weight: 650;
		color: var(--k-text);
	}
	.baz-karta-popis {
		font-size: 12.5px;
		line-height: 1.4;
		color: var(--k-muted);
	}

	.baz-rozmery {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 12px;
		margin-top: 6px;
	}
	/* metrové steppery (RozmerStepper) stohované pod sebou + segmenty select */
	.baz-steppery {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-top: 6px;
	}
	.baz-segmenty {
		max-width: 220px;
	}
	.baz-pole {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.baz-pole span {
		font-size: 13px;
		font-weight: 600;
		color: var(--k-text);
	}
	.baz-pole select {
		padding: 9px 11px;
		border: 1px solid var(--k-line-2);
		border-radius: var(--k-radius-sm);
		font: inherit;
		background: var(--k-surface);
		color: var(--k-text);
	}
	.baz-pole select:focus-visible {
		outline: 2px solid var(--k-ink);
		outline-offset: 1px;
	}

	/* PANEL: súhrn + cena-info + dopyt */
	.baz-panel {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.baz-suhrn,
	.baz-cena-info,
	.baz-blok-kontakt {
		border: 1px solid var(--k-line);
		border-radius: var(--k-radius);
		background: var(--k-surface);
		padding: 20px 22px;
	}
	.baz-suhrn h2,
	.baz-blok-kontakt h2 {
		margin: 0 0 12px;
		font-size: 18px;
		font-weight: 650;
		letter-spacing: -0.01em;
		color: var(--k-text);
	}
	.baz-suhrn dl {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.baz-suhrn dl > div {
		display: flex;
		justify-content: space-between;
		gap: 14px;
		border-bottom: 1px solid var(--k-line);
		padding-bottom: 8px;
	}
	.baz-suhrn dl > div:last-child {
		border-bottom: 0;
		padding-bottom: 0;
	}
	.baz-suhrn dt {
		font-size: 13.5px;
		color: var(--k-muted);
	}
	.baz-suhrn dd {
		margin: 0;
		font-size: 13.5px;
		font-weight: 600;
		color: var(--k-text);
		text-align: right;
	}

	.baz-cena-info {
		background: var(--k-surface-2);
		border-color: var(--k-line-2);
	}
	.baz-cena-info strong {
		display: block;
		font-size: 17px;
		color: var(--k-text);
		margin-bottom: 6px;
	}
	.baz-cena-info p {
		margin: 0 0 14px;
		font-size: 13.5px;
		line-height: 1.5;
		color: var(--k-muted);
	}

	.baz-uvod {
		color: var(--k-muted);
		font-size: 14px;
		line-height: 1.5;
		margin: 0 0 16px;
	}

	.baz-btn {
		font-family: inherit;
		font-size: 14px;
		font-weight: 600;
		border-radius: var(--k-radius-pill);
		padding: 11px 20px;
		cursor: pointer;
		border: 1px solid transparent;
	}
	.baz-btn.primar {
		background: var(--k-ink);
		color: #fff;
	}
	.baz-btn.primar:hover {
		background: var(--k-ink-hover);
	}
	.baz-btn:focus-visible {
		outline: 2px solid var(--k-ink);
		outline-offset: 2px;
	}

	.baz-chyba {
		color: #a3261c;
		background: #fbeeec;
		border: 1px solid #f2cfc9;
		border-radius: var(--k-radius-sm);
		padding: 14px 16px;
		font-size: 14px;
		margin: 0;
	}

	@media (min-width: 900px) {
		.baz-hero {
			grid-template-columns: 1.1fr 0.9fr;
			align-items: center;
		}
		.baz-grid {
			grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
		}
	}
</style>
