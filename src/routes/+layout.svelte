<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';

	let { data, children } = $props();

	// marker pre E2E: hydratácia hotová — pred ním môže fill() na value-bound
	// inputoch prehrať s hydratáciou, ktorá ich vráti na serverový stav
	$effect(() => {
		document.documentElement.dataset.hydrated = '1';
	});

	// B2B vidí LEN Zasklenia — zvyšné odkazy (vrátane Vzorce/Nastavenia, ktoré sú
	// mimo /zasklenia) sú interné. Používatelia je nový odkaz len pre interných.
	const links = $derived(
		data.user?.role === 'b2b'
			? [{ href: '/zasklenia', label: 'Zasklenia' }]
			: [
					{ href: '/pergola', label: 'Pergola' },
					{ href: '/fix', label: 'Šikmý FIX' },
					{ href: '/bazen', label: 'Bazén' },
					{ href: '/zasklenia', label: 'Zasklenia' },
					{ href: '/zasklenia/nastavenia', label: '⚙ Vzorce' },
					{ href: '/odpisy', label: 'História' },
					{ href: '/problem', label: '⚠ Problém' },
					{ href: '/pouzivatelia', label: 'Používatelia' }
				]
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
				<a href={l.href} class:active={page.url.pathname === l.href}>{l.label}</a>
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
