<script lang="ts">
	// Zdieľaný prepínač FIX režimov (#380) — vzor `PergolaModeNav.svelte`.
	// Renderuje sa hore na `/fix` (Fix z appky) aj `/fix/cad` (Fix z cadu), aby sa
	// dalo jedným klikom prepínať odkiaľkoľvek. Aktívna stránka je non-link karta
	// (rovnaký `.active` vzhľad ako pergola), druhá je odkaz. Pomenovanie režimov
	// konzistentné s pergolou/zadaním: „Fix z appky" / „Fix z cadu".
	import { resolve } from '$app/paths';

	type Rezim = 'appka' | 'cad';
	let { active }: { active: Rezim } = $props();

	// jedna mapa namiesto vetiev (rezim je uzavretá únia, Record je vyčerpávajúci
	// by-construction — TS to vynúti), vzor PergolaModeNav.
	const CESTY: Record<Rezim, '/fix' | '/fix/cad'> = {
		appka: '/fix',
		cad: '/fix/cad'
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

<div class="mode-grid cols-2" data-testid="fix-rezimy">
	{@render card(
		'appka',
		'z rozmerov',
		'Fix z appky',
		'Zadaj rozmery — vykreslím výkres konštrukcie na tlač. Do Money nejde nič.',
		'fix-rezim-appka'
	)}
	{@render card(
		'cad',
		'CAD → Money',
		'Fix z cadu',
		'Máš hotový CAD nárez — prepíšem ho na Money odpis a počty tyčí pre Solid Edge.',
		'fix-rezim-cad'
	)}
</div>
