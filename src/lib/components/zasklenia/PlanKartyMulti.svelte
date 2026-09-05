<script lang="ts">
	// Spoločný nárezový plán viacerých zasklení (kroky nahladMulti/hotovoMulti; #468 rename).
	// Čistá prezentácia — stav + výpočty prídu ako propy z +page (#250, vzor #239). `multi` je
	// aliasovaný na `m`, aby vyčlenený markup ostal 1:1. Triedy globálne v app.css.
	import Nahlad2D from '$lib/components/Nahlad2D.svelte';
	import ProfilObrazok from '$lib/components/ProfilObrazok.svelte';
	import RozpisRezov from '$lib/components/RozpisRezov.svelte';
	import CenyTabulka from '$lib/components/CenyTabulka.svelte';
	import SkloCena from '$lib/components/SkloCena.svelte';
	import PoznamkaRal from './PoznamkaRal.svelte';
	import KovanieStrany from './KovanieStrany.svelte';
	import { fmtSkloRozmer } from '$lib/sklo';
	import { nazovSystemu } from '$lib/system-nazvy';
	import { popisRucnejKolajnice } from '$lib/kolajnica';
	import { klinPopis } from '$lib/klin';
	import {
		sietkaPopis,
		rozmerSietovinyPre,
		sietkaStrana,
		potrebuje3KKolajnicu,
		popis3KKolajnicaVymena,
		pridavnaKolajnicaHint
	} from '$lib/sietka';
	import { fmtM, type PlanVstup } from '$lib/zasklenia-form';
	import type { MultiResult } from '$lib/server/compute';
	import type { Polozka } from '$lib/server/money';
	import type { CenyResult } from '$lib/server/ceny';
	import type { SkloCenaResult } from '$lib/server/sklo-cena';

	let {
		multi: m,
		vstup,
		kovanie,
		ceny,
		skloCeny
	}: {
		multi: MultiResult;
		vstup: PlanVstup;
		kovanie?: Polozka[];
		ceny?: CenyResult;
		skloCeny?: SkloCenaResult;
	} = $props();
</script>

