<script lang="ts">
	// Nárezový plán jedného posuvu (kroky nahlad/hotovo). Čistá prezentácia — všetok stav
	// a výpočty prídu ako propy z +page (state+compute hub, #250, vzor #239). Karty:
	// poznámka/RAL, rozmery, náhľad, kovanie, klín, sieťka, sklo, materiál, odpis, ceny,
	// rozpis rezov. `plan` je aliasovaný na `p`, aby vyčlenený markup ostal 1:1.
	import Nahlad2D from '$lib/components/Nahlad2D.svelte';
	import ProfilObrazok from '$lib/components/ProfilObrazok.svelte';
	import RozpisRezov from '$lib/components/RozpisRezov.svelte';
	import CenyTabulka from '$lib/components/CenyTabulka.svelte';
	import SkloCena from '$lib/components/SkloCena.svelte';
	import PoznamkaRal from './PoznamkaRal.svelte';
	import KovanieStrany from './KovanieStrany.svelte';
	import { fmtSkloRozmer } from '$lib/sklo';
	import {
		rozmerSietovinyPre,
		maSietkaSystemVyber,
		sietkaStrana,
		potrebuje3KKolajnicu,
		popis3KKolajnicaVymena,
		pridavnaKolajnicaHint,
		uchytLabel
	} from '$lib/sietka';
	import { fmtM, type PlanVstup } from '$lib/zasklenia-form';
	import type { ComputeResult } from '$lib/server/compute';
	import type { Polozka } from '$lib/server/money';
	import type { CenyResult } from '$lib/server/ceny';
	import type { SkloCenaResult } from '$lib/server/sklo-cena';

	let {
		plan: p,
		vstup,
		kovanie,
		ceny,
		skloCeny
	}: {
		plan: ComputeResult;
		vstup: PlanVstup;
		kovanie?: Polozka[];
		ceny?: CenyResult;
		skloCeny?: SkloCenaResult;
	} = $props();
</script>

