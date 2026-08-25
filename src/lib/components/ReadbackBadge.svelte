<script lang="ts">
	// #298 POST-import readback badge — JEDNA logika verdiktov zdieľaná medzi
	// /odpisy (história) a /odpisy/zakazka/[zak] (#154). Extrahované pri #154
	// review (divergentná kópia na zákazkovej stránke zlúčila „viac" a „len"
	// vetvu do zavádzajúceho title) — nikdy nekopíruj tieto vetvy inline.
	import type { ReadbackVysledok } from '$lib/server/money-readback';

	let { readback, testid }: { readback: ReadbackVysledok | null; testid: string } = $props();
</script>

{#if readback}
	{#if readback.stav === 'ok'}
		<span
			class="badge ok"
			data-testid={testid}
			title={`Money doklad ${readback.dlv} · ${readback.moneyPocet} pol. — sedí.`}>✅ overené</span
		>
	{:else if readback.stav === 'nesulad' && readback.dovod === 'chyba-doklad'}
		<span
			class="badge alarm"
			data-testid={testid}
			title="Money doklad k tomuto odpisu NEEXISTUJE — import ho pravdepodobne ticho zahodil (napr. neznámy kód). Skontroluj v Money a v prípade potreby pošli znova."
			>⛔ Money doklad chýba</span
		>
	{:else if readback.stav === 'nesulad' && (readback.moneyPocet ?? 0) > readback.riadkov}
		<span
			class="badge alarm"
			data-testid={testid}
			title={`Money doklad ${readback.dlv} má ${readback.moneyPocet} položiek, odoslali sme ${readback.riadkov} — VIAC než odoslané, skontroluj doklad (možno zlúčený/cudzí).`}
			>⛔ {readback.moneyPocet}/{readback.riadkov} pol. (viac)</span
		>
	{:else if readback.stav === 'nesulad'}
		<span
			class="badge alarm"
			data-testid={testid}
			title={`Money odpísal len ${readback.moneyPocet} z ${readback.riadkov} riadkov (doklad ${readback.dlv}) — niektorý riadok import preskočil.`}
			>⛔ len {readback.moneyPocet}/{readback.riadkov} pol.</span
		>
	{:else}
		<span
			class="badge wait"
			data-testid={testid}
			title="Zatiaľ neoverené voči Money DB (readback snapshot ešte nedobehol alebo je starší než odpis)."
			>⏳ neoverené</span
		>
	{/if}
{/if}
