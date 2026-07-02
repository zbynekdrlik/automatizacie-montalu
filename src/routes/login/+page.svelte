<script lang="ts">
	let { form } = $props();
</script>

<svelte:head><title>Prihlásenie — Montalu</title></svelte:head>

<div style="max-width:400px;margin:60px auto 0">
	<div class="card">
		<h1 style="margin-bottom:4px">Montalu automatizácie</h1>
		<p class="sub" style="margin-bottom:16px">Prihlás sa na pokračovanie</p>

		{#if form?.error}
			<div class="err" data-testid="login-error">{form.error}</div>
		{/if}

		<form method="POST">
			<div class="field">
				<label for="username">Meno</label>
				<input id="username" name="username" value={form?.username ?? ''} autocomplete="username" required />
			</div>
			<div class="field">
				<label for="password">Heslo</label>
				<input id="password" name="password" type="password" autocomplete="current-password" required />
			</div>
			<button class="btn" type="submit">Prihlásiť</button>
		</form>
	</div>
</div>
