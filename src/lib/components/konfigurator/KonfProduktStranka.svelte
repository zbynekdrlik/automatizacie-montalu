<script lang="ts">
	// #411: zdieľaný SHELL jednostĺpcovej produktovej podstránky konfigurátora — hero
	// (foto + label + h1 + úvod) + 2-stĺpcový grid (ovládanie + panel súhrn/cena/dopyt).
	// Túto kostru zdieľa 5 showroom podstránok {tienenie, pristresok, zasklenie,
	// zimna-zahrada, oplotenie}; produkt-špecifické časti (ovládacie fieldset-y a celý
	// súhrn/cena/dopyt panel vrátane `use:enhance` cenovej formy) dodá stránka cez
	// SNIPPET props `ovladacie` + `panel` — snippety sú súčasťou stránky, zatvárajú sa
	// nad jej `$state`/`$derived`, takže bind/enhance/onclick fungujú bez zmeny. Zdieľaná
	// showroom CSS (`.kp-*`) žije v `konfigurator/+layout.svelte` (`:global(.konf-app .kp-*)`,
	// #409) → aplikuje sa aj na snippet obsah renderovaný v scope stránky. Split-screen
	// pergola/bazén (`.konf-*`/`.baz-*`, ľavý 3D stĺpec) majú vlastnú kostru → tento shell
	// NEpoužívajú. Per-produkt odlišnosti (šírka kariet cez `--kp-karta-min`, utility triedy)
	// žijú v `<style>` danej podstránky.
	import { base } from '$app/paths';
	import type { Snippet } from 'svelte';

	let {
		foto,
		alt,
		label,
		nadpis,
		lead,
		ovladacie,
		panel
	}: {
		/** názov webp v `static/konfigurator/vyber/` (napr. `'tienenie.webp'`) */
		foto: string;
		/** alt text hero fotky */
		alt: string;
		/** malý nadpis kategórie nad h1 (napr. `'Konfigurátor tienenia'`) */
		label: string;
		/** hlavný h1 nadpis stránky */
		nadpis: string;
		/** úvodný odsek pod h1 */
		lead: string;
		/** ovládacie fieldset-y (produkt-špecifické) */
		ovladacie: Snippet;
		/** súhrn + cena + dopyt panel (produkt-špecifický, vrátane `{:else}` chyby) */
		panel: Snippet;
	} = $props();
</script>

<div class="kp">
	<!-- HERO -->
	<section class="kp-hero">
		<div class="kp-hero-foto">
			<img
				src="{base}/konfigurator/vyber/{foto}"
				{alt}
				width="1000"
				height="600"
				loading="eager"
				fetchpriority="high"
			/>
		</div>
		<div class="kp-hero-text">
			<span class="kp-label">{label}</span>
			<h1>{nadpis}</h1>
			<p>{lead}</p>
		</div>
	</section>

	<div class="kp-grid">
		<!-- OVLÁDANIE (produkt-špecifické fieldset-y) -->
		<div class="kp-ovladanie">
			{@render ovladacie()}
		</div>

		<!-- PANEL: súhrn + cena + dopyt (produkt-špecifický) -->
		<div class="kp-panel">
			{@render panel()}
		</div>
	</div>
</div>
