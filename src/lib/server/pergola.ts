// Pergola: CAD nárez → Money odpis + počty tyčí pre Solid Edge.
// Port 1:1 z n8n verzie (n8n/cad2dlv/node_body.js + prepocitaj_body.js),
// overenej na 20/20 reálnych pároch proti Money exportom. Čísla nemeniť
// bez zmeny vektorov v tests/pergola.test.ts.

export interface CatalogItem {
	prp: string;
	name: string;
	bar_mm: number;
	base: string;
}

export const CATALOG: CatalogItem[] = [
	{
		prp: 'PRP202526',
		name: 'Pergola - Žlabový profil 110 V2 Surový 4500mm',
		bar_mm: 4500,
		base: 'Žlabový profil 110 V2'
	},
	{
		prp: 'PRP202525',
		name: 'Pergola - Žlabový profil 110 V2 Surový 6000mm',
		bar_mm: 6000,
		base: 'Žlabový profil 110 V2'
	},
	{
		prp: 'PRP202524',
		name: 'Pergola - Žlabový profil 110 V2 Surový 7500mm',
		bar_mm: 7500,
		base: 'Žlabový profil 110 V2'
	},
	{
		prp: 'PRP20256',
		name: 'Pergola - Žlabový profil 140 surový 4500mm',
		bar_mm: 4500,
		base: 'Žlabový profil 140'
	},
	{
		prp: 'PRP20255',
		name: 'Pergola - Žlabový profil 140 surový 6000mm',
		bar_mm: 6000,
		base: 'Žlabový profil 140'
	},
	{
		prp: 'PRP20254',
		name: 'Pergola - Žlabový profil 140 surový 7500mm',
		bar_mm: 7500,
		base: 'Žlabový profil 140'
	},
	{
		prp: 'PRP202510',
		name: 'Pergola - Kotviaci profil horny V2 surový 4500mm',
		bar_mm: 4500,
		base: 'Kotviaci profil horny V2'
	},
	{
		prp: 'PRP20259',
		name: 'Pergola - Kotviaci profil horny V2 surový 6000mm',
		bar_mm: 6000,
		base: 'Kotviaci profil horny V2'
	},
	{
		prp: 'PRP20258',
		name: 'Pergola - Kotviaci profil horny V2 surový 7500mm',
		bar_mm: 7500,
		base: 'Kotviaci profil horny V2'
	},
	{
		prp: 'PRP00044',
		name: 'Pergola - Priečkový profil 105 Surový 7500mm',
		bar_mm: 7500,
		base: 'Priečkový profil 105'
	},
	{
		prp: 'PRP00046',
		name: 'Pergola - Priečkový profil 105 (light) Surový 7500mm',
		bar_mm: 7500,
		base: 'Priečkový profil 105 (light)'
	},
	{
		prp: 'PRP20242',
		name: 'Pergola - Profil 110x110 V2 surový 7500mm',
		bar_mm: 7500,
		base: 'Profil 110x110 V2'
	},
	{
		prp: 'PRP20252',
		name: 'Pergola - Profil 140x140 surový 7500mm',
		bar_mm: 7500,
		base: 'Profil 140x140'
	},
	{
		prp: 'PRP202410',
		name: 'Pergola - Profil 110x43 V2 surový 7500mm',
		bar_mm: 7500,
		base: 'Profil 110x43 V2'
	},
	{
		prp: 'PRP202530',
		name: 'Pergola - Profil 200x140 Surový 4500mm',
		bar_mm: 4500,
		base: 'Profil 200x140'
	},
	{
		prp: 'PRP202529',
		name: 'Pergola - Profil 200x140 Surový 6000mm',
		bar_mm: 6000,
		base: 'Profil 200x140'
	},
	{
		prp: 'PRP202528',
		name: 'Pergola - Profil 200x140 Surový 7500mm',
		bar_mm: 7500,
		base: 'Profil 200x140'
	},
	{
		prp: 'PRP20243',
		name: 'Pergola - Profil 250x110 surový 4500mm',
		bar_mm: 4500,
		base: 'Profil 250x110'
	},
	{
		prp: 'PRP202411',
		name: 'Pergola - Profil 250x110 surový 6000mm',
		bar_mm: 6000,
		base: 'Profil 250x110'
	},
	{
		prp: 'PRP20244',
		name: 'Pergola - Profil 250x110 surový 7500mm',
		bar_mm: 7500,
		base: 'Profil 250x110'
	},
	{
		prp: 'PRP00047',
		name: 'Pergola - Prítlačná lišta Surový 7500mm',
		bar_mm: 7500,
		base: 'Prítlačná lišta'
	},
	{
		prp: 'PRP00040',
		name: 'Pergola - Maskovacia lišta Surový 7500mm',
		bar_mm: 7500,
		base: 'Maskovacia lišta'
	},
	{
		prp: 'PRP00042',
		name: 'Pergola - Maskovacia lišta krajova Surový 7500mm',
		bar_mm: 7500,
		base: 'Maskovacia lišta krajova'
	},
	{
		prp: 'PRP20246',
		name: 'Pergola - Zaklapávacia lišta čelná surový 7500mm',
		bar_mm: 7500,
		base: 'Zaklapávacia lišta čelná'
	},
	{
		prp: 'PRP20248',
		name: 'Pergola - Okapnica kotviaceho profilu Surový 6000mm',
		bar_mm: 6000,
		base: 'Okapnica kotviaceho profilu'
	}
];

