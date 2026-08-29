<script lang="ts">
	// #327: Prémiový ovládací panel verejného konfigurátora (Tesla/Apple showroom).
	// Nahrádza defaultné `<select>`/radio/number prvky za segmentové karty (model),
	// kruhové RAL swatche (farba), chips (sklo), −/+ steppery (rozmery) a slider s
	// editovateľným číslom (sklon). Renderuje sa VNÚTRI rodičovského `<form use:enhance>`
	// v `+page.svelte` — všetky `name=` inputy (vrátane skrytých pre sklo/farba) sú tak
	// súčasťou POST-u (DOM-based form membership, vzor #239 RezForm). Stav prúdi cez 7×
	// `$bindable` prop späť do rodiča (jeho živý 3D `$effect` + `viz3d` derived ich vidia).
	//
	// Money-neutralita: hex swatchov berie z ČISTÉHO `$lib/vykres/ral` (leaf bez Money kódu,
	// už v klientskom grafe cez Vizual3D) — žiadny import katalógu/servera. `farba` POSTuje
	// RAL KÓD nezmenene (parser kod→„RAL 7016 ANTRACIT").
	//
	// KRITICKÉ: VŠETKY non-submit `<button>` = `type="button"` (inak by stepper/chip/swatch
	// odoslal form). sr-only radio = clip-pattern (fokusovateľný), nie display:none.
	import { farbaKonstrukcie } from '$lib/vykres/ral';
	import KonfInfoKarta from './KonfInfoKarta.svelte';
	import RozmerStepper from './RozmerStepper.svelte';
	import type { KonfSkloKategoria } from '$lib/konfigurator-sklo';

	interface KonfData {
		rozmedzia: {
			sirka: { min: number; max: number };
			hlbka: { min: number; max: number };
			vyskaVpredu: { min: number; max: number };
			sklon: { min: number; max: number };
		};
		modely: { kod: string; popis: string }[];
		// #329 časť 4: zákaznícke kategórie skla (nie plný katalóg)
		sklaKategorie: readonly KonfSkloKategoria[];
		farby: { kod: string; nazov: string }[];
	}

	// #329 časť 3: fotka + hover/ⓘ popis modelu (z montalu.sk konfigurátora, webp v
	// static/konfigurator/). Prezentačná mapa keyed na kód modelu — plain SK texty z montalu.sk.
	const MODEL_FOTA: Record<string, { obrazok: string; popis: string }> = {
		LIGHT: {
			obrazok: 'pergola-light.webp',
			popis:
				'Odľahčená hliníková pergola pre menšie výsuvy od domu. Vhodná na zakrytie terasy či prístrešok pre auto; kotvená na stenu alebo samostatne stojaca.'
		},
		ROBUST: {
			obrazok: 'pergola-robust.webp',
			popis: 'Masívna konštrukcia pre väčšie rozpätia — najuniverzálnejší model.'
		},
		MASSIVE: {
			obrazok: 'pergola-massive.webp',
			popis: 'Vylepšený ROBUST pre najväčšie rozpätia a najnáročnejších zákazníkov.'
		}
	};

	let {
		sirka = $bindable(),
		hlbka = $bindable(),
		vyskaVpredu = $bindable(),
		sklonDeg = $bindable(),
		sklo = $bindable(),
		farba = $bindable(),
		model = $bindable(),
		data,
		spracuva
	}: {
		sirka: number | null;
		hlbka: number | null;
		vyskaVpredu: number | null;
		sklonDeg: number | null;
		sklo: string;
		farba: string;
		model: string;
		data: KonfData;
		spracuva: boolean;
	} = $props();

	const r = $derived(data.rozmedzia);

	// #333: krok stepperov v METROCH — šírka/hĺbka 0,5 m (500 mm), výška 0,1 m (100 mm;
	// výška má rozsah len 2–4 m, celý meter by bol nepoužiteľný). Prevod mm↔metre +
	// smerový snap sú v `konfigurator-jednotky.ts`, používa ich `RozmerStepper`.
	const KROK_SIRKA_HLBKA_MM = 500;
	const KROK_VYSKA_MM = 100;

	// #329 časť 5: prevýšenie strechy pri stene [mm] = tan(sklon)·hĺbka — informatívny popisok pri
	// slideri (koľko cm strecha stúpne k stene pre odvod vody). Iba display, nemení výpočet výšok.
	const sklonPrevysenieMm = $derived(
		sklonDeg != null && sklonDeg > 0 && hlbka != null
			? Math.round(Math.tan((sklonDeg * Math.PI) / 180) * hlbka)
			: 0
	);
