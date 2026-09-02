<script lang="ts">
	// #245: bezpečná chybová stránka namiesto default SvelteKit 500. Pri neočakávanej
	// serverovej chybe (handleError) nesie `page.error.errorId` — používateľ ho nahlási
	// a my ho nájdeme v logu. Očakávané chyby (404 …) errorId nemajú, len správu.
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
</script>

<div class="err">
	<h1>{page.status} — niečo sa pokazilo</h1>
	<p class="msg" data-testid="error-message">
		{page.error?.message ?? 'Nastala neočakávaná chyba.'}
	</p>

	{#if page.error?.errorId}
		<p class="eid">
			Kód chyby: <code data-testid="error-id">{page.error.errorId}</code>
		</p>
		<p class="hint">Nahláste prosím tento kód — pomôže nám chybu rýchlo dohľadať.</p>
	{/if}

	<p><a class="back" href={resolve('/')}>← Späť na začiatok</a></p>
</div>

<style>
	.err {
		max-width: 560px;
		margin: 48px auto;
		text-align: center;
	}
	h1 {
		font-size: 20px;
		margin: 0 0 12px;
	}
	.msg {
		color: #334155;
		margin: 0 0 20px;
	}
	.eid {
		margin: 0 0 4px;
	}
	.eid code {
		font-size: 15px;
		background: #f1f5f9;
		padding: 2px 8px;
		border-radius: 6px;
	}
	.hint {
		color: #64748b;
		font-size: 13px;
		margin: 0 0 20px;
	}
	.back {
		color: var(--m-accent-ink);
		text-decoration: none;
	}
</style>