/** Množina Money PRP kódov pergola katalógu — na validáciu ručných riadkov rezervačného
 *  odpisu (#234). Neznámy kód = varovanie (nie odmietnutie), viď `pergola-rucne.ts`. */
export function catalogCodes(): Set<string> {
	return new Set(CATALOG.map((c) => c.prp));
}

/** Katalóg pre klienta: PRP kód → krátky názov (base) — na okamžité varovanie/predvyplnenie
 *  názvu pri ručnom riadku (#234). Bez `bar_mm` (tie sú interné pre bin-packing). */
export function catalogForClient(): { kod: string; nazov: string }[] {
	return CATALOG.map((c) => ({ kod: c.prp, nazov: c.base }));
}

// CAD (Dominok) kód → profil. Zdroj: Money DominokKod_UserData.
// 18104 (light kotviaci) → V2 (light sa ruší).
const CODE_MAP: Record<string, string> = {
	'18004': 'Priečkový profil 105',
	'18005': 'Zaklapávacia lišta čelná',
	'18006': 'Prítlačná lišta',
	'18007': 'Maskovacia lišta',
	'18008': 'Maskovacia lišta krajova',
	'18013': 'Profil 110x110 V2',
	'18014': 'Profil 250x110',
	'18016': 'Profil 110x43 V2',
	'18017': 'Profil 140x140',
	'18018': 'Žlabový profil 140',
	'18019': 'Kotviaci profil horny V2',
	'18021': 'Žlabový profil 110 V2',
	'18022': 'Profil 200x140',
	'18102': 'Priečkový profil 105 (light)',
	'18104': 'Kotviaci profil horny V2'
};

const norm = (s: string) =>
	String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export interface CadRow {
	code: string;
	name: string;
	qty: number;
	cut_mm: number;
}

/**
 * Parsuje CAD nárez. `skipped` = neprázdne riadky, ktoré sa nedali prečítať —
 * volajúci ich MUSÍ ohlásiť (tichý výpadok riadku = chýbajúci materiál
 * v Money odpise, nález review; n8n verzia ich zahadzovala potichu).
 */
export function parseCad(text: string): { rows: CadRow[]; skipped: string[] } {
	const rows: CadRow[] = [];
	const skipped: string[] = [];
	for (const raw of String(text).split('\n')) {
		const line = raw.replace('\r', '');
		if (!line.trim()) continue;
		let code: string, name: string, qty: string, cut: string;
		if (line.includes('\t')) {
			const p = line.split(/\t+/);
			if (p.length < 3) {
				skipped.push(line.trim());
				continue;
			}
			const mh = p[0].trim().match(/^(\d{3,6})\s+(.*)$/);
			if (!mh) {
				skipped.push(line.trim());
				continue;
			}
			code = mh[1];
			name = mh[2].trim();
			qty = p[1];
			cut = p[2];
		} else {
			const m = line.trim().match(/^(\d{3,6})\s+(.*?)\s+(\d+)\s+([\d.,]+)\s*$/);
			if (!m) {
				skipped.push(line.trim());
				continue;
			}
			code = m[1];
			name = m[2].trim();
			qty = m[3];
			cut = m[4];
		}
		const q = parseInt(String(parseFloat(qty)), 10);
		const c = parseFloat(String(cut).replace(',', '.'));
		if (!q || !c || q <= 0 || c <= 0) {
			skipped.push(line.trim());
			continue;
		}
		rows.push({ code, name, qty: q, cut_mm: c });
	}
	return { rows, skipped };
}

