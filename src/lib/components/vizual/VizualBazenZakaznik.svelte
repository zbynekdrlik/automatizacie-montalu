<script lang="ts">
	// Zákaznícky 3D vizuál bazénového zastrešenia (#405) — self-contained wrapper
	// nad generickým `Vizual3D.svelte` (vzor `VizualPergolaZakaznik`). Mapuje čistý
	// zákaznícky props kontrakt (rozmery, počet segmentov, koľaj, RAL, kategória
	// výplne) → `bazenSpec` a vzhľad výplne → `skloVzhlad`, pridá kamera-presety,
	// reset a PNG export. V RENDERI nie je ani jeden text ani kóta — popisok je POD
	// obrázkom. NULA cien, NULA Money kódov (3D berie len rozmery + odtieň + RAL kód).
	// `zobrazDom={false}` — bazén NEmá pergolovú dom-scénu (dvere/okno/fasáda).
	import Vizual3D from './Vizual3D.svelte';
	import { bazenSpec, bazenPngNazov, type BazenVizVstup } from '$lib/vizual/geo/bazen';
	import { bazenVyplnVzhladZNazvu } from '$lib/vizual/bazen-vypln';
	import { PRESET_DEFAULT, PRESETY, type PresetKluc } from '$lib/vizual/kamera';
	import type { Tier } from '$lib/vizual/kvalita';
	import { fmtMm } from '$lib/vykres/kota';
	import { browser } from '$app/environment';

	let {
		sirkaMm,
		dlzkaMm,
		vyskaMm,
		segmenty,
		dvojkolaj = false,
		vyplnNazov,
		ralKod = $bindable(''),
		ral = undefined,
		vynutenyTier = undefined,
		zobrazOvladanie = true
	}: {
		/** šírka zastrešenia = rozpon oblúka [mm] */
		sirkaMm: number;
		/** dĺžka zastrešenia (pozdĺž bazéna) [mm] */
		dlzkaMm: number;
		/** výška najvyššieho segmentu (oblúk v najvyššom bode) [mm] */
		vyskaMm: number;
		/** počet segmentov (2..8) */
		segmenty: number;
		/** dvojkoľajové rozsúvanie → 2 koľajnice na stranu */
		dvojkolaj?: boolean;
		/** kategória výplne (názov, napr. „Číry polykarbonát") → vzhľad výplne */
		vyplnNazov: string;
		/** kód RAL konštrukcie (bindable) */
		ralKod?: string;
		/** voľný RAL label (pri `RAL_INY_KOD`) */
		ral?: string;
		/** testovací hook (`?viz=low`/`?viz=none`) — preposlaný do Vizual3D */
		vynutenyTier?: Tier;
		/** zobraziť ovládanie (presety/reset/export) pod náhľadom */
		zobrazOvladanie?: boolean;
	} = $props();

	let preset = $state<PresetKluc>(PRESET_DEFAULT);
	// seedne sa v efekte nižšie (nie priamo `$state(vynutenyTier)` — to by čítalo
	// prop len raz a svelte-check to správne varuje ako "state_referenced_locally")
	let interneVynutenyTier = $state<Tier | undefined>(undefined);
	let vizual3dRef: ReturnType<typeof Vizual3D> | undefined;

	// e2e determinizmus: explicitný `vynutenyTier` prop má prednosť, inak
	// `?viz=low|mid|high|none` z URL (rovnako ako VizualPergolaZakaznik).
	$effect(() => {
		if (vynutenyTier) {
			interneVynutenyTier = vynutenyTier;
			return;
		}
		if (!browser) return;
		const v = new URLSearchParams(window.location.search).get('viz');
		if (v === 'low' || v === 'mid' || v === 'high' || v === 'none') interneVynutenyTier = v;
	});

	let vizVstup = $derived<BazenVizVstup>({
		sirkaMm,
		dlzkaMm,
		vyskaMm,
		segmenty,
		dvojkolaj,
		ralKod,
		ral
	});

	let vysledok = $derived(bazenSpec(vizVstup));
	// stabilná referencia per kategória výplne (mapa vracia rovnaký objekt) —
	// Vizual3D prekreslí výplň len pri skutočnej zmene typu
	let skloVzhlad = $derived(bazenVyplnVzhladZNazvu(vyplnNazov));

	// --- verejné API pre integráciu / PDF ponuku (reuse Vizual3D.zachytObrazok) ---

	/** Zachytí aktuálny náhľad ako PNG Blob (vysoké rozlíšenie pre tlač). */
	export async function exportujPNG(sirkaPx?: number, vyskaPx?: number): Promise<Blob> {
		if (!vizual3dRef) throw new Error('VizualBazenZakaznik: vizuál ešte nie je pripravený');
		return vizual3dRef.zachytObrazok(sirkaPx, vyskaPx);
	}

	/** Stiahne aktuálny náhľad ako PNG súbor (názov z rozmerov, bez ceny/kódu). */
	export async function stiahniPNG(): Promise<void> {
		const blob = await exportujPNG();
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = bazenPngNazov(vizVstup);
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	}

	export function nastavPreset(kluc: PresetKluc): void {
		vizual3dRef?.nastavPresetVerejne(kluc);
	}

	export function reset(): void {
		vizual3dRef?.resetVerejne();
	}

	function fmt(n: number): string {
		return fmtMm(n);
	}

	/** Slovenské skloňovanie „segment" (1 = segment, 2–4 = segmenty, inak segmentov). */
	function segmentyText(n: number): string {
		const k = Math.round(n);
		const slovo = k === 1 ? 'segment' : k >= 2 && k <= 4 ? 'segmenty' : 'segmentov';
		return `${k} ${slovo}`;
	}
