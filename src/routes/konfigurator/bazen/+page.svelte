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
	import { enhance } from '$app/forms';
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
	// #404: typy orientačnej ceny (server-počítanej `vypocet` akciou). LEN typy → žiadny import
	// cenového/Money modulu do klientskeho bundle (leak-guard A ostáva zelený).
	import type { VerejnaCena, CenaModelu } from '$lib/konfigurator';

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

	// #404: orientačná cena — server-počítaná (`vypocet` akcia, enhance submit, žiadny reload). Zobrazí
	// sa až po kliku „Zobraziť orientačnú cenu" (vzor pergolovej `vypocet`); pri zmene modelu/rozmerov
	// sa výsledok považuje za neaktuálny (`cenaAktualna`), takže sa NIKDY neukáže cena pre iný rozmer.
	let cenaVysledok = $state<{ cena: VerejnaCena; cenyModely: CenaModelu[] } | null>(null);
	let cenaError = $state<string | null>(null);
	let cenaNacitava = $state(false);
	let poslednyKluc = $state<string | null>(null);
	const cenaKluc = $derived(`${vstup.model}|${dlzka ?? 0}|${sirka ?? 0}`);
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

				<!-- ORIENTAČNÁ CENA (#404) — server-počítaná bazénovou maticou montalu.sk (enhance submit) -->
				<section class="baz-cena" data-testid="bazen-cena-sekcia">
					{#if cenaAktualna && cenaVysledok}
						{@const c = cenaVysledok.cena}
						<div class="baz-cena-blok" data-testid="bazen-cena">
							{#if c.druh === 'cena'}
								<span class="baz-cena-label">Orientačná cena — model {c.model}</span>
								{#if c.hladinaLabel}
									<span class="baz-cena-vo" data-testid="bazen-cena-hladina">{c.hladinaLabel}</span>
								{/if}
								<div class="baz-cena-hlavne">
									<span class="baz-cena-sdph" data-testid="bazen-cena-sdph">{eur(c.sDph)}</span>
									<span class="baz-cena-mena">s DPH</span>
								</div>
								<div class="baz-cena-bezdph" data-testid="bazen-cena-bezdph">
									{eur(c.bezDph)} bez DPH
								</div>
							{:else}
								<span class="baz-cena-label">Cena na vyžiadanie — model {c.model}</span>
								{#if c.hladinaLabel}
									<span class="baz-cena-vo" data-testid="bazen-cena-hladina">{c.hladinaLabel}</span>
								{/if}
								<p class="baz-cena-dovod" data-testid="bazen-cena-individualna">
									{c.dovod} Pripravíme ti individuálnu ponuku.
								</p>
							{/if}
							<p class="baz-cena-pozn">
								Orientačná cena vychádza z aktuálneho cenníka pre zvolený model a rozmery. Presnú,
								záväznú cenu pripravíme po obhliadke miesta.
							</p>
						</div>

						{#if cenaVysledok.cenyModely}
							<div class="baz-porovnanie" data-testid="bazen-porovnanie">
								<h3>Porovnanie modelov (orientačne, s DPH)</h3>
								<ul>
									{#each cenaVysledok.cenyModely as cm (cm.model)}
										<li
											class:vybrany={cm.model === c.model}
											data-testid="bazen-porovnanie-{cm.model}"
										>
											<span class="p-model">{cm.model}</span>
											<span class="p-cena">
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
							class="baz-cena-form"
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
									}
								};
							}}
						>
							<input type="hidden" name="model" value={vstup.model} />
							<input type="hidden" name="dlzka" value={dlzka ?? 0} />
							<input type="hidden" name="sirka" value={sirka ?? 0} />
							<strong>Orientačná cena</strong>
							<p>
								Zobraz si orientačnú cenu zvoleného modelu a porovnanie modelov. Presnú, záväznú
								cenu pripravíme po obhliadke miesta.
							</p>
							{#if cenaError}
								<p class="baz-cena-chyba" data-testid="bazen-cena-chyba">{cenaError}</p>
							{/if}
							<button
								type="submit"
								class="baz-btn primar"
								data-testid="bazen-cena-zobrazit"
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
					<button type="button" class="baz-btn druhotny" onclick={() => scrollNa('dopyt')}>
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

	/* ORIENTAČNÁ CENA (#404) */
	.baz-cena {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.baz-cena-form {
		border: 1px solid var(--k-line-2);
		border-radius: var(--k-radius);
		background: var(--k-surface-2);
		padding: 20px 22px;
	}
	.baz-cena-form strong {
		display: block;
		font-size: 17px;
		color: var(--k-text);
		margin-bottom: 6px;
	}
	.baz-cena-form p {
		margin: 0 0 14px;
		font-size: 13.5px;
		line-height: 1.5;
		color: var(--k-muted);
	}
	.baz-cena-chyba {
		color: #a3261c;
		font-weight: 600;
	}
	/* prémiový antracitový cenový panel (tmavá karta, Tesla-style — zhoda s pergolovým KonfCena) */
	.baz-cena-blok {
		background: var(--k-ink, #1b1e23);
		color: #fff;
		border-radius: var(--k-radius);
		padding: 20px 22px;
	}
	.baz-cena-label {
		display: block;
		color: rgba(255, 255, 255, 0.62);
		font-size: 12px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		font-weight: 600;
	}
	.baz-cena-vo {
		display: inline-block;
		margin-top: 8px;
		padding: 2px 9px;
		border-radius: 999px;
		background: var(--k-accent, #b07a45);
		color: #fff;
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.baz-cena-hlavne {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin-top: 8px;
	}
	.baz-cena-sdph {
		font-size: clamp(28px, 7vw, 38px);
		font-weight: 700;
		line-height: 1.05;
		letter-spacing: -0.02em;
		font-variant-numeric: tabular-nums;
	}
	.baz-cena-mena {
		color: rgba(255, 255, 255, 0.66);
		font-size: 14px;
	}
	.baz-cena-bezdph {
		color: rgba(255, 255, 255, 0.66);
		font-size: 14px;
		margin-top: 4px;
	}
	.baz-cena-dovod {
		color: rgba(255, 255, 255, 0.72);
		font-size: 13.5px;
		margin: 8px 0 0;
	}
	.baz-cena-pozn {
		color: rgba(255, 255, 255, 0.5);
		font-size: 12px;
		line-height: 1.45;
		margin: 14px 0 0;
	}
	.baz-porovnanie {
		border: 1px solid var(--k-line);
		border-radius: var(--k-radius);
		background: var(--k-surface);
		padding: 16px 20px;
	}
	.baz-porovnanie h3 {
		font-size: 11.5px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		font-weight: 600;
		margin: 0 0 12px;
		color: var(--k-faint, #9a9ea6);
	}
	.baz-porovnanie ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 2px;
	}
	.baz-porovnanie li {
		display: flex;
		justify-content: space-between;
		gap: 14px;
		padding: 9px 10px;
		border-radius: 9px;
		font-size: 15px;
	}
	.baz-porovnanie li.vybrany {
		background: var(--k-accent-soft, #f5ede2);
		font-weight: 700;
	}
	.baz-porovnanie .p-model {
		color: var(--k-muted, #6b7078);
	}
	.baz-porovnanie .p-cena {
		color: var(--k-text, #16181c);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.baz-btn.druhotny {
		background: var(--k-surface);
		color: var(--k-text);
		border-color: var(--k-line-2);
	}
	.baz-btn.druhotny:hover {
		border-color: var(--k-ink);
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
