<script lang="ts">
	// Pergola — zákaznícky NÁVRHOVÝ výkres (#138, vzor OP260032). Celý hárok postavený
	// na zdieľanom základe #137 (VykresovyHarok + Kota + TitleBlock + mierka.ts) —
	// žiadny vlastný <svg>/rám, žiadna vlastná pečiatka. Päť pohľadov: predný pohľad,
	// bočný rez (VIEW A), detail strešnej výplne, 3D izometria (ZVOD šípky), texty.
	//
	// Presné vzorce (spád, svetlá výška, rozmery výplne) a ZDÔVODNENÁ nezrovnalosť
	// oproti vzorovým "2200"/"4,3°" — viď design komentár na #138 a hlavičku
	// `$lib/pergola-navrh.ts`. Táto komponenta len KRESLÍ už hotovú geometriu.
	import VykresovyHarok from '$lib/components/vykres/VykresovyHarok.svelte';
	import Kota from '$lib/components/vykres/Kota.svelte';
	import { fitScale, fmtMm, fmtDeg, angleDimension } from '$lib/vykres/kota';
	import { vypocitajMierku } from '$lib/vykres/mierka';
	import { projekciaUsecky, projekcia3D, hraniceProjekcie, type Bod3D } from '$lib/vykres/iso';
	import {
		vypocitajGeometriu,
		izometriaHrany,
		zvodoveBody,
		poznamkaKotva,
		type PergolaNavrhVstup
	} from '$lib/pergola-navrh';

	let {
		vstup,
		datum
	}: {
		vstup: PergolaNavrhVstup;
		/** už naformátovaný dátum zo servera (formatDatumCasSk) */
		datum: string;
	} = $props();

	const PAGE_W = 297;
	const PAGE_H = 210;
	const MARGIN = 6;
	const GRID_BAND = 5;
	const OBLAST_W = PAGE_W - 2 * MARGIN - 2 * GRID_BAND;
	const OBLAST_H = PAGE_H - 2 * MARGIN - 2 * GRID_BAND;

	let g = $derived(vypocitajGeometriu(vstup));

	// #144: OP číslo / vypracoval / revízia sú voliteľné (VO odberateľ nemá Montalu OP
	// číslo) — prázdna hodnota sa v pečiatke vykreslí ako „—", rovnaký čestný-neznáme
	// idiom aký už používa `vypocitajMierku` (nikdy prázdny text, nikdy natvrdo predstierané
	// "0"/meno).
	const emDash = (s: string) => (s.trim() ? s : '—');

	let titleBlockData = $derived({
		nazov: vstup.nazov || 'PERGOLA — NÁVRH',
		projekt: 'automatizacie-montalu',
		cisloVykresu: emDash(vstup.op),
		// čestná mierka sa počíta z REÁLNEJ najväčšej kresby na hárku (izometria/pôdorys
		// šírka) voči dostupnej ploche — presný výpočet nižšie v `content` snippete by
		// vyžadoval dvojfázový render; tu použijeme celkovú šírku ako limitujúci rozmer
		// (rovnaká disciplína ako `vypocitajMierku`, nikdy natvrdo "1:20")
		mierka: vypocitajMierku(
			g.celkovaSirka,
			Math.max(vstup.vyskaPriStene, vstup.hlbka),
			OBLAST_W * 0.66,
			OBLAST_H
		),
		revizia: emDash(vstup.revizia),
		varianta: vstup.varianta || 'NAVRH',
		vypracoval: emDash(vstup.vypracoval),
		datum
	});

	const CIERNA = '#0f172a';
	const MODRA = '#1d4ed8';
	const CERVENA = '#dc2626';

	/** Vrcholy trojuholníkovej šípky na konci úsečky (x1,y1)→(x2,y2), hrot v (x2,y2). */
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

	/** Zalomená ("break") čiara pre skrátené zobrazenie dlhého panelu — CAD konvencia. */
	function zigzag(xLeft: number, xRight: number, y: number, amp = 2.2): string {
		const q = (xRight - xLeft) / 4;
		const mid = (xLeft + xRight) / 2;
		return `M ${xLeft} ${y} L ${xLeft + q} ${y - amp} L ${mid} ${y + amp} L ${xRight - q} ${y - amp} L ${xRight} ${y}`;
	}
</script>

<VykresovyHarok
	pageW={PAGE_W}
	pageH={PAGE_H}
	margin={MARGIN}
	gridBand={GRID_BAND}
	titleBlock={titleBlockData}
