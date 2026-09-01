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

<div class="mode-grid" data-testid="fix-rezimy">
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

<style>
	/* Rozcestník režimov — reuse tokenov z app.css (vzor PergolaModeNav), žiadny nový
	   dizajnový jazyk. Aktívna karta modrý akcent, odkazy hover. */
	.mode-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
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
