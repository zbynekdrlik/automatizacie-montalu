<script lang="ts">
	// 2D náhľad zasklenia — čelný pohľad: N posuvných polí v ráme, kótovanie
	// celkovej šírky/výšky a rozmeru skla, šípka smeru otvárania.
	let {
		S,
		V,
		N,
		skloS,
		skloV,
		otvaranie = '',
		system = '',
		vrtanieZamku = 1050
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
	} = $props();

	const W = 760; // šírka kresby v px
	const M = { top: 46, right: 26, bottom: 64, left: 62 }; // miesto na kóty
	const CAS_ROW = 10; // kaskáda: px na jedno krídlo (odsadenie do hĺbky)

	let scale = $derived((W - M.left - M.right) / S);
	let h = $derived(V * scale);
	let panelW = $derived((S / N) * scale);
	let frame = $derived(Math.max(4, Math.min(14, 45 * scale))); // vizuálna hrúbka rámu poľa

	let dir = $derived(
		otvaranie.replace(/\s/g, '') === 'P-L' ? 'PL' : otvaranie.replace(/\s/g, '') === 'L-P' ? 'LP' : otvaranie ? 'OP' : ''
	);

	// Kaskáda krídel v reze (pohľad z interiéru) — nahrádza šípku + nápis „opona".
	// Každé krídlo = čiara; posuvné krídla sa kaskádovito odsadzujú v smere otvárania
	// (P-L doprava, L-P doľava); opona (2x*) = dve zrkadlové kaskády do stredu.
	// (Dominik 2026-07-14: „len čiary, kaskáda v reze".)
	let casRows = $derived(dir === 'OP' ? Math.max(1, Math.round(N / 2)) : Math.max(1, N));
	let casTop = $derived(M.top + h + 26);
	let totalH = $derived(dir ? casTop + casRows * CAS_ROW + 20 : h + M.top + M.bottom);
	let cascade = $derived.by(() => {
		const empty: { x: number; y: number; w: number }[] = [];
		if (!dir) return empty;
		const fw = W - M.left - M.right;
		const segs: { x: number; y: number; w: number }[] = [];
		if (dir === 'OP') {
			// opona: N/2 krídel na stranu, obe strany kaskádujú do stredu
			const per = Math.max(1, Math.round(N / 2));
			const hw = fw / 2;
			const seg = hw / (per + 0.5);
			const stepX = per > 1 ? (hw - seg - 5) / (per - 1) : 0;
			for (let i = 0; i < per; i++) {
				const y = casTop + i * CAS_ROW;
				segs.push({ x: M.left + i * stepX, y, w: seg }); // ľavá strana → do stredu
				segs.push({ x: W - M.right - seg - i * stepX, y, w: seg }); // pravá → do stredu
			}
		} else {
			// P-L doprava (0 hore vľavo), L-P zrkadlovo doľava (0 hore vpravo)
			const n = Math.max(1, N);
			const seg = fw / (n + 0.5);
			const stepX = n > 1 ? (fw - seg) / (n - 1) : 0;
			for (let i = 0; i < n; i++) {
				const y = casTop + i * CAS_ROW;
				const x = dir === 'LP' ? W - M.right - seg - i * stepX : M.left + i * stepX;
				segs.push({ x, y, w: seg });
			}
		}
		return segs;
	});

	const fmt = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');

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
</script>

<svg
	viewBox="0 0 {W} {totalH}"
	width="100%"
	role="img"
	aria-label="Náhľad zasklenia {S}×{V} mm, {N} polí"
	data-testid="nahlad-2d"
