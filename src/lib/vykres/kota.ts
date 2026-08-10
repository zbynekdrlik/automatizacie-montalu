// Zdieľaný SVG kótovací helper (#137) — vyextrahovaný z opakovane skopírovaného vzoru
// v `FixVykres2D.svelte` (čiarové kóty s ťahákmi, otočené popisky, greedy kolízne
// odsadzovanie L87-145) a `Nahlad2D.svelte` (rovnaký vzor pre šírku/výšku okna).
//
// Existujúce tri kresliace komponenty (FixVykres2D, Nahlad2D, RozpisRezov) si PONE-
// CHÁVAJÚ vlastné kópie — tento modul je základ pre NOVÉ použitie (návrhový výkres,
// #138+), migrácia existujúcich je prípadný samostatný refaktor mimo tohto ticketu.
//
// Čistý TS bez závislosti na Svelte/DOM — ľahko jednotkovo testovateľné (viď
// tests/kota.test.ts) a použiteľné z ľubovoľného SVG kontextu.

/** Zaokrúhli na `dec` desatinných miest a vráti slovenský tvar s ČIARKOU namiesto
 *  bodky — rovnaký formát ako `fmt()` v FixVykres2D/Nahlad2D/RozpisRezov. */
export function fmtMm(n: number, dec = 1): string {
	const f = Math.pow(10, dec);
	return String(Math.round(n * f) / f).replace('.', ',');
}

/** Uhol v stupňoch, slovenský formát + '°'. */
export function fmtDeg(n: number, dec = 1): string {
	return fmtMm(n, dec) + '°';
}

/** Odhad šírky textu v px pri danom font-size — SVG nevie zmerať text pred vykreslením
 *  (žiadny layout pass), takže sa odhaduje z počtu znakov. Kalibrácia (6,1 px/znak pri
 *  font-size 11) prevzatá z `sirkaTextu()` vo FixVykres2D, zovšeobecnená lineárne na
 *  ľubovoľný font-size. */
export function textWidth(text: string, fontSize = 11): number {
	const PX_PER_CHAR_AT_11 = 6.1;
	return text.length * PX_PER_CHAR_AT_11 * (fontSize / 11);
}

// ---------------------------------------------------------------------------
// Kolízne odsadzovanie popiskov (zovšeobecnené z FixVykres2D L87-145)
// ---------------------------------------------------------------------------

/** Obdĺžnik popisku — stred (x,y) + rozmery. SVG text je zarovnaný `text-anchor:
 *  middle`, takže stredová súradnica sedí priamo na kótovú/kolíznu matematiku. */
export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Kolidujú dva obdĺžniky (so stredovými súradnicami) s voliteľnou medzerou navyše na
 *  oboch osiach? Zovšeobecnenie `koliduje()` z FixVykres2D (tam pevné +7/+5 px). */
export function boxesCollide(a: Box, b: Box, gapX = 7, gapY = 5): boolean {
	return (
		Math.abs(a.x - b.x) < (a.w + b.w) / 2 + gapX && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + gapY
	);
}

/** Greedy umiestnenie popisku: skúša kandidátov PO PORADÍ (od najlepšieho) a vráti
 *  prvého, ktorý nekoliduje so žiadnym z `existing`. Keď sa nezmestí nikam, vráti
 *  POSLEDNÉHO kandidáta (fallback — popisok nikdy nezmizne, len sa v najhoršom prípade
 *  prekryje). Rovnaká stratégia ako slučka `for (const t of […])` vo FixVykres2D
 *  L124-133 + fallback L134-141, zovšeobecnená na ľubovoľnú kolekciu kandidátov. */
export function placeLabel<T extends Box>(candidates: T[], existing: Box[], gapX = 7, gapY = 5): T {
	if (candidates.length === 0) throw new Error('placeLabel: candidates je prázdne pole');
	for (const c of candidates) {
		if (!existing.some((e) => boxesCollide(c, e, gapX, gapY))) return c;
	}
	return candidates[candidates.length - 1];
}

