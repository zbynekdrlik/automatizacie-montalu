<script lang="ts">
	import { enhance } from '$app/forms';

	let { form } = $props();
</script>

<svelte:head><title>Objednávka skla — Montalu</title></svelte:head>

<h1>Objednávka skla</h1>

<!-- #577: OP nepovinné — stránka otvorí existujúci podklad zákazky alebo založí nový -->
<p>
	Zadajte číslo zákazky — otvorí sa objednávka skla tejto zákazky (alebo sa založí nová), kde
	pridáte jednotlivé sklá. OP objednávky stačí vyplniť pri servisnej objednávke bez nárezáku;
	zákazka s nárezákom ho má z odpisu.
</p>

<form method="POST" use:enhance data-testid="nova-objednavka">
	<label>
		Zákazka (ZAK)
		<input type="text" name="zak" required placeholder="napr. ZAK260123" data-testid="nova-zak" />
	</label>

	<label>
		OP objednávky <span class="nepovinne">(nepovinné)</span>
		<input type="text" name="op" placeholder="napr. OP260123" data-testid="nova-op" />
	</label>

	{#if form?.error}
		<p class="err" data-testid="nova-chyba">{form.error}</p>
	{/if}

	<button type="submit" class="btn" data-testid="nova-otvorit">Otvoriť podklad</button>
</form>

<style>
	form {
		max-width: 400px;
	}
	label {
		display: block;
		margin-bottom: 8px;
	}
	input {
		margin-top: 4px;
	}
	.btn {
		margin-top: 12px;
	}
	.nepovinne {
		color: var(--m-muted);
		font-size: 0.9em;
	}
</style>
