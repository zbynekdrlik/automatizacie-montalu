<script lang="ts">
	// Polia sieťky pre JEDEN posuv (#86–#90, KOREKCIA 2026-08-02): zapínač + úchyt.
	// Rozmer sa už NEZADÁVA — sieťka je ĎALŠIE krídlo toho istého posuvu s rovnakým
	// rozmerom ako ostatné (appka ho odvodí z už spočítaného skla), rovnaký princíp
	// ako predtým, len bez ručného vstupu. Rovnaký vzor ako KlinPolia.svelte — jeden
	// blok pre primárny posuv (posiela sa aj ako plochý formulár, preto `names`) aj
	// pre každý ďalší posuv zimnej záhrady (ten ide len cez JSON `posuvy`).
	import { SIETKA_UCHYTY, potrebuje3KKolajnicu } from '$lib/sietka';
	import type { SietkaUchyt } from '$lib/sietka';

	let {
		idPrefix = 'sietka',
		names = false,
		styl = '',
		strana = null,
		on = $bindable(false),
		uchyt = $bindable('ziadny' as SietkaUchyt),
		onZmena
	}: {
		/** predpona id-čiek (unikátna per posuv) */
		idPrefix?: string;
		/** true = polia sa posielajú aj ako name= (plochý formulár primárneho posuvu) */
		names?: boolean;
		/** štýl posuvu (2K/3K/…) — určuje, či treba upozornenie na 3K koľajnicu (#87) */
		styl?: string;
		/** strana, na ktorej sieťka beží — podľa smeru posuvu (null = neurčené) */
		strana?: 'ľavá' | 'pravá' | null;
		on?: boolean;
		uchyt?: SietkaUchyt;
		/** #88: pri zapnutí sieťky kľučka/FAB tohto posuvu zmizne — rodič si tak vie
		 *  vynulovať svoje kovanieL/kovanieP polia (sieťka ich nahrádza úchytom) */
		onZmena?: (on: boolean) => void;
	} = $props();

	const nm = (k: string) => (names ? k : undefined);
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
				⚠ Sieťka na 2K koľajnicu nemôže ísť — appka automaticky odpíše 3K koľajnicu (2 ks + 2 ks)
				namiesto 2K.
			</p>
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
