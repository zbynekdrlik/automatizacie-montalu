<script lang="ts">
	// Výkres šikmého FIX zasklenia — kreslí to isté, čo výrobné výkresy OP260236 /
	// OP260264: obrys konštrukcie, stĺpiky medzi poľami, kóty (celková šírka, šírky
	// polí, obe krajné výšky, výšky na stĺpikoch, dĺžka šikmej hrany po poliach) a
	// uhol sklonu. Dielňa reže podľa tohto výkresu.
	import type { FixVykres } from '$lib/fix';

	let {
		r,
		zrkadlo = false,
		oznacenie = 'L'
	}: {
		r: FixVykres;
		/** true = zrkadlový kus (konštrukcia otočená doľava/doprava) */
		zrkadlo?: boolean;
		/** predpona označenia polí na výkrese (L = ľavý kus, P = pravý) */
		oznacenie?: string;
	} = $props();

	const W = 900; // šírka kresby v px
	const M = { top: 74, right: 92, bottom: 78, left: 92 };
	const KRESBA_W = W - M.left - M.right;
	const MAX_H = 300; // px — vysoký úzky fix inak preleze cez celú stránku

	// mierka: šírka aj výška v ROVNAKEJ mierke (tvar musí sedieť), zmenšená ak by
	// bola konštrukcia privysoká na kresbu
	let scale = $derived(Math.min(KRESBA_W / r.S, MAX_H / Math.max(r.V1, r.V2)));
	let base = $derived(M.top + Math.max(r.V1, r.V2) * scale); // spodná hrana konštrukcie
	let totalH = $derived(base + M.bottom);

	/** x-ová súradnica bodu vzdialeného `mm` od ĽAVÉHO kraja konštrukcie.
	 *  Zrkadlový kus je tá istá konštrukcia otočená — otočíme len súradnicu,
	 *  texty ostávajú čitateľné (nekreslíme cez SVG transform). */
	const X = (mm: number) => (zrkadlo ? M.left + (r.S - mm) * scale : M.left + mm * scale);
	const Y = (vyska: number) => base - vyska * scale;
	/** výška konštrukcie v mieste `mm` od ľavého kraja */
	const vyskaV = (mm: number) => r.V1 + ((r.V2 - r.V1) * mm) / r.S;

	const fmt = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

	// hranice polí v mm od ľavého kraja (0, …, S)
	let hranice = $derived([0, ...r.kumulSirka]);
	// polia sa číslujú od VYŠŠEJ strany (tak sú značené L1/L2/L3 na výkresoch)
	let cislovanieZlava = $derived(r.V1 >= r.V2);
	let obrys = $derived(
		[
			[X(0), base],
			[X(0), Y(r.V1)],
			[X(r.S), Y(r.V2)],
			[X(r.S), base]
		]
			// každý bod je 2-prvkové [x, y] pole
			.map(([x, y]) => `${Math.round(x! * 10) / 10},${Math.round(y! * 10) / 10}`)
			.join(' ')
	);
	// Smer „von z konštrukcie" pre kóty krajných výšok. Pri zrkadlovom kuse je
	// ľavý kraj konštrukcie nakreslený vpravo, takže odsadenie musí zmeniť znamienko,
	// inak kóta leží v kresbe (nález pri vizuálnej kontrole zrkadlového kusu).
	let vonV1 = $derived(zrkadlo ? 1 : -1);
	let vonV2 = $derived(-vonV1);

	// Uhly: ostrý pri VYŠŠEJ strane, tupý pri nižšej (ako na výrobnom výkrese).
	// Popisky sa kladú DOVNÚTRA konštrukcie, aby nekolidovali s obrysom ani kótami.
	let xVysoka = $derived(X(r.V1 >= r.V2 ? 0 : r.S));
	let xNizka = $derived(X(r.V1 >= r.V2 ? r.S : 0));
	let dovnutra = $derived(Math.sign(xNizka - xVysoka) || 1);
	let yVysoka = $derived(Y(Math.max(r.V1, r.V2)));
	// popisok ostrého uhla musí ísť pod ŠIKMÚ hranu, nie pod vodorovnú — pri strmom
	// sklone hrana v mieste popisku už klesla o 52·tg α (inak text leží na čiare)
	let ostryOdsad = $derived(28 + 52 * Math.tan((r.alfa * Math.PI) / 180));
	// to isté pre tupý uhol nad šikmou hranou: vo vzdialenosti 44 px dovnútra je
	// hrana o 44·tg α VYŠŠIE, takže konštantné odsadenie by pri strmom sklone
	// popisok znova posadilo na čiaru
	let tupyOdsad = $derived(12 + 44 * Math.tan((r.alfa * Math.PI) / 180));

	// Rovný (pravouhlý) fix: horná hrana je vodorovná ⇒ „šikmá hrana" je obyčajná
	// horná hrana a oba vnútorné uhly sú 90°. Kótovať sklon 0°, hranu rovnú šírke
	// a dvakrát 90° by bol šum cez celý výkres, tak sa tie popisky vynechajú
	// (Patrik 2026-07-31).
	//
	// Podmienkou je ROVNOSŤ VÝŠOK, nie `alfa === 0`: alfa je zaokrúhlená na desatinu
	// stupňa, takže by na 0 spadol aj šikmý fix s rozdielom výšok ~1 mm — a ten by
	// potom prišiel o kóty a čítačka by ho ohlásila ako rovný.
	let rovny = $derived(r.V1 === r.V2);

	let yNizka = $derived(Y(Math.min(r.V1, r.V2)));

	// ---- Rozmiestnenie popiskov bez prekryvov ----
	// SVG nevie rozmiestňovať text sám: pri niektorých tvaroch si popisok uhla a
	// dĺžka šikmej hrany krajného poľa sadli na seba (nález usera na screenshotoch).
	// Šírku textu odhadneme z počtu znakov a dĺžku šikmej hrany posunieme POZDĹŽ
	// hrany na prvé voľné miesto v rámci svojho poľa; keď sa nezmestí nikde,
	// vyskočí o riadok vyššie.
	const ZNAK = 6.1; // px na znak pri font-size 11
	const sirkaTextu = (t: string) => t.length * ZNAK;
	type Box = { x: number; y: number; w: number };
	// Popisky dĺžok sú NATOČENÉ pozdĺž hrany, takže ich skutočná (osovo zarovnaná)
	// výška rastie so sklonom: h ≈ font + šírka·sin α. Bez toho vyzerali dva
	// popisky nad sebou oddelene, ale ich obdĺžniky sa prekrývali (chytil e2e test).
	const vysBoxu = (w: number) => 13 + w * Math.sin((r.alfa * Math.PI) / 180);
	const koliduje = (a: Box, b: Box) =>
		Math.abs(a.x - b.x) < (a.w + b.w) / 2 + 7 &&
		Math.abs(a.y - b.y) < (vysBoxu(a.w) + vysBoxu(b.w)) / 2 + 5;

	// Popisky dĺžok sa natočia POZDĹŽ šikmej hrany (ako kóty v CAD) — inak dlhý
	// text preteká cez šikmú čiaru a pri strmom sklone ju pretína.
	let sklonTextu = $derived((r.V2 - r.V1 < 0 ? 1 : -1) * (zrkadlo ? -1 : 1) * r.alfa);

	let popisUhlov = $derived([
		{ x: xVysoka + dovnutra * 52, y: yVysoka + ostryOdsad, w: sirkaTextu(fmt(r.uholOstry) + '°') },
		{ x: xNizka - dovnutra * 44, y: yNizka - tupyOdsad, w: sirkaTextu(fmt(r.uholTupy) + '°') }
	]);

	/** popisky dĺžok šikmej hrany — jeden na pole, umiestnené tak, aby nekolidovali
	 *  s popiskami uhlov ani medzi sebou */
	let popisySikma = $derived.by(() => {
		const hotove: Box[] = [...popisUhlov];
		const out: { x: number; y: number; text: string }[] = [];
		// hranice.length === r.polia.length + 1 ([0, ...kumulSirka]) → hranice[i] definované
		for (const [i, p] of r.polia.entries()) {
			const x0 = hranice[i]!;
			const text = fmt(p.sikma);
			const w = sirkaTextu(text);
			// kandidáti: stred poľa, potom postupne bližšie ku krajom
			let umiestneny: { x: number; y: number; text: string } | null = null;
			for (const t of [0.5, 0.34, 0.66, 0.22, 0.78]) {
				const mm = x0 + p.sirka * t;
				const box = { x: X(mm), y: Y(vyskaV(mm)) - 10, w };
				if (!hotove.some((h) => koliduje(box, h))) {
					umiestneny = { x: box.x, y: box.y, text };
					hotove.push(box);
					break;
				}
			}
			if (!umiestneny) {
				// nikde sa nezmestil → o riadok vyššie nad stred poľa (výška riadku
				// musí rátať s natočením, inak sa obdĺžniky stále dotýkajú)
				const mm = x0 + p.sirka * 0.5;
				const box = { x: X(mm), y: Y(vyskaV(mm)) - 12 - vysBoxu(w) - 6, w };
				hotove.push(box);
				umiestneny = { x: box.x, y: box.y, text };
			}
			out.push(umiestneny);
		}
		return out;
	});
