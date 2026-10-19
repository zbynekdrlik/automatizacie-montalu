<script lang="ts">
	// #613 (druhá časť) — história účtov na `/pouzivatelia`: posledné udalosti z `user_audit`
	// (vytvorenie, zmena roly, zmazanie, seed, zmena hesla administrátorom). Dáta pripraví server
	// (`historiaUctov`, čas už v Europe/Bratislava, popis akcie po slovensky) — komponent len
	// vykresľuje. Vzor karty „História zmien" editora vzorcov. Riadok = jeden textový výraz, aby
	// Svelte neprehltol medzery okolo oddeľovačov (testing.md).
	// Filter na účet je obyčajný GET formulár (`?historia=<meno>`, funguje aj bez JS): na PROD okno
	// posledných udalostí zaplnia throwaway účty post-deploy E2E, konkrétny účet sa hľadá filtrom.
	import { resolve } from '$app/paths';
	import type { UdalostUctu } from '$lib/server/ucty-historia';

	let {
		historia,
		filter = null,
		ucty = [],
		limit = null,
		ucetMax = 200
	}: {
		historia: UdalostUctu[];
		filter?: string | null;
		ucty?: string[];
		/** koľko udalostí server najviac vráti (`HISTORIA_UCTOV_LIMIT`) — plný zoznam = staršie sú za ním */
		limit?: number | null;
		/** `maxlength` poľa účtu (`MAX_USERNAME_LEN` z load — server ho aj tak skráti) */
		ucetMax?: number;
	} = $props();

	// plný NEfiltrovaný zoznam: povedz, že staršie udalosti sú za limitom a nájdu sa filtrom
	const orezany = $derived(!filter && limit !== null && historia.length >= limit);
</script>

<div class="card" data-testid="pouzivatelia-historia">
	<div class="sec">História účtov</div>
	<form
		method="GET"
		action={resolve('/pouzivatelia')}
		class="historia-filter"
		data-testid="historia-filter"
	>
		<label for="historia-ucet">Účet</label>
		<input
			id="historia-ucet"
			name="historia"
			list="historia-ucty"
			value={filter ?? ''}
			maxlength={ucetMax}
			placeholder="všetky účty"
			autocomplete="off"
		/>
		<datalist id="historia-ucty">
			{#each ucty as u (u)}
				<option value={u}></option>
			{/each}
		</datalist>
		<button class="btn sm secondary" type="submit">Zobraziť</button>
		{#if filter}
			<a href={resolve('/pouzivatelia')} data-testid="historia-vsetky">Všetky účty</a>
		{/if}
	</form>
	{#if historia.length === 0}
		<p class="sub">
			{filter ? `Pre účet „${filter}" zatiaľ žiadne udalosti.` : 'Zatiaľ žiadne udalosti.'}
		</p>
	{:else}
		<p class="sub">
			{filter ? `Účet „${filter}" — ` : ''}Najnovšie hore{orezany
				? `; zobrazuje sa najviac ${limit} — staršie nájdeš filtrom na účet`
				: ''}. Heslá sa nikdy nezapisujú.
		</p>
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
	.historia-filter {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 8px;
		margin: 4px 0 8px;
		font-size: 13px;
	}
	.historia-filter label {
		margin: 0;
	}
	.historia-filter input {
		width: auto;
		min-width: 180px;
		padding: 4px 8px;
		font-size: 13px;
	}
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
