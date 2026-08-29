<script lang="ts">
	// Zákaznícky 3D vizuál pergoly (#276) — self-contained „mode-parametrized
	// wrapper" nad generickým `Vizual3D.svelte`. Mapuje čistý zákaznícky props
	// kontrakt (rozmery, sklon/typ strechy, typ skla, RAL) → `pergolaSpec` a
	// vzhľad skla → `skloVzhlad`, pridá kamera-presety, RAL/sklo výber, reset a
	// PNG export (pre PDF ponuku #277). V RENDERI nie je ani jeden text ani kóta
	// (§2.6) — popisok je POD obrázkom. NULA cien, NULA Money kódov.
	//
	// Integrácia (#275) do verejnej route: vlož komponent, namapuj vstup formulára
	// na props (voliteľne `bind:ralKod`/`bind:typSkla`), doplň E2E (render + zero
	// console errors) — to je scope route/#275.
	import Vizual3D from './Vizual3D.svelte';
	import { pergolaSpec, pergolaPngNazov, type PergolaVizVstup } from '$lib/vizual/geo/pergola';
	import type { PergolaTypStrechy, PergolaModel } from '$lib/vizual/geo/pergola';
	import {
		pergolaSkloVzhlad,
		PERGOLA_SKLA_NAZVY,
		PERGOLA_TYP_SKLA_DEFAULT,
		type PergolaTypSkla
	} from '$lib/vizual/pergola-sklo';
	import { PRESET_DEFAULT, PRESETY, type PresetKluc } from '$lib/vizual/kamera';
	import type { Tier } from '$lib/vizual/kvalita';
	import { RAL_PALETA } from '$lib/vykres/ral';
	import { fmtMm } from '$lib/vykres/kota';
	import { browser } from '$app/environment';

	let {
		sirkaMm,
		hlbkaMm,
		vyskaVpreduMm,
		vyskaPriSteneMm,
		pocetPoli = 1,
		panelPocet = undefined,
		typStrechy = 'pultova',
		typSkla = $bindable<PergolaTypSkla>(PERGOLA_TYP_SKLA_DEFAULT),
		ralKod = $bindable(''),
		ral = undefined,
		model = undefined,
		vynutenyTier = undefined,
		zobrazOvladanie = true
	}: {
		/** celková šírka [mm] */
		sirkaMm: number;
		/** hĺbka (predok → stena) [mm] */
		hlbkaMm: number;
		/** výška vpredu (nižšia) [mm] */
		vyskaVpreduMm: number;
		/** výška pri stene (vyššia, pri pultovej) [mm] */
		vyskaPriSteneMm: number;
		/** počet polí; stĺpov v rade = pocetPoli+1; default 1 */
		pocetPoli?: number;
		/** počet strešných sklenených panelov; default dopočítaný zo šírky */
		panelPocet?: number;
		/** default 'pultova' */
		typStrechy?: PergolaTypStrechy;
		/** typ strešného skla → priehľadnosť/farba (bindable, chip prepína) */
		typSkla?: PergolaTypSkla;
		/** kód RAL konštrukcie (bindable, chip prepína) */
		ralKod?: string;
		/** voľný RAL label (pri `RAL_INY_KOD`) */
		ral?: string;
		/** #329 časť 2: model konštrukcie → hrúbky profilov v 3D (undefined → bez škály) */
		model?: PergolaModel;
		/** testovací hook (`?viz=low`/`?viz=none`) — preposlaný do Vizual3D pre
		 *  e2e determinizmus */
		vynutenyTier?: Tier;
		/** zobraziť ovládanie (presety/RAL/sklo/export) pod náhľadom */
		zobrazOvladanie?: boolean;
	} = $props();

	let preset = $state<PresetKluc>(PRESET_DEFAULT);
	// seedne sa v efekte nižšie (nie priamo `$state(vynutenyTier)` — to by čítalo
	// prop len raz a svelte-check to správne varuje ako "state_referenced_locally")
	let interneVynutenyTier = $state<Tier | undefined>(undefined);
	let vizual3dRef: ReturnType<typeof Vizual3D> | undefined;

	// e2e determinizmus: explicitný `vynutenyTier` prop má prednosť, inak
	// `?viz=low|mid|high|none` z URL (rovnako ako Vizual3DPanel).
	$effect(() => {
		if (vynutenyTier) {
			interneVynutenyTier = vynutenyTier;
			return;
		}
		if (!browser) return;
		const v = new URLSearchParams(window.location.search).get('viz');
		if (v === 'low' || v === 'mid' || v === 'high' || v === 'none') interneVynutenyTier = v;
	});

	let vizVstup = $derived<PergolaVizVstup>({
		sirkaMm,
		hlbkaMm,
		vyskaVpreduMm,
		vyskaPriSteneMm,
		pocetPoli,
		panelPocet,
		typStrechy,
		ralKod,
		ral,
		model
	});

	let vysledok = $derived(pergolaSpec(vizVstup));
	// stabilná referencia per typ skla (mapa vracia rovnaký objekt) — Vizual3D
	// prekreslí sklo len pri skutočnej zmene typu
	let skloVzhlad = $derived(pergolaSkloVzhlad(typSkla));

	// --- verejné API pre integráciu / PDF ponuku (#277) ---

	/** Zachytí aktuálny náhľad ako PNG Blob (vysoké rozlíšenie pre tlač) — pre PDF
	 *  ponuku #277. Reuse `Vizual3D.zachytObrazok` (→ `snimka.ts`, supersample). */
	export async function exportujPNG(sirkaPx?: number, vyskaPx?: number): Promise<Blob> {
		if (!vizual3dRef) throw new Error('VizualPergolaZakaznik: vizuál ešte nie je pripravený');
		return vizual3dRef.zachytObrazok(sirkaPx, vyskaPx);
	}

	/** Stiahne aktuálny náhľad ako PNG súbor (názov z rozmerov, bez ceny/kódu). */
	export async function stiahniPNG(): Promise<void> {
		const blob = await exportujPNG();
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = pergolaPngNazov(vizVstup);
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
</script>

<div class="pergola-zak" data-testid="pergola-zakaznik">
	<Vizual3D
		bind:this={vizual3dRef}
		{vysledok}
		{ralKod}
		{skloVzhlad}
		bind:preset
		vynutenyTier={interneVynutenyTier}
		zobrazDom={true}
	>
		{#snippet posterZaznam()}
			<div class="poster-fallback" data-testid="pergola-poster-fallback">
				<p>3D náhľad nie je na tomto zariadení dostupný.</p>
				<p class="drobne">Pergola {fmt(sirkaMm)} × {fmt(hlbkaMm)} mm</p>
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
						data-testid={`pergola-preset-${kluc}`}>{p.nazov}</button
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
						data-testid={`pergola-ral-${r.kod}`}
						aria-label={`${r.kod} ${r.nazov}`}
						title={`${r.kod} ${r.nazov}`}
					></button>
				{/each}
			</div>

			<div class="sklo-cipy" role="group" aria-label="Typ skla">
				{#each Object.entries(PERGOLA_SKLA_NAZVY) as [kluc, nazov] (kluc)}
					<button
						type="button"
						class="chip"
						class:aktivny={typSkla === kluc}
						onclick={() => (typSkla = kluc as PergolaTypSkla)}
						data-testid={`pergola-sklo-${kluc}`}>{nazov}</button
					>
				{/each}
			</div>

			<div class="akcie">
				<button type="button" class="chip" onclick={() => reset()} data-testid="pergola-reset"
					>⟲ Reset</button
				>
				<button
					type="button"
					class="chip"
					onclick={() => stiahniPNG()}
					data-testid="pergola-export-png">⤓ Stiahnuť obrázok</button
				>
			</div>
		</div>
	{/if}

	<p class="caption" data-testid="pergola-caption">
		<span data-testid="pergola-caption-rozmer">Pergola {fmt(sirkaMm)} × {fmt(hlbkaMm)} mm</span>
		<span> · {PERGOLA_SKLA_NAZVY[typSkla]}</span>
		{#if ral}
			<span data-testid="pergola-caption-ral"> · RAL {ral}</span>
		{/if}
		{#each vysledok.poznamky as p (p)}
			<br /><span class="poznamka">{p}</span>
		{/each}
		<br /><span class="drobne">Ilustračný perspektívny náhľad.</span>
	</p>
</div>

<style>
	.pergola-zak {
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
	.sklo-cipy,
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
