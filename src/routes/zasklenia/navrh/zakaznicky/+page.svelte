<script lang="ts">
	// Zasklenia — zákaznícky TLAČOVÝ list (#170 §2.10): vysoké rozlíšenie
	// (`snimka()`) vložené ako `<img>` do NOVÉHO listu na existujúcom
	// `VykresovyHarok.svelte` shelli (cez `<foreignObject>`, aby sa dal použiť
	// skutočný HTML `<img>` vnútri SVG rámu). Pod obrázkom, MIMO rastra: kóty,
	// RAL, systém/štýl a povinné poznámky (§2.7/§2.13 — nikdy zapečené v PNG).
	import { browser } from '$app/environment';
	import { resolve } from '$app/paths';
	import Vizual3D from '$lib/components/vizual/Vizual3D.svelte';
	import VykresovyHarok from '$lib/components/vykres/VykresovyHarok.svelte';
	import { formatDatumCasSk } from '$lib/datum';
	import { fmtMm } from '$lib/vykres/kota';
	import { nazovSysStyl } from '$lib/system-nazvy';
	import { zaskleniaSpec, type ZaskleniaVizVstup } from '$lib/vizual/geo/zasklenia';
	import { smerZOtvarania, type Smer } from '$lib/zasklenia-navrh';

	let { data, form } = $props();

	let vstup = $derived(form?.vstup ?? null);

	function normalizujSmer(s: Smer): 'PL' | 'LP' | 'OP' {
		return s === 'PL' || s === 'LP' ? s : 'OP';
	}

	let vizVstup = $derived<ZaskleniaVizVstup | null>(
		vstup
			? {
					s: vstup.s,
					v: vstup.v,
					n: vstup.n,
					smer: normalizujSmer(smerZOtvarania(vstup.otvaranie)),
					ralKod: vstup.ralKod,
					ral: vstup.ral,
					kolajnica: vstup.kolajnica ?? undefined,
					kliny: vstup.klin ? [vstup.klin] : undefined,
					otvoreneNa: 0
				}
			: null
	);

	let vysledok = $derived(vizVstup ? zaskleniaSpec(vizVstup) : null);

	let vizRef = $state<ReturnType<typeof Vizual3D>>();
	let pripravene = $state(false);
	let aktualnyTier = $state<'high' | 'mid' | 'low' | 'none'>('high');
	let obrazokUrl = $state<string | null>(null);
	let zachytavaSa = $state(false);
	let zachyteneRaz = false;

	async function zachyt() {
		if (!browser || !vizRef || zachytavaSa || zachyteneRaz || aktualnyTier === 'none') return;
		zachytavaSa = true;
		try {
			const blob = await vizRef.zachytObrazok(2400, 1620);
			if (obrazokUrl) URL.revokeObjectURL(obrazokUrl);
			obrazokUrl = URL.createObjectURL(blob);
			zachyteneRaz = true;
		} finally {
			zachytavaSa = false;
		}
	}

	$effect(() => {
		if (pripravene) void zachyt();
	});

	const PAGE_W = 297;
	const PAGE_H = 210;
</script>

<svelte:head><title>Zasklenia — zákaznícky list</title></svelte:head>

{#if !vstup || !vysledok}
	<div class="card">
		<h1>Zákaznícky list</h1>
		<p class="sub">
			Najprv vykresli zasklenie na <a href={resolve('/zasklenia/navrh')}>návrhovej stránke</a>.
		</p>
	</div>
{:else}
	{#if vysledok.diely.length}
		<div class="skryty-render" aria-hidden="true">
			<Vizual3D
				bind:this={vizRef}
				{vysledok}
				ralKod={vstup.ralKod}
				vynutenyTier="high"
				bind:pripravene
				bind:aktualnyTier
			/>
		</div>
	{/if}

	<div class="card noprint">
		<h1>Zákaznícky list</h1>
		<p class="sub">
			<span class="badge">{fmtMm(vstup.s)} × {fmtMm(vstup.v)} mm</span>
			<span class="badge">{nazovSysStyl(vstup.sysStyl)}</span>
		</p>
		{#if !obrazokUrl}
			<p class="stav">{zachytavaSa ? 'Pripravuje sa obrázok…' : 'Čaká sa na 3D scénu…'}</p>
		{/if}
	</div>

	<div class="card list" style="overflow:auto;padding:10px">
		<VykresovyHarok pageW={PAGE_W} pageH={PAGE_H} margin={6} gridBand={0}>
			{#snippet content(oblast)}
				{@const obrazokH = oblast.h * 0.72}
				{@const captionY = oblast.y + obrazokH + 6}
				<foreignObject x={oblast.x} y={oblast.y} width={oblast.w} height={obrazokH}>
					{#if obrazokUrl}
						<img
							src={obrazokUrl}
							alt="Ilustračný 3D náhľad zasklenia"
							style="width:100%;height:100%;object-fit:contain"
							data-testid="zakaznicky-obrazok"
						/>
					{:else}
						<div class="placeholder">3D náhľad sa pripravuje…</div>
					{/if}
				</foreignObject>
				<foreignObject x={oblast.x} y={captionY} width={oblast.w} height={oblast.h - obrazokH - 6}>
					<div class="caption" data-testid="zakaznicky-caption">
						<p class="drobne">
							Ilustračný perspektívny náhľad — rozmery podľa technického výkresu.
						</p>
						<p>
							{vstup.nazov || nazovSysStyl(vstup.sysStyl)} · {fmtMm(vstup.s)} × {fmtMm(vstup.v)} mm
							{#if vstup.ral}
								· RAL {vstup.ral}
							{/if}
							· {formatDatumCasSk(data.datumIso)}
						</p>
						{#each vysledok.poznamky as p (p)}
							<p class="poznamka">{p}</p>
						{/each}
					</div>
				</foreignObject>
			{/snippet}
		</VykresovyHarok>
	</div>

	<div class="card noprint">
		<button
			class="btn"
			onclick={() => window.print()}
			disabled={!obrazokUrl}
			data-testid="zakaznicky-tlac"
		>
			🖨 Tlačiť / uložiť PDF
		</button>
		<a class="btn secondary" href={resolve('/zasklenia/navrh')}>← Späť na návrh</a>
	</div>
{/if}

<style>
	/* Mimo obrazovky, ale s REÁLNYMI rozmermi (nie 1×1px) — WebGL renderer
	   potrebuje zmysluplnú veľkosť kontajnera pre auto-fit kameru PRED tým,
	   ako `snimka()` explicitne prenastaví veľkosť na tlačové rozlíšenie. */
	.skryty-render {
		position: absolute;
		left: -9999px;
		top: 0;
		width: 800px;
		height: 540px;
		pointer-events: none;
	}

	.stav {
		color: #64748b;
		font-size: 13px;
	}

	.placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		background: #f1f5f9;
		color: #64748b;
		font-size: 13px;
	}

	.caption {
		font-family: sans-serif;
		font-size: 11px;
		color: #334155;
		line-height: 1.5;
	}

	.caption .drobne {
		color: #94a3b8;
		font-size: 9px;
		margin: 0 0 3px;
	}

	.caption p {
		margin: 0 0 2px;
	}

	.poznamka {
		color: #b45309;
	}

	@media print {
		@page {
			size: A4 landscape;
			margin: 6mm;
		}
	}
</style>
