<script lang="ts">
	// Verejný zákaznícky konfigurátor zimných záhrad (#386, etapa 3 jednotného rámu #384).
	// JEDNODUCHÁ jednostĺpcová stránka (zámerne bez 3D — geometria zimnej záhrady zatiaľ neexistuje,
	// viď design komentár + follow-up) a BEZ ORIENTAČNEJ CENY (honest-null: zimná záhrada nemá overený
	// cenový zdroj — cena sa nevymýšľa). Konfigurácia (model/rozmery/farba/zasklenie) sa počíta ČISTO
	// klientsky (`$derived`, žiadny server round-trip — netreba, nie je cena) a tečie do zdieľaného
	// DopytForm (#277) → PDF špecifikácia (bez ceny) + Odoo lead. Zdieľané `--k-*` tokeny z
	// `konfigurator/+layout.svelte`. Money-neutralita: importuje LEN client-safe
	// `konfigurator-zimna-zahrada` + DopytForm (guard: konfigurator-money-safety). Žiadne `console.*`.
	import { untrack } from 'svelte';
	import { base } from '$app/paths';
	import DopytForm from '$lib/components/DopytForm.svelte';
	import RozmerStepper from '$lib/components/konfigurator/RozmerStepper.svelte';
	import { cislaCiarka } from '$lib/konfigurator-jednotky';
	import {
		zzModel,
		zzZasklenie,
		zzVstupPlatny,
		konfigurujZimnaZahradu,
		zimnaZahradaPonukaConfig,
		type ZzVstup
	} from '$lib/konfigurator-zimna-zahrada';
	import type { PonukaConfig } from '$lib/ponuka';

	let { data } = $props();

	const r = $derived(data.rozmedzia);

	// východiskové voľby zo servera + rozumné stredové rozmery (v platných rozmedziach → súhrn hneď).
	// `untrack` v $state initializeri (rovnaký vzor ako pergola/bazén +page.svelte) — inak Svelte
	// varuje „state_referenced_locally" pri čítaní `data` mimo derived.
	let model = $state<string>(untrack(() => data.defaulty.model));
	let zasklenie = $state<string>(untrack(() => data.defaulty.zasklenie));
	let farba = $state<string>(untrack(() => data.farby[0]?.kod ?? ''));
	// rozmery = RozmerStepper (metre, #333 vzor) — clamp na [min,max], NIKDY null (súhrn/dopyt tak
	// pri editovaní rozmerov nezmizne, #385 review 🔵).
	let sirka = $state<number | null>(4000);
	let hlbka = $state<number | null>(3500);
	let vyska = $state<number | null>(2800);

	// display label farby („RAL 7016 ANTRACIT") — do dopytu/PDF ide label, nie holý kód (vzor parseru)
	const farbaLabel = $derived.by(() => {
		const f = data.farby.find((x) => x.kod === farba);
		return f ? `RAL ${f.kod} ${f.nazov}` : farba;
	});

	const vstup = $derived<ZzVstup>({
		model: zzModel(model),
		sirka: sirka ?? 0,
		hlbka: hlbka ?? 0,
		vyska: vyska ?? 0,
		zasklenie: zzZasklenie(zasklenie),
		farba: farbaLabel
	});

	const platny = $derived(zzVstupPlatny(vstup));
	const suhrn = $derived(platny ? konfigurujZimnaZahradu(vstup) : null);
	const ponukaCfg = $derived<PonukaConfig>(suhrn ? zimnaZahradaPonukaConfig(suhrn) : {});

	function scrollNa(id: string) {
		document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
</script>

<svelte:head>
	<title>Navrhni si zimnú záhradu — Montalu</title>
	<meta
		name="description"
		content="Zostav si hliníkovú zimnú záhradu na mieru — vyber model, rozmery, farbu a typ zasklenia a pošli nezáväzný dopyt so špecifikáciou v PDF."
	/>
</svelte:head>

<div class="zz">
	<!-- HERO -->
	<section class="zz-hero">
		<div class="zz-hero-foto">
			<img
				src="{base}/konfigurator/vyber/zimna-zahrada.webp"
				alt="Hliníková zimná záhrada Montalu"
				width="1000"
				height="600"
				loading="eager"
				fetchpriority="high"
			/>
		</div>
		<div class="zz-hero-text">
			<span class="zz-label">Konfigurátor zimných záhrad</span>
			<h1>Navrhni si zimnú záhradu</h1>
			<p>
				Vyber model, rozmery a zasklenie — pripravíme ti nezáväznú špecifikáciu (PDF) a ozveme sa s
				cenovou ponukou po obhliadke. Bez registrácie.
			</p>
		</div>
	</section>

	<div class="zz-grid">
		<!-- OVLÁDANIE -->
		<div class="zz-ovladanie">
			<!-- MODEL -->
			<fieldset class="zz-blok">
				<legend>Model</legend>
				<div class="zz-karty dvoj">
					{#each data.modely as m (m.kod)}
						<button
							type="button"
							class="zz-karta"
							class:vybrana={model === m.kod}
							aria-pressed={model === m.kod}
							data-testid="zz-model-{m.kod}"
							onclick={() => (model = m.kod)}
						>
							<span class="zz-karta-nazov">{m.kod}</span>
							<span class="zz-karta-popis">{m.popis}</span>
						</button>
					{/each}
				</div>
			</fieldset>

			<!-- ROZMERY — metrové steppery (#333 RozmerStepper, zhodné so zákazníckou pergolou/bazénom) -->
			<fieldset class="zz-blok">
				<legend>Rozmery</legend>
				<div class="zz-steppery">
					<RozmerStepper
						bind:hodnotaMm={sirka}
						min={r.sirka.min}
						max={r.sirka.max}
						krokMm={r.sirka.krok}
						popis="Šírka"
						akuzativ="šírku"
						id="zz-sirka"
						testid="zz-sirka"
						name="sirka"
					/>
					<RozmerStepper
						bind:hodnotaMm={hlbka}
						min={r.hlbka.min}
						max={r.hlbka.max}
						krokMm={r.hlbka.krok}
						popis="Hĺbka"
						akuzativ="hĺbku"
						id="zz-hlbka"
						testid="zz-hlbka"
						name="hlbka"
					/>
					<RozmerStepper
						bind:hodnotaMm={vyska}
						min={r.vyska.min}
						max={r.vyska.max}
						krokMm={r.vyska.krok}
						popis="Výška"
						akuzativ="výšku"
						id="zz-vyska"
						testid="zz-vyska"
						name="vyska"
					/>
				</div>
			</fieldset>

			<!-- FARBA + ZASKLENIE -->
			<fieldset class="zz-blok">
				<legend>Vyhotovenie</legend>
				<div class="zz-rozmery">
					<label class="zz-pole">
						<span>Farba konštrukcie</span>
						<select bind:value={farba} data-testid="zz-farba">
							{#each data.farby as f (f.kod)}
								<option value={f.kod}>RAL {f.kod} — {f.nazov}</option>
							{/each}
						</select>
					</label>
					<label class="zz-pole">
						<span>Zasklenie</span>
						<select bind:value={zasklenie} data-testid="zz-zasklenie">
							{#each data.zasklenia as z (z.nazov)}
								<option value={z.nazov}>{z.nazov}</option>
							{/each}
						</select>
					</label>
				</div>
			</fieldset>
		</div>

		<!-- SÚHRN + CENA-INFO + DOPYT -->
		<div class="zz-panel">
			{#if suhrn}
				{@const s = suhrn}
				<section class="zz-suhrn" data-testid="zz-suhrn">
					<h2>Tvoja konfigurácia</h2>
					<dl>
						<div>
							<dt>Model</dt>
							<dd>{s.model}</dd>
						</div>
						<div>
							<dt>Rozmery (š × h)</dt>
							<dd data-testid="zz-suhrn-rozmery">{s.sirka} × {s.hlbka} mm</dd>
						</div>
						<div>
							<dt>Výška</dt>
							<dd>{s.vyska} mm</dd>
						</div>
						<div>
							<dt>Zastavaná plocha</dt>
							<dd>{cislaCiarka(s.plochaM2)} m²</dd>
						</div>
						<div>
							<dt>Farba</dt>
							<dd>{s.farba}</dd>
						</div>
						<div>
							<dt>Zasklenie</dt>
							<dd>{s.zasklenie}</dd>
						</div>
					</dl>
				</section>

				<!-- CENA je na DOPYT (honest-null: zimná záhrada nemá orientačný cenník) -->
				<section class="zz-cena-info" data-testid="zz-cena-info">
					<strong>Cena na vyžiadanie</strong>
					<p>
						Zimnú záhradu ti naceníme individuálne — pošli nezáväzný dopyt a pripravíme cenovú
						ponuku po obhliadke miesta.
					</p>
					<button type="button" class="zz-btn primar" onclick={() => scrollNa('dopyt')}>
						Nezáväzný dopyt →
					</button>
				</section>

				<section class="zz-blok-kontakt" id="dopyt" data-testid="dopyt">
					<h2>Máš záujem o túto zimnú záhradu?</h2>
					<p class="zz-uvod">
						Nechaj nám kontakt a pripravíme ti nezáväznú špecifikáciu (PDF) na stiahnutie. Cenu
						pripravíme individuálne po obhliadke.
					</p>
					<DopytForm
						konfiguracia={ponukaCfg}
						disclaimer="Špecifikácia je nezáväzná. Cenu pripravíme individuálne po obhliadke miesta stavby."
					/>
				</section>
			{:else}
				<p class="zz-chyba" data-testid="zz-chyba">
					⚠ Skontroluj zadané rozmery — musia byť v uvedených rozmedziach.
				</p>
			{/if}
		</div>
	</div>
</div>

<style>
	.zz {
		max-width: 1100px;
		margin: 0 auto;
		padding: clamp(20px, 4vw, 44px) clamp(16px, 4vw, 40px) clamp(40px, 6vw, 72px);
	}

	/* HERO */
	.zz-hero {
		display: grid;
		grid-template-columns: 1fr;
		gap: clamp(16px, 3vw, 28px);
		margin-bottom: clamp(24px, 4vw, 40px);
	}
	.zz-hero-foto {
		border-radius: var(--k-radius);
		overflow: hidden;
		aspect-ratio: 5 / 3;
		background: var(--k-surface-2);
		box-shadow: var(--k-shadow);
	}
	.zz-hero-foto img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.zz-label {
		display: block;
		font-size: 11.5px;
		font-weight: 600;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--k-accent);
		margin-bottom: 10px;
	}
	.zz-hero-text h1 {
		margin: 0 0 12px;
		font-size: clamp(1.8rem, 4vw, 2.7rem);
		font-weight: 700;
		line-height: 1.06;
		letter-spacing: -0.02em;
		color: var(--k-text);
	}
	.zz-hero-text p {
		margin: 0;
		font-size: 15.5px;
		line-height: 1.55;
		color: var(--k-muted);
		max-width: 560px;
	}

	/* LAYOUT: mobil 1 stĺpec, desktop ovládanie + panel */
	.zz-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: clamp(18px, 3vw, 32px);
		align-items: start;
	}

	.zz-blok {
		border: 1px solid var(--k-line);
		border-radius: var(--k-radius);
		background: var(--k-surface);
		padding: 18px 18px 20px;
		margin: 0 0 16px;
	}
	.zz-blok legend {
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--k-accent);
		padding: 0 6px;
	}

	.zz-karty {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 10px;
		margin-top: 6px;
	}
	.zz-karty.dvoj {
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
	}
	.zz-karta {
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
	.zz-karta:hover {
		border-color: var(--k-line-2);
	}
	.zz-karta.vybrana {
		border-color: var(--k-ink);
		background: var(--k-accent-soft);
	}
	.zz-karta:focus-visible {
		outline: 2px solid var(--k-ink);
		outline-offset: 2px;
	}
	.zz-karta-nazov {
		font-size: 15px;
		font-weight: 650;
		color: var(--k-text);
	}
	.zz-karta-popis {
		font-size: 12.5px;
		line-height: 1.4;
		color: var(--k-muted);
	}

	.zz-rozmery {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 12px;
		margin-top: 6px;
	}
	/* metrové steppery (RozmerStepper) stohované pod sebou */
	.zz-steppery {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-top: 6px;
	}
	.zz-pole {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.zz-pole span {
		font-size: 13px;
		font-weight: 600;
		color: var(--k-text);
	}
	.zz-pole select {
		padding: 9px 11px;
		border: 1px solid var(--k-line-2);
		border-radius: var(--k-radius-sm);
		font: inherit;
		background: var(--k-surface);
		color: var(--k-text);
	}
	.zz-pole select:focus-visible {
		outline: 2px solid var(--k-ink);
		outline-offset: 1px;
	}

	/* PANEL: súhrn + cena-info + dopyt */
	.zz-panel {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.zz-suhrn,
	.zz-cena-info,
	.zz-blok-kontakt {
		border: 1px solid var(--k-line);
		border-radius: var(--k-radius);
		background: var(--k-surface);
		padding: 20px 22px;
	}
	.zz-suhrn h2,
	.zz-blok-kontakt h2 {
		margin: 0 0 12px;
		font-size: 18px;
		font-weight: 650;
		letter-spacing: -0.01em;
		color: var(--k-text);
	}
	.zz-suhrn dl {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.zz-suhrn dl > div {
		display: flex;
		justify-content: space-between;
		gap: 14px;
		border-bottom: 1px solid var(--k-line);
		padding-bottom: 8px;
	}
	.zz-suhrn dl > div:last-child {
		border-bottom: 0;
		padding-bottom: 0;
	}
	.zz-suhrn dt {
		font-size: 13.5px;
		color: var(--k-muted);
	}
	.zz-suhrn dd {
		margin: 0;
		font-size: 13.5px;
		font-weight: 600;
		color: var(--k-text);
		text-align: right;
	}

	.zz-cena-info {
		background: var(--k-surface-2);
		border-color: var(--k-line-2);
	}
	.zz-cena-info strong {
		display: block;
		font-size: 17px;
		color: var(--k-text);
		margin-bottom: 6px;
	}
	.zz-cena-info p {
		margin: 0 0 14px;
		font-size: 13.5px;
		line-height: 1.5;
		color: var(--k-muted);
	}

	.zz-uvod {
		color: var(--k-muted);
		font-size: 14px;
		line-height: 1.5;
		margin: 0 0 16px;
	}

	.zz-btn {
		font-family: inherit;
		font-size: 14px;
		font-weight: 600;
		border-radius: var(--k-radius-pill);
		padding: 11px 20px;
		cursor: pointer;
		border: 1px solid transparent;
	}
	.zz-btn.primar {
		background: var(--k-ink);
		color: #fff;
	}
	.zz-btn.primar:hover {
		background: var(--k-ink-hover);
	}
	.zz-btn:focus-visible {
		outline: 2px solid var(--k-ink);
		outline-offset: 2px;
	}

	.zz-chyba {
		color: #a3261c;
		background: #fbeeec;
		border: 1px solid #f2cfc9;
		border-radius: var(--k-radius-sm);
		padding: 14px 16px;
		font-size: 14px;
		margin: 0;
	}

	@media (min-width: 900px) {
		.zz-hero {
			grid-template-columns: 1.1fr 0.9fr;
			align-items: center;
		}
		.zz-grid {
			grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
		}
	}
</style>
