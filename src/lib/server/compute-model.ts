// Zdieľané dátové typy + jadro pure/validačných helperov výpočtu zasklení
// (LEAF vrstva — žiadne interné importy). Rozdelené z compute.ts (#249, pure-move
// split pod 1000-r. strop). Verejné API sa re-exportuje cez fasádu compute.ts,
// preto importuj z `$lib/server/compute`, nie priamo odtiaľto.

export interface SysRow {
	sysStyl: string;
	N: number;
	skloOffset: number;
}

export interface RezRow {
	sysStyl: string;
	poradie: number;
	typ: 'profil' | 'sklo';
	kod: string;
	nazov: string;
	dim: 'S' | 'V';
	koef: number;
	offset: number;
	delitN: 0 | 1;
	kerf: number;
	pocetKs: number;
	sklozavisle: 0 | 1;
	/** dĺžka tyče (mm) tohto profilu — určuje balenie AJ odpis do Money. Chýba/0
	 *  ⇒ default BAR (7500). Deluxe má profily s inou dĺžkou (kladka/klzný 3600,
	 *  5K horná koľajnica 6000) — Robust/Slide ostávajú na 7500. */
	dlzkaTyce?: number;
	/** hrúbka skla (mm), pre ktorú tento riadok platí: 0 = vždy; 6/10 = len keď je
	 *  zvolené 6mm/10mm sklo. Deluxe: kladka/klzný má dva riadky (6mm ZASP202416/424,
	 *  10mm ZASP202417/425) a sklo vyberá ten správny. Robust/Slide = 0 (vždy). */
	skloHrubka?: number;
}

export interface CfgGroup {
	N: number;
	skloOffset: number;
	rez: RezRow[];
	sklo: { s?: RezRow; v?: RezRow };
}

export type Cfg = Record<string, CfgGroup>;

export interface Kus {
	/** finálna dĺžka rezu (zobrazená robotníkovi, s prerezom) */
	rozmer: number;
	/** dĺžka spotrebovaná na tyči (bez prerezu — podľa nej sa balí) */
	dlzka: number;
	/** z ktorého posuvu kus pochádza (1-based) — len pri viac-posuvovom pláne */
	posuv?: number;
}

export interface Tyc {
	kusy: Kus[];
	/** odpad na konci tejto tyče (mm) */
	zvysok: number;
}

export interface MaterialRow {
	kod: string;
	nazov: string;
	rezy: { rozmer: number; ks: number }[];
	tyce: number;
	/** rozloženie kusov na jednotlivé tyče (pre grafický rozpis rezov) */
	bary: Tyc[];
	/** celkový odpad (mm) a % z použitých tyčí */
	odpadMm: number;
	odpadPct: number;
	/** dĺžka tyče tohto profilu (mm) — pre grafický rozpis (mierka, hlavička) */
	barLen: number;
	/** true = rez 45° (šikmý), false = rovný 90°. Deluxe + Štandard + = všetko 90°
	 *  (Zbynek / Dominik+Marek); Robust/Slide = 90° len nosový/oponový, zvyšok 45°
	 *  (podľa názvu profilu). Uhol je len na nákrese — Money odpis nemení. */
	sikmyRez: boolean;
}

export interface OdpisRow {
	kod: string;
	nazov: string;
	metre: number;
}

export interface ComputeResult {
	system: string;
	styl: string;
	S: number;
	V: number;
	N: number;
	m2: number;
	material: MaterialRow[];
	odpis: OdpisRow[];
	sklo: { sirka: number; vyska: number; pocet: number };
}

export const BAR = 7500;
/** hrúbka rezu pílového kotúča — každý rez na tyči odoberie tento materiál */
export const KOTUC = 4;
// pravidlo uhla rezu (nosový/oponový = rovný 90°) žije v client-safe $lib/cut.ts,
// aby ho mohol importovať aj klientský komponent RozpisRezov (server modul nesmie do klienta)

export const R = (x: number) => Math.round(x * 1000) / 1000;

