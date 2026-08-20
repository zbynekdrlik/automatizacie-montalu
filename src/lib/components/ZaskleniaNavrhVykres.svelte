<script lang="ts">
	// Zasklenia — zákaznícky NÁVRHOVÝ výkres (#162). Celý hárok postavený na
	// zdieľanom základe #137 (VykresovyHarok + Kota) — žiadny vlastný <svg>/rám.
	// Na rozdiel od pergoly (#138, PergolaNavrhVykres.svelte) BEZ `titleBlock`
	// (#162 bod 4 — „bez rámčeka vpravo dole a bez konštrukčných mierok", šéfova
	// spätná väzba k pergole msg #1670729): žiadna mierka/revízia/vypracoval,
	// len JEDEN predný pohľad (zasklenie je ploché, netreba bočný rez/izometriu
	// ako pergola).
	//
	// Počet krídel (`vstup.n`) a všetky kóty vychádzajú PRIAMO zo vstupu — táto
	// komponenta len KRESLÍ, nič neprepočítava paralelne (viď design komentár na #162).
	//
	// #168: kompozícia (mierka + vertikálne/vodorovné centrovanie elevácie, min.
	// veľkosti písma) ide cez zdieľané `$lib/vykres/kompozicia.ts` primitívy — NAHRÁDZA
	// doterajší fixný `baseY = r.y + r.h*0.85` odsad, ktorý bol príčinou nálezu "horná
	// tretina hárku prázdna" (viď design komentár na #168). Pohyblivé/fixné krídla sa
	// označujú šípkou (`pohyblivePanely`, `zasklenia-navrh.ts`) — nezávislá
	// reimplementácia rovnakého pravidla, aké používa `$lib/vizual/geo/zasklenia.ts`
	// (zákaznícky 3D náhľad), zámerne oddelená aby `$lib/vizual/**` ostal nedotknutý.
	import VykresovyHarok from '$lib/components/vykres/VykresovyHarok.svelte';
	import Kota from '$lib/components/vykres/Kota.svelte';
	import { fitScale, fmtMm } from '$lib/vykres/kota';
	import {
		fitCentered,
		MIN_TITLE_FONT,
		MIN_SUBTITLE_FONT,
		MIN_DIM_FONT
	} from '$lib/vykres/kompozicia';
	import { farbaKonstrukcie } from '$lib/vykres/ral';
	import { nazovSysStyl } from '$lib/system-nazvy';
	import { popisRucnejKolajnice } from '$lib/kolajnica';
	import {
		deliaceStlpiky,
		smerZOtvarania,
		pohyblivePanely,
		type ZaskleniaNavrhVstup
	} from '$lib/zasklenia-navrh';

	let {
		vstup,
		datum
	}: {
		vstup: ZaskleniaNavrhVstup;
		/** už naformátovaný dátum zo servera (formatDatumCasSk) */
		datum: string;
	} = $props();

	const PAGE_W = 297;
	const PAGE_H = 210;
	const MARGIN = 6;
	const GRID_BAND = 5;

	// #150/#153 disciplína znovupoužitá 1:1 (pergola-navrh.ts / PergolaNavrhVykres.svelte):
	// farebný režim vyfarbuje LEN konštrukciu (rám), kóty/poznámky/raster sa nemenia.
	let farebny = $derived(vstup.rezimVykresu === 'farebny');
	let farba = $derived(farbaKonstrukcie(vstup.ralKod));

	const CIERNA = '#0f172a';
	const MODRA = '#1d4ed8';
	const CERVENA = '#dc2626';

	// hrúbka rámu / deliaceho stĺpika V KRESBE [mm] — LEN vizuálne konštanty
	// (rovnaká disciplína ako STLP_HRUBKA_VIZ_MM v pergola-navrh.ts), nevstupujú
	// do žiadnej kóty — kóty (S/N na krídlo) čítajú vstup.s/vstup.n priamo.
	const RAM_VIZ_MM = 70;
	const MULLION_VIZ_MM = 60;
	const STRUKTURA_STROKE = 1.2;

	/** Obrysová hrúbka pre vyplnený štruktúrny tvar s daným (menším) rozmerom v PX
	 *  — rovnaký "nikdy nezhltni fill" guard ako `obrysStroke()` v
	 *  PergolaNavrhVykres.svelte (#153) — nikdy pevná konštanta bez ohľadu na mierku. */
	function obrysStroke(rozmerPx: number): number {
		return Math.min(STRUKTURA_STROKE, rozmerPx * 0.5);
	}

	/** Vrcholy trojuholníkovej šípky na konci úsečky (x1,y1)→(x2,y2), hrot v (x2,y2)
	 *  — rovnaká implementácia ako `sipka()` v PergolaNavrhVykres.svelte. */
	function sipka(x1: number, y1: number, x2: number, y2: number, dlzka = 4, sirka = 2.2): string {
		const dx = x2 - x1;
		const dy = y2 - y1;
		const len = Math.hypot(dx, dy) || 1;
		const ux = dx / len;
		const uy = dy / len;
		const nx = -uy;
		const ny = ux;
		const bx = x2 - ux * dlzka;
		const by = y2 - uy * dlzka;
		return `${x2},${y2} ${bx + nx * sirka},${by + ny * sirka} ${bx - nx * sirka},${by - ny * sirka}`;
	}

	let n = $derived(Math.max(1, Math.round(vstup.n)));
	let stlpiky = $derived(deliaceStlpiky(vstup.s, n));
	let smer = $derived(smerZOtvarania(vstup.otvaranie));
	let kolajnicaPopis = $derived(popisRucnejKolajnice(vstup.kolajnica));
	let maKlin = $derived(!!vstup.klin);
	// #168 bod 3: ktoré krídlo(á) sú pohyblivé (šípka priamo v elevácii) — čisto
	// odvodené z n+smer, žiadne nové vstupné pole (viď design komentár #168).
	let pohyblive = $derived(pohyblivePanely(n, smer));
