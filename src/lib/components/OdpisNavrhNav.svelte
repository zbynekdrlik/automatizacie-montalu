<script lang="ts">
	// Zdieľaný prepínač režimov pre ZASKLENIA a BAZÉN (#423) — vzor
	// `PergolaModeNav.svelte`/`FixModeNav.svelte`. Owner (2.9.): pri zaskleniach a
	// bazéne majú byť tie isté veľké kachličky ako pri pergole — „normálny zápis do
	// Money so všetkým" vs. „iba návrhový výkres" — namiesto malého redirect odkazu.
	//
	// Obe rodiny majú IDENTICKÚ štruktúru (2 režimy, líšia sa len prefixom cesty +
	// jednou vetou popisu), preto JEDEN parametrizovaný komponent (prop `modul`),
	// nie dva takmer identické súbory (na rozdiel od Pergola/Fix, ktoré majú rôzny
	// POČET + sémantiku režimov). Renderuje sa hore na oboch stránkach rodiny
	// (`/zasklenia`+`/zasklenia/navrh`, `/bazen`+`/bazen/navrh`) vo vlastnej `.card`,
	// aby sa dalo jedným klikom prepínať odkiaľkoľvek. Aktívna stránka je non-link
	// karta (rovnaký minimalistický `.active` vzhľad ako aktuálny PergolaModeNav
	// post-#398 — bez „tu si"/foot), druhá je odkaz s „Otvoriť →".
	import { resolve } from '$app/paths';

	type Modul = 'zasklenia' | 'bazen';
	type Rezim = 'odpis' | 'navrh';
	let { modul, active }: { modul: Modul; active: Rezim } = $props();

	// Cesty ako ÚZKA únia literálov (nie bare `RouteId`) — `resolve()`'s overloaded
	// signatúra prepadne na plnej ~24-člennej `RouteId` únii, ale úzku explicitnú
	// úniu berie (vzor PergolaModeNav, lint-formatting.md).
	type Cesta = '/zasklenia' | '/zasklenia/navrh' | '/bazen' | '/bazen/navrh';
	type Kachlicka = { cesta: Cesta; tag: string; title: string; desc: string };

	// Popis režimu „iba návrhový výkres" je pre obe rodiny rovnaký; popis „zápis do
	// Money" nesie produktovú nuansu (zasklenia = nárezový plán, bazén = parametre
	// krytu). Owner formuluje voľbu ako „zápis do Money so všetkým".
	const NAVRH_DESC = 'Zákaznícky návrhový výkres na tlač. Do Money nejde nič.';
	const KONFIG: Record<Modul, Record<Rezim, Kachlicka>> = {
		zasklenia: {
			odpis: {
				cesta: '/zasklenia',
				tag: 'do Money',
				title: 'Zápis do Money',
				desc: 'Zadaj rozmery — ukážem nárezový plán a po potvrdení odpíšem materiál do Money so všetkým.'
			},
			navrh: {
				cesta: '/zasklenia/navrh',
				tag: 'bez Money',
				title: 'Návrhový výkres',
				desc: NAVRH_DESC
			}
		},
		bazen: {
			odpis: {
				cesta: '/bazen',
				tag: 'do Money',
				title: 'Zápis do Money',
				desc: 'Zadaj parametre krytu — po potvrdení odpíšem materiál do Money so všetkým.'
			},
			navrh: { cesta: '/bazen/navrh', tag: 'bez Money', title: 'Návrhový výkres', desc: NAVRH_DESC }
		}
	};
</script>

{#snippet card(k: Kachlicka, aktivna: boolean, testid: string)}
	{#if aktivna}
		<div class="mode-card active" data-testid={testid}>
			<span class="mode-tag">{k.tag}</span>
			<span class="mode-title">{k.title}</span>
			<span class="mode-desc">{k.desc}</span>
		</div>
	{:else}
		<a class="mode-card" href={resolve(k.cesta)} data-testid={testid}>
			<span class="mode-tag">{k.tag}</span>
			<span class="mode-title">{k.title}</span>
			<span class="mode-desc">{k.desc}</span>
			<span class="mode-foot">Otvoriť →</span>
		</a>
	{/if}
{/snippet}

<div class="mode-grid cols-2" data-testid="{modul}-rezimy">
	{@render card(KONFIG[modul].odpis, active === 'odpis', `${modul}-rezim-odpis`)}
	{@render card(KONFIG[modul].navrh, active === 'navrh', `${modul}-rezim-navrh`)}
</div>
