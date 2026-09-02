<script lang="ts">
	// #5960: znovupoužiteľné „Uložiť ponuku" tlačidlo. Kalkulačka dodá už-vypočítaný `input`
	// (modul, cenové riadky — ceny počíta SERVER, nie tento komponent — zákazník/prílohy);
	// klik POST-ne na `/ulozit-ponuku` cez `saveQuoteRequest` a surface-ne číslo objednávky +
	// odkaz alebo bezpečnú Odoo hlášku. Per-modulové naplnenie `input` (Money predajné kódy +
	// predajné ceny) dodá go-live #5820 — tento komponent je pripravený seam.
	//
	// Tlačidlo je počas volania DISABLED (bráni dvojkliku); idempotencia je na Odoo strane
	// (rovnaké quote_id → `created:false`), takže re-klik po chybe/timeoute je BEZPEČNÝ.
	import { base, resolve } from '$app/paths';
	import { saveQuoteRequest, type SaveQuoteClientInput } from '$lib/ulozit-ponuku-client';

	let { input, label = 'Uložiť ponuku do Odoo' }: { input: SaveQuoteClientInput; label?: string } =
		$props();

	type Stav =
		| { k: 'idle' }
		| { k: 'saving' }
		| { k: 'ok'; created: boolean; name: string; url: string }
		| { k: 'chyba'; sprava: string; reLogin: boolean };
	let stav = $state<Stav>({ k: 'idle' });

	async function uloz() {
		if (stav.k === 'saving') return;
		stav = { k: 'saving' };
		const r = await saveQuoteRequest(input, { endpoint: `${base}/ulozit-ponuku` });
		if (r.ok) {
			stav = { k: 'ok', created: r.created, name: r.name, url: r.url };
		} else {
			stav = { k: 'chyba', sprava: r.error, reLogin: r.code === 'auth' };
		}
	}
</script>

<div class="ulozit-ponuku">
	<button
		class="btn"
		type="button"
		data-testid="ulozit-ponuku"
		disabled={stav.k === 'saving'}
		onclick={uloz}
	>
		{stav.k === 'saving' ? 'Ukladám…' : label}
	</button>

	{#if stav.k === 'ok'}
		<p class="vysledok ok" data-testid="ulozit-ponuku-ok">
			{stav.created ? '✅ Ponuka uložená ako objednávka' : 'ℹ️ Táto ponuka už bola uložená'}
			—
			<!-- externý absolútny Odoo deep-link (iná origin, nový tab) — resolve() sa naň nevzťahuje -->
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a href={stav.url} target="_blank" rel="noopener">{stav.name}</a>
		</p>
	{:else if stav.k === 'chyba'}
		<p class="vysledok chyba" data-testid="ulozit-ponuku-chyba">
			⛔ {stav.sprava}
			{#if stav.reLogin}
				<a href={resolve('/login')}>Prihlásiť sa znova</a>
			{:else}
				<span class="hint">(Skús kliknúť znova — duplikát nevznikne.)</span>
			{/if}
		</p>
	{/if}
</div>

<style>
	.ulozit-ponuku {
		margin: 0.75rem 0;
	}
	.vysledok {
		margin: 0.4rem 0 0;
		font-size: 0.95rem;
	}
	.vysledok.ok {
		color: #166534;
	}
	.vysledok.chyba {
		color: #b91c1c;
	}
	.hint {
		color: #64748b;
	}
</style>
