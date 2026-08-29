<script lang="ts">
	// #333: rozmerový stepper v METROCH (owner: „plus nech pridáva v metroch").
	// Viditeľný `type=text` input ukazuje metre („4,0 m", čiarka, 1 desatinné);
	// SKRYTÝ `<input name= value={mm}>` POSTuje interné MILIMETRE nezmenene (cena/
	// PDF/Odoo pipeline dostáva mm ako doteraz). Display-text je lokálny `$state`
	// synchronizovaný z mm cez `$effect`, ktorý NEfightuje užívateľa počas fokusu
	// (focus-flag) — parse-comparison sync padá na ekvivalentných tvaroch a klobrce
	// rozpísané „4,". Layout je WRAP-PROOF: stepper `−[hodnota]+` sa NIKDY nezalomí
	// (owner bug: `+` nad číslom), len samotný riadok smie zalomiť label nad stepper.
	import { mmNaMetreText, parseMetreNaMm, krokMetre } from '$lib/konfigurator-jednotky';

	let {
		hodnotaMm = $bindable(),
		min,
		max,
		krokMm,
		popis,
		akuzativ,
		id,
		testid,
		name
	}: {
		hodnotaMm: number | null;
		min: number;
		max: number;
		/** krok stepperom v mm (šírka/hĺbka 500, výška 100) */
		krokMm: number;
		popis: string;
		/** akuzatív popisu pre aria-label tlačidiel („šírku"/„hĺbku"/„výšku") */
		akuzativ: string;
		id: string;
		testid: string;
		name: string;
	} = $props();

	// display-text v metroch; `upravuje` = práve fokusovaný/editovaný (nesynchronizuj)
	let text = $state('');
	let upravuje = $state(false);

	// Synchronizácia display-textu z kanonickej mm hodnoty. `hodnotaMm` sa číta PRVÉ
	// (reaktívna závislosť PRED early-return gate-om — vizual3d.md „dead-effect" pasca:
	// gate pred čítaním propu by efekt navždy odmŕtvil), až POTOM sa preskočí prepis,
	// keď užívateľ práve píše (inak by sme mu prepisovali rozpísanú hodnotu).
	$effect(() => {
		const mm = hodnotaMm;
		if (upravuje) return;
		text = mmNaMetreText(mm);
	});

	function onInput(v: string) {
		text = v;
		const mm = parseMetreNaMm(v, min, max);
		// null (prázdny/nečíselný vstup počas mazania) → hodnotu NEmeníme; blur ju
		// dorovná späť na poslednú platnú mm hodnotu.
		if (mm != null) hodnotaMm = mm;
	}

	function onBlur() {
		upravuje = false;
		// normalizuj EXPLICITNE (nespoliehaj na re-fire efektu po zmene `upravuje`)
		text = mmNaMetreText(hodnotaMm);
	}

	function krok(smer: 1 | -1) {
		hodnotaMm = krokMetre(hodnotaMm, smer * krokMm, min, max);
		// stepper klik ukradne fokus inputu → blur; text nastavíme priamo, takže
		// poradie blur/klik je nepodstatné a hodnota sa zobrazí okamžite.
		text = mmNaMetreText(hodnotaMm);
	}
</script>

<div class="rs-rozmer">
	<label for={id} class="rs-popis">{popis}</label>
	<span class="rs-stepper">
		<button
			type="button"
			class="rs-krok"
			aria-label={`Zmenšiť ${akuzativ}`}
			onclick={() => krok(-1)}>−</button
		>
		<input
			{id}
			class="rs-cislo"
			type="text"
			inputmode="decimal"
			value={text}
			data-testid={testid}
			aria-label={`${popis} (metre)`}
			oninput={(e) => onInput(e.currentTarget.value)}
			onfocus={() => (upravuje = true)}
			onblur={onBlur}
		/>
		<span class="rs-jednotka">m</span>
		<button
			type="button"
			class="rs-krok"
			aria-label={`Zväčšiť ${akuzativ}`}
			onclick={() => krok(1)}>+</button
		>
	</span>
	<!-- POSTuje interné MILIMETRE (cena/PDF/Odoo nezmenené) -->
	<input type="hidden" {name} value={hodnotaMm} />
</div>

<style>
	/* Riadok smie zalomiť LABEL nad stepper na úzkom paneli (row-gap), ale stepper
	   samotný sa nikdy nezalomí (nižšie). */
	.rs-rozmer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
		row-gap: 6px;
	}
	.rs-popis {
		font-size: 14px;
		color: var(--k-text);
	}
	/* WRAP-PROOF: `flex-wrap:nowrap` + ne-zmršťujúce tlačidlá → `−[hodnota]+` VŽDY na
	   jednom riadku (owner bug: `+` sa zalomil nad číslo na úzkom viewporte). */
	.rs-stepper {
		display: inline-flex;
		align-items: center;
		flex-wrap: nowrap;
		gap: 4px;
		border: 1px solid var(--k-line-2);
		border-radius: var(--k-radius-pill);
		padding: 3px;
		background: var(--k-surface);
	}
	.rs-stepper:focus-within {
		border-color: var(--k-ink);
	}
	.rs-krok {
		flex-shrink: 0;
		width: 30px;
		height: 30px;
		border: 0;
		border-radius: 999px;
		background: var(--k-surface-2);
		color: var(--k-text);
		font-size: 18px;
		line-height: 1;
		cursor: pointer;
		display: grid;
		place-items: center;
		transition: background 0.15s ease;
	}
	.rs-krok:hover {
		background: var(--k-line);
	}
	.rs-krok:focus-visible {
		outline: 2px solid var(--k-ink);
		outline-offset: 1px;
	}
	.rs-cislo {
		width: 52px;
		min-width: 0;
		flex-shrink: 1;
		border: 0;
		background: none;
		text-align: center;
		font-size: 16px; /* 16px = žiadny iOS auto-zoom pri fokuse (mobil-first) */
		font-family: inherit;
		font-variant-numeric: tabular-nums;
		color: var(--k-text);
	}
	.rs-cislo:focus {
		outline: none;
	}
	.rs-jednotka {
		flex-shrink: 0;
		font-size: 12px;
		color: var(--k-faint);
		padding: 0 2px;
	}
</style>
