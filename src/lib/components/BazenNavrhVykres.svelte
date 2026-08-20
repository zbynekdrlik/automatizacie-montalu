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
	//
	// #168: REZ SEKCIOU (kým #163 nedoplní skutočný rez) je zámerne MALÝ pevný
	// poznámkový box namiesto stĺpca cez celú výšku hárku — uvoľňuje priestor
	// bokorysu/pôdorysu, ktoré teraz zdieľajú JEDNU mierku cez `sharedFitScale`
	// (kompozicia.ts) a sú vycentrované vo svojich riadkoch (namiesto doterajšieho
	// fixného `bokH*0.55`/`podH*0.6` odsadu) — viď design komentár na #168.
	import VykresovyHarok from '$lib/components/vykres/VykresovyHarok.svelte';
	import Kota from '$lib/components/vykres/Kota.svelte';
	import { fmtMm } from '$lib/vykres/kota';
	import { vypocitajMierku } from '$lib/vykres/mierka';
	import {
		sharedFitScale,
		centerAt,
		MIN_SPEC_FONT,
		MIN_DIM_FONT,
		type FitResult
	} from '$lib/vykres/kompozicia';
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

	// unikátne id pre <clipPath> — viac inštancií tejto komponenty na jednej
	// stránke by inak zdieľalo id (rovnaký vzor ako `uid` v TitleBlock.svelte /
	// Nahlad2D.svelte).
	const uid = $props.id();

	const PAGE_W = 297;
	const PAGE_H = 210;
	const MARGIN = 6;
	const GRID_BAND = 5;
	const OBLAST_W = PAGE_W - 2 * MARGIN - 2 * GRID_BAND;
	const OBLAST_H = PAGE_H - 2 * MARGIN - 2 * GRID_BAND;
	// rovnaká disciplína ako pergola (#146 review nález) — JEDNA konštanta
	// poslaná explicitne cez `titleBlockData.height`, nikdy dve nezávislé "50".
	// TB_W = VykresovyHarok's default `tbW` (titleBlock.width nie je nastavené,
	// takže platí jeho interný default 92) — potrebné TU na výpočet, kam smie
	// textový popis siahať, nech ho pečiatka nezakryje (review nález #139).
	const TB_H = 50;
	const TB_W = 92;

	let pocetSekcii = $derived(Math.max(1, Math.round(vstup.pocetSekcii)));
	let vysky = $derived(sekcieVysky(pocetSekcii, vstup.vyskaMax, vstup.vyskaMin));
	// `sirkaSekcieOverride` sa odovzdáva AJ sem (nie len do Kota popisku) —
	// inak by ručne zadaná šírka prvej sekcie ukazovala kótu na hranicu
	// nakreslenú podľa schematického rovnomerného delenia, ktorá ju vôbec
	// nemeria (review nález #139: vizuálne klamlivé, hoci číselne správne).
	let pozicie = $derived(
		sekciePozicie(vstup.zatvorenaDlzka, pocetSekcii, vstup.sirkaSekcieOverride)
	);
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
		<!-- #168: REZ SEKCIOU je odteraz MALÝ pevný poznámkový box (nesie len 2-3
		     riadky textu, kým #163 nedoplní skutočný rez) namiesto stĺpca
		     `oblast.w*0.17` × CELÁ výška — bokorys/pôdorys dostanú CELÚ šírku
		     hárku namiesto zúženého `mainW`. -->
		{@const noteW = 52}
		{@const noteH = 24}
		{@const specRowH = 42}
		{@const viewsY = oblast.y + topPad}
		{@const viewsH = Math.max(1, oblast.h - topPad - specRowH - gap)}
		{@const views = { x: oblast.x, y: viewsY, w: oblast.w, h: viewsH }}
		<!-- bokorys/pôdorys NEDOSTÁVAJÚ rovnaký 50/50 výškový pás — bokorys je takmer
		     vždy pomerovo VEĽMI plochý (výška čela/sekcie rádovo stovky mm oproti
		     mnohometrovej dĺžke koľajiska), zatiaľ čo pôdorys býva bližšie k
		     štvorcu (hĺbka vs zatvorená dĺžka) a teda potrebuje VIAC výšky, aby ho
		     `sharedFitScale` (spoločná mierka OBOCH pohľadov) nezviazal na
		     bokorysov zbytočne veľký, no nevyužitý výškový pás. Pomer sa odvíja od
		     reálnych rozmerov (vyskaMax vs hlbka), s podlahou/stropom, aby ani
		     extrémny vstup nezmenšil bokorysovu vlastnú hlavičku+kóty pod
		     čitateľnosť ani nepripravil pôdorys o väčšinový podiel. -->
		{@const bokFrac = Math.min(
			0.42,
			Math.max(0.22, vstup.vyskaMax / (vstup.vyskaMax + vstup.hlbka))
		)}
		{@const bokH = viewsH * bokFrac}
		{@const vgap = viewsH * 0.06}
		{@const podH = Math.max(1, viewsH - bokH - vgap)}
		{@const bok = { x: views.x, y: views.y, w: views.w, h: bokH }}
		{@const pod = { x: views.x, y: views.y + bokH + vgap, w: views.w, h: podH }}
		<!-- vlastná kresliaca podoblasť KAŽDÉHO pohľadu — hore odsadené pre jeho
		     nadpis ("BOKORYS"/"PÔDORYS"), dole pre jeho kóty (bokorys má TROJICU
		     kót pod sebou — šírka/dĺžka+presah/celková dĺžka, potrebuje viac
		     miesta než pôdorys s jednou). -->
		{@const bokTitlePad = bokH * 0.12}
		{@const bokDimPad = bokH * 0.32}
		{@const bokContent = {
			x: bok.x,
			y: bok.y + bokTitlePad,
			w: bok.w,
			h: Math.max(1, bokH - bokTitlePad - bokDimPad)
		}}
		{@const podTitlePad = podH * 0.12}
		{@const podDimPad = podH * 0.2}
		{@const podContent = {
			x: pod.x,
			y: pod.y + podTitlePad,
			w: pod.w,
			h: Math.max(1, podH - podTitlePad - podDimPad)
		}}
		<!-- jedna spoločná dĺžková mierka pre bokorys AJ pôdorys (aby stĺpiky
		     sekcií v oboch pohľadoch vizuálne sedeli pod sebou — rovnaká
		     projekčná disciplína ako v reálnych CAD výkresoch), teraz cez zdieľaný
		     `sharedFitScale` (kompozicia.ts, #168) namiesto ručného
		     `Math.min(scaleLenW, scaleBokH, scalePodH)`. Vodorovný počiatok (X=0,
		     rovnaký reálny bod pre OBA pohľady — koľajisko aj zatvorená dĺžka
		     začínajú na tej istej hrane) sa NESMIE centrovať nezávisle (dlzkaKolajiska
		     ≠ zatvorenaDlzka by inak posunulo počiatky a stĺpiky sekcií by sa
		     rozišli) — zdieľa sa z BOKORYSU (dlzkaKolajiska je vždy ten širší z
		     oboch, `presahKolajniska` garantuje dlzkaKolajiska > zatvorenaDlzka). -->
		{@const scale = sharedFitScale([
			{ mmW: vstup.dlzkaKolajiska, mmH: vstup.vyskaMax, area: bokContent },
			{ mmW: vstup.zatvorenaDlzka, mmH: vstup.hlbka, area: podContent }
		])}
		{@const bokFit = centerAt(vstup.dlzkaKolajiska, vstup.vyskaMax, bokContent, scale)}
		{@const podVFit = centerAt(vstup.zatvorenaDlzka, vstup.hlbka, podContent, scale)}
		{@const podFit: FitResult = {
			...podVFit,
			x0: bokFit.x0,
			x1: bokFit.x0 + vstup.zatvorenaDlzka * scale
		}}

		{@const noteRowY = oblast.y + oblast.h - specRowH}
		{@const note = { x: oblast.x, y: noteRowY + (specRowH - noteH) / 2, w: noteW, h: noteH }}
		<!-- review nález #139 (🟡): `spec` predtým siahal na CELÚ zvyšnú šírku
		     mainW, ktorej pravý okraj sa PRESNE zhoduje s pravým okrajom pečiatky
		     (tbX+TB_W === oblast.x+oblast.w) — dlhá voľnotextová hodnota (MODEL/
		     VÝPLŇ/ARETÁCIA, až 60 znakov) by sa tak mohla vykresliť POD nepriehľadnú
		     bielu pečiatku. Šírka teraz zámerne končí 2mm pred pečiatkou (`tbX`);
		     `texty` snippet nižšie to navyše fyzicky vynucuje cez <clipPath>, nie
		     len polohou regiónu (ktorá SVG <text> sama osebe neobmedzuje). -->
		{@const tbX = oblast.x + oblast.w - TB_W}
		{@const spec = {
			x: oblast.x + noteW + gap,
			y: noteRowY,
			w: Math.max(0, tbX - 2 - (oblast.x + noteW + gap)),
			h: specRowH
		}}

		<g data-testid="bn-rez-sekciou">
			{@render rezSekciou(note)}
		</g>
		<g data-testid="bn-bokorys">
			{@render bokorys(bok, bokFit)}
		</g>
		<g data-testid="bn-podorys">
			{@render podorys(pod, podFit)}
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
		y={r.y + r.h * 0.52}
		text-anchor="middle"
		font-size={MIN_SPEC_FONT}
		fill="#64748b"
		data-testid="bn-rez-sekciou-poznamka"
	>
		<tspan x={r.x + r.w / 2} dy="0">Rez sekciou</tspan>
		<tspan x={r.x + r.w / 2} dy="3.6">doplní</tspan>
		<tspan x={r.x + r.w / 2} dy="3.6">konštruktér</tspan>
	</text>
{/snippet}

<!-- ============================= bokorys (kaskáda sekcií) ============================= -->
<!-- #168: `fit` (namiesto samostatného `scale`) nesie zdieľanú mierku AJ vopred
     vycentrovanú pozíciu (x0/y0/y1) — bokorys/pôdorys sa už NEPOČÍTAJÚ nezávisle
     s vlastným fixným `r.h*0.62` odsadom; `x0` je navyše ZDIEĽANÝ s pôdorysom
     (viď `content` snippet vyššie), aby stĺpiky sekcií sedeli pod sebou. -->
{#snippet bokorys(r: { x: number; y: number; w: number; h: number }, fit: FitResult)}
	{@const baseY = fit.y1}
	{@const X = (mm: number) => fit.x0 + mm * fit.scale}
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
	<!-- pozicie.length === pocetSekcii+1, vysky.length === pocetSekcii → indexy definované -->
	{#each vysky as vyskaSekcie, i (i)}
		{@const sx0 = X(pozicie[i]!)}
		{@const sx1 = X(pozicie[i + 1]!)}
		{@const sy1 = baseY - vyskaSekcie * fit.scale}
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
	<!-- výšky: najvyššia sekcia (vľavo) / najnižšia sekcia (vpravo). Popisok
	     ČÍTA `vysky[]` (skutočne nakreslenú geometriu), NIE `vstup.vyskaMax`/
	     `vyskaMin` priamo — review nález #139: pri 1 sekcii `sekcieVysky` vráti
	     LEN [vyskaMax] (vyskaMin sa ignoruje, jedna sekcia nekaskáduje), takže
	     čítanie `vstup.vyskaMin` priamo by vytlačilo kótu, ktorej text nesedí
	     s nakreslenou výškou. Pre pocetSekcii>1 sú hodnoty zhodné s predošlým
	     správaním (vysky[0]===vyskaMax, vysky[posledná]===vyskaMin). -->
	<Kota
		x0={X(pozicie[0]!)}
		y0={baseY}
		x1={X(pozicie[0]!)}
		y1={baseY - vysky[0]! * fit.scale}
		perpOffset={-(r.w * 0.05)}
		text={fmtMm(vysky[0]!)}
		color={MODRA}
		fontSize={3}
	/>
	<Kota
		x0={X(pozicie[pozicie.length - 1]!)}
		y0={baseY}
		x1={X(pozicie[pozicie.length - 1]!)}
		y1={baseY - vysky[vysky.length - 1]! * fit.scale}
		perpOffset={r.w * 0.05}
		text={fmtMm(vysky[vysky.length - 1]!)}
		color={MODRA}
		fontSize={3}
	/>
	<!-- šírka prvej sekcie — LEN keď je ručne zadaná (appka nehádže vnorenie) -->
	{#if vstup.sirkaSekcieOverride !== undefined}
		<g data-testid="bn-bokorys-sirka-sekcie">
			<Kota
				x0={X(pozicie[0]!)}
				y0={baseY + r.h * 0.06}
				x1={X(pozicie[1]!)}
				y1={baseY + r.h * 0.06}
				perpOffset={r.h * 0.05}
				text={fmtMm(vstup.sirkaSekcieOverride)}
				color={MODRA}
				fontSize={MIN_DIM_FONT}
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
			fontSize={MIN_DIM_FONT}
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
<!-- #168: `fit.x0` je ZDIEĽANÝ s bokorysom (viď `content` snippet) — X=0 musí byť
     na ROVNAKEJ pozícii v oboch pohľadoch, aby deliace čiary sekcií vizuálne sedeli
     pod sebou (rovnaká disciplína, akú predtým garantoval spoločný `mainX`/`r.w`). -->
{#snippet podorys(r: { x: number; y: number; w: number; h: number }, fit: FitResult)}
	{@const X = (mm: number) => fit.x0 + mm * fit.scale}
	{@const y0 = fit.y0}
	{@const y1 = fit.y1}
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
	<!-- dverová sekcia zvýraznená oranžovo. stroke-width cez obrysStroke() —
	     review nález #139 (🟡, #153 disciplína): pevná hodnota by pri extrémnom
	     (ale platnom) vstupe (napr. 12 sekcií, malá zatvorenaDlzka, veľká hĺbka)
	     zhltla oranžovú výplň vlastným obrysom, presne ako ostatné vyplnené
	     tvary v tomto module. -->
	<rect
		x={dverySx0}
		y={y0}
		width={Math.max(0.3, dverySx1 - dverySx0)}
		height={y1 - y0}
		fill={ORANZOVA}
		fill-opacity="0.55"
		stroke={CIERNA}
		stroke-width={obrysStroke(Math.min(dverySx1 - dverySx0, y1 - y0) * 0.5)}
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
	<!-- review nález #139 (🟡): región `r` už stopuje 2mm pred pečiatkou (viď
	     `spec` vyššie), ale zúženie regiónu SAMO OSEBE nič nevynucuje — SVG
	     <text> nie je orezaný podľa neho, dlhá hodnota by cezeň jednoducho
	     pretiekla. <clipPath> ju fyzicky odreže (rovnaká technika ako
	     TitleBlock.svelte, `uid` z `$props.id()` proti kolízii viacerých
	     inštancií na stránke). -->
	<defs>
		<clipPath id="bn-texty-clip-{uid}">
			<rect x={r.x} y={r.y - 4} width={r.w} height={r.h + 8} />
		</clipPath>
	</defs>
	<g clip-path="url(#bn-texty-clip-{uid})">
		{#each riadky as [label, testid, hodnota], i (testid)}
			<text
				x={r.x}
				y={r.y + 4 + i * 4.6}
				font-size={MIN_SPEC_FONT}
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
	</g>
{/snippet}
