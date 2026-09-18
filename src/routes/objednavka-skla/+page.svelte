<script lang="ts">
	import { enhance } from '$app/forms';

	let { form } = $props();
</script>

<svelte:head><title>Objednávka skla — Montalu</title></svelte:head>

<h1>Objednávka skla</h1>

<p>
	Nová objednávka len skla (servis — bez nárezáku/odpisu). Zadajte číslo zákazky a OP objednávky;
	otvorí sa podklad, kde pridáte jednotlivé sklá.
</p>

<form method="POST" use:enhance data-testid="nova-objednavka">
	<label>
		Zákazka (ZAK)
		<input type="text" name="zak" required placeholder="napr. ZAK260123" data-testid="nova-zak" />
	</label>

	<label>
		OP objednávky
		<input type="text" name="op" required placeholder="napr. OP260123" data-testid="nova-op" />
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
</style>
