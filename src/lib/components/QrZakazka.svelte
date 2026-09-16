<script lang="ts">
	// #528: QR zákazky pre HLAVIČKU tlačených výstupov appky (nárezák zasklení, pergola nárez/výkres,
	// interný podklad objednávky skla). Payload = holé `sale.order.name` (= qrZakazkaPayload(op) =
	// normOp(op)) — po naskenovaní kamerou tabletu na Odoo kiosku sa otvorí daná objednávka/zákazka.
	// Renderuje sa LEN keď je OP zadané (bez OP nič → výstup nezmenený). Malý zdieľaný komponent, aby
	// near-cap route súbory (zasklenia/+page.svelte) nerástli o QR logiku.
	import { renderQrSvg, qrZakazkaPayload, QR_ZAKAZKA_TESTID } from '$lib/qr-zakazka';

	let {
		op = undefined,
		payload = undefined,
		sizeMm = 24
	}: { op?: string | null; payload?: string; sizeMm?: number } = $props();

	const value = $derived(payload ?? qrZakazkaPayload(op));
	const svg = $derived(value ? renderQrSvg(value) : '');
</script>

{#if svg}
	<span
		class="qr-zakazka"
		data-testid={QR_ZAKAZKA_TESTID}
		data-payload={value}
		title="Zákazka {value} — naskenuj tabletom (otvorí objednávku v Odoo)"
		style="width:{sizeMm}mm;height:{sizeMm}mm;"
	>
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- QR SVG je náš deterministický výstup, nie user input -->
		{@html svg}
	</span>
{/if}

<style>
	.qr-zakazka {
		float: right;
		display: block;
		background: #fff;
		line-height: 0;
		margin: 0 0 4px 8px;
	}
	.qr-zakazka :global(svg) {
		display: block;
		width: 100%;
		height: 100%;
	}
</style>
