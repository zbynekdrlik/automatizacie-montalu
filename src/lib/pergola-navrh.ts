// Pergola — zákaznícky NÁVRHOVÝ výkres (#138, vzor OP260032). Čistý TS bez
// závislosti na Svelte/DOM — geometria je jednotkovo testovateľná (viď
// tests/pergola-navrh.test.ts). NIKAM do Money nezapisuje — existujúci
// `/pergola` (CAD nárez → Money odpis, $lib/server/pergola.ts) sa touto
// funkcionalitou vôbec nedotýka (viď ROZHODNUTIE #138 v issue komentári).
//
// Model výšok/svetlej výšky a rozmerov strešnej výplne — a PREČO presne tieto
// konštanty — je zdokumentovaný v design komentári na #138 (gh issue comment):
// spád sa počíta ako priamy pravouhlý trojuholník z (výškaPriStene−výškaVpredu)/hĺbka;
// "svetlá výška" (clearance) = výškaVpredu − NOSNIK_HRUBKA_MM, jedna konštanta pre
// obe zobrazenia kóty (nie vymyslené magické číslo per-view); šírka strešnej výplne
// = celkováŠírka/počet − PANEL_MEDZERA_MM (presne sedí na vzore 6000/8−24=726 mm);
// dĺžka výplne = hĺbka − PANEL_TRIM_MM (sedí na vzore 3500−89=3411 mm). Číselná
// nezrovnalosť oproti vzorovému "VIEW A 2200"/"4,3°" je vo vyššie spomínanom
// komentári priznaná — jedna čestná formula, nie gamovanie jedného demo príkladu.

import type { Bod3D } from '$lib/vykres/iso';

/** hrúbka nosníka [mm] — front. výška mínus toto = "svetlá výška" (clearance) na
 *  kóte, presne sedí na vzore (2500→2310). */
export const NOSNIK_HRUBKA_MM = 190;
/** medzera medzi susednými panelmi strešnej výplne [mm] (rám/lišta) — presne sedí
 *  na vzore (6000/8 − 24 = 726). */
export const PANEL_MEDZERA_MM = 24;
/** orezanie dĺžky výplne oproti celej hĺbke [mm] — presne sedí na vzore
 *  (3500 − 89 = 3411). */
export const PANEL_TRIM_MM = 89;

/** hrúbka stĺpa V KRESBE [mm] — LEN vizuálna konštanta (#146, bod 2 —
 *  "stĺpy s hrúbkou ~90–120 mm"), nevstupuje do žiadneho výpočtu geometrie
 *  ani Money odpisu, používa ju len `PergolaNavrhVykres.svelte` na
 *  odmierkovanie hrúbky stĺpov/nosníkov v elevation/section/izometrii
 *  (rovnaká disciplína ako NOSNIK_HRUBKA_MM — dokumentovaná hodnota, nie
 *  magické číslo bez zmyslu). Stred rozsahu 90–120 mm zo zadania. */
export const STLP_HRUBKA_VIZ_MM = 100;

export const PERGOLA_MAX_POLI = 8;
export const ROZPATIE_MIN = 500;
export const ROZPATIE_MAX = 20000;
export const HLBKA_MIN = 500;
export const HLBKA_MAX = 10000;
export const VYSKA_MIN = 1500;
export const VYSKA_MAX = 4500;
export const PANEL_POCET_MIN = 1;
export const PANEL_POCET_MAX = 30;

export type ZvodStrana = 'predna' | 'zadna';

export interface ZvodPozicia {
	/** index stĺpu (0-based, pozdĺž šírky, vrátane krajných) */
	postIndex: number;
	strana: ZvodStrana;
}

export interface PergolaNavrhVstup {
	/** rozpätia polí [mm], napr. [3000, 3000] — počet stĺpov = polia.length + 1 */
	polia: number[];
	/** hĺbka [mm] */
	hlbka: number;
	/** výška vpredu (k stĺpom) [mm] */
	vyskaVpredu: number;
	/** výška pri stene (zadná, vyššia strana spádu) [mm] */
	vyskaPriStene: number;
	/** počet panelov strešnej výplne */
	panelPocet: number;
	/** ručný prepis šírky panelu [mm] — inak dopočítané z celkovej šírky/počtu */
	panelSirkaOverride?: number;
	panelDlzkaOverride?: number;
	zvody: ZvodPozicia[];
	ral: string;
	/** modrý text (napr. "FIX v 1. etape STADUR RAL 7016JŠ") */
	textVyplne: string;
	/** odkazová poznámka na izometrii (napr. "bez výplne") */
	poznamkaIzometria: string;
	op: string;
	nazov: string;
	revizia: string;
	varianta: string;
	vypracoval: string;
}

