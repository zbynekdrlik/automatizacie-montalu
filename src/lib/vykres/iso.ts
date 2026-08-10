// Izometrická (axonometrická) projekcia 3D bodu do 2D SVG súradníc (#138 — pergola
// návrhový výkres, 3D pohľad podľa vzoru OP260032). Čistý TS bez závislosti na
// Svelte/DOM — generalizovateľné pre ľubovoľný ďalší 3D náhľad (bazén/iné), rovnaká
// disciplína ako `kota.ts`/`mierka.ts`.
//
// Konvencia súradníc VSTUPU: x = šírka (doprava), y = výška (HORE — matematicky
// kladná smerom nahor, na rozdiel od SVG), z = hĺbka (dozadu, "do wallu"). Toto je
// PRIRODZENÁ konvencia pre stavebnú geometriu (pôdorys × výška), nie SVG obrátená os.
//
// Klasická 30° dimetrická/izometrická projekcia (rovnaká matematika ako izometrické
// CAD/montážne výkresy a izometrické herné dlaždice): zvislá os (výška) sa kreslí
// PRESNE zvisle, obe vodorovné osi (šírka/hĺbka) pod 30° od vodorovnej — jedna dole-
// vpravo (šírka), druhá dole-vľavo (hĺbka). Výstup je PRIAMO v SVG súradniciach
// (y rastie NADOL) — netreba dodatočne prevracať.

export interface Bod3D {
	/** šírka [mm] — kladné = doprava */
	x: number;
	/** výška [mm] — kladné = HORE (matematická konvencia, nie SVG) */
	y: number;
	/** hĺbka [mm] — kladné = dozadu (smerom k stene) */
	z: number;
}

export interface Bod2D {
	x: number;
	y: number;
}

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = Math.sin(Math.PI / 6);

/** Projekcia 3D bodu na 2D SVG súradnice (y rastie nadol). `mierka` škáluje výsledok
 *  (napr. mm→px), default 1 (bezrozmerné, na priame porovnanie v testoch). */
export function projekcia3D(b: Bod3D, mierka = 1): Bod2D {
	const svgX = (b.x - b.z) * COS30;
	const svgY = (b.x + b.z) * SIN30 - b.y;
	return { x: svgX * mierka, y: svgY * mierka };
}

/** Projekcia 3D úsečky na 2D SVG segment — pohodlný wrapper pre `<line>`/`<path>`. */
export function projekciaUsecky(
	a: Bod3D,
	b: Bod3D,
	mierka = 1
): { x1: number; y1: number; x2: number; y2: number } {
	const pa = projekcia3D(a, mierka);
	const pb = projekcia3D(b, mierka);
	return { x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y };
}

/** Hraničný obdĺžnik (v 2D SVG súradniciach) množiny projektovaných 3D bodov — na
 *  dopočítanie `fitScale`/pozicovania celej izometrie na hárok. Vráti null pre
 *  prázdny vstup (obranný fallback, nikdy NaN do volajúceho). */
export function hraniceProjekcie(
	body: Bod3D[],
	mierka = 1
): { minX: number; minY: number; maxX: number; maxY: number } | null {
	if (!body.length) return null;
	let minX = Infinity,
		minY = Infinity,
		maxX = -Infinity,
		maxY = -Infinity;
	for (const b of body) {
		const p = projekcia3D(b, mierka);
		if (p.x < minX) minX = p.x;
		if (p.x > maxX) maxX = p.x;
		if (p.y < minY) minY = p.y;
		if (p.y > maxY) maxY = p.y;
	}
	return { minX, minY, maxX, maxY };
}