export function parseInput(text: string): CadRow[] {
	return parseCad(text).rows;
}

function nearestHigher(cut: number, avail: number[]): number {
	const fit = [...avail].sort((a, b) => a - b).filter((b) => b >= cut);
	return fit.length ? fit[0] : Math.max(...avail);
}

/** rez > najdlhšia tyč → najmenšia sada tyčí so súčtom ≥ rez (min. dĺžka, potom počet) */
export function minCoverCombo(cut: number, availIn: number[]): number[] {
	const avail = [...new Set(availIn.filter(Boolean))].sort((a, b) => a - b);
	const cap = Math.ceil(cut / avail[0]) + 1;
	const counts = new Array(avail.length).fill(0);
	let bestKey: number | null = null;
	let bestCombo: number[] | null = null;
	for (;;) {
		const cnt = counts.reduce((a, b) => a + b, 0);
		if (cnt > 0) {
			const total = counts.reduce((s, c, i) => s + c * avail[i], 0);
			if (total >= cut) {
				const key = total * 1000 + cnt;
				if (bestKey === null || key < bestKey) {
					bestKey = key;
					bestCombo = [];
					counts.forEach((c, i) => {
						for (let k = 0; k < c; k++) bestCombo!.push(avail[i]);
					});
				}
			}
		}
		let i = 0;
		for (; i < counts.length; i++) {
			if (++counts[i] <= cap) break;
			counts[i] = 0;
		}
		if (i === counts.length) break;
	}
	return bestCombo || [Math.max(...avail)];
}

export interface ComboOption {
	bars: number[];
	total: number;
	cnt: number;
}

/** všetky rozumné kombinácie tyčí pre rez (na výber podľa pozície nohy) */
export function coverCombos(cut: number, availIn: number[]): ComboOption[] {
	const avail = [...new Set(availIn.filter(Boolean))].sort((a, b) => a - b);
	const maxBars = cut > avail[avail.length - 1] * 2 ? 3 : 2;
	const cap = Math.min(maxBars, Math.ceil(cut / avail[0]));
	const res: ComboOption[] = [];
	const counts = new Array(avail.length).fill(0);
	for (;;) {
		const cnt = counts.reduce((a, b) => a + b, 0);
		if (cnt >= 1 && cnt <= maxBars) {
			const total = counts.reduce((s, c, i) => s + c * avail[i], 0);
			if (total >= cut) {
				const bars: number[] = [];
				counts.forEach((c, i) => {
					for (let k = 0; k < c; k++) bars.push(avail[i]);
				});
				res.push({ bars: bars.sort((a, b) => b - a), total, cnt });
			}
		}
		let i = 0;
		for (; i < counts.length; i++) {
			if (++counts[i] <= cap + 1) break;
			counts[i] = 0;
		}
		if (i === counts.length) break;
	}
	const seen: Record<string, 1> = {};
	const out: ComboOption[] = [];
	res.sort((a, b) => a.total - b.total || a.cnt - b.cnt);
	for (const r of res) {
		const k = r.bars.join('+');
		if (!seen[k]) {
			seen[k] = 1;
			out.push(r);
		}
	}
	return out;
}

function ffd(pieces: number[], bar: number): number {
	return ffdBins(pieces, bar).length;
}

/** FFD do tyčí dĺžky `bar` — vracia využitú dĺžku každej tyče (nie len počet). */
function ffdBins(pieces: number[], bar: number): number[] {
	const used: number[] = [];
	for (const p of [...pieces].sort((a, b) => b - a)) {
		let i = 0;
		for (; i < used.length; i++) if (bar - used[i] >= p) break;
		if (i === used.length) used.push(p);
		else used[i] += p;
	}
	return used;
}