</script>

<VykresovyHarok pageW={PAGE_W} pageH={PAGE_H} margin={MARGIN} gridBand={GRID_BAND}>
	{#snippet content(oblast)}
		{@const klinH = maKlin ? oblast.h * 0.16 : 0}
		<!-- #168 bod 2: hlavička (nadpis/podnadpis) potrebuje viac miesta pre
		     MIN_TITLE_FONT/MIN_SUBTITLE_FONT (predtým 0.07 pri menších fontoch 4,5/3) -->
		{@const headH = oblast.h * 0.09}
		{@const smerH = smer ? oblast.h * 0.08 : 0}
		{@const kolH = kolajnicaPopis ? oblast.h * 0.05 : 0}
		{@const ralH = vstup.ral ? oblast.h * 0.06 : 0}
		{@const elevY = oblast.y + headH + klinH}
		{@const elevH = Math.max(10, oblast.h - headH - klinH - smerH - kolH - ralH)}
		{@const head = { x: oblast.x, y: oblast.y, w: oblast.w, h: headH }}
		{@const klinR = { x: oblast.x, y: oblast.y + headH, w: oblast.w, h: klinH }}
		{@const elev = { x: oblast.x, y: elevY, w: oblast.w, h: elevH }}
		{@const smerR = { x: oblast.x, y: elevY + elevH, w: oblast.w, h: smerH }}
		{@const kolR = { x: oblast.x, y: elevY + elevH + smerH, w: oblast.w, h: kolH }}
		{@const ralR = { x: oblast.x, y: oblast.y + oblast.h - ralH, w: oblast.w, h: ralH }}

		<g data-testid="zn-nadpis">
			{@render nadpis(head)}
		</g>
		{#if maKlin}
			<g data-testid="zn-klin">
				{@render klinView(klinR)}
			</g>
		{/if}
		<g data-testid="zn-elevacia">
			{@render elevacia(elev)}
		</g>
		{#if smer}
			<g data-testid="zn-smer">
				{@render smerSipky(smerR)}
			</g>
		{/if}
		{#if kolajnicaPopis}
			<g data-testid="zn-kolajnica">
				{@render kolajnicaText(kolR)}
			</g>
		{/if}
		{#if vstup.ral}
			<g data-testid="zn-ral">
				{@render ralText(ralR)}
			</g>
		{/if}
	{/snippet}
</VykresovyHarok>

<!-- ============================= nadpis (žiadny rámček — #162 bod 4) ============================= -->
<!-- #168 bod 2: MIN_TITLE_FONT/MIN_SUBTITLE_FONT (predtým 4,5/3 — pod pečiatkovým
     tb-nazov=4, hoci na tomto hárku bez pečiatky je toto JEDINÉ miesto s menom zákazky) -->
{#snippet nadpis(r: { x: number; y: number; w: number; h: number })}
	<text
		x={r.x}
		y={r.y + MIN_TITLE_FONT}
		font-size={MIN_TITLE_FONT}
		fill={CIERNA}
		font-weight="700"
		data-testid="zn-titul">{vstup.nazov || 'ZASKLENIE — NÁVRH'}</text
	>
	<text
		x={r.x}
		y={r.y + r.h - 1}
		font-size={MIN_SUBTITLE_FONT}
		fill={CIERNA}
		data-testid="zn-system">{nazovSysStyl(vstup.sysStyl)} · {datum}</text
	>
{/snippet}

<!-- ============================= klín nad posuvom ============================= -->
{#snippet klinView(r: { x: number; y: number; w: number; h: number })}
	{@const k = vstup.klin}
	{#if k}
		{@const scale = fitScale(vstup.s, Math.max(k.v1, k.v2, 1), r.w * 0.6, r.h * 0.7)}
		{@const x0 = r.x + r.w * 0.2}
		{@const base = r.y + r.h - 4}
		{@const w = Math.min(r.w * 0.6, k.dlzka * scale)}
		{@const x1 = x0 + w}
		{@const maxV = Math.max(k.v1, k.v2, 1)}
		{@const y1 = base - (k.v1 / maxV) * (r.h * 0.5)}
		{@const y2 = base - (k.v2 / maxV) * (r.h * 0.5)}
		<polygon
			points={`${x0},${base} ${x0},${y1} ${x1},${y2} ${x1},${base}`}
			fill={farebny ? farba.hex : '#fef3c7'}
			stroke={CIERNA}
			stroke-width="0.5"
			data-testid="zn-klin-obrys"
		/>
		<Kota
			{x0}
			y0={base + 6}
			{x1}
			y1={base + 6}
			text={`${k.ks}× klín ${fmtMm(k.dlzka)} × ${fmtMm(k.sirka)} mm`}
			color={MODRA}
			fontSize={3}
		/>
		<text
			x={x0 - 2}
			y={y1 - 2}
			text-anchor="end"
			font-size={MIN_DIM_FONT}
			fill={MODRA}
			data-testid="zn-klin-v1">v1 {fmtMm(k.v1)} mm</text
		>
		<text x={x1 + 2} y={y2 - 2} font-size={MIN_DIM_FONT} fill={MODRA} data-testid="zn-klin-v2"
			>v2 {fmtMm(k.v2)} mm</text
		>
	{/if}
{/snippet}

<!-- ============================= predný pohľad ============================= -->
{#snippet elevacia(r: { x: number; y: number; w: number; h: number })}
	<!-- #168 bod 1: `fitCentered` NAHRÁDZA doterajší fixný `baseY = r.y + r.h*0.85`
	     odsad — pri pomerovo širokom/nízkom obsahu (napr. 4200×2100mm) vo vysokej
	     oblasti bola mierka limitovaná ŠÍRKOU a ušetrená výška sa hromadila HORE
	     ako prázdny pás (design komentár #168, nález 1 "horná tretina prázdna").
	     Vycentrovanie rieši oba smery naraz, so zdieľaným cieľom 60-75% plochy. -->
	{@const fit = fitCentered(vstup.s, vstup.v, r)}
	{@const scale = fit.scale}
	{@const baseY = fit.y1}
	{@const topY = fit.y0}
	{@const X = (mm: number) => fit.x0 + mm * scale}
	{@const minKridloMm = Math.min(...stlpiky.slice(1).map((x, i) => x - stlpiky[i]!))}
	{@const ramMm = Math.min(RAM_VIZ_MM, minKridloMm * 0.3, vstup.v * 0.3)}
	{@const mulMm = Math.min(MULLION_VIZ_MM, minKridloMm * 0.4)}

	<!-- vonkajší rám (celá jednotka) — plnená farba/technická svetlá výplň,
	     medzery medzi tabuľami skla nižšie SÚ deliace stĺpiky (rovnaká technika
	     ako reálne CAD elevácie — rám sa nekreslí ako samostatné pásy).
	     #162 review nález (deep review): na rozdiel od pergolového stĺpu/nosníka
	     (jeden dlhý rozmer, druhý vždy vizuálne konštantný) má TÁTO jednotka OBA
	     rozmery nezávisle v rozsahu S_MIN..S_MAX / V_MIN..V_MAX — `obrysStroke()`
	     preto musí brať MENŠÍ z (šírka, výška), nikdy len výšku (inak pri
	     S=300/V=20000 ostane úzka šírka nechránená plnou hrúbkou obrysu). -->
	{@const ramW = X(vstup.s) - X(0)}
	{@const ramH = baseY - topY}
	<rect
		x={X(0)}
		y={topY}
		width={ramW}
		height={ramH}
		fill={farebny ? farba.hex : '#fff'}
		stroke={CIERNA}
		stroke-width={obrysStroke(Math.min(ramW, ramH) * 0.5)}
		shape-rendering="crispEdges"
		data-testid="zn-elevation-ram"
	/>
	<!-- sklá jednotlivých krídel — inset od vonkajšieho rámu a od suseda.
	     #162 review nález: pevný stroke-width="0.3" mohol pri extrémnom vstupe
	     (S_MIN/N_MAX -> veľmi úzke krídlo) prehltnúť celú svetlú výplň — rovnaký
	     `obrysStroke()` guard ako vonkajší rám vyššie (#153 disciplína). -->
	<!-- stlpiky.length === n+1 (deliaceStlpiky) → stlpiky[i], stlpiky[i+1] pre i∈[0,n) definované -->
	{#each Array(n) as _, i (i)}
		{@const left = stlpiky[i]! + (i === 0 ? ramMm : mulMm / 2)}
		{@const right = stlpiky[i + 1]! - (i === n - 1 ? ramMm : mulMm / 2)}
		{@const gx0 = X(left)}
		{@const gx1 = Math.max(gx0 + 0.5, X(right))}
		{@const gh = baseY - topY - 2 * ramMm * scale}
		<rect
			x={gx0}
			y={topY + ramMm * scale}
			width={gx1 - gx0}
			height={gh}
			fill="#eff6ff"
			stroke={CIERNA}
			stroke-width={obrysStroke(Math.min(gx1 - gx0, gh) * 0.5)}
			data-testid={`zn-kridlo-${i}`}
		/>
	{/each}

	<!-- #168 bod 3: sipka na POHYBLIVOM kridle (smer posunu) — vzor z realneho
	     Solid Edge vykresu OP260027 (sipka priamo v zvyraznenej sekcii + text
	     "dvere posuv. do lava" pod kresbou, vid design komentar #168). Fixne
	     kridla ostavaju neoznacene (rovnaka konvencia ako vzor — len pohyblive
	     sa zvyraznuju). -->
	{#each pohyblive as p (p.index)}
		{@const left = stlpiky[p.index]! + (p.index === 0 ? ramMm : mulMm / 2)}
		{@const right = stlpiky[p.index + 1]! - (p.index === n - 1 ? ramMm : mulMm / 2)}
		{@const gx0 = X(left) + 2}
		{@const gx1 = Math.max(gx0 + 2, X(right) - 2)}
		{@const midY = (topY + baseY) / 2}
		{@const od = p.znamienko === -1 ? gx1 : gx0}
		{@const po = p.znamienko === -1 ? gx0 : gx1}
		<g data-testid={`zn-pohyblive-pole-${p.index}`}>
			<line x1={od} y1={midY} x2={po} y2={midY} stroke={CIERNA} stroke-width="0.6" />
			<polygon points={sipka(od, midY, po, midY, 4, 2.2)} fill={CIERNA} />
		</g>
	{/each}

	<!-- kóty krídel + celková šírka -->
	{#each Array(n) as _, i (i)}
		<Kota
			x0={X(stlpiky[i]!)}
			y0={baseY}
			x1={X(stlpiky[i + 1]!)}
			y1={baseY}
			perpOffset={r.h * 0.06}
			text={fmtMm(stlpiky[i + 1]! - stlpiky[i]!)}
			color={MODRA}
			fontSize={3}
		/>
	{/each}
	<Kota
		x0={X(0)}
		y0={baseY}
		x1={X(vstup.s)}
		y1={baseY}
		perpOffset={r.h * 0.13}
		text={fmtMm(vstup.s)}
		color={MODRA}
		fontSize={3.2}
	/>
	<Kota
		x0={X(0)}
		y0={baseY}
		x1={X(0)}
		y1={topY}
		perpOffset={-(r.w * 0.06)}
		text={fmtMm(vstup.v)}
		color={MODRA}
		fontSize={3.2}
	/>
{/snippet}

<!-- ============================= smer otvárania ============================= -->
{#snippet smerSipky(r: { x: number; y: number; w: number; h: number })}
	{@const y = r.y + r.h * 0.5}
	{@const xL = r.x + r.w * 0.12}
	{@const xR = r.x + r.w * 0.88}
	{#if smer === 'PL'}
		<line x1={xL} y1={y} x2={xR} y2={y} stroke={CIERNA} stroke-width="0.6" />
		<polygon points={sipka(xL, y, xR, y, 5, 2.5)} fill={CIERNA} />
	{:else if smer === 'LP'}
		<line x1={xR} y1={y} x2={xL} y2={y} stroke={CIERNA} stroke-width="0.6" />
		<polygon points={sipka(xR, y, xL, y, 5, 2.5)} fill={CIERNA} />
	{:else if smer === 'OP'}
		{@const mid = (xL + xR) / 2}
		<line x1={xL} y1={y} x2={mid - 3} y2={y} stroke={CIERNA} stroke-width="0.6" />
		<polygon points={sipka(xL, y, mid - 3, y, 5, 2.5)} fill={CIERNA} />
		<line x1={xR} y1={y} x2={mid + 3} y2={y} stroke={CIERNA} stroke-width="0.6" />
		<polygon points={sipka(xR, y, mid + 3, y, 5, 2.5)} fill={CIERNA} />
	{/if}
	<text
		x={(xL + xR) / 2}
		y={y + 6}
		text-anchor="middle"
		font-size="3"
		fill={CIERNA}
		data-testid="zn-smer-text">{vstup.otvaranie || '—'}</text
	>
{/snippet}

<!-- ============================= ručná koľajnica (ak zadaná) ============================= -->
{#snippet kolajnicaText(r: { x: number; y: number; w: number; h: number })}
	<text
		x={r.x + r.w / 2}
		y={r.y + r.h * 0.6}
		text-anchor="middle"
		font-size="3"
		fill={CIERNA}
		data-testid="zn-kolajnica-text">{kolajnicaPopis}</text
	>
{/snippet}

<!-- ============================= RAL popis ============================= -->
{#snippet ralText(r: { x: number; y: number; w: number; h: number })}
	<text
		x={r.x}
		y={r.y + r.h - 2}
		font-size="4"
		fill={CERVENA}
		font-weight="700"
		data-testid="zn-ral-text">RAL: {vstup.ral}</text
	>
{/snippet}
