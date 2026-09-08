<script lang="ts">
	import { enhance } from '$app/forms';

	let { form } = $props();
</script>

<svelte:head><title>Objednávka skla — Montalu</title></svelte:head>

<h1>Objednávka skla</h1>

<p>Zadajte číslo zákazky pre zobrazenie podkladu objednávky skla.</p>

<form method="POST" use:enhance>
	<label>
		Zákazka (ZAK)
		<input type="text" name="zak" required placeholder="napr. ZAK260123" />
	</label>

	{#if form?.error}
		<p class="err">{form.error}</p>
	{/if}

	<button type="submit" class="btn">Zobraziť</button>
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
