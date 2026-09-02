// Zákaznícky 3D vizuál bazénového zastrešenia (#405) — bazén → DielSpec[]. Pure,
// THREE-free, jednotkovo testovateľné (Vitest, žiadny DOM/canvas). Oblúkové
// (teleskopické) segmenty: N oblúkov pozdĺž dĺžky, každý rozpätý cez šírku a
// klesajúci na výšku (telescopická kaskáda). Výšky/pozície segmentov sa VŽDY
// čerpajú z existujúcich appkových helperov `bazen-navrh.ts` (`sekcieVysky`,
// `sekciePozicie`) — táto funkcia ich NIKDY neprepočítava paralelne (rovnaká
// disciplína ako `geo/pergola.ts` so `stlpyZPolí` a `geo/zasklenia.ts` s
// `deliaceStlpiky`).
//
// Súradnice (zhodné s `geo/pergola.ts` / `geo/zasklenia.ts`): os X = šírka
// (rozpon oblúka, svet centrovaný na 0), os Y = výška od zeme (0 = zem), os Z =
// dĺžka zastrešenia (segmenty pozdĺž nej, centrované na 0). Presnosť je
// `ilustracna` — reálny profil oblúka a vnorenie segmentov appka bez ďalších
// dát nepozná (`spec.ts` to už dopredu anticipuje: „napr. neznámy oblúk bazéna").
import { RAL_INY_KOD } from '$lib/vykres/ral';
import { sekcieVysky, sekciePozicie } from '$lib/bazen-navrh';
import type { DielSpec, VizVysledok } from '../spec';

export interface BazenVizVstup {
	/** šírka zastrešenia = rozpon oblúka [mm] */
	sirkaMm: number;
	/** dĺžka zastrešenia (pozdĺž bazéna, smer segmentov) [mm] */
	dlzkaMm: number;
	/** výška najvyššieho (prvého) segmentu v najvyššom bode oblúka [mm] */
	vyskaMm: number;
	/** počet segmentov (2..8), inak sa oreže do rozsahu */
	segmenty: number;
	/** dvojkoľajové rozsúvanie → 2 koľajnice na stranu (jednokoľaj = 1) */
	dvojkolaj?: boolean;
	/** kód RAL konštrukcie (RAL_PALETA) — farba sa rieši v materialy.ts */
	ralKod: string;
	/** voľný RAL label (pri `RAL_INY_KOD`) */
	ral?: string;
}

// --- vizuálne mm konštanty (vizuál, NIE katalóg — nevstupujú do žiadnej kóty
//     ani Money výstupu; zdroj pravdy pre skutočné rozmery je vždy vstup appky) ---

/** počet vzorkových bodov na semi-elipsu oblúka (polygonálna aproximácia) [—]. */
const OBLUK_BODY = 22;
/** radiálna hrúbka výplne (polykarbonát) [mm] — vizuál. */
const VYPLN_HRUBKA_MM = 16;
/** radiálna hrúbka rebra (hliníkový oblúkový profil) [mm] — vizuál. */
const REBRO_HRUBKA_MM = 95;
/** hĺbka rebra v smere Z (dĺžky) [mm] — vizuál. */
const REBRO_HLBKA_MM = 60;
/** medzera medzi výplňami susedných segmentov (aby čitateľne „stupňovali") [mm]. */
const SEGMENT_MEDZERA_MM = 45;
/** šírka spodnej koľajnice (X) [mm] — vizuál. */
const KOLAJNICA_W_MM = 70;
/** výška spodnej koľajnice (Y) [mm] — vizuál. */
const KOLAJNICA_H_MM = 45;
/** rozstup dvoch koľajníc pri dvojkoľaji (X) [mm] — vizuál. */
const KOLAJNICA_ROZTEC_MM = 95;

/** per-segment pokles výšky pri teleskopickej kaskáde (podiel z výšky) [—] —
 *  ilustračný: appka zbiera JEDNU výšku, kaskádu neurčuje. */