export interface PergolaGeometria {
	celkovaSirka: number;
	/** X pozície stĺpov (0-based, od 0 po celkováSirka) */
	postX: number[];
	/** spád strechy [°], kladný = stena vyššia než predok */
	sklonDeg: number;
	/** svetlá výška (clearance) vpredu [mm] */
	svetlaVyska: number;
	panelSirka: number;
	panelDlzka: number;
}

const R1 = (x: number) => Math.round(x * 10) / 10;

/** Kumulatívne X pozície stĺpov z rozpätí polí — [0, polia[0], polia[0]+polia[1], …]. */
export function stlpyZPolí(polia: number[]): number[] {
	const out: number[] = [0];
	let acc = 0;
	for (const p of polia) {
		acc += p;
		out.push(R1(acc));
	}
	return out;
}

/** Spád strechy [°] z výšky vpredu, pri stene a hĺbky — priamy pravouhlý trojuholník
 *  (protiľahlá = rozdiel výšok, priľahlá = hĺbka). Kladný = stena vyššia. */
export function vypocitajSklon(vyskaVpredu: number, vyskaPriStene: number, hlbka: number): number {
	if (!(hlbka > 0)) return 0;
	return (Math.atan((vyskaPriStene - vyskaVpredu) / hlbka) * 180) / Math.PI;
}

/** Predvolená šírka jedného panelu strešnej výplne — celková šírka rovnomerne na
 *  `panelPocet` kusov, mínus medzera na rám/lištu medzi nimi. */
export function defaultPanelSirka(celkovaSirka: number, panelPocet: number): number {
	if (!(panelPocet > 0) || !(celkovaSirka > 0)) return 0;
	return Math.max(0, R1(celkovaSirka / panelPocet - PANEL_MEDZERA_MM));
}

/** Predvolená dĺžka panelu strešnej výplne — hĺbka mínus orezanie (presah/lem). */
export function defaultPanelDlzka(hlbka: number): number {
	if (!(hlbka > 0)) return 0;
	return Math.max(0, R1(hlbka - PANEL_TRIM_MM));
}

export function vypocitajGeometriu(v: PergolaNavrhVstup): PergolaGeometria {
	const postX = stlpyZPolí(v.polia);
	const celkovaSirka = postX[postX.length - 1] ?? 0;
	return {
		celkovaSirka,
		postX,
		sklonDeg: vypocitajSklon(v.vyskaVpredu, v.vyskaPriStene, v.hlbka),
		svetlaVyska: Math.max(0, R1(v.vyskaVpredu - NOSNIK_HRUBKA_MM)),
		panelSirka: v.panelSirkaOverride ?? defaultPanelSirka(celkovaSirka, v.panelPocet),
		panelDlzka: v.panelDlzkaOverride ?? defaultPanelDlzka(v.hlbka)
	};
}

// ---------------------------------------------------------------------------
// 3D izometrická konštrukcia
// ---------------------------------------------------------------------------

export interface Hrana3D {
	a: Bod3D;
	b: Bod3D;
	/** hlavný nosný prvok (hrubšia čiara) — stĺpy/hlavné nosníky/krajné krokvy;
	 *  false = vnútorná krokva medzi panelmi (tenšia čiara) */
	hlavna: boolean;
}

/** Hrany 3D drôteného modelu konštrukcie — stĺpy (predné aj zadné), hlavné nosníky
 *  (predný aj zadný), krajné aj vnútorné krokvy pri hraniciach panelov výplne.
 *  x=šírka, y=výška (od zeme), z=hĺbka (0=vpredu, hĺbka=pri stene). */
export function izometriaHrany(g: PergolaGeometria, v: PergolaNavrhVstup): Hrana3D[] {
	const { postX, celkovaSirka } = g;
	const FV = v.vyskaVpredu;
	const SV = v.vyskaPriStene;
	const H = v.hlbka;
	const hrany: Hrana3D[] = [];

	// stĺpy — predný aj zadný rad, na každej hranici poľa
	for (const x of postX) {
		hrany.push({ a: { x, y: 0, z: 0 }, b: { x, y: FV, z: 0 }, hlavna: true });
		hrany.push({ a: { x, y: 0, z: H }, b: { x, y: SV, z: H }, hlavna: true });
	}

	// hlavné nosníky — predný aj zadný (spájajú vrcholy stĺpov pozdĺž šírky)
	hrany.push({ a: { x: 0, y: FV, z: 0 }, b: { x: celkovaSirka, y: FV, z: 0 }, hlavna: true });
	hrany.push({ a: { x: 0, y: SV, z: H }, b: { x: celkovaSirka, y: SV, z: H }, hlavna: true });

	// krokvy pri hraniciach panelov strešnej výplne (n+1 krokiev, vrátane krajných —
	// krajné sú totožné so stĺpmi na x=0/celkováSirka premietnutými cez sklon)
	const n = Math.max(1, Math.round(v.panelPocet));
	for (let j = 0; j <= n; j++) {
		const x = R1((celkovaSirka * j) / n);
		hrany.push({ a: { x, y: FV, z: 0 }, b: { x, y: SV, z: H }, hlavna: j === 0 || j === n });
	}

	return hrany;
}

