// Zákaznícky 3D náhľad (#170) — zasklenia (posuv) → DielSpec[]. Pure, THREE-free,
// jednotkovo testovateľné (Vitest, žiadny DOM). Rozmery/počty sa VŽDY čerpajú z
// existujúcich appkových helperov (`sirkaKridla`, `deliaceStlpiky`) — táto funkcia
// ich nikdy neprepočítava paralelne (rovnaká disciplína ako `ZaskleniaNavrhVykres.svelte`).
//
// Os X = šírka (svet centrovaný na 0), os Y = výška od zeme (0 = spodok spodnej
// koľajnice), os Z = hĺbka smerom k pozorovateľovi (kladné = bližšie).
import { deliaceStlpiky } from '$lib/zasklenia-navrh';
import type { Klin } from '$lib/klin';
import { RAL_INY_KOD } from '$lib/vykres/ral';
import type { DielSpec, VizVysledok } from '../spec';
import {
	KLUCKA_MM,
	KLUCKA_Y_MM,
	KOLAJNICA_HORNA_H_MM,
	KOLAJNICA_SPODNA_H_MM,
	RAM_VIZ_MM,
	SIETKA_HRUBKA_MM,
	SKLO_HRUBKA_DEFAULT_MM,
	SKLO_ZAPUSTENIE_MM,
	ZASK_DRAHA_ROZTEC_MM,
	ZASK_HLBKA_MM,
	ZASK_PORADIE_OBRATENE,
	ZASK_RAM_HLBKA_MM
} from '../konstanty';

export interface ZaskleniaVizVstup {
	/** ZaskleniaNavrhVstup.s (mm, celková šírka) */
	s: number;
	/** ZaskleniaNavrhVstup.v (mm, celková výška) */
	v: number;
	/** z listSysStyly(system+styl) — NIKDY neprepočítať tu */
	n: number;
	/** smerZOtvarania(ZaskleniaNavrhVstup.otvaranie) */
	smer: 'PL' | 'LP' | 'OP';
	/** ZaskleniaNavrhVstup.ralKod */
	ralKod: string;
	/** ZaskleniaNavrhVstup.ral (voľný label) */
	ral?: string;
	/** KolajnicaRucne ($lib/kolajnica.ts) */
	kolajnica?: { horna?: number; spodna?: number };
	/** $lib/klin.ts */
	kliny?: Klin[];
	/** 0..1, default 0 */
	otvoreneNa?: number;
	// aditívne, voliteľné (preposlané z Vstup/PosuvVstup, bez zmeny Money toku):
	sklo?: string;
	skloPresne?: number;
	kovanie?: 'L' | 'P' | 'Stred' | null;
	sietka?: boolean;
}

/** Index vodiaceho krídla (to, ktoré sa pri "Otvoriť" posúva) pre danú stranu. */
function vodiaceIndexy(
	n: number,
	smer: ZaskleniaVizVstup['smer']
): { i: number; znamienko: 1 | -1 }[] {
	if (n <= 1) return [];
	if (smer === 'PL') return [{ i: 0, znamienko: -1 }];
	if (smer === 'LP') return [{ i: n - 1, znamienko: 1 }];
	// 'OP' (opona) — vejár na obe strany, krajné krídla sa rozchádzajú od stredu
	return [
		{ i: 0, znamienko: -1 },
		{ i: n - 1, znamienko: 1 }
	];
}

/** Hĺbkový (Z) "krok" krídla `i` z `n` v danom smere — nezáporné celé číslo,
 *  0 = najbližšie k referenčnej strane danej konvencie. Presná konvencia (ktoré
 *  krídlo je vpredu/vzadu) je zámerne zapísaná TU na jednom mieste — viď
 *  `ZASK_PORADIE_OBRATENE` v konstanty.ts, ak ju treba obrátiť. */
function hlbkovyKrok(i: number, n: number, smer: ZaskleniaVizVstup['smer']): number {
	if (smer === 'LP') return i;
	if (smer === 'PL') return n - 1 - i;
	// 'OP': stredné krídla vzadu (krok 0), vonkajšie vpredu (krok rastie smerom von)
	return Math.round(Math.abs(i - (n - 1) / 2));
}

