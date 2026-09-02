<script lang="ts">
	// #327: Prémiový showroom chrome pre VEREJNÝ konfigurátor (Tesla/Apple štandard).
	// Root `+layout.svelte` renderuje pre `/konfigurator*` len `{@render children()}`
	// (žiadny admin nav, žiadny `.wrap`, žiadny root footer) — tento layout dodáva
	// vlastný minimal header + pätičku s JEDINOU `data-testid="version"` na stránke.
	// Dizajnové tokeny (paleta, rádiusy, Inter) žijú TU (jedno miesto, `.konf-app`) —
	// NIKDY v `app.css` (to by prenieslo showroom tému do internej admin appky).
	// Inter: self-hosted variabilný font (npm, žiadny CDN) — vzor `@fontsource-variable/archivo`.
	import '@fontsource-variable/inter/index.css';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	let { data, children } = $props();

	// #384: na produktovej PODSTRÁNKE (`/konfigurator/<produkt>`) ponúkni cestu späť na výber;
	// na samotnej výberovej obrazovke (`/konfigurator`) sa odkaz neukazuje. SSR-konzistentné
	// cez `$app/state` `page` (žiadny `window.location`, žiadny hydration mismatch).
	const jePodstranka = $derived(page.url.pathname !== '/konfigurator');
</script>

