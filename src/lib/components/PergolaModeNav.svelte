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
			<span class="mode-tag">{tag}</span>
			<span class="mode-title">{title}</span>
			<span class="mode-desc">{desc}</span>
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
		'Pergola z cadu',
		'Máš hotový CAD nárez zo Solid Edge — prepíšem ho na Money odpis a počty tyčí.',
		'rezim-cad'
	)}
	{@render card(
		'narez',
		'z rozmerov',
		'Pergola z appky',
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
<!-- .mode-* štýly zdieľané v src/app.css (#394) -->