</script>

<div class="bazen-zak" data-testid="bazen-zakaznik">
	<Vizual3D
		bind:this={vizual3dRef}
		{vysledok}
		{ralKod}
		{skloVzhlad}
		bind:preset
		vynutenyTier={interneVynutenyTier}
		zobrazDom={false}
		zobrazStena={false}
	>
		{#snippet posterZaznam()}
			<div class="poster-fallback" data-testid="bazen-poster-fallback">
				<p>3D náhľad nie je na tomto zariadení dostupný.</p>
				<p class="drobne">Bazénové zastrešenie {fmt(dlzkaMm)} × {fmt(sirkaMm)} mm</p>
			</div>
		{/snippet}
	</Vizual3D>

	{#if zobrazOvladanie}
		<div class="ovladanie noprint">
			<div class="presety" role="group" aria-label="Kamera">
				{#each Object.entries(PRESETY) as [kluc, p] (kluc)}
					<button
						type="button"
						class="chip"
						class:aktivny={preset === kluc}
						onclick={() => (preset = kluc as PresetKluc)}
						data-testid={`bazen-preset-${kluc}`}>{p.nazov}</button
					>
				{/each}
			</div>

			<div class="akcie">
				<button type="button" class="chip" onclick={() => reset()} data-testid="bazen-reset"
					>⟲ Reset</button
				>
				<button
					type="button"
					class="chip"
					onclick={() => stiahniPNG()}
					data-testid="bazen-export-png">⤓ Stiahnuť obrázok</button
				>
			</div>
		</div>
	{/if}

	<p class="caption" data-testid="bazen-caption">
		<span data-testid="bazen-caption-rozmer"
			>Bazénové zastrešenie {fmt(dlzkaMm)} × {fmt(sirkaMm)} mm</span
		>
		<span> · {segmentyText(segmenty)} · {vyplnNazov}</span>
		{#if ral}
			<span data-testid="bazen-caption-ral"> · RAL {ral}</span>
		{/if}
		{#each vysledok.poznamky as p (p)}
			<br /><span class="poznamka">{p}</span>
		{/each}
		<br /><span class="drobne">Ilustračný perspektívny náhľad.</span>
	</p>
</div>

<style>
	.bazen-zak {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.ovladanie {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		align-items: center;
	}

	.presety,
	.akcie {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
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

	.poster-fallback {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
		background: #fff;
		color: #475569;
		text-align: center;
		padding: 12px;
	}

	.poster-fallback p {
		margin: 0;
	}
</style>
