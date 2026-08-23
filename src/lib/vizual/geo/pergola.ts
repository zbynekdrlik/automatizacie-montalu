// Zákaznícky 3D vizuál pergoly (#276) — pergola → DielSpec[]. Pure, THREE-free,
// jednotkovo testovateľné (Vitest, žiadny DOM/canvas). Rozmery/sklon/panely sa
// VŽDY čerpajú z existujúcich helperov `pergola-navrh.ts` (`stlpyZPolí`,
// `vypocitajSklon`, `defaultPanelSirka`) — táto funkcia ich NIKDY neprepočítava
// paralelne (rovnaká disciplína ako `geo/zasklenia.ts` s `deliaceStlpiky`).
//
// Súradnice (zhodné so `geo/zasklenia.ts`): os X = šírka (svet centrovaný na 0),
// os Y = výška od zeme (0 = zem), os Z = hĺbka (kladné = bližšie k pozorovateľovi).
// Predný (nižší) rad stĺpov z=+H/2, rad pri stene (vyšší) z=−H/2 — vyšší koniec
// je „pri dome", kde `scena.ts` kreslí stenu s dverami (predajný kontext).
import { RAL_INY_KOD } from '$lib/vykres/ral';
import {
	NOSNIK_HRUBKA_MM,
	STLP_HRUBKA_VIZ_MM,
	defaultPanelSirka,
	stlpyZPolí,
	vypocitajSklon,
	PANEL_POCET_MAX
} from '$lib/pergola-navrh';
import type { DielSpec, VizVysledok } from '../spec';

/** Typ strechy — pultová (jednospádová, predok nižší) alebo rovná (bez spádu).
 *  Sklon samotný vyplýva z dvojice výšok; `rovna` len zrovná výšku pri stene s
 *  prednou (SV = FV ⇒ sklon 0). */
export type PergolaTypStrechy = 'pultova' | 'rovna';

export interface PergolaVizVstup {
	/** celková šírka [mm] */
	sirkaMm: number;
	/** hĺbka (predok → stena) [mm] */
	hlbkaMm: number;
	/** výška vpredu (nižšia strana) [mm] */
	vyskaVpreduMm: number;
	/** výška pri stene (vyššia strana pri pultovej) [mm] */
	vyskaPriSteneMm: number;
	/** počet polí; stĺpov v rade = pocetPoli+1; default 1 */
	pocetPoli?: number;
	/** počet strešných sklenených panelov; default dopočítaný zo šírky */
	panelPocet?: number;
	/** default 'pultova' */
	typStrechy?: PergolaTypStrechy;
	/** kód RAL konštrukcie (RAL_PALETA) — farba sa rieši v materialy.ts */
	ralKod: string;
	/** voľný RAL label (pri `RAL_INY_KOD`) */
	ral?: string;
}

// --- vizuálne mm konštanty (vizuál, NIE katalóg — nevstupujú do žiadnej kóty
//     ani Money výstupu; zdroj pravdy pre skutočné rozmery je vždy vstup appky) ---

/** hĺbka (Z) hlavného nosníka [mm] — vizuál. */
const NOSNIK_Z_MM = 120;
/** šírka (X) krokvy [mm] — vizuál. */
const KROKVA_W_MM = 60;
/** výška (Y) krokvy [mm] — vizuál. */
const KROKVA_H_MM = 120;
/** hrúbka strešného skla [mm] — vizuál (strešné sklo je hrubšie než 8 mm default
 *  posuvu). */
const SKLO_HRUBKA_MM = 10;
/** cieľová šírka jedného strešného panelu pri dopočítaní `panelPocet` [mm]. */
const PANEL_CIEL_SIRKA_MM = 700;

/** Dopočíta počet strešných panelov zo šírky, keď nie je zadaný — ~700 mm na
 *  panel, orezané do rozsahu appky (1..PANEL_POCET_MAX). */
function odvodPanelPocet(sirkaMm: number): number {
	return Math.min(PANEL_POCET_MAX, Math.max(1, Math.round(sirkaMm / PANEL_CIEL_SIRKA_MM)));
}

/** Názov PNG súboru pri stiahnutí zákazníckeho renderu (#276 → #277 PDF ponuka).
 *  Čistá funkcia (žiadny DOM) → jednotkovo testovateľná. Bez ceny/Money kódu —
 *  len rozmery (predajný, nie technický identifikátor). */
export function pergolaPngNazov(vst: PergolaVizVstup): string {
	const s = Math.max(1, Math.round(vst.sirkaMm));
	const h = Math.max(1, Math.round(vst.hlbkaMm));
	return `pergola-${s}x${h}mm.png`;
}

