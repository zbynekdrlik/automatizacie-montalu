<script lang="ts">
	// Výkresový hárok (#137, ROZHODNUTÉ user 2026-08-10) — vonkajší rám so
	// súradnicovou mriežkou (stĺpce 1-16, riadky A-L, presne ako na referenčných CAD
	// výkresoch OP260027/OP260032/OP260055) + rohová pečiatka (TitleBlock). Výkres
	// samotný (kresba pergoly/bazéna/…) sa vkladá cez `content` snippet — konzument je
	// #138+, táto komponenta je len rám.
	//
	// viewBox je v MILIMETROCH A4 na šírku (297×210 default) — priamo väzba na reálny
	// papier, z ktorej sa dá čestne dopočítať MIERKA (viď $lib/vykres/mierka.ts).
	import { viewBoxAttr } from '$lib/vykres/kota';
	import TitleBlock from './TitleBlock.svelte';
	import type { Snippet } from 'svelte';
	// #146 bod 8: úzke technické písmo pre CELÝ výkresový hárok — self-hosted
	// Archivo Variable, `wdth` (šírkova) os namiesto `wght` (index.css, používaná
	// na /login) — žiadny externý font fetch, súbory bundlené z node_modules
	// rovnako ako existujúci import na login stránke. `font-stretch` na koreňovom
	// <svg> nižšie sa DEDÍ do všetkých vnorených <text> (mriežka, Kota, TitleBlock,
	// aj obsah konzumenta) bez potreby nastavovať ho v každej komponente zvlášť —
	// bežná CSS kaskáda funguje naprieč hranicami Svelte komponent.
	import '@fontsource-variable/archivo/wdth.css';

	const STLPCE = 16;
	const RIADKY_PISMENA = 'ABCDEFGHIJKL'.split(''); // 12 riadkov

	let {
		pageW = 297,
		pageH = 210,
		margin = 6,
		gridBand = 5,
		titleBlock,
		content
	}: {
		pageW?: number;
		pageH?: number;
		/** okraj papiera pred vonkajším rámom (mm) */
		margin?: number;
		/** hrúbka pásu s číslami/písmenami mriežky (mm) */
		gridBand?: number;
		/** dáta pre rohovú pečiatku — vynechaním sa pečiatka nekreslí (napr. testovacia mriežka) */
		titleBlock?: {
			nazov: string;
			projekt: string;
			cisloVykresu: string;
			mierka: string;
			revizia: string;
			varianta: string;
			vypracoval: string;
			datum: string;
			width?: number;
			height?: number;
		};
		/** obsah výkresu (kresba) — dostane plochu kresliacej oblasti (mm) na vykreslenie */
		content?: Snippet<[{ x: number; y: number; w: number; h: number }]>;
	} = $props();

	const frame = $derived({ x: margin, y: margin, w: pageW - 2 * margin, h: pageH - 2 * margin });
	const oblast = $derived({
		x: frame.x + gridBand,
		y: frame.y + gridBand,
		w: frame.w - 2 * gridBand,
		h: frame.h - 2 * gridBand
	});

	// stred i-teho stĺpca/riadku (0-based) v mriežke, pre umiestnenie čísla/písmena
	const stlpecStred = (i: number) => oblast.x + ((i + 0.5) * oblast.w) / STLPCE;
	const riadokStred = (i: number) => oblast.y + ((i + 0.5) * oblast.h) / RIADKY_PISMENA.length;

	const tbW = $derived(titleBlock?.width ?? 92);
	const tbH = $derived(titleBlock?.height ?? 50);
	const tbX = $derived(oblast.x + oblast.w - tbW);
	const tbY = $derived(oblast.y + oblast.h - tbH);
</script>

<svg
	viewBox={viewBoxAttr(pageW, pageH)}
	width="100%"
	role="img"
	aria-label="Výkresový hárok A4 na šírku s mriežkou a pečiatkou"
	data-testid="vykresovy-harok"
	style="font-family: 'Archivo Variable', sans-serif; font-stretch: 62%;"