/**
 * Viac-variantový profil (žľab / kotviaci / 200x140 / 250x110 — Money ho vedie
 * v 4500 / 6000 / 7500 mm): kusy MUSIA zdieľať tyč, inak sa odpisuje materiál
 * navyše (ZAK2026337: 6400 + 1030 dalo 7,5 + 4,5 m namiesto jednej 7,5 m tyče).
 *
 * Skúsi zabaliť do tyčí každej dostupnej dĺžky ≥ najdlhší kus, potom KAŽDÚ tyč
 * zmenší na najkratšiu variantu, ktorá na jej obsah stačí, a vyberie variant s
 * najmenším celkovým materiálom (pri zhode menej tyčí). Bez prídavku na kotúč —
 * rovnako ako zvyšok pergola enginu, overeného proti reálnym Money exportom.
 */
function packMulti(pieces: number[], avail: number[]): Record<number, number> {
	const mx = Math.max(...avail);
	let best: { bars: Record<number, number>; total: number; cnt: number } | null = null;
	for (const bar of avail) {
		if (bar < Math.max(...pieces)) continue;
		const bars: Record<number, number> = {};
		let total = 0;
		let cnt = 0;
		for (const usedMm of ffdBins(pieces, bar)) {
			const b = nearestHigher(usedMm, avail);
			bars[b] = (bars[b] || 0) + 1;
			total += b;
			cnt++;
		}
		if (!best || total < best.total || (total === best.total && cnt < best.cnt))
			best = { bars, total, cnt };
	}
	// poistka: kus dlhší než najdlhšia tyč sem nepatrí (rieši ho minCoverCombo)
	return best ? best.bars : { [mx]: pieces.length };
}

export interface ComboCase {
	code: string;
	name: string;
	cut: number;
	minimal: number[];
	options: ComboOption[];
	familyMap: Record<number, string>;
	fieldLabel: string;
}

export interface TraceRow {
	cad: string;
	name: string;
	base: string;
	bars: Record<number, number>;
	notes: string[];
}

export interface TransformResult {
	out: { prp: string; name: string; qty: number }[];
	unresolved: { cad: string; name: string }[];
	trace: TraceRow[];
	comboCases: ComboCase[];
	qtyByPrp: Record<string, number>;
}

/**
 * Jadro odpisového výpočtu z už rozparsovaných riadkov (`CadRow[]`). `transform`
 * je tenký obal `transformRows(parseInput(text))` — správanie sa NEMENÍ (kontraktové
 * vektory `tests/pergola.test.ts` platia). Vyčlenené kvôli #221 (rezervačný odpis
 * z rozmerov): potvrdené riadky z `spocitajNarez` majú presne tvar `CadRow`, takže
 * ich stačí prehnať týmto istým, na Money pároch overeným, jadrom.
 */
