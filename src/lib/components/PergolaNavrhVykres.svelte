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
		farbaKonstrukcie,
		ciarovaFarba,
		NOSNIK_HRUBKA_MM,
		STLP_HRUBKA_VIZ_MM,
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
	// deep-review nález (#146): predtým bola `content` snippetu hardcoded lokálna
	// `TB_H = 50` ktorá musela ručne sedieť s `VykresovyHarok`'s internym defaultom
	// (`tbH = titleBlock?.height ?? 50`) — nič to nevynucovalo, tichý rozchod pri
	// zmene jedného z nich by textCol posunul cez pečiatku. Namiesto dvoch čísel:
	// JEDNA konštanta poslaná explicitne ako `titleBlockData.height` nižšie.
	const TB_H = 50;

	let g = $derived(vypocitajGeometriu(vstup));

	// #150: farebný režim vyfarbuje LEN konštrukciu (fill vyplnených tvarov;
	// izometria je čisto líniová bez fill, tam sa stroke sfarbí priamo cez
	// `ciarovaFarba`, ktorá stmaví svetlé odtiene). Kóty/poznámky/raster/pečiatka
	// sa nemenia.
	//
	// Vizuálna iterácia (render + zoom screenshot 9006 STRIEBORNÁ) odhalila:
	// existujúci CIERNA `stroke` na stĺpoch/streche NIE JE vždy len "tenký obrys" —
	// stĺpy sa pri bežnej mierke kreslia UŽŠIE než pôvodná hrúbka obrysu
	// (STRUKTURA_STROKE=1,8mm, napr. reálny rect width≈1,65mm), takže stred-zarovnaný
	// SVG stroke prekryje CELÚ fill plochu a stĺp vyjde vždy CIERNA bez ohľadu na
	// zvolený RAL. Preto vo farebnom režime obrys FILLED tvarov (streška, stĺpy,
	// predný stĺp v reze) používa tenšiu STRUKTURA_STROKE_VEDLAJSIA (0,4mm — presne
	// zodpovedá zadaniu "tenký tmavý obrys"), nie hrubú STRUKTURA_STROKE — fill sa
	// tak reálne uvidí. Technický režim je NEZMENENÝ (stroke-width tam ostáva
	// pôvodné STRUKTURA_STROKE, presne ako pred #150).
	let farebny = $derived(vstup.rezimVykresu === 'farebny');
	let farba = $derived(farbaKonstrukcie(vstup.ralKod));
	let iznKonstrukcia = $derived(ciarovaFarba(farba));

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
		datum,
		height: TB_H
	});

	const CIERNA = '#0f172a';
	const MODRA = '#1d4ed8';
	const CERVENA = '#dc2626';

	// #146 bod 2/3: hierarchia hrúbok čiar — konštrukčné obrysy (stĺpy, nosníky,
	// hlavné hrany izometrie) sú NAJHRUBŠIE (STRUKTURA_STROKE), kóty/odkazové čiary
	// sú tenšie (Kota.svelte, 0.7/0.4), raster hárku najtenší (VykresovyHarok, 0.2-0.5).
	const STRUKTURA_STROKE = 1.8;
	const STRUKTURA_STROKE_VEDLAJSIA = 0.4;
	// previs strechy (eave) oproti vonkajšej hrane stĺpa/steny [mm] — len vizuálne,
	// rovnaká disciplína ako STLP_HRUBKA_VIZ_MM (nevstupuje do žiadneho výpočtu)
	const PREVIS_VIZ_MM = 60;

	/** Polovičná hrúbka stĺpa v PX pri danej mierke — orezaná zdola (nikdy nezmizne
	 *  pri veľmi malej mierke) aj zhora (nikdy nepretečie do susedného poľa pri
	 *  minimálnom rozpätí ROZPATIE_MIN=500mm). */
	function stlpHalfW(scale: number, maxPx: number): number {
		return Math.min(Math.max((STLP_HRUBKA_VIZ_MM * scale) / 2, 0.5), maxPx);
	}

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
		<!-- #146 bod 4: rozloženie podľa vzoru OP260032 (detail vľavo hore, predný
		     pohľad v strede hore, REZ A vpravo hore, izometria vľavo dole, texty/RAL
		     vpravo dole NAD pečiatkou) + vyplniť prázdne plochy/pohľady väčšie —
		     topH zväčšený z 0.38 na 0.40, textCol už nesedí na pevný zlomok výšky ale
		     siaha až tesne nad pečiatku. Výška pečiatky je skriptová konštanta `TB_H`
		     poslaná explicitne cez `titleBlockData.height` vyššie (deep-review nález
		     #146 — predtým dve nezávislé "50" duplicity, ktoré sa museli ručne zhodovať). -->
		{@const topH = oblast.h * 0.4}
		{@const gap = oblast.w * 0.015}
		{@const pd = { x: oblast.x, y: oblast.y, w: oblast.w * 0.16, h: topH }}
		{@const fe = { x: oblast.x + oblast.w * 0.19, y: oblast.y, w: oblast.w * 0.45, h: topH }}
		{@const sec = { x: oblast.x + oblast.w * 0.66, y: oblast.y, w: oblast.w * 0.34, h: topH }}
		{@const iso = {
			x: oblast.x,
			y: oblast.y + topH + gap,
			w: oblast.w * 0.65,
			h: oblast.h - topH - gap
		}}
		{@const textCol = {
			x: oblast.x + oblast.w * 0.68,
			y: oblast.y + topH + gap,
			w: oblast.w - oblast.w * 0.68,
			h: Math.max(0, oblast.h - TB_H - 2 - (topH + gap))
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
	<!-- #146 body 1/6: kóty bez "mm" + rect posunutý DOPRAVA (nie centrovaný) s
	     popisom "Nks strešná výplň" VEDĽA (jednoriadkovo, vpravo zarovnaný, medzi
	     dĺžkovou kótou a obrysom) — poradie zľava doprava presne ako vo vzore
	     OP260032: [dĺžková kóta] [popis] [obrys s break-markami]. (deep-review
	     nález: pôvodný komentár tvrdil "dvojriadkovo" — text nižšie je jeden
	     `<text>` bez zalomenia/`<tspan>`, teda jeden riadok; opravené na presné.) -->
	{@const dlzkaPx = r.h * 0.66}
	{@const sirkaPx = Math.min(r.w * 0.42, dlzkaPx * 0.42)}
	{@const x0 = r.x + r.w * 0.56}
	{@const x1 = x0 + sirkaPx}
	{@const y0 = r.y + r.h * 0.06}
	{@const y1 = y0 + dlzkaPx}
	<!-- deep-review nález (#146): pri x0-6 caption a kóta 3411 (posunutá vľavo od
	     nej, viď nižšie) obsadzovali rovnaký ~16mm pás v tomto úzkom 44mm stĺpci —
	     -2 namiesto -6 posúva popis 4mm bližšie k obrysu (stále čisté 2mm medzera
	     od neho) a uvoľní presne toľko miesta kóte na jej ľavej strane. -->
	{@const captionX = x0 - 2}
	{@const captionY = y0 + dlzkaPx / 2}
	<rect
		x={x0}
		y={y0}
		width={x1 - x0}
		height={y1 - y0}
		fill="#eff6ff"
		stroke={CIERNA}
		stroke-width="0.6"
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
	<!-- deep-review nález (#146, 2 kolo): `verticalDimension`'s vlastný dokumentovaný
	     kontrakt (`$lib/vykres/kota.ts`) je "kladné perpOffset = doľava" — pôvodný
	     `perpOffset={-16}` teda posúval kótu DOPRAVA, priamo DO obrysu (cez
	     break-marky). Prvá oprava (perpOffset=21) kótu z obrysu aj popisu dostala,
	     ale posunula `witnessLine`'s pevný `overshoot` (kota.ts, +3mm za tick) ZA
	     ľavú hranicu kresliacej oblasti (`oblast.x`) — nezávislý druhý nález z
	     deep-review. Riešenie: `perpOffset=17` drží ťaháky/witness vnútri hranice
	     (over. render-diff), a `labelOffset` NEZÁVISLE dolaďuje POZÍCIU POPISKU
	     bez zásahu do witness geometrie (kota.ts L99-102) — `labelOffset=0` centruje
	     "3411" presne medzi rámom a popisom "Nks strešná výplň". -->
	<Kota
		x0={x0 - 3}
		{y0}
		x1={x0 - 3}
		{y1}
		perpOffset={17}
		opts={{ tick: 1, labelOffset: 0 }}
		text={fmtMm(g.panelDlzka)}
		fontSize={3}
		color={MODRA}
	/>
	<Kota
		{x0}
		y0={y1 + 3}
		{x1}
		y1={y1 + 3}
		perpOffset={8}
		text={fmtMm(g.panelSirka)}
		fontSize={3}
		color={MODRA}
	/>
	<text
		x={captionX}
		y={captionY}
		text-anchor="end"
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
	{@const roofH = Math.max(1.5, NOSNIK_HRUBKA_MM * scale)}
	{@const previs = PREVIS_VIZ_MM * scale}
	{@const n = Math.max(1, Math.round(vstup.panelPocet))}
	{@const minPole = Math.min(...vstup.polia)}
	{@const postHalfW = stlpHalfW(scale, minPole * scale * 0.4)}
	<!-- #145: nadpis DNU do panela (kladný odsad od r.y), nie -1 nad r.y — r.y je
	     tu presne na hranici hornej rastrovej lišty, "-1" by skončil VNÚTRI nej. -->
	<text
		x={r.x + r.w * 0.5}
		y={r.y + 3}
		text-anchor="middle"
		font-size="3"
		fill={CIERNA}
		font-weight="600">PREDNÝ POHĽAD</text
	>
	<!-- strešná doska (nosník) v reálnej hrúbke (NOSNIK_HRUBKA_MM), s previsom cez
	     krajné stĺpy (#146 bod 2) + naznačenou výplňou (deliace čiarky panelov) -->
	<rect
		x={X(0) - previs}
		y={topY - roofH}
		width={X(g.celkovaSirka) - X(0) + 2 * previs}
		height={roofH}
		fill={farebny ? farba.hex : '#eff6ff'}
		stroke={CIERNA}
		stroke-width={farebny ? STRUKTURA_STROKE_VEDLAJSIA : STRUKTURA_STROKE}
		data-testid="pn-elevation-strecha"
	/>
	<g stroke={CIERNA} stroke-width="0.3">
		{#each Array(n - 1) as _, i (i)}
			{@const x = X((g.celkovaSirka * (i + 1)) / n)}
			<line x1={x} y1={topY - roofH} x2={x} y2={topY} />
		{/each}
	</g>
	<!-- stĺpy — reálna hrúbka v mierke (STLP_HRUBKA_VIZ_MM), nie jednočiarové -->
	{#each g.postX as px, i (i)}
		<rect
			x={X(px) - postHalfW}
			y={topY}
			width={postHalfW * 2}
			height={baseY - topY}
			fill={farebny ? farba.hex : '#fff'}
			stroke={CIERNA}
			stroke-width={farebny ? STRUKTURA_STROKE_VEDLAJSIA : STRUKTURA_STROKE}
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
			text={fmtMm(p)}
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
		text={fmtMm(g.celkovaSirka)}
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
		text={fmtMm(vstup.vyskaVpredu)}
		color={MODRA}
		fontSize={3}
	/>
	<Kota
		x0={X(g.celkovaSirka)}
		y0={baseY}
		x1={X(g.celkovaSirka)}
		y1={baseY - g.svetlaVyska * scale}
		perpOffset={r.w * 0.06}
		text={fmtMm(g.svetlaVyska)}
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
	{@const roofH = Math.max(1.5, NOSNIK_HRUBKA_MM * scale)}
	{@const previs = PREVIS_VIZ_MM * scale}
	{@const postHalfW = stlpHalfW(scale, (xFront - xWall) * 0.15)}
	{@const arc = angleDimension(xWall, yWallTop, 7, 90, 90 + g.sklonDeg)}
	<!-- #145: nadpis DNU do panela (rovnaký fix ako elevation vyššie) -->
	<text
		x={r.x + r.w * 0.5}
		y={r.y + 3}
		text-anchor="middle"
		font-size="3"
		fill={CIERNA}
		font-weight="600">REZ A</text
	>
	<!-- stena — len tenká referenčná čiara (nie profil, mieri to na múr), zvýraznená
	     o niečo viac než kóty, ale ĎALEKO pod hrúbkou skutočného profilu vpravo -->
	<line
		x1={xWall}
		y1={baseY}
		x2={xWall}
		y2={yWallTop}
		stroke={CIERNA}
		stroke-width="1"
		data-testid="pn-section-stena"
	/>
	<!-- strešný profil (nosník) s reálnou hrúbkou (NOSNIK_HRUBKA_MM) a previsom cez
	     predný stĺp (#146 bod 2: "profil strechy so spádom ako pás, previs") — jeden
	     vyplnený tvar, jednoduchý zvislý odsad hrúbky (dostatočne presné pri malom
	     sklone ~pár stupňov) -->
	<path
		d={`M ${xWall} ${yWallTop} L ${xFront + previs} ${yFrontTop} L ${xFront + previs} ${yFrontTop + roofH} L ${xWall} ${yWallTop + roofH} Z`}
		fill={farebny ? farba.hex : CIERNA}
		stroke={CIERNA}
		stroke-width={STRUKTURA_STROKE_VEDLAJSIA}
		data-testid="pn-section-strecha"
	/>
	<!-- predný stĺp — reálna hrúbka v mierke (STLP_HRUBKA_VIZ_MM), vyplnený (CAD
	     konvencia pre koncový/rezový pohľad na profil) — spolu so strechou vyššie
	     tvorí "L" presne ako vo vzore -->
	<rect
		x={xFront - postHalfW}
		y={yFrontTop + roofH}
		width={postHalfW * 2}
		height={baseY - (yFrontTop + roofH)}
		fill={farebny ? farba.hex : CIERNA}
		stroke={farebny ? CIERNA : 'none'}
		stroke-width={farebny ? STRUKTURA_STROKE_VEDLAJSIA : 0}
		data-testid="pn-section-predok"
	/>
	<!-- #146 bod 9: uhlová kóta ako malý oblúk S radius-čiarami k vrcholu (CAD
	     "flag" konvencia), nie voľne plávajúce číslo -->
	<line
		x1={xWall}
		y1={yWallTop}
		x2={arc.start.x}
		y2={arc.start.y}
		stroke={MODRA}
		stroke-width="0.3"
	/>
	<line x1={xWall} y1={yWallTop} x2={arc.end.x} y2={arc.end.y} stroke={MODRA} stroke-width="0.3" />
	<path d={arc.arcPath} stroke={MODRA} stroke-width="0.5" fill="none" />
	<!-- NEUŽÍVAME arc.label — jeho fixný odsah "r+12" (kota.ts) je v tomto malom
	     kompaktnom náhľade neúmerne veľký (vytláča popisok mimo oblasť rezu), takže
	     popisok umiestňujeme sami, tesne pri oblúku (viazaný naň radius-čiarami vyššie). -->
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
		text={fmtMm(vstup.vyskaPriStene)}
		color={MODRA}
		fontSize={3}
	/>
	<Kota
		x0={xFront}
		y0={baseY}
		x1={xFront}
		y1={yClearTop}
		perpOffset={r.w * 0.06}
		text={fmtMm(g.svetlaVyska)}
		color={MODRA}
		fontSize={3}
	/>
	<Kota
		x0={xWall}
		y0={baseY}
		x1={xFront}
		y1={baseY}
		perpOffset={r.h * 0.14}
		text={fmtMm(vstup.hlbka)}
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
	<!-- #146 bod 7: krokvy/hlavné hrany hrubšie (STRUKTURA_STROKE), vedľajšie panelové
	     deliace krokvy tenšie — jasný vizuálny kontrast hlavná vs. vedľajšia hrana -->
	<g stroke={farebny ? iznKonstrukcia : CIERNA} fill="none" data-testid="pn-iso-hrany">
		{#each hrany as h, i (i)}
			{@const s = projekciaUsecky(h.a, h.b, isoScale)}
			<line
				x1={s.x1 + offX}
				y1={s.y1 + offY}
				x2={s.x2 + offX}
				y2={s.y2 + offY}
				stroke-width={h.hlavna ? STRUKTURA_STROKE : STRUKTURA_STROKE_VEDLAJSIA}
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
			stroke-width="0.45"
			data-testid="pn-zvod-cira"
		/>
		<polygon points={sipka(lx, ly, px, py, 3, 1.5)} fill={CIERNA} />
		<text
			x={lx}
			y={ly + 3}
			text-anchor="middle"
			font-size="2.8"
			fill={CIERNA}
			font-weight="700"
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