<div class="konf-app">
	<header class="konf-hlava">
		<div class="konf-hlava-in">
			<a class="konf-znacka" href="https://www.montalu.sk" target="_blank" rel="noopener">MONTALU</a
			>
			<nav class="konf-hlava-odkazy">
				{#if jePodstranka}
					<a class="konf-spat" href={resolve('/konfigurator')} data-testid="konf-spat-vyber"
						>← Výrobky</a
					>
				{/if}
				{#if data.user}
					<!-- prihlásený interný/b2b user: decentný návrat do internej appky (nie admin nav) -->
					<a class="konf-interny" href={resolve('/zasklenia')}>← interná aplikácia</a>
				{/if}
				<a class="konf-web" href="https://www.montalu.sk" target="_blank" rel="noopener"
					>montalu.sk ↗</a
				>
			</nav>
		</div>
	</header>

	<main class="konf-telo">
		{@render children()}
	</main>

	<footer class="konf-pata">
		<span class="konf-pata-znacka">MONTALU — hliníkové výrobky na mieru</span>
		<span class="konf-pata-verzia" data-testid="version">v{data.version}</span>
	</footer>
</div>

<style>
	/* ── Dizajnové tokeny (jediné miesto; kaskádujú do KonfOvladace/KonfVizual/… cez
	   dedené CSS custom properties, nezávisle od Svelte scoping) ── */
	.konf-app {
		--k-bg: #fafaf8;
		--k-surface: #ffffff;
		--k-surface-2: #f4f3ef;
		--k-text: #16181c;
		--k-muted: #6b7078;
		--k-faint: #9a9ea6;
		--k-line: #e6e4de;
		--k-line-2: #d9d7d0;
		--k-ink: #1b1e23; /* antracit — primárna akcia */
		--k-ink-hover: #2c3037;
		--k-accent: #b07a45; /* jedna teplá akcentová na drobnosti */
		--k-accent-soft: #f5ede2; /* teplý jemný tint (selected/hover pozadie) */
		--k-radius: 16px;
		--k-radius-sm: 11px;
		--k-radius-pill: 999px;
		--k-hlava-h: 58px;
		--k-shadow: 0 1px 2px rgba(22, 24, 28, 0.04), 0 8px 30px rgba(22, 24, 28, 0.05);

		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		background: var(--k-bg);
		color: var(--k-text);
		font-family:
			'Inter Variable',
			-apple-system,
			'Segoe UI',
			Roboto,
			sans-serif;
		-webkit-font-smoothing: antialiased;
		text-rendering: optimizeLegibility;
	}

	.konf-hlava {
		position: sticky;
		top: 0;
		z-index: 30;
		height: var(--k-hlava-h);
		background: rgba(250, 250, 248, 0.82);
		-webkit-backdrop-filter: saturate(1.4) blur(10px);
		backdrop-filter: saturate(1.4) blur(10px);
		border-bottom: 1px solid var(--k-line);
	}
	.konf-hlava-in {
		max-width: 1360px;
		height: 100%;
		margin: 0 auto;
		padding: 0 clamp(16px, 4vw, 40px);
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.konf-znacka {
		font-weight: 700;
		font-size: 18px;
		letter-spacing: 0.18em;
		color: var(--k-text);
		text-decoration: none;
	}
	.konf-hlava-odkazy {
		display: flex;
		align-items: center;
		gap: 18px;
	}
	.konf-spat,
	.konf-interny,
	.konf-web {
		font-size: 13px;
		color: var(--k-muted);
		text-decoration: none;
		transition: color 0.15s ease;
	}
	.konf-spat {
		font-weight: 600;
		color: var(--k-text);
	}
	.konf-spat:hover,
	.konf-interny:hover,
	.konf-web:hover {
		color: var(--k-text);
	}

	.konf-telo {
		flex: 1;
		min-height: 0;
	}

	.konf-pata {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
		padding: 16px clamp(16px, 4vw, 40px);
		border-top: 1px solid var(--k-line);
		background: var(--k-bg);
		color: var(--k-faint);
		font-size: 12.5px;
	}
	.konf-pata-verzia {
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.02em;
	}

	/* ── #409/#411: ZDIEĽANÁ showroom CSS produktových podstránok konfigurátora
	   (`.kp-*` = KonfProduktStranka). Jedno miesto namiesto ~280-riadkovej kópie na
	   každej z 5 jednostĺpcových podstránok {tienenie, pristresok, zasklenie,
	   zimna-zahrada, oplotenie}. `:global(.konf-app .kp-…)` = narieknuté cez `.konf-app`
	   (žiadny únik do internej admin appky, rovnako ako `--k-*` tokeny vyššie), aplikuje
	   sa aj na markup vyrenderovaný v scope stránky (snippet obsah shellu). Split-screen
	   pergola/bazén (`.konf-*`/`.baz-*`) tieto triedy nepoužívajú → nedotknuté.
	   Per-produkt odlišnosti (šírka kariet cez `--kp-karta-min`, utility ako
	   `.kp-latka-info`) žijú v `<style>` danej podstránky. ── */
	:global(.konf-app .kp) {
		max-width: 1100px;
		margin: 0 auto;
		padding: clamp(20px, 4vw, 44px) clamp(16px, 4vw, 40px) clamp(40px, 6vw, 72px);
	}

	/* HERO */
	:global(.konf-app .kp-hero) {
		display: grid;
		grid-template-columns: 1fr;
		gap: clamp(16px, 3vw, 28px);
		margin-bottom: clamp(24px, 4vw, 40px);
	}
	:global(.konf-app .kp-hero-foto) {
		border-radius: var(--k-radius);
		overflow: hidden;
		aspect-ratio: 5 / 3;
		background: var(--k-surface-2);
		box-shadow: var(--k-shadow);
	}
	:global(.konf-app .kp-hero-foto img) {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	:global(.konf-app .kp-label) {
		display: block;
		font-size: 11.5px;
		font-weight: 600;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--k-accent);
		margin-bottom: 10px;
	}
	:global(.konf-app .kp-hero-text h1) {
		margin: 0 0 12px;
		font-size: clamp(1.8rem, 4vw, 2.7rem);
		font-weight: 700;
		line-height: 1.06;
		letter-spacing: -0.02em;
		color: var(--k-text);
	}
	:global(.konf-app .kp-hero-text p) {
		margin: 0;
		font-size: 15.5px;
		line-height: 1.55;
		color: var(--k-muted);
		max-width: 560px;
	}

	/* LAYOUT: mobil 1 stĺpec, desktop ovládanie + panel */
	:global(.konf-app .kp-grid) {
		display: grid;
		grid-template-columns: 1fr;
		gap: clamp(18px, 3vw, 32px);
		align-items: start;
	}

	:global(.konf-app .kp-blok) {
		border: 1px solid var(--k-line);
		border-radius: var(--k-radius);
		background: var(--k-surface);
		padding: 18px 18px 20px;
		margin: 0 0 16px;
	}
	:global(.konf-app .kp-blok legend) {
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--k-accent);
		padding: 0 6px;
	}

	/* karty: šírka mriežky per-produkt cez `--kp-karta-min` (default 150px); `.dvoj` = 200px */
	:global(.konf-app .kp-karty) {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(var(--kp-karta-min, 150px), 1fr));
		gap: 10px;
		margin-top: 6px;
	}
	:global(.konf-app .kp-karty.dvoj) {
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
	}
	:global(.konf-app .kp-karta) {
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
	:global(.konf-app .kp-karta:hover) {
		border-color: var(--k-line-2);
	}
	:global(.konf-app .kp-karta.vybrana) {
		border-color: var(--k-ink);
		background: var(--k-accent-soft);
	}
	:global(.konf-app .kp-karta:focus-visible) {
		outline: 2px solid var(--k-ink);
		outline-offset: 2px;
	}
	:global(.konf-app .kp-karta-nazov) {
		font-size: 15px;
		font-weight: 650;
		color: var(--k-text);
	}
	:global(.konf-app .kp-karta-popis) {
		font-size: 12.5px;
		line-height: 1.4;
		color: var(--k-muted);
	}

	:global(.konf-app .kp-rozmery) {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 12px;
		margin-top: 6px;
	}
	/* metrové steppery (RozmerStepper) stohované pod sebou */
	:global(.konf-app .kp-steppery) {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-top: 6px;
	}
	:global(.konf-app .kp-pole) {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	:global(.konf-app .kp-pole span) {
		font-size: 13px;
		font-weight: 600;
		color: var(--k-text);
	}
	:global(.konf-app .kp-pole select) {
		padding: 9px 11px;
		border: 1px solid var(--k-line-2);
		border-radius: var(--k-radius-sm);
		font: inherit;
		background: var(--k-surface);
		color: var(--k-text);
	}
	:global(.konf-app .kp-pole select:focus-visible) {
		outline: 2px solid var(--k-ink);
		outline-offset: 1px;
	}

	/* PANEL: súhrn + cena (honest-null `.kp-cena-info` / cenová forma `.kp-cena*`) + dopyt */
	:global(.konf-app .kp-panel) {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	:global(.konf-app .kp-suhrn),
	:global(.konf-app .kp-cena-info),
	:global(.konf-app .kp-blok-kontakt) {
		border: 1px solid var(--k-line);
		border-radius: var(--k-radius);
		background: var(--k-surface);
		padding: 20px 22px;
	}
	:global(.konf-app .kp-suhrn h2),
	:global(.konf-app .kp-blok-kontakt h2) {
		margin: 0 0 12px;
		font-size: 18px;
		font-weight: 650;
		letter-spacing: -0.01em;
		color: var(--k-text);
	}
	:global(.konf-app .kp-suhrn dl) {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	:global(.konf-app .kp-suhrn dl > div) {
		display: flex;
		justify-content: space-between;
		gap: 14px;
		border-bottom: 1px solid var(--k-line);
		padding-bottom: 8px;
	}
	:global(.konf-app .kp-suhrn dl > div:last-child) {
		border-bottom: 0;
		padding-bottom: 0;
	}
	:global(.konf-app .kp-suhrn dt) {
		font-size: 13.5px;
		color: var(--k-muted);
	}
	:global(.konf-app .kp-suhrn dd) {
		margin: 0;
		font-size: 13.5px;
		font-weight: 600;
		color: var(--k-text);
		text-align: right;
	}

	/* CENA — honest-null statická karta (tienenie/pristresok/zasklenie) */
	:global(.konf-app .kp-cena-info) {
		background: var(--k-surface-2);
		border-color: var(--k-line-2);
	}
	:global(.konf-app .kp-cena-info strong) {
		display: block;
		font-size: 17px;
		color: var(--k-text);
		margin-bottom: 6px;
	}
	:global(.konf-app .kp-cena-info p) {
		margin: 0 0 14px;
		font-size: 13.5px;
		line-height: 1.5;
		color: var(--k-muted);
	}

	/* CENA — orientačná cena (zimna-zahrada #408 / oplotenie #410), vzor bazén/pergola */
	:global(.konf-app .kp-cena) {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	:global(.konf-app .kp-cena-form) {
		border: 1px solid var(--k-line-2);
		border-radius: var(--k-radius);
		background: var(--k-surface-2);
		padding: 20px 22px;
	}
	:global(.konf-app .kp-cena-form strong) {
		display: block;
		font-size: 17px;
		color: var(--k-text);
		margin-bottom: 6px;
	}
	:global(.konf-app .kp-cena-form p) {
		margin: 0 0 14px;
		font-size: 13.5px;
		line-height: 1.5;
		color: var(--k-muted);
	}
	:global(.konf-app .kp-cena-chyba) {
		color: #a3261c;
		font-weight: 600;
	}
	/* prémiový antracitový cenový panel (tmavá karta — zhoda s pergolovým/bazénovým) */
	:global(.konf-app .kp-cena-blok) {
		background: var(--k-ink, #1b1e23);
		color: #fff;
		border-radius: var(--k-radius);
		padding: 20px 22px;
	}
	:global(.konf-app .kp-cena-label) {
		display: block;
		color: rgba(255, 255, 255, 0.62);
		font-size: 12px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		font-weight: 600;
	}
	:global(.konf-app .kp-cena-vo) {
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
	:global(.konf-app .kp-cena-hlavne) {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin-top: 8px;
	}
	:global(.konf-app .kp-cena-sdph) {
		font-size: clamp(28px, 7vw, 38px);
		font-weight: 700;
		line-height: 1.05;
		letter-spacing: -0.02em;
		font-variant-numeric: tabular-nums;
	}
	:global(.konf-app .kp-cena-mena) {
		color: rgba(255, 255, 255, 0.66);
		font-size: 14px;
	}
	:global(.konf-app .kp-cena-bezdph) {
		color: rgba(255, 255, 255, 0.66);
		font-size: 14px;
		margin-top: 4px;
	}
	:global(.konf-app .kp-cena-grid) {
		color: rgba(255, 255, 255, 0.55);
		font-size: 12px;
		line-height: 1.4;
		margin-top: 8px;
	}
	:global(.konf-app .kp-cena-dovod) {
		color: rgba(255, 255, 255, 0.72);
		font-size: 13.5px;
		margin: 8px 0 0;
	}
	:global(.konf-app .kp-cena-pozn) {
		color: rgba(255, 255, 255, 0.5);
		font-size: 12px;
		line-height: 1.45;
		margin: 14px 0 0;
	}

	:global(.konf-app .kp-uvod) {
		color: var(--k-muted);
		font-size: 14px;
		line-height: 1.5;
		margin: 0 0 16px;
	}

	:global(.konf-app .kp-btn) {
		font-family: inherit;
		font-size: 14px;
		font-weight: 600;
		border-radius: var(--k-radius-pill);
		padding: 11px 20px;
		cursor: pointer;
		border: 1px solid transparent;
	}
	:global(.konf-app .kp-btn.primar) {
		background: var(--k-ink);
		color: #fff;
	}
	:global(.konf-app .kp-btn.primar:hover) {
		background: var(--k-ink-hover);
	}
	:global(.konf-app .kp-btn.druhotny) {
		background: var(--k-surface);
		color: var(--k-text);
		border-color: var(--k-line-2);
	}
	:global(.konf-app .kp-btn.druhotny:hover) {
		border-color: var(--k-ink);
	}
	:global(.konf-app .kp-btn:focus-visible) {
		outline: 2px solid var(--k-ink);
		outline-offset: 2px;
	}

	:global(.konf-app .kp-chyba) {
		color: #a3261c;
		background: #fbeeec;
		border: 1px solid #f2cfc9;
		border-radius: var(--k-radius-sm);
		padding: 14px 16px;
		font-size: 14px;
		margin: 0;
	}

	@media (min-width: 900px) {
		:global(.konf-app .kp-hero) {
			grid-template-columns: 1.1fr 0.9fr;
			align-items: center;
		}
		:global(.konf-app .kp-grid) {
			grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
		}
	}
</style>
