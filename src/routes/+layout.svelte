<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { RouteId } from '$app/types';

	let { data, children } = $props();

	// marker pre E2E: hydratácia hotová — pred ním môže fill() na value-bound
	// inputoch prehrať s hydratáciou, ktorá ich vráti na serverový stav
	$effect(() => {
		document.documentElement.dataset.hydrated = '1';
	});

	// B2B vidí Zasklenia + Sieťka + (od #144) display-only Pergola návrh + (od #162)
	// display-only Zasklenia návrh — zvyšné odkazy (vrátane Vzorce/Nastavenia, ktoré
	// sú mimo /zasklenia) sú interné. Používatelia je nový odkaz len pre interných.
	// href je typovaný ako RouteId (z $app/types) a šablóna nižšie ho vždy volá cez
	// resolve(l.href) — to spĺňa svelte/no-navigation-without-resolve (#99).
	//
	// Interné menu #162 review nález (deep review): /zasklenia/navrh NEDOSTÁVA
	// vlastný top-nav odkaz pre interných (rovnaká disciplína ako pergola — pozri
	// #144 komentár nižšie), lebo interní ju už dosiahnu jedným klikom z vnútra
	// /zasklenia (in-page odkaz „→ Návrhový výkres" pridaný v #162). B2B naopak MÁ
	// tento odkaz priamo v (krátkom, len 3-položkovom) menu — presne to isté
	// zdôvodnenie, aké #144 dalo pergole.
	const links = $derived(
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
					{ href: '/fix', label: 'Fixy' },
					{ href: '/bazen', label: 'Bazén' },
					{ href: '/zasklenia', label: 'Zasklenia' },
					{ href: '/sietka', label: 'Sieťka' },
					// samostatný nárezový optimalizátor (#212) — kalkulačka bez Money odpisu,
					// len pre interných (b2b má /optimalizator v B2B_FORBIDDEN_PREFIXES)
					{ href: '/optimalizator', label: 'Optimalizátor' },
					{ href: '/zasklenia/nastavenia', label: '⚙ Vzorce' },
					{ href: '/odpisy', label: 'História' },
					{ href: '/problem', label: '⚠ Problém' },
					{ href: '/pouzivatelia', label: 'Používatelia' }
				] satisfies { href: RouteId; label: string }[])
	);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if data.user}
	<nav class="top">
		<div class="inner">
			<span class="brand">MONTALU</span>
			{#each links as l (l.href)}
				<a href={resolve(l.href)} class:active={page.url.pathname === resolve(l.href)}>{l.label}</a>
			{/each}
			<span class="spacer"></span>
			{#if !data.live}
				<span class="badge test" data-testid="mode">🧪 TEST režim</span>
			{:else}
				<span class="badge live" data-testid="mode">● LIVE</span>
			{/if}
			<span class="user">{data.user.username}</span>
			<form method="POST" action="/logout" style="margin:0">
				<button
					type="submit"
					style="background:none;border:0;color:#94a3b8;cursor:pointer;font-size:12.5px;padding:0"
					>Odhlásiť</button
				>
			</form>
		</div>
	</nav>
{/if}

{#if page.url.pathname === '/login'}
	<!-- login je full-bleed (vlastný split layout) — bez .wrap -->
	{@render children()}
	<footer class="app login-footer">
		<span data-testid="version">v{data.version}</span>
	</footer>
{:else}
	<div class="wrap">
		{@render children()}
	</div>
	<footer class="app">
		Montalu automatizácie · <span data-testid="version">v{data.version}</span>
	</footer>
{/if}

<style>
	.login-footer {
		position: fixed;
		bottom: 10px;
		right: 16px;
		padding: 0;
		color: #94a3b8;
		z-index: 5;
	}
</style>