export function transformRows(rows: CadRow[]): TransformResult {
	const fam: Record<string, Record<number, CatalogItem>> = {};
	for (const c of CATALOG) {
		const b = norm(c.base);
		(fam[b] = fam[b] || {})[c.bar_mm] = c;
	}
	const bycode: Record<string, { name: string; pieces: number[] }> = {};
	for (const r of rows) {
		const e = (bycode[r.code] = bycode[r.code] || { name: r.name, pieces: [] });
		for (let i = 0; i < r.qty; i++) e.pieces.push(r.cut_mm);
	}
	const qtyByPrp: Record<string, number> = {};
	const unresolved: { cad: string; name: string }[] = [];
	const trace: TraceRow[] = [];
	const comboCases: ComboCase[] = [];
	for (const code in bycode) {
		const info = bycode[code];
		const base = CODE_MAP[code] || info.name;
		const family = fam[norm(base)];
		if (!family) {
			unresolved.push({ cad: code, name: info.name });
			continue;
		}
		const avail = Object.keys(family)
			.map(Number)
			.filter(Boolean)
			.sort((a, b) => a - b);
		const barsUsed: Record<number, number> = {};
		const notes: string[] = [];
		if (avail.length === 1) {
			// single-variant: FFD na kusy ≤ tyč + ceil(p/bar) na kusy > tyč
			// (fix under-countu z 2026-06-30 — ffd by dal 1 tyč aj na 10 m rez)
			const b = avail[0];
			const small = info.pieces.filter((p) => p <= b);
			const big = info.pieces.filter((p) => p > b);
			let cnt = small.length ? ffd(small, b) : 0;
			for (const p of big) cnt += Math.ceil(p / b);
			barsUsed[b] = cnt;
		} else {
			const mx = Math.max(...avail);
			// kusy ≤ najdlhšia tyč sa balia SPOLOČNE (zdieľajú tyč); dlhšie idú
			// cez kombináciu tyčí a majú vlastnú voľbu podľa polohy nohy
			const small = info.pieces.filter((p) => p <= mx);
			if (small.length)
				for (const [b, n] of Object.entries(packMulti(small, avail)))
					barsUsed[Number(b)] = (barsUsed[Number(b)] || 0) + n;
			for (const p of info.pieces) {
				if (p <= mx) continue; // už zabalené v packMulti
				{
					for (const b of minCoverCombo(p, avail)) barsUsed[b] = (barsUsed[b] || 0) + 1;
					notes.push(
						`rez ${Math.round(p)} > ${mx} — kombinácia tyčí (žľab: spoj nad nohou skontrolovať)`
					);
					const fm: Record<number, string> = {};
					for (const b of avail) fm[b] = family[b].prp;
					const minimal = minCoverCombo(p, avail);
					let options = coverCombos(p, avail);
					// extrémne dlhý rez (> ~3 tyče) — coverCombos nič neponúkne;
					// minimal musí byť voliteľný vždy, inak stránka nemá čo zobraziť
					if (!options.length)
						options = [
							{
								bars: minimal.slice().sort((a, b) => b - a),
								total: minimal.reduce((s, x) => s + x, 0),
								cnt: minimal.length
							}
						];
					comboCases.push({
						code,
						name: info.name,
						cut: p,
						minimal,
						options,
						familyMap: fm,
						fieldLabel: `Profil ${code} ${info.name} — rez ${Math.round(p)} mm — kombinácia tyčí (podľa nohy)`
					});
				}
			}
		}
		for (const bm in barsUsed) {
			const bar = Number(bm);
			const item = family[bar] || family[nearestHigher(bar, avail)];
			const meters = Math.round(((barsUsed[bar] * bar) / 1000) * 1000) / 1000;
			qtyByPrp[item.prp] = (qtyByPrp[item.prp] || 0) + meters;
		}
		trace.push({ cad: code, name: info.name, base, bars: { ...barsUsed }, notes });
	}
	// duplicitné labely (dva kusy s rovnakým rezom) rozlíš — voľby sú kľúčované
	// indexom, ale label vidí užívateľ a musí vedieť, ktorý kus vyberá
	const labelCount: Record<string, number> = {};
	for (const c of comboCases) labelCount[c.fieldLabel] = (labelCount[c.fieldLabel] || 0) + 1;
	const labelSeen: Record<string, number> = {};
	for (const c of comboCases) {
		if (labelCount[c.fieldLabel] > 1) {
			labelSeen[c.fieldLabel] = (labelSeen[c.fieldLabel] || 0) + 1;
			c.fieldLabel += ` (kus ${labelSeen[c.fieldLabel]})`;
		}
	}
	const out = CATALOG.map((c) => ({ prp: c.prp, name: c.name, qty: qtyByPrp[c.prp] || 0 }));
	return { out, unresolved, trace, comboCases, qtyByPrp };
}

/** CAD nárez text → Money odpis (obal `transformRows(parseInput(text))`). */
export function transform(text: string): TransformResult {
	return transformRows(parseInput(text));
}

// numericky — lexikografický sort by pri tyči ≥10000 mm porovnával zle
const sortedKey = (bars: number[]) =>
	bars
		.slice()
		.sort((a, b) => a - b)
		.join('+');

export const fmtBars = (dict: Record<number, number>): string => {
	const ks = Object.keys(dict)
		.map(Number)
		.filter((b) => dict[b] > 0)
		.sort((a, b) => a - b);
	return ks.map((b) => dict[b] + '(' + String(b / 1000).replace('.', ',') + 'm)').join(' ');
};

export interface CadCopyLine {
	code: string;
	name: string;
	barsStr: string;
}

/**
 * Počty tyčí pre Solid Edge — jeden riadok na CAD kód, v poradí prvého
 * výskytu vo vstupe, s aplikovanými voľbami kombinácií.
 * `choices` je kľúčované INDEXOM v r.comboCases — dva kusy s rovnakým rezom
 * majú rovnaký label, index je jednoznačný (nález review).
 */
