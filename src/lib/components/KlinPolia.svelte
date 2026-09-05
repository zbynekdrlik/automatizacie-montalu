<script lang="ts">
	// Klíny nad JEDNÝM posuvom (Patrik 2026-07-27, MULTI #472): zapínač + 1..N riadkov,
	// každý so 4 kótami + počtom ks. Rovnaký blok používa primárny posuv (posiela sa aj
	// ako plochý formulár, preto `names` — JEDEN hidden JSON pole `kliny`) aj každý ďalší
	// posuv zimnej záhrady (ten ide len cez JSON `posuvy`, `kliny` je tam už samotné pole,
	// bez ďalšieho JSON-vrstvenia — viď `zasklenia-form.ts`'s `PosuvRow.kliny`).
	//
	// Prvý riadok (index 0) drží PÔVODNÉ id-čka bez suffixu (`${idPrefix}-dlzka`, …) —
	// spätná kompatibilita s existujúcimi e2e testami napísanými pred #472. Ďalšie
	// riadky (index ≥1) dostanú `${idPrefix}-dlzka-${i}`, …
	import { KLIN_MAX_KS, KLIN_MAX_POCET, KLIN_MAX_ROZMER, type KlinVstup } from '$lib/klin';

	let {
		idPrefix = 'klin',
		names = false,
		kliny = $bindable<KlinVstup[]>([])
	}: {
		/** predpona id-čiek (unikátna per posuv) */
		idPrefix?: string;
		/** true = appka pošle aj skryté `name="kliny"` pole (plochý formulár primárneho posuvu) */
		names?: boolean;
		kliny?: KlinVstup[];
	} = $props();

	const nm = (k: string) => (names ? k : undefined);

	/** prázdny riadok klina — obsluha vyplní všetky 4 kóty ručne (žiadny smart default,
	 *  Patrik: „nechcem to úplne hronit"), predvyplní sa len počet kusov 1 */
	function prazdnyKlin(): KlinVstup {
		return { dlzka: '', sirka: '', v1: '', v2: '', ks: 1 };
	}

	function zapnut() {
		kliny = [prazdnyKlin()];
	}
	function vypnut() {
		kliny = [];
	}
	function pridajRiadok() {
		if (kliny.length >= KLIN_MAX_POCET) return;
		kliny = [...kliny, prazdnyKlin()];
	}
	function odoberRiadok(i: number) {
		kliny = kliny.filter((_, j) => j !== i);
	}
	/** id-čko konkrétneho riadku — riadok 0 ostáva BEZ suffixu (spätná kompatibilita) */
	const idFor = (field: string, i: number) =>
		i === 0 ? `${idPrefix}-${field}` : `${idPrefix}-${field}-${i}`;
</script>

<div class="field">
	<label class="opt">
		<input
			type="checkbox"
			id={`${idPrefix}-on`}
			name={nm('klin')}
			value="1"
			checked={kliny.length > 0}
			onchange={(e) => (e.currentTarget.checked ? zapnut() : vypnut())}
		/>
		Klín (nad posuvom) — len na plán a do náhľadu, do Money odpisu nejde
	</label>
</div>
{#if kliny.length > 0}
	<div class="klin-box" data-testid={`${idPrefix}-box`}>
		<p class="klin-hint" data-testid={`${idPrefix}-hint`}>
			Zadaj skutočné rozmery klina — <b>nemusí</b> byť po celej dĺžke posuvu ani mať šírku podľa koľajnice.
		</p>
		{#each kliny as k, i (i)}
			<div class="klin-riadok" data-testid={`${idPrefix}-riadok-${i}`}>
				{#if kliny.length > 1}<p class="klin-riadok-hd">Klín {i + 1}</p>{/if}
				<div class="grid2">
					<div class="field">
						<label for={idFor('dlzka', i)}>Klín — dĺžka (mm) *</label>
						<input
							id={idFor('dlzka', i)}
							type="number"
							min="1"
							max={KLIN_MAX_ROZMER}
							step="any"
							bind:value={k.dlzka}
							required
						/>
					</div>
					<div class="field">
						<label for={idFor('sirka', i)}>Klín — šírka / hĺbka (mm) *</label>
						<input
							id={idFor('sirka', i)}
							type="number"
							min="1"
							max={KLIN_MAX_ROZMER}
							step="any"
							bind:value={k.sirka}
							required
						/>
					</div>
				</div>
				<div class="grid3">
					<div class="field">
						<label for={idFor('v1', i)}>Klín — výška 1 (mm) *</label>
						<input
							id={idFor('v1', i)}
							type="number"
							min="0"
							max={KLIN_MAX_ROZMER}
							step="any"
							bind:value={k.v1}
							required
						/>
					</div>
					<div class="field">
						<label for={idFor('v2', i)}>Klín — výška 2 (mm) *</label>
						<input
							id={idFor('v2', i)}
							type="number"
							min="0"
							max={KLIN_MAX_ROZMER}
							step="any"
							bind:value={k.v2}
							required
						/>
					</div>
					<div class="field">
						<label for={idFor('ks', i)}>Klín — počet (ks)</label>
						<input
							id={idFor('ks', i)}
							type="number"
							min="1"
							max={KLIN_MAX_KS}
							step="1"
							bind:value={k.ks}
						/>
					</div>
				</div>
				{#if kliny.length > 1}
					<button type="button" class="klin-odober" onclick={() => odoberRiadok(i)}
						>✕ Odobrať tento klín</button
					>
				{/if}
			</div>
		{/each}
		{#if kliny.length < KLIN_MAX_POCET}
			<button type="button" class="klin-pridaj" onclick={pridajRiadok}>+ Pridať ďalší klín</button>
		{/if}
	</div>
	{#if names}
		<input type="hidden" name="kliny" value={JSON.stringify(kliny)} />
	{/if}
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
	.klin-riadok {
		border-top: 1px dashed #fcd34d;
		padding-top: 8px;
		margin-top: 4px;
	}
	.klin-riadok:first-of-type {
		border-top: none;
		padding-top: 0;
		margin-top: 0;
	}
	.klin-riadok-hd {
		margin: 0 0 6px;
		font-weight: 600;
		font-size: 12px;
		color: #92400e;
	}
	.klin-odober {
		margin: 0 0 10px;
		font-size: 12px;
		background: none;
		border: 1px solid #fcd34d;
		border-radius: 6px;
		padding: 3px 8px;
		cursor: pointer;
		color: #92400e;
	}
	.klin-pridaj {
		margin: 0 0 10px;
		font-size: 12px;
		background: none;
		border: 1px dashed #b45309;
		border-radius: 6px;
		padding: 4px 10px;
		cursor: pointer;
		color: #92400e;
	}
</style>
