<script lang="ts">
	// #613 (druhá časť) — história účtov na `/pouzivatelia`: posledné udalosti z `user_audit`
	// (vytvorenie, zmena roly, zmazanie, seed, zmena hesla administrátorom). Dáta pripraví server
	// (`historiaUctov`, čas už v Europe/Bratislava, popis akcie po slovensky) — komponent len
	// vykresľuje. Vzor karty „História zmien" editora vzorcov. Riadok = jeden textový výraz, aby
	// Svelte neprehltol medzery okolo oddeľovačov (testing.md).
	import type { UdalostUctu } from '$lib/server/ucty-historia';

	let { historia }: { historia: UdalostUctu[] } = $props();
</script>

<div class="card" data-testid="pouzivatelia-historia">
	<div class="sec">História účtov</div>
	{#if historia.length === 0}
		<p class="sub">Zatiaľ žiadne udalosti.</p>
	{:else}
		<p class="sub">Posledných {historia.length} udalostí, najnovšie hore. Heslá sa nezapisujú.</p>
		<ul class="historia">
			{#each historia as h (h.id)}
				<li data-testid="historia-riadok">
					<b>{h.kedy}</b>{` · ${h.kto || '—'} · ${h.akcia} · ${h.ucet}`}{#if h.detail}<span
							class="detail">{` · ${h.detail}`}</span
						>{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.historia {
		list-style: none;
		margin: 0;
		padding: 0;
		font-size: 13px;
	}
	.historia li {
		padding: 4px 0;
		border-bottom: 1px solid var(--m-line);
	}
	.historia li:last-child {
		border-bottom: none;
	}
	.detail {
		color: var(--m-muted-ink);
	}
</style>
