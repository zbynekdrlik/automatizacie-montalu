<script lang="ts">
	// #329 časť 3: reusable info karta pre model/sklo — fotka + krátky popis. Desktop: zobrazí sa
	// pri HOVER-i (CSS `@media (hover: hover)`). Mobil (hover neexistuje): malé ⓘ tlačidlo, tap ho
	// rozbalí. Karta je `position: absolute` overlay (neposúva layout, NEblokuje klik na výber pod
	// ňou — výber je vždy dostupný, karta je len informačná). Obrázky sú lokálne webp v
	// `static/konfigurator/` (žiadny CDN/hotlink). Čistý prezentačný leaf, žiadny stav rodiča.
	import { base } from '$app/paths';

	let {
		nazov,
		popis,
		obrazok,
		alt = ''
	}: {
		/** nadpis karty (názov modelu/kategórie) */
		nazov: string;
		/** krátky popis (1–2 vety) */
		popis: string;
		/** názov súboru vo `static/konfigurator/` (webp) — bez cesty */
		obrazok: string;
		/** alt text obrázka */
		alt?: string;
	} = $props();

	let otvorene = $state(false);
</script>

<span class="konf-info">
	<button
		type="button"
		class="konf-info-btn"
		aria-label={`Viac o: ${nazov}`}
		aria-expanded={otvorene}
		data-testid="konf-info-btn"
		onclick={(e) => {
			e.stopPropagation();
			e.preventDefault();
			otvorene = !otvorene;
		}}>i</button
	>
	<span class="konf-info-karta" class:otvorene role="tooltip" data-testid="konf-info-karta">
		<img class="konf-info-obr" src={`${base}/konfigurator/${obrazok}`} {alt} loading="lazy" />
		<span class="konf-info-text">
			<strong>{nazov}</strong>
			{popis}
		</span>
	</span>
</span>

<style>
	.konf-info {
		position: relative;
		display: inline-flex;
		vertical-align: middle;
	}
	.konf-info-btn {
		width: 20px;
		height: 20px;
		border-radius: 999px;
		border: 1px solid var(--k-line-2);
		background: var(--k-surface);
		color: var(--k-muted);
		font-size: 12px;
		font-style: italic;
		font-weight: 700;
		line-height: 1;
		cursor: pointer;
		display: grid;
		place-items: center;
		padding: 0;
		font-family: Georgia, 'Times New Roman', serif;
	}
	.konf-info-btn:hover {
		border-color: var(--k-ink);
		color: var(--k-text);
	}
	.konf-info-btn:focus-visible {
		outline: 2px solid var(--k-ink);
		outline-offset: 2px;
	}

	/* karta = absolútny overlay nad triggerom (neposúva layout, neblokuje klik na výber) */
	.konf-info-karta {
		position: absolute;
		bottom: calc(100% + 8px);
		left: 50%;
		transform: translateX(-50%) translateY(4px);
		width: 220px;
		max-width: 74vw;
		background: var(--k-surface);
		border: 1px solid var(--k-line);
		border-radius: var(--k-radius-sm);
		box-shadow: 0 8px 26px rgba(22, 24, 28, 0.16);
		padding: 10px;
		z-index: 20;
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
		transition:
			opacity 0.14s ease,
			transform 0.14s ease,
			visibility 0.14s;
	}
	.konf-info-karta.otvorene {
		opacity: 1;
		visibility: visible;
		transform: translateX(-50%) translateY(0);
		pointer-events: auto;
	}
	/* desktop (ukazovadlo s hover) — karta sa ukáže pri hover-i triggeru */
	@media (hover: hover) {
		.konf-info:hover .konf-info-karta,
		.konf-info-btn:focus-visible + .konf-info-karta {
			opacity: 1;
			visibility: visible;
			transform: translateX(-50%) translateY(0);
			pointer-events: auto;
		}
	}
	.konf-info-obr {
		display: block;
		width: 100%;
		height: auto;
		border-radius: 6px;
		margin-bottom: 8px;
		background: var(--k-surface-2);
	}
	.konf-info-text {
		display: block;
		font-size: 12.5px;
		line-height: 1.4;
		color: var(--k-muted);
	}
	.konf-info-text strong {
		display: block;
		color: var(--k-text);
		font-size: 13px;
		font-weight: 650;
		margin-bottom: 3px;
	}
</style>