>
	<!-- biele pozadie celej strany (tlač) -->
	<rect x="0" y="0" width={pageW} height={pageH} fill="#fff" />

	<!-- vonkajší rám papiera -->
	<rect
		x={frame.x}
		y={frame.y}
		width={frame.w}
		height={frame.h}
		fill="none"
		stroke="#0f172a"
		stroke-width="0.5"
	/>
	<!-- vnútorný rám kresliacej oblasti (ohraničuje pás s mriežkou) -->
	<rect
		x={oblast.x}
		y={oblast.y}
		width={oblast.w}
		height={oblast.h}
		fill="none"
		stroke="#0f172a"
		stroke-width="0.3"
	/>

	<!-- mriežka: stĺpce 1-16 hore/dole -->
	<g data-testid="mriezka-stlpce">
		{#each Array(STLPCE) as _, i (i)}
			{@const x = oblast.x + ((i + 1) * oblast.w) / STLPCE}
			{#if i < STLPCE - 1}
				<line x1={x} y1={frame.y} x2={x} y2={oblast.y} stroke="#0f172a" stroke-width="0.2" />
				<line
					x1={x}
					y1={oblast.y + oblast.h}
					x2={x}
					y2={frame.y + frame.h}
					stroke="#0f172a"
					stroke-width="0.2"
				/>
			{/if}
			<text
				x={stlpecStred(i)}
				y={frame.y + gridBand * 0.7}
				text-anchor="middle"
				font-size="2.6"
				fill="#0f172a">{i + 1}</text
			>
			<text
				x={stlpecStred(i)}
				y={oblast.y + oblast.h + gridBand * 0.7}
				text-anchor="middle"
				font-size="2.6"
				fill="#0f172a">{i + 1}</text
			>
		{/each}
	</g>

	<!-- mriežka: riadky A-L vľavo/vpravo -->
	<g data-testid="mriezka-riadky">
		{#each RIADKY_PISMENA as pismeno, i (pismeno)}
			{@const y = oblast.y + ((i + 1) * oblast.h) / RIADKY_PISMENA.length}
			{#if i < RIADKY_PISMENA.length - 1}
				<line x1={frame.x} y1={y} x2={oblast.x} y2={y} stroke="#0f172a" stroke-width="0.2" />
				<line
					x1={oblast.x + oblast.w}
					y1={y}
					x2={frame.x + frame.w}
					y2={y}
					stroke="#0f172a"
					stroke-width="0.2"
				/>
			{/if}
			<text
				x={frame.x + gridBand * 0.5}
				y={riadokStred(i) + 1}
				text-anchor="middle"
				font-size="2.6"
				fill="#0f172a">{pismeno}</text
			>
			<text
				x={oblast.x + oblast.w + gridBand * 0.5}
				y={riadokStred(i) + 1}
				text-anchor="middle"
				font-size="2.6"
				fill="#0f172a">{pismeno}</text
			>
		{/each}
	</g>

	<!-- obsah výkresu (kresba) — celá kresliaca plocha, konzument si sám vynechá roh s pečiatkou -->
	{#if content}
		{@render content(oblast)}
	{/if}

	<!-- rohová pečiatka -->
	{#if titleBlock}
		<g transform="translate({tbX} {tbY})">
			<TitleBlock
				width={tbW}
				height={tbH}
				nazov={titleBlock.nazov}
				projekt={titleBlock.projekt}
				cisloVykresu={titleBlock.cisloVykresu}
				mierka={titleBlock.mierka}
				revizia={titleBlock.revizia}
				varianta={titleBlock.varianta}
				vypracoval={titleBlock.vypracoval}
				datum={titleBlock.datum}
			/>
		</g>
	{/if}
</svg>

<style>
	/* #150: farebný režim výkresu (fill konštrukčných prvkov podľa RAL) sa musí
	   pri tlači zachovať — bez tohto niektoré prehliadače/tlačové ovládače orezávajú
	   farby ako "background graphics". No-op pre technický (čiernobiely) režim —
	   nemení žiadny existujúci fill/stroke, len hovorí tlači "zachovaj presne to,
	   čo je nastavené". Cieli priamo na VLASTNÝ <svg> tejto komponenty (žiadny
	   :global() netreba, keďže ho táto komponenta kreslí priamo). */
	@media print {
		svg {
			print-color-adjust: exact;
			-webkit-print-color-adjust: exact;
		}
	}
</style>
