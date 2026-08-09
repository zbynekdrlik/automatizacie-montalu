<script lang="ts">
	// Polia sieťky pre JEDEN posuv (#86–#90, KOREKCIA 2026-08-02): zapínač + úchyt.
	// Rozmer sa už NEZADÁVA — sieťka je ĎALŠIE krídlo toho istého posuvu s rovnakým
	// rozmerom ako ostatné (appka ho odvodí z už spočítaného skla), rovnaký princíp
	// ako predtým, len bez ručného vstupu. Rovnaký vzor ako KlinPolia.svelte — jeden
	// blok pre primárny posuv (posiela sa aj ako plochý formulár, preto `names`) aj
	// pre každý ďalší posuv zimnej záhrady (ten ide len cez JSON `posuvy`).
	//
	// #110 (2026-08-03): Štandard/Štandard + navyše ponúkajú VLASTNÝ výber SYSTÉMU
	// sieťky (Patrik: „vyberiem si či chcem sieťku plus štandard alebo starý") —
	// `system` prop hovorí, ktorý posuv (Robust/Slide nemajú výber vôbec), `sietkaSystem`
	// je zvolená hodnota — PRÁZDNY reťazec (nie undefined — jednoduchší typ na
	// $bindable) = rovnaký ako posuv (default); server (`sanitizeSietka`) prázdny
	// reťazec aj tak zahodí rovnako ako chýbajúcu hodnotu.
	import {
		SIETKA_UCHYTY,
		potrebuje3KKolajnicu,
		popis3KKolajnicaVymena,
		pridavnaKolajnicaHint,
		maSietkaSystemVyber,
		SIETKA_SYSTEM_ALT
	} from '$lib/sietka';
	import type { SietkaUchyt } from '$lib/sietka';

	let {
		idPrefix = 'sietka',
		names = false,
		system = '',
		styl = '',
		strana = null,
		pridavna = false,
		on = $bindable(false),
		uchyt = $bindable('ziadny' as SietkaUchyt),
		sietkaSystem = $bindable(''),
		onZmena
	}: {
		/** predpona id-čiek (unikátna per posuv) */
		idPrefix?: string;
		/** true = polia sa posielajú aj ako name= (plochý formulár primárneho posuvu) */
		names?: boolean;
		/** systém POSUVU — určuje, či sa ponúkne výber systému sieťky (#110) */
		system?: string;
		/** štýl posuvu (2K/3K/…) — určuje, či treba upozornenie na 3K koľajnicu (#87) */
		styl?: string;
		/** strana, na ktorej sieťka beží — podľa smeru posuvu (null = neurčené) */
		strana?: 'ľavá' | 'pravá' | null;
		/** #123: hodnota order-level checkboxu „Prídavná koľajnica" (platí pre celú
		 *  objednávku, rovnaký vstup ako posiela server do `railUpsize`) — potrebné
		 *  len na to, aby táto sieťka vedela povedať, či na 2K „Štandard +" už nič
		 *  navyše nepridá (`pridavnaJeVSietke`). Nemení, čo checkbox ROBÍ. */
		pridavna?: boolean;
		on?: boolean;
		uchyt?: SietkaUchyt;
		/** zvolený systém sieťky (#110) — prázdny reťazec = rovnaký ako posuv */
		sietkaSystem?: string;
		/** #88: pri zapnutí sieťky kľučka/FAB tohto posuvu zmizne — rodič si tak vie
		 *  vynulovať svoje kovanieL/kovanieP polia (sieťka ich nahrádza úchytom) */
		onZmena?: (on: boolean) => void;
	} = $props();

	const nm = (k: string) => (names ? k : undefined);
	let maVyber = $derived(maSietkaSystemVyber(system));
	let altSystem = $derived(SIETKA_SYSTEM_ALT[system] ?? '');
</script>

<div class="field">
	<label style="display:flex;align-items:center;gap:8px;font-weight:400">
		<input
			type="checkbox"
			id={`${idPrefix}-on`}
			name={nm('sietka')}
			value="1"
			bind:checked={on}
			onchange={() => onZmena?.(on)}
			style="width:auto"
		/>
		🦟 So sieťkou (na poslednej koľaji) — pridá rám a nos podľa potvrdeného rozpisu, ide do Money odpisu
	</label>
</div>
{#if on}
	<div class="sietka-box" data-testid={`${idPrefix}-box`}>
		{#if strana}
			<p class="sietka-hint" data-testid={`${idPrefix}-strana`}>
				Sieťka pôjde na <b>{strana}</b> stranu (podľa smeru posuvu).
			</p>
		{/if}
		{#if potrebuje3KKolajnicu(styl)}
			<p class="sietka-warn" data-testid={`${idPrefix}-2k-warn`}>
				⚠ Sieťka na 2K koľajnicu nemôže ísť — appka automaticky odpíše {popis3KKolajnicaVymena(
					system
				)}.
			</p>
		{/if}
		{#if pridavnaKolajnicaHint(system, styl, on, pridavna)}
			<p class="sietka-hint" data-testid={`${idPrefix}-pridavna-v-sietke`}>
				ℹ {pridavnaKolajnicaHint(system, styl, on, pridavna)}
			</p>
		{/if}
		{#if maVyber}
			<div class="field">
				<label for={`${idPrefix}-system`}>Systém sieťky</label>
				<select
					id={`${idPrefix}-system`}
					name={nm('sietkaSystem')}
					value={sietkaSystem || system}
					onchange={(e) => {
						const v = e.currentTarget.value;
						sietkaSystem = v === system ? '' : v;
					}}
				>
					<option value={system}>{system} (rovnaký ako posuv)</option>
					<option value={altSystem}>{altSystem}</option>
				</select>
			</div>
		{/if}
		<div class="field">
			<label for={`${idPrefix}-uchyt`}>Úchyt (sieťka nemá kľučku)</label>
			<select id={`${idPrefix}-uchyt`} name={nm('sietkaUchyt')} bind:value={uchyt}>
				{#each SIETKA_UCHYTY as u (u.value)}<option value={u.value}>{u.label}</option>{/each}
			</select>
		</div>
	</div>
{/if}

<style>
	.sietka-hint {
		margin: 0 0 8px;
		font-size: 12px;
		color: #0369a1;
	}
	.sietka-warn {
		margin: 0 0 8px;
		font-size: 12px;
		font-weight: 600;
		color: #92400e;
	}
	.sietka-box {
		border: 1px solid #7dd3fc;
		background: #f0f9ff;
		border-radius: 10px;
		padding: 10px 12px 2px;
		margin-bottom: 12px;
	}
</style>
