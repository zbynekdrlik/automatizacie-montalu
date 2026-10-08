<script lang="ts">
	// #587 (Odoo úloha 1185, att 39228): karta „Sklo (mm)" nárezáku ukáže, koľko tabúľ má zámkový
	// otvor ⌀46 a koľko nie — z TOHO ISTÉHO pravidla ako riadky objednávky skla (`sklo-otvory.ts`).
	// Systém bez otvorov (Robust/Slide/Štandard) → nič. Tlačí sa s kartou (žiadny `.noprint`).
	// #603: otváranie je POVINNÉ — pri opone majú otvor aj stredové sklá (rovnako ako výkres).
	import { rozpisOtvorovSkla } from '$lib/sklo-otvory';

	let {
		system,
		pocet,
		otvaranie,
		testid
	}: { system: string; pocet: number; otvaranie: string; testid: string } = $props();
	let text = $derived(rozpisOtvorovSkla(system, pocet, otvaranie));
</script>

{#if text}
	<div class="otvory-rozpis" data-testid={testid}>{text}</div>
{/if}

<style>
	.otvory-rozpis {
		font-size: 12px;
		color: var(--m-muted-ink);
		margin-top: 2px;
	}
</style>
