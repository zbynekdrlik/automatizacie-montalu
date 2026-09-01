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
</style>
