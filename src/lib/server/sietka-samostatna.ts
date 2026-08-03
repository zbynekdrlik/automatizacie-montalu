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
	else if (!SIETKA_SAMOSTATNA_SYSTEMY.includes(vstup.system))
		error = 'Vyber systém (Robust alebo Slide).';
	else if (!vstup.styl) error = 'Vyber štýl (počet krídel posuvu).';
	else if (!(vstup.otvorS >= 300 && vstup.otvorS <= 20000))
		error = 'Šírka otvoru musí byť 300–20000 mm.';
	else if (!(vstup.otvorV >= 300 && vstup.otvorV <= 20000))
		error = 'Výška otvoru musí byť 300–20000 mm.';
	else error = sk.error;
	return { vstup, error };
}
