<script lang="ts">
	// Polia klina pre JEDEN posuv (Patrik 2026-07-27): zapínač + 4 kóty + počet ks.
	// Rovnaký blok používa primárny posuv (posiela sa aj ako plochý formulár, preto
	// `names`) aj každý ďalší posuv zimnej záhrady (ten ide len cez JSON `posuvy`).
	import { KLIN_MAX_KS, KLIN_MAX_ROZMER } from '$lib/klin';

	let {
		idPrefix = 'klin',
		names = false,
		on = $bindable(false),
		dlzka = $bindable(''),
		sirka = $bindable(''),
		v1 = $bindable(''),
		v2 = $bindable(''),
		ks = $bindable(1)
	}: {
		/** predpona id-čiek (unikátna per posuv) */
		idPrefix?: string;
		/** true = polia sa posielajú aj ako name= (plochý formulár primárneho posuvu) */
		names?: boolean;
		on?: boolean;
		dlzka?: number | string;
		sirka?: number | string;
		v1?: number | string;
		v2?: number | string;
		ks?: number | string;
	} = $props();

	const nm = (k: string) => (names ? k : undefined);
	// Patrik 2026-07-27: „nechcem to úplne hronit, že automaticky šírka klinu podľa
	// koľajnice, lebo nie vždy to je pravidlo… tiež nie je pravidlo, že dĺžka klinu
	// musí byť na celú dĺžku posuvu" → NIČ sa neodvodzuje z posuvu ani z koľajnice,
	// všetky štyri kóty zadáva dielňa ručne (polia sú `required`). Predvyplní sa len
	// počet kusov, ktorý je takmer vždy 1.
	function zapnute() {
		if (on && !ks) ks = 1;
	}
</script>

<div class="field">
	<label style="display:flex;align-items:center;gap:8px;font-weight:400">
		<input
			type="checkbox"
			id={`${idPrefix}-on`}
			name={nm('klin')}
			value="1"
			bind:checked={on}
			onchange={zapnute}
			style="width:auto"
		/>
		📐 Klín (nad posuvom) — len na plán a do náhľadu, do Money odpisu nejde
	</label>
</div>
{#if on}
	<div class="klin-box" data-testid={`${idPrefix}-box`}>
		<p class="klin-hint" data-testid={`${idPrefix}-hint`}>
			Zadaj skutočné rozmery klina — <b>nemusí</b> byť po celej dĺžke posuvu ani mať šírku podľa
			koľajnice.
		</p>
		<div class="grid2">
			<div class="field">
				<label for={`${idPrefix}-dlzka`}>Klín — dĺžka (mm) *</label>
				<input
					id={`${idPrefix}-dlzka`}
					name={nm('klinDlzka')}
					type="number"
					min="1"
					max={KLIN_MAX_ROZMER}
					step="any"
					bind:value={dlzka}
					required
				/>
			</div>
			<div class="field">
				<label for={`${idPrefix}-sirka`}>Klín — šírka / hĺbka (mm) *</label>
				<input
					id={`${idPrefix}-sirka`}
					name={nm('klinSirka')}
					type="number"
					min="1"
					max={KLIN_MAX_ROZMER}
					step="any"
					bind:value={sirka}
					required
				/>
			</div>
		</div>
		<div class="grid3">
			<div class="field">
				<label for={`${idPrefix}-v1`}>Klín — výška 1 (mm) *</label>
				<input
					id={`${idPrefix}-v1`}
					name={nm('klinV1')}
					type="number"
					min="0"
					max={KLIN_MAX_ROZMER}
					step="any"
					bind:value={v1}
					required
				/>
			</div>
			<div class="field">
				<label for={`${idPrefix}-v2`}>Klín — výška 2 (mm) *</label>
				<input
					id={`${idPrefix}-v2`}
					name={nm('klinV2')}
					type="number"
					min="0"
					max={KLIN_MAX_ROZMER}
					step="any"
					bind:value={v2}
					required
				/>
			</div>
			<div class="field">
				<label for={`${idPrefix}-ks`}>Klín — počet (ks)</label>
				<input
					id={`${idPrefix}-ks`}
					name={nm('klinKs')}
					type="number"
					min="1"
					max={KLIN_MAX_KS}
					step="1"
					bind:value={ks}
				/>
			</div>
		</div>
	</div>
{/if}

<style>
	.klin-hint {
		margin: 0 0 8px;
		font-size: 12px;
		color: #92400e;
	}
	.klin-box {
		border: 1px solid #fcd34d;
		background: #fffbeb;
		border-radius: 10px;
		padding: 10px 12px 2px;
		margin-bottom: 12px;
	}
</style>