<PoznamkaRal poznamka={vstup.poznamka} ral={vstup.ral} />
<div class="card">
	<div class="sec">Rozmery</div>
	<div class="g">
		<div><span>Šírka</span><b class="mono">{p.S} mm</b></div>
		<div><span>Výška</span><b class="mono">{p.V} mm</b></div>
		<div><span>Plocha</span><b class="mono">{fmtM(p.m2)} m²</b></div>
		{#if vstup.kolajnica?.horna}
			<div>
				<span>Koľajnica horná (ručne)</span>
				<b class="mono" data-testid="kolajnica-horna">{vstup.kolajnica.horna} mm</b>
			</div>
		{/if}
		{#if vstup.kolajnica?.spodna}
			<div>
				<span>Koľajnica spodná (ručne)</span>
				<b class="mono" data-testid="kolajnica-spodna">{vstup.kolajnica.spodna} mm</b>
			</div>
		{/if}
	</div>
</div>

<div class="card">
	<div class="sec">Náhľad</div>
	<Nahlad2D
		S={p.S}
		V={p.V}
		N={p.N}
		skloS={p.sklo.sirka}
		skloV={p.sklo.vyska}
		otvaranie={vstup.otvaranie}
		system={p.system}
		vrtanieZamku={vstup.vrtanieZamku}
		kovanieL={vstup.kovanieL}
		kovanieP={vstup.kovanieP}
		kovanieStred={vstup.kovanieStred}
		kovanieStredOkno={vstup.kovanieStredOkno}
		klin={vstup.klin}
		sietka={vstup.sietka}
	/>
</div>

{#if vstup.kovanieL || vstup.kovanieP || vstup.kovanieStred}
	<div class="card" data-testid="kovanie-strany">
		<div class="sec">Kovanie — kľučky a FAB</div>
		<KovanieStrany
			nadpis="Zasklenie 1"
			lava={vstup.kovanieL}
			prava={vstup.kovanieP}
			stred={vstup.kovanieStred}
			stredOkno={vstup.kovanieStredOkno}
		/>
	</div>
{/if}

{#if vstup.klin}
	<div class="card" data-testid="klin-karta">
		<div class="sec">Klín</div>
		<div class="g">
			<div>
				<span>Dĺžka</span><b class="mono" data-testid="klin-dlzka">{vstup.klin.dlzka} mm</b>
			</div>
			<div><span>Šírka (hĺbka)</span><b class="mono">{vstup.klin.sirka} mm</b></div>
			<div><span>Výška 1</span><b class="mono">{vstup.klin.v1} mm</b></div>
			<div><span>Výška 2</span><b class="mono">{vstup.klin.v2} mm</b></div>
			<div><span>Počet</span><b class="mono">{vstup.klin.ks} ks</b></div>
		</div>
	</div>
{/if}

{#if vstup.sietka}
	{@const rozmer = rozmerSietovinyPre(p.system, p.sklo.sirka, p.sklo.vyska)}
	{@const sietkaSystemVal = vstup.sietka.system ?? p.system}
	{@const pridavnaHint = pridavnaKolajnicaHint(p.system, vstup.styl, true, vstup.pridavnaKolajnica)}
	<div class="card" data-testid="sietka-karta">
		<div class="sec">Sieťka — v Money odpise</div>
		<div class="g">
			<div>
				<span>Strana</span><b data-testid="sietka-strana">{sietkaStrana(vstup.otvaranie) ?? '—'}</b>
			</div>
			{#if maSietkaSystemVyber(p.system)}
				<div>
					<span>Systém sieťky</span><b data-testid="sietka-system">{sietkaSystemVal}</b>
				</div>
			{/if}
			<div>
				<span>Rozmer sieťoviny (objednávka u dodávateľa)</span><b
					class="mono"
					data-testid="sietka-rozmer">{fmtM(rozmer.sirka)} × {fmtM(rozmer.vyska)} mm</b
				>
			</div>
			<div><span>Úchyt</span><b>{uchytLabel(vstup.sietka.uchyt)}</b></div>
			<div>
				<span>Profily navyše</span><b
					>{maSietkaSystemVyber(p.system)
						? '+2 šírka prírezov + 1 krajová + 1 nos + 1 dorazová'
						: p.system === 'Slide'
							? '+2 rámové rezy (S aj V) + 1 nosový rez + redukcia pre sieťku'
							: '+2 rámové rezy (S aj V) + 1 nosový rez'}</b
				>
			</div>
			<div><span>Joklík</span><b>bez skladovej karty — nájde dielňa, neodpisuje sa</b></div>
		</div>
		{#if potrebuje3KKolajnicu(vstup.styl)}
			<p class="sub" data-testid="sietka-2k-warn-karta">
				⚠ 2K systém — appka automaticky odpíše {popis3KKolajnicaVymena(p.system)}.
			</p>
		{/if}
		{#if pridavnaHint}
			<p class="sub" data-testid="pridavna-v-sietke-karta">
				ℹ {pridavnaHint}
			</p>
		{/if}
	</div>
{/if}

<div class="card">
	<div class="sec">Sklo (mm)</div>
	<div class="g">
		<div><span>Šírka</span><b class="mono" data-testid="sklo-sirka">{fmtM(p.sklo.sirka)}</b></div>
		<div><span>Výška</span><b class="mono" data-testid="sklo-vyska">{fmtM(p.sklo.vyska)}</b></div>
		<div><span>Počet</span><b class="mono">{p.sklo.pocet} ks</b></div>
		<div><span>Typ</span><b style="font-size:13px">{vstup.skloPresne || vstup.sklo}</b></div>
		<div>
			<span>Rozmer (na objednávku skla)</span><b class="mono" data-testid="sklo-rozmer"
				>{fmtSkloRozmer(p.sklo.sirka, p.sklo.vyska)}</b
			>
		</div>
	</div>
</div>

<div class="card">
	<div class="sec">Zoznam materiálu — profily</div>
	<table data-testid="material-tabulka">
		<thead><tr><th></th><th>Profil</th><th>Kód</th><th>Rezy</th><th class="c">Tyče</th></tr></thead>
		<tbody>
			{#each p.material as m (m.kod)}
				<tr>
					<td style="width:52px"><ProfilObrazok kod={m.kod} nazov={m.nazov} /></td>
					<td>{m.nazov}</td>
					<td class="c">{m.kod}</td>
					<td
						>{m.rezy
							.filter((x) => x.ks > 0)
							.map((x) => `${x.ks}×${x.rozmer} mm`)
							.join(' + ') || '—'}</td
					>
					<td class="c"><b>{m.tyce}</b></td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<div class="card">
	<div class="sec">Odpis (do Money)</div>
	{#each p.odpis.filter((o) => o.metre > 0) as o (o.kod)}
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

<!-- cenový zoznam materiálu (#154, fáza 1) — LEN pre interných; b2b nikdy nedostane
     `ceny` (viď cenyPre v +page.server.ts), takže sa im tento blok vôbec nevykreslí -->
{#if ceny}
	<CenyTabulka {ceny} />
{/if}

<!-- náklad na sklo (display-only, #225) — LEN pre interných, NOPRINT; b2b nikdy
     nedostane `skloCeny` (viď skloCenyPre v +page.server.ts) -->
{#if skloCeny}
	<SkloCena {skloCeny} />
{/if}

<div class="card">
	<div class="sec">Rozpis rezov na tyče — pre pílu</div>
	<p class="sub" style="margin-bottom:14px">
		Každá tyč nakreslená v mierke s očíslovanými rezmi a odpadom na konci (dĺžka tyče je pri každom
		profile — Deluxe má kratšie: kladka/klzný 3600, 5K horná 6000 mm).
	</p>
	<RozpisRezov material={p.material} />
</div>