export function buildCopyBack(
	text: string,
	r: TransformResult,
	choices: Map<number, number[]>
): { lines: CadCopyLine[]; totalBars: number } {
	const inputRows = parseInput(text);
	const seen: Record<string, 1> = {};
	const ord: string[] = [];
	for (const rw of inputRows) {
		if (!seen[rw.code]) {
			seen[rw.code] = 1;
			ord.push(rw.code);
		}
	}
	const lines: CadCopyLine[] = [];
	let totalBars = 0;
	for (const code of ord) {
		const t = r.trace.find((x) => x.cad === code);
		if (!t) continue;
		const dict: Record<number, number> = { ...t.bars };
		r.comboCases.forEach((c, idx) => {
			if (c.code !== code) return;
			const chosen = choices.get(idx) ?? c.minimal;
			if (sortedKey(chosen) === sortedKey(c.minimal)) return;
			for (const b of c.minimal) dict[b] = (dict[b] || 0) - 1;
			for (const b of chosen) dict[b] = (dict[b] || 0) + 1;
		});
		totalBars += Object.values(dict).reduce((s, x) => s + x, 0);
		lines.push({ code, name: t.name || t.base, barsStr: fmtBars(dict) });
	}
	return { lines, totalBars };
}

/**
 * Aplikuje voľby kombinácií na Money množstvá (minimal → zvolená kombinácia).
 * Port prepocitaj_body.js; `choices` kľúčované indexom v r.comboCases.
 */
export function applyCombos(
	r: TransformResult,
	choices: Map<number, number[]>
): Record<string, number> {
	const q = { ...r.qtyByPrp };
	r.comboCases.forEach((c, idx) => {
		const bars = choices.get(idx) ?? c.minimal;
		if (sortedKey(bars) === sortedKey(c.minimal)) return;
		for (const b of c.minimal) {
			const p = c.familyMap[b];
			q[p] = Math.round(((q[p] || 0) - b / 1000) * 1000) / 1000;
		}
		for (const b of bars) {
			const p = c.familyMap[b];
			q[p] = Math.round(((q[p] || 0) + b / 1000) * 1000) / 1000;
		}
	});
	return q;
}

/**
 * Parsuje voľbu z radio hodnoty „4500+6000 mm (10.5 m)…" → [4500,6000].
 * Voľba MUSÍ byť z ponúknutých kombinácií (options) — sfalšovaný/poškodený
 * POST s neexistujúcimi tyčami by cez familyMap ticho vypustil materiál
 * z Money odpisu (nález review). Neplatná voľba padá na minimal.
 */
export function parseChoice(
	value: string | undefined,
	minimal: number[],
	options?: ComboOption[]
): number[] {
	if (value) {
		const m = String(value).match(/^([0-9+]+)/);
		if (m) {
			const bars = m[1].split('+').map(Number);
			const key = sortedKey(bars);
			const valid = options
				? options.some((o) => sortedKey(o.bars) === key)
				: bars.every((b) => Number.isFinite(b) && b > 0);
			if (valid) return bars;
		}
	}
	return minimal;
}

export function comboOptionLabel(o: ComboOption, isFirst: boolean): string {
	return (
		o.bars.join('+') + ' mm (' + o.total / 1000 + ' m)' + (isFirst ? ' — najmenej odpadu' : '')
	);
}

export function validatePergola(
	zak: string,
	op: string,
	zakaznik: string,
	text: string,
	r: TransformResult
): string | null {
	const { rows, skipped } = parseCad(text);
	const nonzero = r.out.filter((o) => o.qty > 0);
	if (!zak) return 'Chýba číslo objednávky (ZAK).';
	if (!zakaznik) return 'Chýba zákazník.';
	if (rows.length === 0)
		return 'Vstup je prázdny alebo v zlom formáte. Očakávam riadky: KÓD NÁZOV KS REZ.';
	if (skipped.length)
		return (
			'Nerozpoznané riadky (oprav vstup, inak by v odpise chýbal materiál): ' +
			skipped
				.slice(0, 3)
				.map((l) => `„${l.slice(0, 60)}"`)
				.join(', ') +
			(skipped.length > 3 ? ` a ďalšie ${skipped.length - 3}` : '')
		);
	if (r.unresolved.length)
		return 'Nenamapované CAD kódy: ' + r.unresolved.map((u) => u.cad + ' ' + u.name).join(', ');
	if (nonzero.length === 0) return 'Žiadne položky na výstup.';
	if (!op) return 'Chýba OP/OPDL číslo (ide do popisu dokladu).';
	return null;
}