<PoznamkaRal poznamka={vstup.poznamka} ral={vstup.ral} />
<div class="card">
	<div class="sec">Zasklenia ({m.posuvy.length}) — spolu {fmtM(m.m2)} m²</div>
	<table>
		<thead
			><tr><th></th><th>Systém</th><th>Rozmer</th><th>Sklo (mm)</th><th>Otváranie</th></tr></thead
		>
		<tbody>
			{#each m.posuvy as pv, i (i)}
				<tr>
					<td class="c"><b>Zasklenie {i + 1}</b></td>
					<td>{nazovSystemu(pv.system)} {pv.styl}</td>
					<td
						>{pv.S} × {pv.V} mm{#if popisRucnejKolajnice(pv.kolajnica)}<span
								class="kol-rucne"
								data-testid={`kolajnica-rucne-${i}`}>{popisRucnejKolajnice(pv.kolajnica)}</span
							>{/if}</td
					>
					<!-- oddeľovač je v BUNKE ako výraz — `{#if} · {/if}` by o medzeru pred
					     bodkou prišlo pri kompilácii (zachytil e2e: „2115mm· Izolačné") -->
					<td data-testid={`posuv-sklo-${i}`}
						>{fmtSkloRozmer(pv.sklo.sirka, pv.sklo.vyska) +
							(pv.skloNazov ? ` · ${pv.skloNazov}` : '')}</td
					>
					<td>{pv.otvaranie ?? ''}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<div class="card">
	<div class="sec">Náhľady zasklení</div>
	<div class="posuv-nahlady">
		{#each m.posuvy as pv, i (i)}
			<div class="posuv-nahlad">
				<div class="posuv-nahlad-hd">Posuv {i + 1}</div>
				<Nahlad2D
					S={pv.S}
					V={pv.V}
					N={pv.N}
					skloS={pv.sklo.sirka}
					skloV={pv.sklo.vyska}
					otvaranie={pv.otvaranie ?? 'Opona'}
					system={pv.system}
					kovanieL={pv.kovanieL ?? ''}
					kovanieP={pv.kovanieP ?? ''}
					kovanieStred={pv.kovanieStred ?? ''}
					kovanieStredOkno={(pv.kovanieStredOkno ?? 'L') as 'L' | 'P'}
					klin={pv.klin ?? null}
					sietka={pv.sietka ?? null}
				/>
			</div>
		{/each}
	</div>
</div>

<!-- Patrik 2026-07-31 (Odoo „Vyroba automatizacia"): „pri posuve Robust by som
     potreboval tie kľučky fabky vypísať niekam rozumnejšie, zle je to vidieť —
     kľudne aj pod tie posuvy". V kresbe sú ďalej, toto je čitateľný výpis. -->
{#if m.posuvy.some((pv) => pv.kovanieL || pv.kovanieP || pv.kovanieStred)}
	<div class="card" data-testid="kovanie-strany-multi">
		<div class="sec">Kovanie — kľučky a FAB</div>
		{#each m.posuvy as pv, i (i)}
			{#if pv.kovanieL || pv.kovanieP || pv.kovanieStred}
				<KovanieStrany
					nadpis={`Zasklenie ${i + 1}`}
					lava={pv.kovanieL ?? ''}
					prava={pv.kovanieP ?? ''}
					stred={pv.kovanieStred ?? ''}
					stredOkno={(pv.kovanieStredOkno ?? 'L') as 'L' | 'P'}
				/>
			{/if}
		{/each}
	</div>
{/if}

{#if m.posuvy.some((pv) => pv.klin)}
	<div class="card" data-testid="klin-karta-multi">
		<div class="sec">Klíny</div>
		{#each m.posuvy as pv, i (i)}
			{#if pv.klin}
				<div class="row"><span>Zasklenie {i + 1}</span><b>{klinPopis(pv.klin)}</b></div>
			{/if}
		{/each}
	</div>
{/if}

{#if m.posuvy.some((pv) => pv.sietka)}
	<div class="card" data-testid="sietka-karta-multi">
		<div class="sec">Sieťky — v Money odpise</div>
		{#each m.posuvy as pv, i (i)}
			{#if pv.sietka}
				{@const rozmer = rozmerSietovinyPre(pv.system, pv.sklo.sirka, pv.sklo.vyska)}
				{@const pridavnaHint = pridavnaKolajnicaHint(
					pv.system,
					pv.styl,
					true,
					vstup.pridavnaKolajnica
				)}
				<div class="row">
					<span
						>Posuv {i + 1}{#if sietkaStrana(pv.otvaranie ?? '')}
							· strana {sietkaStrana(pv.otvaranie ?? '')}{/if}</span
					><b>{sietkaPopis(pv.sietka, rozmer)}</b>
				</div>
				{#if potrebuje3KKolajnicu(pv.styl)}
					<p class="sub" data-testid={`sietka-2k-warn-multi-${i}`}>
						⚠ Zasklenie {i + 1}: 2K systém — appka automaticky odpíše {popis3KKolajnicaVymena(
							pv.system
						)}.
					</p>
				{/if}
				{#if pridavnaHint}
					<p class="sub" data-testid={`pridavna-v-sietke-multi-${i}`}>
						ℹ Zasklenie {i + 1}: {pridavnaHint}
					</p>
				{/if}
			{/if}
		{/each}
	</div>
{/if}

<div class="card">
	<div class="sec">Zoznam materiálu — spoločný (naprieč zaskleniami)</div>
	<table data-testid="material-tabulka">
		<thead><tr><th></th><th>Profil</th><th>Kód</th><th>Rezy</th><th class="c">Tyče</th></tr></thead>
		<tbody>
			{#each m.material as mt (mt.kod)}
				<tr>
					<td style="width:52px"><ProfilObrazok kod={mt.kod} nazov={mt.nazov} /></td>
					<td>{mt.nazov}</td>
					<td class="c">{mt.kod}</td>
					<td
						>{mt.rezy
							.filter((x) => x.ks > 0)
							.map((x) => `${x.ks}×${x.rozmer} mm`)
							.join(' + ') || '—'}</td
					>
					<td class="c"><b>{mt.tyce}</b></td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<div class="card">
	<div class="sec">Odpis (do Money) — spoločný za celú zákazku</div>
	{#each m.odpis.filter((o) => o.metre > 0) as o (o.kod)}
		<div class="row">
			<span><span class="mono">{o.kod}</span> · {o.nazov}</span><b class="mono">{fmtM(o.metre)} m</b
			>
		</div>
	{/each}
</div>

{#if kovanie?.length}
	<div class="card" data-testid="kovanie-karta">
		<div class="sec">Kovanie a tesnenia (do Money)</div>
		{#each kovanie as k (k.kod)}
			<div class="row">
				<span>{k.kod} · {k.nazov}</span><b class="mono"
					>{k.mj === 'ks' ? k.qty : fmtM(k.qty)} {k.mj}</b
				>
			</div>
		{/each}
	</div>
{/if}

<!-- cenový zoznam materiálu (#154, fáza 1) — LEN pre interných, viď PlanKarty vyššie -->
{#if ceny}
	<CenyTabulka {ceny} />
{/if}

<!-- náklad na sklo per posuv + súhrn (display-only, #225) — LEN pre interných, NOPRINT -->
{#if skloCeny}
	<SkloCena {skloCeny} />
{/if}

<div class="card">
	<div class="sec">Rozpis rezov na tyče — pre pílu (zasklenia zdieľajú tyče)</div>
	<p class="sub" style="margin-bottom:14px">
		Rezy z rôznych zasklení sú v jednej tyči — pri každom reze je číslo zasklenia (Z1/Z2/…).
	</p>
	<RozpisRezov material={m.material} viacPosuvov={true} />
</div>
