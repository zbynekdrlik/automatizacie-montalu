<script lang="ts">
	// Rohová pečiatka návrhového výkresu (#137) — logo + adresa, NÁZOV, PROJEKT,
	// ČÍSLO VÝKRESU (= OP číslo), MIERKA, Revízia, VARIANTA, Vypracoval, Dátum,
	// značka NAVRH. Dátum je HOTOVÝ formátovaný reťazec zo servera (formatDatumCasSk,
	// rovnaká disciplína ako #114) — komponenta sama nič nepočíta.
	//
	// Kreslí sa relatívne k lokálnemu počiatku (0,0) = ľavý horný roh — volajúci
	// umiestni cez obalový `<g transform="translate(x,y)">` (rovnaká konvencia ako
	// MontAluLogo/Kota).
	import MontAluLogo from './MontAluLogo.svelte';

	// unikátne id pre <clipPath> — viac TitleBlock inštancií na jednej stránke by inak
	// zdieľalo id (neplatný duplicitný DOM), rovnaký vzor ako `uid` v Nahlad2D.svelte
	const uid = $props.id();

	let {
		width = 92,
		height = 50,
		nazov,
		projekt,
		cisloVykresu,
		mierka,
		revizia,
		varianta,
		vypracoval,
		datum
	}: {
		width?: number;
		height?: number;
		nazov: string;
		projekt: string;
		cisloVykresu: string;
		/** už vypočítaná (nikdy natvrdo "1:20") — viď `$lib/vykres/mierka.ts` */
		mierka: string;
		revizia: string;
		varianta: string;
		vypracoval: string;
		/** už naformátovaný ("D.M.RRRR HH:MM") — viď `formatDatumCasSk` */
		datum: string;
	} = $props();

	const leftW = $derived(width * 0.42);
	const rightW = $derived(width - leftW);
	// vodorovné hranice riadkov pravého stĺpca (zhora) — dostatočná medzera medzi
	// popiskom a hodnotou v každom riadku (nález vizuálnej kontroly: pôvodné husté
	// zlomky 0.4/0.62/0.8/0.92 nechávali Revízia/VARIANTA riadku len ~1mm, popisok a
	// hodnota sa prekrývali).
	const y1 = $derived(height * 0.24); // koniec NÁZOV
	const y2 = $derived(height * 0.42); // koniec PROJEKT
	const y3 = $derived(height * 0.62); // koniec ČÍSLO VÝKRESU | MIERKA (aj Vypracoval | Dátum vľavo)
	const y4 = $derived(height * 0.8); // koniec Revízia | VARIANTA
	// zvislá hranica v riadku ČÍSLO VÝKRESU/MIERKA a Revízia/VARIANTA
	const cisloW = $derived(rightW * 0.6);
	const reviziaW = $derived(rightW * 0.5);

	const LBL = '#64748b'; // sivá — malé popisky polí (konzistentné s .sub v app.css)
	const VAL = '#0f172a'; // čierna — hodnoty
</script>