export function pergolaSpec(vst: PergolaVizVstup): VizVysledok {
	const S = Math.max(1, vst.sirkaMm);
	const H = Math.max(1, vst.hlbkaMm);
	const FV = Math.max(1, vst.vyskaVpreduMm);
	// rovná strecha ⇒ výška pri stene = predná (sklon 0)
	const SV = vst.typStrechy === 'rovna' ? FV : Math.max(FV, vst.vyskaPriSteneMm);

	const pocetPoli = Math.max(1, Math.round(vst.pocetPoli ?? 1));
	const panelPocet = Math.max(1, Math.round(vst.panelPocet ?? odvodPanelPocet(S)));

	// stĺpy z rozpätí polí (rovnomerné polia z celkovej šírky) — cez appkový
	// helper, centrované na 0
	const polia = Array.from({ length: pocetPoli }, () => S / pocetPoli);
	const postX = stlpyZPolí(polia).map((x) => x - S / 2);

	// sklon strechy z výšok/hĺbky — cez appkový helper (stupne → radiány)
	const sklonDeg = vypocitajSklon(FV, SV, H);
	const alfa = (sklonDeg * Math.PI) / 180;

	const diely: DielSpec[] = [];
	const poznamky: string[] = [];

	const zFront = H / 2;
	const zWall = -H / 2;

	// --- stĺpy: predný rad (výška FV) + rad pri stene (výška SV) ---
	for (const x of postX) {
		diely.push({
			rola: 'ram',
			tvar: { kind: 'box', w: STLP_HRUBKA_VIZ_MM, h: FV, d: STLP_HRUBKA_VIZ_MM },
			pos: { x, y: FV / 2, z: zFront - STLP_HRUBKA_VIZ_MM / 2 }
		});
		diely.push({
			rola: 'ram',
			tvar: { kind: 'box', w: STLP_HRUBKA_VIZ_MM, h: SV, d: STLP_HRUBKA_VIZ_MM },
			pos: { x, y: SV / 2, z: zWall + STLP_HRUBKA_VIZ_MM / 2 }
		});
	}

	// --- hlavné nosníky: predný (na FV) + pri stene (na SV), po celej šírke,
	//     horná hrana zarovnaná s vrcholom stĺpov ---
	diely.push({
		rola: 'ram',
		tvar: { kind: 'box', w: S, h: NOSNIK_HRUBKA_MM, d: NOSNIK_Z_MM },
		pos: { x: 0, y: FV - NOSNIK_HRUBKA_MM / 2, z: zFront - NOSNIK_Z_MM / 2 }
	});
	diely.push({
		rola: 'ram',
		tvar: { kind: 'box', w: S, h: NOSNIK_HRUBKA_MM, d: NOSNIK_Z_MM },
		pos: { x: 0, y: SV - NOSNIK_HRUBKA_MM / 2, z: zWall + NOSNIK_Z_MM / 2 }
	});

	// rovina strechy: y v strede hĺbky (z=0) = priemer výšok; dĺžka pozdĺž spádu
	const roofMidY = (FV + SV) / 2;
	const roofLen = Math.sqrt(H * H + (SV - FV) * (SV - FV));

	// --- krokvy: na každej hranici strešného panelu (panelPocet+1), sklonené o
	//     `alfa` okolo osi X → predný koniec klesne na (y=FV,z=+H/2), koniec pri
	//     stene stúpne na (y=SV,z=−H/2). Vrch krokvy ~ rovina strechy. ---
	for (let j = 0; j <= panelPocet; j++) {
		const x = -S / 2 + (S * j) / panelPocet;
		diely.push({
			rola: 'ram',
			tvar: { kind: 'box', w: KROKVA_W_MM, h: KROKVA_H_MM, d: roofLen },
			rot: { x: alfa, y: 0, z: 0 },
			pos: { x, y: roofMidY - KROKVA_H_MM / 2, z: 0 }
		});
	}

	// --- strešné sklo: panelPocet panelov, každý vyplní jedno pole medzi
	//     krokvami, po sklonenej rovine tesne nad krokvami ---
	const panelSirka = Math.max(1, defaultPanelSirka(S, panelPocet));
	for (let k = 0; k < panelPocet; k++) {
		const x = -S / 2 + ((k + 0.5) * S) / panelPocet;
		diely.push({
			rola: 'sklo',
			tvar: { kind: 'box', w: panelSirka, h: SKLO_HRUBKA_MM, d: roofLen },
			rot: { x: alfa, y: 0, z: 0 },
			pos: { x, y: roofMidY + SKLO_HRUBKA_MM / 2, z: 0 }
		});
	}

	// RAL — hex sa rieši v materialy.ts (farbaKonstrukcie); tu len povinná
	// poznámka o ilustračnej farbe PRESNE pri voľnom labeli (§2.7, rovnako ako
	// zasklenia)
	if (vst.ralKod === RAL_INY_KOD) {
		poznamky.push(
			`Farba je len ilustračná — RAL ${vst.ral ?? ''} nie je vo vzorkovníku náhľadu.`.trim()
		);
	}

	return {
		diely,
		// bbox.h = horná hrana konštrukcie pri stene (SV); strešné sklo ju
		// presahuje len o svoju hrúbku (zanedbateľné pre rámovanie kamery)
		bbox: { w: S, h: SV, d: H },
		presnost: 'vykresova',
		poznamky
	};
}