>
	{#snippet content(oblast)}
		{@const topH = oblast.h * 0.38}
		{@const gap = oblast.w * 0.015}
		{@const pd = { x: oblast.x, y: oblast.y, w: oblast.w * 0.14, h: topH }}
		{@const fe = { x: oblast.x + oblast.w * 0.17, y: oblast.y, w: oblast.w * 0.45, h: topH }}
		{@const sec = { x: oblast.x + oblast.w * 0.65, y: oblast.y, w: oblast.w * 0.33, h: topH }}
		{@const iso = {
			x: oblast.x,
			y: oblast.y + topH + gap,
			w: oblast.w * 0.65,
			h: oblast.h - topH - gap
		}}
		{@const textCol = {
			x: oblast.x + oblast.w * 0.68,
			y: oblast.y + topH + gap,
			w: oblast.w * 0.3,
			h: oblast.h * 0.28
		}}

		<g data-testid="pn-panel-detail">
			{@render panelDetail(pd)}
		</g>
		<g data-testid="pn-elevation">
			{@render elevation(fe)}
		</g>
		<g data-testid="pn-section">
			{@render section(sec)}
		</g>
		<g data-testid="pn-isometria">
			{@render izometria(iso)}
		</g>
		<g data-testid="pn-texty">
			{@render texty(textCol)}
		</g>
	{/snippet}
</VykresovyHarok>

<!-- ============================= detail strešnej výplne ============================= -->
{#snippet panelDetail(r: { x: number; y: number; w: number; h: number })}
	{@const dlzkaPx = r.h * 0.66}
	{@const sirkaPx = Math.min(r.w * 0.6, dlzkaPx * 0.42)}
	{@const x0 = r.x + r.w * 0.28}
	{@const x1 = x0 + sirkaPx}
	{@const y0 = r.y + r.h * 0.06}
	{@const y1 = y0 + dlzkaPx}
	<rect
		x={x0}
		y={y0}
		width={x1 - x0}
		height={y1 - y0}
		fill="#eff6ff"
		stroke={CIERNA}
		stroke-width="0.4"
		data-testid="pn-panel-obrys"
	/>
	<path
		d={zigzag(x0, x1, y0 + dlzkaPx * 0.35, 1.6)}
		stroke={CIERNA}
		stroke-width="0.35"
		fill="none"
	/>
	<path
		d={zigzag(x0, x1, y0 + dlzkaPx * 0.65, 1.6)}
		stroke={CIERNA}
		stroke-width="0.35"
		fill="none"
	/>
	<Kota
		x0={x0 - 3}
		{y0}
		x1={x0 - 3}
		{y1}
		perpOffset={-8}
		text={fmtMm(g.panelDlzka) + ' mm'}
		fontSize={3}
		color={MODRA}
	/>
	<Kota
		{x0}
		y0={y1 + 3}
		{x1}
		y1={y1 + 3}
		perpOffset={8}
		text={fmtMm(g.panelSirka) + ' mm'}
		fontSize={3}
		color={MODRA}
	/>
	<text
		x={r.x + r.w / 2}
		y={y1 + 14}
		text-anchor="middle"
		font-size="3"
		fill={CIERNA}
		font-weight="600"
		data-testid="pn-panel-pocet">{Math.round(vstup.panelPocet)}ks strešná výplň</text
	>
{/snippet}

<!-- ============================= predný pohľad ============================= -->
{#snippet elevation(r: { x: number; y: number; w: number; h: number })}
	{@const scale = fitScale(g.celkovaSirka, vstup.vyskaVpredu, r.w * 0.8, r.h * 0.6)}
	{@const baseY = r.y + r.h * 0.8}
	{@const x0 = r.x + r.w * 0.12}
	{@const X = (mm: number) => x0 + mm * scale}
	{@const topY = baseY - vstup.vyskaVpredu * scale}
	{@const roofH = Math.max(2, r.h * 0.03)}
	{@const n = Math.max(1, Math.round(vstup.panelPocet))}
	<text
		x={r.x + r.w * 0.5}
		y={r.y - 1}
		text-anchor="middle"
		font-size="3"
		fill={CIERNA}
		font-weight="600">PREDNÝ POHĽAD</text
	>
	<!-- strešná doska s naznačenou výplňou -->
	<rect
		x={X(0)}
		y={topY - roofH}
		width={X(g.celkovaSirka) - X(0)}
		height={roofH}
		fill="#eff6ff"
		stroke={CIERNA}
		stroke-width="0.35"
	/>
	<g stroke={CIERNA} stroke-width="0.2">
		{#each Array(n - 1) as _, i (i)}
			{@const x = X((g.celkovaSirka * (i + 1)) / n)}
			<line x1={x} y1={topY - roofH} x2={x} y2={topY} />
		{/each}
	</g>
	<!-- stĺpy -->
	{#each g.postX as px, i (i)}
		<line
			x1={X(px)}
			y1={baseY}
			x2={X(px)}
			y2={topY}
			stroke={CIERNA}
			stroke-width="0.6"
			data-testid="pn-elevation-post-{i}"
		/>
	{/each}
	<!-- kóty polí + celková šírka -->
	{#each vstup.polia as p, i (i)}
		<Kota
			x0={X(g.postX[i])}
			y0={baseY}
			x1={X(g.postX[i + 1])}
			y1={baseY}
			perpOffset={r.h * 0.06}
			text={fmtMm(p) + ' mm'}
			color={MODRA}
			fontSize={3}
		/>
	{/each}
	<Kota
		x0={X(0)}
		y0={baseY}
		x1={X(g.celkovaSirka)}
		y1={baseY}
		perpOffset={r.h * 0.16}
		text={fmtMm(g.celkovaSirka) + ' mm'}
		color={MODRA}
		fontSize={3.2}
	/>
	<!-- výšky: vpredu (vľavo, celá) / svetlá výška (vpravo, po spodok nosníka) -->
	<Kota
		x0={X(0)}
		y0={baseY}
		x1={X(0)}
		y1={topY}
		perpOffset={-(r.w * 0.06)}
		text={fmtMm(vstup.vyskaVpredu) + ' mm'}
		color={MODRA}
		fontSize={3}
	/>
	<Kota
		x0={X(g.celkovaSirka)}
		y0={baseY}
		x1={X(g.celkovaSirka)}
		y1={baseY - g.svetlaVyska * scale}
		perpOffset={r.w * 0.06}
		text={fmtMm(g.svetlaVyska) + ' mm'}
		color={MODRA}
		fontSize={3}
	/>
	<!-- smer rezu A -->
	<text
		x={r.x + r.w + 3}
		y={topY + 3}
		font-size="3.4"
		fill={CIERNA}
		font-weight="700"
		data-testid="pn-rez-a">A</text
	>
	<polygon points={sipka(r.x + r.w - 4, topY, r.x + r.w + 2, topY, 3, 1.6)} fill={CIERNA} />
{/snippet}

<!-- ============================= bočný rez (VIEW A) ============================= -->
{#snippet section(r: { x: number; y: number; w: number; h: number })}
	{@const maxV = Math.max(vstup.vyskaVpredu, vstup.vyskaPriStene)}
	{@const scale = fitScale(vstup.hlbka, maxV, r.w * 0.75, r.h * 0.6)}
	{@const baseY = r.y + r.h * 0.8}
	{@const xWall = r.x + r.w * 0.18}
	{@const xFront = xWall + vstup.hlbka * scale}
	{@const yWallTop = baseY - vstup.vyskaPriStene * scale}
	{@const yFrontTop = baseY - vstup.vyskaVpredu * scale}
	{@const yClearTop = baseY - g.svetlaVyska * scale}
	{@const arc = angleDimension(xWall, yWallTop, 7, 90, 90 + g.sklonDeg)}
	<text
		x={r.x + r.w * 0.5}
		y={r.y - 1}
		text-anchor="middle"
		font-size="3"
		fill={CIERNA}
		font-weight="600">REZ A</text
	>
	<line
		x1={xWall}
		y1={baseY}
		x2={xWall}
		y2={yWallTop}
		stroke={CIERNA}
		stroke-width="0.6"
		data-testid="pn-section-stena"
	/>
	<line
		x1={xFront}
		y1={baseY}
		x2={xFront}
		y2={yFrontTop}
		stroke={CIERNA}
		stroke-width="0.7"
		data-testid="pn-section-predok"
	/>
	<line
		x1={xWall}
		y1={yWallTop}
		x2={xFront}
		y2={yFrontTop}
		stroke={CIERNA}
		stroke-width="0.5"
		data-testid="pn-section-strecha"
	/>
	<path d={arc.arcPath} stroke={MODRA} stroke-width="0.35" fill="none" />
	<!-- NEUŽÍVAME arc.label — jeho fixný odsah "r+12" (kota.ts) je v tomto malom
	     kompaktnom náhľade neúmerne veľký (vytláča popisok mimo oblasť rezu), takže
	     popisok umiestňujeme sami, blízko rohu oblúka. -->
	<text
		x={xWall + 4}
		y={yWallTop - 2}
		text-anchor="middle"
		font-size="2.8"
		fill={MODRA}
		font-weight="600"
		data-testid="pn-sklon">{fmtDeg(g.sklonDeg)}</text
	>
	<!-- výšky: stena (vonkajšia, ľavá) / svetlá výška (vnútorná, pri predku) -->
	<Kota
		x0={xWall}
		y0={baseY}
		x1={xWall}
		y1={yWallTop}
		perpOffset={-(r.w * 0.1)}
		text={fmtMm(vstup.vyskaPriStene) + ' mm'}
		color={MODRA}
		fontSize={3}
	/>
	<Kota
		x0={xFront}
		y0={baseY}
		x1={xFront}
		y1={yClearTop}
		perpOffset={r.w * 0.06}
		text={fmtMm(g.svetlaVyska) + ' mm'}
		color={MODRA}
		fontSize={3}
	/>
	<Kota
		x0={xWall}
		y0={baseY}
		x1={xFront}
		y1={baseY}
		perpOffset={r.h * 0.14}
		text={fmtMm(vstup.hlbka) + ' mm'}
		color={MODRA}
		fontSize={3.2}
	/>
	<text
		x={(xWall + xFront) / 2}
		y={baseY + r.h * 0.22}
		text-anchor="middle"
		font-size="3"
		fill={CIERNA}
		font-weight="600">VIEW A</text
	>
{/snippet}

<!-- ============================= 3D izometria ============================= -->
{#snippet izometria(r: { x: number; y: number; w: number; h: number })}
	{@const hrany = izometriaHrany(g, vstup)}
	{@const zvody = zvodoveBody(vstup, g)}
	{@const poznamka = poznamkaKotva(g, vstup)}
	{@const vsetkyBody: Bod3D[] = [...hrany.flatMap((h) => [h.a, h.b]), ...zvody.map((z) => z.bod), poznamka]}
	{@const bbox1 = hraniceProjekcie(vsetkyBody, 1)}
	{@const isoScale = bbox1
		? fitScale(bbox1.maxX - bbox1.minX || 1, bbox1.maxY - bbox1.minY || 1, r.w * 0.86, r.h * 0.72)
		: 1}
	{@const bbox = hraniceProjekcie(vsetkyBody, isoScale)}
	{@const offX = bbox ? r.x + r.w * 0.08 - bbox.minX : r.x}
	{@const offY = bbox ? r.y + r.h * 0.06 - bbox.minY : r.y}
	<text
		x={r.x + r.w / 2}
		y={r.y - 1}
		text-anchor="middle"
		font-size="3"
		fill={CIERNA}
		font-weight="600">3D — IZOMETRICKÝ POHĽAD</text
	>
	<g stroke={CIERNA} fill="none" data-testid="pn-iso-hrany">
		{#each hrany as h, i (i)}
			{@const s = projekciaUsecky(h.a, h.b, isoScale)}
			<line
				x1={s.x1 + offX}
				y1={s.y1 + offY}
				x2={s.x2 + offX}
				y2={s.y2 + offY}
				stroke-width={h.hlavna ? 0.7 : 0.3}
			/>
		{/each}
	</g>
	{#each zvody as z, i (i)}
		{@const p = projekcia3D(z.bod, isoScale)}
		{@const px = p.x + offX}
		{@const py = p.y + offY}
		{@const lx = px + (z.strana === 'predna' ? -1 : 1) * r.w * 0.1}
		{@const ly = py + r.h * 0.16}
		<line
			x1={lx}
			y1={ly}
			x2={px}
			y2={py}
			stroke={CIERNA}
			stroke-width="0.3"
			data-testid="pn-zvod-cira"
		/>
		<polygon points={sipka(lx, ly, px, py, 2.6, 1.3)} fill={CIERNA} />
		<text
			x={lx}
			y={ly + 3}
			text-anchor="middle"
			font-size="2.6"
			fill={CIERNA}
			font-weight="600"
			data-testid="pn-zvod-label">ZVOD</text
		>
	{/each}
	{#if vstup.poznamkaIzometria}
		{@const p = projekcia3D(poznamka, isoScale)}
		{@const px = p.x + offX}
		{@const py = p.y + offY}
		{@const lx = r.x + r.w * 0.62}
		{@const ly = r.y + r.h * 0.18}
		<line x1={lx} y1={ly} x2={px} y2={py} stroke={CIERNA} stroke-width="0.3" />
		<polygon points={sipka(lx, ly, px, py, 2.6, 1.3)} fill={CIERNA} />
		<text x={lx + 2} y={ly - 1} font-size="2.8" fill={CIERNA} data-testid="pn-poznamka-izometria"
			>{vstup.poznamkaIzometria}</text
		>
	{/if}
{/snippet}

<!-- ============================= texty (výplň/etapa, RAL) ============================= -->
{#snippet texty(r: { x: number; y: number; w: number; h: number })}
	{#if vstup.textVyplne}
		<text
			x={r.x}
			y={r.y + 4}
			font-size="3.2"
			fill={MODRA}
			font-weight="600"
			style="white-space:pre"
			data-testid="pn-text-vyplne">{vstup.textVyplne}</text
		>
	{/if}
	{#if vstup.ral}
		<text
			x={r.x}
			y={r.y + r.h - 2}
			font-size="4"
			fill={CERVENA}
			font-weight="700"
			data-testid="pn-ral">RAL: {vstup.ral}</text
		>
	{/if}
{/snippet}
