<script lang="ts">
	// (#300) Zdieľaný blok pre `status:'blocked'` odpis (ledger-duplicate / unknown-kod /
	// prehodene-polia #307 / uz-odpisane #608) naprieč modulmi. Zobrazí hlášku bloku + confirm-gated
	// tlačidlo, ktoré RE-submitne PRESNE
	// ten istý POST (`rawEntries` = pôvodné polia vrátane ručných úprav qty), doplní skryté
	// `override=<blokReason>` a pošle na pôvodnú akciu → server volá `writeOdpis` s override flagom.
	// (#608) `uz-odpisane` = zákazka/OP už má v module odpis → tlačidlo „Odoslať ako dorobenie";
	// `rawEntries` nesie aj token `potvrdenie_token` (stav append-only ledgeru, ktorý operátor práve
	// vidí — aj pri `ledger-duplicate`), takže refresh výsledku, dvojklik ani replay po „Uvoľniť"
	// nevyrobí ďalší doklad bez nového potvrdenia. Tvrdý duplicate (cross-modul identický obsah,
	// pergola rezervácia) sem NEIDE — ostáva dead-end „Duplikát" v module.
	import { resolve } from '$app/paths';

	let {
		rawEntries,
		blokReason,
		blokAction,
		error
	}: {
		rawEntries: [string, string][];
		blokReason: 'unknown-kod' | 'ledger-duplicate' | 'prehodene-polia' | 'uz-odpisane';
		blokAction: string;
		error: string;
	} = $props();

	const dorobenie = $derived(blokReason === 'uz-odpisane');

	const potvrd = $derived(
		blokReason === 'unknown-kod'
			? 'Money niektorý z kódov nepozná — pri neznámom kóde by import NEODPÍSAL CELÝ doklad. ' +
					'Naozaj odoslať aj tak? (Použi len ak vieš, že kód je správny a Money ho už má.)'
			: blokReason === 'prehodene-polia'
				? 'Číslo zákazky a číslo objednávky (OP) sú pravdepodobne prehodené. Naozaj odoslať aj tak? ' +
					'(Použi len ak vieš, že zadanie je správne.)'
				: blokReason === 'uz-odpisane'
					? 'Táto zákazka už bola odpísaná. Odoslať ju ako DOROBENIE — ďalší doklad do Money, prvý ' +
						'odpis ostane? (Použi LEN keď sa naozaj vyrába znova, napr. pri zlom zameraní — nie pri ' +
						'omylom zopakovanom odoslaní.)'
					: 'Rovnaký obsah tejto zákazky už bol raz importovaný do Money. Odoslať znova AJ TAK? ' +
						'(Použi LEN ak si import v Money NAOZAJ zmazal — inak vznikne dvojitý zápis.)'
	);

	// (#300 review 🟡) rawEntries už môže niesť DRUHÝ override z predošlého bloku — pridaj tento
	// `blokReason` len ak tam ešte nie je, aby sa pri dvojitom bloku (kód + ledger) prekonali OBA
	// naraz a nevznikol nekonečný ping-pong.
	const maBlokReason = $derived(rawEntries.some(([k, v]) => k === 'override' && v === blokReason));
</script>

<div class="card">
	<h1>{dorobenie ? '⚠️ Zákazka už bola odpísaná' : '⛔ Odpis zablokovaný'}</h1>
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
				<!-- HTML parser zhltne JEDEN vodiaci `\n` v textarea → keď hodnota začína newline,
				     predsadíme ďalší, aby sa obsah pri submitne zachoval 1:1 (#300 review 🔵) -->
				<textarea name={k} hidden>{(v.startsWith('\n') ? '\n' : '') + v}</textarea>
			{:else}
				<input type="hidden" name={k} value={v} />
			{/if}
		{/each}
		{#if !maBlokReason}
			<input type="hidden" name="override" value={blokReason} />
		{/if}
		{#if dorobenie}
			<button type="submit" class="btn danger" data-testid="odoslat-ako-dorobenie"
				>🔁 Odoslať ako dorobenie</button
			>
		{:else}
			<button type="submit" class="btn danger" data-testid="odoslat-aj-tak"
				>⚠️ Odoslať aj tak</button
			>
		{/if}
	</form>
	<button class="btn secondary" type="button" onclick={() => history.back()}
		>← Späť a upraviť</button
	>
	<a class="btn secondary" href={resolve('/odpisy')}>📋 História odpisov</a>
</div>
