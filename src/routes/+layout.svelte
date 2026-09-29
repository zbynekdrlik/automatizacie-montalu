<script lang="ts">
	import '../app.css';
	// #376 stage 3: tlačový @media print blok presunutý z app.css (blížil sa 1000-r.
	// stropu) — hneď za app.css, aby kaskáda ostala nezmenená (byte-identické pravidlá).
	import '../print.css';
	// #376 stage 1: Archivo (display: h1/nav/tlačidlá) + Inter (body) Variable písma,
	// wirované raz tu (root layout je spoločný predok pre login/konfigurátor/internú
	// appku) — tokeny `--m-font-display`/`--m-font-body` v app.css. Oba balíčky sú v
	// package.json od skôr (login = Archivo, konfigurátor = Inter); duplicitný CSS
	// import je neškodný (rovnaká URL, prehliadač dedupuje).
	import '@fontsource-variable/archivo/index.css';
	import '@fontsource-variable/inter/index.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { afterNavigate } from '$app/navigation';
	import type { RouteId } from '$app/types';
	// #453 (Patrik, Odoo ch207 msg 1792131): koliesko myši nad zaostreným
	// <input type="number"> nebezpečne mení hodnotu namiesto scrollovania —
	// pripojené CELOPLOŠNE tu (jediné miesto pre všetky routy vrátane
	// /konfigurator), detail + zdôvodnenie v src/lib/wheel-guard.ts.
	import { odfokusujCisloInputPriWheeli } from '$lib/wheel-guard';
	// #592 (Odoo úloha 1220): „Fixy" + „Clip" zjednotené pod jednu položku „Pevné zasklenie"
	import {
		PEVNE_ZASKLENIE_LABEL,
		PEVNE_ZASKLENIE_LINKS,
		jePevneZasklenie
	} from '$lib/nav-pevne-zasklenie';

	let { data, children } = $props();

	// #327: /konfigurator je VEREJNÁ zákaznícka stránka s
	// VLASTNÝM minimal chrome (`konfigurator/+layout.svelte`). Interná admin navigácia sa
	// na nej NEzobrazuje NIKOMU (ani prihlásenému), a pätičku s verziou vlastní konf layout
	// → root pre túto vetvu nerenderuje nav, `.wrap` ani footer (práve JEDEN
	// `data-testid="version"` na stránke). `$app/state` `page` je reaktívne + SSR-konzistentné
	// (žiadny hydration mismatch), nikdy `window.location`.
	const jeKonfig = $derived(
		page.url.pathname === '/konfigurator' || page.url.pathname.startsWith('/konfigurator/')
	);

	// marker pre E2E: hydratácia hotová — pred ním môže fill() na value-bound
	// inputoch prehrať s hydratáciou, ktorá ich vráti na serverový stav
	$effect(() => {
		document.documentElement.dataset.hydrated = '1';
	});

	// #392: interný ≠ b2b — použité aj na gate admin odkazu (user menu) aj tools skupinu.
	const isInterny = $derived(data.user?.role !== 'b2b');

	// #392 (predtým jeden plochý `links` zoznam — owner 1.9.: „ta horna lista je uplne
	// hrozna"): rozdelené na PRIMÁRNU skupinu „Moduly" (rovnaká gating logika ako predtým,
	// len prerozdelená). B2B vidí Zasklenia + Sieťka + (od #144) display-only Pergola
	// návrh + (od #162) display-only Zasklenia návrh. href je typovaný ako RouteId (z
	// $app/types) a šablóna nižšie ho vždy volá cez resolve(l.href) — svelte/no-navigation-
	// without-resolve (#99).
	//
	// Interné menu #162 review nález (deep review): /zasklenia/navrh NEDOSTÁVA vlastný
	// top-nav odkaz pre interných (rovnaká disciplína ako pergola — pozri #144 komentár
	// nižšie), lebo interní ju už dosiahnu jedným klikom z vnútra /zasklenia (in-page
	// odkaz „→ Návrhový výkres" pridaný v #162). B2B naopak MÁ tento odkaz priamo v
	// (krátkom) menu — presne to isté zdôvodnenie, aké #144 dalo pergole.
	//
	// #592: interný zoznam nesie namiesto dvoch odkazov „Fixy"/„Clip" jeden ZNAČKOVÝ člen
	// `PEVNE` — na jeho mieste sa renderuje skupina „Pevné zasklenie" (desktop: vnorený
	// <details> dropdown; v „Moduly" dropdowne pod 900px: podsekcia s nadpisom). B2B vetva
	// ho nemá — /fix aj /clip sú v B2B_FORBIDDEN_PREFIXES (drift guard v unit teste #592).
	const PEVNE = { skupina: 'pevne' } as const;
	const moduleLinks = $derived(
		data.user?.role === 'b2b'
			? ([
					{ href: '/zasklenia', label: 'Zasklenia' },
					// dodatočná sieťka bez posuvu (#89) — Patrik: „hlavne pre externých"
					{ href: '/sietka', label: 'Sieťka' },
					// zákaznícky návrhový výkres (#138), sprístupnený b2b (#144) — display-only,
					// žiadny Money zápis; /pergola (Money odpis z CAD nárezu) pre b2b NIE JE tu
					{ href: '/pergola/navrh', label: 'Pergola návrh' },
					// zákaznícky návrhový výkres pre zasklenia (#162) — rovnaká disciplína ako
					// vyššie; na rozdiel od pergoly /zasklenia/navrh NEPOTREBUJE výnimku v
					// B2B_FORBIDDEN_PREFIXES (rodičovská /zasklenia už nie je zakázaná), ale
					// priamy odkaz v krátkom b2b menu je rovnako žiaduci ako pri pergole
					{ href: '/zasklenia/navrh', label: 'Zasklenia návrh' }
				] satisfies { href: RouteId; label: string }[])
			: ([
					{ href: '/pergola', label: 'Pergola' },
					// #592: Fix z appky / Fix z CADu / Zábradlia (CLIP) — `$lib/nav-pevne-zasklenie`
					PEVNE,
					{ href: '/bazen', label: 'Bazén' },
					{ href: '/zasklenia', label: 'Zasklenia' },
					{ href: '/sietka', label: 'Sieťka' }
				] satisfies ({ href: RouteId; label: string } | typeof PEVNE)[])
	);

	// #392: SEKUNDÁRNA skupina „Nástroje" — vždy dropdown, menej výrazný font. Len pre
	// interných (b2b má tieto routy v B2B_FORBIDDEN_PREFIXES, rovnako ako predtým).
	const toolLinks = $derived(
		isInterny
			? ([
					// samostatný nárezový optimalizátor (#212) — kalkulačka bez Money odpisu
					{ href: '/optimalizator', label: 'Optimalizátor' },
					// plán rezov (#482) — univerzálny optimalizátor z CAD tabuľky, bez Money
					{ href: '/plan-rezov', label: 'Plán rezov' },
					// #376 stage 1: emoji preč z nav labelov. Žiadny E2E neasertuje presný text
					// s emoji (overené grepom pred úpravou #376), h1 na /zasklenia/nastavenia
					// (⚙ Vzorce — nastavenia rezov) je stránkový nadpis, nie nav.
					{ href: '/zasklenia/nastavenia', label: 'Vzorce' },
					{ href: '/odpisy', label: 'História' },
					// #282: interný prehľad zákazníckych dopytov z verejného konfigurátora
					{ href: '/dopyty-konfigurator', label: 'Dopyty' },
					{ href: '/problem', label: 'Problém' },
					// #496: objednávka skla podklad per zákazka (interný, Money-neutrálny)
					{ href: '/objednavka-skla', label: 'Objednávka skla' }
				] satisfies { href: RouteId; label: string }[])
			: []
	);

	// #392: tri natívne <details> dropdowny (Moduly-pri-zúžení / Nástroje / user menu) —
	// viď design komentár na #392 (Prístup 1: natívny <details>/<summary>, žiadna nová JS
	// závislosť). Zatváranie: (1) po SPA navigácii cez afterNavigate — root layout sa pri
	// route zmene NEremountuje, takže natívny `open` atribút by inak ostal nastavený aj
	// po kliku na odkaz vnútri dropdownu; (2) light-dismiss (klik mimo / Escape) — review
	// nález #392 🟡, natívny <details> sám osebe nezatvára ani jedno z toho.
	// #583: open stav vlastní NATÍVNY <details> (žiadny `bind:open`) — `bind:open` efekt pri
	// hydratácii prepísal `open` na `false`, takže menu otvorené klikom PRED hydratáciou (plný
	// POST → nový dokument, pomalé pripojenie) sa hneď zavrelo. Zatváranie ide cez element refs.
	let modulesEl = $state<HTMLDetailsElement>();
	let toolsEl = $state<HTMLDetailsElement>();
	let userEl = $state<HTMLDetailsElement>();
	// #592: vnorený dropdown „Pevné zasklenie" v plochej lište (rovnaký vzor, žiadny bind:open)
	let pevneEl = $state<HTMLDetailsElement>();

	// zavrie všetky dropdowny OKREM toho, ktorý obsahuje `okrem` (cieľ kliku) — #592
	function zavriMenu(okrem: Node | null = null) {
		for (const el of [modulesEl, toolsEl, userEl, pevneEl])
			if (el && !(okrem && el.contains(okrem))) el.open = false;
	}

	// aktívny člen lišty — odkaz presnou zhodou, skupina „Pevné zasklenie" celou vetvou /fix*, /clip*
	function jeAktivny(l: (typeof moduleLinks)[number] | (typeof toolLinks)[number]): boolean {
		return 'href' in l
			? page.url.pathname === resolve(l.href)
			: jePevneZasklenie(page.url.pathname);
	}

	afterNavigate(({ type }) => {
		// 'enter' = prvá hydratácia, nie navigácia — menu otvorené pred ňou nechaj otvorené (#583)
		if (type !== 'enter') zavriMenu();
	});