const KASKADA_KROK_POMER = 0.06;
/** dolný/horný strop kroku kaskády [mm]. */
const KASKADA_KROK_MIN_MM = 60;
const KASKADA_KROK_MAX_MM = 150;
/** dolný strop najnižšieho segmentu (podiel z výšky) — aby posledný segment
 *  nebol nereálne nízky [—]. */
const KASKADA_MIN_POMER = 0.5;

function clamp(v: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, v));
}

/** Uzavretý polygonálny prierez oblúkového PÁSU v X-Y rovine (mm) — vonkajšia
 *  semi-elipsa (rx, ry) mínus vnútorná (rx-hrubka, ry-hrubka). Body od +x päty
 *  cez vrchol po −x pätu (vonkajšia), potom späť (vnútorná) — `builder.ts`
 *  polygon uzavrie (`closePath`), takže dve päty ostanú otvorené (arch shell).
 *  Hrúbka sa klampuje, aby vnútorná elipsa nikdy neprekročila vonkajšiu. */
function oblukPasObrys(rx: number, ry: number, hrubka: number, body: number): [number, number][] {
	const t = Math.min(hrubka, rx * 0.45, ry * 0.45);
	const rxi = rx - t;
	const ryi = ry - t;
	const out: [number, number][] = [];
	// vonkajšia semi-elipsa: θ 0 → π (od +x päty cez vrchol po −x pätu)
	for (let k = 0; k <= body; k++) {
		const th = (Math.PI * k) / body;
		out.push([rx * Math.cos(th), ry * Math.sin(th)]);
	}
	// vnútorná semi-elipsa: θ π → 0 (späť)
	for (let k = body; k >= 0; k--) {
		const th = (Math.PI * k) / body;
		out.push([rxi * Math.cos(th), ryi * Math.sin(th)]);
	}
	return out;
}

/** Názov PNG súboru pri stiahnutí zákazníckeho renderu — čistá funkcia (žiadny
 *  DOM), bez ceny/Money kódu (len rozmery = predajný, nie technický identifikátor). */
export function bazenPngNazov(vst: BazenVizVstup): string {
	const d = Math.max(1, Math.round(vst.dlzkaMm));
	const s = Math.max(1, Math.round(vst.sirkaMm));
	return `bazen-zastresenie-${d}x${s}mm.png`;
}

