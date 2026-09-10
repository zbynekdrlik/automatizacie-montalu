// FIX (pevné zasklenie) katalóg (#500) — data-driven z Money `Artikly_Artikl`.
// FIX CAD kódy (Dominikov kód) sú PRIAMO Money kódy (16xxx/26xxx), na rozdiel
// od pergoly (18xxx → PRP-meno cez CODE_MAP). Potvrdené live read-only SQL
// 2026-09-10: všetkých 16 článkov existuje v Money (Deleted=0), DominokKod = Kod 1:1.
//
// `bar_mm: null` = dĺžka tyče NEZNÁMA (honest-null) — Money nemá bar_mm ekvivalent
// pre FIX profily (`Delka_ID` je nerozriešiteľný GUID, Odoo má len hmotnosť/MJ).
// Bez bar_mm engine počíta LEN celkovú dĺžku rezov (nie počet tyčí). Doplnenie
// bar_mm = follow-up so zdrojom od dodávateľa (FINAL SPOLKA AKCYJNA, katalóg ZC-*V2).
//
// Qty do Money ide v METROCH (`mj: 'm'`): celková dĺžka rezov per kód. To je
// konzervativné minimum (nezahŕňa odpad); Money karta má MJ=Units, ale meter
// je honest-null fallback — presnejší odpis v ks (tyče) vyžaduje bar_mm.

import type { CadRow } from '$lib/server/pergola';

export interface FixCatalogItem {
	kod: string;
	name: string;
	/** Dĺžka tyče v mm. `null` = neznáma (honest-null); bez nej sa nedá
	 *  spočítať bin-packing na tyče, qty = celková dĺžka rezov. */
	bar_mm: number | null;
	/** Katalóg dodávateľa (Money `Artikly_Artikl.Katalog`). */
	katalog: string;
}

// V2 = aktuálny FIX systém (Cortizo COR-60 CE V2), V1 = starší (bez V2 suffixu).
// 26xxx = príslušenstvo (kovanie, krytky). Všetky overené v Money 2026-09-10.
export const FIX_CATALOG: FixCatalogItem[] = [
	// V1 (starší systém — kódy sa stále používajú v niektorých zákazkách)
	{ kod: '16001', name: 'RAMOVY PROFIL', bar_mm: null, katalog: 'ZC-0001' },
	{ kod: '16002', name: 'PRIECKOVY PROFIL', bar_mm: null, katalog: 'ZC-0002' },
	{ kod: '16003', name: 'ROZNY STLP', bar_mm: null, katalog: 'ZC-0003' },
	{ kod: '16004', name: 'ZASKLIEVACI PROFIL 38mm', bar_mm: null, katalog: 'ZC-0004' },
	{ kod: '16005', name: 'SPOJOVACI PROFIL PRIECKY', bar_mm: null, katalog: 'ZC-0005' },
	{ kod: '16006', name: 'ZASKLIEVACI PROFIL 28mm', bar_mm: null, katalog: 'ZC-0006' },
	// V2 (aktuálny systém — tieto kódy Patrik použil v reálnom CAD)
	{ kod: '16101', name: 'RAMOVY PROFIL', bar_mm: null, katalog: 'ZC-0001V2' },
	{ kod: '16102', name: 'PRIECKOVY PROFIL', bar_mm: null, katalog: 'ZC-0002V2' },
	{ kod: '16103', name: 'ROZNY STLP', bar_mm: null, katalog: 'ZC-0003V2' },
	{ kod: '16104', name: 'ZASKLIEVACI PROFIL 36mm', bar_mm: null, katalog: 'ZC-0004V2' },
	// Príslušenstvo (26xxx)
	{ kod: '26001', name: 'SPOJKA PRIECKY CLIP', bar_mm: null, katalog: '' },
	{ kod: '26002', name: 'REKTIFIKACNA NOZICKA M8x53', bar_mm: null, katalog: '' },
	{ kod: '26003', name: 'ROHOVNIK ZABRADLIA', bar_mm: null, katalog: '' },
	{ kod: '26004', name: 'ROHOVNIK STABILIZACNEHO PROFILU', bar_mm: null, katalog: '' },
	{ kod: '26101', name: 'ROHOVNIK ZABRADLIA 2020', bar_mm: null, katalog: '' },
	{ kod: '26102', name: 'KRYTKA RAMOVEHO PROFILU 2020', bar_mm: null, katalog: '' }
];

const fixByKod = new Map(FIX_CATALOG.map((c) => [c.kod, c]));

/** Lookup — vráti FIX katalógový riadok alebo `undefined` (neznámy kód). */
export function fixLookup(kod: string): FixCatalogItem | undefined {
	return fixByKod.get(kod);
}

export interface FixTransformResult {
	/** Položky s nenulovou dĺžkou rezov (do Money). */
	items: { kod: string; nazov: string; qty: number; mj: 'm' | 'ks' }[];
	/** Nerozpoznané kódy (nie sú v FIX katalógu). */
	unresolved: { cad: string; name: string }[];
	/** Trace pre zobrazenie (kód → zoznam rezov). */
	trace: { code: string; name: string; cuts: number[]; totalMm: number; totalM: number }[];
}

/**
 * FIX transform: CAD kódy sú PRIAMO Money kódy (bez CODE_MAP). Qty = celková dĺžka
 * rezov v metroch (honest-null fallback bez bar_mm). Ak bar_mm je známe, qty = počet
 * tyčí (budúce rozšírenie).
 */
export function transformFix(rows: CadRow[]): FixTransformResult {
	// Akumuluj rezy per kód
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

	for (const [code, info] of byCode) {
		const cat = fixLookup(code);
		if (!cat) {
			unresolved.push({ cad: code, name: info.name });
			continue;
		}

		const totalMm = info.cuts.reduce((s, c) => s + c, 0);
		const totalM = Math.round((totalMm / 1000) * 1000) / 1000;

		// Qty = celková dĺžka rezov v metroch (honest-null: bar_mm neznáme →
		// nemožno spočítať tyče). Keď sa bar_mm doplní, tu pribudne bin-packing
		// (rovnaký FFD ako v pergole) a qty bude v ks (tyče).
		items.push({ kod: cat.kod, nazov: cat.name, qty: totalM, mj: 'm' });

		trace.push({
			code,
			name: cat.name,
			cuts: info.cuts,
			totalMm,
			totalM
		});
	}

	return { items, unresolved, trace };
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
