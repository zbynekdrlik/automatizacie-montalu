// FIX (pevné zasklenie) katalóg (#500 round 2) — CAD kódy mapované na Money ZASP karty
// cez Money pole „Dominikov kód" (`DominokKod_UserData`). Rovnaký princíp ako pergola
// (CAD → Money skladová karta), len pergola ide cez CODE_MAP→meno profilu→PRP, zatiaľ
// čo FIX má priamy CAD kód → ZASP kód (1:1 cez Dominikov kód field).
//
// Potvrdené Dominikovým screenshotom Money artiklov (msg 1818224, 10.9.2026):
//   ZASP00116  → CAD 16101 (Rámový profil, 7500 mm)
//   ZASP00119  → CAD 16006 (Zasklievací 28 mm, 7500 mm)
//   ZASP00125  → CAD 16102 (Priečkový profil, 7500 mm)
//   ZASP00128  → CAD 16103 (Rohový stĺp, 7500 mm)
//   ZASP202413 → CAD 16104 (Zasklievací 36 mm, 7500 mm)
//
// Všetky ZASP karty majú MJ = m (metre), tyč 7500 mm. Qty do Money = počet tyčí ×
// dĺžka tyče (FFD bin-packing rezov do 7500 mm tyčí, výstup v metroch — rovnaký
// princíp ako pergola engine). Round 1 chybne liečil 16xxx ako priame Money kódy
// (s MJ=Units z Odoo, bar_mm neznáme); round 2 opravuje na ZASP karty.

import type { CadRow } from '$lib/server/pergola';

export interface FixCatalogItem {
	/** CAD kód zo Solid Edge (16xxx) — lookup kľúč v transformFix. */
	cadKod: string;
	/** Money ZASP kód (skladová karta) — cieľ odpisu. */
	kod: string;
	/** Ľudský názov profilu. */
	name: string;
	/** Dĺžka tyče v mm (všetky FIX profily = 7500). */
	bar_mm: number;
}

// Dominikovo mapovanie CAD→ZASP (msg 1818224, 10.9.2026, screenshot Money artiklov).
// Len kódy s potvrdeným „Dominikov kód" field. V1 kódy bez mapovania (16001-16005)
// a 26xxx príslušenstvo sú VYNECHANÉ — ak sa objavia v reálnom CAD → „Nenamapované"
// (honest unknown, rovnaký princíp ako round 1).
export const FIX_CATALOG: FixCatalogItem[] = [
	// V2 aktuálny systém (Cortizo COR-60 CE V2) — Patrikove kódy z reálneho CAD
	{ cadKod: '16101', kod: 'ZASP00116', name: 'Rámový profil Surový 7500 mm', bar_mm: 7500 },
	{ cadKod: '16102', kod: 'ZASP00125', name: 'Priečkový profil Surový 7500 mm', bar_mm: 7500 },
	{
		cadKod: '16103',
		kod: 'ZASP00128',
		name: 'Rohový stĺp Surový 7500 mm',
		bar_mm: 7500
	},
	{
		cadKod: '16104',
		kod: 'ZASP202413',
		name: 'Zasklievací profil 36 mm Surový 7500 mm',
		bar_mm: 7500
	},
	// V1 kód 16006 má Dominikov kód mapping (jediný V1 s potvrdeným mapovaním)
	{
		cadKod: '16006',
		kod: 'ZASP00119',
		name: 'Zasklievací profil 28 mm Surový 7500 mm',
		bar_mm: 7500
	}
];

const fixByCadKod = new Map(FIX_CATALOG.map((c) => [c.cadKod, c]));

/** Lookup CAD kód → FIX katalógový riadok, alebo `undefined` (neznámy kód). */
export function fixLookup(cadKod: string): FixCatalogItem | undefined {
	return fixByCadKod.get(cadKod);
}

/**
 * First Fit Decreasing bin-packing: zabaliť kusy do tyčí dĺžky `bar`.
 * Vracia počet tyčí. Rovnaký algoritmus ako pergola `ffd` (pergola.ts:351),
 * len nie je exportovaný → lokálna kópia pre FIX.
 */
function ffd(pieces: number[], bar: number): number {
	const used: number[] = [];
	for (const p of [...pieces].sort((a, b) => b - a)) {
		let placed = false;
		for (let i = 0; i < used.length; i++) {
			if (bar - used[i]! >= p) {
				used[i] = used[i]! + p;
				placed = true;
				break;
			}
		}
		if (!placed) used.push(p);
	}
	return used.length;
}

