<script lang="ts">
	// #384: výberová obrazovka jednotného verejného konfigurátora — grid produktových kariet
	// (fotka + názov + 1 veta + CTA). Live produkt → interná podstránka `/konfigurator/<kod>`
	// (typovaná `resolve()` navigácia, #99); `pripravujeme` → badge + odkaz na produktovú stránku
	// montalu.sk (žiadny mŕtvy klik, žiadny fake konfigurátor). Čistý prezentačný leaf: katalóg
	// je client-safe `KONF_PRODUKTY` (žiadny Money kód/cena) → leak-guard (A) ho prejde.
	import { base, resolve } from '$app/paths';
	import { KONF_PRODUKTY } from '$lib/konfigurator-produkty';

	// Interné (live) karty vedú na typovanú `resolve()` navigáciu (#99). `odkaz` je v katalógu
	// `string` (rovnaké pole nesie aj externé montalu.sk URL), tu ho pre live vetvu zúžime na
	// KONKRÉTNE interné route literály — každý produktový PR (#385–#390), čo prepne kartu na `live`,
	// sem pridá svoj `/konfigurator/<slug>` literál (#385: bazén; #387: zasklenie; #389: tienenie).
	type LiveRoute =
		| '/konfigurator/pergola'
		| '/konfigurator/bazen'
		| '/konfigurator/zasklenie'
		| '/konfigurator/tienenie';
</script>

<section class="vyber" data-testid="konf-vyber">
	<header class="vyber-hlava">
		<h1>Nakonfigurujte si výrobok na mieru</h1>
		<p>Vyberte, čo chcete konfigurovať — pripravíme vám orientačnú cenu a špecifikáciu.</p>
	</header>

	<ul class="mriezka">
		{#each KONF_PRODUKTY as p, i (p.kod)}
			<li>
				{#if p.externy}
					<!-- eslint-disable svelte/no-navigation-without-resolve -- `p.odkaz` je pri
					     `pripravujeme` externá absolútna montalu.sk URL (nie interná route), takže
					     `resolve()` sa naň nevzťahuje; pravidlo má false-positive na dynamickom externom
					     href. Disable je scoped LEN na túto vetvu — interná (else) vetva ho drží. -->
					<a
						class="karta"
						class:pripravujeme={p.stav === 'pripravujeme'}
						href={p.odkaz}
						target="_blank"
						rel="noopener"
						data-testid="konf-produkt-{p.kod}"
						data-stav={p.stav}
					>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
						<div class="foto-obal">
							<img
								class="foto"
								src="{base}/konfigurator/vyber/{p.foto}"
								alt={p.alt}
								loading={i === 0 ? 'eager' : 'lazy'}
								fetchpriority={i === 0 ? 'high' : null}
								width="1000"
								height="600"
							/>
							{#if p.stav === 'pripravujeme'}
								<span class="odznak">Pripravujeme</span>
							{/if}
						</div>
						<div class="telo">
							<h2>{p.nazov}</h2>
							<p>{p.popis}</p>
							<span class="cta cta-web">Pozrieť na montalu.sk ↗</span>
						</div>
					</a>
				{:else}
					<a
						class="karta"
						href={resolve(p.odkaz as LiveRoute)}
						data-testid="konf-produkt-{p.kod}"
						data-stav={p.stav}
					>
						<div class="foto-obal">
							<img
								class="foto"
								src="{base}/konfigurator/vyber/{p.foto}"
								alt={p.alt}
								loading={i === 0 ? 'eager' : 'lazy'}
								fetchpriority={i === 0 ? 'high' : null}
								width="1000"
								height="600"
							/>
						</div>
						<div class="telo">
							<h2>{p.nazov}</h2>
							<p>{p.popis}</p>
							<span class="cta cta-konf">Konfigurovať →</span>
						</div>
					</a>
				{/if}
			</li>
		{/each}
	</ul>
</section>

<style>
	.vyber {
		max-width: 1360px;
		margin: 0 auto;
		padding: clamp(28px, 5vw, 56px) clamp(16px, 4vw, 40px) clamp(40px, 6vw, 72px);
	}
	.vyber-hlava {
		text-align: center;
		margin-bottom: clamp(24px, 4vw, 44px);
	}
	.vyber-hlava h1 {
		margin: 0 0 10px;
		font-size: clamp(1.6rem, 3.4vw, 2.4rem);
		font-weight: 700;
		letter-spacing: -0.01em;
		color: var(--k-text);
	}
	.vyber-hlava p {
		margin: 0;
		font-size: clamp(0.95rem, 1.6vw, 1.075rem);
		color: var(--k-muted);
	}

	.mriezka {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: clamp(16px, 2.4vw, 26px);
	}

	.karta {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--k-surface);
		border: 1px solid var(--k-line);
		border-radius: var(--k-radius);
		overflow: hidden;
		text-decoration: none;
		color: inherit;
		box-shadow: var(--k-shadow);
		transition:
			transform 0.18s ease,
			box-shadow 0.18s ease,
			border-color 0.18s ease;
	}
	.karta:hover,
	.karta:focus-visible {
		transform: translateY(-3px);
		border-color: var(--k-line-2);
		box-shadow:
			0 2px 4px rgba(22, 24, 28, 0.05),
			0 16px 40px rgba(22, 24, 28, 0.1);
	}
	.karta:focus-visible {
		outline: 2px solid var(--k-ink);
		outline-offset: 2px;
	}

	.foto-obal {
		position: relative;
		aspect-ratio: 5 / 3;
		background: var(--k-surface-2);
		overflow: hidden;
	}
	.foto {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		transition: transform 0.4s ease;
	}
	.karta:hover .foto {
		transform: scale(1.035);
	}
	.pripravujeme .foto {
		filter: saturate(0.82) brightness(0.98);
	}

	.odznak {
		position: absolute;
		top: 12px;
		left: 12px;
		padding: 4px 11px;
		border-radius: var(--k-radius-pill);
		background: rgba(27, 30, 35, 0.86);
		color: #fff;
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.02em;
		-webkit-backdrop-filter: blur(4px);
		backdrop-filter: blur(4px);
	}

	.telo {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 16px 18px 18px;
		flex: 1;
	}
	.telo h2 {
		margin: 0;
		font-size: 1.14rem;
		font-weight: 650;
		color: var(--k-text);
	}
	.telo p {
		margin: 0;
		font-size: 0.9rem;
		line-height: 1.45;
		color: var(--k-muted);
		flex: 1;
	}
	.cta {
		margin-top: 8px;
		font-size: 0.9rem;
		font-weight: 600;
	}
	.cta-konf {
		color: var(--k-ink);
	}
	.cta-web {
		color: var(--k-accent);
	}
</style>
