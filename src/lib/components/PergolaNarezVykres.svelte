<script lang="ts">
	// Pergola — TECHNICKÝ výkres z NÁREZOVÝCH rozmerov (#194, vzor OP260032). Postavený
	// na zdieľanom základe #137/#168 (VykresovyHarok + Kota + kompozicia.ts) — žiadny
	// vlastný <svg>/rám, žiadna vlastná pečiatka, žiadny nový framework. Geometria je
	// ČISTÁ funkcia `schemaVykresu` v `$lib/pergola-narez.ts` (unit-testovaná, pokrytá
	// money-safety guardom) — táto komponenta LEN kreslí.
	//
	// DISPLAY-ONLY: NIČ do Money nezapisuje, NEimportuje server/money ani server/pergola
	// (statický guard: tests/pergola-narez-money-safety.test.ts). Žiadny golden snapshot.
	//
	// DISCIPLÍNA (#155/#194): kreslí sa LEN potvrdená geometria (nohy/rozostupy/priečky/
	// žľab pozícia). KROV (sklon 7°, rozostup krovov, frézovanie) je #161 a O4/O5/O6
	// blokované — kreslí sa LEN ako čestný poznámkový box „doplní konštruktér → #161",
	// NIKDY sa nehádže sklon/rozostup krovu. Tri pohľady: predný pohľad (nárys),
	// bokorys (bočný rez), pôdorys (mriežka nôh).
	import VykresovyHarok from '$lib/components/vykres/VykresovyHarok.svelte';
	import Kota from '$lib/components/vykres/Kota.svelte';
	import { fmtMm, fmtDeg } from '$lib/vykres/kota';
	import { vypocitajMierku } from '$lib/vykres/mierka';
	import {
		sharedFitScale,
		centerAt,
		fitCentered,
		MIN_SPEC_FONT,
		MIN_DIM_FONT,
		type FitResult
	} from '$lib/vykres/kompozicia';
	import { schemaVykresu, MAX_ROZOSTUP_PRIECOK, type PergolaNarezVstup } from '$lib/pergola-narez';
	import { krovUlozenie, type KrovUlozenie } from '$lib/pergola-krov';

	let {
		vstup,
		datum
	}: {
		vstup: PergolaNarezVstup;
		/** už naformátovaný dátum zo servera (formatDatumCasSk) */
		datum: string;
	} = $props();

	// unikátne id pre <clipPath> — viac inštancií na jednej stránke by inak zdieľalo
	// id (rovnaký vzor ako uid v BazenNavrhVykres/TitleBlock).
	const uid = $props.id();

	const PAGE_W = 297;
	const PAGE_H = 210;
	const MARGIN = 6;
	const GRID_BAND = 5;
	const OBLAST_W = PAGE_W - 2 * MARGIN - 2 * GRID_BAND;
	const OBLAST_H = PAGE_H - 2 * MARGIN - 2 * GRID_BAND;
	// JEDNA konštanta výšky/šírky pečiatky poslaná explicitne cez titleBlockData.height
	// (rovnaká disciplína ako pergola/bazén — nikdy dve nezávislé "50", #146 review).
	// TB_W = VykresovyHarok default tbW (titleBlock.width nenastavené) — potrebné TU na
	// výpočet, kam smie spec text siahať, nech ho pečiatka nezakryje.
	const TB_H = 50;
	const TB_W = 92;

	let s = $derived(schemaVykresu(vstup));

	// #161 — krov uloženie z POTVRDENÝCH vzorcov (prah 7°). Počíta sa LEN keď je sklon
	// strechy zadaný; inak (a pri sklone < 7°, ktorý engine hlási ako „nepodporované")
	// ostáva krov len čestnou poznámkou → #161, presne ako doteraz (#194). NIKDY sa
	// nekreslí sklon/uloženie, ktoré engine nepotvrdil.
	let krov: KrovUlozenie | null = $derived(
		vstup.sklonStrechy != null ? krovUlozenie(vstup.sklonStrechy) : null
	);
	let krovRezimText = $derived(
		krov?.rezim === 'rovnobezne'
			? `= ${7}° — krov leží rovnobežne s hranou`
			: krov?.rezim === 'otvara'
				? '> 7° — dva dotyky + previs'
				: ''
	);

	// najvyššia SKUTOČNE nakreslená vertikálna kóta na hárku — pri samostatne stojacej
	// bokorys kreslí až po `vyskaZadna` (t.j. vyššie než predná svetlosť), takže čestná
	// mierka MUSÍ zahrnúť aj ju (review nález #194 🟡: inak by úzka+vysoká samostatná
	// zákazka reportovala mierku podhodnotenú ~1,5×; rovnaká disciplína ako
	// `Math.max(vyskaPriStene, hlbka)` v PergolaNavrhVykres).
	// #206 — spec riadky: potvrdené rozmery + nové voľby (výstuha profil, zasklenie, sklá,
	// zvod). Voliteľné riadky sa pridávajú len keď sú vyplnené, aby sa spec nezhltol pečiatkou.
	let specRiadky = $derived.by((): [string, string, string][] => {
		const rows: [string, string, string][] = [
			['SYSTÉM', 'system', vstup.system],
			['ROZMER', 'rozmer', `${fmtMm(s.sirka)} × ${fmtMm(s.hlbka)} mm`],
			[
				vstup.vystuhaProfil === '200x140' && vstup.system === 'Massive'
					? 'EFEKTÍVNA SVETLOSŤ'
					: 'PREDNÁ SVETLOSŤ',
				'svetlost',
				`${fmtMm(s.prednaSvetlost)} mm${vstup.vystuhaProfil === '200x140' && vstup.system === 'Massive' ? ' (200×140: −60)' : ''}`
			],
			[
				'PREDNÉ NOHY',
				'nohy',
				`${vstup.pocetPrednychNoh} ks${s.rozostupPrednychNoh ? ` · rozostup ${fmtMm(s.rozostupPrednychNoh)} mm` : ''}`
			],
			[
				'UCHYTENIE',
				'uchytenie',
				s.zadnaKonstrukcia.typ === 'samostatne'
					? `samostatne · zadná noha ${fmtMm(s.zadnaKonstrukcia.nohaDlzka)} mm`
					: 'na stenu'
			],
			['PRIEČKY', 'priecky', `${s.priecky.pocet} ks · rozostup ≤ ${MAX_ROZOSTUP_PRIECOK} mm`]
		];
		if (vstup.vystuhaProfil) rows.push(['VÝSTUHA', 'vystuha', vstup.vystuhaProfil]);
		if (vstup.jednoduchaBezZasklenia)
			rows.push(['ZASKLENIE', 'zasklenie', 'jednoduchá bez zasklenia · bočné 110×43 vypnuté']);
		if (vstup.strechaSklo) rows.push(['STRECHA SKLO', 'strechasklo', vstup.strechaSklo]);
		if (vstup.obvodoveZasklenie) rows.push(['OBVODOVÉ', 'obvodove', vstup.obvodoveZasklenie]);
		if (vstup.zvodFrezovat && vstup.zvodFrezovanieSHmm != null)
			rows.push(['ZVOD SH', 'zvod', `frézovať ${fmtMm(vstup.zvodFrezovanieSHmm)} mm`]);
		return rows;
	});

	let najvyssiaVyska = $derived(
		Math.max(
			s.prednaSvetlost,
			s.zadnaKonstrukcia.typ === 'samostatne' ? s.zadnaKonstrukcia.vyskaZadna : 0
		) + s.zlabHrubka
	);

	let titleBlockData = $derived({
		nazov: `PERGOLA NÁREZ — ${vstup.system}`,
		projekt: 'automatizacie-montalu',
		cisloVykresu: '—',
		// čestná mierka z REÁLNEJ najväčšej kresby (šírka je najširší rozmer na hárku,
		// najvyssiaVyska najvyšší) voči dostupnej ploche — rovnaká disciplína ako
		// vypocitajMierku inde (nikdy natvrdo "1:20").
		mierka: vypocitajMierku(s.sirka, Math.max(najvyssiaVyska, s.hlbka), OBLAST_W * 0.6, OBLAST_H),
		revizia: '—',
		varianta: 'NÁREZ',
		vypracoval: '—',
		datum,
		height: TB_H
	});

	const CIERNA = '#0f172a';
	const MODRA = '#1d4ed8';
	const SIVA = '#64748b';

	// #204 — CAD konvencia hrúbky čiar: rezová/hlavná obrysová čiara (cut line) je hrubšia
	// než POMOCNÉ pohľadové čiary (view line). Dominik (Odoo #1691127): „hrubé čiary v tých
	// pohľadoch … ako cez skicár" → pohľadové čiary tenké technické, hrubšia ostáva LEN pre
	// samotný rez/hlavný obrys (žľab-sekcia, pôdorysný obrys). Predtým bola jednotná 1.2.
	const REZ_STROKE = 0.5; // rezová/hlavná obrysová čiara (žľab sekcia, pôdorysný obrys)
	const POHLAD_STROKE = 0.3; // pomocná pohľadová čiara (nohy, steny, obrys strechy, zem)
	// previs žľabu/strechy oproti krajnej nohe [mm] — LEN vizuálne (nevstupuje do
	// žiadneho výpočtu), rovnaká disciplína ako PREVIS_VIZ_MM v PergolaNavrhVykres.
	const PREVIS_VIZ_MM = 60;

	/** Obrysová hrúbka vyplneného tvaru — nikdy širšia než polovica tvaru, aby pri
	 *  extrémnej (ale platnej) mierke nezhltla fill (vykres.md #153, `obrysStroke`).
	 *  `base` = REZ_STROKE (rezová čiara) alebo POHLAD_STROKE (pohľadová, default). */
	function obrysStroke(rozmerPx: number, base: number = POHLAD_STROKE): number {
		return Math.min(base, rozmerPx * 0.5);
	}

	/** Polovičná hrúbka nohy v PX pri danej mierke — orezaná zdola (nikdy nezmizne)
	 *  aj zhora (nikdy nepretečie do susedného poľa). Vizuálna hrúbka = profil systému
	 *  (110/140), rovnaká disciplína ako stlpHalfW v PergolaNavrhVykres. */
	function nohaHalfW(scale: number, maxPx: number): number {
		return Math.min(Math.max((s.profilRozmer * scale) / 2, 0.5), maxPx);
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
		<!-- Rozloženie (vzor OP260032 + bazén multi-pohľad + spodný spec-riadok):
		     predný pohľad vľavo hore, bokorys vpravo hore, pôdorys vľavo dole (zarovnaný
		     pod predný pohľad cez zdieľanú šírkovú mierku), krov-poznámka vpravo dole
		     vedľa pôdorysu, spec v samostatnom spodnom riadku VĽAVO od pečiatky (vzor
		     bazén `specRowH` — spec sa nikdy nesqueezne pod pečiatku). -->
		{@const gap = oblast.w * 0.02}
		{@const vgap = oblast.h * 0.04}
		{@const bottomRowH = TB_H}
		{@const bottomY = oblast.y + oblast.h - bottomRowH}
		{@const viewsH = Math.max(1, oblast.h - bottomRowH - vgap)}
		{@const topH = viewsH * 0.46}
		{@const feW = oblast.w * 0.62}
		{@const rightX = oblast.x + feW + gap}
		{@const rightW = oblast.w - feW - gap}
		{@const fe = { x: oblast.x, y: oblast.y, w: feW, h: topH }}
		{@const bok = { x: rightX, y: oblast.y, w: rightW, h: topH }}
		{@const podBandY = oblast.y + topH + vgap}
		{@const podBandH = Math.max(1, viewsH - topH - vgap)}
		{@const pod = { x: oblast.x, y: podBandY, w: feW, h: podBandH }}
		{@const krovNote = { x: rightX, y: podBandY, w: rightW, h: podBandH }}
		{@const tbX = oblast.x + oblast.w - TB_W}
		{@const spec = {
			x: oblast.x,
			y: bottomY,
			w: Math.max(0, tbX - 2 - oblast.x),
			h: bottomRowH
		}}

		<!-- kresliace podoblasti predného pohľadu a pôdorysu — odsadené hore pre nadpis,
		     dole pre kóty; zdieľajú JEDNU šírkovú mierku + x0 (nohy sedia pod sebou). -->
		{@const feTitlePad = topH * 0.1}
		{@const feDimPad = topH * 0.3}
		{@const feContent = {
			x: fe.x,
			y: fe.y + feTitlePad,
			w: fe.w,
			h: Math.max(1, topH - feTitlePad - feDimPad)
		}}
		{@const podTitlePad = pod.h * 0.12}
		{@const podDimPad = pod.h * 0.24}
		{@const podContent = {
			x: pod.x,
			y: pod.y + podTitlePad,
			w: pod.w,
			h: Math.max(1, pod.h - podTitlePad - podDimPad)
		}}
		{@const feVyska = s.prednaSvetlost + s.zlabHrubka}
		{@const scale = sharedFitScale([
			{ mmW: s.sirka, mmH: feVyska, area: feContent },
			{ mmW: s.sirka, mmH: s.hlbka, area: podContent }
		])}
		{@const feFit = centerAt(s.sirka, feVyska, feContent, scale)}
		{@const podVFit = centerAt(s.sirka, s.hlbka, podContent, scale)}
		<!-- pôdorys ZDIEĽA x0 s predným pohľadom, aby nohy sedeli pod sebou. Tu je to
		     de-facto no-op (obe oblasti majú rovnaké x/w/mmW/scale), ale override
		     drží zarovnanie explicitne aj keby sa layout niekedy rozišiel (rovnaká
		     disciplína ako bazén, kde dlzkaKolajiska≠zatvorenaDlzka to robí nutným). -->
		{@const podFit: FitResult = { ...podVFit, x0: feFit.x0, x1: feFit.x0 + s.sirka * scale }}

		<g data-testid="pnr-predny-pohlad">
			{@render prednyPohlad(fe, feFit)}
		</g>
		<g data-testid="pnr-bokorys">
			{@render bokorys(bok)}
		</g>
		<g data-testid="pnr-podorys">
			{@render podorys(pod, podFit)}
		</g>
		<g data-testid="pnr-krov-note">
			{@render krovPoznamka(krovNote)}
		</g>
		<g data-testid="pnr-spec">
			{@render specText(spec)}
		</g>
	{/snippet}
</VykresovyHarok>

<!-- ============================= predný pohľad (nárys) ============================= -->
{#snippet prednyPohlad(r: { x: number; y: number; w: number; h: number }, fit: FitResult)}
	{@const baseY = fit.y1}
	{@const X = (mm: number) => fit.x0 + mm * fit.scale}
	{@const topY = baseY - s.prednaSvetlost * fit.scale}
	{@const zlabH = Math.max(1.2, s.zlabHrubka * fit.scale)}
	{@const previs = PREVIS_VIZ_MM * fit.scale}
	{@const rozostupPx = s.rozostupPrednychNoh
		? s.rozostupPrednychNoh * fit.scale
		: s.sirka * fit.scale}
	{@const halfW = nohaHalfW(fit.scale, rozostupPx * 0.4)}
	<text
		x={r.x + r.w * 0.5}
		y={r.y + 3}
		text-anchor="middle"
		font-size="3"
		fill={CIERNA}
		font-weight="600">PREDNÝ POHĽAD</text
	>
	<!-- horný nosník (žľab + kotviaci profil) v reálnej hrúbke, s previsom cez krajné
	     nohy. #153: svetlá fill + obrysStroke (osovo zarovnaný rect → crispEdges). -->
	<rect
		x={X(0) - previs}
		y={topY - zlabH}
		width={X(s.sirka) - X(0) + 2 * previs}
		height={zlabH}
		fill="#eff6ff"
		stroke={CIERNA}
		stroke-width={obrysStroke(zlabH, REZ_STROKE)}
		shape-rendering="crispEdges"
		data-testid="pnr-fe-zlab"
	/>
	<!-- priečky — tenké deliace čiary výplne (rozostup ≤ 700), LEN vnútorné (krajné
	     sadnú na profily). Sekundárne oproti nohám (tenšie). -->
	<g stroke={SIVA} stroke-width={POHLAD_STROKE} data-testid="pnr-fe-priecky">
		{#each s.priecky.pozicieX as px, i (i)}
			<line x1={X(px)} y1={topY} x2={X(px)} y2={baseY} />
		{/each}
	</g>
	<!-- predné nohy — reálna hrúbka profilu (110/140) v mierke, vyplnené. -->
	{#each s.prednaNohyX as px, i (i)}
		<rect
			x={X(px) - halfW}
			y={topY}
			width={halfW * 2}
			height={baseY - topY}
			fill="#fff"
			stroke={CIERNA}
			stroke-width={obrysStroke(halfW * 2)}
			shape-rendering="crispEdges"
			data-testid="pnr-fe-noha-{i}"
		/>
	{/each}
	<!-- kóty: rozostupy nôh (medzi susednými), celková šírka, predná svetlá výška -->
	{#each s.prednaNohyX.slice(0, -1) as px, i (i)}
		<Kota
			x0={X(px)}
			y0={baseY}
			x1={X(s.prednaNohyX[i + 1])}
			y1={baseY}
			perpOffset={r.h * 0.06}
			text={fmtMm(s.prednaNohyX[i + 1] - px)}
			color={MODRA}
			fontSize={MIN_DIM_FONT}
		/>
	{/each}
	<Kota
		x0={X(0)}
		y0={baseY}
		x1={X(s.sirka)}
		y1={baseY}
		perpOffset={r.h * 0.16}
		text={fmtMm(s.sirka)}
		color={MODRA}
		fontSize={3.2}
	/>
	<Kota
		x0={X(0)}
		y0={baseY}
		x1={X(0)}
		y1={topY}
		perpOffset={-(r.w * 0.05)}
		text={fmtMm(s.prednaSvetlost)}
		color={MODRA}
		fontSize={MIN_DIM_FONT}
	/>
{/snippet}

<!-- ============================= bokorys (bočný rez) ============================= -->
{#snippet bokorys(r: { x: number; y: number; w: number; h: number })}
	{@const samostatne = s.zadnaKonstrukcia.typ === 'samostatne'}
	{@const vyskaZadna =
		s.zadnaKonstrukcia.typ === 'samostatne' ? s.zadnaKonstrukcia.vyskaZadna : s.prednaSvetlost}
	{@const maxV = Math.max(s.prednaSvetlost, vyskaZadna) + s.zlabHrubka}
	{@const titlePad = r.h * 0.1}
	{@const dimPad = r.h * 0.3}
	{@const area = { x: r.x, y: r.y + titlePad, w: r.w, h: Math.max(1, r.h - titlePad - dimPad) }}
	{@const fit = fitCentered(s.hlbka, maxV, area)}
	{@const baseY = fit.y1}
	{@const scale = fit.scale}
	<!-- vľavo = zadná strana (stena / zadné nohy), vpravo = predná (nižšia, žľab) -->
	{@const xBack = fit.x0}
	{@const xFront = fit.x0 + s.hlbka * scale}
	{@const yFrontTop = baseY - s.prednaSvetlost * scale}
	{@const yBackTop = baseY - vyskaZadna * scale}
	{@const zlabH = Math.max(1.2, s.zlabHrubka * scale)}
	{@const halfW = nohaHalfW(scale, (xFront - xBack) * 0.12)}
	<text
		x={r.x + r.w * 0.5}
		y={r.y + 3}
		text-anchor="middle"
		font-size="3"
		fill={CIERNA}
		font-weight="600">BOKORYS</text
	>
	<!-- strecha (krov) LEN zjednodušený obrys — sklon/rozostup je #161 (nekreslíme
	     ho pri uchytení na stenu, kde výška uloženia nie je potvrdená). -->
	{#if samostatne}
		<line
			x1={xBack}
			y1={yBackTop - zlabH}
			x2={xFront}
			y2={yFrontTop - zlabH}
			stroke={SIVA}
			stroke-width={POHLAD_STROKE}
			stroke-dasharray="3,1.5"
			data-testid="pnr-bok-strecha"
		/>
	{/if}
	<!-- žľab (predná, nižšia strana) -->
	<rect
		x={xFront - halfW}
		y={yFrontTop - zlabH}
		width={halfW * 2}
		height={zlabH}
		fill="#eff6ff"
		stroke={CIERNA}
		stroke-width={obrysStroke(zlabH, REZ_STROKE)}
		shape-rendering="crispEdges"
		data-testid="pnr-bok-zlab"
	/>
	<!-- predná noha -->
	<rect
		x={xFront - halfW}
		y={yFrontTop}
		width={halfW * 2}
		height={baseY - yFrontTop}
		fill="#fff"
		stroke={CIERNA}
		stroke-width={obrysStroke(halfW * 2)}
		shape-rendering="crispEdges"
		data-testid="pnr-bok-predna-noha"
	/>
	<!-- zadná strana: samostatne = zadná noha, na stenu = referenčná čiara steny -->
	{#if samostatne}
		<rect
			x={xBack - halfW}
			y={yBackTop}
			width={halfW * 2}
			height={baseY - yBackTop}
			fill="#fff"
			stroke={CIERNA}
			stroke-width={obrysStroke(halfW * 2)}
			shape-rendering="crispEdges"
			data-testid="pnr-bok-zadna-noha"
		/>
	{:else}
		<line
			x1={xBack}
			y1={baseY}
			x2={xBack}
			y2={yFrontTop}
			stroke={CIERNA}
			stroke-width={POHLAD_STROKE}
			data-testid="pnr-bok-stena"
		/>
		<text
			x={xBack - 1}
			y={(baseY + yFrontTop) / 2}
			text-anchor="end"
			font-size={MIN_SPEC_FONT}
			fill={SIVA}>stena</text
		>
	{/if}
	<!-- zem -->
	<line x1={xBack} y1={baseY} x2={xFront} y2={baseY} stroke={CIERNA} stroke-width={POHLAD_STROKE} />
	<!-- kóty: hĺbka (dole), predná svetlá výška (vpravo), zadná výška (vľavo, samostatne) -->
	<Kota
		x0={xBack}
		y0={baseY}
		x1={xFront}
		y1={baseY}
		perpOffset={r.h * 0.16}
		text={fmtMm(s.hlbka)}
		color={MODRA}
		fontSize={MIN_DIM_FONT}
	/>
	<Kota
		x0={xFront}
		y0={baseY}
		x1={xFront}
		y1={yFrontTop}
		perpOffset={r.w * 0.06}
		text={fmtMm(s.prednaSvetlost)}
		color={MODRA}
		fontSize={MIN_DIM_FONT}
	/>
	{#if samostatne}
		<Kota
			x0={xBack}
			y0={baseY}
			x1={xBack}
			y1={yBackTop}
			perpOffset={-(r.w * 0.06)}
			text={fmtMm(vyskaZadna)}
			color={MODRA}
			fontSize={MIN_DIM_FONT}
		/>
	{/if}
	<!-- poznámka o krove priamo v pohľade — keď je uloženie potvrdené (sklon zadaný ≥ 7°),
	     odkáž na uloženie detail; inak zjednodušený obrys. VŽDY nesie #161. -->
	<text
		x={r.x + r.w * 0.5}
		y={baseY + r.h * 0.26}
		text-anchor="middle"
		font-size={MIN_SPEC_FONT}
		fill={SIVA}
		data-testid="pnr-bok-krov-pozn"
		>{krov?.podporovane ? 'krov: uloženie #161 (detail nižšie)' : 'krov zjednodušený → #161'}</text
	>
{/snippet}

<!-- ============================= pôdorys (mriežka nôh) ============================= -->
{#snippet podorys(r: { x: number; y: number; w: number; h: number }, fit: FitResult)}
	{@const X = (mm: number) => fit.x0 + mm * fit.scale}
	{@const y0 = fit.y0}
	{@const y1 = fit.y1}
	{@const samostatne = s.zadnaKonstrukcia.typ === 'samostatne'}
	{@const nohaPx = Math.max(1.2, s.profilRozmer * fit.scale)}
	<text
		x={r.x + r.w * 0.5}
		y={r.y + 3}
		text-anchor="middle"
		font-size="3"
		fill={CIERNA}
		font-weight="600">PÔDORYS</text
	>
	<!-- vonkajší obrys šírka × hĺbka -->
	<rect
		x={X(0)}
		y={y0}
		width={X(s.sirka) - X(0)}
		height={y1 - y0}
		fill="none"
		stroke={CIERNA}
		stroke-width={obrysStroke(Math.min(X(s.sirka) - X(0), y1 - y0), REZ_STROKE)}
		data-testid="pnr-pod-obrys"
	/>
	<!-- predné nohy — štvorčeky na PREDNEJ hrane (dole, y1) -->
	{#each s.prednaNohyX as px, i (i)}
		<rect
			x={X(px) - nohaPx / 2}
			y={y1 - nohaPx}
			width={nohaPx}
			height={nohaPx}
			fill={CIERNA}
			data-testid="pnr-pod-predna-noha-{i}"
		/>
	{/each}
	<!-- zadná strana: samostatne = zadné nohy (hore, y0), na stenu = čiara steny -->
	{#if samostatne && s.zadnaKonstrukcia.typ === 'samostatne'}
		{#each s.zadnaKonstrukcia.nohyX as px, i (i)}
			<rect
				x={X(px) - nohaPx / 2}
				y={y0}
				width={nohaPx}
				height={nohaPx}
				fill={CIERNA}
				data-testid="pnr-pod-zadna-noha-{i}"
			/>
		{/each}
	{:else}
		<line
			x1={X(0)}
			y1={y0}
			x2={X(s.sirka)}
			y2={y0}
			stroke={CIERNA}
			stroke-width={POHLAD_STROKE}
			data-testid="pnr-pod-stena"
		/>
	{/if}
	<!-- kóty: šírka (dole), hĺbka (vľavo) -->
	<Kota
		x0={X(0)}
		y0={y1}
		x1={X(s.sirka)}
		{y1}
		perpOffset={r.h * 0.16}
		text={fmtMm(s.sirka)}
		color={MODRA}
		fontSize={3.2}
	/>
	<Kota
		x0={X(0)}
		{y0}
		x1={X(0)}
		{y1}
		perpOffset={-(r.w * 0.05)}
		text={fmtMm(s.hlbka)}
		color={MODRA}
		fontSize={MIN_DIM_FONT}
	/>
{/snippet}

<!-- ============================= krov — uloženie / poznámka (#161) ================= -->
{#snippet krovPoznamka(r: { x: number; y: number; w: number; h: number })}
	<rect
		x={r.x}
		y={r.y}
		width={r.w}
		height={r.h}
		fill="none"
		stroke={CIERNA}
		stroke-width="0.35"
		stroke-dasharray="2,1.5"
		data-testid="pnr-krov-ram"
	/>
	{#if krov?.podporovane}
		{@render krovUlozenieDetail(r)}
	{:else}
		<!-- sklon nezadaný alebo < 7° (O5) → čestný placeholder, presne ako #194 -->
		<text
			x={r.x + r.w / 2}
			y={r.y + r.h * 0.3}
			text-anchor="middle"
			font-size="3.2"
			font-weight="700"
			fill={CIERNA}>KROV / STRECHA</text
		>
		<text
			x={r.x + r.w / 2}
			y={r.y + r.h * 0.42}
			text-anchor="middle"
			font-size={MIN_SPEC_FONT}
			fill={SIVA}
			data-testid="pnr-krov-pozn"
		>
			<tspan x={r.x + r.w / 2} dy="0">detail krovu (sklon 7°, rozostup,</tspan>
			<tspan x={r.x + r.w / 2} dy="3.4">frézovanie) doplní konštruktér</tspan>
			<tspan x={r.x + r.w / 2} dy="3.4">→ #161</tspan>
		</text>
		{#if krov && krov.rezim === 'nepodporovane'}
			<text
				x={r.x + r.w / 2}
				y={r.y + r.h * 0.42 + 12}
				text-anchor="middle"
				font-size={MIN_SPEC_FONT}
				fill={SIVA}
				data-testid="pnr-krov-pod7"
				>zadaný sklon {fmtDeg(krov.sklonStupne ?? 0)} &lt; 7° — uloženie O5 (nepodporované)</text
			>
		{/if}
	{/if}
{/snippet}

<!-- Uloženie detail — LEN potvrdené hodnoty (prah 7°). Schematický trojuholník je
     zámerne NIE v mierke (uloženie je sub-mm oproti 29 mm odvesne) — všetky KÓTY sú
     potvrdené, len proporcia je schéma. Nič sa nevymýšľa. -->
{#snippet krovUlozenieDetail(r: { x: number; y: number; w: number; h: number })}
	{@const cx = r.x + r.w / 2}
	{@const pad = 3}
	<text
		x={cx}
		y={r.y + pad + 1}
		text-anchor="middle"
		font-size="3.2"
		font-weight="700"
		fill={CIERNA}
		data-testid="pnr-krov-ulozenie">KROV — ULOŽENIE (#161)</text
	>
	<g font-size={MIN_SPEC_FONT} fill={CIERNA} data-testid="pnr-krov-ulozenie-hodnoty">
		<text x={r.x + pad} y={r.y + pad + 6}
			><tspan font-weight="700">sklon {fmtDeg(krov?.sklonStupne ?? 0)}</tspan> · {krovRezimText}</text
		>
		<text x={r.x + pad} y={r.y + pad + 10.5}
			>uhol2={krov?.uhol2} · uhol3={fmtDeg(krov?.uhol3 ?? 0)}</text
		>
		<text x={r.x + pad} y={r.y + pad + 15}
			>odvesna c=29 → <tspan font-weight="700">ps=ls={fmtMm(krov?.ps ?? 0, 2)} mm</tspan></text
		>
		<text x={r.x + pad} y={r.y + pad + 19.5}
			>odvesna cc=37,28 → <tspan font-weight="700">lv=pv={fmtMm(krov?.lv ?? 0, 2)} mm</tspan></text
		>
	</g>
	<!-- schematický trojuholník uloženia (ps–c–konštanta), NIE v mierke -->
	{@const triY = r.y + r.h - pad - 9}
	{@const triX0 = r.x + pad + 2}
	{@const triW = Math.min(26, r.w - 2 * pad - 30)}
	{@const triH = 6}
	<g data-testid="pnr-krov-trojuholnik" stroke={MODRA} stroke-width="0.4" fill="none">
		<polygon points="{triX0},{triY} {triX0 + triW},{triY} {triX0 + triW},{triY - triH}" />
	</g>
	<g font-size={MIN_SPEC_FONT} fill={SIVA}>
		<text x={triX0 + triW / 2} y={triY + 3} text-anchor="middle">c 29</text>
		<text x={triX0 + triW + 1.5} y={triY - triH / 2} text-anchor="start"
			>ps {fmtMm(krov?.ps ?? 0, 2)}</text
		>
		<text x={triX0 + triW + 12} y={triY} text-anchor="start">schéma (nie v mierke)</text>
	</g>
	<!-- to, čo OSTÁVA nepodporované — frézovanie výrobného listu → #161 -->
	<text
		x={cx}
		y={r.y + r.h - pad}
		text-anchor="middle"
		font-size={MIN_SPEC_FONT}
		fill={SIVA}
		data-testid="pnr-krov-pozn">frézovanie drážok (výrobný list) doplní konštruktér → #161</text
	>
{/snippet}

<!-- ============================= spec (potvrdené rozmery) ============================= -->
{#snippet specText(r: { x: number; y: number; w: number; h: number })}
	{@const riadky = specRiadky}
	<!-- adaptívne riadkovanie: pri viac riadkoch sa zmenší, aby sa spec zmestil (nezhltne pečiatka) -->
	{@const dy = Math.min(4.4, (r.h - 6) / (riadky.length + 1))}
	<!-- clipPath vynúti hranicu renderovania (SVG <text> zúženie regiónu samo o sebe
	     neobmedzuje — vykres.md „Text-blok vedľa pečiatky"). -->
	<defs>
		<clipPath id="pnr-spec-clip-{uid}">
			<rect x={r.x} y={r.y - 4} width={r.w} height={r.h + 8} />
		</clipPath>
	</defs>
	<g clip-path="url(#pnr-spec-clip-{uid})">
		{#each riadky as [label, testid, hodnota], i (testid)}
			<text
				x={r.x}
				y={r.y + 4 + i * dy}
				font-size={MIN_SPEC_FONT}
				fill={CIERNA}
				data-testid={`pnr-spec-${testid}`}><tspan font-weight="700">{label}:</tspan> {hodnota}</text
			>
		{/each}
		<text
			x={r.x}
			y={r.y + 4 + riadky.length * dy + 2}
			font-size={MIN_SPEC_FONT}
			fill={SIVA}
			data-testid="pnr-spec-money">Display-only · Money odpis: /pergola</text
		>
	</g>
{/snippet}
