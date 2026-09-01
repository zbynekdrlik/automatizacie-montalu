<script lang="ts">
	// Zdieľaný prepínač pergola režimov (#371) — extrahované z pôvodného
	// .mode-grid/.mode-card bloku, ktorý žil len na hub route (/pergola).
	// Renderuje sa hore na VŠETKÝCH troch pergola stránkach, aby sa dalo
	// jedným klikom prepínať odkiaľkoľvek (owner 1.9.2026: "uz sa neviem
	// lahko prepinat"). Aktívna stránka je non-link karta (rovnaký
	// `.active` vzhľad ako predtým na hube — žiadna vizuálna zmena tam),
	// ostatné dve sú odkazy. Testid-y ostávajú PRESNE tie, čo už
	// asertuje e2e/pergola-uix.spec.ts (rezim-cad / link-narez /
	// link-navrh / wrapper pergola-rezimy), aby sa žiadny existujúci
	// test nemusel meniť. Konzumenti: VŠETKY tri stránky (`/pergola`,
	// `/pergola/narez`, `/pergola/navrh`) ho wrapnú do VLASTNEJ `.card`,
	// VŽDY PRED nadpisovou `.card` (review nález #371 + zjednotenie poradia
	// #375 — konzistentný card vzhľad AJ poradie voči <h1> na všetkých
	// troch, žiadna zmena vnútra tejto komponenty).
	import { resolve } from '$app/paths';

	type Rezim = 'cad' | 'narez' | 'navrh';
	let { active }: { active: Rezim } = $props();

	// Review nález (#371): pôvodný if/if-else reťazec duplikoval href-resolúciu per
	// vetva — jedna mapa nahradí 3 vetvy 1 (rezim je uzavretá únia troch stringov,
	// takže Record je vyčerpávajúci by-construction, TS to vynúti).
	const CESTY: Record<Rezim, '/pergola' | '/pergola/narez' | '/pergola/navrh'> = {
		cad: '/pergola',
		narez: '/pergola/narez',
		navrh: '/pergola/navrh'
	};
</script>

{#snippet card(rezim: Rezim, tag: string, title: string, desc: string, testid: string)}
	{#if rezim === active}
		<div class="mode-card active" data-testid={testid}>
			<span class="mode-tag ok">{tag} tu si</span>
			<span class="mode-title">{title}</span>
			<span class="mode-desc">{desc}</span>
			<span class="mode-foot">Formulár je nižšie ↓</span>
		</div>
	{:else}
		<a class="mode-card" href={resolve(CESTY[rezim])} data-testid={testid}>
			<span class="mode-tag">{tag}</span>
			<span class="mode-title">{title}</span>
			<span class="mode-desc">{desc}</span>
			<span class="mode-foot">Otvoriť →</span>
		</a>
	{/if}
{/snippet}

<div class="mode-grid" data-testid="pergola-rezimy">
	{@render card(
		'cad',
		'➊',
		'CAD nárez → Money odpis',
		'Máš hotový CAD nárez zo Solid Edge — prepíšem ho na Money odpis a počty tyčí.',
		'rezim-cad'
	)}
	{@render card(
		'narez',
		'z rozmerov',
		'Rezervačný odpis',
		'Ešte nemáš CAD — zarezervuj materiál v Money už z rozmerov objednávky.',
		'link-narez'
	)}
	{@render card(
		'navrh',
		'bez Money',
		'Návrhový výkres',
		'Pekný technický výkres pre zákazníka. Do Money nejde nič.',
		'link-navrh'
	)}
</div>

<style>
	/* Rozcestník režimov (#222, extrahované #371) — reuse tokenov z app.css,
	   žiadny nový dizajnový jazyk. Aktívna karta modrý akcent, odkazy hover. */
	.mode-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 12px;
		margin-bottom: 14px;
	}
	@media (max-width: 720px) {
		.mode-grid {
			grid-template-columns: 1fr;
		}
	}
	.mode-card {
		display: flex;
		flex-direction: column;
		text-align: left;
		text-decoration: none;
		color: inherit;
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		border-radius: 12px;
		padding: 16px;
		transition:
			border-color 0.12s,
			box-shadow 0.12s,
			background 0.12s;
	}
	a.mode-card:hover {
		border-color: #2563eb;
		background: #fff;
		box-shadow: 0 2px 8px rgba(37, 99, 235, 0.12);
	}
	.mode-card.active {
		background: #eff6ff;
		border-color: #2563eb;
		box-shadow: inset 0 0 0 1px #2563eb;
	}
	.mode-tag {
		align-self: flex-start;
		font-size: 12px;
		font-weight: 700;
		color: #64748b;
		background: #e2e8f0;
		border-radius: 999px;
		padding: 2px 9px;
		margin-bottom: 9px;
	}
	.mode-tag.ok {
		background: #dcfce7;
		color: #15803d;
	}
	.mode-title {
		font-size: 17px;
		font-weight: 700;
		color: #0f172a;
		margin-bottom: 5px;
	}
	.mode-desc {
		font-size: 14px;
		color: #475569;
		line-height: 1.4;
	}
	.mode-foot {
		margin-top: 10px;
		font-size: 13px;
		font-weight: 600;
		color: #2563eb;
	}
	.mode-card.active .mode-foot {
		color: #475569;
	}
</style>