// ---------------------------------------------------------------------------
// Čiarové kóty (vodorovné, zvislé, ľubovoľne otočené) s ťahákmi
// ---------------------------------------------------------------------------

export interface Segment {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

export interface DimensionLabel {
	x: number;
	y: number;
	/** stupne pre SVG `rotate(deg x y)` (0 = bez otočenia) */
	rotate: number;
}

export interface DimensionGeometry {
	/** [kótová čiara, ťahák na začiatku, ťahák na konci] — kresliť ako tri <line>.
	 *  Ťaháky sú KOLMÉ na kótovú čiaru (CAD konvencia — krížové značky na koncoch). */
	lines: [Segment, Segment, Segment];
	label: DimensionLabel;
	/** odkazové (witness) čiary od PÔVODNÝCH bodov (x0,y0)/(x1,y1) — pred `perpOffset`
	 *  — ku (odsadenej) kótovej čiare. Prázdne pole, keď `perpOffset === 0` (kótová
	 *  čiara leží priamo na geometrii, žiadny „stonok" netreba). */
	witnesses: Segment[];
}

export interface DimensionOpts {
	/** polovičná dĺžka ťaháku (px), default 5 */
	tick?: number;
	/** kolmý posun popisku od (odsadenej) kótovej čiary (px) v smere normály danej
	 *  `perpOffset`; default -4 (mierne „dovnútra", ku geometrii — vizuálne blízko
	 *  čiary, nie prilepené na ňu). Volajúci si podľa potreby vie zvoliť aj kladnú
	 *  hodnotu (popisok ĎALEJ od geometrie, za ťahákmi — konvencia zvislých kót vo
	 *  FixVykres2D). */
	labelOffset?: number;
}

/** Normalizuje uhol priamky (stupne, SVG súradnice) na rozsah (-90°, 90°] tak, aby
 *  text popisku otočený o výsledný uhol NIKDY nebol „hlavou dole" (čitateľný zľava
 *  doprava max. ±90° od vodorovnej). Rovnaký problém rieši `sklonTextu` vo
 *  FixVykres2D (tam len pre malé sklony); tu zovšeobecnené na ľubovoľný smer.
 *  POZNÁMKA: presne zvislé vstupy (±90°) sa oba zbiehajú na +90 — pre zvislé kóty s
 *  konkrétnou (zdola-nahor) konvenciou použi `verticalDimension()`, ktorá si rotáciu
 *  rieši explicitne, nezávisle od tejto funkcie. */
export function readableLabelAngle(deg: number): number {
	let a = ((deg % 360) + 360) % 360; // [0, 360)
	if (a > 180) a -= 360; // (-180, 180]
	if (a > 90) a -= 180;
	else if (a <= -90) a += 180;
	return a;
}

function dimensionLines(
	ax0: number,
	ay0: number,
	ax1: number,
	ay1: number,
	nx: number,
	ny: number,
	tick: number
): [Segment, Segment, Segment] {
	return [
		{ x1: ax0, y1: ay0, x2: ax1, y2: ay1 },
		{ x1: ax0 - nx * tick, y1: ay0 - ny * tick, x2: ax0 + nx * tick, y2: ay0 + ny * tick },
		{ x1: ax1 - nx * tick, y1: ay1 - ny * tick, x2: ax1 + nx * tick, y2: ay1 + ny * tick }
	];
}

/** Čiarová kóta medzi bodmi (x0,y0)-(x1,y1), voliteľne posunutá KOLMO o `perpOffset`
 *  (kladné = v smere normály (-uy,ux), t.j. „doprava" od smeru vektora bodu 0→1).
 *  Jedna funkcia pokrýva vodorovné (dy=0), zvislé (dx=0) aj ľubovoľne otočené kóty
 *  (napr. pozdĺž šikmej hrany) — generalizácia oddelených vodorovných/zvislých vetiev
 *  vo FixVykres2D + Nahlad2D. Ťaháky sú vždy KOLMÉ na kótovú čiaru. */
export function lineDimension(
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	perpOffset = 0,
	opts: DimensionOpts = {}
): DimensionGeometry {
	const tick = opts.tick ?? 5;
	const labelOffset = opts.labelOffset ?? -4;
	const dx = x1 - x0;
	const dy = y1 - y0;
	const len = Math.hypot(dx, dy) || 1;
	const ux = dx / len;
	const uy = dy / len;
	const nx = -uy; // jednotková normála (kolmica), smer kladného perpOffset
	const ny = ux;
	const ax0 = x0 + nx * perpOffset;
	const ay0 = y0 + ny * perpOffset;
	const ax1 = x1 + nx * perpOffset;
	const ay1 = y1 + ny * perpOffset;
	const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
	// odkazové čiary len keď je kótová čiara naozaj odsadená (perpOffset !== 0) — smer
	// (dirSign*nx, dirSign*ny) ukazuje SPRÁVNYM smerom aj pri zápornom perpOffset
	// (odsadenie na druhú stranu), overShoot vždy PRESAHUJE za skutočnú kótovú čiaru.
	const dirSign = Math.sign(perpOffset) || 1;
	const witnesses: Segment[] =
		perpOffset === 0
			? []
			: [
					witnessLine(x0, y0, nx * dirSign, ny * dirSign, Math.abs(perpOffset)),
					witnessLine(x1, y1, nx * dirSign, ny * dirSign, Math.abs(perpOffset))
				];
	return {
		lines: dimensionLines(ax0, ay0, ax1, ay1, nx, ny, tick),
		label: {
			x: (ax0 + ax1) / 2 + nx * labelOffset,
			y: (ay0 + ay1) / 2 + ny * labelOffset,
			rotate: readableLabelAngle(angleDeg)
		},
		witnesses
	};
}

/** Vodorovná čiarová kóta medzi (x0,y) a (x1,y) — geometria, NIE už-odsadená poloha;
 *  `perpOffset` ju posunie kolmo (kladné = nadol, SVG konvencia) a zapne odkazové
 *  čiary presne ako `lineDimension`. Popisok bez otočenia. */
export function horizontalDimension(
	x0: number,
	x1: number,
	y: number,
	perpOffset = 0,
	opts: DimensionOpts = {}
): DimensionGeometry {
	return lineDimension(x0, y, x1, y, perpOffset, opts);
}

/** Zvislá čiarová kóta medzi (x,y0) (hore) a (x,y1) (dole) — geometria, NIE
 *  už-odsadená poloha; `perpOffset` ju posunie kolmo (kladné = doľava od smeru
 *  zhora nadol, SVG konvencia) a zapne odkazové čiary. Popisok je VŽDY otočený o
 *  -90° bez ohľadu na poradie y0/y1 — čitateľný zdola nahor, presne konvencia
 *  `rotate(-90 …)` z FixVykres2D/Nahlad2D pre zvislé kóty. */
export function verticalDimension(
	y0: number,
	y1: number,
	x: number,
	perpOffset = 0,
	opts: DimensionOpts = {}
): DimensionGeometry {
	const g = lineDimension(x, y0, x, y1, perpOffset, opts);
	return { ...g, label: { ...g.label, rotate: -90 } };
}

/** Odkazová (extenzná/witness) čiara od bodu geometrie `(px,py)` v smere jednotkového
 *  vektora `(dirX,dirY)` k odsadenej kótovej čiare vo vzdialenosti `offset` — s malou
 *  medzerou od geometrie (`gap`, CAD konvencia — čiara sa NEDOTÝKA obrysu) a presahom
 *  za kótovú čiaru (`overshoot`). FixVykres2D kóty tento krok vynechávajú (kótová čiara
 *  je priamo odsadená bez samostatného „stonku"); tento primitív dopĺňa plnohodnotnú
 *  CAD konvenciu pre nový výkres (#138), kde referenčné PDF odkazové čiary majú. */
export function witnessLine(
	px: number,
	py: number,
	dirX: number,
	dirY: number,
	offset: number,
	gap = 2,
	overshoot = 3
): Segment {
	return {
		x1: px + dirX * gap,
		y1: py + dirY * gap,
		x2: px + dirX * (offset + overshoot),
		y2: py + dirY * (offset + overshoot)
	};
}

// ---------------------------------------------------------------------------
// Uhlové kóty
// ---------------------------------------------------------------------------

export interface AngleDimensionGeometry {
	/** SVG <path> `d` — oblúk od `fromDeg` po `toDeg` (matematická konvencia: 0° = +x,
	 *  kladný smer proti smeru hod. ručičiek v matematických súradniciach; keďže SVG má
	 *  y os obrátenú, na obrazovke to vyzerá ako smer hod. ručičiek) */
	arcPath: string;
	label: { x: number; y: number };
	/** koncové body oblúka — pre prípadné napojenie na ramená uhla */
	start: { x: number; y: number };
	end: { x: number; y: number };
}

/** Uhlová kóta — oblúk s polomerom `r` okolo vrcholu `(cx,cy)`, od `fromDeg` po
 *  `toDeg` (matematická konvencia, stupne, y os obrátená ako v SVG). Vracia SVG
 *  `<path d>` pre MENŠÍ (≤180°) oblúk v smere rastúceho uhla `fromDeg → toDeg`, plus
 *  pozíciu popisku na polovici uhla, mierne za oblúkom (`r + 12`). */
export function angleDimension(
	cx: number,
	cy: number,
	r: number,
	fromDeg: number,
	toDeg: number
): AngleDimensionGeometry {
	// kladný rozdiel v smere fromDeg → toDeg, vždy [0,360) — uhol sa vždy kreslí „dopredu"
	const delta = (((toDeg - fromDeg) % 360) + 360) % 360;
	const a0 = (fromDeg * Math.PI) / 180;
	const a1 = ((fromDeg + delta) * Math.PI) / 180;
	// SVG y rastie NADOL → matematicky kladný (proti smeru hod. ručičiek) uhol vyzerá
	// na obrazovke ako smer hod. ručičiek, preto x = cos, y = -sin.
	const start = { x: cx + r * Math.cos(a0), y: cy - r * Math.sin(a0) };
	const end = { x: cx + r * Math.cos(a1), y: cy - r * Math.sin(a1) };
	const largeArc = delta > 180 ? 1 : 0;
	// sweep=0: SVG kreslí oblúk v smere RASTÚCEHO matematického uhla (fromDeg → toDeg)
	// pri tejto (x=cos, y=-sin) parametrizácii — overené round-trip testom stredu oblúka
	// (tests/kota.test.ts, SVG spec F.6.5 endpoint→center) pre viacero uhlových dvojíc
	// vrátane „wraparound" cez 0°/360° a largeArc>180°.
	const sweep = 0;
	const midDeg = fromDeg + delta / 2;
	const midRad = (midDeg * Math.PI) / 180;
	const lr = r + 12;
	return {
		arcPath: `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} ${sweep} ${end.x} ${end.y}`,
		label: { x: cx + lr * Math.cos(midRad), y: cy - lr * Math.sin(midRad) },
		start,
		end
	};
}

// ---------------------------------------------------------------------------
// Mierka / viewBox utility
// ---------------------------------------------------------------------------

/** Rovnomerná mierka (px na jednotku, typicky mm), aby sa objekt (mmW × mmH) zmestil
 *  do dostupného priestoru (pxW × pxH) bez skreslenia pomeru strán — zovšeobecnenie
 *  `scale = Math.min(KRESBA_W / r.S, MAX_H / Math.max(r.V1, r.V2))` z FixVykres2D na
 *  oba rozmery naraz. Neplatné (nekladné) vstupy vrátia 1 (obranný fallback, aby
 *  volajúci nedostal Infinity/NaN do SVG súradníc). */
export function fitScale(mmW: number, mmH: number, pxW: number, pxH: number): number {
	if (!(mmW > 0) || !(mmH > 0) || !(pxW > 0) || !(pxH > 0)) return 1;
	return Math.min(pxW / mmW, pxH / mmH);
}

/** SVG `viewBox` atribút reťazec pre danú šírku/výšku (vždy od počiatku 0,0). */
export function viewBoxAttr(w: number, h: number): string {
	return `0 0 ${w} ${h}`;
}
