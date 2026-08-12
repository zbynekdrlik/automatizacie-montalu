<script lang="ts">
	// Bazén — zákaznícky NÁVRHOVÝ výkres, FÁZA 1 (#139, vzory OP260027 rev.3 a
	// OP260055). Celý hárok postavený na zdieľanom základe #137 (VykresovyHarok +
	// Kota + TitleBlock + mierka.ts) — žiadny vlastný <svg>/rám, žiadna vlastná
	// pečiatka. NAVYŠE oproti pergole/zaskleniam: `podpisovaLista` (#139, nová
	// opt-in vlastnosť VykresovyHarok).
	//
	// Štyri pohľady: bokorys (kaskáda sekcií), pôdorys (dverová sekcia oranžovo +
	// smer posuvu), textový popis (MODEL/VÝPLŇ/POSUV/ARETÁCIA/DVERE/VÝŠKA ČELA/
	// DĹŽKA KOĽAJISKA/RAL), a REZERVOVANÉ miesto pre rez sekciou (VIEW A) —
	// zámerne PRÁZDNE s poznámkou "Rez sekciou doplní konštruktér", NIKDY
	// vymyslený oblúk (#163 — tvar nesedí na kruh ani elipsu, viď design
	// komentár na #139).
	import VykresovyHarok from '$lib/components/vykres/VykresovyHarok.svelte';
	import Kota from '$lib/components/vykres/Kota.svelte';
	import { fmtMm } from '$lib/vykres/kota';
	import { vypocitajMierku } from '$lib/vykres/mierka';
	import {
		variantaZSekcii,
		presahKolajniska,
		sekcieVysky,
		sekciePozicie,
		posuvPopis,
		dverePopis,
		predvyplnenyNazov,
		farbaKonstrukcie,
		type BazenNavrhVstup
	} from '$lib/bazen-navrh';

	let {
		vstup,
		datum
	}: {
		vstup: BazenNavrhVstup;
		/** už naformátovaný dátum zo servera (formatDatumCasSk) */
		datum: string;
	} = $props();

	const PAGE_W = 297;
	const PAGE_H = 210;
	const MARGIN = 6;
	const GRID_BAND = 5;
	const OBLAST_W = PAGE_W - 2 * MARGIN - 2 * GRID_BAND;
	const OBLAST_H = PAGE_H - 2 * MARGIN - 2 * GRID_BAND;
	// rovnaká disciplína ako pergola (#146 review nález) — JEDNA konštanta
	// poslaná explicitne cez `titleBlockData.height`, nikdy dve nezávislé "50".
	const TB_H = 50;

	let pocetSekcii = $derived(Math.max(1, Math.round(vstup.pocetSekcii)));
	let vysky = $derived(sekcieVysky(pocetSekcii, vstup.vyskaMax, vstup.vyskaMin));
	let pozicie = $derived(sekciePozicie(vstup.zatvorenaDlzka, pocetSekcii));
	let presah = $derived(presahKolajniska(vstup.dlzkaKolajiska, vstup.zatvorenaDlzka));
	let varianta = $derived(variantaZSekcii(pocetSekcii));

	// #150/#153 disciplína znovupoužitá 1:1 (pergola-navrh.ts / zasklenia-navrh.ts):
	// farebný režim vyfarbuje LEN konštrukciu, kóty/poznámky/raster/pečiatka sa
	// nemenia.
	let farebny = $derived(vstup.rezimVykresu === 'farebny');
	let farba = $derived(farbaKonstrukcie(vstup.ralKod));

	const emDash = (s: string) => (s.trim() ? s : '—');

	let titleBlockData = $derived({
		nazov:
			vstup.nazov ||
			predvyplnenyNazov(vstup.zatvorenaDlzka, vstup.hlbka, vstup.vyskaMax) ||
			'BAZÉN — NÁVRH',
		projekt: 'automatizacie-montalu',
		cisloVykresu: emDash(vstup.op),
		// čestná mierka z REÁLNEJ najväčšej kresby (dĺžka koľajiska = najdlhší
		// vodorovný rozmer na hárku) voči dostupnej ploche — rovnaká disciplína
		// ako `vypocitajMierku` v pergola-navrh (nikdy natvrdo "1:20").
		mierka: vypocitajMierku(
			vstup.dlzkaKolajiska,
			Math.max(vstup.hlbka, vstup.vyskaMax),
			OBLAST_W * 0.7,
			OBLAST_H
		),
		revizia: emDash(vstup.revizia),
		varianta,
		vypracoval: emDash(vstup.vypracoval),
		datum,
		height: TB_H
	});

	const CIERNA = '#0f172a';
	const MODRA = '#1d4ed8';
	const CERVENA = '#dc2626';
	const ORANZOVA = '#f97316';

	const STRUKTURA_STROKE = 1.2;

	/** Obrysová hrúbka pre vyplnený štruktúrny tvar s daným (menším) rozmerom v PX
	 *  — rovnaký "nikdy nezhltni fill" guard ako `obrysStroke()` v
	 *  PergolaNavrhVykres.svelte / ZaskleniaNavrhVykres.svelte (#153). Nikdy
	 *  pevná konštanta bez ohľadu na mierku — over proti CELÉMU vstupnému
	 *  rozsahu (`.claude/rules/vykres.md`), nie len demo fixture. */
	function obrysStroke(rozmerPx: number): number {
		return Math.min(STRUKTURA_STROKE, rozmerPx * 0.5);
	}

	/** Vrcholy trojuholníkovej šípky na konci úsečky (x1,y1)→(x2,y2), hrot v
	 *  (x2,y2) — rovnaká implementácia ako `sipka()` v ostatných dvoch návrhových
	 *  komponentách. */
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
</script>

