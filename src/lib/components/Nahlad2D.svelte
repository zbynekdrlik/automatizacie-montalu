<script lang="ts">
	// 2D náhľad zasklenia — čelný pohľad: N posuvných polí v ráme, kótovanie
	// celkovej šírky/výšky a rozmeru skla, kaskáda krídel v reze.
	import { overlapMm } from '$lib/cut';
	import { fmtSkloRozmer } from '$lib/sklo';
	import type { Klin } from '$lib/klin';
	import { sietkaStrana, type Sietka } from '$lib/sietka';
	// unikátne id pre <pattern> (viac Nahlad2D inštancií na jednej stránke pri
	// zimnej záhrade s viac posuvmi — duplicitné SVG id by boli neplatné DOM)
	const uid = $props.id();
	let {
		S,
		V,
		N,
		skloS,
		skloV,
		otvaranie = '',
		system = '',
		vrtanieZamku = 1050,
		kovanieL = '',
		kovanieP = '',
		kovanieStred = '',
		kovanieStredOkno = 'L',
		kliny = [],
		sietka = null
	}: {
		S: number;
		V: number;
		N: number;
		skloS: number;
		skloV: number;
		otvaranie?: string;
		/** systém zasklenia — Deluxe kreslí zámkové otvory D46 na krajných sklách */
		system?: string;
		/** výška vŕtania zámku (mm od spodku skla) — len Deluxe; do náhľadu + tlače */
		vrtanieZamku?: number;
		/** kovanie ĽAVEJ strany (kľučka) — vypíše sa do KRAJNÉHO ĽAVÉHO krídla */
		kovanieL?: string;
		/** kovanie PRAVEJ strany (kľučka) — vypíše sa do KRAJNÉHO PRAVÉHO krídla */
		kovanieP?: string;
		/** kovanie STREDOVÉHO krídla — len opona; kľučka navyše tam, kde sa polovice stretávajú */
		kovanieStred?: string;
		/** ktoré z dvoch stredových krídel kľučku nesie: 'L' = ľavé, 'P' = pravé */
		kovanieStredOkno?: 'L' | 'P';
		/** klíny nad posuvom (Patrik, #472 viac RÔZNYCH naraz) — trapéz s kótami nad rámom
		 *  na posuv, kreslené vedľa seba zľava (kumulatívny x-posun); prázdne pole = žiadny */
		kliny?: Klin[];
		/** sieťka na posuve (#86–#90) — vyznačí sa mimo rámu na strane podľa smeru posuvu */
		sietka?: Sietka | null;
	} = $props();

	const W = 760; // šírka kresby v px
	// Klín sa kreslí NAD okno — keď je zadaný, celý čelný pohľad sa posunie nižšie
	// o vyhradený pás. M je preto derived (nie const), takže všetky kóty, kovanie,
	// zámky aj kaskáda idú s ním bez ďalšej zmeny.
	const KLIN_PAS = 96; // px vyhradených nad okno pre klín (kresba + kóty)
	const KLIN_KRESBA = 46; // px výška NAJVYŠŠEJ strany klina v kresbe
	const KLIN_BASE = 96; // y spodnej hrany klina (nad kótou šírky okna na M.top-24)
	const KLIN_KOTA_Y = 24; // y kótovej línie dĺžky klina
	const M0 = { top: 46, right: 26, bottom: 64, left: 62 }; // miesto na kóty
	let M = $derived({ ...M0, top: M0.top + (kliny.length ? KLIN_PAS : 0) });
	const CAS_ROW = 14; // kaskáda: px na jedno krídlo (odsadenie do hĺbky/koľajnice)
	const CAS_BAR = 6; // kaskáda: hrúbka pruhu krídla
	const CAS_PAD = 12; // kaskáda: vnútorný okraj rámčeka

	let scale = $derived((W - M.left - M.right) / S);
	let h = $derived(V * scale);
	let panelW = $derived((S / N) * scale);
	let frame = $derived(Math.max(4, Math.min(14, 45 * scale))); // vizuálna hrúbka rámu poľa

	let dir = $derived(
		otvaranie.replace(/\s/g, '') === 'P-L'
			? 'PL'
			: otvaranie.replace(/\s/g, '') === 'L-P'
				? 'LP'
				: otvaranie
					? 'OP'
					: ''
	);

	// Reálny presah susedných krídel (mm) per systém žije v $lib/cut.ts (overlapMm),
	// spolu s drift-guard testom, že každý systém má hodnotu. Kreslí sa v MIERKE okna.

	// Kaskáda krídel v reze zhora (pôdorys, pohľad z interiéru) — nahrádza šípku +
	// nápis „opona". Krídla = pruhy v RÁMČEKU cez celú šírku okna; každé krídlo má REÁLNU
	// šírku a susedné sa prekrývajú o skutočný presah (mm→px v mierke okna). Kaskádujú
	// v smere otvárania (P-L doprava, L-P doľava); opona (2x*) = dve strany do stredu.
	let casRows = $derived(dir === 'OP' ? Math.max(1, Math.round(N / 2)) : Math.max(1, N));
	let casTop = $derived(M.top + h + 36); // pod čelným pohľadom + miesto na titulok
	let casFrameH = $derived(2 * CAS_PAD + (casRows - 1) * CAS_ROW + CAS_BAR);
	let totalH = $derived(dir ? casTop + casFrameH + 20 : h + M.top + M.bottom);
	let cascade = $derived.by(() => {
		const empty: { x: number; y: number; w: number }[] = [];
		if (!dir) return empty;
		// pruhy zarovnané na ŠÍRKU OKNA (rámček); presah = reálny mm v mierke rámčeka.
		const inset = 8;
		const xL = M.left + inset;
		const xR = W - M.right - inset;
		const fw = xR - xL;
		const y0 = casTop + CAS_PAD;
		const casScale = fw / S; // px na mm cez rámček kaskády
		const ov = overlapMm(system) * casScale; // presah v px (reálny mm v mierke)
		const segs: { x: number; y: number; w: number }[] = [];
		if (dir === 'OP') {
			// opona: N/2 krídel na stranu, obe strany kaskádujú do stredu s reálnym presahom
			const per = Math.max(1, Math.round(N / 2));
			const half = fw / 2 - 3; // malá medzera v strede
			// per krídel cez pol šírky s presahom ov: panel = (half + (per-1)*ov)/per
			const seg = Math.min(half, (half + (per - 1) * ov) / per);
			const stepX = seg - ov;
			for (let i = 0; i < per; i++) {
				const y = y0 + i * CAS_ROW;
				segs.push({ x: xL + i * stepX, y, w: seg }); // ľavá strana → do stredu
				segs.push({ x: xR - seg - i * stepX, y, w: seg }); // pravá → do stredu
			}
		} else {
			// P-L doprava (0 hore vľavo), L-P zrkadlovo doľava (0 hore vpravo)
			const n = Math.max(1, N);
			// n krídel cez celú šírku s presahom ov: panel = (fw + (n-1)*ov)/n
			const seg = Math.min(fw, (fw + (n - 1) * ov) / n);
			const stepX = seg - ov;
			for (let i = 0; i < n; i++) {
				const y = y0 + i * CAS_ROW;
				const x = dir === 'LP' ? xR - seg - i * stepX : xL + i * stepX;
				segs.push({ x, y, w: seg });
			}
		}
		return segs;
	});

	const fmt = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');

	// Kovanie krídla (kľučka) sa vypisuje DO krajných krídel — ľavé do prvého poľa,
	// pravé do posledného (tak, ako to nakreslil Patrik 2026-07-27). SVG nevie
	// zalamovať text, takže si ho zalomíme sami podľa šírky poľa.
	const KOV_FONT = 12;
	const KOV_LINE = 15;
	function wrapKov(text: string, boxW: number): string[] {
		const max = Math.max(8, Math.floor((boxW - 14) / (KOV_FONT * 0.52)));
		const out: string[] = [];
		let line = '';
		for (const w of text.split(/\s+/).filter(Boolean)) {
			if (!line) line = w;
			else if (line.length + 1 + w.length <= max) line += ' ' + w;
			else {
				out.push(line);
				line = w;
			}
		}
		if (line) out.push(line);
		return out;
	}
	// blok riadkov vycentrovaný na zadanú výšku (podiel výšky okna). Pri nízkom
	// a širokom okne je h v px malé, takže blok clampneme, aby nepreliezol nápis
	// s rozmerom skla (ten je na h/2 v prvom poli) ani rám poľa.
	const kovBlok = (
		text: string,
		poleIdx: number,
		podiel: number,
		limit: { poslednyMax?: number; prvyMin?: number } = {}
	) => {
		const lines = wrapKov(text, panelW);
		const blokH = (lines.length - 1) * KOV_LINE;
		let y0 = M.top + h * podiel - blokH / 2;
		if (limit.poslednyMax !== undefined) y0 = Math.min(y0, limit.poslednyMax - blokH);
		if (limit.prvyMin !== undefined) y0 = Math.max(y0, limit.prvyMin);
		y0 = Math.max(y0, M.top + frame + KOV_FONT); // ostaň v skle
		return {
			cx: M.left + poleIdx * panelW + panelW / 2,
			lines: lines.map((t, i) => ({ t, y: y0 + i * KOV_LINE }))
		};
	};
	// ľavé kovanie ide NAD rozmer skla (ten je v prvom poli), pravé na stred
	// posledného poľa; pri jednom krídle sa pravé posunie POD rozmer skla
	let kovL = $derived(
		kovanieL ? kovBlok(kovanieL, 0, 0.34, { poslednyMax: M.top + h / 2 - 22 }) : null
	);
	let kovP = $derived(
		kovanieP
			? N > 1
				? kovBlok(kovanieP, N - 1, 0.44)
				: kovBlok(kovanieP, 0, 0.72, { prvyMin: M.top + h / 2 + 26 })
			: null
	);
	// OPONA má kľučku NAVYŠE na jednom z dvoch krídel, kde sa polovice stretávajú
	// (Patrik 2026-07-31: „ak máme 2x3, kľučka bude okno 1, okno 6 a potom buď
	// okno 3 alebo 4"). 'L' = posledné pole ľavej polovice, 'P' = prvé pole pravej.
	let poleStred = $derived(
		Math.min(
			N - 1,
			Math.max(0, kovanieStredOkno === 'P' ? Math.floor(N / 2) : Math.floor(N / 2) - 1)
		)
	);
	let kovS = $derived(kovanieStred && N > 1 ? kovBlok(kovanieStred, poleStred, 0.6) : null);

	// Deluxe zámkové otvory D46: ⌀46 mm, 50 mm od kraja skla, na KRAJNÝCH sklách
	// (ľavé pole pri ľavej hrane, pravé pole pri pravej). Výška vŕtania od spodku
	// skla je konfigurovateľná (default 1050); diera sa v kresbe nemusí presne
	// posúvať, hlavné je zobraziť + okótovať hodnotu (Dominik 2026-07-14).
	const D_ZAMOK = 46; // priemer otvoru [mm]
	const OKRAJ_ZAMOK = 50; // vzdialenosť stredu diery od kraja skla [mm]
	let zamky = $derived.by(() => {
		if (system !== 'Deluxe' || !(N >= 1)) return [];
		const r = (D_ZAMOK / 2) * scale;
		const glassTop = M.top + frame;
		const glassBot = M.top + h - frame;
		// stred vo výške vrtanieZamku od spodku, orezané aby kruh ostal v skle
		const cyRaw = glassBot - vrtanieZamku * scale;
		const cy = Math.max(glassTop + r + 4, Math.min(glassBot - r - 4, cyRaw));
		const idxs = N === 1 ? [0] : [0, N - 1];
		return idxs.map((i) => {
			const left = i === 0;
			const gx0 = M.left + i * panelW + frame;
			const gx1 = M.left + i * panelW + panelW - frame;
			const edgeX = left ? gx0 : gx1;
			const cx = left ? gx0 + OKRAJ_ZAMOK * scale : gx1 - OKRAJ_ZAMOK * scale;
			return { cx, cy, r, edgeX, left };
		});
	});

	// Klíny nad posuvom (#472 viac RÔZNYCH naraz): každý trapéz s dlhou hornou hranou
	// (dĺžka), ľavou výškou v1 a pravou v2. Dĺžka je v MIERKE okna (klín kratší ako
	// okno je aj v kresbe kratší); výšky sa škálujú na KLIN_KRESBA per klín, aby bola
	// kresba čitateľná aj pri nízkom kline — čísla v kótach sú vždy tie zadané. Viac
	// klinov sa kreslí VEDĽA SEBA zľava (kumulatívny x-posun, rovnaká logika ako
	// `geo/zasklenia.ts`'s `x0 += klin.dlzka` v 3D náhľade) — pri PRESNE 1 kline je
	// geometria byte-identická s pôvodným jednoklinovým výpočtom (regresná parita).
	let klinGeos = $derived.by(() => {
		if (!kliny.length) return [];
		const base = KLIN_BASE; // spodná hrana klina (nad kótou šírky okna)
		let cursor = M.left;
		return kliny.map((k) => {
			const maxV = Math.max(k.v1, k.v2, 1);
			const w = Math.max(24, Math.min(W - M.left - M.right, k.dlzka * scale));
			const x0 = cursor;
			const x1 = x0 + w;
			cursor = x1;
			return {
				klin: k,
				x0,
				x1,
				base,
				y1: base - (k.v1 / maxV) * KLIN_KRESBA,
				y2: base - (k.v2 / maxV) * KLIN_KRESBA,
				body: [
					[x0, base],
					[x0, base - (k.v1 / maxV) * KLIN_KRESBA],
					[x1, base - (k.v2 / maxV) * KLIN_KRESBA],
					[x1, base]
				]
					.map(([x, y]) => `${Math.round(x! * 10) / 10},${Math.round(y! * 10) / 10}`)
					.join(' ')
			};
		});
	});

	// Sieťka (#86–#90, KOREKCIA 2026-08-02): sieťka je ĎALŠIE krídlo tohto posuvu,
	// „úplne rovnaký rozmer ako každé iné okno v tom posuve" — preto sa kreslí ako
	// PLNOHODNOTNÉ pole TEJ ISTEJ šírky (`panelW`) mimo rámu, na strane podľa smeru
	// posuvu (L-P → vľavo, P-L → vpravo). Len na jednom súvislom behu krídel (opona
	// nemá určenú stranu — `sietkaStrana('Opona') === null` — tam sa nekreslí, presne
	// ako pri Money výpočte). Viditeľná plocha (viewBox) sa o šírku panela rozšíri
	// na tú stranu, kde sieťka pribúda — ostatné kóty/rám ostávajú nedotknuté.
	let sietkaStranaVal = $derived(sietka ? sietkaStrana(otvaranie) : null);
	let sietkaVlavo = $derived(sietkaStranaVal === 'ľavá');
	let sietkaGeo = $derived.by(() => {
		if (!sietka || !sietkaStranaVal) return null;
		const x = sietkaVlavo ? M.left - panelW : W - M.right;
		return { x, y: M.top, w: panelW, h, cx: x + panelW / 2 };
	});
	let viewX = $derived(sietkaGeo && sietkaVlavo ? -panelW : 0);
	let viewW = $derived(W + (sietkaGeo ? panelW : 0));
