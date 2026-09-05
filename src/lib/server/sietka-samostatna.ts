// Dodatočná sieťka BEZ posuvu (#89 — „90 % prípadov": zákazník má posuv už
// namontovaný a sieťku chce dodatočne). Parsovanie a serverová validácia vstupu.
// Žije v $lib/server (nie v +page.server.ts), rovnaký dôvod ako fix-vstup.ts —
// SvelteKit z page-server súboru exportuje len load/actions, takto sa vstup dá
// priamo unit-testovať.
//
// Money (KOREKCIA 2026-08-02, #89): pre INTERNÝCH používateľov appka POČÍTA aj
// ODOSIELA odpis (`sietkaSamostatnaVypocet` v `compute.ts` — 2 rámové rezy + 1
// nosový rez, pri 2K aj 3K koľajnicu), rovnakým `writeOdpis`/MONEY_LIVE mechanizmom
// ako Zasklenia. B2B naďalej NEODPISUJE (existujúce pravidlo — len tabuľka/výpočet).
import { SIETKA_SAMOSTATNA_SYSTEMY, type Sietka } from '$lib/sietka';
import { parseSietka } from './vstup';

export interface SietkaSamostatnaVstup {
	zak: string;
	op: string;
	zakaznik: string;
	/** systém posuvu, ku ktorému sieťka patrí — len Robust/Slide */
	system: string;
	/** štýl posuvu (počet krídel) — určuje, či treba upozornenie/koľajnicu 3K */
	styl: string;
	/** rozmery OTVORU (posuvu, nie skla/sieťoviny) [mm] */
	otvorS: number;
	otvorV: number;
	sietka: Sietka;
	poznamka: string;
}

function num(form: FormData, k: string): number {
	const x = parseFloat(String(form.get(k) ?? '').replace(',', '.'));
	return Number.isFinite(x) ? x : 0;
}

function numVal(v: unknown): number {
	const x = parseFloat(String(v ?? '').replace(',', '.'));
	return Number.isFinite(x) ? x : 0;
}

/** Validuje polia JEDNÉHO kusu sieťky (systém/štýl/rozmery otvoru) — zdieľané medzi
 *  jednokusovým (`parseSietkaSamostatnaVstup`) aj viackusovým (`parseSietkaMultiVstup`,
 *  #473) parsovaním, aby obe cesty hlásili IDENTICKÉ chyby a nikdy sa nerozišli
 *  (rovnaký dôvod ako `SIETKA_SYSTEMY_DELENA_KOLAJNICA` sync guard v `sietka.ts`). */
function chybaSietkaKusu(
	k: Pick<SietkaSamostatnaVstup, 'system' | 'styl' | 'otvorS' | 'otvorV'>
): string | null {
	if (!SIETKA_SAMOSTATNA_SYSTEMY.includes(k.system)) return 'Vyber systém (Robust alebo Slide).';
	if (!k.styl) return 'Vyber štýl (počet krídel posuvu).';
	if (!(k.otvorS >= 300 && k.otvorS <= 20000)) return 'Šírka otvoru musí byť 300–20000 mm.';
	if (!(k.otvorV >= 300 && k.otvorV <= 20000)) return 'Výška otvoru musí byť 300–20000 mm.';
	return null;
}

export function parseSietkaSamostatnaVstup(form: FormData): {
	vstup: SietkaSamostatnaVstup;
	error: string | null;
} {
	const system = String(form.get('system') ?? '').trim();
	const styl = String(form.get('styl') ?? '').trim();
	// na tejto stránke je sieťka VŽDY zadaná (nie je čo zapínať) — `on` je vždy '1'
	const sk = parseSietka({ on: '1', uchyt: form.get('sietkaUchyt') });
	const vstup: SietkaSamostatnaVstup = {
		zak: String(form.get('zak') ?? '').trim(),
		op: String(form.get('op') ?? '').trim(),
		zakaznik: String(form.get('zakaznik') ?? '').trim(),
		system,
		styl,
		otvorS: num(form, 'otvorS'),
		otvorV: num(form, 'otvorV'),
		sietka: sk.sietka ?? { uchyt: 'ziadny' },
		poznamka: String(form.get('poznamka') ?? '')
			.replace(/\r\n/g, '\n')
			.trim()
			.slice(0, 300)
	};

	let error: string | null;
	if (!vstup.zak) error = 'Chýba číslo objednávky (ZAK).';
	else if (!vstup.op) error = 'Chýba OP/OPDL číslo.';
	else if (!vstup.zakaznik) error = 'Chýba zákazník.';
	else error = chybaSietkaKusu(vstup) ?? sk.error;
	return { vstup, error };
}

