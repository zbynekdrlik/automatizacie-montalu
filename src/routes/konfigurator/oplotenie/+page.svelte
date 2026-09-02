<script lang="ts">
	// Verejný zákaznícky konfigurátor hliníkového oplotenia a brán (#388, etapa 5 jednotného rámu #384).
	// JEDNODUCHÁ jednostĺpcová stránka (zámerne bez 3D — dispatch: 3D NErob, tier B) a BEZ ORIENTAČNEJ
	// CENY (honest-null: oplotenie nemá overený cenový zdroj — cena sa nevymýšľa). Konfigurácia
	// (typ/model/výška/šírka/počet/farba) sa počíta ČISTO klientsky (`$derived`, žiadny server round-trip
	// — netreba, nie je cena) a tečie do zdieľaného DopytForm (#277) → PDF špecifikácia (bez ceny) + Odoo
	// lead. Zdieľané `--k-*` tokeny z `konfigurator/+layout.svelte`. Money-neutralita: importuje LEN
	// client-safe `konfigurator-oplotenie` + DopytForm (guard: konfigurator-money-safety). Žiadne `console.*`.
	import { untrack } from 'svelte';
	import { base } from '$app/paths';
	import DopytForm from '$lib/components/DopytForm.svelte';
	import RozmerStepper from '$lib/components/konfigurator/RozmerStepper.svelte';
	import {
		oplotenieTyp,
		oplotenieModel,
		oplotenieVstupPlatny,
		konfigurujOplotenie,
		oploteniePonukaConfig,
		type OplotenieVstup
	} from '$lib/konfigurator-oplotenie';
	import type { PonukaConfig } from '$lib/ponuka';

	let { data } = $props();

	const r = $derived(data.rozmedzia);

	// východiskové voľby zo servera + rozumné stredové rozmery (v platných rozmedziach → súhrn hneď).
	// `untrack` v $state initializeri (rovnaký vzor ako bazén/pergola +page.svelte) — inak Svelte varuje
	// „state_referenced_locally" pri čítaní `data` mimo derived.
	let typ = $state<string>(untrack(() => data.defaulty.typ));
	let model = $state<string>(untrack(() => data.defaulty.model));
	let farba = $state<string>(untrack(() => data.farby[0]?.kod ?? ''));
	// rozmery = RozmerStepper (metre, #333 vzor) — clamp na [min,max], NIKDY null (súhrn/dopyt tak pri
	// editovaní rozmerov nezmizne); počet ks = <select> (1..20, tiež nikdy null).
	let vyska = $state<number | null>(1500);
	let sirka = $state<number | null>(2000);
	let pocet = $state<number>(1);
	// možnosti počtu kusov (1..20) — select nikdy nevráti mimo-rozmedzia/null hodnotu
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

	function scrollNa(id: string) {
		document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
</script>

<svelte:head>
	<title>Navrhni si hliníkové oplotenie a brány — Montalu</title>
	<meta
		name="description"
		content="Zostav si hliníkové oplotenie na mieru — vyber typ (plotový diel, krídlová, posuvná či samonosná brána, vchodová bránka), model výplne, rozmery a farbu a pošli nezáväzný dopyt so špecifikáciou v PDF."
	/>
</svelte:head>

<div class="opl">
	<!-- HERO -->
	<section class="opl-hero">
		<div class="opl-hero-foto">
			<img
				src="{base}/konfigurator/vyber/oplotenie.webp"
				alt="Dizajnové hliníkové oplotenie Montalu"
				width="1000"
				height="600"
				loading="eager"
				fetchpriority="high"
			/>
		</div>
		<div class="opl-hero-text">
			<span class="opl-label">Konfigurátor oplotenia a brán</span>
			<h1>Navrhni si hliníkové oplotenie</h1>
			<p>
				Vyber typ prvku, dizajn výplne, rozmery a farbu — pripravíme ti nezáväznú špecifikáciu (PDF)
				a ozveme sa s cenovou ponukou po obhliadke. Bez registrácie.
			</p>
		</div>
	</section>

	<div class="opl-grid">
		<!-- OVLÁDANIE -->
		<div class="opl-ovladanie">
			<!-- TYP PRVKU -->
			<fieldset class="opl-blok">
				<legend>Typ prvku</legend>
				<div class="opl-karty">
					{#each data.typy as t (t.kod)}
						<button
							type="button"
							class="opl-karta"
							class:vybrana={typ === t.kod}
							aria-pressed={typ === t.kod}
							data-testid="oplotenie-typ-{t.kod}"
							onclick={() => (typ = t.kod)}
						>
							<span class="opl-karta-nazov">{t.nazov}</span>
							<span class="opl-karta-popis">{t.popis}</span>
						</button>
					{/each}
				</div>
			</fieldset>

			<!-- MODEL / DIZAJN VÝPLNE -->
			<fieldset class="opl-blok">
				<legend>Dizajn výplne</legend>
				<div class="opl-karty">
					{#each data.modely as m (m.kod)}
						<button
							type="button"
							class="opl-karta"
							class:vybrana={model === m.kod}
							aria-pressed={model === m.kod}
							data-testid="oplotenie-model-{m.kod}"
							onclick={() => (model = m.kod)}
						>
							<span class="opl-karta-nazov">{m.kod}</span>
							<span class="opl-karta-popis">{m.popis}</span>
						</button>
					{/each}
				</div>
			</fieldset>

			<!-- ROZMERY — metrové steppery (#333 RozmerStepper) + počet ks -->
			<fieldset class="opl-blok">
				<legend>Rozmery</legend>
				<div class="opl-steppery">
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
					<label class="opl-pole opl-pocet">
						<span>Počet kusov</span>
						<select bind:value={pocet} data-testid="oplotenie-pocet">
							{#each pocetOpts as n (n)}
								<option value={n}>{n}</option>
							{/each}
						</select>
					</label>
				</div>
			</fieldset>

			<!-- FARBA -->
			<fieldset class="opl-blok">
				<legend>Vyhotovenie</legend>
				<div class="opl-rozmery">
					<label class="opl-pole">
						<span>Farba konštrukcie</span>
						<select bind:value={farba} data-testid="oplotenie-farba">
							{#each data.farby as f (f.kod)}
								<option value={f.kod}>RAL {f.kod} — {f.nazov}</option>
							{/each}
						</select>
					</label>
				</div>
			</fieldset>
		</div>

		<!-- SÚHRN + CENA-INFO + DOPYT -->
		<div class="opl-panel">
			{#if suhrn}
				{@const s = suhrn}
				<section class="opl-suhrn" data-testid="oplotenie-suhrn">
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
							<dd data-testid="oplotenie-suhrn-rozmery">{s.vyska} × {s.sirka} mm</dd>
						</div>
						<div>
							<dt>Počet kusov</dt>
							<dd>{s.pocet}</dd>
						</div>
						<div>
							<dt>Farba</dt>
							<dd>{s.farba}</dd>
						</div>
					</dl>
				</section>

				<!-- CENA je na DOPYT (honest-null: oplotenie nemá orientačný cenník) -->
				<section class="opl-cena-info" data-testid="oplotenie-cena-info">
					<strong>Cena na vyžiadanie</strong>
					<p>
						Oplotenie ti naceníme individuálne — pošli nezáväzný dopyt a pripravíme cenovú ponuku po
						obhliadke miesta.
					</p>
					<button type="button" class="opl-btn primar" onclick={() => scrollNa('dopyt')}>
						Nezáväzný dopyt →
					</button>
				</section>

				<section class="opl-blok-kontakt" id="dopyt" data-testid="dopyt">
					<h2>Máš záujem o toto oplotenie?</h2>
					<p class="opl-uvod">
						Nechaj nám kontakt a pripravíme ti nezáväznú špecifikáciu (PDF) na stiahnutie. Cenu
						pripravíme individuálne po obhliadke.
					</p>
					<DopytForm
						konfiguracia={ponukaCfg}
						disclaimer="Špecifikácia je nezáväzná. Cenu pripravíme individuálne po obhliadke miesta stavby."
					/>
				</section>
			{:else}
				<p class="opl-chyba" data-testid="oplotenie-chyba">
					⚠ Skontroluj zadané rozmery — musia byť v uvedených rozmedziach.
				</p>
			{/if}
		</div>
	</div>
</div>

<style>
	.opl {
		max-width: 1100px;
		margin: 0 auto;
		padding: clamp(20px, 4vw, 44px) clamp(16px, 4vw, 40px) clamp(40px, 6vw, 72px);
	}

	/* HERO */
	.opl-hero {
		display: grid;
		grid-template-columns: 1fr;
		gap: clamp(16px, 3vw, 28px);
		margin-bottom: clamp(24px, 4vw, 40px);
	}
	.opl-hero-foto {
		border-radius: var(--k-radius);
		overflow: hidden;
		aspect-ratio: 5 / 3;
		background: var(--k-surface-2);
		box-shadow: var(--k-shadow);
	}
	.opl-hero-foto img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.opl-label {
		display: block;
		font-size: 11.5px;
		font-weight: 600;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--k-accent);
		margin-bottom: 10px;
	}
	.opl-hero-text h1 {
		margin: 0 0 12px;
		font-size: clamp(1.8rem, 4vw, 2.7rem);
		font-weight: 700;
		line-height: 1.06;
		letter-spacing: -0.02em;
		color: var(--k-text);
	}
	.opl-hero-text p {
		margin: 0;
		font-size: 15.5px;
		line-height: 1.55;
		color: var(--k-muted);
		max-width: 560px;
	}

	/* LAYOUT: mobil 1 stĺpec, desktop ovládanie + panel */
	.opl-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: clamp(18px, 3vw, 32px);
		align-items: start;
	}

	.opl-blok {
		border: 1px solid var(--k-line);
		border-radius: var(--k-radius);
		background: var(--k-surface);
		padding: 18px 18px 20px;
		margin: 0 0 16px;
	}
	.opl-blok legend {
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--k-accent);
		padding: 0 6px;
	}

	.opl-karty {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 10px;
		margin-top: 6px;
	}
	.opl-karta {
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
	.opl-karta:hover {
		border-color: var(--k-line-2);
	}
	.opl-karta.vybrana {
		border-color: var(--k-ink);
		background: var(--k-accent-soft);
	}
	.opl-karta:focus-visible {
		outline: 2px solid var(--k-ink);
		outline-offset: 2px;
	}
	.opl-karta-nazov {
		font-size: 15px;
		font-weight: 650;
		color: var(--k-text);
	}
	.opl-karta-popis {
		font-size: 12.5px;
		line-height: 1.4;
		color: var(--k-muted);
	}

	.opl-rozmery {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 12px;
		margin-top: 6px;
	}
	/* metrové steppery (RozmerStepper) stohované pod sebou + počet ks select */
	.opl-steppery {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-top: 6px;
	}
	.opl-pocet {
		max-width: 220px;
	}
	.opl-pole {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.opl-pole span {
		font-size: 13px;
		font-weight: 600;
		color: var(--k-text);
	}
	.opl-pole select {
		padding: 9px 11px;
		border: 1px solid var(--k-line-2);
		border-radius: var(--k-radius-sm);
		font: inherit;
		background: var(--k-surface);
		color: var(--k-text);
	}
	.opl-pole select:focus-visible {
		outline: 2px solid var(--k-ink);
		outline-offset: 1px;
	}

	/* PANEL: súhrn + cena-info + dopyt */
	.opl-panel {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.opl-suhrn,
	.opl-cena-info,
	.opl-blok-kontakt {
		border: 1px solid var(--k-line);
		border-radius: var(--k-radius);
		background: var(--k-surface);
		padding: 20px 22px;
	}
	.opl-suhrn h2,
	.opl-blok-kontakt h2 {
		margin: 0 0 12px;
		font-size: 18px;
		font-weight: 650;
		letter-spacing: -0.01em;
		color: var(--k-text);
	}
	.opl-suhrn dl {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.opl-suhrn dl > div {
		display: flex;
		justify-content: space-between;
		gap: 14px;
		border-bottom: 1px solid var(--k-line);
		padding-bottom: 8px;
	}
	.opl-suhrn dl > div:last-child {
		border-bottom: 0;
		padding-bottom: 0;
	}
	.opl-suhrn dt {
		font-size: 13.5px;
		color: var(--k-muted);
	}
	.opl-suhrn dd {
		margin: 0;
		font-size: 13.5px;
		font-weight: 600;
		color: var(--k-text);
		text-align: right;
	}

	.opl-cena-info {
		background: var(--k-surface-2);
		border-color: var(--k-line-2);
	}
	.opl-cena-info strong {
		display: block;
		font-size: 17px;
		color: var(--k-text);
		margin-bottom: 6px;
	}
	.opl-cena-info p {
		margin: 0 0 14px;
		font-size: 13.5px;
		line-height: 1.5;
		color: var(--k-muted);
	}

	.opl-uvod {
		color: var(--k-muted);
		font-size: 14px;
		line-height: 1.5;
		margin: 0 0 16px;
	}

	.opl-btn {
		font-family: inherit;
		font-size: 14px;
		font-weight: 600;
		border-radius: var(--k-radius-pill);
		padding: 11px 20px;
		cursor: pointer;
		border: 1px solid transparent;
	}
	.opl-btn.primar {
		background: var(--k-ink);
		color: #fff;
	}
	.opl-btn.primar:hover {
		background: var(--k-ink-hover);
	}
	.opl-btn:focus-visible {
		outline: 2px solid var(--k-ink);
		outline-offset: 2px;
	}

	.opl-chyba {
		color: #a3261c;
		background: #fbeeec;
		border: 1px solid #f2cfc9;
		border-radius: var(--k-radius-sm);
		padding: 14px 16px;
		font-size: 14px;
		margin: 0;
	}

	@media (min-width: 900px) {
		.opl-hero {
			grid-template-columns: 1.1fr 0.9fr;
			align-items: center;
		}
		.opl-grid {
			grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
		}
	}
</style>