<VykresovyHarok
	pageW={PAGE_W}
	pageH={PAGE_H}
	margin={MARGIN}
	gridBand={GRID_BAND}
	titleBlock={titleBlockData}
	podpisovaLista={true}
>
	{#snippet content(oblast)}
		<!-- top pás vynecháva roh podpisovej lišty (VykresovyHarok, PL_W=90/PL_H=12) —
		     rovnaká disciplína ako "vynechaj roh s pečiatkou" (VykresovyHarok header
		     komentár), len navyše hore namiesto dole. -->
		{@const topPad = 14}
		{@const gap = oblast.w * 0.015}
		{@const rezW = oblast.w * 0.17}
		{@const rez = { x: oblast.x, y: oblast.y + topPad, w: rezW, h: oblast.h - topPad }}
		{@const mainX = oblast.x + rezW + gap}
		{@const mainW = oblast.w - rezW - gap}
		{@const bokH = (oblast.h - topPad) * 0.32}
		{@const podH = (oblast.h - topPad) * 0.3}
		{@const bok = { x: mainX, y: oblast.y + topPad, w: mainW, h: bokH }}
		{@const pod = { x: mainX, y: bok.y + bokH + gap, w: mainW, h: podH }}
		{@const spec = {
			x: mainX,
			y: pod.y + podH + gap,
			w: mainW,
			h: Math.max(0, oblast.y + oblast.h - (pod.y + podH + gap))
		}}
		<!-- jedna spoločná dĺžková mierka pre bokorys AJ pôdorys (aby stĺpiky
		     sekcií v oboch pohľadoch vizuálne sedeli pod sebou — rovnaká
		     projekčná disciplína ako v reálnych CAD výkresoch) — limitované
		     zdola šírkou stĺpca AJ výškou OBOCH riadkov, nikdy len jedným z nich. -->
		{@const scaleLenW = (mainW * 0.82) / Math.max(vstup.dlzkaKolajiska, 1)}
		{@const scaleBokH = (bokH * 0.55) / Math.max(vstup.vyskaMax, 1)}
		{@const scalePodH = (podH * 0.6) / Math.max(vstup.hlbka, 1)}
		{@const scale = Math.min(scaleLenW, scaleBokH, scalePodH)}

		<g data-testid="bn-rez-sekciou">
			{@render rezSekciou(rez)}
		</g>
		<g data-testid="bn-bokorys">
			{@render bokorys(bok, scale)}
		</g>
		<g data-testid="bn-podorys">
			{@render podorys(pod, scale)}
		</g>
		<g data-testid="bn-texty">
			{@render texty(spec)}
		</g>
	{/snippet}
</VykresovyHarok>

<!-- ============================= rez sekciou (rezervované, #163) ============================= -->
{#snippet rezSekciou(r: { x: number; y: number; w: number; h: number })}
	<rect
		x={r.x}
		y={r.y}
		width={r.w}
		height={r.h}
		fill="none"
		stroke={CIERNA}
		stroke-width="0.35"
		stroke-dasharray="2,1.5"
		data-testid="bn-rez-sekciou-ram"
	/>
	<text
		x={r.x + r.w / 2}
		y={r.y + r.h * 0.42}
		text-anchor="middle"
		font-size="3.2"
		font-weight="700"
		fill={CIERNA}>REZ SEKCIOU</text
	>
	<text
		x={r.x + r.w / 2}
		y={r.y + r.h * 0.5}
		text-anchor="middle"
		font-size="2.6"
		fill="#64748b"
		data-testid="bn-rez-sekciou-poznamka"
	>
		<tspan x={r.x + r.w / 2} dy="0">Rez sekciou</tspan>
		<tspan x={r.x + r.w / 2} dy="3.4">doplní</tspan>
		<tspan x={r.x + r.w / 2} dy="3.4">konštruktér</tspan>
	</text>
{/snippet}

<!-- ============================= bokorys (kaskáda sekcií) ============================= -->
{#snippet bokorys(r: { x: number; y: number; w: number; h: number }, scale: number)}
	{@const baseY = r.y + r.h * 0.62}
	{@const x0 = r.x + r.w * 0.07}
	{@const X = (mm: number) => x0 + mm * scale}
	<text
		x={r.x + r.w * 0.5}
		y={r.y + 3}
		text-anchor="middle"
		font-size="3"
		fill={CIERNA}
		font-weight="600">BOKORYS</text
	>
	<!-- koľajisko — tenká referenčná čiara po celej dĺžke koľajiska (presahuje
	     zatvorenú dĺžku sekcií o presah teleskopu) -->
	<line
		x1={X(0)}
		y1={baseY}
		x2={X(vstup.dlzkaKolajiska)}
		y2={baseY}
		stroke={CIERNA}
		stroke-width="0.6"
		data-testid="bn-bokorys-kolajisko"
	/>
	<!-- kaskáda sekcií — sekcia 0 (najvyššia) vľavo, posledná (najnižšia) vpravo -->
	{#each vysky as vyskaSekcie, i (i)}
		{@const sx0 = X(pozicie[i])}
		{@const sx1 = X(pozicie[i + 1])}
		{@const sy1 = baseY - vyskaSekcie * scale}
		<rect
			x={sx0}
			y={sy1}
			width={Math.max(0.3, sx1 - sx0)}
			height={baseY - sy1}
			fill={farebny ? farba.hex : '#eff6ff'}
			stroke={CIERNA}
			stroke-width={obrysStroke(Math.min(sx1 - sx0, baseY - sy1) * 0.5)}
			shape-rendering="crispEdges"
			data-testid={`bn-bokorys-sekcia-${i}`}
		/>
	{/each}
	<!-- výšky: najvyššia sekcia (vľavo) / najnižšia sekcia (vpravo) -->
	<Kota
		x0={X(pozicie[0])}
		y0={baseY}
		x1={X(pozicie[0])}
		y1={baseY - vysky[0] * scale}
		perpOffset={-(r.w * 0.05)}
		text={fmtMm(vstup.vyskaMax)}
		color={MODRA}
		fontSize={3}
	/>
	<Kota
		x0={X(pozicie[pozicie.length - 1])}
		y0={baseY}
		x1={X(pozicie[pozicie.length - 1])}
		y1={baseY - vysky[vysky.length - 1] * scale}
		perpOffset={r.w * 0.05}
		text={fmtMm(vstup.vyskaMin)}
		color={MODRA}
		fontSize={3}
	/>
	<!-- šírka prvej sekcie — LEN keď je ručne zadaná (appka nehádže vnorenie) -->
	{#if vstup.sirkaSekcieOverride !== undefined}
		<g data-testid="bn-bokorys-sirka-sekcie">
			<Kota
				x0={X(pozicie[0])}
				y0={baseY + r.h * 0.06}
				x1={X(pozicie[1])}
				y1={baseY + r.h * 0.06}
				perpOffset={r.h * 0.05}
				text={fmtMm(vstup.sirkaSekcieOverride)}
				color={MODRA}
				fontSize={2.8}
			/>
		</g>
	{/if}
	<!-- zatvorená dĺžka / dĺžka koľajiska / presah -->
	<Kota
		x0={X(0)}
		y0={baseY}
		x1={X(vstup.zatvorenaDlzka)}
		y1={baseY}
		perpOffset={r.h * 0.16}
		text={fmtMm(vstup.zatvorenaDlzka)}
		color={MODRA}
		fontSize={3.2}
	/>
	<g data-testid="bn-bokorys-presah">
		<Kota
			x0={X(vstup.zatvorenaDlzka)}
			y0={baseY}
			x1={X(vstup.dlzkaKolajiska)}
			y1={baseY}
			perpOffset={r.h * 0.16}
			text={fmtMm(presah)}
			color={MODRA}
			fontSize={2.8}
		/>
	</g>
	<Kota
		x0={X(0)}
		y0={baseY}
		x1={X(vstup.dlzkaKolajiska)}
		y1={baseY}
		perpOffset={r.h * 0.28}
		text={fmtMm(vstup.dlzkaKolajiska)}
		color={MODRA}
		fontSize={3.2}
	/>
{/snippet}

<!-- ============================= pôdorys (dverová sekcia + smer) ============================= -->
{#snippet podorys(r: { x: number; y: number; w: number; h: number }, scale: number)}
	{@const x0 = r.x + r.w * 0.07}
	{@const X = (mm: number) => x0 + mm * scale}
	{@const y0 = r.y + r.h * 0.16}
	{@const y1 = y0 + vstup.hlbka * scale}
	{@const dverySx0 = X(pozicie[vstup.dverovaSekcia - 1] ?? 0)}
	{@const dverySx1 = X(pozicie[vstup.dverovaSekcia] ?? 0)}
	{@const arrowY = (y0 + y1) / 2}
	<text
		x={r.x + r.w * 0.5}
		y={r.y + 3}
		text-anchor="middle"
		font-size="3"
		fill={CIERNA}
		font-weight="600">PÔDORYS</text
	>
	<!-- vonkajší obrys -->
	<rect
		x={X(0)}
		y={y0}
		width={X(vstup.zatvorenaDlzka) - X(0)}
		height={y1 - y0}
		fill="none"
		stroke={CIERNA}
		stroke-width={obrysStroke(Math.min(X(vstup.zatvorenaDlzka) - X(0), y1 - y0) * 0.5)}
		data-testid="bn-podorys-obrys"
	/>
	<!-- dverová sekcia zvýraznená oranžovo -->
	<rect
		x={dverySx0}
		y={y0}
		width={Math.max(0.3, dverySx1 - dverySx0)}
		height={y1 - y0}
		fill={ORANZOVA}
		fill-opacity="0.55"
		stroke={CIERNA}
		stroke-width="0.35"
		data-testid="bn-podorys-dvere"
	/>
	<!-- deliace čiary sekcií -->
	<g stroke={CIERNA} stroke-width="0.3">
		{#each pozicie.slice(1, -1) as p, i (i)}
			<line x1={X(p)} y1={y0} x2={X(p)} y2={y1} />
		{/each}
	</g>
	<!-- smer posuvu — jednokoľaj: jedna šípka, dvojkoľaj: obojsmerná -->
	{#if vstup.kolaj === 'dvojkolaj'}
		{@const midX = (dverySx0 + dverySx1) / 2}
		<line
			x1={midX - 4}
			y1={arrowY}
			x2={dverySx0 + 1}
			y2={arrowY}
			stroke={CIERNA}
			stroke-width="0.5"
		/>
		<polygon points={sipka(midX - 4, arrowY, dverySx0 + 1, arrowY, 2.6, 1.4)} fill={CIERNA} />
		<line
			x1={midX + 4}
			y1={arrowY}
			x2={dverySx1 - 1}
			y2={arrowY}
			stroke={CIERNA}
			stroke-width="0.5"
		/>
		<polygon points={sipka(midX + 4, arrowY, dverySx1 - 1, arrowY, 2.6, 1.4)} fill={CIERNA} />
	{:else if vstup.smer === 'vlavo'}
		<line
			x1={dverySx1 - 1}
			y1={arrowY}
			x2={dverySx0 + 1}
			y2={arrowY}
			stroke={CIERNA}
			stroke-width="0.5"
		/>
		<polygon points={sipka(dverySx1 - 1, arrowY, dverySx0 + 1, arrowY, 2.6, 1.4)} fill={CIERNA} />
	{:else}
		<line
			x1={dverySx0 + 1}
			y1={arrowY}
			x2={dverySx1 - 1}
			y2={arrowY}
			stroke={CIERNA}
			stroke-width="0.5"
		/>
		<polygon points={sipka(dverySx0 + 1, arrowY, dverySx1 - 1, arrowY, 2.6, 1.4)} fill={CIERNA} />
	{/if}
	<!-- kóty: hĺbka (zvislo, vľavo) + zatvorená dĺžka (vodorovne, dole) -->
	<Kota
		x0={X(0)}
		{y0}
		x1={X(0)}
		{y1}
		perpOffset={-(r.w * 0.05)}
		text={fmtMm(vstup.hlbka)}
		color={MODRA}
		fontSize={3}
	/>
	<Kota
		x0={X(0)}
		y0={y1}
		x1={X(vstup.zatvorenaDlzka)}
		{y1}
		perpOffset={r.h * 0.14}
		text={fmtMm(vstup.zatvorenaDlzka)}
		color={MODRA}
		fontSize={3}
	/>
{/snippet}

<!-- ============================= textový popis ============================= -->
{#snippet texty(r: { x: number; y: number; w: number; h: number })}
	<!-- explicitné ASCII testid namiesto odvodeného z (diakritického) labelu —
	     jednoznačné, grep-ovateľné, žiadne prekvapenia s unicode rozsahom v regexe -->
	{@const riadky: [string, string, string][] = [
		['MODEL', 'model', emDash(vstup.model)],
		['VÝPLŇ', 'vyplna', emDash(vstup.vyplna)],
		['POSUV', 'posuv', posuvPopis(vstup.kolaj, vstup.smer)],
		['ARETÁCIA', 'aretacia', emDash(vstup.aretacia)],
		['DVERE', 'dvere', dverePopis(vstup.dvereSmer)],
		['VÝŠKA ČELA', 'vyska-cela', `${fmtMm(vstup.vyskaCela)} mm`],
		['DĹŽKA KOĽAJISKA', 'dlzka-kolajiska', `${fmtMm(vstup.dlzkaKolajiska)} mm`]
	]}
	{#each riadky as [label, testid, hodnota], i (testid)}
		<text
			x={r.x}
			y={r.y + 4 + i * 4.6}
			font-size="3"
			fill={CIERNA}
			data-testid={`bn-spec-${testid}`}><tspan font-weight="700">{label}:</tspan> {hodnota}</text
		>
	{/each}
	{#if vstup.ral}
		<text
			x={r.x}
			y={r.y + 4 + riadky.length * 4.6 + 2}
			font-size="3.6"
			font-weight="700"
			fill={CERVENA}
			data-testid="bn-ral-text">RAL: {vstup.ral}</text
		>
	{/if}
{/snippet}
