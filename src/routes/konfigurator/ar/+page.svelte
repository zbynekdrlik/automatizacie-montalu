<script lang="ts">
	// AR náhľad pergoly (#286) — samostatná AR viewer stránka. Renderuje `PergolaAR`
	// v režime 'viewer' (vždy model-viewer + AR tlačidlo). Lazy import komponentu →
	// three/model-viewer bundle sa načíta až tu (nie na hlavnom konfigurátore).
	import { resolve } from '$app/paths';

	let { data } = $props();

	type PergolaARTyp = (typeof import('$lib/components/vizual/PergolaAR.svelte'))['default'];
	let PergolaAR = $state<PergolaARTyp | null>(null);

	$effect(() => {
		if (!data.platne) return;
		void import('$lib/components/vizual/PergolaAR.svelte').then((m) => (PergolaAR = m.default));
	});
</script>

<svelte:head>
	<title>Pergola v AR — Montalu</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="ar-stranka">
	<header>
		<h1>Tvoja pergola v AR</h1>
		<p>Klikni „Pozri v AR" a umiestni pergolu v skutočnej veľkosti u seba na pozemku.</p>
	</header>

	{#if data.platne}
		{#if PergolaAR}
			{@const Komp = PergolaAR}
			<Komp
				sirkaMm={data.sirkaMm}
				hlbkaMm={data.hlbkaMm}
				vyskaVpreduMm={data.vyskaVpreduMm}
				vyskaPriSteneMm={data.vyskaPriSteneMm}
				typSkla={data.typSkla}
				ralKod={data.ralKod}
				model={data.model}
				rezim="viewer"
			/>
		{:else}
			<div class="nacitava" data-testid="ar-stranka-loading">Načítavam AR náhľad…</div>
		{/if}
	{:else}
		<p class="chyba" data-testid="ar-stranka-chyba">
			Chýba konfigurácia pergoly.
			<a href={resolve('/konfigurator')}>Vráť sa do konfigurátora</a> a navrhni si pergolu.
		</p>
	{/if}
</div>

<style>
	.ar-stranka {
		max-width: 640px;
		margin: 0 auto;
		padding: 8px;
	}
	header {
		text-align: center;
		margin: 8px 0 16px;
	}
	header h1 {
		font-size: clamp(20px, 5vw, 26px);
		margin: 0 0 6px;
		color: #0f172a;
	}
	header p {
		color: #64748b;
		font-size: 14px;
		margin: 0;
	}
	.nacitava {
		width: 100%;
		min-height: 200px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #eef2f6;
		border-radius: 10px;
		color: #64748b;
	}
	.chyba {
		color: #64748b;
		font-size: 15px;
		text-align: center;
	}
</style>