</script>

<!-- vMenu = vykresľuje sa VNÚTRI dropdown menu (Moduly pod 900px / Nástroje): skupina
     „Pevné zasklenie" je tam podsekcia s nadpisom, nie ďalší vnorený <details> (#592) -->
{#snippet navLinks(list: typeof moduleLinks | typeof toolLinks, vMenu: boolean)}
	{#each list as l ('href' in l ? l.href : l.skupina)}
		{#if 'href' in l}
			<a href={resolve(l.href)} class:active={jeAktivny(l)}>{l.label}</a>
		{:else if vMenu}
			<div class="nav-subgroup" role="group" aria-label={PEVNE_ZASKLENIE_LABEL}>
				<span class="nav-subgroup-title" data-testid="modules-pevne-nadpis"
					>{PEVNE_ZASKLENIE_LABEL}</span
				>
				{@render pevneLinks()}
			</div>
		{:else}
			<details class="nav-dropdown nav-pevne" class:active={jeAktivny(l)} bind:this={pevneEl}>
				<summary data-testid="pevne-menu-toggle"
					>{PEVNE_ZASKLENIE_LABEL} <span aria-hidden="true">▾</span></summary
				>
				<div class="nav-dropdown-menu">
					{@render pevneLinks()}
				</div>
			</details>
		{/if}
	{/each}
{/snippet}

{#snippet pevneLinks()}
	{#each PEVNE_ZASKLENIE_LINKS as p (p.href)}
		<a href={resolve(p.href)} class:active={page.url.pathname === resolve(p.href)}>{p.label}</a>
	{/each}
{/snippet}

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<!-- #392 review nález 🟡: light-dismiss pre nav dropdowny — natívny <details> sám
     osebe nezatvára pri kliku mimo ani na Escape. Zatvor každý dropdown, ktorý klik
     NEOBSAHUJE: klik mimo zavrie všetky, klik do jedného (napr. na jeho summary — natívny
     toggle sa postará sám) zavrie jeho súrodencov, aby sa dve menu neprekrývali (#592). -->
<svelte:window
	onclick={(e) => zavriMenu(e.target instanceof Node ? e.target : null)}
	onkeydown={(e) => {
		if (e.key === 'Escape') zavriMenu();
	}}
	onwheel={odfokusujCisloInputPriWheeli}
/>

{#if data.user && !jeKonfig}
	<nav class="top">
		<div class="inner">
			<a href={resolve('/zasklenia')} class="brand">MONTALU</a>

			<!-- primárna skupina „Moduly" — plochá na desktope; pod 900px ju nahradí
			     dropdown nižšie (rovnaké moduleLinks pole, CSS display toggle — #392) -->
			<div class="nav-group nav-modules-flat">
				{@render navLinks(moduleLinks, false)}
			</div>
			<details
				class="nav-dropdown nav-modules-drop"
				class:active={moduleLinks.some(jeAktivny)}
				bind:this={modulesEl}
			>
				<summary data-testid="modules-menu-toggle">Moduly <span aria-hidden="true">▾</span></summary
				>
				<div class="nav-dropdown-menu">
					{@render navLinks(moduleLinks, true)}
				</div>
			</details>

			{#if toolLinks.length}
				<details
					class="nav-dropdown nav-tools"
					class:active={toolLinks.some(jeAktivny)}
					bind:this={toolsEl}
				>
					<summary data-testid="tools-menu-toggle"
						>Nástroje <span aria-hidden="true">▾</span></summary
					>
					<div class="nav-dropdown-menu">
						{@render navLinks(toolLinks, true)}
					</div>
				</details>
			{/if}

			<span class="spacer"></span>

			{#if !data.live}
				<span class="badge test" data-testid="mode">🧪 TEST režim</span>
			{:else}
				<span class="badge live" data-testid="mode">● LIVE</span>
			{/if}

			<!-- #392: Používatelia + Odhlásiť zoskupené do user menu -->
			<details
				class="nav-dropdown nav-user"
				class:active={isInterny && page.url.pathname === resolve('/pouzivatelia')}
				bind:this={userEl}
			>
				<summary data-testid="user-menu-toggle"
					>{data.user.username} <span aria-hidden="true">▾</span></summary
				>
				<div class="nav-dropdown-menu nav-dropdown-menu-right">
					{#if isInterny}
						<a
							href={resolve('/pouzivatelia')}
							class:active={page.url.pathname === resolve('/pouzivatelia')}>Používatelia</a
						>
					{/if}
					<form method="POST" action="/logout">
						<button type="submit">Odhlásiť</button>
					</form>
				</div>
			</details>
		</div>
	</nav>
{/if}

{#if page.url.pathname === '/login'}
	<!-- login je full-bleed (vlastný split layout) — bez .wrap -->
	{@render children()}
	<footer class="app login-footer">
		<span class="mono" data-testid="version">v{data.version}</span>
	</footer>
{:else if jeKonfig}
	<!-- #327 /konfigurator: full-bleed prémiový showroom — vlastný minimal chrome +
	     pätička s verziou (data-testid="version") žijú v konfigurator/+layout.svelte -->
	{@render children()}
{:else}
	<div class="wrap">
		{@render children()}
	</div>
	<footer class="app">
		Montalu automatizácie · <span class="mono" data-testid="version">v{data.version}</span>
	</footer>
{/if}

<style>
	.login-footer {
		position: fixed;
		bottom: 10px;
		right: 16px;
		padding: 0;
		color: var(--m-muted);
		z-index: 5;
	}
</style>