// --- Multi (#473): viac dodatočných sieťok naraz v JEDNOM odpise ---

export interface SietkaMultiVstup {
	zak: string;
	op: string;
	zakaznik: string;
	/** poznámka je ZDIEĽANÁ hlavičková hodnota (jedna objednávka, viac kusov) —
	 *  nie per-kus, rovnaký vzor ako CLIP multi zdieľaný `caka`. */
	poznamka: string;
	kusy: SietkaSamostatnaVstup[];
}

/**
 * Parsuje viackusový vstup z FormData — vzor `parseClipMultiVstup` (vstup.ts, #468
 * fáza 2). Kusy prichádzajú ako JSON pole v hidden inpute `sietkaKusy` (max 12).
 * Každý kus vo výstupnom `SietkaMultiVstup.kusy` nesie ZDIEĽANÉ hlavičkové polia
 * (zak/op/zakaznik/poznamka) replikované — tak ho vie priamo skonzumovať čokoľvek,
 * čo očakáva plný `SietkaSamostatnaVstup` (rovnaký vzor ako `ClipMultiVstup.kusy`).
 */
export function parseSietkaMultiVstup(form: FormData): {
	vstup: SietkaMultiVstup;
	error: string | null;
} {
	const base = {
		zak: String(form.get('zak') ?? '').trim(),
		op: String(form.get('op') ?? '').trim(),
		zakaznik: String(form.get('zakaznik') ?? '').trim(),
		poznamka: String(form.get('poznamka') ?? '')
			.replace(/\r\n/g, '\n')
			.trim()
			.slice(0, 300)
	};
	let kusyRaw: unknown;
	try {
		kusyRaw = JSON.parse(String(form.get('sietkaKusy') ?? '[]'));
	} catch {
		kusyRaw = null;
	}
	const kusy: SietkaSamostatnaVstup[] = [];
	let error: string | null = null;
	if (!base.zak) error = 'Chýba číslo objednávky (ZAK).';
	else if (!base.op) error = 'Chýba OP/OPDL číslo.';
	else if (!base.zakaznik) error = 'Chýba zákazník.';
	else if (!Array.isArray(kusyRaw) || kusyRaw.length < 1) error = 'Zadaj aspoň jednu sieťku.';
	else if (kusyRaw.length > 12) error = 'Priveľa kusov (max 12).';
	else {
		for (let i = 0; i < kusyRaw.length; i++) {
			const k = (kusyRaw[i] ?? {}) as Record<string, unknown>;
			const sk = parseSietka({ on: '1', uchyt: k.sietkaUchyt });
			const kus: SietkaSamostatnaVstup = {
				zak: base.zak,
				op: base.op,
				zakaznik: base.zakaznik,
				system: String(k.system ?? '').trim(),
				styl: String(k.styl ?? '').trim(),
				otvorS: numVal(k.otvorS),
				otvorV: numVal(k.otvorV),
				sietka: sk.sietka ?? { uchyt: 'ziadny' },
				poznamka: base.poznamka
			};
			kusy.push(kus);
			const kErr = chybaSietkaKusu(kus) ?? sk.error;
			if (kErr) {
				error = `Sieťka ${i + 1}: ${kErr}`;
				break;
			}
		}
	}
	return { vstup: { ...base, kusy }, error };
}