</script>

<svg
	viewBox="{viewX} 0 {viewW} {totalH}"
	width="100%"
	role="img"
	aria-label="Náhľad zasklenia {S}×{V} mm, {N} polí{sietkaGeo ? ' + sieťka' : ''}"
	data-testid="nahlad-2d"
>
	<!-- KLÍNY nad posuvom (#472 viac RÔZNYCH naraz, len keď je zadaný aspoň jeden):
	     per klín trapéz + kóty dĺžky, oboch výšok, hĺbky a počtu kusov, vedľa seba
	     zľava. Display-only prvok — do Money odpisu nevstupuje. Riadok 0 si drží
	     BEZ suffixu testid `nahlad-klin` (spätná kompatibilita s e2e pred #472). -->
	{#each klinGeos as g, i (i)}
		<g data-testid={i === 0 ? 'nahlad-klin' : `nahlad-klin-${i}`}>
			<polygon points={g.body} fill="#fef3c7" stroke="#b45309" stroke-width="1.2" />
			<!-- kóta dĺžky nad klinom -->
			<g stroke="#b45309" stroke-width="0.9" fill="none">
				<line x1={g.x0} y1={KLIN_KOTA_Y} x2={g.x1} y2={KLIN_KOTA_Y} />
				<line x1={g.x0} y1={KLIN_KOTA_Y - 5} x2={g.x0} y2={KLIN_KOTA_Y + 5} />
				<line x1={g.x1} y1={KLIN_KOTA_Y - 5} x2={g.x1} y2={KLIN_KOTA_Y + 5} />
			</g>
			<text
				x={(g.x0 + g.x1) / 2}
				y={KLIN_KOTA_Y - 6}
				text-anchor="middle"
				font-size="11"
				fill="#92400e"
				font-weight="600">klín — dĺžka {fmt(g.klin.dlzka)} mm</text
			>
			<!-- výšky na oboch stranách -->
			<text
				x={g.x0 - 6}
				y={g.y1 - 4}
				text-anchor="start"
				font-size="10"
				fill="#92400e"
				font-weight="600">v1 {fmt(g.klin.v1)}</text
			>
			<text
				x={g.x1 - 2}
				y={g.y2 - 4}
				text-anchor="end"
				font-size="10"
				fill="#92400e"
				font-weight="600">v2 {fmt(g.klin.v2)}</text
			>
			<!-- hĺbka + počet kusov pod klinom -->
			<text x={g.x0 + 4} y={g.base + 12} font-size="10" fill="#92400e"
				>šírka (hĺbka) {fmt(g.klin.sirka)} mm · {g.klin.ks} ks</text
			>
		</g>
	{/each}

	<!-- kóta šírky hore -->
	<g stroke="#94a3b8" stroke-width="1" fill="none">
		<line x1={M.left} y1={M.top - 18} x2={W - M.right} y2={M.top - 18} />
		<line x1={M.left} y1={M.top - 24} x2={M.left} y2={M.top - 12} />
		<line x1={W - M.right} y1={M.top - 24} x2={W - M.right} y2={M.top - 12} />
	</g>
	<text
		x={M.left + (W - M.left - M.right) / 2}
		y={M.top - 24}
		text-anchor="middle"
		font-size="13"
		fill="#334155"
		font-weight="600">{fmt(S)} mm</text
	>

	<!-- kóta výšky vľavo -->
	<g stroke="#94a3b8" stroke-width="1" fill="none">
		<line x1={M.left - 18} y1={M.top} x2={M.left - 18} y2={M.top + h} />
		<line x1={M.left - 24} y1={M.top} x2={M.left - 12} y2={M.top} />
		<line x1={M.left - 24} y1={M.top + h} x2={M.left - 12} y2={M.top + h} />
	</g>
	<text
		x={M.left - 26}
		y={M.top + h / 2}
		text-anchor="middle"
		font-size="13"
		fill="#334155"
		font-weight="600"
		transform="rotate(-90 {M.left - 26} {M.top + h / 2})">{fmt(V)} mm</text
	>

	<!-- vonkajší rám (koľajnice) -->
	<rect
		x={M.left - 3}
		y={M.top - 3}
		width={W - M.left - M.right + 6}
		height={h + 6}
		fill="none"
		stroke="#475569"
		stroke-width="1.5"
		rx="2"
	/>

	<!-- polia -->
	{#each Array(N) as _, i (i)}
		{@const x = M.left + i * panelW}
		<!-- rám poľa -->
		<rect
			x={x + 1}
			y={M.top + 1}
			width={panelW - 2}
			height={h - 2}
			fill="#e2e8f0"
			stroke="#64748b"
			stroke-width="0.9"
		/>
		<!-- sklo -->
		<rect
			x={x + frame}
			y={M.top + frame}
			width={panelW - 2 * frame}
			height={h - 2 * frame}
			fill="#e9edf0"
			stroke="#a7adb4"
			stroke-width="0.6"
		/>
		<!-- odlesk skla -->
		<line
			x1={x + frame + (panelW - 2 * frame) * 0.2}
			y1={M.top + frame + (h - 2 * frame) * 0.75}
			x2={x + frame + (panelW - 2 * frame) * 0.55}
			y2={M.top + frame + (h - 2 * frame) * 0.15}
			stroke="#c8ccd0"
			stroke-width="2.5"
			stroke-linecap="round"
			opacity="0.8"
		/>
		<text x={x + panelW / 2} y={M.top + 18} text-anchor="middle" font-size="11" fill="#64748b"
			>{i + 1}</text
		>
	{/each}

	<!-- Sieťka (#86–#90, KOREKCIA 2026-08-02): PLNOHODNOTNÉ pole (rovnaká šírka ako
	     ostatné krídla) mimo rámu na strane podľa smeru posuvu — 3K so sieťkou takto
	     ukáže 4 polia (3 sklenené + 1 sieťkové), presne ako Money odpis počíta. -->
	{#if sietka && sietkaGeo}
		<g data-testid="nahlad-sietka">
			<defs>
				<pattern
					id="sietka-mriezka-{uid}"
					width="6"
					height="6"
					patternTransform="rotate(45)"
					patternUnits="userSpaceOnUse"
				>
					<line x1="0" y1="0" x2="0" y2="6" stroke="#64748b" stroke-width="1" opacity="0.5" />
				</pattern>
			</defs>
			<rect
				x={sietkaGeo.x + 1}
				y={sietkaGeo.y + 1}
				width={sietkaGeo.w - 2}
				height={sietkaGeo.h - 2}
				fill="#e2e8f0"
				stroke="#64748b"
				stroke-width="0.9"
			/>
			<rect
				x={sietkaGeo.x + frame}
				y={sietkaGeo.y + frame}
				width={Math.max(0, sietkaGeo.w - 2 * frame)}
				height={Math.max(0, sietkaGeo.h - 2 * frame)}
				fill="url(#sietka-mriezka-{uid})"
				stroke="#64748b"
				stroke-width="0.8"
				stroke-dasharray="4 3"
			/>
			<text x={sietkaGeo.cx} y={sietkaGeo.y + 18} text-anchor="middle" font-size="11" fill="#585d65"
				>{N + 1}</text
			>
			<text
				x={sietkaGeo.cx}
				y={sietkaGeo.y + sietkaGeo.h / 2}
				text-anchor="middle"
				font-size="10"
				fill="#585d65"
				font-weight="700"
				transform="rotate(-90 {sietkaGeo.cx} {sietkaGeo.y + sietkaGeo.h / 2})">sieťka</text
			>
		</g>
	{/if}

	<!-- Deluxe zámkové otvory D46 na krajných sklách (⌀46, 50 mm od kraja, výška vŕtania) -->
	{#each zamky as z (z.cx)}
		{@const yDim = z.cy - z.r - 9}
		<!-- otvor (prerušovaný kruh = vŕtaný otvor) -->
		<circle
			cx={z.cx}
			cy={z.cy}
			r={z.r}
			fill="none"
			stroke="#334155"
			stroke-width="1"
			stroke-dasharray="3 2"
		/>
		<!-- kóta 50 mm od kraja skla -->
		<g stroke="#475569" stroke-width="0.8" fill="none">
			<line x1={z.edgeX} y1={z.cy} x2={z.edgeX} y2={yDim - 3} />
			<line x1={z.cx} y1={z.cy - z.r} x2={z.cx} y2={yDim - 3} />
			<line x1={z.edgeX} y1={yDim} x2={z.cx} y2={yDim} />
		</g>
		<text x={(z.edgeX + z.cx) / 2} y={yDim - 2} text-anchor="middle" font-size="9" fill="#334155"
			>{OKRAJ_ZAMOK}</text
		>
		<!-- ⌀46 + výška vŕtania pod otvorom -->
		<text
			x={z.cx}
			y={z.cy + z.r + 11}
			text-anchor="middle"
			font-size="9"
			fill="#334155"
			font-weight="600">⌀{D_ZAMOK}</text
		>
		<text x={z.cx} y={z.cy + z.r + 21} text-anchor="middle" font-size="9" fill="#334155"
			>v {fmt(vrtanieZamku)}</text
		>
	{/each}

	<!-- kovanie (kľučka) v krajných krídlach — ľavé a pravé zvlášť -->
	{#if kovL}
		<g data-testid="kovanie-l">
			{#each kovL.lines as ln (ln.y)}
				<text
					x={kovL.cx}
					y={ln.y}
					text-anchor="middle"
					font-size={KOV_FONT}
					fill="#0f172a"
					font-weight="600">{ln.t}</text
				>
			{/each}
		</g>
	{/if}
	{#if kovP}
		<g data-testid="kovanie-p">
			{#each kovP.lines as ln (ln.y)}
				<text
					x={kovP.cx}
					y={ln.y}
					text-anchor="middle"
					font-size={KOV_FONT}
					fill="#0f172a"
					font-weight="600">{ln.t}</text
				>
			{/each}
		</g>
	{/if}
	<!-- kľučka navyše na stredovom krídle (opona) -->
	{#if kovS}
		<g data-testid="kovanie-stred">
			{#each kovS.lines as ln (ln.y)}
				<text
					x={kovS.cx}
					y={ln.y}
					text-anchor="middle"
					font-size={KOV_FONT}
					fill="#0f172a"
					font-weight="600">{ln.t}</text
				>
			{/each}
		</g>
	{/if}

	<!-- rozmer skla v prvom poli — s jednotkami hneď za číslom (kopíruje sa do objednávky skla) -->
	<text
		x={M.left + panelW / 2}
		y={M.top + h / 2 - 8}
		text-anchor="middle"
		font-size="12"
		fill="#8a5a2b"
		font-weight="600">sklo</text
	>
	<text
		x={M.left + panelW / 2}
		y={M.top + h / 2 + 9}
		text-anchor="middle"
		font-size="12"
		fill="#8a5a2b"
		font-weight="700"
		data-testid="nahlad-sklo-rozmer">{fmtSkloRozmer(skloS, skloV)}</text
	>

	<!-- kaskáda krídel v reze zhora (rámček cez šírku okna) — nahrádza šípku otvárania -->
	{#if dir}
		<text x={M.left} y={casTop - 10} font-size="11" fill="#334155" font-weight="600"
			>Kaskáda krídel — rez zhora, pohľad z interiéru{dir === 'OP'
				? ' (opona, od stredu)'
				: dir === 'PL'
					? ' (P-L)'
					: ' (L-P)'}</text
		>
		<!-- rámček = šírka okna (zarovnaný s čelným pohľadom hore) -->
		<rect
			x={M.left}
			y={casTop}
			width={W - M.left - M.right}
			height={casFrameH}
			rx="5"
			fill="#f8fafc"
			stroke="#94a3b8"
			stroke-width="1.2"
		/>
		<g data-testid="kaskada">
			{#each cascade as c (`${c.x}-${c.y}`)}
				<rect
					x={c.x}
					y={c.y}
					width={c.w}
					height={CAS_BAR}
					rx={CAS_BAR / 2}
					fill="#8a5a2b"
					opacity="0.9"
				/>
			{/each}
		</g>
	{/if}
</svg>