>
	<!-- kóta šírky hore -->
	<g stroke="#94a3b8" stroke-width="1" fill="none">
		<line x1={M.left} y1={M.top - 18} x2={W - M.right} y2={M.top - 18} />
		<line x1={M.left} y1={M.top - 24} x2={M.left} y2={M.top - 12} />
		<line x1={W - M.right} y1={M.top - 24} x2={W - M.right} y2={M.top - 12} />
	</g>
	<text x={M.left + (W - M.left - M.right) / 2} y={M.top - 24} text-anchor="middle" font-size="13" fill="#334155" font-weight="600">{fmt(S)} mm</text>

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
	<rect x={M.left - 3} y={M.top - 3} width={W - M.left - M.right + 6} height={h + 6} fill="none" stroke="#475569" stroke-width="1.5" rx="2" />

	<!-- polia -->
	{#each Array(N) as _, i (i)}
		{@const x = M.left + i * panelW}
		<!-- rám poľa -->
		<rect x={x + 1} y={M.top + 1} width={panelW - 2} height={h - 2} fill="#e2e8f0" stroke="#64748b" stroke-width="0.9" />
		<!-- sklo -->
		<rect
			x={x + frame}
			y={M.top + frame}
			width={panelW - 2 * frame}
			height={h - 2 * frame}
			fill="#dbeafe"
			stroke="#93c5fd"
			stroke-width="0.6"
		/>
		<!-- odlesk skla -->
		<line
			x1={x + frame + (panelW - 2 * frame) * 0.2}
			y1={M.top + frame + (h - 2 * frame) * 0.75}
			x2={x + frame + (panelW - 2 * frame) * 0.55}
			y2={M.top + frame + (h - 2 * frame) * 0.15}
			stroke="#bfdbfe"
			stroke-width="2.5"
			stroke-linecap="round"
			opacity="0.8"
		/>
		<text x={x + panelW / 2} y={M.top + 18} text-anchor="middle" font-size="11" fill="#64748b">{i + 1}</text>
	{/each}

	<!-- Deluxe zámkové otvory D46 na krajných sklách (⌀46, 50 mm od kraja, výška vŕtania) -->
	{#each zamky as z (z.cx)}
		{@const yDim = z.cy - z.r - 9}
		<!-- otvor (prerušovaný kruh = vŕtaný otvor) -->
		<circle cx={z.cx} cy={z.cy} r={z.r} fill="none" stroke="#334155" stroke-width="1" stroke-dasharray="3 2" />
		<!-- kóta 50 mm od kraja skla -->
		<g stroke="#475569" stroke-width="0.8" fill="none">
			<line x1={z.edgeX} y1={z.cy} x2={z.edgeX} y2={yDim - 3} />
			<line x1={z.cx} y1={z.cy - z.r} x2={z.cx} y2={yDim - 3} />
			<line x1={z.edgeX} y1={yDim} x2={z.cx} y2={yDim} />
		</g>
		<text x={(z.edgeX + z.cx) / 2} y={yDim - 2} text-anchor="middle" font-size="9" fill="#334155">{OKRAJ_ZAMOK}</text>
		<!-- ⌀46 + výška vŕtania pod otvorom -->
		<text x={z.cx} y={z.cy + z.r + 11} text-anchor="middle" font-size="9" fill="#334155" font-weight="600">⌀{D_ZAMOK}</text>
		<text x={z.cx} y={z.cy + z.r + 21} text-anchor="middle" font-size="9" fill="#334155">v {fmt(vrtanieZamku)}</text>
	{/each}

	<!-- rozmer skla v prvom poli -->
	<text x={M.left + panelW / 2} y={M.top + h / 2 - 8} text-anchor="middle" font-size="12" fill="#1d4ed8" font-weight="600">sklo</text>
	<text x={M.left + panelW / 2} y={M.top + h / 2 + 9} text-anchor="middle" font-size="12" fill="#1d4ed8" font-weight="700"
		>{fmt(skloS)} × {fmt(skloV)}</text
	>

	<!-- kaskáda krídel v reze (pohľad z interiéru) — nahrádza šípku smeru otvárania -->
	{#if dir}
		<text x={M.left} y={casTop - 9} font-size="10.5" fill="#64748b"
			>rez — pohľad z interiéru{dir === 'OP' ? ' · opona (od stredu)' : dir === 'PL' ? ' · P-L' : ' · L-P'}</text
		>
		<g data-testid="kaskada" stroke="#2563eb" stroke-width="2.6" stroke-linecap="round">
			{#each cascade as c (`${c.x}-${c.y}`)}
				<line x1={c.x} y1={c.y} x2={c.x + c.w} y2={c.y} />
			{/each}
		</g>
	{/if}
</svg>