<g data-testid="title-block" font-family="inherit">
	<defs>
		<!-- ochrana proti pretečeniu dlhých hodnôt (reálne názvy objednávok môžu byť
		     dlhšie než demo dáta) — hodnota sa ORAMUJE na šírku svojej bunky, nikdy
		     nepretečie mimo rám pečiatky -->
		<clipPath id="tb-clip-nazov-{uid}"><rect x={leftW} y="0" width={rightW} height={y1} /></clipPath
		>
		<clipPath id="tb-clip-projekt-{uid}"
			><rect x={leftW} y={y1} width={rightW} height={y2 - y1} /></clipPath
		>
		<clipPath id="tb-clip-cislo-{uid}"
			><rect x={leftW} y={y2} width={cisloW} height={y3 - y2} /></clipPath
		>
	</defs>

	<!-- vonkajší rám pečiatky -->
	<rect x="0" y="0" {width} {height} fill="#fff" stroke="#0f172a" stroke-width="0.5" />
	<!-- zvislá deliaca čiara: logo/adresa | polia -->
	<line x1={leftW} y1="0" x2={leftW} y2={height} stroke="#0f172a" stroke-width="0.35" />
	<!-- vodorovné deliace čiary v pravom stĺpci -->
	<line x1={leftW} {y1} x2={width} y2={y1} stroke="#0f172a" stroke-width="0.35" />
	<line x1={leftW} y1={y2} x2={width} {y2} stroke="#0f172a" stroke-width="0.35" />
	<line x1={leftW} y1={y3} x2={width} y2={y3} stroke="#0f172a" stroke-width="0.35" />
	<line x1={leftW} y1={y4} x2={width} y2={y4} stroke="#0f172a" stroke-width="0.35" />
	<!-- zvislé deliace čiary v riadkoch ČÍSLO VÝKRESU/MIERKA a Revízia/VARIANTA -->
	<line
		x1={leftW + cisloW}
		y1={y2}
		x2={leftW + cisloW}
		y2={y3}
		stroke="#0f172a"
		stroke-width="0.35"
	/>
	<line
		x1={leftW + reviziaW}
		y1={y3}
		x2={leftW + reviziaW}
		y2={y4}
		stroke="#0f172a"
		stroke-width="0.35"
	/>
	<!-- vodorovná deliaca čiara v ľavom stĺpci: adresa | Vypracoval/Dátum -->
	<line x1="0" y1={y3} x2={leftW} y2={y3} stroke="#0f172a" stroke-width="0.35" />
	<line
		x1={leftW * 0.5}
		y1={y3}
		x2={leftW * 0.5}
		y2={height}
		stroke="#0f172a"
		stroke-width="0.35"
	/>

	<!-- ĽAVÝ STĹPEC: logo + adresa -->
	<g transform="translate(3.5 2.5)">
		<MontAluLogo size={6.5} />
	</g>
	<text x="3.5" y="18" font-size="3.6" fill={VAL}>MONT-ALU s.r.o.</text>
	<text x="3.5" y="22" font-size="3.2" fill={LBL}>Vrádište 269</text>
	<text x="3.5" y="26" font-size="3.2" fill={LBL}>908 49 Vrádište</text>
	<text x="3.5" y="30" font-size="3.2" fill={LBL}>Slovenská republika</text>

	<!-- Vypracoval | Dátum -->
	<text x="2" y={y3 + 4} font-size="2.6" fill={LBL}>Vypracoval</text>
	<text x="2" y={height - 3} font-size="3.4" fill={VAL} data-testid="tb-vypracoval"
		>{vypracoval}</text
	>
	<text x={leftW * 0.5 + 2} y={y3 + 4} font-size="2.6" fill={LBL}>Dátum</text>
	<text x={leftW * 0.5 + 2} y={height - 3} font-size="3" fill={VAL} data-testid="tb-datum"
		>{datum}</text
	>

	<!-- NÁZOV -->
	<text x={leftW + 2.5} y="4.5" font-size="2.8" fill={LBL}>NÁZOV</text>
	<g clip-path="url(#tb-clip-nazov-{uid})">
		<text
			x={leftW + 2.5}
			y={y1 - 2.5}
			font-size="4"
			font-weight="700"
			fill={VAL}
			data-testid="tb-nazov">{nazov}</text
		>
	</g>

	<!-- PROJEKT -->
	<text x={leftW + 2.5} y={y1 + 3.5} font-size="2.8" fill={LBL}>PROJEKT</text>
	<g clip-path="url(#tb-clip-projekt-{uid})">
		<text x={leftW + 2.5} y={y2 - 1.5} font-size="3.4" fill={VAL} data-testid="tb-projekt"
			>{projekt}</text
		>
	</g>

	<!-- ČÍSLO VÝKRESU | MIERKA -->
	<text x={leftW + 2.5} y={y2 + 4} font-size="2.6" fill={LBL}>ČÍSLO VÝKRESU</text>
	<g clip-path="url(#tb-clip-cislo-{uid})">
		<text
			x={leftW + 2.5}
			y={y3 - 1.5}
			font-size="4"
			font-weight="700"
			fill={VAL}
			data-testid="tb-cislo-vykresu">{cisloVykresu}</text
		>
	</g>
	<text x={leftW + cisloW + 2} y={y2 + 4} font-size="2.6" fill={LBL}>MIERKA</text>
	<text
		x={leftW + cisloW + 2}
		y={y3 - 1.5}
		font-size="3.4"
		font-weight="600"
		fill="#1d4ed8"
		data-testid="tb-mierka">{mierka}</text
	>

	<!-- Revízia | VARIANTA -->
	<text x={leftW + 2.5} y={y3 + 3} font-size="2.6" fill={LBL}>Revízia</text>
	<text x={leftW + 2.5} y={y4 - 1} font-size="3.2" fill={VAL} data-testid="tb-revizia"
		>{revizia}</text
	>
	<text x={leftW + reviziaW + 2} y={y3 + 3} font-size="2.6" fill={LBL}>VARIANTA</text>
	<text x={leftW + reviziaW + 2} y={y4 - 1} font-size="3.2" fill={VAL} data-testid="tb-varianta"
		>{varianta}</text
	>

	<!-- Značka NAVRH — pečiatka typu výkresu -->
	<text
		x={leftW + rightW / 2}
		y={(y4 + height) / 2 + 2.2}
		text-anchor="middle"
		font-size="5.4"
		font-weight="800"
		letter-spacing="0.12em"
		fill={VAL}
		data-testid="tb-navrh">NAVRH</text
	>
</g>
