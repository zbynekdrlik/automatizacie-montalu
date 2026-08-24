<script lang="ts">
	// (#300) Zdieľaný blok pre `status:'blocked'` odpis (ledger-duplicate / unknown-kod) naprieč
	// modulmi. Zobrazí hlášku bloku + confirm-gated „⚠️ Odoslať aj tak", ktoré RE-submitne PRESNE
	// ten istý POST (`rawEntries` = pôvodné polia vrátane ručných úprav qty), doplní skryté
	// `override=<blokReason>` a pošle na pôvodnú akciu → server volá `writeOdpis` s override flagom.
	// Pure duplicate (dedup, `odpis_log` riadok existuje) sem NEIDE — tá ostáva dead-end na /odpisy.
	import { resolve } from '$app/paths';

	let {
		rawEntries,
		blokReason,
		blokAction,
		error
	}: {
		rawEntries: [string, string][];
		blokReason: 'unknown-kod' | 'ledger-duplicate';
		blokAction: string;
		error: string;
	} = $props();

	const potvrd = $derived(
		blokReason === 'unknown-kod'
			? 'Money niektorý z kódov nepozná — pri neznámom kóde by import NEODPÍSAL CELÝ doklad. ' +
					'Naozaj odoslať aj tak? (Použi len ak vieš, že kód je správny a Money ho už má.)'
			: 'Rovnaký obsah tejto zákazky už bol raz importovaný do Money. Odoslať znova AJ TAK? ' +
					'(Použi LEN ak si import v Money NAOZAJ zmazal — inak vznikne dvojitý zápis.)'
	);
</script>

<div class="card">
	<h1>⛔ Odpis zablokovaný</h1>
</div>

<div class="err" data-testid="blok">⚠️ {error}</div>

<div class="card noprint">
	<form
		method="POST"
		action={blokAction}
		onsubmit={(e) => {
			if (!confirm(potvrd)) e.preventDefault();
		}}
	>
		{#each rawEntries as [k, v], i (i)}
			{#if v.includes('\n')}
				<textarea name={k} hidden>{v}</textarea>
			{:else}
				<input type="hidden" name={k} value={v} />
			{/if}
		{/each}
		<input type="hidden" name="override" value={blokReason} />
		<button type="submit" class="btn danger" data-testid="odoslat-aj-tak">⚠️ Odoslať aj tak</button>
	</form>
	<button class="btn secondary" type="button" onclick={() => history.back()}
		>← Späť a upraviť</button
	>
	<a class="btn secondary" href={resolve('/odpisy')}>📋 História odpisov</a>
</div>