export interface FixTransformResult {
	/** Položky s nenulovou dĺžkou rezov (do Money). */
	items: { kod: string; nazov: string; qty: number; mj: 'm' | 'ks' }[];
	/** Nerozpoznané kódy (nie sú v FIX katalógu). */
	unresolved: { cad: string; name: string }[];
	/** Trace pre zobrazenie (kód → zoznam rezov). */
	trace: {
		code: string;
		name: string;
		cuts: number[];
		totalMm: number;
		totalM: number;
		bars: number;
	}[];
	/** `true` keď VŠETKY použité kódy majú bar_mm — odpis môže ísť do Money. */
	barMmConfirmed: boolean;
	/** CAD kódy, pre ktoré bar_mm chýba (pre chybovú hlášku). */
	missingBarMm: string[];
}

/**
 * FIX transform: CAD kódy (16xxx) → Money ZASP kódy cez Dominikov kód field.
 * Qty = FFD bin-packing rezov do 7500 mm tyčí, výstup v metroch (bars × bar_mm / 1000).
 * Rovnaký princíp ako pergola engine (pergola.ts:transform → qtyByPrp).
 */
export function transformFix(rows: CadRow[]): FixTransformResult {
	// Akumuluj rezy per CAD kód
	const byCode = new Map<string, { name: string; cuts: number[] }>();
	for (const r of rows) {
		let entry = byCode.get(r.code);
		if (!entry) {
			entry = { name: r.name, cuts: [] };
			byCode.set(r.code, entry);
		}
		for (let i = 0; i < r.qty; i++) entry.cuts.push(r.cut_mm);
	}

	const items: FixTransformResult['items'] = [];
	const unresolved: FixTransformResult['unresolved'] = [];
	const trace: FixTransformResult['trace'] = [];

	for (const [cadCode, info] of byCode) {
		const cat = fixLookup(cadCode);
		if (!cat) {
			unresolved.push({ cad: cadCode, name: info.name });
			continue;
		}

		const totalMm = info.cuts.reduce((s, c) => s + c, 0);
		const totalM = Math.round((totalMm / 1000) * 1000) / 1000;

		// FFD bin-packing: zabaliť rezy do tyčí, spočítať koľko tyčí treba.
		// Rezy > bar_mm: ceil(rez / bar_mm) tyčí (kus dlhší ako tyč = viac tyčí, spojených).
		const fitsInBar = info.cuts.filter((c) => c <= cat.bar_mm);
		const oversize = info.cuts.filter((c) => c > cat.bar_mm);
		const oversizeBars = oversize.reduce((s, c) => s + Math.ceil(c / cat.bar_mm), 0);
		const bars = ffd(fitsInBar, cat.bar_mm) + oversizeBars;

		// Qty = počet tyčí × dĺžka tyče v metroch (celkový materiál vrátane odpadu)
		const qty = Math.round((bars * cat.bar_mm) / 10) / 100; // mm → m, rounded to 3dp

		items.push({ kod: cat.kod, nazov: cat.name, qty, mj: 'm' });

		trace.push({
			code: cadCode,
			name: cat.name,
			cuts: info.cuts,
			totalMm,
			totalM,
			bars
		});
	}

	const missingBarMm: string[] = []; // round 2: all mapped codes have bar_mm
	const barMmConfirmed = missingBarMm.length === 0 && items.length > 0;

	return { items, unresolved, trace, barMmConfirmed, missingBarMm };
}

/**
 * Validácia FIX CAD vstupu — rovnaká sémantika ako `validatePergola`:
 * chýbajúce povinné polia, nerozpoznané riadky, nenamapované kódy, prázdny výstup.
 */
export function validateFix(
	zak: string,
	op: string,
	zakaznik: string,
	skipped: string[],
	result: FixTransformResult
): string | null {
	if (!zak) return 'Chýba číslo objednávky (ZAK).';
	if (!zakaznik) return 'Chýba zákazník.';
	if (result.items.length === 0 && result.unresolved.length === 0)
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
	if (result.unresolved.length)
		return (
			'Nenamapované CAD kódy: ' + result.unresolved.map((u) => u.cad + ' ' + u.name).join(', ')
		);
	if (result.items.length === 0) return 'Žiadne položky na výstup.';
	if (!op) return 'Chýba OP/OPDL číslo (ide do popisu dokladu).';
	return null;
}