</script>

<svg
	viewBox="0 0 {W} {totalH}"
	width="100%"
	role="img"
	aria-label={rovny
		? `Výkres rovného fixu ${r.S}×${r.V1} mm, ${r.polia.length} polí`
		: `Výkres šikmého fixu ${r.S}×${r.V1}/${r.V2} mm, ${r.polia.length} polí`}
	data-testid="fix-vykres"
>
	<!-- obrys konštrukcie -->
	<polygon points={obrys} fill="#e9edf0" stroke="#0f172a" stroke-width="1.8" />

	<!-- polia: stĺpiky + označenie + výška na stĺpiku -->
	{#each r.polia as p, i (i)}
		{@const x0 = hranice[i]!}
		{@const x1 = hranice[i + 1]!}
		{@const cx = (X(x0) + X(x1)) / 2}
		{@const stred = (p.vLavo + p.vPravo) / 2}
		<text
			x={cx}
			y={Y(stred / 2) + 4}
			text-anchor="middle"
			font-size="14"
			font-weight="700"
			fill="#0f172a">{oznacenie}{cislovanieZlava ? i + 1 : r.polia.length - i}</text
		>
		{#if i < r.polia.length - 1}
			<!-- stĺpik medzi poľami -->
			<line x1={X(x1)} y1={base} x2={X(x1)} y2={Y(p.vPravo)} stroke="#0f172a" stroke-width="1.6" />
			<!-- výška na stĺpiku (vnútri konštrukcie, otočená) -->
			<text
				x={X(x1) - 9}
				y={Y(p.vPravo / 2)}
				text-anchor="middle"
				font-size="11"
				fill="#8a5a2b"
				font-weight="600"
				stroke="#fff"
				stroke-width="3"
				paint-order="stroke"
				transform="rotate(-90 {X(x1) - 9} {Y(p.vPravo / 2)})">{fmt(p.vPravo)}</text
			>
		{/if}
	{/each}

	<!-- kóta ĽAVEJ krajnej výšky (nulovú výšku nekótujeme — konštrukcia tam dobehla do ostra) -->
	{#if r.V1 > 0}
		<g stroke="#94a3b8" stroke-width="1" fill="none">
			<line x1={X(0) + 26 * vonV1} y1={Y(r.V1)} x2={X(0) + 26 * vonV1} y2={base} />
			<line x1={X(0) + 32 * vonV1} y1={Y(r.V1)} x2={X(0) + 20 * vonV1} y2={Y(r.V1)} />
			<line x1={X(0) + 32 * vonV1} y1={base} x2={X(0) + 20 * vonV1} y2={base} />
		</g>
		<text
			x={X(0) + 34 * vonV1}
			y={(Y(r.V1) + base) / 2}
			text-anchor="middle"
			font-size="13"
			font-weight="600"
			fill="#334155"
			transform="rotate(-90 {X(0) + 34 * vonV1} {(Y(r.V1) + base) / 2})"
			data-testid="fix-v1">{fmt(r.V1)} mm</text
		>
	{/if}

	<!-- kóta PRAVEJ krajnej výšky -->
	{#if r.V2 > 0}
		<g stroke="#94a3b8" stroke-width="1" fill="none">
			<line x1={X(r.S) + 26 * vonV2} y1={Y(r.V2)} x2={X(r.S) + 26 * vonV2} y2={base} />
			<line x1={X(r.S) + 20 * vonV2} y1={Y(r.V2)} x2={X(r.S) + 32 * vonV2} y2={Y(r.V2)} />
			<line x1={X(r.S) + 20 * vonV2} y1={base} x2={X(r.S) + 32 * vonV2} y2={base} />
		</g>
		<text
			x={X(r.S) + 34 * vonV2}
			y={(Y(r.V2) + base) / 2}
			text-anchor="middle"
			font-size="13"
			font-weight="600"
			fill="#334155"
			transform="rotate(-90 {X(r.S) + 34 * vonV2} {(Y(r.V2) + base) / 2})"
			data-testid="fix-v2">{fmt(r.V2)} mm</text
		>
	{/if}

	<!-- kóty šírok polí (nad spodnou hranou) + celková šírka pod ňou -->
	{#each r.polia.length > 1 ? r.polia : [] as p, i (i)}
		{@const xa = X(hranice[i]!)}
		{@const xb = X(hranice[i + 1]!)}
		<g stroke="#94a3b8" stroke-width="1" fill="none">
			<line x1={xa} y1={base + 20} x2={xb} y2={base + 20} />
			<line x1={xa} y1={base + 15} x2={xa} y2={base + 25} />
			<line x1={xb} y1={base + 15} x2={xb} y2={base + 25} />
		</g>
		<text
			x={(xa + xb) / 2}
			y={base + 16}
			text-anchor="middle"
			font-size="11"
			fill="#334155"
			stroke="#fff"
			stroke-width="3"
			paint-order="stroke">{fmt(p.sirka)}</text
		>
	{/each}
	<g stroke="#475569" stroke-width="1" fill="none">
		<line x1={X(0)} y1={base + 46} x2={X(r.S)} y2={base + 46} />
		<line x1={X(0)} y1={base + 41} x2={X(0)} y2={base + 51} />
		<line x1={X(r.S)} y1={base + 41} x2={X(r.S)} y2={base + 51} />
	</g>
	<text
		x={(X(0) + X(r.S)) / 2}
		y={base + 42}
		text-anchor="middle"
		font-size="13"
		font-weight="700"
		fill="#0f172a"
		data-testid="fix-sirka">{fmt(r.S)} mm</text
	>

	<!-- šikmá hrana: dĺžky po poliach (rozmiestnené bez prekryvov) -->
	{#each rovny ? [] : popisySikma as p (p.text + p.x)}
		<text
			x={p.x}
			y={p.y}
			text-anchor="middle"
			font-size="11"
			fill="#b45309"
			font-weight="600"
			stroke="#fff"
			stroke-width="3"
			paint-order="stroke"
			data-testid="fix-sikma-pole"
			transform="rotate({sklonTextu} {p.x} {p.y})">{p.text}</text
		>
	{/each}
	{#if !rovny}
		<text
			x={(X(0) + X(r.S)) / 2}
			y={20}
			text-anchor="middle"
			font-size="13"
			font-weight="700"
			fill="#b45309"
			data-testid="fix-sikma">šikmá hrana {fmt(r.sikmaCelkom)} mm · sklon {fmt(r.alfa)}°</text
		>
	{/if}

	{#if !rovny}
		<!-- uhol sklonu pri vyššej strane (ostrý uhol konštrukcie) -->
		<text
			x={popisUhlov[0]!.x}
			y={popisUhlov[0]!.y}
			text-anchor="middle"
			font-size="12"
			font-weight="700"
			fill="#0f766e"
			stroke="#fff"
			stroke-width="3"
			paint-order="stroke"
			data-testid="fix-uhol">{fmt(r.uholOstry)}°</text
		>
		<!-- Tupý uhol pri nižšej strane. Ide NAD šikmú hranu (mimo konštrukcie) — pri
	     nízkej špičke (napr. 64,6 mm) je vnútri sotva pár pixelov a popisok by ležal
	     na obryse; nad hranou je vždy voľno. -->
		<text
			x={popisUhlov[1]!.x}
			y={popisUhlov[1]!.y}
			text-anchor="middle"
			font-size="12"
			font-weight="700"
			fill="#0f766e"
			stroke="#fff"
			stroke-width="3"
			paint-order="stroke"
			data-testid="fix-uhol-tupy">{fmt(r.uholTupy)}°</text
		>
	{/if}
</svg>
