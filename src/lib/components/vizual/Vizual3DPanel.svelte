<script lang="ts">
	// Zákaznícky 3D náhľad (#170) — presety, RAL čipy, prepínač otvorené/zatvorené,
	// caption pásik. V RENDERI nie je ani jeden text (§2.6) — kóty/RAL/poznámky sú
	// TU, pod obrázkom, nikdy zapečené v rastri. Táto komponenta prepočítava
	// `vysledok` (zaskleniaSpec) pri zmene RAL/otvorenia — `n` sa berie priamo z
	// `vstup.n` (server load, nikdy neprepočítané — §2.3).
	import Vizual3D from './Vizual3D.svelte';
	import Vizual3DPoster from './Vizual3DPoster.svelte';
	import { zaskleniaSpec, type ZaskleniaVizVstup } from '$lib/vizual/geo/zasklenia';
	import { OTVORENE_NA_DEFAULT } from '$lib/vizual/konstanty';
	import { PRESET_DEFAULT, PRESETY, type PresetKluc } from '$lib/vizual/kamera';
	import type { Tier } from '$lib/vizual/kvalita';
	import { fmtMm } from '$lib/vykres/kota';
	import { RAL_PALETA } from '$lib/vykres/ral';
	import { browser } from '$app/environment';
	import { smerZOtvarania, type Smer, type ZaskleniaNavrhVstup } from '$lib/zasklenia-navrh';

	let { vstup, datum }: { vstup: ZaskleniaNavrhVstup; datum: string } = $props();

	let otvorene = $state(false);
	// inicializuje sa na '' a nastaví na `vstup.ralKod` v efekte nižšie (nikdy
	// priamo `$state(vstup.ralKod)` — to by čítalo `vstup` len raz, neskoro na
	// reaktivitu, a svelte-check to správne varuje ako "state_referenced_locally")
	let ralKod = $state('');
	let preset = $state<PresetKluc>(PRESET_DEFAULT);
	let vynutenyTier = $state<Tier | undefined>(undefined);

	$effect(() => {
		if (!browser) return;
		const v = new URLSearchParams(window.location.search).get('viz');
		if (v === 'low' || v === 'mid' || v === 'high' || v === 'none') vynutenyTier = v;
	});

	// RAL kód sa mení pri zmene vstupu (napr. "← Späť a upraviť") — ale NIE po
	// ručnej voľbe RAL čipu v paneli, tá je čisto vizuálna (appka odpis
	// nemení). Preto sledujeme referenciu `vstup.ralKod` len raz pri prvom
	// vykreslení tohto konkrétneho vstupu.
	let posledneRalKod: string | undefined;
	$effect(() => {
		if (posledneRalKod !== vstup.ralKod) {
			posledneRalKod = vstup.ralKod;
			ralKod = vstup.ralKod;
		}
	});

	function normalizujSmer(s: Smer): 'PL' | 'LP' | 'OP' {
		return s === 'PL' || s === 'LP' ? s : 'OP';
	}

	let vizVstup = $derived<ZaskleniaVizVstup>({
		s: vstup.s,
		v: vstup.v,
		n: vstup.n,
		smer: normalizujSmer(smerZOtvarania(vstup.otvaranie)),
		ralKod,
		ral: vstup.ral,
		kolajnica: vstup.kolajnica ?? undefined,
		kliny: vstup.klin ? [vstup.klin] : undefined,
		otvoreneNa: otvorene ? OTVORENE_NA_DEFAULT : 0
	});

	let vysledok = $derived(zaskleniaSpec(vizVstup));

	let vizual3dRef: ReturnType<typeof Vizual3D> | undefined;

	function fmt(n: number) {
		return fmtMm(n);
	}
</script>

<div class="vizual3d-panel" data-testid="vizual3d-panel">
	<Vizual3D bind:this={vizual3dRef} {vysledok} {ralKod} bind:preset {vynutenyTier}>
		{#snippet posterZaznam()}
			<Vizual3DPoster {vstup} {datum} />
		{/snippet}
	</Vizual3D>

	<div class="ovladanie noprint">
		<div class="presety" role="group" aria-label="Kamera">
			{#each Object.entries(PRESETY) as [kluc, p] (kluc)}
				<button
					type="button"
					class="chip"
					class:aktivny={preset === kluc}
					onclick={() => (preset = kluc as PresetKluc)}
					data-testid={`viz-preset-${kluc}`}>{p.nazov}</button
				>
			{/each}
		</div>

		<div class="ral-cipy" role="group" aria-label="Farba RAL">
			{#each RAL_PALETA as r (r.kod)}
				<button
					type="button"
					class="ral-cip"
					class:aktivny={ralKod === r.kod}
					style="background:{r.hex}"
					onclick={() => (ralKod = r.kod)}
					data-testid={`viz-ral-${r.kod}`}
					aria-label={`${r.kod} ${r.nazov}`}
					title={`${r.kod} ${r.nazov}`}
				></button>
			{/each}
		</div>

		<div class="akcie">
			<button
				type="button"
				class="chip"
				onclick={() => (otvorene = !otvorene)}
				data-testid="viz-otvorene-toggle"
			>
				{otvorene ? '◀ Zatvoriť' : 'Otvoriť ▶'}
			</button>
			<button
				type="button"
				class="chip"
				onclick={() => vizual3dRef?.resetVerejne()}
				data-testid="viz-reset"
			>
				⟲ Reset
			</button>
		</div>
	</div>

	<p class="caption" data-testid="vizual3d-caption">
		<span data-testid="viz-caption-rozmer">{fmt(vstup.s)} × {fmt(vstup.v)} mm</span>
		{#if vstup.ral}
			<span data-testid="viz-caption-ral"> · RAL {vstup.ral}</span>
		{/if}
		{#each vysledok.poznamky as p (p)}
			<br /><span class="poznamka">{p}</span>
		{/each}
		<br /><span class="drobne"
			>Ilustračný perspektívny náhľad — rozmery podľa technického výkresu.</span
		>
	</p>
</div>

<style>
	.vizual3d-panel {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.ovladanie {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		align-items: center;
		justify-content: space-between;
	}

	.presety,
	.akcie {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}

	.ral-cipy {
		display: flex;
		gap: 6px;
	}

	.chip {
		border: 1px solid #cbd5e1;
		background: #fff;
		border-radius: 999px;
		padding: 6px 12px;
		font-size: 13px;
		cursor: pointer;
	}

	.chip.aktivny {
		background: #1d4ed8;
		border-color: #1d4ed8;
		color: #fff;
	}

	.ral-cip {
		width: 26px;
		height: 26px;
		border-radius: 6px;
		border: 2px solid #94a3b8;
		cursor: pointer;
	}

	.ral-cip.aktivny {
		border-color: #1d4ed8;
		box-shadow: 0 0 0 2px #bfdbfe;
	}

	.caption {
		margin: 0;
		font-size: 13px;
		color: #334155;
		line-height: 1.5;
	}

	.poznamka {
		color: #b45309;
	}

	.drobne {
		color: #94a3b8;
		font-size: 11px;
	}
</style>