function hlbkaZ(i: number, n: number, smer: ZaskleniaVizVstup['smer']): number {
	if (n <= 1) return 0;
	const off = ((n - 1) / 2) * ZASK_DRAHA_ROZTEC_MM;
	const krok = hlbkovyKrok(i, n, smer);
	const znamienko = ZASK_PORADIE_OBRATENE ? -1 : 1;
	return znamienko * (krok * ZASK_DRAHA_ROZTEC_MM - off);
}

/** Rámový box pre jeden diel krídla — klampuje hrúbku rámu tak, aby nikdy
 *  nezhltla celé krídlo pri extrémne úzkom/nízkom vstupe (rovnaký guard ako
 *  `ZaskleniaNavrhVykres.svelte`'s `ramMm`). */
function ramHrubka(leafW: number, leafH: number): number {
	return Math.max(1, Math.min(RAM_VIZ_MM, leafW * 0.3, leafH * 0.3));
}

export function zaskleniaSpec(vst: ZaskleniaVizVstup): VizVysledok {
	const { s, v } = vst;
	const n = Math.max(1, Math.round(vst.n));
	const smer = vst.smer;
	const otvoreneNa = vst.otvoreneNa ?? 0;
	const skloHrubka = vst.skloPresne ?? SKLO_HRUBKA_DEFAULT_MM;

	const stlpiky = deliaceStlpiky(s, n);
	const guide = vodiaceIndexy(n, smer);
	const diely: DielSpec[] = [];
	const poznamky: string[] = [];

	const leafYBottom = KOLAJNICA_SPODNA_H_MM;
	const leafYTop = v - KOLAJNICA_HORNA_H_MM;
	const leafH = Math.max(1, leafYTop - leafYBottom);
	const leafYCenter = (leafYBottom + leafYTop) / 2;

	const zByLeaf: number[] = [];
	const xCenterByLeaf: number[] = [];

	// stlpiky.length === n+1 (deliaceStlpiky) → stlpiky[i] a stlpiky[i+1] pre i∈[0,n) definované
	for (let i = 0; i < n; i++) {
		const xLeft = stlpiky[i]! - s / 2;
		const xRight = stlpiky[i + 1]! - s / 2;
		const leafW = Math.max(1, xRight - xLeft);
		const z = hlbkaZ(i, n, smer);
		zByLeaf.push(z);

		const posun =
			otvoreneNa > 0 ? (guide.find((g) => g.i === i)?.znamienko ?? 0) * otvoreneNa * leafW : 0;
		const xLeftO = xLeft + posun;
		const xRightO = xRight + posun;
		const xCenter = (xLeftO + xRightO) / 2;
		xCenterByLeaf.push(xCenter);

		const ram = ramHrubka(leafW, leafH);

		// zvislé stojiny (ľavá/pravá) — CELÁ výška krídla
		diely.push({
			rola: 'ram',
			tvar: { kind: 'box', w: ram, h: leafH, d: ZASK_RAM_HLBKA_MM },
			pos: { x: xLeftO + ram / 2, y: leafYCenter, z }
		});
		diely.push({
			rola: 'ram',
			tvar: { kind: 'box', w: ram, h: leafH, d: ZASK_RAM_HLBKA_MM },
			pos: { x: xRightO - ram / 2, y: leafYCenter, z }
		});
		// vodorovné priečky (horná/spodná) — medzi stojinami
		const vodorovnaW = Math.max(1, leafW - 2 * ram);
		diely.push({
			rola: 'ram',
			tvar: { kind: 'box', w: vodorovnaW, h: ram, d: ZASK_RAM_HLBKA_MM },
			pos: { x: xCenter, y: leafYTop - ram / 2, z }
		});
		diely.push({
			rola: 'ram',
			tvar: { kind: 'box', w: vodorovnaW, h: ram, d: ZASK_RAM_HLBKA_MM },
			pos: { x: xCenter, y: leafYBottom + ram / 2, z }
		});

		// tabuľa — zapustená SKLO_ZAPUSTENIE_MM zo všetkých strán, v strede
		// hĺbky krídla
		const sklaW = Math.max(1, leafW - 2 * SKLO_ZAPUSTENIE_MM);
		const sklaH = Math.max(1, leafH - 2 * SKLO_ZAPUSTENIE_MM);
		diely.push({
			rola: 'sklo',
			tvar: { kind: 'box', w: sklaW, h: sklaH, d: skloHrubka },
			pos: { x: xCenter, y: leafYCenter, z }
		});
	}

	// koľajnice — dĺžka presne podľa KolajnicaRucne, chýbajúca hodnota = s
	// (sieťka pridáva jeden krok hĺbky navyše, ak je zapnutá — viď nižšie)
	const hlbkaCela = ZASK_HLBKA_MM(n) + (vst.sietka ? ZASK_DRAHA_ROZTEC_MM : 0);
	const hornaDlzka = vst.kolajnica?.horna ?? s;
	const spodnaDlzka = vst.kolajnica?.spodna ?? s;
	diely.push({
		rola: 'kolajnica',
		tvar: { kind: 'box', w: hornaDlzka, h: KOLAJNICA_HORNA_H_MM, d: hlbkaCela },
		pos: { x: 0, y: v - KOLAJNICA_HORNA_H_MM / 2, z: 0 }
	});
	diely.push({
		rola: 'kolajnica',
		tvar: { kind: 'box', w: spodnaDlzka, h: KOLAJNICA_SPODNA_H_MM, d: hlbkaCela },
		pos: { x: 0, y: KOLAJNICA_SPODNA_H_MM / 2, z: 0 }
	});

	// kľučka — na vodiacom stojíne krídla podľa `kovanie`; null/chýba = nič
	if (vst.kovanie) {
		const idx = vst.kovanie === 'L' ? 0 : vst.kovanie === 'P' ? n - 1 : Math.floor((n - 1) / 2);
		// idx ∈ [0,n-1]; stlpiky.length === n+1, zByLeaf.length === n → definované
		const xLeft = stlpiky[idx]! - s / 2;
		const xRight = stlpiky[idx + 1]! - s / 2;
		// vnútorná (stredová) hrana toho krídla — ľavé kovanie sedí na jeho
		// pravej hrane, pravé na jeho ľavej, stred berie pravú hranu (vizuál,
		// nie katalóg — appka dnes presnú stranu pre "Stred" nezbiera)
		const x = vst.kovanie === 'P' ? xLeft : xRight;
		diely.push({
			rola: 'klucka',
			tvar: { kind: 'box', w: KLUCKA_MM.w, h: KLUCKA_MM.h, d: KLUCKA_MM.d },
			pos: { x, y: KLUCKA_Y_MM, z: zByLeaf[idx]! + ZASK_RAM_HLBKA_MM / 2 + KLUCKA_MM.d / 2 }
		});
	}

	// sieťka — jeden panel cez celú šírku, o krok hlbšie za posledným krídlom
	// (vizuál, nie katalóg — appka dnes samostatné rozmery sieťky nezbiera)
	if (vst.sietka) {
		const maxZ = zByLeaf.length ? Math.max(...zByLeaf) : 0;
		diely.push({
			rola: 'sietka',
			tvar: { kind: 'box', w: Math.max(1, s), h: leafH, d: SIETKA_HRUBKA_MM },
			pos: { x: 0, y: leafYCenter, z: maxZ + ZASK_DRAHA_ROZTEC_MM }
		});
	}

	// klin(y) nad posuvom — display-only, NIKDY nemení bbox krídel (žiadny
	// vplyv na v/s/leaf rozmery vyššie, len samostatné diely nad y = v)
	for (const klin of vst.kliny ?? []) {
		const ks = Math.max(1, Math.round(klin.ks));
		const celkovaSirka = klin.dlzka * ks;
		let x0 = -celkovaSirka / 2;
		for (let k = 0; k < ks; k++) {
			const obrys: [number, number][] = [
				[0, 0],
				[0, klin.v1],
				[klin.dlzka, klin.v2],
				[klin.dlzka, 0]
			];
			diely.push({
				rola: 'klin',
				tvar: { kind: 'extrude', obrys, dlzka: klin.sirka },
				pos: { x: x0, y: v, z: 0 }
			});
			x0 += klin.dlzka;
		}
	}

	// RAL — hex sa rieši v materialy.ts (farbaKonstrukcie), tu sa len pridá
	// povinná poznámka o ilustračnej farbe PRESNE pri voľnom labeli (nikdy
	// pri inom neznámom/prázdnom kóde — §2.7)
	if (vst.ralKod === RAL_INY_KOD) {
		poznamky.push(
			`Farba je len ilustračná — RAL ${vst.ral ?? ''} nie je vo vzorkovníku náhľadu.`.trim()
		);
	}

	return {
		diely,
		bbox: { w: s, h: v, d: hlbkaCela },
		presnost: 'vykresova',
		poznamky
	};
}