</script>

<div class="konf-ovladace" class:pracuje={spracuva}>
	<!-- MODEL — segmentové karty -->
	<section class="konf-sekcia">
		<span class="konf-label">Model konštrukcie</span>
		<div class="konf-modely" role="radiogroup" aria-label="Model konštrukcie" data-testid="modely">
			{#each data.modely as m (m.kod)}
				{@const foto = MODEL_FOTA[m.kod]}
				<!-- review 🟡: ⓘ karta je SESTRA `<label>`, nie vnútri neho — `<button>` je labelovateľný
				     prvok, HTML ho vnútri `<label>` zakazuje a jeho text by znečistil accessible name radia -->
				<div class="konf-model-wrap">
					<label class="konf-model" class:vybrany={model === m.kod} data-testid="model-{m.kod}">
						<input
							type="radio"
							name="model"
							value={m.kod}
							bind:group={model}
							class="konf-sr-only"
						/>
						<span class="konf-model-hlava">
							<span class="konf-model-nazov">{m.kod}</span>
							<span class="konf-model-fajka" aria-hidden="true">✓</span>
						</span>
						<span class="konf-model-popis">{m.popis}</span>
					</label>
					{#if foto}
						<span class="konf-model-info">
							<KonfInfoKarta
								nazov="Pergola {m.kod}"
								popis={foto.popis}
								obrazok={foto.obrazok}
								alt="Pergola {m.kod}"
							/>
						</span>
					{/if}
				</div>
			{/each}
		</div>
	</section>

	<!-- FARBA — kruhové RAL swatche (najväčší vizuálny upgrade) -->
	<section class="konf-sekcia">
		<span class="konf-label">Farba konštrukcie</span>
		<div class="konf-swatche" role="group" aria-label="Farba konštrukcie">
			{#each data.farby as f (f.kod)}
				{@const info = farbaKonstrukcie(f.kod)}
				<button
					type="button"
					class="konf-swatch"
					class:vybrany={farba === f.kod}
					class:svetly={info.tmavyObrys}
					data-testid="farba-swatch"
					data-value={f.kod}
					aria-pressed={farba === f.kod}
					aria-label="RAL {f.kod} {f.nazov}"
					title="RAL {f.kod} {f.nazov}"
					style="--sw:{info.hex}"
					onclick={() => (farba = f.kod)}
				>
					<span class="konf-swatch-kruh"></span>
					<span class="konf-swatch-nazov">{f.nazov}</span>
				</button>
			{/each}
		</div>
		<!-- POSTuje RAL kód nezmenene (server: kod → „RAL 7016 ANTRACIT") -->
		<input type="hidden" name="farba" value={farba} />
	</section>

	<!-- STREŠNÉ SKLO — zákaznícke kategórie (#329 časť 4): chip = label kategórie + ⓘ/hover karta
	     (ikona + popis). Skrytý input POSTuje KONKRÉTNY katalógový nazov (k.katalogNazov) → cena/
	     PDF/dopyt/Odoo dostávajú nezmenený katalógový názov. Zákazník nikdy nevidí hrúbku. -->
	<section class="konf-sekcia">
		<span class="konf-label">Strešné sklo</span>
		<div class="konf-chips" role="group" aria-label="Strešné sklo">
			{#each data.sklaKategorie as k (k.kluc)}
				<span class="konf-chip-wrap">
					<button
						type="button"
						class="konf-chip"
						class:vybrany={sklo === k.katalogNazov}
						data-testid="sklo-chip"
						data-value={k.katalogNazov}
						aria-pressed={sklo === k.katalogNazov}
						onclick={() => (sklo = k.katalogNazov)}>{k.label}</button
					>
					<KonfInfoKarta nazov={k.label} popis={k.popis} obrazok={k.ikona} alt={k.label} />
				</span>
			{/each}
		</div>
		<input type="hidden" name="sklo" value={sklo} />
	</section>

	<!-- ROZMERY — #333: metre + −/+ steppery (RozmerStepper: viditeľné metre, POSTuje mm) -->
	<section class="konf-sekcia">
		<span class="konf-label">Rozmery</span>
		<div class="konf-rozmery">
			<RozmerStepper
				bind:hodnotaMm={sirka}
				min={r.sirka.min}
				max={r.sirka.max}
				krokMm={KROK_SIRKA_HLBKA_MM}
				popis="Šírka"
				akuzativ="šírku"
				id="konf-sirka"
				testid="sirka"
				name="sirka"
			/>
			<RozmerStepper
				bind:hodnotaMm={hlbka}
				min={r.hlbka.min}
				max={r.hlbka.max}
				krokMm={KROK_SIRKA_HLBKA_MM}
				popis="Hĺbka (výsuv)"
				akuzativ="hĺbku"
				id="konf-hlbka"
				testid="hlbka"
				name="hlbka"
			/>
			<RozmerStepper
				bind:hodnotaMm={vyskaVpredu}
				min={r.vyskaVpredu.min}
				max={r.vyskaVpredu.max}
				krokMm={KROK_VYSKA_MM}
				popis="Výška vpredu"
				akuzativ="výšku"
				id="konf-vyska"
				testid="vyskaVpredu"
				name="vyskaVpredu"
			/>
		</div>
	</section>

	<!-- SKLON — slider + editovateľné číslo (twin nesie name+testid, aby E2E .fill() fungoval) -->
	<section class="konf-sekcia">
		<span class="konf-label">Sklon strechy</span>
		<div class="konf-sklon">
			<input
				class="konf-slider"
				type="range"
				min={r.sklon.min}
				max={r.sklon.max}
				step="1"
				value={sklonDeg ?? r.sklon.min}
				oninput={(e) => (sklonDeg = Number(e.currentTarget.value))}
				aria-label="Sklon strechy (posuvník)"
			/>
			<span class="konf-sklon-hodnota">
				<input
					class="konf-cislo konf-cislo-mini"
					name="sklonDeg"
					type="number"
					inputmode="numeric"
					min={r.sklon.min}
					max={r.sklon.max}
					step="1"
					bind:value={sklonDeg}
					data-testid="sklonDeg"
					aria-label="Sklon strechy (stupne)"
					required
				/>
				<span class="konf-jednotka">°</span>
			</span>
		</div>
		{#if sklonPrevysenieMm > 0}
			<span class="konf-sklon-info" data-testid="sklon-prevysenie"
				>Strecha pri stene stúpne o ~{sklonPrevysenieMm} mm (odvod vody).</span
			>
		{/if}
	</section>
</div>

<style>
	.konf-ovladace {
		display: flex;
		flex-direction: column;
		gap: 26px;
	}
	.konf-ovladace.pracuje {
		opacity: 0.72;
		pointer-events: none;
	}

	.konf-sekcia {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.konf-label {
		font-size: 11.5px;
		font-weight: 600;
		letter-spacing: 0.13em;
		text-transform: uppercase;
		color: var(--k-faint);
	}

	.konf-sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		clip-path: inset(50%);
		white-space: nowrap;
		border: 0;
	}

	/* ── Model — segmentové karty ── */
	.konf-modely {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.konf-model {
		display: grid;
		gap: 3px;
		padding: 14px 16px;
		border: 1px solid var(--k-line-2);
		border-radius: var(--k-radius-sm);
		background: var(--k-surface);
		cursor: pointer;
		transition:
			border-color 0.15s ease,
			box-shadow 0.15s ease,
			background 0.15s ease;
	}
	.konf-model:hover {
		border-color: var(--k-faint);
	}
	.konf-model:focus-within {
		outline: 2px solid var(--k-ink);
		outline-offset: 2px;
	}
	.konf-model.vybrany {
		border-color: var(--k-ink);
		box-shadow: inset 0 0 0 1px var(--k-ink);
		background: var(--k-surface);
	}
	.konf-model-wrap {
		position: relative;
	}
	/* ⓘ karta v pravom hornom rohu karty (mimo `<label>`, ale vizuálne v hlavičke) — vľavo od
	   miesta pre fajku (hlavička má padding-right, aby sa neprekrývali) */
	.konf-model-info {
		position: absolute;
		top: 13px;
		right: 15px;
		z-index: 2;
	}
	.konf-model-hlava {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding-right: 28px;
	}
	.konf-model-nazov {
		font-weight: 650;
		font-size: 15px;
		letter-spacing: 0.03em;
		color: var(--k-text);
	}
	.konf-model-fajka {
		display: grid;
		place-items: center;
		width: 20px;
		height: 20px;
		border-radius: 999px;
		background: var(--k-ink);
		color: #fff;
		font-size: 12px;
		opacity: 0;
		transform: scale(0.7);
		transition:
			opacity 0.15s ease,
			transform 0.15s ease;
	}
	.konf-model.vybrany .konf-model-fajka {
		opacity: 1;
		transform: scale(1);
	}
	.konf-model-popis {
		font-size: 13px;
		line-height: 1.45;
		color: var(--k-muted);
	}

	/* ── Farba — kruhové swatche ── */
	.konf-swatche {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
	}
	.konf-swatch {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 7px;
		padding: 0;
		border: 0;
		background: none;
		cursor: pointer;
		width: 60px;
	}
	.konf-swatch-kruh {
		width: 40px;
		height: 40px;
		border-radius: 999px;
		background: var(--sw);
		box-shadow: 0 0 0 1px rgba(22, 24, 28, 0.12);
		transition:
			transform 0.15s ease,
			box-shadow 0.15s ease;
	}
	.konf-swatch.svetly .konf-swatch-kruh {
		box-shadow: 0 0 0 1px var(--k-line-2);
	}
	.konf-swatch:hover .konf-swatch-kruh {
		transform: scale(1.06);
	}
	.konf-swatch.vybrany .konf-swatch-kruh {
		box-shadow:
			0 0 0 2px var(--k-bg),
			0 0 0 4px var(--k-ink);
	}
	.konf-swatch-nazov {
		font-size: 11px;
		letter-spacing: 0.02em;
		color: var(--k-muted);
		text-align: center;
		line-height: 1.2;
	}
	.konf-swatch.vybrany .konf-swatch-nazov {
		color: var(--k-text);
		font-weight: 600;
	}
	.konf-swatch:focus-visible {
		outline: 2px solid var(--k-ink);
		outline-offset: 3px;
		border-radius: 8px;
	}

	/* ── Sklo — chips ── */
	.konf-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.konf-chip-wrap {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.konf-chip {
		padding: 9px 15px;
		border: 1px solid var(--k-line-2);
		border-radius: var(--k-radius-pill);
		background: var(--k-surface);
		color: var(--k-muted);
		font-size: 13px;
		font-family: inherit;
		cursor: pointer;
		transition:
			border-color 0.15s ease,
			background 0.15s ease,
			color 0.15s ease;
	}
	.konf-chip:hover {
		border-color: var(--k-faint);
		color: var(--k-text);
	}
	.konf-chip.vybrany {
		background: var(--k-ink);
		border-color: var(--k-ink);
		color: #fff;
	}
	.konf-chip:focus-visible {
		outline: 2px solid var(--k-ink);
		outline-offset: 2px;
	}

	/* ── Rozmery — steppery (#333: samotný stepper je v RozmerStepper.svelte) ── */
	.konf-rozmery {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	/* .konf-cislo/.konf-jednotka nižšie sú stále v UŽITÍ sekciou SKLON (číselný twin + „°"). */
	.konf-cislo {
		width: 66px;
		border: 0;
		background: none;
		text-align: center;
		font-size: 16px; /* #327 review 🟡: 16px = žiadny iOS auto-zoom pri fokuse (mobil-first) */
		font-family: inherit;
		font-variant-numeric: tabular-nums;
		color: var(--k-text);
		-moz-appearance: textfield;
		appearance: textfield;
	}
	.konf-cislo::-webkit-outer-spin-button,
	.konf-cislo::-webkit-inner-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}
	.konf-cislo:focus {
		outline: none;
	}
	.konf-jednotka {
		font-size: 12px;
		color: var(--k-faint);
		padding-right: 4px;
	}

	/* ── Sklon — slider + číslo ── */
	.konf-sklon {
		display: flex;
		align-items: center;
		gap: 16px;
	}
	.konf-slider {
		flex: 1;
		appearance: none;
		-webkit-appearance: none;
		height: 4px;
		border-radius: 999px;
		background: var(--k-line-2);
		cursor: pointer;
	}
	.konf-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 22px;
		height: 22px;
		border-radius: 999px;
		background: var(--k-ink);
		border: 3px solid var(--k-surface);
		box-shadow: 0 1px 4px rgba(22, 24, 28, 0.25);
		cursor: pointer;
	}
	.konf-slider::-moz-range-thumb {
		width: 22px;
		height: 22px;
		border-radius: 999px;
		background: var(--k-ink);
		border: 3px solid var(--k-surface);
		box-shadow: 0 1px 4px rgba(22, 24, 28, 0.25);
		cursor: pointer;
	}
	.konf-slider:focus-visible {
		outline: 2px solid var(--k-ink);
		outline-offset: 6px;
	}
	.konf-sklon-hodnota {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		border: 1px solid var(--k-line-2);
		border-radius: var(--k-radius-pill);
		padding: 5px 10px 5px 4px;
		background: var(--k-surface);
	}
	.konf-sklon-hodnota:focus-within {
		border-color: var(--k-ink);
	}
	.konf-cislo-mini {
		width: 42px;
	}
	.konf-sklon-info {
		display: block;
		margin-top: 8px;
		font-size: 12.5px;
		color: var(--k-muted);
	}
</style>