export function buildCFG(sysRows: SysRow[], rezRows: RezRow[]): Cfg {
	const cfg: Cfg = {};
	for (const s of sysRows) {
		if (!s || !s.sysStyl) continue;
		cfg[s.sysStyl] = { N: Number(s.N), skloOffset: Number(s.skloOffset), rez: [], sklo: {} };
	}
	for (const r of rezRows) {
		if (!r || !r.sysStyl) continue;
		const g = cfg[r.sysStyl];
		if (!g) continue;
		if (r.typ === 'sklo') g.sklo[r.dim === 'S' ? 's' : 'v'] = r;
		else g.rez.push(r);
	}
	for (const k in cfg) {
		const g = cfg[k]; // for…in nad cfg — vždy prítomné; guard len pre typ
		if (g) g.rez.sort((a, b) => Number(a.poradie) - Number(b.poradie));
	}
	return cfg;
}

export function val(row: RezRow, S: number, V: number, N: number, useKerf: boolean): number {
	const DIM = row.dim === 'S' ? S : V;
	let x = Number(row.koef) * DIM + Number(row.offset) - (useKerf ? Number(row.kerf) : 0);
	if (Number(row.delitN)) x /= N;
	return x;
}

/**
 * Reálne balenie kusov do tyčí — First-Fit-Decreasing. Mieša rôzne dĺžky
 * rezov toho istého profilu na jednu tyč (napr. 2530+2530+2000 z jednej 7500),
 * ako sa reálne reže. Nahrádza pôvodný súčet-po-dĺžkach, ktorý každú dĺžku
 * počítal na samostatnú tyč a preto nadhodnocoval počet tyčí (a odpis do Money).
 */
/** FFD balenie so sledovaním, ktorý kus je na ktorej tyči (pre grafický rozpis).
 *  Každý kus rezervuje svoju dĺžku + reznú medzeru (`kerf`, default KOTUC = 4 mm) —
 *  reálny rez odoberie materiál. zvysok = skutočný odpad (offcut) po odrátaní kusov
 *  aj rezov. `kerf` je parameter (spätne kompatibilný default 4 mm) kvôli nárezovému
 *  optimalizátoru (#212), ktorý používa vlastnú reznú medzeru (default 10 mm);
 *  existujúci volajúci (zasklenia, sieťka) parameter neposielajú → ostáva 4 mm. */
export function ffdPack(kusy: Kus[], barLen: number = BAR, kerf: number = KOTUC): Tyc[] {
	const bary: Tyc[] = [];
	const rem: number[] = [];
	for (const k of [...kusy].sort((a, b) => b.dlzka - a.dlzka)) {
		const need = k.dlzka + kerf;
		let i = 0;
		// bounded scan: `i < rem.length` zaručuje, že `rem[i]` je definované
		for (; i < rem.length; i++) if (rem[i]! >= need) break;
		if (i === rem.length) {
			bary.push({ kusy: [k], zvysok: barLen - need });
			rem.push(barLen - need);
		} else {
			// vetva `i < rem.length`; `bary` a `rem` sú paralelné (spolu push vyššie)
			const bar = bary[i]!;
			const zvysok = rem[i]! - need;
			bar.kusy.push(k);
			rem[i] = zvysok;
			bar.zvysok = zvysok;
		}
	}
	// v každej tyči zoraď kusy od najdlhšieho (ako v optimalizačnom výstupe)
	for (const b of bary) b.kusy.sort((a, c) => c.dlzka - a.dlzka);
	return bary;
}

// Zhoda mien profilov (rámový / nosový) — zdieľané `sietkaExtraPocetKs` (nižšie)
// aj `sietkaSamostatnaVypocet` (compute-sietka.ts). Presunuté sem, aby model ostal
// leaf a nevznikol cyklus profily/sieťka (#249).
export const JE_RAMOVY_PROFIL = /^R[áa]mov/i;
export const JE_NOSOVY_PROFIL = /^Nosov/i;

/** +2 rámové rezy (S aj V), +1 nosový rez (V) — PEVNÁ delta na jednu sieťku, nezávislá
 *  od N (viď komentár vyššie prečo nie odvodený všeobecný vzorec). LEN Robust/Slide —
 *  Štandard/Štandard + majú VLASTNÝ mechanizmus (`sietkaStandardExtra` nižšie), lebo
 *  tento generický regex na predponu mena by na Štandarde kolidoval („Rámový profil"
 *  krajová vs „Rámový profil stredový" nos — rovnaká predpona, INÁ delta) a nevie
 *  pridať riadok s cudzím kódom (cross-systémová sieťka, #110). */
