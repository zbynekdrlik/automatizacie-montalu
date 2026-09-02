<script lang="ts">
	// Verejný zákaznícky konfigurátor prístreškov a altánkov (#390, etapa 7/7 jednotného rámu #384).
	// JEDNODUCHÁ jednostĺpcová stránka (zámerne bez 3D — dispatch „3D NErob"; prístrešky = lead-gen
	// vrstva) a BEZ ORIENTAČNEJ CENY (honest-null: prístrešky nemajú overený cenový zdroj — cena sa
	// nevymýšľa). Konfigurácia (typ/rozmery/krytina/farba) sa počíta ČISTO klientsky (`$derived`,
	// žiadny server round-trip — netreba, nie je cena) a tečie do zdieľaného DopytForm (#277) → PDF
	// špecifikácia (bez ceny) + Odoo lead. Zdieľané `--k-*` tokeny z `konfigurator/+layout.svelte`.
	// Money-neutralita: importuje LEN client-safe `konfigurator-pristresok` + DopytForm (guard:
	// konfigurator-money-safety). Žiadne `console.*`.
	import { untrack } from 'svelte';
	import { base } from '$app/paths';
	import DopytForm from '$lib/components/DopytForm.svelte';
	import RozmerStepper from '$lib/components/konfigurator/RozmerStepper.svelte';
	import { cislaCiarka } from '$lib/konfigurator-jednotky';
	import {
		pristresokTyp,
		pristresokKrytina,
		pristresokVstupPlatny,
		konfigurujPristresok,
		pristresokPonukaConfig,
		type PristresokVstup
	} from '$lib/konfigurator-pristresok';
	import type { PonukaConfig } from '$lib/ponuka';

	let { data } = $props();

	const r = $derived(data.rozmedzia);

	// východiskové voľby zo servera + rozumné stredové rozmery (v platných rozmedziach → súhrn hneď).
	// `untrack` v $state initializeri (rovnaký vzor ako bazén/pergola +page.svelte) — inak Svelte
	// varuje „state_referenced_locally" pri čítaní `data` mimo derived.
	let typ = $state<string>(untrack(() => data.defaulty.typ));
	let krytina = $state<string>(untrack(() => data.defaulty.krytina));
	let farba = $state<string>(untrack(() => data.farby[0]?.kod ?? ''));
	// rozmery = RozmerStepper (metre, #333 vzor) — clamp na [min,max], NIKDY null (súhrn/dopyt tak
	// pri editovaní rozmerov nezmizne, vzor #385 review 🔵).
	let dlzka = $state<number | null>(5000);
	let sirka = $state<number | null>(3000);
	let vyska = $state<number | null>(2500);

	// display label farby („RAL 7016 ANTRACIT") — do dopytu/PDF ide label, nie holý kód (vzor parseru)
	const farbaLabel = $derived.by(() => {
		const f = data.farby.find((x) => x.kod === farba);
		return f ? `RAL ${f.kod} ${f.nazov}` : farba;
	});

	const vstup = $derived<PristresokVstup>({
		typ: pristresokTyp(typ),
		krytina: pristresokKrytina(krytina),
		dlzka: dlzka ?? 0,
		sirka: sirka ?? 0,
		vyska: vyska ?? 0,
		farba: farbaLabel
	});

	const platny = $derived(pristresokVstupPlatny(vstup));
	const suhrn = $derived(platny ? konfigurujPristresok(vstup) : null);
	const ponukaCfg = $derived<PonukaConfig>(suhrn ? pristresokPonukaConfig(suhrn) : {});

	function scrollNa(id: string) {
		document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
</script>

<svelte:head>
	<title>Navrhni si prístrešok alebo altánok — Montalu</title>
	<meta
		name="description"
		content="Zostav si hliníkový prístrešok, altánok, skleník či vonkajšiu saunu na mieru — vyber typ, rozmery, krytinu strechy a farbu a pošli nezáväzný dopyt so špecifikáciou v PDF."
	/>
</svelte:head>

<div class="pris">
	<!-- HERO -->
	<section class="pris-hero">
		<div class="pris-hero-foto">
			<img
				src="{base}/konfigurator/vyber/pristresok.webp"
				alt="Hliníkový prístrešok na auto Montalu"
				width="1000"
				height="600"
				loading="eager"
				fetchpriority="high"
			/>
		</div>
		<div class="pris-hero-text">
			<span class="pris-label">Konfigurátor prístreškov a altánkov</span>
			<h1>Navrhni si prístrešok alebo altánok</h1>
			<p>
				Vyber typ, rozmery a vyhotovenie — pripravíme ti nezáväznú špecifikáciu (PDF) a ozveme sa s
				cenovou ponukou po obhliadke. Bez registrácie.
			</p>
		</div>
	</section>

	<div class="pris-grid">
		<!-- OVLÁDANIE -->
		<div class="pris-ovladanie">
			<!-- TYP -->
			<fieldset class="pris-blok">
				<legend>Typ výrobku</legend>
				<div class="pris-karty">
					{#each data.typy as t (t.kod)}
						<button
							type="button"
							class="pris-karta"
							class:vybrana={typ === t.kod}
							aria-pressed={typ === t.kod}
							data-testid="pristresok-typ-{t.kod}"
							onclick={() => (typ = t.kod)}
						>
							<span class="pris-karta-nazov">{t.nazov}</span>
							<span class="pris-karta-popis">{t.popis}</span>
						</button>
					{/each}
				</div>
			</fieldset>

			<!-- ROZMERY — metrové steppery (#333 RozmerStepper, zhodné so zákazníckou pergolou/bazénom) -->
			<fieldset class="pris-blok">
				<legend>Rozmery</legend>
				<div class="pris-steppery">
					<RozmerStepper
						bind:hodnotaMm={dlzka}
						min={r.dlzka.min}
						max={r.dlzka.max}
						krokMm={r.dlzka.krok}
						popis="Dĺžka"
						akuzativ="dĺžku"
						id="pris-dlzka"
						testid="pristresok-dlzka"
						name="dlzka"
					/>
					<RozmerStepper
						bind:hodnotaMm={sirka}
						min={r.sirka.min}
						max={r.sirka.max}
						krokMm={r.sirka.krok}
						popis="Šírka"
						akuzativ="šírku"
						id="pris-sirka"
						testid="pristresok-sirka"
						name="sirka"
					/>
					<RozmerStepper
						bind:hodnotaMm={vyska}
						min={r.vyska.min}
						max={r.vyska.max}
						krokMm={r.vyska.krok}
						popis="Výška"
						akuzativ="výšku"
						id="pris-vyska"
						testid="pristresok-vyska"
						name="vyska"
					/>
				</div>
			</fieldset>

			<!-- KRYTINA + FARBA -->
			<fieldset class="pris-blok">
				<legend>Vyhotovenie</legend>
				<div class="pris-rozmery">
					<label class="pris-pole">
						<span>Krytina / výplň strechy</span>
						<select bind:value={krytina} data-testid="pristresok-krytina">
							{#each data.krytiny as k (k.nazov)}
								<option value={k.nazov}>{k.nazov}</option>
							{/each}
						</select>
					</label>
					<label class="pris-pole">
						<span>Farba konštrukcie</span>
						<select bind:value={farba} data-testid="pristresok-farba">
							{#each data.farby as f (f.kod)}
								<option value={f.kod}>RAL {f.kod} — {f.nazov}</option>
							{/each}
						</select>
					</label>
				</div>
			</fieldset>
		</div>

		<!-- SÚHRN + CENA-INFO + DOPYT -->
		<div class="pris-panel">
			{#if suhrn}
				{@const s = suhrn}
				<section class="pris-suhrn" data-testid="pristresok-suhrn">
					<h2>Tvoja konfigurácia</h2>
					<dl>
						<div>
							<dt>Typ výrobku</dt>
							<dd>{s.typ}</dd>
						</div>
						<div>
							<dt>Krytina / strecha</dt>
							<dd>{s.krytina}</dd>
						</div>
						<div>
							<dt>Rozmery (d × š)</dt>
							<dd data-testid="pristresok-suhrn-rozmery">{s.dlzka} × {s.sirka} mm</dd>
						</div>
						<div>
							<dt>Výška</dt>
							<dd>{s.vyska} mm</dd>
						</div>
						<div>
							<dt>Zastrešená plocha</dt>
							<dd>{cislaCiarka(s.plochaM2)} m²</dd>
						</div>
						<div>
							<dt>Farba</dt>
							<dd>{s.farba}</dd>
						</div>
					</dl>
				</section>

				<!-- CENA je na DOPYT (honest-null: prístrešky nemajú orientačný cenník) -->
				<section class="pris-cena-info" data-testid="pristresok-cena-info">
					<strong>Cena na vyžiadanie</strong>
					<p>
						Prístrešok ti naceníme individuálne — pošli nezáväzný dopyt a pripravíme cenovú ponuku
						po obhliadke miesta.
					</p>
					<button type="button" class="pris-btn primar" onclick={() => scrollNa('dopyt')}>
						Nezáväzný dopyt →
					</button>
				</section>

				<section class="pris-blok-kontakt" id="dopyt" data-testid="dopyt">
					<h2>Máš záujem o tento prístrešok?</h2>
					<p class="pris-uvod">
						Nechaj nám kontakt a pripravíme ti nezáväznú špecifikáciu (PDF) na stiahnutie. Cenu
						pripravíme individuálne po obhliadke.
					</p>
					<DopytForm
						konfiguracia={ponukaCfg}
						disclaimer="Špecifikácia je nezáväzná. Cenu pripravíme individuálne po obhliadke miesta stavby."
					/>
				</section>
			{:else}
				<p class="pris-chyba" data-testid="pristresok-chyba">
					⚠ Skontroluj zadané rozmery — musia byť v uvedených rozmedziach.
				</p>
			{/if}
		</div>
	</div>
</div>

<style>
	.pris {
		max-width: 1100px;
		margin: 0 auto;
		padding: clamp(20px, 4vw, 44px) clamp(16px, 4vw, 40px) clamp(40px, 6vw, 72px);
	}

	/* HERO */
	.pris-hero {
		display: grid;
		grid-template-columns: 1fr;
		gap: clamp(16px, 3vw, 28px);
		margin-bottom: clamp(24px, 4vw, 40px);
	}
	.pris-hero-foto {
		border-radius: var(--k-radius);
		overflow: hidden;
		aspect-ratio: 5 / 3;
		background: var(--k-surface-2);
		box-shadow: var(--k-shadow);
	}
	.pris-hero-foto img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.pris-label {
		display: block;
		font-size: 11.5px;
		font-weight: 600;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--k-accent);
		margin-bottom: 10px;
	}
	.pris-hero-text h1 {
		margin: 0 0 12px;
		font-size: clamp(1.8rem, 4vw, 2.7rem);
		font-weight: 700;
		line-height: 1.06;
		letter-spacing: -0.02em;
		color: var(--k-text);
	}
	.pris-hero-text p {
		margin: 0;
		font-size: 15.5px;
		line-height: 1.55;
		color: var(--k-muted);
		max-width: 560px;
	}

	/* LAYOUT: mobil 1 stĺpec, desktop ovládanie + panel */
	.pris-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: clamp(18px, 3vw, 32px);
		align-items: start;
	}

	.pris-blok {
		border: 1px solid var(--k-line);
		border-radius: var(--k-radius);
		background: var(--k-surface);
		padding: 18px 18px 20px;
		margin: 0 0 16px;
	}
	.pris-blok legend {
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--k-accent);
		padding: 0 6px;
	}

	.pris-karty {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 10px;
		margin-top: 6px;
	}
	.pris-karta {
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
	.pris-karta:hover {
		border-color: var(--k-line-2);
	}
	.pris-karta.vybrana {
		border-color: var(--k-ink);
		background: var(--k-accent-soft);
	}
	.pris-karta:focus-visible {
		outline: 2px solid var(--k-ink);
		outline-offset: 2px;
	}
	.pris-karta-nazov {
		font-size: 15px;
		font-weight: 650;
		color: var(--k-text);
	}
	.pris-karta-popis {
		font-size: 12.5px;
		line-height: 1.4;
		color: var(--k-muted);
	}

	.pris-rozmery {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 12px;
		margin-top: 6px;
	}
	/* metrové steppery (RozmerStepper) stohované pod sebou */
	.pris-steppery {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-top: 6px;
	}
	.pris-pole {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.pris-pole span {
		font-size: 13px;
		font-weight: 600;
		color: var(--k-text);
	}
	.pris-pole select {
		padding: 9px 11px;
		border: 1px solid var(--k-line-2);
		border-radius: var(--k-radius-sm);
		font: inherit;
		background: var(--k-surface);
		color: var(--k-text);
	}
	.pris-pole select:focus-visible {
		outline: 2px solid var(--k-ink);
		outline-offset: 1px;
	}

	/* PANEL: súhrn + cena-info + dopyt */
	.pris-panel {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.pris-suhrn,
	.pris-cena-info,
	.pris-blok-kontakt {
		border: 1px solid var(--k-line);
		border-radius: var(--k-radius);
		background: var(--k-surface);
		padding: 20px 22px;
	}
	.pris-suhrn h2,
	.pris-blok-kontakt h2 {
		margin: 0 0 12px;
		font-size: 18px;
		font-weight: 650;
		letter-spacing: -0.01em;
		color: var(--k-text);
	}
	.pris-suhrn dl {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.pris-suhrn dl > div {
		display: flex;
		justify-content: space-between;
		gap: 14px;
		border-bottom: 1px solid var(--k-line);
		padding-bottom: 8px;
	}
	.pris-suhrn dl > div:last-child {
		border-bottom: 0;
		padding-bottom: 0;
	}
	.pris-suhrn dt {
		font-size: 13.5px;
		color: var(--k-muted);
	}
	.pris-suhrn dd {
		margin: 0;
		font-size: 13.5px;
		font-weight: 600;
		color: var(--k-text);
		text-align: right;
	}

	.pris-cena-info {
		background: var(--k-surface-2);
		border-color: var(--k-line-2);
	}
	.pris-cena-info strong {
		display: block;
		font-size: 17px;
		color: var(--k-text);
		margin-bottom: 6px;
	}
	.pris-cena-info p {
		margin: 0 0 14px;
		font-size: 13.5px;
		line-height: 1.5;
		color: var(--k-muted);
	}

	.pris-uvod {
		color: var(--k-muted);
		font-size: 14px;
		line-height: 1.5;
		margin: 0 0 16px;
	}

	.pris-btn {
		font-family: inherit;
		font-size: 14px;
		font-weight: 600;
		border-radius: var(--k-radius-pill);
		padding: 11px 20px;
		cursor: pointer;
		border: 1px solid transparent;
	}
	.pris-btn.primar {
		background: var(--k-ink);
		color: #fff;
	}
	.pris-btn.primar:hover {
		background: var(--k-ink-hover);
	}
	.pris-btn:focus-visible {
		outline: 2px solid var(--k-ink);
		outline-offset: 2px;
	}

	.pris-chyba {
		color: #a3261c;
		background: #fbeeec;
		border: 1px solid #f2cfc9;
		border-radius: var(--k-radius-sm);
		padding: 14px 16px;
		font-size: 14px;
		margin: 0;
	}

	@media (min-width: 900px) {
		.pris-hero {
			grid-template-columns: 1.1fr 0.9fr;
			align-items: center;
		}
		.pris-grid {
			grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
		}
	}
</style>
