<script lang="ts">
	// Verejný zákaznícky konfigurátor tienenia — markízy a screenové rolety (#389, etapa 6 rámu #384).
	// JEDNODUCHÁ jednostĺpcová stránka (zámerne bez 3D — dispatch „3D NErob", ako bazén #385) a BEZ
	// ORIENTAČNEJ CENY (honest-null: tienenie nemá overený cenový zdroj — cena sa nevymýšľa). Konfigurácia
	// (typ/rozmery/ovládanie/farba) sa počíta ČISTO klientsky (`$derived`, žiadny server round-trip —
	// netreba, nie je cena) a tečie do zdieľaného DopytForm (#277) → PDF špecifikácia (bez ceny) + Odoo
	// lead. Druhý rozmer je VÝSUN (markíza) / VÝŠKA (roleta) — label sa mení podľa druhu zvoleného modelu.
	// Farbu cloniacej látky NEPONÚKAME ako fixný výber (montalu.sk „podľa vzorkovníka") — poznámka nižšie.
	// Zdieľané `--k-*` tokeny z `konfigurator/+layout.svelte`. Money-neutralita: importuje LEN client-safe
	// `konfigurator-tienenie` + DopytForm (guard: konfigurator-money-safety). Žiadne `console.*`.
	import { untrack } from 'svelte';
	import { base } from '$app/paths';
	import DopytForm from '$lib/components/DopytForm.svelte';
	import RozmerStepper from '$lib/components/konfigurator/RozmerStepper.svelte';
	import {
		tienenieModel,
		tienenieOvladanie,
		tienenieModelInfo,
		tienenieRanges,
		rozmer2Popis,
		rozmer2Akuzativ,
		tienenieVstupPlatny,
		konfigurujTienenie,
		tieneniePonukaConfig,
		type TienenieVstup
	} from '$lib/konfigurator-tienenie';
	import type { PonukaConfig } from '$lib/ponuka';

	let { data } = $props();

	// východiskové voľby zo servera + rozumné stredové rozmery (v platných rozmedziach → súhrn hneď).
	// `untrack` v $state initializeri (vzor bazén/pergola +page.svelte) — inak Svelte varuje
	// „state_referenced_locally" pri čítaní `data` mimo derived.
	let model = $state<string>(untrack(() => data.defaulty.model));
	let ovladanie = $state<string>(untrack(() => data.defaulty.ovladanie));
	let farba = $state<string>(untrack(() => data.farby[0]?.kod ?? ''));
	// rozmery = RozmerStepper (metre, #333 vzor) — clamp na [min,max], NIKDY null (súhrn/dopyt tak pri
	// editovaní rozmerov nezmizne, vzor #385). `rozmer2` = výsun/výška (label podľa druhu).
	let sirka = $state<number | null>(4000);
	let rozmer2 = $state<number | null>(3000);

	// info + rozmedzia + druh zvoleného modelu. Limity SÚ per model (review #389 🟡 — nič nevymýšľaj):
	// `r` sa mení pri prepnutí typu, RozmerStepper dostane nové min/max. `druh` (markíza/roleta) riadi
	// label druhého rozmeru (výsun/výška) + súhrn.
	const modelInfo = $derived(tienenieModelInfo(tienenieModel(model)));
	const r = $derived(tienenieRanges(tienenieModel(model)));
	const druh = $derived(modelInfo.druh);
	const rozmer2Label = $derived(rozmer2Popis(druh)); // „Výsun" | „Výška"
	const rozmer2Akuz = $derived(rozmer2Akuzativ(druh)); // „výsun" | „výšku"
	// ovládanie dostupné PRE MODEL (montalu.sk: ZIPLINE/XLINE motorické, XLIGHT aj ručné) — katalóg
	// (`data.ovladanie`) prefiltrovaný na to, čo model reálne ponúka.
	const ovladaceModelu = $derived(
		data.ovladanie.filter((o) => modelInfo.ovladanie.includes(o.kod))
	);

	// pri prepnutí typu: clampni rozmery do NOVÝCH per-model limitov (nech súhrn nezmizne) a normalizuj
	// ovládanie na to, čo model ponúka. Zápis rovnakej hodnoty je no-op (žiadna slučka).
	$effect(() => {
		const rng = tienenieRanges(tienenieModel(model));
		if (sirka != null) {
			const c = Math.min(rng.sirka.max, Math.max(rng.sirka.min, sirka));
			if (c !== sirka) sirka = c;
		}
		if (rozmer2 != null) {
			const c = Math.min(rng.rozmer2.max, Math.max(rng.rozmer2.min, rozmer2));
			if (c !== rozmer2) rozmer2 = c;
		}
		ovladanie = tienenieOvladanie(ovladanie, tienenieModel(model));
	});

	// display label farby („RAL 7016 ANTRACIT") — do dopytu/PDF ide label, nie holý kód (vzor parseru)
	const farbaLabel = $derived.by(() => {
		const f = data.farby.find((x) => x.kod === farba);
		return f ? `RAL ${f.kod} ${f.nazov}` : farba;
	});

	const vstup = $derived<TienenieVstup>({
		model: tienenieModel(model),
		ovladanie: tienenieOvladanie(ovladanie, tienenieModel(model)),
		sirka: sirka ?? 0,
		rozmer2: rozmer2 ?? 0,
		farba: farbaLabel
	});

	const platny = $derived(tienenieVstupPlatny(vstup));
	const suhrn = $derived(platny ? konfigurujTienenie(vstup) : null);
	const ponukaCfg = $derived<PonukaConfig>(suhrn ? tieneniePonukaConfig(suhrn) : {});

	function scrollNa(id: string) {
		document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
</script>

<svelte:head>
	<title>Navrhni si tienenie — markízy a rolety — Montalu</title>
	<meta
		name="description"
		content="Zostav si markízu alebo screenovú roletu na mieru — vyber typ, rozmery, ovládanie a farbu a pošli nezáväzný dopyt so špecifikáciou v PDF."
	/>
</svelte:head>

<div class="tie">
	<!-- HERO -->
	<section class="tie-hero">
		<div class="tie-hero-foto">
			<img
				src="{base}/konfigurator/vyber/tienenie.webp"
				alt="Hliníková markíza Montalu"
				width="1000"
				height="600"
				loading="eager"
				fetchpriority="high"
			/>
		</div>
		<div class="tie-hero-text">
			<span class="tie-label">Konfigurátor tienenia</span>
			<h1>Navrhni si markízu alebo roletu</h1>
			<p>
				Vyber typ, rozmery a ovládanie — pripravíme ti nezáväznú špecifikáciu (PDF) a ozveme sa s
				cenovou ponukou po obhliadke. Bez registrácie.
			</p>
		</div>
	</section>

	<div class="tie-grid">
		<!-- OVLÁDANIE -->
		<div class="tie-ovladanie">
			<!-- TYP -->
			<fieldset class="tie-blok">
				<legend>Typ tienenia</legend>
				<div class="tie-karty">
					{#each data.modely as m (m.kod)}
						<button
							type="button"
							class="tie-karta"
							class:vybrana={model === m.kod}
							aria-pressed={model === m.kod}
							data-testid="tienenie-model-{m.kod}"
							onclick={() => (model = m.kod)}
						>
							<span class="tie-karta-nazov">{m.nazov}</span>
							<span class="tie-karta-popis">{m.popis}</span>
						</button>
					{/each}
				</div>
			</fieldset>

			<!-- OVLÁDANIE — len to, čo model reálne ponúka (montalu.sk); testid je ASCII `id`. -->
			<fieldset class="tie-blok">
				<legend>Ovládanie</legend>
				<div class="tie-karty dvoj">
					{#each ovladaceModelu as o (o.kod)}
						<button
							type="button"
							class="tie-karta"
							class:vybrana={ovladanie === o.kod}
							aria-pressed={ovladanie === o.kod}
							data-testid="tienenie-ovladanie-{o.id}"
							onclick={() => (ovladanie = o.kod)}
						>
							<span class="tie-karta-nazov">{o.kod}</span>
							<span class="tie-karta-popis">{o.popis}</span>
						</button>
					{/each}
				</div>
			</fieldset>

			<!-- ROZMERY — metrové steppery (#333 RozmerStepper). Druhý rozmer = výsun (markíza) / výška
			     (roleta) — popis + akuzatív aria-labelu sa menia podľa druhu zvoleného typu. -->
			<fieldset class="tie-blok">
				<legend>Rozmery</legend>
				<div class="tie-steppery">
					<RozmerStepper
						bind:hodnotaMm={sirka}
						min={r.sirka.min}
						max={r.sirka.max}
						krokMm={r.sirka.krok}
						popis="Šírka"
						akuzativ="šírku"
						id="tie-sirka"
						testid="tienenie-sirka"
						name="sirka"
					/>
					<RozmerStepper
						bind:hodnotaMm={rozmer2}
						min={r.rozmer2.min}
						max={r.rozmer2.max}
						krokMm={r.rozmer2.krok}
						popis={rozmer2Label}
						akuzativ={rozmer2Akuz}
						id="tie-rozmer2"
						testid="tienenie-rozmer2"
						name="rozmer2"
					/>
				</div>
			</fieldset>

			<!-- FARBA -->
			<fieldset class="tie-blok">
				<legend>Vyhotovenie</legend>
				<div class="tie-rozmery">
					<label class="tie-pole">
						<span>Farba konštrukcie</span>
						<select bind:value={farba} data-testid="tienenie-farba">
							{#each data.farby as f (f.kod)}
								<option value={f.kod}>RAL {f.kod} — {f.nazov}</option>
							{/each}
						</select>
					</label>
				</div>
				<p class="tie-latka-info">
					Farbu cloniacej látky vyberieme spoločne zo vzorkovníka po obhliadke — ponúkame širokú
					škálu odtieňov aj vzorov.
				</p>
			</fieldset>
		</div>

		<!-- SÚHRN + CENA-INFO + DOPYT -->
		<div class="tie-panel">
			{#if suhrn}
				{@const s = suhrn}
				<section class="tie-suhrn" data-testid="tienenie-suhrn">
					<h2>Tvoja konfigurácia</h2>
					<dl>
						<div>
							<dt>Typ</dt>
							<dd>{s.nazov}</dd>
						</div>
						<div>
							<dt>Ovládanie</dt>
							<dd>{s.ovladanie}</dd>
						</div>
						<div>
							<dt>Šírka</dt>
							<dd data-testid="tienenie-suhrn-sirka">{s.sirka} mm</dd>
						</div>
						<div>
							<dt>{rozmer2Label}</dt>
							<dd data-testid="tienenie-suhrn-rozmer2">{s.rozmer2} mm</dd>
						</div>
						<div>
							<dt>Farba konštrukcie</dt>
							<dd>{s.farba}</dd>
						</div>
					</dl>
				</section>

				<!-- CENA je na DOPYT (honest-null: tienenie nemá orientačný cenník) -->
				<section class="tie-cena-info" data-testid="tienenie-cena-info">
					<strong>Cena na vyžiadanie</strong>
					<p>
						Markízy aj rolety naceníme individuálne — pošli nezáväzný dopyt a pripravíme cenovú
						ponuku po obhliadke miesta.
					</p>
					<button type="button" class="tie-btn primar" onclick={() => scrollNa('dopyt')}>
						Nezáväzný dopyt →
					</button>
				</section>

				<section class="tie-blok-kontakt" id="dopyt" data-testid="dopyt">
					<h2>Máš záujem o toto tienenie?</h2>
					<p class="tie-uvod">
						Nechaj nám kontakt a pripravíme ti nezáväznú špecifikáciu (PDF) na stiahnutie. Cenu
						pripravíme individuálne po obhliadke.
					</p>
					<DopytForm
						konfiguracia={ponukaCfg}
						disclaimer="Špecifikácia je nezáväzná. Cenu pripravíme individuálne po obhliadke miesta stavby."
					/>
				</section>
			{:else}
				<p class="tie-chyba" data-testid="tienenie-chyba">
					⚠ Skontroluj zadané rozmery — musia byť v uvedených rozmedziach.
				</p>
			{/if}
		</div>
	</div>
</div>

<style>
	.tie {
		max-width: 1100px;
		margin: 0 auto;
		padding: clamp(20px, 4vw, 44px) clamp(16px, 4vw, 40px) clamp(40px, 6vw, 72px);
	}

	/* HERO */
	.tie-hero {
		display: grid;
		grid-template-columns: 1fr;
		gap: clamp(16px, 3vw, 28px);
		margin-bottom: clamp(24px, 4vw, 40px);
	}
	.tie-hero-foto {
		border-radius: var(--k-radius);
		overflow: hidden;
		aspect-ratio: 5 / 3;
		background: var(--k-surface-2);
		box-shadow: var(--k-shadow);
	}
	.tie-hero-foto img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.tie-label {
		display: block;
		font-size: 11.5px;
		font-weight: 600;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--k-accent);
		margin-bottom: 10px;
	}
	.tie-hero-text h1 {
		margin: 0 0 12px;
		font-size: clamp(1.8rem, 4vw, 2.7rem);
		font-weight: 700;
		line-height: 1.06;
		letter-spacing: -0.02em;
		color: var(--k-text);
	}
	.tie-hero-text p {
		margin: 0;
		font-size: 15.5px;
		line-height: 1.55;
		color: var(--k-muted);
		max-width: 560px;
	}

	/* LAYOUT: mobil 1 stĺpec, desktop ovládanie + panel */
	.tie-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: clamp(18px, 3vw, 32px);
		align-items: start;
	}

	.tie-blok {
		border: 1px solid var(--k-line);
		border-radius: var(--k-radius);
		background: var(--k-surface);
		padding: 18px 18px 20px;
		margin: 0 0 16px;
	}
	.tie-blok legend {
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--k-accent);
		padding: 0 6px;
	}

	.tie-karty {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 10px;
		margin-top: 6px;
	}
	.tie-karty.dvoj {
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
	}
	.tie-karta {
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
	.tie-karta:hover {
		border-color: var(--k-line-2);
	}
	.tie-karta.vybrana {
		border-color: var(--k-ink);
		background: var(--k-accent-soft);
	}
	.tie-karta:focus-visible {
		outline: 2px solid var(--k-ink);
		outline-offset: 2px;
	}
	.tie-karta-nazov {
		font-size: 15px;
		font-weight: 650;
		color: var(--k-text);
	}
	.tie-karta-popis {
		font-size: 12.5px;
		line-height: 1.4;
		color: var(--k-muted);
	}

	.tie-rozmery {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 12px;
		margin-top: 6px;
	}
	/* metrové steppery (RozmerStepper) stohované pod sebou */
	.tie-steppery {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-top: 6px;
	}
	.tie-pole {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.tie-pole span {
		font-size: 13px;
		font-weight: 600;
		color: var(--k-text);
	}
	.tie-pole select {
		padding: 9px 11px;
		border: 1px solid var(--k-line-2);
		border-radius: var(--k-radius-sm);
		font: inherit;
		background: var(--k-surface);
		color: var(--k-text);
	}
	.tie-pole select:focus-visible {
		outline: 2px solid var(--k-ink);
		outline-offset: 1px;
	}
	.tie-latka-info {
		margin: 12px 0 0;
		font-size: 12.5px;
		line-height: 1.45;
		color: var(--k-muted);
	}

	/* PANEL: súhrn + cena-info + dopyt */
	.tie-panel {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.tie-suhrn,
	.tie-cena-info,
	.tie-blok-kontakt {
		border: 1px solid var(--k-line);
		border-radius: var(--k-radius);
		background: var(--k-surface);
		padding: 20px 22px;
	}
	.tie-suhrn h2,
	.tie-blok-kontakt h2 {
		margin: 0 0 12px;
		font-size: 18px;
		font-weight: 650;
		letter-spacing: -0.01em;
		color: var(--k-text);
	}
	.tie-suhrn dl {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.tie-suhrn dl > div {
		display: flex;
		justify-content: space-between;
		gap: 14px;
		border-bottom: 1px solid var(--k-line);
		padding-bottom: 8px;
	}
	.tie-suhrn dl > div:last-child {
		border-bottom: 0;
		padding-bottom: 0;
	}
	.tie-suhrn dt {
		font-size: 13.5px;
		color: var(--k-muted);
	}
	.tie-suhrn dd {
		margin: 0;
		font-size: 13.5px;
		font-weight: 600;
		color: var(--k-text);
		text-align: right;
	}

	.tie-cena-info {
		background: var(--k-surface-2);
		border-color: var(--k-line-2);
	}
	.tie-cena-info strong {
		display: block;
		font-size: 17px;
		color: var(--k-text);
		margin-bottom: 6px;
	}
	.tie-cena-info p {
		margin: 0 0 14px;
		font-size: 13.5px;
		line-height: 1.5;
		color: var(--k-muted);
	}

	.tie-uvod {
		color: var(--k-muted);
		font-size: 14px;
		line-height: 1.5;
		margin: 0 0 16px;
	}

	.tie-btn {
		font-family: inherit;
		font-size: 14px;
		font-weight: 600;
		border-radius: var(--k-radius-pill);
		padding: 11px 20px;
		cursor: pointer;
		border: 1px solid transparent;
	}
	.tie-btn.primar {
		background: var(--k-ink);
		color: #fff;
	}
	.tie-btn.primar:hover {
		background: var(--k-ink-hover);
	}
	.tie-btn:focus-visible {
		outline: 2px solid var(--k-ink);
		outline-offset: 2px;
	}

	.tie-chyba {
		color: #a3261c;
		background: #fbeeec;
		border: 1px solid #f2cfc9;
		border-radius: var(--k-radius-sm);
		padding: 14px 16px;
		font-size: 14px;
		margin: 0;
	}

	@media (min-width: 900px) {
		.tie-hero {
			grid-template-columns: 1.1fr 0.9fr;
			align-items: center;
		}
		.tie-grid {
			grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
		}
	}
</style>