export function sietkaExtraPocetKs(system: string, r: RezRow, sietkaOn: boolean): number {
	if (!sietkaOn) return 0;
	if (system !== 'Robust' && system !== 'Slide') return 0;
	if (JE_RAMOVY_PROFIL.test(r.nazov)) return 2;
	if (JE_NOSOVY_PROFIL.test(r.nazov)) return 1;
	return 0;
}

const isFin = (x: unknown): boolean =>
	x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x));

/** Kontrola, že konfigurácia systému je kompletná a numericky platná. */
export function validSys(cfg: Cfg, ss: string): boolean {
	const g = cfg[ss];
	if (!g || !isFin(g.N) || Number(g.N) <= 0 || !isFin(g.skloOffset)) return false;
	const prof = g.rez.filter((r) => r.typ === 'profil' && r.kod);
	if (!prof.length) return false;
	if (!g.sklo.s || !g.sklo.v) return false;
	for (const r of g.rez) {
		if (![r.koef, r.offset, r.pocetKs, r.kerf].every(isFin)) return false;
	}
	if (
		!isFin(g.sklo.s.offset) ||
		!isFin(g.sklo.v.offset) ||
		!isFin(g.sklo.s.koef) ||
		!isFin(g.sklo.v.koef)
	)
		return false;
	return true;
}

/**
 * Rozsahové limity editovateľných hodnôt — druhá vrstva ochrany Money odpisu
 * (prvá je validSys). Preklep mimo rozsahu sa odmietne pri ukladaní v editore
 * AJ pri výpočte.
 */
export const BOUNDS = {
	offset: { min: -500, max: 500 },
	skloOffset: { min: 0, max: 500 },
	koef: { min: 0.1, max: 10 },
	kerf: { min: 0, max: 50 },
	pocetKs: { min: 0, max: 100 },
	N: { min: 1, max: 12 },
	// dĺžka tyče násobí odpis do Money (metre = tyče × dĺžka/1000) — preklep (600
	// namiesto 6000, 75000 namiesto 7500) sa musí odmietnuť. Reálne: 3600/6000/7500.
	dlzkaTyce: { min: 1000, max: 8000 }
};

export function inBounds(cfg: Cfg, ss: string): string | null {
	const g = cfg[ss];
	if (!g) return 'Neznámy systém/štýl.';
	if (g.N < BOUNDS.N.min || g.N > BOUNDS.N.max) return `Počet polí (N=${g.N}) mimo rozsahu.`;
	if (g.skloOffset < BOUNDS.skloOffset.min || g.skloOffset > BOUNDS.skloOffset.max)
		return `Sklo odsadenie (${g.skloOffset}) mimo rozsahu ${BOUNDS.skloOffset.min}–${BOUNDS.skloOffset.max}.`;
	const all = [...g.rez, g.sklo.s, g.sklo.v].filter(Boolean) as RezRow[];
	for (const r of all) {
		if (r.offset < BOUNDS.offset.min || r.offset > BOUNDS.offset.max)
			return `Odsadenie ${r.offset} (${r.nazov || r.kod}) mimo rozsahu ±${BOUNDS.offset.max}.`;
		if (r.koef < BOUNDS.koef.min || r.koef > BOUNDS.koef.max)
			return `Koeficient ${r.koef} (${r.nazov || r.kod}) mimo rozsahu.`;
		if (r.kerf < BOUNDS.kerf.min || r.kerf > BOUNDS.kerf.max)
			return `Prerez ${r.kerf} (${r.nazov || r.kod}) mimo rozsahu.`;
		if (r.pocetKs < BOUNDS.pocetKs.min || r.pocetKs > BOUNDS.pocetKs.max)
			return `Počet ks ${r.pocetKs} (${r.nazov || r.kod}) mimo rozsahu.`;
		if (
			r.dlzkaTyce !== undefined &&
			(r.dlzkaTyce < BOUNDS.dlzkaTyce.min || r.dlzkaTyce > BOUNDS.dlzkaTyce.max)
		)
			return `Dĺžka tyče ${r.dlzkaTyce} (${r.nazov || r.kod}) mimo rozsahu ${BOUNDS.dlzkaTyce.min}–${BOUNDS.dlzkaTyce.max} mm.`;
	}
	return null;
}
