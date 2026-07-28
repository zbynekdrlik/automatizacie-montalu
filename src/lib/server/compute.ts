// Zasklenia — výpočet nárezového plánu a odpisu do Money.
// Port 1:1 z n8n verzie (n8n/zasklenia/zasklenia_node_body_v2.js), overenej proti
// pôvodným odpisovým Excelom (robust_slide.xlsm). Čísla sa NESMÚ zmeniť bez
// zmeny testovacích vektorov v tests/compute.test.ts.
import { jeSikmyRez, systemRovnyRez } from '$lib/cut';
import type { Klin } from '$lib/klin';
import { rolaKolajnice, type KolajnicaRucne } from '$lib/kolajnica';

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

const R = (x: number) => Math.round(x * 1000) / 1000;

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
	for (const k in cfg) cfg[k].rez.sort((a, b) => Number(a.poradie) - Number(b.poradie));
	return cfg;
}

function val(row: RezRow, S: number, V: number, N: number, useKerf: boolean): number {
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
 *  Každý kus rezervuje svoju dĺžku + hrúbku kotúča (KOTUC) — reálny rez odoberie
 *  4 mm. zvysok = skutočný odpad (offcut) po odrátaní kusov aj rezov. */
function ffdPack(kusy: Kus[], barLen: number = BAR): Tyc[] {
	const bary: Tyc[] = [];
	const rem: number[] = [];
	for (const k of [...kusy].sort((a, b) => b.dlzka - a.dlzka)) {
		const need = k.dlzka + KOTUC;
		let i = 0;
		for (; i < rem.length; i++) if (rem[i] >= need) break;
		if (i === rem.length) {
			bary.push({ kusy: [k], zvysok: barLen - need });
			rem.push(barLen - need);
		} else {
			bary[i].kusy.push(k);
			rem[i] -= need;
			bary[i].zvysok = rem[i];
		}
	}
	// v každej tyči zoraď kusy od najdlhšieho (ako v optimalizačnom výstupe)
	for (const b of bary) b.kusy.sort((a, c) => c.dlzka - a.dlzka);
	return bary;
}

/** Rezy jedného profilu (naprieč rez-riadkami S aj V) pre jeden posuv — BEZ
 *  balenia. `posuv` (1-based) sa vloží do každého kusu, aby ho vedel rozpis
 *  označiť pri viac-posuvovom pláne. Zdieľané computeFlat aj computeMulti. */
interface ProfilCuts {
	kod: string;
	nazov: string;
	rezy: { rozmer: number; ks: number }[];
	kusy: Kus[];
	/** dĺžka tyče tohto profilu (mm) — z RezRow.dlzkaTyce, default BAR */
	barLen: number;
}

function profilCuts(
	g: CfgGroup,
	S: number,
	V: number,
	N: number,
	redukciaZero: boolean,
	skloHrubka: number,
	posuv?: number,
	rucnaKolajnica?: KolajnicaRucne
): ProfilCuts[] {
	const order: string[] = [];
	const byKod: Record<string, RezRow[]> = {};
	const sh = Number(skloHrubka) || 0; // normalizuj (SQLite INTEGER, ale buď odolný voči '6')
	for (const r of g.rez) {
		// hrúbka-závislý riadok (Deluxe kladka/klzný pre 6mm alebo 10mm sklo) sa
		// zahrnie LEN keď sedí zvolená hrúbka skla; 0 = platí vždy (Robust/Slide)
		const rh = Number(r.skloHrubka) || 0;
		if (rh !== 0 && rh !== sh) continue;
		if (!byKod[r.kod]) {
			byKod[r.kod] = [];
			order.push(r.kod);
		}
		byKod[r.kod].push(r);
	}
	return order.map((kod) => {
		const rows = byKod[kod];
		const rezy: { rozmer: number; ks: number }[] = [];
		// dĺžka pre balenie je bez prerezu; zobrazený rozmer je s prerezom
		const kusy: Kus[] = [];
		// ručne zadaná dĺžka koľajnice (Patrik): nahradí vypočítanú dĺžku pre TÚTO
		// rolu (horná / spodná). Koľajnice majú kerf 0, takže rezaná = balená dĺžka.
		const rola = rolaKolajnice(rows[0].nazov);
		const rucne = rola ? Number(rucnaKolajnica?.[rola]) || 0 : 0;
		for (const r of rows) {
			const t = Number(r.sklozavisle) && redukciaZero ? 0 : Number(r.pocetKs);
			const q = rucne > 0 ? rucne : val(r, S, V, N, false);
			const rozmer = rucne > 0 ? rucne : Math.round(val(r, S, V, N, true));
			for (let i = 0; i < t; i++)
				if (q > 0) kusy.push(posuv ? { dlzka: q, rozmer, posuv } : { dlzka: q, rozmer });
			rezy.push({ rozmer, ks: t });
		}
		// dĺžka tyče je vlastnosť profilu (Money článku) — všetky rez-riadky toho
		// istého kódu ju majú rovnakú; ber ju z prvého riadku, default BAR
		const barLen = Number(rows[0].dlzkaTyce) || BAR;
		return { kod, nazov: rows[0].nazov, rezy, kusy, barLen };
	});
}

/**
 * Kus dlhší než jeho tyč sa fyzicky NEDÁ vyrobiť (napr. 6500 mm rez z 6000 mm
 * 5K hornej koľajnice). FFD by taký kus „zabalil" na jednu tyč so záporným
 * odpadom → tyce=1 → odpis do Money PODHODNOTENÝ na polovicu. Preto to zachytíme
 * a výpočet zlyhá s konkrétnou chybou (namiesto tichého zlého odpisu). Vráti
 * správu pre prvý taký profil, inak null. Volá sa v safeCompute PRED zápisom.
 */
export function oversizeCut(
	cfg: Cfg,
	sysStyl: string,
	S: number,
	V: number,
	redukciaZero: boolean,
	skloHrubka: number,
	rucnaKolajnica?: KolajnicaRucne
): string | null {
	const g = cfg[sysStyl];
	if (!g) return null;
	for (const c of profilCuts(g, S, V, g.N, redukciaZero, skloHrubka, undefined, rucnaKolajnica)) {
		for (const k of c.kusy) {
			if (k.dlzka + KOTUC > c.barLen)
				return `Rez ${Math.round(k.rozmer)} mm (${c.nazov}) je dlhší než tyč ${c.barLen} mm — tento rozmer sa z daného profilu nedá vyrobiť. Zmenši rozmer alebo zvoľ iný systém.`;
		}
	}
	return null;
}

/**
 * Fail-loud guard: ak systém MÁ hrúbko-závislé profily (Deluxe kladka/klzný pre
 * 6/10 mm), ale pre zvolenú hrúbku skla ani jeden nesedí, `profilCuts` by ticho
 * VYNECHAL kladku aj klzný → odpis do Money podhodnotený o ~40 %. Namiesto tichého
 * fallbacku (bar codebase: „chyba sa hlási nahlas") to zachytíme a výpočet zlyhá.
 * Dnes nedosiahnuteľné cez UI (glassTypesForSystem púšťa pre Deluxe len sklá s
 * hrúbkou 6/10), ale bráni tichej regresii, ak by tá záruka niekedy padla.
 */
export function missingHrubkaProfile(
	cfg: Cfg,
	sysStyl: string,
	skloHrubka: number
): string | null {
	const g = cfg[sysStyl];
	if (!g) return null;
	const sh = Number(skloHrubka) || 0;
	const hrubkaRows = g.rez.filter((r) => (Number(r.skloHrubka) || 0) !== 0);
	if (!hrubkaRows.length) return null; // žiadne hrúbko-závislé profily (Robust/Slide) → OK
	if (hrubkaRows.some((r) => (Number(r.skloHrubka) || 0) === sh)) return null;
	return `Pre zvolenú hrúbku skla (${sh} mm) tento systém nemá kladka/klzný profil — vyber platné sklo (6 alebo 10 mm).`;
}

/**
 * Vypočíta nárezový plán. `redukciaZero` = true keď zvolené sklo nuluje
 * sklo-závislé profily (Redukcia 6mm pri Slide). Ktoré sklá to sú, určuje
 * tabuľka glass_types (stĺpec redukcia_zero) — nie natvrdo zadaný reťazec.
 */
// „Prídavná koľajnica" (Dominik 2026-07-15): checkbox → spodná koľajnica o 1 veľkosť
// vyššia. LEN Štandard + (tieto kódy zdieľa s Deluxe, preto sa swap GEJTUJE na systém).
// Dĺžka tyče je rovnaká (7500 mm) → metre v odpise ostávajú, mení sa len KÓD + názov.
// NEZÁVISLÉ od typu skla (IZO aj obyčajné — Dominik: „to že je IZO nie je podmienka").
export const RAIL_UPSIZE: Record<string, { kod: string; nazov: string }> = {
	ZASP00104: { kod: 'ZASP00030', nazov: 'Koľajnica spodná 3K Surový 7500 mm' },
	ZASP00030: { kod: 'ZASP00033', nazov: 'Koľajnica spodná 4K Surový 7500 mm' },
	ZASP00033: { kod: 'ZASP202432', nazov: 'Koľajnica spodná 5K Surový 7500 mm' },
	ZASP202432: { kod: 'ZASP202437', nazov: 'Koľajnica spodná 6K Surový 7500 mm' }
	// 6K (ZASP202437) nemá +1 — 7K koľajnica neexistuje.
};
export function railUpsize(
	system: string,
	pridavna: boolean,
	kod: string,
	nazov: string
): { kod: string; nazov: string } {
	if (pridavna && system === 'Štandard +' && RAIL_UPSIZE[kod]) return RAIL_UPSIZE[kod];
	return { kod, nazov };
}

/**
 * Systémy, kde sa dá koľajnica zadať RUČNE — tie, ktoré majú v konfigurácii
 * ODDELENÚ hornú a spodnú koľajnicu (Deluxe, Štandard +, Štandard). Robust a Slide
 * majú jednu obvodovú koľajnicu, takže „iná horná / iná spodná" tam nemá zmysel
 * (Patrik: „Robust a slide sa to stať nemôže max ešte delux"). Zoznam sa NEZADÁVA
 * natvrdo — vyplýva z názvov profilov v cfg, takže nový systém ho zdedí sám.
 */
export function systemyRucnaKolajnica(cfg: Cfg): string[] {
	const roly: Record<string, Set<string>> = {};
	for (const sysStyl in cfg) {
		const system = sysStyl.split('|')[0];
		for (const r of cfg[sysStyl].rez) {
			const rola = rolaKolajnice(r.nazov);
			if (!rola) continue;
			(roly[system] ??= new Set()).add(rola);
		}
	}
	return Object.keys(roly).filter((s) => roly[s].has('horna') && roly[s].has('spodna'));
}

export function computeFlat(
	cfg: Cfg,
	sysStyl: string,
	S: number,
	V: number,
	redukciaZero: boolean,
	skloHrubka = 0,
	pridavnaKolajnica = false,
	rucnaKolajnica?: KolajnicaRucne
): ComputeResult | null {
	const g = cfg[sysStyl];
	if (!g || !g.rez.length) return null;
	const N = g.N;
	const system = sysStyl.split('|')[0];
	const material: MaterialRow[] = [];
	const odpis: OdpisRow[] = [];
	for (const c of profilCuts(g, S, V, N, redukciaZero, skloHrubka, undefined, rucnaKolajnica)) {
		const bary = ffdPack(c.kusy, c.barLen);
		const tyce = bary.length;
		const odpadMm = Math.round(bary.reduce((s, b) => s + b.zvysok, 0));
		const odpadPct = tyce > 0 ? Math.round((odpadMm / (tyce * c.barLen)) * 1000) / 10 : 0;
		// Deluxe + Štandard + = všetko rovný 90°; inak podľa názvu profilu (nosový/oponový 90°)
		const sikmyRez = !systemRovnyRez(system) && jeSikmyRez(c.nazov);
		// prídavná koľajnica: spodná koľajnica o 1 väčšia (len Štandard +)
		const up = railUpsize(system, pridavnaKolajnica, c.kod, c.nazov);
		material.push({ kod: up.kod, nazov: up.nazov, rezy: c.rezy, tyce, bary, odpadMm, odpadPct, barLen: c.barLen, sikmyRez });
		odpis.push({ kod: up.kod, nazov: up.nazov, metre: R((tyce * c.barLen) / 1000) });
	}
	const ss = g.sklo.s,
		sv = g.sklo.v;
	if (!ss || !sv) return null;
	return {
		system: sysStyl.split('|')[0],
		styl: sysStyl.split('|')[1],
		S,
		V,
		N,
		m2: R((S * V) / 1e6),
		material,
		odpis,
		sklo: {
			// sklo sa objednáva na CELÉ milimetre (Dominik: 904,578 → 905) — zaokrúhli
			// na najbližší mm. Sklo NIE je v Money odpise, takže je to len rozmer na plán/objednávku.
			sirka: Math.round(val(ss, S, V, N, true) - g.skloOffset),
			vyska: Math.round(val(sv, S, V, N, true) - g.skloOffset),
			pocet: N
		}
	};
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

/**
 * Bezpečný výpočet: config musí prejsť validSys + inBounds a výsledok musí byť
 * konečný a nezáporný — inak vráti null a volajúci zobrazí chybu. Žiadny tichý
 * fallback (na rozdiel od n8n verzie): DB je zdroj pravdy, chyba sa hlási nahlas.
 */
export function safeCompute(
	cfg: Cfg,
	sysStyl: string,
	S: number,
	V: number,
	redukciaZero: boolean,
	skloHrubka = 0,
	pridavnaKolajnica = false,
	rucnaKolajnica?: KolajnicaRucne
): { r: ComputeResult | null; err: string | null } {
	if (!validSys(cfg, sysStyl)) return { r: null, err: 'Konfigurácia systému je neúplná alebo chybná.' };
	const boundErr = inBounds(cfg, sysStyl);
	if (boundErr) return { r: null, err: 'Konfigurácia mimo povolených rozsahov: ' + boundErr };
	const hrubkaErr = missingHrubkaProfile(cfg, sysStyl, skloHrubka);
	if (hrubkaErr) return { r: null, err: hrubkaErr };
	const overErr = oversizeCut(cfg, sysStyl, S, V, redukciaZero, skloHrubka, rucnaKolajnica);
	if (overErr) return { r: null, err: overErr };
	const r = computeFlat(cfg, sysStyl, S, V, redukciaZero, skloHrubka, pridavnaKolajnica, rucnaKolajnica);
	if (!r || !r.odpis.length || !r.odpis.every((o) => Number.isFinite(o.metre) && o.metre >= 0))
		return { r: null, err: 'Výpočet zlyhal — skontroluj konfiguráciu vzorcov.' };
	return { r, err: null };
}

// ---- Viac posuvov v jednej zákazke (zimná záhrada) ----

/** jeden posuv v rámci objednávky */
export interface PosuvSpec {
	sysStyl: string;
	S: number;
	V: number;
	redukciaZero: boolean;
	/** hrúbka zvoleného skla (mm) — vyberá Deluxe kladka/klzný profil (6/10); 0 = n/a */
	skloHrubka?: number;
	/** prídavná koľajnica — spodná koľajnica o 1 väčšia (len Štandard +) */
	pridavnaKolajnica?: boolean;
	/** ručne zadaná dĺžka hornej / spodnej koľajnice — MENÍ odpis (Patrik 2026-07-28) */
	kolajnica?: KolajnicaRucne;
	/** len na plán/detail (nemení výpočet) */
	otvaranie?: string;
	sklo?: string;
	/** kovanie ľavej/pravej strany (kľučka) — len na plán/náhľad, len Robust */
	kovanieL?: string;
	kovanieP?: string;
	/** klín nad posuvom — len na plán/náhľad, do Money odpisu NEJDE */
	klin?: Klin | null;
}

export interface PosuvInfo {
	system: string;
	styl: string;
	S: number;
	V: number;
	N: number;
	m2: number;
	sklo: { sirka: number; vyska: number; pocet: number };
	otvaranie?: string;
	skloNazov?: string;
	kovanieL?: string;
	kovanieP?: string;
	klin?: Klin | null;
	/** ručne zadané dĺžky koľajníc tohto posuvu — na plán/tlač (výpočet ich už použil) */
	kolajnica?: KolajnicaRucne | null;
}

export interface MultiResult {
	posuvy: PosuvInfo[];
	/** materiál ZLÚČENÝ naprieč posuvmi (zdieľané tyče) — kusy nesú `posuv` */
	material: MaterialRow[];
	odpis: OdpisRow[];
	/** súčet plôch všetkých posuvov */
	m2: number;
}

/**
 * Nárezový plán pre VIAC posuvov naraz. Rezy toho istého profilu (podľa kódu) sa
 * spoja naprieč VŠETKÝMI posuvmi do jedného FFD balenia → zdieľané tyče → menej
 * odpadu a menší odpis do Money než keby sa každý posuv balil samostatne. Každý
 * kus si nesie svoje číslo posuvu (pre rozpis). Sklo sa počíta per-posuv.
 * Pre jeden posuv dáva IDENTICKÝ odpis/tyče ako computeFlat (overené testom).
 */
export function computeMulti(cfg: Cfg, posuvy: PosuvSpec[]): MultiResult | null {
	if (!posuvy.length) return null;
	const infos: PosuvInfo[] = [];
	const order: string[] = [];
	const pool: Record<
		string,
		{ nazov: string; rezy: { rozmer: number; ks: number }[]; kusy: Kus[]; barLen: number; sikmyRez: boolean }
	> = {};
	for (let i = 0; i < posuvy.length; i++) {
		const p = posuvy[i];
		const g = cfg[p.sysStyl];
		if (!g || !g.rez.length || !g.sklo.s || !g.sklo.v) return null;
		const N = g.N;
		const system = p.sysStyl.split('|')[0];
		// INVARIANT: spájanie profilov po kóde na jednu tyč je bezpečné len ak KAŽDÝ
		// výskyt daného kódu (aj naprieč systémami) používa ROVNAKÚ dĺžku tyče.
		// Štandard + zdieľa 5 spodných koľajníc s Deluxe (ZASP00104/00030/00033/
		// 202432/202437), vždy s rovnakou barLen (7500), takže odpis ostáva správny.
		// Ak by konfigurácia niekedy dala ten istý kód dvom systémom s INOU dĺžkou
		// tyče, toto treba prehodnotiť. Pozn.: príznak sikmyRez pooled riadku sa
		// preberá z PRVÉHO posuvu — pri zmiešanej Deluxe+Štandard+ zákazke to môže
		// zle označiť uhol rezu iba v KRESBE (odpis nie je dotknutý).
		for (const c of profilCuts(g, p.S, p.V, N, p.redukciaZero, p.skloHrubka ?? 0, i + 1, p.kolajnica)) {
			// prídavná koľajnica: spodná koľajnica o 1 väčšia (len Štandard +) — swap
			// PRED poolovaním, aby sa metre pooli pod správnym (väčším) kódom.
			const up = railUpsize(system, p.pridavnaKolajnica ?? false, c.kod, c.nazov);
			if (!pool[up.kod]) {
				pool[up.kod] = {
					nazov: up.nazov,
					rezy: [],
					kusy: [],
					barLen: c.barLen,
					sikmyRez: !systemRovnyRez(system) && jeSikmyRez(c.nazov)
				};
				order.push(up.kod);
			}
			pool[up.kod].kusy.push(...c.kusy);
			for (const rz of c.rezy) {
				const ex = pool[up.kod].rezy.find((x) => x.rozmer === rz.rozmer);
				if (ex) ex.ks += rz.ks;
				else pool[up.kod].rezy.push({ ...rz });
			}
		}
		const ss = g.sklo.s,
			sv = g.sklo.v;
		infos.push({
			system: p.sysStyl.split('|')[0],
			styl: p.sysStyl.split('|')[1],
			S: p.S,
			V: p.V,
			N,
			m2: R((p.S * p.V) / 1e6),
			sklo: {
				sirka: Math.round(val(ss, p.S, p.V, N, true) - g.skloOffset),
				vyska: Math.round(val(sv, p.S, p.V, N, true) - g.skloOffset),
				pocet: N
			},
			otvaranie: p.otvaranie,
			skloNazov: p.sklo,
			kovanieL: p.kovanieL,
			kovanieP: p.kovanieP,
			klin: p.klin ?? null,
			kolajnica: p.kolajnica ?? null
		});
	}
	const material: MaterialRow[] = [];
	const odpis: OdpisRow[] = [];
	for (const kod of order) {
		const pk = pool[kod];
		const bary = ffdPack(pk.kusy, pk.barLen);
		const tyce = bary.length;
		const odpadMm = Math.round(bary.reduce((s, b) => s + b.zvysok, 0));
		const odpadPct = tyce > 0 ? Math.round((odpadMm / (tyce * pk.barLen)) * 1000) / 10 : 0;
		pk.rezy.sort((a, b) => b.rozmer - a.rozmer);
		material.push({ kod, nazov: pk.nazov, rezy: pk.rezy, tyce, bary, odpadMm, odpadPct, barLen: pk.barLen, sikmyRez: pk.sikmyRez });
		odpis.push({ kod, nazov: pk.nazov, metre: R((tyce * pk.barLen) / 1000) });
	}
	return { posuvy: infos, material, odpis, m2: R(infos.reduce((s, x) => s + x.m2, 0)) };
}

export function safeComputeMulti(
	cfg: Cfg,
	posuvy: PosuvSpec[]
): { r: MultiResult | null; err: string | null } {
	if (!posuvy.length) return { r: null, err: 'Zadaj aspoň jeden posuv.' };
	for (let i = 0; i < posuvy.length; i++) {
		const p = posuvy[i];
		if (!validSys(cfg, p.sysStyl))
			return { r: null, err: `Posuv ${i + 1}: konfigurácia systému je neúplná alebo chybná.` };
		const boundErr = inBounds(cfg, p.sysStyl);
		if (boundErr) return { r: null, err: `Posuv ${i + 1}: konfigurácia mimo rozsahov — ${boundErr}` };
		const hrubkaErr = missingHrubkaProfile(cfg, p.sysStyl, p.skloHrubka ?? 0);
		if (hrubkaErr) return { r: null, err: `Posuv ${i + 1}: ${hrubkaErr}` };
		const overErr = oversizeCut(
			cfg,
			p.sysStyl,
			p.S,
			p.V,
			p.redukciaZero,
			p.skloHrubka ?? 0,
			p.kolajnica
		);
		if (overErr) return { r: null, err: `Posuv ${i + 1}: ${overErr}` };
	}
	const r = computeMulti(cfg, posuvy);
	if (!r || !r.odpis.length || !r.odpis.every((o) => Number.isFinite(o.metre) && o.metre >= 0))
		return { r: null, err: 'Výpočet zlyhal — skontroluj konfiguráciu vzorcov.' };
	return { r, err: null };
}