export function bazenSpec(vst: BazenVizVstup): VizVysledok {
	const S = Math.max(1, vst.sirkaMm);
	const D = Math.max(1, vst.dlzkaMm);
	const V = Math.max(1, vst.vyskaMm);
	const n = Math.max(2, Math.round(vst.segmenty));
	const rx = S / 2;

	// teleskopická kaskáda výšok — per-krok pokles odvodený ilustračne z JEDNEJ
	// zadanej výšky, potom cez appkový helper (`sekcieVysky`) na lineárnu kaskádu.
	const krok = clamp(V * KASKADA_KROK_POMER, KASKADA_KROK_MIN_MM, KASKADA_KROK_MAX_MM);
	const vyskaMin = Math.max(V - krok * (n - 1), V * KASKADA_MIN_POMER);
	// `sekcieVysky` vracia práve `n` hodnôt (najvyššia prvá) — dĺžková invariancia
	const vysky = sekcieVysky(n, V, vyskaMin);
	// `sekciePozicie` vracia práve `n+1` hraníc [0..D]; centrujeme na 0
	const hranice = sekciePozicie(D, n).map((z) => z - D / 2);

	const diely: DielSpec[] = [];
	const poznamky: string[] = [];

	// --- výplne (sklo/polykarbonát): jeden oblúkový pás na segment, klesajúca
	//     výška = teleskopický stupňový vzhľad; báza na y=0 (pos.y=0) ---
	for (let i = 0; i < n; i++) {
		const z0 = hranice[i]!; // hranice.length === n+1
		const z1 = hranice[i + 1]!;
		const stred = (z0 + z1) / 2;
		const hlbka = Math.max(1, z1 - z0 - SEGMENT_MEDZERA_MM);
		const ry = vysky[i]!; // vysky.length === n
		diely.push({
			rola: 'sklo',
			tvar: {
				kind: 'extrude',
				obrys: oblukPasObrys(rx, ry, VYPLN_HRUBKA_MM, OBLUK_BODY),
				dlzka: hlbka
			},
			pos: { x: 0, y: 0, z: stred }
		});
	}

	// --- rebrá (ram = hliníková konštrukcia): na každej hranici segmentu jeden
	//     oblúkový pás; výška = vyšší zo susedných segmentov (kaskáda je klesajúca,
	//     takže rebro „prekryje" vyššiu výplň a nižšia sa pod neho zasunie).
	//     Krajné rebrá sa posunú dovnútra o polovicu hĺbky, aby netrčali von. ---
	for (let j = 0; j <= n; j++) {
		// vysky je klesajúce → vyšší sused pri vnútornej hranici je ľavý (j-1)
		const ry = j === 0 ? vysky[0]! : vysky[j - 1]!; // j-1 ∈ [0,n-1] pre j∈[1,n]
		const zEdge = hranice[j]!; // hranice.length === n+1
		const zc = j === 0 ? zEdge + REBRO_HLBKA_MM / 2 : j === n ? zEdge - REBRO_HLBKA_MM / 2 : zEdge;
		diely.push({
			rola: 'ram',
			tvar: {
				kind: 'extrude',
				obrys: oblukPasObrys(rx, ry, REBRO_HRUBKA_MM, OBLUK_BODY),
				dlzka: REBRO_HLBKA_MM
			},
			pos: { x: 0, y: 0, z: zc }
		});
	}

	// --- spodné koľajnice (kolajnica): pozdĺž oboch dlhých strán (X=±rx), po celej
	//     dĺžke; dvojkoľaj = 2 koľajnice na stranu (2. posunutá dovnútra). Vrch
	//     koľajnice prekryje spodok pätiek oblúka (pätka zapadá do koľajnice). ---
	const koľajníNaStranu = vst.dvojkolaj ? 2 : 1;
	for (const strana of [-1, 1] as const) {
		for (let r = 0; r < koľajníNaStranu; r++) {
			const xr = strana * (rx - KOLAJNICA_W_MM / 2 - r * KOLAJNICA_ROZTEC_MM);
			diely.push({
				rola: 'kolajnica',
				tvar: { kind: 'box', w: KOLAJNICA_W_MM, h: KOLAJNICA_H_MM, d: D },
				pos: { x: xr, y: KOLAJNICA_H_MM / 2, z: 0 }
			});
		}
	}

	// ilustračná poznámka (presnosť === 'ilustracna') — POD obrázkom, nikdy do rastra
	poznamky.push(
		'Ilustračný náhľad — presné tvarovanie oblúka a vnorenie segmentov upresníme po zameraní.'
	);

	// RAL — hex sa rieši v materialy.ts (farbaKonstrukcie); tu len povinná poznámka
	// o ilustračnej farbe PRESNE pri voľnom labeli (rovnako ako pergola/zasklenia)
	if (vst.ralKod === RAL_INY_KOD) {
		poznamky.push(
			`Farba je len ilustračná — RAL ${vst.ral ?? ''} nie je vo vzorkovníku náhľadu.`.trim()
		);
	}

	return {
		diely,
		// bbox.h = najvyšší segment (vysky[0] === V); výplň/rebrá ho presahujú
		// len zanedbateľne, koľajnica je nižšia — rámovanie kamery podľa V
		bbox: { w: S, h: V, d: D },
		presnost: 'ilustracna',
		poznamky
	};
}
