<script lang="ts">
	// Verejný zákaznícky konfigurátor zasklenia terás a balkónov (#387, etapa jednotného rámu #384).
	// JEDNODUCHÁ jednostĺpcová stránka (zámerne bez 3D — dispatch + vzor #385) a BEZ ORIENTAČNEJ CENY
	// (honest-null: zasklenie nemá overený cenový zdroj — cena sa nevymýšľa). Konfigurácia
	// (umiestnenie/model/rozmery/počet krídel/farba/výplň) sa počíta ČISTO klientsky (`$derived`,
	// žiadny server round-trip — netreba, nie je cena) a tečie do zdieľaného DopytForm (#277) → PDF
	// špecifikácia (bez ceny) + Odoo lead. Zdieľané `--k-*` tokeny z `konfigurator/+layout.svelte`.
	// Money-neutralita: importuje LEN client-safe `konfigurator-zasklenie` + DopytForm (guard:
	// konfigurator-money-safety). Žiadne `console.*`.
	import { untrack } from 'svelte';
	import { base } from '$app/paths';
	import DopytForm from '$lib/components/DopytForm.svelte';
	import RozmerStepper from '$lib/components/konfigurator/RozmerStepper.svelte';
	import { cislaCiarka } from '$lib/konfigurator-jednotky';
	import {
		zaskleniUmiestnenie,
		zaskleniModel,
		zaskleniVypln,
		zaskleniVstupPlatny,
		konfigurujZasklenie,
		zaskleniePonukaConfig,
		type ZaskleniVstup
	} from '$lib/konfigurator-zasklenie';
	import type { PonukaConfig } from '$lib/ponuka';

	let { data } = $props();

	const r = $derived(data.rozmedzia);

	// východiskové voľby zo servera + rozumné stredové rozmery (v platných rozmedziach → súhrn hneď).
	// `untrack` v $state initializeri (rovnaký vzor ako pergola/bazén +page.svelte) — inak Svelte
	// varuje „state_referenced_locally" pri čítaní `data` mimo derived.
	let umiestnenie = $state<string>(untrack(() => data.defaulty.umiestnenie));
	let model = $state<string>(untrack(() => data.defaulty.model));
	let vypln = $state<string>(untrack(() => data.defaulty.vypln));
	let farba = $state<string>(untrack(() => data.farby[0]?.kod ?? ''));
	// rozmery = RozmerStepper (metre, #333 vzor) — clamp na [min,max], NIKDY null (súhrn/dopyt tak
	// pri editovaní rozmerov nezmizne, #385 review 🔵); počet krídel = <select> (2..8, tiež nikdy null).
	let sirka = $state<number | null>(4000);
	let vyska = $state<number | null>(2500);
	let kridla = $state<number>(4);

	// modely dostupné pre zvolené umiestnenie (klient si filtruje z client-safe katalógu)
	const modelyPreU = $derived(data.modely.filter((m) => m.umiestnenie === umiestnenie));

	// zmena umiestnenia RESETUJE model na prvý model daného umiestnenia (žiadny effect → žiadna
	// dead-effect pasca; reset žije priamo v onclick handleri, jedinom mieste zmeny umiestnenia).
	function vyberUmiestnenie(u: string) {
		umiestnenie = u;
		model = data.modely.find((m) => m.umiestnenie === u)?.kod ?? '';
	}

	// možnosti počtu krídel (2..8) — select nikdy nevráti mimo-rozmedzia/null hodnotu
	const kridlaOpts = $derived(
		Array.from(
			{ length: data.rozmedzia.kridla.max - data.rozmedzia.kridla.min + 1 },
			(_, i) => data.rozmedzia.kridla.min + i
		)
	);

	// display label farby („RAL 7016 ANTRACIT") — do dopytu/PDF ide label, nie holý kód (vzor parseru)
	const farbaLabel = $derived.by(() => {
		const f = data.farby.find((x) => x.kod === farba);
		return f ? `RAL ${f.kod} ${f.nazov}` : farba;
	});

	const u = $derived(zaskleniUmiestnenie(umiestnenie));

	const vstup = $derived<ZaskleniVstup>({
		umiestnenie: u,
		model: zaskleniModel(model, u),
		sirka: sirka ?? 0,
		vyska: vyska ?? 0,
		kridla,
		vypln: zaskleniVypln(vypln),
		farba: farbaLabel
	});

	const platny = $derived(zaskleniVstupPlatny(vstup));
	const suhrn = $derived(platny ? konfigurujZasklenie(vstup) : null);
	const ponukaCfg = $derived<PonukaConfig>(suhrn ? zaskleniePonukaConfig(suhrn) : {});

	function scrollNa(id: string) {
		document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
</script>

<svelte:head>
	<title>Navrhni si zasklenie terasy alebo balkóna — Montalu</title>
	<meta
		name="description"
		content="Zostav si zasklenie terasy alebo balkóna na mieru — vyber systém, rozmery, počet krídel, farbu a sklo a pošli nezáväzný dopyt so špecifikáciou v PDF."
	/>
</svelte:head>

<div class="zas">
	<!-- HERO -->
	<section class="zas-hero">
		<div class="zas-hero-foto">
			<img
				src="{base}/konfigurator/vyber/zasklenie.webp"
				alt="Zasklenie terasy Montalu"
				width="1000"
				height="600"
				loading="eager"
				fetchpriority="high"
			/>
		</div>
		<div class="zas-hero-text">
			<span class="zas-label">Konfigurátor zasklenia terás a balkónov</span>
			<h1>Navrhni si zasklenie</h1>
			<p>
				Vyber umiestnenie, systém, rozmery a vyhotovenie — pripravíme ti nezáväznú špecifikáciu
				(PDF) a ozveme sa s cenovou ponukou po obhliadke. Bez registrácie.
			</p>
		</div>
	</section>

	<div class="zas-grid">
		<!-- OVLÁDANIE -->
		<div class="zas-ovladanie">
			<!-- UMIESTNENIE -->
			<fieldset class="zas-blok">
				<legend>Umiestnenie</legend>
				<div class="zas-karty dvoj">
					{#each data.umiestnenia as um (um)}
						<button
							type="button"
							class="zas-karta"
							class:vybrana={umiestnenie === um}
							aria-pressed={umiestnenie === um}
							data-testid="zasklenie-umiestnenie-{um}"
							onclick={() => vyberUmiestnenie(um)}
						>
							<span class="zas-karta-nazov">{um}</span>
						</button>
					{/each}
				</div>
			</fieldset>

			<!-- MODEL (filtrovaný podľa umiestnenia) -->
			<fieldset class="zas-blok">
				<legend>Systém zasklenia</legend>
				<div class="zas-karty">
					{#each modelyPreU as m (m.kod)}
						<button
							type="button"
							class="zas-karta"
							class:vybrana={model === m.kod}
							aria-pressed={model === m.kod}
							data-testid="zasklenie-model-{m.kod}"
							onclick={() => (model = m.kod)}
						>
							<span class="zas-karta-nazov">{m.kod}</span>
							<span class="zas-karta-system">{m.system}</span>
							<span class="zas-karta-popis">{m.popis}</span>
						</button>
					{/each}
				</div>
			</fieldset>

			<!-- ROZMERY — metrové steppery (#333 RozmerStepper, zhodné so zákazníckou pergolou/bazénom) -->
			<fieldset class="zas-blok">
				<legend>Rozmery</legend>
				<div class="zas-steppery">
					<RozmerStepper
						bind:hodnotaMm={sirka}
						min={r.sirka.min}
						max={r.sirka.max}
						krokMm={r.sirka.krok}
						popis="Šírka"
						akuzativ="šírku"
						id="zas-sirka"
						testid="zasklenie-sirka"
						name="sirka"
					/>
					<RozmerStepper
						bind:hodnotaMm={vyska}
						min={r.vyska.min}
						max={r.vyska.max}
						krokMm={r.vyska.krok}
						popis="Výška"
						akuzativ="výšku"
						id="zas-vyska"
						testid="zasklenie-vyska"
						name="vyska"
					/>
					<label class="zas-pole zas-kridla">
						<span>Počet krídel</span>
						<select bind:value={kridla} data-testid="zasklenie-kridla">
							{#each kridlaOpts as n (n)}
								<option value={n}>{n}</option>
							{/each}
						</select>
					</label>
				</div>
			</fieldset>

			<!-- FARBA + VÝPLŇ -->
			<fieldset class="zas-blok">
				<legend>Vyhotovenie</legend>
				<div class="zas-rozmery">
					<label class="zas-pole">
						<span>Farba konštrukcie</span>
						<select bind:value={farba} data-testid="zasklenie-farba">
							{#each data.farby as f (f.kod)}
								<option value={f.kod}>RAL {f.kod} — {f.nazov}</option>
							{/each}
						</select>
					</label>
					<label class="zas-pole">
						<span>Sklo / výplň</span>
						<select bind:value={vypln} data-testid="zasklenie-vypln">
							{#each data.vyplne as v (v.nazov)}
								<option value={v.nazov}>{v.nazov}</option>
							{/each}
						</select>
					</label>
				</div>
			</fieldset>
		</div>

		<!-- SÚHRN + CENA-INFO + DOPYT -->
		<div class="zas-panel">
			{#if suhrn}
				{@const s = suhrn}
				<section class="zas-suhrn" data-testid="zasklenie-suhrn">
					<h2>Tvoja konfigurácia</h2>
					<dl>
						<div>
							<dt>Umiestnenie</dt>
							<dd>{s.umiestnenie}</dd>
						</div>
						<div>
							<dt>Systém</dt>
							<dd>{s.model} ({s.system})</dd>
						</div>
						<div>
							<dt>Rozmery (š × v)</dt>
							<dd data-testid="zasklenie-suhrn-rozmery">{s.sirka} × {s.vyska} mm</dd>
						</div>
						<div>
							<dt>Počet krídel</dt>
							<dd>{s.kridla}</dd>
						</div>
						<div>
							<dt>Zasklená plocha</dt>
							<dd>{cislaCiarka(s.plochaM2)} m²</dd>
						</div>
						<div>
							<dt>Farba</dt>
							<dd>{s.farba}</dd>
						</div>
						<div>
							<dt>Sklo / výplň</dt>
							<dd>{s.vypln}</dd>
						</div>
					</dl>
				</section>

				<!-- CENA je na DOPYT (honest-null: zasklenie nemá orientačný cenník) -->
				<section class="zas-cena-info" data-testid="zasklenie-cena-info">
					<strong>Cena na vyžiadanie</strong>
					<p>
						Zasklenie ti naceníme individuálne — pošli nezáväzný dopyt a pripravíme cenovú ponuku po
						obhliadke miesta.
					</p>
					<button type="button" class="zas-btn primar" onclick={() => scrollNa('dopyt')}>
						Nezáväzný dopyt →
					</button>
				</section>

				<section class="zas-blok-kontakt" id="dopyt" data-testid="dopyt">
					<h2>Máš záujem o toto zasklenie?</h2>
					<p class="zas-uvod">
						Nechaj nám kontakt a pripravíme ti nezáväznú špecifikáciu (PDF) na stiahnutie. Cenu
						pripravíme individuálne po obhliadke.
					</p>
					<DopytForm
						konfiguracia={ponukaCfg}
						disclaimer="Špecifikácia je nezáväzná. Cenu pripravíme individuálne po obhliadke miesta stavby."
					/>
				</section>
			{:else}
				<p class="zas-chyba" data-testid="zasklenie-chyba">
					⚠ Skontroluj zadané rozmery — musia byť v uvedených rozmedziach.
				</p>
			{/if}
		</div>
	</div>
</div>

<style>
	.zas {
		max-width: 1100px;
		margin: 0 auto;
		padding: clamp(20px, 4vw, 44px) clamp(16px, 4vw, 40px) clamp(40px, 6vw, 72px);
	}

	/* HERO */
	.zas-hero {
		display: grid;
		grid-template-columns: 1fr;
		gap: clamp(16px, 3vw, 28px);
		margin-bottom: clamp(24px, 4vw, 40px);
	}
	.zas-hero-foto {
		border-radius: var(--k-radius);
		overflow: hidden;
		aspect-ratio: 5 / 3;
		background: var(--k-surface-2);
		box-shadow: var(--k-shadow);
	}
	.zas-hero-foto img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.zas-label {
		display: block;
		font-size: 11.5px;
		font-weight: 600;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--k-accent);
		margin-bottom: 10px;
	}
	.zas-hero-text h1 {
		margin: 0 0 12px;
		font-size: clamp(1.8rem, 4vw, 2.7rem);
		font-weight: 700;
		line-height: 1.06;
		letter-spacing: -0.02em;
		color: var(--k-text);
	}
	.zas-hero-text p {
		margin: 0;
		font-size: 15.5px;
		line-height: 1.55;
		color: var(--k-muted);
		max-width: 560px;
	}

	/* LAYOUT: mobil 1 stĺpec, desktop ovládanie + panel */
	.zas-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: clamp(18px, 3vw, 32px);
		align-items: start;
	}

	.zas-blok {
		border: 1px solid var(--k-line);
		border-radius: var(--k-radius);
		background: var(--k-surface);
		padding: 18px 18px 20px;
		margin: 0 0 16px;
	}
	.zas-blok legend {
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--k-accent);
		padding: 0 6px;
	}

	.zas-karty {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 10px;
		margin-top: 6px;
	}
	.zas-karty.dvoj {
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
	}
	.zas-karta {
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
	.zas-karta:hover {
		border-color: var(--k-line-2);
	}
	.zas-karta.vybrana {
		border-color: var(--k-ink);
		background: var(--k-accent-soft);
	}
	.zas-karta:focus-visible {
		outline: 2px solid var(--k-ink);
		outline-offset: 2px;
	}
	.zas-karta-nazov {
		font-size: 15px;
		font-weight: 650;
		color: var(--k-text);
	}
	.zas-karta-system {
		font-size: 11.5px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--k-accent);
	}
	.zas-karta-popis {
		font-size: 12.5px;
		line-height: 1.4;
		color: var(--k-muted);
	}

	.zas-rozmery {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 12px;
		margin-top: 6px;
	}
	/* metrové steppery (RozmerStepper) stohované pod sebou + počet krídel select */
	.zas-steppery {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-top: 6px;
	}
	.zas-kridla {
		max-width: 220px;
	}
	.zas-pole {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.zas-pole span {
		font-size: 13px;
		font-weight: 600;
		color: var(--k-text);
	}
	.zas-pole select {
		padding: 9px 11px;
		border: 1px solid var(--k-line-2);
		border-radius: var(--k-radius-sm);
		font: inherit;
		background: var(--k-surface);
		color: var(--k-text);
	}
	.zas-pole select:focus-visible {
		outline: 2px solid var(--k-ink);
		outline-offset: 1px;
	}

	/* PANEL: súhrn + cena-info + dopyt */
	.zas-panel {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.zas-suhrn,
	.zas-cena-info,
	.zas-blok-kontakt {
		border: 1px solid var(--k-line);
		border-radius: var(--k-radius);
		background: var(--k-surface);
		padding: 20px 22px;
	}
	.zas-suhrn h2,
	.zas-blok-kontakt h2 {
		margin: 0 0 12px;
		font-size: 18px;
		font-weight: 650;
		letter-spacing: -0.01em;
		color: var(--k-text);
	}
	.zas-suhrn dl {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.zas-suhrn dl > div {
		display: flex;
		justify-content: space-between;
		gap: 14px;
		border-bottom: 1px solid var(--k-line);
		padding-bottom: 8px;
	}
	.zas-suhrn dl > div:last-child {
		border-bottom: 0;
		padding-bottom: 0;
	}
	.zas-suhrn dt {
		font-size: 13.5px;
		color: var(--k-muted);
	}
	.zas-suhrn dd {
		margin: 0;
		font-size: 13.5px;
		font-weight: 600;
		color: var(--k-text);
		text-align: right;
	}

	.zas-cena-info {
		background: var(--k-surface-2);
		border-color: var(--k-line-2);
	}
	.zas-cena-info strong {
		display: block;
		font-size: 17px;
		color: var(--k-text);
		margin-bottom: 6px;
	}
	.zas-cena-info p {
		margin: 0 0 14px;
		font-size: 13.5px;
		line-height: 1.5;
		color: var(--k-muted);
	}

	.zas-uvod {
		color: var(--k-muted);
		font-size: 14px;
		line-height: 1.5;
		margin: 0 0 16px;
	}

	.zas-btn {
		font-family: inherit;
		font-size: 14px;
		font-weight: 600;
		border-radius: var(--k-radius-pill);
		padding: 11px 20px;
		cursor: pointer;
		border: 1px solid transparent;
	}
	.zas-btn.primar {
		background: var(--k-ink);
		color: #fff;
	}
	.zas-btn.primar:hover {
		background: var(--k-ink-hover);
	}
	.zas-btn:focus-visible {
		outline: 2px solid var(--k-ink);
		outline-offset: 2px;
	}

	.zas-chyba {
		color: #a3261c;
		background: #fbeeec;
		border: 1px solid #f2cfc9;
		border-radius: var(--k-radius-sm);
		padding: 14px 16px;
		font-size: 14px;
		margin: 0;
	}

	@media (min-width: 900px) {
		.zas-hero {
			grid-template-columns: 1.1fr 0.9fr;
			align-items: center;
		}
		.zas-grid {
			grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
		}
	}
</style>
