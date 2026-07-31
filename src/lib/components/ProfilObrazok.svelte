<script lang="ts">
	// Rez profilu z Money katalógu. Malý náhľad v riadku; klik → zväčšenie.
	import { maObrazok, obrazokUrl } from '$lib/profil-obrazky';

	let {
		kod,
		nazov = '',
		velkost = 44
	}: { kod: string; nazov?: string; velkost?: number } = $props();

	let otvorene = $state(false);
	let dostupny = $derived(maObrazok(kod));
</script>

{#if dostupny}
	<button
		type="button"
		class="thumb"
		style="--v:{velkost}px"
		onclick={() => (otvorene = true)}
		title="Zväčšiť rez profilu {kod}"
		aria-label="Rez profilu {kod}"
	>
		<img src={obrazokUrl(kod)} alt="Rez profilu {kod}" loading="lazy" />
	</button>

	{#if otvorene}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="lightbox" onclick={() => (otvorene = false)}>
			<div class="lb-card" onclick={(e) => e.stopPropagation()}>
				<div class="lb-hd">
					<div>
						<b>{kod}</b>{#if nazov}<span> · {nazov}</span>{/if}
						<div class="lb-sub">Rez profilu (Money katalóg)</div>
					</div>
					<button type="button" class="lb-x" onclick={() => (otvorene = false)} aria-label="Zavrieť"
						>✕</button
					>
				</div>
				<img src={obrazokUrl(kod)} alt="Rez profilu {kod}" />
			</div>
		</div>
	{/if}
{/if}

<style>
	.thumb {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--v);
		height: var(--v);
		padding: 3px;
		background: #fff;
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		cursor: zoom-in;
		flex: 0 0 auto;
		transition:
			border-color 0.12s ease,
			box-shadow 0.12s ease;
	}
	.thumb:hover {
		border-color: #2563eb;
		box-shadow: 0 4px 12px -6px rgba(37, 99, 235, 0.5);
	}
	.thumb img {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
	}
	.lightbox {
		position: fixed;
		inset: 0;
		z-index: 100;
		background: rgba(15, 23, 42, 0.72);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
		animation: fade 0.15s ease;
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	.lb-card {
		background: #fff;
		border-radius: 16px;
		padding: 18px;
		max-width: min(560px, 92vw);
		max-height: 90vh;
		box-shadow: 0 24px 60px -20px rgba(0, 0, 0, 0.5);
		cursor: default;
	}
	.lb-hd {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 16px;
		margin-bottom: 12px;
	}
	.lb-hd b {
		font-size: 16px;
	}
	.lb-hd span {
		color: #475569;
	}
	.lb-sub {
		color: #94a3b8;
		font-size: 12.5px;
		margin-top: 2px;
	}
	.lb-x {
		background: #f1f5f9;
		border: 0;
		border-radius: 8px;
		width: 32px;
		height: 32px;
		font-size: 15px;
		cursor: pointer;
		color: #475569;
		flex: 0 0 auto;
	}
	.lb-x:hover {
		background: #e2e8f0;
	}
	.lb-card img {
		display: block;
		max-width: 100%;
		max-height: 72vh;
		margin: 0 auto;
		object-fit: contain;
	}
	@media print {
		.thumb {
			border: none;
		}
	}
</style>
