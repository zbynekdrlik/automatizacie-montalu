// Zasklenia — výpočet nárezového plánu a odpisu do Money.
// Port 1:1 z n8n verzie (n8n/zasklenia/zasklenia_node_body_v2.js), overenej proti
// pôvodným odpisovým Excelom (robust_slide.xlsm). Čísla sa NESMÚ zmeniť bez
// zmeny testovacích vektorov v tests/compute.test.ts.

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
/** FFD balenie so sledovaním, ktorý kus je na ktorej tyči (pre grafický rozpis). */
function ffdPack(kusy: Kus[]): Tyc[] {
	const bary: Tyc[] = [];
	const rem: number[] = [];
	for (const k of [...kusy].sort((a, b) => b.dlzka - a.dlzka)) {
		let i = 0;
		for (; i < rem.length; i++) if (rem[i] >= k.dlzka) break;
		if (i === rem.length) {
			bary.push({ kusy: [k], zvysok: BAR - k.dlzka });
			rem.push(BAR - k.dlzka);
		} else {
			bary[i].kusy.push(k);
			rem[i] -= k.dlzka;
			bary[i].zvysok = rem[i];
		}
	}
	// v každej tyči zoraď kusy od najdlhšieho (ako v optimalizačnom výstupe)
	for (const b of bary) b.kusy.sort((a, c) => c.dlzka - a.dlzka);
	return bary;
}

/**
 * Vypočíta nárezový plán. `redukciaZero` = true keď zvolené sklo nuluje
 * sklo-závislé profily (Redukcia 6mm pri Slide). Ktoré sklá to sú, určuje
 * tabuľka glass_types (stĺpec redukcia_zero) — nie natvrdo zadaný reťazec.
 */
export function computeFlat(
	cfg: Cfg,
	sysStyl: string,
	S: number,
	V: number,
	redukciaZero: boolean
): ComputeResult | null {
	const g = cfg[sysStyl];
	if (!g || !g.rez.length) return null;
	const N = g.N;
	const order: string[] = [];
	const byKod: Record<string, RezRow[]> = {};
	for (const r of g.rez) {
		if (!byKod[r.kod]) {
			byKod[r.kod] = [];
			order.push(r.kod);
		}
		byKod[r.kod].push(r);
	}
	const material: MaterialRow[] = [];
	const odpis: OdpisRow[] = [];
	for (const kod of order) {
		const rows = byKod[kod];
		const rezy: { rozmer: number; ks: number }[] = [];
		// všetky kusy tohto profilu (naprieč rez-riadkami S aj V) idú do jedného
		// balenia — dĺžka pre balenie je bez prerezu (rovnaká ako v pôvodnom
		// `per` výpočte); zobrazený rozmer je s prerezom
		const kusy: Kus[] = [];
		for (const r of rows) {
			const t = Number(r.sklozavisle) && redukciaZero ? 0 : Number(r.pocetKs);
			const q = val(r, S, V, N, false);
			for (let i = 0; i < t; i++) if (q > 0) kusy.push({ dlzka: q, rozmer: Math.round(val(r, S, V, N, true)) });
			rezy.push({ rozmer: Math.round(val(r, S, V, N, true)), ks: t });
		}
		const bary = ffdPack(kusy);
		const tyce = bary.length;
		const odpadMm = Math.round(bary.reduce((s, b) => s + b.zvysok, 0));
		const odpadPct = tyce > 0 ? Math.round((odpadMm / (tyce * BAR)) * 1000) / 10 : 0;
		material.push({ kod, nazov: rows[0].nazov, rezy, tyce, bary, odpadMm, odpadPct });
		odpis.push({ kod, nazov: rows[0].nazov, metre: R((tyce * BAR) / 1000) });
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
			sirka: R(val(ss, S, V, N, true) - g.skloOffset),
			vyska: R(val(sv, S, V, N, true) - g.skloOffset),
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
	N: { min: 1, max: 12 }
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
	redukciaZero: boolean
): { r: ComputeResult | null; err: string | null } {
	if (!validSys(cfg, sysStyl)) return { r: null, err: 'Konfigurácia systému je neúplná alebo chybná.' };
	const boundErr = inBounds(cfg, sysStyl);
	if (boundErr) return { r: null, err: 'Konfigurácia mimo povolených rozsahov: ' + boundErr };
	const r = computeFlat(cfg, sysStyl, S, V, redukciaZero);
	if (!r || !r.odpis.length || !r.odpis.every((o) => Number.isFinite(o.metre) && o.metre >= 0))
		return { r: null, err: 'Výpočet zlyhal — skontroluj konfiguráciu vzorcov.' };
	return { r, err: null };
}