export interface ZvodBod {
	bod: Bod3D;
	strana: ZvodStrana;
}

/** Kotvové body pre ZVOD šípky — stred výšky príslušného stĺpu (predný/zadný rad),
 *  podľa zadaných pozícií. Neplatný `postIndex` (mimo rozsahu stĺpov) sa preskočí. */
export function zvodoveBody(v: PergolaNavrhVstup, g: PergolaGeometria): ZvodBod[] {
	const out: ZvodBod[] = [];
	for (const z of v.zvody) {
		const x = g.postX[z.postIndex];
		if (x === undefined) continue;
		const vyska = z.strana === 'predna' ? v.vyskaVpredu : v.vyskaPriStene;
		const hz = z.strana === 'predna' ? 0 : v.hlbka;
		out.push({ bod: { x, y: vyska / 2, z: hz }, strana: z.strana });
	}
	return out;
}

/** Kotvový bod pre odkazovú čiaru poznámky ("bez výplne") — stred POSLEDNEJ sekcie
 *  strešnej výplne (posledný panel smerom k vysokému koncu), v strede hĺbky/sklonu. */
export function poznamkaKotva(g: PergolaGeometria, v: PergolaNavrhVstup): Bod3D {
	const n = Math.max(1, Math.round(v.panelPocet));
	const posledny = R1(g.celkovaSirka - g.celkovaSirka / n / 2);
	return { x: posledny, y: (v.vyskaVpredu + v.vyskaPriStene) / 2, z: v.hlbka / 2 };
}

// ---------------------------------------------------------------------------
// Validácia formulárového vstupu
// ---------------------------------------------------------------------------

/** Chybová hláška vstupu, alebo null keď je platný. Rovnaká disciplína ako
 *  `chybaFixVstupu` v `$lib/fix.ts`. */
export function chybaPergolaNavrhVstupu(v: PergolaNavrhVstup): string | null {
	if (!v.polia.length || v.polia.length > PERGOLA_MAX_POLI)
		return `Počet polí musí byť 1–${PERGOLA_MAX_POLI}.`;
	if (v.polia.some((p) => !(p >= ROZPATIE_MIN && p <= ROZPATIE_MAX)))
		return `Rozpätie poľa musí byť ${ROZPATIE_MIN}–${ROZPATIE_MAX} mm.`;
	if (!(v.hlbka >= HLBKA_MIN && v.hlbka <= HLBKA_MAX))
		return `Hĺbka musí byť ${HLBKA_MIN}–${HLBKA_MAX} mm.`;
	if (!(v.vyskaVpredu >= VYSKA_MIN && v.vyskaVpredu <= VYSKA_MAX))
		return `Výška vpredu musí byť ${VYSKA_MIN}–${VYSKA_MAX} mm.`;
	if (!(v.vyskaPriStene >= VYSKA_MIN && v.vyskaPriStene <= VYSKA_MAX))
		return `Výška pri stene musí byť ${VYSKA_MIN}–${VYSKA_MAX} mm.`;
	if (!(v.panelPocet >= PANEL_POCET_MIN && v.panelPocet <= PANEL_POCET_MAX))
		return `Počet panelov strešnej výplne musí byť ${PANEL_POCET_MIN}–${PANEL_POCET_MAX}.`;
	if (v.panelSirkaOverride !== undefined && !(v.panelSirkaOverride > 0))
		return 'Ručná šírka strešnej výplne musí byť kladné číslo.';
	if (v.panelDlzkaOverride !== undefined && !(v.panelDlzkaOverride > 0))
		return 'Ručná dĺžka strešnej výplne musí byť kladné číslo.';
	const postCount = v.polia.length + 1;
	if (v.zvody.some((z) => z.postIndex < 0 || z.postIndex >= postCount))
		return 'Neplatná pozícia zvodu.';
	// OP číslo je VOLITEĽNÉ (#144) — VO odberateľ (b2b) nemá Montalu OP číslo;
	// prázdne sa v pečiatke vykreslí ako „—" (PergolaNavrhVykres.svelte). Relaxované
	// pre VŠETKÝCH (formulár je zdieľaný interní/b2b), viď design komentár na #144.
	return null;
}
